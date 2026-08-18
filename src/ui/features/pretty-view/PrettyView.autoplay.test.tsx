/**
 * PrettyView autoplay dispatch tests — quick 260811-8we.
 *
 * Covers:
 *   D1-D7: WS dispatch matrix (armed+visible+assistant → sets target; various guards)
 *   D8-D9: arm/disarm via onLongPressSpeak callback (handleLongPressSpeak toggle)
 *   D10:   paneKey reset clears armed + target
 *
 * Strategy:
 *   - vi.mock("./ChatMessage") returns a stub that renders data-* attributes for
 *     autoplay props and registers the onLongPressSpeak callback on
 *     window.__pvTestLongPress so tests can invoke it.
 *   - WS setup mirrors PrettyView.test.tsx / PrettyView.phase29.test.tsx pattern:
 *     openClaudeSessionSocket is mocked to push a fresh stub per render.
 *   - No fake timers needed for dispatch tests — message frames fire synchronously
 *     via act(). paneKey reset test uses re-render.
 *
 * NOTE: ChatMessage is mocked, so no TTS/speak machinery runs in these tests.
 *   The intent is to test PrettyView's state logic in isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// WS stub harness — mirrors PrettyView.test.tsx §36-77 shape
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => {
    const ws: WsStub = {
      readyState: 1,
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

// ChatMessage mock: renders data-* attributes for autoplay props and registers
// the onLongPressSpeak callback so tests can invoke it externally.
vi.mock("./ChatMessage", () => ({
  ChatMessage: vi.fn((props: {
    eventId?: string;
    autoplayArmed?: boolean;
    autoplayTargetEventId?: string | null;
    onLongPressSpeak?: (eventId: string) => void;
    role?: string;
    content?: string;
  }) => {
    const w = window as typeof window & { __pvTestLongPress?: Map<string, (id: string) => void> };
    w.__pvTestLongPress = w.__pvTestLongPress ?? new Map();
    if (props.eventId && props.onLongPressSpeak) {
      w.__pvTestLongPress.set(props.eventId, props.onLongPressSpeak);
    }
    // Also store the latest callback under a fixed key so tests without a
    // known eventId can still invoke it.
    if (props.onLongPressSpeak) {
      w.__pvTestLongPress.set("__latest__", props.onLongPressSpeak);
    }
    return (
      <div
        data-testid={`chat-message-${props.eventId ?? "noid"}`}
        data-autoplay-armed={String(props.autoplayArmed ?? false)}
        data-autoplay-target={props.autoplayTargetEventId ?? ""}
      />
    );
  }),
}));

import { PrettyView } from "./PrettyView";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flipToStreaming(ws: WsStub): void {
  act(() => {
    ws.onopen?.();
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "session", sessionFile: "/tmp/test.jsonl" }),
      }),
    );
  });
}

function fireMessageFrame(ws: WsStub, frame: Record<string, unknown>): void {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(frame),
      }),
    );
  });
}

/** Get the most recently rendered ChatMessage data-autoplay-target value from the DOM. */
function getAutoplayTarget(container: HTMLElement): string {
  // Find all rendered ChatMessage stubs and return the last one's target
  // (which is the newest message, the one autoplay should be set to).
  const stubs = container.querySelectorAll("[data-autoplay-target]");
  if (stubs.length === 0) return "";
  return stubs[stubs.length - 1].getAttribute("data-autoplay-target") ?? "";
}

/** Get the autoplay-armed value from any rendered ChatMessage stub. */
function getAutoplayArmed(container: HTMLElement): string {
  const stubs = container.querySelectorAll("[data-autoplay-armed]");
  if (stubs.length === 0) return "false";
  return stubs[0].getAttribute("data-autoplay-armed") ?? "false";
}

/** Fire the onLongPressSpeak callback for a given eventId (or latest). */
function fireLongPress(eventId: string): void {
  const w = window as typeof window & { __pvTestLongPress?: Map<string, (id: string) => void> };
  const cb = w.__pvTestLongPress?.get(eventId) ?? w.__pvTestLongPress?.get("__latest__");
  if (!cb) throw new Error(`No onLongPressSpeak registered for eventId="${eventId}"`);
  act(() => {
    cb(eventId);
  });
}

// ---------------------------------------------------------------------------
// PrettyView autoplay dispatch tests (D1-D7)
// ---------------------------------------------------------------------------

