/**
 * useHoldToRecord — press-and-hold gesture hook for the ComposeBox send button.
 *
 * Owns the pointer-event layer that distinguishes a SHORT tap (≥ 0ms, < 250ms —
 * fires the caller's onShortTap; the caller wires this to the normal typed-send
 * path) from a LONG press (≥ 250ms — commits to voice recording; on release
 * inside button bounds fires onLongPressSend, on release outside fires
 * voice.cancel()). Shape 1 from Phase 32 CONTEXT.md § "iOS Safari sync-gesture
 * invariant" (L59-64): optimistic start + rollback — voice.start() is called
 * SYNCHRONOUSLY in the pointerdown handler; if the release is early enough to
 * be a short tap, the just-started recording is rolled back via
 * `await voice.cancel()` before onShortTap dispatches.
 *
 * D-16-02 iOS Safari sync-gesture invariant chain:
 *   pointerdown (browser tap handler)
 *     → useHoldToRecord.onPointerDown
 *       → voice.start()                              (SYNC — first non-conditional
 *                                                    line after guards + one ref write)
 *         → navigator.mediaDevices.getUserMedia(...) (SYNC inside voice.start)
 * Any `await`, `setTimeout`, or promise-chain inserted between the pointerdown
 * event and getUserMedia queues a microtask that iOS Safari uses to reject the
 * call as non-user-gesture, silently killing the mic-permission prompt.
 * This hook enforces the invariant by construction: the ONLY statement between
 * the guard chain's `return`s and `voice.start()` is the synchronous
 * `holdInitiatedRef.current = true` ref write (not a setState, not a microtask).
 *
 * B-1 relationship (Plan 32-01 Task 1): the short-tap branch calls
 * `voice.cancel()` BEFORE voice.state has transitioned to "recording" (getUserMedia
 * has not yet resolved). Without the pendingCancelRef defensive fix in Task 1,
 * cancel() would be a no-op in that window and the mic would stay hot. This
 * hook is inseparable from Task 1's fix.
 *
 * B-3 relationship (Plan 32-02 consumer): `holdInitiatedRef` is exposed so the
 * consumer can gate `showRecordingControls` on `!holdInitiatedRef.current`.
 * During a hold-initiated recording, the RecordingControls (Cancel / Append /
 * Send) MUST NOT swap in under the pointer per CONTEXT.md § "Visual during
 * hold" — morphing the button the user is pressing makes the slide-off-to-
 * cancel gesture fuzzy. The ref is set true BEFORE voice.start() and stays
 * true across the voice.state re-render, so the predicate sees it as `true`
 * when the render fires and skips the swap.
 *
 * Consumer responsibilities NOT owned by this hook:
 *   - Wiring the button's native `onClick` for the aside-dismiss branch
 *     (`asideActive === true` — hook is inert in that case; the browser
 *     synthesizes onClick from any pointerdown/pointerup pair on the button,
 *     which the aside-dismiss handler consumes).
 *   - Rendering the visual tint (`data-hold-active` attribute driven from
 *     `holdActive`).
 *
 * Guards (short-circuit pointerdown before voice.start is ever called):
 *   - asideActive === true  (X-dismiss mode)
 *   - disabled === true      (sendDisabled / showTranscribingSend)
 *   - voice.state !== "idle" (would double-arm a prior mic-tap recording)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type {
  UseVoiceRecordingReturn,
  VoiceRecordingState,
} from "./useVoiceRecording";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hold threshold — pointer must remain down for at least this many milliseconds
 * for the release to be treated as a long-press-send. Below this: short tap.
 * LOCKED at 250ms per Phase 32 CONTEXT.md § "Threshold — LOCKED" (L44-45).
 */
export const HOLD_THRESHOLD_MS = 250;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Narrowed subset of useVoiceRecording's return that useHoldToRecord depends on.
 * The hook does NOT import useVoiceRecording directly — the consumer supplies
 * the singleton, keeping the two hooks decoupled (each testable in isolation).
 *
 * Includes commitStartVisibility so the 250ms threshold-timer callback can advance
 * state from "starting" → "recording" + play start.mp3 at the exact hold-commit moment.
 */
export type UseHoldToRecordVoice = Pick<
  UseVoiceRecordingReturn,
  "state" | "start" | "cancel" | "commitStartVisibility"
>;

