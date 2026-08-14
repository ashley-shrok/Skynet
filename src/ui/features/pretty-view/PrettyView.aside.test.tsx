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
import {
  publishFleetStatusSessionState,
  __resetForTest as resetWorkingStore,
} from "@/state/session-working-store";
import type { SessionState } from "@/api/fleet-status-types";

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
    // Reset session-working-store so no stale broadcast state leaks between tests.
    // Required for C1-C3 which drive the aside-arm via publishFleetStatusSessionState.
    resetWorkingStore();
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
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
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
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
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

  // Tests 3, 4, 7, 8, 9 SKIPPED 2026-07-27 (Ashley): the automatic aside-arm
  // emit is disabled at the source via AUTO_ASIDE_ARM_ENABLED=false in
  // PrettyView.tsx. These tests all exercise the isIdle-transition emit
  // contract and are inert while the flag is off. Re-enable together with
  // the flag when a new trigger mechanism lands. Tests 1/2/5/6 stay live
  // — they exercise the render/session-change surface, which is unchanged.
  it.skip("Test 3: isIdle:false→true transition on IDENTITY-attached session sends {type:'aside_arm'} on WS", async () => {
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
        isVisible={true}
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
        isVisible={true}
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

  it.skip("Test 4: isIdle:false→true transition on ANONYMOUS session (pvIdentity null) does NOT send aside_arm", async () => {
    // Default mock returns identity: null → anonymous session.
    const { rerender } = render(
      <PrettyView
        hostId={1}
        tmuxSession="anon"
        onSend={() => true}
        isIdle={false}
        isVisible={true}
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
        isVisible={true}
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
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws1 = getCurrentWs();
    flipToStreaming(ws1);

    fireWsMessage(ws1, { type: "aside_ready", text: "aside on pane s1" });
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeTruthy();
    });

    // Switch to a fresh pane — the reset block should clear asideText.
    rerender(<PrettyView hostId={2} tmuxSession="s2" onSend={() => true} isVisible={true} />);
    // A fresh WS stub is created for the new pane by the WS-setup effect.
    // The aside from the prior pane must be cleared even before the new
    // WS emits its first frame.
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeNull();
    });
  });

  it("Test 6: session_changed WS frame clears displayed asideText", async () => {
    // Phase 14 followup (Ashley 2026-07-26): a session recycle in the SAME
    // pane must drop any displayed aside from the OLD session — otherwise
    // stale aside UI lingers attached to a fresh session until the next
    // aside_ready arrives (or forever if none does).
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" onSend={() => true} isVisible={true} />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireWsMessage(ws, { type: "aside_ready", text: "aside on old session" });
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeTruthy();
    });

    fireWsMessage(ws, {
      type: "session_changed",
      newSessionFile: "/tmp/new.jsonl",
    });
    await waitFor(() => {
      expect(container.querySelector('[role="note"]')).toBeNull();
    });
  });

  it.skip("Test 7: isIdle transition does NOT emit aside_arm when last user turn was /id command", async () => {
    // Phase 14 followup (Ashley 2026-07-27): /id save, /id reset, /id <name>
    // don't need plain-language recaps — suppress the aside for them.
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
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // User's last submission was an /id command (rendered as a user turn).
    fireWsMessage(ws, {
      type: "message",
      role: "user",
      content: "/id save",
      eventId: "u1",
      ts: Date.now(),
    });
    const sendCountBefore = ws.send.mock.calls.length;

    // Transition isIdle: false → true — arm-emitter fires but MUST short-circuit.
    rerender(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isIdle={true}
        isVisible={true}
      />,
    );

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

  it.skip("Test 8: /id turn followed by a real user turn does NOT suppress — only the LAST user turn matters", async () => {
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
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireWsMessage(ws, {
      type: "message",
      role: "user",
      content: "/id save",
      eventId: "u1",
      ts: Date.now(),
    });
    fireWsMessage(ws, {
      type: "message",
      role: "assistant",
      content: "Saved: history +2, handoff rewritten.",
      eventId: "a1",
      ts: Date.now(),
    });
    fireWsMessage(ws, {
      type: "message",
      role: "user",
      content: "help me understand this diff",
      eventId: "u2",
      ts: Date.now(),
    });
    const sendCountBefore = ws.send.mock.calls.length;

    rerender(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isIdle={true}
        isVisible={true}
      />,
    );

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

  // ─────────────────────────────────────────────────────────────────────────
  // C1-C3: Phase 41 Plan 01 — store-driven aside_arm tests
  //
  // These prove PrettyView derives isIdle from publishFleetStatusSessionState
  // (fleet-status broadcast) rather than the isIdle prop. Because
  // AUTO_ASIDE_ARM_ENABLED=false these are also skipped alongside Tests 3/4/7-9
  // — they exercise the same wiring path and are inert while the flag is off.
  // Re-enable together with the flag when the aside subsystem is re-activated.
  // ─────────────────────────────────────────────────────────────────────────

  it.skip("C1: no store publish → isIdleDerived null → aside_arm never fires on mount (null-mount regression guard)", async () => {
    // Guard: Pitfall 1 from 41-RESEARCH.md — if isIdleDerived collapsed null to
    // true on first mount, aside_arm would fire immediately. Null → no fire.
    useSessionIdentityMock.mockReturnValue({
      identity: { key: "tina", displayName: "Tina", colorHue: 200 } as unknown,
      identityHue: 200,
    });

    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // No publishFleetStatusSessionState — store has no record for "1:s1".
    // isIdleDerived is null on this mount. Give any deferred effects time to run.
    await new Promise((r) => setTimeout(r, 40));

    const armSend = ws.send.mock.calls.find(([data]) => {
      try {
        return JSON.parse(data as string).type === "aside_arm";
      } catch {
        return false;
      }
    });
    expect(armSend).toBeUndefined();
  });

  it.skip("C2: publish {status:'busy'} then {status:'idle'} → aside_arm fires exactly once on false→true transition", async () => {
    // Proves store-driven path fires the aside_arm on a real working→idle transition.
    useSessionIdentityMock.mockReturnValue({
      identity: { key: "tina", displayName: "Tina", colorHue: 200 } as unknown,
      identityHue: 200,
    });

    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    const makeState = (overrides: Partial<SessionState> = {}): SessionState => ({
      hostId: "1",
      tmuxSession: "s1",
      sessionId: "sess-1",
      pid: 1234,
      status: "idle",
      backgroundTasks: [],
      updatedAt: Date.now(),
      ...overrides,
    });

    // First: publish working (false→false on isIdleDerived after null — no fire yet)
    act(() => {
      publishFleetStatusSessionState("1", makeState({ status: "busy" }));
    });

    const sendCountAfterBusy = ws.send.mock.calls.length;

    // Then: transition to idle (isIdleDerived: false → true — fire!)
    act(() => {
      publishFleetStatusSessionState("1", makeState({ status: "idle" }));
    });

    await waitFor(() => {
      const newCalls = ws.send.mock.calls.slice(sendCountAfterBusy);
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

  it.skip("C3: publish {status:'busy'} then {status:'idle'} twice → aside_arm fires exactly once (no double-fire on same-value republish)", async () => {
    // Proves the session-working-store's no-op notify guard prevents double-fire
    // when the same idle status is re-published without a real state change.
    useSessionIdentityMock.mockReturnValue({
      identity: { key: "tina", displayName: "Tina", colorHue: 200 } as unknown,
      identityHue: 200,
    });

    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    const makeState = (overrides: Partial<SessionState> = {}): SessionState => ({
      hostId: "1",
      tmuxSession: "s1",
      sessionId: "sess-1",
      pid: 1234,
      status: "idle",
      backgroundTasks: [],
      updatedAt: Date.now(),
      ...overrides,
    });

    act(() => {
      publishFleetStatusSessionState("1", makeState({ status: "busy" }));
    });
    const sendCountAfterBusy = ws.send.mock.calls.length;

    // First idle publish — real transition (false → true)
    act(() => {
      publishFleetStatusSessionState("1", makeState({ status: "idle" }));
    });

    // Second identical idle publish — no-op notify guard; isIdleDerived stays true;
    // prevIsIdleRef is already true so the guard (prev===false) does NOT fire.
    act(() => {
      publishFleetStatusSessionState(
        "1",
        makeState({ status: "idle", updatedAt: Date.now() + 1 }),
      );
    });

    // Wait for effects to settle
    await new Promise((r) => setTimeout(r, 60));

    const newCalls = ws.send.mock.calls.slice(sendCountAfterBusy);
    const armSends = newCalls.filter(([data]) => {
      try {
        return JSON.parse(data as string).type === "aside_arm";
      } catch {
        return false;
      }
    });
    // Exactly one aside_arm — no double-fire
    expect(armSends).toHaveLength(1);
  });

  it.skip("Test 9: isIdle transition does NOT emit aside_arm when last user turn was harness slash-UI /id XML-wrapper form", async () => {
    // UAT amendment E41 (Ashley 2026-07-27): Ashley's PRIMARY /id invocation
    // path is the harness slash-UI, which lands in JSONL as XML-wrapper form
    // (<command-name>/id</command-name>...) rather than raw "/id save" text.
    // Phase 14's initial suppression missed this path; extending isIdCommand
    // to cover both forms.
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
        isVisible={true}
      />,
    );
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // User's last submission was an /id command via harness slash-UI
    // (pretty-view slash-UI emits this XML-wrapper form into JSONL, not raw text).
    fireWsMessage(ws, {
      type: "message",
      role: "user",
      content:
        "<command-message>id</command-message><command-name>/id</command-name><command-args>tina</command-args>",
      eventId: "u1",
      ts: Date.now(),
    });
    const sendCountBefore = ws.send.mock.calls.length;

    // Transition isIdle: false → true — arm-emitter fires but MUST short-circuit.
    rerender(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        onSend={() => true}
        isIdle={true}
        isVisible={true}
      />,
    );

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
});
