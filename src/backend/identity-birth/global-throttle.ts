/**
 * identity-birth/global-throttle.ts — Phase 110 identity-birth throttle
 * (reshaped 2026-09-24 to per-target-host axis).
 *
 * Wraps both `identity-birth.ts` (HTTP SSE entry point) and
 * `spawn-requests/worker.ts` (disk-drop entry point) invocations of
 * `birthIdentity()` through a per-hostId semaphore so a coordinator dropping N
 * spawn-request files at once (or firing N concurrent HTTP births) never
 * saturates downstream chokepoints for the target host (SSH channels + the
 * supervisor's serial launch queue on the box), while births to DIFFERENT
 * hosts always run in parallel.
 *
 * Prior shape (pre-2026-09-24) was a PROCESS-WIDE cap keyed to nothing — a
 * birth on hostA blocked a concurrent birth on hostB even though they touch
 * disjoint machines. The Matrix admin API is shared across hosts but is
 * comfortably able to absorb `maxConcurrent × N_hosts` mints; per-host is the
 * right axis for the meaningful chokepoint.
 *
 * Implementation mirrors `src/backend/ssh/host-semaphore-registry.ts`: a
 * module-scope Map<hostKey, HostState> with lazy creation on first acquire.
 * The counter+waiter-queue mechanics are unchanged from the pre-reshape shape.
 *
 * Env var backward-compat: `IDENTITY_BIRTH_MAX_CONCURRENT` retains its name
 * (default bumped 1 → 2 as part of the reshape — same-host serialization is
 * still enforced by the target's supervisor's serial launch queue, so two
 * concurrent births on one host is safe and unlocks the Ashley-modal + a
 * peer-coordinator scenario). Queue depth is per-host too.
 *
 * Bounty: identity-creation-flow-global-throttle
 */

import { systemLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ThrottleSource = "http" | "spawn-request";

export interface AcquireContext {
  source: ThrottleSource;
  /**
   * Target hostId the birth is landing on. Used as the per-host semaphore
   * registry key (`String(hostId)` — numeric 1 and string "1" collapse to the
   * same pool, matching host-semaphore-registry.ts's normalization).
   */
  hostId: string | number;
  requestId?: string;
  bypassQueueDepth?: boolean;
}

/**
 * Thrown by `acquireBirthSlot` when the target host's queue is at capacity.
 * Carries `retryAfterMs` so the HTTP caller can build a 429 response body.
 */
export class ThrottleRejectedError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super("identity_birth_queue_full");
    this.name = "ThrottleRejectedError";
    this.retryAfterMs = retryAfterMs;
  }
}

// ---------------------------------------------------------------------------
// Per-host semaphore registry
// ---------------------------------------------------------------------------

type Waiter = {
  resolve: () => void;
  reject: (e: Error) => void;
  source: ThrottleSource;
  requestId?: string;
};

type HostState = {
  active: number;
  waiters: Waiter[];
  /** Epoch ms of most recent release on this host. 0 = "never released" —
   * first acquire skips the min-interval gate. */
  lastReleaseAt: number;
};

const registry = new Map<string, HostState>();

function getOrCreateHostState(hostKey: string): HostState {
  let state = registry.get(hostKey);
  if (!state) {
    state = { active: 0, waiters: [], lastReleaseAt: 0 };
    registry.set(hostKey, state);
  }
  return state;
}

let config: {
  maxConcurrent: number;
  minIntervalMs: number;
  maxQueueDepth: number;
  expectedBirthDurationMs: number;
};

// ---------------------------------------------------------------------------
// Env-var config loader
// ---------------------------------------------------------------------------

function parseEnvInt(
  envVar: string,
  defaultValue: number,
  minValue: number,
): number {
  const raw = process.env[envVar];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < minValue) {
    systemLogger.warn(
      `identity-birth-throttle: ${envVar} malformed, falling back to default`,
      {
        operation: "identity_birth_throttle_env_malformed",
        envVar,
        rawValue: raw,
        defaultValue,
      },
    );
    return defaultValue;
  }
  return parsed;
}

function loadConfig(): typeof config {
  // Reshape 2026-09-24: default bumped 1 → 2 (per-host, not global). Same-host
  // serialization is still enforced downstream by the supervisor's serial
  // launch queue; two concurrent births per host is safe and unlocks the
  // modal + coordinator co-fire case.
  const maxConcurrent = parseEnvInt("IDENTITY_BIRTH_MAX_CONCURRENT", 2, 1);
  const minIntervalMs = parseEnvInt("IDENTITY_BIRTH_MIN_INTERVAL_MS", 0, 0);
  const maxQueueDepth = parseEnvInt("IDENTITY_BIRTH_MAX_QUEUE_DEPTH", 100, 1);
  const expectedBirthDurationMs = parseEnvInt(
    "IDENTITY_BIRTH_EXPECTED_DURATION_MS",
    30_000,
    1,
  );

  systemLogger.info("identity-birth-throttle: config loaded", {
    operation: "identity_birth_throttle_config_loaded",
    maxConcurrent,
    minIntervalMs,
    maxQueueDepth,
    expectedBirthDurationMs,
    axis: "per-host",
  });

  return { maxConcurrent, minIntervalMs, maxQueueDepth, expectedBirthDurationMs };
}

