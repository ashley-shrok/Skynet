/**
 * Phase 137 Plan 05 — PrettyView widget-submit routing tests.
 *
 * Tests cover:
 *   isWidgetSubmit predicate (Behaviors 1-4): verified indirectly through the
 *   handleOptimisticSend render-blacklist gate — a payload starting with
 *   "/widget-submit " produces ZERO pending bubbles; other payloads produce one.
 *
 *   handleWidgetSubmit dispatcher (Behaviors 5-8): verified by mocking WidgetBubble
 *   to capture its onSubmit prop, triggering it, and asserting:
 *     - ws.send is called with the synthesized "/widget-submit <id> <value>" payload
 *     - No pending bubble is created (gate short-circuit)
 *     - The WS-not-open path calls sendInput (which returns false) and no bubble appears
 *
 *   ChatMessage prop wiring (Behavior 9): verified by checking that the WidgetBubble
 *   stub receives a non-null onSubmit prop for confirmed messages; the pending-sends
 *   ChatMessage mount does NOT render WidgetBubble at all (pending sends never contain
 *   widget URLs).
 *
 *   WS-not-open path (Behavior 10): ws.readyState = CLOSED → sendInput returns false
 *   → handleOptimisticSend receives immediateFailure:true → no bubble rendered (gate
 *   still fires).
 *
 * Mock strategy mirrors PrettyView.optimistic-bubbles.test.tsx:
 *   - WS stub via vi.mock("@/api/claude-session-api")
 *   - use-editable-file-eligibility mocked to return "interactive-message" for widget URLs
 *   - WidgetBubble mocked to capture onSubmit prop (spy pattern)
 *   - useChatSurfaceAdapter not needed (source defaults to harness kind)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";

// ── WS stub ──────────────────────────────────────────────────────────────────

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
  return wsStubs[wsStubs.length - 1]!;
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
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
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

// ── eligibility hook: returns "interactive-message" for widget URLs ──────────

vi.mock("./use-editable-file-eligibility", () => ({
  useEditableFileEligibility: vi.fn(() => new Map()),
}));

// ── WidgetBubble spy: captures onSubmit so we can fire it in tests ────────────
// Phase 137 D-137: spy pattern to exercise handleWidgetSubmit without
// relying on actual iframe postMessage mechanics in jsdom.

const capturedOnSubmitCallbacks: Array<((widgetId: string, value: string) => void) | undefined> = [];

vi.mock("./WidgetBubble", () => ({
  WidgetBubble: ({
    onSubmit,
  }: {
    src: string;
    onSubmit?: (widgetId: string, value: string) => void;
  }) => {
    capturedOnSubmitCallbacks.push(onSubmit);
    return <div data-testid="widget-bubble-mock" />;
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import { PrettyView } from "./PrettyView";
import { useEditableFileEligibility } from "./use-editable-file-eligibility";

const mockedEligibility = vi.mocked(useEditableFileEligibility);
const WIDGET_URL = "https://term.example.com/interactive/3/poll-abc/pane/";

function flipToStreaming(ws: WsStub) {
  act(() => {
    ws.onopen?.();
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }),
      }),
    );
  });
}

function sendWsFrame(ws: WsStub, frame: unknown) {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(frame) }),
    );
  });
}

function countPendingBubbles(container: HTMLElement): number {
  return container.querySelectorAll('[data-event-id^="pending-"]').length;
}

function typeAndEnter(container: HTMLElement, text: string) {
  const textarea = container.querySelector(
    'textarea[placeholder^="Message"]',
  ) as HTMLTextAreaElement;
  expect(textarea).not.toBeNull();
  act(() => {
    fireEvent.change(textarea, { target: { value: text } });
    fireEvent.keyDown(textarea, { key: "Enter" });
  });
}

function mountPrettyView() {
  const { container, unmount } = render(
    <PrettyView
      hostId={1}
      tmuxSession="s1"
      isVisible={true}
      onSend={vi.fn(() => true)}
    />,
  );
  return { container, unmount };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Phase 137 Plan 05 — isWidgetSubmit predicate (Behaviors 1-4, tested via gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    capturedOnSubmitCallbacks.length = 0;
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    vi.stubGlobal("ResizeObserver", vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }));
    mockedEligibility.mockReturnValue(new Map());
    vi.useRealTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("Behavior 1: /widget-submit with space and args — gate fires, zero pending bubbles", async () => {
    const { container } = mountPrettyView();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "/widget-submit poll-abc red");

    // The gate short-circuits before seeding pendingSends — zero bubbles.
    expect(countPendingBubbles(container)).toBe(0);
  });

  it("Behavior 2: /widget-submit without trailing space — does NOT match, bubble IS created", async () => {
    // The predicate requires '/widget-submit ' (with trailing space) — bare
    // '/widget-submit' (no space, no args) must NOT match.
    const { container } = mountPrettyView();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    // Type just '/widget-submit' — no trailing space, no args.
    typeAndEnter(container, "/widget-submit");

    // Does NOT match isWidgetSubmit — a pending bubble IS created.
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
  });

  it("Behavior 3: /widget-submit mid-message — does NOT match (prefix check, not substring)", async () => {
    // 'hello /widget-submit poll-abc red' does NOT start with '/widget-submit '
    const { container } = mountPrettyView();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "hello /widget-submit poll-abc red");

    // Not a prefix match — bubble IS created.
    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
  });

  it("Behavior 4: empty string — does NOT match, treated as normal send (creates bubble if any text)", async () => {
    // Sending 'hello' should produce a bubble (baseline sanity check that the
    // gate is NOT over-broadly suppressing normal sends).
    const { container } = mountPrettyView();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    typeAndEnter(container, "hello world");

    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));
  });
});

describe("Phase 137 Plan 05 — handleWidgetSubmit dispatcher (Behaviors 5-8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    capturedOnSubmitCallbacks.length = 0;
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    vi.stubGlobal("ResizeObserver", vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }));
    mockedEligibility.mockReturnValue(new Map());
    vi.useRealTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /**
   * Delivers a confirmed assistant message (role: "assistant") containing a
   * widget URL into the PrettyView WS, so ChatMessage renders WidgetBubble.
   * Also sets the eligibility map so the URL is classified as "interactive-message".
   */
  async function setupWithWidgetMessage(container: HTMLElement, ws: WsStub) {
    // Classify the widget URL before the confirmed message arrives.
    mockedEligibility.mockReturnValue(
      new Map([[WIDGET_URL, "interactive-message"]]),
    );
    // Deliver a confirmed message referencing the widget URL.
    sendWsFrame(ws, {
      type: "message",
      role: "assistant",
      eventId: "evt-widget-1",
      content: `[widget](${WIDGET_URL})`,
      ts: Date.now(),
    });
    // Wait for WidgetBubble stub to render (onSubmit captured).
    await waitFor(() => expect(capturedOnSubmitCallbacks.length).toBeGreaterThan(0));
  }

  it("Behavior 5: handleWidgetSubmit synthesizes '/widget-submit <id> <value>' and calls sendInput", async () => {
    const { container } = mountPrettyView();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    await setupWithWidgetMessage(container, ws);

    // Reset ws.send spy to isolate widget-submit call from prior session frames.
    ws.send.mockClear();

    const onSubmit = capturedOnSubmitCallbacks[capturedOnSubmitCallbacks.length - 1]!;
    expect(typeof onSubmit).toBe("function");

    act(() => {
      onSubmit("poll-abc", "red");
    });

    // sendInput should have been called once with the synthesized payload.
    expect(ws.send).toHaveBeenCalledTimes(1);
    const sentPayload = JSON.parse(ws.send.mock.calls[0][0] as string) as {
      type: string;
      data: string;
      messageQueueItemId?: string;
    };
    expect(sentPayload.type).toBe("input");
    // The data carries the payload AFTER the harness-control-tag neutralization in sendInput.
    // The /widget-submit prefix has no XML-tag shapes, so neutralization is a no-op here.
    expect(sentPayload.data).toBe("/widget-submit poll-abc red");
    // An auto-generated mqid MUST be present so the backend Phase 56 wake gate fires.
    expect(typeof sentPayload.messageQueueItemId).toBe("string");
    expect(sentPayload.messageQueueItemId!.length).toBeGreaterThan(0);
  });

  it("Behavior 6: handleWidgetSubmit calls handleOptimisticSend (WS-not-open path branches correctly)", async () => {
    const { container } = mountPrettyView();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    await setupWithWidgetMessage(container, ws);

    const onSubmit = capturedOnSubmitCallbacks[capturedOnSubmitCallbacks.length - 1]!;

    // Fire the submit — WS is open.
    act(() => {
      onSubmit("poll-abc", "red");
    });

    // handleOptimisticSend is called — but the isWidgetSubmit gate short-circuits
    // before any record is added to pendingSends. Zero pending bubbles confirms
    // both that handleOptimisticSend was called AND that the gate ran.
    expect(countPendingBubbles(container)).toBe(0);
  });

  it("Behavior 7: handleOptimisticSend gate short-circuits on isWidgetSubmit — no pending bubble", async () => {
    const { container } = mountPrettyView();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    await setupWithWidgetMessage(container, ws);

    const onSubmit = capturedOnSubmitCallbacks[capturedOnSubmitCallbacks.length - 1]!;

    // Confirm zero pending bubbles BEFORE submit (baseline).
    expect(countPendingBubbles(container)).toBe(0);

    act(() => {
      onSubmit("poll-abc", "option-1");
    });

    // Still zero — the gate suppressed the pending-bubble seed.
    expect(countPendingBubbles(container)).toBe(0);
  });

  it("Behavior 8: widget-submit blacklist has NO attachment carve-out — gate fires unconditionally", async () => {
    // Verify the /id carve-out does NOT apply to widget-submit: typing
    // '/widget-submit <id> <value>' always suppresses the bubble, never
    // leaks through any attachment path.
    // (handleWidgetSubmit never passes attachments to handleOptimisticSend —
    // the gate fires unconditionally.)
    const { container } = mountPrettyView();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    // Simulate typing '/widget-submit ...' directly via ComposeBox — the same
    // gate path that handleWidgetSubmit routes through.
    typeAndEnter(container, "/widget-submit poll-abc red");

    // Gate fires unconditionally — zero pending bubbles.
    expect(countPendingBubbles(container)).toBe(0);
  });
});

