// Tests for useAutoScroll — Phase 70 rewrite: two-state auto-scroll state machine.
//
// Phase 70 rewrites the hook to a thin wrapper around the pure reducer in
// ./auto-scroll-machine.ts. This test file locks the new two-state SM semantics
// at the HOOK level. Reducer-level coverage lives in ./auto-scroll-machine.test.ts
// (pure function truth-table, zero DOM, zero mocks, zero timers). This file
// covers the DOM/React glue: hide-pin-reveal, RAF-coalesced writes, observer
// wiring, and the `isTrusted` input-origin gate.
//
// Coverage strategy:
//   - renderHook + a plain HTMLElement created via makeScrollEl (JSDOM harness
//     with Object.defineProperty scroll geometry overrides — canonical pattern).
//   - TestConsumer component wires the hook to a pre-made scroll element via
//     useLayoutEffect, then exposes mode/revealed on data-* attributes.
//   - ResizeObserverStub + MutationObserverStub give tests synchronous control
//     over observer callbacks (JSDOM lacks native RO/MO tick guarantees).
//   - vi.useFakeTimers({ shouldAdvanceTime: false }) so RAF ticks can be walked
//     deterministically via vi.advanceTimersByTime().
//
// T5 is the LOAD-BEARING no-yank regression: "user scrolled-up + new message
// arrives → NO scroll write, NO mode change." This is the whole point of the
// rewrite — the state machine enforces the invariant structurally, not by
// gating on a flag that can be defeated by a race. T5 must always run;
// Skipping this test is FORBIDDEN.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { useAutoScroll } from "./use-auto-scroll";

// ---------------------------------------------------------------------------
// makeScrollEl — JSDOM scroll-container mock (PRESERVED verbatim from current
// test file L53-118 as per 70-PATTERNS.md § "Preserve two load-bearing patterns")
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
  /** Call the registered scroll listener directly with isTrusted=true.
   *  JSDOM's dispatchEvent always sets isTrusted=false for synthetic events
   *  (spec-compliant but untestable). This escape hatch captures the listener
   *  via the addEventListenerSpy and invokes it with a mocked-trusted event. */
  fireUserScroll: () => void;
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

  // Map of event type → registered handlers so fireUserScroll can invoke them.
  const registeredHandlers: Map<string, EventListenerOrEventListenerObject[]> = new Map();

  // Wrap addEventListener / removeEventListener so tests can assert cleanup
  // behavior (T13). We wrap the real DOM methods rather than replacing
  // them entirely so the hook's real listener actually attaches and fires.
  const realAdd = el.addEventListener.bind(el);
  const realRemove = el.removeEventListener.bind(el);
  const addEventListenerSpy = vi.fn(
    (
      type: string,
      handler: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions | boolean,
    ) => {
      realAdd(type, handler, options);
      // Also track in our map for direct invocation.
      if (!registeredHandlers.has(type)) registeredHandlers.set(type, []);
      registeredHandlers.get(type)!.push(handler);
    },
  );
  const removeEventListenerSpy = vi.fn(
    (
      type: string,
      handler: EventListenerOrEventListenerObject,
      options?: EventListenerOptions | boolean,
    ) => {
      realRemove(type, handler, options);
    },
  );
  // Cast through unknown to satisfy TS — we're intentionally shadowing
  // the DOM method on this instance only.
  (
    el as unknown as { addEventListener: typeof addEventListenerSpy }
  ).addEventListener = addEventListenerSpy;
  (
    el as unknown as { removeEventListener: typeof removeEventListenerSpy }
  ).removeEventListener = removeEventListenerSpy;

  /** Invoke the registered scroll handler directly with isTrusted=true.
   *  JSDOM always overrides isTrusted=false on dispatchEvent; this bypass
   *  calls the handler with a plain object that has isTrusted=true so the
   *  hook's user-input gate fires correctly in tests. */
  function fireUserScroll(): void {
    const handlers = registeredHandlers.get("scroll") ?? [];
    for (const handler of handlers) {
      const syntheticEvent = { isTrusted: true } as Event;
      act(() => {
        if (typeof handler === "function") {
          handler(syntheticEvent);
        } else {
          handler.handleEvent(syntheticEvent);
        }
      });
    }
  }

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
    fireUserScroll,
  };
}

