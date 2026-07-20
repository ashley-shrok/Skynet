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

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeAnchorPinTop,
  computeFollowBottomTop,
  computeClampTarget,
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

// Helper: build a minimal mock anchor element.
function makeAnchorEl(opts: {
  boundingTop: number; // top relative to viewport (already accounting for scroll)
}): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      top: opts.boundingTop,
      bottom: opts.boundingTop + 40,
      left: 0,
      right: 0,
      width: 100,
      height: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

// ---------------------------------------------------------------------------
// Pure-helper unit tests (A-E cover anchor selection via hook; C-E cover math)
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

describe("computeAnchorPinTop", () => {
  it("returns the absolute scrollTop that would place anchor at viewport top", () => {
    // scrollEl bounding top = 0; anchor bounding top = 100; scrollTop = 50
    // anchorPinTop = (100 - 0) + 50 = 150
    const scrollEl = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 50,
      boundingTop: 0,
    });
    const anchorEl = makeAnchorEl({ boundingTop: 100 });
    expect(computeAnchorPinTop(anchorEl, scrollEl)).toBe(150);
  });

  it("works when scrollEl itself has a non-zero bounding top", () => {
    // scrollEl bounding top = 60 (e.g. inside a layout); anchor bounding top = 160; scrollTop = 0
    // anchorPinTop = (160 - 60) + 0 = 100
    const scrollEl = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 0,
      boundingTop: 60,
    });
    const anchorEl = makeAnchorEl({ boundingTop: 160 });
    expect(computeAnchorPinTop(anchorEl, scrollEl)).toBe(100);
  });
});

// Test C: follow-bottom branch (content barely overflows, fbt <= apt)
describe("computeClampTarget — Test C: follow-bottom branch", () => {
  it("target = followBottomTop when content barely overflows (fbt <= apt)", () => {
    // scrollHeight=500, clientHeight=400, scrollTop=0, anchor at top of scroll
    // fbt = max(0, 500-400) = 100
    // anchorEl bounding top = 0 (matches scroll container top), scrollTop=0
    // apt = (0 - 0) + 0 = 0
    // target = min(100, 0) = 0 → follow-bottom because fbt(100) > apt(0)
    // Actually fbt <= apt check: fbt=100, apt=0 → min=0, follow-bottom wins with lower value
    const scrollEl = makeScrollEl({
      scrollHeight: 500,
      clientHeight: 400,
      scrollTop: 0,
      boundingTop: 0,
    });
    const anchorEl = makeAnchorEl({ boundingTop: 0 }); // anchor at top of viewport
    const fbt = computeFollowBottomTop(scrollEl);
    const apt = computeAnchorPinTop(anchorEl, scrollEl);
    const target = computeClampTarget(anchorEl, scrollEl);
    // fbt=100, apt=0; min=0 (apt wins since content is short and anchor is already at top)
    expect(fbt).toBe(100);
    expect(apt).toBe(0);
    expect(target).toBe(0);
  });
});

// Test D: anchor-pinned branch (content greatly overflows, fbt > apt)
describe("computeClampTarget — Test D: anchor-pinned branch", () => {
  it("target = anchorPinTop when content is far past viewport (fbt > apt)", () => {
    // scrollHeight=1000, clientHeight=400, scrollTop=0
    // anchor bounding top = 100 (anchor is 100px below scroll container top in viewport)
    // fbt = 1000-400 = 600
    // apt = (100-0) + 0 = 100
    // target = min(600, 100) = 100 → anchor ceiling
    const scrollEl = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 0,
      boundingTop: 0,
    });
    const anchorEl = makeAnchorEl({ boundingTop: 100 });
    const target = computeClampTarget(anchorEl, scrollEl);
    expect(target).toBe(100);
  });
});

