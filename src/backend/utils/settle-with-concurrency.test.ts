import { describe, it, expect } from "vitest";
import { settleWithConcurrency } from "./settle-with-concurrency.js";

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("settleWithConcurrency", () => {
  it("never exceeds the limit and keeps input order", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 30 }, (_, i) => i);
    const out = await settleWithConcurrency(items, 8, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return n * 2;
    });
    expect(peak).toBe(8);
    expect(out.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual(
      items.map((n) => n * 2),
    );
  });

  it("records rejections (async and sync throws) without stopping the rest", async () => {
    const out = await settleWithConcurrency([1, 2, 3, 4], 2, (n) => {
      if (n === 2) throw new Error("sync boom");
      if (n === 3) return Promise.reject(new Error("async boom"));
      return Promise.resolve(n);
    });
    expect(out[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(out[1].status).toBe("rejected");
    expect((out[1] as PromiseRejectedResult).reason.message).toBe("sync boom");
    expect((out[2] as PromiseRejectedResult).reason.message).toBe("async boom");
    expect(out[3]).toEqual({ status: "fulfilled", value: 4 });
  });

  it("handles empty input and degenerate limits", async () => {
    expect(await settleWithConcurrency([], 8, async () => 1)).toEqual([]);
    let active = 0;
    let peak = 0;
    await settleWithConcurrency([1, 2, 3], 0, async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
    });
    expect(peak).toBe(1);
  });
});
