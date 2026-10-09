import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const listSkillsMock = vi.fn();
vi.mock("@/api/skills-api", () => ({
  listSkills: (hostId: number) => listSkillsMock(hostId),
}));

let currentUser: string | null = "alice";
vi.mock("@/state/user-scoped-cache", () => ({
  getCurrentUser: () => currentUser,
}));

import {
  __resetSkillActionsStoreForTests,
  getSkillActions,
  refreshSkillActions,
  useSkillActions,
} from "./skill-actions-store";

describe("skill-actions-store", () => {
  beforeEach(() => {
    __resetSkillActionsStoreForTests();
    localStorage.clear();
    listSkillsMock.mockReset();
    currentUser = "alice";
  });

  it("is null (unknown) for a host never fetched", () => {
    expect(getSkillActions(7)).toBeNull();
  });

  it("hook prefetches once per host per app load and returns the sorted list", async () => {
    listSkillsMock.mockResolvedValue([
      { name: "recap", description: "Recap the session." },
      { name: "light-review", description: "Unbiased sub-agent code review" },
    ]);
    const { result, rerender } = renderHook(() => useSkillActions(1, true));
    expect(result.current).toBeNull();
    await waitFor(() =>
      expect(result.current).toEqual([
        { name: "light-review", description: "Unbiased sub-agent code review" },
        { name: "recap", description: "Recap the session." },
      ]),
    );
    rerender();
    const second = renderHook(() => useSkillActions(1, true));
    expect(second.result.current?.map((s) => s.name)).toEqual(["light-review", "recap"]);
    expect(listSkillsMock).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when disabled (relay panes)", () => {
    const { result } = renderHook(() => useSkillActions(1, false));
    expect(result.current).toBeNull();
    expect(listSkillsMock).not.toHaveBeenCalled();
  });

  it("remembers the list across app loads (localStorage) so it is available instantly", async () => {
    listSkillsMock.mockResolvedValue([{ name: "build" }]);
    await refreshSkillActions(3, "prefetch");
    __resetSkillActionsStoreForTests(); // simulate reload: memory gone, storage kept
    expect(getSkillActions(3)).toEqual([{ name: "build" }]);
  });

  it("a failed refresh keeps the remembered list", async () => {
    listSkillsMock.mockResolvedValueOnce([{ name: "build" }]);
    await refreshSkillActions(4, "prefetch");
    listSkillsMock.mockRejectedValueOnce(new Error("SSH connect failed"));
    await refreshSkillActions(4, "menu-open");
    expect(getSkillActions(4)).toEqual([{ name: "build" }]);
  });

  it("a known-empty host is [] (distinct from unknown)", async () => {
    listSkillsMock.mockResolvedValue([]);
    await refreshSkillActions(5, "prefetch");
    expect(getSkillActions(5)).toEqual([]);
  });

  it("concurrent refreshes for one host share a single request", async () => {
    let resolve!: (v: unknown) => void;
    listSkillsMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const a = refreshSkillActions(6, "prefetch");
    const b = refreshSkillActions(6, "menu-open");
    resolve([{ name: "x" }]);
    await Promise.all([a, b]);
    expect(listSkillsMock).toHaveBeenCalledTimes(1);
  });

  it("a background refresh that adds a skill updates subscribers", async () => {
    listSkillsMock.mockResolvedValueOnce([{ name: "build" }]);
    const { result } = renderHook(() => useSkillActions(8, true));
    await waitFor(() => expect(result.current).toEqual([{ name: "build" }]));
    listSkillsMock.mockResolvedValueOnce([{ name: "build" }, { name: "new-one" }]);
    await act(async () => {
      await refreshSkillActions(8, "menu-open");
    });
    expect(result.current?.map((s) => s.name)).toEqual(["build", "new-one"]);
  });

  it("lists are scoped per user", async () => {
    listSkillsMock.mockResolvedValue([{ name: "build" }]);
    await refreshSkillActions(9, "prefetch");
    currentUser = "stacy";
    expect(getSkillActions(9)).toBeNull();
  });
});
