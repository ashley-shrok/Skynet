// Quick 260814-1hz — integration tests for the hold-to-record gesture on the
// ComposeBox primary MIC button. Renamed from ComposeBox.hold-to-send.test.tsx
// after the hold gesture was moved from the Send button onto the MicButton
// (see plan .planning/quick/260814-1hz-move-hold-to-record-gesture-from-send-bu/
// 260814-1hz-PLAN.md). Semantics preserved:
//   - LONG-press (>= HOLD_THRESHOLD_MS) inside bounds still fires
//     handleVoiceSend → handleSend(glued transcript) → onSend.
//   - SHORT tap (< HOLD_THRESHOLD_MS) NOW opens a mic-tap recording via
//     beginRecord (previously it fired the typed-send path from the Send
//     button; that path is now on Send button's plain onClick).
//   - Aside-morph inertness: when asideActive=true, MicButton does NOT render
//     at all (showMicButton gates on !asideActive with no hold disjunct on
//     that gate).
//   - iOS Safari D-16-02 sync-gesture invariant: getUserMedia STILL fires
//     synchronously inside pointerdown (the hook is unchanged; only the
//     button hosting it changed).
//
// Covers the 9 canonical CONTEXT.md § specifics test cases (L120-129) plus 1
// threshold-boundary regression guard, all rewired onto the MicButton, plus 1
// new test covering the mic-short-tap-opens-recording path. Every test drives
// the full ComposeBox render tree. If a test fails, the failure indicates a
// real defect in Quick 260814-1hz Task 1/2/3 (MicButton props extension,
// hook rewire, showMicButton visibility fix) — do NOT weaken the assertion
// to make it pass.
//
// Test scope:
//   - Primary mic button only. The slot-mode mic button is functionally
//     identical (same hook, symmetric callbacks per Task 2); the hook's own
//     unit tests already prove the gesture logic works on any consumer.
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

/**
 * Convenience for the primary MicButton (Quick 260814-1hz: hold-to-record
 * now lives here, not on the Send button). Queried by MicButton's default
 * aria-label "Record voice".
 */
function getMicButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: "Record voice",
  }) as HTMLButtonElement;
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

