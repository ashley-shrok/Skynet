/**
 * identity-birth/global-throttle.test.ts
 *
 * Unit tests for the Phase 110 identity-birth throttle module (reshaped
 * 2026-09-24 to per-target-host axis).
 *
 * Tests:
 *   1. concurrency cap forced 1 (env) — first resolves synchronously, second waits
 *   2. FIFO ordering under maxConcurrent=1 with 3 waiters
 *   3. maxConcurrent=2 default — two slots free simultaneously, third queues
 *   4. queue-depth reject — ThrottleRejectedError when queue full
 *   5. bypassQueueDepth=true — spawn-request path never rejects on depth overflow
 *   6. release() idempotency — double-release doesn't spuriously free a slot
 *   7. min-interval spacing (fake timers) — grant delayed when last release was recent
 *   8. __resetForTests clears state — fresh acquire is not blocked by leftover waiters
 *   9. env-var malformed fallback — LOUD warn + default fallback behavior
 *  10. config-loaded log fires after __resetForTests
 *  11. grant log carries source/requestId/hostId
 *  12. reject error shape — instanceof, message, name, retryAfterMs
 *  13. per-host isolation — a saturated hostA does not block acquires on hostB
 *  14. per-host queue-depth — reject at hostA's queue cap does not affect hostB
 *  15. per-host release wakes ONLY its own host's waiters
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  acquireBirthSlot,
  ThrottleRejectedError,
  __resetForTests,
} from "./global-throttle.js";
import { systemLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Mock systemLogger so log calls don't error in test environment and we can
// assert on structured log payloads.
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const systemLoggerMock = systemLogger as {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

// ---------------------------------------------------------------------------
// Env-var backup/restore helpers
// ---------------------------------------------------------------------------

const ENV_VARS = [
  "IDENTITY_BIRTH_MAX_CONCURRENT",
  "IDENTITY_BIRTH_MIN_INTERVAL_MS",
  "IDENTITY_BIRTH_MAX_QUEUE_DEPTH",
  "IDENTITY_BIRTH_EXPECTED_DURATION_MS",
] as const;

let savedEnv: Record<string, string | undefined> = {};

// Every test uses the same hostId=1 unless it's specifically exercising the
// per-host axis (tests 13-15), so give it a name for clarity.
const H = 1;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("identity-birth throttle (per-host)", () => {
  beforeEach(() => {
    // Back up env vars
    for (const key of ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    __resetForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore env vars
    for (const key of ENV_VARS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    savedEnv = {};
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Test 1 — concurrency cap forced to 1 via env
  // -------------------------------------------------------------------------

  it("Test 1: concurrency cap=1 (env) — first resolves synchronously, second waits", async () => {
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = "1";
    __resetForTests();
    vi.clearAllMocks();

    const callOrder: string[] = [];

    // Acquire slot A — should resolve immediately (active < maxConcurrent=1).
    const releaseAPromise = acquireBirthSlot({ source: "http", hostId: H, requestId: "A" });
    const releaseA = await releaseAPromise;
    callOrder.push("A-granted");

    // Acquire slot B — must queue because A holds the only slot.
    let releaseB: (() => void) | undefined;
    const slotBPromise = acquireBirthSlot({ source: "http", hostId: H, requestId: "B" }).then((fn) => {
      callOrder.push("B-granted");
      releaseB = fn;
    });

    // Give the microtask queue a chance to settle; B should still be pending.
    await Promise.resolve();
    await Promise.resolve();
    expect(callOrder).toEqual(["A-granted"]);
    expect(releaseB).toBeUndefined();

    // Release A — B should now be granted.
    releaseA();
    callOrder.push("A-released");

    await slotBPromise;
    expect(callOrder).toEqual(["A-granted", "A-released", "B-granted"]);
    expect(releaseB).toBeDefined();
    releaseB!();
  });

  // -------------------------------------------------------------------------
  // Test 2 — FIFO ordering under maxConcurrent=1 with 3 waiters
  // -------------------------------------------------------------------------

  it("Test 2: FIFO ordering — A then B then C granted in arrival order", async () => {
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = "1";
    __resetForTests();
    vi.clearAllMocks();

    const callOrder: string[] = [];

    // Hold slot A.
    const releaseA = await acquireBirthSlot({ source: "http", hostId: H, requestId: "A" });
    callOrder.push("A-granted");

    // Enqueue B and C while A holds the slot.
    let releaseB: (() => void) | undefined;
    let releaseC: (() => void) | undefined;

    const slotBPromise = acquireBirthSlot({ source: "http", hostId: H, requestId: "B" }).then((fn) => {
      callOrder.push("B-granted");
      releaseB = fn;
    });
    const slotCPromise = acquireBirthSlot({ source: "http", hostId: H, requestId: "C" }).then((fn) => {
      callOrder.push("C-granted");
      releaseC = fn;
    });

    await Promise.resolve();
    expect(callOrder).toEqual(["A-granted"]); // B and C are waiting

    // Release A — B should get the slot next (FIFO).
    releaseA();
    await slotBPromise;
    expect(callOrder).toEqual(["A-granted", "B-granted"]);
    expect(releaseC).toBeUndefined(); // C still waiting

    // Release B — C should get the slot.
    releaseB!();
    await slotCPromise;
    expect(callOrder).toEqual(["A-granted", "B-granted", "C-granted"]);
    releaseC!();
  });

  // -------------------------------------------------------------------------
  // Test 3 — maxConcurrent=2 (the new default)
  // -------------------------------------------------------------------------

  it("Test 3: maxConcurrent=2 default — two slots free simultaneously, third queues", async () => {
    // No env override — asserts the new per-host default.
    __resetForTests();
    vi.clearAllMocks();

    // A and B should resolve immediately.
    const releaseA = await acquireBirthSlot({ source: "http", hostId: H, requestId: "A" });
    const releaseB = await acquireBirthSlot({ source: "http", hostId: H, requestId: "B" });

    // C must queue (both slots occupied).
    let releaseC: (() => void) | undefined;
    const slotCPromise = acquireBirthSlot({ source: "http", hostId: H, requestId: "C" }).then((fn) => {
      releaseC = fn;
    });

    await Promise.resolve();
    expect(releaseC).toBeUndefined(); // C is still queued

    releaseA();
    await slotCPromise;
    expect(releaseC).toBeDefined();

    releaseB();
    releaseC!();
  });

  // -------------------------------------------------------------------------
  // Test 4 — queue-depth reject
  // -------------------------------------------------------------------------

  it("Test 4: queue-depth reject — fourth HTTP acquire rejects with ThrottleRejectedError", async () => {
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = "1";
    process.env.IDENTITY_BIRTH_MAX_QUEUE_DEPTH = "2";
    process.env.IDENTITY_BIRTH_EXPECTED_DURATION_MS = "5000";
    __resetForTests();
    vi.clearAllMocks();

    // Slot 1 acquired (holds the only concurrency slot).
    const releaseFirst = await acquireBirthSlot({ source: "http", hostId: H, requestId: "req-1" });

    // Waiter 1 and 2 enqueue fine (queue depth 1, 2 — within maxQueueDepth=2).
    const waiter1 = acquireBirthSlot({ source: "http", hostId: H, requestId: "req-2" });
    const waiter2 = acquireBirthSlot({ source: "http", hostId: H, requestId: "req-3" });

    // The fourth acquire should reject immediately (waiters.length === 2 === maxQueueDepth).
    await expect(
      acquireBirthSlot({ source: "http", hostId: H, requestId: "req-4" }),
    ).rejects.toThrow(ThrottleRejectedError);

    // Verify the rejected error has a positive retryAfterMs.
    let caughtErr: ThrottleRejectedError | undefined;
    try {
      await acquireBirthSlot({ source: "http", hostId: H, requestId: "req-5" });
    } catch (err) {
      if (err instanceof ThrottleRejectedError) caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    expect(caughtErr!.retryAfterMs).toBeGreaterThan(0);

    // Cleanup — release serially; with maxConcurrent=1 we must chain releases
    // because each release unblocks only one waiter at a time.
    releaseFirst();
    const releaseW1 = await waiter1;
    releaseW1();
    const releaseW2 = await waiter2;
    releaseW2();
  });

  // -------------------------------------------------------------------------
  // Test 5 — bypassQueueDepth=true
  // -------------------------------------------------------------------------

  it("Test 5: bypassQueueDepth=true — spawn-request path never rejects on depth overflow", async () => {
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = "1";
    process.env.IDENTITY_BIRTH_MAX_QUEUE_DEPTH = "2";
    __resetForTests();
    vi.clearAllMocks();

    const releases: Array<() => void> = [];
    const promises: Array<Promise<() => void>> = [];

    // Fire 10 acquires with bypassQueueDepth=true — none should reject.
    for (let i = 0; i < 10; i++) {
      promises.push(
        acquireBirthSlot({
          source: "spawn-request",
          hostId: H,
          bypassQueueDepth: true,
          requestId: `req-${i}`,
        }),
      );
    }

    // Release each as it becomes available.
    // The first resolves immediately; releasing it unblocks the next.
    for (let i = 0; i < 10; i++) {
      const release = await promises[i];
      releases.push(release);
      release();
    }

    // All 10 resolved without rejection.
    expect(releases).toHaveLength(10);
  });

  // -------------------------------------------------------------------------
  // Test 6 — release() idempotency
  // -------------------------------------------------------------------------

  it("Test 6: release() idempotency — double-release does not spuriously free a slot", async () => {
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = "1";
    __resetForTests();
    vi.clearAllMocks();

    const releaseA = await acquireBirthSlot({ source: "http", hostId: H, requestId: "A" });

    // Double-release.
    releaseA();
    releaseA(); // should be a no-op

    // Now acquire two slots: the first should be granted (slot free), the second
    // should queue because after double-release active should be 0, not -1.
    const releaseB = await acquireBirthSlot({ source: "http", hostId: H, requestId: "B" });

    // If double-release had decremented active twice it would be -1, letting a
    // third acquire resolve without waiting — catch that scenario.
    let releaseCGranted = false;
    const slotCPromise = acquireBirthSlot({ source: "http", hostId: H, requestId: "C" }).then((fn) => {
      releaseCGranted = true;
      return fn;
    });

    await Promise.resolve();
    // C must still be waiting because B holds the only slot.
    expect(releaseCGranted).toBe(false);

    releaseB();
    const releaseC = await slotCPromise;
    expect(releaseCGranted).toBe(true);
    releaseC();
  });

  // -------------------------------------------------------------------------
  // Test 7 — min-interval spacing (fake timers)
  // -------------------------------------------------------------------------

  it("Test 7: min-interval spacing — grant delayed when last release was recent", async () => {
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = "1";
    process.env.IDENTITY_BIRTH_MIN_INTERVAL_MS = "100";
    __resetForTests();
    vi.clearAllMocks();

    vi.useFakeTimers();

    // Acquire and immediately release to set lastReleaseAt.
    const releaseFirst = await acquireBirthSlot({ source: "http", hostId: H, requestId: "first" });
    releaseFirst();

    // Second acquire should be delayed by min-interval (we haven't advanced time yet).
    let secondGranted = false;
    const slotSecondPromise = acquireBirthSlot({ source: "http", hostId: H, requestId: "second" }).then(
      (fn) => {
        secondGranted = true;
        fn();
      },
    );

    // Advance by less than minIntervalMs — should still be waiting.
    await vi.advanceTimersByTimeAsync(50);
    expect(secondGranted).toBe(false);

    // Advance to past the min-interval boundary.
    await vi.advanceTimersByTimeAsync(100);
    await slotSecondPromise;
    expect(secondGranted).toBe(true);

    // Assert a wait log with reason: "min_interval" fired.
    expect(systemLoggerMock.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ operation: "identity_birth_throttle_wait", reason: "min_interval" }),
    );
  });

  // -------------------------------------------------------------------------
  // Test 8 — __resetForTests clears state
  // -------------------------------------------------------------------------

  it("Test 8: __resetForTests clears state — fresh acquire is not blocked by leftover waiters", async () => {
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = "1";
    __resetForTests();
    vi.clearAllMocks();

    // Enqueue 3 waiters by holding the slot and letting them queue.
    const holdSlot = await acquireBirthSlot({ source: "http", hostId: H, requestId: "hold" });
    const w1 = acquireBirthSlot({ source: "http", hostId: H, requestId: "w1" });
    const w2 = acquireBirthSlot({ source: "http", hostId: H, requestId: "w2" });
    const w3 = acquireBirthSlot({ source: "http", hostId: H, requestId: "w3" });
    void w1; void w2; void w3; // prevent unhandled rejection lint noise

    await Promise.resolve(); // let them enqueue

    // Reset — clears the registry Map (all per-host state gone).
    // (The three pending promises remain dangling but that's fine for this test.)
    holdSlot(); // release so reset doesn't leave active=1
    __resetForTests();
    vi.clearAllMocks();

    // After reset a new acquire must resolve synchronously (no leftover waiters blocking).
    let resolved = false;
    const freshPromise = acquireBirthSlot({ source: "http", hostId: H, requestId: "fresh" }).then((fn) => {
      resolved = true;
      fn();
    });

    await freshPromise;
    expect(resolved).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 9 — env-var malformed fallback
  // -------------------------------------------------------------------------

  it("Test 9: env-var malformed fallback — LOUD warn + default (maxConcurrent=2) behavior", async () => {
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = "abc";
    __resetForTests();
    // Note: vi.clearAllMocks() is NOT called here — we want to see the warn from loadConfig.

    // Verify the warn was emitted with the correct structured payload.
    expect(systemLoggerMock.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "identity_birth_throttle_env_malformed",
        envVar: "IDENTITY_BIRTH_MAX_CONCURRENT",
      }),
    );

    // Behavior fallback: should act as maxConcurrent=2 (per-host default). Two
    // concurrent acquires should both resolve; the third should queue.
    const releaseA = await acquireBirthSlot({ source: "http", hostId: H, requestId: "A" });
    const releaseB = await acquireBirthSlot({ source: "http", hostId: H, requestId: "B" });

    let releaseCGranted = false;
    const slotCPromise = acquireBirthSlot({ source: "http", hostId: H, requestId: "C" }).then((fn) => {
      releaseCGranted = true;
      fn();
    });

    await Promise.resolve();
    expect(releaseCGranted).toBe(false); // queued, not granted — confirms maxConcurrent=2 cap

    releaseA();
    await slotCPromise;
    expect(releaseCGranted).toBe(true);
    releaseB();
  });

  // -------------------------------------------------------------------------
  // Test 10 — config-loaded log fires after __resetForTests
  // -------------------------------------------------------------------------

  it("Test 10: config-loaded log fires after __resetForTests", () => {
    // __resetForTests is called in beforeEach, but let's call it again
    // to get a fresh mock capture after vi.clearAllMocks().
    __resetForTests();

    expect(systemLoggerMock.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "identity_birth_throttle_config_loaded",
        maxConcurrent: expect.any(Number),
        minIntervalMs: expect.any(Number),
        maxQueueDepth: expect.any(Number),
        expectedBirthDurationMs: expect.any(Number),
        axis: "per-host",
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Test 11 — grant log carries source/requestId/hostId
  // -------------------------------------------------------------------------

  it("Test 11: grant log fires with source, requestId, and hostId", async () => {
    const release = await acquireBirthSlot({
      source: "spawn-request",
      hostId: 42,
      requestId: "req-123",
    });

    expect(systemLoggerMock.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: "identity_birth_throttle_grant",
        source: "spawn-request",
        requestId: "req-123",
        hostId: 42,
      }),
    );

    release();
  });

  // -------------------------------------------------------------------------
  // Test 12 — reject error shape
  // -------------------------------------------------------------------------

  it("Test 12: reject error shape — instanceof, message, name, retryAfterMs", async () => {
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = "1";
    process.env.IDENTITY_BIRTH_MAX_QUEUE_DEPTH = "1";
    process.env.IDENTITY_BIRTH_EXPECTED_DURATION_MS = "10000";
    __resetForTests();
    vi.clearAllMocks();

    // Hold the only slot.
    const holdRelease = await acquireBirthSlot({ source: "http", hostId: H, requestId: "hold" });

    // Enqueue one waiter to fill queue to maxQueueDepth=1.
    const waiter = acquireBirthSlot({ source: "http", hostId: H, requestId: "waiter" });

    // The next HTTP acquire should be rejected.
    let caughtErr: unknown;
    try {
      await acquireBirthSlot({ source: "http", hostId: H, requestId: "overflow" });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeDefined();
    expect(caughtErr instanceof ThrottleRejectedError).toBe(true);

    const err = caughtErr as ThrottleRejectedError;
    expect(err.message).toBe("identity_birth_queue_full");
    expect(err.name).toBe("ThrottleRejectedError");
    expect(typeof err.retryAfterMs).toBe("number");
    expect(err.retryAfterMs).toBeGreaterThan(0);

    // Cleanup
    holdRelease();
    const releaseWaiter = await waiter;
    releaseWaiter();
  });

  // -------------------------------------------------------------------------
  // Test 13 — per-host isolation: saturated hostA does NOT block hostB
  // -------------------------------------------------------------------------

  it("Test 13: per-host isolation — saturating hostA does not block acquires on hostB", async () => {
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = "1";
    __resetForTests();
    vi.clearAllMocks();

    // Saturate hostA (cap=1, so one acquire fills it).
    const releaseA1 = await acquireBirthSlot({ source: "http", hostId: 1, requestId: "A1" });

    // A second acquire on hostA MUST queue.
    let releaseA2Granted = false;
    const a2Promise = acquireBirthSlot({ source: "http", hostId: 1, requestId: "A2" }).then((fn) => {
      releaseA2Granted = true;
      return fn;
    });
    await Promise.resolve();
    expect(releaseA2Granted).toBe(false);

    // But an acquire on hostB MUST resolve synchronously — different host, different pool.
    let releaseB1: (() => void) | undefined;
    const b1Promise = acquireBirthSlot({ source: "http", hostId: 2, requestId: "B1" }).then((fn) => {
      releaseB1 = fn;
      return fn;
    });
    await b1Promise;
    expect(releaseB1).toBeDefined();

    // Cleanup — release hostB, then unwind hostA's queue.
    releaseB1!();
    releaseA1();
    const releaseA2 = await a2Promise;
    releaseA2();
  });

  // -------------------------------------------------------------------------
  // Test 14 — per-host queue-depth: hostA queue-full does not affect hostB
  // -------------------------------------------------------------------------

  it("Test 14: per-host queue-depth — hostA queue-full rejects there but hostB accepts freely", async () => {
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = "1";
    process.env.IDENTITY_BIRTH_MAX_QUEUE_DEPTH = "1";
    process.env.IDENTITY_BIRTH_EXPECTED_DURATION_MS = "5000";
    __resetForTests();
    vi.clearAllMocks();

    // Fill hostA to cap + 1 waiter (queue at maxQueueDepth).
    const releaseA1 = await acquireBirthSlot({ source: "http", hostId: 1, requestId: "A1" });
    const a2 = acquireBirthSlot({ source: "http", hostId: 1, requestId: "A2" });

    // A third on hostA should reject.
    await expect(
      acquireBirthSlot({ source: "http", hostId: 1, requestId: "A3" }),
    ).rejects.toThrow(ThrottleRejectedError);

    // Meanwhile hostB's pool is untouched — an acquire resolves immediately, and
    // its waiter capacity is separate from hostA's.
    const releaseB1 = await acquireBirthSlot({ source: "http", hostId: 2, requestId: "B1" });
    const b2 = acquireBirthSlot({ source: "http", hostId: 2, requestId: "B2" });

    // Cleanup
    releaseB1();
    (await b2)();
    releaseA1();
    (await a2)();
  });

  // -------------------------------------------------------------------------
  // Test 15 — release on hostA wakes ONLY hostA's waiters
  // -------------------------------------------------------------------------

  it("Test 15: per-host release semantics — releasing hostA does not wake hostB's waiters", async () => {
    process.env.IDENTITY_BIRTH_MAX_CONCURRENT = "1";
    __resetForTests();
    vi.clearAllMocks();

    // Saturate both hosts.
    const releaseA1 = await acquireBirthSlot({ source: "http", hostId: 1, requestId: "A1" });
    const releaseB1 = await acquireBirthSlot({ source: "http", hostId: 2, requestId: "B1" });

    // Enqueue a waiter on each host.
    let a2Granted = false;
    let b2Granted = false;
    const a2Promise = acquireBirthSlot({ source: "http", hostId: 1, requestId: "A2" }).then((fn) => {
      a2Granted = true;
      return fn;
    });
    const b2Promise = acquireBirthSlot({ source: "http", hostId: 2, requestId: "B2" }).then((fn) => {
      b2Granted = true;
      return fn;
    });
    await Promise.resolve();
    expect(a2Granted).toBe(false);
    expect(b2Granted).toBe(false);

    // Release hostA — A2 should be granted; B2 must remain waiting.
    releaseA1();
    await a2Promise;
    expect(a2Granted).toBe(true);
    expect(b2Granted).toBe(false);

    // Release hostB — now B2 is granted.
    releaseB1();
    await b2Promise;
    expect(b2Granted).toBe(true);

    // Cleanup
    (await a2Promise)();
    (await b2Promise)();
  });
});