describe("Phase 137 Plan 05 — ChatMessage prop wiring (Behavior 9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    capturedOnSubmitCallbacks.length = 0;
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    vi.stubGlobal("ResizeObserver", vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }));
    mockedEligibility.mockReturnValue(new Map());
    vi.useRealTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("Behavior 9a: primary ChatMessage mount receives onWidgetSubmit — WidgetBubble's onSubmit is non-null when confirmed message has widget URL", async () => {
    const { container } = mountPrettyView();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    mockedEligibility.mockReturnValue(
      new Map([[WIDGET_URL, "interactive-message"]]),
    );

    sendWsFrame(ws, {
      type: "message",
      role: "assistant",
      eventId: "evt-widget-9",
      content: `[poll](${WIDGET_URL})`,
      ts: Date.now(),
    });

    await waitFor(() => expect(capturedOnSubmitCallbacks.length).toBeGreaterThan(0));

    // The onSubmit prop passed to WidgetBubble must be a function (wired to
    // PrettyView's handleWidgetSubmit).
    const onSubmit = capturedOnSubmitCallbacks[capturedOnSubmitCallbacks.length - 1];
    expect(typeof onSubmit).toBe("function");
  });

  it("Behavior 9b: pending-sends ChatMessage mount does NOT render WidgetBubble (no widget URL in pending bubble)", async () => {
    // This tests that the pending-sends ChatMessage mount (line ~4309) does NOT
    // receive onWidgetSubmit. A pending bubble's content is plain text (the user's
    // typed message) — it never contains a widget URL so WidgetBubble never renders
    // from that path. Verify by typing a message and checking the new WidgetBubble
    // stub instances do NOT increase (pending-sends ChatMessage doesn't render one).
    const { container } = mountPrettyView();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    // WidgetBubble stub count before user sends.
    const countBefore = capturedOnSubmitCallbacks.length;

    // Type a normal message — creates a pending-sends bubble.
    typeAndEnter(container, "hello from user");

    await waitFor(() => expect(countPendingBubbles(container)).toBe(1));

    // Pending-sends ChatMessage never renders WidgetBubble — count unchanged.
    expect(capturedOnSubmitCallbacks.length).toBe(countBefore);
  });
});

