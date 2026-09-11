---
phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc
plan: 04
subsystem: ui
tags: [react, tailwind, css, chrome, meter, drawer, phase-93-uat-polish]

# Dependency graph
requires:
  - phase: 93-relay-rooms-use-the-chat-surface-one-surface-two-data-source
    provides: "AgentBadgeWithMeter component with mt-1 appendage housing the 12-segment meter, reset button, and band-computation logic (relay case only, per Phase 93 D-08 source.kind branch)"
provides:
  - "F-5: meter appendage rendered as a 'simple slotted drawer' — top edge tucks 8px behind the pill's bottom, bottom corners rounded (6px), top corners squared/tucked, top border invisible; pill's existing drop-shadow lands on the drawer surface reinforcing 'pill is in front' layering"
  - "Byte-for-byte fidelity to Variant A prototype (meter-tasting.html L164-177) — same tuck depth (-8px), same padding-top (10px), same z-index (1), same corner-radius (rounded-b-md = 6px), same border-top (border-t-0)"
  - "Meter internals invariant: SEG_COUNT=12, gradient rules, band computation, reset button, all shadows/borders on the meter body — unchanged (Phase 93 D-03 byte-identity discipline preserved)"
  - "IdentityBadge primitive untouched (scope constraint)"
affects:
  - "Phase 97 close-out (`/close`) — reviewer verifies drawer READS as pulled from behind the pill per D-12/D-13"
  - "Future meter/badge chrome work — the drawer pattern is now the established shape for 'peripheral appendage tucked behind an authoritative pill'"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Drawer chrome pattern: `data-drawer=\"true\"` wrapper with negative margin-top + positive padding-top + z-index below the authoritative element's implicit stacking, so the authority's drop-shadow lands on the drawer surface"
    - "Byte-for-byte prototype-to-production fidelity: Tailwind arbitrary-value syntax (`pt-[10px]`) + inline style for zIndex when explicit ordering matters, matching the tasting prototype's CSS verbatim rather than paraphrasing"

key-files:
  created: []
  modified:
    - "src/ui/features/pretty-view/AgentBadgeWithMeter.tsx — drawer wrapper added around the data-appendage div; meter-well corner-radius and border-top tokens adjusted per Variant A prototype"
    - "src/ui/features/pretty-view/AgentBadgeWithMeter.test.tsx — added Tests 14/15/16 asserting drawer structure, corner tokens, and mt-1 removal"

key-decisions:
  - "Tuck depth locked at -8px (`-mt-2`) — the prototype's exact value, and dead-center of D-13's 6-10px executor-discretion band. No fine-tune needed."
  - "z-index expressed via inline `style={{ zIndex: 1 }}` rather than Tailwind's `z-[1]` arbitrary-value class — inline style is unambiguous about the exact numeric layering intent (pill implicit ≥ 2 via drop-shadow context, drawer explicitly 1)."
  - "`mt-1` on the appendage was REMOVED (not preserved alongside the drawer's -mt-2) — its 4px spacer role is replaced by the drawer's negative-margin + padding-top geometry, matching prototype semantics exactly."
  - "Task 2 human-verify APPROVED AS-IS by Alice (thumbs up) at the code level — byte-for-byte prototype match was accepted without live-browser tuck-depth adjustment. Live rendering deferred to phase-end deploy per standard fleet pattern; if tuck reads differently on real DOM, adjustment happens at `/close` time."

patterns-established:
  - "Simple slotted drawer chrome (Variant A): wrapper carries the geometry (negative margin-top + padding-top + z-index below), inner element (the appendage) carries only its own semantics (data-role, flex layout, gap). Two-concern separation between 'how the container tucks' and 'what the container contains.'"
  - "Prototype-driven CSS-token porting: when a design tasting locks a prototype file (meter-tasting.html), the executor's job is byte-for-byte token translation (Tailwind class equivalents), not paraphrase-with-interpretation. If a Tailwind class doesn't exist for a value, use arbitrary-value syntax (`pt-[10px]`) rather than rounding to the nearest scale value."

requirements-completed: [F-5, D-12, D-13]

# Metrics
duration: ~15min (Task 1 implementation + Task 2 checkpoint round-trip)
completed: 2026-09-10
---

