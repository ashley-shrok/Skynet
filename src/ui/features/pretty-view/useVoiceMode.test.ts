// Unit tests for useVoiceMode — the hands-free voice-mode loop behind the
// ComposeBox mic long-press. The browser audio stack (getUserMedia,
// MediaRecorder, AudioContext/AnalyserNode), the STT fetch, the TTS fetch and
// the stream player are all stubbed; the analyser's RMS level is driven by the
// test (`setLevel`) so VAD transitions can be walked with fake timers.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const stampedFetch = vi.fn();
vi.mock("@/lib/stamped-fetch", () => ({ stampedFetch: (...a: unknown[]) => stampedFetch(...a) }));

const postSpeakStream = vi.fn();
vi.mock("../../api/voice-api", () => ({ postSpeakStream: (...a: unknown[]) => postSpeakStream(...a) }));

vi.mock("../../audio/auto-speak-cue", () => ({ playAutoSpeakOn: vi.fn(), playAutoSpeakOff: vi.fn() }));
const playTink = vi.fn();
vi.mock("../../audio/ready-cue", () => ({ playTink: () => playTink() }));

type PlayerOpts = { onEnded?: () => void; onError?: (e: Error) => void };
const players: Array<{ opts: PlayerOpts; play: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: (opts: PlayerOpts) => {
    const p = { opts, play: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), pause: vi.fn(), resume: vi.fn() };
    players.push(p);
    return p;
  },
}));

import {
  useVoiceMode,
  isExitPhrase,
  toSpeakableText,
  SILENCE_END_MS,
  type UseVoiceModeArgs,
  type VoiceModeMessage,
} from "./useVoiceMode";
import { clearCurrentPlayer } from "./speak-singleton";

// ---------------------------------------------------------------------------
// Browser audio stubs
// ---------------------------------------------------------------------------

let level = 0;
function setLevel(v: number) {
  level = v;
}

class MockAnalyser {
  fftSize = 1024;
  getFloatTimeDomainData(buf: Float32Array) {
    buf.fill(level);
  }
}

class MockAudioContext {
  state = "running";
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
  createAnalyser() {
    return new MockAnalyser();
  }
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
}

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  mimeType = "audio/webm";
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown) {
    MockMediaRecorder.instances.push(this);
  }
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
    this.onstop?.();
  });
}

const track = { stop: vi.fn(), onended: null as null | (() => void) };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
const getUserMedia = vi.fn();
const wakeLockRelease = vi.fn().mockResolvedValue(undefined);
const wakeLockRequest = vi.fn();

function transcribeReturns(text: string) {
  stampedFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ text }) });
}

function baseArgs(overrides: Partial<UseVoiceModeArgs> = {}): UseVoiceModeArgs {
  return {
    hostId: 1,
    tmuxSession: "s1",
    voice: "Ruth",
    isWorking: false,
    messages: [],
    suspended: false,
    send: vi.fn(() => true),
    onUndelivered: vi.fn(),
    ...overrides,
  };
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Speak for `speechMs`, then fall silent long enough to end the utterance. */
async function sayUtterance(speechMs = 600) {
  setLevel(0.2);
  await flush(speechMs);
  setLevel(0);
  await flush(SILENCE_END_MS + 100);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  level = 0;
  players.length = 0;
  MockMediaRecorder.instances = [];
  stampedFetch.mockReset();
  postSpeakStream.mockReset();
  postSpeakStream.mockResolvedValue({ ok: true, status: 200 });
  playTink.mockReset();
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue(stream);
  wakeLockRequest.mockReset();
  wakeLockRequest.mockResolvedValue({ release: wakeLockRelease, released: false });
  vi.stubGlobal("AudioContext", MockAudioContext);
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: { request: wakeLockRequest },
  });
  clearCurrentPlayer();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("isExitPhrase", () => {
  it.each(["Stop voice mode.", "exit voice mode", "Turn off voice mode please", "end the voice mode!"])(
    "matches %s",
    (t) => expect(isExitPhrase(t)).toBe(true),
  );
  it.each(["stop", "how do I stop voice mode in the app", "voice mode is great"])(
    "ignores %s",
    (t) => expect(isExitPhrase(t)).toBe(false),
  );
});

