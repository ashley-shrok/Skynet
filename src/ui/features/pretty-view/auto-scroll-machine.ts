// phase-70: pure auto-scroll reducer — two-state position-derived state machine LOCKED
/**
 * Pure two-state auto-scroll reducer — the deterministic core of the Phase 70
 * rewrite of PrettyView's auto-scroll layer.
 *
 * SHAPE-FILE CROSS-REFERENCE (LOCKED):
 *   `.planning/shapes/shape-pv-autoscroll-rewrite.md` § Shape, § Philosophy,
 *   § What would make it wrong — all decisions are locked from that file.
 *   Do not change the two-state model, the transition rules, or the
 *   exhaustiveness sentinel without updating the shape file first.
 *
 * TRUTH TABLE (LOCKED per shape file § Shape):
 *
 *   mode           | event.kind        | distanceFromBottom  | → next.mode      | effect
 *   ---------------|-------------------|---------------------|------------------|--------
 *   at-bottom      | user-input        | > tolerance         | not-at-bottom    | none   ← OUT transition; ONLY user-input can trigger it
 *   at-bottom      | user-input        | ≤ tolerance         | at-bottom        | none
 *   at-bottom      | content-changed   | (any)               | at-bottom        | chase  ← symmetric event
 *   at-bottom      | container-resized | (any)               | at-bottom        | chase  ← symmetric event
 *   at-bottom      | measured          | (any)               | at-bottom        | chase  ← symmetric event (unless mount-landing — see below)
 *   at-bottom      | jump-clicked      | (any)               | at-bottom        | chase  ← already at bottom, chase guarantees position
 *   at-bottom      | send-fired        | (any)               | at-bottom        | chase  ← already at bottom, chase guarantees position
 *   not-at-bottom  | user-input        | ≤ tolerance         | at-bottom        | chase  ← IN transition via scrolling back to bottom
 *   not-at-bottom  | user-input        | > tolerance         | not-at-bottom    | none
 *   not-at-bottom  | content-changed   | (any)               | not-at-bottom    | none   ← LOAD-BEARING: no yank when scrolled up
 *   not-at-bottom  | container-resized | (any)               | not-at-bottom    | none   ← LOAD-BEARING: no yank when scrolled up
 *   not-at-bottom  | measured          | (any)               | not-at-bottom    | none   ← LOAD-BEARING: no yank when scrolled up
 *   not-at-bottom  | jump-clicked      | (any)               | at-bottom        | chase
 *   not-at-bottom  | send-fired        | (any)               | at-bottom        | chase  ← send flips regardless of prior state
 *
 *   MOUNT-LANDING OVERRIDE:
 *   hasLandedOnce=false + mode=at-bottom + {kind:"measured", contentHeight > 0}
 *     → { next: {...state, hasLandedOnce: true}, effect: "reveal" }
 *   (hides flash-at-top on first paint — see hide-pin-reveal pattern description)
 *
 * NO I/O IMPORTS — pure function only. No React imports, no DOM imports,
 * no logger imports, no timer scheduling, no wall-clock reads.
 * Enforced by the acceptance structural-grep gate:
 *   grep -v '^#' src/ui/features/pretty-view/auto-scroll-machine.ts | grep -c '^import ' → 0
 * This is what makes the state-transition unit tests in
 * auto-scroll-machine.test.ts cheap to set up (import + call — no mocks,
 * no timers, no DOM harness, no renderHook). Pattern copied verbatim from
 * src/ui/features/pretty-view/resolve-phase.ts and (upstream)
 * src/backend/claude-session/layer1-detect.ts.
 */

// ── Mode union (two-state model — LOCKED) ────────────────────────────────────
//
// The two-state model is LOCKED — shape file § Shape para 1: any third state
// is contamination per § What would make it wrong bullet 6 and § Scope edges
// Tempting-but-no bullet 2 ("Adding a distinct sending/loading state ... is
// contamination").

