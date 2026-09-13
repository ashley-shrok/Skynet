---
phase: 110-global-throttle-on-identity-birth-flow-new-module-wrapping-b
plan: "04"
subsystem: docs
tags: [coordinator-instructions, spawn-requests, identity-birth, throttle, documentation]

# Dependency graph
requires:
  - phase: 110-global-throttle-on-identity-birth-flow-new-module-wrapping-b
    provides: "global-throttle.ts module (plan 01), HTTP integration (plan 02), worker integration (plan 03)"
provides:
  - "Coordinator-facing documentation noting batch spawn-request drops are safe (must-have 9)"
affects: [substrate-distributor, coordinator-identities]

# Tech tracking
tech-stack:
  added: []
  patterns: ["doc update to coordinator-instructions.md distributed via substrate distributor; no per-host manual push needed"]

key-files:
  created: []
  modified:
    - substrate/skills/id/coordinator-instructions.md

key-decisions:
  - "Placed batch-drop-safe note after the mkdir -p line and before the '### Wait for the response file' heading — matches callout style of surrounding ⚠️ paragraphs"
  - "Referenced Phase 110 and global-throttle.ts by path so readers can trace the mechanism"

patterns-established:
  - "Batch-drop-safe callout pattern: ⚠️ bold lead, mechanism reference by Phase + file path, closing no-manual-action sentence"

requirements-completed: []

# Metrics
duration: 5min
completed: 2026-09-13
---

# Phase 110 Plan 04: Coordinator-instructions batch-drop-safe note Summary

**Batch-drop-safe callout added to coordinator-instructions.md — coordinators no longer need to manually space spawn-request drops because Phase 110's global throttle paces births internally**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-09-13T19:44:48Z
- **Completed:** 2026-09-13T19:44:53Z
- **Tasks:** 1 of 1
- **Files modified:** 1

## Accomplishments

- Inserted a new ⚠️ **Batch drops are safe** paragraph in `substrate/skills/id/coordinator-instructions.md` inside the "Drop the request file" section, immediately before the "### Wait for the response file" heading (lines ~270-277 post-edit).
- Paragraph references Phase 110 (`src/backend/identity-birth/global-throttle.ts`) so coordinators and future readers can trace the throttle mechanism.
- No surrounding content was rewritten — the edit is a single additive paragraph insertion; all existing ⚠️ callouts, code examples, and section headings are unchanged.

## Task Commits

1. **Task 1: Add batch-drop-safe note to coordinator-instructions.md** — `57adcafc` (docs)

**Plan metadata:** (committed below with SUMMARY.md)

## Files Created/Modified

- `substrate/skills/id/coordinator-instructions.md` — Added 8 lines: one blank line, the ⚠️ **Batch drops are safe** paragraph (6 lines), one blank line before the next section heading. Line count went from 442 to 450. Note lands at the insertion point after `mkdir -p ~/fleet/spawn-requests` and before `### Wait for the response file`.

## Decisions Made

- The paragraph was placed immediately after the `mkdir -p` sentence (end of the "Drop the request file" section body) and before the next `###` heading — this is the natural reading position where a coordinator has just learned how to write files and needs to know that writing many is safe.
- Wording follows the existing ⚠️ bold-lead callout convention (matching `⚠️ **Write atomically**` and `⚠️ **Never pretty-print the JSON.**` above it).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The substrate distributor picks up the updated `coordinator-instructions.md` on its next sweep to every managed host. No manual per-host push is needed.

## Next Phase Readiness

Phase 110 is now complete — all four plans have SUMMARY.md:

- 110-01: global-throttle.ts module (Wave 1)
- 110-02: HTTP route integration (Wave 1)
- 110-03: spawn-request worker integration (Wave 1)
- 110-04: coordinator-instructions doc note (Wave 2, this plan)

Must-have 9 ("Batch drops are safe" documentation note) is satisfied. No blockers.

## Self-Check: PASSED

- `substrate/skills/id/coordinator-instructions.md` — FOUND
- `110-04-SUMMARY.md` — FOUND
- Commit `57adcafc` — FOUND in git log

---
*Phase: 110-global-throttle-on-identity-birth-flow-new-module-wrapping-b*
*Completed: 2026-09-13*
