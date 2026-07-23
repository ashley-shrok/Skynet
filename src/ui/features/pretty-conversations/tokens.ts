// ─── pretty-conversations tokens ─────────────────────────────────────────────
// Named constants for values that repeat 3+ times across the
// pretty-conversations component tree.
//
// Naming rule (Ashley 2026-07-22): DO NOT add a token for a value used at only
// one or two call sites. Prefer inline `hsla(...)` / literal numbers everywhere
// else. Tokens exist so that a coherent change to the swipe state machine can
// be made in one place — not to over-abstract the CSS.
//
// Phase 13 Plan 01 lift-from-mock retired the row-min-height tokens
// (`PC_ROW_MIN_H_MOBILE` and `PC_ROW_MIN_H_DESKTOP`) because the CSS density
// variants (`.pv-row--mobile` at 72px and `.pv-row--desktop` at 62px in
// pretty-conversations.css) now own row geometry. The swipe state machine
// constants remain because the mobile swipe transform is JS-driven and can't
// be expressed in CSS.

/** Full width of the mobile swipe-reveal strip, in px. Used by:
 *  1) swipe-strip absolute-position right anchor
 *  2) swipe state-machine dx clamp (translateX max negative = -PC_SWIPE_REVEAL)
 *  3) closed-state transform reset (row settles at translateX(0) or translateX(-PC_SWIPE_REVEAL))
 */
export const PC_SWIPE_REVEAL = 88;

/** dx threshold (px) past which a swipe-left snaps the row open on touchEnd.
 *  Used by:
 *  1) swipe state-machine "shouldOpen" branch
 *  2) close-on-swipe-right symmetric threshold check
 *  3) test-suite assertions (snap-open at -60, snap-closed at -25)
 */
export const PC_SWIPE_THRESHOLD = 40;

/** Vertical-gesture bail-out tolerance (px). If the user's finger moves more
 *  than this in the y-axis during a swipe, we release control to the browser's
 *  native vertical scroll instead of hijacking it. Used by:
 *  1) swipe state-machine onTouchMove dy check
 *  2) test-suite vertical-yield assertion (dy=20)
 *  3) any future related gesture heuristic (kept as a shared knob)
 */
export const PC_SWIPE_ANGLE_TOLERANCE = 12;