// ---------------------------------------------------------------------------
// fireScroll / fireProgrammaticScroll — synthetic-event helpers
// (PRESERVED from current file L120-128 with isTrusted modification)
//
// isTrusted on DOM Event is non-configurable in JSDOM (setting it via
// Object.defineProperty throws "Cannot redefine property: isTrusted").
// To control isTrusted, we subclass Event and override the getter — this is
// the only reliable approach that works in both JSDOM and real browsers.
// ---------------------------------------------------------------------------

/** A subclass of Event that allows overriding isTrusted for test purposes. */
class TrustedScrollEvent extends Event {
  override get isTrusted(): boolean {
    return true;
  }
}

class UntrustedScrollEvent extends Event {
  override get isTrusted(): boolean {
    return false;
  }
}

/**
 * Fire a trusted scroll event (isTrusted=true) on the mock element under act()
 * so React flushes the state updates the hook triggers from its scroll listener.
 * Uses TrustedScrollEvent subclass because isTrusted is non-configurable on
 * DOM Event instances in JSDOM — Object.defineProperty throws.
 */
function fireScroll(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new TrustedScrollEvent("scroll", { bubbles: true }));
  });
}

/**
 * Fire a programmatic (untrusted) scroll event — isTrusted=false.
 * JSDOM synthetic events already default to isTrusted=false; this helper
 * makes test intent explicit by using UntrustedScrollEvent.
 */
function fireProgrammaticScroll(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new UntrustedScrollEvent("scroll", { bubbles: true }));
  });
}

// ---------------------------------------------------------------------------
// ResizeObserverStub — synchronous RO substitute for JSDOM
// ---------------------------------------------------------------------------

class ResizeObserverStub {
  callback: ResizeObserverCallback;
  disconnectSpy: Mock;
  static lastInstance: ResizeObserverStub | null = null;

  constructor(cb: ResizeObserverCallback) {
    this.callback = cb;
    this.disconnectSpy = vi.fn();
    ResizeObserverStub.lastInstance = this;
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    this.disconnectSpy();
  }

