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
 * keepRecordingOnShortTap (quick-260814-iwy) — optional prop that changes the
 * short-tap branch semantics for mic-button consumers:
 *   (a) Send-button default (omit prop or pass false): short-tap awaits
 *       voice.cancel() then fires onShortTap(). Byte-identical to the original
 *       B-1 / M-1 behavior — the just-started recording is rolled back and the
 *       caller dispatches the normal typed-send path. This preserves the
 *       D-16-02 / B-1 / B-3 contracts documented above verbatim.
 *   (b) Mic-button (pass keepRecordingOnShortTap: true + no-op onShortTap):
 *       short-tap calls voice.commitStartVisibility() (advances "starting" →
 *       "recording" and plays start.mp3), then fires onShortTap(). The
 *       pointerdown-started recording is PRESERVED — no cancel, no restart.
 *       resetGestureState() then clears holdInitiatedRef, which makes
 *       showRecordingControls (`isPrimaryRecording && !holdInitiatedRef`)
 *       evaluate true so RecordingControls swap in on the next render.
 *       commitStartVisibility is idempotent (no-op if state !== "starting"),
 *       so this call is safe even if the sync-gesture chain in pointerdown
 *       was short-circuited or getUserMedia auto-committed already.
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

/**
 * Bounds tolerance for the release-inside check (post-quick-260814-iwy iOS UAT
 * follow-up 2026-08-14). Real touch releases wobble a few px around the finger's
 * intended target; the strict getBoundingClientRect check treated 5-10px of
 * wobble the same as a deliberate slide-off gesture and routed valid long-press
 * sends to cancel. 40px is wide enough to swallow finger wobble but narrow enough
 * that an intentional slide-off (30-50px+ of motion) still reads as cancel.
 * Also motivates dropping the pointerLeave-driven `outOfBoundsRef` short-circuit —
 * iOS Safari fires `pointerleave` even under `setPointerCapture` on small
 * wobbles, and the strict "leave once = cancel" rule was too twitchy for the
 * design intent ("committed slide-off").
 */
