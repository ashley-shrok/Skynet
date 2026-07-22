// ─── pretty-conversations tokens ─────────────────────────────────────────────
// Named constants for values that repeat 3+ times across the
// pretty-conversations component tree.
//
// Naming rule (Ashley 2026-07-22): DO NOT add a token for a value used at only
// one or two call sites. Prefer inline `hsla(...)` / literal numbers everywhere
// else. Tokens exist so that a coherent change to row geometry OR the swipe
// state machine can be made in one place — not to over-abstract the CSS.
//
// If a future edit would use one of these values, use the token. If a future
// edit needs a new shared value, add it here ONLY once it hits three call
// sites. Otherwise inline it.

/** Minimum row height on the mobile (touch) variant, in px. Used by:
 *  1) PrettyConversationRow row-body min-h class
 *  2) PinAction mobile size (48px disc centred inside a 72px row)
 *  3) swipe-strip vertical anchor (top:0 bottom:0 spanning the full height)
 */
export const PC_ROW_MIN_H_MOBILE = 72;

/** Minimum row height on the desktop (pointer) variant, in px. Used by:
 *  1) PrettyConversationRow row-body min-h class
 *  2) desktop hover-reveal PinAction column vertical centre alignment
 *  3) group divider / hairline spacing between rows
 */
export const PC_ROW_MIN_H_DESKTOP = 62;

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
