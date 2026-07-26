/**
 * Phase 14 (plain-language-translation-asides) Wave 3 Task 3 — PrettyView
 * aside subsystem integration tests.
 *
 * Covers the wiring layer between the backend WS surface (Wave 2's
 * aside_ready + aside_dismissed frames + accepted aside_arm + aside_
 * dismissed client-side sends) and the frontend render (Task 1's
 * AsideBubble + Task 2's ComposeBoxProps interface).
 *
 * Scenarios:
 *   Test 1: aside_ready WS frame renders AsideBubble at bottom of message
 *           stream (in-flow, per ASIDE-05).
 *   Test 2: aside_dismissed WS frame clears the AsideBubble.
 *   Test 3: isIdle:false→true transition on identity-attached session
 *           sends {type:'aside_arm'} on the WS (per CONTEXT.md § Trigger
 *           LOCK 2026-07-26 — frontend-arm architecture).
 *   Test 4: isIdle:false→true transition on ANONYMOUS session (pvIdentity
 *           null) does NOT send aside_arm (per CONTEXT.md § Trigger:
 *           identity gating happens frontend-side).
 *   Test 5: fresh-pane mount (hostId/tmuxSession change) resets asideText
 *           to null so the new pane starts clean.
 *
 * Uses the same WS-stub scaffolding shape as PrettyView.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";

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

// Default: anonymous session (no identity). Individual tests override.
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

function fireWsMessage(ws: WsStub, payload: object) {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify(payload),
      }),
    );
  });
}

describe("PrettyView — Phase 14 Wave 3 Task 3 aside subsystem wiring", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    // Default: anonymous session (Tests 4 + baseline). Individual tests
    // override this via useSessionIdentityMock.mockReturnValue().
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    // jsdom lacks ResizeObserver; useAutoScroll's effect calls
    // `new ResizeObserver(...)` at mount, so provide a no-op stub.
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Test 1: aside_ready WS frame renders AsideBubble at bottom of message stream", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // No aside yet.
    expect(container.querySelector('[role="note"]')).toBeNull();

    // Fire the WS frame.
    fireWsMessage(ws, {
      type: "aside_ready",
      text: "the agent is explaining the current step in plain language",
    });

    await waitFor(() => {
      const note = container.querySelector('[role="note"]');
      expect(note).toBeTruthy();
      expect(note?.textContent).toContain(
        "the agent is explaining the current step in plain language",
      );
    });
  });

  it("Test 2: aside_dismissed WS frame clears the AsideBubble", async () => {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireWsMessage(ws, { type: "aside_ready", text: "hello" });
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeTruthy();
    });

    fireWsMessage(ws, { type: "aside_dismissed" });
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeNull();
    });
  });

  it("Test 3: isIdle:false→true transition on IDENTITY-attached session sends {type:'aside_arm'} on WS", async () => {
    // Override useSessionIdentity to return a non-null identity for this test.
    useSessionIdentityMock.mockReturnValue({
      identity: { key: "tina", displayName: "Tina", colorHue: 200 } as unknown,
      identityHue: 200,
    });

    const { rerender } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isIdle={false}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    // Baseline send count after streaming (only the connectToPane send).
    const sendCountBefore = ws.send.mock.calls.length;

    // Transition isIdle: false → true (agent just settled after a completed turn).
    rerender(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isIdle={true}
      />,
    );

    // Assert an aside_arm WS-send happened after the transition.
    await waitFor(() => {
      const newCalls = ws.send.mock.calls.slice(sendCountBefore);
      const armSend = newCalls.find(([data]) => {
        try {
          return JSON.parse(data as string).type === "aside_arm";
        } catch {
          return false;
        }
      });
      expect(armSend).toBeTruthy();
    });
  });

  it("Test 4: isIdle:false→true transition on ANONYMOUS session (pvIdentity null) does NOT send aside_arm", async () => {
    // Default mock returns identity: null → anonymous session.
    const { rerender } = render(
      <PrettyView
        hostId={1}
        tmuxSession="anon"
        onSend={() => true}
        isIdle={false}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);
    const sendCountBefore = ws.send.mock.calls.length;

    rerender(
      <PrettyView
        hostId={1}
        tmuxSession="anon"
        onSend={() => true}
        isIdle={true}
      />,
    );

    // Give the effect a chance to run; no aside_arm should ever be sent.
    await new Promise((r) => setTimeout(r, 40));
    const newCalls = ws.send.mock.calls.slice(sendCountBefore);
    const armSend = newCalls.find(([data]) => {
      try {
        return JSON.parse(data as string).type === "aside_arm";
      } catch {
        return false;
      }
    });
    expect(armSend).toBeUndefined();
  });

  it("Test 5: fresh-pane mount (hostId/tmuxSession change) resets asideText to null", async () => {
    const { container, rerender } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} />,
    );
    const ws1 = getCurrentWs();
    flipToStreaming(ws1);

    fireWsMessage(ws1, { type: "aside_ready", text: "aside on pane s1" });
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeTruthy();
    });

    // Switch to a fresh pane — the reset block should clear asideText.
    rerender(<PrettyView hostId={2} tmuxSession="s2" onSend={() => true} />);
    // A fresh WS stub is created for the new pane by the WS-setup effect.
    // The aside from the prior pane must be cleared even before the new
    // WS emits its first frame.
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeNull();
    });
  });
});
