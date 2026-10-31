/**
 * app-frame-backdrop — the app pane's frame takes the leaving page's covering
 * background for the gap between pages, and is white under every live page.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  BACKDROP_WATCH_CAP_MS,
  colorAlpha,
  frameCoveringBackdrop,
  watchFrameBackdrop,
} from "./app-frame-backdrop";

// A real (jsdom) document with a defaultView, styled as given.
function makeDoc(opts: { html?: string; body?: string; meta?: string } = {}): Document {
  const holder = document.createElement("iframe");
  document.body.appendChild(holder);
  const doc = holder.contentDocument!;
  if (opts.html !== undefined) doc.documentElement.setAttribute("style", opts.html);
  if (opts.body !== undefined) doc.body.setAttribute("style", opts.body);
  if (opts.meta !== undefined) {
    const m = doc.createElement("meta");
    m.setAttribute("name", "color-scheme");
    m.setAttribute("content", opts.meta);
    doc.head.appendChild(m);
  }
  return doc;
}

// Stand-in for the pane's iframe whose current document the test swaps, the
// way a navigation commits a new document into the same frame.
function makeFrame(initial: Document | null) {
  const frame = new EventTarget() as EventTarget & {
    contentDocument: Document | null;
    contentWindow: Window | null;
    isConnected: boolean;
  };
  frame.isConnected = true;
  frame.contentDocument = initial;
  frame.contentWindow = initial?.defaultView ?? null;
  const navigateTo = (doc: Document | null) => {
    frame.contentDocument = doc;
    frame.contentWindow = doc?.defaultView ?? null;
  };
  return { frame, navigateTo, el: frame as unknown as HTMLIFrameElement };
}

const ctx = () => ({ tabId: "t1", hostId: 1, slug: "videos" });

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("colorAlpha", () => {
  it.each([
    ["transparent", 0],
    ["rgba(0, 0, 0, 0)", 0],
    ["rgb(20, 21, 32)", 1],
    ["rgba(20, 21, 32, 0.5)", 0.5],
    ["rgb(20 21 32 / 40%)", 0.4],
    ["oklch(0.2 0.02 260)", 1],
    ["oklch(0.2 0.02 260 / 0.3)", 0.3],
    ["color(srgb 0.1 0.1 0.1 / 0)", 0],
    ["oklch(0.2 0.02 260 / none)", 0],
    ["", 0],
  ])("%s → %s", (c, a) => {
    expect(colorAlpha(c)).toBeCloseTo(a);
  });
});

describe("frameCoveringBackdrop", () => {
  it("opaque html background covers", () => {
    expect(frameCoveringBackdrop(makeDoc({ html: "background-color: rgb(10, 11, 12)" }))).toBe(
      "rgb(10, 11, 12)",
    );
  });

  it("body background propagates when html has none", () => {
    expect(frameCoveringBackdrop(makeDoc({ body: "background-color: rgb(1, 2, 3)" }))).toBe(
      "rgb(1, 2, 3)",
    );
  });

  it("html background wins over body", () => {
    const doc = makeDoc({
      html: "background-color: rgb(9, 9, 9)",
      body: "background-color: rgb(1, 2, 3)",
    });
    expect(frameCoveringBackdrop(doc)).toBe("rgb(9, 9, 9)");
  });

  it("no background doesn't cover (frame stays white, like its own tab)", () => {
    expect(frameCoveringBackdrop(makeDoc())).toBeNull();
  });

  it("see-through background doesn't cover", () => {
    expect(
      frameCoveringBackdrop(makeDoc({ body: "background-color: rgba(0, 0, 0, 0.5)" })),
    ).toBeNull();
  });

  it("dark-only color scheme with no background gets the browser's dark canvas", () => {
    expect(frameCoveringBackdrop(makeDoc({ meta: "dark" }))).toMatch(/^rgb/);
    expect(frameCoveringBackdrop(makeDoc({ meta: "only dark" }))).toMatch(/^rgb/);
  });

  it("'light dark' follows the frame's light scheme — doesn't cover", () => {
    expect(frameCoveringBackdrop(makeDoc({ meta: "light dark" }))).toBeNull();
  });

  it("null document (off-site) doesn't cover", () => {
    expect(frameCoveringBackdrop(null)).toBeNull();
  });
});

describe("watchFrameBackdrop", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "Date"] });
  });

  it("dark page → leaving it colors the gap; next page's load goes back to white", () => {
    const dark = makeDoc({ body: "background-color: rgb(20, 21, 32)" });
    const { frame, navigateTo, el } = makeFrame(dark);
    const apply = vi.fn();
    const stop = watchFrameBackdrop(el, apply, ctx);

    frame.dispatchEvent(new Event("load"));
    expect(apply).toHaveBeenLastCalledWith(null);

    dark.defaultView!.dispatchEvent(new Event("pagehide"));
    expect(apply).toHaveBeenLastCalledWith("rgb(20, 21, 32)");

    // Next document committed but not parsed yet, no styles: gap stays dark.
    const next = makeDoc();
    Object.defineProperty(next, "readyState", { value: "loading", configurable: true });
    navigateTo(next);
    vi.advanceTimersToNextFrame();
    expect(apply).toHaveBeenLastCalledWith("rgb(20, 21, 32)");

    frame.dispatchEvent(new Event("load"));
    expect(apply).toHaveBeenLastCalledWith(null);
    stop();
  });

  it("next page that covers takes over before its load", () => {
    const dark = makeDoc({ body: "background-color: rgb(20, 21, 32)" });
    const { frame, navigateTo, el } = makeFrame(dark);
    const apply = vi.fn();
    const stop = watchFrameBackdrop(el, apply, ctx);
    frame.dispatchEvent(new Event("load"));
    dark.defaultView!.dispatchEvent(new Event("pagehide"));

    const next = makeDoc({ html: "background-color: rgb(5, 5, 5)" });
    Object.defineProperty(next, "readyState", { value: "loading", configurable: true });
    navigateTo(next);
    vi.advanceTimersToNextFrame();
    expect(apply).toHaveBeenLastCalledWith("rgb(5, 5, 5)");
    stop();
  });

  it("next page with no background goes white only once parsed, scripts run and styles in", () => {
    const dark = makeDoc({ body: "background-color: rgb(20, 21, 32)" });
    const { frame, navigateTo, el } = makeFrame(dark);
    const apply = vi.fn();
    const stop = watchFrameBackdrop(el, apply, ctx);
    frame.dispatchEvent(new Event("load"));
    dark.defaultView!.dispatchEvent(new Event("pagehide"));

    const next = makeDoc();
    const link = next.createElement("link");
    link.rel = "stylesheet"; // never loads in jsdom: sheet stays null
    next.head.appendChild(link);
    let state = "loading";
    Object.defineProperty(next, "readyState", { get: () => state, configurable: true });
    navigateTo(next);
    vi.advanceTimersToNextFrame();
    expect(apply).toHaveBeenLastCalledWith("rgb(20, 21, 32)");

    // Parsed, but deferred/module scripts haven't run (no DOMContentLoaded).
    state = "interactive";
    vi.advanceTimersToNextFrame();
    expect(apply).toHaveBeenLastCalledWith("rgb(20, 21, 32)");

    // Scripts run, stylesheet still loading.
    next.dispatchEvent(new Event("DOMContentLoaded"));
    vi.advanceTimersToNextFrame();
    expect(apply).toHaveBeenLastCalledWith("rgb(20, 21, 32)");

    // Stylesheet in (simulated by its removal): fully styled, no background.
    link.remove();
    vi.advanceTimersToNextFrame();
    expect(apply).toHaveBeenLastCalledWith(null);
    stop();
  });

  it("next page already past parsing when first seen waits for its load", () => {
    const dark = makeDoc({ body: "background-color: rgb(20, 21, 32)" });
    const { frame, navigateTo, el } = makeFrame(dark);
    const apply = vi.fn();
    const stop = watchFrameBackdrop(el, apply, ctx);
    frame.dispatchEvent(new Event("load"));
    dark.defaultView!.dispatchEvent(new Event("pagehide"));
    navigateTo(makeDoc()); // jsdom documents report "complete"
    vi.advanceTimersToNextFrame();
    expect(apply).toHaveBeenLastCalledWith("rgb(20, 21, 32)");
    frame.dispatchEvent(new Event("load"));
    expect(apply).toHaveBeenLastCalledWith(null);
    stop();
  });

  it("a page left before its own load is still watched once seen", () => {
    const dark = makeDoc({ body: "background-color: rgb(20, 21, 32)" });
    const { frame, navigateTo, el } = makeFrame(dark);
    const apply = vi.fn();
    const stop = watchFrameBackdrop(el, apply, ctx);
    frame.dispatchEvent(new Event("load"));
    dark.defaultView!.dispatchEvent(new Event("pagehide"));
    const next = makeDoc({ body: "background-color: rgb(7, 7, 7)" });
    navigateTo(next);
    vi.advanceTimersToNextFrame();
    expect(apply).toHaveBeenLastCalledWith("rgb(7, 7, 7)");
    // Left again before its load.
    next.defaultView!.dispatchEvent(new Event("pagehide"));
    navigateTo(makeDoc({ body: "background-color: rgb(9, 9, 9)" }));
    vi.advanceTimersToNextFrame();
    expect(apply).toHaveBeenLastCalledWith("rgb(9, 9, 9)");
    stop();
  });

  it("bfcache pagehide (persisted) leaves the frame white", () => {
    const dark = makeDoc({ body: "background-color: rgb(20, 21, 32)" });
    const { frame, el } = makeFrame(dark);
    const apply = vi.fn();
    const stop = watchFrameBackdrop(el, apply, ctx);
    frame.dispatchEvent(new Event("load"));
    const e = new Event("pagehide");
    Object.defineProperty(e, "persisted", { value: true });
    dark.defaultView!.dispatchEvent(e);
    expect(apply.mock.calls.every(([c]) => c === null)).toBe(true);
    stop();
  });

  it("pagehide from the pane closing (frame detached) does nothing", () => {
    const dark = makeDoc({ body: "background-color: rgb(20, 21, 32)" });
    const { frame, el } = makeFrame(dark);
    const apply = vi.fn();
    const stop = watchFrameBackdrop(el, apply, ctx);
    frame.dispatchEvent(new Event("load"));
    frame.isConnected = false;
    dark.defaultView!.dispatchEvent(new Event("pagehide"));
    expect(apply.mock.calls.every(([c]) => c === null)).toBe(true);
    stop();
  });

  it("light app with no background: the gap stays white throughout", () => {
    const plain = makeDoc();
    const { frame, el } = makeFrame(plain);
    const apply = vi.fn();
    const stop = watchFrameBackdrop(el, apply, ctx);
    frame.dispatchEvent(new Event("load"));
    plain.defaultView!.dispatchEvent(new Event("pagehide"));
    expect(apply.mock.calls.every(([c]) => c === null)).toBe(true);
    stop();
  });

  it("off-site next page falls back to white", () => {
    const dark = makeDoc({ body: "background-color: rgb(20, 21, 32)" });
    const { frame, navigateTo, el } = makeFrame(dark);
    const apply = vi.fn();
    const stop = watchFrameBackdrop(el, apply, ctx);
    frame.dispatchEvent(new Event("load"));
    dark.defaultView!.dispatchEvent(new Event("pagehide"));
    navigateTo(null);
    vi.advanceTimersToNextFrame();
    expect(apply).toHaveBeenLastCalledWith(null);
    stop();
  });

  it("stops looking for the next page after the cap", () => {
    const dark = makeDoc({ body: "background-color: rgb(20, 21, 32)" });
    const { frame, el } = makeFrame(dark);
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");
    const stop = watchFrameBackdrop(el, vi.fn(), ctx);
    frame.dispatchEvent(new Event("load"));
    dark.defaultView!.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(BACKDROP_WATCH_CAP_MS + 1000);
    const calls = rafSpy.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(rafSpy.mock.calls.length).toBe(calls);
    stop();
  });

  it("cleanup detaches from the page", () => {
    const dark = makeDoc({ body: "background-color: rgb(20, 21, 32)" });
    const { frame, el } = makeFrame(dark);
    const apply = vi.fn();
    const stop = watchFrameBackdrop(el, apply, ctx);
    frame.dispatchEvent(new Event("load"));
    stop();
    apply.mockClear();
    dark.defaultView!.dispatchEvent(new Event("pagehide"));
    frame.dispatchEvent(new Event("load"));
    expect(apply).not.toHaveBeenCalled();
  });
});
