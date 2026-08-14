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
//   - Primary mic button + slot mic button. Test 13 (added under
//     quick-260814-o22) covers the slot short-tap regression where the
//     missing setMicTarget in the JSX-seam wrapper caused RecordingControls
//     to swap in on the PRIMARY compose area instead of the tapped slot.
//     The hook itself is untested here — its unit tests cover the pointer
//     state machine.
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
  it("Test 1 (rewired per 260814-iwy): short tap on the mic under threshold OPENS a recording via commitStartVisibility (NOT via cancel+beginRecord) — onSend NOT called, voice.cancel NOT called, RecordingControls swap in", async () => {
    // quick-260814-iwy: rewired from the old "await cancel → beginRecord →
    // second getUserMedia" flow. Under keepRecordingOnShortTap:true on the
    // primary mic hook, the short-tap-keep branch preserves the
    // pointerdown-started recording via voice.commitStartVisibility() — no
    // cancel, no beginRecord, EXACTLY ONE getUserMedia call, EXACTLY ONE
    // MediaRecorder instance. Fixes the iPhone regression where the first
    // short-tap played cancel.mp3 and required a double-tap.
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
    // (D-16-02) → getUserMedia queued. Pointerup at t=200ms (< HOLD_THRESHOLD_MS)
    // → hook's short-tap-KEEP branch: voice.commitStartVisibility() (SYNC,
    // advances "starting" → "recording") → onShortTap() (no-op — voice is
    // already recording) → resetGestureState clears holdInitiatedRef →
    // showRecordingControls = isPrimaryRecording && !holdInitiatedRef flips
    // to true → RecordingControls (Cancel button) render.
    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });
    // Advance timers BEFORE pointerup so getUserMedia has a chance to resolve
    // and voice.state transitions to "starting" — this mirrors production
    // behavior where the user's hold takes long enough for the mic-permission
    // promise chain to complete before release. Without this, the test races
    // ahead of the microtask queue: pointerup fires while state is still
    // "idle" (getUserMedia unresolved), commitStartVisibility no-ops (state
    // guard), and RecordingControls never swap in. In the harness, walking
    // 200ms of fake time is enough for the mock getUserMedia promise chain
    // to complete because the mock resolves synchronously — the timer advance
    // just flushes the accumulated microtasks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 200,
      });
      // Flush the async pointerup handler + short-tap-keep branch's
      // commitStartVisibility state transition (starting → recording) +
      // React re-render.
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Assertion 1: onSend was NOT called. Short-tap on mic does not send text.
    expect(onSend).not.toHaveBeenCalled();

    // Assertion 2: getUserMedia was called EXACTLY ONCE — from the hook's
    // pointerdown voice.start() only. No cancel+beginRecord cycle means no
    // second getUserMedia call. Tightened from `>=1` under the pre-260814-iwy
    // semantic to a strict `===1` invariant.
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    expect(getUserMediaMock.mock.calls.length).toBe(1);

    // Assertion 2b (quick-260814-iwy): no STT fetch — short-tap that keeps
    // the recording alive does not fire /voice/transcribe. Send/cancel are
    // the only paths that fire STT.
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    // Assertion 2c (quick-260814-iwy): EXACTLY ONE MediaRecorder was
    // constructed. Belt-and-suspenders proof that the cancel+beginRecord
    // sequence did NOT run (that path would construct two recorders — one
    // torn down by cancel, one built by the beginRecord re-arm).
    expect(MockMediaRecorder.instances.length).toBe(1);

    // Assertion 3: voice.state is now in the recording branch — RecordingControls
    // swapped in (Cancel-recording button visible). This proves
    // commitStartVisibility completed the "starting" → "recording" transition
    // AND resetGestureState cleared holdInitiatedRef so showRecordingControls
    // evaluated true.
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

  it("Test 10 (rewired per 260814-iwy): threshold boundary — 249ms (HOLD_THRESHOLD_MS - 1) short-tap on mic KEEPS the recording alive via commitStartVisibility (no send, no fetch, RecordingControls swapped in); 250ms (HOLD_THRESHOLD_MS) long-press sends glued transcript", async () => {
    // quick-260814-iwy: Case A rewired. Under the new keepRecordingOnShortTap:
    // true semantic, a <threshold tap on the mic no longer runs voice.cancel
    // — it runs voice.commitStartVisibility, which advances the pointerdown-
    // started recording into the "recording" state. RecordingControls swap
    // in. The stateRef sync-lag limitation of useVoiceRecording (documented
    // in the pre-260814-iwy version of this test and in deferred-items.md)
    // is no longer relevant to this code path because no cancel-then-restart
    // race exists. Case B (long-press-send) is UNCHANGED — the long-press
    // branch is untouched by the short-tap-keep opt-in.

    // ---- Case A: HOLD_THRESHOLD_MS - 1 = 249ms → short-tap-KEEP → recording alive
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
        // Flush the hook's short-tap-keep branch (commitStartVisibility is
        // SYNC) + React re-renders + any post-render effects that transition
        // voice.state -> "recording" and swap in RecordingControls.
        await vi.advanceTimersByTimeAsync(100);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // quick-260814-iwy Case A assertions — "recording is ALIVE post-tap":
      //   - onSend NOT called (mic-pointer sequences never fire the typed-send
      //     path; typed-send lives on the Send button's plain onClick).
      //   - No STT fetch (short-tap keep does not fire /voice/transcribe;
      //     only send/cancel do).
      //   - Cancel-recording button IS present — RecordingControls swapped in
      //     because commitStartVisibility advanced state to "recording" AND
      //     resetGestureState cleared holdInitiatedRef, making
      //     showRecordingControls (isPrimaryRecording && !holdInitiatedRef)
      //     evaluate true.
      //   - MicButton is UNMOUNTED — showMicButton evaluated false because
      //     isPrimaryRecording is true AND holdInitiatedRef was cleared
      //     (neither disjunct saved it).
      expect(onSendA).toHaveBeenCalledTimes(0);
      const fetchMockA = fetch as ReturnType<typeof vi.fn>;
      expect(fetchMockA.mock.calls.length).toBe(0);
      expect(queryCancelRecordingButton()).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Record voice" })).toBeNull();

      // Explicit Cancel-recording cleanup before unmount — the recording is
      // ALIVE now, so the pre-260814-iwy pattern of assuming voice.state ===
      // "idle" post-tap no longer holds. Click Cancel + flush so unmount()
      // below doesn't fight an in-flight recording.
      const cancelBtnA = screen.getByRole("button", { name: "Cancel recording" });
      await act(async () => {
        fireEvent.click(cancelBtnA);
        await vi.advanceTimersByTimeAsync(50);
        await Promise.resolve();
        await Promise.resolve();
      });
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

  it("Test 11 (rewired per 260814-iwy): mic short-tap starts recording (opens RecordingControls path) via commitStartVisibility — proves the hook's keepRecordingOnShortTap:true wiring works end-to-end on the mic button", async () => {
    // quick-260814-iwy: rewired from the "await cancel → onShortTap →
    // beginRecord" flow to the new "commitStartVisibility (preserve
    // pointerdown-started recording) → onShortTap (no-op) → RecordingControls
    // swap in" flow. This test asserts the PRESENCE of a live recording
    // after a short tap, via the RecordingControls swap-in, AND that the
    // cancel+restart cycle did NOT run (exactly one getUserMedia call,
    // exactly one MediaRecorder instance, no STT fetch).
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);

    // Skip typing text — recording works with empty textarea; MicButton is
    // always visible when voice.state === "idle" (Task 3's showMicButton
    // predicate has no text-content gate on the mic).
    const button = getMicButton();
    installBoundsShim(button);

    // Fire a sub-threshold tap: pointerdown at t=0, pointerup at t=100
    // (< HOLD_THRESHOLD_MS = 250). Hook's short-tap-KEEP branch:
    // voice.commitStartVisibility() (SYNC, advances "starting" → "recording")
    // → onShortTap() (no-op — voice is already recording; no beginRecord)
    // → resetGestureState clears holdInitiatedRef → showRecordingControls
    // = isPrimaryRecording && !holdInitiatedRef = true → Cancel-recording
    // button renders.
    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });
    // Advance timers BEFORE pointerup so getUserMedia resolves and
    // voice.state transitions to "starting" — see Test 1 for the extended
    // rationale. Without this, the short-tap-keep branch's
    // commitStartVisibility runs against state="idle" and no-ops (idempotent
    // state guard in useVoiceRecording.ts), so state stays "idle" through
    // pointerup and RecordingControls never swap in.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 100,
      });
      // Flush the async pointerup handler + short-tap-keep branch's
      // commitStartVisibility state transition + React re-render.
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Assertion 1: RecordingControls swapped in — Cancel-recording button
    // exists. This proves commitStartVisibility completed the "starting" →
    // "recording" transition AND holdInitiatedRef is false in this branch
    // (short-tap-keep goes through resetGestureState which clears
    // holdInitiatedRef), so showRecordingControls = isPrimaryRecording &&
    // !holdInitiatedRef = true.
    expect(
      screen.getByRole("button", { name: "Cancel recording" }),
    ).toBeTruthy();

    // Assertion 2: onSend was NOT called — mic short-tap does not send.
    expect(onSend).not.toHaveBeenCalled();

    // Assertion 3 (quick-260814-iwy): getUserMedia was called EXACTLY ONCE —
    // no cancel+restart cycle. Tightened from `>=1` under the old semantic.
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    expect(getUserMediaMock.mock.calls.length).toBe(1);

    // Assertion 4 (quick-260814-iwy): EXACTLY ONE MediaRecorder — belt-and-
    // suspenders proof no cancel+beginRecord cycle ran (that path would
    // construct two recorders).
    expect(MockMediaRecorder.instances.length).toBe(1);

    // Assertion 5 (quick-260814-iwy): no STT fetch — short-tap keep does not
    // fire /voice/transcribe (only send/cancel do).
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    // Cleanup: click Cancel to return to idle.
    const cancelBtn = screen.getByRole("button", { name: "Cancel recording" });
    await act(async () => {
      fireEvent.click(cancelBtn);
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("Test 12 (NEW under 260814-iwy): MicButton className includes [-webkit-touch-callout:none] (iOS Safari callout suppression)", () => {
    // Static-attribute assertion — jsdom cannot verify the actual iOS Safari
    // callout suppression behavior, but this guards against a future edit
    // that strips the class without realizing it was there for iOS. The
    // class is applied via the cn() list in MicButton.tsx and is one of two
    // belt-and-suspenders defenses against iOS Safari long-press callout /
    // magnifier / quick-note firing pointercancel mid-hold (the other is the
    // preventDefault wrapper on onPointerDown — see Test 8 for the sync-
    // gesture invariant that preventDefault does NOT break).
    render(<ComposeBox {...baseProps()} />);
    const button = getMicButton();
    expect(button.className).toContain("[-webkit-touch-callout:none]");
  });

  it("Test 13 (NEW under 260814-o22): short-tap on a queue-slot mic swaps RecordingControls into the SLOT's data-slot-id container, NOT into the primary compose area", async () => {
    // quick-260814-o22: the bug. useHoldToRecord.onPointerDown calls
    // voice.start() synchronously (D-16-02) but does NOT set micTarget;
    // setMicTarget only ran inside beginRecord(target) — wired to MicButton's
    // onClick. MicButton's preventDefault-on-pointerdown (quick-260814-iwy,
    // load-bearing for iOS callout suppression) ALSO suppresses the
    // synthesized click on <button> in iOS Safari, so onClick never fires and
    // micTarget stays at its default "primary". Result: short-tapping a slot
    // mic on iPhone opened RecordingControls in the PRIMARY compose area.
    // The fix wraps each MicButton's onPointerDown to fire setMicTarget
    // synchronously BEFORE delegating to the hook. This test asserts the
    // slot short-tap correctly targets the slot's [data-slot-id] container.
    //
    // How this test catches the pre-fix bug: without the wrapper, the
    // "Cancel recording" button would render OUTSIDE the [data-slot-id]
    // container (in the primary area), so `cancelBtn.closest("[data-slot-id]")`
    // would return null and the containment assertion would fail. As a
    // corollary, the primary compose area would swap into RecordingControls,
    // hiding the "Send" button — so the "Send button still present" assertion
    // would also fail.
    const onSend = vi.fn(() => true);
    render(<ComposeBox {...baseProps({ onSend })} />);

    // Flush the compose-drafts draft-load useEffect (see ComposeBox.tsx L694)
    // BEFORE clicking Queue-a-message. The draft-load's async .then() calls
    // setQueueSlots(hydratedSlots) — if it lands AFTER our click, it clobbers
    // the just-added slot with [] (the mocked draft) and no slot renders.
    // Walking 50ms of fake time + a few microtasks lets the mocked
    // Promise.resolve() chain settle before we mutate queueSlots.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Add a queue slot via the "Queue a message" button (aria-label at
    // ComposeBox.tsx L2048).
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /queue a message/i }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Two mic buttons now render: one for the primary compose area and one
    // for the slot. The slot's mic is the one INSIDE a [data-slot-id]
    // container. Discriminate by DOM ancestry, not by ordering — ordering
    // is a footgun if the queued row is ever rearranged above/below the
    // primary.
    const allMics = screen.getAllByRole("button", { name: "Record voice" });
    const slotMic = allMics.find((el) => el.closest("[data-slot-id]") != null);
    if (!slotMic) throw new Error("expected a slot-scoped mic button");
    installBoundsShim(slotMic as HTMLElement);

    // Capture the slot's data-slot-id up front so we can assert containment
    // after RecordingControls swap in.
    const slotContainer = (slotMic as HTMLElement).closest(
      "[data-slot-id]",
    ) as HTMLElement;
    const slotId = slotContainer.getAttribute("data-slot-id");
    expect(slotId).toBeTruthy();

    // Baseline: primary send button IS present (proves the primary is not
    // in RecordingControls mode). Query by aria-label "Send".
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();

    // Short-tap the SLOT mic: pointerdown → 100ms → pointerup (< 250ms
    // HOLD_THRESHOLD_MS). Hook's short-tap-keep branch runs
    // voice.commitStartVisibility() (SYNC) → recording stays alive →
    // RecordingControls swap in on the SLOT (per quick-260814-o22 fix,
    // micTarget is now correctly set to slotId synchronously in the
    // pointerdown wrapper).
    fireEvent.pointerDown(slotMic, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });
    // Advance timers BEFORE pointerup so getUserMedia resolves + voice.state
    // transitions to "starting". Rationale mirrored from Test 1 L242-254.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => {
      fireEvent.pointerUp(slotMic, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 100,
      });
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Assertion 1 — THE regression assertion: RecordingControls's "Cancel
    // recording" button is INSIDE the slot's data-slot-id container.
    // Pre-fix (missing setMicTarget in the pointerdown wrapper) this Cancel
    // button would render outside the slot (in the primary area) because
    // micTarget stayed at its default "primary" and showRecordingControls
    // fired on the primary.
    const cancelBtn = screen.getByRole("button", { name: "Cancel recording" });
    const cancelParentSlot = cancelBtn.closest("[data-slot-id]");
    expect(cancelParentSlot).not.toBeNull();
    expect(cancelParentSlot?.getAttribute("data-slot-id")).toBe(slotId);

    // Assertion 2 — Corollary: primary send button is STILL present. Proves
    // the primary compose area did NOT swap into RecordingControls. Under
    // the bug this assertion would fail because showRecordingControls on the
    // primary would replace the send button with RecordingControls.
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();

    // Assertion 3 — Exactly one getUserMedia call (no double-arm, no
    // cancel+restart). Matches Test 1's tightened invariant under
    // quick-260814-iwy semantics.
    const getUserMediaMock = navigator.mediaDevices.getUserMedia as ReturnType<
      typeof vi.fn
    >;
    expect(getUserMediaMock.mock.calls.length).toBe(1);

    // Assertion 4 — Exactly one MediaRecorder constructed (belt-and-suspenders
    // for Assertion 3).
    expect(MockMediaRecorder.instances.length).toBe(1);

    // Assertion 5 — No STT fetch (short-tap-keep does not transcribe; only
    // send/cancel do). Matches Test 1's fetch invariant.
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    // Cleanup — click the slot's Cancel-recording button so afterEach's
    // unmount doesn't fight an in-flight recording. Mirrors Test 1's cleanup
    // pattern at L306-313.
    await act(async () => {
      fireEvent.click(cancelBtn);
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Belt: onSend was never called (mic pointer sequences never fire the
    // typed-send path on either surface).
    expect(onSend).not.toHaveBeenCalled();
  });
});
