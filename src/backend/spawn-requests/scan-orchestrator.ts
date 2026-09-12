/**
 * spawn-requests/scan-orchestrator.ts — Always-on spawn-request scanner.
 *
 * ## Why this module exists (bounty fleet-status-orchestrator-coupling-with-spawn-request-scanning)
 * Pre-fix: `scanSpawnRequests` piggybacked on the fleet-status per-host poll
 * loop in `ssh-poll-orchestrator.ts`. The fleet-status orchestrator uses a
 * lazy-start pattern gated on WS subscribers (start on first, stop on last).
 * When no browser subscribed, spawn-request scanning also stopped — coord-
 * driven spawn-request drops sat unclaimed until a browser reconnected. The
 * whole point of coord-driven spawns is that they run out-of-band from browser
 * presence, so the coupling was a real functional bug.
 *
 * Post-fix: this module runs an always-on tick that enumerates every
 * `runsFleetSubstrate:true` host via the session-less CSKEK path
 * (`list-substrate-hosts.ts`), acquires an SSH channel per host, calls
 * `scanSpawnRequests` (unchanged — atomic `mv` claim is still the correctness
 * primitive), and enqueues claimed requests via `queue.enqueue`. Independent of
 * `/fleet-status/ws` subscribers.
 *
 * ## Architecture
 * Mirrors `distributor/server-substrate-orchestrator.ts` (Phase 75 Plan 02):
 *   - Factory-shape module with fully injected deps (testable with
 *     `vi.useFakeTimers()` + `vi.fn()` — no real SSH, no real DB).
 *   - Session-less host enumeration via `listSubstrateHosts` — no browser
 *     subscriber required, no per-user DEK. Same host filter as substrate
 *     (`enableSsh=true AND runsFleetSubstrate=true`), which is the correct
 *     set for spawn-requests since spawn drops land at `~/fleet/spawn-requests/`
 *     on identity-hosting hosts and identity-hosting = runsFleetSubstrate.
 *   - Own per-host `hostClients` map (independent of fleet-status +
 *     substrate — never contaminate each others' lifecycles).
 *   - Per-host in-flight guard (quick-260820-tm0 wilma pattern) — if a slow
 *     host's `scanSpawnRequests` is still awaiting when the next tick fires,
 *     that tick skips this host and continues to the next. Prevents SSH
 *     session pileup that trashed target `MaxSessions` in the wilma incident.
 *   - Never-throw contract on `start()`/`stop()` (defense-in-depth try/catch
 *     around the tick body).
 *
 * ## Cadence
 * Default 10s tick. Rationale: spawn-requests are rare (coordinator-driven,
 * measured in per-minute-at-most), and coordinator's own timeouts are 30-60s.
 * 10s is well inside coord's response window while keeping SSH cost negligible.
 *
 * ## What stays with ssh-poll-orchestrator.ts
 * The fleet-status orchestrator's `enqueueSpawnRequest` dep + the piggybacked
 * `scanSpawnRequests` calls are REMOVED in the same commit that adds this
 * module. Only this module runs the scan going forward. See starter.ts wiring
 * and the ssh-poll-orchestrator diff for the removals.
 */

import { systemLogger } from "../utils/logger.js";
import { scanSpawnRequests } from "../fleet-status/ssh-poll-orchestrator.js";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import type { HostRecord } from "../fleet-status/host-id-resolver.js";
import type { PendingBirth } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A substrate host record — matches the shape returned by `listSubstrateHosts`
 * (Phase 75 Plan 03). Only the fields consumed by this module are declared;
 * the wider `_connDetails` bag passes through opaquely to `acquireChannel`.
 */
export interface SpawnScanHostRecord {
  id: string;
  name: string;
  _connDetails: Record<string, unknown>;
}

/**
 * Injected dependencies. Every runtime side-effect (DB enumeration, SSH,
 * timers, clock, enqueue) is behind a dep so the module is fully unit-testable
 * with `vi.useFakeTimers()` + `vi.fn()`.
 */
export interface SpawnScanOrchestratorDeps {
  /** Enumerate every substrate-eligible host from the DB (session-less CSKEK path). */
  listSubstrateHosts(): Promise<SpawnScanHostRecord[]>;

  /** Open a dedicated SSH channel for a host; returns null on failure. */
  acquireChannel(host: SpawnScanHostRecord): Promise<SshChannel | null>;

  /**
   * Release a previously-acquired SSH channel. In production this is a no-op
   * (the underlying ssh2 Client is reused across ticks for the container
   * lifetime), but the seam exists for symmetry with the substrate + fleet-
   * status orchestrators and to give tests an assertion hook.
   */
  releaseChannel(host: SpawnScanHostRecord, channel: SshChannel): void;

  /** Enqueue a claimed spawn-request for async birth-worker processing. */
  enqueue(item: PendingBirth): void;

  /** Timer factory (injectable for tests). */
  setInterval(fn: () => Promise<void> | void, ms: number): ReturnType<typeof setInterval>;

  /** Timer cancellation. */
  clearInterval(h: ReturnType<typeof setInterval>): void;

  /** Clock (injectable for tests). */
  now(): number;

  /** Scan interval in ms. Default 10000. */
  scanIntervalMs?: number;
}

/**
 * Public surface returned by the factory.
 */
export interface SpawnScanOrchestrator {
  /** Fire an immediate first scan, then install the interval. Awaited by starter.ts. */
  start(): Promise<void>;

  /** Cancel the interval and clear internal state. Called on SIGTERM. */
  stop(): void;

