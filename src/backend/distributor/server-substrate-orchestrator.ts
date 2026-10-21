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
import { readInstanceFileBytes } from "../instance-file/store.js";
import { systemLogger } from "../utils/logger.js";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import type { HarnessReconciler } from "./harness-reconciler.js";
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
  machineId?: string;
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

  /**
   * Keeps each host on the pinned Claude Code harness (harness-reconciler.ts).
   * Queued after every host sweep and on every retry tick; it gates itself
   * (converged / in-flight / backoff) and never blocks the sweep. Optional so
   * tests that don't exercise it stay unaffected.
   */
  harnessReconciler?: HarnessReconciler<SubstrateHostRecord>;

  /**
   * How long the serial startup pass waits on one host before moving to the
   * next (default HOST_SWEEP_DEADLINE_MS). The abandoned sweep keeps running
   * and keeps its in-flight mark until it settles, so retry ticks never
   * start a second sweep alongside it.
   */
  hostSweepDeadlineMs?: number;
}

/**
 * A healthy host sweep takes ~5–20s; 10 minutes means the host is wedged.
 * Kept at twice the substrate per-exec ceiling (SUBSTRATE_EXEC_TIMEOUT_MS,
 * 5 min) so one slow-but-legitimate exec can't trip it on a healthy host.
 * Without this, one stalled exec on one host holds the startup pass forever,
 * so the retry interval is never installed and no host is retried this
 * uptime.
 */
export const HOST_SWEEP_DEADLINE_MS = 10 * 60 * 1000;

/**
 * Per-exec ceiling for the substrate SSH channel adapter (starter.ts), passed
 * INTO execCommand so a wedged exec closes its channel and frees its
 * per-host semaphore slot. Half the host sweep's deadline, so one slow exec
 * still leaves the sweep room to finish; the one long-running exception
 * (harness install) passes HARNESS_ATTEMPT_TIMEOUT_MS explicitly.
 */
export const SUBSTRATE_EXEC_TIMEOUT_MS = 5 * 60 * 1000;

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

  /**
   * Last-known sweep outcome for a host (admin Hosts overview). Null when the
   * host has not been attempted this process lifetime.
   */
  getHostSweepStatus(hostId: string): HostSweepStatus | null;

  /**
   * Re-resolve runtime-sourced bytes and re-sweep every host now — used after
   * the instance file is edited, since hosts that already swept clean are
   * otherwise left alone until the next restart. Never rejects.
   */
  resweepAll(reason: string): Promise<void>;
}

/** Per-host sweep outcome surfaced to the admin Hosts overview. */
export interface HostSweepStatus {
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  /** Short human-readable reason for the most recent failure. */
  lastError: string | null;
  consecutiveFailures: number;
  inFlight: boolean;
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

  /** Last success / failure per host.id, for getHostSweepStatus. */
  const sweepOutcomes = new Map<
    string,
    { lastSuccessAt: number | null; lastFailureAt: number | null; lastError: string | null }
  >();

  function recordOutcome(hostId: string, error: string | null): void {
    const prev = sweepOutcomes.get(hostId) ?? {
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
    };
    sweepOutcomes.set(
      hostId,
      error === null
        ? { ...prev, lastSuccessAt: deps.now(), lastError: null }
        : { ...prev, lastFailureAt: deps.now(), lastError: error },
    );
  }

  const itemsFailedError = (n: number) =>
    `${n} item${n === 1 ? "" : "s"} failed to install`;

  let sweepTickCount = 0;
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const hostSweepDeadlineMs = deps.hostSweepDeadlineMs ?? HOST_SWEEP_DEADLINE_MS;

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
   * Bumped by resweepAll once fresh bytes are in place. A sweep snapshots
   * (bytes, generation) together when it starts; one that started under an
   * older generation ran with stale bytes, so it never marks its host done —
   * the retry tick sweeps it again with the fresh bytes.
   */
  let runtimeBytesGeneration = 0;

  /**
   * Read ordering: each resolve takes a sequence number before its await, and
   * a result is applied only if no later-started resolve has already landed —
   * so a retry tick that read before an edit can never overwrite the bytes a
   * resweepAll read after it.
   */
  let resolveSeq = 0;
  let appliedResolveSeq = 0;

