// Tests for useHoldToRecord — the press-and-hold gesture hook wrapping
// useVoiceRecording for the ComposeBox send button.
//
// Test strategy:
//   - Test-consumer component pattern: a small functional component binds the
//     hook's returned handlers to a real <button data-testid="hold-btn"> and
//     reads holdActive / holdInitiatedRef into DOM data-* attributes so tests
//     can observe them without renderHook.
//   - fireEvent.pointerDown / pointerUp / pointerCancel / pointerLeave drive
//     the hook through the real React synthetic-event flow.
//   - installBoundsShim installs a getBoundingClientRect override on the button
//     because jsdom returns a zero-width rect by default and the hook's bounds
//     check needs a real rect for the release-inside-vs-outside branch.
//   - vi.useFakeTimers({ shouldAdvanceTime: false }) so the 250ms threshold
//     boundary can be walked deterministically.
//   - Voice mock: a Pick<UseVoiceRecordingReturn, "state" | "start" | "cancel">
//     object with vi.fn() spies. `cancel` returns a resolved promise by default;
//     Test 5 overrides it with a controllable promise to prove the awaited
//     ordering of the short-tap-rollback branch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import {
  useHoldToRecord,
  HOLD_THRESHOLD_MS,
  type UseHoldToRecordArgs,
} from "./useHoldToRecord";
import type {
  VoiceRecordingState,
  UseVoiceRecordingReturn,
} from "./useVoiceRecording";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Narrowed voice mock — matches Pick<UseVoiceRecordingReturn, "state"|"start"|"cancel">. */
function makeMockVoice(
  state: VoiceRecordingState = "idle",
): Pick<UseVoiceRecordingReturn, "state" | "start" | "cancel"> {
  return {
    state,
    start: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
}

/** Build UseHoldToRecordArgs with sensible defaults + per-test overrides. */
function makeArgs(
  overrides?: Partial<UseHoldToRecordArgs>,
): UseHoldToRecordArgs {
  const base: UseHoldToRecordArgs = {
    voice: makeMockVoice(),
    onShortTap: vi.fn(),
    onLongPressSend: vi.fn(),
    asideActive: false,
    disabled: false,
  };
  return { ...base, ...(overrides ?? {}) };
}

/**
 * Install a fixed getBoundingClientRect on a button so the hook's bounds check
 * has a real rect to consult. jsdom returns a zero-width rect by default,
 * which would make every pointerup with clientX/Y != 0 register as "outside".
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
 * Test-consumer component — binds the hook's handlers to a button so tests
 * can drive real pointer events through React's synthetic-event system.
 * Reads holdActive and holdInitiatedRef.current into data-* attributes so
 * DOM assertions can observe them. Note: data-hold-initiated reads a ref, so
 * the attribute reflects the ref value at render time only.
 */
function TestConsumer({ args }: { args: UseHoldToRecordArgs }): JSX.Element {
  const handlers = useHoldToRecord(args);
  return (
    <button
      data-testid="hold-btn"
      onPointerDown={handlers.onPointerDown}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
      onPointerLeave={handlers.onPointerLeave}
      data-hold-active={handlers.holdActive ? "true" : "false"}
      data-hold-committed={handlers.holdCommitted ? "true" : "false"}
      data-hold-initiated={handlers.holdInitiatedRef.current ? "true" : "false"}
    >
      Send
    </button>
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Fake timers so the 250ms threshold can be walked deterministically. Use
  // { shouldAdvanceTime: false } so timers do not silently tick during
  // synchronous test setup — every advance is explicit via advanceTimersByTime.
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useHoldToRecord", () => {
  it("Test 1: guard — asideActive=true short-circuits pointerdown, voice.start NOT called", () => {
    const args = makeArgs({ asideActive: true });
    render(<TestConsumer args={args} />);
    const button = screen.getByTestId("hold-btn");
    installBoundsShim(button);

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 20, clientY: 20 });

    expect((args.voice.start as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(button.getAttribute("data-hold-active")).toBe("false");
    expect(button.getAttribute("data-hold-initiated")).toBe("false");
  });

  it("Test 2: guard — disabled=true short-circuits pointerdown, voice.start NOT called", () => {
    const args = makeArgs({ disabled: true });
    render(<TestConsumer args={args} />);
    const button = screen.getByTestId("hold-btn");
    installBoundsShim(button);

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 20, clientY: 20 });

    expect((args.voice.start as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(button.getAttribute("data-hold-active")).toBe("false");
  });

  it("Test 3: guard — voice.state !== 'idle' short-circuits pointerdown, voice.start NOT called", () => {
    const args = makeArgs({ voice: makeMockVoice("recording") });
    render(<TestConsumer args={args} />);
    const button = screen.getByTestId("hold-btn");
    installBoundsShim(button);

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 20, clientY: 20 });

    // Would double-arm the mic if not guarded.
    expect((args.voice.start as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(button.getAttribute("data-hold-active")).toBe("false");
  });

  it("Test 4: iOS Safari sync-gesture invariant — voice.start is called synchronously within the pointerdown handler", () => {
    // Load-bearing invariant: voice.start MUST be called synchronously in the
    // same tick as the pointerdown handler — no await, no microtask, no timer
    // advance between fireEvent.pointerDown and the assertion. If any await
    // sneaked in before voice.start, this assertion would fail because the
    // call would be queued to a later microtask/task.
    const args = makeArgs();
    render(<TestConsumer args={args} />);
    const button = screen.getByTestId("hold-btn");
    installBoundsShim(button);

    // Snapshot: no calls before pointerdown.
    expect((args.voice.start as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 20, clientY: 20 });

    // Synchronous assertion — NO await, NO timer advance, NO waitFor between
    // fireEvent and this expect. This is the D-16-02 invariant guarantee.
    expect((args.voice.start as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("Test 5: short tap (elapsed < 250ms) awaits rollback then fires onShortTap", async () => {
    // Controllable cancel so we can observe that onShortTap fires ONLY AFTER
    // cancel resolves. This proves the M-1 fix: the short-tap-rollback branch
    // awaits voice.cancel() before dispatching onShortTap.
    let resolveCancel: () => void = () => {};
    const cancelSpy = vi.fn().mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveCancel = r;
        }),
    );
    const voice: Pick<UseVoiceRecordingReturn, "state" | "start" | "cancel"> = {
      state: "idle",
      start: vi.fn(),
      cancel: cancelSpy,
    };
    const args = makeArgs({ voice });
    render(<TestConsumer args={args} />);
    const button = screen.getByTestId("hold-btn");
    installBoundsShim(button);

    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });
    // Advance past the threshold check window but stay well BELOW 250ms.
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.pointerUp(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 200,
    });

    // Synchronous checks immediately after pointerUp: voice.start called (1x),
    // voice.cancel called (1x, kicked off the rollback), but onShortTap has
    // NOT yet fired because the branch is awaiting cancel's promise.
    expect((voice.start as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(cancelSpy.mock.calls.length).toBe(1);
    expect((args.onShortTap as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect((args.onLongPressSend as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    // Resolve the cancel promise; the awaited pointerup handler unwinds and
    // dispatches onShortTap.
    await act(async () => {
      resolveCancel();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((args.onShortTap as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((args.onLongPressSend as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("Test 6: long press release inside bounds fires onLongPressSend, voice.cancel NOT called", async () => {
    const args = makeArgs();
    render(<TestConsumer args={args} />);
    const button = screen.getByTestId("hold-btn");
    installBoundsShim(button);

    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });
    act(() => { vi.advanceTimersByTime(300); });
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 300,
      });
      // Flush the async pointerup handler — even without a controlled promise,
      // the branch is inside an async function.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((args.voice.start as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((args.onLongPressSend as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((args.voice.cancel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect((args.onShortTap as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("Test 7: long press slide-off then release fires voice.cancel, onLongPressSend NOT called", async () => {
    const args = makeArgs();
    render(<TestConsumer args={args} />);
    const button = screen.getByTestId("hold-btn");
    installBoundsShim(button);

    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });
    act(() => { vi.advanceTimersByTime(300); });
    // Slide off — pointerleave marks outOfBoundsRef=true.
    fireEvent.pointerLeave(button, { pointerId: 1, clientX: 200, clientY: 200 });
    // Release outside the shimmed rect (right=40, bottom=40) — clientX/Y at 200.
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 200,
        clientY: 200,
        timeStamp: 300,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((args.voice.start as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((args.voice.cancel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((args.onLongPressSend as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect((args.onShortTap as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("Test 8: holdActive lifecycle — false → true after guarded-pass pointerdown → false after pointerup", async () => {
    const args = makeArgs();
    render(<TestConsumer args={args} />);
    const button = screen.getByTestId("hold-btn");
    installBoundsShim(button);

    // Before any pointer event: false.
    expect(button.getAttribute("data-hold-active")).toBe("false");

    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 0,
    });

    // After pointerdown (guards passed): true.
    expect(button.getAttribute("data-hold-active")).toBe("true");

    act(() => { vi.advanceTimersByTime(300); });
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 300,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // After pointerup: false.
    expect(button.getAttribute("data-hold-active")).toBe("false");
  });

  it("Test 9: threshold boundary — 249ms is short-tap, 250ms is long-press", async () => {
    // Case A: 249ms — strictly less than threshold → short-tap branch.
    {
      const args = makeArgs();
      const { unmount } = render(<TestConsumer args={args} />);
      const button = screen.getByTestId("hold-btn");
      installBoundsShim(button);

      fireEvent.pointerDown(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 0,
      });
      act(() => { vi.advanceTimersByTime(249); });
      await act(async () => {
        fireEvent.pointerUp(button, {
          pointerId: 1,
          clientX: 20,
          clientY: 20,
          timeStamp: 249,
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect((args.onShortTap as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
      expect((args.onLongPressSend as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
      expect((args.voice.cancel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
      unmount();
    }

    // Case B: exactly HOLD_THRESHOLD_MS (250) — equal to threshold →
    // long-press branch. The hook's boundary is `<` for short-tap, `>=` for
    // long-press. Uses the exported constant rather than the literal 250 so
    // this test tracks the threshold if it ever moves.
    {
      const args = makeArgs();
      render(<TestConsumer args={args} />);
      const button = screen.getByTestId("hold-btn");
      installBoundsShim(button);

      fireEvent.pointerDown(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 0,
      });
      act(() => { vi.advanceTimersByTime(HOLD_THRESHOLD_MS); });
      await act(async () => {
        fireEvent.pointerUp(button, {
          pointerId: 1,
          clientX: 20,
          clientY: 20,
          timeStamp: HOLD_THRESHOLD_MS,
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect((args.onLongPressSend as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
      expect((args.onShortTap as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
      expect((args.voice.cancel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    }
  });

  it("Test 10: pointerdown when guards passed but pointerup fires immediately (elapsed=0) → short-tap branch", async () => {
    // Guards against an off-by-one where elapsed=0 was accidentally categorized
    // as long-press (would require `<=` for short-tap, which we do NOT use —
    // the hook uses `<` so elapsed=0 stays in the short-tap branch).
    const args = makeArgs();
    render(<TestConsumer args={args} />);
    const button = screen.getByTestId("hold-btn");
    installBoundsShim(button);

    fireEvent.pointerDown(button, {
      pointerId: 1,
      clientX: 20,
      clientY: 20,
      timeStamp: 100,
    });
    // Same timeStamp → elapsed = 0.
    await act(async () => {
      fireEvent.pointerUp(button, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
        timeStamp: 100,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((args.voice.start as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((args.voice.cancel as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((args.onShortTap as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((args.onLongPressSend as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
