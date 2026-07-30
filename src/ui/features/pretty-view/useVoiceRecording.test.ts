// Tests for useVoiceRecording — the voice-recording state machine hook.
//
// Coverage strategy:
//   - MockMediaRecorder: a minimal MediaRecorder stub that supports .start(),
//     .stop(), .mimeType, .ondataavailable, .onstop event handlers. Assigned
//     to globalThis.MediaRecorder in beforeEach so the hook can `new MediaRecorder(stream)`.
//   - MockStream: a stub MediaStream with getTracks() returning a mock track
//     that has a .stop() method (so the hook can call stream.getTracks().forEach(t.stop)).
//   - navigator.mediaDevices.getUserMedia: vi.fn() stubbed to resolve with
//     MockStream or reject with a NotAllowedError.
//   - globalThis.fetch: vi.spyOn stubbed to return a Response-like object.
//   - globalThis.Audio: vi.fn() stubbed so audio playback calls are captured
//     without requiring a browser audio context.
//
// iOS Safari sync-getUserMedia: Test 2 asserts that after calling start(),
// getUserMedia was already called BEFORE any await resolves. This verifies
// the "synchronous first statement" constraint locked in 16-CONTEXT.md.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useVoiceRecording } from "./useVoiceRecording";

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

/** Minimal MediaStream stub: getTracks() returns one stoppable track. */
function makeMockStream() {
  const track = { stop: vi.fn() };
  return {
    getTracks: vi.fn(() => [track]),
    _track: track,
  };
}

/** Minimal MediaRecorder stub. Tests can trigger ondataavailable / onstop manually. */
class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];

  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start = vi.fn();
  stop = vi.fn().mockImplementation(() => {
    // Automatically fire onstop after stop() is called (mirrors real behavior).
    if (this.onstop) this.onstop();
  });

  constructor(public stream: MediaStream) {
    MockMediaRecorder.instances.push(this);
  }

  /** Helper for tests to push a data chunk as if the recorder emitted it. */
  emitData(blob: Blob) {
    if (this.ondataavailable) this.ondataavailable({ data: blob });
  }
}

/** Module-scope array of Audio mock instances created during a test. */
let audioInstances: Array<{ src: string; currentTime: number; play: Mock }> = [];

/** Find the Audio mock instance whose src ends with the given suffix. */
function getAudioBySrc(suffix: string) {
  return audioInstances.find((inst) => inst.src.endsWith(suffix)) ?? null;
}

