// ─── ChatMessage — feedback-thumbs coverage (Phase 124 Plan 01 Task 2 —
// D-53 cases 1-7 + Plan 01 sanity for role="user" and eventId=undefined).
//
// This file owns the ChatMessage-internal thumbs behavior: layout-mode swap
// (feedback OFF vs ON), thumbs-up callback dispatch + pressed-state,
// thumbs-down callback dispatch + pressed-state, second-tap-no-op, both-
// thumbs-allowed, and the user-bubble-untouched invariant.
//
// Intentionally NOT covered here (owned by Plan 02's
// PrettyView.feedback-thumbs.test.tsx):
//   - The thumbs-down modal open / submit / dismiss flow (D-23/D-25) —
//     ChatMessage's onThumbsDown callback is a bare `(eventId) => void`;
//     the modal lives upstream at PrettyView per D-38.
//   - Actual postFeedback / toast fires — same reason; PrettyView owns them.
//   - exchangeText computation (D-33/D-34) — the exchange is built at
//     PrettyView from the messages array; ChatMessage receives it via the
//     callback contract's payload semantics.
//   - RelayInboundBubble / WaitingBubble invariants (D-12/D-13) — separate
//     components with their own render paths; verified from PrettyView-scope
//     tests in Plan 02.
//
// Mock recipe borrowed from ChatMessage.speak.test.tsx (voice-api +
// webAudioStreamPlayer stubs so strip-mode speak paths don't try to make
// real fetch/AudioContext calls) + feedback-store mock (per PATTERNS.md
// "Mock recipe (combined)" section).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

// ─── Feedback pipeline mocks (shape 3 specific) ────────────────────────────

vi.mock("@/feedback/feedback-store", () => ({
  useFeedbackEnabled: vi.fn(() => true),
  __resetForTest: () => {},
}));

// ─── Voice mocks (strip-mode speak still touches these paths) ──────────────

vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(async () => {
    const stream = new ReadableStream({ start(c) { c.close(); } });
    return new Response(stream, { status: 200 });
  }),
  postSpeak: vi.fn(),
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

// ─── Component under test (import AFTER mocks) ─────────────────────────────

import { ChatMessage } from "./ChatMessage";
import { useFeedbackEnabled } from "@/feedback/feedback-store";

// ─── Test suite ────────────────────────────────────────────────────────────

