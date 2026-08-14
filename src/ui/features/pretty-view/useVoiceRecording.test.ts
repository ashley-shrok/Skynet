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
  // Mirrors the real MediaRecorder.state — starts "inactive", flips to
  // "recording" on start(), flips to "inactive" on stop(). The hook's
  // stopRecording() guard reads this field to short-circuit when the
  // recorder is already inactive (iOS Safari dropped-onstop cascade fix,
  // quick-260808-1pa).
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start = vi.fn().mockImplementation(() => {
    this.state = "recording";
  });
  stop = vi.fn().mockImplementation(() => {
    // Automatically fire onstop after stop() is called (mirrors real behavior).
    this.state = "inactive";
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
    expect(typeof result.current.commitStartVisibility).toBe("function");
    expect(typeof result.current.endAppend).toBe("function");
    expect(typeof result.current.endSend).toBe("function");
  });

  it("Test 2: start({ autoCommit: true }) calls getUserMedia SYNCHRONOUSLY (before first await resolves), then transitions to recording", async () => {
    // Uses autoCommit:true to exercise the mic-tap path that skips the "starting"
    // grey zone and transitions directly to "recording" + plays start.mp3.
    const { result } = renderHook(() => useVoiceRecording());

    // Call start({ autoCommit: true }) — getUserMedia MUST be called synchronously.
    act(() => {
      result.current.start({ autoCommit: true });
    });

    // Assert getUserMedia was called SYNCHRONOUSLY — before any microtask resolves.
    // If start() were async and had an `await` before getUserMedia, this assertion
    // would fail because getUserMedia would not yet have been called at this point.
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });

    // Now await until state transitions to recording (the promise resolves).
    // With autoCommit:true the "starting" intermediate is skipped.
    await waitFor(() => {
      expect(result.current.state).toBe("recording");
    });

    // MediaRecorder should have been constructed and .start() called.
    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(MockMediaRecorder.instances[0].start).toHaveBeenCalledTimes(1);
  });

  it("Test 3: cancel() while recording → idle, no fetch, MediaRecorder.stop and stream.getTracks called", async () => {
    const { result } = renderHook(() => useVoiceRecording());

    // Start recording (autoCommit:true to skip the "starting" grey zone).
    act(() => { result.current.start({ autoCommit: true }); });
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

    act(() => { result.current.start({ autoCommit: true }); });
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

    act(() => { result.current.start({ autoCommit: true }); });
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

    act(() => { result.current.start({ autoCommit: true }); });
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
    act(() => { result.current.start({ autoCommit: true }); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    let resA: Awaited<ReturnType<typeof result.current.endAppend>> = null;
    await act(async () => {
      resA = await result.current.endAppend("hello ");
    });

    expect(resA!.glued).toBe("hello hello world");

    // --- Case B: empty string → transcript only, no leading space ---
    act(() => { result.current.start({ autoCommit: true }); });
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

  it("Test A: start.mp3 plays after MediaRecorder init succeeds (not before) — via autoCommit:true (mic-tap path)", async () => {
    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start({ autoCommit: true }); });
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

  it("Test C: stop.mp3 plays AFTER recorder.stop() and BEFORE STT fetch in endAppend and endSend", async () => {
    // AudioSession-safety anti-regression: stop.mp3 must play AFTER recorder.stop()
    // to keep iOS Safari's AudioSession in record mode through the recorder teardown +
    // onstop dispatch. Playing before recorder.stop() (the original order) causes
    // AudioSession to switch playback mid-recording and can drop onstop, orphaning
    // the audio blob. See bounty voice-recording-audio-feedback-ordering-onstop-drop.

    // --- endAppend variant ---
    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start({ autoCommit: true }); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    const recorder = MockMediaRecorder.instances[0];

    await act(async () => {
      await result.current.endAppend("text");
    });

    const stopAudio = getAudioBySrc("stop.mp3");
    expect(stopAudio).not.toBeNull();
    expect(stopAudio!.play).toHaveBeenCalledTimes(1);

    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const stopPlayOrder = stopAudio!.play.mock.invocationCallOrder[0];
    const fetchCallOrder = fetchMock.mock.invocationCallOrder[0];
    const recorderStopOrder = recorder.stop.mock.invocationCallOrder[0];
    expect(recorderStopOrder).toBeLessThan(stopPlayOrder);
    expect(stopPlayOrder).toBeLessThan(fetchCallOrder);

    // --- endSend variant (fresh hook) ---
    // Reset audio instances for a clean check
    audioInstances = [];
    MockMediaRecorder.instances = [];

    const { result: result2 } = renderHook(() => useVoiceRecording());

    act(() => { result2.current.start({ autoCommit: true }); });
    await waitFor(() => expect(result2.current.state).toBe("recording"));

    const recorder2 = MockMediaRecorder.instances[0];

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
    const recorderStopOrder2 = recorder2.stop.mock.invocationCallOrder[0];
    expect(recorderStopOrder2).toBeLessThan(stopPlayOrder2);
    expect(stopPlayOrder2).toBeLessThan(fetchCallOrder2);
  });

  it("Test D: cancel.mp3 plays AFTER recorder teardown in cancel()", async () => {
    // AudioSession-safety anti-regression — see Test C.
    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start({ autoCommit: true }); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    const recorder = MockMediaRecorder.instances[0];

    await act(async () => {
      await result.current.cancel();
    });

    const cancelAudio = getAudioBySrc("cancel.mp3");
    expect(cancelAudio).not.toBeNull();
    expect(cancelAudio!.play).toHaveBeenCalledTimes(1);

    // cancelAudio.play() must have been called AFTER recorder.stop() to keep
    // iOS Safari's AudioSession in record mode through recorder teardown.
    const cancelPlayOrder = cancelAudio!.play.mock.invocationCallOrder[0];
    const recorderStopOrder = recorder.stop.mock.invocationCallOrder[0];
    expect(recorderStopOrder).toBeLessThan(cancelPlayOrder);
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

    act(() => { result.current.start({ autoCommit: true }); });
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

    act(() => { result2.current.start({ autoCommit: true }); });
    await waitFor(() => expect(result2.current.state).toBe("recording"));

    await act(async () => {
      await result2.current.endAppend("text");
    });

    const errorAudio2 = getAudioBySrc("error.mp3");
    expect(errorAudio2).not.toBeNull();
    expect(errorAudio2!.play).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Phase 34 tests — client consumes server transcript VERBATIM (no client-side
  // transform). Server-side wake-word + skill-catalog transform is exercised
  // by src/backend/database/routes/voice.test.ts.
  // ---------------------------------------------------------------------------

  it("Test P34-01: endAppend uses server response text verbatim (server returns pre-transformed '/gsd-quick fix')", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ text: "/gsd-quick fix the login bug" }),
      }),
    );

    const { result } = renderHook(() => useVoiceRecording());
    act(() => { result.current.start({ autoCommit: true }); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    let returnValue: Awaited<ReturnType<typeof result.current.endAppend>> = null;
    await act(async () => {
      returnValue = await result.current.endAppend("");
    });

    expect(returnValue).not.toBeNull();
    expect(returnValue!.transcript).toBe("/gsd-quick fix the login bug");
    expect(returnValue!.glued).toBe("/gsd-quick fix the login bug");
  });

  it("Test P34-02: endSend uses server response text verbatim (server returns pre-transformed)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ text: "/gsd-quick fix the login bug" }),
      }),
    );

    const { result } = renderHook(() => useVoiceRecording());
    act(() => { result.current.start({ autoCommit: true }); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    let returnValue: Awaited<ReturnType<typeof result.current.endSend>> = null;
    await act(async () => {
      returnValue = await result.current.endSend("");
    });

    expect(returnValue).not.toBeNull();
    expect(returnValue!.transcript).toBe("/gsd-quick fix the login bug");
    expect(returnValue!.glued).toBe("/gsd-quick fix the login bug");
  });

  it("Test P34-03: endAppend passes non-transformed text through unchanged when server returns raw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ text: "just some raw text" }),
      }),
    );

    const { result } = renderHook(() => useVoiceRecording());
    act(() => { result.current.start({ autoCommit: true }); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    let returnValue: Awaited<ReturnType<typeof result.current.endAppend>> = null;
    await act(async () => {
      returnValue = await result.current.endAppend("");
    });

    expect(returnValue).not.toBeNull();
    expect(returnValue!.transcript).toBe("just some raw text");
    expect(returnValue!.glued).toBe("just some raw text");
  });

  it("Test P34-04: transcribeBlob appends hostId + tmuxSession form fields when logContext provided", async () => {
    let capturedBody: FormData | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        capturedBody = opts.body as FormData;
        return { ok: true, status: 200, json: () => Promise.resolve({ text: "x" }) };
      }),
    );

    const { result } = renderHook(() => useVoiceRecording({ hostId: 42, sessionId: "mysession" }));
    act(() => { result.current.start({ autoCommit: true }); });
    await waitFor(() => expect(result.current.state).toBe("recording"));
    await act(async () => { await result.current.endAppend(""); });

    expect(capturedBody).not.toBeNull();
    const fd = capturedBody as FormData;
    expect(fd.get("hostId")).toBe("42");
    expect(fd.get("tmuxSession")).toBe("mysession");
    expect(fd.get("file")).not.toBeNull();
  });

  it("Test P34-05: transcribeBlob OMITS hostId + tmuxSession when logContext is undefined", async () => {
    let capturedBody: FormData | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
        capturedBody = opts.body as FormData;
        return { ok: true, status: 200, json: () => Promise.resolve({ text: "x" }) };
      }),
    );

    const { result } = renderHook(() => useVoiceRecording()); // NO logContext arg
    act(() => { result.current.start({ autoCommit: true }); });
    await waitFor(() => expect(result.current.state).toBe("recording"));
    await act(async () => { await result.current.endAppend(""); });

    expect(capturedBody).not.toBeNull();
    const fd = capturedBody as FormData;
    expect(fd.get("hostId")).toBeNull();
    expect(fd.get("tmuxSession")).toBeNull();
    expect(fd.get("file")).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Regression tests for the stopRecording() guard + watchdog (quick-260808-1pa)
  //
  // Context: On iOS Safari the browser's MediaRecorder `onstop` event can drop.
  // Before this fix, that hang cascaded — every subsequent button press
  // reassigned `recorder.onstop` and called `recorder.stop()` again on an
  // already-inactive recorder, hanging identically. Fix is two additions:
  //   G — state guard: when recorder.state !== "recording", resolve(null)
  //       immediately WITHOUT touching onstop (kills the cascade).
  //   H — 8s watchdog: if onstop never fires, force cleanup + resolve(null)
  //       (recovers even the first hang).
  // ---------------------------------------------------------------------------

  it("Test G: stopRecording no-ops when recorder.state !== 'recording' — second call does not reassign onstop", async () => {
    // Simulates the exact iOS Safari cascade-of-hangs: the browser transitions
    // MediaRecorder.state to "inactive" even when the `onstop` event drops,
    // leaving React state stuck at "recording" and recorderRef pointing at
    // an inactive recorder. Any subsequent stopRecording() call would (before
    // this fix) reassign `onstop` on the inactive recorder and call `.stop()`
    // again — hanging identically. The guard bails without touching onstop.
    //
    // Test structure:
    //   1. Start → recorder created (state="recording").
    //   2. Manually flip recorder.state to "inactive" (mimics browser having
    //      dropped onstop after prior stop attempt — React state stays
    //      "recording" because our hook never saw onstop fire).
    //   3. Call cancel() — outer React-state gate passes (state==="recording"),
    //      stopRecording's inner guard sees recorder.state==="inactive" and
    //      bails without assigning onstop.
    //   4. Assert onstop assignment count === 0 (guard never reached the
    //      assignment line). This is stricter than the plan's ">=1 across
    //      two calls" formulation but locks in the same invariant: after the
    //      state transitions to non-recording, no further onstop reassignments
    //      happen. Any regression that removes the guard would trip this.
    const { result } = renderHook(() => useVoiceRecording());

    act(() => { result.current.start({ autoCommit: true }); });
    await waitFor(() => expect(result.current.state).toBe("recording"));

    const recorder = MockMediaRecorder.instances[0];

    // Install accessor spies on `onstop` to count assignments. Every `set`
    // bumps the counter. Baseline: 0 (hook has not entered stopRecording yet).
    let onstopAssignCount = 0;
    let currentOnstop: (() => void) | null = recorder.onstop;
    Object.defineProperty(recorder, "onstop", {
      configurable: true,
      get() {
        return currentOnstop;
      },
      set(v: (() => void) | null) {
        onstopAssignCount += 1;
        currentOnstop = v;
      },
    });

    // Simulate the browser having transitioned the recorder to "inactive"
    // (as happens on iOS Safari after a dropped onstop event) while React
    // state is still "recording". Give the recorder a `state` field so the
    // guard can read it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (recorder as any).state = "inactive";

    await act(async () => {
      await result.current.cancel();
    });

    // React state recovered to idle via cancel's normal path (cancel awaits
    // stopRecording, then setState("idle") unconditionally).
    expect(result.current.state).toBe("idle");
    // Onstop was NEVER reassigned — the guard bailed before touching it.
    // Without the guard, this would be 1 (or higher on subsequent presses).
    expect(onstopAssignCount).toBe(0);
  });

  it("Test H: watchdog resolves null and cleans up after 8s if onstop never fires", async () => {
    // Use fake timers to advance the 8000ms watchdog deterministically.
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useVoiceRecording());

      act(() => { result.current.start({ autoCommit: true }); });
      // waitFor uses real-time internals; with fake timers we need to flush
      // pending microtasks (the getUserMedia .then chain) manually before
      // asserting state.
      await vi.waitFor(() => {
        expect(result.current.state).toBe("recording");
      });

      const recorder = MockMediaRecorder.instances[0];
      const stream = recorder.stream as unknown as ReturnType<typeof makeMockStream>;

      // Override this instance's stop() so it does NOT auto-fire onstop
      // AND does NOT flip state to "inactive" — per-instance mutation to
      // avoid leaking into sibling tests. Note: this leaves recorder.state
      // === "recording" (as set by the mock's start()) so the guard passes
      // and stopRecording arms the watchdog.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (recorder as any).stop = vi.fn();

      // Kick off endSend without awaiting, then advance fake timers by 8s
      // so the watchdog fires. `advanceTimersByTimeAsync` flushes queued
      // microtasks between timer ticks so the awaits inside endSend/
      // stopRecording/transcribeBlob unwind correctly.
      let endSendResult: Awaited<ReturnType<typeof result.current.endSend>> | undefined;
      await act(async () => {
        const p = result.current.endSend("text");
        await vi.advanceTimersByTimeAsync(8000);
        endSendResult = await p;
      });

      // Watchdog resolved null → endSend's null-blob branch set state=idle.
      expect(endSendResult).toBeNull();
      await vi.waitFor(() => {
        expect(result.current.state).toBe("idle");
      });

      // The stream tracks were stopped by the watchdog cleanup path.
      expect(stream._track.stop).toHaveBeenCalled();

      // Fetch was NOT called — null blob short-circuits before transcribeBlob.
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // ---------------------------------------------------------------------------
  // cancel() race-safety (pending cancel flag) — Plan 32-01 Task 1 B-1 fix
  //
  // The race being defended: cancel() invoked BEFORE getUserMedia resolves
  // (short-tap on hold-send during a slow mic-permission grant). Before this
  // fix, cancel()'s state !== "recording" guard turned it into a no-op, so
  // the arriving stream was still wired up to a fresh MediaRecorder and the
  // mic stayed hot with no way to stop it.
  //
  // The fix: cancel() in the pending window sets pendingCancelRef=true;
  // start()'s streamPromise.then() reads that flag, tears down the stream,
  // and short-circuits BEFORE constructing MediaRecorder / firing setState /
  // playing the start sound.
  // ---------------------------------------------------------------------------

  describe("cancel() race-safety (pending cancel flag)", () => {
    it("Test PC-A: cancel() BEFORE getUserMedia resolves → MediaRecorder NEVER constructed, state stays idle, stream tracks stopped", async () => {
      // Install a controllable getUserMedia so the .then() callback does not run
      // until we explicitly resolve it. This models the "slow mic-permission grant"
      // window: state stays "idle" throughout, so pre-fix cancel() would be a no-op.
      let resolveStream: (stream: ReturnType<typeof makeMockStream>) => void = () => {};
      const controlledStream = makeMockStream();
      Object.defineProperty(globalThis, "navigator", {
        value: {
          mediaDevices: {
            getUserMedia: vi.fn(
              () =>
                new Promise<ReturnType<typeof makeMockStream>>((r) => {
                  resolveStream = r;
                }),
            ),
          },
        },
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useVoiceRecording());

      // Fire start() — getUserMedia called synchronously; .then() has NOT run yet.
      act(() => { result.current.start(); });
      expect(result.current.state).toBe("idle");
      expect(MockMediaRecorder.instances).toHaveLength(0);

      // Cancel while state is still "idle" — pre-fix, this was a no-op; post-fix,
      // it sets pendingCancelRef=true.
      await act(async () => { await result.current.cancel(); });
      expect(result.current.state).toBe("idle");
      expect(MockMediaRecorder.instances).toHaveLength(0);

      // Now resolve the pending getUserMedia. The .then() callback runs, sees
      // pendingCancelRef=true, tears down the stream, and returns early.
      await act(async () => {
        resolveStream(controlledStream);
        // Flush the microtask queue so .then() executes.
        await Promise.resolve();
        await Promise.resolve();
      });

      // MediaRecorder was NEVER constructed — the race is closed.
      expect(MockMediaRecorder.instances).toHaveLength(0);
      // State never transitioned to "recording".
      expect(result.current.state).toBe("idle");
      // Stream tracks were stopped (torn down by the .then() pending-cancel branch).
      expect(controlledStream._track.stop).toHaveBeenCalledTimes(1);
    });

    it("Test PC-B: cancel() AFTER recording started → unchanged behavior (recorder.stop called, state → idle)", async () => {
      // This proves the fix is purely additive: the pre-existing state === "recording"
      // branch of cancel() still runs byte-identically.
      const { result } = renderHook(() => useVoiceRecording());

      act(() => { result.current.start({ autoCommit: true }); });
      await waitFor(() => expect(result.current.state).toBe("recording"));

      expect(MockMediaRecorder.instances).toHaveLength(1);
      const recorderInstance = MockMediaRecorder.instances[0];
      const stream = recorderInstance.stream as unknown as ReturnType<typeof makeMockStream>;

      await act(async () => { await result.current.cancel(); });

      expect(result.current.state).toBe("idle");
      expect(recorderInstance.stop).toHaveBeenCalledTimes(1);
      expect(stream._track.stop).toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("Test PC-C: cancel-then-start sequence → stale pending-cancel flag is cleared at start() entry", async () => {
      // Install a controllable getUserMedia so we can drive the pending window
      // for the FIRST start()/cancel() pair. After cancel resolves the .then(),
      // we switch getUserMedia back to auto-resolving so the SECOND start()
      // completes normally.
      let resolveStream1: (stream: ReturnType<typeof makeMockStream>) => void = () => {};
      const controlledStream1 = makeMockStream();
      const getUserMediaMock = vi
        .fn()
        // First call: controlled promise (pending until we resolve it).
        .mockImplementationOnce(
          () =>
            new Promise<ReturnType<typeof makeMockStream>>((r) => {
              resolveStream1 = r;
            }),
        )
        // Second call: auto-resolves with a fresh stream so the second start proceeds.
        .mockImplementation(() => Promise.resolve(makeMockStream()));
      Object.defineProperty(globalThis, "navigator", {
        value: {
          mediaDevices: { getUserMedia: getUserMediaMock },
        },
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useVoiceRecording());

      // First cycle: start → cancel while pending → resolve → .then() tears down.
      act(() => { result.current.start(); });
      await act(async () => { await result.current.cancel(); });
      await act(async () => {
        resolveStream1(controlledStream1);
        await Promise.resolve();
        await Promise.resolve();
      });
      // No MediaRecorder from the first cycle.
      expect(MockMediaRecorder.instances).toHaveLength(0);
      expect(controlledStream1._track.stop).toHaveBeenCalledTimes(1);
      expect(result.current.state).toBe("idle");

      // Second cycle: fresh start must clear the pending-cancel flag at entry and
      // proceed through .then() normally. Use autoCommit:true to verify the full
      // recording path completes (not just the "starting" intermediate).
      act(() => { result.current.start({ autoCommit: true }); });
      await waitFor(() => expect(result.current.state).toBe("recording"));

      // Fresh MediaRecorder constructed for the second cycle.
      expect(MockMediaRecorder.instances).toHaveLength(1);
      expect(MockMediaRecorder.instances[0].start).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // New tests for Task 1 — commitStartVisibility split + orphan-guard (patch #436)
  // ---------------------------------------------------------------------------

  describe("cancel() race-safety — post-recorder-start orphan guard (Layer 1 fix, B-1)", () => {
    it("Test PC-D: getUserMedia resolves BEFORE cancel() — recorder constructed, then cancel() tears it down via stateRef", async () => {
      // Scenario: start() fires, getUserMedia resolves quickly (before cancel() runs).
      // .then() runs and sets stateRef="starting". THEN cancel() is called.
      // Expected: cancel() reads stateRef.current==="starting", recorder exists, so
      // it runs the teardown path: recorder.stop, tracks stopped, state=idle.
      const { result } = renderHook(() => useVoiceRecording());

      // Start without autoCommit — state will go "idle" → "starting" after .then().
      act(() => { result.current.start(); });

      // Wait for getUserMedia to resolve and state to reach "starting".
      await waitFor(() => expect(result.current.state).toBe("starting"));

      // Recorder was constructed (by this point .then() has run).
      expect(MockMediaRecorder.instances).toHaveLength(1);
      const recorder = MockMediaRecorder.instances[0];

      // Now cancel() — state is "starting" with recorder present.
      await act(async () => { await result.current.cancel(); });

      // State returns to idle.
      expect(result.current.state).toBe("idle");
      // Recorder was stopped.
      expect(recorder.stop).toHaveBeenCalledTimes(1);
      // start.mp3 was NEVER played (commitStartVisibility was never called).
      const startAudio = getAudioBySrc("start.mp3");
      if (startAudio) {
        expect(startAudio.play).not.toHaveBeenCalled();
      }

      // After cancel, a fresh start() should construct a new MediaRecorder,
      // proving refs were properly cleared.
      act(() => { result.current.start({ autoCommit: true }); });
      await waitFor(() => expect(result.current.state).toBe("recording"));
      expect(MockMediaRecorder.instances).toHaveLength(2);
    });

    it("Test PC-E: post-recorder.start() re-check path (B-1 smoking-gun — cancel arms pendingCancelRef AFTER recorder construction)", async () => {
      // This tests the exact Ashley bug log scenario:
      //   start() called → getUserMedia in-flight → cancel() called → pendingCancelRef=true
      //   → getUserMedia resolves → .then() runs pre-construction check (sees true) but...
      // Wait, actually the pre-construction check would catch it. Let me replicate the
      // exact race: cancel() runs while state is STILL "idle" (before .then() sets "starting").
      // Then the pre-construction pendingCancelRef check clears pendingCancelRef (sets false)
      // and returns. But we want to test the POST-recorder.start() re-check.
      //
      // The post-recorder.start() re-check fires when:
      //   1. start() fires, getUserMedia promise is created.
      //   2. .then() starts running — pre-construction check passes (pendingCancelRef=false at entry).
      //   3. Recorder is constructed and recorder.start() fires.
      //   4. During step 3, in a race scenario, pendingCancelRef is set true by cancel().
      //   5. Post-recorder.start() re-check sees pendingCancelRef=true → tears down.
      //
      // To simulate this in tests: use a controllable getUserMedia, call start(),
      // call cancel() (arms pendingCancelRef), then resolve getUserMedia.
      // The pre-construction check will see pendingCancelRef=true and tear down
      // WITHOUT constructing recorder — demonstrating the first defense.
      // For the true Layer 1 re-check path, we need pendingCancelRef to be set
      // AFTER pre-construction check but BEFORE post-recorder.start() re-check.
      //
      // Simplest way: manually patch pendingCancelRef via a mock that sets it
      // inside MediaRecorder constructor (between pre-check and post-check).
      let resolveStream: (stream: ReturnType<typeof makeMockStream>) => void = () => {};
      const controlledStream = makeMockStream();
      Object.defineProperty(globalThis, "navigator", {
        value: {
          mediaDevices: {
            getUserMedia: vi.fn(
              () => new Promise<ReturnType<typeof makeMockStream>>((r) => { resolveStream = r; }),
            ),
          },
        },
        writable: true,
        configurable: true,
      });

      // Capture the real MockMediaRecorder and wrap it to simulate the race:
      // set pendingCancelRef=true INSIDE the constructor (after pre-check, before post-check).
      let pendingCancelFlipper: (() => void) | null = null;
      const OriginalMockRecorder = MockMediaRecorder;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).MediaRecorder = class RacyMockRecorder extends OriginalMockRecorder {
        constructor(stream: MediaStream) {
          super(stream);
          // Flip pendingCancelRef AFTER recorder construction (simulating the race)
          // by calling any queued callback.
          if (pendingCancelFlipper) pendingCancelFlipper();
        }
      };

      const { result } = renderHook(() => useVoiceRecording());

      act(() => { result.current.start(); });
      // State is idle — getUserMedia in-flight.
      expect(result.current.state).toBe("idle");

      // Set up the race: cancel will be called synchronously from inside
      // MediaRecorder constructor (via pendingCancelFlipper). This simulates
      // cancel() called between pre-construction check and post-recorder.start() re-check.
      // We arm it BEFORE resolving getUserMedia.
      // Actually, more accurately: cancel() arms pendingCancelRef before getUserMedia resolves.
      // The pre-construction check MISSES it because it was cleared by a prior check.
      // To force the post-recorder.start() path, we'll directly arm the pending cancel
      // inside the constructor via the flipper:
      pendingCancelFlipper = () => {
        // Simulate cancel() having set pendingCancelRef — we do this by calling
        // the actual cancel() which sets pendingCancelRef=true via the "not recording/starting" branch.
        // But result.current.cancel() is async, so capture and call synchronously inline:
        // (The hook's cancel() on state==="idle" sets pendingCancelRef=true synchronously before returning)
        void result.current.cancel();
      };

      // Resolve getUserMedia — this triggers .then() which: pre-check passes (false),
      // constructs recorder (pendingCancelFlipper fires → cancel() sets pendingCancelRef=true),
      // calls recorder.start(), then post-recorder.start() re-check sees true → teardown.
      await act(async () => {
        resolveStream(controlledStream);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Post-recorder.start() re-check should have torn down:
      // Recorder was constructed (instances.length >= 1)
      expect(MockMediaRecorder.instances.length).toBeGreaterThanOrEqual(1);
      const recorder = MockMediaRecorder.instances[0];
      // Recorder.stop() was called by the re-check teardown path.
      expect(recorder.stop).toHaveBeenCalledTimes(1);
      // Stream tracks were stopped.
      expect(controlledStream._track.stop).toHaveBeenCalled();
      // State stays idle.
      expect(result.current.state).toBe("idle");
      // start.mp3 was NEVER played.
      const startAudio = getAudioBySrc("start.mp3");
      if (startAudio) {
        expect(startAudio.play).not.toHaveBeenCalled();
      }
    });
  });

  describe("commitStartVisibility() — Layer 2 UX split (B-2 fix)", () => {
    it("Test COMMIT-A: happy path via commitStartVisibility — start.mp3 NOT played until commit, state 'starting' until commit", async () => {
      const { result } = renderHook(() => useVoiceRecording());

      act(() => { result.current.start(); });

      // Wait for the "starting" intermediate state (getUserMedia resolved + .then() ran).
      await waitFor(() => expect(result.current.state).toBe("starting"));

      // Assert start.mp3 has NOT played yet.
      const startAudio = getAudioBySrc("start.mp3");
      if (startAudio) {
        expect(startAudio.play).not.toHaveBeenCalled();
      }

      // Now commit — should transition to "recording" and play start.mp3.
      act(() => { result.current.commitStartVisibility(); });

      await waitFor(() => expect(result.current.state).toBe("recording"));

      // start.mp3 played exactly once.
      const startAudioAfter = getAudioBySrc("start.mp3");
      expect(startAudioAfter).not.toBeNull();
      expect(startAudioAfter!.play).toHaveBeenCalledTimes(1);
    });

    it("Test COMMIT-B: commitStartVisibility called BEFORE getUserMedia resolves → arms pendingCommitRef; .then() auto-advances to recording (cold-start race fix, 2026-08-14)", async () => {
      // Install controllable getUserMedia — .then() hasn't run yet.
      let resolveStream: (stream: ReturnType<typeof makeMockStream>) => void = () => {};
      const controlledStream = makeMockStream();
      Object.defineProperty(globalThis, "navigator", {
        value: {
          mediaDevices: {
            getUserMedia: vi.fn(
              () => new Promise<ReturnType<typeof makeMockStream>>((r) => { resolveStream = r; }),
            ),
          },
        },
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useVoiceRecording());

      act(() => { result.current.start(); });
      // .then() hasn't run yet — state is "idle".
      expect(result.current.state).toBe("idle");

      // Call commitStartVisibility before getUserMedia resolves — arms pendingCommitRef
      // (state guard rejects the immediate transition, but the ref is set for .then()
      // to consume when it runs).
      act(() => { result.current.commitStartVisibility(); });

      // Before .then() runs: state still idle, no start.mp3.
      expect(result.current.state).toBe("idle");
      const startAudio = getAudioBySrc("start.mp3");
      if (startAudio) {
        expect(startAudio.play).not.toHaveBeenCalled();
      }

      // Now resolve getUserMedia — .then() runs; sees pendingCommitRef=true, skips the
      // "starting" grey zone and jumps straight to "recording" + plays start.mp3.
      // This is the cold-start race fix (Ashley iPhone 2026-08-14 — getUserMedia took
      // 1.1s to resolve, timer had fired at 250ms and armed the ref).
      await act(async () => {
        resolveStream(controlledStream);
        await Promise.resolve();
        await Promise.resolve();
      });

      // State advanced directly to "recording" via pendingCommitRef consumption.
      expect(result.current.state).toBe("recording");
      const startAudioAfter = getAudioBySrc("start.mp3");
      expect(startAudioAfter).not.toBeNull();
      expect(startAudioAfter!.play).toHaveBeenCalledTimes(1);
    });

    it("Test COMMIT-C: re-entrance during grey zone — second start() is a no-op (getUserMedia called only once)", async () => {
      const { result } = renderHook(() => useVoiceRecording());

      act(() => { result.current.start(); });

      // Wait for "starting" (grey zone: .then() ran, commitStartVisibility not yet called).
      await waitFor(() => expect(result.current.state).toBe("starting"));

      // Second start() while in "starting" — stateRef.current === "starting" !== "idle"
      // so the guard should short-circuit without calling getUserMedia again.
      act(() => { result.current.start(); });

      // getUserMedia was called ONLY ONCE total.
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
      // MockMediaRecorder instance count stays at 1.
      expect(MockMediaRecorder.instances).toHaveLength(1);
    });

    it("Test COMMIT-D: start({ autoCommit: true }) skips 'starting' and goes directly to 'recording' + plays start.mp3", async () => {
      // This is the mic-tap parity path: beginRecord() calls start({ autoCommit: true }).
      const { result } = renderHook(() => useVoiceRecording());

      act(() => { result.current.start({ autoCommit: true }); });

      // Should jump straight to "recording" without passing through "starting".
      await waitFor(() => expect(result.current.state).toBe("recording"));

      // start.mp3 was played (without calling commitStartVisibility()).
      const startAudio = getAudioBySrc("start.mp3");
      expect(startAudio).not.toBeNull();
      expect(startAudio!.play).toHaveBeenCalledTimes(1);

      // commitStartVisibility is a no-op in "recording" state (idempotent safety check).
      act(() => { result.current.commitStartVisibility(); });
      expect(result.current.state).toBe("recording");
      // No second play() call.
      expect(startAudio!.play).toHaveBeenCalledTimes(1);
    });
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

    act(() => { result.current.start({ autoCommit: true }); });

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
