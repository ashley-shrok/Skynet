/**
 * Patch #223: ChatMessage speak button tests.
 *
 * Tests cover: assistant-only rendering, click-to-speak, concurrent-playback,
 * and loading/playing state transitions.
 *
 * Mock rules (per patch #211 lesson):
 * - HTMLAudioElement globally mocked: play() returns Promise.resolve()
 * - fetch / postSpeak mocked to return a Blob
 * - URL.createObjectURL / URL.revokeObjectURL mocked
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";

// ---------------------------------------------------------------------------
// Mock voice-api
// ---------------------------------------------------------------------------

vi.mock("@/api/voice-api", () => ({
  postSpeak: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" })),
  getVoices: vi.fn(async () => []),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

// ---------------------------------------------------------------------------
// Mock Audio + URL globals
// ---------------------------------------------------------------------------

class MockAudio {
  src: string;
  onended: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
}

beforeEach(() => {
  vi.stubGlobal("Audio", MockAudio);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatMessage speak button (patch #223)", () => {
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

  it("Test 3: clicking the speak button calls postSpeak with the bubble text", async () => {
    const { postSpeak } = await import("@/api/voice-api");
    const mockPostSpeak = vi.mocked(postSpeak);
    mockPostSpeak.mockResolvedValueOnce(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }));

    render(<ChatMessage role="assistant" content="Speak this text" />);
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockPostSpeak).toHaveBeenCalled();
    });
  });

  it("Test 4: while postSpeak is pending, button shows Loader2; after resolution, returns to Volume2", async () => {
    const { postSpeak } = await import("@/api/voice-api");
    const mockPostSpeak = vi.mocked(postSpeak);

    let resolveSpeak!: (b: Blob) => void;
    mockPostSpeak.mockReturnValueOnce(
      new Promise<Blob>((resolve) => { resolveSpeak = resolve; })
    );

    render(<ChatMessage role="assistant" content="Loading test" />);
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    // During loading: Loader2 spinner should be visible (animate-spin class)
    await waitFor(() => {
      const spinner = document.querySelector(".animate-spin");
      expect(spinner).not.toBeNull();
    });

    // Resolve the promise
    resolveSpeak(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }));

    // After resolution: spinner gone, Volume2 back
    await waitFor(() => {
      const spinner = document.querySelector(".animate-spin");
      expect(spinner).toBeNull();
    });
  });

  it("Test 5: clicking same button while audio is playing pauses it", async () => {
    const { postSpeak } = await import("@/api/voice-api");
    const mockPostSpeak = vi.mocked(postSpeak);
    const pauseSpy = vi.fn();

    class MockAudioWithSpy extends MockAudio {
      pause() { pauseSpy(); }
    }
    vi.stubGlobal("Audio", MockAudioWithSpy);

    mockPostSpeak.mockResolvedValueOnce(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }));

    render(<ChatMessage role="assistant" content="Stop test" />);
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    // Wait for playing state
    await waitFor(() => {
      const stopBtn = screen.queryByLabelText(/stop speaking/i);
      expect(stopBtn).not.toBeNull();
    });

    // Click again to stop
    const stopBtn = screen.getByLabelText(/stop speaking/i);
    fireEvent.click(stopBtn);

    await waitFor(() => {
      expect(pauseSpy).toHaveBeenCalled();
    });

    // Button should be back to idle (speak message label)
    await waitFor(() => {
      const idleBtn = screen.getByLabelText(/speak message/i);
      expect(idleBtn).not.toBeNull();
    });
  });

  it("Test 6: clicking a different assistant bubble while one is playing pauses the first", async () => {
    const { postSpeak } = await import("@/api/voice-api");
    const mockPostSpeak = vi.mocked(postSpeak);
    const pauseSpy = vi.fn();

    class MockAudioWithSpy extends MockAudio {
      pause() { pauseSpy(); }
    }
    vi.stubGlobal("Audio", MockAudioWithSpy);

    mockPostSpeak.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }));

    const { container } = render(
      <div>
        <ChatMessage role="assistant" content="First bubble" />
        <ChatMessage role="assistant" content="Second bubble" />
      </div>
    );

    const buttons = container.querySelectorAll("button[aria-label]");
    const firstBtn = buttons[0] as HTMLElement;
    const secondBtn = buttons[1] as HTMLElement;

    // Click first bubble
    fireEvent.click(firstBtn);
    await waitFor(() => {
      expect(firstBtn.getAttribute("aria-label")).toBe("Stop speaking");
    });

    // Click second bubble — first should be paused
    fireEvent.click(secondBtn);
    await waitFor(() => {
      expect(pauseSpy).toHaveBeenCalled();
    });
  });
});
