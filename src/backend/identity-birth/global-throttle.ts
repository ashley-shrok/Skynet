/**
 * identity-birth/global-throttle.ts — Phase 110 global birth throttle.
 *
 * Wraps both `identity-birth.ts` (HTTP SSE entry point) and
 * `spawn-requests/worker.ts` (disk-drop entry point) invocations of
 * `birthIdentity()` through a single shared semaphore so a coordinator
 * dropping N spawn-request files at once (or firing N concurrent HTTP births)
 * never saturates downstream chokepoints (Matrix admin API, SSH channels on the
 * target host).
 *
 * Implementation uses Option B from CONTEXT.md § Specifics — a counter+waiter-
 * queue semaphore. The mechanics mirror `host-semaphore-registry.ts::makeSemaphore`
 * (active/waiters/waiters.shift() on release) but this instance is scoped to
 * per-process birth concurrency, not per-host SSH concurrency. The two scopes
 * are orthogonal; do NOT mix them.
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
  requestId?: string;
  bypassQueueDepth?: boolean;
}

/**
 * Thrown by `acquireBirthSlot` when the HTTP path's queue is at capacity.
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
// Module state (NOT exported — semaphore internals)
// ---------------------------------------------------------------------------

let active = 0;

const waiters: Array<{
  resolve: () => void;
  reject: (e: Error) => void;
  source: ThrottleSource;
  requestId?: string;
}> = [];

/** Epoch ms of most recent release. 0 = "never released" — first acquire skips
 * the min-interval gate. */
let lastReleaseAt = 0;

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
  const maxConcurrent = parseEnvInt("IDENTITY_BIRTH_MAX_CONCURRENT", 1, 1);
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
  });

  return { maxConcurrent, minIntervalMs, maxQueueDepth, expectedBirthDurationMs };
}

// Module init — fires exactly once on import.
config = loadConfig();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Acquire a birth slot. Resolves with a `release` fn the caller MUST invoke
 * inside a `finally` block.
 *
 * - When `active < maxConcurrent`: grants immediately (synchronous-style).
 * - When all slots are busy: enqueues and waits for a prior release.
 * - When `waiters.length >= maxQueueDepth` AND `bypassQueueDepth !== true`:
 *   rejects with `ThrottleRejectedError` (HTTP callers → 429).
 * - `bypassQueueDepth: true` (spawn-request path): never rejects on queue-depth
 *   overflow — disk-drop items already live on disk; silently dropping them is
 *   worse UX than piling up in memory.
 */
export async function acquireBirthSlot(ctx: AcquireContext): Promise<() => void> {
  if (active >= config.maxConcurrent) {
    // All slots busy — either reject or enqueue.
    if (waiters.length >= config.maxQueueDepth && ctx.bypassQueueDepth !== true) {
      const retryAfterMs = waiters.length * config.expectedBirthDurationMs;
      systemLogger.warn("identity-birth-throttle: reject (queue full)", {
        operation: "identity_birth_throttle_reject",
        source: ctx.source,
        requestId: ctx.requestId,
        queueDepth: waiters.length,
        maxQueueDepth: config.maxQueueDepth,
        retryAfterMs,
      });
      throw new ThrottleRejectedError(retryAfterMs);
    }

    // Enqueue the waiter.
    systemLogger.info("identity-birth-throttle: waiting for slot", {
      operation: "identity_birth_throttle_wait",
      source: ctx.source,
      requestId: ctx.requestId,
      reason: "concurrency",
      queueDepth: waiters.length + 1,
      active,
    });

    await new Promise<void>((resolve, reject) => {
      waiters.push({ resolve, reject, source: ctx.source, requestId: ctx.requestId });
    });
    // Falls through to the grant path below after resolve() fires.
  }

  // Grant path — reached either synchronously or after a waiter was resolved.
  //
  // Increment active BEFORE any min-interval delay so the concurrency-cap
  // invariant holds throughout the wait: a second acquire arriving during the
  // min-interval pause correctly sees `active === maxConcurrent` and queues
  // rather than racing into a second grant. (Plan-checker concern #1.)
  active++;

  const sinceLastRelease =
    lastReleaseAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - lastReleaseAt;

  if (sinceLastRelease < config.minIntervalMs) {
    const delayMs = config.minIntervalMs - sinceLastRelease;
    systemLogger.info("identity-birth-throttle: waiting for min-interval spacing", {
      operation: "identity_birth_throttle_wait",
      source: ctx.source,
      requestId: ctx.requestId,
      reason: "min_interval",
      delayMs,
    });
    await new Promise<void>((res) => setTimeout(res, delayMs));
  }

  systemLogger.info("identity-birth-throttle: slot granted", {
    operation: "identity_birth_throttle_grant",
    source: ctx.source,
    requestId: ctx.requestId,
    active,
    maxConcurrent: config.maxConcurrent,
  });

  // Build the idempotent release closure.
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    active--;
    lastReleaseAt = Date.now();
    systemLogger.info("identity-birth-throttle: slot released", {
      operation: "identity_birth_throttle_release",
      source: ctx.source,
      requestId: ctx.requestId,
      active,
      waitersRemaining: waiters.length,
    });
    const next = waiters.shift();
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
  active = 0;
  waiters.length = 0;
  lastReleaseAt = 0;
  config = loadConfig();
}
