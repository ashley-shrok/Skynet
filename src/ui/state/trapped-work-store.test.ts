// ─── trapped-work-store — Vitest coverage (Phase 104 Plan 02) ────────────────
//
// Exercises the module-scoped useSyncExternalStore store that backs the
// per-identity trapped-work indicator. The store owns:
//   - useTrappedWork(identityKey, hostId) selector (undefined pre-fetch,
//     returns {hasTrappedWork} post-fetch)
//   - refreshTrappedWork(targets) one-shot fetch that applies to the map
//   - startTrappedWorkPoller(getTargets, intervalMs) with 60s + window.focus
//
// The store's only external dependency is probeIdentityTrappedWork from
// @/api/claude-session-api; we mock that module here to feed deterministic
// responses per test.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/api/claude-session-api", () => ({
  probeIdentityTrappedWork: vi.fn(),
}));

import { probeIdentityTrappedWork } from "@/api/claude-session-api";
import {
  useTrappedWork,
  refreshTrappedWork,
  startTrappedWorkPoller,
  __resetTrappedWorkForTest,
} from "./trapped-work-store.js";

type TrappedWorkResponse = {
  type: "identity:trapped-work";
  results: Array<{
    identityKey: string;
    hostId: number | null;
    hasTrappedWork: boolean;
    error?: string;
  }>;
};

function response(
  entries: Array<[string, number | null, boolean, string?]>,
): TrappedWorkResponse {
  return {
    type: "identity:trapped-work",
    results: entries.map(([identityKey, hostId, hasTrappedWork, error]) => ({
      identityKey,
      hostId,
      hasTrappedWork,
      ...(error ? { error } : {}),
    })),
  };
}

