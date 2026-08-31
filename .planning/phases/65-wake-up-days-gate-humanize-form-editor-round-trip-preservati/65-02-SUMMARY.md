---
phase: 65-wake-up-days-gate-humanize-form-editor-round-trip-preservati
plan: "02"
subsystem: frontend
tags: [wakeup, form-editor, days-gate, round-trip, WakeupsTab, tdd, vitest, chip-ui]

requires:
  - "65-01: humanizer days-gate extension (independent but conceptually paired)"

provides:
  - "FormSchedule discriminated union extended with days?: Weekday[] on interval/daily/weekly variants"
  - "normalizeDays helper: defensive normalization from unknown to Weekday[] | undefined"
  - "hydrateFormSchedule reads and normalizes s.days on interval/daily/weekly branches"
  - "buildSchedule emits days key only when non-empty non-full-7 (D-02 + D-04)"
  - "RestrictToDaysChips sub-component: 7-chip pill row mounted on daily + weekly variants"
  - "5 new tests (8-12) covering SC #2, SC #3, D-02, D-03, D-04, D-06, D-07"

affects:
  - "WakeupsTab.tsx: all users of the form editor see the new chip row and round-trip behavior"

tech-stack:
  added: []
  patterns:
    - "normalizeDays: unknown → Weekday[] | undefined (undefined = no-gate) — same semantic as Plan 65-01's normalizeDaysGate but for the frontend round-trip path"
    - "RestrictToDaysChips: file-private React sub-component, role=group, 7 aria-pressed pill buttons, hue-tinted inline style when selected"
    - "TDD RED/GREEN: failing tests committed first (fd140dd7), implementation makes all pass (d5321a9d)"

key-files:
  created: []
  modified:
    - src/ui/features/pretty-view/WakeupsTab.tsx
    - src/ui/features/pretty-view/WakeupsTab.test.tsx

key-decisions:
  - "D-02: full-7 days array treated as no-gate — normalizeDays returns undefined for size===7; buildSchedule drops the field"
  - "D-03: canonical mon→sun order enforced by WEEKDAY_VALUES.filter(seen.has) in normalizeDays on both read and write paths"
  - "D-04: empty subset is valid — normalizeDays returns undefined for size===0; buildSchedule drops field; validateForm unchanged"
  - "D-06: chip UI uses hsla(hue, 60%, 50%, 0.35/0.55) inline style when selected, bg-slate-500/10 Tailwind when deselected; matches existing enabled-chip family at L354-362"
  - "D-07: hydrateFormSchedule defensively filters non-string entries, lowercases+trims strings, filters through isWeekday allowlist, deduplicates via Set — malformed s.days cannot produce XSS or crash"
  - "chip row mounted AFTER timezone hint in both daily and weekly variant blocks; NOT on interval (out of scope) or one_shot (nonsensical)"
  - "onChange collapses empty nextArr to undefined so formSchedule.days is absent (not []) when all chips deselected; normalizeDays on write also handles [] → undefined as a second defense"

requirements-completed: []

duration: 7min
completed: "2026-08-31"
---

# Phase 65 Plan 02: Form editor days-gate round-trip + chip UI Summary

**FormSchedule extended with days?: Weekday[] on interval/daily/weekly; normalizeDays helper + RestrictToDaysChips sub-component add defensive round-trip preservation and a 7-chip pill UI on daily/weekly variants — fixing the DATA LOSS bug where opening a weekdays-only wakeup and pressing Save stripped the days gate**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-08-31T13:08:32Z
- **Completed:** 2026-08-31T13:16:06Z
- **Tasks:** 2 (RED test + GREEN implementation)
- **Files modified:** 2

## Accomplishments

