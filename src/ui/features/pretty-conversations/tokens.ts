// ─── pretty-conversations tokens ─────────────────────────────────────────────
// This file previously exported PC_SWIPE_REVEAL / PC_SWIPE_THRESHOLD /
// PC_SWIPE_ANGLE_TOLERANCE — the constants that parameterized the mobile
// swipe-to-reveal state machine on PrettyConversationRow. That machine was
// retired in quick-260802-pq2 in favor of a long-press → context-menu
// affordance (the same PrettyConversationContextMenu desktop uses for
// right-click), because the reveal-strip's action buttons were bleeding
// visually through translucent ambient/hidden row backgrounds (bounty
// `swipe-actions-visible-through-translucent-rows`). Nothing painted behind
// rows = no bleed-through, ever.
//
// Naming rule (Ashley 2026-07-22): DO NOT add a token for a value used at
// only one or two call sites. Prefer inline `hsla(...)` / literal numbers
// everywhere else. Tokens exist for values shared coherently across the
// component tree; the swipe state machine was the only such value here, so
// the file is now header-only.

export {};
