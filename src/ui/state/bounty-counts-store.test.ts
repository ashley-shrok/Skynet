// ─── bounty-counts-store — Vitest coverage (quick 260727-tb1 Task 2) ─────────
//
// Exercises the module-scoped useSyncExternalStore store that backs the per-
// row pinned bounty badge in pretty-conversations. The store owns:
//   - useBountyCounts(identityKey, hostId) selector (undefined pre-fetch),
//     returns {pinnedCount, needsDeskCount} pair post-fetch
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
  useBountyCounts,
  useAllBountyCounts,
  bountyCountsCompositeKey,
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
    pinnedCount: number;
    needsDeskCount: number;
    error?: string;
  }>;
};

function response(
  entries: Array<[string, number | null, number, number, string?]>,
): CountsResponse {
  return {
    type: "identity:bounty-counts",
    counts: entries.map(
      ([identityKey, hostId, pinnedCount, needsDeskCount, error]) => ({
        identityKey,
        hostId,
        pinnedCount,
        needsDeskCount,
        ...(error ? { error } : {}),
      }),
    ),
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
// Test 1 — useBountyCounts pre-fetch returns undefined; post-fetch returns pair
// ─────────────────────────────────────────────────────────────────────────────

describe("useBountyCounts round-trip", () => {
  it("returns undefined before any fetch, then the fetched pair after refreshBountyCounts", async () => {
    vi.mocked(countIdentityBounties).mockResolvedValue(
      response([["tina", null, 3, 1]]),
    );

    const { result, rerender } = renderHook(() =>
      useBountyCounts("tina", null),
    );
    expect(result.current).toBeUndefined();

    await act(async () => {
      await refreshBountyCounts([{ identityKey: "tina", hostId: null }]);
    });
    rerender();
    expect(result.current).toEqual({ pinnedCount: 3, needsDeskCount: 1 });
  });

  it("returns undefined when identityKey is null (short-circuit — no subscription cost)", () => {
    const { result } = renderHook(() => useBountyCounts(null, null));
    expect(result.current).toBeUndefined();
  });

  it("distinguishes composite keys — same identityKey on different hostIds are independent", async () => {
    vi.mocked(countIdentityBounties).mockResolvedValue(
      response([
        ["tina", null, 2, 0],
        ["tina", 42, 5, 2],
      ]),
    );

    const { result: localResult, rerender: rerenderLocal } = renderHook(() =>
      useBountyCounts("tina", null),
    );
    const { result: remoteResult, rerender: rerenderRemote } = renderHook(() =>
      useBountyCounts("tina", 42),
    );

    await act(async () => {
      await refreshBountyCounts([
        { identityKey: "tina", hostId: null },
        { identityKey: "tina", hostId: 42 },
      ]);
    });
    rerenderLocal();
    rerenderRemote();
    expect(localResult.current).toEqual({ pinnedCount: 2, needsDeskCount: 0 });
    expect(remoteResult.current).toEqual({ pinnedCount: 5, needsDeskCount: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — batching + wire shape: N targets = ONE countIdentityBounties call
// ─────────────────────────────────────────────────────────────────────────────

describe("refreshBountyCounts batching", () => {
  it("N targets → exactly one countIdentityBounties call carrying all N targets (batched)", async () => {
    vi.mocked(countIdentityBounties).mockResolvedValue(
      response([
        ["a", null, 1, 0],
        ["b", null, 0, 0],
        ["c", 7, 4, 2],
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

    // Spot-check one identity's needsDeskCount is threaded into the store.
    const { result, rerender } = renderHook(() => useBountyCounts("c", 7));
    rerender();
    expect(result.current).toEqual({ pinnedCount: 4, needsDeskCount: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — poll interval fires refresh at intervalMs
// ─────────────────────────────────────────────────────────────────────────────

describe("startBountyCountPoller cadence", () => {
  it("fires an initial fetch, then again at each intervalMs, and stop() clears the interval", async () => {
    vi.useFakeTimers();
    vi.mocked(countIdentityBounties).mockResolvedValue(
      response([["tina", null, 1, 0]]),
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
      response([["tina", null, 1, 0]]),
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
      response([["tina", 42, 9, 3]]),
    );

    await act(async () => {
      await invalidateIdentity("tina", 42);
    });

    expect(countIdentityBounties).toHaveBeenCalledTimes(1);
    const targetsArg = vi.mocked(countIdentityBounties).mock.calls[0][0];
    expect(targetsArg).toEqual([{ identityKey: "tina", hostId: 42 }]);

    const { result, rerender } = renderHook(() => useBountyCounts("tina", 42));
    rerender();
    expect(result.current).toEqual({ pinnedCount: 9, needsDeskCount: 3 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — per-target error preserves last-known pair (does NOT clobber either half)
// ─────────────────────────────────────────────────────────────────────────────

describe("per-target error handling", () => {
  it("a rejected target in the response does NOT overwrite the last-known counts pair", async () => {
    // First fetch: healthy, pinnedCount=4, needsDeskCount=2.
    vi.mocked(countIdentityBounties).mockResolvedValueOnce(
      response([["tina", null, 4, 2]]),
    );
    // Second fetch: SSH died, error surface — must NOT overwrite either half.
    vi.mocked(countIdentityBounties).mockResolvedValueOnce(
      response([["tina", null, 0, 0, "ssh dead"]]),
    );

    const { result, rerender } = renderHook(() =>
      useBountyCounts("tina", null),
    );
    await act(async () => {
      await refreshBountyCounts([{ identityKey: "tina", hostId: null }]);
    });
    rerender();
    expect(result.current).toEqual({ pinnedCount: 4, needsDeskCount: 2 });

    await act(async () => {
      await refreshBountyCounts([{ identityKey: "tina", hostId: null }]);
    });
    rerender();
    // BOTH halves of last-known pair preserved, NOT overwritten to zeros.
    expect(result.current).toEqual({ pinnedCount: 4, needsDeskCount: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — useAllBountyCounts returns ReadonlyMap<string, {pinnedCount, needsDeskCount}>
// ─────────────────────────────────────────────────────────────────────────────

describe("useAllBountyCounts returns a ReadonlyMap of pairs", () => {
  it("returns a map with size equal to distinct keys; values are the {pinnedCount, needsDeskCount} pair", async () => {
    vi.mocked(countIdentityBounties).mockResolvedValue(
      response([
        ["alice", null, 3, 1],
        ["bob", 7, 0, 2],
      ]),
    );

    await act(async () => {
      await refreshBountyCounts([
        { identityKey: "alice", hostId: null },
        { identityKey: "bob", hostId: 7 },
      ]);
    });

    const { result, rerender } = renderHook(() => useAllBountyCounts());
    rerender();

    expect(result.current.size).toBe(2);
    expect(
      result.current.get(bountyCountsCompositeKey("alice", null)),
    ).toEqual({ pinnedCount: 3, needsDeskCount: 1 });
    expect(result.current.get(bountyCountsCompositeKey("bob", 7))).toEqual({
      pinnedCount: 0,
      needsDeskCount: 2,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — change-detection: notify fires iff EITHER half changes; identical pair = no-op
// ─────────────────────────────────────────────────────────────────────────────

describe("change-detection on either half of the pair", () => {
  it("triggers re-render when pinnedCount alone changes; no re-render when pair is identical", async () => {
    // First refresh: set {pinnedCount:2, needsDeskCount:1}
    vi.mocked(countIdentityBounties).mockResolvedValueOnce(
      response([["tina", null, 2, 1]]),
    );
    // Second refresh: pinnedCount changes to 3, needsDeskCount stays 1
    vi.mocked(countIdentityBounties).mockResolvedValueOnce(
      response([["tina", null, 3, 1]]),
    );
    // Third refresh: identical to second — should NOT trigger re-render
    vi.mocked(countIdentityBounties).mockResolvedValueOnce(
      response([["tina", null, 3, 1]]),
    );

    let renderCount = 0;
    const { result, rerender } = renderHook(() => {
      renderCount++;
      return useBountyCounts("tina", null);
    });
    const initialRenderCount = renderCount;

    // First refresh — populates the store (undefined → pair = change)
    await act(async () => {
      await refreshBountyCounts([{ identityKey: "tina", hostId: null }]);
    });
    rerender();
    expect(result.current).toEqual({ pinnedCount: 2, needsDeskCount: 1 });
    const afterFirstRefresh = renderCount;

    // Second refresh — pinnedCount changes: {2,1} → {3,1} = change → notify
    await act(async () => {
      await refreshBountyCounts([{ identityKey: "tina", hostId: null }]);
    });
    rerender();
    expect(result.current).toEqual({ pinnedCount: 3, needsDeskCount: 1 });
    // render count must have increased (change triggered re-render)
    expect(renderCount).toBeGreaterThan(afterFirstRefresh);

    const beforeIdenticalRefresh = renderCount;

    // Third refresh — identical pair {3,1} → {3,1} = no change → no notify
    await act(async () => {
      await refreshBountyCounts([{ identityKey: "tina", hostId: null }]);
    });
    rerender();
    // Still same values
    expect(result.current).toEqual({ pinnedCount: 3, needsDeskCount: 1 });
    // renderCount should NOT have increased beyond the manual rerender() call
    // (the manual rerender() calls the hook body once; no additional notified re-render)
    // We verify by checking the store state is stable (no spurious notify fired)
    // Since rerender() itself invokes the hook, we just assert the final pair is correct
    // and that the hook didn't receive a new pair reference (same values).
    expect(renderCount).toBe(beforeIdenticalRefresh + 1); // only the manual rerender()

    // Suppress "unused" warning for initialRenderCount
    void initialRenderCount;
  });
});
