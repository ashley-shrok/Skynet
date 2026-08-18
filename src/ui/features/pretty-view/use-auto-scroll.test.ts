// Tests for useAutoScroll — the plain-DOM pinned-follow hook.
//
// Phase 43 (replace-pv-virtualization-with-plain-dom-windowed-paginatio)
// § "Frontend simplifications enabled": TanStack Virtual is being removed,
// so the three-actor scroll problem (user scroll / virtualizer correction
// writes / follow-to-bottom heuristics) collapses to one actor. The hook
// becomes: (a) a scroll listener updating `pinnedRef` from
// `scrollTop + clientHeight >= scrollHeight - EPSILON`, (b) a
// `messageCount` effect that jumps to bottom when pinned, (c) an
// explicit `scrollToBottomAndFollow` action. Every construct in
// 43-CONTEXT.md `<decisions>` § "Deletion scope" for this hook is gone:
// RO gymnastics, <20 px delta heuristic, programmaticRef, stickyRef,
// rAF chain, MutationObserver, tall-bubble jump-protection.
//
// This test file locks the NEW simplified behavior. It is written
// FIRST — the current 245-line hook implementation should fail (or be
// unreliable against) several of these assertions; that unreliability
// is the RED signal that motivates the rewrite in Task 2. After
// Task 2, all 8 tests must pass.
//
// Coverage strategy:
//   - renderHook + a plain HTMLElement created via document.createElement("div")
//     with scrollHeight / clientHeight / scrollTop overridden via
//     Object.defineProperty (same pattern used in
//     PrettyView.virtualization.test.tsx L187-216 — the technique of
//     overriding the read-only scroll geometry via defineProperty is the
//     standard JSDOM-scroll harness in this codebase).
//   - Wrap scroll event dispatches in act() so React state updates flush.
//   - Test 5 is the load-bearing regression: "no yank when scrolled up
//     and a new message arrives" — the whole point of the hook simplification
//     is that this is trivially true when there's no virtualizer to filter.
//   - Test 8 locks the exported API surface via Object.keys so downstream
//     plans 43-07a/07b consume a frozen shape and don't need to renegotiate.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoScroll } from "./use-auto-scroll";

// ---------------------------------------------------------------------------
// Test infrastructure — controllable scroll container mock
// ---------------------------------------------------------------------------

/**
 * Creates a plain HTMLDivElement with scrollHeight / clientHeight / scrollTop
 * overridden via Object.defineProperty. Mirrors the pattern from
 * PrettyView.virtualization.test.tsx `shrinkScrollContainer` at L187-216 —
 * scrollTop is BOTH readable and writable (the setter mutates the backing
 * state so the hook's `el.scrollTop = el.scrollHeight` writes propagate).
 *
 * Returns the element plus setter functions for the test to drive scroll
 * geometry changes without needing to render into a real DOM tree.
 */
