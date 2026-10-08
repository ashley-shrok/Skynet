/**
 * Voice-resolution regression tests.
 *
 * The app sends voice CANDIDATES in preference order —
 *   identity's own voice → role's voice → user's fallbackVoice
 * — and the server speaks in the first one the active TTS provider offers,
 * else the provider's default. PrettyView wires
 * speakVoices={speakVoiceCandidates(pvIdentity, userPrefs.fallbackVoice)};
 * tested here via the pure helper plus ChatMessage (the leaf that calls
 * postSpeakStream) — rendering PrettyView would need a full WS environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatMessage } from "./ChatMessage";
import { speakVoiceCandidates } from "./voice-candidates";
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

describe("speakVoiceCandidates — identity → role → user fallback, deduped", () => {
  it("lists the identity's own voice, then the role's, then the fallback", () => {
    expect(
      speakVoiceCandidates({ voice: "nova", roleDefaults: { voice: "Matthew" } }, "Ruth"),
    ).toEqual(["nova", "Matthew", "Ruth"]);
  });

  it("an identity inheriting its role's voice lists it once", () => {
    // identity.voice is the identity-over-role merge, so it equals the role voice here.
    expect(
      speakVoiceCandidates({ voice: "Matthew", roleDefaults: { voice: "Matthew" } }, "Ruth"),
    ).toEqual(["Matthew", "Ruth"]);
  });

  it("drops missing / empty / non-string values; nothing at all → []", () => {
    expect(speakVoiceCandidates({ voice: null, roleDefaults: { voice: 7 } }, "")).toEqual([]);
    expect(speakVoiceCandidates(null, null)).toEqual([]);
    expect(speakVoiceCandidates(undefined, "Ruth")).toEqual(["Ruth"]);
  });
});

describe("ChatMessage sends its voice candidates with the speak request", () => {
  it("passes the candidates through in order", async () => {
    render(
      <ChatMessage
        role="assistant"
        content="Test message"
        speakVoices={speakVoiceCandidates({ voice: "Joanna", roleDefaults: { voice: "Matthew" } }, "Ruth")}
      />,
    );

    fireEvent.click(screen.getByLabelText(/speak message/i));

    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);
      const [, voices] = mockedPostSpeakStream.mock.calls[0];
      expect(voices).toEqual(["Joanna", "Matthew", "Ruth"]);
    });
  });

  it("no candidates → [] (the server speaks the provider's default voice)", async () => {
    render(<ChatMessage role="assistant" content="Test message" />);

    fireEvent.click(screen.getByLabelText(/speak message/i));

    await waitFor(() => {
      expect(mockedPostSpeakStream).toHaveBeenCalledTimes(1);
      const [, voices] = mockedPostSpeakStream.mock.calls[0];
      expect(voices).toEqual([]);
    });
  });
});

describe("a failing speak shows a notice instead of going silent", () => {
  it("503 from the voice service → 'Couldn't speak this message' notice, button back to idle", async () => {
    const { toast } = await import("sonner");
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "id");
    mockedPostSpeakStream.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));

    render(<ChatMessage role="assistant" content="Test message" speakVoices={["Joanna"]} />);
    fireEvent.click(screen.getByLabelText(/speak message/i));

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("Couldn't speak this message", {
        description: "The voice service is unavailable.",
      });
    });
    expect(screen.getByLabelText(/speak message/i)).toBeTruthy();
  });
});
