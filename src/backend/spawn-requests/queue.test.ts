/**
 * spawn-requests/queue.test.ts
 *
 * Unit tests for the in-memory serialized spawn-request queue (D-06, D-07).
 *
 * Tests:
 *   1. isEmpty() returns true on a fresh queue (after __resetForTests())
 *   2. enqueue(item) + drain calls processBirth with the item
 *   3. Two rapid enqueue() calls result in processBirth invoked SERIALLY
 *   4. If processBirth throws / rejects, the queue continues draining
 *   5. enqueue() returns synchronously (void)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  enqueue,
  isEmpty,
  setProcessBirth,
  __resetForTests,
} from "./queue.js";
import type { PendingBirth } from "./types.js";

// ---------------------------------------------------------------------------
// Mock systemLogger so log calls don't error in test environment
// ---------------------------------------------------------------------------

vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePendingBirth(overrides?: Partial<PendingBirth>): PendingBirth {
  return {
    hostId: "42",
    hostIdNum: 42,
    uuid: "test-uuid-0001-0000-0000-000000000001",
    role: "coordinator",
    task: "do a thing",
    requested_at: "2026-09-10T00:00:00Z",
    userId: "user-abc",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("spawn-request queue", () => {
  beforeEach(() => {
    __resetForTests();
    vi.clearAllMocks();
  });

  it("Test 1: isEmpty() returns true on a fresh queue", () => {
    expect(isEmpty()).toBe(true);
  });

  it("Test 2: enqueue(item) + drain calls processBirth with the item", async () => {
    const mockProcessBirth = vi.fn().mockResolvedValue(undefined);
    setProcessBirth(mockProcessBirth);

    const item = makePendingBirth();
    enqueue(item);

    // Wait for the worker Promise chain to settle
    // We need to flush the microtask queue via a small timeout
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(mockProcessBirth).toHaveBeenCalledTimes(1);
    expect(mockProcessBirth).toHaveBeenCalledWith(item);
  });

  it("Test 3: two rapid enqueue() calls result in processBirth invoked SERIALLY", async () => {
    const callOrder: string[] = [];

    // Create two manually-resolvable Promises so we can control timing
    let resolveA!: () => void;
    const deferredA = new Promise<void>((r) => {
      resolveA = r;
    });

    const itemA = makePendingBirth({ uuid: "aaaa-0000-0000-0000-000000000001" });
    const itemB = makePendingBirth({ uuid: "bbbb-0000-0000-0000-000000000002" });

    const mockProcessBirth = vi.fn().mockImplementation(async (item: PendingBirth) => {
      if (item.uuid === itemA.uuid) {
        callOrder.push("A-start");
        await deferredA;
        callOrder.push("A-end");
      } else {
        callOrder.push("B-start");
        callOrder.push("B-end");
      }
    });

    setProcessBirth(mockProcessBirth);

    // Enqueue both items rapidly (synchronous)
    enqueue(itemA);
    enqueue(itemB);

    // Wait one microtask tick so drainOne starts for A
    await Promise.resolve();
    await Promise.resolve();

    // A has started but not finished yet — B must not have started
    expect(callOrder).toContain("A-start");
    expect(callOrder).not.toContain("B-start");

    // Resolve A — now B should run
    resolveA();

    // Flush the remainder of the Promise chain
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(callOrder).toEqual(["A-start", "A-end", "B-start", "B-end"]);
    expect(mockProcessBirth).toHaveBeenCalledTimes(2);
    expect(mockProcessBirth).toHaveBeenNthCalledWith(1, itemA);
    expect(mockProcessBirth).toHaveBeenNthCalledWith(2, itemB);
  });

  it("Test 4: if processBirth throws, the queue continues draining subsequent items", async () => {
    const callOrder: string[] = [];

    const itemA = makePendingBirth({ uuid: "aaaa-0000-0000-0000-000000000001" });
    const itemB = makePendingBirth({ uuid: "bbbb-0000-0000-0000-000000000002" });

    const mockProcessBirth = vi.fn().mockImplementation(async (item: PendingBirth) => {
      if (item.uuid === itemA.uuid) {
        callOrder.push("A-threw");
        throw new Error("simulated birth failure");
      } else {
        callOrder.push("B-ran");
      }
    });

    setProcessBirth(mockProcessBirth);

    enqueue(itemA);
    enqueue(itemB);

    // Flush the Promise chain
    await new Promise<void>((r) => setTimeout(r, 20));

    expect(callOrder).toContain("A-threw");
    expect(callOrder).toContain("B-ran");
    expect(mockProcessBirth).toHaveBeenCalledTimes(2);
  });

  it("Test 5: enqueue() returns synchronously (void)", () => {
    const mockProcessBirth = vi.fn().mockResolvedValue(undefined);
    setProcessBirth(mockProcessBirth);

    const item = makePendingBirth();
    const result = enqueue(item);

    // enqueue returns void (undefined), not a Promise
    expect(result).toBeUndefined();
    // processBirth has NOT been called yet synchronously
    expect(mockProcessBirth).not.toHaveBeenCalled();
  });
});
