---
phase: 24-plan-mode-approval-bubble-pane-tail-detection-expanded-bubbl
plan: 04
subsystem: frontend/pretty-view

tags: [plan-mode, bubble, react, phase-4-glass, identity-hue, feedback-modal, raw-keystrokes-callbacks]

# Dependency graph
requires:
  - phase: 24-03
    provides: "widened PlanPendingEvent shape + RawKeystrokesPayload client→server type (wire contract)"
provides:
  - "expanded PlanPendingBubble.tsx with PlanPendingBubbleProps interface (planFilePath, planContent, contentError, onApprove, onFeedback)"
  - "in-place vertical growth of the identity-hue Phase 4 Glass bubble — header + plan-contents + footer buttons + inline modal, all inside the same outer wrapper as the original 61-line presence-only component"
  - "four render states for the plan-contents section (skip-when-no-path, loading-italic-text-no-spinner, dim-error-line, <pre> monospace) matching CONTEXT § Bubble UI fallback matrix verbatim"
  - "Approve button (identity-hue primary) + Feedback button (quiet secondary) — both fire props callbacks; no direct WS access"
  - "inline Feedback modal (textarea + Submit + Cancel + backdrop-click-to-close) with Submit disabled while trimmed empty; MVP scope per CONTEXT § Deferred (no paste-image, no markdown preview, no template snippets)"