export const BOUNDS_TOLERANCE_PX = 40;

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
  /**
   * When true, the short-tap branch calls voice.commitStartVisibility()
   * instead of voice.cancel() — used by mic-button consumers that want the
   * pointerdown-started recording to survive a sub-threshold tap. Defaults to
   * false (send-button behavior — awaited voice.cancel() then onShortTap()).
   * See the header docstring's "keepRecordingOnShortTap" paragraph for the
   * full semantic contract. Introduced by quick-260814-iwy to fix the iPhone
   * "first mic tap plays cancel.mp3 + requires double-tap" regression.
   */
  keepRecordingOnShortTap?: boolean;
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
  const { voice, onShortTap, onLongPressSend, asideActive, disabled, keepRecordingOnShortTap } = args;
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
   * Sync mirror of the holdCommitted useState, so pointerCancel can read the
   * committed-vs-window state without waiting for a re-render (2026-08-14 iOS
   * UAT follow-up — permission-prompt pointercancel that fires before the
   * 250ms threshold must NOT be treated as a hold-cancel).
   */
  const holdCommittedRef = useRef<boolean>(false);
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
    holdCommittedRef.current = false;
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
      holdCommittedRef.current = false;

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
        holdCommittedRef.current = true;
      }, effectiveThreshold);

      // Pointer capture — recommended in CONTEXT.md § "Claude's Discretion"
      // (L69). Simplifies slide-off tracking by ensuring the same element
      // receives pointerup regardless of where the pointer lands. jsdom does
      // not implement setPointerCapture, so wrap in try/catch for test safety.
      let captured = false;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
        captured = true;
      } catch {
        // jsdom or older browsers without pointer capture — bounds check in
        // pointerup still works via outOfBoundsRef + getBoundingClientRect.
      }

      // Forensic log: pair with pointerup/pointercancel logs by pointerId to
      // diagnose the intermittent stuck-glow / no-RecordingControls bug where
      // pointerdown fires but neither pointerup nor pointercancel does
      // (suspected iOS Safari swallowing pointerup on a button that flips to
      // disabled={voice.state !== "idle"} mid-gesture).
      console.info(
        "[hold-to-record] pointerdown started" +
          " pointerType=" + e.pointerType +
          " pointerId=" + e.pointerId +
          " captured=" + captured +
          " keepRecordingOnShortTap=" + (keepRecordingOnShortTap === true),
      );
    },
    [asideActive, disabled, voice, effectiveThreshold, keepRecordingOnShortTap],
  );

  const onPointerUp = useCallback(
    async (e: React.PointerEvent<HTMLButtonElement>): Promise<void> => {
      // Snapshot bounds before we mutate refs — the currentTarget will still be
      // valid at this synchronous point but we compute both facts up front.
      const elapsedMs = e.timeStamp - pointerDownAtRef.current;
      let withinBounds = true;
      try {
        const rect = e.currentTarget.getBoundingClientRect();
        const tol = BOUNDS_TOLERANCE_PX;
        withinBounds =
          e.clientX >= rect.left - tol &&
          e.clientX <= rect.right + tol &&
          e.clientY >= rect.top - tol &&
          e.clientY <= rect.bottom + tol;
      } catch {
        // Defensive: if getBoundingClientRect throws (shouldn't in practice),
        // treat as in-bounds so we don't accidentally cancel a valid send.
        withinBounds = true;
      }
      // 2026-08-14 iOS UAT follow-up: outOfBoundsRef is no longer consulted —
      // pointerleave fires spuriously under setPointerCapture on iOS Safari
      // even for small finger wobbles. The tolerance-widened rect check above
      // is the sole source of truth for release-inside. The ref is still SET
      // by onPointerLeave (kept for log-forensic purposes) but no longer
      // influences the branch decision.

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
      let branch: "short" | "short-keep" | "long-in" | "long-out" | "guarded";
      if (!startedRecordingRef.current) {
        // Guard-short-circuited pointerdown — nothing to unwind.
        branch = "guarded";
        // quick-260814-iwy: forensic log for next iOS UAT window. Emitted
        // BEFORE the early-return so branch=guarded still surfaces in the
        // console-forward stream.
        console.info(
          "[hold-to-record] pointerup branch=" + branch +
            " elapsedMs=" + elapsedMs +
            " withinBounds=" + withinBounds +
            " outOfBoundsRef=" + outOfBoundsRef.current +
            " startedRecording=" + startedRecordingRef.current,
        );
        resetGestureState();
        return;
      }

      const threshold = effectiveThreshold;
      if (elapsedMs < threshold) {
        if (keepRecordingOnShortTap === true) {
          // quick-260814-iwy short-tap-keep branch (mic-button opt-in):
          // preserve the pointerdown-started recording. commitStartVisibility
          // is SYNCHRONOUS and idempotent (no-op if state !== "starting"),
          // so if getUserMedia has already resolved and auto-committed, this
          // is a safe no-op. onShortTap is expected to be a no-op for mic
          // consumers — voice is already recording; no beginRecord needed.
          voice.commitStartVisibility();
          onShortTap();
          branch = "short-keep";
        } else {
          // Default short tap: roll back the just-started recording and
          // dispatch the normal typed-send. AWAIT cancel() so onShortTap
          // fires AFTER the teardown — deterministic ordering closes M-1.
          // If voice.state is still "idle" (getUserMedia hasn't resolved),
          // cancel() takes the pending-cancel branch from Plan 32-01 Task 1
          // which is synchronous and resolves immediately; awaiting is still
          // correct.
          await voice.cancel();
          onShortTap();
          branch = "short";
        }
      } else if (withinBounds) {
        // Long press released inside bounds — send. Consumer's onLongPressSend
        // is expected to invoke voice.endSend which stops the recorder
        // gracefully; do NOT call voice.cancel here.
        onLongPressSend();
        branch = "long-in";
      } else {
        // Long press released outside bounds — cancel. Fire-and-forget is fine
        // because in this branch voice.state === "recording", so cancel() runs
        // the fast teardown path (no ordering requirement with any callback
        // dispatched after).
        void voice.cancel();
        branch = "long-out";
      }

      // quick-260814-iwy: forensic log — emitted AFTER the branch executed,
      // BEFORE resetGestureState() runs. Snapshot semantics: elapsedMs and
      // withinBounds are locals computed at the top of the callback; the
      // Refs (outOfBoundsRef, startedRecordingRef) still hold pre-reset
      // values because resetGestureState has not run yet.
      console.info(
        "[hold-to-record] pointerup branch=" + branch +
          " elapsedMs=" + elapsedMs +
          " withinBounds=" + withinBounds +
          " outOfBoundsRef=" + outOfBoundsRef.current +
          " startedRecording=" + startedRecordingRef.current,
      );

      resetGestureState();
    },
    [voice, onShortTap, onLongPressSend, effectiveThreshold, resetGestureState, keepRecordingOnShortTap],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>): void => {
      // pointercancel arrives when the browser interrupts the gesture — either
      // a benign system-level pre-emption (iOS mic-permission prompt, callout
      // menu, magnifier) OR an actual user cancellation. We can't distinguish
      // directly, so we branch on whether the hold had crossed threshold:
      //
      //   Case A (short-tap window, holdCommittedRef === false) AND caller opted
      //   in via keepRecordingOnShortTap: this is almost certainly a benign
      //   interrupt on a mic-button tap (permission prompt on first-tap after
      //   page load being the canonical case — iOS shows the prompt mid-gesture
      //   and fires pointercancel to release the mic button). Cancelling here
      //   would strand the recording. Instead call voice.commitStartVisibility
      //   (idempotent no-op if state !== "starting", or arms pendingCommitRef
      //   for .then() to consume) so the recording continues into
      //   RecordingControls. Symmetric with pointerup short-tap-keep branch.
      //
      //   Case B (committed hold OR opt-out): pre-existing behavior — cancel.
      //
      // 2026-08-14 iOS UAT follow-up; before this branch every first-tap-with-
      // permission-prompt required a second tap to actually record.
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
        if (keepRecordingOnShortTap === true && !holdCommittedRef.current) {
          voice.commitStartVisibility();
        } else {
          void voice.cancel();
        }
      }
      // quick-260814-iwy: forensic log for iOS pointercancel diagnosis. Emitted
      // AFTER the cancel branch runs, BEFORE resetGestureState() mutates the
      // ref — so the logged startedRecording value reflects the pre-reset
      // gesture state. This is the critical log for Bug 1 (iOS callout /
      // magnifier firing pointercancel mid-hold); if the callout suppression
      // in MicButton is insufficient, this line surfaces in the console-forward
      // stream even when pointerup never fires.
      console.info(
        "[hold-to-record] pointercancel triggered startedRecording=" +
          startedRecordingRef.current,
      );
      resetGestureState();
    },
    [voice, resetGestureState, keepRecordingOnShortTap],
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
