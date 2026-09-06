/**
 * server-substrate-orchestrator.ts — Server-context substrate-sweep orchestrator.
 *
 * Phase 75 Plan 02. Factory module delivering:
 *   D-01 — Startup pass: enumerates every runsFleetSubstrate:true host serially
 *           at container boot before the retry interval is installed.
 *   D-03 — Retry cadence: 30s tick (piggybacking on hostRefreshEveryNTicks
 *           semantics) re-sweeps any host not yet marked done.
 *   D-05 — Once-per-host-per-Skynet-lifetime gating: sweepedThisInstance Set.
 *           A successful sweep marks the host done for this process lifetime.
 *           Container restart re-fires (Set dies with the closure).
 *   D-06 — Loud alerting after N consecutive failures per host (default N=3).
 *           Chose 3: small enough to surface persistent failures within 90s
 *           (30s × 3), large enough to absorb single-tick transients.
 *   D-07 — Alert fires once per host per uptime. Counter + fired-Set reset on
 *           the next successful sweep for that host.
 *
 * PATTERNS:
 *   - Factory function shape from ssh-poll-orchestrator.ts:787-794
 *   - Once-per-host gating Set from ssh-poll-orchestrator.ts:822-838
 *   - queueMicrotask fire-and-forget from ssh-poll-orchestrator.ts:2103-2151
 *   - stop() cleanup from ssh-poll-orchestrator.ts:2295-2319
 *   - never-throw contract from run-sweep.ts:13 (MUST be preserved)
 *
 * PURE-FACTORY DISCIPLINE:
 *   All runtime deps (SSH channel acquire/release, host enumeration, timers,
 *   clock) are injected via ServerSubstrateOrchestratorDeps. No DB, no SSH,
 *   no filesystem at module scope — test isolation guaranteed.
 *
 * WARN-3 DISCIPLINE:
 *   Uses queueMicrotask NOT the set-immediate API. Under vi.useFakeTimers() the
 *   set-immediate API does not drain via tick(); queueMicrotask drains via Promise.resolve().
 */

import { runSweepForHost } from "./run-sweep.js";
import { FLEET_SUBSTRATE_CATALOG } from "./catalog.js";
import { logSweepHookError, logPersistentFailure } from "./log-tags.js";
import { bundledReaderFromDisk } from "./bundled-reader.js";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A host record as returned by listSubstrateHosts. Shape mirrors the DB row
 * shape exposed by list-substrate-hosts.ts (75-03).
 */
export interface SubstrateHostRecord {
  id: string;
  name: string;
  _connDetails: Record<string, unknown>;
}

/**
 * Injected dependencies for the server-substrate orchestrator.
 * All timer and clock functions are injectable so tests can use vi.useFakeTimers().
 */
export interface ServerSubstrateOrchestratorDeps {
  /** Enumerate all hosts with runsFleetSubstrate:true from the DB. */
  listSubstrateHosts(): Promise<SubstrateHostRecord[]>;

  /** Open a dedicated SSH channel for a host; returns null on failure. */
  acquireChannel(host: SubstrateHostRecord): Promise<SshChannel | null>;

  /** Release a previously-acquired SSH channel. */
  releaseChannel(host: SubstrateHostRecord, channel: SshChannel): void;

  /** Timer factory (injectable for tests). */
  setInterval(
    fn: () => Promise<void> | void,
    ms: number,
  ): ReturnType<typeof setInterval>;

  /** Timer cancellation. */
  clearInterval(h: ReturnType<typeof setInterval>): void;

  /** Clock (injectable for tests). */
  now(): number;

  /** Retry interval in ms (default 30000). */
  retryIntervalMs?: number;

  /**
   * N consecutive failures before logPersistentFailure fires (default 3).
   * Chose 3 per D-06 Claude's Discretion:
   *   (a) surfaces persistent failures within 90s (30s × 3)
   *   (b) absorbs single-tick transients (one SSH blip won't alert)
   *   (c) matches D-06's "small number, likely 3-5" guidance
   */
  persistentFailureThreshold?: number;
}

/**
 * Public surface of the server-substrate orchestrator returned by the factory.
 */