describe("PrettyView autoplay dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    const w = window as typeof window & { __pvTestLongPress?: Map<string, (id: string) => void> };
    w.__pvTestLongPress = new Map();
    // Phase 32 (Plan 32-03 Task 3, Rule 3 auto-fix): useAutoScroll now runs
    // whenever <PrettyView> mounts and uses ResizeObserver. jsdom doesn't
    // implement RO, so provide a no-op stub. Pattern mirrors PrettyView.test.tsx.
    vi.stubGlobal('ResizeObserver', function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("D1: armed + visible + assistant message → autoplayTargetEventId set to new eventId", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Arm via long-press on a pre-existing message stub.
    // First: deliver a message so ChatMessage renders and registers the callback.
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "First msg",
      eventId: "evt-0",
      ts: 1000,
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="chat-message-evt-0"]')).not.toBeNull();
    });

    // Arm autoplay.
    fireLongPress("evt-0");

    await waitFor(() => {
      expect(getAutoplayArmed(container)).toBe("true");
    });

    // Now deliver a new assistant message.
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "New message",
      eventId: "evt-1",
      ts: 2000,
    });

    await waitFor(() => {
      const stub = container.querySelector('[data-testid="chat-message-evt-1"]');
      expect(stub).not.toBeNull();
      // The target should be the new eventId
      expect(stub?.getAttribute("data-autoplay-target")).toBe("evt-1");
    });
  });

  it("D2: armed + hidden (isVisible=false) + assistant message → autoplayTargetEventId NOT set", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={false} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Deliver initial message and arm.
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "Initial",
      eventId: "evt-init",
      ts: 1000,
    });

    // Arm (even though hidden — the state can be set, but dispatch is gated on isVisible).
    fireLongPress("__latest__");

    // Deliver new message while hidden.
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "Hidden msg",
      eventId: "evt-hidden",
      ts: 2000,
    });

    await waitFor(() => {
      const stub = container.querySelector('[data-testid="chat-message-evt-hidden"]');
      expect(stub).not.toBeNull();
    });

    // autoplay target should NOT be set to the new message
    const stub = container.querySelector('[data-testid="chat-message-evt-hidden"]');
    expect(stub?.getAttribute("data-autoplay-target") ?? "").not.toBe("evt-hidden");
  });

  it("D3: disarmed + visible + assistant message → autoplayTargetEventId NOT set", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Deliver a message WITHOUT arming autoplay.
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "Disarmed msg",
      eventId: "evt-disarmed",
      ts: 1000,
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="chat-message-evt-disarmed"]')).not.toBeNull();
    });

    const stub = container.querySelector('[data-testid="chat-message-evt-disarmed"]');
    // Target should be empty (no autoplay)
    expect(stub?.getAttribute("data-autoplay-target") ?? "").toBe("");
  });

  it("D4: armed + visible + relay_inbound frame → autoplayTargetEventId NOT set", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Deliver message to arm.
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "Arm msg",
      eventId: "evt-arm-d4",
      ts: 1000,
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="chat-message-evt-arm-d4"]')).not.toBeNull();
    });

    fireLongPress("evt-arm-d4");
    await waitFor(() => expect(getAutoplayArmed(container)).toBe("true"));

    // Now deliver a relay_inbound frame.
    fireMessageFrame(ws, {
      type: "relay_inbound",
      room: "#general",
      sender: "@bob:matrix.org",
      body: "relay text",
      eventId: "evt-relay-in",
      ts: 2000,
    });

    // No ChatMessage stub for relay_inbound (rendered by RelayInboundBubble which is not mocked here).
    // The key check: autoplayTargetEventId on the original arm-msg stub should still be its own
    // eventId (set by the long-press arm), not evt-relay-in.
    await waitFor(() => {
      // target is set to the armed bubble's eventId from the long-press
      const stub = container.querySelector('[data-testid="chat-message-evt-arm-d4"]');
      // It may be "evt-arm-d4" (from arm) but MUST NOT be "evt-relay-in"
      expect(stub?.getAttribute("data-autoplay-target") ?? "").not.toBe("evt-relay-in");
    });
  });

  it("D5: armed + visible + relay_outbound frame → autoplayTargetEventId NOT set", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "Arm for D5",
      eventId: "evt-arm-d5",
      ts: 1000,
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="chat-message-evt-arm-d5"]')).not.toBeNull();
    });

    fireLongPress("evt-arm-d5");
    await waitFor(() => expect(getAutoplayArmed(container)).toBe("true"));

    fireMessageFrame(ws, {
      type: "relay_outbound",
      rawCommand: "/send hello",
      body: null,
      eventId: "evt-relay-out",
      ts: 2000,
    });

    // The autoplay target on any ChatMessage stub must NOT be evt-relay-out
    const stubs = container.querySelectorAll("[data-autoplay-target]");
    stubs.forEach((stub) => {
      expect(stub.getAttribute("data-autoplay-target") ?? "").not.toBe("evt-relay-out");
    });
  });

  it("D6: armed + visible + user role message → autoplayTargetEventId NOT set", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Deliver an assistant message to arm.
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "Arm msg D6",
      eventId: "evt-arm-d6",
      ts: 1000,
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="chat-message-evt-arm-d6"]')).not.toBeNull();
    });

    fireLongPress("evt-arm-d6");
    await waitFor(() => expect(getAutoplayArmed(container)).toBe("true"));

    // Deliver a user-role message.
    fireMessageFrame(ws, {
      type: "message",
      role: "user",
      content: "User message",
      eventId: "evt-user",
      ts: 2000,
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="chat-message-evt-user"]')).not.toBeNull();
    });

    // The user-role stub should NOT have autoplay target set to itself
    const userStub = container.querySelector('[data-testid="chat-message-evt-user"]');
    expect(userStub?.getAttribute("data-autoplay-target") ?? "").not.toBe("evt-user");
  });

  it("D7: sequential preempt — two assistant messages arrive; target ends up as the latest eventId", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Deliver initial message and arm.
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "Arm msg D7",
      eventId: "evt-arm-d7",
      ts: 1000,
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="chat-message-evt-arm-d7"]')).not.toBeNull();
    });

    fireLongPress("evt-arm-d7");
    await waitFor(() => expect(getAutoplayArmed(container)).toBe("true"));

    // Two rapid messages.
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "First",
      eventId: "evt-seq-1",
      ts: 2000,
    });

    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "Second",
      eventId: "evt-seq-2",
      ts: 3000,
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="chat-message-evt-seq-2"]')).not.toBeNull();
    });

    // The latest stub should have the latest target
    const latestStub = container.querySelector('[data-testid="chat-message-evt-seq-2"]');
    expect(latestStub?.getAttribute("data-autoplay-target") ?? "").toBe("evt-seq-2");
  });
});

