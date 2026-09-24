/**
 * image-gen-requests/scan-orchestrator.ts — Always-on image-gen-request scanner.
 *
 * ## Why this module exists
 * Direct structural clone of spawn-requests/scan-orchestrator.ts (the always-on
 * pattern that superseded the fleet-status-piggyback scan on 2026-09-11 — see
 * RESEARCH.md Q2). This module runs an always-on tick that enumerates every
 * `runsFleetSubstrate:true` host via the session-less CSKEK path
 * (`list-substrate-hosts.ts`), acquires an SSH channel per host, atomically
 * claims request files via the mv-based scan exec, fetches any `ref` companion
 * bytes, and enqueues each PendingImageGen via queue.enqueue.
 *
 * DOES NOT modify `src/backend/fleet-status/ssh-poll-orchestrator.ts` — Phase
 * 116 CONTEXT.md D-01's "piggyback" wording is superseded by the always-on
 * pattern.
 *
 * ## Architecture
 * Mirrors `spawn-requests/scan-orchestrator.ts`:
 *   - Factory-shape module with fully injected deps (testable with
 *     `vi.useFakeTimers()` + `vi.fn()` — no real SSH, no real DB).
 *   - Session-less host enumeration via `listSubstrateHosts`.
 *   - Own per-host `hostClients` map (independent of fleet-status +
 *     substrate + spawn-scan — never contaminate each others' lifecycles).
 *   - Per-host in-flight guard (quick-260820-tm0 wilma pattern) — if a slow
 *     host's scan is still awaiting when the next tick fires, that tick
 *     skips this host and continues to the next.
 *   - Never-throw contract on `start()`/`stop()` (defense-in-depth try/catch
 *     around the tick body).
 *
 * ## Cadence
 * Default 10s tick. Image-gen isn't more time-sensitive than spawn-requests;
 * the 5-min helper poll timeout (D-16) sits well above any 10-second-scale
 * scan latency.
 *
 * ## Delta from the spawn-request analog
 * After the atomic-mv scan claims a request .json, the sweep fetches any
 * companion `<uuid>.ref.<ext>` file via a second `channel.exec("cat ... |
 * base64")` and attaches the decoded bytes as `PendingImageGen.refImage`.
 * The sweep does NOT delete the companion (D-02) — the helper script cleans
 * it up on its own timeout / success path.
 */

import { systemLogger } from "../utils/logger.js";
import { parseRequestBody } from "./parse-request-body.js";
import { isLocalHostId } from "../claude-session/identity-artifact-reader.js";
import {
  scanLocalFleetFolder,
  readLocalFleetCompanionRef,
} from "../utils/local-fleet-scan.js";
import type { PendingImageGen } from "./types.js";

/**
 * SSH channel shape consumed by the scan orchestrator. Structurally
 * identical to `SshChannel` exported by ssh-poll-orchestrator.ts:102 but
 * declared locally to keep Phase 116 free of any ssh-poll-orchestrator
 * import (RESEARCH.md Q2 invariant — the always-on scan pattern is
 * intentionally decoupled from the fleet-status per-host tick module).
 * The `stdinBody?` overload matches the ssh-poll-orchestrator contract so
 * starter.ts can hand the same channel wrappers to either orchestrator
 * without a shape mismatch.
 */
export interface SshChannel {
  exec(command: string, stdinBody?: Buffer): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A substrate host record — matches the shape returned by `listSubstrateHosts`.
 * Only the fields consumed by this module are declared; the wider
 * `_connDetails` bag passes through opaquely to `acquireChannel`.
 */
export interface ImageGenScanHostRecord {
  id: string;
  name: string;
  _connDetails: Record<string, unknown>;
}

/**
 * Injected dependencies. Every runtime side-effect (DB enumeration, SSH,
 * timers, clock, enqueue) is behind a dep so the module is fully unit-testable
 * with `vi.useFakeTimers()` + `vi.fn()`.
 */
export interface ImageGenScanOrchestratorDeps {
  /** Enumerate every substrate-eligible host from the DB. */
  listSubstrateHosts(): Promise<ImageGenScanHostRecord[]>;