describe("toSpeakableText", () => {
  it("drops markdown formatting and announces code blocks", () => {
    const md = "## Result\n\n**Done** — see [the PR](https://x.y/1).\n\n```ts\nconst a = 1;\n```\n- item `one`";
    const out = toSpeakableText(md);
    expect(out).toContain("Result");
    expect(out).toContain("Done — see the PR.");
    expect(out).toContain("(code block omitted)");
    expect(out).toContain("item one");
    expect(out).not.toMatch(/[#*`]/);
    expect(out).not.toContain("const a");
  });
});

// ---------------------------------------------------------------------------
// Hook behaviour
// ---------------------------------------------------------------------------

describe("useVoiceMode", () => {
  it("calls getUserMedia synchronously in start(), takes a wake lock and starts listening", async () => {
    const { result } = renderHook((p: UseVoiceModeArgs) => useVoiceMode(p), { initialProps: baseArgs() });
    act(() => result.current.start());
    // D-16-02: no await between start() and getUserMedia.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("starting");
    await flush();
    expect(result.current.phase).toBe("listening");
    expect(result.current.active).toBe(true);
    expect(wakeLockRequest).toHaveBeenCalledWith("screen");
    expect(MockMediaRecorder.instances[0].start).toHaveBeenCalled();
  });

  it("sends a transcript after speech followed by trailing silence", async () => {
    const send = vi.fn(() => true);
    const { result } = renderHook((p: UseVoiceModeArgs) => useVoiceMode(p), { initialProps: baseArgs({ send }) });
    act(() => result.current.start());
    await flush();
    transcribeReturns("run the tests please");
    setLevel(0.2);
    await flush(400);
    expect(result.current.phase).toBe("hearing");
    setLevel(0);
    await flush(SILENCE_END_MS + 100);
    expect(stampedFetch).toHaveBeenCalledWith("/voice/transcribe", expect.objectContaining({ method: "POST" }));
    expect(send).toHaveBeenCalledWith("run the tests please");
    // Straight back to listening for the next utterance.
    expect(result.current.phase).toBe("listening");
  });

  it("ignores short bumps that never reach the speech-start threshold", async () => {
    const send = vi.fn(() => true);
    const { result } = renderHook((p: UseVoiceModeArgs) => useVoiceMode(p), { initialProps: baseArgs({ send }) });
    act(() => result.current.start());
    await flush();
    setLevel(0.2);
    await flush(100);
    setLevel(0);
    await flush(SILENCE_END_MS * 2);
    expect(stampedFetch).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("listening");
  });

  it("speaks only assistant messages that arrive after start, in the identity voice", async () => {
    const history: VoiceModeMessage[] = [
      { type: "message", role: "assistant", content: "old reply", eventId: "a0", ts: Date.now() },
    ];
    const { result, rerender } = renderHook((p: UseVoiceModeArgs) => useVoiceMode(p), {
      initialProps: baseArgs({ messages: history }),
    });
    act(() => result.current.start());
    await flush();
    expect(postSpeakStream).not.toHaveBeenCalled();

    const next: VoiceModeMessage[] = [
      ...history,
      { type: "message", role: "user", content: "hi", eventId: "u1", ts: Date.now() },
      { type: "message", role: "assistant", content: "**Hello** there", eventId: "a1", ts: Date.now() },
    ];
    rerender(baseArgs({ messages: next, isWorking: true }));
    await flush();
    expect(postSpeakStream).toHaveBeenCalledTimes(1);
    expect(postSpeakStream).toHaveBeenCalledWith("Hello there", "Ruth");
    expect(result.current.phase).toBe("speaking");
    // Half-duplex: recorder stopped while speaking.
    expect(MockMediaRecorder.instances.every((r) => r.state === "inactive")).toBe(true);

    // Reply ends while the agent is still working → listen again, no chime yet.
    act(() => players[0].opts.onEnded?.());
    await flush();
    expect(result.current.phase).toBe("listening");
    expect(playTink).not.toHaveBeenCalled();

    // Agent finishes → "your turn" chime.
    rerender(baseArgs({ messages: next, isWorking: false }));
    await flush();
    expect(playTink).toHaveBeenCalledTimes(1);
  });

  it("queues replies instead of cutting one off with the next", async () => {
    const { result, rerender } = renderHook((p: UseVoiceModeArgs) => useVoiceMode(p), { initialProps: baseArgs() });
    act(() => result.current.start());
    await flush();
    rerender(baseArgs({
      messages: [
        { type: "message", role: "assistant", content: "first", eventId: "a1", ts: Date.now() },
        { type: "message", role: "assistant", content: "second", eventId: "a2", ts: Date.now() },
      ],
    }));
    await flush();
    expect(postSpeakStream).toHaveBeenCalledTimes(1);
    expect(postSpeakStream).toHaveBeenLastCalledWith("first", "Ruth");
    act(() => players[0].opts.onEnded?.());
    await flush();
    expect(postSpeakStream).toHaveBeenCalledTimes(2);
    expect(postSpeakStream).toHaveBeenLastCalledWith("second", "Ruth");
    expect(players[0].stop).not.toHaveBeenCalled();
  });

  it("does not talk over the user mid-utterance", async () => {
    const { result, rerender } = renderHook((p: UseVoiceModeArgs) => useVoiceMode(p), { initialProps: baseArgs() });
    act(() => result.current.start());
    await flush();
    setLevel(0.2);
    await flush(400);
    expect(result.current.phase).toBe("hearing");
    rerender(baseArgs({ messages: [{ type: "message", role: "assistant", content: "reply", eventId: "a1", ts: Date.now() }] }));
    await flush(200);
    expect(postSpeakStream).not.toHaveBeenCalled();
    transcribeReturns("and another thing");
    setLevel(0);
    await flush(SILENCE_END_MS + 100);
    expect(postSpeakStream).toHaveBeenCalledWith("reply", "Ruth");
  });

  it("pauses (and drops the capture) while the manual mic is recording", async () => {
    const send = vi.fn(() => true);
    const { result, rerender } = renderHook((p: UseVoiceModeArgs) => useVoiceMode(p), { initialProps: baseArgs({ send }) });
    act(() => result.current.start());
    await flush();
    setLevel(0.2);
    await flush(400);
    rerender(baseArgs({ send, suspended: true }));
    await flush();
    expect(result.current.phase).toBe("paused");
    setLevel(0);
    await flush(SILENCE_END_MS * 2);
    expect(stampedFetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    rerender(baseArgs({ send, suspended: false }));
    await flush();
    expect(result.current.phase).toBe("listening");
  });

  it("survives the mic track being ended by the manual mic (iOS) and re-acquires it afterwards", async () => {
    const { result, rerender } = renderHook((p: UseVoiceModeArgs) => useVoiceMode(p), { initialProps: baseArgs() });
    act(() => result.current.start());
    await flush();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    // Manual mic opens → iOS ends voice mode's capture track.
    rerender(baseArgs({ suspended: true }));
    await flush();
    act(() => track.onended?.());
    await flush();
    expect(result.current.active).toBe(true);
    expect(result.current.phase).toBe("paused");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    // Manual mic released → fresh stream, listening again.
    rerender(baseArgs({ suspended: false }));
    await flush();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("listening");
  });

  it("leaves voice mode on a spoken exit phrase without sending it", async () => {
    const send = vi.fn(() => true);
    const { result } = renderHook((p: UseVoiceModeArgs) => useVoiceMode(p), { initialProps: baseArgs({ send }) });
    act(() => result.current.start());
    await flush();
    transcribeReturns("Stop voice mode.");
    await sayUtterance();
    expect(send).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("off");
    expect(track.stop).toHaveBeenCalled();
    expect(wakeLockRelease).toHaveBeenCalled();
  });

  it("hands an unsendable transcript to onUndelivered so it is never lost", async () => {
    const onUndelivered = vi.fn();
    const { result } = renderHook((p: UseVoiceModeArgs) => useVoiceMode(p), {
      initialProps: baseArgs({ send: () => false, onUndelivered }),
    });
    act(() => result.current.start());
    await flush();
    transcribeReturns("hello there");
    await sayUtterance();
    expect(onUndelivered).toHaveBeenCalledWith("hello there");
    expect(result.current.phase).toBe("listening");
  });

  it("skipSpeech stops the current reply and drops the queue", async () => {
    const { result, rerender } = renderHook((p: UseVoiceModeArgs) => useVoiceMode(p), { initialProps: baseArgs() });
    act(() => result.current.start());
    await flush();
    rerender(baseArgs({
      messages: [
        { type: "message", role: "assistant", content: "first", eventId: "a1", ts: Date.now() },
        { type: "message", role: "assistant", content: "second", eventId: "a2", ts: Date.now() },
      ],
    }));
    await flush();
    act(() => result.current.skipSpeech());
    await flush();
    expect(players[0].stop).toHaveBeenCalled();
    expect(postSpeakStream).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("listening");
  });

  it("stop() releases mic, wake lock and audio context", async () => {
    const { result } = renderHook((p: UseVoiceModeArgs) => useVoiceMode(p), { initialProps: baseArgs() });
    act(() => result.current.start());
    await flush();
    act(() => result.current.stop());
    expect(result.current.phase).toBe("off");
    expect(track.stop).toHaveBeenCalled();
    expect(wakeLockRelease).toHaveBeenCalled();
  });
});
