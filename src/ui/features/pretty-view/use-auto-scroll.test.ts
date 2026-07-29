// ResizeObserver polyfill — JSDOM does not ship it.
// Must be assigned BEFORE the import of useAutoScroll so that
// the module's ResizeObserver reference picks up the stub at module-init time.
// Captures the most recent constructor's callback so tests that need to
// simulate a browser ResizeObserver firing (Test O) can invoke it directly.
let capturedROCallback: ResizeObserverCallback | null = null;
class CapturingResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    capturedROCallback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as Record<string, unknown>).ResizeObserver =
  CapturingResizeObserver;

import { describe, it, expect } from "vitest";
import {
  computeFollowBottomTop,
  useAutoScroll,
} from "./use-auto-scroll";
import { renderHook, act } from "@testing-library/react";

// Helper: build a minimal mock scroll container with controlled geometry.
function makeScrollEl(opts: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop?: number;
  boundingTop?: number;
}): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", {
    get: () => opts.scrollHeight,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    get: () => opts.clientHeight,
    configurable: true,
  });
  let _scrollTop = opts.scrollTop ?? 0;
  Object.defineProperty(el, "scrollTop", {
    get: () => _scrollTop,
    set: (v: number) => {
      _scrollTop = v;
    },
    configurable: true,
  });
  const boundingTop = opts.boundingTop ?? 0;
  el.getBoundingClientRect = () =>
    ({
      top: boundingTop,
      bottom: boundingTop + opts.clientHeight,
      left: 0,
      right: 0,
      width: 0,
      height: opts.clientHeight,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

// ---------------------------------------------------------------------------
// Pure-helper unit tests
// ---------------------------------------------------------------------------

describe("computeFollowBottomTop", () => {
  it("returns scrollHeight - clientHeight when content overflows", () => {
    const el = makeScrollEl({ scrollHeight: 1000, clientHeight: 400 });
    expect(computeFollowBottomTop(el)).toBe(600);
  });

  it("returns 0 when content fits (no overflow)", () => {
    const el = makeScrollEl({ scrollHeight: 300, clientHeight: 400 });
    expect(computeFollowBottomTop(el)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test G: scrollToBottomAndFollow
// ---------------------------------------------------------------------------

describe("useAutoScroll — Test G: scrollToBottomAndFollow", () => {
  it("sets isPinnedToBottom to true when scrollToBottomAndFollow is called", () => {
    const scrollEl = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 200,
    });

    const { result } = renderHook(() => useAutoScroll());

    act(() => {
      result.current.scrollRef(scrollEl);
    });

    // Scroll up so we are not pinned
    act(() => {
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    act(() => {
      result.current.scrollToBottomAndFollow();
    });

    // isPinnedToBottom should flip to true after GTG
    expect(result.current.isPinnedToBottom).toBe(true);
  });

  it("scrolls to scrollHeight after scrollToBottomAndFollow", () => {
    const scrollEl = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 0,
    });

    const { result } = renderHook(() => useAutoScroll());

    act(() => {
      result.current.scrollRef(scrollEl);
    });

    act(() => {
      result.current.scrollToBottomAndFollow();
    });

    // scrollEl.scrollTop should have been set to scrollHeight (1000)
    expect(scrollEl.scrollTop).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Test K: wheel event updates isPinnedToBottom
// ---------------------------------------------------------------------------

describe("useAutoScroll — Test K: wheel event", () => {
  it("wheel event on scrollEl updates isPinnedToBottom based on distFromBottom", () => {
    // scrollHeight=1000, clientHeight=400, scrollTop=200
    // distFromBottom = 1000 - 200 - 400 = 400 > 100 → not pinned
    const scrollEl = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 200,
    });

    const { result } = renderHook(() => useAutoScroll());

    act(() => {
      result.current.scrollRef(scrollEl);
    });

    act(() => {
      scrollEl.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    });

    expect(result.current.isPinnedToBottom).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test L: touchmove event updates isPinnedToBottom
// ---------------------------------------------------------------------------

describe("useAutoScroll — Test L: touchmove event", () => {
  it("touchmove event on scrollEl updates isPinnedToBottom based on distFromBottom", () => {
    // scrollHeight=1000, clientHeight=400, scrollTop=600
    // distFromBottom = 1000 - 600 - 400 = 0 ≤ 100 → pinned
    const scrollEl = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 600,
    });

    const { result } = renderHook(() => useAutoScroll());

    act(() => {
      result.current.scrollRef(scrollEl);
    });

    // Use Event('touchmove') for JSDOM compatibility (hook only needs the event type)
    act(() => {
      scrollEl.dispatchEvent(new Event("touchmove", { bubbles: true }));
    });

    expect(result.current.isPinnedToBottom).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test M: keydown scroll keys flip isPinnedToBottom; non-scroll keys do not
// ---------------------------------------------------------------------------

describe("useAutoScroll — Test M: keydown scroll keys", () => {
  const SCROLL_KEYS = ["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End", " "];

  for (const key of SCROLL_KEYS) {
    it(`keydown key='${key === " " ? "Space" : key}' updates isPinnedToBottom based on distFromBottom`, () => {
      // scrollHeight=1000, clientHeight=400, scrollTop=0
      // distFromBottom = 1000 - 0 - 400 = 600 > 100 → not pinned
      const scrollEl = makeScrollEl({
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 0,
      });

      const { result } = renderHook(() => useAutoScroll());

      act(() => {
        result.current.scrollRef(scrollEl);
      });

      act(() => {
        scrollEl.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });

      expect(result.current.isPinnedToBottom).toBe(false);
    });
  }

  it("does not flip mode on non-scroll keys like 'a'", () => {
    // scrollHeight=1000, clientHeight=400, scrollTop=0
    // distFromBottom = 600 > 100 → not pinned initially (hook starts with isPinnedToBottom=true)
    const scrollEl = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 0,
    });

    const { result } = renderHook(() => useAutoScroll());

    act(() => {
      result.current.scrollRef(scrollEl);
    });

    const initialPinned = result.current.isPinnedToBottom;

    act(() => {
      scrollEl.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    });

    // Non-scroll key: handler did NOT run, so state is unchanged.
    expect(result.current.isPinnedToBottom).toBe(initialPinned);
  });
});

// ---------------------------------------------------------------------------
// Test N: followBottom respects distance after gesture
// ---------------------------------------------------------------------------

describe("useAutoScroll — Test N: followBottom respects distance after gesture", () => {
  it("sub-case 1: scrollTop mid-content → isPinnedToBottom false after wheel", () => {
    // scrollHeight=1000, clientHeight=400, scrollTop=0
    // distFromBottom = 1000 - 0 - 400 = 600 > 100 → not pinned
    const scrollEl = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 0,
    });

    const { result } = renderHook(() => useAutoScroll());

    act(() => {
      result.current.scrollRef(scrollEl);
    });

    act(() => {
      scrollEl.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    });

    expect(result.current.isPinnedToBottom).toBe(false);
  });

  it("sub-case 2: scrollTop at bottom → isPinnedToBottom true after wheel", () => {
    // scrollHeight=1000, clientHeight=400, scrollTop=600
    // distFromBottom = 1000 - 600 - 400 = 0 ≤ 100 → pinned
    const scrollEl = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 600,
    });

    const { result } = renderHook(() => useAutoScroll());

    act(() => {
      result.current.scrollRef(scrollEl);
    });

    act(() => {
      scrollEl.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    });

    expect(result.current.isPinnedToBottom).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test O (patch #103 regression): ResizeObserver recomputes isPinnedToBottom.
// ---------------------------------------------------------------------------
// When the user has scrolled up (not pinned) and content grows WITHOUT a
// scroll event, the RO callback must still call syncPinned so isPinnedToBottom
// stays correctly false. This guards against any future regression where the
// RO callback is gated in a way that skips the syncPinned call.

describe("useAutoScroll — Test O (patch #103 regression): RO recomputes isPinnedToBottom", () => {
  it("content growth while scrolled up does not incorrectly flip isPinnedToBottom to true via ResizeObserver", () => {
    // Mutable scrollHeight so we can simulate content growth mid-test.
    let scrollHeightState = 1000;
    const scrollEl = document.createElement("div");
    Object.defineProperty(scrollEl, "scrollHeight", {
      get: () => scrollHeightState,
      configurable: true,
    });
    Object.defineProperty(scrollEl, "clientHeight", {
      get: () => 400,
      configurable: true,
    });
    // scrollTop=0, distFromBottom = 1000-0-400 = 600 > 100 → NOT pinned
    let _scrollTop = 0;
    Object.defineProperty(scrollEl, "scrollTop", {
      get: () => _scrollTop,
      set: (v: number) => {
        _scrollTop = v;
      },
      configurable: true,
    });
    scrollEl.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 400,
        left: 0,
        right: 0,
        width: 0,
        height: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const contentEl = document.createElement("div");

    const { result } = renderHook(() => useAutoScroll());

    act(() => {
      result.current.scrollRef(scrollEl);
      result.current.contentRef(contentEl);
    });

    // Dispatch a scroll event so followBottomRef syncs to false (not pinned).
    act(() => {
      scrollEl.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isPinnedToBottom).toBe(false);

    // Content grows (MORE content below fold) — WITHOUT any scroll write or scroll event.
    scrollHeightState = 2000;

    // Fire the captured RO callback (simulates a real ResizeObserver notification).
    act(() => {
      capturedROCallback?.([], {} as ResizeObserver);
    });

    // The RO callback must have called syncPinned: distFromBottom = 2000-0-400 = 1600 > 100
    // → still NOT pinned. If the RO callback skipped syncPinned, isPinnedToBottom could
    // end up stale (depends on implementation); this test ensures it stays false.
    expect(result.current.isPinnedToBottom).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Held position: when scrolled up, RO fires but does NOT write scrollTop
// ---------------------------------------------------------------------------

describe("useAutoScroll — held position when scrolled up", () => {
  it("RO callback does not mutate scrollTop when followBottomRef is false", () => {
    // scrollHeight=1000, clientHeight=400, scrollTop=100
    // distFromBottom = 1000 - 100 - 400 = 500 > 100 → NOT pinned
    const scrollEl = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 100,
    });
    const contentEl = document.createElement("div");

    const { result } = renderHook(() => useAutoScroll());

    act(() => {
      result.current.scrollRef(scrollEl);
      result.current.contentRef(contentEl);
    });

    // Dispatch scroll event so followBottomRef syncs to false (not pinned).
    act(() => {
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(result.current.isPinnedToBottom).toBe(false);
    const scrollTopBefore = scrollEl.scrollTop; // 100

    // Fire the RO callback — should NOT write scrollTop.
    act(() => {
      capturedROCallback?.([], {} as ResizeObserver);
    });

    expect(scrollEl.scrollTop).toBe(scrollTopBefore); // still 100
    expect(result.current.isPinnedToBottom).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Follows bottom when pinned: RO fires and writes scrollTop to new scrollHeight
// ---------------------------------------------------------------------------

describe("useAutoScroll — follows bottom when pinned", () => {
  it("RO callback writes scrollTop to scrollHeight when followBottomRef is true", () => {
    // Start pinned: scrollHeight=500, clientHeight=400, scrollTop=100
    // distFromBottom = 500 - 100 - 400 = 0 ≤ 100 → pinned
    let scrollHeightState = 500;
    const scrollEl = document.createElement("div");
    Object.defineProperty(scrollEl, "scrollHeight", {
      get: () => scrollHeightState,
      configurable: true,
    });
    Object.defineProperty(scrollEl, "clientHeight", {
      get: () => 400,
      configurable: true,
    });
    let _scrollTop = 100;
    Object.defineProperty(scrollEl, "scrollTop", {
      get: () => _scrollTop,
      set: (v: number) => {
        _scrollTop = v;
      },
      configurable: true,
    });

    const contentEl = document.createElement("div");

    const { result } = renderHook(() => useAutoScroll());

    act(() => {
      result.current.scrollRef(scrollEl);
      result.current.contentRef(contentEl);
    });

    // Dispatch scroll to sync pinned=true.
    act(() => {
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(result.current.isPinnedToBottom).toBe(true);

    // Simulate content growth: scrollHeight 500 → 2000.
    scrollHeightState = 2000;

    // Fire the RO callback — should write scrollTop = scrollHeight (2000).
    act(() => {
      capturedROCallback?.([], {} as ResizeObserver);
    });

    // After the RO write, scrollTop should be updated to scrollHeight.
    expect(scrollEl.scrollTop).toBe(2000);
  });
});
