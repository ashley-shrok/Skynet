---
phase: 47-load-more-button-in-prettyview-manual-reveal-of-older-messag
plan: 02
subsystem: ui
tags: [pretty-view, react, tsx, tdd, vitest, twin-arc-spinner, component]

# Dependency graph
requires:
  - phase: 45-post-hydration-cap-cleanup
    provides: locked `fetch_older` / `fetch_older_batch` type names as FORBIDDEN (hydration-cap Test H); Phase 47 wire-shape MUST pick a fresh name
provides:
  - LoadMoreOlderButton presentational component (pure function of props)
  - LoadMoreOlderButtonProps public type
  - 7-test suite covering the 3 visible states + no-lie invariant + retry contract
affects: [phase-47-load-more-button-plan-04-PrettyView-mount, phase-47-load-more-button-plan-03-server-handler]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "pure-props presentational component (mirror AsideBubble.tsx / DormancyOverlay.tsx)"
    - "tri-branch aria-label discrimination for state-communicating widgets (mirror DormancyOverlay.tsx L99-105)"
    - "twin-arc spinner SVG copied verbatim from ComposeBox.tsx L2551-2564 (patch #467, commit df4d7543)"
    - "no-lie invariant: early null-return when a gating prop is false (mirror AttachmentChipStrip.tsx L61)"

key-files:
  created:
    - src/ui/features/pretty-view/LoadMoreOlderButton.tsx
    - src/ui/features/pretty-view/LoadMoreOlderButton.test.tsx
  modified: []

key-decisions:
  - "Idle-state glyph: ChevronUp (from lucide-react) — matches the semantic of 'load messages above'."
  - "Error-state glyph: AlertCircle (from lucide-react) — same as AttachmentChipStrip's error affordance; keeps the pretty-view error vocabulary consistent."
  - "Idle-state visible label: 'Load older messages' (matches aria-label verbatim so screen reader and visual reader see the same string). Error-state visible label: 'Retry'."
  - "Wrapper classes: `flex justify-center py-2` — horizontally-centered, small vertical padding; Plan 04 can override via optional `className` prop without editing this component."
  - "Optional `className` prop added on the wrapper (not required by tests). Kept the seam for Plan 04's mount-site alignment tweaks."

patterns-established:
  - "Pattern: tri-branch aria-label — same string on wrapper `role=\"status\"` AND on the Button, so screen readers get consistent state whether the focus is on the region or the button."
  - "Pattern: comment discipline for grep-gated files — avoid mentioning forbidden identifiers (Loader2, useState, useEffect, useRef, useCallback) even in comments, so the acceptance-criteria grep gates stay strict."

requirements-completed: []

# Metrics
duration: 6min
completed: 2026-08-20
---

# Phase 47 Plan 02: LoadMoreOlderButton Summary

**Pure-props 3-state presentational component (idle/in-flight/error) using twin-arc spinner, ChevronUp/AlertCircle glyphs, and tri-branch aria-label — 7/7 tests green.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-20T02:10:44Z
- **Completed:** 2026-08-20T02:16:44Z
- **Tasks:** 2 (RED + GREEN)
- **Files created:** 2

## Accomplishments

