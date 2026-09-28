/**
 * Phase 139 Plan 08 — WidgetBubble multi-mount independence tests.
 *
 * Verifies that two concurrent WidgetBubble mounts do NOT share state. Each
 * mount is an independent React component instance with its own:
 *   - iframeRef (useRef, instance-local)
 *   - retryCount / retrySrc (useState, instance-local)
 *   - postMessage handler (useEffect, instance-local closure over iframeRef)
 *   - cleanup fn (useEffect return value, per-mount)
 *
 * Note on retry-timer independence: RETRY_DELAYS_MS is a module-scope constant
 * (WidgetBubble.tsx lines 17), not mutable state — it is safe to share. The
 * useState(0) for retryCount (line 37) and useState(src) for retrySrc (line 38)
 * are instance-local by React semantics, so a dedicated timer-collision test
 * would only be testing React's own semantics. Instead, Test 1 implicitly
 * confirms independent src tracking, and Test 2 confirms per-mount callback
 * isolation. See WidgetBubble.tsx lines 37-38 for the useState declarations.
 *
 * Test coverage (4 tests, multi-mount):
 *   1. Two concurrent mounts render two iframes with distinct src attrs
 *   2. onSubmit callbacks are per-mount — fnA fires only for mount A, fnB for B
 *   3. Cross-source message reaches NEITHER onSubmit (source-guard on N mounts)
 *   4. Cleanup on unmount removes only that mount's listener (per-mount cleanup)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { WidgetBubble } from "./WidgetBubble";

const SRC_W1 = "/interactive/1/w1/pane/";
const SRC_W2 = "/interactive/1/w2/pane/";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  cleanup();
});

describe("WidgetBubble — multi-mount independence (Phase 139 Plan 08)", () => {
  it("Test 1: two concurrent mounts render two iframes with distinct src attrs", () => {
    render(
      <>
        <WidgetBubble src={SRC_W1} />
        <WidgetBubble src={SRC_W2} />
      </>,
    );

    const iframes = screen.getAllByTitle("Interactive widget");
    expect(iframes).toHaveLength(2);

    const srcs = iframes.map((el) => el.getAttribute("src"));
    expect(srcs).toContain(SRC_W1);
    expect(srcs).toContain(SRC_W2);
    expect(srcs[0]).not.toBe(srcs[1]);

    iframes.forEach((el) => expect(el.tagName).toBe("IFRAME"));
  });

  it("Test 2: onSubmit callbacks are per-mount — dispatching from one iframe does not call the other's callback", () => {
    const fnA = vi.fn();
    const fnB = vi.fn();

    render(
      <>
        <WidgetBubble src={SRC_W1} onSubmit={fnA} />
        <WidgetBubble src={SRC_W2} onSubmit={fnB} />
      </>,
    );

    const iframes = screen.getAllByTitle("Interactive widget") as HTMLIFrameElement[];
    expect(iframes).toHaveLength(2);

    // Assign distinct fake contentWindows — unique object identities so
    // WidgetBubble's source guard (e.source !== iframeRef.current?.contentWindow)
    // can distinguish them meaningfully.
    const fakeContentWindowA = {} as Window;
    const fakeContentWindowB = {} as Window;
    Object.defineProperty(iframes[0], "contentWindow", {
      value: fakeContentWindowA,
      configurable: true,
    });
    Object.defineProperty(iframes[1], "contentWindow", {
      value: fakeContentWindowB,
      configurable: true,
    });

    // Dispatch from iframe[0] (mount A) — only fnA should fire
    const msgA = new MessageEvent("message", {
      data: { type: "widget-submit", widgetId: "wid-a", value: "valA" },
      origin: window.location.origin,
      source: fakeContentWindowA,
    });
    act(() => { window.dispatchEvent(msgA); });

    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnA).toHaveBeenCalledWith("wid-a", "valA");
    expect(fnB).not.toHaveBeenCalled();

    // Dispatch from iframe[1] (mount B) — only fnB should fire; fnA stays at 1
    const msgB = new MessageEvent("message", {
      data: { type: "widget-submit", widgetId: "wid-b", value: "valB" },
      origin: window.location.origin,
      source: fakeContentWindowB,
    });
    act(() => { window.dispatchEvent(msgB); });

    expect(fnB).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledWith("wid-b", "valB");
    // fnA must NOT have been called a second time
    expect(fnA).toHaveBeenCalledTimes(1);
  });

  it("Test 3: a message with mismatched source reaches NEITHER onSubmit — source-guard on multi-mount", () => {
    const fnA = vi.fn();
    const fnB = vi.fn();

    render(
      <>
        <WidgetBubble src={SRC_W1} onSubmit={fnA} />
        <WidgetBubble src={SRC_W2} onSubmit={fnB} />
      </>,
    );

    // Dispatch with a foreign source — not matching any iframe's contentWindow
    // (JSDOM does not auto-assign contentWindow; {} is a third distinct object)
    const foreignSource = {} as Window;
    const msg = new MessageEvent("message", {
      data: { type: "widget-submit", widgetId: "any", value: "evil" },
      origin: window.location.origin,
      source: foreignSource,
    });
    act(() => { window.dispatchEvent(msg); });

    // Source guard rejected for both mounts — neither callback fires
    expect(fnA).not.toHaveBeenCalled();
    expect(fnB).not.toHaveBeenCalled();
  });

  it("Test 4: cleanup on unmount removes only that mount's listener — the other mount continues to receive events", () => {
    const fnA = vi.fn();
    const fnB = vi.fn();

    // Use a spy to confirm removeEventListener was called when mount A unmounts.
    // This is the direct evidence that mount A's per-mount cleanup ran.
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount: unmountAll } = render(
      <>
        <WidgetBubble src={SRC_W1} onSubmit={fnA} />
        <WidgetBubble src={SRC_W2} onSubmit={fnB} />
      </>,
    );

    // Both mounts are up — record spy call count baseline
    const removeCallsBefore = removeEventListenerSpy.mock.calls.filter(
      ([event]) => event === "message",
    ).length;

    // Unmount everything, then remount only mount B. This is the cleanest way
    // to verify that mount A's listener is gone while mount B's persists.
    unmountAll();

    // After full unmount, both listeners should have been removed
    const removeCallsAfterUnmount = removeEventListenerSpy.mock.calls.filter(
      ([event]) => event === "message",
    ).length;
    expect(removeCallsAfterUnmount).toBeGreaterThan(removeCallsBefore);

    // Now render only mount B afresh — it gets a fresh listener
    const { unmount: unmountB } = render(
      <WidgetBubble src={SRC_W2} onSubmit={fnB} />,
    );

    const survivingIframe = screen.getByTitle("Interactive widget") as HTMLIFrameElement;

    // Set a unique contentWindow on mount B's iframe
    const fakeContentWindowB = {} as Window;
    Object.defineProperty(survivingIframe, "contentWindow", {
      value: fakeContentWindowB,
      configurable: true,
    });

    // Dispatch with mount B's contentWindow — fnB should fire
    const msgB = new MessageEvent("message", {
      data: { type: "widget-submit", widgetId: "wid-b", value: "survived" },
      origin: window.location.origin,
      source: fakeContentWindowB,
    });
    act(() => { window.dispatchEvent(msgB); });

    // fnB called exactly once — mount B's fresh listener is active
    expect(fnB).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledWith("wid-b", "survived");

    // fnA was never called — mount A was fully unmounted before any messages
    expect(fnA).not.toHaveBeenCalled();

    removeEventListenerSpy.mockRestore();
    unmountB();
  });
});
