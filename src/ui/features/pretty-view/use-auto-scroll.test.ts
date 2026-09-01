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
    // NOTE: the follow effect also fires on mount with initial messageCount,
    // so scrollTop will have been jumped to scrollHeight (5000) — this is
    // by design (see hook L67-73: "Fires on mount and whenever messageCount
    // grows"). The assertion here is on isPinnedToBottom only, matching the
    // plan's Test 2 spec.
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
    // The mount/paneKey effect (2026-08-21 rewrite) writes scrollTop=5000
    // on ref bind. Force scrollTop back to 0 and re-fire scroll to reach the
    // unpinned state this test exercises the recovery from.
    scrollEl.setScrollTop(0);
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

  // ── Tests 9-11 (2026-08-21, tina): three-engine coverage ─────────────
  // Locks the three fixes for Ashley's "auto-scroll feels messy" report.

  it("Test 9 — paneKey change resets pinned state + jumps to bottom (identity swap on live PrettyView)", () => {
    const scrollEl = makeScrollEl({ scrollHeight: 5000, clientHeight: 800, initialScrollTop: 4200 });
    const { result, rerender } = renderHook(
      ({ pk }: { pk: string }) => useAutoScroll(pk, 10),
      { initialProps: { pk: "pane-A" } },
    );
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });

    // User scrolls up in pane A → pinned=false.
    scrollEl.setScrollTop(0);
    fireScroll(scrollEl.el);
    expect(result.current.isPinnedToBottom).toBe(false);

    // Switch to pane B on the SAME hook instance (no remount — identity swap
    // within a live PrettyView). The paneKey change must reset pinned=true
    // AND jump to the current scrollHeight.
    act(() => {
      rerender({ pk: "pane-B" });
    });
    expect(result.current.isPinnedToBottom).toBe(true);
    expect(scrollEl.getScrollTop()).toBe(5000);
  });

  it("Test 10 — mount-effect scrolls to bottom on ref bind even when initialScrollTop is 0 (session-enter fix)", () => {
    // Regression for "not always scrolling to the bottom when I enter a
    // session." The pre-rewrite hook could compute pinned=false from the seed
    // onScroll if the container had pre-populated DOM (fast re-mount, warm
    // cache), then the follow effect skipped. The rewrite's mount-effect
    // unconditionally jumps + pins on ref bind, so session enter always
    // lands at the bottom regardless of pre-mount geometry.
    const scrollEl = makeScrollEl({ scrollHeight: 5000, clientHeight: 800, initialScrollTop: 0 });
    const { result } = renderHook(() => useAutoScroll("pane-A", 10));
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });
    // After ref bind, scrollTop must be at scrollHeight regardless of the
    // initialScrollTop=0 pre-condition. Pinned stays true.
    expect(scrollEl.getScrollTop()).toBe(5000);
    expect(result.current.isPinnedToBottom).toBe(true);
  });

  it("Test 11 — mount-effect does NOT overwrite scrollTop when the same hook re-renders (only fires on scrollEl / paneKey change)", () => {
    // Guardrail: the mount/paneKey effect must NOT fire on unrelated re-renders
    // (e.g. messageCount changes) or it would repeatedly yank the user to
    // bottom every time a new message arrives even after they scrolled up.
    const scrollEl = makeScrollEl({ scrollHeight: 5000, clientHeight: 800, initialScrollTop: 0 });
    const { result, rerender } = renderHook(
      ({ count }: { count: number }) => useAutoScroll("pane-A", count),
      { initialProps: { count: 10 } },
    );
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });
    // Post-mount: pinned=true, scrollTop=5000.
    expect(scrollEl.getScrollTop()).toBe(5000);

    // User scrolls up.
    scrollEl.setScrollTop(100);
    fireScroll(scrollEl.el);
    expect(result.current.isPinnedToBottom).toBe(false);

    // A new message arrives — messageCount grows, follow effect fires with
    // pinnedRef.current=false so it skips. Mount effect must NOT re-fire
    // (paneKey unchanged, scrollEl unchanged). scrollTop stays at 100.
    scrollEl.setScrollHeight(5500);
    act(() => {
      rerender({ count: 11 });
    });
    expect(scrollEl.getScrollTop()).toBe(100);
    expect(result.current.isPinnedToBottom).toBe(false);
  });

  // ── Tests 12-17 (2026-08-23, tina): first-content-arrival gate bypass ─────
  // Locks the fix for Ashley 2026-08-23: session-enter / page-refresh must land
  // at the bottom even when the first messageCount 0→positive transition happens
  // AFTER an intervening scroll event has spuriously flipped pinnedRef to false.

  it("Test 12 — first-content-arrival: scrolls to bottom on messageCount 0→positive even when pinnedRef was spuriously flipped false before content arrived", () => {
    // Spurious-flip geometry: scrollHeight=2000 > clientHeight=800 while
    // messageCount=0 — represents a container that has some scrollHeight
    // (e.g. scrollbar mount reflow, browser scroll-restoration) but no
    // rendered message children yet. A scroll event will compute
    // dist = 2000 - 0 - 800 = 1200 > BOTTOM_EPSILON → pinned=false.
    const scrollEl = makeScrollEl({ scrollHeight: 2000, clientHeight: 800, initialScrollTop: 0 });
    const { result, rerender } = renderHook(
      ({ count }: { count: number }) => useAutoScroll("pane-A", count),
      { initialProps: { count: 0 } },
    );
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });

    // Mount effect wrote scrollTop=scrollHeight. Reset to 0 to model the
    // "spurious reflow flipped pinnedRef to false" precondition. This
    // mirrors browser scroll-restoration / scrollbar-mount reflow that
    // resets scrollTop after the programmatic mount write.
    scrollEl.setScrollTop(0);

    // Spurious scroll event flips pinnedRef to false BEFORE any content arrives.
    // dist = 2000 - 0 - 800 = 1200 > BOTTOM_EPSILON → pinned=false.
    fireScroll(scrollEl.el);
    expect(result.current.isPinnedToBottom).toBe(false);

    // Now content arrives via WS backfill: scrollHeight grows and messageCount
    // transitions 0→5. First-content-arrival must bypass the pinnedRef gate.
    scrollEl.setScrollHeight(5000);
    act(() => {
      rerender({ count: 5 });
    });
    expect(scrollEl.getScrollTop()).toBe(5000);
    expect(result.current.isPinnedToBottom).toBe(true);
  });

  it("Test 13 — first-content-arrival: pinned stays true naturally → messageCount 0→positive scrolls to bottom (regression guard for the case that was already working)", () => {
    // Empty-container geometry: scrollHeight=200 < clientHeight=800 →
    // dist = 200 - 0 - 800 = -600, well under BOTTOM_EPSILON → pinned=true
    // naturally on any scroll event. This is the case that ALREADY worked
    // pre-fix; the guard ensures the fix doesn't regress it.
    const scrollEl = makeScrollEl({ scrollHeight: 200, clientHeight: 800, initialScrollTop: 0 });
    const { result, rerender } = renderHook(
      ({ count }: { count: number }) => useAutoScroll("pane-A", count),
      { initialProps: { count: 0 } },
    );
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });
    expect(result.current.isPinnedToBottom).toBe(true);

    scrollEl.setScrollHeight(5000);
    act(() => {
      rerender({ count: 5 });
    });
    expect(scrollEl.getScrollTop()).toBe(5000);
  });

  it("Test 14 — first-content-arrival: content present at mount → scroll to bottom (regression guard for warm-mount case)", () => {
    // Warm-mount: messages already populated when the ref binds. Mount
    // effect writes scrollTop=scrollHeight AND the messageCount effect
    // fires with messageCount>0 and didFirstContentScrollRef=false, so
    // first-content-arrival re-anchors + flips the flag true.
    const scrollEl = makeScrollEl({ scrollHeight: 5000, clientHeight: 800, initialScrollTop: 0 });
    const { result } = renderHook(() => useAutoScroll("pane-A", 20));
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });
    expect(scrollEl.getScrollTop()).toBe(5000);
    expect(result.current.isPinnedToBottom).toBe(true);
  });

  it("Test 15 — post-first-content no-yank preserved: first-content fires, then user scrolls up, then new message arrives → scrollTop unchanged", () => {
    // Load-bearing preservation of Test 5's invariant: after the first-
    // content-arrival flag flips true, the pinnedRef gate must apply to
    // all subsequent messageCount growth. If the user has scrolled up to
    // read history, new messages MUST NOT yank scroll back to bottom.
    const scrollEl = makeScrollEl({ scrollHeight: 2000, clientHeight: 800, initialScrollTop: 0 });
    const { result, rerender } = renderHook(
      ({ count }: { count: number }) => useAutoScroll("pane-A", count),
      { initialProps: { count: 0 } },
    );
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });

    // First content arrives — first-content-arrival fires, flag flips true.
    scrollEl.setScrollHeight(5000);
    act(() => {
      rerender({ count: 5 });
    });
    expect(scrollEl.getScrollTop()).toBe(5000);

    // User scrolls up to read history. dist = 5000 - 0 - 800 = 4200 > 100.
    scrollEl.setScrollTop(0);
    fireScroll(scrollEl.el);
    expect(result.current.isPinnedToBottom).toBe(false);

    // New message arrives — flag is now true, so pinnedRef gate applies.
    scrollEl.setScrollHeight(5500);
    act(() => {
      rerender({ count: 10 });
    });
    // CRITICAL: no yank. scrollTop stays where the user left it.
    expect(scrollEl.getScrollTop()).toBe(0);
    expect(result.current.isPinnedToBottom).toBe(false);
  });

  it("Test 16 — pane switch resets first-content flag: pane A first-content fires, switch to pane B, spurious pinned=false, pane B first-content still fires", () => {
    // Pane-swap on same PrettyView instance must re-arm first-content-
    // arrival behavior for the new pane (fresh pane gets fresh auto-anchor
    // even if the prior pane was scrolled up when swapped).
    const scrollEl = makeScrollEl({ scrollHeight: 2000, clientHeight: 800, initialScrollTop: 0 });
    const { result, rerender } = renderHook(
      ({ pk, count }: { pk: string; count: number }) => useAutoScroll(pk, count),
      { initialProps: { pk: "pane-A", count: 0 } },
    );
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });

    // Pane A: content arrives, first-content-arrival fires, flag=true.
    scrollEl.setScrollHeight(5000);
    act(() => {
      rerender({ pk: "pane-A", count: 5 });
    });
    expect(scrollEl.getScrollTop()).toBe(5000);

    // Switch to pane B (empty). Mount/paneKey effect re-fires, resets
    // pinnedRef=true AND didFirstContentScrollRef=false, writes
    // scrollTop=scrollHeight=200 (empty pane B).
    scrollEl.setScrollHeight(200);
    scrollEl.setScrollTop(0);
    act(() => {
      rerender({ pk: "pane-B", count: 0 });
    });
    expect(scrollEl.getScrollTop()).toBe(200);

    // Spurious scroll flips pinnedRef=false on pane B (scrollbar-mount
    // reflow updated geometry to non-empty while count still 0).
    scrollEl.setScrollHeight(2000);
    scrollEl.setScrollTop(0);
    fireScroll(scrollEl.el);
    expect(result.current.isPinnedToBottom).toBe(false);

    // Pane B content arrives — first-content-arrival fires again (fresh
    // pane, flag was reset by the mount/paneKey effect).
    scrollEl.setScrollHeight(4000);
    act(() => {
      rerender({ pk: "pane-B", count: 3 });
    });
    expect(scrollEl.getScrollTop()).toBe(4000);
    expect(result.current.isPinnedToBottom).toBe(true);
  });

  // ── Tests 18-19 (2026-09-01, tina): belt-and-suspenders write-time gate ──
  // Locks the fix for Ashley 2026-09-01. In production the IntersectionObserver
  // callback never fired in her browser (37 pv-scroll-diag events, 0
  // sentinel-intersect events), leaving pinnedRef stuck at its initial `true`
  // (scroll listener had been demoted to `!hasIO` fallback, IO owned pinning
  // but wasn't firing) → every new message yanked her viewport to the bottom
  // regardless of where she was scrolled. Fix removes the `!hasIO` gate on
  // the scroll listener (so it owns pinnedRef authoritatively again) AND
  // adds a direct scroll-position measurement at write time in follow +
  // observer effects — so even if pinnedRef ever drifts stale-true, the
  // write is skipped if the user is actually scrolled up.
  //
  // These two tests simulate the pre-fix production condition (pinnedRef is
  // true but scrollTop is not at bottom) and assert the fix refuses to yank.
  // They complement Test 5 (which asserts the pinnedRef gate) by covering
  // the case where pinnedRef itself has drifted.
  it("Test 18 — belt-and-suspenders: follow effect uses direct scroll-position measurement even when pinnedRef is stale-true", () => {
    const scrollEl = makeScrollEl({ scrollHeight: 5000, clientHeight: 800, initialScrollTop: 4200 });
    const { result, rerender } = renderHook(
      ({ count }: { count: number }) => useAutoScroll("pane-A", count),
      { initialProps: { count: 10 } },
    );
    act(() => {
      result.current.scrollRef(scrollEl.el);
    });
    // Post-mount: pinnedRef=true (fresh), scrollTop=5000 (mount effect wrote).
    // Simulate the pre-fix production bug: scrollTop drifts to 0 WITHOUT a
    // scroll event firing (so the scroll listener never updates pinnedRef).
    // In production this happened because IO owned pinning + never fired;
    // pinnedRef stayed initialized-true even though the container's visible
    // position was at the top.
    scrollEl.setScrollTop(0);
    // Note: no fireScroll() here — that's the whole point. The scroll
    // listener never sees the position change (mimicking a browser where
    // scroll events don't propagate for whatever reason, or where the
    // programmatic write happened before the listener attached).

    // A new message arrives — messageCount grows, follow effect fires.
    scrollEl.setScrollHeight(5500);
    act(() => {
      rerender({ count: 11 });
    });
    // CRITICAL: scrollTop must still be 0. The follow effect must have
    // re-measured position at write time (dist = 5500 - 0 - 800 = 4700 >
    // BOTTOM_EPSILON) and refused to yank, even though pinnedRef was
    // stale-true.
    expect(scrollEl.getScrollTop()).toBe(0);
  });

  it("Test 19 — belt-and-suspenders: observer effect uses direct scroll-position measurement even when pinnedRef is stale-true", async () => {
    if (typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }
    const scrollEl = document.createElement("div");
    document.body.appendChild(scrollEl);
    let scrollHeightState = 5000;
    let clientHeightState = 800;
    let scrollTopState = 4200;
    Object.defineProperty(scrollEl, "scrollHeight", {
      get: () => scrollHeightState,
      configurable: true,
    });
    Object.defineProperty(scrollEl, "clientHeight", {
      get: () => clientHeightState,
      configurable: true,
    });
    Object.defineProperty(scrollEl, "scrollTop", {
      get: () => scrollTopState,
      set: (v: number) => {
        scrollTopState = v;
      },
      configurable: true,
    });
    void clientHeightState;

    // Seed a first child so the observer's first-content-arrival branch is
    // already consumed BEFORE the test-of-interest mutation fires (otherwise
    // isFirstContentArrival would bypass the measurement gate and pass the
    // assertion for the wrong reason).
    scrollEl.appendChild(document.createElement("div"));

    const { result, unmount } = renderHook(() => useAutoScroll("pane-D", 1));
    act(() => {
      result.current.scrollRef(scrollEl);
    });

    // Wait for the initial mount + first-content-arrival RAF to flush.
    await act(async () => {
      await new Promise<void>((r) => {
        requestAnimationFrame(() => r());
      });
    });

    // Simulate the stale-true drift: scrollTop moves to 0 without firing a
    // scroll event. pinnedRef stays true.
    scrollTopState = 0;

    // A new child mounts — mutation observer fires, RAF runs. Without the
    // belt-and-suspenders measurement, this would yank scrollTop to
    // scrollHeight even though the user is at the top.
    scrollHeightState = 5500;
    await act(async () => {
      const child = document.createElement("div");
      scrollEl.appendChild(child);
      await new Promise<void>((r) => {
        requestAnimationFrame(() => r());
      });
    });

    // CRITICAL: scrollTop must still be 0. The observer must have
    // re-measured and refused to yank.
    expect(scrollTopState).toBe(0);

    unmount();
    scrollEl.remove();
  });

  it("Test 17 — observer-path first-content-arrival: MutationObserver sees first children while pinned=false → RAF still writes", async () => {
    // Skip guard: matches the hook's own bail-out (use-auto-scroll.ts line 114)
    // so this test is a no-op in RO-less jsdom. Tests 12-16 do not rely on
    // RO/MO, so they remain valid regardless.
    if (typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }

    // Real DOM parent so MutationObserver can observe childList reliably.
    // Inline defineScrollGeometry helper — do NOT globally refactor
    // makeScrollEl (single-use pattern for this observer-path test).
    const scrollEl = document.createElement("div");
    document.body.appendChild(scrollEl);
    let scrollHeightState = 2000;
    let clientHeightState = 800;
    let scrollTopState = 0;
    Object.defineProperty(scrollEl, "scrollHeight", {
      get: () => scrollHeightState,
      configurable: true,
    });
    Object.defineProperty(scrollEl, "clientHeight", {
      get: () => clientHeightState,
      configurable: true,
    });
    Object.defineProperty(scrollEl, "scrollTop", {
      get: () => scrollTopState,
      set: (v: number) => {
        scrollTopState = v;
      },
      configurable: true,
    });
    void clientHeightState;

    const { result, unmount } = renderHook(() => useAutoScroll("pane-C", 0));
    act(() => {
      result.current.scrollRef(scrollEl);
    });

    // Spurious scroll flips pinned=false: dist = 2000 - 0 - 800 = 1200 > 100.
    act(() => {
      scrollEl.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isPinnedToBottom).toBe(false);

    // Set the new scrollHeight BEFORE the RAF fires so the observer's write
    // sees the populated geometry when it anchors.
    scrollHeightState = 5000;

    // Mount a first child — MO fires childList mutation, scheduleCheck
    // runs, RAF fires. Observer's first-content-arrival must bypass the
    // pinnedRef gate.
    await act(async () => {
      const child = document.createElement("div");
      scrollEl.appendChild(child);
      await new Promise<void>((r) => {
        requestAnimationFrame(() => r());
      });
    });

    expect(scrollTopState).toBe(5000);

    unmount();
    scrollEl.remove();
  });
});
