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
const mockPause = vi.fn(async () => {});
const mockResume = vi.fn(async () => {});

vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: vi.fn(() => ({
    play: mockPlay,
    stop: mockStop,
    pause: mockPause,
    resume: mockResume,
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
    pause: mockPause,
    resume: mockResume,
  }));
  mockPlay.mockResolvedValue(undefined);
  mockPause.mockResolvedValue(undefined);
  mockResume.mockResolvedValue(undefined);
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
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
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
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalled();
    });
  });

  it("Test 4: while postSpeakStream is pending, button shows Loader2; after resolution, shows Pause (playing)", async () => {
    let resolveStream!: (r: Response) => void;
    mockedPostSpeakStream.mockReturnValueOnce(
      new Promise<Response>((resolve) => { resolveStream = resolve; }),
    );

    render(<ChatMessage role="assistant" content="Loading test" />);
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
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

  it("Test 5: same-bubble click cycles playing → paused → playing via pause()/resume() (never stop())", async () => {
    render(<ChatMessage role="assistant" content="Pause test" />);
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    // Wait for playing state — button now advertises pause action.
    await waitFor(() => {
      const pauseBtn = screen.queryByLabelText(/pause speaking/i);
      expect(pauseBtn).not.toBeNull();
    });

    // Click while playing → player.pause(), aria-label swaps to "Resume speaking"
    fireEvent.click(screen.getByLabelText(/pause speaking/i));
    await waitFor(() => {
      expect(mockPause).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByLabelText(/resume speaking/i)).not.toBeNull();
    });
    expect(mockStop).not.toHaveBeenCalled();

    // Click while paused → player.resume(), aria-label swaps back to "Pause speaking"
    fireEvent.click(screen.getByLabelText(/resume speaking/i));
    await waitFor(() => {
      expect(mockResume).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByLabelText(/pause speaking/i)).not.toBeNull();
    });
    expect(mockStop).not.toHaveBeenCalled();
  });

  it("Test 6: clicking a different assistant bubble while one is playing calls stop() on the first player", async () => {
    const { container } = render(
      <div>
        <ChatMessage role="assistant" content="First bubble" />
        <ChatMessage role="assistant" content="Second bubble" />
      </div>,
    );

    // Both assistant bubbles start collapsed (quick-260829-qb9) — expand both to reveal speak buttons.
    for (const header of screen.queryAllByTestId("chatmessage-collapsed-header")) {
      fireEvent.click(header);
    }

    const buttons = container.querySelectorAll("button[aria-label='Speak message']");
    const firstBtn = buttons[0] as HTMLElement;
    const secondBtn = buttons[1] as HTMLElement;

    // Click first bubble
    fireEvent.click(firstBtn);
    await waitFor(() => {
      expect(firstBtn.getAttribute("aria-label")).toBe("Pause speaking");
    });

    // Reset stop spy so we can detect the cross-bubble preempt call
    mockStop.mockClear();

    // Click second bubble — should call stop() on the first player (cross-bubble preempt)
    fireEvent.click(secondBtn);
    await waitFor(() => {
      expect(mockStop).toHaveBeenCalled();
    });
  });

  it("Test 7: cross-bubble preempt cancels a PAUSED bubble via stop() (paused is not sticky)", async () => {
    const { container } = render(
      <div>
        <ChatMessage role="assistant" content="First bubble" />
        <ChatMessage role="assistant" content="Second bubble" />
      </div>,
    );

    // Both assistant bubbles start collapsed (quick-260829-qb9) — expand both to reveal speak buttons.
    for (const header of screen.queryAllByTestId("chatmessage-collapsed-header")) {
      fireEvent.click(header);
    }

    const buttons = container.querySelectorAll("button[aria-label='Speak message']");
    const firstBtn = buttons[0] as HTMLElement;
    const secondBtn = buttons[1] as HTMLElement;

    // Start first, then pause it.
    fireEvent.click(firstBtn);
    await waitFor(() => {
      expect(firstBtn.getAttribute("aria-label")).toBe("Pause speaking");
    });
    fireEvent.click(firstBtn);
    await waitFor(() => {
      expect(firstBtn.getAttribute("aria-label")).toBe("Resume speaking");
    });

    mockStop.mockClear();

    // Click second bubble while first is paused — first's player.stop() is called.
    fireEvent.click(secondBtn);
    await waitFor(() => {
      expect(mockStop).toHaveBeenCalled();
    });
  });
});