describe("ChatMessage feedback-thumbs (shape 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: feedback ON. Individual tests flip to OFF as needed.
    vi.mocked(useFeedbackEnabled).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── D-53 case 1: Feedback OFF rendering ────────────────────────────────

  it("Test 1: feedback OFF renders in-bubble speak; no strip, no thumbs; bubble has pr-[42px]", () => {
    vi.mocked(useFeedbackEnabled).mockReturnValue(false);

    const { container } = render(
      <ChatMessage role="assistant" content="hello" eventId="e1" />,
    );

    // In-bubble speak button present (as before shape 3): the pv-speak-btn
    // class hook survives on the in-bubble button.
    const inBubbleSpeak = container.querySelector(".pv-speak-btn");
    expect(inBubbleSpeak).not.toBeNull();

    // Bubble div retains the pr-[42px] pocket for the in-bubble speak button.
    const bubble = container.querySelector(".pv-bubble") as HTMLElement | null;
    expect(bubble).not.toBeNull();
    expect(bubble!.className).toContain("pr-[42px]");

    // No strip. No thumbs.
    expect(screen.queryByTestId("pv-chat-message-action-strip")).toBeNull();
    expect(screen.queryByTestId("pv-chat-message-thumbs-up")).toBeNull();
    expect(screen.queryByTestId("pv-chat-message-thumbs-down")).toBeNull();
  });

  // ─── D-53 case 2: Feedback ON rendering ─────────────────────────────────

  it("Test 2: feedback ON renders strip with speak+thumbsUp+thumbsDown; bubble has symmetric pr-[12px]", () => {
    vi.mocked(useFeedbackEnabled).mockReturnValue(true);

    const { container } = render(
      <ChatMessage role="assistant" content="hello" eventId="e1" />,
    );

    // Bubble padding collapsed to symmetric pr-[12px], not pr-[42px].
    const bubble = container.querySelector(".pv-bubble") as HTMLElement | null;
    expect(bubble).not.toBeNull();
    expect(bubble!.className).toContain("pl-[12px]");
    expect(bubble!.className).toContain("pr-[12px]");
    expect(bubble!.className).not.toContain("pr-[42px]");

    // Strip present; three children in left-to-right order.
    const strip = screen.getByTestId("pv-chat-message-action-strip");
    const buttons = strip.querySelectorAll("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].getAttribute("data-testid")).toBe("pv-chat-message-speak");
    expect(buttons[1].getAttribute("data-testid")).toBe("pv-chat-message-thumbs-up");
    expect(buttons[2].getAttribute("data-testid")).toBe("pv-chat-message-thumbs-down");
  });

  // ─── D-53 case 3: Thumbs-up flow ────────────────────────────────────────

  it("Test 3: thumbs-up click fires onThumbsUp(eventId) once + pressed-state hue fill applies", () => {
    vi.mocked(useFeedbackEnabled).mockReturnValue(true);
    const onThumbsUp = vi.fn();

    render(
      <ChatMessage
        role="assistant"
        content="answer"
        eventId="e42"
        onThumbsUp={onThumbsUp}
      />,
    );

    const thumbsUp = screen.getByTestId("pv-chat-message-thumbs-up") as HTMLButtonElement;
    fireEvent.click(thumbsUp);

    expect(onThumbsUp).toHaveBeenCalledTimes(1);
    expect(onThumbsUp).toHaveBeenCalledWith("e42");

    // Pressed-state visual: hue fill background applied.
    expect(thumbsUp.style.background).toContain("hsla(var(--pv-id-hue)");
  });

  // ─── D-53 case 4/5 slice: Thumbs-down flow (callback + pressed state) ───

  it("Test 4: thumbs-down click fires onThumbsDown(eventId) once + pressed-state hue fill applies", () => {
    vi.mocked(useFeedbackEnabled).mockReturnValue(true);
    const onThumbsDown = vi.fn();

    render(
      <ChatMessage
        role="assistant"
        content="answer"
        eventId="e77"
        onThumbsDown={onThumbsDown}
      />,
    );

    const thumbsDown = screen.getByTestId("pv-chat-message-thumbs-down") as HTMLButtonElement;
    fireEvent.click(thumbsDown);

    expect(onThumbsDown).toHaveBeenCalledTimes(1);
    expect(onThumbsDown).toHaveBeenCalledWith("e77");

    // Pressed-state visual: hue fill background applied.
    expect(thumbsDown.style.background).toContain("hsla(var(--pv-id-hue)");
  });

  // ─── D-53 case 6: Second-tap no-op on thumbs-up ─────────────────────────

  it("Test 5: second tap on already-pressed thumbs-up is a no-op (no additional callback fire)", () => {
    vi.mocked(useFeedbackEnabled).mockReturnValue(true);
    const onThumbsUp = vi.fn();

    render(
      <ChatMessage
        role="assistant"
        content="answer"
        eventId="e42"
        onThumbsUp={onThumbsUp}
      />,
    );

    const thumbsUp = screen.getByTestId("pv-chat-message-thumbs-up") as HTMLButtonElement;
    fireEvent.click(thumbsUp);
    const backgroundAfterFirstTap = thumbsUp.style.background;

    fireEvent.click(thumbsUp);

    // Second tap did NOT re-fire the callback.
    expect(onThumbsUp).toHaveBeenCalledTimes(1);
    // Pressed state is stable — background unchanged between clicks.
    expect(thumbsUp.style.background).toBe(backgroundAfterFirstTap);
  });

  // ─── D-53 case 6 (mirror): Second-tap no-op on thumbs-down ──────────────

  it("Test 6: second tap on already-pressed thumbs-down is a no-op", () => {
    vi.mocked(useFeedbackEnabled).mockReturnValue(true);
    const onThumbsDown = vi.fn();

    render(
      <ChatMessage
        role="assistant"
        content="answer"
        eventId="e77"
        onThumbsDown={onThumbsDown}
      />,
    );

    const thumbsDown = screen.getByTestId("pv-chat-message-thumbs-down") as HTMLButtonElement;
    fireEvent.click(thumbsDown);
    fireEvent.click(thumbsDown);

    expect(onThumbsDown).toHaveBeenCalledTimes(1);
  });

  // ─── D-53 case 7: Both-thumbs allowed on the same message ───────────────

  it("Test 7: thumbs-up then thumbs-down on the same message fires both callbacks + both show pressed", () => {
    vi.mocked(useFeedbackEnabled).mockReturnValue(true);
    const onThumbsUp = vi.fn();
    const onThumbsDown = vi.fn();

    render(
      <ChatMessage
        role="assistant"
        content="answer"
        eventId="e99"
        onThumbsUp={onThumbsUp}
        onThumbsDown={onThumbsDown}
      />,
    );

    const thumbsUp = screen.getByTestId("pv-chat-message-thumbs-up") as HTMLButtonElement;
    const thumbsDown = screen.getByTestId("pv-chat-message-thumbs-down") as HTMLButtonElement;

    fireEvent.click(thumbsUp);
    fireEvent.click(thumbsDown);

    expect(onThumbsUp).toHaveBeenCalledTimes(1);
    expect(onThumbsUp).toHaveBeenCalledWith("e99");
    expect(onThumbsDown).toHaveBeenCalledTimes(1);
    expect(onThumbsDown).toHaveBeenCalledWith("e99");

    // Both buttons show pressed-state (hue-fill background).
    expect(thumbsUp.style.background).toContain("hsla(var(--pv-id-hue)");
    expect(thumbsDown.style.background).toContain("hsla(var(--pv-id-hue)");
  });

  // ─── D-53 case 10 (ChatMessage-scope slice): user bubble unaffected ─────

  it("Test 8: role='user' with feedback ON does not render strip/thumbs and keeps px-[12px] padding", () => {
    // INTENTIONAL OVERLAP: Plan 02's PrettyView-scope Test 8 verifies the
    // same D-53 case 10 from the PrettyView angle (full tree + user-message
    // fixture). This ChatMessage-scope test verifies the same case at the
    // leaf. Both angles are cheap and worth keeping (per Plan 01 Task 2's
    // "intentional overlap note").
    vi.mocked(useFeedbackEnabled).mockReturnValue(true);

    const { container } = render(
      <ChatMessage role="user" content="hi" eventId="e1" />,
    );

    // No strip, no thumbs on user bubbles regardless of feedbackEnabled.
    expect(screen.queryByTestId("pv-chat-message-action-strip")).toBeNull();
    expect(screen.queryByTestId("pv-chat-message-thumbs-up")).toBeNull();
    expect(screen.queryByTestId("pv-chat-message-thumbs-down")).toBeNull();

    // User bubble keeps its px-[12px] py-[7px] padding — not the
    // assistant's pl-[12px] pr-[42px] pocket, and not the feedback-ON
    // symmetric pl-[12px] pr-[12px].
    const bubble = container.querySelector(".pv-bubble") as HTMLElement | null;
    expect(bubble).not.toBeNull();
    expect(bubble!.className).toContain("px-[12px]");
    expect(bubble!.className).not.toContain("pr-[42px]");
  });

  // ─── Defensive: missing eventId is a no-op ──────────────────────────────

  it("Test 9: thumbs-up click with no eventId is a no-op (callback never fires, pressed state not set)", () => {
    vi.mocked(useFeedbackEnabled).mockReturnValue(true);
    const onThumbsUp = vi.fn();

    render(
      // No eventId prop — an edge-case for confirmed messages (D-32 makes
      // eventId the messageRef; without one, there's nothing to reference).
      <ChatMessage role="assistant" content="orphan" onThumbsUp={onThumbsUp} />,
    );

    const thumbsUp = screen.getByTestId("pv-chat-message-thumbs-up") as HTMLButtonElement;
    const backgroundBefore = thumbsUp.style.background;

    fireEvent.click(thumbsUp);

    expect(onThumbsUp).not.toHaveBeenCalled();
    // Pressed state not set — background unchanged from resting.
    expect(thumbsUp.style.background).toBe(backgroundBefore);
  });
});
