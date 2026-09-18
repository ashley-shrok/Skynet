/**
 * image-gen-requests/queue.test.ts
 *
 * Unit tests for the in-memory 5-worker-pool image-gen queue (Phase 116 D-20).
 *
 * Tests (Phase 116 deltas vs. Phase 99 spawn-requests/queue.test.ts):
 *   1. isEmpty() returns true on a fresh queue
 *   2. enqueue + startPool + drain calls processImageGen with the item
 *   3. Concurrent worker cap — 10 enqueued items → exactly 5 in-flight simultaneously
 *      (D-20 N=5). Resolve one → 6th picks up. Resolve remaining → all 10 fire.
 *   4. FIFO waiter wake-up — startPool with empty queue parks 5 workers; a subsequent
 *      enqueue directly wakes the earliest waiter (no shift/reshift dance).
 *   5. Drain-error containment — a throwing processImageGenFn does NOT crash the
 *      worker loop; subsequent items still process.
 *   6. __resetForTests clears state — after enqueue + reset, isEmpty is true.
 *   7. enqueue returns synchronously (void).
 *
 * TTL semantics are NOT tested at queue level (Pitfall 5 — TTL lives inside the
 * worker at dequeue). Queue tests only cover FIFO order, worker-pool cap,
 * waiter wake-up, and drain-error containment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  enqueue,
  isEmpty,
  setProcessImageGen,
  setWorkerDeps,
  startPool,
  stopPool,
  __resetForTests,
  WORKER_COUNT,
  MAX_QUEUE_DEPTH,
  type ProcessImageGenFn,
} from "./queue.js";
import type { PendingImageGen } from "./types.js";
import type { WorkerDeps } from "./worker.js";

// ---------------------------------------------------------------------------
// Mock systemLogger so log calls don't error in test environment
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  };
  // Provide every export the transitively-imported modules read
  // (worker.ts → ssh/host-resolver.ts pulls in `logger`, etc.). Post-FIX 5,
  // queue.ts runtime-imports worker.ts to expose writeImageGenFailureFile,
  // so every logger export the worker's transitive graph consumes must be
  // present in this mock or the module load errors.
  return {
    systemLogger: mockLogger,
    sshLogger: mockLogger,
    databaseLogger: mockLogger,
    logger: mockLogger,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePendingImageGen(overrides?: Partial<PendingImageGen>): PendingImageGen {
  return {
    hostId: "42",
    hostIdNum: 42,
    uuid: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    body: {
      prompt: "a cat",
      requested_at: "2026-09-18T00:00:00Z",
    },
    userId: "user-abc",
    ...overrides,
  };
}

/** A stub WorkerDeps — queue tests don't exercise dep fields, but the
 *  processImageGen fn must be called with both item AND deps per the wiring
 *  contract. Any object satisfies the {} slot; the fn itself never touches
 *  the fields under test. */
function makeStubWorkerDeps(): WorkerDeps {
  // Cast to WorkerDeps via unknown — the shape is a mock stand-in and the
  // queue does not read any fields off it.
  return {} as unknown as WorkerDeps;
}