- Shipped `LoadMoreOlderButton.tsx` — a zero-hooks pure-props component with three visible states, satisfying the presentational-purity contract (mirror `AsideBubble.tsx` L40-42).
- Shipped `LoadMoreOlderButton.test.tsx` — 7 tests locking behavior: no-lie null-return, idle click, in-flight disabled-guard, in-flight twin-arc SVG discrimination, error aria-label surface, error retry contract.
- Copied the twin-arc spinner SVG verbatim from `ComposeBox.tsx` L2551-2564 — both `d=` path values match byte-for-byte (patch #467 / commit df4d7543).
- Established the aria-label tri-branch pattern for LoadMoreOlderButton by mirroring `DormancyOverlay.tsx` L99-105 structure.

## Task Commits

Each task committed atomically per TDD RED/GREEN cycle:

1. **Task 1 (RED): 7 failing tests** — `f48c43cf` (test)
2. **Task 2 (GREEN): implementation** — `cd3867a9` (feat)

## Files Created/Modified

- `src/ui/features/pretty-view/LoadMoreOlderButton.tsx` — NEW; 166 lines; zero React hooks; three visible states + tri-branch aria-label; twin-arc spinner for in-flight (2 `<path>` children); ChevronUp for idle; AlertCircle for error retry.
- `src/ui/features/pretty-view/LoadMoreOlderButton.test.tsx` — NEW; 107 lines; 7 tests under one `describe("LoadMoreOlderButton")` block; factory-helper pattern (`makeProps`) copied from `AttachmentChipStrip.test.tsx` L9-15 shape.

## Decisions Made

### (a) Idle-state glyph

**Choice:** `ChevronUp` from `lucide-react`.
**Rationale:** Semantic match — the button loads messages *above* the current view. `History` was the alternative but it hints at "past sessions" rather than "content above the fold". `ChevronUp` reads as "reveal above" at a glance.

### (b) Error-state glyph

**Choice:** `AlertCircle` from `lucide-react`.
**Rationale:** Same glyph `AttachmentChipStrip.tsx` L164 uses for its error affordance. Keeps the pretty-view error vocabulary consistent — Ashley learns the glyph once and it means "this failed, and you can act on it".

### (c) Visible label strings

- **Idle:** `Load older messages` — matches aria-label verbatim so screen readers and sighted users converge on the same phrasing.
- **In-flight:** no visible text (twin-arc SVG only). aria-label carries `Loading older messages…`.
- **Error:** `Retry` — short + verb-first + action-oriented, per the "fail visibly" philosophy in 47-CONTEXT.md § Philosophy. aria-label carries the fuller `Couldn't load older messages — {error} — tap to retry`.

### (d) Wrapper classes for mounting-site alignment

**Chosen:** `flex justify-center py-2`.

**Rationale:** Horizontally-centered at the top of the scroll container (pretty-view convention is centered for chrome affordances vs. left/right-aligned for chat bubbles). `py-2` gives the button a small breathing room from the topmost message. Kept as an optional `className` prop so Plan 04 can override without editing the component — this is a common "mount-site alignment surprise" that the extra seam avoids.

## Deviations from Plan

None — plan executed exactly as written. Both RED and GREEN gates hit on first attempt; the only edits during Task 2 were removing two comment references (`Loader2`, `useState/useEffect/useRef/useCallback`) that were false-positive-triggering the acceptance-criteria grep gates. The intent of those comments is preserved via rewordings ("the lucide spinner" / "zero React hooks of any kind").

## Issues Encountered

**Worktree base drift** (resolved before task execution):

The worktree was created off `2d5da043` (upstream base) rather than `feat/tab-title-from-tmux` (the fork branch containing `src/ui/features/pretty-view/`). The plan-context said "the branch is `feat/tab-title-from-tmux`", so the worktree should have been rooted there. Resolved by `git reset --hard feat/tab-title-from-tmux` on the per-agent branch — this is a permitted operation on the per-agent `worktree-agent-*` branch (not a protected ref) and no prior work was on the branch to lose. After the reset, all Phase 47 planning docs + `pretty-view/` module were present. This did NOT trigger any of the destructive-git prohibitions (the branch was in the `worktree-agent-*` namespace, no protected ref was touched, no `git clean` was run).

## User Setup Required

None — pure component work, no environment or credential changes.

## Threat Flags

None — the component is purely presentational. The one prop-flow that touches a trust boundary is the `error` string interpolation into the aria-label, which is already registered as `T-47-07` in the plan's threat model with disposition `accept` (screen-reader text, no HTML surface, no XSS).

## Next Phase Readiness

**Plan 04 (Wave 2) consumer readiness:**
- Import: `import { LoadMoreOlderButton } from "./LoadMoreOlderButton"` and `import type { LoadMoreOlderButtonProps } from "./LoadMoreOlderButton"`.
- Mount site: sibling of `messages.map(...)` inside the scroll container, ABOVE the map (see 47-PATTERNS.md § "Button mount site").
- Wire: `<LoadMoreOlderButton hasOlder={...} status={loadOlderState} error={loadOlderError} onClick={handleLoadOlder} />`.
- Optional wrapper override: pass `className="..."` if Plan 04's scroll-container layout needs a different rhythm than `flex justify-center py-2`.

**Wave-1 coordination:**
- Zero file overlap with Plan 01 (sibling worktree). Plan 01 modifies `src/ui/api/claude-session-api.ts` wire types; this plan creates two new files in `src/ui/features/pretty-view/`. Merges should be conflict-free.

**No blockers.**

## Self-Check

**Files exist:**
- `src/ui/features/pretty-view/LoadMoreOlderButton.tsx` — FOUND
- `src/ui/features/pretty-view/LoadMoreOlderButton.test.tsx` — FOUND

**Commits exist:**
- `f48c43cf` — FOUND (test RED)
- `cd3867a9` — FOUND (feat GREEN)

**Verification commands:**
- `npx vitest run src/ui/features/pretty-view/LoadMoreOlderButton.test.tsx` → 7/7 passed
- `npx tsc --noEmit` → exit 0 (no output)

**Acceptance-criteria grep gates (all pass):**
- Task 1 test file: 7 `it(` blocks; twin-arc discriminator present; 0 `Loader2` references
- Task 2 component file: 1 `export function`; 1 `export type`; 0 hooks; 0 `Loader2`; both twin-arc `d=` values present; 1 `role="status"`

## TDD Gate Compliance

- **RED gate:** `f48c43cf` `test(47-02): add 7 failing tests for LoadMoreOlderButton (RED)` — 7 tests failed with module-not-found before implementation existed. ✓
- **GREEN gate:** `cd3867a9` `feat(47-02): implement LoadMoreOlderButton — pure-props 3-state (GREEN)` — 7/7 tests pass after implementation. ✓
- **REFACTOR gate:** N/A — no refactor commit needed; the component landed in shippable shape.

**Self-Check: PASSED**

---
*Phase: 47-load-more-button-in-prettyview-manual-reveal-of-older-messag*
*Completed: 2026-08-20*