  /** Number of completed scan ticks (immediate first pass = 1, first interval tick = 2, …). */
  getScanTickCount(): number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSpawnScanOrchestrator(
  deps: SpawnScanOrchestratorDeps,
): SpawnScanOrchestrator {
  const scanIntervalMs = deps.scanIntervalMs ?? 10000;

  /**
   * Per-host in-flight guard — quick-260820-tm0 wilma pattern. A slow host
   * whose `scanSpawnRequests` is still awaiting when the next tick fires
   * would otherwise accumulate concurrent SSH sessions. Guard is PER-HOST,
   * NOT GLOBAL — a slow host must NOT block scans for other hosts on the
   * same tick.
   */
  const inFlight = new Set<string>();

  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let scanTickCount = 0;
  let stopped = false;

  /**
   * Scan a single host: acquire channel → scanSpawnRequests → enqueue results
   * → release channel. Never throws (defense-in-depth try/catch). Fails open
   * on any SSH-side error (matches `scanSpawnRequests`' own fail-open contract).
   */
  async function scanOneHost(host: SpawnScanHostRecord): Promise<void> {
    let channel: SshChannel | null = null;
    try {
      channel = await deps.acquireChannel(host);
      if (channel === null) {
        systemLogger.warn(
          "Spawn-scan: SSH acquire failed — skipping this tick",
          {
            operation: "spawn_scan_acquire_failed",
            fleetHostId: host.id,
            hostName: host.name,
          },
        );
        return;
      }
      // scanSpawnRequests is defined in ssh-poll-orchestrator.ts (exported for
      // reuse here). Same helper the pre-fix piggyback used — atomic mv claim,
      // UUID length guard, per-line parseRequestBody validation, malformed-
      // reason enqueue path, fail-open null-exec handling. Unchanged.
      const batch = await scanSpawnRequests(host as HostRecord, channel);
      for (const item of batch) {
        deps.enqueue(item);
      }
    } catch (err) {
      // scanSpawnRequests + acquireChannel are already non-throwing; this
      // catch is belt-and-suspenders against a future contract drift.
      systemLogger.warn(
        "Spawn-scan: per-host scan threw unexpectedly (should be unreachable)",
        {
          operation: "spawn_scan_host_threw",
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
          // best-effort — matches ssh-poll-orchestrator.ts stop() pattern
        }
      }
    }
  }

  /**
   * Iterate every substrate host and scan for spawn-requests. Called on the
   * interval AND once eagerly at start() so a coord-drop landing during boot
   * gets picked up on the same tick.
   */
  async function scanAllHosts(): Promise<void> {
    if (stopped) return;
    scanTickCount++;

    let hosts: SpawnScanHostRecord[] = [];
    try {
      hosts = await deps.listSubstrateHosts();
    } catch (err) {
      // listSubstrateHosts has its own never-throw wrapper (returns [] on any
      // failure); this catch is belt-and-suspenders against a future drift.
      systemLogger.warn("Spawn-scan: host list query threw unexpectedly", {
        operation: "spawn_scan_host_list_failed",
        error: err instanceof Error ? err.message : "unknown",
        tick: scanTickCount,
      });
      return;
    }

    if (hosts.length === 0) {
      // Empty host list is a genuine steady state (fresh container, no
      // substrate hosts yet, or all decrypt-failed and got skipped). Don't
      // log every tick — silence is fine here.
      return;
    }

    // Fire per-host scans concurrently, FIRE-AND-FORGET. A slow host's
    // still-awaiting scan MUST NOT delay this tick's return — the interval
    // relies on the tick returning quickly so the NEXT tick fires on
    // schedule (regardless of any prior host's in-flight scan). The in-
    // flight Set handles serialization: a subsequent tick that sees the
    // slow host still in-flight skips it, while the .finally() drains the
    // Set when the scan eventually resolves.
    //
    // `scanOneHost` never throws, so leaving the promise unawaited does
    // not risk an unhandled rejection.
    for (const host of hosts) {
      if (inFlight.has(host.id)) {
        systemLogger.info(
          "Spawn-scan: skipping host with in-flight scan (per-host guard)",
          {
            operation: "spawn_scan_skip_in_flight",
            fleetHostId: host.id,
            hostName: host.name,
            tick: scanTickCount,
          },
        );
        continue;
      }
      inFlight.add(host.id);
      void scanOneHost(host).finally(() => {
        inFlight.delete(host.id);
      });
    }
  }

  return {
    async start(): Promise<void> {
      stopped = false;

      // Fire an immediate first scan so anything already in
      // ~/fleet/spawn-requests/ at boot gets picked up without waiting for
      // the first interval tick. Awaited so start() completion means the
      // first pass finished.
      try {
        await scanAllHosts();
      } catch (err) {
        // scanAllHosts is already never-throw; belt-and-suspenders.
        systemLogger.warn("Spawn-scan: initial scan threw unexpectedly", {
          operation: "spawn_scan_initial_failed",
          error: err instanceof Error ? err.message : "unknown",
        });
      }

      // Install the recurring interval. The fn returns a Promise so tests
      // can capture + await it directly under vi.useFakeTimers().
      scanTimer = deps.setInterval(scanAllHosts, scanIntervalMs);

      systemLogger.info("Spawn-scan orchestrator started", {
        operation: "spawn_scan_orchestrator_started",
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
      systemLogger.info("Spawn-scan orchestrator stopped", {
        operation: "spawn_scan_orchestrator_stopped",
      });
    },

    getScanTickCount(): number {
      return scanTickCount;
    },
  };
}