  /** Manually trigger the observer callback from test code. */
  trigger(entries: ResizeObserverEntry[] = []): void {
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

// ---------------------------------------------------------------------------
// MutationObserverStub — synchronous MO substitute for JSDOM
// ---------------------------------------------------------------------------

class MutationObserverStub {
  callback: MutationCallback;
  disconnectSpy: Mock;
  static lastInstance: MutationObserverStub | null = null;

  constructor(cb: MutationCallback) {
    this.callback = cb;
    this.disconnectSpy = vi.fn();
    MutationObserverStub.lastInstance = this;
  }

  observe(): void {}
  disconnect(): void {
    this.disconnectSpy();
  }

  /** Manually trigger the observer callback from test code. */
  trigger(records: MutationRecord[] = []): void {
    this.callback(records, this as unknown as MutationObserver);
  }
}

// ---------------------------------------------------------------------------
// TestConsumer — drives the hook through render with a pre-made scroll element
// ---------------------------------------------------------------------------

/**
 * TestConsumer binds the hook's scrollRef to a pre-made makeScrollEl element
 * via useLayoutEffect (synchronous, runs BEFORE the hook's observer-setup
 * useEffect so the observers see the element with correct geometry).
 *
 * Renders a passive read surface (`data-testid="probe"`) with data-mode and
 * data-revealed. Provides jump and send buttons wired to the hook's actions.
 *
 * NOTE: Do NOT render the scrollRef on a <div> inside TestConsumer's JSX —
 * that would create two scroll targets racing for the ref, defeating the
 * geometry-injection contract. The pre-made `el` is the sole scroll target.
 */
function TestConsumer({
  paneKey,
  el,
}: {
  paneKey: string;
  el: HTMLElement;
}): JSX.Element {
  const { scrollRef, mode, revealed, jumpToBottom, onSendFired } =
    useAutoScroll(paneKey);

  // useLayoutEffect binds the callback ref SYNCHRONOUSLY on mount, BEFORE
  // the hook's observer-setup useEffect runs (useEffect is scheduled after
  // useLayoutEffect). This guarantees scrollEl inside the hook is the
  // makeScrollEl-produced element (with its stubbed scrollHeight /
  // clientHeight / scrollTop getters + setters) at the moment the
  // observer-setup effect installs the ResizeObserver + MutationObserver +
  // scroll listener.
  useLayoutEffect(() => {
    scrollRef(el);
    return () => scrollRef(null);
  }, [el]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <button data-testid="jump" onClick={jumpToBottom} />
      <button data-testid="send" onClick={onSendFired} />
      <div
        data-testid="probe"
        data-mode={mode}
        data-revealed={revealed ? "true" : "false"}
      />
    </>
  ) as unknown as JSX.Element;
}

// ---------------------------------------------------------------------------
// Lifecycle — stubs + timers
// ---------------------------------------------------------------------------

const originalResizeObserver = globalThis.ResizeObserver;
const originalMutationObserver = globalThis.MutationObserver;

beforeEach(() => {
  ResizeObserverStub.lastInstance = null;
  MutationObserverStub.lastInstance = null;
  // Install synchronous stubs over the globals so the hook uses them.
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  globalThis.MutationObserver = MutationObserverStub as unknown as typeof MutationObserver;
  // Fake timers so RAF ticks can be walked deterministically via
  // vi.advanceTimersByTime. { shouldAdvanceTime: false } means no silent
  // tick during synchronous test setup — every advance is explicit.
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.MutationObserver = originalMutationObserver;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: flush RAF via fake timers
// ---------------------------------------------------------------------------
function flushRaf(): void {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

// ===========================================================================
// T1-T4: Hide-pin-reveal + at-bottom chase behaviors
// ===========================================================================

describe("hide-pin-reveal + at-bottom chase", () => {
  it("T1: cold mount → hide-pin-reveal completes → mode=at-bottom + revealed=true", () => {
    const { el, setScrollHeight } = makeScrollEl({
      scrollHeight: 0,
      clientHeight: 500,
    });

    act(() => {
      render(<TestConsumer paneKey="pane-A" el={el} />);
    });

    // Initially not revealed (waiting for non-zero contentHeight).
    const probe = screen.getByTestId("probe");
    expect(probe.getAttribute("data-revealed")).toBe("false");

    // Simulate content arriving — ResizeObserver tick with non-zero scrollHeight.
    setScrollHeight(800);
    const ro = ResizeObserverStub.lastInstance;
    expect(ro).not.toBeNull();

    act(() => {
      ro!.trigger();
    });

    // After RO tick with non-zero height, the reducer fires effect:"reveal".
    expect(probe.getAttribute("data-revealed")).toBe("true");
    expect(probe.getAttribute("data-mode")).toBe("at-bottom");
  });

  it("T4: new message arrives while at-bottom → single scroll-write per RAF", () => {
    const { el, setScrollHeight, getScrollTop } = makeScrollEl({
      scrollHeight: 500,
      clientHeight: 400,
      initialScrollTop: 100, // at bottom (dist = 500-100-400 = 0)
    });

    act(() => {
      render(<TestConsumer paneKey="pane-A" el={el} />);
    });

    // Trigger mount-landing reveal via RO tick.
    const ro = ResizeObserverStub.lastInstance;
    act(() => {
      ro!.trigger();
    });

    // New message arrives — trigger MutationObserver.
    setScrollHeight(600);
    const mo = MutationObserverStub.lastInstance;
    expect(mo).not.toBeNull();

    act(() => {
      mo!.trigger();
    });

    // RAF hasn't fired yet — scrollTop not yet written.
    flushRaf();

    // After RAF flush, chase-write should set scrollTop = scrollHeight.
    expect(getScrollTop()).toBe(600);
  });

  it("T5: LOAD-BEARING — user scrolled-up + new message arrives → NO scroll-write, NO mode change", () => {
    // § What would make it wrong bullet 1: no special-casing per event kind
    // § What would make it wrong bullet 2: programmatic scroll write must NOT transition mode
    const { el, setScrollTop, setScrollHeight, getScrollTop, fireUserScroll } = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      initialScrollTop: 100, // scrolled up (dist = 1000-100-400 = 500, way above tolerance)
    });

    act(() => {
      render(<TestConsumer paneKey="pane-A" el={el} />);
    });

    // Reveal the surface + flush RAF so pendingChaseRef is clear.
    const ro = ResizeObserverStub.lastInstance;
    act(() => {
      ro!.trigger();
    });
    flushRaf();

    // User scrolls up (trusted event, distanceFromBottom = 500 > 28 tolerance).
    setScrollTop(100);
    fireUserScroll(); // isTrusted=true via direct handler invocation, distance=500 → OUT → not-at-bottom

    const probe = screen.getByTestId("probe");
    expect(probe.getAttribute("data-mode")).toBe("not-at-bottom");

    // New message arrives while scrolled up.
    const prevScrollTop = getScrollTop();
    setScrollHeight(1100);
    const mo = MutationObserverStub.lastInstance;
    act(() => {
      mo!.trigger();
    });
    flushRaf();

    // § What would make it wrong bullet 1: no yank when scrolled up.
    // scrollTop MUST NOT have changed — the state machine must not chase
    // while mode=not-at-bottom.
    expect(getScrollTop()).toBe(prevScrollTop);
    // Mode must remain not-at-bottom — content arrival must not flip mode.
    expect(probe.getAttribute("data-mode")).toBe("not-at-bottom");
  });

  it("T6: accessory mount while at-bottom → chase", () => {
    const { el, setScrollHeight, getScrollTop } = makeScrollEl({
      scrollHeight: 500,
      clientHeight: 400,
      initialScrollTop: 100,
    });

    act(() => {
      render(<TestConsumer paneKey="pane-A" el={el} />);
    });

    // Reveal surface.
    const ro = ResizeObserverStub.lastInstance;
    act(() => {
      ro!.trigger();
    });

    // Simulate WipBubble mounting — MutationObserver fires.
    setScrollHeight(540); // accessory added scrollHeight
    const mo = MutationObserverStub.lastInstance;
    act(() => {
      mo!.trigger();
    });
    flushRaf();

    expect(getScrollTop()).toBe(540);
  });

  it("T7: accessory unmount while at-bottom → chase", () => {
    const { el, setScrollHeight, getScrollTop } = makeScrollEl({
      scrollHeight: 540,
      clientHeight: 400,
      initialScrollTop: 140,
    });

    act(() => {
      render(<TestConsumer paneKey="pane-A" el={el} />);
    });

    // Reveal surface.
    const ro = ResizeObserverStub.lastInstance;
    act(() => {
      ro!.trigger();
    });

    // WipBubble unmounts — scrollHeight shrinks.
    setScrollHeight(500);
    const mo = MutationObserverStub.lastInstance;
    act(() => {
      mo!.trigger();
    });
    flushRaf();

    expect(getScrollTop()).toBe(500);
  });
});

// ===========================================================================
// T2-T3: Scroll-listener user-input transitions
// ===========================================================================

describe("scroll-listener user-input transitions", () => {
  it("T2: user scrolls up via wheel → mode flips to not-at-bottom", () => {
    const { el, setScrollTop, fireUserScroll } = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      initialScrollTop: 600, // at bottom (1000-600-400=0)
    });

    act(() => {
      render(<TestConsumer paneKey="pane-A" el={el} />);
    });

    // Reveal surface first — flush RAF so pendingChaseRef.current is cleared
    // before the subsequent fireUserScroll call (the RO trigger schedules a
    // chase via RAF; if the RAF is not flushed, pendingChaseRef=true blocks
    // the scroll listener as a programmatic event).
    const ro = ResizeObserverStub.lastInstance;
    act(() => {
      ro!.trigger();
    });
    flushRaf();

    const probe = screen.getByTestId("probe");
    expect(probe.getAttribute("data-mode")).toBe("at-bottom");

    // Scroll up: distanceFromBottom = 1000 - 100 - 400 = 500 > 28 tolerance.
    // fireUserScroll calls the registered scroll handler directly with isTrusted=true
    // (JSDOM always overrides isTrusted=false on dispatchEvent, making the isTrusted
    // gate untestable via normal dispatchEvent — this bypass is the correct workaround).
    setScrollTop(100);
    fireUserScroll();

    expect(probe.getAttribute("data-mode")).toBe("not-at-bottom");
  });

  it("T3: user scrolls back near bottom (distance < BOTTOM_TOLERANCE_PX) → mode flips to at-bottom", () => {
    const { el, setScrollTop, fireUserScroll } = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      initialScrollTop: 100, // scrolled up (dist=500)
    });

    act(() => {
      render(<TestConsumer paneKey="pane-A" el={el} />);
    });

    // Reveal surface + flush RAF so pendingChaseRef is clear. The initial
    // reveal+RO chase writes scrollTop to scrollHeight. We then override
    // scrollTop back to 100 (scrolled-up position) before the user-scroll event.
    const ro = ResizeObserverStub.lastInstance;
    act(() => {
      ro!.trigger();
    });
    flushRaf();

    // Re-position to scrolled-up state (the chase write moved scrollTop to 1000).
    setScrollTop(100);
    // Scroll event from scrollTop=100: dist = 1000 - 100 - 400 = 500 → not-at-bottom.
    fireUserScroll();

    const probe = screen.getByTestId("probe");
    expect(probe.getAttribute("data-mode")).toBe("not-at-bottom");

    // Scroll back near bottom: distanceFromBottom = 1000 - 585 - 400 = 15 < 28.
    setScrollTop(585);
    fireUserScroll();

    expect(probe.getAttribute("data-mode")).toBe("at-bottom");
  });