/**
 * The scroll surface is always in one of two modes. Derived from position
 * relative to the bottom of the scroll container.
 *
 * "at-bottom"     — chasing the bottom; any event that could move the bottom
 *                   triggers an immediate scroll write ("chase").
 * "not-at-bottom" — frozen where the user left it; bottom-moving events are
 *                   IGNORED (the LOAD-BEARING "no yank when scrolled up" rule).
 */
export type Mode = "at-bottom" | "not-at-bottom";

// ── AutoScrollEvent discriminated union ──────────────────────────────────────
//
// Six variants only — per shape file § Shape "Symmetric event handling."
// Every event that could move the bottom is treated UNIFORMLY per mode:
// "message added", "accessory disappeared", "window resized" are all the same
// conceptual event class — something changed that could have moved the bottom.

/**
 * All events the auto-scroll state machine can receive. The discriminated
 * union enforces exhaustiveness at compile time via the `_exhaust: never`
 * sentinel in `reduce()` — adding a variant without a matching switch branch
 * fails `npx tsc --noEmit` immediately.
 *
 * NOTE: Chase writes (the "chase" effect) are intentionally NOT represented
 * as events in this union. Chase writes happen as side-effects of
 * `effect: "chase"` being returned by `reduce()`; by construction they cannot
 * loop back into `reduce()`. This is the "if any programmatic scroll write
 * can transition mode, the recursive-bug pattern the current code trips on is
 * back" invariant from shape file § What would make it wrong bullet 2 — made
 * structurally impossible by having no write-feedback variant in this union.
 */
export type AutoScrollEvent =
  | {
      kind: "measured"; // initial mount + content-height observer poll
      distanceFromBottom: number;
      contentHeight: number;
    }
  | { kind: "content-changed" } // MutationObserver on scroll-container children
  | { kind: "container-resized" } // ResizeObserver on scroll container
  | {
      kind: "user-input"; // scroll listener + isTouch from useIsTouchDevice()
      distanceFromBottom: number;
      isTouch: boolean;
    }
  | { kind: "jump-clicked" } // jump-to-bottom pill onClick
  | { kind: "send-fired" }; // handleComposeSend

// ── AutoScrollEffect union ────────────────────────────────────────────────────

/**
 * Effect returned by `reduce()` instructing the hook wrapper what to do after
 * every state transition.
 *
 * "chase"  — write scrollTop to the bottom of the container (instant, not
 *            smooth-scroll; coalesced one-write-per-rAF by the hook wrapper).
 * "reveal" — flip the scroll surface from hidden to visible (the terminal step
 *            of the mount-landing hide-pin-reveal sequence; a chase to bottom
 *            is expected to have occurred just before, via content-changed).
 * "none"   — no scroll write; no visibility change.
 */
export type AutoScrollEffect = "chase" | "reveal" | "none";

// ── AutoScrollState ───────────────────────────────────────────────────────────

/**
 * The full state the reducer reads and returns. Immutable — `reduce()` always
 * returns a new object; it never mutates `state` in place.
 */
export type AutoScrollState = {
  mode: Mode;
  /** True after the first `measured` event with non-zero contentHeight. Once
   * flipped, it stays true for the lifetime of the session. */
  hasLandedOnce: boolean;
  /** The most recently observed distanceFromBottom (for diagnostics in the
   * hook wrapper — pure store, not used in transition logic directly). */
  lastMeasuredDistance: number;
};

// ── Constants (LOCKED per shape file § Shape para 1) ─────────────────────────

/**
 * Distance from the bottom (in CSS pixels) within which the scroll surface
 * is considered "at bottom." Roughly one line of body text.
 *
 * LOCKED at 28px per shape file § Shape para 1: "roughly one line of body
 * text, ~24-32px, pick center." Do not adjust without updating the shape file.
 */
export const BOTTOM_TOLERANCE_PX = 28;

/**
 * Additional slack added to `BOTTOM_TOLERANCE_PX` on touch devices.
 *
 * LOCKED per shape file § Prior context "iOS touch-momentum overshoot" pitfall
 * and § Shape para 1 "additional slack on touch devices." iOS momentum scroll
 * can produce a brief rubber-band overshoot that reads as a real out-of-bottom
 * position; the extra slack absorbs it without triggering a false mode-out
 * transition. Only applied when `isTouch === true` on a `user-input` event.
 */
