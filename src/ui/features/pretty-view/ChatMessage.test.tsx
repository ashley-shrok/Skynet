/**
 * Phase 05 Plan 03 Task 2: sender-side chip render tests for ChatMessage.
 *
 * When a user-role message's content is an injected user turn (produced by
 * formatInjectedUserTurn during the pretty-view upload flow), ChatMessage
 * detects the shape via parseInjectedUserTurn and renders caption text +
 * inline chip strip in the SAME bubble instead of the normal markdown
 * render.
 *
 * Non-injected messages (plain text, all assistant messages) render
 * byte-identically to pre-Plan-03 behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatMessage } from "./ChatMessage";
import { formatInjectedUserTurn } from "@/api/pretty-view-upload-protocol";
import { postSpeakStream } from "@/api/voice-api";
import { createWebAudioStreamPlayer } from "./webAudioStreamPlayer";

// Mock voice-api and webAudioStreamPlayer for speak state-machine tests (Phase 19).
// These mocks only affect the new describe block below; existing tests don't call
// postSpeak at all (they test chip rendering / copy-button behavior).
vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(),
  postSpeak: vi.fn(),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: vi.fn(),
}));

const F1 = {
  filename: "screenshot.png",
  size: 20480,
  mimetype: "image/png",
  uploadTimestamp: "2026-07-20T14:32:11",
  landingPath: "/home/ash/pretty-view-uploads/2026-07-20/143211-screenshot.png",
};

const F2 = {
  filename: "logs.txt",
  size: 3072,
  mimetype: "text/plain",
  uploadTimestamp: "2026-07-20T14:32:11",
  landingPath: "/home/ash/pretty-view-uploads/2026-07-20/143211-logs.txt",
};

describe("ChatMessage — sender-side injected-turn detection (Plan 05-03)", () => {
  it("Test 9: user message with injected-turn content renders caption + inline chip strip in one bubble", () => {
    const content = formatInjectedUserTurn({
      caption: "review these",
      files: [F1, F2],
    });
    render(<ChatMessage role="user" content={content} />);

    // Caption text renders (not through markdown — direct pv-injected-caption slot).
    // Assertion is on the caption text being present in the DOM anywhere in the bubble.
    expect(screen.getByText(/review these/)).toBeTruthy();

    // Two chips render, one per file, chips-only (filename + size), no thumbnails.
    const chips = screen.getAllByTestId("attachment-chip");
    expect(chips).toHaveLength(2);

    // Chip content: filename + human-size.
    expect(screen.getByText(/screenshot\.png/)).toBeTruthy();
    expect(screen.getByText(/20\.0 KB/)).toBeTruthy();
    expect(screen.getByText(/logs\.txt/)).toBeTruthy();
    expect(screen.getByText(/3\.0 KB/)).toBeTruthy();
  });

  it("Test 10: plain user message renders as markdown WITHOUT any chip strip", () => {
    render(<ChatMessage role="user" content="just a normal message" />);
    // No chip strip anywhere in the DOM.
    expect(screen.queryByTestId("attachment-chip-strip")).toBeNull();
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
    // Normal message content still renders.
    expect(screen.getByText(/just a normal message/)).toBeTruthy();
  });

  it("Test 11: assistant message never triggers chip detection even if content coincidentally matches injected format", () => {
    // If an assistant message contained the exact injected-turn shape (very
    // unlikely — but the role gate must be defense-in-depth), it must still
    // render as normal markdown, NOT as a chip strip. Chip rendering is a
    // sender-side affordance for the user's own messages only.
    const content = formatInjectedUserTurn({
      caption: "assistant echo",
      files: [F1],
    });
    render(<ChatMessage role="assistant" content={content} />);
    // No chip strip.
    expect(screen.queryByTestId("attachment-chip-strip")).toBeNull();
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
  });

  it("Test 12: injected turn with empty caption renders only the chip strip (no caption text slot)", () => {
    const content = formatInjectedUserTurn({
      caption: "",
      files: [F1],
    });
    render(<ChatMessage role="user" content={content} />);
    // One chip renders.
    expect(screen.getAllByTestId("attachment-chip")).toHaveLength(1);
    // No caption slot present (or it's empty). Since caption is "", the
    // pv-injected-caption div MUST NOT render — a zero-height slot would
    // still add unwanted margin. Assert the class name isn't in the DOM.
    const captionSlot = document.querySelector(".pv-injected-caption");
    expect(captionSlot).toBeNull();
  });

  it("Test 13: sender-side chips have NO × remove button (readOnly render)", () => {
    const content = formatInjectedUserTurn({
      caption: "hi",
      files: [F1],
    });
    render(<ChatMessage role="user" content={content} />);
    // The already-sent injected turn must never present a remove control —
    // the batch has landed; removal would only confuse the model of "sent".
    expect(
      screen.queryByLabelText(/Remove attachment screenshot\.png/i),
    ).toBeNull();
  });

  it("Test 14: quick-reply thumbs-up render works for the 'let's go' payload", () => {
    // Regression guard: the isQuickReply branch must not be disturbed by
    // the injected-turn detection ordering. ONLY the exact payload "let's go"
    // (case/whitespace insensitive) triggers the ThumbsUp glyph — legacy
    // alt-matches (including 'thumbs up' after the #254 revert) are stripped.
    render(<ChatMessage role="user" content="let's go" />);
    // ThumbsUp glyph is rendered with aria-label "quick reply".
    expect(screen.getByLabelText(/quick reply/i)).toBeTruthy();
    // And no chip strip.
    expect(screen.queryByTestId("attachment-chip-strip")).toBeNull();
  });

  it("Test 14b (Vehicle B strip): legacy 'good to go' payload renders as plain text bubble, NOT thumbs-up", () => {
    render(<ChatMessage role="user" content="good to go" />);
    expect(screen.queryByLabelText(/quick reply/i)).toBeNull();
  });

  it("Test 14c (Vehicle B strip): legacy 'works for me' payload renders as plain text bubble, NOT thumbs-up", () => {
    render(<ChatMessage role="user" content="works for me" />);
    expect(screen.queryByLabelText(/quick reply/i)).toBeNull();
  });

  it("Test 14d (Vehicle B strip): legacy 'go ahead' payload renders as plain text bubble, NOT thumbs-up", () => {
    render(<ChatMessage role="user" content="go ahead" />);
    expect(screen.queryByLabelText(/quick reply/i)).toBeNull();
  });

  it("Test 14e (Vehicle B strip): legacy 'yes' payload renders as plain text bubble, NOT thumbs-up", () => {
    render(<ChatMessage role="user" content="yes" />);
    expect(screen.queryByLabelText(/quick reply/i)).toBeNull();
  });

  it("Test 14f: legacy 'thumbs up' payload renders as plain text bubble, NOT thumbs-up glyph", () => {
    render(<ChatMessage role="user" content="thumbs up" />);
    expect(screen.queryByLabelText(/quick reply/i)).toBeNull();
  });
});

/**
 * Quick task 260730-ujq: copy button on code blocks and blockquotes.
 *
 * Tests G, H, I verify CopyableBlock wiring in ChatMessage's ReactMarkdown
 * component overrides. Test J (regression guard) is implicit — the existing
 * suite above continues to run untouched.
 */