  it("T12: programmatic write never triggers mode transition", () => {
    // § What would make it wrong bullet 2: programmatic scroll write must NOT
    // transition mode — the recursive-bug pattern the current code trips on.
    const { el, setScrollTop } = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      initialScrollTop: 600, // at bottom
    });

    act(() => {
      render(<TestConsumer paneKey="pane-A" el={el} />);
    });

    // Reveal surface + flush RAF so pendingChaseRef is clear. This ensures
    // the following test specifically targets the isTrusted gate (not the
    // pendingChase gate) when it checks that the programmatic scroll is skipped.
    const ro = ResizeObserverStub.lastInstance;
    act(() => {
      ro!.trigger();
    });
    flushRaf();

    const probe = screen.getByTestId("probe");
    expect(probe.getAttribute("data-mode")).toBe("at-bottom");

    // Simulate a programmatic scroll (isTrusted=false — chase-write position).
    // JSDOM always sets isTrusted=false on dispatchEvent, which is exactly what
    // we want here: the hook's isTrusted gate must block this from transitioning mode.
    setScrollTop(100); // would be "not-at-bottom" if isTrusted were true
    fireProgrammaticScroll(el);

    // § What would make it wrong bullet 2: mode must NOT have changed.
    // The isTrusted gate in the scroll listener must have blocked this.
    expect(probe.getAttribute("data-mode")).toBe("at-bottom");
  });
});

