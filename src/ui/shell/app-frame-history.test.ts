import { describe, it, expect } from "vitest";
import {
  EMPTY_FRAME_HISTORY,
  MAX_FRAME_HISTORY,
  canFrameGoBack,
  canFrameGoForward,
  observeFrameUrl,
  planFrameStep,
  type FrameHistory,
} from "./app-frame-history";

function visit(...urls: string[]): FrameHistory {
  return urls.reduce((h, u) => observeFrameUrl(h, u, "push"), EMPTY_FRAME_HISTORY);
}

describe("app frame history", () => {
  it("first load starts the list; nowhere to go yet", () => {
    const h = observeFrameUrl(EMPTY_FRAME_HISTORY, "/a", "unknown");
    expect(h).toEqual({ entries: ["/a"], index: 0, pending: null });
    expect(canFrameGoBack(h)).toBe(false);
    expect(canFrameGoForward(h)).toBe(false);
  });

  it("the app navigating pushes pages; back becomes available", () => {
    const h = visit("/a", "/b", "/c");
    expect(h.index).toBe(2);
    expect(canFrameGoBack(h)).toBe(true);
    expect(canFrameGoForward(h)).toBe(false);
  });

  it("back never goes before the first page the pane showed", () => {
    expect(planFrameStep(visit("/a"), -1)).toBeNull();
    expect(planFrameStep(EMPTY_FRAME_HISTORY, -1)).toBeNull();
  });

  it("a bar back step loads the previous page and lands on it", () => {
    const h = visit("/a", "/b");
    const step = planFrameStep(h, -1)!;
    expect(step.url).toBe("/a");
    // The load in place reports as a replace.
    const landed = observeFrameUrl(step.next, "/a", "replace");
    expect(landed).toEqual({ entries: ["/a", "/b"], index: 0, pending: null });
    expect(canFrameGoForward(landed)).toBe(true);
    const fwd = planFrameStep(landed, 1)!;
    expect(fwd.url).toBe("/b");
    expect(observeFrameUrl(fwd.next, "/b", "replace").index).toBe(1);
  });

  it("a redirected back load records where it actually ended up", () => {
    const step = planFrameStep(visit("/a", "/b"), -1)!;
    const landed = observeFrameUrl(step.next, "/login", "replace");
    expect(landed.entries).toEqual(["/login", "/b"]);
    expect(landed.index).toBe(0);
  });

  it("navigating after going back drops the forward pages", () => {
    const step = planFrameStep(visit("/a", "/b", "/c"), -1)!;
    const atB = observeFrameUrl(step.next, "/b", "replace");
    const h = observeFrameUrl(atB, "/d", "push");
    expect(h.entries).toEqual(["/a", "/b", "/d"]);
    expect(canFrameGoForward(h)).toBe(false);
  });

  it("the app replacing its own page updates the current entry only", () => {
    const h = observeFrameUrl(visit("/a", "/b"), "/b?tab=2", "replace");
    expect(h.entries).toEqual(["/a", "/b?tab=2"]);
    expect(h.index).toBe(1);
  });

  it("reloads and same-URL loads change nothing", () => {
    const h = visit("/a", "/b");
    expect(observeFrameUrl(h, "/b", "reload")).toBe(h);
    expect(observeFrameUrl(h, "/b", "unknown")).toBe(h);
    expect(observeFrameUrl(h, "/b", "push")).toBe(h);
  });

  it("a browser traverse onto a known neighbour follows it", () => {
    const h = visit("/a", "/b");
    const back = observeFrameUrl(h, "/a", "traverse");
    expect(back.index).toBe(0);
    expect(observeFrameUrl(back, "/b", "traverse").index).toBe(1);
  });

  it("a browser traverse somewhere unknown replaces the current page", () => {
    const h = observeFrameUrl(visit("/a", "/b"), "/zzz", "traverse");
    expect(h.entries).toEqual(["/a", "/zzz"]);
    expect(h.index).toBe(1);
  });

  it("the list is capped, keeping the newest pages", () => {
    const urls = Array.from({ length: MAX_FRAME_HISTORY + 5 }, (_, i) => `/p${i}`);
    const h = visit(...urls);
    expect(h.entries.length).toBe(MAX_FRAME_HISTORY);
    expect(h.entries[h.index]).toBe(`/p${MAX_FRAME_HISTORY + 4}`);
  });
});
