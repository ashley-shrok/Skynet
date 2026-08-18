/**
 * Phase 27 (virtualize-prettyview-message-list) Wave 3 (Plan 27-03) —
 * PrettyView virtualization integration tests.
 *
 * Empirically verifies the phase's core must-haves against the real
 * TanStack Virtual virtualizer + real DOM (JSDOM), NOT via mocks of the
 * virtualizer itself. Covers:
 *
 *   Test 1  — bounded DOM cap (≤ 30 [data-pv-bubble] subtrees) on a
 *             100+ msg conversation (CONTEXT.md § Success criteria #2/#3;
 *             the phase's raison d'être).
 *   Test 2  — auto-scroll-to-bottom-when-pinned still works over the
 *             virtualized layout (CONTEXT.md § Success criteria #4).
 *   Test 3  — don't-yank-when-scrolled-up (CONTEXT.md § Success criteria #5).
 *   Test 4  — getItemKey identity via the observable `data-event-id` DOM
 *             attribute (per checker Warning 4; NOT React-key inspection).
 *             Regression here means measurement-cache would invalidate on
 *             every dedup / reorder / prepend (SURPRISE #2).
 *   Test 5a — AsideBubble renders as a sibling of the sized virtualizer
 *             container, INSIDE the outer scroll container (CONTEXT.md
 *             § Success criteria #8 layout invariant, Wave 2 Step B shape).
 *   Test 5b — PlanPendingBubble renders as a sibling of the sized
 *             virtualizer container, INSIDE the outer scroll container.
 *
 * Test 5 (the deliberately-dropped image-bubble re-measure test) is NOT
 * in this file per checker Warning 3 — the available ResizeObserver stubs
 * cannot reliably drive TanStack Virtual's per-item measureElement ROs.
 * That must_have is verified by the Wave 2 Step B manual smoke check
 * documented in 27-02-SUMMARY (deferred to post-deploy production UAT).
 *
 * Infrastructure: verbatim copies of the wsStubs + getCurrentWs +
 * openClaudeSessionSocket factory pattern from PrettyView.test.tsx, and
 * the no-op resizeObserverStub pattern from PrettyView.aside.test.tsx.
 * Per Plan 27-03 step 6: do NOT mock @tanstack/react-virtual itself —
 * test the real virtualizer against real DOM.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, fireEvent } from "@testing-library/react";

// ── WS stub scaffolding (verbatim copy from PrettyView.test.tsx) ───────────

type WsStub = {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
const wsStubs: WsStub[] = [];
function getCurrentWs(): WsStub {
  return wsStubs[wsStubs.length - 1];
}

vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => {
    const ws: WsStub = {
      readyState: 1, // OPEN
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onopen: null,
      onerror: null,
      onclose: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    wsStubs.push(ws);
    return ws;
  }),
}));

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: vi.fn(() => null),
  useSessionIdentity: vi.fn(() => ({ identity: null, identityHue: null })),
}));

vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: () => null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

import { PrettyView } from "./PrettyView";

// ── WS-frame helpers ──────────────────────────────────────────────────────

function flipToStreaming(ws: WsStub): void {
  act(() => {
    ws.onopen?.();
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }),
      }),
    );
  });
}

function fireWsMessage(ws: WsStub, payload: object): void {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(payload),
      }),
    );
  });
}

// Fire a batch of message frames — one act() call so React commits them
// together and the virtualizer only measures the final state.
function fireMessageBatch(
  ws: WsStub,
  count: number,
  makePayload: (i: number) => Record<string, unknown>,
): void {
  act(() => {
    for (let i = 0; i < count; i++) {
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify(makePayload(i)),
        }),
      );
    }
  });
}

// ── DOM helpers ───────────────────────────────────────────────────────────

// Find the outer scroll container — the div that owns composeScrollRefs
// (the [data-pv-bubble] items live inside its sized virtualizer child).
// Located as: the parent of the sized virtualizer container, which itself
// is the parent of any [data-pv-bubble] element. In pathological empty
// cases the sized container has no bubbles but is still the FIRST child
// of the outer scroll container. Both accessors below deal with the case
// where messages have already been fired.
function getOuterScrollContainer(container: HTMLElement): HTMLElement {
  const sized = getSizedVirtualizerContainer(container);
  const parent = sized.parentElement;
  if (!parent) {
    throw new Error("sized virtualizer container has no parent — cannot find outer scroll container");
  }
  return parent as HTMLElement;
}

// The sized virtualizer container is the direct parent of the first
// [data-pv-bubble] element. If no bubbles are mounted yet, fall back to
// looking for the div with an inline style containing `height:` and
// `position: relative` — the shape Wave 2 uses.
function getSizedVirtualizerContainer(container: HTMLElement): HTMLElement {
  const firstBubble = container.querySelector("[data-pv-bubble]");
  if (firstBubble && firstBubble.parentElement) {
    return firstBubble.parentElement as HTMLElement;
  }
  // Fallback: find the div whose inline style matches the virtualizer
  // container shape (height: <px>; position: relative).
  const candidates = container.querySelectorAll("div[style*='position: relative']");
  for (const c of candidates) {
    const s = (c as HTMLElement).style;
    if (s.height && s.position === "relative") return c as HTMLElement;
  }
  throw new Error("could not locate sized virtualizer container");
}

// Mount the scroll container's clientHeight to a known, small value so
// the virtualizer's visible slice + overscan is small enough that
// bounded-DOM assertions have real bite. Without this, the virtualizer's
// observeElementRect fallback yields a 4096px height → too many items
// visible to prove the "≤ 30 subtrees on a 100+ msg convo" bound.
//
// We override BOTH offsetHeight (which the custom observeElementRect
// reads) AND clientHeight/scrollHeight/scrollTop (which useAutoScroll
// reads) so both readers see the shrunk viewport.
function shrinkScrollContainer(el: HTMLElement, clientHeight: number, scrollHeight: number): {
  setScrollHeight: (v: number) => void;
  setScrollTop: (v: number) => void;
  getScrollTop: () => number;
} {
  let scrollHeightState = scrollHeight;
  let scrollTopState = 0;
  Object.defineProperty(el, "offsetHeight", {
    get: () => clientHeight,
    configurable: true,
  });
  Object.defineProperty(el, "offsetWidth", {
    get: () => 1024,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    get: () => clientHeight,
    configurable: true,
  });
  Object.defineProperty(el, "scrollHeight", {
    get: () => scrollHeightState,
    configurable: true,
  });
  Object.defineProperty(el, "scrollTop", {
    get: () => scrollTopState,
    set: (v: number) => {
      scrollTopState = v;
    },
    configurable: true,
  });
  return {
    setScrollHeight: (v: number) => {
      scrollHeightState = v;
    },
    setScrollTop: (v: number) => {
      scrollTopState = v;
    },
    getScrollTop: () => scrollTopState,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────

describe("PrettyView virtualization — Phase 27 Plan 27-03", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;
  // Capturing store for ResizeObserver callbacks — some tests need to fire
  // a specific callback manually (Test 1 needs the virtualizer's own
  // observeElementRect-installed RO to re-read the shrunk offsetHeight;
  // the useAutoScroll RO is captured too but we don't need to fire it).
  const capturedROCallbacks: ResizeObserverCallback[] = [];
  // Save/restore original prototype methods so we can override without
  // polluting sibling test files.
  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;
  const originalOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    capturedROCallbacks.length = 0;
    // JSDOM lacks ResizeObserver; useAutoScroll's effect calls
    // `new ResizeObserver(...)` at mount, and TanStack Virtual's
    // measureElement path also constructs per-item ROs. Widened from the
    // no-op stub in PrettyView.aside.test.tsx :122-127 to a capturing
    // multi-slot stub (per 27-PATTERNS.md SURPRISE #3 mitigation note:
    // widen the polyfill so per-item ROs don't overwrite the useAutoScroll
    // one). We store every callback in `capturedROCallbacks` so tests
    // that need to fire a specific RO can do so.
    resizeObserverStub = vi.fn(function (cb: ResizeObserverCallback) {
      capturedROCallbacks.push(cb);
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
    // Give every [data-pv-bubble] a non-zero measured height so TanStack
    // Virtual's `measureElement` cache is populated with realistic sizes
    // instead of JSDOM's default 0-height (which collapses totalSize to 0
    // and defeats the virtualization slice — every item ends up rendered).
    // Non-bubble elements fall through to the original prototype method.
    HTMLElement.prototype.getBoundingClientRect = function (): DOMRect {
      if (this.hasAttribute && this.hasAttribute("data-pv-bubble")) {
        return {
          top: 0,
          left: 0,
          right: 1024,
          bottom: 80,
          width: 1024,
          height: 80,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalGetBoundingClientRect.call(this);
    };
    // TanStack Virtual v3's measureElement path reads `element.offsetHeight`
    // when no ResizeObserver entry is available (virtual-core/index.js:150).
    // JSDOM's default offsetHeight is 0 for every element, which collapses
    // measurement-cache entries to 0 and — since itemSizeCache overrides
    // estimateSize — makes getTotalSize() return 0. Override the getter to
    // return 80 for [data-pv-bubble] items so their measurements match
    // estimateSize=80 and totalSize adds up correctly.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(): number {
        if (this.hasAttribute && this.hasAttribute("data-pv-bubble")) {
          return 80;
        }
        // Fall back to any previously-installed per-element override
        // (Test 2/3 install their own offsetHeight overrides on the scroll
        // container). We can't easily chain the original prototype getter
        // — return 0 as JSDOM's default. Tests that need a specific value
        // set it via Object.defineProperty on the element directly, which
        // shadows this prototype getter.
        return 0;
      },
    });
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect =
      originalGetBoundingClientRect;
    if (originalOffsetHeightDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        originalOffsetHeightDescriptor,
      );
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Test 1: bounded DOM — 120 messages produces ≤ 30 [data-pv-bubble] subtrees", async () => {
    // CONTEXT.md § Success criteria #2/#3 — the phase's core empirical
    // must-have. With estimateSize=80 and a 600px clientHeight the
    // virtualizer's visible slice + overscan (5 each direction) is
    // ~600/80 + 10 = ~17.5 items — well under the 30 cap.
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Fire 120 message frames to blow well past the 100-msg must-have
    // threshold. Batched in a single act() so React commits once and
    // the virtualizer sees the final message count when it measures.
    fireMessageBatch(ws, 120, (i) => ({
      type: "message",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
      eventId: `evt-${i}`,
      ts: 1_000_000 + i,
    }));

    // Locate the outer scroll container AFTER frames are committed so the
    // sized virtualizer container exists in the DOM.
    let outerScroll: HTMLElement;
    await waitFor(() => {
      outerScroll = getOuterScrollContainer(container);
      expect(outerScroll).toBeTruthy();
    });

    // Shrink the scroll container's viewport so the virtualizer's fallback
    // observeElementRect reads a small height instead of the 4096px default,
    // producing a small visible slice. The virtualizer's own
    // observeElementRect binding (PrettyView.tsx :646-661) reads offsetWidth/
    // offsetHeight synchronously on bind AND on each ResizeObserver fire.
    // Since JSDOM's RO stub never fires on its own, we manually invoke
    // every captured RO callback to force a re-read AFTER shrinking.
    shrinkScrollContainer(outerScroll!, 600, 0);
    act(() => {
      for (const cb of capturedROCallbacks) {
        cb([], {} as ResizeObserver);
      }
    });
    // Fire one more frame so the virtualizer definitely commits a fresh
    // render with the new visible-slice size.
    fireWsMessage(ws, {
      type: "message",
      role: "assistant",
      content: "final message",
      eventId: "evt-120",
      ts: 1_000_120,
    });

    // Assert the bounded DOM cap: bubbles.length <= 30 (CONTEXT.md
    // § verification-anchor — the phase's core empirical must-have).
    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBeGreaterThan(0);
      expect(bubbles.length).toBeLessThanOrEqual(30);
    });
  });

  // PHASE 43 / plan 43-06: this test asserted the OLD useAutoScroll hook's
  // paneKey-change rAF chain semantics (advances timers by 200ms to let the
  // STICK_ARM_MS=150ms rAF-loop pump scrollTop to bottom). Phase 43's rewrite
  // deleted the rAF chain — the new hook seeds pinned=true and relies on the
  // messageCount effect (which runs before shrinkScrollContainer installs the
  // scroll geometry mock in this test's setup). Skipped here because this
  // whole file is scheduled for deletion in plan 43-07a alongside the
  // TanStack Virtual removal. The load-bearing "don't yank when scrolled up"
  // regression (this file's Test 3) still passes against the new hook, and
  // the equivalent scroll-listener / follow-on-new / no-yank / cleanup /
  // API-surface behaviors are covered by the new use-auto-scroll.test.ts
  // added in this same plan.
  it.skip("Test 2: session first load lands at bottom — scrollTop jumps to bottom via paneKey rAF-chain over virtualized layout", async () => {
    // CONTEXT.md § Test coverage scenario 1 ("Session first load lands at
    // bottom"). Phase 32 useAutoScroll's paneKey-change useEffect
    // (use-auto-scroll.ts § Case 1, ~L96-114) arms a rAF-chain that writes
    // scrollTop = scrollHeight every frame for STICK_ARM_MS (150ms). That
    // primitive works uniformly over any scrollable container — including
    // the virtualized one whose scrollHeight derives from
    // `rowVirtualizer.getTotalSize() + accessory heights`. Test proves the
    // primitive still fires end-to-end through PrettyView's wire-through.
    //
    // rAF-in-JSDOM: vitest's fake-timer wrapper does NOT polyfill
    // requestAnimationFrame by default. We stub it via setTimeout(..., 16)
    // so vi.advanceTimersByTime() flushes the rAF chain synchronously —
    // same pattern that lets the hook's chain ticks run under fake timers.
    vi.useFakeTimers();
    try {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
        setTimeout(() => cb(performance.now()), 16),
      );
      const { container } = render(
        <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
      );
      const ws = getCurrentWs();
      flipToStreaming(ws);

      // Populate enough messages that the virtualizer has real content
      // to size against.
      fireMessageBatch(ws, 20, (i) => ({
        type: "message",
        role: "assistant",
        content: `message ${i}`,
        eventId: `evt-${i}`,
        ts: 1_000_000 + i,
      }));

      // Mount geometry: viewport 600px, scrollHeight 5000px (well past
      // viewport). scrollTop starts at 0 — user has NOT scrolled anywhere.
      const outerScroll = getOuterScrollContainer(container);
      const geom = shrinkScrollContainer(outerScroll, 600, 5000);
      expect(geom.getScrollTop()).toBe(0);

      // Advance timers past STICK_ARM_MS (150ms) so the paneKey-change
      // useEffect's rAF chain completes its jumpToBottom writes. 200ms is
      // a comfortable overshoot that guarantees the chain has run its
      // final tick and settled.
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // scrollTop should have been driven to scrollHeight (=5000) by the
      // rAF-chain. This is the "session first load lands at bottom"
      // primitive firing over the virtualized-DOM scroll container.
      expect(geom.getScrollTop()).toBe(5000);
    } finally {
      vi.useRealTimers();
    }
  });

  // PHASE 43 / plan 43-06: this test's baseline `expect(scrollTop).toBe(5000)`
  // after `vi.advanceTimersByTime(200)` was written against the OLD hook's rAF
  // chain. The follow-when-pinned semantic it verifies IS preserved by the new
  // hook, but not via a time-pumped rAF loop — verified instead by
  // use-auto-scroll.test.ts Test 4 (follow-when-pinned direct assertion).
  // Skipped here pending file deletion in plan 43-07a.
  it.skip("Test 2b: incoming message while at bottom — follows (pin-to-bottom via new-message useEffect on messageCount growth)", async () => {
    // CONTEXT.md § Test coverage scenario 2 ("New messages while already
    // at bottom → follow"). After the paneKey rAF-chain lands us at
    // bottom (stickyRef.current === true), a subsequent message arrival
    // must drive a follow-to-bottom.
    //
    // Under the post-2026-08-13 correction the follow is driven by the
    // new-message useEffect (use-auto-scroll.ts § Case 2, keyed on
    // [scrollEl, messageCount, jumpToBottom]) — NOT by the RO. RO fires
    // are now setIsPinnedToBottom-only. fireWsMessage below appends via
    // setMessages, which grows messages.length; PrettyView passes
    // messages.length to useAutoScroll; the useEffect fires on that dep
    // change and calls jumpToBottom(scrollEl) because stickyRef.current
    // is still true. No manual RO fire needed here.
    vi.useFakeTimers();
    try {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
        setTimeout(() => cb(performance.now()), 16),
      );
      const { container } = render(
        <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
      );
      const ws = getCurrentWs();
      flipToStreaming(ws);

      fireMessageBatch(ws, 20, (i) => ({
        type: "message",
        role: "assistant",
        content: `message ${i}`,
        eventId: `evt-${i}`,
        ts: 1_000_000 + i,
      }));

      const outerScroll = getOuterScrollContainer(container);
      const geom = shrinkScrollContainer(outerScroll, 600, 5000);

      // Let the paneKey rAF chain settle so scrollTop lands at 5000
      // (baseline = at bottom, sticky = true).
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(geom.getScrollTop()).toBe(5000);

      // Simulate content growth: bump the mocked scrollHeight and fire a
      // fresh WS frame so real DOM content is added AND messages.length
      // grows in the component's setMessages handler. That drives the
      // new-message useEffect (keyed on messageCount) to fire jumpToBottom.
      geom.setScrollHeight(5200);
      fireWsMessage(ws, {
        type: "message",
        role: "assistant",
        content: "new frame while at bottom",
        eventId: "evt-new",
        ts: 2_000_000,
      });

      // Let the new-message useEffect commit + its rAF-based
      // programmaticRef clear settle.
      act(() => {
        vi.advanceTimersByTime(50);
      });

      // The new-message useEffect fires jumpToBottom(scrollEl) because
      // stickyRef.current is still true (user never scrolled up). scrollTop
      // follows to the new scrollHeight (5200). The RO no longer drives
      // this follow — it only updates pill visibility now.
      expect(geom.getScrollTop()).toBe(5200);
    } finally {
      vi.useRealTimers();
    }
  });

  // PHASE 43 / plan 43-06: this test guarded the 2026-08-13 Phase 32 correction
  // that split the RO callback from jumpToBottom. That whole RO machinery is
  // GONE in the Phase 43 rewrite (there's no ResizeObserver in the new hook at
  // all), so the tall-bubble-remeasure-yank class of bug is eliminated by
  // construction — no callback that could ever write scrollTop on a resize.
  // The rAF-chain baseline this test depends on is likewise gone. Skipped
  // here pending file deletion in plan 43-07a.
  it.skip("Test 2c: tall-bubble re-measure while sticky — RO-only fire (no new message) does NOT trigger jumpToBottom (post-2026-08-13 correction; pre-fix would have yanked to 5800)", async () => {
    // Post-2026-08-13 correction (Ashley: "snaps back to the bottom or
    // jumps to a completely different area … coincides with very tall
    // bubbles"). The Phase 32 Case 2 useEffect conflated "new message
    // arrived" with "existing bubble re-measured by TanStack Virtual" —
    // both fired the same RO callback which called jumpToBottom. Under
    // the correction Case 2 is split: new-message useEffect (keyed on
    // messageCount) is the ONLY jumpToBottom-on-arrival path; the
    // retained RO callback is setIsPinnedToBottom-only.
    //
    // This test is the invariant witness — it FAILS under the pre-fix
    // hook (RO fires with no new message → jumpToBottom yanks scrollTop
    // to 5800) and PASSES under the post-fix hook (RO fires with no new
    // message → setIsPinnedToBottom only → scrollTop stays at 5000).
    vi.useFakeTimers();
    try {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
        setTimeout(() => cb(performance.now()), 16),
      );
      const { container } = render(
        <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
      );
      const ws = getCurrentWs();
      flipToStreaming(ws);

      fireMessageBatch(ws, 20, (i) => ({
        type: "message",
        role: "assistant",
        content: `message ${i}`,
        eventId: `evt-${i}`,
        ts: 1_000_000 + i,
      }));

      const outerScroll = getOuterScrollContainer(container);
      const geom = shrinkScrollContainer(outerScroll, 600, 5000);

      // Let the paneKey rAF chain settle so scrollTop lands at 5000
      // (baseline = at bottom, sticky = true).
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(geom.getScrollTop()).toBe(5000);

      // Simulate a tall-bubble re-measure: an image bubble whose
      // estimatePvBubbleSize=400px ceiling proves too small when the real
      // decoded height (on a wide viewport) exceeds it. TanStack Virtual's
      // measurement path re-measures and scrollHeight grows — but NO new
      // message has arrived, so messages.length is unchanged.
      geom.setScrollHeight(5800);

      // Manually fire captured RO callbacks — this is the browser's RO
      // firing on the scrollHeight growth. Under the pre-fix hook, this
      // callback would have called jumpToBottom → scrollTop yanks to 5800.
      // Under the post-fix hook, this callback is setIsPinnedToBottom-only
      // → scrollTop stays at 5000.
      act(() => {
        for (const cb of capturedROCallbacks) {
          cb([], {} as ResizeObserver);
        }
      });

      // Let any deferred rAF settle.
      act(() => {
        vi.advanceTimersByTime(50);
      });

      // Critical assertion: NO auto-jump. scrollTop stays at 5000. This
      // is the invariant the 2026-08-13 correction ships.
      expect(geom.getScrollTop()).toBe(5000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Test 3: incoming message while scrolled up — does NOT yank to bottom (scroll-listener source)", async () => {
    // CONTEXT.md § Test coverage scenario 3 ("Incoming message while
    // scrolled up → do NOT yank"). Under the Phase 32 hook, `scroll` is
    // the SINGLE event source (wheel/keydown/touchmove listeners are
    // gone — CONTEXT.md § Event handling LOCK). The user scrolling up
    // fires a scroll event whose scrollTop is below the previous value;
    // the hook's scroll listener (use-auto-scroll.ts § scroll listener,
    // ~L146-177) flips stickyRef.current = false. Subsequent RO fires
    // then take the !stickyRef branch and only recompute pill
    // visibility — they NEVER write scrollTop.
    //
    // The programmaticRef gate skips our own writes; the sub-20px
    // MEASUREMENT_DELTA_IGNORE_PX gate skips TanStack Virtual's
    // measurement-adjustment writes. Neither applies here: the delta
    // between the initial scrollTop (0) and the mocked 1000 is >20px,
    // and no programmaticRef.current is set at test-time.
    vi.useFakeTimers();
    try {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
        setTimeout(() => cb(performance.now()), 16),
      );
      const { container } = render(
        <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
      );
      const ws = getCurrentWs();
      flipToStreaming(ws);

      fireMessageBatch(ws, 20, (i) => ({
        type: "message",
        role: "assistant",
        content: `message ${i}`,
        eventId: `evt-${i}`,
        ts: 1_000_000 + i,
      }));

      const outerScroll = getOuterScrollContainer(container);
      const geom = shrinkScrollContainer(outerScroll, 600, 5000);

      // Let the paneKey rAF chain settle (baseline at bottom, sticky).
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Two-step scroll dispatch to properly simulate "user scrolls up
      // from bottom." The scroll listener's `lastScrollTop` closure
      // captures scrollEl.scrollTop at effect-attach time, and our own
      // programmatic writes are gated out (programmaticRef guard) so
      // the listener never sees them. We therefore first dispatch a
      // scroll event at the current mocked bottom (5000) to sync the
      // listener's baseline to a value that matches what the user
      // sees, THEN dispatch a scroll event at 1000 so the listener
      // observes `now (1000) < lastScrollTop (5000)` and flips
      // stickyRef.current = false. Under the new hook, `scroll` is the
      // single event source (wheel/keydown/touchmove listeners are
      // gone — CONTEXT.md § Event handling LOCK).
      geom.setScrollTop(5000);
      act(() => {
        outerScroll.dispatchEvent(new Event("scroll"));
      });
      geom.setScrollTop(1000);
      act(() => {
        outerScroll.dispatchEvent(new Event("scroll"));
      });

      // Fire a new frame. The critical assertion: scrollTop was NOT
      // driven back to scrollHeight (5000). It stays at 1000.
      // Bump scrollHeight to simulate content growth from the new frame
      // — if the hook incorrectly yanked, scrollTop would follow.
      geom.setScrollHeight(5200);
      fireWsMessage(ws, {
        type: "message",
        role: "assistant",
        content: "new frame after user scrolled up",
        eventId: "evt-new",
        ts: 2_000_000,
      });

      // Fire RO callbacks — under the post-2026-08-13 correction the RO
      // ONLY updates pill visibility (setIsPinnedToBottom); this fires
      // that path and confirms no scrollTop write. New-message useEffect
      // also does nothing because stickyRef.current is false (user
      // scrolled up).
      act(() => {
        for (const cb of capturedROCallbacks) {
          cb([], {} as ResizeObserver);
        }
      });

      // Give React + any RO/rAF a chance to run.
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(geom.getScrollTop()).toBe(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  // PHASE 43 / plan 43-06: same rAF-chain baseline dependency as Test 2b/2c.
  // The scrollToBottomAndFollow behavior it verifies IS preserved and covered
  // directly by use-auto-scroll.test.ts Test 6 (scrollToBottomAndFollow
  // synchronously sets scrollTop = scrollHeight AND flips isPinnedToBottom
  // to true). Skipped here pending file deletion in plan 43-07a.
  it.skip("Test 2d: user send from scrolled-up state — forces scroll to bottom via handleComposeSend → scrollToBottomAndFollow", async () => {
    // CONTEXT.md § Test coverage scenario 4 ("User send from any state →
    // force bottom"). Even after the user has un-stuck by scrolling up
    // (stickyRef.current === false), invoking handleComposeSend via the
    // ComposeBox Send button must re-stick and jump back to bottom.
    // handleComposeSend (PrettyView.tsx L610-628) closes over the hook's
    // scrollToBottomAndFollow (use-auto-scroll.ts § Case 3, ~L182-195)
    // and calls it after invoking onSend — the send is the strongest
    // possible "I want to see the reply" signal.
    //
    // We drive this via the real ComposeBox UI (Option A per plan §
    // Change 4): type into the compose textarea and click the Send
    // button (aria-label="Send"). ComposeBox test patterns already
    // exercise this shape (ComposeBox.test.tsx Test 7 L262-269, Test 13
    // L338-341). Option A gives true end-to-end wire-through
    // verification — the whole point of scenario 4.
    vi.useFakeTimers();
    try {
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
        setTimeout(() => cb(performance.now()), 16),
      );
      const { container, getByRole, getByPlaceholderText } = render(
        <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
      );
      const ws = getCurrentWs();
      flipToStreaming(ws);

      fireMessageBatch(ws, 20, (i) => ({
        type: "message",
        role: "assistant",
        content: `message ${i}`,
        eventId: `evt-${i}`,
        ts: 1_000_000 + i,
      }));

      const outerScroll = getOuterScrollContainer(container);
      const geom = shrinkScrollContainer(outerScroll, 600, 5000);

      // Baseline: paneKey rAF chain lands at bottom (sticky).
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(geom.getScrollTop()).toBe(5000);

      // User scrolls up — flips stickyRef.current to false via the
      // single scroll listener (same two-step baseline pattern as
      // Test 3: sync listener's `lastScrollTop` closure to the mocked
      // bottom first, then dispatch the down-scroll so the listener
      // observes `now < lastScrollTop`).
      geom.setScrollTop(5000);
      act(() => {
        outerScroll.dispatchEvent(new Event("scroll"));
      });
      geom.setScrollTop(1000);
      act(() => {
        outerScroll.dispatchEvent(new Event("scroll"));
      });
      // Verify we're NOT sticky (baseline for the send assertion).
      expect(geom.getScrollTop()).toBe(1000);

      // Drive the compose Send flow via the real ComposeBox UI. Pattern
      // mirrors ComposeBox.test.tsx Test 7 (L262-269) + Test 13 (L338-341):
      // fireEvent.change writes the value + dispatches an input event that
      // ComposeBox's textarea onChange handler consumes.
      const textarea = getByPlaceholderText(/message/i) as HTMLTextAreaElement;
      act(() => {
        fireEvent.change(textarea, { target: { value: "user follow-up" } });
      });

      // Quick 260814-1hz: the hold-to-record gesture moved off the Send
      // button (patch #436 Phase 32 wiring) and onto the MicButton. The
      // Send button is back to plain onClick={handleSend}, so fireEvent.click
      // fires the send path directly. No navigator.mediaDevices stub is
      // required here because no voice.start is invoked from a Send-button
      // click anymore.
      const originalNavigator = globalThis.navigator;
      Object.defineProperty(globalThis, "navigator", {
        value: { mediaDevices: { getUserMedia: vi.fn(() => new Promise(() => {})) } },
        writable: true,
        configurable: true,
      });
      try {
        const sendBtn = getByRole("button", { name: "Send" });
        await act(async () => {
          fireEvent.click(sendBtn);
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });

        // scrollToBottomAndFollow enters sticky + jumps + brief rAF re-arm
        // for STICK_ARM_MS (150ms). 200ms overshoot flushes the chain.
        act(() => {
          vi.advanceTimersByTime(200);
        });

        // The send should have re-stuck and jumped back to bottom. If the
        // wire-through (handleComposeSend → scrollToBottomAndFollow) is
        // broken, scrollTop would remain at 1000.
        expect(geom.getScrollTop()).toBe(5000);
      } finally {
        Object.defineProperty(globalThis, "navigator", {
          value: originalNavigator,
          writable: true,
          configurable: true,
        });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("Test 4: getItemKey identity via data-event-id — each [data-pv-bubble] carries the eventId of the message at its data-index", async () => {
    // Checker Warning 4: verify getItemKey identity via the observable
    // `data-event-id` DOM attribute (added in Wave 2 Step A), NOT via
    // React key inspection (which is stripped before commit and not
    // observable through the DOM).
    //
    // Regression here means TanStack Virtual's measurement cache would
    // invalidate on every dedup / reorder / prepend (SURPRISE #2) —
    // producing visible jitter on the image-load re-measure path.
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Fire messages with distinct, known eventIds so we can cross-check
    // each [data-pv-bubble]'s data-event-id against messages[data-index].eventId.
    const N = 10;
    const expectedEventIds: string[] = [];
    for (let i = 0; i < N; i++) {
      expectedEventIds.push(`known-evt-${i}`);
    }
    fireMessageBatch(ws, N, (i) => ({
      type: "message",
      role: "assistant",
      content: `body ${i}`,
      eventId: expectedEventIds[i],
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBeGreaterThan(0);
    });

    // For each rendered [data-pv-bubble] item, read the DOM-observable
    // data-index and data-event-id attributes. Assert the eventId at
    // data-index i is exactly expectedEventIds[i]. This proves the
    // virtualizer's getItemKey wired to messages[i].eventId is producing
    // stable, correct identity for every rendered row.
    const bubbles = container.querySelectorAll("[data-pv-bubble]");
    expect(bubbles.length).toBeGreaterThan(0);
    for (const el of Array.from(bubbles)) {
      const dataIndexAttr = el.getAttribute("data-index");
      const dataEventIdAttr = el.getAttribute("data-event-id");
      expect(dataIndexAttr).not.toBeNull();
      expect(dataEventIdAttr).not.toBeNull();
      const idx = Number.parseInt(dataIndexAttr as string, 10);
      expect(Number.isNaN(idx)).toBe(false);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(N);
      // The critical assertion — DOM identity witness matches the
      // eventId the virtualizer was given for that row.
      expect(dataEventIdAttr).toBe(expectedEventIds[idx]);
    }
  });

  it("Test 5a: AsideBubble renders as a sibling of the sized virtualizer container, INSIDE the outer scroll container (not a child of the sized container)", async () => {
    // CONTEXT.md § Success criteria #8 layout invariant — Wave 2 Step B
    // moved accessories OUT of the sized virtualizer container into
    // in-flow siblings inside the outer scroll container. This test
    // locks that shape in specifically for the virtualization refactor
    // context. Regression here means accessories would land inside the
    // virtualizer's absolute-positioned box and be positioned wrong
    // (overlapping the last virtualized item at top-left).
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Populate a couple messages so the sized virtualizer container exists
    // in the DOM (we need it as the reference sibling).
    fireMessageBatch(ws, 3, (i) => ({
      type: "message",
      role: "assistant",
      content: `msg ${i}`,
      eventId: `evt-${i}`,
      ts: 1_000_000 + i,
    }));

    fireWsMessage(ws, {
      type: "aside_ready",
      text: "aside from the agent explaining current step",
    });

    let asideEl: Element | null = null;
    await waitFor(() => {
      asideEl = container.querySelector('[role="note"]');
      expect(asideEl).toBeTruthy();
    });

    const sizedContainer = getSizedVirtualizerContainer(container);
    const outerScroll = getOuterScrollContainer(container);
    expect(sizedContainer).toBeTruthy();
    expect(outerScroll).toBeTruthy();

    // Invariant #1: AsideBubble is NOT a child of the sized virtualizer
    // container (would put it inside the absolute-positioned box, wrong).
    expect(sizedContainer.contains(asideEl)).toBe(false);

    // Invariant #2: AsideBubble IS inside the outer scroll container
    // (in-flow below the message list, per ASIDE-05).
    expect(outerScroll.contains(asideEl)).toBe(true);

    // Invariant #3: AsideBubble's direct parent chain leads through the
    // outer scroll container — no absolute-positioning intermediary and
    // no sized-container intermediary. Walk up from asideEl to confirm
    // the sized container is skipped (asideEl reaches outerScroll without
    // crossing sizedContainer).
    let walker: Element | null = asideEl;
    let crossedSized = false;
    while (walker && walker !== outerScroll) {
      if (walker === sizedContainer) {
        crossedSized = true;
        break;
      }
      walker = walker.parentElement;
    }
    expect(crossedSized).toBe(false);
    expect(walker).toBe(outerScroll);
  });

  it("Test 5b: PlanPendingBubble renders as a sibling of the sized virtualizer container, INSIDE the outer scroll container", async () => {
    // Same layout invariant as Test 5a but for the plan_pending accessory
    // path. Locks the invariant across all three accessories described in
    // CONTEXT.md § Success criteria #8 (WipBubble is store-driven so its
    // sibling invariant is verified transitively via the shared JSX block
    // — the accessories are rendered by the same `{isWorking && ...}`,
    // `{planPending && ...}`, `{asideText !== null && ...}` triplet in
    // PrettyView.tsx :1896-1916; if plan_pending and aside are both
    // siblings of the sized container, wip is too by construction).
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireMessageBatch(ws, 3, (i) => ({
      type: "message",
      role: "assistant",
      content: `msg ${i}`,
      eventId: `evt-${i}`,
      ts: 1_000_000 + i,
    }));

    fireWsMessage(ws, {
      type: "plan_pending",
      pending: {
        planFilePath: "/tmp/plan.md",
        planContent: "the plan body",
        contentError: null,
      },
    });

    let planEl: Element | null = null;
    await waitFor(() => {
      planEl = container.querySelector('[aria-label="Plan waiting for your approval"]');
      expect(planEl).toBeTruthy();
    });

    const sizedContainer = getSizedVirtualizerContainer(container);
    const outerScroll = getOuterScrollContainer(container);

    // PlanPendingBubble is NOT inside the sized virtualizer container.
    expect(sizedContainer.contains(planEl)).toBe(false);
    // PlanPendingBubble IS inside the outer scroll container.
    expect(outerScroll.contains(planEl)).toBe(true);

    // And its parent chain to the outer scroll does NOT cross the sized
    // container (no absolute-positioning intermediary).
    let walker: Element | null = planEl;
    let crossedSized = false;
    while (walker && walker !== outerScroll) {
      if (walker === sizedContainer) {
        crossedSized = true;
        break;
      }
      walker = walker.parentElement;
    }
    expect(crossedSized).toBe(false);
    expect(walker).toBe(outerScroll);
  });

  it("Test 6: H3 — observeElementRect cleanup contract; no TypeError across mount → streaming → unmount even when scrollElement is transiently null", async () => {
    // Phase 28 review finding H3 (/tmp/pv-virtualization-review.md :55-86).
    // TanStack Virtual stores observeElementRect's return value as the
    // cleanup and calls it on rebind (e.g., scrollElement flipping from
    // null → element on the first status transition, or on status
    // re-mount cycles). If any early-return branch returns bare undefined
    // instead of `() => {}`, calling that cleanup throws
    // `TypeError: undefined is not a function`.
    //
    // We can't perfectly simulate the "null-then-non-null" identity swap
    // in JSDOM because PrettyView's outer scroll container always mounts
    // synchronously. But we CAN drive the render lifecycle across mount →
    // status flip → unmount and assert that no exception was thrown and
    // no error surfaced on console.error. If Task 1's H3 fix (returning
    // `() => {}` on the two null branches) is reverted, and TanStack ever
    // hits the rebind path in this lifecycle, it would surface as a
    // console.error from React's error handling.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let threw: unknown = null;
    let unmount: (() => void) | null = null;
    try {
      const rendered = render(
        <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
      );
      unmount = rendered.unmount;
      const ws = getCurrentWs();
      flipToStreaming(ws);
      fireMessageBatch(ws, 3, (i) => ({
        type: "message",
        role: "assistant",
        content: `msg ${i}`,
        eventId: `evt-${i}`,
        ts: 1_000_000 + i,
      }));
      // Explicitly invoke every captured RO cleanup path via unmount —
      // TanStack Virtual's own useLayoutEffect cleanup calls the value
      // returned from observeElementRect. If any of those stored values
      // is bare undefined, calling it throws.
      unmount();
    } catch (e) {
      threw = e;
    } finally {
      errorSpy.mockRestore();
    }
    expect(threw).toBeNull();
    // Assert no TypeError leaked through React's error boundary chatter.
    const typeErrorCalls = errorSpy.mock.calls.filter((args) =>
      args.some(
        (a) =>
          (typeof a === "string" && a.includes("TypeError")) ||
          (a instanceof Error && a.name === "TypeError"),
      ),
    );
    expect(typeErrorCalls.length).toBe(0);
  });

  it("Test 7: H4 — read() closure survives a stale-scrollElement fire and does not crash the virtualizer", async () => {
    // Phase 28 review finding H4 (/tmp/pv-virtualization-review.md :88-111).
    // The custom observeElementRect's read() closure re-derives
    // instance.scrollElement on every invocation so a stale RO firing
    // after a scroll-container remount reports current dimensions for
    // the CURRENT element, not the captured-at-bind stale one.
    //
    // JSDOM cannot easily simulate a full scroll-container identity swap
    // (that would require unmount/remount of PrettyView with the same
    // session). The practical proxy: change the outer scroll container's
    // offsetHeight after bind, then manually invoke every captured RO
    // callback (as if a real browser had delivered a resize entry). The
    // virtualizer should re-read dimensions inside read() and NOT crash;
    // the sized virtualizer container should remain valid and bubbles
    // should still be present in the DOM.
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    fireMessageBatch(ws, 5, (i) => ({
      type: "message",
      role: "assistant",
      content: `msg ${i}`,
      eventId: `evt-${i}`,
      ts: 1_000_000 + i,
    }));

    const outerScroll = getOuterScrollContainer(container);
    // Simulate a post-mount viewport size change by mutating offsetHeight
    // on the outer scroll container. The virtualizer's own RO (installed
    // by observeElementRect) reads offsetHeight synchronously on each fire.
    Object.defineProperty(outerScroll, "offsetHeight", {
      get: () => 480,
      configurable: true,
    });
    Object.defineProperty(outerScroll, "offsetWidth", {
      get: () => 1024,
      configurable: true,
    });

    // Fire every captured RO callback — the H4 concern is that read()
    // must re-derive from instance.scrollElement every time, so even a
    // "stale-looking" callback path lands on the current element cleanly.
    let threw: unknown = null;
    try {
      act(() => {
        for (const cb of capturedROCallbacks) {
          cb([], {} as ResizeObserver);
        }
      });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();

    // Proxy assertion: after the re-read, the sized virtualizer container
    // is still located-able and bubbles are still present. If read() had
    // thrown or fed a zero rect into the virtualizer, this would fail.
    const sized = getSizedVirtualizerContainer(container);
    expect(sized).toBeTruthy();
    const bubbles = container.querySelectorAll("[data-pv-bubble]");
    expect(bubbles.length).toBeGreaterThan(0);
  });

  it("Test 8: M2 — reduced initialRect.height (600) yields bounded first paint (≤ 20 bubbles) without any RO firing", async () => {
    // Phase 28 review finding M2 (/tmp/pv-virtualization-review.md :136-149).
    // Before M2 the initialRect was { width: 1024, height: 4096 }. With
    // estimateSize=80 + overscan=5 that yields 4096/80 + 10 ≈ 61 real
    // bubble subtrees on the first paint before the ResizeObserver fires
    // — defeats the phase's bounded-DOM goal in the transient pre-RO
    // window on every mount / paneKey change / reconnect.
    //
    // After M2 the initialRect is { width: 1024, height: 600 }. That
    // caps the transient at 600/80 + 10 ≈ 17.5 items. This test verifies
    // the reduced cap WITHOUT firing any RO callbacks (i.e., without
    // shrinkScrollContainer + capturedROCallbacks) so we exercise the
    // pure initialRect path — the exact code path a real browser hits on
    // its very first paint.
    //
    // This is the JSDOM-observable proxy for the true M2 concern (real
    // browsers benefit even more because the RO eventually fires and
    // contracts further).
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireMessageBatch(ws, 120, (i) => ({
      type: "message",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
      eventId: `evt-${i}`,
      ts: 1_000_000 + i,
    }));

    // Wait for bubbles to appear WITHOUT calling shrinkScrollContainer or
    // manually firing RO callbacks. The virtualizer uses initialRect
    // exclusively for the visible-slice calculation.
    await waitFor(() => {
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      expect(bubbles.length).toBeGreaterThan(0);
    });

    const bubbles = container.querySelectorAll("[data-pv-bubble]");
    // Cap 20 chosen conservatively: 600/80 + 10 overscan = 17.5, rounded
    // up with a couple of margin. Pre-M2 this would have been ~61.
    expect(bubbles.length).toBeLessThanOrEqual(20);
  });

  it("Test 9: M4 — getItemKey never falls back under normal render flow; no bubble carries a __oob_ data-event-id and no [pv-virtual] warn fires", async () => {
    // Phase 28 review finding M4 (/tmp/pv-virtualization-review.md :163-176).
    // The new getItemKey uses a non-colliding `__oob_${i}` string prefix
    // fallback and emits a console.warn on that path. Under normal
    // rendering (count and messages come from the same render) the
    // fallback should NEVER trigger. This test is the guardrail: if it
    // ever fails, the fallback path is being hit and either the race the
    // previous fallback protected against IS real (surprising) or a new
    // bug slipped in.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { container } = render(
        <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
      );
      const ws = getCurrentWs();
      flipToStreaming(ws);

      // Fire a batch of messages with distinct real eventIds. Some short,
      // some long, some numeric-looking — to prove the fallback is not
      // silently substituting for any of them.
      const N = 15;
      fireMessageBatch(ws, N, (i) => ({
        type: "message",
        role: "assistant",
        content: `msg ${i}`,
        eventId: `real-evt-${i}`,
        ts: 1_000_000 + i,
      }));

      await waitFor(() => {
        const bubbles = container.querySelectorAll("[data-pv-bubble]");
        expect(bubbles.length).toBeGreaterThan(0);
      });

      // Assertion 1: no rendered bubble carries a __oob_ data-event-id.
      // The virtualizer forwards its getItemKey output onto data-event-id
      // via the Wave 2 Step A wiring. If getItemKey returned the fallback
      // for any rendered row, the fallback string would surface here.
      const bubbles = container.querySelectorAll("[data-pv-bubble]");
      for (const el of Array.from(bubbles)) {
        const dataEventIdAttr = el.getAttribute("data-event-id");
        expect(dataEventIdAttr).not.toBeNull();
        expect(dataEventIdAttr).not.toContain("__oob_");
        expect(dataEventIdAttr).toMatch(/^real-evt-/);
      }

      // Assertion 2: no [pv-virtual] prefixed warn was emitted. If the
      // fallback path fired, the console.warn inside getItemKey would
      // have surfaced in warnSpy.mock.calls.
      const pvVirtualWarns = warnSpy.mock.calls.filter((args) =>
        args.some((a) => typeof a === "string" && a.includes("[pv-virtual]")),
      );
      expect(pvVirtualWarns.length).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
