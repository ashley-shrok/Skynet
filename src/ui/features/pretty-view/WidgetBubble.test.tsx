/**
 * Phase 137 Plan 04 Task 2 — WidgetBubble component tests.
 *
 * Tests 1-10 covering:
 *   - iframe rendering (src, referrerPolicy, loading, title, height)
 *   - Exponential backoff retry on load error (2s/4s/8s, cap at 3)
 *   - postMessage listener: dual source+origin guard
 *   - Component unmount cleanup (listener removal, timer cancellation)
 *
 * Note (plan-checker MEDIUM-2): WidgetBubble accepts any `src` prop —
 * it just passes it to the iframe. The absolute-HTTPS-URL constraint lives
 * in INTERACTIVE_MSG_URL_RE_CLIENT (classifier), not in this component.
 * Tests here use relative paths which is intentional for component-level testing.
 *
 * Note on contentWindow in JSDOM: JSDOM does not set iframe.contentWindow
 * automatically. We simulate postMessage source matching by accessing the
 * ref's contentWindow via spy or by directly simulating the MessageEvent
 * with a matching source object.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { WidgetBubble } from "./WidgetBubble";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  cleanup();
});

const WIDGET_SRC = "/interactive/3/poll-abc/pane/";

describe("WidgetBubble — Phase 137 Plan 04 Task 2", () => {
  it("Test 1: renders iframe with correct src, referrerPolicy, loading, title, and style", () => {
    render(<WidgetBubble src={WIDGET_SRC} />);

    const iframe = screen.getByTitle("Interactive widget") as HTMLIFrameElement;
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe.getAttribute("src")).toBe(WIDGET_SRC);
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(iframe.getAttribute("loading")).toBe("eager");
    expect(iframe.style.height).toBe("200px");
  });

  it("Test 2: on iframe error event, schedules retry after 2000ms with cache-busting _r param", async () => {
    render(<WidgetBubble src={WIDGET_SRC} />);

    const iframe = screen.getByTitle("Interactive widget") as HTMLIFrameElement;

    // Fire an error event on the iframe
    fireEvent.error(iframe);

    // Before timer fires, src should still be original
    expect(iframe.getAttribute("src")).toBe(WIDGET_SRC);

    // Advance time by 2000ms
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // After the timer, src should have a cache-busting param
    const newSrc = iframe.getAttribute("src") ?? "";
    expect(newSrc).toContain("_r=");
    expect(newSrc).toContain(WIDGET_SRC.replace(/\/$/, "")); // base URL preserved
  });

  it("Test 3: successive error events trigger retries at 2s, then 4s, then 8s (RETRY_DELAYS_MS)", async () => {
    render(<WidgetBubble src={WIDGET_SRC} />);

    const iframe = screen.getByTitle("Interactive widget") as HTMLIFrameElement;

    // First error → should schedule 2s retry
    fireEvent.error(iframe);
    act(() => { vi.advanceTimersByTime(2000); });
    const src1 = iframe.getAttribute("src") ?? "";
    expect(src1).toContain("_r=");

    // Second error (after first retry rendered) → should schedule 4s retry
    fireEvent.error(iframe);
    act(() => { vi.advanceTimersByTime(3999); }); // 4s not yet up
    const srcMid = iframe.getAttribute("src") ?? "";
    // Still at src1 (4s hasn't elapsed)
    expect(srcMid).toBe(src1);

    act(() => { vi.advanceTimersByTime(1); }); // now exactly 4s
    const src2 = iframe.getAttribute("src") ?? "";
    expect(src2).toContain("_r=");
    // src2 should be a different retry URL than src1
    expect(src2).not.toBe(src1);

    // Third error → should schedule 8s retry
    fireEvent.error(iframe);
    act(() => { vi.advanceTimersByTime(7999); }); // 8s not yet up
    const srcMid2 = iframe.getAttribute("src") ?? "";
    expect(srcMid2).toBe(src2); // still src2

    act(() => { vi.advanceTimersByTime(1); }); // now exactly 8s
    const src3 = iframe.getAttribute("src") ?? "";
    expect(src3).toContain("_r=");
    expect(src3).not.toBe(src2);
  });

  it("Test 4: after 3rd retry, further error events do NOT schedule additional retries (cap at 3)", async () => {
    render(<WidgetBubble src={WIDGET_SRC} />);

    const iframe = screen.getByTitle("Interactive widget") as HTMLIFrameElement;

    // Fire 3 errors and advance through all delays
    fireEvent.error(iframe);
    act(() => { vi.advanceTimersByTime(2000); });

    fireEvent.error(iframe);
    act(() => { vi.advanceTimersByTime(4000); });

    fireEvent.error(iframe);
    act(() => { vi.advanceTimersByTime(8000); });

    const srcAfter3 = iframe.getAttribute("src") ?? "";

    // 4th error — should NOT schedule any retry
    fireEvent.error(iframe);
    act(() => { vi.advanceTimersByTime(30000); }); // Wait 30s — no timer should fire

    // src must not change after the 3rd retry cap
    expect(iframe.getAttribute("src")).toBe(srcAfter3);
  });

  it("Test 5: postMessage with wrong event.source is IGNORED — onSubmit not called", () => {
    const onSubmit = vi.fn();
    render(<WidgetBubble src={WIDGET_SRC} onSubmit={onSubmit} />);

    // Fire a message event from a different source (not the iframe's contentWindow)
    const differentWindow = {} as Window;
    const msg = new MessageEvent("message", {
      data: { type: "widget-submit", widgetId: "poll-abc", value: "optA" },
      origin: window.location.origin,
      source: differentWindow,
    });
    act(() => { window.dispatchEvent(msg); });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Test 6: postMessage with wrong event.origin is IGNORED even if source matches", () => {
    const onSubmit = vi.fn();
    const { container } = render(<WidgetBubble src={WIDGET_SRC} onSubmit={onSubmit} />);

    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    // Simulate contentWindow being set to a known object
    const fakeContentWindow = {} as Window;
    Object.defineProperty(iframe, "contentWindow", { value: fakeContentWindow, configurable: true });

    const msg = new MessageEvent("message", {
      data: { type: "widget-submit", widgetId: "poll-abc", value: "optA" },
      origin: "https://evil.example.com", // wrong origin
      source: fakeContentWindow,
    });
    act(() => { window.dispatchEvent(msg); });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Test 7: postMessage with correct source AND origin AND type=widget-submit calls onSubmit(widgetId, value)", () => {
    const onSubmit = vi.fn();
    const { container } = render(<WidgetBubble src={WIDGET_SRC} onSubmit={onSubmit} />);

    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const fakeContentWindow = {} as Window;
    Object.defineProperty(iframe, "contentWindow", { value: fakeContentWindow, configurable: true });

    const msg = new MessageEvent("message", {
      data: { type: "widget-submit", widgetId: "poll-abc", value: "optA" },
      origin: window.location.origin,
      source: fakeContentWindow,
    });
    act(() => { window.dispatchEvent(msg); });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("poll-abc", "optA");
  });

  it("Test 8: postMessage with type !== 'widget-submit' is IGNORED — onSubmit not called", () => {
    const onSubmit = vi.fn();
    const { container } = render(<WidgetBubble src={WIDGET_SRC} onSubmit={onSubmit} />);

    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const fakeContentWindow = {} as Window;
    Object.defineProperty(iframe, "contentWindow", { value: fakeContentWindow, configurable: true });

    const msg = new MessageEvent("message", {
      data: { type: "widget-ping", widgetId: "poll-abc", value: "something" },
      origin: window.location.origin,
      source: fakeContentWindow,
    });
    act(() => { window.dispatchEvent(msg); });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Test 9: component unmount removes message event listener from window", () => {
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = render(<WidgetBubble src={WIDGET_SRC} />);

    unmount();

    // Should have called removeEventListener with "message"
    const messageRemovals = removeEventListenerSpy.mock.calls.filter(
      ([event]) => event === "message"
    );
    expect(messageRemovals.length).toBeGreaterThanOrEqual(1);

    removeEventListenerSpy.mockRestore();
  });

  it("Test 10: error event AFTER unmount does NOT trigger a state update (timers cancelled)", async () => {
    const { container, unmount } = render(<WidgetBubble src={WIDGET_SRC} />);

    const iframe = container.querySelector("iframe") as HTMLIFrameElement;

    // Fire an error event (schedules a 2s retry)
    fireEvent.error(iframe);

    // Unmount before the timer fires
    unmount();

    // Advance time past the retry delay — should NOT cause any React setState
    // If the timer wasn't cancelled, this would cause "can't perform a React
    // state update on an unmounted component"
    expect(() => {
      act(() => { vi.advanceTimersByTime(2000); });
    }).not.toThrow();
  });

  it("Test 11: after 3rd retry error, iframe is replaced by expired-placeholder card", () => {
    render(<WidgetBubble src={WIDGET_SRC} />);
    const iframe = screen.getByTitle("Interactive widget") as HTMLIFrameElement;

    // Fire 3 errors, advancing through each retry delay
    fireEvent.error(iframe);
    act(() => { vi.advanceTimersByTime(2000); });

    const iframe2 = screen.getByTitle("Interactive widget") as HTMLIFrameElement;
    fireEvent.error(iframe2);
    act(() => { vi.advanceTimersByTime(4000); });

    const iframe3 = screen.getByTitle("Interactive widget") as HTMLIFrameElement;
    fireEvent.error(iframe3);
    act(() => { vi.advanceTimersByTime(8000); });

    // After 3rd retry delay, the iframe is still present with retry src.
    // Fire one more error — retryCount is now at cap, so this sets expired=true.
    const iframe4 = screen.queryByTitle("Interactive widget") as HTMLIFrameElement | null;
    if (iframe4) {
      fireEvent.error(iframe4);
      act(() => { vi.advanceTimersByTime(1); });
    }

    // Now the iframe must be gone
    expect(screen.queryByTitle("Interactive widget")).toBeNull();
    // And the placeholder must be present
    expect(screen.getByText(/This interactive message expired/i)).toBeTruthy();
    expect(screen.getByText(/Ask the agent to send it again if you still need it/i)).toBeTruthy();
  });

  it("Test 12: after 2 retry errors, iframe is still present (not yet expired)", () => {
    render(<WidgetBubble src={WIDGET_SRC} />);
    const iframe = screen.getByTitle("Interactive widget") as HTMLIFrameElement;
    fireEvent.error(iframe);
    act(() => { vi.advanceTimersByTime(2000); });
    const iframe2 = screen.getByTitle("Interactive widget") as HTMLIFrameElement;
    fireEvent.error(iframe2);
    act(() => { vi.advanceTimersByTime(4000); });

    // Iframe should still be rendered (only 2 errors so far, cap is 3)
    expect(screen.queryByTitle("Interactive widget")).not.toBeNull();
    expect(screen.queryByText(/This interactive message expired/i)).toBeNull();
  });

  it("Test 13: expired placeholder carries role=status and matching aria-label", () => {
    render(<WidgetBubble src={WIDGET_SRC} />);
    const iframe = screen.getByTitle("Interactive widget") as HTMLIFrameElement;
    fireEvent.error(iframe);
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.error(screen.getByTitle("Interactive widget") as HTMLIFrameElement);
    act(() => { vi.advanceTimersByTime(4000); });
    fireEvent.error(screen.getByTitle("Interactive widget") as HTMLIFrameElement);
    act(() => { vi.advanceTimersByTime(8000); });
    const maybeIframe = screen.queryByTitle("Interactive widget") as HTMLIFrameElement | null;
    if (maybeIframe) {
      fireEvent.error(maybeIframe);
      act(() => { vi.advanceTimersByTime(1); });
    }
    const status = screen.getByRole("status");
    expect(status).toBeTruthy();
    expect(status.getAttribute("aria-label")).toBe("Expired interactive message");
  });
});
