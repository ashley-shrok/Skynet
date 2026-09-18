// ─── app-tiles-store — Vitest coverage (Phase 119 Plan 119-02, Task 1) ───────
// Tests for the standalone client-side subscription slice that consumes the
// three Phase 119-01 app frames (app-snapshot / app-update / app-gone) and
// exposes a sorted `useAppTiles()` reader hook.
//
// Coverage per PLAN.md 119-02 <behavior> list:
//   A. useAppTiles() returns [] initially (empty map — D-17)
//   B. publishAppSnapshot([...]) populates the map and returns sorted by title (D-14 + D-15)
//   C. publishAppSnapshot([...]) REPLACES the map — prior tiles gone (D-14 snapshot-as-full-list)
//   D. publishAppUpdate(existingKey) upserts — no dup, isHealthy/title mutations reflect
//   E. publishAppUpdate(newKey) inserts a new key
//   F. publishAppGone(hostId, slug) removes existing key
//   G. publishAppGone on absent key is a no-op (does not throw)
//   H. Sort tiebreak stability — same title on different hosts keeps stable order across app-update (Pitfall 6)
//   I. Sort is locale-aware case-insensitive — "apple" < "Banana" < "cherry" (base sensitivity)
//   J. subscribe() returns a disposer that removes the listener from the set
//   K. __resetForTest() clears state and notifies
//
// Pattern mirrors src/ui/state/session-working-store.test.ts — vitest +
// @testing-library/react's renderHook; module-scope state reset via a
// __resetForTest() helper in beforeEach.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  publishAppSnapshot,
  publishAppUpdate,
  publishAppGone,
  useAppTiles,
  subscribeAppTilesStore,
  __resetForTest,
} from "./app-tiles-store.js";

import type { AppState } from "../api/fleet-status-types.js";

