/**
 * PrettyView feedback-thumbs plumbing tests — Phase 124 Plan 02 Task 2.
 *
 * Owns the PrettyView-scope coverage of D-53 cases 8-11:
 *   - Case 8: RelayInboundBubble unaffected when feedback ON.
 *   - Case 9: WaitingBubble unaffected when feedback ON.
 *   - Case 10: User bubble unaffected when feedback ON (intentional overlap
 *              with Plan 01's ChatMessage-scope Test 8).
 *   - Case 11: exchangeText carries the prior user turn for a normal user →
 *              assistant exchange; carries assistant-only content when there
 *              is no prior user turn (D-35 edge case).
 *
 * Plus one T-124-05 threat-mitigation test: an interposed relay_inbound
 * frame between a user turn and an assistant reply MUST NOT contribute to
 * exchangeText (the prior-turn lookup filters on m.type === "message" per
 * the discriminator locked at src/ui/api/claude-session-api.ts:43-46).
 *
 * Plus the shape-1 fire-path coverage:
 *   - Thumbs-up click fires postFeedback with { kind:"thumbs_up",
 *     userNote:"", messageRef, exchangeText } + toast.success.
 *   - Thumbs-down click opens the FeedbackModal in thumbs_down variant.
 *   - Modal Send fires postFeedback with { kind:"thumbs_down",
 *     userNote:<typed>, messageRef, exchangeText } + toast + closes.
 *   - Modal close-X fires postFeedback with { kind:"thumbs_down",
 *     userNote:"", messageRef, exchangeText } + toast (dismiss path).
 *
 * Test structure borrows from PrettyView.autoplay.test.tsx (WS-stub-per-
 * render pattern) plus the feedback + voice mock recipe from
 * ChatMessage.feedback-thumbs.test.tsx (Plan 01).
 *
 * NOTE (per PLAN 124-02 warning): the modal-close test uses
 * fireEvent.click(screen.getByTestId("feedback-close")). The
 * document.body escape-keydown path is deliberately avoided — Radix
 * Dialog binds the escape key at DialogPrimitive.Content level, so a
 * document.body-scope keydown is flaky under jsdom. The stable-testid
 * click exercises the same onOpenChange(false) → onDismissWithoutSubmit
 * code path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, waitFor, screen, fireEvent } from "@testing-library/react";

// ─── WS stub harness (borrowed from PrettyView.autoplay.test.tsx) ──────────

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

// ─── Feedback pipeline mocks (shape 3 specific) ────────────────────────────

vi.mock("@/feedback/feedback-store", () => ({
  useFeedbackEnabled: vi.fn(() => true),
  __resetForTest: () => {},
}));

vi.mock("@/feedback/feedback-api", () => ({
  postFeedback: vi.fn(async () => {}),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn() },
  Toaster: () => null,
}));

// ─── Voice mocks (assistant bubbles render the strip's speak button) ───────

vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(async () => {
    const stream = new ReadableStream({ start(c) { c.close(); } });
    return new Response(stream, { status: 200 });
  }),
  postSpeak: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" })),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: vi.fn(() => ({
    play: vi.fn(async () => {}),
    stop: vi.fn(),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
  })),
}));

// ─── PrettyView-scope infrastructure mocks (mirrors autoplay.test.tsx) ─────

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

// Fix WR-03/M2 (2026-09-20): Test 7's D-53 case 9 verifies that
// WaitingBubble does NOT sprout a strip or thumbs when feedback is ON. Prior
// to this mock the test never mounted a WaitingBubble at all (waitingFor
// stayed null, WaitingBubble is gated on waitingFor !== null in
// PrettyView.tsx), making the assertion vacuously true — it would pass even
// if WaitingBubble mistakenly carried thumbs plumbing. Mocking the store so
// individual tests can drive waitingFor to a truthy value lets Test 7
// mount an actual WaitingBubble and assert BOTH that the bubble is present
// AND that no strip/thumbs testids appear. Default return is null so the
// other tests (which do NOT want a WaitingBubble in their render output)
// keep their existing behavior.
vi.mock("@/state/session-waiting-store", () => ({
  useSessionWaitingFor: vi.fn(() => null),
}));

// ─── Imports (after mocks so vi.mock hoisting rebinds these correctly) ─────

import { PrettyView } from "./PrettyView";
import { postFeedback } from "@/feedback/feedback-api";
import { toast } from "sonner";
import { useFeedbackEnabled } from "@/feedback/feedback-store";
import { useSessionWaitingFor } from "@/state/session-waiting-store";

// ─── Helpers ───────────────────────────────────────────────────────────────

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

// ─── Suite ─────────────────────────────────────────────────────────────────

describe("PrettyView feedback-thumbs plumbing (shape 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    vi.mocked(useFeedbackEnabled).mockReturnValue(true);
    // jsdom doesn't implement ResizeObserver — PrettyView's useAutoScroll
    // uses it on mount. Stub matches PrettyView.autoplay.test.tsx.
    vi.stubGlobal("ResizeObserver", function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ─── Test 1: Thumbs-up fires with exchangeText carrying both turns ──────

  it("Test 1: thumbs-up click fires postFeedback with kind=thumbs_up + exchangeText containing both user and assistant content", async () => {
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Deliver a normal user → assistant exchange.
    fireMessageFrame(ws, {
      type: "message",
      role: "user",
      content: "What is 2+2?",
      eventId: "u1",
      ts: 1,
    });
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "It is 4.",
      eventId: "a1",
      ts: 2,
    });

    await waitFor(() => {
      expect(screen.getByTestId("pv-chat-message-thumbs-up")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("pv-chat-message-thumbs-up"));

    expect(postFeedback).toHaveBeenCalledTimes(1);
    expect(postFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "thumbs_up",
        userNote: "",
        messageRef: "a1",
        exchangeText: expect.stringContaining("What is 2+2?"),
      }),
    );
    // Second assertion — must contain the assistant content as well.
    expect(postFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        exchangeText: expect.stringContaining("It is 4."),
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Thanks — feedback sent.", {
      duration: 2000,
    });
  });

  // ─── Test 2: Assistant-only exchangeText when no prior user turn ─────────

  it("Test 2: assistant message with no prior user turn emits exchangeText WITHOUT a **User:** block (D-35)", async () => {
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Only an assistant greeting — no prompting user turn.
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "Hello — how can I help?",
      eventId: "a-greet",
      ts: 1,
    });

    await waitFor(() => {
      expect(screen.getByTestId("pv-chat-message-thumbs-up")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("pv-chat-message-thumbs-up"));

    expect(postFeedback).toHaveBeenCalledTimes(1);
    expect(postFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "thumbs_up",
        messageRef: "a-greet",
        exchangeText: expect.stringContaining("Hello — how can I help?"),
      }),
    );
    // D-35 edge case: NO **User:** block prefix in the exchangeText.
    const call = vi.mocked(postFeedback).mock.calls[0]?.[0];
    expect(call?.exchangeText).toBeDefined();
    expect(call?.exchangeText).not.toContain("**User:**");
  });

  // ─── Test 3: Thumbs-down opens the FeedbackModal in thumbs_down variant ─

  it("Test 3: thumbs-down click opens FeedbackModal (variant=thumbs_down) but does NOT yet fire postFeedback", async () => {
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireMessageFrame(ws, {
      type: "message",
      role: "user",
      content: "prompt",
      eventId: "u1",
      ts: 1,
    });
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "reply",
      eventId: "a1",
      ts: 2,
    });

    await waitFor(() => {
      expect(screen.getByTestId("pv-chat-message-thumbs-down")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("pv-chat-message-thumbs-down"));

    // Modal is now present in the DOM.
    await waitFor(() => {
      expect(screen.getByTestId("feedback-dialog")).toBeTruthy();
    });

    // The fire-on-submit / fire-on-dismiss contract means the POST has NOT
    // yet happened at this point (D-25).
    expect(postFeedback).not.toHaveBeenCalled();
  });

  // ─── Test 4: Modal submit fires thumbs_down payload with typed userNote ─

  it("Test 4: modal Send fires postFeedback with kind=thumbs_down + typed userNote + closes modal", async () => {
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireMessageFrame(ws, {
      type: "message",
      role: "user",
      content: "What is 2+2?",
      eventId: "u1",
      ts: 1,
    });
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "It is 4.",
      eventId: "a1",
      ts: 2,
    });

    await waitFor(() => {
      expect(screen.getByTestId("pv-chat-message-thumbs-down")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("pv-chat-message-thumbs-down"));
    await waitFor(() => expect(screen.getByTestId("feedback-dialog")).toBeTruthy());

    // Type a note into the modal's textarea.
    const textarea = screen.getByPlaceholderText("Anything you want to add?");
    fireEvent.change(textarea, { target: { value: "the answer was wrong" } });

    // Click Send — the stable testid on the primary Send button
    // (FeedbackModal.tsx L206).
    fireEvent.click(screen.getByTestId("feedback-send"));

    await waitFor(() => {
      expect(postFeedback).toHaveBeenCalledTimes(1);
    });
    expect(postFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "thumbs_down",
        userNote: "the answer was wrong",
        messageRef: "a1",
        exchangeText: expect.stringContaining("What is 2+2?"),
      }),
    );
    expect(postFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        exchangeText: expect.stringContaining("It is 4."),
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Thanks — feedback sent.", {
      duration: 2000,
    });
    // Modal closed after submit.
    await waitFor(() => {
      expect(screen.queryByTestId("feedback-dialog")).toBeNull();
    });
  });

  // ─── Test 5: Modal dismiss (close-X) fires thumbs_down with EMPTY note ──

  it("Test 5: modal close-X fires postFeedback with kind=thumbs_down + empty userNote (D-25 dismiss path)", async () => {
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireMessageFrame(ws, {
      type: "message",
      role: "user",
      content: "What is 2+2?",
      eventId: "u1",
      ts: 1,
    });
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "It is 4.",
      eventId: "a1",
      ts: 2,
    });

    await waitFor(() => {
      expect(screen.getByTestId("pv-chat-message-thumbs-down")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("pv-chat-message-thumbs-down"));
    await waitFor(() => expect(screen.getByTestId("feedback-dialog")).toBeTruthy());

    // Click the close-X button — FeedbackModal.tsx L168 stable testid.
    // The document.body-scope escape-key path is deliberately avoided
    // (Radix listens on DialogPrimitive.Content, so jsdom flakiness).
    fireEvent.click(screen.getByTestId("feedback-close"));

    await waitFor(() => {
      expect(postFeedback).toHaveBeenCalledTimes(1);
    });
    expect(postFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "thumbs_down",
        userNote: "",
        messageRef: "a1",
        exchangeText: expect.stringContaining("What is 2+2?"),
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Thanks — feedback sent.", {
      duration: 2000,
    });
    // Modal closed after dismiss.
    await waitFor(() => {
      expect(screen.queryByTestId("feedback-dialog")).toBeNull();
    });
  });

  // ─── Test 6: RelayInboundBubble unaffected when feedback ON (D-53 #8) ───

  it("Test 6: RelayInboundBubble renders no strip and no thumbs even when feedback is ON", async () => {
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireMessageFrame(ws, {
      type: "relay_inbound",
      room: "!r:s",
      sender: "@u:s",
      body: "external msg",
      eventId: "r1",
      ts: 1,
    });

    // Give the render a beat.
    await waitFor(() => {
      // RelayInboundBubble has no direct testid we can hook — assert on
      // the absence of the ChatMessage strip pieces instead.
      expect(screen.queryByTestId("pv-chat-message-action-strip")).toBeNull();
    });

    // Absolutely no strip / thumbs testids on the surface.
    expect(screen.queryByTestId("pv-chat-message-action-strip")).toBeNull();
    expect(screen.queryByTestId("pv-chat-message-thumbs-up")).toBeNull();
    expect(screen.queryByTestId("pv-chat-message-thumbs-down")).toBeNull();
  });

  // ─── Test 7: WaitingBubble unaffected when feedback ON (D-53 #9) ────────

  it("Test 7: WaitingBubble renders no strip and no thumbs even when feedback is ON", async () => {
    // Fix WR-03/M2 (2026-09-20): drive useSessionWaitingFor to a truthy
    // waiting reason BEFORE render so WaitingBubble actually mounts. Without
    // this the hook returned null and WaitingBubble never appeared — the
    // absence-of-thumbs assertions below were vacuously true against an
    // empty surface. Now the test mounts an actual WaitingBubble and
    // asserts BOTH that the bubble is present AND that no strip / thumbs
    // testids appear on the WaitingBubble's surface.
    vi.mocked(useSessionWaitingFor).mockReturnValue("permission-prompt");

    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Positive assertion: WaitingBubble is on the surface. WaitingBubble
    // renders with aria-label starting "Harness waiting on you:" (see
    // WaitingBubble.tsx L70-71). Using getByLabelText locks the fixture —
    // if WaitingBubble ever stopped rendering, this test would fail rather
    // than silently passing on an empty surface. (Cannot use getByRole
    // here because a peer loading-indicator ALSO uses role="status" in
    // pretty-view; matching on the aria-label text is the precise pin.)
    await waitFor(() => {
      expect(
        screen.getByLabelText(/^Harness waiting on you:/),
      ).toBeTruthy();
    });

    // Negative assertion: even though WaitingBubble is rendered, none of
    // the shape-3 strip / thumbs testids appear anywhere on the surface.
    // If ChatMessage's thumbs plumbing ever leaked into WaitingBubble's
    // render path, one of these queries would find something.
    expect(screen.queryByTestId("pv-chat-message-action-strip")).toBeNull();
    expect(screen.queryByTestId("pv-chat-message-thumbs-up")).toBeNull();
    expect(screen.queryByTestId("pv-chat-message-thumbs-down")).toBeNull();
  });

  // ─── Test 8: User bubble unaffected when feedback ON (D-53 #10) ─────────

  it("Test 8: user-role bubble renders no strip and no thumbs even when feedback is ON (PrettyView-scope verification of D-53 case 10)", async () => {
    // INTENTIONAL OVERLAP: Plan 01's ChatMessage.feedback-thumbs.test.tsx
    // Test 8 verifies the same D-53 case 10 from the ChatMessage-leaf angle
    // (rendering <ChatMessage role="user"> directly). This Plan 02 test
    // verifies the same case from the PrettyView-tree angle (rendering
    // full <PrettyView> with a user-message fixture). Both angles are
    // cheap; both are worth keeping (per Plan 02 Task 2 <behavior>).
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    const ws = getCurrentWs();
    flipToStreaming(ws);

    fireMessageFrame(ws, {
      type: "message",
      role: "user",
      content: "hi",
      eventId: "u-only",
      ts: 1,
    });

    // Let render settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // No strip on user-role bubbles.
    expect(screen.queryByTestId("pv-chat-message-action-strip")).toBeNull();
    expect(screen.queryByTestId("pv-chat-message-thumbs-up")).toBeNull();
    expect(screen.queryByTestId("pv-chat-message-thumbs-down")).toBeNull();
  });

  // ─── Test 9: Prior-turn lookup skips relay_inbound frames (T-124-05) ────

  it("Test 9: prior-turn lookup skips an interposed relay_inbound frame — exchangeText carries the real user turn, not the relay content", async () => {
    render(<PrettyView hostId={1} tmuxSession="s1" isVisible={true} />);
    const ws = getCurrentWs();
    flipToStreaming(ws);

    // Timeline: real user turn → relay_inbound (interposed) → assistant reply.
    // The prior-turn lookup MUST filter by m.type === "message" && role ===
    // "user" and thereby skip the relay_inbound frame (which has
    // type === "relay_inbound", not "message").
    fireMessageFrame(ws, {
      type: "message",
      role: "user",
      content: "real user turn",
      eventId: "u1",
      ts: 1,
    });
    fireMessageFrame(ws, {
      type: "relay_inbound",
      room: "!r:s",
      sender: "@u:s",
      body: "external relay content",
      eventId: "r1",
      ts: 2,
    });
    fireMessageFrame(ws, {
      type: "message",
      role: "assistant",
      content: "reply to user1",
      eventId: "a1",
      ts: 3,
    });

    await waitFor(() => {
      expect(screen.getByTestId("pv-chat-message-thumbs-up")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("pv-chat-message-thumbs-up"));

    expect(postFeedback).toHaveBeenCalledTimes(1);
    const call = vi.mocked(postFeedback).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call?.exchangeText).toContain("real user turn");
    expect(call?.exchangeText).toContain("reply to user1");
    // T-124-05 mitigation: the relay content MUST NOT appear in exchangeText.
    expect(call?.exchangeText).not.toContain("external relay content");
  });
});