# Phase 97 Plan 04: Meter Drawer Chrome (F-5) Summary

**Agent-meter appendage now renders as a "simple slotted drawer" tucked 8px behind the pill's bottom edge — bottom-only 6px corners, invisible top border, pill's drop-shadow lands on the drawer surface — byte-for-byte match to Variant A prototype (meter-tasting.html L164-177).**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-09-10
- **Tasks:** 2 (1 implementation + 1 human-verify checkpoint)
- **Files modified:** 2 (both scoped to AgentBadgeWithMeter — implementation + tests)

## Accomplishments

- **F-5 shipped:** the appendage below each agent's IdentityBadge in the relay case now reads visually as a drawer peeking from behind the pill, per Alice's tasting decision (D-12 "simple slotted drawer" variant, 2026-09-10).
- **Byte-for-byte prototype fidelity:** every Tailwind token in the drawer wrapper and the adjusted meter-well corner/border classes maps 1:1 to the prototype's CSS at meter-tasting.html L164-177.
- **Meter internals preserved:** SEG_COUNT=12, band computation, reset button, gradient/shadow tokens — all byte-identical to pre-plan (T-97-04-01 threat mitigated per plan scope discipline).
- **IdentityBadge untouched:** `git diff --name-only 50b82206~1 50b82206` shows only AgentBadgeWithMeter files (T-97-04-02 threat mitigated).
- **Task 2 (checkpoint:human-verify) APPROVED AS-IS by Alice** — code-level review of the byte-for-byte prototype match; no adjustment requested.

## Task Commits

1. **Task 1: Wrap appendage in drawer + adjust meter-well corners per Variant A** — `50b82206` (feat)
2. **Task 2: Human verification of drawer visual** — no code commit (checkpoint approved as-is with "approved" resume signal; no adjustment required)

**Plan metadata:** _(this SUMMARY.md commit, following)_

## Files Created/Modified

- `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx` — Wrapped the existing `data-appendage="true"` div in a `data-drawer="true"` container with `relative -mt-2 pt-[10px]` + inline `zIndex: 1`. Changed the meter-well's className from `rounded-md` to `rounded-b-md` and added `border-t-0`. Removed `mt-1` from the appendage (its spacer role replaced by drawer geometry).
- `src/ui/features/pretty-view/AgentBadgeWithMeter.test.tsx` — Added 3 new tests: Test 14 asserts drawer wraps appendage and carries `-mt-2`, `pt-[10px]`, and inline `zIndex: 1`; Test 15 asserts meter-well has `rounded-b-md` + `border-t-0` and does NOT have `rounded-md` or `rounded-t-md`; Test 16 asserts `mt-1` was removed from the appendage.

## Byte-for-Byte Prototype Fidelity

| Prototype (meter-tasting.html L164-177) | Ships in AgentBadgeWithMeter.tsx |
| --------------------------------------- | -------------------------------- |
| `margin-top: -8px` (drawer)             | `-mt-2` (drawer wrapper)         |
| `padding-top: 10px` (drawer)            | `pt-[10px]` (drawer wrapper)     |
| `z-index: 1` (drawer)                   | `style={{ zIndex: 1 }}` (drawer wrapper) |
| `border-radius: 0 0 6px 6px` (meter-well) | `rounded-b-md` (meter-well)   |
| `border-top: 0` (meter-well)            | `border-t-0` (meter-well)        |
| Bottom/side borders + palette preserved | `border` + `border-[rgba(220,225,245,0.1)]` preserved |

The prototype's pill drop-shadow (`0 8px 24px rgba(0,0,0,0.6)`, live at IdentityBadge.tsx:121) is unchanged; because the drawer's `zIndex: 1` sits below the pill's implicit stacking, the shadow lands ON the drawer surface — the "pill is in front" layering signal the tasting design was after.

## Verification

