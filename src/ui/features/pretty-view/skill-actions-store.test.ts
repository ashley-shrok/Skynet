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
  settleSkillActions,
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

  it("a fresh refresh (after a skill change) waits out a request already running and asks again", async () => {
    let releaseFirst!: (v: unknown) => void;
    listSkillsMock
      .mockImplementationOnce(() => new Promise((r) => (releaseFirst = r)))
      .mockResolvedValueOnce([{ name: "deploy" }, { name: "recap" }]);
    const first = refreshSkillActions(4, "menu-open");
    const fresh = refreshSkillActions(4, "new-skill", { fresh: true });
    expect(listSkillsMock).toHaveBeenCalledTimes(1);
    // The early request answers with the list from before the skill existed.
    releaseFirst([{ name: "recap" }]);
    await first;
    await fresh;
    expect(listSkillsMock).toHaveBeenCalledTimes(2);
    expect(getSkillActions(4)?.map((s) => s.name)).toEqual(["deploy", "recap"]);
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
    currentUser = "quinn";
    expect(getSkillActions(9)).toBeNull();
  });

  it("leaves out agent-only skills (userInvocable false)", async () => {
    listSkillsMock.mockResolvedValue([
      { name: "build", description: "Builds" },
      { name: "campaign", description: "Arc", userInvocable: false },
    ]);
    await refreshSkillActions(3, "prefetch");
    expect(getSkillActions(3)).toEqual([{ name: "build", description: "Builds" }]);
  });

  it("settle re-checks until a switched-off shared skill leaves the host's list", async () => {
    // The host still has the old copy on the first two looks (sync pass not done).
    listSkillsMock
      .mockResolvedValueOnce([{ name: "close" }, { name: "open" }])
      .mockResolvedValueOnce([{ name: "close" }, { name: "open" }])
      .mockResolvedValue([{ name: "close", userInvocable: false }, { name: "open" }]);
    await expect(settleSkillActions(6, "close", false, [0, 0, 0])).resolves.toBe(true);
    expect(getSkillActions(6)?.map((s) => s.name)).toEqual(["open"]);
    expect(listSkillsMock).toHaveBeenCalledTimes(3);
  });

  it("settle stops at once when the first look already shows the change", async () => {
    listSkillsMock.mockResolvedValue([{ name: "open" }]);
    await expect(settleSkillActions(6, "open", true, [0, 0])).resolves.toBe(true);
    expect(listSkillsMock).toHaveBeenCalledTimes(1);
  });

  it("settle gives up after its retries, keeping the last list", async () => {
    listSkillsMock.mockResolvedValue([{ name: "close" }]);
    await expect(settleSkillActions(6, "close", false, [0, 0])).resolves.toBe(false);
    expect(listSkillsMock).toHaveBeenCalledTimes(3);
    expect(getSkillActions(6)?.map((s) => s.name)).toEqual(["close"]);
  });

  it("coming back to the page refreshes a list last fetched over a minute ago", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      listSkillsMock.mockResolvedValue([{ name: "build" }, { name: "close" }]);
      const { result } = renderHook(() => useSkillActions(4, true));
      await waitFor(() => expect(result.current?.length).toBe(2));
      expect(listSkillsMock).toHaveBeenCalledTimes(1);

      // Back within the minute: no refetch.
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(listSkillsMock).toHaveBeenCalledTimes(1);

      // Changed elsewhere; back after more than a minute: refetched.
      listSkillsMock.mockResolvedValue([{ name: "build" }]);
      vi.advanceTimersByTime(61_000);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => expect(result.current?.map((s) => s.name)).toEqual(["build"]));
      expect(listSkillsMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
