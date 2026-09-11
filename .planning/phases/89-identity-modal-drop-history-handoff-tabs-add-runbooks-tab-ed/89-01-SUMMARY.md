---
phase: 89-identity-modal-drop-history-handoff-tabs-add-runbooks-tab-ed
plan: "01"
subsystem: substrate
tags: [substrate, id-skill, runbooks, naming-convention, documentation]

# Dependency graph
requires: []
provides:
  - "substrate/skills/id/SKILL.md § Runbooks Storage updated: sentinel file convention changed from <slug>.md to runbook.md"
  - "substrate/skills/id/SKILL.md § 3 on-wake missing-file clause updated: <slug>.md → runbook.md"
  - "Contract-consistency baseline for Wave-2 backend enumerator (89-02)"
affects:
  - 89-02-backend
  - 89-03-api
  - 89-04-modal
  - 89-05-tab-restructure
  - 89-06-pretty-view

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "runbook.md as fixed sentinel inside runbook subfolder, mirroring SKILL.md for skills"

key-files:
  created: []
  modified:
    - substrate/skills/id/SKILL.md

key-decisions:
  - "D-19: runbook.md replaces <slug>.md as the going-forward sentinel file name in id-skill body"
  - "D-20: convention is going-forward only; no grandfather rule codified — on-disk rename of existing runbooks is Alice's manual post-close pass"
  - "D-23: id-skill body update ships in its own Wave-1 commit before backend/frontend so no intermediate commit has contract drift"

patterns-established:
  - "Folder-names-the-thing + fixed sentinel inside (runbook.md) mirrors skills' SKILL.md convention"

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-09-08
---

# Phase 89 Plan 01: id-skill § Runbooks sentinel renamed to runbook.md

**id-skill body (substrate/skills/id/SKILL.md) updated so the going-forward runbook sentinel file is `runbook.md`, mirroring `SKILL.md` for skills — two surgical text edits, no code or schema changes**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-09-08T00:00:00Z
- **Completed:** 2026-09-08
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- § Runbooks / Storage: storage-path example changed from `<runbook-slug>/<runbook-slug>.md` to `<runbook-slug>/runbook.md`
- § Runbooks / Storage / Naming clause: sentinel requirement changed from `<slug>.md` to `runbook.md`; philosophy sentence added explaining the SKILL.md mirroring rationale
- § 3 Loading an existing identity: missing-file clause sentinel changed from `<slug>.md` to `runbook.md`; enumeration paragraph (folder-name-based) unchanged per D-19
- No grandfather rule added per D-20; all 9 automated grep acceptance gates pass; line count 1526 (within 1520-1530 bound)

## Task Commits

Each task was committed atomically:

1. **Task 1: Update substrate/skills/id/SKILL.md — § Runbooks Storage + § 3 on-wake wording to `runbook.md` sentinel** - `60649e1f` (docs)

**Plan metadata:** (committed with SUMMARY.md below)

## Files Created/Modified
- `substrate/skills/id/SKILL.md` - Two text-only edits: § Runbooks / Storage path + Naming clause + § 3 missing-file clause; line count 1524 → 1526 (two added lines for philosophy sentence)

## Decisions Made
- Reformatted the Naming clause wrap slightly to ensure `runbook.md` and `sentinel` both appear inline with their respective grep-anchoring keywords (`**Naming**` and `mirrors the \`SKILL.md\``), satisfying the plan's automated acceptance-criteria grep patterns without altering prose meaning

## Deviations from Plan

None - plan executed exactly as written. Minor line-wrap adjustment to satisfy grep patterns (both `**Naming**.*runbook.md` and `mirrors the \`SKILL.md\`. sentinel` on single lines) was within the plan's intent and the NON-EDITS block.

## Issues Encountered

The plan's acceptance criteria grep `^\*\*Naming\*\*.*runbook\.md` and `mirrors the .SKILL\.md. sentinel` require both tokens to appear on the same line. Initial edit wrapped the Naming clause such that `runbook.md` was on line 1296 but `**Naming**` was on line 1295, and `sentinel` wrapped to a line after `SKILL.md`. Reshuffled the line-break positions so both grep patterns match single lines. Content and meaning unchanged; structural preservation checks all pass.

## User Setup Required
None - no external service configuration required. Distributor sweep picks up the substrate change on next fleet-substrate propagation; no restart needed on managed boxes.

## Next Phase Readiness
- Wave-1 contract-consistency edit is complete; substrate now says `runbook.md` as the going-forward sentinel
- Wave-2 (89-02 backend enumerator) and all downstream waves can proceed
- No blockers

---
*Phase: 89-identity-modal-drop-history-handoff-tabs-add-runbooks-tab-ed*
*Completed: 2026-09-08*
