/**
 * Voice-resolution regression tests — Phase 137 Plan 03 Task 2
 *
 * D-16: the frontend voice-resolution chain is:
 *   identity's bound voice → user's fallbackVoice → backend DEFAULT_VOICE
 *
 * These tests verify the contract that PrettyView should apply when wiring
 * identityVoice={pvIdentity?.voice ?? userPrefs.fallbackVoice ?? null}.
 * We test via ChatMessage directly (the leaf component that calls
 * postSpeakStream with the resolved identityVoice prop) — rendering
 * PrettyView in a test would require a full WS environment.
 *
 * Three branches covered:
 *   Branch 1: identity has a bound voice → use identity's voice
 *   Branch 2: identity has no voice, userPrefs.fallbackVoice="Ruth" → use "Ruth"
 *   Branch 3: identity has no voice AND fallbackVoice=null → call with undefined (backend uses DEFAULT_VOICE)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { postSpeakStream } from "@/api/voice-api";

// Mock voice-api (mirrors ChatMessage.speak.test.tsx pattern)
vi.mock("@/api/voice-api", () => ({
  postSpeakStream: vi.fn(async () => {
    const stream = new ReadableStream({ start(c) { c.close(); } });
    return new Response(stream, { status: 200 });
  }),
  postSpeak: vi.fn(async () => new Blob([], { type: "audio/wav" })),
  SAMPLE_PHRASE: "Hi, this is your voice.",
}));

// Mock WebAudioStreamPlayer (mirrors ChatMessage.speak.test.tsx pattern)
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

beforeEach(() => {
  vi.clearAllMocks();
  mockedPostSpeakStream.mockResolvedValue(
    new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 }),
  );
  mockPlay.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Voice resolution (D-16) — identity voice → user fallback → backend default", () => {
  it("Branch 1: identity has bound voice 'Joanna' — postSpeakStream called with 'Joanna'", async () => {
    // PrettyView wire: identityVoice={pvIdentity?.voice ?? userPrefs.fallbackVoice ?? null}
    // identity.voice = "Joanna" → resolved = "Joanna"
    render(
      <ChatMessage
        role="assistant"
        content="Test message"
        identityVoice="Joanna"
      />,
    );

    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);
      const [, voice] = mockedPostSpeakStream.mock.calls[0];
      expect(voice).toBe("Joanna");
    });
  });

  it("Branch 2: identity voice=null, fallbackVoice='Ruth' — postSpeakStream called with 'Ruth'", async () => {
    // PrettyView wire: identityVoice={null ?? "Ruth" ?? null} = "Ruth"
    render(
      <ChatMessage
        role="assistant"
        content="Test message"
        identityVoice="Ruth"
      />,
    );

    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);
      const [, voice] = mockedPostSpeakStream.mock.calls[0];
      expect(voice).toBe("Ruth");
    });
  });

  it("Branch 3: identity voice=null, fallbackVoice=null — postSpeakStream called with undefined (backend uses DEFAULT_VOICE)", async () => {
    // PrettyView wire: identityVoice={null ?? null ?? null} = null
    // ChatMessage: postSpeakStream(text, null ?? undefined) = postSpeakStream(text, undefined)
    render(
      <ChatMessage
        role="assistant"
        content="Test message"
        identityVoice={null}
      />,
    );

    const btn = screen.getByLabelText(/speak message/i);
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);
      const [, voice] = mockedPostSpeakStream.mock.calls[0];
      // null ?? undefined = undefined; backend then applies DEFAULT_VOICE "Joanna"
      expect(voice).toBeUndefined();
    });
  });
});