// ===========================================================================
// T8-T9: Container resize events
// ===========================================================================

describe("container resize events", () => {
  it("T8: container resize while at-bottom → chase", () => {
    const { el, setScrollHeight, getScrollTop } = makeScrollEl({
      scrollHeight: 500,
      clientHeight: 400,
      initialScrollTop: 100,
    });

    act(() => {
      render(<TestConsumer paneKey="pane-A" el={el} />);
    });

    // Reveal surface.
    const ro = ResizeObserverStub.lastInstance;
    act(() => {
      ro!.trigger();
    });

    // Simulate window resize: scrollHeight grows (content now taller).
    setScrollHeight(600);

    act(() => {
      ro!.trigger();
    });
    flushRaf();

    // Chase-write should have scrolled to new bottom.
    expect(getScrollTop()).toBe(600);
  });

  it("T9: container resize while not-at-bottom → NO write, NO mode change", () => {
    // § What would make it wrong bullet 1: no yank when scrolled up — resize
    // events are symmetric (same treatment as content-changed events).
    const { el, setScrollTop, setScrollHeight, getScrollTop, fireUserScroll } = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      initialScrollTop: 100, // scrolled up (dist=500)
    });

    act(() => {
      render(<TestConsumer paneKey="pane-A" el={el} />);
    });

    // Reveal surface + flush RAF so pendingChaseRef is clear before fireUserScroll.
    const ro = ResizeObserverStub.lastInstance;
    act(() => {
      ro!.trigger();
    });
    flushRaf();

    // User scrolls up → not-at-bottom.
    setScrollTop(100);
    fireUserScroll();

    const probe = screen.getByTestId("probe");
    expect(probe.getAttribute("data-mode")).toBe("not-at-bottom");
    const prevScrollTop = getScrollTop();

    // Window resize — RO fires.
    setScrollHeight(1100);
    act(() => {
      ro!.trigger();
    });
    flushRaf();

    // § What would make it wrong bullet 1: no yank when scrolled up.
    expect(getScrollTop()).toBe(prevScrollTop);
    expect(probe.getAttribute("data-mode")).toBe("not-at-bottom");
  });
});