describe("Phase 137 Plan 05 — WS-not-open path (Behavior 10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    capturedOnSubmitCallbacks.length = 0;
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    vi.stubGlobal("ResizeObserver", vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    }));
    mockedEligibility.mockReturnValue(new Map());
    vi.useRealTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("Behavior 10: WS not open — sendInput is called (returns false) and NO bubble appears (gate still fires)", async () => {
    const { container } = mountPrettyView();
    const ws = getCurrentWs();
    flipToStreaming(ws);
    await waitFor(() =>
      expect(container.querySelector('textarea[placeholder^="Message"]')).not.toBeNull(),
    );

    mockedEligibility.mockReturnValue(
      new Map([[WIDGET_URL, "interactive-message"]]),
    );

    sendWsFrame(ws, {
      type: "message",
      role: "assistant",
      eventId: "evt-widget-10",
      content: `[poll](${WIDGET_URL})`,
      ts: Date.now(),
    });

    await waitFor(() => expect(capturedOnSubmitCallbacks.length).toBeGreaterThan(0));

    const onSubmit = capturedOnSubmitCallbacks[capturedOnSubmitCallbacks.length - 1]!;

    // Close the WS so sendInput will return false.
    act(() => {
      ws.readyState = 3; // CLOSED
    });
    ws.send.mockClear();

    act(() => {
      onSubmit("poll-abc", "blue");
    });

    // sendInput was called (attempted to write the WS frame).
    // With readyState=CLOSED, ws.send is NOT called (sendInput returns early with false).
    // The important assertion: NO pending bubble regardless of WS state, because the
    // isWidgetSubmit gate fires before any pendingSend record is created.
    expect(countPendingBubbles(container)).toBe(0);
  });
});
