/**
 * use-seen-tracker — a conversation is seen only while it is on screen AND
 * this browser tab is in front of the user.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const post = vi.fn().mockResolvedValue({});
vi.mock("@/main-axios", () => ({
  authApi: { get: vi.fn(), post: (...a: unknown[]) => post(...a) },
}));
vi.mock("@/api/user-preferences-api", () => ({
  putPinnedIds: vi.fn().mockResolvedValue([]),
  setIdentityPinned: vi.fn().mockResolvedValue(undefined),
}));

import { useSeenTracker, type SeenTarget } from "./use-seen-tracker";
import {
  applyReadState,
  applyRemoteDm,
  isDmd,
  isUnread,
  publishLastFinishAt,
  __resetAttentionForTest,
} from "./attention-store";

const ASH: SeenTarget = { id: "t-ash", hostId: "1", identityName: "ash" };

let visibility: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => visibility,
});
function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  __resetAttentionForTest();
  post.mockClear();
  visibility = "visible";
  applyReadState({ baselineAt: 1_000, seen: [] });
  publishLastFinishAt("1", "ash", 2_000);
});

describe("useSeenTracker", () => {
  it("marks an on-screen conversation seen while the tab is in front", () => {
    renderHook(() => useSeenTracker([ASH], true));
    expect(isUnread("1:ash")).toBe(false);
    expect(post).toHaveBeenCalledWith("/attention/seen", { hostId: "1", identityName: "ash", seenFinishAt: 2_000 });
  });

  it("does nothing while the tab is in the background", () => {
    visibility = "hidden";
    renderHook(() => useSeenTracker([ASH], true));
    expect(isUnread("1:ash")).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });

  it("does nothing when the conversation isn't actually showing (phone list screen)", () => {
    renderHook(() => useSeenTracker([ASH], false));
    expect(isUnread("1:ash")).toBe(true);
  });

  it("a turn that finishes while watching never becomes unread", () => {
    renderHook(() => useSeenTracker([ASH], true));
    act(() => publishLastFinishAt("1", "ash", 3_000));
    expect(isUnread("1:ash")).toBe(false);
  });

  it("a turn that finishes while the tab is hidden stays unread until the tab comes back", () => {
    renderHook(() => useSeenTracker([ASH], true));
    act(() => setVisibility("hidden"));
    act(() => publishLastFinishAt("1", "ash", 3_000));
    expect(isUnread("1:ash")).toBe(true);
    act(() => setVisibility("visible"));
    expect(isUnread("1:ash")).toBe(false);
  });

  it("stops marking a conversation once it leaves the screen", () => {
    const { rerender } = renderHook(({ t }) => useSeenTracker(t, true), {
      initialProps: { t: [ASH] as SeenTarget[] },
    });
    rerender({ t: [] });
    act(() => publishLastFinishAt("1", "ash", 3_000));
    expect(isUnread("1:ash")).toBe(true);
  });

  it("a DM that arrives while watching never marks the conversation", () => {
    renderHook(() => useSeenTracker([ASH], true));
    act(() => applyRemoteDm({ hostId: "1", identityName: "ash", lastDmAt: 2_500, seenDmAt: 0 }));
    expect(isDmd("1:ash")).toBe(false);
    expect(post).toHaveBeenCalledWith("/attention/dm-seen", { hostId: "1", identityName: "ash", seenDmAt: 2_500 });
  });

  it("a DM that arrives while the tab is hidden stays until the tab comes back", () => {
    renderHook(() => useSeenTracker([ASH], true));
    act(() => setVisibility("hidden"));
    act(() => applyRemoteDm({ hostId: "1", identityName: "ash", lastDmAt: 2_500, seenDmAt: 0 }));
    expect(isDmd("1:ash")).toBe(true);
    act(() => setVisibility("visible"));
    expect(isDmd("1:ash")).toBe(false);
  });
});