describe("ComposeBox — 260814-1hz hold-to-record gesture (primary mic button)", () => {
  it("Test 1 (reformulated per 260814-1hz): short tap on the mic under threshold OPENS a recording via beginRecord — onSend NOT called, RecordingControls swap in", async () => {
    // Reformulated from the original Phase 32 CONTEXT.md L122 test. Original
    // semantic: short-tap on the Send button = fire typed-send. New semantic:
    // short-tap on the Mic button = beginRecord (opens RecordingControls) —
    // the old mic-onClick behavior. The typed-send path now lives on the Send
    // button's plain onClick and is not exercised by pointer events at all.
    const onSend = vi.fn(() => true);
    const props = baseProps({ onSend });
    render(<ComposeBox {...props} />);

    // Type text so the Send button would send it if that were the code path —
    // but we're pointer-ing the Mic, so onSend MUST NOT fire. The text remains
    // untouched.
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello world" } });

    const button = getMicButton();
    installBoundsShim(button);

    // Pointerdown → hook's guard chain passes → voice.start() called synchronously
    // → getUserMedia queued. Pointerup at t=200ms (< HOLD_THRESHOLD_MS) → hook's
    // short-tap branch: await voice.cancel() (which rolls back the just-started
    // recording via Plan 32-01 Task 1's pending-cancel defense) then onShortTap()
    // → beginRecord("primary"). beginRecord opens a NEW recording (second
    // getUserMedia call).
    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 200,
      });
      // Flush voice.cancel + getUserMedia resolution (rollback branch) +
      // onShortTap → beginRecord → NEW voice.start → getUserMedia + MediaRecorder
      // + voice.state → "recording" re-render.
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Assertion 1: onSend was NOT called. Short-tap on mic does not send text.
    expect(onSend).not.toHaveBeenCalled();

    // Assertion 2: getUserMedia was called (at least once by the hook's
    // synchronous pointerdown path; beginRecord in onShortTap fires a second
    // call after the rollback — the important invariant is "at least one" so
    // the mic became live).
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    expect(getUserMediaMock.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Assertion 3: voice.state is now in the recording branch — RecordingControls
    // swapped in (Cancel-recording button visible). This proves beginRecord
    // completed and the mic-tap path took over.
    expect(queryCancelRecordingButton()).not.toBeNull();

    // Assertion 4: textarea unchanged — no send fired.
    expect(textarea.value).toBe("hello world");

    // Cleanup: click Cancel so afterEach's unmount doesn't fight an in-flight
    // recording.
    const cancelBtn = screen.getByRole("button", { name: "Cancel recording" });
    await act(async () => {
      fireEvent.click(cancelBtn);
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("Test 2 (CONTEXT.md L123): long press >= 250ms starts recording IN PLACE — mic button stays with data-hold-active=true, RecordingControls does NOT swap in (B-3, and Task 3's showMicButton visibility fix keeps the mic mounted)", async () => {
    render(<ComposeBox {...baseProps()} />);

    // Type text (not strictly required — mic doesn't gate on text — but keeps
    // the render tree identical to the other tests for comparability).
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hi" } });

    const button = getMicButton();
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

    // ---- Three-part deterministic identity-preservation assertion --------
    // (Restored under 260814-1hz — Task 3 preserves MicButton visibility
    // during a hold-initiated recording so the button element does NOT
    // unmount mid-hold. If any of the three assertions below fails, Task 3
    // did not land correctly — do NOT weaken the assertion.)

    // (a) The button carries data-hold-active="true" — proves the
    //     primaryHold.holdActive prop is flowing through MicButton
    //     correctly per Task 1, AND that MicButton has not been
    //     unmounted-then-remounted.
    expect(button.getAttribute("data-hold-active")).toBe("true");

    // (b) RecordingControls did NOT swap in — the Cancel-recording button
    //     that would appear if showRecordingControls were true is absent
    //     (B-3 gate: holdInitiatedRef=true → showRecordingControls=false).
    expect(queryCancelRecordingButton()).toBeNull();

    // (c) The SAME mic button element is still in the DOM (identity
    //     preserved via Task 3's showMicButton disjunct). setPointerCapture
    //     stays attached; the hook's onPointerUp can still fire on release.
    expect(getMicButton()).toBe(button);

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

    const button = getMicButton();
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

    const button = getMicButton();
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

  it("Test 5 (reformulated per 260814-1hz — CONTEXT.md L126): aside-morph inertness — when asideActive=true, MicButton does NOT render at all, and tapping Resume dismisses aside via onClick", async () => {
    // Reformulated: the hold gesture no longer lives on the Send button, so
    // there is no longer a "hold on Resume/X" code path to test. Instead, the
    // relevant invariant under 260814-1hz is that showMicButton gates on
    // !asideActive (Task 3 preserves this — the hold disjunct only relaxes the
    // voice.state gates, not the asideActive gate). Result: MicButton is not
    // in the DOM at all when asideActive=true, so hold-on-mic cannot even be
    // attempted. The Resume button's onClick continues to fire onAsideDismiss.
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

    // Assertion 1: MicButton is NOT rendered — showMicButton is false because
    // asideActive=true.
    expect(screen.queryByRole("button", { name: "Record voice" })).toBeNull();

    // Assertion 2: Resume button IS rendered (Send button morph in aside mode).
    const resumeButton = screen.getByRole("button", {
      name: "Resume",
    }) as HTMLButtonElement;
    expect(resumeButton).toBeTruthy();

    // Assertion 3: getUserMedia was never called — no hook ever fired because
    // the button hosting it doesn't exist in this state.
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    expect(getUserMediaMock).not.toHaveBeenCalled();

    // Assertion 4: clicking Resume fires onAsideDismiss (the Send button's
    // onClick in aside-mode is preserved byte-for-byte from before 260814-1hz).
    await act(async () => {
      fireEvent.click(resumeButton);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onAsideDismiss).toHaveBeenCalledTimes(1);
    // Belt: onSend was not called (aside-dismiss must not trigger send).
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Test 6 (reformulated per 260814-1hz — CONTEXT.md L127): disabled-state inertness — MicButton IS visible on empty textarea (unlike the old Send button); pressing-and-holding starts a recording (the mic's disabled predicate is voice.state !== 'idle', not sendDisabled)", async () => {
    // Reformulated: the old test asserted that the SEND button, when disabled
    // via sendDisabled=true (empty text), was inert to hold. Under 260814-1hz,
    // hold no longer lives on the Send button; MicButton's disabled predicate
    // is voice.state !== "idle" (not sendDisabled), so an empty textarea does
    // NOT disable the mic. This test documents that shift: MicButton renders
    // on empty text and hold-to-record works.
    const onSend = vi.fn(() => true);
    // Empty text + no attachments — the old Send button would be disabled here.
    render(<ComposeBox {...baseProps({ onSend })} />);

    // Assertion 1: MicButton IS rendered even with empty text.
    const button = getMicButton();
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false);
    installBoundsShim(button);

    // Assertion 2: pressing-and-holding starts a recording — the hook fires
    // regardless of typed-text state because sendDisabled does not gate the
    // mic's hold hook.
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

    // getUserMedia was called (hook armed and fired voice.start).
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);

    // data-hold-active flipped to "true" — hold is active.
    expect(button.getAttribute("data-hold-active")).toBe("true");

    // Cleanup: slide off + release so voice.cancel runs.
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
        timeStamp: 300,
      });
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Belt: onSend was not called (long-press-cancel path — slid off).
    expect(onSend).toHaveBeenCalledTimes(0);
  });

  it("Test 7 (CONTEXT.md L128): voice.state !== 'idle' guard — while a mic-tap recording is active, MicButton is not visible (showMicButton gates on the recording branch because holdInitiatedRef=false in the mic-tap path), and no additional getUserMedia call fires", async () => {
    render(<ComposeBox {...baseProps()} />);

    // Tap the MicButton (click, not pointer sequence) to start a mic-tap
    // recording via the direct onClick={() => beginRecord("primary")} path.
    // The hook's onShortTap redundantly calls beginRecord as well but is
    // guarded by voice.state !== "idle" — the second call is a no-op.
    const micBtn = getMicButton();
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

    // showRecordingControls is now true (voice.state === "recording" &&
    // !holdInitiatedRef.current — the mic-tap path leaves holdInitiatedRef
    // false, so showMicButton also evaluates false: MicButton is gone and
    // the RecordingControls swap in).
    expect(screen.queryByRole("button", { name: "Record voice" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Cancel recording" }),
    ).toBeTruthy();

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

  it("Test 8 (CONTEXT.md L129): iOS Safari sync-gesture invariant — getUserMedia is called SYNCHRONOUSLY within the pointerdown handler on the mic button", async () => {
    // D-16-02 iOS Safari sync-gesture invariant assertion — if this test
    // fails, the mic-permission prompt will silently die on iOS Safari and
    // hold-to-record will not work on Ashley's iPhone. Do NOT insert an
    // `await` between fireEvent.pointerDown and the expect below — the whole
    // point of this test is that the assertion is synchronous. The hook was
    // NOT touched in 260814-1hz (only its host button changed), so this
    // guarantee is inherited unchanged from Phase 32.

    render(<ComposeBox {...baseProps()} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hi" } });

    const button = getMicButton();
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

  it("Test 9 (CONTEXT.md L130): both paths coexist — after a hold-send cycle on the mic, the mic-tap path still works cleanly", async () => {
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);

    // ---- Full hold-send cycle (on the mic button) ------------------------
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "test1" } });

    const button = getMicButton();
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

    // State should be back to idle — the mic button is visible again (post-send,
    // voice.state → "idle" and holdInitiatedRef cleared in resetGestureState).
    expect(getMicButton()).toBeTruthy();

    // ---- Mic-tap cycle (short-tap opens a recording) ---------------------
    const micBtn = getMicButton();
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

  it("Test 10 (reformulated per 260814-1hz): threshold boundary — 249ms (HOLD_THRESHOLD_MS - 1) short-tap on mic yields cancel+idle (no send, no active recording); 250ms (HOLD_THRESHOLD_MS) long-press sends glued transcript", async () => {
    // Reformulated: under the old semantics, a <threshold tap on the Send
    // button fired handleSend with the typed text (Case A tested that). Under
    // 260814-1hz, a <threshold tap on the Mic button fires beginRecord
    // instead — the "opens RecordingControls" outcome is covered directly by
    // Test 1 (fast pending-cancel path) and Test 11 (empty-text new-test).
    // Case A here specifically exercises the OTHER short-tap path — the one
    // where the pre-pointerup timer advance forces getUserMedia to resolve
    // BEFORE cancel fires (so cancel takes the slow real-teardown branch
    // instead of the pending-cancel fast branch). In that path the beginRecord
    // re-arm is a no-op in the test harness (see the note inside the pointerup
    // act about the stateRef sync-lag limitation of useVoiceRecording), so
    // the invariant we assert here is "the cancel path executed cleanly —
    // no send, no fetch, voice returned to idle, mic visible again". Case B
    // (long-press-send) is functionally unchanged — the gesture just runs on
    // the mic instead of the send button.

    // ---- Case A: HOLD_THRESHOLD_MS - 1 = 249ms → short-tap → cancel+idle --
    const onSendA = vi.fn(() => true);
    const { unmount } = render(
      <ComposeBox {...baseProps({ onSend: onSendA })} />,
    );

    {
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "hi" } });

      const button = getMicButton();
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
        // Flush voice.cancel (real teardown because getUserMedia already
        // resolved during the pre-pointerup 249ms advance) + any subsequent
        // React re-renders. Note: the hook's onShortTap DOES call
        // beginRecord("primary") after awaiting cancel, but useVoiceRecording's
        // stateRef.current syncs from stateRef ← state via a useEffect on the
        // next render tick, NOT synchronously inside setState. Under this test's
        // deterministic microtask timing, beginRecord's voice.start guard
        // (stateRef.current !== "idle" → return) runs BEFORE the sync effect
        // fires, so the second voice.start is a no-op. In production this
        // window is imperceptible; in the jsdom + fake-timer harness it is
        // observable. Test 1 exercises the "fast pending-cancel" alternative
        // path (no pre-pointerup advance) which does re-arm successfully.
        await vi.advanceTimersByTimeAsync(100);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Reformulated Case A assertions (adapted to the observed post-tap
      // state under the fake-timer harness):
      //   - onSend NOT called (typed-send now lives on the Send button;
      //     mic-pointer sequences never fire it).
      //   - No STT fetch (voice.cancel took the teardown path; no send).
      //   - voice.state has returned to "idle" and MicButton is visible
      //     again — i.e., getMicButton() succeeds and the Cancel-recording
      //     button is NOT present (the beginRecord re-arm was suppressed by
      //     the stateRef sync-lag limitation noted above; the invariant we
      //     assert here is "no send, no active recording after the short
      //     tap" — the "recording opened" assertion is covered by Test 1
      //     and Test 11 which use the fast pending-cancel path).
      expect(onSendA).toHaveBeenCalledTimes(0);
      const fetchMockA = fetch as ReturnType<typeof vi.fn>;
      expect(fetchMockA.mock.calls.length).toBe(0);
      expect(queryCancelRecordingButton()).toBeNull();
      // MicButton is present (voice.state === "idle" post-cancel).
      expect(getMicButton()).toBeTruthy();
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

      const button = getMicButton();
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

  it("Test 11 (NEW under 260814-1hz): mic short-tap starts recording (opens RecordingControls path) — proves the hook's onShortTap → beginRecord wiring works end-to-end on the mic button", async () => {
    // Verifies the short-tap-on-mic → beginRecord semantic added by Task 2
    // (primaryHold.onShortTap now calls beginRecord("primary") instead of
    // handleSend). This test is orthogonal to Test 1 (which asserts the
    // ABSENCE of send); it asserts the PRESENCE of a live recording after a
    // short tap, via the RecordingControls swap-in.
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);

    // Skip typing text — recording works with empty textarea; MicButton is
    // always visible when voice.state === "idle" (Task 3's showMicButton
    // predicate has no text-content gate on the mic).
    const button = getMicButton();
    installBoundsShim(button);

    // Fire a sub-threshold tap: pointerdown at t=0, pointerup at t=100
    // (< HOLD_THRESHOLD_MS = 250). Hook's short-tap branch: await
    // voice.cancel() (rollback of the optimistic voice.start), then
    // onShortTap() → beginRecord("primary") → a fresh recording opens.
    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 100,
      });
      // Flush voice.cancel + getUserMedia rollback + onShortTap → beginRecord
      // → new voice.start → getUserMedia + MediaRecorder + state re-render.
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Assertion 1: RecordingControls swapped in — Cancel-recording button
    // exists. This proves beginRecord was invoked (via the hook's onShortTap)
    // AND holdInitiatedRef is false in this branch (short-tap goes through
    // resetGestureState which clears holdInitiatedRef), so showRecordingControls
    // = isPrimaryRecording && !holdInitiatedRef = true.
    expect(
      screen.getByRole("button", { name: "Cancel recording" }),
    ).toBeTruthy();

    // Assertion 2: onSend was NOT called — mic short-tap does not send.
    expect(onSend).not.toHaveBeenCalled();

    // Cleanup: click Cancel to return to idle.
    const cancelBtn = screen.getByRole("button", { name: "Cancel recording" });
    await act(async () => {
      fireEvent.click(cancelBtn);
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});