  /**
   * Resolve runtime-sourced catalog bytes. Never throws: on a read error the
   * previous value is kept (a transient I/O failure must not read as "unset",
   * which would remove the file from every host).
   */
  async function resolveRuntimeBytesForTick(): Promise<Map<string, Buffer | null>> {
    const map = new Map<string, Buffer | null>();
    try {
      map.set("instance-policy", await readInstanceFileBytes());
    } catch (err) {
      systemLogger.error("Fleet-substrate: instance file read failed — keeping previous bytes", {
        operation: "fleet_substrate_runtime_bytes_read_error",
        error: err instanceof Error ? err.message : "unknown",
      });
      if (currentRuntimeBytes.has("instance-policy")) {
        map.set("instance-policy", currentRuntimeBytes.get("instance-policy") ?? null);
      }
    }
    return map;
  }

  /** Resolve and apply, honoring read ordering (see resolveSeq). */
  async function refreshRuntimeBytes(): Promise<void> {
    const seq = ++resolveSeq;
    const map = await resolveRuntimeBytesForTick();
    if (seq < appliedResolveSeq) return;
    appliedResolveSeq = seq;
    currentRuntimeBytes = map;
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
    generation: number,
  ): void {
    recordOutcome(host.id, failed === 0 ? null : itemsFailedError(failed));
    if (failed === 0) {
      if (generation === runtimeBytesGeneration) sweepedThisInstance.add(host.id);
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
    const generation = runtimeBytesGeneration;
    const runtimeBytes = currentRuntimeBytes;
    // Quick 260918-5lb: LOCAL BYPASS. When the host's numeric id is in
    // IDENTITIES_LOCAL_HOST_IDS, SSH-to-self hangs from inside the container
    // — the whole for-of loop wedges in deps.acquireChannel. Skip SSH
    // entirely and delegate to the local-FS helper, which covers both the
    // bootstrap (host-parent + host-name writes) AND the catalog
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
        const bootstrap = await bootstrapFleetSubstrateLocally({
          id: host.id,
          name: host.name,
          machineId: host.machineId,
        });
        result = await installFleetSubstrateLocally(
          { id: host.id, name: host.name },
          FLEET_SUBSTRATE_CATALOG,
          {
            readBundledBytes: bundledReaderFromDisk,
            resolvedRuntimeBytes: runtimeBytes,
            now: deps.now,
          },
        );
        // Same rule as run-sweep.ts: an incomplete roles-key migration holds
        // the host open for a retry.
        if (bootstrap?.rolesKeyMigrationOk === false) {
          result = { ...result, itemsFailed: result.itemsFailed + 1 };
        }
        if (bootstrap?.roleSkillsMigrationOk === false) {
          result = { ...result, itemsFailed: result.itemsFailed + 1 };
        }
      } catch (err) {
        // Belt-and-suspenders — the local helpers are already never-throw.
        // Any escape here is a code bug, not a runtime failure; log it and
        // treat the sweep as failed for bookkeeping purposes.
        logSweepHookError({
          fleetHostId: host.id,
          hostName: host.name,
          errorMessage: err instanceof Error ? err.message : "unknown",
        });
        applySweepBookkeeping(host, 1, generation);
        recordOutcome(host.id, err instanceof Error ? err.message : "unknown error");
        sweepInFlight.delete(host.id);
        return;
      }
      applySweepBookkeeping(host, result.itemsFailed, generation);
      sweepInFlight.delete(host.id);
      return;
    }