function makeScrollEl(opts: {
  scrollHeight: number;
  clientHeight: number;
  initialScrollTop?: number;
}): {
  el: HTMLDivElement;
  setScrollHeight: (v: number) => void;
  setScrollTop: (v: number) => void;
  getScrollTop: () => number;
  addEventListenerSpy: ReturnType<typeof vi.fn>;
  removeEventListenerSpy: ReturnType<typeof vi.fn>;
} {
  const el = document.createElement("div");
  let scrollHeightState = opts.scrollHeight;
  let clientHeightState = opts.clientHeight;
  let scrollTopState = opts.initialScrollTop ?? 0;

  Object.defineProperty(el, "scrollHeight", {
    get: () => scrollHeightState,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    get: () => clientHeightState,
    configurable: true,
  });
  Object.defineProperty(el, "scrollTop", {
    get: () => scrollTopState,
    set: (v: number) => {
      scrollTopState = v;
    },
    configurable: true,
  });

  // Wrap addEventListener / removeEventListener so tests can assert cleanup
  // behavior (Test 7). We wrap the real DOM methods rather than replacing
  // them entirely so the hook's real listener actually attaches and fires.
  const realAdd = el.addEventListener.bind(el);
  const realRemove = el.removeEventListener.bind(el);
  const addEventListenerSpy = vi.fn(
    (type: string, handler: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) => {
      realAdd(type, handler, options);
    },
  );
  const removeEventListenerSpy = vi.fn(
    (type: string, handler: EventListenerOrEventListenerObject, options?: EventListenerOptions | boolean) => {
      realRemove(type, handler, options);
    },
  );
  // Cast through unknown to satisfy TS — we're intentionally shadowing
  // the DOM method on this instance only.
  (el as unknown as { addEventListener: typeof addEventListenerSpy }).addEventListener = addEventListenerSpy;
  (el as unknown as { removeEventListener: typeof removeEventListenerSpy }).removeEventListener = removeEventListenerSpy;

  return {
    el,
    setScrollHeight: (v: number) => {
      scrollHeightState = v;
    },
    setScrollTop: (v: number) => {
      scrollTopState = v;
    },
    getScrollTop: () => scrollTopState,
    addEventListenerSpy,
    removeEventListenerSpy,
  };
}

/**
 * Fire a synthetic scroll event on the mock element under act() so React
 * flushes the state updates the hook triggers from its scroll listener.
 */