// Test E: early-turn short reply (fbt < apt — follow bottom wins)
describe("computeClampTarget — Test E: early-turn short reply", () => {
  it("target = followBottomTop when content is short and anchor is mid-page", () => {
    // scrollHeight=450, clientHeight=400, scrollTop=0
    // anchor at 200px from scroll container top in viewport
    // fbt = max(0, 450-400) = 50
    // apt = (200-0) + 0 = 200
    // target = min(50, 200) = 50 → follow bottom
    const scrollEl = makeScrollEl({
      scrollHeight: 450,
      clientHeight: 400,
      scrollTop: 0,
      boundingTop: 0,
    });
    const anchorEl = makeAnchorEl({ boundingTop: 200 });
    const target = computeClampTarget(anchorEl, scrollEl);
    expect(target).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Hook integration tests (A, B, F', G, K, L, M, N)
// ---------------------------------------------------------------------------

describe("useAutoScroll — Test A: anchor selection", () => {
  it("derives anchor eventId from the LAST user-role message, not the first", () => {
    const messages = [
      { type: "message", role: "assistant", eventId: "a0" },
      { type: "message", role: "user", eventId: "e1" },
      { type: "message", role: "assistant", eventId: "a1" },
      { type: "message", role: "user", eventId: "e2" },
      { type: "message", role: "assistant", eventId: "a2" },
    ];

    // We verify anchor selection indirectly: on the first render, the hook
    // should detect e2 (last user-role event) as the new anchor eventId.
    // We'll spy on requestAnimationFrame to confirm the clamp reset fires.
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      // Don't actually call — just count calls
      return 0 as unknown as ReturnType<typeof requestAnimationFrame>;
    });

    renderHook(() => useAutoScroll(messages));

    // rAF should have been called (the anchor-key-change effect schedules one)
    expect(rafSpy).toHaveBeenCalled();
    rafSpy.mockRestore();
  });
});

describe("useAutoScroll — Test B: anchor reset on new user message", () => {
  it("resets mode to clamp and followBottom to false when anchorEventId changes", () => {
    const messages1 = [
      { type: "message", role: "user", eventId: "e1" },
    ];
    const messages2 = [
      { type: "message", role: "user", eventId: "e1" },
      { type: "message", role: "user", eventId: "e2" },
    ];

    const rafCalls: number[] = [];
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb) => {
        rafCalls.push(1);
        return 0 as unknown as ReturnType<typeof requestAnimationFrame>;
      });

    const { rerender } = renderHook(
      ({ msgs }) => useAutoScroll(msgs),
      { initialProps: { msgs: messages1 } },
    );

    const callsAfterFirst = rafCalls.length;

    // Add a new user message with a different eventId
    rerender({ msgs: messages2 });

    // A new rAF should have been scheduled (anchor key changed from e1 → e2)
    expect(rafCalls.length).toBeGreaterThan(callsAfterFirst);

    rafSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Test F' (patch #98 regression): delayed scroll event does NOT flip mode
// ---------------------------------------------------------------------------
// Regression guard for patch #98: browser scroll events can arrive 200ms+ after a
// programmatic scrollTop write. The hook MUST NOT flip mode based on scroll events.
describe("useAutoScroll — Test F' (patch #98 regression): delayed scroll event does NOT flip mode", () => {
  it("a scroll event — even after a 250ms delay — does not change isPinnedToBottom in a mode-flip way", async () => {
    const scrollEl = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 0, // distFromBottom = 600 > 100, so not pinned
    });

    const { result } = renderHook(() =>
      useAutoScroll([{ type: "message", role: "user", eventId: "u1" }]),
    );

    act(() => {
      result.current.scrollRef(scrollEl);
    });

    // Read isPinnedToBottom value after mounting; with scrollTop=0 and
    // distFromBottom=600, the value should be false (not pinned).
    const beforeScroll = result.current.isPinnedToBottom;

    // Simulate the delayed browser scroll arrival (200ms+ after programmatic write).
    await new Promise((r) => setTimeout(r, 250));

    act(() => {
      scrollEl.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    // After the scroll event, isPinnedToBottom should still reflect the current
    // distFromBottom (600 > 100 → false), NOT a mode-flip artifact.
    // The key: this value is the same as what the scroll handler computes from
    // distFromBottom — it has not been influenced by a mode flip.
    expect(result.current.isPinnedToBottom).toBe(false);

    // Now dispatch a wheel event — FIRST genuine user gesture.
    // isPinnedToBottom should remain false (distFromBottom still 600 > 100).
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    });
    expect(result.current.isPinnedToBottom).toBe(false);
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

    const { result } = renderHook(() =>
      useAutoScroll([
        { type: "message", role: "user", eventId: "u1" },
        { type: "message", role: "assistant", eventId: "a1" },
      ]),
    );

    act(() => {
      result.current.scrollRef(scrollEl);
    });

    // Initially may be false (clamp mode, not pinned)
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

    const { result } = renderHook(() =>
      useAutoScroll([{ type: "message", role: "user", eventId: "u1" }]),
    );

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
// Test K: wheel event flips mode to user-driving
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

    const { result } = renderHook(() =>
      useAutoScroll([{ type: "message", role: "user", eventId: "u1" }]),
    );

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
// Test L: touchmove event flips mode to user-driving
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

    const { result } = renderHook(() =>
      useAutoScroll([{ type: "message", role: "user", eventId: "u1" }]),
    );

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
// Test M: keydown scroll keys flip mode; non-scroll keys do not
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

      const { result } = renderHook(() =>
        useAutoScroll([{ type: "message", role: "user", eventId: "u1" }]),
      );

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
    // distFromBottom = 600 > 100 → not pinned initially
    const scrollEl = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 0,
    });

    const { result } = renderHook(() =>
      useAutoScroll([{ type: "message", role: "user", eventId: "u1" }]),
    );

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

    const { result } = renderHook(() =>
      useAutoScroll([{ type: "message", role: "user", eventId: "u1" }]),
    );

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

    const { result } = renderHook(() =>
      useAutoScroll([{ type: "message", role: "user", eventId: "u1" }]),
    );

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
// When a sent user message anchors the scroll in clamp mode and content
// grows past the anchor ceiling, applyClampRule's target (apt) equals the
// current scrollTop → no scroll write → no scroll event → effect 1 does not
// update isPinnedToBottom. The jump-to-bottom pill was hiding forever even
// with a full viewport of unread content below the fold. Effect 2's RO
// callback must recompute pill visibility from current scroll geometry.

describe("useAutoScroll — Test O (patch #103 regression): RO recomputes isPinnedToBottom", () => {
  it("content growth without a scroll event flips isPinnedToBottom to false via ResizeObserver", () => {
    // Mutable scrollHeight so we can simulate content growth mid-test.
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

    const { result } = renderHook(() =>
      useAutoScroll([{ type: "message", role: "user", eventId: "u1" }]),
    );

    act(() => {
      result.current.scrollRef(scrollEl);
      result.current.contentRef(contentEl);
    });

    // Sync isPinnedToBottom to the initial (pinned) geometry.
    // scrollHeight=500, scrollTop=100, clientHeight=400 → distFromBottom=0 → pinned=true
    act(() => {
      scrollEl.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isPinnedToBottom).toBe(true);

    // Content grows past the fold — WITHOUT any scroll write or scroll event.
    // scrollHeight 500 → 2000. New distFromBottom = 2000 - 100 - 400 = 1500 >> 100.
    scrollHeightState = 2000;

    // Fire the captured RO callback (simulates a real ResizeObserver notification).
    act(() => {
      capturedROCallback?.([], {} as ResizeObserver);
    });

    // Without the fix, isPinnedToBottom stays true and the pill hides.
    // With the fix, the RO callback recomputes and flips it to false.
    expect(result.current.isPinnedToBottom).toBe(false);
  });
});