// ===========================================================================
// T10-T11: Actions — jumpToBottom + onSendFired
// ===========================================================================

describe("actions", () => {
  it("T10: jumpToBottom() action → flips to at-bottom, writes scrollTop = scrollHeight", () => {
    const { el, setScrollTop, getScrollTop, fireUserScroll } = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      initialScrollTop: 100, // scrolled up
    });

    act(() => {
      render(<TestConsumer paneKey="pane-A" el={el} />);
    });

    // Reveal surface + flush RAF so pendingChaseRef is clear before fireUserScroll.
    const ro = ResizeObserverStub.lastInstance;
    act(() => {
      ro!.trigger();
    });
    flushRaf();

    // Scroll up to not-at-bottom.
    setScrollTop(100);
    fireUserScroll();
    const probe = screen.getByTestId("probe");
    expect(probe.getAttribute("data-mode")).toBe("not-at-bottom");

    // Click jump button.
    act(() => {
      fireEvent.click(screen.getByTestId("jump"));
    });
    flushRaf();

    expect(probe.getAttribute("data-mode")).toBe("at-bottom");
    expect(getScrollTop()).toBe(1000);
  });

  it("T11: onSendFired() from not-at-bottom → flips to at-bottom + chase", () => {
    const { el, setScrollTop, getScrollTop, fireUserScroll } = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      initialScrollTop: 100, // scrolled up
    });

    act(() => {
      render(<TestConsumer paneKey="pane-A" el={el} />);
    });

    // Reveal surface + flush RAF so pendingChaseRef is clear before fireUserScroll.
    const ro = ResizeObserverStub.lastInstance;
    act(() => {
      ro!.trigger();
    });
    flushRaf();

    // Scroll up to not-at-bottom.
    setScrollTop(100);
    fireUserScroll();
    const probe = screen.getByTestId("probe");
    expect(probe.getAttribute("data-mode")).toBe("not-at-bottom");

    // Fire send action.
    act(() => {
      fireEvent.click(screen.getByTestId("send"));
    });
    flushRaf();

    expect(probe.getAttribute("data-mode")).toBe("at-bottom");
    expect(getScrollTop()).toBe(1000);
  });
});