beforeEach(() => {
  __resetTrappedWorkForTest();
  vi.mocked(probeIdentityTrappedWork).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Store Tests 1-3 — useTrappedWork pre/post-fetch + null-identityKey short-circuit
// ─────────────────────────────────────────────────────────────────────────────

describe("useTrappedWork round-trip", () => {
  it("Store Test 1 (pre-fetch): renderHook of useTrappedWork returns undefined before any refresh", () => {
    const { result } = renderHook(() => useTrappedWork("tina", null));
    expect(result.current).toBeUndefined();
  });

  it("Store Test 2 (identityKey null short-circuit): renderHook of useTrappedWork(null, null) returns undefined", () => {
    const { result } = renderHook(() => useTrappedWork(null, null));
    expect(result.current).toBeUndefined();
  });

  it("Store Test 3 (post-fetch): after refreshTrappedWork resolves with hasTrappedWork:true, useTrappedWork returns {hasTrappedWork:true}", async () => {
    vi.mocked(probeIdentityTrappedWork).mockResolvedValue(
      response([["tina", null, true]]),
    );

    const { result, rerender } = renderHook(() =>
      useTrappedWork("tina", null),
    );
    expect(result.current).toBeUndefined();

    await act(async () => {
      await refreshTrappedWork([{ identityKey: "tina", hostId: null }]);
    });
    rerender();
    expect(result.current).toEqual({ hasTrappedWork: true });
  });

  it("Store Test 4 (composite-key isolation): same identityKey on different hostIds are independent snapshots", async () => {
    vi.mocked(probeIdentityTrappedWork).mockResolvedValue(
      response([
        ["tina", null, true],
        ["tina", 42, false],
      ]),
    );

    const { result: localResult, rerender: rerenderLocal } = renderHook(() =>
      useTrappedWork("tina", null),
    );
    const { result: remoteResult, rerender: rerenderRemote } = renderHook(() =>
      useTrappedWork("tina", 42),
    );

    await act(async () => {
      await refreshTrappedWork([
        { identityKey: "tina", hostId: null },
        { identityKey: "tina", hostId: 42 },
      ]);
    });
    rerenderLocal();
    rerenderRemote();
    expect(localResult.current).toEqual({ hasTrappedWork: true });
    expect(remoteResult.current).toEqual({ hasTrappedWork: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Store Test 5 — batching: N targets = ONE probeIdentityTrappedWork call
// ─────────────────────────────────────────────────────────────────────────────

describe("refreshTrappedWork batching", () => {
  it("Store Test 5: N targets → exactly one probeIdentityTrappedWork call carrying all N deduped targets", async () => {
    vi.mocked(probeIdentityTrappedWork).mockResolvedValue(
      response([
        ["a", null, true],
        ["b", null, false],
        ["c", 7, true],
      ]),
    );

    await act(async () => {
      await refreshTrappedWork([
        { identityKey: "a", hostId: null },
        { identityKey: "b", hostId: null },
        { identityKey: "c", hostId: 7 },
      ]);
    });

    expect(probeIdentityTrappedWork).toHaveBeenCalledTimes(1);
    expect(vi.mocked(probeIdentityTrappedWork).mock.calls[0][0]).toHaveLength(
      3,
    );

    const { result, rerender } = renderHook(() => useTrappedWork("c", 7));
    rerender();
    expect(result.current).toEqual({ hasTrappedWork: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Store Test 6 — poll interval fires refresh at intervalMs; stop-fn clears it
// ─────────────────────────────────────────────────────────────────────────────

describe("startTrappedWorkPoller cadence", () => {
  it("Store Test 6: fires initial fetch, then again at each intervalMs, and stop() clears the interval", async () => {
    vi.useFakeTimers();
    vi.mocked(probeIdentityTrappedWork).mockResolvedValue(
      response([["tina", null, true]]),
    );

    const getTargets = () => [{ identityKey: "tina", hostId: null }];
    let stop = () => {};
    await act(async () => {
      stop = startTrappedWorkPoller(getTargets, 60_000);
      // Flush the initial fetch's microtask.
      await Promise.resolve();
    });
    expect(probeIdentityTrappedWork).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(probeIdentityTrappedWork).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(probeIdentityTrappedWork).toHaveBeenCalledTimes(3);

    stop();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(probeIdentityTrappedWork).toHaveBeenCalledTimes(3);
  });

  it("Store Test 7 (window.focus): dispatching focus fires an additional probe; stop-fn removes the listener", async () => {
    vi.useFakeTimers();
    vi.mocked(probeIdentityTrappedWork).mockResolvedValue(
      response([["tina", null, true]]),
    );

    const getTargets = () => [{ identityKey: "tina", hostId: null }];
    let stop = () => {};
    await act(async () => {
      stop = startTrappedWorkPoller(getTargets, 60_000);
      await Promise.resolve();
    });
    // Initial fetch.
    expect(probeIdentityTrappedWork).toHaveBeenCalledTimes(1);

    // Focus fires an extra refresh.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(probeIdentityTrappedWork).toHaveBeenCalledTimes(2);

    // stop() removes the listener; subsequent focus events do NOT fire.
    stop();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(probeIdentityTrappedWork).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Store Test 8 — per-target error preserves last-known snapshot
// ─────────────────────────────────────────────────────────────────────────────

describe("per-target error handling", () => {
  it("Store Test 8: a rejected target in the response does NOT overwrite last-known snapshot", async () => {
    // First fetch: healthy, hasTrappedWork=true.
    vi.mocked(probeIdentityTrappedWork).mockResolvedValueOnce(
      response([["tina", null, true]]),
    );
    // Second fetch: SSH died, error surface — must NOT overwrite to false.
    vi.mocked(probeIdentityTrappedWork).mockResolvedValueOnce(
      response([["tina", null, false, "ssh dead"]]),
    );

    const { result, rerender } = renderHook(() => useTrappedWork("tina", null));
    await act(async () => {
      await refreshTrappedWork([{ identityKey: "tina", hostId: null }]);
    });
    rerender();
    expect(result.current).toEqual({ hasTrappedWork: true });

    await act(async () => {
      await refreshTrappedWork([{ identityKey: "tina", hostId: null }]);
    });
    rerender();
    // Last-known preserved, NOT overwritten to false.
    expect(result.current).toEqual({ hasTrappedWork: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Store Test 9 — transport-error resilience: probe rejection is caught
// ─────────────────────────────────────────────────────────────────────────────

describe("transport-error resilience", () => {
  it("Store Test 9: probeIdentityTrappedWork rejection is caught; store does not throw and poller continues on next tick", async () => {
    vi.useFakeTimers();
    // First call rejects; second call resolves.
    vi.mocked(probeIdentityTrappedWork).mockRejectedValueOnce(
      new Error("Connection failed"),
    );
    vi.mocked(probeIdentityTrappedWork).mockResolvedValueOnce(
      response([["tina", null, true]]),
    );

    const getTargets = () => [{ identityKey: "tina", hostId: null }];
    let stop = () => {};
    await act(async () => {
      stop = startTrappedWorkPoller(getTargets, 60_000);
      // Flush initial fetch's microtask (which rejects).
      await Promise.resolve();
    });
    // Initial fetch called; rejected but not thrown.
    expect(probeIdentityTrappedWork).toHaveBeenCalledTimes(1);

    // Advance timer past the interval — second tick fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(probeIdentityTrappedWork).toHaveBeenCalledTimes(2);

    // The second tick's resolved value should now be in the store.
    const { result, rerender } = renderHook(() =>
      useTrappedWork("tina", null),
    );
    rerender();
    expect(result.current).toEqual({ hasTrappedWork: true });

    stop();
  });
});