beforeEach(() => {
  __resetForTest();
});

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeApp(overrides: Partial<AppState> = {}): AppState {
  return {
    hostId: "1",
    slug: "example",
    title: "Example",
    description: "An example app",
    port: null,
    hasIcon: false,
    createdAtMs: 1_726_000_000_000,
    isHealthy: true,
    healthMessage: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test A — useAppTiles() returns [] initially
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test A — empty map on cold start (D-17)", () => {
  it("useAppTiles returns [] when no frames have arrived", () => {
    const { result } = renderHook(() => useAppTiles());
    expect(result.current).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test B — publishAppSnapshot populates + sorted
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test B — publishAppSnapshot populates and sorts by title (D-14 + D-15)", () => {
  it("publishAppSnapshot with three tiles → useAppTiles returns them sorted case-insensitively", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    act(() => {
      publishAppSnapshot([
        makeApp({ hostId: "1", slug: "charlie", title: "Charlie" }),
        makeApp({ hostId: "1", slug: "alpha", title: "alpha" }),
        makeApp({ hostId: "1", slug: "bravo", title: "Bravo" }),
      ]);
    });
    rerender();

    expect(result.current.map((a) => a.title)).toEqual([
      "alpha",
      "Bravo",
      "Charlie",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test C — publishAppSnapshot REPLACES the map (not merge)
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test C — publishAppSnapshot REPLACES prior map contents (D-14)", () => {
  it("publishAppSnapshot after prior snapshot drops tiles not in the new list", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    act(() => {
      publishAppSnapshot([
        makeApp({ hostId: "1", slug: "alpha", title: "Alpha" }),
        makeApp({ hostId: "1", slug: "bravo", title: "Bravo" }),
        makeApp({ hostId: "1", slug: "charlie", title: "Charlie" }),
      ]);
    });
    rerender();
    expect(result.current).toHaveLength(3);

    act(() => {
      // Second snapshot: only alpha + bravo, charlie must disappear.
      publishAppSnapshot([
        makeApp({ hostId: "1", slug: "alpha", title: "Alpha" }),
        makeApp({ hostId: "1", slug: "bravo", title: "Bravo" }),
      ]);
    });
    rerender();

    const titles = result.current.map((a) => a.title);
    expect(titles).toEqual(["Alpha", "Bravo"]);
    expect(titles).not.toContain("Charlie");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test D — publishAppUpdate upserts an existing key
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test D — publishAppUpdate upserts an existing key", () => {
  it("publishAppUpdate on existing ${hostId}:${slug} mutates isHealthy + title without duplication", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    act(() => {
      publishAppSnapshot([
        makeApp({
          hostId: "1",
          slug: "weather",
          title: "Weather",
          isHealthy: true,
        }),
      ]);
    });
    rerender();
    expect(result.current).toHaveLength(1);
    expect(result.current[0].isHealthy).toBe(true);

    act(() => {
      publishAppUpdate(
        makeApp({
          hostId: "1",
          slug: "weather",
          title: "Weather",
          isHealthy: false,
          healthMessage: "unit stopped",
        }),
      );
    });
    rerender();

    expect(result.current).toHaveLength(1);
    expect(result.current[0].isHealthy).toBe(false);
    expect(result.current[0].healthMessage).toBe("unit stopped");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test E — publishAppUpdate inserts a new key
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test E — publishAppUpdate inserts a new key", () => {
  it("publishAppUpdate with never-seen key adds a tile to the sorted list", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    act(() => {
      publishAppSnapshot([
        makeApp({ hostId: "1", slug: "alpha", title: "Alpha" }),
      ]);
    });
    rerender();
    expect(result.current).toHaveLength(1);

    act(() => {
      publishAppUpdate(
        makeApp({ hostId: "1", slug: "bravo", title: "Bravo" }),
      );
    });
    rerender();

    expect(result.current).toHaveLength(2);
    expect(result.current.map((a) => a.slug)).toEqual(["alpha", "bravo"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test F — publishAppGone removes an existing key
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test F — publishAppGone removes an existing key", () => {
  it("publishAppGone(hostId, slug) drops the matching tile", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    act(() => {
      publishAppSnapshot([
        makeApp({ hostId: "1", slug: "alpha", title: "Alpha" }),
        makeApp({ hostId: "1", slug: "bravo", title: "Bravo" }),
      ]);
    });
    rerender();
    expect(result.current).toHaveLength(2);

    act(() => {
      publishAppGone("1", "alpha");
    });
    rerender();

    expect(result.current).toHaveLength(1);
    expect(result.current[0].slug).toBe("bravo");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test G — publishAppGone on absent key is a no-op (no throw)
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test G — publishAppGone on absent key is a no-op", () => {
  it("publishAppGone with unknown hostId/slug does not throw and does not notify", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    act(() => {
      publishAppSnapshot([
        makeApp({ hostId: "1", slug: "alpha", title: "Alpha" }),
      ]);
    });
    rerender();

    // Attach a listener to observe notify behavior — subscribeAppTilesStore
    // is the public subscribe primitive (also used by React under the hood).
    const listener = vi.fn();
    const dispose = subscribeAppTilesStore(listener);

    expect(() => {
      act(() => {
        publishAppGone("999", "does-not-exist");
      });
    }).not.toThrow();

    // No notify should have fired because nothing changed.
    expect(listener).not.toHaveBeenCalled();

    dispose();
    rerender();
    expect(result.current).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test H — sort tiebreak stability (Pitfall 6 regression)
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test H — same-title tiles on different hosts stay stably ordered across app-update (Pitfall 6)", () => {
  it("host-1 Weather stays at index 0 and host-2 Weather stays at index 1 after updating host-2 Weather", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    act(() => {
      publishAppSnapshot([
        makeApp({ hostId: "1", slug: "weather", title: "Weather" }),
        makeApp({ hostId: "2", slug: "weather", title: "Weather" }),
      ]);
    });
    rerender();

    expect(result.current).toHaveLength(2);
    expect(result.current[0].hostId).toBe("1");
    expect(result.current[1].hostId).toBe("2");

    act(() => {
      publishAppUpdate(
        makeApp({
          hostId: "2",
          slug: "weather",
          title: "Weather",
          isHealthy: false,
          healthMessage: "flipped",
        }),
      );
    });
    rerender();

    expect(result.current).toHaveLength(2);
    // Order MUST be unchanged — Pitfall 6 mitigation via `${hostId}:${slug}` tiebreak.
    expect(result.current[0].hostId).toBe("1");
    expect(result.current[1].hostId).toBe("2");
    expect(result.current[1].isHealthy).toBe(false);
    expect(result.current[1].healthMessage).toBe("flipped");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test I — sort is locale-aware case-insensitive
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test I — sort is locale-aware case-insensitive (D-15 base sensitivity)", () => {
  it("'apple' < 'Banana' < 'cherry' regardless of case", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    act(() => {
      publishAppSnapshot([
        makeApp({ hostId: "1", slug: "cherry", title: "cherry" }),
        makeApp({ hostId: "1", slug: "banana", title: "Banana" }),
        makeApp({ hostId: "1", slug: "apple", title: "apple" }),
      ]);
    });
    rerender();

    expect(result.current.map((a) => a.title)).toEqual([
      "apple",
      "Banana",
      "cherry",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test J — subscribe() disposer removes listener from the set
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test J — subscribe disposer removes the listener", () => {
  it("after dispose, subsequent publishes do NOT call the listener", () => {
    const listener = vi.fn();
    const dispose = subscribeAppTilesStore(listener);

    act(() => {
      publishAppUpdate(
        makeApp({ hostId: "1", slug: "alpha", title: "Alpha" }),
      );
    });
    expect(listener).toHaveBeenCalledTimes(1);

    dispose();

    act(() => {
      publishAppUpdate(
        makeApp({ hostId: "1", slug: "bravo", title: "Bravo" }),
      );
    });
    // Still 1 — disposer worked, no additional invocations.
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test K — __resetForTest clears state and notifies
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test K — __resetForTest clears state and notifies", () => {
  it("populated store → __resetForTest → useAppTiles returns [] and listener was notified", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    act(() => {
      publishAppSnapshot([
        makeApp({ hostId: "1", slug: "alpha", title: "Alpha" }),
        makeApp({ hostId: "1", slug: "bravo", title: "Bravo" }),
      ]);
    });
    rerender();
    expect(result.current).toHaveLength(2);

    const listener = vi.fn();
    const dispose = subscribeAppTilesStore(listener);

    act(() => {
      __resetForTest();
    });
    rerender();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([]);

    dispose();
  });
});