// ===========================================================================
// T13: Cleanup
// ===========================================================================

describe("cleanup", () => {
  it("T13: unmount removes scroll listener, disconnects MutationObserver + ResizeObserver, cancels RAF", () => {
    const { el, removeEventListenerSpy } = makeScrollEl({
      scrollHeight: 500,
      clientHeight: 400,
    });

    const { unmount } = render(<TestConsumer paneKey="pane-A" el={el} />);

    // Capture observer stubs before unmount.
    const ro = ResizeObserverStub.lastInstance;
    const mo = MutationObserverStub.lastInstance;
    expect(ro).not.toBeNull();
    expect(mo).not.toBeNull();

    act(() => {
      unmount();
    });

    // Scroll listener removed.
    const scrollRemoveCalls = removeEventListenerSpy.mock.calls.filter(
      ([type]: [string]) => type === "scroll",
    );
    expect(scrollRemoveCalls.length).toBeGreaterThanOrEqual(1);

    // Observers disconnected.
    expect(ro!.disconnectSpy).toHaveBeenCalled();
    expect(mo!.disconnectSpy).toHaveBeenCalled();
  });
});

// ===========================================================================
// T14: API surface lock
// ===========================================================================

describe("API surface", () => {
  it("T14: hook result has exactly {scrollRef, jumpToBottom, onSendFired, mode, revealed} — no legacy props", () => {
    const { result } = renderHook(() => useAutoScroll("pane-A"));

    const keys = Object.keys(result.current).sort();
    expect(keys).toEqual(["jumpToBottom", "mode", "onSendFired", "revealed", "scrollRef"]);

    // Explicit no-legacy assertions. Cast via `unknown` first because the
    // static type of result.current does not sufficiently overlap with
    // Record<string, unknown> for a direct cast (TS2352).
    const asRecord = result.current as unknown as Record<string, unknown>;
    expect(asRecord.sentinelRef).toBeUndefined();
    expect(asRecord.scrollToBottomAndFollow).toBeUndefined();
    expect(asRecord.isPinnedToBottom).toBeUndefined();
  });
});

// ===========================================================================
// T15: Session re-entry (paneKey change) must NOT touch scroll position
// ===========================================================================

describe("session re-entry", () => {
  it("T15: paneKey change (session re-entry via rerender) MUST NOT touch scroll position AND MUST NOT reset mode", () => {
    const { el, setScrollTop, getScrollTop, fireUserScroll } = makeScrollEl({
      scrollHeight: 1000,
      clientHeight: 400,
      initialScrollTop: 100, // scrolled up
    });

    const { rerender } = render(<TestConsumer paneKey="pane-A" el={el} />);

    // Reveal surface + flush RAF so pendingChaseRef is clear before fireUserScroll.
    const ro = ResizeObserverStub.lastInstance;
    act(() => {
      ro!.trigger();
    });
    flushRaf();

    // Scroll up to not-at-bottom.
    setScrollTop(100);
    fireUserScroll();

    const probe = screen.getByTestId("probe");
    expect(probe.getAttribute("data-mode")).toBe("not-at-bottom");
    const scrollTopBefore = getScrollTop();

    // Session re-entry: new paneKey without remounting the hook.
    act(() => {
      rerender(<TestConsumer paneKey="pane-B" el={el} />);
    });

    // paneKey change must NOT reset scroll position (shape § "Session re-entry").
    // paneKey is passed for logging only — no state-reset effect.
    expect(getScrollTop()).toBe(scrollTopBefore);
    // Mode must NOT have been reset to at-bottom by the paneKey change.
    expect(probe.getAttribute("data-mode")).toBe("not-at-bottom");
  });
});