// Reset mocks between tests so per-test setup is deterministic.
beforeEach(() => {
  vi.clearAllMocks();
});

describe("ChatMessage — copy button on code blocks and blockquotes (quick 260730-ujq)", () => {
  it("Test G: fenced code block renders exactly one copy button", () => {
    render(
      <ChatMessage
        role="assistant"
        content={"here is code:\n\n```\nnpm test\n```\n"}
      />,
    );
    const copyBtns = screen.queryAllByTestId("copyable-block-copy");
    expect(copyBtns).toHaveLength(1);
    expect(screen.getByRole("button", { name: /copy/i })).toBeTruthy();
  });

  it("Test H: blockquote renders exactly one copy button inside a blockquote element", () => {
    render(
      <ChatMessage role="assistant" content={"quote:\n\n> hello world\n"} />,
    );
    const copyBtns = screen.queryAllByTestId("copyable-block-copy");
    expect(copyBtns).toHaveLength(1);
    // The copy button must be a descendant of a <blockquote> element.
    const bq = document.querySelector("blockquote");
    expect(bq).not.toBeNull();
    expect(bq?.querySelector("[data-testid='copyable-block-copy']")).not.toBeNull();
  });

  it("Test I: plain prose does NOT get a copy button", () => {
    render(
      <ChatMessage role="assistant" content="just a plain paragraph." />,
    );
    const copyBtns = screen.queryAllByTestId("copyable-block-copy");
    expect(copyBtns).toHaveLength(0);
  });
});

/**
 * Phase 19 Plan 04 (patch #237): speak state machine tests.
 *
 * Tests 18-21 cover the new WebAudioStreamPlayer-based speak handler in
 * ChatMessage.tsx. The voice-api module and webAudioStreamPlayer module are
 * mocked so these tests do not require a real audio context or network.
 *
 * Test numbering: 18-21 (avoids collision with pre-existing Tests 14, 14b, 14c
 * and the Phase 19 non-negotiable that tests 15/16/17 remain unused).
 */
