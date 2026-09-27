/**
 * phone-call-requests/scan-orchestrator.ts — Always-on phone-call-request scanner.
 *
 * Structural clone of image-gen-requests/scan-orchestrator.ts:
 *   - Factory-shape module with fully-injected deps (fully unit-testable
 *     with vi.useFakeTimers() + vi.fn() — no real SSH, no real DB).
 *   - Session-less host enumeration via listSubstrateHosts (same
 *     substrate-host walker every other scanner uses).
 *   - Own per-host hostClients map (independent of every other
 *     orchestrator so lifecycles never contaminate).
 *   - Per-host in-flight guard — a slow host's scan does not block scans
 *     for other hosts on the same tick.
 *   - Per-host scan-timeout race so a wedged acquireChannel cannot hold
 *     the in-flight guard forever.
 *   - Never-throw contract on start()/stop().
 *   - LOCAL bypass (isLocalHostId) reads the request folder directly from
 *     the container-side bind-mount via scanLocalFleetFolder.
 *
 * Delta from the image-gen analog:
 *   - No companion-file case, so the scan is a single mv-and-cat pass with
 *     no follow-up per-file fetch. Simpler than the image-gen scanner.
 *   - Different folder path (~/fleet/phone-call-requests/).
 *   - Different parser output (PendingPhoneCall vs PendingImageGen).
 *
 * Cadence: default 10s tick, matching image-gen. Phone calls aren't more
 * time-sensitive than image generation, and the 15-minute agent-side wait
 * sits well above any 10-second-scale scan latency.
 */

import { systemLogger } from "../utils/logger.js";
import { parseRequestBody } from "./parse-request-body.js";
import { isLocalHostId } from "../claude-session/identity-artifact-reader.js";
import { scanLocalFleetFolder } from "../utils/local-fleet-scan.js";
import type { PendingPhoneCall } from "./types.js";

/** SSH channel shape consumed by the scan orchestrator. */
export interface SshChannel {
  exec(command: string, stdinBody?: Buffer): Promise<string | null>;
}

/**
 * A substrate host record. Only the fields consumed by this module are
 * declared; the wider `_connDetails` bag passes through opaquely to
 * acquireChannel.
 */
export interface PhoneCallScanHostRecord {
  id: string;
  name: string;
  _connDetails: Record<string, unknown>;
}