function fireScroll(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new Event("scroll"));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useAutoScroll — plain-DOM pinned-follow hook (Phase 43 rewrite)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Test 1 — initial state is pinned (isPinnedToBottom === true before any scroll interaction)", () => {
    // Even before binding a scroll element, the hook seeds isPinnedToBottom = true
    // so the first messageCount effect scrolls to bottom on cold load.
    const { result } = renderHook(() => useAutoScroll("pane-1", 0));
    expect(result.current.isPinnedToBottom).toBe(true);
  });

  it("Test 2 — scroll near bottom -> pinned (isPinnedToBottom stays true)", () => {
    const scrollEl = makeScrollEl({ scrollHeight: 5000, clientHeight: 800, initialScrollTop: 4200 });
    // scrollTop + clientHeight = 5000 = scrollHeight → dist = 0, well under BOTTOM_EPSILON.
    const { result } = renderHook(() => useAutoScroll("pane-1", 10));
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });
    fireScroll(scrollEl.el);
    expect(result.current.isPinnedToBottom).toBe(true);
    // scrollTop should not have been reset by the hook when we're already at bottom
    // (the follow effect only fires when messageCount changes; a scroll event alone
    // must not touch scrollTop).
    expect(scrollEl.getScrollTop()).toBe(4200);
  });

  it("Test 3 — scroll to top -> unpinned (isPinnedToBottom flips to false)", () => {
    const scrollEl = makeScrollEl({ scrollHeight: 5000, clientHeight: 800, initialScrollTop: 4200 });
    const { result } = renderHook(() => useAutoScroll("pane-1", 10));
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });
    // Seed the listener at pinned = true first, then scroll up
    fireScroll(scrollEl.el);
    expect(result.current.isPinnedToBottom).toBe(true);
    // Now the user scrolls to the top
    scrollEl.setScrollTop(100);
    fireScroll(scrollEl.el);
    // dist = 5000 - 100 - 800 = 4100, well above BOTTOM_EPSILON (100)
    expect(result.current.isPinnedToBottom).toBe(false);
    // scrollTop still where the user left it — hook must not write during a scroll event
    expect(scrollEl.getScrollTop()).toBe(100);
  });

  it("Test 4 — follow-when-pinned: messageCount grows while pinned -> scrollTop jumps to scrollHeight", () => {
    const scrollEl = makeScrollEl({ scrollHeight: 5000, clientHeight: 800, initialScrollTop: 4200 });
    const { result, rerender } = renderHook(
      ({ count }: { count: number }) => useAutoScroll("pane-1", count),
      { initialProps: { count: 10 } },
    );
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });
    fireScroll(scrollEl.el); // ensure pinned = true
    expect(result.current.isPinnedToBottom).toBe(true);

    // A new message arrives: simulate scrollHeight growing (more DOM), then
    // re-render with the higher messageCount to trigger the follow effect.
    scrollEl.setScrollHeight(5500);
    act(() => {
      rerender({ count: 11 });
    });
    // The follow effect must have set scrollTop to the current scrollHeight
    expect(scrollEl.getScrollTop()).toBe(5500);
  });

  it("Test 5 — NO yank when scrolled up (LOAD-BEARING REGRESSION): new message must not move scrollTop", () => {
    // This is the whole point of Phase 43's auto-scroll simplification.
    // If the user has scrolled up to read history, a new incoming message
    // MUST NOT pull them back down. In the old 245-line hook this was
    // enforced by a maze of programmaticRef + <20px delta + stickyRef
    // gymnastics. In the new hook it's a single `if (!pinnedRef.current) return;`
    // guard on the follow effect.
    const scrollEl = makeScrollEl({ scrollHeight: 5000, clientHeight: 800, initialScrollTop: 4200 });
    const { result, rerender } = renderHook(
      ({ count }: { count: number }) => useAutoScroll("pane-1", count),
      { initialProps: { count: 10 } },
    );
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });
    // User scrolls to the very top
    scrollEl.setScrollTop(0);
    fireScroll(scrollEl.el);
    expect(result.current.isPinnedToBottom).toBe(false);

    // New message arrives — bump count AND grow scrollHeight (real behavior)
    scrollEl.setScrollHeight(5500);
    act(() => {
      rerender({ count: 11 });
    });
    // CRITICAL ASSERTION: scrollTop must still be 0 — no yank.
    expect(scrollEl.getScrollTop()).toBe(0);
    // And isPinnedToBottom must still be false — the follow effect must not
    // have flipped pinned state either.
    expect(result.current.isPinnedToBottom).toBe(false);
  });

  it("Test 6 — scrollToBottomAndFollow(): sets scrollTop = scrollHeight AND flips isPinnedToBottom to true", () => {
    const scrollEl = makeScrollEl({ scrollHeight: 5000, clientHeight: 800, initialScrollTop: 0 });
    const { result } = renderHook(() => useAutoScroll("pane-1", 10));
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });
    // Start unpinned (user scrolled up)
    fireScroll(scrollEl.el);
    expect(result.current.isPinnedToBottom).toBe(false);

    // Invoke the explicit action — the compose-send / jump-to-bottom-pill path
    act(() => {
      result.current.scrollToBottomAndFollow();
    });
    expect(scrollEl.getScrollTop()).toBe(5000);
    expect(result.current.isPinnedToBottom).toBe(true);
  });

  it("Test 7 — cleanup: unmounting removes the scroll event listener", () => {
    const scrollEl = makeScrollEl({ scrollHeight: 5000, clientHeight: 800, initialScrollTop: 4200 });
    const { result, unmount } = renderHook(() => useAutoScroll("pane-1", 10));
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });
    // Confirm the listener was added first (sanity check on the harness)
    expect(scrollEl.addEventListenerSpy).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      expect.anything(),
    );
    unmount();
    // The hook must have called removeEventListener on cleanup
    expect(scrollEl.removeEventListenerSpy).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
    );
  });

  it("Test 8 — API surface locked: return object keys are EXACTLY isPinnedToBottom + scrollRef + scrollToBottomAndFollow", () => {
    // This regression guards the frozen hook API. Plan 43-07b explicitly
    // does NOT extend this hook with a `scrollEl` field or 4th return field —
    // it composes its own ref to obtain the element locally. If a future
    // change adds a return field, this test fails and forces the author to
    // reconsider before growing the surface.
    const { result } = renderHook(() => useAutoScroll("pane-1", 0));
    const keys = Object.keys(result.current).sort();
    expect(keys).toEqual(["isPinnedToBottom", "scrollRef", "scrollToBottomAndFollow"]);
  });
});
