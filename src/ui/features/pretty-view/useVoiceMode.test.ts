// Unit tests for useVoiceMode — the hands-free voice-mode loop behind the
// ComposeBox voice-mode button. The browser audio stack (getUserMedia,
// MediaRecorder, AudioContext/AnalyserNode), the STT fetch, the TTS fetch, the
// stream player and the cue module are all stubbed; the analyser's RMS level
// is driven by the test (`setLevel`) so VAD transitions can be walked with
// fake timers.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const stampedFetch = vi.fn();
vi.mock("@/lib/stamped-fetch", () => ({ stampedFetch: (...a: unknown[]) => stampedFetch(...a) }));

const postSpeakStream = vi.fn();
vi.mock("../../api/voice-api", () => ({ postSpeakStream: (...a: unknown[]) => postSpeakStream(...a) }));

vi.mock("../../audio/auto-speak-cue", () => ({ playAutoSpeakOn: vi.fn(), playAutoSpeakOff: vi.fn() }));

type PlayerOpts = { onEnded?: () => void; onError?: (e: Error) => void };
const players: Array<{ opts: PlayerOpts; play: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
vi.mock("./webAudioStreamPlayer", () => ({
  createWebAudioStreamPlayer: (opts: PlayerOpts) => {
    const p = { opts, play: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), pause: vi.fn(), resume: vi.fn() };
    players.push(p);
    return p;
  },
}));

// Cue module: record every cue and the ticking state.
const cuesPlayed: string[] = [];
let ticking = false;
vi.mock("./voice-mode-cues", () => ({
  createVoiceModeCues: () => ({
    play: (cue: string) => cuesPlayed.push(cue),
    startTicking: () => {
      ticking = true;
    },
    stopTicking: () => {
      ticking = false;
    },
    isTicking: () => ticking,
    dispose: () => {
      ticking = false;
    },
  }),
}));

import {
  useVoiceMode,
  endsWithExitPhrase,
  stripSendPhrase,
  toSpeakableText,
  PIECE_GAP_MS,
  TIMED_END_MS,
  TRANSCRIBE_RETRY_WINDOW_MS,
  type UseVoiceModeArgs,
  type VoiceModeMessage,
} from "./useVoiceMode";
import { clearCurrentPlayer } from "./speak-singleton";
import { setVoiceModeSettings } from "./voice-mode-settings";

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

/** A transcription the test resolves by hand (to reorder pieces). */
function transcribeDeferred(): (text: string) => void {
  let resolve!: (v: unknown) => void;
  stampedFetch.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  return (text: string) => resolve({ ok: true, status: 200, json: async () => ({ text }) });
}

