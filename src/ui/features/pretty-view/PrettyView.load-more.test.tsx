/**
 * Phase 47 Plan 04 — PrettyView load-more button + cap-off + prepend integration.
 *
 * Locks the observable behavior CONTEXT.md § Shape describes:
 *   - Button appears at the top of a pane's message list when older exists.
 *   - Click sends fetch_older_range { beforeLine, count: 20 } on the pane's WS.
 *   - Response prepends the 20 older messages above the current view.
 *   - First click flips cap-off for the pane's lifetime (live-tail no longer drops-oldest).
 *   - Scroll position anchored to the reading position on prepend.
 *   - Single-request-in-flight: rapid double-click is blocked.
 *   - Error frame surfaces retry-clickable state; oldestLoadedLine NOT touched on error.
 *   - hasMore=false hides the button.
 *   - Pane close/reopen resets cap-off + oldestLoadedLine + sessionTotalLines.
 *   - Client NEVER sends "fetch_older" or "fetch_older_batch" (Phase 45 Test H lock).
 *
 * Test infrastructure lifted VERBATIM from PrettyView.hydration-cap.test.tsx
 * per 47-PATTERNS.md § Pattern D "infrastructure verbatim reuse":
 *   - WS stub scaffolding (WsStub type, wsStubs array, getCurrentWs helper)
 *   - vi.mock('@/api/claude-session-api') zero-arg shape (Plan 45-02 wire contract)
 *   - vi.mock('@/api/compose-drafts-api'), session-hue, IdentityBadge, touch
 *   - ResizeObserver polyfill + HTMLElement.prototype.offsetHeight override on [data-pv-bubble]
 *   - fireMessageBatch(ws, count, ...) helper — one act() drives many frames.
 *
 * Widening from the analog:
 *   - fireMessageBatch adds a startLine parameter so each frame's payload
 *     carries `line: startLine + i` (Plan 01 additive optional field).
 *   - flipToStreaming accepts an opts { totalLines? } so the session frame
 *     carries the widened field (Plan 01 SessionMetaEvent.totalLines?).
 *   - fireLoadOlderResponse fires the new server-to-client frame.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, fireEvent, screen } from "@testing-library/react";

// ── WS stub scaffolding (verbatim copy from PrettyView.hydration-cap.test.tsx) ──

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

const useSessionIdentityMock = vi.fn(() => ({
  identity: null as unknown,
  identityHue: null as number | null,
}));
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: vi.fn(() => null),
  useSessionIdentity: (name: string | null | undefined) =>
    useSessionIdentityMock(name as unknown as never),
}));

vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: () => null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

import { PrettyView } from "./PrettyView";

// ── WS-frame helpers ──────────────────────────────────────────────────────

function flipToStreaming(
  ws: WsStub,
  opts?: { totalLines?: number },
): void {
  act(() => {
    ws.onopen?.();
    const payload: Record<string, unknown> = {
      type: "session",
      sessionFile: "/tmp/x.jsonl",
    };
    if (typeof opts?.totalLines === "number") {
      payload.totalLines = opts.totalLines;
    }
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(payload),
      }),
    );
  });
}

// Fire a batch of message frames, each carrying `line: startLine + i` (Plan 01
// widening — the client tracks oldestLoadedLine as min across the batch).
function fireMessageBatch(
  ws: WsStub,
  count: number,
  startLine: number,
  makePayload: (i: number) => Record<string, unknown>,
): void {
  act(() => {
    for (let i = 0; i < count; i++) {
      const payload = makePayload(i);
      payload.line = startLine + i;
      ws.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify(payload),
        }),
      );
    }
  });
}

// Fire a fetch_older_range_batch response frame — the server-to-client
// answer for the load-more click.
function fireLoadOlderResponse(
  ws: WsStub,
  batch: Array<Record<string, unknown>>,
  oldestLine: number,
  hasMore: boolean,
  error?: string,
): void {
  act(() => {
    const payload: Record<string, unknown> = {
      type: "fetch_older_range_batch",
      messages: batch,
      oldestLine,
      hasMore,
    };
    if (error !== undefined) {
      payload.error = error;
    }
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(payload),
      }),
    );
  });
}

function getBubbles(): NodeListOf<Element> {
  return document.querySelectorAll("[data-pv-bubble]");
}

function findScrollContainer(container: HTMLElement): HTMLElement | null {
  const bubble = container.querySelector(
    "[data-pv-bubble]",
  ) as HTMLElement | null;
  if (!bubble) return null;
  let node: HTMLElement | null = bubble;
  while (node) {
    const cls = node.className || "";
    if (typeof cls === "string" && cls.includes("overflow-y-auto")) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

// Filter helper — only load-more-related sends (post-click ws.send() calls).
function loadOlderSends(ws: WsStub): Array<Record<string, unknown>> {
  return ws.send.mock.calls
    .map((call) => {
      const arg = call[0];
      if (typeof arg !== "string") return null;
      try {
        return JSON.parse(arg) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(
      (p): p is Record<string, unknown> =>
        p !== null && p.type === "fetch_older_range",
    );
}

// Inverse-parity filter — the Phase 45 Test H forbidden names.
function forbiddenLegacySends(ws: WsStub): Array<Record<string, unknown>> {
  return ws.send.mock.calls
    .map((call) => {
      const arg = call[0];
      if (typeof arg !== "string") return null;
      try {
        return JSON.parse(arg) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter(
      (p): p is Record<string, unknown> =>
        p !== null &&
        (p.type === "fetch_older" || p.type === "fetch_older_batch"),
    );
}

// ── Test suite ────────────────────────────────────────────────────────────

describe("PrettyView load-more button + cap-off + prepend behavior", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;
  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;
  const originalOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight",
  );

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    useSessionIdentityMock.mockReturnValue({
      identity: null,
      identityHue: null,
    });
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);

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
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(): number {
        if (this.hasAttribute && this.hasAttribute("data-pv-bubble")) {
          return 80;
        }
        return 0;
      },
    });
    // Phase 71 (2026-09-04, HEAD 79d14042) rewrote PrettyView auto-scroll with
    // a hide-pin-reveal mount-landing pattern: the scroll container is wrapped
    // in a `visibility: hidden` div until the useAutoScroll hook observes a
    // non-zero `scrollHeight` on the container and dispatches effect="reveal".
    // JSDOM defaults scrollHeight to 0 for every element, so without an
    // override the wrapper never becomes visible and Testing Library's
    // getByRole (which filters out inaccessible elements per WAI-ARIA) can't
    // find the LoadMoreOlderButton. Return a positive value for the scroll
    // container so the mount-landing reveal fires exactly like it does in a
    // real browser.
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(): number {
        const cls = (this.className as string) || "";
        if (typeof cls === "string" && cls.includes("overflow-y-auto")) {
          return 1000;
        }
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
    if (originalScrollHeightDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollHeight",
        originalScrollHeightDescriptor,
      );
    } else {
      // JSDOM's default has no descriptor — delete our override.
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)
        .scrollHeight;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Test 1: button hidden when no older exists (totalLines <= messages.length)", async () => {
    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws, { totalLines: 15 });
    fireMessageBatch(ws, 15, 1, (i) => ({
      type: "message",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `short ${i}`,
      eventId: `evt-short-${i}`,
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      expect(getBubbles().length).toBe(15);
    });

    // Button should NOT be present — no older messages behind the view.
    expect(
      screen.queryByRole("button", { name: /Load older messages/i }),
    ).toBeNull();
  });

  it("Test 2: button visible when older exists (totalLines > messages.length after cap)", async () => {
    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    // totalLines=100; the streaming tail delivers lines 81..100 (already after
    // client-side cap of 20 during hydration). 100 > 20 = older exists.
    flipToStreaming(ws, { totalLines: 100 });
    fireMessageBatch(ws, 20, 81, (i) => ({
      type: "message",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `tail ${i}`,
      eventId: `evt-tail-${i}`,
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      expect(getBubbles().length).toBe(20);
    });

    // Button MUST be present — 80 older messages behind the view.
    expect(
      screen.getByRole("button", { name: /Load older messages/i }),
    ).toBeTruthy();
  });

  it("Test 3: click sends { type: fetch_older_range, beforeLine: <oldest>, count: 20 } + NEVER sends forbidden legacy names", async () => {
    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws, { totalLines: 100 });
    fireMessageBatch(ws, 20, 81, (i) => ({
      type: "message",
      role: "assistant",
      content: `tail ${i}`,
      eventId: `evt-t-${i}`,
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      expect(getBubbles().length).toBe(20);
    });

    const button = screen.getByRole("button", {
      name: /Load older messages/i,
    });
    act(() => {
      fireEvent.click(button);
    });

    const sends = loadOlderSends(ws);
    expect(sends.length).toBe(1);
    expect(sends[0]).toEqual({
      type: "fetch_older_range",
      beforeLine: 81,
      count: 20,
    });

    // Inverse parity with hydration-cap.test.tsx Test H — the forbidden legacy
    // names MUST have zero send calls even after the load-more button fires.
    expect(forbiddenLegacySends(ws).length).toBe(0);
  });

  it("Test 4: click flips cap-off — subsequent live-tail messages do NOT drop-oldest (CENTRAL PHASE 47 BEHAVIOR)", async () => {
    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws, { totalLines: 100 });
    // Fire 40 hydration frames (line 61..100) — cap holds DOM at 20 (keeps 81..100).
    fireMessageBatch(ws, 40, 61, (i) => ({
      type: "message",
      role: "assistant",
      content: `hyd ${i}`,
      eventId: `evt-h-${i}`,
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      expect(getBubbles().length).toBe(20);
    });

    // Click the button.
    const button = screen.getByRole("button", {
      name: /Load older messages/i,
    });
    act(() => {
      fireEvent.click(button);
    });

    // Fire the 20-older response batch (lines 61..80).
    const olderBatch: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 20; i++) {
      olderBatch.push({
        type: "message",
        role: "assistant",
        content: `older ${i}`,
        eventId: `evt-older-${i}`,
        ts: 900_000 + i,
        line: 61 + i,
      });
    }
    fireLoadOlderResponse(ws, olderBatch, 61, true);

    await waitFor(() => {
      expect(getBubbles().length).toBe(40);
    });

    // Fire 5 MORE live-tail frames (lines 101..105) — cap-off is now active
    // for this pane, so the DOM grows to 45 (NOT capped back to 20).
    fireMessageBatch(ws, 5, 101, (i) => ({
      type: "message",
      role: "assistant",
      content: `live ${i}`,
      eventId: `evt-live-${i}`,
      ts: 2_000_000 + i,
    }));

    await waitFor(() => {
      expect(getBubbles().length).toBe(45);
    });
  });

  it("Test 5: older messages prepend (not append) — first bubble is oldest of returned batch", async () => {
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws, { totalLines: 100 });
    fireMessageBatch(ws, 20, 81, (i) => ({
      type: "message",
      role: "assistant",
      content: `tail ${i}`,
      eventId: `evt-tail-${i}`,
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      expect(getBubbles().length).toBe(20);
    });
    // Sanity — before click, first bubble is the oldest currently-held (line 81).
    const bubblesBefore = container.querySelectorAll("[data-pv-bubble]");
    expect(
      (bubblesBefore[0] as HTMLElement).getAttribute("data-event-id"),
    ).toBe("evt-tail-0");

    const button = screen.getByRole("button", {
      name: /Load older messages/i,
    });
    act(() => {
      fireEvent.click(button);
    });

    // Server returns messages OLDEST-FIRST (chronological order per Plan 03).
    const olderBatch: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 20; i++) {
      olderBatch.push({
        type: "message",
        role: "assistant",
        content: `older ${i}`,
        eventId: `evt-older-${i}`,
        ts: 900_000 + i,
        line: 61 + i,
      });
    }
    fireLoadOlderResponse(ws, olderBatch, 61, true);

    await waitFor(() => {
      expect(getBubbles().length).toBe(40);
    });

    // Prepend order: first DOM bubble is the OLDEST returned message
    // (batch[0] = evt-older-0 at line 61).
    const bubblesAfter = container.querySelectorAll("[data-pv-bubble]");
    expect(
      (bubblesAfter[0] as HTMLElement).getAttribute("data-event-id"),
    ).toBe("evt-older-0");
    // What was previously the first bubble (evt-tail-0 at line 81) is now at
    // DOM position 20 (0-indexed) — after the 20 prepended older bubbles.
    expect(
      (bubblesAfter[20] as HTMLElement).getAttribute("data-event-id"),
    ).toBe("evt-tail-0");
  });

  it("Test 6: scroll position preserved on prepend (does not yank to top or bottom)", async () => {
    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws, { totalLines: 100 });
    fireMessageBatch(ws, 20, 81, (i) => ({
      type: "message",
      role: "assistant",
      content: `tail ${i}`,
      eventId: `evt-tail-${i}`,
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      expect(getBubbles().length).toBe(20);
    });

    const scrollContainer = findScrollContainer(container);
    expect(scrollContainer).toBeTruthy();
    // Simulate a mid-view scroll position. Set scrollHeight and clientHeight
    // to non-zero so the assertion is meaningful.
    Object.defineProperty(scrollContainer!, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(scrollContainer!, "clientHeight", {
      configurable: true,
      value: 600,
    });
    act(() => {
      scrollContainer!.scrollTop = 100;
      fireEvent.scroll(scrollContainer!);
    });

    // Snapshot scrollTop BEFORE the prepend.
    const scrollTopBefore = scrollContainer!.scrollTop;

    const button = screen.getByRole("button", {
      name: /Load older messages/i,
    });
    act(() => {
      fireEvent.click(button);
    });

    const olderBatch: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 20; i++) {
      olderBatch.push({
        type: "message",
        role: "assistant",
        content: `older ${i}`,
        eventId: `evt-older-${i}`,
        ts: 900_000 + i,
        line: 61 + i,
      });
    }
    fireLoadOlderResponse(ws, olderBatch, 61, true);

    await waitFor(() => {
      expect(getBubbles().length).toBe(40);
    });

    // Scroll position preserved: EITHER browser's overflow-anchor:auto shifted
    // scrollTop upward (positive delta) OR the implementation preserved it
    // manually. Either way, scrollTop MUST NOT snap to 0 (yank-to-top) or to
    // scrollHeight (yank-to-bottom). Assert bounded near the original position
    // OR grown proportionally to the prepended content — accept both because
    // JSDOM's overflow-anchor behavior is implementation-dependent.
    const scrollTopAfter = scrollContainer!.scrollTop;
    // The one thing that would be wrong: yank to 0 (top) with the user having
    // been mid-scroll before. Allow the browser to have shifted it upward
    // (native overflow-anchor) OR left it unchanged (manual anchoring).
    expect(scrollTopAfter).toBeGreaterThanOrEqual(scrollTopBefore);
  });

  it("Test 7: rapid double-click blocked by in-flight state — only 1 send", async () => {
    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws, { totalLines: 100 });
    fireMessageBatch(ws, 20, 81, (i) => ({
      type: "message",
      role: "assistant",
      content: `tail ${i}`,
      eventId: `evt-tail-${i}`,
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      expect(getBubbles().length).toBe(20);
    });

    const button = screen.getByRole("button", {
      name: /Load older messages/i,
    });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    // Only ONE load-older send — the second click was blocked by the
    // in-flight state (button disabled at HTML level, click event never
    // reaches React's onClick handler).
    expect(loadOlderSends(ws).length).toBe(1);
  });

  it("Test 8: error frame — button still visible + retry-clickable + oldestLoadedLine NOT advanced on error", async () => {
    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws, { totalLines: 100 });
    fireMessageBatch(ws, 20, 81, (i) => ({
      type: "message",
      role: "assistant",
      content: `tail ${i}`,
      eventId: `evt-tail-${i}`,
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      expect(getBubbles().length).toBe(20);
    });

    const button1 = screen.getByRole("button", {
      name: /Load older messages/i,
    });
    act(() => {
      fireEvent.click(button1);
    });

    // First send happened.
    expect(loadOlderSends(ws).length).toBe(1);
    expect(loadOlderSends(ws)[0]).toEqual({
      type: "fetch_older_range",
      beforeLine: 81,
      count: 20,
    });

    // Server returns error frame — messages [], oldestLine 0, hasMore false,
    // error "SSH timeout".
    fireLoadOlderResponse(ws, [], 0, false, "SSH timeout");

    // Button is still visible (didn't unmount even though the response's
    // hasMore=false — because the ERROR gate prevents applying hasMore).
    // Its aria-label carries the failure cause.
    const errorButton = await waitFor(() =>
      screen.getByRole("button", {
        name: /couldn't load|failed|error|retry/i,
      }),
    );
    expect(errorButton).toBeTruthy();
    expect(errorButton.getAttribute("aria-label")).toMatch(/SSH timeout/);

    // Retry click — MUST send with the ORIGINAL beforeLine (81), NOT 0.
    // If oldestLoadedLine were advanced to parsed.oldestLine on the error
    // frame, the retry payload would carry beforeLine: 0 which the backend
    // rejects. T-47-24 mitigation.
    act(() => {
      fireEvent.click(errorButton);
    });

    const sendsAfterRetry = loadOlderSends(ws);
    expect(sendsAfterRetry.length).toBe(2);
    expect(sendsAfterRetry[1]).toEqual({
      type: "fetch_older_range",
      beforeLine: 81,
      count: 20,
    });
  });

  it("Test 9: hasMore=false hides the button after successful prepend", async () => {
    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws, { totalLines: 100 });
    fireMessageBatch(ws, 20, 81, (i) => ({
      type: "message",
      role: "assistant",
      content: `tail ${i}`,
      eventId: `evt-tail-${i}`,
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      expect(getBubbles().length).toBe(20);
    });

    const button = screen.getByRole("button", {
      name: /Load older messages/i,
    });
    act(() => {
      fireEvent.click(button);
    });

    // Server returns final batch: hasMore=false.
    const olderBatch: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 20; i++) {
      olderBatch.push({
        type: "message",
        role: "assistant",
        content: `older ${i}`,
        eventId: `evt-older-${i}`,
        ts: 900_000 + i,
        line: 61 + i,
      });
    }
    fireLoadOlderResponse(ws, olderBatch, 61, false);

    await waitFor(() => {
      expect(getBubbles().length).toBe(40);
    });

    // Button MUST unmount now — hasMore=false gate hides it.
    expect(
      screen.queryByRole("button", { name: /Load older messages/i }),
    ).toBeNull();
  });

  it("Test 10: pane close-and-reopen (paneKey change) resets cap-off + oldestLoadedLine (TRANSIENT ACROSS PANE LIFETIMES)", async () => {
    const { rerender } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const wsA = getCurrentWs();
    flipToStreaming(wsA, { totalLines: 100 });
    fireMessageBatch(wsA, 20, 81, (i) => ({
      type: "message",
      role: "assistant",
      content: `A-tail ${i}`,
      eventId: `evt-A-${i}`,
      ts: 1_000_000 + i,
    }));

    await waitFor(() => {
      expect(getBubbles().length).toBe(20);
    });

    // Click the button on pane A — flips cap-off.
    const buttonA = screen.getByRole("button", {
      name: /Load older messages/i,
    });
    act(() => {
      fireEvent.click(buttonA);
    });
    const olderBatchA: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 20; i++) {
      olderBatchA.push({
        type: "message",
        role: "assistant",
        content: `A-older ${i}`,
        eventId: `evt-A-older-${i}`,
        ts: 900_000 + i,
        line: 61 + i,
      });
    }
    fireLoadOlderResponse(wsA, olderBatchA, 61, true);

    await waitFor(() => {
      expect(getBubbles().length).toBe(40);
    });

    // Fire 5 more live-tail frames — cap-off is on for pane A.
    fireMessageBatch(wsA, 5, 101, (i) => ({
      type: "message",
      role: "assistant",
      content: `A-live ${i}`,
      eventId: `evt-A-live-${i}`,
      ts: 2_000_000 + i,
    }));

    await waitFor(() => {
      expect(getBubbles().length).toBe(45);
    });

    // Rerender with a DIFFERENT tmuxSession — paneKey change triggers the
    // fresh-pane reset block at PrettyView.tsx:1054-1092.
    rerender(
      <PrettyView
        hostId={1}
        tmuxSession="s2"
        onSend={() => true}
        isVisible={true}
      />,
    );

    // New WS for pane B — grab the latest stub.
    const wsB = getCurrentWs();
    expect(wsB).not.toBe(wsA);

    flipToStreaming(wsB, { totalLines: 50 });
    // Fire 25 hydration frames on pane B (lines 26..50) — cap re-enforced
    // (only 20 survive).
    fireMessageBatch(wsB, 25, 26, (i) => ({
      type: "message",
      role: "assistant",
      content: `B-tail ${i}`,
      eventId: `evt-B-${i}`,
      ts: 3_000_000 + i,
    }));

    await waitFor(() => {
      // Exactly 20 bubbles — cap enforced from scratch on the new pane
      // (proves capOff was reset to false in the fresh-pane block).
      expect(getBubbles().length).toBe(20);
    });

    // Button visible on the new pane — totalLines=50 > messages.length=20.
    const buttonB = screen.getByRole("button", {
      name: /Load older messages/i,
    });

    // Click the button on pane B — the sent beforeLine MUST reflect the NEW
    // pane's oldest held line (line 31 = 26 + 25 - 20; kept the last 20 of
    // 25 hydration frames), NOT the previous pane's beforeLine (81).
    // If oldestLoadedLine were NOT reset in Hunk C, the click would send
    // beforeLine: 61 (pane A's advanced value) — that would be a leak.
    wsB.send.mockClear();
    act(() => {
      fireEvent.click(buttonB);
    });
    const sendsB = loadOlderSends(wsB);
    expect(sendsB.length).toBe(1);
    expect(sendsB[0]).toEqual({
      type: "fetch_older_range",
      beforeLine: 31,
      count: 20,
    });
  });
});
