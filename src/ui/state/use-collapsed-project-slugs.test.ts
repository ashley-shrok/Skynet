/**
 * Phase 117 Plan 117-07 Task 2: Tests for use-collapsed-project-slugs.ts —
 * localStorage-backed hook tracking per-project collapse state (D-40).
 *
 * localStorage key: "pv-collapsed-project-slugs" (verbatim string; the Wave 4
 * UI code cross-references it for the chevron-toggle handler).
 *
 * Behavior covered (8 tests per plan):
 *   1: Hydrate empty — no stored value → empty Set.
 *   2: Hydrate from valid JSON array — ["alpha","beta"] → Set{alpha,beta}.
 *   3: Hydrate silent on corrupt JSON — "not-json{" → empty Set (no throw).
 *   4: Hydrate silent on non-array — '{"a":1}' → empty Set.
 *   5: Hydrate filters non-string entries — '["a", 42, "b"]' → Set{a,b}.
 *   6: toggle adds a missing slug + persists.
 *   7: toggle removes a present slug + persists.
 *   8: toggle silent on localStorage.setItem throw (in-memory update still fires).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCollapsedProjectSlugs } from "./use-collapsed-project-slugs.js";

const STORAGE_KEY = "pv-collapsed-project-slugs";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ─── Test 1: hydrate empty ───────────────────────────────────────────────────
describe("useCollapsedProjectSlugs — hydrate empty", () => {
  it("Test 1: no stored value → collapsed is empty Set", () => {
    const { result } = renderHook(() => useCollapsedProjectSlugs());
    expect(result.current.collapsed.size).toBe(0);
    expect(typeof result.current.toggle).toBe("function");
  });
});

// ─── Test 2: hydrate from valid stored value ────────────────────────────────
describe("useCollapsedProjectSlugs — hydrate from valid JSON array", () => {
  it("Test 2: localStorage carries [\"alpha\",\"beta\"] → collapsed = {alpha, beta}", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["alpha", "beta"]));
    const { result } = renderHook(() => useCollapsedProjectSlugs());
    expect(result.current.collapsed.has("alpha")).toBe(true);
    expect(result.current.collapsed.has("beta")).toBe(true);
    expect(result.current.collapsed.size).toBe(2);
  });
});

// ─── Test 3: hydrate silent on corrupt JSON ─────────────────────────────────
describe("useCollapsedProjectSlugs — corrupt JSON is silent", () => {
  it("Test 3: unparseable JSON string → collapsed is empty Set (no throw)", () => {
    localStorage.setItem(STORAGE_KEY, "not-json{");
    const { result } = renderHook(() => useCollapsedProjectSlugs());
    expect(result.current.collapsed.size).toBe(0);
  });
});

// ─── Test 4: hydrate silent on non-array ────────────────────────────────────
describe("useCollapsedProjectSlugs — non-array JSON is silent", () => {
  it("Test 4: JSON object → collapsed is empty Set (silent)", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: 1 }));
    const { result } = renderHook(() => useCollapsedProjectSlugs());
    expect(result.current.collapsed.size).toBe(0);
  });
});

// ─── Test 5: hydrate filters non-string entries ─────────────────────────────
describe("useCollapsedProjectSlugs — filters non-string array entries", () => {
  it("Test 5: mixed array [\"a\", 42, \"b\"] → Set{a, b}", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["a", 42, "b"]));
    const { result } = renderHook(() => useCollapsedProjectSlugs());
    expect(result.current.collapsed.has("a")).toBe(true);
    expect(result.current.collapsed.has("b")).toBe(true);
    expect(result.current.collapsed.size).toBe(2);
  });
});

// ─── Test 6: toggle adds slug + persists ────────────────────────────────────
describe("useCollapsedProjectSlugs — toggle adds a slug", () => {
  it("Test 6: initial empty → toggle('alpha') → Set{alpha}; localStorage carries [\"alpha\"]", () => {
    const { result } = renderHook(() => useCollapsedProjectSlugs());
    expect(result.current.collapsed.size).toBe(0);
    act(() => {
      result.current.toggle("alpha");
    });
    expect(result.current.collapsed.has("alpha")).toBe(true);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(["alpha"]);
  });
});

// ─── Test 7: toggle removes slug + persists ─────────────────────────────────
describe("useCollapsedProjectSlugs — toggle removes a slug", () => {
  it("Test 7: initial {alpha} → toggle('alpha') → empty; localStorage carries []", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["alpha"]));
    const { result } = renderHook(() => useCollapsedProjectSlugs());
    expect(result.current.collapsed.has("alpha")).toBe(true);
    act(() => {
      result.current.toggle("alpha");
    });
    expect(result.current.collapsed.has("alpha")).toBe(false);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual([]);
  });
});

// ─── Test 8: toggle silent on localStorage.setItem throw ────────────────────
describe("useCollapsedProjectSlugs — silent on localStorage.setItem throw", () => {
  it("Test 8: setItem throws (quota-exceeded) → toggle does NOT throw; in-memory state still updates", () => {
    // Spy on Storage.prototype.setItem to make it throw.
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    const { result } = renderHook(() => useCollapsedProjectSlugs());
    expect(() => {
      act(() => {
        result.current.toggle("alpha");
      });
    }).not.toThrow();
    // In-memory state still updates even though persistence failed.
    expect(result.current.collapsed.has("alpha")).toBe(true);
    // setItem was called at least once (proof the persist path attempted).
    expect(setItemSpy).toHaveBeenCalled();
  });
});
