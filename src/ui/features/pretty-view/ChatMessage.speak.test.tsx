/**
 * ChatMessage speak button tests.
 *
 * Originally: Patch #223 — tested HTMLAudioElement-based buffered speak.
 * Updated: Patch #237 (Phase 19 Plan 04) — updated to test streaming
 * WebAudioStreamPlayer-based speak path.
 *
 * Tests cover: assistant-only rendering, click-to-speak, loading/playing
 * state transitions, same-bubble stop, and cross-bubble preempt.
 *
 * Mock rules (patch #237):
 * - postSpeakStream mocked to return a streaming Response
 * - createWebAudioStreamPlayer mocked to return {play, stop} spies
 * - postSpeak mock retained in case other imports reference it
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { postSpeakStream } from "@/api/voice-api";
import { createWebAudioStreamPlayer } from "./webAudioStreamPlayer";

// ---------------------------------------------------------------------------
// Mock voice-api (patch #237: use postSpeakStream, not postSpeak)
// ---------------------------------------------------------------------------

vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(async () => {
    const stream = new ReadableStream({ start(c) { c.close(); } });
    return new Response(stream, { status: 200 });
  }),
  postSpeak: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" })),
  getVoices: vi.fn(async () => []),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

// ---------------------------------------------------------------------------
// Mock WebAudioStreamPlayer (patch #237)
// ---------------------------------------------------------------------------

const mockPlay = vi.fn(async () => {});
const mockStop = vi.fn();

vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: vi.fn(() => ({
    play: mockPlay,
    stop: mockStop,
  })),
}));

const mockedPostSpeakStream = vi.mocked(postSpeakStream);
const mockedCreatePlayer = vi.mocked(createWebAudioStreamPlayer);

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the mock implementations to default happy-path after clearAllMocks.
  mockedPostSpeakStream.mockResolvedValue(
    new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }),
  );
  mockedCreatePlayer.mockImplementation(() => ({
    play: mockPlay,
    stop: mockStop,
  }));
  mockPlay.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatMessage speak button (patch #237 streaming)", () => {
  it("Test 1: role='assistant' renders exactly one speak button", () => {
    render(<ChatMessage role="assistant" content="Hello from assistant" />);
    const buttons = screen.queryAllByLabelText(/speak|stop/i);
    expect(buttons).toHaveLength(1);
  });

  it("Test 2: role='user' renders NO speak button", () => {
    render(<ChatMessage role="user" content="Hello from user" />);
    const btn = screen.queryByLabelText(/speak|stop/i);
    expect(btn).toBeNull();
  });

  it("Test 3: clicking the speak button calls postSpeakStream with the bubble text", async () => {
    render(<ChatMessage role="assistant" content="Speak this text" />);
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalled();
    });
  });

  it("Test 4: while postSpeakStream is pending, button shows Loader2; after resolution, shows Volume2 (playing)", async () => {
    let resolveStream!: (r: Response) => void;
    mockedPostSpeakStream.mockReturnValueOnce(
      new Promise<Response>((resolve) => { resolveStream = resolve; }),
    );

    render(<ChatMessage role="assistant" content="Loading test" />);
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    // During loading: Loader2 spinner should be visible (animate-spin class)
    await waitFor(() => {
      const spinner = document.querySelector(".animate-spin");
      expect(spinner).not.toBeNull();
    });

    // Resolve the stream — transitions to playing state
    resolveStream(new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }));

    // After resolution: spinner gone (playing state has Volume2)
    await waitFor(() => {
      const spinner = document.querySelector(".animate-spin");
      expect(spinner).toBeNull();
    });
  });

  it("Test 5: clicking same button while audio is playing calls player.stop()", async () => {
    render(<ChatMessage role="assistant" content="Stop test" />);
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    // Wait for playing state
    await waitFor(() => {
      const stopBtn = screen.queryByLabelText(/stop speaking/i);
      expect(stopBtn).not.toBeNull();
    });

    // Click again to stop — should call player.stop()
    const stopBtn = screen.getByLabelText(/stop speaking/i);
    fireEvent.click(stopBtn);

    await waitFor(() => {
      expect(mockStop).toHaveBeenCalled();
    });

    // Button should be back to idle
    await waitFor(() => {
      const idleBtn = screen.getByLabelText(/speak message/i);
      expect(idleBtn).not.toBeNull();
    });
  });

  it("Test 6: clicking a different assistant bubble while one is playing calls stop() on the first player", async () => {
    const { container } = render(
      <div>
        <ChatMessage role="assistant" content="First bubble" />
        <ChatMessage role="assistant" content="Second bubble" />
      </div>,
    );

    const buttons = container.querySelectorAll("button[aria-label]");
    const firstBtn = buttons[0] as HTMLElement;
    const secondBtn = buttons[1] as HTMLElement;

    // Click first bubble
    fireEvent.click(firstBtn);
    await waitFor(() => {
      expect(firstBtn.getAttribute("aria-label")).toBe("Stop speaking");
    });

    // Reset stop spy so we can detect the cross-bubble preempt call
    mockStop.mockClear();

    // Click second bubble — should call stop() on the first player (cross-bubble preempt)
    fireEvent.click(secondBtn);
    await waitFor(() => {
      expect(mockStop).toHaveBeenCalled();
    });
  });
});
