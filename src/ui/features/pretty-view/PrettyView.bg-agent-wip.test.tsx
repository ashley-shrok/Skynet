/**
 * Phase 50 Plan 03 Task 3a + Task 3b — PrettyView pendingSends state machine
 * and render interleaving tests.
 *
 * The state machine (Task 3a):
 *   - handleOptimisticSend seeds a PendingSend record (mqid, content, sentAt,
 *     state, timer) into the pendingSends array.
 *   - Incoming kind:"message" role:"user" WS frames head-match the oldest
 *     pending by content equality (post-newline-collapse); on match, remove
 *     the pending AND clearTimeout its 20s timer.
 *   - paste_send_failed and send_keys_error WS frames look up the pending
 *     by mqid and flip it to state:'failed'; ComposeBox's overrideText
 *     prop is populated with the failed content so the user can edit-and-
 *     resend.
 *   - 20s client-side timer flips the pending to state:'failed' when the
 *     specific signal never arrives.
 *   - immediateFailure:true on the optimistic seed lands the pending in
 *     state:'failed' from birth (no timer armed).
 *   - Matched bubbles NEVER flip to failed (D-05 invariant enforced via
 *     clearTimeout on match).
 *   - Mqid threading end-to-end (Blocker #4 fix): the mqid ComposeBox
 *     generates flows through onSend → handleComposeSend → the parent's
 *     onSend prop → matched by paste_send_failed frames.
 *   - WS-close + unmount clears all pending timers.
 *   - onOverrideTextConsumed acks the overrideText one-way trigger
 *     (Warning #6 resolution).
 *
 * The render interleaving (Task 3b):
 *   - Optimistic bubbles render AFTER confirmed messages (chronological).
 *   - 'sending' pendings render as plain bubbles (no spinner); the
 *     optimistic WipBubble carries the in-flight feedback instead.
 *   - Every 'failed' pending shows red styling regardless of position.
 *   - Bubble transitions on match are stable (no visual reshuffling).
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
  useSessionIdentity: () => useSessionIdentityMock(),
}));

vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: () => null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

import { PrettyView } from "./PrettyView";

// A background sub-agent keeps working after the main turn ends; the WIP
// bubble stays lit while the Agents panel has entries (shells don't count).

function sendWsFrame(ws: WsStub, frame: unknown) {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(frame) }),
    );
  });
}

const WIP_SELECTOR = '[aria-label="Claude is working"]';

describe("PrettyView — WIP bubble while a background sub-agent runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function () {
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      }),
    );
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mountStreaming() {
    const { container } = render(
      <PrettyView hostId={1} tmuxSession="s1" isVisible={true} onSend={vi.fn((_text: string) => true)} />,
    );
    const ws = getCurrentWs();
    act(() => ws.onopen?.());
    sendWsFrame(ws, { type: "session", sessionFile: "/tmp/x.jsonl" });
    return { container, ws };
  }

  it("shows the bubble while an agent runs and hides it when the agent finishes", async () => {
    const { container, ws } = mountStreaming();
    await waitFor(() =>
      expect(container.querySelector('[aria-label="Backgrounded agents"]')).toBeNull(),
    );
    expect(container.querySelector(WIP_SELECTOR)).toBeNull();

    sendWsFrame(ws, {
      type: "backgrounded_agents",
      agents: [
        {
          toolUseId: "toolu_a",
          subagentType: "general-purpose",
          description: "Audit flows",
          startedAt: 1,
        },
      ],
    });
    await waitFor(() => expect(container.querySelector(WIP_SELECTOR)).not.toBeNull());

    sendWsFrame(ws, { type: "backgrounded_agents", agents: [] });
    await waitFor(() => expect(container.querySelector(WIP_SELECTOR)).toBeNull());
  });

  it("does not show the bubble for background shells alone", async () => {
    const { container, ws } = mountStreaming();
    sendWsFrame(ws, {
      type: "backgrounded_shells",
      shells: [{ toolUseId: "toolu_s", description: "Serve", command: "python3 -m http.server", ts: 1 }],
    });
    await waitFor(() =>
      expect(container.querySelector('[aria-label="Backgrounded shells"]')).not.toBeNull(),
    );
    expect(container.querySelector(WIP_SELECTOR)).toBeNull();
  });

  it("does not show the agent-driven bubble while the pane is dormant", async () => {
    const { container, ws } = mountStreaming();
    sendWsFrame(ws, { type: "dormant", dormant: true });
    sendWsFrame(ws, {
      type: "backgrounded_agents",
      agents: [{ toolUseId: "toolu_d", subagentType: "Explore", description: "x", startedAt: 1 }],
    });
    await waitFor(() =>
      expect(container.querySelector('[aria-label="Backgrounded agents"]')).not.toBeNull(),
    );
    expect(container.querySelector(WIP_SELECTOR)).toBeNull();
  });
});
