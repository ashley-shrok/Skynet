import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const selected: string[] = [];
vi.mock("@/state/conversation-store", () => ({
  selectConversationDeferred: (id: string) => selected.push(id),
}));
const nav: string[] = [];
vi.mock("@/lib/mobile-flow", () => ({
  navigateToView: () => nav.push("view"),
  navigateToList: () => nav.push("list"),
}));

import type { Tab } from "@/types/ui-types";
import { DESKTOP_HISTORY_KEY, requestDesktopBack } from "./desktop-drag";
import { findAgentConversation, usePhoneDesktop } from "./use-phone-desktop";

const conv = {
  id: "conv-willow",
  type: "terminal",
  host: { id: "1" },
  targetTmuxSession: "Willow",
} as unknown as Tab;
const other = {
  id: "conv-other",
  type: "terminal",
  host: { id: "2" },
  targetTmuxSession: "willow",
} as unknown as Tab;
const desk = {
  id: "desk-1",
  type: "desktop",
  desktop: { hostId: 1, identityKey: "willow" },
} as unknown as Tab;
const payload = { hostId: 1, identityKey: "willow", label: "Willow" };

beforeEach(() => {
  selected.length = 0;
  nav.length = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
  window.history.replaceState({ __skynetMobileView: true }, "", "/#mv=1");
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("findAgentConversation", () => {
  it("matches the agent's own conversation on its own machine", () => {
    expect(findAgentConversation([other, desk, conv], 1, "willow")?.id).toBe("conv-willow");
    expect(findAgentConversation([other, desk], 1, "willow")).toBeUndefined();
  });
});

describe("usePhoneDesktop", () => {
  const closed: string[] = [];
  const close = (id: string) => closed.push(id);
  const opened: string[] = [];
  const openConv = (hostId: number, key: string) => {
    opened.push(`${hostId}::${key}`);
    return "conv-reopened";
  };
  const noConv = (hostId: number, key: string) => {
    opened.push(`${hostId}::${key}`);
    return null;
  };
  beforeEach(() => {
    closed.length = 0;
    opened.length = 0;
  });

  it("opening shows the desktop alone and adds a history entry at the same address", () => {
    const { result } = renderHook(() => usePhoneDesktop([conv, desk], close, openConv, null));
    const push = vi.spyOn(window.history, "pushState");
    result.current.openFullScreen("desk-1", payload, "conv-willow");
    expect(selected).toEqual(["desk-1"]);
    expect(nav).toEqual(["view"]);
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#mv=1");
    const st = window.history.state as Record<string, unknown>;
    expect(st[DESKTOP_HISTORY_KEY]).toBe("1::willow");
    expect(st.__skynetMobileView).toBe(true);
  });

  it("the bar's back steps back over the entry, returns to the conversation and closes the desktop", async () => {
    const { result } = renderHook(() => usePhoneDesktop([conv, desk], close, openConv, null));
    result.current.openFullScreen("desk-1", payload, "conv-willow");
    selected.length = 0;
    nav.length = 0;
    const back = vi.spyOn(window.history, "back");
    requestDesktopBack("desk-1");
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(selected).toEqual(["conv-willow"]));
    expect(nav).toEqual(["view"]);
    expect(closed).toEqual(["desk-1"]);
    const st = window.history.state as Record<string, unknown> | null;
    expect(st?.[DESKTOP_HISTORY_KEY]).toBeUndefined();
  });

  it("the phone's own back gesture also returns to the conversation", async () => {
    const { result } = renderHook(() => usePhoneDesktop([conv, desk], close, openConv, null));
    result.current.openFullScreen("desk-1", payload, "conv-willow");
    selected.length = 0;
    nav.length = 0;
    window.history.back();
    await waitFor(() => expect(selected).toEqual(["conv-willow"]));
    expect(nav).toEqual(["view"]);
    expect(closed).toEqual(["desk-1"]);
  });

  it("back returns to the conversation it was opened from, over another tab of the same agent", async () => {
    const twin = { ...conv, id: "conv-willow-2" } as Tab;
    const { result } = renderHook(() => usePhoneDesktop([conv, twin, desk], close, openConv, null));
    result.current.openFullScreen("desk-1", payload, "conv-willow-2");
    selected.length = 0;
    requestDesktopBack("desk-1");
    await waitFor(() => expect(selected).toEqual(["conv-willow-2"]));
  });

  it("with the conversation no longer open (e.g. after a reload), back opens it again", async () => {
    const restored = { ...desk, id: "desk-after-reload" } as Tab;
    renderHook(() => usePhoneDesktop([restored], close, openConv, null));
    requestDesktopBack("desk-after-reload");
    expect(opened).toEqual(["1::willow"]);
    expect(selected).toEqual(["conv-reopened"]);
    expect(nav).toEqual(["view"]);
    expect(closed).toEqual(["desk-after-reload"]);
  });

  it("when the conversation can't be opened, back goes to the list and still closes the desktop", async () => {
    const { result } = renderHook(() => usePhoneDesktop([desk], close, noConv, null));
    result.current.openFullScreen("desk-1", payload, null);
    nav.length = 0;
    requestDesktopBack("desk-1");
    await waitFor(() => expect(nav).toEqual(["list"]));
    expect(closed).toEqual(["desk-1"]);
  });

  it("after a reload (new tab id, entry still on top), the phone's back gesture still leaves", async () => {
    // The entry from before the reload: tagged by the desktop, not the tab.
    window.history.pushState(
      { __skynetMobileView: true, [DESKTOP_HISTORY_KEY]: "1::willow" },
      "",
      "/#mv=1",
    );
    const restored = { ...desk, id: "desk-after-reload" } as Tab;
    renderHook(() => usePhoneDesktop([conv, restored], close, openConv, null));
    window.history.back();
    await waitFor(() => expect(selected).toEqual(["conv-willow"]));
    expect(closed).toEqual(["desk-after-reload"]);
  });

  it("after a reload, the bar's back steps over the old entry too", async () => {
    window.history.pushState(
      { __skynetMobileView: true, [DESKTOP_HISTORY_KEY]: "1::willow" },
      "",
      "/#mv=1",
    );
    const restored = { ...desk, id: "desk-after-reload" } as Tab;
    renderHook(() => usePhoneDesktop([conv, restored], close, openConv, null));
    const back = vi.spyOn(window.history, "back");
    requestDesktopBack("desk-after-reload");
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(closed).toEqual(["desk-after-reload"]));
  });

  it("without its history entry, back leaves straight away", () => {
    renderHook(() => usePhoneDesktop([conv, desk], close, openConv, null));
    const back = vi.spyOn(window.history, "back");
    requestDesktopBack("desk-1");
    expect(back).not.toHaveBeenCalled();
    expect(selected).toEqual(["conv-willow"]);
    expect(closed).toEqual(["desk-1"]);
  });

  it("opening a second time reuses the entry instead of stacking one", () => {
    const desk2 = { ...desk, id: "desk-2" } as Tab;
    const { result } = renderHook(() => usePhoneDesktop([conv, desk, desk2], close, openConv, null));
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    result.current.openFullScreen("desk-1", payload, "conv-willow");
    result.current.openFullScreen("desk-2", payload, "desk-1");
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("a history step that leaves a desktop already closed does nothing", async () => {
    const { result, rerender } = renderHook(({ tabs }) => usePhoneDesktop(tabs, close, openConv, null), {
      initialProps: { tabs: [conv, desk] as Tab[] },
    });
    result.current.openFullScreen("desk-1", payload, "conv-willow");
    rerender({ tabs: [conv] });
    selected.length = 0;
    nav.length = 0;
    window.history.back();
    await new Promise((r) => setTimeout(r, 50));
    expect(selected).toEqual([]);
    expect(nav).toEqual([]);
    expect(closed).toEqual([]);
  });

  it("a full-screen desktop on screen without its entry gets it back (after a reload)", () => {
    vi.stubGlobal("screen", { width: 390, height: 844 });
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("coarse"), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    try {
      const restored = { ...desk, id: "desk-after-reload" } as Tab;
      const { rerender } = renderHook(({ sel }) => usePhoneDesktop([conv, restored], close, openConv, sel), {
        initialProps: { sel: null as string | null },
      });
      const push = vi.spyOn(window.history, "pushState");
      rerender({ sel: "desk-after-reload" });
      expect(push).toHaveBeenCalledTimes(1);
      expect((window.history.state as Record<string, unknown>)[DESKTOP_HISTORY_KEY]).toBe("1::willow");
      // Already there: not pushed again.
      rerender({ sel: "desk-after-reload" });
      expect(push).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("not on a phone, a shown desktop gets no entry", () => {
    const { rerender } = renderHook(({ sel }) => usePhoneDesktop([conv, desk], close, openConv, sel), {
      initialProps: { sel: null as string | null },
    });
    const push = vi.spyOn(window.history, "pushState");
    rerender({ sel: "desk-1" });
    expect(push).not.toHaveBeenCalled();
  });

  it("other history moves while the desktop is up don't leave it", () => {
    const { result } = renderHook(() => usePhoneDesktop([conv, desk], close, openConv, null));
    result.current.openFullScreen("desk-1", payload, "conv-willow");
    selected.length = 0;
    window.history.replaceState(window.history.state, "", "/#mv=1&tab=x");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(selected).toEqual([]);
  });
});
