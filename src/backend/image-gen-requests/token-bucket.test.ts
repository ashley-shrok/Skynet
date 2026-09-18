/**
 * token-bucket.test.ts — Unit tests for the hand-rolled token bucket used by
 * the image-gen worker pool to self-throttle outbound OpenAI calls.
 *
 * Coverage (per plan 116-01 Task 2 behaviour list):
 *   C1  createTokenBucket(60) → capacity = 5 (60 × 5 / 60), initial tokens = 5
 *   C2  createTokenBucket(30) → capacity = 2 (max(1, floor(30 × 5 / 60)))
 *   C3  createTokenBucket(6)  → capacity = 1 (max(1, floor(6 × 5 / 60)) — zero-guard)
 *   B1  5 consecutive acquire() at rpm=60 all resolve synchronously via microtask
 *   B2  6th acquire() blocks; advanceTimersByTimeAsync(1100) resolves one waiter
 *   B3  Second still-pending waiter after B2 remains blocked
 *   F1  Multiple queued waiters resolve in FIFO order
 *   R1  Over a 60s window at rpm=60, at most 60 acquires complete beyond initial burst
 *
 * Tests use vi.useFakeTimers so setInterval refill + Date.now can be advanced
 * deterministically.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTokenBucket } from "./token-bucket.js";

describe("createTokenBucket — capacity formula (D-21)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("C1: rpm=60 → capacity=5, initial tokens=5", () => {
    const bucket = createTokenBucket(60);
    const s = bucket.getState();
    expect(s.capacity).toBe(5);
    expect(s.tokens).toBe(5);
    expect(s.refillRatePerSec).toBeCloseTo(1, 6);
  });

  it("C2: rpm=30 → capacity=2, initial tokens=2", () => {
    const bucket = createTokenBucket(30);
    const s = bucket.getState();
    expect(s.capacity).toBe(2);
    expect(s.tokens).toBe(2);
    expect(s.refillRatePerSec).toBeCloseTo(0.5, 6);
  });

  it("C3: rpm=6 → capacity=1 (max(1, floor(6*5/60)) = max(1, 0))", () => {
    const bucket = createTokenBucket(6);
    const s = bucket.getState();
    expect(s.capacity).toBe(1);
    expect(s.tokens).toBe(1);
  });

  it("C4: rpm=120 → capacity=10", () => {
    const bucket = createTokenBucket(120);
    const s = bucket.getState();
    expect(s.capacity).toBe(10);
    expect(s.tokens).toBe(10);
    expect(s.refillRatePerSec).toBeCloseTo(2, 6);
  });
});

describe("createTokenBucket — acquire semantics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("B1: 5 consecutive acquires on rpm=60 all resolve immediately", async () => {
    const bucket = createTokenBucket(60);
    // The bucket must not drain below 0 while resolving these.
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    const s = bucket.getState();
    // Some tiny partial refill may have happened at the 0-ms mark since setup;
    // tolerate < 1 token accumulated (all 5 initial were drained).
    expect(s.tokens).toBeLessThan(1);
  });

  it("B2: 6th acquire blocks until ≥1s of refill happens", async () => {
    const bucket = createTokenBucket(60);
    for (let i = 0; i < 5; i++) await bucket.acquire();

    let sixthResolved = false;
    const sixthPromise = bucket.acquire().then(() => {
      sixthResolved = true;
    });

    // Nudge microtasks — still not resolved (no time elapsed).
    await Promise.resolve();
    expect(sixthResolved).toBe(false);

    // Advance beyond the 1s at rpm=60 = 1 token/sec.
    await vi.advanceTimersByTimeAsync(1_100);
    await sixthPromise;
    expect(sixthResolved).toBe(true);
  });

  it("B3: a second waiter remains blocked when only one token has refilled", async () => {
    const bucket = createTokenBucket(60);
    for (let i = 0; i < 5; i++) await bucket.acquire();

    let firstWaiterResolved = false;
    let secondWaiterResolved = false;
    const firstWaiter = bucket.acquire().then(() => {
      firstWaiterResolved = true;
    });
    const secondWaiter = bucket.acquire().then(() => {
      secondWaiterResolved = true;
    });

    await Promise.resolve();
    expect(firstWaiterResolved).toBe(false);
    expect(secondWaiterResolved).toBe(false);

    // 1.1s refills 1.1 tokens — enough for the FIRST waiter only.
    await vi.advanceTimersByTimeAsync(1_100);
    await firstWaiter;
    expect(firstWaiterResolved).toBe(true);
    expect(secondWaiterResolved).toBe(false);

    // Another second → refills enough for the second.
    await vi.advanceTimersByTimeAsync(1_000);
    await secondWaiter;
    expect(secondWaiterResolved).toBe(true);
  });
});

describe("createTokenBucket — FIFO waiter order", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("F1: multiple queued waiters resolve in FIFO order", async () => {
    const bucket = createTokenBucket(60);
    for (let i = 0; i < 5; i++) await bucket.acquire();

    const order: number[] = [];
    const waiters = [
      bucket.acquire().then(() => order.push(1)),
      bucket.acquire().then(() => order.push(2)),
      bucket.acquire().then(() => order.push(3)),
    ];

    // Refill enough for all 3 (3+ seconds at 1 token/sec).
    await vi.advanceTimersByTimeAsync(3_500);
    await Promise.all(waiters);

    expect(order).toEqual([1, 2, 3]);
  });
});

describe("createTokenBucket — sustained rate enforcement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("R1: 60s window at rpm=60 completes at most ~65 acquires (5 initial burst + 60 sustained)", async () => {
    const bucket = createTokenBucket(60);
    let completed = 0;

    // Queue 100 acquires — many will block.
    const promises: Array<Promise<void>> = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        bucket.acquire().then(() => {
          completed++;
        }),
      );
    }

    // Let the initial-burst 5 resolve.
    await Promise.resolve();
    // 60s window advance.
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();

    // Initial burst of 5 + 60s * 1/sec sustained = 65 max. Allow a small
    // slack for rounding (± 2).
    expect(completed).toBeGreaterThanOrEqual(60);
    expect(completed).toBeLessThanOrEqual(67);

    // Advance far into the future to drain remaining acquires so pending
    // Promise handles don't leak into the next test.
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all(promises);
  });
});
