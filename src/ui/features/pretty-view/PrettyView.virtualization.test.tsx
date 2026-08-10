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
import { render, act, waitFor } from "@testing-library/react";

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

  // SKIP TEMP 2026-08-10: auto-scroll disabled per bounty
  // pv-disable-auto-scroll-temp — restore this assertion when
  // bounty pv-auto-scroll-redesign lands.
  it.skip("Test 2: auto-scroll-to-bottom-when-pinned — scrollTop jumps to bottom via paneKey rAF-chain over virtualized layout", async () => {
    // CONTEXT.md § Success criteria #4. useAutoScroll's paneKey-change
    // useEffect (use-auto-scroll.ts:108-127) arms a 300ms rAF-chain that
    // writes scrollTop = scrollHeight every frame. That primitive works
    // uniformly over any scrollable container — including the virtualized
    // one whose scrollHeight now derives from `rowVirtualizer.getTotalSize()
    // + accessory heights`. Test proves the primitive still fires.
    vi.useFakeTimers();
    try {
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

      // Advance timers past LOAD_LOCK_MS (300ms) + the rAF-chain window so
      // the pane-change useEffect fires its jumpToBottom writes. Fake
      // timers stub Date.now(), which the rAF loop uses to decide when to
      // stop.
      act(() => {
        vi.advanceTimersByTime(400);
      });

      // scrollTop should have been driven to scrollHeight (=5000) by the
      // rAF-chain. This is the "pinned-to-bottom auto-scroll" primitive
      // firing over the virtualized-DOM scroll container.
      expect(geom.getScrollTop()).toBe(5000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Test 3: don't-yank-when-scrolled-up — after wheel-up gesture, subsequent frames do not force scrollTop back to bottom", async () => {
    // CONTEXT.md § Success criteria #5. After the user gestures scroll-up
    // (wheel deltaY<0), useAutoScroll flips stickToBottomRef to false.
    // Subsequent WS frames must NOT reset scrollTop to bottom.
    // With the no-op ResizeObserver stub, the RO-driven jump path in
    // useAutoScroll (use-auto-scroll.ts:137-159) never fires — but this
    // is the EXACT invariant we want to prove: no matter which path
    // useAutoScroll takes, scrollTop is NOT yanked back to bottom while
    // the user is scrolled up. So the test asserts scrollTop stays put.
    vi.useFakeTimers();
    try {
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

      // Advance past LOAD_LOCK_MS so the load-lock gate opens and wheel
      // gestures can register.
      act(() => {
        vi.advanceTimersByTime(400);
      });

      // User scrolls up: set scrollTop below bottom and dispatch a wheel
      // event with deltaY < 0 to exit sticky mode.
      geom.setScrollTop(1000);
      act(() => {
        const wheelEvt = new WheelEvent("wheel", {
          deltaY: -100,
          bubbles: true,
          cancelable: true,
        });
        outerScroll.dispatchEvent(wheelEvt);
      });

      // Fire a new frame. The critical assertion: scrollTop was NOT
      // driven back to scrollHeight (5000). It stays at 1000.
      // Bump scrollHeight to simulate content growth from the new frame
      // — if useAutoScroll incorrectly yanked, scrollTop would follow.
      geom.setScrollHeight(5200);
      fireWsMessage(ws, {
        type: "message",
        role: "assistant",
        content: "new frame after user scrolled up",
        eventId: "evt-new",
        ts: 2_000_000,
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
});
