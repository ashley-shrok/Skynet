---
phase: 09-compose-box-redesign-2-tall-shell
plan: "01"
subsystem: ComposeBox / pretty-view
tags: [layout, jsx-restructure, compose-box, ui]
dependency_graph:
  requires: []
  provides:
    - ComposeBox 2-row shell layout (Row-3 chips, Row-1 instrument bar, Row-2 compose bar)
  affects:
    - src/ui/features/pretty-view/ComposeBox.tsx
tech_stack:
  added: []
  patterns:
    - "flex items-center gap-2 with min-h-[44px]/min-h-8 ternary for Row 1 touch-target"
    - "flex-1 aria-hidden spacer between meter and aux group"
    - "flex flex-row gap-1 for horizontal aux-button group (converted from flex-col)"
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
decisions:
  - "Meter well internals (w-7, self-stretch, flex-col, segment iteration) left completely unchanged — Plan 09-02 handles horizontal rotation"
  - "AttachmentChipStrip mounted unconditionally (DOM-first); component self-returns null when empty — no wrapper conditional needed (UPLOAD-04)"
  - "Send button moved from the old single-row to Row 2 only; aux buttons (paperclip, ThumbsUp, Queue) moved to Row 1 flex-row group"
  - "Math.max(2, ...) → Math.max(1, ...) for textarea rows floor per UI-SPEC Row 2 contract"
metrics:
  duration: "316s"
  completed: "2026-07-22"
  tasks: 1
  files: 1
---

# Phase 9 Plan 01: 2-Row Shell JSX Restructure Summary

**One-liner:** Restructured ComposeBox JSX into 2-row shell — Row-1 instrument bar (meter+spacer+aux) above Row-2 compose bar (textarea+send) — with chip strip DOM-first as ephemeral Row 3; all class values verbatim, all behaviors intact.

## Tasks

| # | Name | Commit | Status |
|---|------|--------|--------|
| 1 | Restructure ComposeBox JSX into 2-row shell | d3748ec | Complete |

## What Was Built

Rearranged the JSX inside `ComposeBox.tsx`'s `return()` from a single-row layout (`flex items-end gap-2` containing meter + textarea + icon column) into a two-stacked-row shell:

**Row 1 — Instrument bar** (`flex items-center gap-2`, `min-h-[44px]` on touch / `min-h-8` on desktop):
- Meter well `<div role="meter">` with reset cell — moved verbatim from the old single row. Internals (w-7, self-stretch, flex-col, segment iteration, drain animation) completely unchanged.
- `<div className="flex-1" aria-hidden="true" />` spacer — new; reserves room for future top-row buttons between meter and aux group.
- `<div className="flex flex-row gap-1">` aux-button group — contains paperclip (conditional), ThumbsUp, and Queue (Hourglass) buttons moved verbatim from the old `flex flex-col gap-1` column. Direction changed from flex-col to flex-row to fit the horizontal layout.

**Row 2 — Compose bar** (`flex items-end gap-2`):
- `<div className="relative flex-1 self-stretch">` textarea wrapper (with queueArmed overlay) — moved verbatim.
- Send `<Button size="icon-sm">` — moved from the old icon column into Row 2. All amber gradient classes preserved verbatim (VISUAL-08 HARD LOCK).

**Row 3 — Chip strip** (ephemeral, DOM-first above Row 1):
- `<AttachmentChipStrip>` stays in its existing position as the first child of the outer wrapper. Component self-returns null when empty — no conditional wrapper added.

**Also changed:** `Math.max(2, text.split("\n").length)` → `Math.max(1, ...)` (textarea rows floor drops to 1 per UI-SPEC Row 2 contract). Adjacent comment updated from "2 minimum, 6 maximum" to "1 minimum, 6 maximum".

**Block comment** above `return` updated from stale single-row description to the new 2-row shell layout with Row 1/Row 2/Row 3 nomenclature referencing UI-SPEC.md.

## Verification

All grep gates passed:

- `flex items-end gap-2` count: 1 (Row 2 only — within `^[12]$` range)
- `flex items-center gap-2` present (Row 1)
- `min-h-[44px]` present (Row 1 touch branch)
- `min-h-8` present (Row 1 desktop branch)
- `Math.max(1, text.split` present
- `flex-1" aria-hidden="true"` present (spacer)
- `flex flex-row gap-1` present (aux group)
- `bg-[rgba(10,12,20,0.5)]!` present (textarea — `!` load-bearing)
- `bg-[linear-gradient(180deg,rgba(28,30,40,0.55),rgba(18,20,28,0.62))]` present (outer wrapper)
- `bg-[linear-gradient(180deg,hsla(38,90%,66%,0.92),hsla(38,90%,44%,0.94))]` present (Send amber — VISUAL-08)
- `bg-[linear-gradient(180deg,hsla(38,55%,50%,0.9),hsla(38,60%,32%,0.95))]!` present (Queue armed — `!` load-bearing)
- `Math.max(2, text.split` absent (old floor removed)

10/10 ComposeBox.test.tsx tests pass. Typecheck clean.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes introduced. Pure client-side JSX rearrangement. All STRIDE mitigations from the plan's threat register confirmed satisfied by grep gates (T-09-01-01: `!` suffixes on both `bg-[rgba(10,12,20,0.5)]!` and queue armed gradient intact; T-09-01-02: event handlers untouched).

## Self-Check: PASSED

- [x] `src/ui/features/pretty-view/ComposeBox.tsx` modified and committed at d3748ec
- [x] Commit d3748ec exists in git log
- [x] 10/10 tests pass
- [x] Typecheck clean
