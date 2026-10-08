import { describe, it, expect, vi } from "vitest";
import { JobQueue } from "./queue.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(concurrency: number, maxDepth = 100) {
  const started: string[] = [];
  const gates = new Map<string, ReturnType<typeof deferred>>();
  const onJobError = vi.fn();
  const queue = new JobQueue({ concurrency, maxDepth, onJobError });
  const add = (id: string, key?: string) =>
    queue.enqueue({
      key,
      run: () => {
        started.push(id);
        const d = deferred();
        gates.set(id, d);
        return d.promise;
      },
    });
  const finish = async (id: string) => {
    gates.get(id)!.resolve();
    await flush();
  };
  return { queue, started, add, finish, onJobError };
}

describe("JobQueue", () => {
  it("runs up to `concurrency` jobs at once, in FIFO order", async () => {
    const h = harness(2);
    ["a", "b", "c"].forEach((id) => h.add(id));
    expect(h.started).toEqual(["a", "b"]);
    await h.finish("a");
    expect(h.started).toEqual(["a", "b", "c"]);
  });

  it("never overlaps jobs with the same key, but lets other keys pass", async () => {
    const h = harness(10);
    h.add("alice-1", "alice");
    h.add("alice-2", "alice");
    h.add("bob-1", "bob");
    expect(h.started).toEqual(["alice-1", "bob-1"]);
    await h.finish("bob-1");
    expect(h.started).toEqual(["alice-1", "bob-1"]);
    await h.finish("alice-1");
    expect(h.started).toEqual(["alice-1", "bob-1", "alice-2"]);
  });

  it("rejects past maxDepth pending jobs", () => {
    const h = harness(1, 1);
    expect(h.add("running")).toBe(true);
    expect(h.add("pending")).toBe(true);
    expect(h.add("overflow")).toBe(false);
  });

  it("survives a job that rejects", async () => {
    const onJobError = vi.fn();
    const queue = new JobQueue({ concurrency: 1, maxDepth: 10, onJobError });
    const ran: string[] = [];
    queue.enqueue({ run: () => Promise.reject(new Error("boom")) });
    queue.enqueue({ run: async () => void ran.push("next") });
    await flush();
    await flush();
    expect(onJobError).toHaveBeenCalledOnce();
    expect(ran).toEqual(["next"]);
  });

  it("stop() drops pending jobs and refuses new ones", async () => {
    const h = harness(1);
    h.add("a");
    h.add("b");
    h.queue.stop();
    await h.finish("a");
    expect(h.started).toEqual(["a"]);
    expect(h.add("c")).toBe(false);
  });
});