export type UseHoldToRecordArgs = {
  /** Voice recording singleton — subset of useVoiceRecording()'s return. */
  voice: UseHoldToRecordVoice;
  /**
   * Called when pointerup fires BEFORE the hold threshold — the just-started
   * recording has already been rolled back via `await voice.cancel()`, and the
   * caller should now dispatch the normal typed-send path.
   */
  onShortTap: () => void;
  /**
   * Called when pointerup fires AT OR AFTER the hold threshold AND inside the
   * button's bounding rect. The caller is expected to invoke voice.endSend()
   * inside this handler (which stops the recorder, transcribes, and returns
   * the glued transcript for handleSend).
   */
  onLongPressSend: () => void;
  /**
   * When true the hook is fully inert (no voice.start, no state change). The
   * consumer preserves the button's native `onClick` for the X-dismiss branch.
   */
  asideActive: boolean;
  /** When true the hook is fully inert (sendDisabled / showTranscribingSend). */
  disabled: boolean;
  /** Override the hold threshold (test-only). Defaults to HOLD_THRESHOLD_MS. */
  thresholdMs?: number;
};

export type UseHoldToRecordReturn = {
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => Promise<void>;
  onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerLeave: (e: React.PointerEvent<HTMLButtonElement>) => void;
  /**
   * True while the pointer is down AND voice.start has been called AND
   * pointerup / pointercancel has not yet fired. Drives the button's
   * `data-hold-active` attribute.
   */
  holdActive: boolean;
  /**
   * True once the 250ms threshold has elapsed AND the pointer is still down
   * (i.e., the gesture has committed to a long-press). Independent of
   * holdActive so consumers can distinguish "started tint" from "committed
   * tint" if desired.
   */
  holdCommitted: boolean;
  /**
   * Ref that is `true` for the entire lifetime of a hold-initiated recording
   * (set BEFORE voice.start() in pointerdown, cleared in pointerup /
   * pointercancel). Consumers gate `showRecordingControls` on
   * `!holdInitiatedRef.current` per the B-3 fix so RecordingControls do NOT
   * swap in under the pointer while a hold recording is active. This is a ref
   * (not state) because reads happen during render and setting it must not
   * trigger a re-render.
   */
  holdInitiatedRef: React.MutableRefObject<boolean>;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useHoldToRecord(
  args: UseHoldToRecordArgs,
): UseHoldToRecordReturn {
  const { voice, onShortTap, onLongPressSend, asideActive, disabled } = args;
  const effectiveThreshold =
    typeof args.thresholdMs === "number" ? args.thresholdMs : HOLD_THRESHOLD_MS;

  // ---- Refs -------------------------------------------------------------

  /** e.timeStamp of the pointerdown that started the current gesture. */
  const pointerDownAtRef = useRef<number>(0);
  /**
   * True only if voice.start was actually called in this gesture (i.e., the
   * guard chain passed). pointerup consults this to decide whether to run its
   * branch or no-op.
   */
  const startedRecordingRef = useRef<boolean>(false);
  /** Handle for the 250ms setTimeout that flips holdCommitted → true. */
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set true by onPointerLeave so a subsequent pointerup routes to cancel. */
  const outOfBoundsRef = useRef<boolean>(false);
  /**
   * True from the moment voice.start is called (in pointerdown) until pointerup
   * / pointercancel clears it. Consumer reads this during render to gate
   * showRecordingControls (B-3 fix).
   */
  const holdInitiatedRef = useRef<boolean>(false);

  // ---- State ------------------------------------------------------------

  const [holdActive, setHoldActive] = useState<boolean>(false);
  const [holdCommitted, setHoldCommitted] = useState<boolean>(false);

  // ---- Effects ----------------------------------------------------------

  // Clean up any pending timer on unmount so we don't fire setState on an
  // unmounted component.
  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== null) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
    };
  }, []);

  // ---- Handlers ---------------------------------------------------------

  const resetGestureState = useCallback((): void => {
    setHoldActive(false);
    setHoldCommitted(false);
    startedRecordingRef.current = false;
    outOfBoundsRef.current = false;
    holdInitiatedRef.current = false;
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>): void => {
      // Guard chain — MUST come first. Any of these true → hook is fully inert.
      // asideActive: X-dismiss mode; short-tap-on-X goes through the button's
      //   native onClick, not this hook.
      // disabled: sendDisabled / showTranscribingSend — button is not interactive.
      // voice.state !== "idle": prior mic-tap already recording; would double-arm.
      if (asideActive || disabled || voice.state !== "idle") return;

      // B-3 ref write MUST come before voice.start() so a re-render triggered by
      // voice.state → "recording" (which happens asynchronously after
      // getUserMedia resolves) sees holdInitiatedRef=true and gates
      // showRecordingControls off. This is a synchronous JS assignment (not a
      // setState, not a microtask) so it does NOT break the D-16-02 iOS Safari
      // sync-gesture invariant.
      holdInitiatedRef.current = true;

      // D-16-02: voice.start() MUST be the first non-conditional statement
      // after guards + holdInitiatedRef write — iOS Safari getUserMedia
      // requires synchronous invocation inside the user-gesture handler.
      // holdInitiatedRef is a synchronous ref write and does not queue a
      // microtask.
      voice.start();

      // Post-start bookkeeping — order matters only relative to voice.start
      // (all lines below are safe post-invariant).
      startedRecordingRef.current = true;
      pointerDownAtRef.current = e.timeStamp;
      outOfBoundsRef.current = false;
      setHoldActive(true);
      setHoldCommitted(false);

      if (holdTimerRef.current !== null) {
        clearTimeout(holdTimerRef.current);
      }
      holdTimerRef.current = setTimeout(() => {
        // B-2 fix: commitStartVisibility() fires at the exact threshold instant,
        // advancing state "starting" → "recording" and playing start.mp3. This
        // ensures start.mp3 sounds ONLY when the hold gesture crosses 250ms —
        // not on every quick tap. Called BEFORE setHoldCommitted so the state
        // transition (and audio cue) precede the UI visual commit.
        voice.commitStartVisibility();
        setHoldCommitted(true);
      }, effectiveThreshold);

      // Pointer capture — recommended in CONTEXT.md § "Claude's Discretion"
      // (L69). Simplifies slide-off tracking by ensuring the same element
      // receives pointerup regardless of where the pointer lands. jsdom does
      // not implement setPointerCapture, so wrap in try/catch for test safety.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // jsdom or older browsers without pointer capture — bounds check in
        // pointerup still works via outOfBoundsRef + getBoundingClientRect.
      }
    },
    [asideActive, disabled, voice, effectiveThreshold],
  );

  const onPointerUp = useCallback(
    async (e: React.PointerEvent<HTMLButtonElement>): Promise<void> => {
      // Snapshot bounds before we mutate refs — the currentTarget will still be
      // valid at this synchronous point but we compute both facts up front.
      const elapsedMs = e.timeStamp - pointerDownAtRef.current;
      let withinBounds = true;
      try {
        const rect = e.currentTarget.getBoundingClientRect();
        withinBounds =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
      } catch {
        // Defensive: if getBoundingClientRect throws (shouldn't in practice),
        // treat as in-bounds so we don't accidentally cancel a valid send.
        withinBounds = true;
      }
      if (outOfBoundsRef.current) withinBounds = false;

      // Clear the hold-committed timer regardless of branch.
      if (holdTimerRef.current !== null) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }

      // Release pointer capture (paired with setPointerCapture in pointerdown).
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // jsdom or capture never installed — ignore.
      }

      // Branch on gesture outcome.
      if (!startedRecordingRef.current) {
        // Guard-short-circuited pointerdown — nothing to unwind.
        resetGestureState();
        return;
      }

      const threshold = effectiveThreshold;
      if (elapsedMs < threshold) {
        // Short tap: roll back the just-started recording and dispatch the
        // normal typed-send. AWAIT cancel() so onShortTap fires AFTER the
        // teardown — deterministic ordering closes M-1. If voice.state is
        // still "idle" (getUserMedia hasn't resolved), cancel() takes the
        // pending-cancel branch from Plan 32-01 Task 1 which is synchronous
        // and resolves immediately; awaiting is still correct.
        await voice.cancel();
        onShortTap();
      } else if (withinBounds) {
        // Long press released inside bounds — send. Consumer's onLongPressSend
        // is expected to invoke voice.endSend which stops the recorder
        // gracefully; do NOT call voice.cancel here.
        onLongPressSend();
      } else {
        // Long press released outside bounds — cancel. Fire-and-forget is fine
        // because in this branch voice.state === "recording", so cancel() runs
        // the fast teardown path (no ordering requirement with any callback
        // dispatched after).
        void voice.cancel();
      }

      resetGestureState();
    },
    [voice, onShortTap, onLongPressSend, effectiveThreshold, resetGestureState],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>): void => {
      // Same teardown as pointerup's "out of bounds" branch — pointercancel
      // arrives when the browser interrupts the gesture (e.g., touch canceled
      // by a system gesture); we treat it as a committed cancel.
      if (holdTimerRef.current !== null) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (startedRecordingRef.current) {
        void voice.cancel();
      }
      resetGestureState();
    },
    [voice, resetGestureState],
  );

  const onPointerLeave = useCallback(
    (_e: React.PointerEvent<HTMLButtonElement>): void => {
      // Mark slid-off; the actual cancel commits on pointerup (or pointercancel).
      // Matches CONTEXT.md L18: "once off, releasing anywhere is committed cancel".
      outOfBoundsRef.current = true;
    },
    [],
  );

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
    holdActive,
    holdCommitted,
    holdInitiatedRef,
  };
}

// Re-export VoiceRecordingState for consumers that want to type the voice.state
// field they pass in (avoids requiring an extra import from useVoiceRecording).
export type { VoiceRecordingState };