export const BOTTOM_TOLERANCE_TOUCH_EXTRA_PX = 32;

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Returns the initial AutoScrollState for a fresh session mount.
 *
 * Initial mode is "at-bottom" because the first mount lands at bottom via
 * the hook's hide-pin-reveal: the surface is hidden, content mounts, the
 * first `measured` event with non-zero contentHeight fires `effect: "reveal"`,
 * and the chase to bottom was already live during the hidden phase. The user
 * lands at the bottom with no flash.
 */
export function createInitialState(): AutoScrollState {
  return {
    mode: "at-bottom",
    hasLandedOnce: false,
    lastMeasuredDistance: 0,
  };
}

// ── Pure reducer (LOCKED truth table — Phase 70) ─────────────────────────────

/**
 * Map (AutoScrollState × AutoScrollEvent) → { next: AutoScrollState; effect: AutoScrollEffect }
 * per the LOCKED Phase-70 truth table in the file header above. Pure function —
 * no side effects, no I/O, no wall-clock logic. Always returns a NEW `next`
 * object (never returns `state` unchanged) so referential-equality-based
 * memoization downstream is not accidentally load-bearing.
 *
 * BRANCH ORDER (LOCKED — matches truth table rows top-to-bottom):
 *
 *   (a) Mount-landing override — the hide-pin-reveal gate. Fires ONLY when
 *       hasLandedOnce is false, mode is at-bottom, and a measured event with
 *       non-zero contentHeight arrives. Returns effect:"reveal" and flips
 *       hasLandedOnce. Checked before the main mode switch because it is a
 *       special case of the "at-bottom + measured → chase" row that instead
 *       returns "reveal" to trigger the visibility flip.
 *   (b) at-bottom mode branches — user-input (OUT or stay), symmetric events
 *       (chase), jump-clicked and send-fired (chase with no mode change).
 *   (c) not-at-bottom mode branches — jump-clicked and send-fired (IN),
 *       user-input (IN or stay), symmetric events (none — LOAD-BEARING).
 *
 * The compile-time exhaustiveness sentinel below (`_exhaust: never`) on the
 * event.kind switch ensures that adding a new AutoScrollEvent variant without
 * a matching case branch fails `npx tsc --noEmit` before the code ships.
 */