- Extended `FormSchedule` discriminated union with `days?: Weekday[]` on interval/daily/weekly variants; one_shot unchanged
- Added `normalizeDays(raw: unknown): Weekday[] | undefined` — defensive normalizer: rejects non-array, per-entry lowercase+trim, filters through `isWeekday` (WEEKDAY_VALUES allowlist), deduplicates via Set, sorts canonical mon→sun, returns undefined for empty or full-7 (D-02+D-04 symmetry)
- Added `cap(s: string): string` helper for chip label capitalization
- Updated `hydrateFormSchedule` — reads `s.days` via `normalizeDays` in all three interval/daily/weekly branches; conditionally attaches `days` to return object (D-03 canonical normalization on read)
- Updated `buildSchedule` — re-runs `normalizeDays(fs.days)` in all three branches; emits `days` key only when non-undefined (D-02: full-7 drop; D-04: empty drop)
- Added `RestrictToDaysChips` sub-component: `role="group" aria-label="Restrict to days of week"`, 7 pill buttons with `aria-label="Toggle {Day}"` and `aria-pressed={selected}`, hue-tinted inline style when selected, `bg-slate-500/10 text-slate-400 border-slate-500/25` when deselected (D-06)
- Mounted chip row under daily variant (after timezone hint) and weekly variant (after timezone hint); NOT mounted on interval or one_shot
- `validateForm` left unchanged — D-04 says empty subset is valid (no blocking check needed)
- 5 new tests (8-12) in `WakeupsTab.test.tsx`: SC #2 round-trip, SC #3 chip-toggle-to-build, D-02 full-7-drop, D-04 empty-subset-drop + aria-pressed pre-condition, D-03 defensive hydrate normalization
- All 12 tests (7 pre-existing + 5 new) pass; `npm run build:backend && npm run build` exit 0

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — failing unit tests** - `fd140dd7` (test)
2. **Task 2: GREEN — FormSchedule + chip UI** - `d5321a9d` (feat)

## Files Created/Modified

- `src/ui/features/pretty-view/WakeupsTab.tsx` — FormSchedule extended, normalizeDays+cap helpers added, hydrateFormSchedule+buildSchedule updated, RestrictToDaysChips sub-component added, mounted on daily+weekly variants
- `src/ui/features/pretty-view/WakeupsTab.test.tsx` — enterEditMode helper added, tests 8-12 appended, existing 7 tests unmodified

## Decisions Made

- `normalizeDays` used symmetrically on both read (hydrate) and write (build) paths so the drop rules (D-02 full-7, D-04 empty) apply identically in both directions — this is the key pattern that makes round-trip fidelity automatic
- `onChange` in `RestrictToDaysChips` passes `undefined` when `nextArr.length === 0` so the formSchedule state keeps `days` absent rather than `[]`; normalizeDays on buildSchedule also handles `[]` → undefined as second defense
- `cap()` helper kept file-private alongside `normalizeDays` (not exported) — matches the Plan 65-01 pattern of file-private helpers

## Deviations from Plan

None — plan executed exactly as written. All mustHaves and aria-label contracts implemented as specified.

## Threat Surface Scan

No new threat surface introduced.
- `normalizeDays` filters `s.days` through the `isWeekday` WEEKDAY_VALUES allowlist (7-string set) — no user-supplied text reaches JSX output; T-65-03 mitigated
- `RestrictToDaysChips` chip labels are `cap(d)` where `d ∈ WEEKDAY_VALUES` (hardcoded); React auto-escapes; no `dangerouslySetInnerHTML`; T-65-04 mitigated

## Self-Check: PASSED

- FOUND: src/ui/features/pretty-view/WakeupsTab.tsx
- FOUND: src/ui/features/pretty-view/WakeupsTab.test.tsx
- FOUND: .planning/phases/65-wake-up-days-gate-humanize-form-editor-round-trip-preservati/65-02-SUMMARY.md
- FOUND: commit fd140dd7 (RED test)
- FOUND: commit d5321a9d (GREEN feat)
- 12/12 tests pass verified
- npm run build:backend && npm run build exit 0 verified