    let channel: SshChannel | null = null;
    try {
      channel = await deps.acquireChannel(host);

      if (channel === null) {
        // Channel acquire failed — record as a sweep failure
        recordOutcome(host.id, "couldn't connect over SSH");
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
          { id: host.id, name: host.name, username, machineId: host.machineId },
          FLEET_SUBSTRATE_CATALOG,
          {
            readBundledBytes: bundledReaderFromDisk,
            // Phase 114 Plan 05 (D-15 + Pitfall 6): pass the per-tick
            // resolver map (populated ONCE per tick at start() / retry
            // callback), so runtime rows fan bytes across all hosts
            // without re-reading the twinkie per host.
            resolvedRuntimeBytes: runtimeBytes,
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
        recordOutcome(host.id, err instanceof Error ? err.message : "unknown error");
        return;
      }

      const failed = result?.itemsFailed ?? 0;
      recordOutcome(host.id, failed === 0 ? null : itemsFailedError(failed));
      if (failed === 0) {
        // Clean sweep — mark done for this uptime, reset failure tracking
        if (generation === runtimeBytesGeneration) sweepedThisInstance.add(host.id);
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
      recordOutcome(host.id, err instanceof Error ? err.message : "unknown error");
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
   * Startup-pass wrapper: waits for the host's sweep or the deadline,
   * whichever comes first, then queues the host's harness reconcile — for a
   * sweep that passed its deadline, only once it finally settles, so the two
   * never race to open the host's first SSH client. Never rejects
   * (executeSweeForHost never does).
   */
  async function sweepWithDeadline(host: SubstrateHostRecord): Promise<void> {
    const startedAt = deps.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => resolve("deadline"), hostSweepDeadlineMs);
    });
    const sweep = executeSweeForHost(host).then(() => "done" as const);
    const winner = await Promise.race([sweep, deadline]);
    clearTimeout(timer);
    if (winner === "done") {
      deps.harnessReconciler?.queue(host);
      return;
    }
    {
      recordOutcome(host.id, "sweep timed out");
      systemLogger.warn("Fleet-substrate: host sweep passed its deadline — moving on to the next host", {
        operation: "fleet_substrate_sweep_host_deadline",
        fleetHostId: host.id,
        hostName: host.name,
        deadlineMs: hostSweepDeadlineMs,
      });
      void sweep.then(() => {
        systemLogger.info("Fleet-substrate: late host sweep settled", {
          operation: "fleet_substrate_sweep_host_late_settle",
          fleetHostId: host.id,
          hostName: host.name,
          durationMs: deps.now() - startedAt,
        });
        deps.harnessReconciler?.queue(host);
      });
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
      deps.harnessReconciler?.queue(host);
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
      await refreshRuntimeBytes();

      const hosts = await deps.listSubstrateHosts();
      sweepTickCount++;

      // Serial sweep — for...of with await, not Promise.all (D-01 decision)
      for (const host of hosts) {
        if (stopped) break;
        if (sweepedThisInstance.has(host.id)) continue;
        if (sweepInFlight.has(host.id)) continue;

        sweepInFlight.add(host.id);
        // Await directly in the startup pass (not fire-and-forget) so start()
        // resolves only after all startup sweeps complete (S1/S2/S3 requirements),
        // or a host passes its deadline.
        // sweepWithDeadline also queues the harness reconcile, which runs
        // alongside, never inside, the serial pass — queue() is
        // fire-and-forget so a slow install can't hold up the next host.
        await sweepWithDeadline(host);
      }

      // Install retry interval after startup pass
      retryTimer = deps.setInterval(async () => {
        if (stopped) return;
        sweepTickCount++;
        // Phase 114 Plan 05: re-resolve for this retry tick. Fresh read
        // per tick — the twinkie file may have been edited between ticks.
        await refreshRuntimeBytes();
        const retryHosts = await deps.listSubstrateHosts();
        for (const h of retryHosts) {
          if (!sweepedThisInstance.has(h.id)) {
            // The harness reconcile is queued when this sweep finishes rather
            // than alongside it, so the two don't both try to open the host's
            // first SSH client in the same tick. (A later sweep CAN overlap a
            // long install — harmless once the client is cached.)
            queueSweepForHost(h);
          } else {
            // Self-gating: no-op for converged / in-flight / backing-off hosts.
            deps.harnessReconciler?.queue(h);
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
      sweepOutcomes.clear();
      deps.harnessReconciler?.stop();
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
        deps.harnessReconciler?.queue(hostRecord);
      });
    },

    async resweepAll(reason: string): Promise<void> {
      if (stopped) return;
      try {
        // Bump only after the post-edit read has landed (or been superseded
        // by an even later one), so no sweep can pair the new generation
        // with pre-edit bytes.
        await refreshRuntimeBytes();
        runtimeBytesGeneration++;
        sweepedThisInstance.clear();
        const hosts = await deps.listSubstrateHosts();
        systemLogger.info("Fleet-substrate resweep requested", {
          operation: "fleet_substrate_resweep_all",
          reason,
          hostCount: hosts.length,
          generation: runtimeBytesGeneration,
        });
        // In-flight hosts are skipped here; their stale-generation sweep
        // leaves them unmarked, so the next retry tick picks them up.
        for (const h of hosts) queueSweepForHost(h);
      } catch (err) {
        systemLogger.warn("Fleet-substrate resweep failed", {
          operation: "fleet_substrate_resweep_all_error",
          reason,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    },

    /** Observability — mirrors getPollTickCount() from ssh-poll-orchestrator.ts:2297-2299. */
    getSweepTickCount(): number {
      return sweepTickCount;
    },

    getHostSweepStatus(hostId: string): HostSweepStatus | null {
      const outcome = sweepOutcomes.get(hostId);
      const inFlight = sweepInFlight.has(hostId);
      if (!outcome && !inFlight) return null;
      return {
        lastSuccessAt: outcome?.lastSuccessAt ?? null,
        lastFailureAt: outcome?.lastFailureAt ?? null,
        lastError: outcome?.lastError ?? null,
        consecutiveFailures: consecutiveFailures.get(hostId) ?? 0,
        inFlight,
      };
    },
  };
}