export interface PhoneCallScanOrchestratorDeps {
  listSubstrateHosts(): Promise<PhoneCallScanHostRecord[]>;
  acquireChannel(host: PhoneCallScanHostRecord): Promise<SshChannel | null>;
  releaseChannel(host: PhoneCallScanHostRecord, channel: SshChannel): void;
  enqueue(item: PendingPhoneCall): void;
  setInterval(fn: () => Promise<void> | void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(h: ReturnType<typeof setInterval>): void;
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(h: ReturnType<typeof setTimeout>): void;
  now(): number;
  scanIntervalMs?: number;
  scanTimeoutMs?: number;
}

export interface PhoneCallScanOrchestrator {
  start(): Promise<void>;
  stop(): void;
  getScanTickCount(): number;
}

// ---------------------------------------------------------------------------
// Atomic scan command + parser
// ---------------------------------------------------------------------------

/**
 * Atomic scan-and-claim command for the phone-call-requests folder.
 * Mirrors the image-gen scan shape with:
 *   - Folder swapped to ~/fleet/phone-call-requests
 *   - 36-char basename guard rejects .response.json files (basename would
 *     be longer than 36 chars).
 *
 * `mv "$f" "$tmp"` is the atomic claim primitive — a losing racer's mv
 * fails and the loop continues.
 */
export const PHONE_CALL_SCAN_CMD = [
  "cd ~/fleet/phone-call-requests 2>/dev/null || exit 0;",
  "for f in *.json; do",
  '[ -f "$f" ] || continue;',
  'base="${f%.json}";',
  "[ ${#base} -eq 36 ] || continue;",
  'tmp="$f.$$";',
  'mv "$f" "$tmp" 2>/dev/null || continue;',
  "printf '%s\\t' \"$f\"; cat \"$tmp\"; printf '\\n'; rm -f \"$tmp\";",
  "done",
].join(" ");

/**
 * Canonical UUID shape — strict 8-4-4-4-12 dashed form. Same regex as
 * image-gen's scan-orchestrator (hardened against pathological 36-char
 * strings that pass a loose hex+dash filter).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse the batched stdout from the atomic scan exec into PendingPhoneCall
 * items. Malformed request bodies still emit an item with malformedReason
 * populated so the worker's malformed shortcut fires and the caller gets a
 * proper `{outcome: "malformed", message}` response file instead of a
 * silent timeout.
 */
export function parsePhoneCallRequestBatch(
  stdout: string,
  hostId: string,
): PendingPhoneCall[] {
  if (!stdout.trim()) return [];
  const results: PendingPhoneCall[] = [];
  const hostIdNum = parseInt(hostId, 10);
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const filename = line.slice(0, tab).trim();
    const body = line.slice(tab + 1).trim();
    const uuid = filename.replace(/\.json$/, "");
    if (!UUID_RE.test(uuid)) continue;

    const parsed = parseRequestBody(uuid, body);
    if (parsed.ok === false) {
      systemLogger.warn("phone-call scan: request body malformed — enqueuing malformed", {
        operation: "phone_scan_malformed",
        fleetHostId: hostId,
        uuid,
        reason: parsed.message,
      });
      results.push({
        hostId,
        hostIdNum,
        uuid,
        body: {
          // Placeholder — worker's malformed shortcut fires before reading
          // these fields, but they need to satisfy the interface.
          caller_name: "",
          to_user: "",
          message: "",
          requested_at: new Date(0).toISOString(),
        },
        malformedReason: parsed.message,
      });
      continue;
    }

    results.push({
      hostId,
      hostIdNum,
      uuid,
      body: parsed.body,
    });
  }
  return results;
}

/**
 * Full per-host SSH scan: exec the atomic mv-claim, parse the batched
 * output, and return items ready to enqueue. Fails open on SSH errors.
 */