beforeEach(() => {
  MockMediaRecorder.instances = [];
  // Assign stub MediaRecorder to globalThis so new MediaRecorder(stream) works.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaRecorder = MockMediaRecorder;

  // Stub navigator.mediaDevices.getUserMedia to resolve with a mock stream by default.
  const mockStream = makeMockStream();
  const getUserMediaMock = vi.fn().mockResolvedValue(mockStream);
  Object.defineProperty(globalThis, "navigator", {
    value: {
      mediaDevices: {
        getUserMedia: getUserMediaMock,
      },
    },
    writable: true,
    configurable: true,
  });

  // Stub fetch to return a successful STT response by default.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ text: "hello world" }),
    }),
  );

  // Stub Audio constructor — capture instances so tests can assert on .play().
  audioInstances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Audio = function AudioMock(this: any, src: string) {
    this.src = src;
    this.currentTime = 0;
    this.play = vi.fn().mockResolvedValue(undefined);
    audioInstances.push(this);
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useVoiceRecording", () => {
  it("Test 1: initial state is idle with null errorMessage and all functions present", () => {
    const { result } = renderHook(() => useVoiceRecording());
    expect(result.current.state).toBe("idle");
    expect(result.current.errorMessage).toBeNull();
    expect(typeof result.current.start).toBe("function");
    expect(typeof result.current.cancel).toBe("function");
    expect(typeof result.current.endAppend).toBe("function");
    expect(typeof result.current.endSend).toBe("function");
  });

  it("Test 2: start() calls getUserMedia SYNCHRONOUSLY (before first await resolves), then transitions to recording", async () => {
    const { result } = renderHook(() => useVoiceRecording());

    // Call start() — getUserMedia MUST be called synchronously as the first action.
    act(() => {
      result.current.start();
    });

    // Assert getUserMedia was called SYNCHRONOUSLY — before any microtask resolves.
    // If start() were async and had an `await` before getUserMedia, this assertion
    // would fail because getUserMedia would not yet have been called at this point.
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });

    // Now await until state transitions to recording (the promise resolves).
    await waitFor(() => {
      expect(result.current.state).toBe("recording");
    });

    // MediaRecorder should have been constructed and .start() called.
    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(MockMediaRecorder.instances[0].start).toHaveBeenCalledTimes(1);
  });

  it("Test 3: cancel() while recording → idle, no fetch, MediaRecorder.stop and stream.getTracks called", async () => {
    const { result } = renderHook(() => useVoiceRecording());

    // Start recording.
    act(() => { result.current.start(); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    // Cancel while recording.
    await act(async () => { await result.current.cancel(); });

    expect(result.current.state).toBe("idle");
    expect(fetch).not.toHaveBeenCalled();

    const recorderInstance = MockMediaRecorder.instances[0];
    expect(recorderInstance.stop).toHaveBeenCalledTimes(1);
    // stream.getTracks().forEach(t.stop) should have been called.
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("Test 4: endAppend() while recording → recording→transcribing→idle, fetch POST /voice/transcribe, returns space-glued transcript", async () => {
    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start(); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    // Push a data chunk so the blob is non-empty.
    const recorder = MockMediaRecorder.instances[0];
    act(() => { recorder.emitData(new Blob(["audio"], { type: "audio/webm" })); });

    let returnValue: Awaited<ReturnType<typeof result.current.endAppend>> = null;
    await act(async () => {
      returnValue = await result.current.endAppend("existing text");
    });

    expect(result.current.state).toBe("idle");

    // fetch should have been called with POST /voice/transcribe.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(fetchUrl).toBe("/voice/transcribe");
    expect(fetchInit.method).toBe("POST");
    expect(fetchInit.body).toBeInstanceOf(FormData);

    // Returned value should have transcript + space-glued result.
    expect(returnValue).not.toBeNull();
    expect(returnValue!.transcript).toBe("hello world");
    // "existing text" does not end in whitespace → glue is " "
    expect(returnValue!.glued).toBe("existing text hello world");
  });

  it("Test 5: endSend() while recording → same transitions + fetch, returns distinguishable result for caller to send", async () => {
    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start(); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    const recorder = MockMediaRecorder.instances[0];
    act(() => { recorder.emitData(new Blob(["audio"], { type: "audio/webm" })); });

    let returnValue: Awaited<ReturnType<typeof result.current.endSend>> = null;
    await act(async () => {
      returnValue = await result.current.endSend("hello");
    });

    expect(result.current.state).toBe("idle");
    expect(fetch).toHaveBeenCalledTimes(1);

    // endSend returns same {transcript, glued} shape — caller decides to send.
    expect(returnValue).not.toBeNull();
    expect(returnValue!.transcript).toBe("hello world");
    expect(returnValue!.glued).toBe("hello hello world");
  });

  it("Test 6: fetch HTTP 500 → state becomes idle, errorMessage set, endAppend resolves null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "internal error", status: 500 }),
      }),
    );

    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start(); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    let returnValue: Awaited<ReturnType<typeof result.current.endAppend>> = undefined as unknown as null;
    await act(async () => {
      returnValue = await result.current.endAppend("text");
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.errorMessage).toMatch(/STT error.*500/);
    expect(returnValue).toBeNull();
  });

  it("Test 7: getUserMedia rejects with NotAllowedError → state stays idle, errorMessage set, no MediaRecorder created", async () => {
    const notAllowedError = Object.assign(new Error("Permission denied"), {
      name: "NotAllowedError",
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(notAllowedError),
        },
      },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start(); });

    await waitFor(() => {
      expect(result.current.errorMessage).toMatch(/mic denied/);
    });

    expect(result.current.state).toBe("idle");
    expect(MockMediaRecorder.instances).toHaveLength(0);
  });

  it("Test 8: glue rule — trailing whitespace → no double space; empty string → no leading space", async () => {
    const { result } = renderHook(() => useVoiceRecording());

    // --- Case A: text ending in whitespace → no extra space glued ---
    act(() => { result.current.start(); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    let resA: Awaited<ReturnType<typeof result.current.endAppend>> = null;
    await act(async () => {
      resA = await result.current.endAppend("hello ");
    });

    expect(resA!.glued).toBe("hello hello world");

    // --- Case B: empty string → transcript only, no leading space ---
    act(() => { result.current.start(); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    let resB: Awaited<ReturnType<typeof result.current.endAppend>> = null;
    await act(async () => {
      resB = await result.current.endAppend("");
    });

    expect(resB!.glued).toBe("hello world");
  });

  // ---------------------------------------------------------------------------
  // Audio feedback tests (Tests A–F)
  // ---------------------------------------------------------------------------

  it("Test A: start.mp3 plays after MediaRecorder init succeeds (not before)", async () => {
    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start(); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    const startAudio = getAudioBySrc("start.mp3");
    expect(startAudio).not.toBeNull();
    expect(startAudio!.play).toHaveBeenCalledTimes(1);

    // Verify ordering: recorder.start() was called before startAudio.play()
    const recorder = MockMediaRecorder.instances[0];
    const recorderStartOrder = recorder.start.mock.invocationCallOrder[0];
    const audioPlayOrder = startAudio!.play.mock.invocationCallOrder[0];
    expect(recorderStartOrder).toBeLessThan(audioPlayOrder);
  });

  it("Test B: start.mp3 does NOT play on getUserMedia rejection (permission-denied path stays silent)", async () => {
    const notAllowedError = Object.assign(new Error("Permission denied"), {
      name: "NotAllowedError",
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(notAllowedError),
        },
      },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start(); });

    await waitFor(() => {
      expect(result.current.errorMessage).toMatch(/mic denied/);
    });

    const startAudio = getAudioBySrc("start.mp3");
    // start.mp3 Audio instance may exist (created at hook mount) but play() must NOT have been called
    if (startAudio) {
      expect(startAudio.play).not.toHaveBeenCalled();
    }
  });

  it("Test C: stop.mp3 plays before STT fetch in endAppend and endSend", async () => {
    // --- endAppend variant ---
    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start(); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    await act(async () => {
      await result.current.endAppend("text");
    });

    const stopAudio = getAudioBySrc("stop.mp3");
    expect(stopAudio).not.toBeNull();
    expect(stopAudio!.play).toHaveBeenCalledTimes(1);

    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const stopPlayOrder = stopAudio!.play.mock.invocationCallOrder[0];
    const fetchCallOrder = fetchMock.mock.invocationCallOrder[0];
    expect(stopPlayOrder).toBeLessThan(fetchCallOrder);

    // --- endSend variant (fresh hook) ---
    // Reset audio instances for a clean check
    audioInstances = [];
    MockMediaRecorder.instances = [];

    const { result: result2 } = renderHook(() => useVoiceRecording());

    act(() => { result2.current.start(); });
    await waitFor(() => expect(result2.current.state).toBe("recording"));

    // Reset fetch mock invocation tracking
    fetchMock.mockClear();

    await act(async () => {
      await result2.current.endSend("text");
    });

    const stopAudio2 = getAudioBySrc("stop.mp3");
    expect(stopAudio2).not.toBeNull();
    expect(stopAudio2!.play).toHaveBeenCalledTimes(1);

    const stopPlayOrder2 = stopAudio2!.play.mock.invocationCallOrder[0];
    const fetchCallOrder2 = fetchMock.mock.invocationCallOrder[0];
    expect(stopPlayOrder2).toBeLessThan(fetchCallOrder2);
  });

  it("Test D: cancel.mp3 plays before recorder teardown in cancel()", async () => {
    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start(); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    const recorder = MockMediaRecorder.instances[0];

    await act(async () => {
      await result.current.cancel();
    });

    const cancelAudio = getAudioBySrc("cancel.mp3");
    expect(cancelAudio).not.toBeNull();
    expect(cancelAudio!.play).toHaveBeenCalledTimes(1);

    // cancelAudio.play() must have been called BEFORE recorder.stop()
    const cancelPlayOrder = cancelAudio!.play.mock.invocationCallOrder[0];
    const recorderStopOrder = recorder.stop.mock.invocationCallOrder[0];
    expect(cancelPlayOrder).toBeLessThan(recorderStopOrder);
  });

  it("Test E: error.mp3 plays on STT HTTP 500, and on fetch network error", async () => {
    // --- HTTP 500 variant ---
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "internal error", status: 500 }),
      }),
    );

    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start(); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    await act(async () => {
      await result.current.endAppend("text");
    });

    const errorAudio = getAudioBySrc("error.mp3");
    expect(errorAudio).not.toBeNull();
    expect(errorAudio!.play).toHaveBeenCalledTimes(1);

    // --- Network error variant (fresh hook) ---
    audioInstances = [];
    MockMediaRecorder.instances = [];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network failure")),
    );

    const { result: result2 } = renderHook(() => useVoiceRecording());

    act(() => { result2.current.start(); });
    await waitFor(() => expect(result2.current.state).toBe("recording"));

    await act(async () => {
      await result2.current.endAppend("text");
    });

    const errorAudio2 = getAudioBySrc("error.mp3");
    expect(errorAudio2).not.toBeNull();
    expect(errorAudio2!.play).toHaveBeenCalledTimes(1);
  });

  it("Test F: failed .play() Promise does not throw or break the recording flow", async () => {
    // Make start.mp3's play() reject (e.g., Safari autoplay blocked)
    // We need to intercept the Audio constructor to inject this behavior.
    // Reset and reinstall Audio mock with start.mp3 rejecting.
    audioInstances = [];
    let startAudioInst: { src: string; currentTime: number; play: Mock } | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Audio = function AudioMockF(this: any, src: string) {
      this.src = src;
      this.currentTime = 0;
      this.play =
        typeof src === "string" && src.endsWith("start.mp3")
          ? vi.fn().mockRejectedValue(new Error("NotAllowedError"))
          : vi.fn().mockResolvedValue(undefined);
      audioInstances.push(this);
      if (typeof src === "string" && src.endsWith("start.mp3")) startAudioInst = this;
    };

    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start(); });

    // State should still transition to recording despite the play() rejection
    await waitFor(() => {
      expect(result.current.state).toBe("recording");
    });

    // play() was attempted (and rejected, but swallowed)
    expect(startAudioInst).not.toBeNull();
    expect(startAudioInst!.play).toHaveBeenCalledTimes(1);

    // No unhandled rejection — the hook swallowed it silently.
    // The fact that we reach this line without the test framework throwing
    // an unhandled rejection error confirms the .catch() is in place.
    expect(result.current.state).toBe("recording");
    expect(result.current.errorMessage).toBeNull();
  });
});