// Module init — fires exactly once on import.
config = loadConfig();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Acquire a birth slot on the target host. Resolves with a `release` fn the
 * caller MUST invoke inside a `finally` block.
 *
 * Concurrency semantics are per-hostId:
 * - When `state.active < maxConcurrent` for this host: grants immediately.
 * - When all slots for this host are busy: enqueues into the host's queue and
 *   waits for a prior release ON THE SAME HOST.
 * - When the host's queue is at `maxQueueDepth` AND `bypassQueueDepth !== true`:
 *   rejects with `ThrottleRejectedError` (HTTP callers → 429).
 * - Births to DIFFERENT hosts NEVER block each other regardless of load.
 * - `bypassQueueDepth: true` (spawn-request path): never rejects on queue-depth
 *   overflow — disk-drop items already live on disk; silently dropping them is
 *   worse UX than piling up in memory.
 */
export async function acquireBirthSlot(ctx: AcquireContext): Promise<() => void> {
  const hostKey = String(ctx.hostId);
  const state = getOrCreateHostState(hostKey);

  if (state.active >= config.maxConcurrent) {
    // Host's slots all busy — either reject or enqueue.
    if (state.waiters.length >= config.maxQueueDepth && ctx.bypassQueueDepth !== true) {
      const retryAfterMs = state.waiters.length * config.expectedBirthDurationMs;
      systemLogger.warn("identity-birth-throttle: reject (queue full)", {
        operation: "identity_birth_throttle_reject",
        source: ctx.source,
        requestId: ctx.requestId,
        hostId: Number(ctx.hostId),
        queueDepth: state.waiters.length,
        maxQueueDepth: config.maxQueueDepth,
        retryAfterMs,
      });
      throw new ThrottleRejectedError(retryAfterMs);
    }

    // Enqueue the waiter into this host's queue.
    systemLogger.info("identity-birth-throttle: waiting for slot", {
      operation: "identity_birth_throttle_wait",
      source: ctx.source,
      requestId: ctx.requestId,
      hostId: Number(ctx.hostId),
      reason: "concurrency",
      queueDepth: state.waiters.length + 1,
      active: state.active,
    });

    await new Promise<void>((resolve, reject) => {
      state.waiters.push({ resolve, reject, source: ctx.source, requestId: ctx.requestId });
    });
    // Falls through to the grant path below after resolve() fires.
  }

  // Grant path — reached either synchronously or after a waiter was resolved.
  //
  // Increment active BEFORE any min-interval delay so the concurrency-cap
  // invariant holds throughout the wait: a second acquire arriving during the
  // min-interval pause correctly sees `active === maxConcurrent` and queues
  // rather than racing into a second grant. (Plan-checker concern #1, preserved
  // from the pre-reshape shape.)
  state.active++;

  const sinceLastRelease =
    state.lastReleaseAt === 0
      ? Number.POSITIVE_INFINITY
      : Date.now() - state.lastReleaseAt;

  if (sinceLastRelease < config.minIntervalMs) {
    const delayMs = config.minIntervalMs - sinceLastRelease;
    systemLogger.info("identity-birth-throttle: waiting for min-interval spacing", {
      operation: "identity_birth_throttle_wait",
      source: ctx.source,
      requestId: ctx.requestId,
      hostId: Number(ctx.hostId),
      reason: "min_interval",
      delayMs,
    });
    await new Promise<void>((res) => setTimeout(res, delayMs));
  }

  systemLogger.info("identity-birth-throttle: slot granted", {
    operation: "identity_birth_throttle_grant",
    source: ctx.source,
    requestId: ctx.requestId,
    hostId: Number(ctx.hostId),
    active: state.active,
    maxConcurrent: config.maxConcurrent,
  });

  // Build the idempotent release closure. Captures its own hostKey/state so a
  // release on hostA never touches hostB's counters.
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    state.active--;
    state.lastReleaseAt = Date.now();
    systemLogger.info("identity-birth-throttle: slot released", {
      operation: "identity_birth_throttle_release",
      source: ctx.source,
      requestId: ctx.requestId,
      hostId: Number(ctx.hostId),
      active: state.active,
      waitersRemaining: state.waiters.length,
    });
    const next = state.waiters.shift();
    if (next) next.resolve();
  };

  return release;
}

// ---------------------------------------------------------------------------
// Test-only helper
// ---------------------------------------------------------------------------

/**
 * Reset all module state. Call in `beforeEach` to give each test a clean slate.
 * Also re-reads env vars so tests that mutate `process.env` see updated values
 * on the next `acquireBirthSlot` call.
 *
 * Do NOT call from production code.
 */
export function __resetForTests(): void {
  registry.clear();
  config = loadConfig();
}