describe("ChatMessage speak state machine (Phase 19 / patch #237)", () => {
  const mockedPostSpeakStream = postSpeakStream as ReturnType<typeof vi.fn>;
  const mockedCreatePlayer = createWebAudioStreamPlayer as ReturnType<typeof vi.fn>;

  it("Test 18 — clicking speak transitions to playing on successful response", async () => {
    // Mock player: play resolves immediately; stop/pause/resume are no-ops.
    const mockPlay = vi.fn().mockResolvedValue(undefined);
    const mockStop = vi.fn();
    const mockPause = vi.fn().mockResolvedValue(undefined);
    const mockResume = vi.fn().mockResolvedValue(undefined);
    mockedCreatePlayer.mockImplementation(() => ({
      play: mockPlay,
      stop: mockStop,
      pause: mockPause,
      resume: mockResume,
    }));

    // Mock fetch: returns a 200 OK response with a readable stream.
    const stream = new ReadableStream({ start(c) { c.close(); } });
    const mockResponse = new Response(stream, { status: 200 });
    mockedPostSpeakStream.mockResolvedValue(mockResponse);

    render(<ChatMessage role="assistant" content="hello" />);

    const speakBtn = screen.getByRole("button", { name: "Speak message" });

    await act(async () => {
      await userEvent.click(speakBtn);
    });

    // After postSpeakStream resolves and play() is called, state should be
    // "playing" — button now advertises Pause as the next action.
    expect(screen.getByRole("button", { name: "Pause speaking" })).toBeTruthy();
    // play() was called with the mock response.
    expect(mockPlay).toHaveBeenCalledWith(mockResponse);
  });

  it("Test 19 — same-bubble click while playing calls pause() (not stop); another click calls resume()", async () => {
    const mockPlay = vi.fn().mockResolvedValue(undefined);
    const mockStop = vi.fn();
    const mockPause = vi.fn().mockResolvedValue(undefined);
    const mockResume = vi.fn().mockResolvedValue(undefined);
    mockedCreatePlayer.mockImplementation(() => ({
      play: mockPlay,
      stop: mockStop,
      pause: mockPause,
      resume: mockResume,
    }));

    const stream = new ReadableStream({ start(c) { c.close(); } });
    mockedPostSpeakStream.mockResolvedValue(new Response(stream, { status: 200 }));

    render(<ChatMessage role="assistant" content="hello" />);
    const speakBtn = screen.getByRole("button", { name: "Speak message" });

    // First click → playing. Button labels itself with the NEXT action: Pause.
    await act(async () => {
      await userEvent.click(speakBtn);
    });
    expect(screen.getByRole("button", { name: "Pause speaking" })).toBeTruthy();

    // Second click → pause() is called, button flips to advertise Resume.
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Pause speaking" }));
    });
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockStop).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Resume speaking" })).toBeTruthy();

    // Third click → resume() is called, button flips back to advertise Pause.
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Resume speaking" }));
    });
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(mockStop).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause speaking" })).toBeTruthy();
  });

  it("Test 20 — mocked player onError callback reverts state to idle", async () => {
    // Capture the onError callback passed to the mock player.
    let capturedOnError: ((err: Error) => void) | undefined;
    mockedCreatePlayer.mockImplementation((opts: { onError?: (err: Error) => void }) => {
      capturedOnError = opts.onError;
      return {
        play: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
        pause: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn().mockResolvedValue(undefined),
      };
    });

    const stream = new ReadableStream({ start(c) { c.close(); } });
    mockedPostSpeakStream.mockResolvedValue(new Response(stream, { status: 200 }));

    render(<ChatMessage role="assistant" content="hello" />);
    const speakBtn = screen.getByRole("button", { name: "Speak message" });

    // Get to "playing" state — the label now advertises Pause as next.
    await act(async () => {
      await userEvent.click(speakBtn);
    });
    expect(screen.getByRole("button", { name: "Pause speaking" })).toBeTruthy();

    // Fire the onError callback (simulates a mid-stream error from the player).
    act(() => {
      capturedOnError?.(new Error("mid-stream blip"));
    });

    // State must revert to idle.
    expect(screen.getByRole("button", { name: "Speak message" })).toBeTruthy();
  });

  it("Test 21 — non-ok response from postSpeakStream reverts state to idle without calling play()", async () => {
    const mockPlay = vi.fn();
    mockedCreatePlayer.mockImplementation(() => ({
      play: mockPlay,
      stop: vi.fn(),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
    }));

    // Non-ok response: 503.
    mockedPostSpeakStream.mockResolvedValue(new Response(null, { status: 503 }));

    render(<ChatMessage role="assistant" content="hello" />);
    const speakBtn = screen.getByRole("button", { name: "Speak message" });

    await act(async () => {
      await userEvent.click(speakBtn);
    });

    // State must end at idle (the try/catch caught the !response.ok throw).
    expect(screen.getByRole("button", { name: "Speak message" })).toBeTruthy();
    // play() must NOT have been called — fast-fail before player.play().
    expect(mockPlay).not.toHaveBeenCalled();
  });
});
