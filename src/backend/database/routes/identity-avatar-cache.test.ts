import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  getCachedAvatar,
  invalidateCachedAvatar,
  invalidateCachedAvatarsForHost,
  _resetAvatarCacheForTest,
  _avatarCacheStatsForTest,
} from "./identity-avatar-cache.js";

const img = (s: string) => ({ bytes: Buffer.from(s), mime: "image/webp" });

describe("identity-avatar-cache", () => {
  beforeEach(() => _resetAvatarCacheForTest());
  afterEach(() => vi.useRealTimers());

  it("serves a versioned hit without calling load again", async () => {
    const load = vi.fn(async () => img("a"));
    const first = await getCachedAvatar(7, "aqua", "abc", load);
    const second = await getCachedAvatar(7, "aqua", "abc", load);
    expect(first.hit).toBe(false);
    expect(second.hit).toBe(true);
    expect(second.avatar?.bytes.toString()).toBe("a");
    expect(second.avatar?.etag).toMatch(/^"disk-[0-9a-f]{32}"$/);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("misses when the version changes", async () => {
    await getCachedAvatar(7, "aqua", "v1", async () => img("old"));
    const r = await getCachedAvatar(7, "aqua", "v2", async () => img("new"));
    expect(r.hit).toBe(false);
    expect(r.avatar?.bytes.toString()).toBe("new");
  });

  it("collapses concurrent misses into one load", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const load = vi.fn(async () => {
      await gate;
      return img("x");
    });
    const all = Promise.all(
      Array.from({ length: 20 }, () => getCachedAvatar(7, "aqua", "v", load)),
    );
    release();
    const results = await all;
    expect(load).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.avatar?.bytes.toString() === "x")).toBe(true);
  });

  it("expires unversioned entries after 60s", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => img("a"));
    await getCachedAvatar(7, "aqua", null, load);
    expect((await getCachedAvatar(7, "aqua", null, load)).hit).toBe(true);
    vi.advanceTimersByTime(61_000);
    expect((await getCachedAvatar(7, "aqua", null, load)).hit).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("caches 'no avatar' briefly, then retries", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => null);
    expect((await getCachedAvatar(7, "aqua", "v", load)).avatar).toBeNull();
    expect((await getCachedAvatar(7, "aqua", "v", load)).hit).toBe(true);
    vi.advanceTimersByTime(61_000);
    expect((await getCachedAvatar(7, "aqua", "v", load)).hit).toBe(false);
  });

  it("does not cache load failures", async () => {
    await expect(
      getCachedAvatar(7, "aqua", "v", async () => {
        throw new Error("ssh down");
      }),
    ).rejects.toThrow("ssh down");
    const r = await getCachedAvatar(7, "aqua", "v", async () => img("ok"));
    expect(r.hit).toBe(false);
    expect(r.avatar?.bytes.toString()).toBe("ok");
  });

  it("invalidate drops the entry", async () => {
    await getCachedAvatar(7, "aqua", "v", async () => img("a"));
    invalidateCachedAvatar(7, "aqua");
    expect((await getCachedAvatar(7, "aqua", "v", async () => img("b"))).hit).toBe(false);
  });

  it("a load in flight during invalidation does not repopulate the cache", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = getCachedAvatar(7, "aqua", null, async () => {
      await gate;
      return img("old");
    });
    invalidateCachedAvatar(7, "aqua");
    // A request after the invalidation must not join the stale load.
    const fresh = await getCachedAvatar(7, "aqua", null, async () => img("new"));
    expect(fresh.avatar?.bytes.toString()).toBe("new");
    release();
    await slow;
    const after = await getCachedAvatar(7, "aqua", null, async () => img("unused"));
    expect(after.hit).toBe(true);
    expect(after.avatar?.bytes.toString()).toBe("new");
  });

  it("host invalidation drops every identity on that host only", async () => {
    await getCachedAvatar(7, "a", "v", async () => img("a"));
    await getCachedAvatar(7, "b", "v", async () => img("b"));
    await getCachedAvatar(6, "a", "v", async () => img("six"));
    invalidateCachedAvatarsForHost(7);
    expect((await getCachedAvatar(7, "a", "v", async () => img("a2"))).hit).toBe(false);
    expect((await getCachedAvatar(7, "b", "v", async () => img("b2"))).hit).toBe(false);
    expect((await getCachedAvatar(6, "a", "v", async () => img("x"))).hit).toBe(true);
  });

  it("keys by host as well as identity", async () => {
    await getCachedAvatar(6, "aqua", "v", async () => img("six"));
    const r = await getCachedAvatar(7, "aqua", "v", async () => img("seven"));
    expect(r.hit).toBe(false);
    expect(r.avatar?.bytes.toString()).toBe("seven");
  });

  it("evicts least-recently-used entries past the byte budget", async () => {
    const big = () => ({ bytes: Buffer.alloc(5 * 1024 * 1024), mime: "image/webp" });
    for (let i = 0; i < 10; i++) {
      await getCachedAvatar(7, `id${i}`, "v", async () => big());
    }
    const stats = _avatarCacheStatsForTest();
    expect(stats.totalBytes).toBeLessThanOrEqual(24 * 1024 * 1024);
    expect((await getCachedAvatar(7, "id9", "v", async () => big())).hit).toBe(true);
    expect((await getCachedAvatar(7, "id0", "v", async () => big())).hit).toBe(false);
  });
});
