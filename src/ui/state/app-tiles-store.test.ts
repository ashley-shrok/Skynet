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
  readAppTilesCache,
  markPendingAppArchive,
  clearPendingAppArchive,
  PENDING_APP_ARCHIVE_TTL_MS,
  setPendingAppTitle,
  clearPendingAppTitle,
  __resetForTest,
  __seedFromCacheForTest,
} from "./app-tiles-store.js";

import type { AppState } from "../api/fleet-status-types.js";

// Cross-user leak fix: bumped v1 → v2 for owner-tag wrapper.
const APP_TILES_CACHE_KEY = "skynet:app-tiles-cache:v2";
const TEST_USERNAME = "test-user";

function seedAuth(username: string = TEST_USERNAME): void {
  localStorage.setItem(
    "skynet_auth",
    JSON.stringify({ loggedIn: true, username }),
  );
}

function wrap<T>(payload: T, owner: string = TEST_USERNAME): string {
  return JSON.stringify({ owner, payload });
}

beforeEach(() => {
  localStorage.clear();
  seedAuth();
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

// ─────────────────────────────────────────────────────────────────────────────
// Test L — localStorage cache: cold-boot seed paints tiles before WS frame
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test L — cold-boot cache seed (D-17 reversed)", () => {
  it("__seedFromCacheForTest populates the map from localStorage", () => {
    // Seed localStorage directly to simulate a pre-existing cache from a
    // prior tab session, then re-run the module-load seed.
    const seedApps: AppState[] = [
      {
        hostId: "1",
        slug: "alpha",
        title: "Alpha",
        description: "A",
        port: null,
        hasIcon: false,
        createdAtMs: 1_726_000_000_000,
        isHealthy: true,
        healthMessage: null,
      },
      {
        hostId: "2",
        slug: "bravo",
        title: "Bravo",
        description: "B",
        port: 8080,
        hasIcon: true,
        createdAtMs: 1_726_000_000_001,
        isHealthy: false,
        healthMessage: "unit stopped",
      },
    ];
    localStorage.setItem(APP_TILES_CACHE_KEY, wrap(seedApps));

    const { result, rerender } = renderHook(() => useAppTiles());
    act(() => {
      __seedFromCacheForTest();
    });
    rerender();

    expect(result.current).toHaveLength(2);
    expect(result.current.map((a) => a.title)).toEqual(["Alpha", "Bravo"]);
    expect(result.current[1].healthMessage).toBe("unit stopped");
  });

  it("malformed cache falls back to empty (silent by contract)", () => {
    localStorage.setItem(APP_TILES_CACHE_KEY, "{not valid json");
    const { result, rerender } = renderHook(() => useAppTiles());
    act(() => {
      __seedFromCacheForTest();
    });
    rerender();
    expect(result.current).toEqual([]);
  });

  it("cache with wrong-shape entries drops them and keeps valid ones", () => {
    localStorage.setItem(
      APP_TILES_CACHE_KEY,
      wrap([
        { hostId: 1, slug: "alpha", title: "Alpha" }, // hostId is number, not string — invalid
        {
          hostId: "2",
          slug: "bravo",
          title: "Bravo",
          description: "B",
          port: null,
          hasIcon: false,
          createdAtMs: 1_726_000_000_000,
          isHealthy: true,
          healthMessage: null,
        },
      ]),
    );
    const { result, rerender } = renderHook(() => useAppTiles());
    act(() => {
      __seedFromCacheForTest();
    });
    rerender();
    expect(result.current).toHaveLength(1);
    expect(result.current[0].title).toBe("Bravo");
  });

  it("owner-mismatch cache yields empty tiles (cross-user leak fix)", () => {
    const seedApps: AppState[] = [
      {
        hostId: "1",
        slug: "alpha",
        title: "Alpha",
        description: "A",
        port: null,
        hasIcon: false,
        createdAtMs: 1_726_000_000_000,
        isHealthy: true,
        healthMessage: null,
      },
    ];
    localStorage.setItem(
      APP_TILES_CACHE_KEY,
      wrap(seedApps, "someone-else"),
    );
    const { result, rerender } = renderHook(() => useAppTiles());
    act(() => {
      __seedFromCacheForTest();
    });
    rerender();
    // No stale tiles painted. The seed path reads the stale owner-mismatched
    // cache, discards it, then notify() writes the current (empty) state
    // back under the current user's owner tag — so the key exists but holds
    // an empty payload keyed to the test user, not "someone-else"'s tiles.
    expect(result.current).toEqual([]);
    const raw = localStorage.getItem(APP_TILES_CACHE_KEY);
    expect(raw).not.toBeNull();
    const w = JSON.parse(raw as string) as { owner: string; payload: unknown[] };
    expect(w.owner).toBe(TEST_USERNAME);
    expect(w.payload).toEqual([]);
  });

  it("legacy un-tagged cache (pre-v2) yields empty tiles (no cross-version leak)", () => {
    const seedApps: AppState[] = [
      {
        hostId: "1",
        slug: "alpha",
        title: "Alpha",
        description: "A",
        port: null,
        hasIcon: false,
        createdAtMs: 1_726_000_000_000,
        isHealthy: true,
        healthMessage: null,
      },
    ];
    localStorage.setItem(APP_TILES_CACHE_KEY, JSON.stringify(seedApps));
    const { result, rerender } = renderHook(() => useAppTiles());
    act(() => {
      __seedFromCacheForTest();
    });
    rerender();
    expect(result.current).toEqual([]);
    // Same post-condition shape as the owner-mismatch case: current user's
    // empty payload replaces the legacy un-tagged array.
    const raw = localStorage.getItem(APP_TILES_CACHE_KEY);
    expect(raw).not.toBeNull();
    const w = JSON.parse(raw as string) as { owner: string; payload: unknown[] };
    expect(w.owner).toBe(TEST_USERNAME);
    expect(w.payload).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test M — cache is written on every notify() so next cold boot is fresh
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test M — cache write on notify (single-authority)", () => {
  it("publishAppSnapshot writes canonical tiles to localStorage", () => {
    act(() => {
      publishAppSnapshot([
        {
          hostId: "1",
          slug: "alpha",
          title: "Alpha",
          description: "A",
          port: null,
          hasIcon: false,
          createdAtMs: 1_726_000_000_000,
          isHealthy: true,
          healthMessage: null,
        },
      ]);
    });
    const cached = readAppTilesCache();
    expect(cached).toHaveLength(1);
    expect(cached[0].slug).toBe("alpha");
  });

  it("publishAppUpdate then publishAppGone leaves cache in sync with state", () => {
    act(() => {
      publishAppSnapshot([
        {
          hostId: "1",
          slug: "alpha",
          title: "Alpha",
          description: "A",
          port: null,
          hasIcon: false,
          createdAtMs: 1_726_000_000_000,
          isHealthy: true,
          healthMessage: null,
        },
      ]);
    });
    act(() => {
      publishAppUpdate({
        hostId: "1",
        slug: "bravo",
        title: "Bravo",
        description: "B",
        port: null,
        hasIcon: false,
        createdAtMs: 1_726_000_000_001,
        isHealthy: true,
        healthMessage: null,
      });
    });
    expect(readAppTilesCache()).toHaveLength(2);

    act(() => {
      publishAppGone("1", "alpha");
    });
    const cached = readAppTilesCache();
    expect(cached).toHaveLength(1);
    expect(cached[0].slug).toBe("bravo");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test N — __resetForTest clears localStorage cache too (test isolation)
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: Test N — __resetForTest clears localStorage cache", () => {
  it("after __resetForTest, __seedFromCacheForTest yields empty", () => {
    // Populate cache via a snapshot.
    act(() => {
      publishAppSnapshot([
        {
          hostId: "1",
          slug: "alpha",
          title: "Alpha",
          description: "A",
          port: null,
          hasIcon: false,
          createdAtMs: 1_726_000_000_000,
          isHealthy: true,
          healthMessage: null,
        },
      ]);
    });
    expect(readAppTilesCache()).toHaveLength(1);

    act(() => {
      __resetForTest();
    });

    // Cache is cleared — seed-from-cache yields nothing.
    expect(readAppTilesCache()).toEqual([]);
    const { result } = renderHook(() => useAppTiles());
    expect(result.current).toEqual([]);
  });
});

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

// ─────────────────────────────────────────────────────────────────────────────
// Pending-archive filter: AppTile's Archive click marks an app pending-
// archive, then publishes gone. The app keeps appearing in the backend's
// fleet-status app frames (update + snapshot) until the supervisor's sweep
// tick moves the folder (~15s). During that window the filter must silent-
// drop the entry from BOTH publishAppUpdate (per-frame update path) and
// publishAppSnapshot (subscribe-on-connect / bulk snapshot path).
// ─────────────────────────────────────────────────────────────────────────────
describe("app-tiles-store: pending-archive filter", () => {
  it("publishAppUpdate is a silent no-op when (hostId, slug) is marked pending-archive", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    markPendingAppArchive("7", "phantom");
    act(() => {
      publishAppUpdate(
        makeApp({ hostId: "7", slug: "phantom", title: "Phantom" }),
      );
    });
    rerender();

    expect(result.current).toHaveLength(0);

    clearPendingAppArchive("7", "phantom");
  });

  it("publishAppSnapshot filters out pending-archive entries from the incoming list", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    markPendingAppArchive("2", "archived-soon");
    act(() => {
      publishAppSnapshot([
        makeApp({ hostId: "1", slug: "keeper", title: "Keeper" }),
        makeApp({ hostId: "2", slug: "archived-soon", title: "Archived" }),
      ]);
    });
    rerender();

    expect(result.current).toHaveLength(1);
    expect(result.current[0].slug).toBe("keeper");

    clearPendingAppArchive("2", "archived-soon");
  });

  it("clearPendingAppArchive re-opens the door — subsequent update lands normally (rollback path)", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    markPendingAppArchive("3", "rollback-me");

    // First update: silent-dropped.
    act(() => {
      publishAppUpdate(
        makeApp({ hostId: "3", slug: "rollback-me", title: "Rollback" }),
      );
    });
    rerender();
    expect(result.current).toHaveLength(0);

    // Simulated archive-failure rollback.
    clearPendingAppArchive("3", "rollback-me");

    // Second update: lands as normal — this is what makes the tile come back
    // on the next fleet-status pulse after AppTile's catch clause fires.
    act(() => {
      publishAppUpdate(
        makeApp({ hostId: "3", slug: "rollback-me", title: "Rollback" }),
      );
    });
    rerender();
    expect(result.current).toHaveLength(1);
    expect(result.current[0].slug).toBe("rollback-me");
  });

  it("pending-archive filter is per-(hostId,slug) — siblings are unaffected", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    // Two apps sharing a slug across hosts (Pitfall 6 shape from the sort
    // tiebreak). Marking one pending must not shadow the other.
    markPendingAppArchive("1", "same-slug");
    act(() => {
      publishAppSnapshot([
        makeApp({ hostId: "1", slug: "same-slug", title: "One" }),
        makeApp({ hostId: "2", slug: "same-slug", title: "Two" }),
      ]);
    });
    rerender();

    expect(result.current).toHaveLength(1);
    expect(result.current[0].hostId).toBe("2");

    clearPendingAppArchive("1", "same-slug");
  });

  it("a snapshot without the pending app releases the mark — a later un-archive re-surfaces the tile", () => {
    const { result, rerender } = renderHook(() => useAppTiles());

    markPendingAppArchive("4", "restored");
    // Supervisor moved the folder: the next full snapshot no longer carries it.
    act(() => {
      publishAppSnapshot([makeApp({ hostId: "1", slug: "keeper", title: "Keeper" })]);
    });
    // Un-archive: reconciler restores it and the sweep re-publishes it.
    act(() => {
      publishAppUpdate(makeApp({ hostId: "4", slug: "restored", title: "Restored" }));
    });
    rerender();

    expect(result.current.map((a) => a.slug).sort()).toEqual(["keeper", "restored"]);
  });

  it("pending-archive mark expires after PENDING_APP_ARCHIVE_TTL_MS (supervisor-failure backstop)", () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(() => useAppTiles());
      markPendingAppArchive("5", "stuck");

      act(() => {
        publishAppUpdate(makeApp({ hostId: "5", slug: "stuck", title: "Stuck" }));
      });
      rerender();
      expect(result.current).toHaveLength(0);

      vi.advanceTimersByTime(PENDING_APP_ARCHIVE_TTL_MS);
      act(() => {
        publishAppUpdate(makeApp({ hostId: "5", slug: "stuck", title: "Stuck" }));
      });
      rerender();
      expect(result.current).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("__resetForTest clears pending-archive marks", () => {
    markPendingAppArchive("6", "leak");
    __resetForTest();
    const { result, rerender } = renderHook(() => useAppTiles());
    act(() => {
      publishAppUpdate(makeApp({ hostId: "6", slug: "leak", title: "Leak" }));
    });
    rerender();
    expect(result.current).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// app-rename shape — optimistic pending-title overrides
// ─────────────────────────────────────────────────────────────────────────────

describe("app-tiles-store: pending-title overrides (app-rename shape)", () => {
  function titles(): string[] {
    const { result } = renderHook(() => useAppTiles());
    return result.current.map((a) => a.title);
  }

  it("setPendingAppTitle retitles the tile immediately and re-sorts", () => {
    publishAppSnapshot([
      makeApp({ slug: "a", title: "Alpha" }),
      makeApp({ slug: "b", title: "Beta" }),
    ]);
    act(() => setPendingAppTitle("1", "a", "Zulu"));
    expect(titles()).toEqual(["Beta", "Zulu"]);
  });

  it("stale app-update / app-snapshot frames keep the override until the new title arrives", () => {
    publishAppSnapshot([makeApp({ slug: "a", title: "Alpha" })]);
    setPendingAppTitle("1", "a", "Renamed");

    publishAppUpdate(makeApp({ slug: "a", title: "Alpha", isHealthy: false }));
    const { result } = renderHook(() => useAppTiles());
    expect(result.current[0].title).toBe("Renamed");
    // Non-title fields from the frame still land.
    expect(result.current[0].isHealthy).toBe(false);

    act(() => publishAppSnapshot([makeApp({ slug: "a", title: "Alpha" })]));
    expect(result.current[0].title).toBe("Renamed");

    // Sweep catches up → override clears itself...
    act(() => publishAppUpdate(makeApp({ slug: "a", title: "Renamed" })));
    expect(result.current[0].title).toBe("Renamed");
    // ...so a later, genuinely different title (e.g. an agent edit) wins.
    act(() => publishAppUpdate(makeApp({ slug: "a", title: "Agent Edit" })));
    expect(result.current[0].title).toBe("Agent Edit");
  });

  it("clearPendingAppTitle restores the previous title and drops the override", () => {
    publishAppSnapshot([makeApp({ slug: "a", title: "Alpha" })]);
    setPendingAppTitle("1", "a", "Renamed");
    act(() => clearPendingAppTitle("1", "a", "Alpha"));
    expect(titles()).toEqual(["Alpha"]);

    publishAppUpdate(makeApp({ slug: "a", title: "Alpha" }));
    expect(titles()).toEqual(["Alpha"]);
  });

  it("clearPendingAppTitle does not clobber a title the backend already replaced", () => {
    publishAppSnapshot([makeApp({ slug: "a", title: "Alpha" })]);
    setPendingAppTitle("1", "a", "Renamed");
    // Sweep caught up before the (late) failure rollback.
    publishAppUpdate(makeApp({ slug: "a", title: "Renamed" }));
    clearPendingAppTitle("1", "a", "Alpha");
    expect(titles()).toEqual(["Renamed"]);
  });

  it("override only touches its own (hostId, slug)", () => {
    publishAppSnapshot([
      makeApp({ hostId: "1", slug: "a", title: "Alpha" }),
      makeApp({ hostId: "2", slug: "a", title: "Alpha" }),
    ]);
    setPendingAppTitle("2", "a", "Other");
    publishAppSnapshot([
      makeApp({ hostId: "1", slug: "a", title: "Alpha" }),
      makeApp({ hostId: "2", slug: "a", title: "Alpha" }),
    ]);
    expect(titles()).toEqual(["Alpha", "Other"]);
  });
});
