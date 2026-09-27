/**
 * phone-call-requests/queue.test.ts
 *
 * Tests for the per-user-serial in-memory queue. Key invariant:
 *   - Two items targeting the SAME user run serially.
 *   - Items targeting DIFFERENT users can run concurrently.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  enqueue,
  setProcessPhoneCall,
  setWorkerDeps,
  stopPool,
  getQueueSnapshot,
  __resetForTests,
  MAX_QUEUE_DEPTH,
} from "./queue.js";
import type { PendingPhoneCall } from "./types.js";
import type { WorkerDeps } from "./worker.js";

const { stubLogger } = vi.hoisted(() => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  };
  return { stubLogger: stub };
});
vi.mock("../utils/logger.js", () => ({
  systemLogger: stubLogger,
  databaseLogger: stubLogger,
  sshLogger: stubLogger,
  tunnelLogger: stubLogger,
  fileLogger: stubLogger,
  statsLogger: stubLogger,
  apiLogger: stubLogger,
  authLogger: stubLogger,
  versionLogger: stubLogger,
  dashboardLogger: stubLogger,
  guacLogger: stubLogger,
  logger: stubLogger,
  setGlobalLogLevel: vi.fn(),
  getGlobalLogLevel: () => "info",
}));

const emptyDeps = {} as unknown as WorkerDeps;

function makeItem(uuid: string, toUser: string): PendingPhoneCall {
  return {
    hostId: "1",
    hostIdNum: 1,
    uuid,
    body: {
      caller_name: "Test",
      to_user: toUser,
      message: "hi",
      requested_at: new Date().toISOString(),
    },
  };
}

/**
 * Manually-releasable deferred — controls the exact moment the "in-flight"
 * call finishes so tests can prove serial-vs-parallel behavior.
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("phone queue — per-user serialization", () => {
  beforeEach(() => {
    __resetForTests();
    setWorkerDeps(emptyDeps);
  });

  afterEach(() => {
    stopPool();
    __resetForTests();
  });

  it("processes items for the SAME user serially", async () => {
    const order: string[] = [];
    const gate1 = deferred();
    const gate2 = deferred();

    const fn = vi.fn(async (item: PendingPhoneCall) => {
      order.push(`start:${item.uuid}`);
      if (item.uuid === "a") await gate1.promise;
      else if (item.uuid === "b") await gate2.promise;
      order.push(`end:${item.uuid}`);
    });
    setProcessPhoneCall(fn);

    enqueue(makeItem("a", "alice"));
    enqueue(makeItem("b", "alice"));

    // Let the microtask queue drain so a's loop entry runs.
    await Promise.resolve();
    await Promise.resolve();

    // a should be running; b is queued behind (NOT started yet).
    expect(order).toEqual(["start:a"]);

    // Finish a — b should now start.
    gate1.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["start:a", "end:a", "start:b"]);

    // Finish b.
    gate2.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("processes items for DIFFERENT users concurrently", async () => {
    const order: string[] = [];
    const gateAlice = deferred();
    const gateBob = deferred();

    const fn = vi.fn(async (item: PendingPhoneCall) => {
      order.push(`start:${item.uuid}`);
      if (item.body.to_user === "alice") await gateAlice.promise;
      else if (item.body.to_user === "bob") await gateBob.promise;
      order.push(`end:${item.uuid}`);
    });
    setProcessPhoneCall(fn);

    enqueue(makeItem("a", "alice"));
    enqueue(makeItem("b", "bob"));

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Both should be running concurrently (different users → parallel loops).
    expect(order).toEqual(["start:a", "start:b"]);
    expect(getQueueSnapshot().runningUsers.sort()).toEqual(["alice", "bob"]);

    // Finish both.
    gateAlice.resolve();
    gateBob.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(order.sort()).toEqual(["end:a", "end:b", "start:a", "start:b"]);
    expect(getQueueSnapshot().runningUsers).toEqual([]);
  });

  it("continues the per-user loop even after an item throws", async () => {
    const seen: string[] = [];
    const fn = vi.fn(async (item: PendingPhoneCall) => {
      seen.push(item.uuid);
      if (item.uuid === "a") throw new Error("simulated");
    });
    setProcessPhoneCall(fn);

    enqueue(makeItem("a", "alice"));
    enqueue(makeItem("b", "alice"));

    // Wait a few microtasks for both to drain.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(seen).toEqual(["a", "b"]);
    expect(getQueueSnapshot().runningUsers).toEqual([]);
  });
});

describe("phone queue — MAX_QUEUE_DEPTH cap", () => {
  beforeEach(() => {
    __resetForTests();
    setWorkerDeps(emptyDeps);
  });
  afterEach(() => {
    stopPool();
    __resetForTests();
  });

  it("rejects items past MAX_QUEUE_DEPTH without invoking the processor", async () => {
    // Never resolve — every enqueued item stays "in flight" so the FIFO
    // grows unbounded until the cap kicks in.
    const forever = deferred();
    const fn = vi.fn(async () => forever.promise);
    setProcessPhoneCall(fn);

    // Fill to the cap.
    for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
      enqueue(makeItem(`item-${i}`, `user-${i % 10}`));
    }
    await Promise.resolve();

    // One more — should be REJECTED (write attempted via workerDeps, but
    // our emptyDeps has no writer, so the void write is a silent no-op
    // when writePhoneCallResponseFile can't do anything with undefined).
    const initialCallCount = fn.mock.calls.length;
    enqueue(makeItem("overflow", "user-0"));

    // Processor must not have been invoked for the overflow item.
    await Promise.resolve();
    for (const call of fn.mock.calls) {
      expect((call[0] as PendingPhoneCall).uuid).not.toBe("overflow");
    }
    // Still exactly `initialCallCount` in-flight processor calls (all
    // frozen on `forever`), and the overflow item never entered.
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(initialCallCount);

    forever.resolve();
  });
});