/**
 * Flush the microtask queue enough times for a small chain of awaits to
 * settle. Mirrors spawn-requests/scan-orchestrator.test.ts:139 flush() idiom.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("image-gen queue", () => {
  beforeEach(() => {
    __resetForTests();
    vi.clearAllMocks();
  });

  it("Test 1: isEmpty() returns true on a fresh queue", () => {
    expect(isEmpty()).toBe(true);
  });

  it("Test 2: enqueue + startPool + drain calls processImageGen with the item", async () => {
    const mockProcess: ProcessImageGenFn = vi.fn().mockResolvedValue(undefined);
    setProcessImageGen(mockProcess);
    setWorkerDeps(makeStubWorkerDeps());
    startPool();

    const item = makePendingImageGen();
    enqueue(item);

    await flush();

    expect(mockProcess).toHaveBeenCalledTimes(1);
    // First arg = item; second arg = the workerDeps object (identity check)
    expect(vi.mocked(mockProcess).mock.calls[0][0]).toBe(item);
  });

  it("Test 3: concurrent worker cap — 10 enqueued items → exactly 5 in-flight; resolving one lets a 6th start", async () => {
    // Each processImageGen invocation returns a manually-controlled deferred.
    // We record which deferred belongs to which invocation index so the test
    // can resolve them in a controlled order.
    const deferreds: Array<{ resolve: () => void; itemUuid: string }> = [];

    const mockProcess: ProcessImageGenFn = vi.fn().mockImplementation(async (item: PendingImageGen) => {
      await new Promise<void>((resolve) => {
        deferreds.push({ resolve, itemUuid: item.uuid });
      });
    });

    setProcessImageGen(mockProcess);
    setWorkerDeps(makeStubWorkerDeps());
    startPool();

    // Enqueue 10 items. WORKER_COUNT = 5 → exactly 5 should start immediately.
    for (let i = 0; i < 10; i++) {
      enqueue(makePendingImageGen({ uuid: `item-${i.toString().padStart(2, "0")}-0000-0000-0000-000000000000` }));
    }

    await flush();

    // Exactly 5 processImageGen calls in-flight (D-20 concurrency cap).
    expect(mockProcess).toHaveBeenCalledTimes(5);
    expect(deferreds.length).toBe(5);

    // Resolve one → the loop that owned it should pick up a 6th item.
    deferreds[0].resolve();
    await flush();
    expect(mockProcess).toHaveBeenCalledTimes(6);

    // Resolve the remaining 5 in-flight → each loop picks up another item
    // until the queue drains. After that, all 10 items should be processed.
    for (let i = 1; i < 5; i++) deferreds[i].resolve();
    await flush();
    // At this point 5 more items (indices 5..9) should have been started —
    // total call count = 10. But 5 of them are still holding deferreds.
    expect(mockProcess).toHaveBeenCalledTimes(10);

    // Drain the last 5 deferreds so the test can exit cleanly.
    for (let i = 5; i < 10; i++) deferreds[i].resolve();
    await flush();
  });

  it("Test 4: FIFO waiter wake-up — startPool with empty queue parks workers; subsequent enqueue wakes earliest waiter", async () => {
    const callOrder: string[] = [];
    const mockProcess: ProcessImageGenFn = vi.fn().mockImplementation(async (item: PendingImageGen) => {
      callOrder.push(item.uuid);
    });

    setProcessImageGen(mockProcess);
    setWorkerDeps(makeStubWorkerDeps());
    startPool();

    // Give the pool a tick to fire — all 5 loops should be parked as waiters.
    await flush();
    expect(mockProcess).not.toHaveBeenCalled();

    // Enqueue two items — both should be picked up promptly (each wakes a waiter).
    const itemA = makePendingImageGen({ uuid: "aaaaaaaa-0000-0000-0000-000000000001" });
    const itemB = makePendingImageGen({ uuid: "bbbbbbbb-0000-0000-0000-000000000002" });

    enqueue(itemA);
    enqueue(itemB);

    await flush();

    expect(mockProcess).toHaveBeenCalledTimes(2);
    // Both items processed; order preserved (A before B by enqueue order).
    expect(callOrder).toEqual([itemA.uuid, itemB.uuid]);
  });

  it("Test 5: drain-error containment — a throwing processImageGenFn does not crash the loop; subsequent items still process", async () => {
    const processed: string[] = [];
    const mockProcess: ProcessImageGenFn = vi.fn().mockImplementation(async (item: PendingImageGen) => {
      processed.push(item.uuid);
      // Throw on odd-indexed items (by ordinal in `processed`)
      if (processed.length % 2 === 1) {
        throw new Error(`simulated worker failure for ${item.uuid}`);
      }
    });

    setProcessImageGen(mockProcess);
    setWorkerDeps(makeStubWorkerDeps());
    startPool();

    // Enqueue 4 items — items 1 + 3 throw, items 2 + 4 succeed.
    for (let i = 0; i < 4; i++) {
      enqueue(makePendingImageGen({ uuid: `item-${i.toString().padStart(2, "0")}-0000-0000-0000-000000000000` }));
    }

    await flush();

    // All 4 items got processImageGen invocations (loops did not crash).
    expect(mockProcess).toHaveBeenCalledTimes(4);
    expect(processed.length).toBe(4);
  });

  it("Test 6: __resetForTests clears state — isEmpty returns true after enqueue + reset", () => {
    setProcessImageGen(vi.fn().mockResolvedValue(undefined));
    setWorkerDeps(makeStubWorkerDeps());

    enqueue(makePendingImageGen());
    enqueue(makePendingImageGen({ uuid: "bbbbbbbb-0000-0000-0000-000000000002" }));
    expect(isEmpty()).toBe(false);

    __resetForTests();
    expect(isEmpty()).toBe(true);
  });

  it("Test 7: enqueue returns synchronously (void)", () => {
    setProcessImageGen(vi.fn().mockResolvedValue(undefined));
    setWorkerDeps(makeStubWorkerDeps());
    // Note: no startPool() here — pool must be startable independently of enqueue.

    const item = makePendingImageGen();
    const result = enqueue(item);

    expect(result).toBeUndefined();
    expect(isEmpty()).toBe(false); // item still pending — no loop consuming yet
  });

  it("Test 8: WORKER_COUNT is exported as the D-20 named constant (5)", () => {
    expect(WORKER_COUNT).toBe(5);
  });

  it("Test 10: MAX_QUEUE_DEPTH exported and finite", () => {
    expect(Number.isFinite(MAX_QUEUE_DEPTH)).toBe(true);
    expect(MAX_QUEUE_DEPTH).toBeGreaterThan(0);
  });

  it("Test 11: enqueue past MAX_QUEUE_DEPTH → new item rejected, failure.json dropped via workerDeps", async () => {
    // Track failure-file writes: any writeMarkdownFileAtomic call means the
    // overflow-drop path fired.
    const writeMarkdownFileAtomic = vi.fn().mockResolvedValue(undefined);
    const writeBinaryFileAtomic = vi.fn().mockResolvedValue(undefined);

    const workerDeps: WorkerDeps = {
      writeMarkdownFileAtomic,
      writeBinaryFileAtomic,
      isLocalHostId: vi.fn().mockReturnValue(true),
      resolveHostById: vi.fn(),
      connectOneShot: vi.fn(),
      execCommand: vi.fn(),
      callOpenAiImageGen: vi.fn(),
      tokenBucket: { acquire: vi.fn(), getState: vi.fn() } as unknown as WorkerDeps["tokenBucket"],
      now: () => Date.now(),
    };

    // Register a process fn that BLOCKS forever so no items leave the pending
    // queue — this lets us fill the queue up to the cap without racing with
    // worker drain.
    const blockingProcess: ProcessImageGenFn = vi.fn().mockImplementation(
      () => new Promise<void>(() => {}),
    );
    setProcessImageGen(blockingProcess);
    setWorkerDeps(workerDeps);
    // NOTE: do NOT startPool() — no drain → items sit in pending.

    // Fill to the cap. Use padded uuids so each is unique + a valid hex
    // shape isn't required (queue doesn't validate).
    for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
      enqueue(
        makePendingImageGen({
          uuid: `cap-item-${i.toString().padStart(6, "0")}-0000-0000-0000-000000000000`,
        }),
      );
    }

    // No failure drops yet — every enqueue below the cap succeeds.
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();

    // The (MAX_QUEUE_DEPTH + 1)th item MUST be rejected.
    const rejectItem = makePendingImageGen({
      uuid: "reject00-0000-0000-0000-000000000000",
    });
    enqueue(rejectItem);

    // Give the fire-and-forget failure-file drop a microtask to fire.
    await flush();

    // writeMarkdownFileAtomic fired exactly once — for the rejected item.
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const call = writeMarkdownFileAtomic.mock.calls[0];
    // The path names the rejected uuid's failure.json.
    expect(call[1]).toContain("reject00-0000-0000-0000-000000000000.failure.json");
    // Body contains the queue-full failure shape.
    const body = JSON.parse(call[2] as string);
    expect(body.reason).toBe("unknown");
    expect(body.message).toContain("queue full");
  });

  it("Test 12: overflow-drop is safe when workerDeps is not wired (warn-log only, no throw)", () => {
    // No setWorkerDeps() — mimic a mis-wired startup or a very early scan tick.
    setProcessImageGen(vi.fn().mockResolvedValue(undefined));

    // Fill to the cap.
    for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
      enqueue(
        makePendingImageGen({
          uuid: `cap2-item-${i.toString().padStart(5, "0")}-0000-0000-0000-000000000000`,
        }),
      );
    }

    // The (cap + 1) enqueue MUST NOT throw when workerDeps is null.
    expect(() => enqueue(makePendingImageGen({ uuid: "no-deps00-0000-0000-0000-000000000000" }))).not.toThrow();
  });

  it("Test 9: stopPool prevents new drains (workers exit their loop)", async () => {
    const mockProcess: ProcessImageGenFn = vi.fn().mockResolvedValue(undefined);
    setProcessImageGen(mockProcess);
    setWorkerDeps(makeStubWorkerDeps());
    startPool();

    // Give loops a tick to park.
    await flush();

    stopPool();

    // After stopPool the loop check should short-circuit. New enqueues will
    // sit in pending forever (in-memory queue dies on process exit — matches
    // Phase 99 D-06 in-memory-only invariant).
    enqueue(makePendingImageGen());
    await flush();
    expect(mockProcess).not.toHaveBeenCalled();
  });
});
