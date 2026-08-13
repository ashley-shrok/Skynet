// Phase 32 Plan 32-03 — integration tests for the hold-to-send gesture on the
// ComposeBox primary send button.
//
// Covers the 9 canonical CONTEXT.md § specifics test cases (L120-129) plus 1
// threshold-boundary regression guard. Every test drives the full ComposeBox
// render tree — production wiring from Plan 32-02 (useHoldToRecord instance,
// preserved onClick for aside-dismiss, holdInitiatedRef-gated
// showRecordingControls) is what's under test here. If a test fails, the
// failure indicates a real defect in Plan 32-01 or Plan 32-02; do NOT weaken
// the assertion to make it pass.
//
// Test scope:
//   - Primary send button only. The slot-mode send button is functionally
//     identical (same hook, symmetric callbacks per Plan 32-02); the hook's
//     own unit tests already prove the gesture logic works on any consumer.
//
// D-16-02 iOS Safari sync-gesture invariant is asserted in Test 8: the
// getUserMedia call-count assertion appears IMMEDIATELY after fireEvent
// .pointerDown with NO intervening await, timer advance, or waitFor.
//
// Setup mirrors ComposeBox.voice.test.tsx (MockMediaRecorder + getUserMedia +
// fetch triple) so the internal useVoiceRecording singleton wires up.
// Additionally, this file installs vi.useFakeTimers({ shouldAdvanceTime: false })
// in beforeEach so the 250ms hold-threshold can be walked deterministically.
// For async transitions (getUserMedia resolution, React re-render after
// voice.state → "recording") the tests use
// `await act(async () => { await vi.advanceTimersByTimeAsync(N); })` which
// flushes fake-timer callbacks AND microtasks in lockstep — this is the
// vitest 4.x idiom for combining fake timers with promise-driven code.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ComposeBoxProps } from "./ComposeBox";
import { HOLD_THRESHOLD_MS } from "./useHoldToRecord";

// Mock the compose-drafts API BEFORE importing ComposeBox so the module's
// effect uses the mock at first render (mirrors ComposeBox.voice.test.tsx).
vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "", queueSlots: [] }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

import { ComposeBox } from "./ComposeBox";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function baseProps(overrides: Partial<ComposeBoxProps> = {}): ComposeBoxProps {
  return {
    onSend: vi.fn(() => true),
    hostId: 1,
    tmuxSession: "s1",
    ...overrides,
  };
}

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
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start = vi.fn().mockImplementation(() => {
    this.state = "recording";
  });
  stop = vi.fn().mockImplementation(() => {
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

/**
 * Install a fixed getBoundingClientRect on the given button so the hook's
 * bounds check has a real rect to consult. jsdom returns a zero-width rect by
 * default which would make every pointerup register as "outside".
 */
function installBoundsShim(
  button: HTMLElement,
  rect: { left: number; right: number; top: number; bottom: number } = {
    left: 0,
    right: 40,
    top: 0,
    bottom: 40,
  },
): void {
  Object.defineProperty(button, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      x: rect.left,
      y: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      toJSON: () => ({}),
    }),
  });
}

/** Convenience for the primary (paper-plane) send button in non-aside mode. */
function getSendButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
}