  /** Open a dedicated SSH channel for a host; returns null on failure. */
  acquireChannel(host: ImageGenScanHostRecord): Promise<SshChannel | null>;

  /** Release a previously-acquired SSH channel. Prod no-op; test assertion hook. */
  releaseChannel(host: ImageGenScanHostRecord, channel: SshChannel): void;

  /** Enqueue a claimed image-gen request for the worker pool. */
  enqueue(item: PendingImageGen): void;

  /** Timer factory (injectable for tests). */
  setInterval(fn: () => Promise<void> | void, ms: number): ReturnType<typeof setInterval>;

  /** Timer cancellation. */
  clearInterval(h: ReturnType<typeof setInterval>): void;

  /**
   * One-shot timer factory (injectable for tests). Used to bound the per-host
   * scan promise so a wedged `acquireChannel` / `scanImageGenRequests` cannot
   * hold the in-flight guard indefinitely. See the sibling spawn-requests
   * scan-orchestrator's docblock for the shared rationale.
   */
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;

  /** One-shot timer cancellation. */
  clearTimeout(h: ReturnType<typeof setTimeout>): void;

  /** Clock (injectable for tests). */
  now(): number;

  /** Scan interval in ms. Default 10000. */
  scanIntervalMs?: number;

  /**
   * Per-host scan timeout in ms. Default 30000 (three scan intervals).
   * On timeout the in-flight guard is force-released with a WARN-level log
   * (`image_gen_scan_timeout`) so the next tick's scan runs.
   */
  scanTimeoutMs?: number;
}

/**
 * Public surface returned by the factory.
 */
export interface ImageGenScanOrchestrator {
  start(): Promise<void>;
  stop(): void;
  getScanTickCount(): number;
}

// ---------------------------------------------------------------------------
// Atomic scan command + parser (mirrors ssh-poll-orchestrator.ts:1198-1282
// with folder path swapped and a companion-fetch delta injected downstream)
// ---------------------------------------------------------------------------

/**
 * Atomic scan-and-claim command. Byte-for-byte mirror of
 * SPAWN_REQUESTS_SCAN_CMD at ssh-poll-orchestrator.ts:1198-1208 with the
 * folder path swapped to `~/fleet/image-gen-requests`.
 *
 * The `[ ${#base} -eq 36 ]` guard rejects `.success.json`, `.failure.json`,
 * and `.ref.png` files — their basenames are longer than 36 chars, so only
 * true request files (36-char UUID + `.json`) enter the parse path.
 *
 * The `mv "$f" "$tmp"` is the atomic-claim primitive — a losing racer's
 * mv fails and the loop continues, so a single filesystem read+delete
 * happens per file per tick.
 */
export const IMAGE_GEN_SCAN_CMD = [
  "cd ~/fleet/image-gen-requests 2>/dev/null || exit 0;",
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
 * UUID shape regex — strict canonical 8-4-4-4-12 dashed form.
 *
 * The prior loose form (`/^[0-9a-f-]{36}$/i`) accepted any 36-char string
 * composed of hex or hyphens — including pathological cases like 36 hyphens
 * (`------------------------------------`) or `abcdefff-abcd-abcd-abcd-abcdefabcde`
 * (35 hex chars misspelled to reach 36 total). These would never be produced
 * by `uuidgen` but a hostile caller writing files by hand could exploit the
 * loose match. Tightened to the canonical dashed shape (matches the
 * REF_PATTERN in parse-request-body.ts).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse the batched stdout from the atomic scan exec into an array of
 * PendingImageGen items. Mirrors parseSpawnRequestBatch structure
 * (ssh-poll-orchestrator.ts:1228-1282).
 *
 * stdout format: one line per claimed file, tab-separated:
 *   <uuid>.json<TAB><json-body><NEWLINE>
 *
 * Skips:
 * - Lines without a TAB separator.
 * - Filenames whose UUID portion fails UUID_RE.
 * - Malformed request bodies (parseRequestBody ok:false) still emit a
 *   PendingImageGen with `malformedReason: <parse error>` so the worker's
 *   malformed-shortcut drops a proper `{reason:"malformed", message}`
 *   failure file (matches the Phase 99 malformed-enqueue convention).
 *
 * userId is left as "" — the sweep does not know the origin userId (image-gen
 * requests are agent-driven, not user-driven — helper-script writes the file
 * as the box's own user). The worker uses `resolveHostById(hostIdNum, "")`
 * on the REMOTE branch; when the host record's userId is not needed for
 * decrypt (the response-file write path doesn't decrypt anything sensitive),
 * this is fine.
 */
export function parseImageGenRequestBatch(
  stdout: string,
  hostId: string,
): PendingImageGen[] {
  if (!stdout.trim()) return [];
  const results: PendingImageGen[] = [];
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
      systemLogger.warn("image-gen-scan: request body malformed — enqueueing malformed failure", {
        operation: "image_gen_scan_malformed",
        fleetHostId: hostId,
        uuid,
        reason: parsed.message,
      });
      results.push({
        hostId,
        hostIdNum,
        uuid,
        // Stub body — the worker's malformed shortcut fires before touching
        // any body field. requested_at is set to an ISO-Z placeholder so any
        // downstream Date.parse doesn't NaN.
        body: {
          prompt: "",
          requested_at: new Date(0).toISOString(),
        },
        userId: "",
        malformedReason: parsed.message,
      });
      continue;
    }

    results.push({
      hostId,
      hostIdNum,
      uuid,
      body: parsed.body,
      userId: "",
    });
  }
  return results;
}

/**
 * Maximum companion `ref` file size in bytes — matches OpenAI's documented
 * limit for gpt-image-1's /images/edits endpoint (20 MiB per image). Enforced
 * at scan time via `head -c` so an unbounded file on the host box never
 * pulls unbounded bytes over the SSH channel or into a decoded Buffer.
 *
 * The check is defense-in-depth over the caller's helper script — the helper
 * copies caller-supplied ref files by reference and doesn't validate size.
 * Without this cap, a caller could plant a 10GB file at `<uuid>.ref.png` and
 * exhaust backend memory as the scan tick reads it.
 */
export const MAX_REF_BYTES = 20 * 1024 * 1024;

/**
 * Fetch the companion `<uuid>.ref.<ext>` file bytes over the same SSH channel
 * the scan used. Uses `head -c MAX_REF_BYTES "$HOME/fleet/image-gen-requests/<ref>"
 * | base64 -w0` → decode → Buffer. `head -c` bounds the read at the OS level
 * so a runaway file never streams unbounded bytes. If the raw file exceeded
 * the cap, the base64-decoded length here will exactly equal MAX_REF_BYTES;
 * we treat that as `malformed` so the caller sees a descriptive error rather
 * than a silently-truncated image being sent to OpenAI (which would fail
 * server-side with a confusing message).
 *
 * The path prefix is fully backend-controlled (the caller-supplied `ref` was
 * validated by parseRequestBody to match the strict `<uuid>.ref.<ext>` shape
 * — no shell metacharacters, no path traversal), so shell-interpolating it
 * here is safe.
 *
 * **Cross-request companion protection:** The parser accepts any `<uuid>.ref.<ext>`
 * shape but does not know the request's own uuid at parse time. We enforce the
 * `refFilename` starts with `<requestUuid>.ref.` here — otherwise caller-A can
 * drop `<uuid-A>.json` referencing `<uuid-B>.ref.png` and steal caller-B's ref
 * bytes. Mismatch is treated as `malformed` so the worker drops a proper
 * failure file (caller sees a descriptive error instead of a silent timeout).
 *
 * Returns the Buffer on success, or a string reason on failure (the caller
 * attaches it as `malformedReason` so the worker drops a `malformed` failure).
 */
async function fetchCompanionRef(
  channel: SshChannel,
  refFilename: string,
  requestUuid: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: string }> {
  // Cross-request companion guard — the ref filename's embedded uuid MUST
  // match the request's own uuid. Prevents a hostile caller from writing a
  // request that references another caller's ref file.
  const expectedPrefix = `${requestUuid}.ref.`;
  if (!refFilename.startsWith(expectedPrefix)) {
    return {
      ok: false,
      reason: `ref filename uuid does not match request uuid: ${refFilename}`,
    };
  }

  // The parser already restricted ref to `^<uuid>\.ref\.(png|jpg|jpeg|webp)$`
  // so shell-interpolating the value is safe. Still quote it for defense in
  // depth. Use `head -c MAX_REF_BYTES` to bound reads at the OS level, then
  // pipe to `base64 -w0` (no line wrapping) so the entire payload arrives on
  // stdout as a single base64 blob we can decode.
  const cmd = `head -c ${MAX_REF_BYTES} "$HOME/fleet/image-gen-requests/${refFilename}" | base64 -w0`;
  const stdout = await channel.exec(cmd);
  if (stdout === null) {
    return { ok: false, reason: `ref companion missing or unreadable: ${refFilename}` };
  }
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: `ref companion is empty: ${refFilename}` };
  }
  try {
    const bytes = Buffer.from(trimmed, "base64");
    if (bytes.byteLength === 0) {
      return { ok: false, reason: `ref companion decoded to zero bytes: ${refFilename}` };
    }
    // Cap enforcement — `head -c` bounds the read at exactly MAX_REF_BYTES,
    // so a decoded length equal to the cap means the source file exceeded
    // it (the bounded read tail-truncated the image). Reject with a
    // descriptive `malformed` so the caller sees "reference image exceeds
    // 20MB limit" instead of a silently-truncated file being sent to OpenAI.
    if (bytes.byteLength >= MAX_REF_BYTES) {
      return {
        ok: false,
        reason: `reference image exceeds ${MAX_REF_BYTES} byte limit: ${refFilename}`,
      };
    }
    return { ok: true, bytes };
  } catch (err) {
    return {
      ok: false,
      reason: `ref companion decode failed: ${refFilename} (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

/**
 * Full per-host scan: exec the atomic mv-claim, parse the batched output,
 * fetch any companion refs, and return the array of PendingImageGen items
 * ready to enqueue. Fails open on any SSH-side error.
 */
export async function scanImageGenRequests(
  host: { id: string; name: string },
  channel: SshChannel,
): Promise<PendingImageGen[]> {
  const stdout = await channel.exec(IMAGE_GEN_SCAN_CMD);
  if (stdout === null) {
    systemLogger.warn("image-gen-scan: exec returned null (SSH error)", {
      operation: "image_gen_scan_exec_ssh_error",
      fleetHostId: host.id,
    });
    return [];
  }
  if (!stdout.trim()) {
    // Missing folder (cd ... || exit 0) OR empty folder — both non-errors.
    return [];
  }
  const items = parseImageGenRequestBatch(stdout, host.id);

  // Companion-fetch loop — for every item with body.ref set, follow up
  // with a per-file cat|base64. Two-exec approach picked because the main
  // scan's tab-separated stdout parser wasn't designed for binary payloads
  // (RESEARCH.md Q2 / Pattern 2 alternative rationale). Sequential-exec
  // cost per tick is negligible vs the scan itself.
  for (const item of items) {
    if (item.malformedReason !== undefined) continue; // skip malformed entries
    const refName = item.body.ref;
    if (refName === undefined) continue;
    const refResult = await fetchCompanionRef(channel, refName, item.uuid);
    // Explicit `=== true` narrowing per the same tsc 6.0.3 discriminated-
    // union quirk documented in Plan 01 (spawn-requests parser, adapter) —
    // `if (refResult.ok)` does NOT narrow the ok:false branch under strict
    // tsc build settings.
    if (refResult.ok === true) {
      item.refImage = refResult.bytes;
    } else {
      item.malformedReason = refResult.reason;
      systemLogger.warn("image-gen-scan: companion ref fetch failed — marking malformed", {
        operation: "image_gen_scan_ref_fetch_failed",
        fleetHostId: host.id,
        uuid: item.uuid,
        refFilename: refName,
        reason: refResult.reason,
      });
    }
  }

  systemLogger.info("image-gen-scan: exec complete", {
    operation: "image_gen_scan_exec_complete",
    fleetHostId: host.id,
    claimed: items.length,
  });
  return items;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createImageGenScanOrchestrator(
  deps: ImageGenScanOrchestratorDeps,
): ImageGenScanOrchestrator {
  const scanIntervalMs = deps.scanIntervalMs ?? 10000;
  const scanTimeoutMs = deps.scanTimeoutMs ?? 30000;

  /**
   * Per-host in-flight guard — a slow host whose scan is still awaiting when
   * the next tick fires would otherwise accumulate concurrent SSH sessions.
   * Guard is PER-HOST, NOT GLOBAL — a slow host must NOT block scans for
   * other hosts on the same tick.
   */
  const inFlight = new Set<string>();

  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let scanTickCount = 0;
  let stopped = false;

  /**
   * Scan a single host: acquire channel → scanImageGenRequests → enqueue
   * results → release channel. Never throws (defense-in-depth try/catch).
   *
   * LOCAL bypass: when the host's numeric id is in IDENTITIES_LOCAL_HOST_IDS
   * (e.g. Skynet's own hostId inside its container), SSH-to-self hangs
   * indefinitely (acquireChannel never returns → per-host in-flight guard is
   * held forever → every subsequent tick logs `skipping host with in-flight
   * scan`). The bypass reads the request folder directly from the container-
   * side bind-mount via `scanLocalFleetFolder` / `readLocalFleetCompanionRef`,
   * with byte-identical semantics to the SSH IMAGE_GEN_SCAN_CMD +
   * fetchCompanionRef path (36-char basename filter, atomic mv-claim,
   * cross-request companion uuid guard, MAX_REF_BYTES cap).
   */
  async function scanOneHost(host: ImageGenScanHostRecord): Promise<void> {
    // LOCAL bypass — skip SSH entirely for the container's own host.
    const numericId = parseInt(host.id, 10);
    if (isLocalHostId(numericId)) {
      try {
        const rawItems = await scanLocalFleetFolder("image-gen-requests");
        if (rawItems.length === 0) return;
        // Feed into the same parser the SSH path uses: build the same
        // tab-separated stdout shape (`<filename>\t<contents>` per line)
        // so parseImageGenRequestBatch's downstream contract stays 1:1.
        const stdout = rawItems.map((r) => `${r.filename}\t${r.contents}`).join("\n");
        const items = parseImageGenRequestBatch(stdout, host.id);
        for (const item of items) {
          if (item.malformedReason !== undefined) {
            deps.enqueue(item);
            continue;
          }
          const refName = item.body.ref;
          if (refName === undefined) {
            deps.enqueue(item);
            continue;
          }
          const refBytes = await readLocalFleetCompanionRef(
            "image-gen-requests",
            refName,
            MAX_REF_BYTES,
            item.uuid,
          );
          if (refBytes === null) {
            item.malformedReason = `ref companion missing or unreadable (local): ${refName}`;
            systemLogger.warn(
              "image-gen-scan: local companion ref fetch failed — marking malformed",
              {
                operation: "image_gen_scan_ref_fetch_failed_local",
                fleetHostId: host.id,
                uuid: item.uuid,
                refFilename: refName,
              },
            );
          } else {
            item.refImage = refBytes;
          }
          deps.enqueue(item);
        }
        systemLogger.info("image-gen-scan: local exec complete", {
          operation: "image_gen_scan_local_exec_complete",
          fleetHostId: host.id,
          claimed: items.length,
        });
      } catch (err) {
        // scanLocalFleetFolder + readLocalFleetCompanionRef are already
        // never-throw; this is belt-and-suspenders against future drift.
        systemLogger.warn(
          "Image-gen-scan: local per-host scan threw unexpectedly (should be unreachable)",
          {
            operation: "image_gen_scan_local_host_threw",
            fleetHostId: host.id,
            hostName: host.name,
            error: err instanceof Error ? err.message : "unknown",
          },
        );
      }
      return;
    }

    let channel: SshChannel | null = null;
    try {
      channel = await deps.acquireChannel(host);
      if (channel === null) {
        systemLogger.warn("Image-gen-scan: SSH acquire failed — skipping this tick", {
          operation: "image_gen_scan_acquire_failed",
          fleetHostId: host.id,
          hostName: host.name,
        });
        return;
      }
      const batch = await scanImageGenRequests(host, channel);
      for (const item of batch) {
        deps.enqueue(item);
      }
    } catch (err) {
      systemLogger.warn(
        "Image-gen-scan: per-host scan threw unexpectedly (should be unreachable)",
        {
          operation: "image_gen_scan_host_threw",
          fleetHostId: host.id,
          hostName: host.name,
          error: err instanceof Error ? err.message : "unknown",
        },
      );
    } finally {
      if (channel !== null) {
        try {
          deps.releaseChannel(host, channel);
        } catch {
          // best-effort — matches spawn-requests/scan-orchestrator.ts pattern
        }
      }
    }
  }

  /**
   * Iterate every substrate host and scan for image-gen requests.
   */
  async function scanAllHosts(): Promise<void> {
    if (stopped) return;
    scanTickCount++;

    let hosts: ImageGenScanHostRecord[] = [];
    try {
      hosts = await deps.listSubstrateHosts();
    } catch (err) {
      systemLogger.warn("Image-gen-scan: host list query threw unexpectedly", {
        operation: "image_gen_scan_host_list_failed",
        error: err instanceof Error ? err.message : "unknown",
        tick: scanTickCount,
      });
      return;
    }

    if (hosts.length === 0) {
      return;
    }

    // Fire per-host scans concurrently, FIRE-AND-FORGET. Per-host in-flight
    // guard prevents session pileup on a slow host without blocking other
    // hosts' scans on the same tick.
    for (const host of hosts) {
      if (inFlight.has(host.id)) {
        systemLogger.info(
          "Image-gen-scan: skipping host with in-flight scan (per-host guard)",
          {
            operation: "image_gen_scan_skip_in_flight",
            fleetHostId: host.id,
            hostName: host.name,
            tick: scanTickCount,
          },
        );
        continue;
      }
      inFlight.add(host.id);
      // Scan-timeout race: whichever settles first (scan-complete OR timeout)
      // releases the guard. If the timeout wins, the still-hanging scan is
      // abandoned. See the sibling spawn-requests scan-orchestrator for the
      // shared rationale — same failure mode, same fix.
      let settled = false;
      const timeoutHandle = deps.setTimeout(() => {
        if (settled) return;
        settled = true;
        systemLogger.warn(
          "Image-gen-scan: per-host scan exceeded timeout — force-releasing in-flight guard",
          {
            operation: "image_gen_scan_timeout",
            fleetHostId: host.id,
            hostName: host.name,
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
        systemLogger.warn("Image-gen-scan: initial scan threw unexpectedly", {
          operation: "image_gen_scan_initial_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      }
      scanTimer = deps.setInterval(scanAllHosts, scanIntervalMs);
      systemLogger.info("Image-gen-scan orchestrator started", {
        operation: "image_gen_scan_orchestrator_started",
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
      systemLogger.info("Image-gen-scan orchestrator stopped", {
        operation: "image_gen_scan_orchestrator_stopped",
      });
    },

    getScanTickCount(): number {
      return scanTickCount;
    },
  };
}
