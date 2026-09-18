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
 *   - Local-host distributor bypass (quick 260918-5lb) — mirrors the Phase 116
 *     scanner bypass pattern from src/backend/utils/local-fleet-scan.ts +
 *     src/backend/spawn-requests/scan-orchestrator.ts:163-197. When a host's
 *     numeric id is in IDENTITIES_LOCAL_HOST_IDS, executeSweeForHost skips
 *     deps.acquireChannel entirely and delegates to local-fleet-install.ts,
 *     which writes to the bind-mounted filesystem. Avoids the SSH-to-self
 *     hang that previously wedged the entire serial for-of loop.
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
import { readInstancePolicyBytes } from "../branding/branding-config-loader.js";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import { isLocalHostId } from "../claude-session/identity-artifact-reader.js";
import {
  installFleetSubstrateLocally,
  bootstrapFleetSubstrateLocally,
} from "./local-fleet-install.js";

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

  /**
   * Phase 114 Plan 05 (D-15 + Pitfall 6): current-tick runtime bytes.
   *
   * The orchestrator resolves runtime-sourced catalog rows (currently just
   * the "instance-policy" twinkie) ONCE per tick and fans the same Map to
   * every runSweepForHost invocation in that tick. This factory-scope
   * variable is refreshed:
   *   (a) at the top of start() before the startup-pass host iteration
   *   (b) at the top of the retry-tick setInterval callback before the
   *       retry-pass host iteration
   *
   * NOT called per-host — that would burn N filesystem reads per tick
   * instead of one, defeating the "once per sweep" invariant.
   *
   * Default empty Map (before start() runs) is safe: the composer treats
   * missing keys as null → runtime rows are either removed (if ever
   * installed) or skipped silently. sweepOneHost callers before start()
   * would fall through this path, which is acceptable.
   */
  let currentRuntimeBytes: Map<string, Buffer | null> = new Map();

  /**
   * Resolve runtime-sourced catalog bytes for the current tick.
   *
   * NEVER-THROW: readInstancePolicyBytes has its own never-throws contract
   * (Plan 01), but the try/catch here is defense-in-depth against future
   * changes to the resolver. On any throw, the map value falls back to null
   * — the composer's removal branch (D-16) will run against every root-SSH
   * host, mimicking the "clean unset state" the resolver-null path is
   * designed for.
   */
  async function resolveRuntimeBytesForTick(): Promise<Map<string, Buffer | null>> {
    const map = new Map<string, Buffer | null>();
    try {
      map.set("instance-policy", await readInstancePolicyBytes());
    } catch {
      // Defense-in-depth: keep the tick alive even if the resolver breaks.
      map.set("instance-policy", null);
    }
    return map;
  }

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
  /**
   * Apply the SSH-branch bookkeeping to a per-host sweep result. Extracted so
   * the local-branch (quick 260918-5lb) and the SSH-branch share identical
   * post-sweep state transitions. `failed` is the sweep's itemsFailed count;
   * failed === 0 marks the host done for this uptime, failed > 0 bumps the
   * consecutive-failures counter and fires the persistent-alert once at
   * threshold.
   */
  function applySweepBookkeeping(
    host: SubstrateHostRecord,
    failed: number,
  ): void {
    if (failed === 0) {
      sweepedThisInstance.add(host.id);
      consecutiveFailures.delete(host.id);
      persistentAlertFired.delete(host.id);
    } else {
      const n = (consecutiveFailures.get(host.id) ?? 0) + 1;
      consecutiveFailures.set(host.id, n);
      if (
        n >= persistentFailureThreshold &&
        !persistentAlertFired.has(host.id)
      ) {
        persistentAlertFired.add(host.id);
        logPersistentFailure({
          fleetHostId: host.id,
          hostName: host.name,
          consecutiveFailures: n,
        });
      }
    }
  }

  async function executeSweeForHost(host: SubstrateHostRecord): Promise<void> {
    // Quick 260918-5lb: LOCAL BYPASS. When the host's numeric id is in
    // IDENTITIES_LOCAL_HOST_IDS, SSH-to-self hangs from inside the container
    // — the whole for-of loop wedges in deps.acquireChannel. Skip SSH
    // entirely and delegate to the local-FS helper, which covers both the
    // bootstrap (skynet-parent + skynet-hostname writes) AND the catalog
    // install (skills, helper scripts, systemd unit). Bookkeeping matches
    // the SSH branch via applySweepBookkeeping.
    const numericId = parseInt(host.id, 10);
    if (isLocalHostId(numericId)) {
      let result: {
        itemsChecked: number;
        itemsChanged: number;
        itemsFailed: number;
      };
      try {
        // Bootstrap first (mirrors run-sweep.ts:127 — bootstrap runs BEFORE
        // the catalog loop).
        await bootstrapFleetSubstrateLocally({
          id: host.id,
          name: host.name,
        });
        result = await installFleetSubstrateLocally(
          { id: host.id, name: host.name },
          FLEET_SUBSTRATE_CATALOG,
          {
            readBundledBytes: bundledReaderFromDisk,
            resolvedRuntimeBytes: currentRuntimeBytes,
            now: deps.now,
          },
        );
      } catch (err) {
        // Belt-and-suspenders — the local helpers are already never-throw.
        // Any escape here is a code bug, not a runtime failure; log it and
        // treat the sweep as failed for bookkeeping purposes.
        logSweepHookError({
          fleetHostId: host.id,
          hostName: host.name,
          errorMessage: err instanceof Error ? err.message : "unknown",
        });
        applySweepBookkeeping(host, 1);
        sweepInFlight.delete(host.id);
        return;
      }
      applySweepBookkeeping(host, result.itemsFailed);
      sweepInFlight.delete(host.id);
      return;
    }

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
        // Phase 114 Plan 05 (Pitfall 3): extract SSH username from
        // _connDetails so the composer's D-13 root-user gate can enforce
        // system-root row eligibility. Null-coalesce to "unknown" so a
        // missing/malformed record safely gates OUT of system-root rows
        // (composer treats "unknown" !== "root" → skip-with-log).
        const username =
          typeof host._connDetails?.username === "string"
            ? host._connDetails.username
            : "unknown";
        result = await runSweepForHost(
          channel,
          { id: host.id, name: host.name, username },
          FLEET_SUBSTRATE_CATALOG,
          {
            readBundledBytes: bundledReaderFromDisk,
            // Phase 114 Plan 05 (D-15 + Pitfall 6): pass the per-tick
            // resolver map (populated ONCE per tick at start() / retry
            // callback), so runtime rows fan bytes across all hosts
            // without re-reading the twinkie per host.
            resolvedRuntimeBytes: currentRuntimeBytes,
            now: deps.now,
          },
        );
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
      // Phase 114 Plan 05 (D-15 + Pitfall 6): resolve runtime-sourced
      // catalog bytes ONCE for this tick, BEFORE iterating hosts. Every
      // executeSweeForHost invocation in this tick will pick up the same
      // Map via the currentRuntimeBytes closure variable.
      currentRuntimeBytes = await resolveRuntimeBytesForTick();

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
        // Phase 114 Plan 05: re-resolve for this retry tick. Fresh read
        // per tick — the twinkie file may have been edited between ticks.
        currentRuntimeBytes = await resolveRuntimeBytesForTick();
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
