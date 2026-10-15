import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectsSectionCollapsed } from "./use-projects-section-collapsed.js";

const STORAGE_KEY = "pv-projects-section-collapsed";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("useProjectsSectionCollapsed", () => {
  it("defaults to expanded with nothing stored", () => {
    const { result } = renderHook(() => useProjectsSectionCollapsed());
    expect(result.current.collapsed).toBe(false);
  });

  it("hydrates collapsed from storage", () => {
    localStorage.setItem(STORAGE_KEY, "1");
    const { result } = renderHook(() => useProjectsSectionCollapsed());
    expect(result.current.collapsed).toBe(true);
  });

  it("toggle flips state and persists both directions", () => {
    const { result } = renderHook(() => useProjectsSectionCollapsed());
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("toggle still updates in memory when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { result } = renderHook(() => useProjectsSectionCollapsed());
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
  });
});