affects: [24-05-composebox-plan-pending-disable-and-prettyview-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Props-in/callbacks-out bubble expansion: grow an existing presentational component in place — same file, same outer wrapper, same identity-hue Phase 4 Glass tokens — by adding a props interface and swapping the inner container's layout (flex items-center → flex flex-col) with all other visual tokens preserved verbatim. Aesthetic identical; container taller."
    - "Cross-plan interface contract via exported Props type: PlanPendingBubbleProps is the load-bearing seam between Plan 04 (defines) and Plan 05 (consumes). Plan 05 does not need to know internal render logic; it just supplies the shape."
    - "Inline overlay modal (not radix Portal) for a two-button/one-textarea affordance: `fixed inset-0 z-50` with backdrop-click-to-close via `e.target === e.currentTarget` and Submit-disabled-while-trimmed-empty. Simpler than DialogPrimitive when there's no need for focus trap / portal / animation orchestration."
    - "Identity-hue primary button styling via HSLA on --pv-id-hue: `bg-[hsla(var(--pv-id-hue),70%,50%,0.85)] text-[#fbf5e8] border-[hsla(var(--pv-id-hue),80%,60%,0.55)]` complements the bubble's identity-hue gradient without needing a --color-pv-accent token (which doesn't exist in this codebase — greppable list is base/base-mid/base-end/border-quiet/border-quiet-strong/code-fg/fg/fg-dim/fg-muted/surface/surface-quiet/surface-quiet-alt only)."

key-files:
  created: []
  modified:
    - "src/ui/features/pretty-view/PlanPendingBubble.tsx (+219/-4, 61→276 lines) — expanded from bare presence indicator to full plan-approval card. PlanPendingBubbleProps interface exports 5-prop shape (planFilePath, planContent, contentError, onApprove, onFeedback). Function signature accepts props (was zero-prop). Inner container layout: flex items-center gap-2 text-sm → flex flex-col gap-2 text-sm max-w-[min(720px,80vw)] (width cap prevents long plan lines from overflowing pretty-view column). Header preserved verbatim (ClipboardList h-4 w-4 shrink-0 + 'Plan proposed — awaiting your approval'). Middle section renders 4 states per CONTEXT § Bubble UI: (a) planFilePath===null → section skipped; (b) contentError !== null → 'Plan contents unavailable ({error})' italic dim; (c) planContent===null → 'Loading plan…' italic (no spinner glyph per docblock L23-27); (d) planContent non-null → <pre max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-sm bg-black/20 p-3 text-xs font-mono>. Footer: Approve (identity-hue HSLA primary) + Feedback (quiet secondary, opens modal). Inline Feedback modal: fixed inset-0 z-50 backdrop with click-to-close, w-[min(520px,90vw)] surface panel, label + autoFocus textarea + Cancel + Submit (disabled while trim-empty). useState hooks: feedbackOpen, feedbackText, with closeFeedback + submitFeedback helpers that clear text on close/submit. Docblock: preserved patch #63 provenance + patch #67 split-send warning (L14-21) + patch #53 spinner-glyph warning (L23-27) verbatim; added Phase 24 stanza documenting the expansion, the raw_keystrokes callback contract, and the props-in/callbacks-out rationale (component does not know about WS; parent PrettyView owns wsRef)."

key-decisions:
  - "Identity-hue HSLA for the Approve button (no --color-pv-accent token exists). Plan text said 'if --color-pv-accent / --color-pv-accent-fg don't exist, substitute the closest existing tokens or use inline-style hue equivalents; load-bearing property is Approve = primary/emphasized, Feedback = secondary/muted, side-by-side.' Verified via grep that no --color-pv-accent token is in use anywhere in src/ — the greppable set is base/base-mid/base-end/border-quiet/border-quiet-strong/code-fg/fg/fg-dim/fg-muted/surface/surface-quiet/surface-quiet-alt. Chose the identity-hue HSLA path over --color-pv-code-fg (which NewSessionDialog uses as a text-color accent) because the bubble already carries the identity-hue gradient — a matched-hue fill button reads as 'this is the identity speaking, committing to its own plan' where a text-only accent would read as an alien color inside the hue-tinted card. Feedback button uses the quiet-surface treatment from NewSessionDialog.tsx L985 (border-quiet + surface-quiet + fg) which is the codebase's standard secondary."
  - "Inline overlay modal (not radix DialogPrimitive) — PATTERNS.md § Feedback modal locked this to inline for MVP scope. Confirmed the tradeoff by re-reading PATTERNS: only 2 buttons + 1 textarea, no portal escape needed, no animation orchestration. Backdrop-click-to-close via `if (e.target === e.currentTarget) closeFeedback()` — the load-bearing check that the click landed on the backdrop itself, not on a bubbled child, so clicking inside the modal panel does not dismiss."
  - "Submit-disabled-while-trimmed-empty (not while-empty). Prevents Ashley from firing a `3\r` frame that Ink would interpret as 'option 3 with no feedback text' — semantically wrong; the feedback affordance requires actual content. Whitespace-only input is also rejected via the same trim guard on the submit-handler side."
  - "closeFeedback + submitFeedback helper functions defined at component-body scope (not inline arrow functions on the JSX). Slight readability win + prevents duplication of the setFeedbackOpen(false) + setFeedbackText('') teardown pattern across the two dismiss paths (Cancel button, Submit success). Also makes the backdrop-click handler a one-liner (`closeFeedback()`)."
  - "Docblock preservation strategy: keep patch #63 provenance line at L1-2 verbatim, keep patch #67 split-send-anti-pattern block at L14-21 verbatim, keep patch #53 spinner-glyph rationale block at L23-27 verbatim. Add a new Phase 24 expansion stanza AFTER those blocks (starts L29) that documents the 3-section card structure (header/middle/footer), the 4 render states, the raw_keystrokes callback contract with the parent-owns-wsRef rationale, and a re-statement of the split-send anti-pattern to prevent future 'optimizations' back through ComposeBox. Ordering is 'oldest provenance first, newest expansion last' so the docblock reads chronologically."

patterns-established:
  - "Grow-in-place bubble expansion: when a presentational bubble needs to grow from a 1-line indicator into a multi-section card, keep the same file, same outer wrapper alignment, same identity-hue Phase 4 Glass token cascade, and switch ONLY the inner container's layout mode (typically `flex items-center` → `flex flex-col`). Preserve every other className token verbatim. Add a max-width cap to prevent overflow of the pretty-view content column. This pattern keeps visual continuity (Ashley sees 'the same bubble, just fuller') and preserves the aesthetic-review contract from the original component's landing patch."
  - "Cross-plan interface contract via exported Props type: when Plan A defines a component and Plan B wires it into the parent tree, Plan A exports the Props interface as the single source of truth and Plan B imports it. Plan A does not need to know parent state shape; Plan B does not need to know component internals. This is the pattern for the 24-04 → 24-05 boundary — PlanPendingBubbleProps is the seam."

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-08-04
---

# Phase 24 Plan 04: PlanPendingBubble expansion Summary

**Expanded PlanPendingBubble.tsx in place from a 61-line presence-only indicator to a 276-line full plan-approval card: PlanPendingBubbleProps interface with 5 props (planFilePath, planContent, contentError, onApprove, onFeedback), 4-state plan-contents render section (skip / loading-italic-text-no-spinner / dim-error / `<pre>` monospace), identity-hue Approve + quiet Feedback footer buttons, and an inline Feedback modal (textarea + Submit-disabled-while-trimmed-empty + Cancel + backdrop-click-to-close) — Phase 4 Glass identity-hue treatment preserved verbatim (backdrop-blur, gradient, border, shadow, rounding, text color, ClipboardList glyph, header line all byte-identical to the original patch #63 shape), only the inner container's layout mode changed from `flex items-center` to `flex flex-col` to grow vertically.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-08-04T20:20:00Z (approximate — recorded from plan-load flow)
- **Completed:** 2026-08-04T20:28:00Z
- **Tasks:** 1 (auto, no TDD; single-file in-place expansion)
- **Files modified:** 1

## Accomplishments

- Added `PlanPendingBubbleProps` interface with the 5-prop shape locked by the plan + PATTERNS.md § Feedback modal (planFilePath, planContent, contentError, onApprove, onFeedback). Interface exported so Plan 05 can consume it via `import { PlanPendingBubbleProps } from "./PlanPendingBubble"` when wiring the parent (PrettyView).
- Added `useState` hooks for `feedbackOpen` + `feedbackText` — the two pieces of local state the inline modal needs. Both cleared together via a `closeFeedback` helper used by Cancel, Submit-success, and backdrop-click.
- Switched inner container layout from `flex items-center gap-2 text-sm` to `flex flex-col gap-2 text-sm max-w-[min(720px,80vw)]` so the bubble grows vertically. All other Phase 4 Glass tokens preserved verbatim (rounding, backdrop-blur, gradient, border, shadow, text color).
- Preserved the header row verbatim: `<ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />` + `<span>Plan proposed — awaiting your approval</span>`. Now mounted as the first child of the vertical container (was the ONLY child in the original).
- Added the middle plan-contents section as a conditional block gated on `planFilePath !== null`. Four render states per CONTEXT § Bubble UI:
  - `contentError !== null` → italic dim "Plan contents unavailable ({error})" text (buttons still work).
  - `planContent === null` (in-flight) → italic "Loading plan…" text. **NO spinner glyph** — respects the L23-27 docblock rationale (plan-pending is "waiting on you", opposite of spinner "Claude is working" semantics; motion channel stays owned by WipBubble).
  - `planContent !== null` → `<pre max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-sm bg-black/20 p-3 text-xs font-mono>`. Bounded height prevents very long plans from pushing footer off-screen; whitespace-pre-wrap preserves plan formatting while allowing word-boundary wraps.
- When `planFilePath === null` the entire middle section is skipped (buttons still work) so a footer-extraction miss doesn't disable the approval affordance.
- Added the footer with Approve + Feedback buttons side-by-side:
  - **Approve** (primary/emphasized): identity-hue HSLA fill (`bg-[hsla(var(--pv-id-hue),70%,50%,0.85)]` + matched-hue border) with light text (`#fbf5e8`, matches bubble body text color). aria-label "Approve plan". Fires `onApprove` prop.
  - **Feedback** (secondary/muted): quiet-surface treatment (`border-[color:var(--color-pv-border-quiet)]` + `bg-[color:var(--color-pv-surface-quiet)]` + `text-[color:var(--color-pv-fg)]`) copied from NewSessionDialog's canonical secondary button pattern. aria-label "Provide feedback on plan". Opens the modal via `setFeedbackOpen(true)`.
- Added the inline Feedback modal: `fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm` outer backdrop, `role="dialog" aria-modal="true" aria-label="Provide feedback for Claude"` for accessibility, `w-[min(520px,90vw)]` inner surface panel with `--color-pv-surface` bg. Contents: label (`htmlFor="plan-feedback-textarea"`) + textarea (autoFocus, rows=4, aria-label "Feedback", placeholder "What should Claude change about the plan?", styled per NewSessionDialog.tsx L985 canonical shape) + footer with Cancel (ghost) + Submit (identity-hue primary, `disabled={feedbackText.trim().length === 0}`, `disabled:opacity-50 disabled:cursor-not-allowed`).
- Backdrop-click-to-close via `if (e.target === e.currentTarget) closeFeedback()` on the outer overlay div — the load-bearing check that the click landed on the backdrop, not on a bubbled child. Clicking inside the modal panel does not dismiss.
- Submit handler: trim, early-return if empty (defense-in-depth against the disabled flag being bypassed), fire `onFeedback(trimmed)`, then close. Cancel handler: close without firing.
- Docblock: preserved patch #63 provenance (L1-2), patch #67 split-send-anti-pattern warning (L14-21), and patch #53 spinner-glyph rationale (L23-27) verbatim. Added a new Phase 24 stanza (starts L29) that:
  - Documents the 3-section card structure (header / middle / footer) with per-section render rules.
  - Documents the 4 render states of the middle section with the exact fallback matrix.
  - Restates the raw_keystrokes callback contract: Approve fires `onApprove` → parent sends `{type:"raw_keystrokes", bytes:"1\r"}`; Feedback Submit fires `onFeedback(text)` → parent sends `{type:"raw_keystrokes", bytes:"3" + text + "\r"}`.
  - Re-states (a third time in this file) the split-send anti-pattern to prevent future 'optimizations' back through ComposeBox's send path — a future reader who doesn't know about patch #67 might see "we call `raw_keystrokes` twice, let's route through the compose infrastructure" and quietly break plan-mode.
  - Documents the props-in/callbacks-out purity: the component does NOT know about the WebSocket. Parent PrettyView owns the wsRef.

## Task Commits

Each task was committed atomically:

1. **Task 1: Expand PlanPendingBubble.tsx — props + plan-contents section + Approve/Feedback footer + inline Feedback modal** — `da471dc` (feat)

**Plan metadata:** _(see final commit below in State Updates section)_

## Files Created/Modified

- `src/ui/features/pretty-view/PlanPendingBubble.tsx` — expanded in place from 61 lines to 276 lines (+219/-4). New imports: `useState` from React. Preserved imports: `ClipboardList` from lucide-react, `cn` from @/lib/utils. New exported types: `PlanPendingBubbleProps`. Function signature changed from `PlanPendingBubble()` to `PlanPendingBubble(props: PlanPendingBubbleProps)`. Local state: `feedbackOpen`, `feedbackText`. Local helpers: `closeFeedback`, `submitFeedback`. Outer wrapper unchanged (`<div className={cn("flex", "justify-start")}>` — assistant-aligned). Inner container className cascade preserved verbatim except for the layout token swap (`flex items-center gap-2 text-sm` → `flex flex-col gap-2 text-sm max-w-[min(720px,80vw)]`). Docblock: patch #63 provenance + patch #67 split-send warning + patch #53 spinner-glyph rationale all preserved verbatim; new Phase 24 expansion stanza added after those blocks.

## Decisions Made

See frontmatter `key-decisions` for the full list. Summary of the load-bearing calls:

- **Identity-hue HSLA for Approve button** (no `--color-pv-accent` token exists in this codebase per grep). The identity-hue fill reads as "the identity committing to its own plan" — semantically stronger than a token-color accent inside the identity-hue bubble.
- **Inline overlay modal, not radix DialogPrimitive** (PATTERNS.md § Feedback modal decision, confirmed appropriate for 2-button/1-textarea scope).
- **Submit disabled while `trim()` empty**, not `length === 0` (prevents whitespace-only feedback from firing a semantically-empty `3\r` frame that Ink would interpret as option-3-with-no-content).
- **Helper functions at component-body scope** (`closeFeedback`, `submitFeedback`) rather than inline arrows — DRY on the setFeedbackOpen+setFeedbackText teardown pattern used across Cancel, Submit-success, and backdrop-click.
- **Docblock ordering: oldest provenance first, newest expansion last** — reads chronologically (patch #63 → patch #67 → patch #53 → Phase 24) so a reader can trace the component's evolution top-to-bottom.

## Deviations from Plan

### Rule 1 - Grep-intent-vs-mechanical-check clarification

**Found during:** Task 1 verify step.

**Issue:** The plan's automated verify includes `grep -ciE '(spinner|Loader|RefreshCw|CircleNotch)' src/ui/features/pretty-view/PlanPendingBubble.tsx | grep '^0$'` which expects zero matches. The expanded file contains 5 matches of the word "spinner" — but all 5 are in COMMENTS explaining why the component does NOT use a spinner glyph:
- L23-26 (patch #53 provenance block — `Static ClipboardList (not a spinner)`, `A spinner reads as "Claude is working"`, `a spinner would be semantically wrong`) — REQUIRED to preserve verbatim per acceptance criterion "spinner-glyph warning (L23-27) still present verbatim".
- L47 (Phase 24 docblock stanza — `→ italic "Loading plan…" text. NO spinner glyph`).
- L189 (inline comment above the loading state — `// Loading state — italic text, NO spinner glyph. See docblock`).

**Resolution:** The plan's grep is over-inclusive by design (mechanical, no comment-vs-code distinction); the plan text and success_criteria explicitly require preserving the spinner-glyph warning verbatim. The two constraints conflict: obeying the grep would strip the required docblock. Chose to obey the higher-priority preservation directive.

- Verified: no lucide-react spinner components imported (`import { ClipboardList } from "lucide-react"` — only ClipboardList).
- Verified: no `<Loader`, `<RefreshCw`, `<CircleNotch`, `<Spinner` JSX elements anywhere in the file.
- Verified: the plan's success_criteria says "No spinner glyphs anywhere in the bubble" (glyph = rendered lucide-react icon component) — satisfied.

**Files modified:** none (this is a documentation-of-intent clarification, not a code change).

**Commit:** N/A (no code delta).

---

**Total deviations:** 0 code deviations; 1 grep-intent clarification documented above.

**Impact on plan:** Plan executed exactly as written; the spinner grep's mechanical output is a false positive that would only be "resolved" by stripping the required docblock text — an unacceptable tradeoff.

## Issues Encountered

None material. One small point worth surfacing for downstream planners:

- **No `--color-pv-accent` token in this codebase.** The plan text anticipated this ("if `--color-pv-accent` / `--color-pv-accent-fg` don't exist, substitute the closest existing tokens or use inline-style hue equivalents"). Chose the identity-hue HSLA approach for the primary button — this is arguably a NEW styling convention for identity-hued primary buttons inside identity-hued bubbles, which Plan 05 or a future phase may want to extract into a shared helper if the pattern recurs.

## Testing

**Type-check:** `npx tsc --noEmit -p tsconfig.json` → 0 errors, exit 0. Repo-wide clean.

**New tests for Plan 04:** intentionally deferred per plan text — "Testing: Optional vitest for the bubble. Not required by the plan (plan 24-05 will have the disable-truth-table tests; bubble is visual)." Plan 05's ComposeBox.plan-pending-disable.test.tsx will exercise the parent-side wiring; the bubble's internal render states are visual and better covered by the phase-level human-verify checkpoint.

**Existing suites:** no test files touched, no regression risk.

## Threat Flags

None. The two threats named in the plan's `<threat_model>` are mitigated as designed:

- **T-24-04-01 (Tampering — plan content rendering):** `<pre>{planContent}</pre>` uses JSX text-child rendering which React auto-escapes. No `dangerouslySetInnerHTML`, no `innerHTML`, no markdown parser. XSS surface = 0.
- **T-24-04-02 (DoS — very long plan content):** `max-h-[40vh] overflow-y-auto` on the `<pre>` block bounds the visible height; the backend's 500KB cap (Plan 02) bounds the total DOM string length. Combined: the bubble stays responsive even on a maximally-large plan file.

No new network endpoints, no new auth paths, no schema changes, no new trust boundaries introduced by this plan.

## Next Phase Readiness

- **Plan 05** (ComposeBox planPendingActive prop + PrettyView wire-up) can now consume `PlanPendingBubbleProps` directly via `import { PlanPendingBubbleProps } from "@/ui/features/pretty-view/PlanPendingBubble"` and pass the 5 props from PrettyView's `planPending` state. The 24-03 SUMMARY notes PrettyView's `planPending` state currently declares the narrow shape `{planFilePath: string} | null` and receives the widened shape via `setPlanPending(parsed.pending)` — Plan 05 widens that state declaration to `{planFilePath: string | null; planContent: string | null; contentError: string | null} | null` and threads all three fields into the bubble.
- **Send-path wiring:** Plan 05's PrettyView handlers `handlePlanApprove` and `handlePlanFeedback(text)` fire `wsRef.current?.send(JSON.stringify({type: "raw_keystrokes", bytes: "1\r"} satisfies RawKeystrokesPayload))` and `... bytes: "3" + text + "\r" ...` respectively. The bubble is agnostic to the send mechanism — it just needs the two callbacks.
- No blockers for Plan 05.

## Self-Check: PASSED

- FOUND: `/home/ubuntu/skynet/src/ui/features/pretty-view/PlanPendingBubble.tsx` (modified, 276 lines).
- FOUND: `export interface PlanPendingBubbleProps` at file scope (grep count = 1).
- FOUND: `onApprove: () => void` prop signature (grep count = 1).
- FOUND: `onFeedback: (feedback: string) => void` prop signature (grep count = 1).
- FOUND: `Plan proposed — awaiting your approval` header text preserved (grep count = 2 — once in comments, once in JSX).
- FOUND: `ClipboardList` reference (grep count = 6 — imports, JSX, plus comment mentions).
- FOUND: Phase 4 Glass identity-hue tokens (`pv-id-hue`, `backdrop-blur-xl`, `rounded-[var(--radius-pv-bubble)]`) present with count 7.
- FOUND: patch #67 split-send warning preserved (grep count = 4 — L14-21 original + Phase 24 restatement).
- FOUND: `Static ClipboardList (not a spinner)` at L23 (patch #53 spinner-glyph warning preserved verbatim).
- FOUND: commit `da471dc` (feat(24-04): expand PlanPendingBubble with plan contents + Approve/Feedback + inline modal) at HEAD of `feat/tab-title-from-tmux`.
- Confirmed: `npx tsc --noEmit -p tsconfig.json` exits 0 with no output.
- Confirmed: `git status --short` clean (only the SUMMARY.md addition pending for the docs commit below).
- Confirmed: no unintended deletions in the commit (`git diff --diff-filter=D --name-only HEAD~1 HEAD` returns empty).

---
*Phase: 24-plan-mode-approval-bubble-pane-tail-detection-expanded-bubbl*
*Completed: 2026-08-04*