export interface ServerSubstrateOrchestrator {
  /** Run the startup pass, then install the retry interval. Awaited by starter.ts. */
  start(): Promise<void>;

  /** Clear the retry interval and all internal state. Called on SIGTERM. */
  stop(): void;

  /**
   * Trigger a targeted single-host sweep immediately, bypassing the retry cadence.
   * Used by the on-add trigger in 75-06. Never rejects (never-throw contract).
   */
  sweepOneHost(host: { id: string; name: string }): Promise<void>;

  /** Returns the number of sweep ticks completed (startup pass = 1, first retry = 2, …). */
  getSweepTickCount(): number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createServerSubstrateOrchestrator(
  deps: ServerSubstrateOrchestratorDeps,
): ServerSubstrateOrchestrator {
  const retryIntervalMs = deps.retryIntervalMs ?? 30000;
  const persistentFailureThreshold = deps.persistentFailureThreshold ?? 3;

  // -------------------------------------------------------------------------
  // Internal state — exact pattern from ssh-poll-orchestrator.ts:822-838
  // -------------------------------------------------------------------------

  /** Hosts whose sweep completed with itemsFailed === 0 this process lifetime. */
  const sweepedThisInstance = new Set<string>();

  /** Hosts whose sweep is currently executing (prevents concurrent double-fire). */
  const sweepInFlight = new Set<string>();

  /** Number of consecutive failed sweeps per host.id. Deleted on success. */
  const consecutiveFailures = new Map<string, number>();

  /** Hosts for which the persistent-failure alert has already fired this uptime. */
  const persistentAlertFired = new Set<string>();

  let sweepTickCount = 0;
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  // -------------------------------------------------------------------------
  // Internal sweep helper
  // -------------------------------------------------------------------------

  /**
   * Acquire channel for host, run runSweepForHost, apply success/failure state
   * transitions, release channel. Never throws (defense-in-depth try/catch).
   *
   * Must only be called from a context that has already checked:
   *   - !stopped
   *   - !sweepedThisInstance.has(host.id)
   *   - !sweepInFlight.has(host.id)
   * And has already done sweepInFlight.add(host.id).
   */
  async function executeSweeForHost(host: SubstrateHostRecord): Promise<void> {
    let channel: SshChannel | null = null;
    try {
      channel = await deps.acquireChannel(host);

      if (channel === null) {
        // Channel acquire failed — record as a sweep failure
        const n = (consecutiveFailures.get(host.id) ?? 0) + 1;
        consecutiveFailures.set(host.id, n);
        if (n >= persistentFailureThreshold && !persistentAlertFired.has(host.id)) {
          persistentAlertFired.add(host.id);
          logPersistentFailure({
            fleetHostId: host.id,
            hostName: host.name,
            consecutiveFailures: n,
          });
        }
        return;
      }

      let result: { itemsChecked: number; itemsChanged: number; itemsFailed: number };
      try {
        result = await runSweepForHost(channel, { id: host.id, name: host.name }, FLEET_SUBSTRATE_CATALOG, {
          readBundledBytes: bundledReaderFromDisk,
          now: deps.now,
        });
      } catch (err) {
        // Defense-in-depth: runSweepForHost has a never-reject contract;
        // this catch is for the one-in-a-million synchronous throw before
        // the composer's outer try. Route through logSweepHookError.
        logSweepHookError({
          fleetHostId: host.id,
          hostName: host.name,
          errorMessage: err instanceof Error ? err.message : "unknown",
        });
        return;
      }

      const failed = result?.itemsFailed ?? 0;
      if (failed === 0) {
        // Clean sweep — mark done for this uptime, reset failure tracking
        sweepedThisInstance.add(host.id);
        consecutiveFailures.delete(host.id);
        persistentAlertFired.delete(host.id);
      } else {
        // Failed sweep — increment counter, fire alert at threshold
        const n = (consecutiveFailures.get(host.id) ?? 0) + 1;
        consecutiveFailures.set(host.id, n);
        if (n >= persistentFailureThreshold && !persistentAlertFired.has(host.id)) {
          persistentAlertFired.add(host.id);
          logPersistentFailure({
            fleetHostId: host.id,
            hostName: host.name,
            consecutiveFailures: n,
          });
        }
      }
    } catch (err) {
      // Outer defense-in-depth catch (e.g., unexpected acquireChannel throw)
      logSweepHookError({
        fleetHostId: host.id,
        hostName: host.name,
        errorMessage: err instanceof Error ? err.message : "unknown",
      });
    } finally {
      sweepInFlight.delete(host.id);
      if (channel !== null) {
        try {
          deps.releaseChannel(host, channel);
        } catch {
          // release errors are logged nowhere — they cannot throw into orchestrator
        }
      }
    }
  }

  /**
   * Gate check + queue the sweep for a host. Fire-and-forget via queueMicrotask.
   * Called from both the startup pass (via sweepOne) and the retry tick.
   * Also the implementation of the public sweepOneHost entrypoint.
   */
  function queueSweepForHost(host: SubstrateHostRecord): void {
    if (stopped) return;
    if (sweepedThisInstance.has(host.id)) return;
    if (sweepInFlight.has(host.id)) return;

    sweepInFlight.add(host.id);
    queueMicrotask(async () => {
      await executeSweeForHost(host);
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  return {
    /**
     * D-01: Startup pass — enumerate hosts once, sweep serially (for...of with await),
     * then install the 30s retry interval.
     */
    async start(): Promise<void> {
      const hosts = await deps.listSubstrateHosts();
      sweepTickCount++;

      // Serial sweep — for...of with await, not Promise.all (D-01 decision)
      for (const host of hosts) {
        if (stopped) break;
        if (sweepedThisInstance.has(host.id)) continue;
        if (sweepInFlight.has(host.id)) continue;

        sweepInFlight.add(host.id);
        // Await directly in the startup pass (not fire-and-forget) so start()
        // resolves only after all startup sweeps complete (S1/S2/S3 requirements)
        await executeSweeForHost(host);
      }

      // Install retry interval after startup pass
      retryTimer = deps.setInterval(async () => {
        if (stopped) return;
        sweepTickCount++;
        const retryHosts = await deps.listSubstrateHosts();
        for (const h of retryHosts) {
          if (!sweepedThisInstance.has(h.id)) {
            queueSweepForHost(h);
          }
        }
      }, retryIntervalMs);
    },

    /**
     * Clear the retry interval and all internal state.
     * Called on SIGTERM or in tests. Pattern from ssh-poll-orchestrator.ts:2295-2310.
     */
    stop(): void {
      stopped = true;
      if (retryTimer !== null) {
        deps.clearInterval(retryTimer);
        retryTimer = null;
      }
      sweepedThisInstance.clear();
      sweepInFlight.clear();
      consecutiveFailures.clear();
      persistentAlertFired.clear();
    },

    /**
     * Public single-host sweep entrypoint for the on-add trigger (75-06).
     * Resolves the host via listSubstrateHosts to get connDetails, then delegates
     * to queueSweepForHost. Never rejects (never-throw contract, test NT2).
     */
    async sweepOneHost(host: { id: string; name: string }): Promise<void> {
      if (stopped) return;
      if (sweepedThisInstance.has(host.id)) return;
      if (sweepInFlight.has(host.id)) return;

      // Resolve fresh host record from the enumerator to get connDetails.
      // If host was deleted between create-response and this call, log at debug and return.
      let hosts: SubstrateHostRecord[];
      try {
        hosts = await deps.listSubstrateHosts();
      } catch {
        // enumerator failure — cannot sweep, don't throw
        return;
      }

      const hostRecord = hosts.find((h) => h.id === host.id);
      if (!hostRecord) {
        // Host not found (deleted between create and sweep) — no-op, no throw
        return;
      }

      if (stopped) return;
      if (sweepedThisInstance.has(host.id)) return;
      if (sweepInFlight.has(host.id)) return;

      sweepInFlight.add(host.id);
      // Fire-and-forget via queueMicrotask — caller does not await the sweep.
      // Pass the resolved hostRecord (with _connDetails), NOT the narrowed input.
      queueMicrotask(async () => {
        await executeSweeForHost(hostRecord);
      });
    },

    /** Observability — mirrors getPollTickCount() from ssh-poll-orchestrator.ts:2297-2299. */
    getSweepTickCount(): number {
      return sweepTickCount;
    },
  };
}
