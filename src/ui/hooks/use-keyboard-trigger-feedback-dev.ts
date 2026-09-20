// ─── use-keyboard-trigger-feedback-dev (Phase 121 Plan 04 Task 2) ────────────
// Dev-only keyboard chord hook that opens the FeedbackModal without any
// user-facing trigger. Shape 1 of the user-feedback campaign deliberately
// ships zero user-visible triggers — Shape 2 (general button) and Shape 3
// (message thumbs) land those. This hook exists solely so the operator can
// exercise the pipeline end-to-end in dev builds during Shape 1 verification.
//
// Chord bindings (D-31 + RESEARCH A4):
//   Ctrl+Alt+F → openFeedback("general")
//   Ctrl+Alt+T → openFeedback("thumbs_down")
//
// Ctrl+Alt (NOT Ctrl+Shift) is chosen per RESEARCH A4: Ctrl+Shift+F collides
// with Firefox's built-in "find in all tabs" find-bar UI; Ctrl+Alt is free
// across Chrome, Firefox, and Safari for this letter pair.
//
// T-121-18 (Elevation of Privilege) mitigation:
//   The `if (!import.meta.env.DEV) return;` gate is the FIRST statement inside
//   useEffect. Vite tree-shakes this branch out of production bundles — the
//   entire chord-binding branch below the gate NEVER runs in prod. Real users
//   have no keyboard path to open the feedback modal in Shape 1.
//
// Structural mirror of src/ui/hooks/use-keyboard-toggle-pretty-mode.ts:
//   - useRef pattern to keep the callback fresh without re-binding the DOM
//     listener on every render.
//   - `addEventListener("keydown", onKeyDown, true)` — CAPTURE phase, ensures
//     the chord fires even if a focused element would otherwise consume it.
//   - Chord modifier discipline: REJECT if any wrong modifier is present.
//     Guards against overlapping Ctrl+Alt+Shift+F or Cmd+Ctrl+Alt+F chords
//     bound elsewhere.

import { useEffect, useRef } from "react";

export function useKeyboardTriggerFeedbackDev(
  openFeedback: (variant: "general" | "thumbs_down") => void,
): void {
  // Ref-freshness pattern: preserve the callback identity across re-renders
  // without needing to re-bind the DOM listener. Matches pretty-mode L9-14.
  const openRef = useRef(openFeedback);
  openRef.current = openFeedback;

  useEffect(() => {
    // D-31 dev-only gate — Vite's `import.meta.env.DEV` is `true` in `vite
    // dev` and `false` in `vite build` (production). This branch is the FIRST
    // statement so the entire rest of the effect (chord binding, event
    // listener, cleanup registration) is dead code under prod, and Vite's
    // tree-shaker drops it from the production bundle. T-121-18 mitigation.
    if (!import.meta.env.DEV) return;

    const onKeyDown = (e: KeyboardEvent): void => {
      // Chord discipline: require Ctrl+Alt, forbid Shift and Meta. Matches
      // pretty-mode L39 pattern (reject-if-wrong-modifier). RESEARCH A4:
      // Ctrl+Alt over Ctrl+Shift to avoid Firefox find-bar collision.
      if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;

      if (e.code === "KeyF") {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        openRef.current("general");
        return;
      }
      if (e.code === "KeyT") {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        openRef.current("thumbs_down");
        return;
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