/** Convenience for the RecordingControls Cancel button (used to assert its absence). */
function queryCancelRecordingButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Cancel recording" });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();

  MockMediaRecorder.instances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaRecorder = MockMediaRecorder;

  // Stub navigator.mediaDevices.getUserMedia to resolve with a mock stream.
  // This ALSO satisfies the showMicButton `navigator.mediaDevices != null`
  // guard so the MicButton renders in these tests.
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

  // Default fetch mock: successful STT response returning "hello world".
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ text: "hello world" }),
    }),
  );

  // Fake timers so the 250ms hold threshold can be walked deterministically.
  // shouldAdvanceTime:false — every tick is explicit via advanceTimersByTime[Async].
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ComposeBox — Phase 32 hold-to-send gesture (primary send button)", () => {
  it("Test 1 (CONTEXT.md L122): short tap under threshold fires normal handleSend with typed text; rollback via voice.cancel means no MediaRecorder is ever constructed", async () => {
    const onSend = vi.fn(() => true);
    const props = baseProps({ onSend });
    render(<ComposeBox {...props} />);

    // Type into the textarea so sendDisabled=false and the hook can arm.
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello world" } });

    const button = getSendButton();
    installBoundsShim(button);

    // Pointerdown → voice.start() called synchronously → getUserMedia queued.
    // Pointerup fires WITHOUT advancing fake timers OR flushing microtasks
    // between the two events — this reproduces the real-world short-tap where
    // the user releases so fast that the getUserMedia .then() callback has
    // NOT yet run when cancel() fires. The hook uses e.timeStamp (not real
    // elapsed time) for the elapsedMs calculation, so passing timeStamp: 200
    // still lands in the short-tap branch (< HOLD_THRESHOLD_MS). This is the
    // exact race Plan 32-01 Task 1's pendingCancelRef defense targets — with
    // getUserMedia still unresolved, cancel() sets pendingCancelRef=true and
    // the .then() (which runs on microtask flush below) takes the teardown
    // branch and does NOT construct a MediaRecorder.
    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });
    // Pointerup at t=200ms (timeStamp) — short-tap branch: await voice.cancel()
    // then onShortTap() → handleSend() → props.onSend("hello world").
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 200,
      });
      // Now flush the awaited voice.cancel() (sets pendingCancelRef=true,
      // resolves immediately in state=idle branch) + the getUserMedia .then()
      // (takes the pending-cancel teardown branch) + onShortTap → handleSend.
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // onSend called exactly once with the typed text.
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello world");

    // Shape 1 optimistic-start invariant: getUserMedia was called once
    // (synchronously inside pointerdown), then the pending-cancel branch tore
    // down the arriving stream. No MediaRecorder was ever constructed.
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    expect(getUserMediaMock.mock.calls.length).toBe(1);
    expect(MockMediaRecorder.instances.length).toBe(0);

    // No /voice/transcribe fetch — the rollback tore down before any STT.
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it("Test 2 (CONTEXT.md L123): long press >= 250ms starts recording IN PLACE — send button stays with data-hold-active=true, RecordingControls does NOT swap in (B-3)", async () => {
    render(<ComposeBox {...baseProps()} />);

    // Type text so sendDisabled=false and the hook can arm.
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hi" } });

    const button = getSendButton();
    installBoundsShim(button);

    // Baseline snapshot: data-hold-active is "false" before pointerdown.
    expect(button.getAttribute("data-hold-active")).toBe("false");

    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });

    // Advance past the threshold + flush the getUserMedia .then() chain so
    // voice.state transitions "idle" → "recording" and React re-renders.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    // Extra microtask flushes to guarantee the MediaRecorder .start() +
    // setState("recording") re-render has landed.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // ---- B-3 deterministic assertions (three, all unconditional) ---------

    // (a) The button carries data-hold-active="true".
    expect(button.getAttribute("data-hold-active")).toBe("true");

    // (b) RecordingControls did NOT swap in — the Cancel-recording button
    //     that would appear if showRecordingControls were true is absent.
    expect(queryCancelRecordingButton()).toBeNull();

    // (c) The same button element is still in the DOM (identity preserved).
    expect(getSendButton()).toBe(button);

    // ---- Cleanup: slide-off + release so voice.cancel runs and afterEach's
    //     unmount doesn't fight an in-flight recording.
    fireEvent.pointerLeave(button, {
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 200,
        clientY: 200,
        timeStamp: 400,
      });
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("Test 3 (CONTEXT.md L124): release inside bounds after long-press with typed text sends the glued transcript via handleSend (D-16-05 same-path assertion)", async () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });

    const button = getSendButton();
    installBoundsShim(button);

    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });

    // Advance past threshold + flush getUserMedia resolution + MediaRecorder
    // construction + voice.state → "recording" re-render.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Push a data chunk so the emitted blob is non-empty (STT path needs it).
    act(() => {
      const recorder = MockMediaRecorder.instances[0];
      recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
    });

    // Release inside bounds at t=300ms → long-press-send branch: onLongPressSend
    // → handleVoiceSend("primary") → voice.endSend → handleSend(glued).
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 300,
      });
      // Flush the async pointerup handler + voice.endSend await + fetch resolution.
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The glue rule: existing "hello" does not end in whitespace, so a single
    // space is inserted between "hello" and the STT transcript "hello world".
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello hello world");

    // Fetch was made to /voice/transcribe.
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.length).toBe(1);
    const [fetchUrl] = fetchMock.mock.calls[0] as [string, ...unknown[]];
    expect(fetchUrl).toBe("/voice/transcribe");
  });

  it("Test 4 (CONTEXT.md L125): slide off + release cancels — no send, no fetch, textarea unchanged", async () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });

    const button = getSendButton();
    installBoundsShim(button);

    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Slide off — pointerleave marks outOfBoundsRef=true.
    fireEvent.pointerLeave(button, {
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });

    // Release outside bounds at t=300ms → long-press-cancel branch:
    // void voice.cancel(); no onLongPressSend.
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 200,
        clientY: 200,
        timeStamp: 300,
      });
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // No fetch (voice.cancel path taken, no /voice/transcribe request).
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.length).toBe(0);
    // No send.
    expect(onSend).toHaveBeenCalledTimes(0);
    // Textarea unchanged.
    expect(textarea.value).toBe("hello");
  });

  it("Test 5 (CONTEXT.md L126): aside-morph inertness — hold on Resume (X) does NOT call getUserMedia; short-tap on X still dismisses via preserved onClick (B-2)", async () => {
    const onSend = vi.fn(() => true);
    const onAsideDismiss = vi.fn();
    render(
      <ComposeBox
        {...baseProps({
          onSend,
          asideActive: true,
          onAsideDismiss,
        })}
      />,
    );

    // With asideActive=true the send button renders as X ("Resume").
    const resumeButton = screen.getByRole("button", {
      name: "Resume",
    }) as HTMLButtonElement;
    installBoundsShim(resumeButton);

    // ---- Deterministic assertion sequence (no branching) ------------------

    // 1. Pointerdown on Resume button.
    fireEvent.pointerDown(resumeButton, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });

    // 2. Advance well past the 250ms threshold.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // 3. Deterministic assertion: getUserMedia was NEVER called. The hook's
    //    asideActive guard prevented voice.start().
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    expect(getUserMediaMock).not.toHaveBeenCalled();

    // 4. Pointerup inside bounds — browser synthesizes a click from the
    //    pointerdown/pointerup pair which fires the preserved onClick.
    await act(async () => {
      fireEvent.pointerUp(resumeButton, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 500,
      });
      // jsdom does NOT synthesize a click from fireEvent.pointerDown+pointerUp
      // — the React SyntheticEvent path only fires onClick when we explicitly
      // dispatch a click. Simulate the browser-native short-tap behavior by
      // firing the click ourselves (this is exactly what the browser does on
      // a real device after a valid pointerdown/pointerup pair inside bounds).
      fireEvent.click(resumeButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    // 5. Deterministic assertion: onAsideDismiss was called exactly once.
    expect(onAsideDismiss).toHaveBeenCalledTimes(1);

    // 6. Deterministic assertion: getUserMedia STILL not called after pointerup
    //    (guards against a late setTimeout firing voice.start belatedly).
    expect(getUserMediaMock).not.toHaveBeenCalled();

    // Belt: onSend was not called (aside-dismiss must not trigger send).
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Test 6 (CONTEXT.md L127): disabled-state inertness — hold on send button when sendDisabled=true fires nothing (no voice.start, no send)", async () => {
    const onSend = vi.fn(() => true);
    // Empty text + no attachments → sendDisabled=true → button is disabled.
    render(<ComposeBox {...baseProps({ onSend })} />);

    const button = getSendButton();
    installBoundsShim(button);

    // In jsdom, disabled buttons still receive pointerdown events but the
    // hook's own `disabled` guard short-circuits before voice.start.
    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // Deterministic assertion: getUserMedia never called (hook guard held).
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    expect(getUserMediaMock).not.toHaveBeenCalled();

    // Pointerup — should also be inert.
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 500,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // onSend never called, no fetch.
    expect(onSend).toHaveBeenCalledTimes(0);
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it("Test 7 (CONTEXT.md L128): voice.state !== 'idle' guard — while mic-tap is recording, primary send button is not visible AND no additional getUserMedia call fires (both paths mutually exclusive at the state-machine level)", async () => {
    render(<ComposeBox {...baseProps()} />);

    // Tap the MicButton to start recording via the mic-tap path.
    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    // Flush getUserMedia + MediaRecorder construction + voice.state re-render.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // MediaRecorder was constructed exactly once via the mic-tap path.
    expect(MockMediaRecorder.instances.length).toBe(1);

    // showRecordingControls now true (voice.state === "recording" &&
    // !holdInitiatedRef.current since the mic-tap path leaves it false).
    // The primary Send button is gone (replaced by RecordingControls).
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();

    // Deterministic assertion: getUserMedia was called EXACTLY once — no
    // double-arm from any lingering hold-hook state.
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    expect(getUserMediaMock.mock.calls.length).toBe(1);

    // Clean up: cancel the recording so afterEach's unmount doesn't fight it.
    const cancelBtn = screen.getByRole("button", {
      name: "Cancel recording",
    });
    await act(async () => {
      fireEvent.click(cancelBtn);
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("Test 8 (CONTEXT.md L129): iOS Safari sync-gesture invariant — getUserMedia is called SYNCHRONOUSLY within the pointerdown handler", async () => {
    // D-16-02 iOS Safari sync-gesture invariant assertion — if this test
    // fails, the mic-permission prompt will silently die on iOS Safari and
    // hold-to-record will not work on Ashley's iPhone. Do NOT insert an
    // `await` between fireEvent.pointerDown and the expect below — the whole
    // point of this test is that the assertion is synchronous.

    render(<ComposeBox {...baseProps()} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hi" } });

    const button = getSendButton();
    installBoundsShim(button);

    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;

    // Snapshot: no calls before pointerdown.
    expect(getUserMediaMock.mock.calls.length).toBe(0);

    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });

    // SYNCHRONOUS assertion — NO await, NO timer advance, NO waitFor between
    // the fireEvent above and this expect. This is the D-16-02 guarantee.
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);

    // Cleanup: release outside bounds so voice.cancel runs and afterEach's
    // unmount doesn't fight an in-flight recording.
    fireEvent.pointerLeave(button, {
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 200,
        clientY: 200,
        timeStamp: 100,
      });
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("Test 9 (CONTEXT.md L130): both paths coexist — after a hold-send cycle, the mic-tap path still works cleanly", async () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);

    // ---- Full hold-send cycle --------------------------------------------
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "test1" } });

    const button = getSendButton();
    installBoundsShim(button);

    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Emit an audio chunk on the just-constructed recorder.
    act(() => {
      const recorder = MockMediaRecorder.instances[0];
      recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
    });

    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 300,
      });
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("test1 hello world");

    // State should be back to idle — the Send button is visible again.
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();

    // ---- Mic-tap cycle ---------------------------------------------------
    const micBtn = screen.getByRole("button", { name: "Record voice" });
    fireEvent.click(micBtn);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The mic-tap path built a NEW recorder (second instance).
    expect(MockMediaRecorder.instances.length).toBe(2);

    // Cancel to return to idle cleanly (no send, no fetch beyond the first).
    const cancelBtn = screen.getByRole("button", {
      name: "Cancel recording",
    });
    await act(async () => {
      fireEvent.click(cancelBtn);
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Deterministic assertion: getUserMedia was called exactly twice (once
    // per cycle) — neither cycle poisoned the other.
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    expect(getUserMediaMock.mock.calls.length).toBe(2);
  });

  it("Test 10: threshold boundary — 249ms (HOLD_THRESHOLD_MS - 1) tap-sends typed text only; 250ms (HOLD_THRESHOLD_MS) hold-records + sends glued transcript", async () => {
    // ---- Case A: HOLD_THRESHOLD_MS - 1 = 249ms → short-tap-send branch ----
    const onSendA = vi.fn(() => true);
    const { unmount } = render(<ComposeBox {...baseProps({ onSend: onSendA })} />);

    {
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "hi" } });

      const button = getSendButton();
      installBoundsShim(button);

      fireEvent.pointerDown(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 0,
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HOLD_THRESHOLD_MS - 1);
      });
      await act(async () => {
        fireEvent.pointerUp(button, {
          pointerId: 1,
          clientX: 20,
          clientY: 20,
          timeStamp: HOLD_THRESHOLD_MS - 1,
        });
        await vi.advanceTimersByTimeAsync(50);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Short-tap branch: typed text only, no fetch.
      expect(onSendA).toHaveBeenCalledTimes(1);
      expect(onSendA).toHaveBeenCalledWith("hi");
      const fetchMockA = fetch as ReturnType<typeof vi.fn>;
      expect(fetchMockA.mock.calls.length).toBe(0);
    }

    unmount();
    // Reset shared state (MockMediaRecorder instances + mocks) before Case B.
    MockMediaRecorder.instances = [];
    vi.clearAllMocks();
    // Re-stub navigator + fetch after clearAllMocks wiped them.
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ text: "hello world" }),
      }),
    );

    // ---- Case B: HOLD_THRESHOLD_MS = 250ms → long-press-send branch -------
    const onSendB = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend: onSendB })} />);

    {
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "hi" } });

      const button = getSendButton();
      installBoundsShim(button);

      fireEvent.pointerDown(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 0,
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HOLD_THRESHOLD_MS);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // Emit an audio chunk before pointerup so the STT blob is non-empty.
      act(() => {
        const recorder = MockMediaRecorder.instances[0];
        recorder.emitData(new Blob(["audio"], { type: "audio/webm" }));
      });

      await act(async () => {
        fireEvent.pointerUp(button, {
          pointerId: 1,
          clientX: 20,
          clientY: 20,
          timeStamp: HOLD_THRESHOLD_MS,
        });
        await vi.advanceTimersByTimeAsync(100);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Long-press branch: transcript glued to typed text, fetch fired.
      expect(onSendB).toHaveBeenCalledTimes(1);
      expect(onSendB).toHaveBeenCalledWith("hi hello world");
      const fetchMockB = fetch as ReturnType<typeof vi.fn>;
      expect(fetchMockB.mock.calls.length).toBe(1);
    }
  });
});