// ---------------------------------------------------------------------------
// PrettyView autoplay long-press toggle (D8-D9)
// ---------------------------------------------------------------------------

describe("PrettyView autoplay long-press toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    const w = window as typeof window & { __pvTestLongPress?: Map<string, (id: string) => void> };
    w.__pvTestLongPress = new Map();
    // Phase 32 (Plan 32-03 Task 3, Rule 3 auto-fix): useAutoScroll uses
    // ResizeObserver; jsdom lacks it — provide a no-op stub.
    vi.stubGlobal('ResizeObserver', function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("D8: onLongPressSpeak called while disarmed → armed=true + target=eventId", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "D8 msg",
      eventId: "msg-X",
      ts: 1000,
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="chat-message-msg-X"]')).not.toBeNull();
    });

    // Initially disarmed
    expect(getAutoplayArmed(container)).toBe("false");

    // Fire long-press to arm
    fireLongPress("msg-X");

    await waitFor(() => {
      expect(getAutoplayArmed(container)).toBe("true");
    });

    // Target should be set to the just-long-pressed bubble's eventId
    const stub = container.querySelector('[data-testid="chat-message-msg-X"]');
    expect(stub?.getAttribute("data-autoplay-target") ?? "").toBe("msg-X");
  });

  it("D9: onLongPressSpeak called again while armed → armed=false + target=null", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "D9 msg",
      eventId: "msg-Y",
      ts: 1000,
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="chat-message-msg-Y"]')).not.toBeNull();
    });

    // First long-press: arm
    fireLongPress("msg-Y");
    await waitFor(() => expect(getAutoplayArmed(container)).toBe("true"));

    // Second long-press: disarm
    fireLongPress("msg-Y");
    await waitFor(() => expect(getAutoplayArmed(container)).toBe("false"));

    // Target should be cleared
    const stubs = container.querySelectorAll("[data-autoplay-target]");
    stubs.forEach((stub) => {
      expect(stub.getAttribute("data-autoplay-target") ?? "").toBe("");
    });
  });
});

// ---------------------------------------------------------------------------
// PrettyView autoplay pane-scope reset (D10)
// ---------------------------------------------------------------------------

describe("PrettyView autoplay pane-scope reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    const w = window as typeof window & { __pvTestLongPress?: Map<string, (id: string) => void> };
    w.__pvTestLongPress = new Map();
    // Phase 32 (Plan 32-03 Task 3, Rule 3 auto-fix): useAutoScroll uses
    // ResizeObserver; jsdom lacks it — provide a no-op stub.
    vi.stubGlobal('ResizeObserver', function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("D10: paneKey change (hostId+tmuxSession change) resets autoplayArmed to false + target to null", async () => {
    const { container, rerender } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} />,
    );
    const ws1 = getCurrentWs();
    flipToStreaming(ws1);

    fireMessageFrame(ws1, {
      type: "message",
      role: "assistant",
      content: "D10 msg",
      eventId: "msg-d10",
      ts: 1000,
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="chat-message-msg-d10"]')).not.toBeNull();
    });

    // Arm autoplay
    fireLongPress("msg-d10");
    await waitFor(() => expect(getAutoplayArmed(container)).toBe("true"));

    // Switch pane (new hostId + tmuxSession)
    rerender(<PrettyView hostId={2} tmuxSession="s2" isVisible={true} />);

    await waitFor(() => {
      expect(getAutoplayArmed(container)).toBe("false");
    });

    // All stubs should have empty target
    const stubs = container.querySelectorAll("[data-autoplay-target]");
    stubs.forEach((stub) => {
      expect(stub.getAttribute("data-autoplay-target") ?? "").toBe("");
    });
  });
});