function baseArgs(overrides: Partial<UseVoiceModeArgs> = {}): UseVoiceModeArgs {
  return {
    hostId: 1,
    tmuxSession: "s1",
    voices: ["Ruth"],
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

/** Speak for `speechMs`, then pause just long enough to close the piece. */
async function sayPiece(speechMs = 600) {
  setLevel(0.2);
  await flush(speechMs);
  setLevel(0);
  await flush(PIECE_GAP_MS + 100);
}

/** Speak, then stay silent long enough for timed mode to send. */
async function sayUtterance(speechMs = 600) {
  await sayPiece(speechMs);
  await flush(TIMED_END_MS);
}

async function startVoiceMode(args: UseVoiceModeArgs = baseArgs()) {
  const hook = renderHook((p: UseVoiceModeArgs) => useVoiceMode(p), { initialProps: args });
  act(() => hook.result.current.start());
  await flush();
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  level = 0;
  players.length = 0;
  cuesPlayed.length = 0;
  ticking = false;
  MockMediaRecorder.instances = [];
  stampedFetch.mockReset();
  postSpeakStream.mockReset();
  postSpeakStream.mockResolvedValue({ ok: true, status: 200 });
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
  setVoiceModeSettings({ endOfTurn: null, sendPhrase: null });
  clearCurrentPlayer();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("endsWithExitPhrase", () => {
  it.each([
    "Stop voice mode.",
    "exit voice mode",
    "Turn off voice mode please",
    "end the voice mode!",
    "OK, that's all for now. Stop voice mode.",
  ])("matches %s", (t) => expect(endsWithExitPhrase(t)).toBe(true));
  it.each(["stop", "stop voice mode and then run the tests", "voice mode is great", "backstop voice mode"])(
    "ignores %s",
    (t) => expect(endsWithExitPhrase(t)).toBe(false),
  );
});

describe("stripSendPhrase", () => {
  it.each([
    ["Run the tests. Send it.", "send it", "Run the tests."],
    ["run the tests, send it", "send it", "run the tests"],
    ["Send it!", "send it", ""],
    ["Deploy when green — over and out", "Over and out", "Deploy when green"],
    ["SEND IT", "send it", ""],
  ])("strips %j with phrase %j", (text, phrase, expected) => {
    expect(stripSendPhrase(text, phrase)).toBe(expected);
  });
  it.each([
    ["send it to the team", "send it"],
    ["just send", "send it"],
    ["resend it", "send it"],
    ["anything", "  "],
  ])("returns null for %j / %j", (text, phrase) => {
    expect(stripSendPhrase(text, phrase)).toBeNull();
  });
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

  describe("timed mode (default)", () => {
    it("transcribes a piece at a short pause but only sends after the longer silence", async () => {
      const send = vi.fn(() => true);
      const { result } = await startVoiceMode(baseArgs({ send }));
      transcribeReturns("run the tests please");
      setLevel(0.2);
      await flush(400);
      expect(result.current.phase).toBe("hearing");
      setLevel(0);
      await flush(PIECE_GAP_MS + 100);
      // The piece is transcribed, and the next recorder is already running.
      expect(stampedFetch).toHaveBeenCalledWith("/voice/transcribe", expect.objectContaining({ method: "POST" }));
      expect(MockMediaRecorder.instances.length).toBe(2);
      expect(send).not.toHaveBeenCalled();
      expect(result.current.phase).toBe("hearing");
      await flush(TIMED_END_MS);
      expect(send).toHaveBeenCalledWith("run the tests please");
      expect(cuesPlayed).toEqual(["sent"]);
      expect(result.current.phase).toBe("listening");
    });

    it("can pause between pieces without sending, and sends them as one message in spoken order", async () => {
      const send = vi.fn(() => true);
      await startVoiceMode(baseArgs({ send }));
      const first = transcribeDeferred();
      const second = transcribeDeferred();
      await sayPiece();
      // A thinking pause longer than a piece gap but shorter than the turn end.
      await flush(500);
      await sayPiece();
      // Results come back out of order.
      second("and then deploy it.");
      await flush();
      first("Run the tests,");
      await flush(TIMED_END_MS);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith("Run the tests, and then deploy it.");
    });

    it("drops a piece with no words (sneeze) without a sound, a send, or a stage change", async () => {
      const send = vi.fn(() => true);
      const { result } = await startVoiceMode(baseArgs({ send }));
      transcribeReturns("");
      await sayUtterance();
      expect(stampedFetch).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
      expect(cuesPlayed).toEqual([]);
      expect(result.current.phase).toBe("listening");
    });

    it("ignores short bumps that never reach the speech-start threshold", async () => {
      const { result } = await startVoiceMode();
      setLevel(0.2);
      await flush(100);
      setLevel(0);
      await flush(TIMED_END_MS * 2);
      expect(stampedFetch).not.toHaveBeenCalled();
      expect(result.current.phase).toBe("listening");
    });

    it("never cuts off long talking — a piece only closes at a pause", async () => {
      const send = vi.fn(() => true);
      await startVoiceMode(baseArgs({ send }));
      transcribeReturns("a very long thought");
      setLevel(0.2);
      await flush(6 * 60 * 1000); // past the old five-minute cap
      // The safety cap closed one piece mid-speech; the next piece keeps recording.
      expect(stampedFetch).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
      transcribeReturns("that finally ends");
      setLevel(0);
      await flush(PIECE_GAP_MS + TIMED_END_MS + 200);
      expect(send).toHaveBeenCalledWith("a very long thought that finally ends");
    });
  });

  describe("send-phrase mode", () => {
    beforeEach(() => setVoiceModeSettings({ endOfTurn: "phrase", sendPhrase: "send it" }));

    it("never sends on silence; sends the draft when a piece ends with the phrase (phrase removed)", async () => {
      const send = vi.fn(() => true);
      const { result } = await startVoiceMode(baseArgs({ send }));
      transcribeReturns("First, check the logs.");
      await sayPiece();
      await flush(2 * 60 * 1000); // a long think
      expect(send).not.toHaveBeenCalled();
      expect(result.current.phase).toBe("hearing");
      transcribeReturns("Then fix it. Send it.");
      await sayPiece();
      expect(send).toHaveBeenCalledWith("First, check the logs. Then fix it.");
      expect(cuesPlayed).toEqual(["sent"]);
      expect(result.current.phase).toBe("listening");
    });

    it("uses a custom phrase from the preference", async () => {
      setVoiceModeSettings({ endOfTurn: "phrase", sendPhrase: "over and out" });
      const send = vi.fn(() => true);
      await startVoiceMode(baseArgs({ send }));
      transcribeReturns("ship the fix. Send it.");
      await sayPiece();
      expect(send).not.toHaveBeenCalled();
      transcribeReturns("Over and out.");
      await sayPiece();
      expect(send).toHaveBeenCalledWith("ship the fix. Send it.");
    });

    it("waits for earlier pieces before sending", async () => {
      const send = vi.fn(() => true);
      const { result } = await startVoiceMode(baseArgs({ send }));
      const first = transcribeDeferred();
      await sayPiece();
      transcribeReturns("send it");
      await sayPiece();
      expect(send).not.toHaveBeenCalled();
      expect(result.current.phase).toBe("transcribing");
      first("look at the failing test");
      await flush();
      expect(send).toHaveBeenCalledWith("look at the failing test");
    });

    it("holds replies (and the working ticks) while a draft is unsent", async () => {
      const send = vi.fn(() => true);
      const { result, rerender } = await startVoiceMode(baseArgs({ send }));
      transcribeReturns("hmm, let me think");
      await sayPiece();
      rerender(baseArgs({
        send,
        isWorking: true,
        messages: [{ type: "message", role: "assistant", content: "earlier reply", eventId: "a1", ts: Date.now() }],
      }));
      await flush(10_000);
      expect(postSpeakStream).not.toHaveBeenCalled();
      expect(ticking).toBe(false);
      expect(result.current.phase).toBe("hearing");
      transcribeReturns("okay. send it");
      await sayPiece();
      expect(send).toHaveBeenCalledWith("hmm, let me think okay.");
      expect(postSpeakStream).toHaveBeenCalledWith("earlier reply", ["Ruth"]);
    });
  });

  describe("leaving and failing", () => {
    it("leaves voice mode on an exit phrase at the end of a piece and throws the draft away", async () => {
      const send = vi.fn(() => true);
      const onUndelivered = vi.fn();
      setVoiceModeSettings({ endOfTurn: "phrase" });
      const { result } = await startVoiceMode(baseArgs({ send, onUndelivered }));
      transcribeReturns("delete the old branch");
      await sayPiece();
      transcribeReturns("actually never mind. Stop voice mode.");
      await sayPiece();
      expect(send).not.toHaveBeenCalled();
      expect(onUndelivered).not.toHaveBeenCalled();
      expect(result.current.phase).toBe("off");
      expect(cuesPlayed).toEqual(["off"]);
      expect(track.stop).toHaveBeenCalled();
      expect(wakeLockRelease).toHaveBeenCalled();
    });

    it("retries a failed piece and carries on when it succeeds", async () => {
      const send = vi.fn(() => true);
      await startVoiceMode(baseArgs({ send }));
      stampedFetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });
      transcribeReturns("retry worked");
      await sayPiece();
      await flush(TIMED_END_MS + 2000);
      expect(stampedFetch).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenCalledWith("retry worked");
      expect(cuesPlayed).not.toContain("alarm");
    });

    it("bails loudly when a piece can't be transcribed: off, alarm, nothing sent", async () => {
      const send = vi.fn(() => true);
      const onUndelivered = vi.fn();
      const { result } = await startVoiceMode(baseArgs({ send, onUndelivered }));
      transcribeReturns("first half of the instructions");
      await sayPiece();
      stampedFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
      await sayPiece();
      await flush(TRANSCRIBE_RETRY_WINDOW_MS + 5000);
      expect(send).not.toHaveBeenCalled();
      expect(onUndelivered).not.toHaveBeenCalled();
      expect(cuesPlayed).toContain("alarm");
      expect(result.current.phase).toBe("off");
      expect(result.current.errorMessage).toMatch(/nothing was sent/);
    });

    it("hands an unsendable draft to onUndelivered so it is never lost", async () => {
      const onUndelivered = vi.fn();
      const { result } = await startVoiceMode(baseArgs({ send: () => false, onUndelivered }));
      transcribeReturns("hello there");
      await sayUtterance();
      expect(onUndelivered).toHaveBeenCalledWith("hello there");
      expect(cuesPlayed).toEqual(["error"]);
      expect(result.current.phase).toBe("listening");
    });
  });

  describe("replies and sounds", () => {
    it("speaks only new assistant replies; ticks while the agent works; 'your turn' when it is done", async () => {
      const history: VoiceModeMessage[] = [
        { type: "message", role: "assistant", content: "old reply", eventId: "a0", ts: Date.now() },
      ];
      const { result, rerender } = await startVoiceMode(baseArgs({ messages: history }));
      expect(postSpeakStream).not.toHaveBeenCalled();

      // Agent starts working → ticking.
      rerender(baseArgs({ messages: history, isWorking: true }));
      await flush();
      expect(ticking).toBe(true);

      const next: VoiceModeMessage[] = [
        ...history,
        { type: "message", role: "user", content: "hi", eventId: "u1", ts: Date.now() },
        { type: "message", role: "assistant", content: "**Hello** there", eventId: "a1", ts: Date.now() },
      ];
      rerender(baseArgs({ messages: next, isWorking: true }));
      await flush();
      expect(postSpeakStream).toHaveBeenCalledWith("Hello there", ["Ruth"]);
      expect(result.current.phase).toBe("speaking");
      expect(ticking).toBe(false);
      // Half-duplex: recorder stopped while speaking.
      expect(MockMediaRecorder.instances.every((r) => r.state === "inactive")).toBe(true);

      // Reply ends while the agent is still working → ticking again, no "your turn".
      act(() => players[0].opts.onEnded?.());
      await flush();
      expect(result.current.phase).toBe("listening");
      expect(ticking).toBe(true);
      expect(cuesPlayed).not.toContain("yourTurn");

      // Agent finishes → ticking stops, "your turn".
      rerender(baseArgs({ messages: next, isWorking: false }));
      await flush();
      expect(ticking).toBe(false);
      expect(cuesPlayed).toEqual(["yourTurn"]);
    });

    it("plays 'your turn' when the last reply ends and the agent is already done", async () => {
      const { rerender } = await startVoiceMode();
      rerender(baseArgs({ messages: [{ type: "message", role: "assistant", content: "done", eventId: "a1", ts: Date.now() }] }));
      await flush();
      act(() => players[0].opts.onEnded?.());
      await flush();
      expect(cuesPlayed).toEqual(["yourTurn"]);
    });

    it("stops ticking as soon as the user starts talking", async () => {
      const { rerender } = await startVoiceMode();
      rerender(baseArgs({ isWorking: true }));
      await flush();
      expect(ticking).toBe(true);
      setLevel(0.2);
      await flush(400);
      expect(ticking).toBe(false);
    });

    it("queues replies instead of cutting one off with the next", async () => {
      const { rerender } = await startVoiceMode();
      rerender(baseArgs({
        messages: [
          { type: "message", role: "assistant", content: "first", eventId: "a1", ts: Date.now() },
          { type: "message", role: "assistant", content: "second", eventId: "a2", ts: Date.now() },
        ],
      }));
      await flush();
      expect(postSpeakStream).toHaveBeenCalledTimes(1);
      expect(postSpeakStream).toHaveBeenLastCalledWith("first", ["Ruth"]);
      act(() => players[0].opts.onEnded?.());
      await flush();
      expect(postSpeakStream).toHaveBeenCalledTimes(2);
      expect(postSpeakStream).toHaveBeenLastCalledWith("second", ["Ruth"]);
      expect(players[0].stop).not.toHaveBeenCalled();
    });

    it("says it couldn't speak when the voice service fails — never silently", async () => {
      postSpeakStream.mockResolvedValueOnce(new Response(null, { status: 503 }));
      const { result, rerender } = await startVoiceMode();
      rerender(baseArgs({ messages: [{ type: "message", role: "assistant", content: "reply", eventId: "a1", ts: Date.now() }] }));
      await flush();
      expect(postSpeakStream).toHaveBeenCalledTimes(1);
      expect(result.current.errorMessage).toBe("Voice mode: couldn't speak that reply");
      expect(cuesPlayed).toContain("error");
      expect(result.current.phase).toBe("listening");
    });

    it("reports a mid-stream speak failure once", async () => {
      const { result, rerender } = await startVoiceMode();
      rerender(baseArgs({ messages: [{ type: "message", role: "assistant", content: "reply", eventId: "a1", ts: Date.now() }] }));
      await flush();
      act(() => players[players.length - 1].opts.onError?.(new Error("stream dropped")));
      await flush();
      expect(result.current.errorMessage).toBe("Voice mode: couldn't speak that reply");
      expect(cuesPlayed.filter((c) => c === "error")).toHaveLength(1);
    });

    it("does not talk over the user mid-utterance", async () => {
      const { result, rerender } = await startVoiceMode();
      setLevel(0.2);
      await flush(400);
      expect(result.current.phase).toBe("hearing");
      rerender(baseArgs({ messages: [{ type: "message", role: "assistant", content: "reply", eventId: "a1", ts: Date.now() }] }));
      await flush(200);
      expect(postSpeakStream).not.toHaveBeenCalled();
      transcribeReturns("and another thing");
      setLevel(0);
      await flush(PIECE_GAP_MS + TIMED_END_MS + 200);
      expect(postSpeakStream).toHaveBeenCalledWith("reply", ["Ruth"]);
    });

    it("skipSpeech stops the current reply and drops the queue", async () => {
      const { result, rerender } = await startVoiceMode();
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
  });

  describe("manual mic + lifecycle", () => {
    it("pauses (and drops the piece being recorded) while the manual mic is recording", async () => {
      const send = vi.fn(() => true);
      const { result, rerender } = await startVoiceMode(baseArgs({ send }));
      setLevel(0.2);
      await flush(400);
      rerender(baseArgs({ send, suspended: true }));
      await flush();
      expect(result.current.phase).toBe("paused");
      setLevel(0);
      await flush(TIMED_END_MS * 2);
      expect(stampedFetch).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      rerender(baseArgs({ send, suspended: false }));
      await flush();
      expect(result.current.phase).toBe("listening");
    });

    it("survives the mic track being ended by the manual mic (iOS) and re-acquires it afterwards", async () => {
      const { result, rerender } = await startVoiceMode();
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      rerender(baseArgs({ suspended: true }));
      await flush();
      act(() => track.onended?.());
      await flush();
      expect(result.current.active).toBe(true);
      expect(result.current.phase).toBe("paused");
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      rerender(baseArgs({ suspended: false }));
      await flush();
      expect(getUserMedia).toHaveBeenCalledTimes(2);
      expect(result.current.phase).toBe("listening");
    });

    it("cuts the current reply when the manual mic starts, and speaks the queue after release", async () => {
      const { result, rerender } = await startVoiceMode();
      const messages = [
        { type: "message", role: "assistant", content: "first", eventId: "a1", ts: Date.now() },
        { type: "message", role: "assistant", content: "second", eventId: "a2", ts: Date.now() },
      ];
      rerender(baseArgs({ messages }));
      await flush();
      expect(result.current.phase).toBe("speaking");
      rerender(baseArgs({ messages, suspended: true }));
      await flush();
      expect(players[0].stop).toHaveBeenCalled();
      expect(result.current.phase).toBe("paused");
      expect(postSpeakStream).toHaveBeenCalledTimes(1);
      rerender(baseArgs({ messages, suspended: false }));
      await flush();
      expect(postSpeakStream).toHaveBeenCalledTimes(2);
      expect(postSpeakStream).toHaveBeenLastCalledWith("second", ["Ruth"]);
    });

    it("stop() releases mic, wake lock and audio context, and drops any draft", async () => {
      const send = vi.fn(() => true);
      const { result } = await startVoiceMode(baseArgs({ send }));
      transcribeReturns("half a thought");
      await sayPiece();
      act(() => result.current.stop());
      await flush(TIMED_END_MS * 2);
      expect(result.current.phase).toBe("off");
      expect(send).not.toHaveBeenCalled();
      expect(track.stop).toHaveBeenCalled();
      expect(wakeLockRelease).toHaveBeenCalled();
    });
  });
});