- **Scoped Vitest:** 17/17 tests green (`npx vitest run --related src/ui/features/pretty-view/AgentBadgeWithMeter.tsx`), including the 3 new drawer-structure/corner-token/mt-1-removal assertions added in Task 1.
- **Type-check:** `npx tsc --noEmit` clean project-wide.
- **Grep gates (from Task 1 automated verify):** all 8 grep assertions passed — `data-drawer="true"` present, `-mt-2` present, `pt-[10px]` present, `zIndex: 1` present, `rounded-b-md` present, `border-t-0` present, `data-appendage="true"` count exactly 1 (no duplication), IdentityBadge diff empty.
- **Meter internals byte-identity:** SEG_COUNT constant, reset button JSX, band computation function, gradient/shadow tokens — all unchanged (spot-checked via diff).
- **Task 2 human-verify:** APPROVED AS-IS by Alice (thumbs up, resume signal "approved") — Alice reviewed the byte-for-byte prototype match at the code level and greenlit the current -8px tuck depth without adjustment. Live-browser tuck-depth verification is deferred to phase-end deploy per standard fleet pattern.

## Must-Haves Fulfilled

- **F-5 (Meter chrome drawer treatment):** shipped per D-12's five bullets — 8px tuck (within 6-10px band), rounded bottom corners, squared top corners, dark palette preserved (not hue-tinted), 12-segment bar + reset button byte-identical.
- **D-12 (Simple slotted drawer variant):** implemented; Variant B "hue-tinted" was rejected in the tasting and no color hue was added.
- **D-13 (Prototype is the visual pattern to match):** met byte-for-byte — every Tailwind token in the drawer wrapper and meter-well adjustments maps 1:1 to meter-tasting.html L164-177. No paraphrase, no interpretation.

## Decisions Made

- **Tuck depth locked at -8px:** the prototype's exact value, dead-center of D-13's 6-10px executor tolerance. No live-browser fine-tune executed because Alice approved the byte-for-byte match at the code level; if the rendered tuck reads differently once deployed, adjustment happens at `/close`.
- **Inline `style={{ zIndex: 1 }}` rather than `z-[1]` Tailwind arbitrary-value:** unambiguous about the exact numeric layering intent, matches the prototype's declarative CSS directly, and avoids any concern about how Tailwind's z-index scale might map.
- **`mt-1` on the appendage REMOVED, not layered with drawer -mt-2:** the drawer's negative-margin + padding-top geometry semantically replaces the 4px spacer. Keeping both would double-count and drift from the prototype.

## Deviations from Plan

None — plan executed exactly as written. Task 1 implemented Variant A byte-for-byte; Task 2 checkpoint returned "approved" without adjustment.

## Issues Encountered

None. The pill-is-absolute-positioned-inside-its-parent-cell landmine called out in RESEARCH § Finding 5 did not manifest — the `-mt-2` on the drawer wrapper achieved the intended tuck at the code level (Alice confirmed). The absolute-positioning fallback in the plan was not needed.

## User Setup Required

None — pure client-side CSS/JSX chrome change on a single component. No environment variables, no external services, no config.

## Deferred Items

- **Live-browser tuck-depth verification.** Alice approved the code-level byte-for-byte prototype match. Actual rendered tuck depth on real DOM is verified at phase-end deploy per the standard fleet pattern; if the tuck reads differently on live surface than in the prototype (edge case: font-metric drift, browser-specific stacking-context resolution), adjustment happens at `/close` time. The plan already provides the tolerance band (D-13's 6-10px) for that fine-tune if needed.

## Next Phase Readiness

- **F-5 is functionally complete for `/close`-time review.** Reviewer's yardstick per D-01 is "does this feel like the session case except where deliberately case-branched, and does the drawer READ as pulled from behind the pill?" — the byte-for-byte prototype match answers "yes" at the code level.
- **No blockers for downstream plans.** F-5 is file-disjoint from all other Phase 97 findings (findings 1, 2, 3, 4, 6, 7 touch distinct files); no cross-plan interference.

## Self-Check: PASSED

- `.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-04-SUMMARY.md` — FOUND (this file)
- Commit `50b82206` — FOUND (`git log --oneline` confirms)
- Modified files exist:
  - `src/ui/features/pretty-view/AgentBadgeWithMeter.tsx` — FOUND (contains `data-drawer="true"`, `-mt-2`, `pt-[10px]`, `zIndex: 1`, `rounded-b-md`, `border-t-0`)
  - `src/ui/features/pretty-view/AgentBadgeWithMeter.test.tsx` — FOUND (17 tests present)

---

*Phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc*
*Completed: 2026-09-10*