export async function scanPhoneCallRequests(
  host: { id: string; name: string },
  channel: SshChannel,
): Promise<PendingPhoneCall[]> {
  const stdout = await channel.exec(PHONE_CALL_SCAN_CMD);
  if (stdout === null) {
    systemLogger.warn("phone-call scan: exec returned null (SSH error)", {
      operation: "phone_scan_exec_ssh_error",
      fleetHostId: host.id,
    });
    return [];
  }
  if (!stdout.trim()) return [];
  const items = parsePhoneCallRequestBatch(stdout, host.id);
  systemLogger.info("phone-call scan: exec complete", {
    operation: "phone_scan_exec_complete",
    fleetHostId: host.id,
    claimed: items.length,
  });
  return items;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPhoneCallScanOrchestrator(
  deps: PhoneCallScanOrchestratorDeps,
): PhoneCallScanOrchestrator {
  const scanIntervalMs = deps.scanIntervalMs ?? 10000;
  const scanTimeoutMs = deps.scanTimeoutMs ?? 30000;

  const inFlight = new Set<string>();
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let scanTickCount = 0;
  let stopped = false;

  /**
   * Scan a single host. Never throws.
   *
   * LOCAL bypass matches image-gen's rationale: SSH-to-self hangs
   * indefinitely inside the container, so the local branch reads the
   * folder directly from the bind-mount.
   */
  async function scanOneHost(host: PhoneCallScanHostRecord): Promise<void> {
    const numericId = parseInt(host.id, 10);
    if (isLocalHostId(numericId)) {
      try {
        const rawItems = await scanLocalFleetFolder("phone-call-requests");
        if (rawItems.length === 0) return;
        const stdout = rawItems.map((r) => `${r.filename}\t${r.contents}`).join("\n");
        const items = parsePhoneCallRequestBatch(stdout, host.id);
        for (const item of items) deps.enqueue(item);
        systemLogger.info("phone-call scan: local exec complete", {
          operation: "phone_scan_local_exec_complete",
          fleetHostId: host.id,
          claimed: items.length,
        });
      } catch (err) {
        systemLogger.warn("phone-call scan: local per-host scan threw", {
          operation: "phone_scan_local_host_threw",
          fleetHostId: host.id,
          hostName: host.name,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
      return;
    }

    let channel: SshChannel | null = null;
    try {
      channel = await deps.acquireChannel(host);
      if (channel === null) {
        systemLogger.warn("phone-call scan: SSH acquire failed — skipping this tick", {
          operation: "phone_scan_acquire_failed",
          fleetHostId: host.id,
          hostName: host.name,
        });
        return;
      }
      const batch = await scanPhoneCallRequests(host, channel);
      for (const item of batch) deps.enqueue(item);
    } catch (err) {
      systemLogger.warn("phone-call scan: per-host scan threw unexpectedly", {
        operation: "phone_scan_host_threw",
        fleetHostId: host.id,
        hostName: host.name,
        error: err instanceof Error ? err.message : "unknown",
      });
    } finally {
      if (channel !== null) {
        try {
          deps.releaseChannel(host, channel);
        } catch {
          // best-effort
        }
      }
    }
  }

  async function scanAllHosts(): Promise<void> {
    if (stopped) return;
    scanTickCount++;

    let hosts: PhoneCallScanHostRecord[] = [];
    try {
      hosts = await deps.listSubstrateHosts();
    } catch (err) {
      systemLogger.warn("phone-call scan: host list query threw", {
        operation: "phone_scan_host_list_failed",
        error: err instanceof Error ? err.message : "unknown",
        tick: scanTickCount,
      });
      return;
    }

    if (hosts.length === 0) return;

    for (const host of hosts) {
      if (inFlight.has(host.id)) {
        systemLogger.info(
          "phone-call scan: skipping host with in-flight scan (per-host guard)",
          {
            operation: "phone_scan_skip_in_flight",
            fleetHostId: host.id,
            tick: scanTickCount,
          },
        );
        continue;
      }
      inFlight.add(host.id);
      let settled = false;
      const timeoutHandle = deps.setTimeout(() => {
        if (settled) return;
        settled = true;
        systemLogger.warn(
          "phone-call scan: per-host scan exceeded timeout — force-releasing in-flight guard",
          {
            operation: "phone_scan_timeout",
            fleetHostId: host.id,
            scanTimeoutMs,
            tick: scanTickCount,
          },
        );
        inFlight.delete(host.id);
      }, scanTimeoutMs);
      void scanOneHost(host).finally(() => {
        if (settled) return;
        settled = true;
        deps.clearTimeout(timeoutHandle);
        inFlight.delete(host.id);
      });
    }
  }

  return {
    async start(): Promise<void> {
      stopped = false;
      try {
        await scanAllHosts();
      } catch (err) {
        systemLogger.warn("phone-call scan: initial scan threw", {
          operation: "phone_scan_initial_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      }
      scanTimer = deps.setInterval(scanAllHosts, scanIntervalMs);
      systemLogger.info("Phone-call scan orchestrator started", {
        operation: "phone_scan_orchestrator_started",
        scanIntervalMs,
      });
    },

    stop(): void {
      stopped = true;
      if (scanTimer !== null) {
        deps.clearInterval(scanTimer);
        scanTimer = null;
      }
      inFlight.clear();
      systemLogger.info("Phone-call scan orchestrator stopped", {
        operation: "phone_scan_orchestrator_stopped",
      });
    },

    getScanTickCount(): number {
      return scanTickCount;
    },
  };
}
