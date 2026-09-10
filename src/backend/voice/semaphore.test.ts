import { describe, it, expect } from "vitest";
import { createSemaphore } from "./semaphore.js";

describe("createSemaphore", () => {
  it("admits exactly N concurrent calls; the (N+1)th waits until one resolves", async () => {
    const sem = createSemaphore(2);

    let running = 0;
    let maxSeen = 0;
    const resolvers: Array<() => void> = [];

    // Create 3 async fns that each wait on a manual resolver.
    const tasks = [0, 1, 2].map(() =>
      sem(
        () =>
          new Promise<void>((res) => {
            running++;
            if (running > maxSeen) maxSeen = running;
            resolvers.push(() => {
              running--;
              res();
            });
          }),
      ),
    );

    // Give the microtask queue time to admit up to N=2 callers.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Exactly 2 should be running; the 3rd is still queued.
    expect(running).toBe(2);
    expect(maxSeen).toBe(2);

    // Resolve the first caller — the 3rd should now be admitted.
    resolvers[0]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Now 2 are still running (tasks 1 and 2).
    expect(running).toBe(2);

    // Drain the rest.
    resolvers[1]();
    resolvers[2]();
    await Promise.all(tasks);

    expect(running).toBe(0);
    expect(maxSeen).toBe(2);
  });

  it("acquire returns the wrapped fn's resolved value (identity passthrough)", async () => {
    const sem = createSemaphore(1);
    const result = await sem(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("acquire rejects with the wrapped fn's rejection (error passthrough, slot released)", async () => {
    const sem = createSemaphore(1);
    const boom = new Error("test-rejection");
    await expect(sem(() => Promise.reject(boom))).rejects.toBe(boom);

    // Slot was released — a subsequent acquire succeeds without hanging.
    const result = await sem(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });

  it("preserves FIFO queue order (limit=1, calls A B C resolve in order A B C)", async () => {
    const sem = createSemaphore(1);
    const order: number[] = [];

    // Build 3 deferred promises to control resolution timing.
    const resolvers: Array<() => void> = [];
    const make = (id: number) =>
      sem(
        () =>
          new Promise<void>((res) => {
            resolvers.push(() => {
              order.push(id);
              res();
            });
          }),
      );

    const tasks = [make(0), make(1), make(2)];

    // Drain microtasks so callers are queued.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Resolve in submission order.
    resolvers[0]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    resolvers[1]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    resolvers[2]();
    await Promise.all(tasks);

    expect(order).toEqual([0, 1, 2]);
  });

  it("releases the slot even when the wrapped fn throws (no slot leak on rejection)", async () => {
    const sem = createSemaphore(1);
    const boom = new Error("slot-leak-test");

    // Fill the semaphore — this one will throw.
    await expect(sem(() => Promise.reject(boom))).rejects.toBe(boom);

    // The slot MUST be released. If it leaked, the following call would hang.
    const result = await sem(() => Promise.resolve("after-throw"));
    expect(result).toBe("after-throw");
  });
});
