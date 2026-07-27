// ─── bounty-counts-store — Vitest coverage (quick 260727-tb1 Task 2) ─────────
//
// Exercises the module-scoped useSyncExternalStore store that backs the per-
// row on-deck bounty badge in pretty-conversations. The store owns:
//   - useBountyCount(identityKey, hostId) selector (undefined pre-fetch)
//   - refreshBountyCounts(targets) one-shot fetch that applies to the map
//   - startBountyCountPoller(getTargets, intervalMs) with 60s + window.focus
//   - invalidateIdentity(identityKey, hostId) targeted refetch
//
// The store's only external dependency is countIdentityBounties from
// @/api/claude-session-api; we mock that module here to feed deterministic
// responses per test.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/api/claude-session-api", () => ({
  countIdentityBounties: vi.fn(),
}));

import { countIdentityBounties } from "@/api/claude-session-api";
import {
  useBountyCount,
  refreshBountyCounts,
  startBountyCountPoller,
  invalidateIdentity,
  __resetBountyCountsForTest,
} from "./bounty-counts-store.js";

type CountsResponse = {
  type: "identity:bounty-counts";
  counts: Array<{
    identityKey: string;
    hostId: number | null;
    onDeckCount: number;
    error?: string;
  }>;
};

function response(
  entries: Array<[string, number | null, number, string?]>,
): CountsResponse {
  return {
    type: "identity:bounty-counts",
    counts: entries.map(([identityKey, hostId, onDeckCount, error]) => ({
      identityKey,
      hostId,
      onDeckCount,
      ...(error ? { error } : {}),
    })),
  };
}

beforeEach(() => {
  __resetBountyCountsForTest();
  vi.mocked(countIdentityBounties).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — useBountyCount pre-fetch returns undefined; post-fetch returns int
// ─────────────────────────────────────────────────────────────────────────────

describe("useBountyCount round-trip", () => {
  it("returns undefined before any fetch, then the fetched integer after refreshBountyCounts", async () => {
    vi.mocked(countIdentityBounties).mockResolvedValue(
      response([["tina", null, 3]]),
    );

    const { result, rerender } = renderHook(() => useBountyCount("tina", null));
    expect(result.current).toBeUndefined();

    await act(async () => {
      await refreshBountyCounts([{ identityKey: "tina", hostId: null }]);
    });
    rerender();
    expect(result.current).toBe(3);
  });

  it("returns undefined when identityKey is null (short-circuit — no subscription cost)", () => {
    const { result } = renderHook(() => useBountyCount(null, null));
    expect(result.current).toBeUndefined();
  });

  it("distinguishes composite keys — same identityKey on different hostIds are independent", async () => {
    vi.mocked(countIdentityBounties).mockResolvedValue(
      response([
        ["tina", null, 2],
        ["tina", 42, 5],
      ]),
    );

    const { result: localResult, rerender: rerenderLocal } = renderHook(() =>
      useBountyCount("tina", null),
    );
    const { result: remoteResult, rerender: rerenderRemote } = renderHook(() =>
      useBountyCount("tina", 42),
    );

    await act(async () => {
      await refreshBountyCounts([
        { identityKey: "tina", hostId: null },
        { identityKey: "tina", hostId: 42 },
      ]);
    });
    rerenderLocal();
    rerenderRemote();
    expect(localResult.current).toBe(2);
    expect(remoteResult.current).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — batching + wire shape: N targets = ONE countIdentityBounties call
// ─────────────────────────────────────────────────────────────────────────────

describe("refreshBountyCounts batching", () => {
  it("N targets → exactly one countIdentityBounties call carrying all N targets (batched)", async () => {
    vi.mocked(countIdentityBounties).mockResolvedValue(
      response([
        ["a", null, 1],
        ["b", null, 0],
        ["c", 7, 4],
      ]),
    );

    await act(async () => {
      await refreshBountyCounts([
        { identityKey: "a", hostId: null },
        { identityKey: "b", hostId: null },
        { identityKey: "c", hostId: 7 },
      ]);
    });

    expect(countIdentityBounties).toHaveBeenCalledTimes(1);
    expect(vi.mocked(countIdentityBounties).mock.calls[0][0]).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — poll interval fires refresh at intervalMs
// ─────────────────────────────────────────────────────────────────────────────

describe("startBountyCountPoller cadence", () => {
  it("fires an initial fetch, then again at each intervalMs, and stop() clears the interval", async () => {
    vi.useFakeTimers();
    vi.mocked(countIdentityBounties).mockResolvedValue(
      response([["tina", null, 1]]),
    );

    const getTargets = () => [{ identityKey: "tina", hostId: null }];
    let stop = () => {};
    await act(async () => {
      stop = startBountyCountPoller(getTargets, 60_000);
      // Flush the initial fetch's microtask.
      await Promise.resolve();
    });
    expect(countIdentityBounties).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(countIdentityBounties).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(countIdentityBounties).toHaveBeenCalledTimes(3);

    stop();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(countIdentityBounties).toHaveBeenCalledTimes(3);
  });

  it("window.focus fires an extra refresh; stop() removes the focus listener", async () => {
    vi.useFakeTimers();
    vi.mocked(countIdentityBounties).mockResolvedValue(
      response([["tina", null, 1]]),
    );

    const getTargets = () => [{ identityKey: "tina", hostId: null }];
    let stop = () => {};
    await act(async () => {
      stop = startBountyCountPoller(getTargets, 60_000);
      await Promise.resolve();
    });
    // Initial fetch.
    expect(countIdentityBounties).toHaveBeenCalledTimes(1);

    // Focus fires an extra refresh.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(countIdentityBounties).toHaveBeenCalledTimes(2);

    // stop() removes the listener; subsequent focus events do NOT fire.
    stop();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(countIdentityBounties).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — invalidateIdentity fires a targeted refresh
// ─────────────────────────────────────────────────────────────────────────────

describe("invalidateIdentity", () => {
  it("fires a targeted refresh for just the given (identityKey, hostId) pair", async () => {
    vi.mocked(countIdentityBounties).mockResolvedValue(
      response([["tina", 42, 9]]),
    );

    await act(async () => {
      await invalidateIdentity("tina", 42);
    });

    expect(countIdentityBounties).toHaveBeenCalledTimes(1);
    const targetsArg = vi.mocked(countIdentityBounties).mock.calls[0][0];
    expect(targetsArg).toEqual([{ identityKey: "tina", hostId: 42 }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — per-target error preserves last-known count (does NOT clobber to 0)
// ─────────────────────────────────────────────────────────────────────────────

describe("per-target error handling", () => {
  it("a rejected target in the response does NOT overwrite the last-known count with 0", async () => {
    // First fetch: healthy, count=4.
    vi.mocked(countIdentityBounties).mockResolvedValueOnce(
      response([["tina", null, 4]]),
    );
    // Second fetch: SSH died, error surface with count=0 — must NOT overwrite.
    vi.mocked(countIdentityBounties).mockResolvedValueOnce(
      response([["tina", null, 0, "ssh dead"]]),
    );

    const { result, rerender } = renderHook(() => useBountyCount("tina", null));
    await act(async () => {
      await refreshBountyCounts([{ identityKey: "tina", hostId: null }]);
    });
    rerender();
    expect(result.current).toBe(4);

    await act(async () => {
      await refreshBountyCounts([{ identityKey: "tina", hostId: null }]);
    });
    rerender();
    // Last-known 4 preserved, NOT overwritten to 0.
    expect(result.current).toBe(4);
  });
});
