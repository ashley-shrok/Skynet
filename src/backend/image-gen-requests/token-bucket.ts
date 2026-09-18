/**
 * image-gen-requests/token-bucket.ts
 *
 * Hand-rolled token-bucket rate limiter used by the image-gen worker pool to
 * self-throttle outbound OpenAI calls (D-21). No external library dep —
 * `bottleneck`, `p-limit`, `p-queue`, `limiter` are all rejected in
 * RESEARCH.md § Alternatives Considered in favour of ~50 lines the project
 * owns outright.
 *
 * Configuration:
 *   rpm         — requests per minute; drives both refill rate and burst
 *                 capacity. Read from process.env.SKYNET_IMAGE_GEN_RPM
 *                 (default 30) at boot time in starter.ts; passed here.
 *   capacity    — max(1, floor(rpm * 5 / 60)) — RPM × 5 seconds of headroom
 *                 (D-21 discretion). The max(1, ...) floor guard prevents a
 *                 zero-capacity bucket when rpm < 12 (which would deadlock all
 *                 acquires).
 *   refillPerMs — rpm / 60_000 — tokens per millisecond; partial refill
 *                 accumulates linearly across the periodic tick.
 *
 * Design notes:
 *   - `setInterval(refill, 100).unref()` — periodic refill so queued waiters
 *     get woken even without new acquire() traffic. `.unref()` prevents this
 *     handle from blocking a Node SIGTERM shutdown (V14 of RESEARCH.md
 *     hygiene checklist).
 *   - No persistent-state backing — matches Phase 99 D-06 in-memory-only
 *     invariant. Restart clears all in-flight state; caller-side timeouts
 *     absorb the loss cleanly (D-16 helper timeout + D-22 worker TTL).
 *   - Waiters resolve in FIFO order: `waiters.shift()!` pops the oldest first.
 *
 * The factory returns a FRESH bucket instance per call, so no module-level
 * mutable state to reset in tests — every test creates its own bucket.
 */

/**
 * Public interface of a token bucket instance. Consumers await `acquire()`
 * before performing the rate-limited action; `getState()` is a snapshot for
 * logging/instrumentation and does NOT mutate.
 */
export interface TokenBucket {
  acquire(): Promise<void>;
  getState(): { tokens: number; capacity: number; refillRatePerSec: number };
}

/**
 * Construct a fresh token bucket sized for `rpm` requests per minute.
 *
 * Capacity: `max(1, floor(rpm * 5 / 60))` (RPM × 5 seconds).
 * Refill:   `rpm / 60_000` tokens per millisecond, applied continuously via
 *           a 100ms periodic tick + on-demand refill inside `acquire()`.
 */
export function createTokenBucket(rpm: number): TokenBucket {
  const capacity = Math.max(1, Math.floor((rpm * 5) / 60));
  const refillPerMs = rpm / 60_000;
  let tokens = capacity;
  let lastRefillMs = Date.now();
  const waiters: Array<() => void> = [];

  function refill(): void {
    const now = Date.now();
    const elapsed = now - lastRefillMs;
    if (elapsed <= 0) return;
    tokens = Math.min(capacity, tokens + elapsed * refillPerMs);
    lastRefillMs = now;
    // Drain waiters in FIFO order as long as tokens allow.
    while (waiters.length > 0 && tokens >= 1) {
      tokens -= 1;
      const resolve = waiters.shift()!;
      resolve();
    }
  }

  // Periodic refill — .unref() so the handle does not block Node exit /
  // SIGTERM. Every 100ms is fine-grained enough for a 30-60 RPM bucket
  // (1 token every 1-2 seconds) without meaningful CPU cost.
  setInterval(refill, 100).unref();

  return {
    async acquire(): Promise<void> {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    },
    getState(): { tokens: number; capacity: number; refillRatePerSec: number } {
      // Snapshot values — do NOT expose the mutable internals. `tokens` is
      // floored to an integer for readable log/instrumentation output
      // (internal math keeps the float across refills so partial-token
      // accumulation isn't lost). A caller sees "4 tokens remaining" instead
      // of "4.7333333333 tokens remaining".
      return {
        tokens: Math.floor(tokens),
        capacity,
        refillRatePerSec: rpm / 60,
      };
    },
  };
}
