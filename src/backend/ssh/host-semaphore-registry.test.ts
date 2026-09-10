/**
 * host-semaphore-registry.test.ts — Unit tests for the per-host SSH semaphore
 * registry introduced in Phase 101 Plan 01 (D-01, D-08).
 *
 * Coverage:
 *   A — same hostId returns the same Semaphore instance (===)
 *   B — different hostIds return distinct Semaphore instances
 *   C — key normalization: numeric 1 and string "1" share one slot (D-01)
 *   D — cap=8 slot semantics with FIFO queueing under contention (D-08)
 *   E — error path: a throwing fn() still releases its slot
 *
 * No real SSH involved — tests operate purely on semaphore logic.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getHostSemaphore,
  __resetHostSemaphoreRegistryForTests,
} from "./host-semaphore-registry.js";

// ---------------------------------------------------------------------------
// Deferred helper — inline, not exported, used only in Test D
// ---------------------------------------------------------------------------
function makeDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// Reset registry between tests to prevent state leak
// ---------------------------------------------------------------------------
beforeEach(() => {
  __resetHostSemaphoreRegistryForTests();
});

describe("host-semaphore-registry", () => {
  // -------------------------------------------------------------------------
  // Test A — same hostId returns the SAME Semaphore instance
  // -------------------------------------------------------------------------
  it("A — same hostId returns the same Semaphore instance", () => {
    const sem1 = getHostSemaphore("42");
    const sem2 = getHostSemaphore("42");
    expect(sem1).toBe(sem2);
  });

  // -------------------------------------------------------------------------
  // Test B — different hostIds return DISTINCT Semaphore instances
  // -------------------------------------------------------------------------
  it("B — different hostIds return distinct Semaphore instances", () => {
    const semA = getHostSemaphore("42");
    const semB = getHostSemaphore("43");
    expect(semA).not.toBe(semB);
  });

  // -------------------------------------------------------------------------
  // Test C — key normalization (D-01): numeric 1 and string "1" share one slot
  // -------------------------------------------------------------------------
  it("C — key normalization: getHostSemaphore(1) and getHostSemaphore('1') return the same instance", () => {
    const semNumeric = getHostSemaphore(1);
    const semString = getHostSemaphore("1");
    expect(semNumeric).toBe(semString);
  });

  // -------------------------------------------------------------------------
  // Test D — cap=8 slot semantics with FIFO queueing (D-08)
  // -------------------------------------------------------------------------
  it("D — cap=8: 9th concurrent run() queues FIFO; resolving slot[0] starts slot[8]", async () => {
    const sem = getHostSemaphore("x", 8);

    // Create 9 deferreds — each fn() increments `started`, then awaits its deferred.
    const deferreds = Array.from({ length: 9 }, () => makeDeferred());
    let started = 0;

    const runs = deferreds.map((d, _i) =>
      sem.run(async () => {
        started++;
        await d.promise;
      }),
    );

    // Let the synchronous portion of each run() execute:
    // slot-check + started++ fires synchronously for the first 8; the 9th
    // queues and its started++ is gated behind the waiter resolution.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toBe(8);

    // Resolve deferred[0] — its slot releases, the 9th waiter wakes.
    deferreds[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toBe(9);

    // Clean up — resolve all remaining deferreds and await all run() promises.
    for (let i = 1; i < 9; i++) {
      deferreds[i].resolve();
    }
    await Promise.all(runs);
  });

  // -------------------------------------------------------------------------
  // Test E — error path: throwing fn() still releases its slot
  // -------------------------------------------------------------------------
  it("E — a throwing fn() releases its slot so the next waiter resumes", async () => {
    // Use limit=1 so the second run() must queue behind the first.
    const sem = getHostSemaphore("err-host", 1);

    const errorFn = async (): Promise<void> => {
      throw new Error("intentional test error");
    };

    // The first run() should reject (error propagates unchanged).
    await expect(sem.run(errorFn)).rejects.toThrow("intentional test error");

    // If the slot was NOT released, this second run() would hang forever.
    // With correct try/finally it resolves immediately.
    let secondRan = false;
    await sem.run(async () => {
      secondRan = true;
    });
    expect(secondRan).toBe(true);
  });
});
