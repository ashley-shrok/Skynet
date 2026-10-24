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
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { postSpeakStream } from "@/api/voice-api";
import { createWebAudioStreamPlayer } from "./webAudioStreamPlayer";
import { clearCurrentPlayer, getButtonSpeechState } from "./speak-singleton";

// ---------------------------------------------------------------------------
// Mock voice-api (patch #237: use postSpeakStream, not postSpeak)
// ---------------------------------------------------------------------------

vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(async () => {
    const stream = new ReadableStream({ start(c) { c.close(); } });
    return new Response(stream, { status: 200 });
  }),
  postSpeak: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" })),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

// ---------------------------------------------------------------------------
// Mock WebAudioStreamPlayer (patch #237)
// ---------------------------------------------------------------------------

const mockPlay = vi.fn(async (_response?: Response) => {});
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
  // Like the real player, play() reports canplay once audio is queued —
  // that is what flips the button from loading to playing.
  mockedCreatePlayer.mockImplementation((opts) => ({
    play: async (response: Response) => {
      opts?.onCanPlay?.();
      return mockPlay(response);
    },
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

  it("Test 4: while postSpeakStream is pending, button shows Loader2; after resolution, shows Pause (playing)", async () => {
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

  it("Test 4b: a 200 alone keeps the spinner — playing only once the player reports audio queued", async () => {
    let reportCanPlay!: () => void;
    mockedCreatePlayer.mockImplementation((opts) => ({
      play: async (response: Response) => {
        reportCanPlay = () => opts?.onCanPlay?.();
        return mockPlay(response);
      },
      stop: mockStop,
      pause: mockPause,
      resume: mockResume,
    }));

    render(<ChatMessage role="assistant" content="Stalled provider" />);
    fireEvent.click(screen.getByLabelText(/speak message/i));

    await waitFor(() => expect(mockPlay).toHaveBeenCalled());
    expect(document.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByLabelText(/pause speaking/i)).toBeNull();

    act(() => reportCanPlay());
    await waitFor(() => expect(screen.getByLabelText(/pause speaking/i)).toBeTruthy());
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("Test 5: same-bubble click cycles playing → paused → playing via pause()/resume() (never stop())", async () => {
    render(<ChatMessage role="assistant" content="Pause test" />);
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

    const buttons = container.querySelectorAll("button[aria-label]");
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

    const buttons = container.querySelectorAll("button[aria-label]");
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

  it("Test 8: publishes its state on the singleton and returns to idle when playback is taken away", async () => {
    const { container } = render(
      <div>
        <ChatMessage role="assistant" content="First bubble" />
        <ChatMessage role="assistant" content="Second bubble" />
      </div>,
    );
    const [firstBtn, secondBtn] = Array.from(container.querySelectorAll("button[aria-label]")) as HTMLElement[];
    const idleLabel = firstBtn.getAttribute("aria-label");

    fireEvent.click(firstBtn);
    await waitFor(() => expect(firstBtn.getAttribute("aria-label")).toBe("Pause speaking"));
    expect(getButtonSpeechState()).toBe("playing");
    fireEvent.click(firstBtn);
    await waitFor(() => expect(getButtonSpeechState()).toBe("paused"));

    // Another bubble preempts → the first falls back to idle.
    fireEvent.click(secondBtn);
    await waitFor(() => expect(secondBtn.getAttribute("aria-label")).toBe("Pause speaking"));
    expect(firstBtn.getAttribute("aria-label")).toBe(idleLabel);

    // Ownership released from outside (voice mode's skip) → idle, nothing published.
    act(() => clearCurrentPlayer());
    await waitFor(() => expect(secondBtn.getAttribute("aria-label")).toBe(idleLabel));
    expect(getButtonSpeechState()).toBeNull();
  });
});

describe("ChatMessage speak button — in-bubble controls are not read aloud", () => {
  // jsdom has no innerText. Stand-in: text of every node not under an
  // element hidden with display:none — what the browser's innerText skips.
  function visibleText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node instanceof HTMLElement && node.style.display === "none") return "";
    return Array.from(node.childNodes).map(visibleText).join("");
  }

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      configurable: true,
      get(this: HTMLElement) {
        return visibleText(this);
      },
    });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as { innerText?: string }).innerText;
  });

  it("quote, code and long-diff blocks speak their content but not Copy / Show all", async () => {
    const diffLines = Array.from({ length: 20 }, (_, i) => `+added line ${i}`).join("\n");
    const content = [
      "Before the quote.",
      "> quoted words",
      "```\ncode words\n```",
      "```diff\n@@ -0,0 +1,20 @@\n" + diffLines + "\n```",
    ].join("\n\n");
    render(<ChatMessage role="assistant" content={content} />);
    expect(screen.getAllByTestId("copyable-block-copy").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId("chat-diff-toggle").textContent).toMatch(/Show all/);

    fireEvent.click(screen.getByLabelText(/speak message/i));
    await waitFor(() => expect(mockedPostSpeakStream).toHaveBeenCalled());

    const spoken = mockedPostSpeakStream.mock.calls.map((c) => c[0]).join(" ");
    expect(spoken).toContain("quoted words");
    expect(spoken).toContain("code words");
    expect(spoken).toContain("added line 0");
    expect(spoken).not.toMatch(/\bCop(y|ied)\b/);
    expect(spoken).not.toMatch(/Show all|Show less/);
    // Controls are restored after the read.
    for (const btn of screen.getAllByTestId("copyable-block-copy")) {
      expect(btn.style.display).toBe("");
    }
    expect(screen.getByTestId("chat-diff-toggle").style.display).toBe("");
  });
});