export function reduce(
  state: AutoScrollState,
  event: AutoScrollEvent,
): { next: AutoScrollState; effect: AutoScrollEffect } {
  // (a) Mount-landing override: hide-pin-reveal terminal step.
  // Fires only when:
  //   - hasLandedOnce is still false (first mount only — idempotent after flip)
  //   - mode is at-bottom (the initial state; see createInitialState rationale)
  //   - event is a measured event with non-zero contentHeight (content has settled)
  // Returns effect:"reveal" so the hook wrapper flips the surface from hidden
  // to visible. The chase-to-bottom was already live during the hidden phase.
  if (
    !state.hasLandedOnce &&
    state.mode === "at-bottom" &&
    event.kind === "measured" &&
    event.contentHeight > 0
  ) {
    return {
      next: {
        ...state,
        hasLandedOnce: true,
        lastMeasuredDistance: event.distanceFromBottom,
      },
      effect: "reveal",
    };
  }

  // (b) + (c) Main mode × event.kind dispatch.
  switch (state.mode) {
    case "at-bottom": {
      // (b) at-bottom branches.
      switch (event.kind) {
        case "user-input": {
          // The OUT transition — ONLY user-input events landing outside
          // tolerance can flip mode to not-at-bottom. Shape file § Shape
          // para 2 ("Out of at-bottom happens only when a real user input
          // event ... lands position outside the threshold").
          const tolerance = event.isTouch
            ? BOTTOM_TOLERANCE_PX + BOTTOM_TOLERANCE_TOUCH_EXTRA_PX
            : BOTTOM_TOLERANCE_PX;
          if (event.distanceFromBottom > tolerance) {
            // OUT transition.
            return {
              next: {
                ...state,
                mode: "not-at-bottom",
                lastMeasuredDistance: event.distanceFromBottom,
              },
              effect: "none",
            };
          }
          // Inside tolerance — staying at bottom via user gesture; no chase
          // (the user just scrolled to the bottom themselves).
          return {
            next: {
              ...state,
              lastMeasuredDistance: event.distanceFromBottom,
            },
            effect: "none",
          };
        }

        case "content-changed":
        case "container-resized":
          // Symmetric event handling — all "something moved the bottom" events
          // are treated uniformly when at-bottom. Shape file § Shape para 2
          // ("When in at-bottom mode, all of these trigger a chase to the new
          // bottom").
          return {
            next: { ...state },
            effect: "chase",
          };

        case "measured":
          // Symmetric event — treat like content-changed/container-resized.
          // (Mount-landing handled above before this switch.)
          return {
            next: {
              ...state,
              lastMeasuredDistance: event.distanceFromBottom,
            },
            effect: "chase",
          };

        case "jump-clicked":
        case "send-fired":
          // Already at bottom; chase anyway to guarantee position after any
          // layout-shift that may accompany the action.
          return {
            next: { ...state },
            effect: "chase",
          };

        default: {
          // Compile-time exhaustiveness sentinel — if a new AutoScrollEvent
          // variant is added without a matching case branch here, TypeScript's
          // narrowing rule flags this as a type error at `npx tsc --noEmit`
          // build time. Verbatim from resolve-phase.ts lines 182-186.
          const _exhaust: never = event;
          return _exhaust;
        }
      }
    }

    case "not-at-bottom": {
      // (c) not-at-bottom branches.
      switch (event.kind) {
        case "jump-clicked":
          // User explicitly requested bottom — IN transition.
          return {
            next: { ...state, mode: "at-bottom" },
            effect: "chase",
          };

        case "send-fired":
          // Send flips to at-bottom regardless of prior state. Shape file
          // § Shape para 2 ("sends a message from the compose box (send flips
          // to at-bottom regardless of prior state)").
          return {
            next: { ...state, mode: "at-bottom" },
            effect: "chase",
          };

        case "user-input": {
          // IN transition when user scrolled back near the bottom.
          const tolerance = event.isTouch
            ? BOTTOM_TOLERANCE_PX + BOTTOM_TOLERANCE_TOUCH_EXTRA_PX
            : BOTTOM_TOLERANCE_PX;
          if (event.distanceFromBottom <= tolerance) {
            // IN transition.
            return {
              next: {
                ...state,
                mode: "at-bottom",
                lastMeasuredDistance: event.distanceFromBottom,
              },
              effect: "chase",
            };
          }
          // Still scrolled up — stay not-at-bottom.
          return {
            next: {
              ...state,
              lastMeasuredDistance: event.distanceFromBottom,
            },
            effect: "none",
          };
        }

        case "content-changed":
        case "container-resized":
          // LOAD-BEARING: no yank when scrolled up. Shape file § Shape para 2
          // ("When in not-at-bottom mode, none of them touch scroll position").
          // Do NOT touch scroll position, do NOT change mode.
          return {
            next: { ...state },
            effect: "none",
          };

        case "measured":
          // LOAD-BEARING: no yank when scrolled up. Measured event treated
          // symmetrically with content-changed/container-resized per the
          // "symmetric event handling" invariant.
          return {
            next: {
              ...state,
              lastMeasuredDistance: event.distanceFromBottom,
            },
            effect: "none",
          };

        default: {
          // Compile-time exhaustiveness sentinel (verbatim from resolve-phase.ts
          // lines 182-186). See at-bottom branch comment for rationale.
          const _exhaust: never = event;
          return _exhaust;
        }
      }
    }

    default: {
      // Compile-time exhaustiveness sentinel on Mode — if a third mode is
      // ever added, tsc catches it here before the code ships.
      const _exhaust: never = state.mode;
      return _exhaust;
    }
  }
}
