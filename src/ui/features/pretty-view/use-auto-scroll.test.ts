// ResizeObserver polyfill — JSDOM does not ship it.
// Must be assigned BEFORE the import of useAutoScroll so that
// the module's ResizeObserver reference picks up the stub at module-init time.
// Captures the most recent constructor's callback so tests that need to
// simulate a browser ResizeObserver firing can invoke it directly.
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoScroll } from "./use-auto-scroll";
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

// Helper: build a scroll container whose scrollHeight is driven by a mutable
// getter so tests can simulate content growth mid-run.
function makeMutableScrollEl(opts: {
  initialScrollHeight: number;
  clientHeight: number;
  initialScrollTop?: number;
}): { el: HTMLElement; setScrollHeight: (v: number) => void } {
  let scrollHeightState = opts.initialScrollHeight;
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", {
    get: () => scrollHeightState,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    get: () => opts.clientHeight,
    configurable: true,
  });
  let _scrollTop = opts.initialScrollTop ?? 0;
  Object.defineProperty(el, "scrollTop", {
    get: () => _scrollTop,
    set: (v: number) => {
      _scrollTop = v;
    },
    configurable: true,
  });
  el.getBoundingClientRect = () =>
    ({
      top: 0,
      bottom: opts.clientHeight,
      left: 0,
      right: 0,
      width: 0,
      height: opts.clientHeight,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return { el, setScrollHeight: (v: number) => { scrollHeightState = v; } };
}

// The mount effect arms loadLockUntilRef for LOAD_LOCK_MS (300ms) after
// mount and after every paneKey change. Tests that want to fire a gesture
// event and observe the exit-sticky branch must first advance time past
// that lock — we use vi.useFakeTimers() so we can advance deterministically
// AND still let the rAF-chain in the paneKey effect complete without racing.
// `vi.advanceTimersByTime` also advances the Date.now() clock that the
// load-lock uses (vitest fake timers stub Date), so a single advance both
// clears the lock and lets any queued rAFs run out.
const LOAD_LOCK_MS = 300;
const PAST_LOCK_MS = LOAD_LOCK_MS + 50;

describe("useAutoScroll — sticky-bottom", () => {
  beforeEach(() => {
    // Fresh RO capture per test so bullets 12/13 can rely on capturedROCallback
    // being the most recent hook mount's callback.
    capturedROCallback = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Bullet 5: overflow-anchor CSS application (mount / unmount)
  // -------------------------------------------------------------------------

  describe("overflow-anchor CSS", () => {
    it("applies overflow-anchor: none on mount when scrollRef binds", () => {
      const scrollEl = makeScrollEl({ scrollHeight: 500, clientHeight: 400 });
      const { result } = renderHook(() => useAutoScroll());

      act(() => {
        result.current.scrollRef(scrollEl);
      });

      expect(scrollEl.style.overflowAnchor).toBe("none");
    });

    it("restores the prior overflowAnchor value on unmount", () => {
      const scrollEl = makeScrollEl({ scrollHeight: 500, clientHeight: 400 });
      scrollEl.style.overflowAnchor = "auto"; // pre-existing value

      const { result, unmount } = renderHook(() => useAutoScroll());

      act(() => {
        result.current.scrollRef(scrollEl);
      });
      expect(scrollEl.style.overflowAnchor).toBe("none");

      unmount();

      expect(scrollEl.style.overflowAnchor).toBe("auto");
    });
  });

  // -------------------------------------------------------------------------
  // Bullet 6: fresh mount starts sticky + isPinnedToBottom true
  // -------------------------------------------------------------------------

  describe("initial state", () => {
    it("isPinnedToBottom is true after scrollRef binds on fresh mount", () => {
      const scrollEl = makeScrollEl({ scrollHeight: 500, clientHeight: 400 });
      const { result } = renderHook(() => useAutoScroll());

      act(() => {
        result.current.scrollRef(scrollEl);
      });

      expect(result.current.isPinnedToBottom).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Bullet 7: paneKey reset on conversation switch
  // -------------------------------------------------------------------------

  describe("paneKey reset", () => {
    it("paneKey change re-enters sticky after a prior gesture exit", () => {
      // Render with paneKey="pane-A", bind scrollEl+contentEl, advance past
      // load-lock, exit sticky via wheel-up, then rerender with a fresh
      // paneKey and assert we're sticky again.
      const scrollEl = makeScrollEl({
        scrollHeight: 1000,
        clientHeight: 400,
        scrollTop: 600,
      });
      const contentEl = document.createElement("div");
      const { result, rerender } = renderHook(
        ({ paneKey }: { paneKey: string }) => useAutoScroll(paneKey),
        { initialProps: { paneKey: "pane-A" } },
      );

      act(() => {
        result.current.scrollRef(scrollEl);
        result.current.contentRef(contentEl);
      });

      // Advance past the mount load-lock so the wheel-up will be honored.
      act(() => {
        vi.advanceTimersByTime(PAST_LOCK_MS);
      });

      // Exit sticky via wheel-up.
      act(() => {
        scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
      });
      expect(result.current.isPinnedToBottom).toBe(false);

      // Rerender with a new paneKey — the pane-change effect fires,
      // re-enters sticky, and arms a fresh load-lock.
      rerender({ paneKey: "pane-B" });
      expect(result.current.isPinnedToBottom).toBe(true);

      // After the paneKey change, a content-growth RO callback should still
      // write scrollTop = scrollHeight (proving sticky was re-entered).
      scrollEl.scrollTop = 0; // pretend layout perturbation
      act(() => {
        capturedROCallback?.([], {} as ResizeObserver);
      });
      expect(scrollEl.scrollTop).toBe(1000);
    });
  });

  // -------------------------------------------------------------------------
  // Bullet 8: gesture-only exit via wheel — deltaY < 0 exits, deltaY > 0 doesn't
  // -------------------------------------------------------------------------

  describe("wheel-gesture exit", () => {
    it("wheel with deltaY < 0 exits sticky", () => {
      const scrollEl = makeScrollEl({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
      const { result } = renderHook(() => useAutoScroll());

      act(() => { result.current.scrollRef(scrollEl); });
      act(() => { vi.advanceTimersByTime(PAST_LOCK_MS); });

      act(() => {
        scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
      });

      expect(result.current.isPinnedToBottom).toBe(false);
    });

    it("wheel with deltaY > 0 does NOT exit sticky", () => {
      const scrollEl = makeScrollEl({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
      const { result } = renderHook(() => useAutoScroll());

      act(() => { result.current.scrollRef(scrollEl); });
      act(() => { vi.advanceTimersByTime(PAST_LOCK_MS); });

      act(() => {
        scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: +50 }));
      });

      expect(result.current.isPinnedToBottom).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Bullet 9: gesture-only exit via keydown — PageUp/ArrowUp/Home exit,
  // PageDown/ArrowDown/End/letters/space do NOT
  // -------------------------------------------------------------------------

  describe("keydown-gesture exit", () => {
    const EXIT_KEYS = ["PageUp", "ArrowUp", "Home"];
    const NON_EXIT_KEYS = ["PageDown", "ArrowDown", "End", "a", " "];

    for (const key of EXIT_KEYS) {
      it(`keydown '${key}' exits sticky`, () => {
        const scrollEl = makeScrollEl({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
        const { result } = renderHook(() => useAutoScroll());

        act(() => { result.current.scrollRef(scrollEl); });
        act(() => { vi.advanceTimersByTime(PAST_LOCK_MS); });

        act(() => {
          scrollEl.dispatchEvent(new KeyboardEvent("keydown", { key }));
        });

        expect(result.current.isPinnedToBottom).toBe(false);
      });
    }

    for (const key of NON_EXIT_KEYS) {
      it(`keydown '${key === " " ? "Space" : key}' does NOT exit sticky`, () => {
        const scrollEl = makeScrollEl({ scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
        const { result } = renderHook(() => useAutoScroll());

        act(() => { result.current.scrollRef(scrollEl); });
        act(() => { vi.advanceTimersByTime(PAST_LOCK_MS); });

        act(() => {
          scrollEl.dispatchEvent(new KeyboardEvent("keydown", { key }));
        });

        expect(result.current.isPinnedToBottom).toBe(true);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Bullet 10: gesture-only exit via touchmove — scrollTop reduction > 2px
  // exits; unchanged or increased scrollTop does NOT exit
  // -------------------------------------------------------------------------

  describe("touchmove-gesture exit", () => {
    // Priming note: the touchmove handler compares scrollTop to
    // lastScrollTopRef.current and unconditionally writes
    // lastScrollTopRef.current = scrollTop at the end of every fire.
    //
    // Important: after the mount rAF-chain runs (via vi.advanceTimersByTime
    // past LOAD_LOCK_MS), scrollEl.scrollTop has been jumped to scrollHeight
    // and lastScrollTopRef is also at scrollHeight (jumpToBottom writes both).
    // So tests operate near scrollHeight and dispatch a first "prime"
    // touchmove at the desired baseline scrollTop before the actual test
    // touchmove, so lastScrollTopRef reflects the baseline.

    it("touchmove that reduces scrollTop by > 2px exits sticky", () => {
      // Use scrollHeight=2000 so we have headroom to move scrollTop down
      // by >2px without wrapping around scrollHeight bounds.
      const scrollEl = makeScrollEl({
        scrollHeight: 2000,
        clientHeight: 400,
        scrollTop: 0,
      });
      const { result } = renderHook(() => useAutoScroll());

      act(() => { result.current.scrollRef(scrollEl); });
      act(() => { vi.advanceTimersByTime(PAST_LOCK_MS); });
      // After mount+advance: scrollTop = 2000 (jumpToBottom writes scrollHeight),
      // lastScrollTopRef = 2000.

      // First touchmove primes lastScrollTopRef at current scrollTop=2000.
      act(() => { scrollEl.dispatchEvent(new Event("touchmove")); });
      expect(result.current.isPinnedToBottom).toBe(true);

      // Reduce scrollTop by 50 (>2px).
      scrollEl.scrollTop = 1950;
      act(() => { scrollEl.dispatchEvent(new Event("touchmove")); });

      expect(result.current.isPinnedToBottom).toBe(false);
    });

    it("touchmove with unchanged scrollTop does NOT exit sticky", () => {
      const scrollEl = makeScrollEl({
        scrollHeight: 2000,
        clientHeight: 400,
        scrollTop: 0,
      });
      const { result } = renderHook(() => useAutoScroll());

      act(() => { result.current.scrollRef(scrollEl); });
      act(() => { vi.advanceTimersByTime(PAST_LOCK_MS); });
      // scrollTop = 2000, lastScrollTopRef = 2000.

      // Prime + verify.
      act(() => { scrollEl.dispatchEvent(new Event("touchmove")); });
      expect(result.current.isPinnedToBottom).toBe(true);

      // touchmove with scrollTop unchanged (still 2000).
      act(() => { scrollEl.dispatchEvent(new Event("touchmove")); });

      expect(result.current.isPinnedToBottom).toBe(true);
    });

    it("touchmove with scrollTop moved UP-then-DOWN by 1px does NOT exit sticky (mobile passive-tap regression)", () => {
      // Simulate the mobile bug pattern: user taps a conversation row, the
      // touchmove that comes in with the tap does NOT actually reduce
      // scrollTop from the previous value by >2px (either unchanged or
      // moved down by a small amount). Historically this un-stuck sticky
      // mode. The fix requires now < prev - 2, so this case must stay pinned.
      // Bump scrollHeight so scrollTop can go slightly ABOVE where mount
      // jumped it (simulating a bounce), by mutating scrollHeight after
      // mount to model post-mount growth.
      const { el: scrollEl, setScrollHeight } = makeMutableScrollEl({
        initialScrollHeight: 2000,
        clientHeight: 400,
        initialScrollTop: 0,
      });
      const { result } = renderHook(() => useAutoScroll());

      act(() => { result.current.scrollRef(scrollEl); });
      act(() => { vi.advanceTimersByTime(PAST_LOCK_MS); });
      // scrollTop = 2000, lastScrollTopRef = 2000.

      // Grow content so scrollTop can nudge up by 1 without hitting bounds.
      setScrollHeight(3000);

      // Prime at 2000.
      act(() => { scrollEl.dispatchEvent(new Event("touchmove")); });
      expect(result.current.isPinnedToBottom).toBe(true);

      // Move DOWN by 1px (simulating passive tap-drag on mobile).
      scrollEl.scrollTop = 2001;
      act(() => { scrollEl.dispatchEvent(new Event("touchmove")); });

      expect(result.current.isPinnedToBottom).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Bullet 11: forceStickAndJump re-enters sticky + jumps + arms load-lock
  // -------------------------------------------------------------------------

  describe("forceStickAndJump", () => {
    it("re-enters sticky, jumps to bottom, and arms load-lock so an immediate wheel-up is ignored", () => {
      const scrollEl = makeScrollEl({
        scrollHeight: 2000,
        clientHeight: 400,
        scrollTop: 200,
      });
      const { result } = renderHook(() => useAutoScroll());

      act(() => { result.current.scrollRef(scrollEl); });
      act(() => { vi.advanceTimersByTime(PAST_LOCK_MS); });

      // Exit sticky via wheel-up.
      act(() => {
        scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
      });
      expect(result.current.isPinnedToBottom).toBe(false);

      // Call forceStickAndJump — re-enters sticky, jumps to scrollHeight,
      // and arms the load-lock for LOAD_LOCK_MS.
      act(() => { result.current.forceStickAndJump(); });

      expect(result.current.isPinnedToBottom).toBe(true);
      expect(scrollEl.scrollTop).toBe(2000);

      // A subsequent wheel-up fired IMMEDIATELY (within the load-lock) must
      // NOT exit sticky — proves the load-lock re-arm.
      act(() => {
        scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
      });
      expect(result.current.isPinnedToBottom).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Bullet 12: ResizeObserver — content growth while sticky writes scrollTop
  // -------------------------------------------------------------------------

  describe("ResizeObserver — while sticky", () => {
    it("content growth writes scrollTop = scrollHeight and keeps isPinnedToBottom true", () => {
      const { el: scrollEl, setScrollHeight } = makeMutableScrollEl({
        initialScrollHeight: 500,
        clientHeight: 400,
        initialScrollTop: 100,
      });
      const contentEl = document.createElement("div");

      const { result } = renderHook(() => useAutoScroll());

      act(() => {
        result.current.scrollRef(scrollEl);
        result.current.contentRef(contentEl);
      });
      // Fresh mount is sticky; no need to advance timers here — we're not
      // firing user gestures.
      expect(result.current.isPinnedToBottom).toBe(true);

      // Simulate content growth: scrollHeight 500 → 2000.
      setScrollHeight(2000);

      act(() => {
        capturedROCallback?.([], {} as ResizeObserver);
      });

      expect(scrollEl.scrollTop).toBe(2000);
      expect(result.current.isPinnedToBottom).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Bullet 13: ResizeObserver — content growth while NOT sticky does NOT
  // write scrollTop; isPinnedToBottom reflects distFromBottom <= BOTTOM_THRESHOLD
  // -------------------------------------------------------------------------

  describe("ResizeObserver — while not sticky", () => {
    it("content growth does NOT write scrollTop when exited from sticky", () => {
      const { el: scrollEl, setScrollHeight } = makeMutableScrollEl({
        initialScrollHeight: 1000,
        clientHeight: 400,
        initialScrollTop: 0,
      });
      const contentEl = document.createElement("div");

      const { result } = renderHook(() => useAutoScroll());

      act(() => {
        result.current.scrollRef(scrollEl);
        result.current.contentRef(contentEl);
      });
      act(() => { vi.advanceTimersByTime(PAST_LOCK_MS); });

      // Exit sticky via wheel-up.
      act(() => {
        scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
      });
      expect(result.current.isPinnedToBottom).toBe(false);

      const scrollTopBefore = scrollEl.scrollTop; // 0
      // Content grows: 1000 → 2000. distFromBottom = 2000-0-400 = 1600 > 100.
      setScrollHeight(2000);

      act(() => {
        capturedROCallback?.([], {} as ResizeObserver);
      });

      // scrollTop unchanged — RO's non-sticky branch does NOT write scrollTop.
      expect(scrollEl.scrollTop).toBe(scrollTopBefore);
      // isPinnedToBottom reflects the distFromBottom check: dist=1600 > 100
      // → false.
      expect(result.current.isPinnedToBottom).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Bullet 14: scrollToBottomAndFollow sets sticky + jumps; does NOT arm load-lock
  // -------------------------------------------------------------------------

  describe("scrollToBottomAndFollow", () => {
    it("re-enters sticky and jumps to bottom, but a subsequent wheel-up CAN exit sticky (no load-lock)", () => {
      const scrollEl = makeScrollEl({
        scrollHeight: 2000,
        clientHeight: 400,
        scrollTop: 100,
      });
      const { result } = renderHook(() => useAutoScroll());

      act(() => { result.current.scrollRef(scrollEl); });
      act(() => { vi.advanceTimersByTime(PAST_LOCK_MS); });

      // Exit sticky via wheel-up.
      act(() => {
        scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
      });
      expect(result.current.isPinnedToBottom).toBe(false);

      // Call scrollToBottomAndFollow — re-enters sticky and jumps to bottom.
      act(() => { result.current.scrollToBottomAndFollow(); });

      expect(result.current.isPinnedToBottom).toBe(true);
      expect(scrollEl.scrollTop).toBe(2000);

      // Unlike forceStickAndJump, scrollToBottomAndFollow does NOT arm the
      // load-lock, so a wheel-up fired right after CAN exit sticky again.
      act(() => {
        scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
      });
      expect(result.current.isPinnedToBottom).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Bullet 15: scrolling back into the BOTTOM_THRESHOLD re-enters sticky
  // -------------------------------------------------------------------------

  describe("scroll-back-to-bottom re-enters sticky", () => {
    it("scroll event with distFromBottom <= BOTTOM_THRESHOLD re-enters sticky without pill", () => {
      const scrollEl = makeScrollEl({
        scrollHeight: 2000,
        clientHeight: 400,
        scrollTop: 100,
      });
      const { result } = renderHook(() => useAutoScroll());

      act(() => { result.current.scrollRef(scrollEl); });
      act(() => { vi.advanceTimersByTime(PAST_LOCK_MS); });

      // Exit sticky via wheel-up (dist = 2000-100-400 = 1500 > 100 initially).
      act(() => {
        scrollEl.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
      });
      expect(result.current.isPinnedToBottom).toBe(false);

      // User manually scrolls to bottom: scrollTop such that dist <= 100.
      // dist = 2000 - scrollTop - 400 → scrollTop = 1550 gives dist = 50.
      scrollEl.scrollTop = 1550;
      act(() => {
        scrollEl.dispatchEvent(new Event("scroll"));
      });

      expect(result.current.isPinnedToBottom).toBe(true);
    });
  });
});
