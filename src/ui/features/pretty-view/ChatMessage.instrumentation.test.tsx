/**
 * ChatMessage instrumentation smoke tests — Phase 31 Plan 03.
 *
 * Asserts that the [tts] structured log lines emitted by ChatMessage.tsx
 * match the expected shapes per D-11/D-13/D-20.
 *
 * Covers the 5 behaviors specified in the plan:
 *   INSTR-1: speak-start fires with owner/textLen/voice/trigger fields
 *   INSTR-2: play-attempt result=success fires when player.play() resolves
 *   INSTR-3: play-attempt result=blocked fires when play() rejects NotAllowedError
 *   INSTR-4: fetch-error fires when postSpeakStream returns 502
 *   INSTR-5: player-error fires (via onError callback) with errName/errMessage
 *
 * Mock setup mirrors ChatMessage.speak.test.tsx:
 *   - postSpeakStream mocked via vi.mock("@/api/voice-api")
 *   - createWebAudioStreamPlayer mocked to capture callbacks so tests can
 *     invoke onError / onEnded programmatically
 *
 * Assertions use expect.arrayContaining([expect.stringMatching(...)]) on
 * the spy's captured call args so the assertion matches any logged line
 * without over-constraining the exact set of lines emitted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { postSpeakStream } from "@/api/voice-api";
import { createWebAudioStreamPlayer } from "./webAudioStreamPlayer";
import type { WebAudioStreamPlayerOptions } from "./webAudioStreamPlayer";

// ---------------------------------------------------------------------------
// Mock voice-api
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
// Mock WebAudioStreamPlayer — captures callbacks so tests can invoke them
// ---------------------------------------------------------------------------

// Holds the opts passed to the most recent createWebAudioStreamPlayer call.
let capturedOpts: WebAudioStreamPlayerOptions = {};

const mockPlay = vi.fn(async () => {});
const mockStop = vi.fn();
const mockPause = vi.fn(async () => {});
const mockResume = vi.fn(async () => {});

vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: vi.fn((opts: WebAudioStreamPlayerOptions) => {
    capturedOpts = opts;
    return {
      play: mockPlay,
      stop: mockStop,
      pause: mockPause,
      resume: mockResume,
    };
  }),
}));

const mockedPostSpeakStream = vi.mocked(postSpeakStream);
const mockedCreatePlayer = vi.mocked(createWebAudioStreamPlayer);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  capturedOpts = {};

  // Spy without suppressing — calls pass through to vitest's console capture.
  infoSpy = vi.spyOn(console, "info");
  warnSpy = vi.spyOn(console, "warn");
  errorSpy = vi.spyOn(console, "error");

  // Default: happy-path 200 response.
  mockedPostSpeakStream.mockResolvedValue(
    new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }),
  );
  mockedCreatePlayer.mockImplementation((opts: WebAudioStreamPlayerOptions) => {
    capturedOpts = opts;
    return {
      play: mockPlay,
      stop: mockStop,
      pause: mockPause,
      resume: mockResume,
    };
  });
  mockPlay.mockResolvedValue(undefined);
  mockPause.mockResolvedValue(undefined);
  mockResume.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All first-argument strings captured by the info spy. */
function infoLines(): string[] {
  return infoSpy.mock.calls.map((c) => String(c[0]));
}

/** All first-argument strings captured by the warn spy. */
function warnLines(): string[] {
  return warnSpy.mock.calls.map((c) => String(c[0]));
}

/** All first-argument strings captured by the error spy. */
function errorLines(): string[] {
  return errorSpy.mock.calls.map((c) => String(c[0]));
}

// ---------------------------------------------------------------------------
// Instrumentation smoke tests
// ---------------------------------------------------------------------------

describe("ChatMessage [tts] instrumentation", () => {
  it("INSTR-1: clicking speak fires [tts] speak-start with owner/textLen/voice/trigger fields", async () => {
    render(<ChatMessage role="assistant" content="Hello world" />);
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(infoLines()).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^\[tts\] speak-start owner=\S+ textLen=\d+ voice="[^"]+" trigger=/,
          ),
        ]),
      );
    });
  });

  it("INSTR-2: resolved player.play() emits [tts] play-attempt result=success", async () => {
    render(<ChatMessage role="assistant" content="Play success test" />);
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockPlay).toHaveBeenCalled();
    });

    // play() mock resolves immediately; drain microtasks via waitFor.
    await waitFor(() => {
      expect(infoLines()).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^\[tts\] play-attempt.*result=success/),
        ]),
      );
    });
  });

  it("INSTR-3: play() rejecting with NotAllowedError emits [tts] play-attempt result=blocked errName=\"NotAllowedError\"", async () => {
    mockPlay.mockRejectedValueOnce(
      new DOMException("play blocked", "NotAllowedError"),
    );

    render(<ChatMessage role="assistant" content="Blocked test" />);
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockPlay).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(warnLines()).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^\[tts\] play-attempt.*result=blocked errName="NotAllowedError"/,
          ),
        ]),
      );
    });
  });

  it("INSTR-4: postSpeakStream returning 502 emits [tts] fetch-error with status=502", async () => {
    mockedPostSpeakStream.mockResolvedValueOnce(
      new Response(null, { status: 502, statusText: "Bad Gateway" }),
    );

    render(<ChatMessage role="assistant" content="Fetch error test" />);
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(errorLines()).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/\[tts\] fetch-error.*status=502/),
        ]),
      );
    });
  });

  it("INSTR-5: onError callback emits [tts] player-error with errName and errMessage fields", async () => {
    render(<ChatMessage role="assistant" content="Player error test" />);
    // Assistant bubble starts collapsed (quick-260829-qb9) — expand to reveal speak button.
    fireEvent.click(screen.getByTestId("chatmessage-collapsed-header"));
    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    // Wait for the player to be created so capturedOpts is populated.
    await waitFor(() => {
      expect(mockedCreatePlayer).toHaveBeenCalled();
    });

    // Simulate the player surfacing a MediaError-like error via onError callback.
    // In the Web Audio path, errors surface via this callback — never as DOM events.
    const err = Object.assign(new Error("MEDIA_ERR_SRC_NOT_SUPPORTED"), {
      name: "MediaError",
    });
    capturedOpts.onError?.(err);

    await waitFor(() => {
      expect(errorLines()).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^\[tts\] player-error.*errName="MediaError".*errMessage="MEDIA_ERR_SRC_NOT_SUPPORTED"/,
          ),
        ]),
      );
    });
  });
});
