---
phase: 72-feature-02-slice-2-reconcile-loop
plan: 01
subsystem: backend/distributor
tags: [catalog, fleet-substrate, tdd, pure-data]
requires: []
provides:
  - src/backend/distributor/catalog.ts
  - CatalogEntry type
  - FLEET_SUBSTRATE_CATALOG constant (19 rows)
affects:
  - Later plans in phase 72 (Plans 02–04) iterate over FLEET_SUBSTRATE_CATALOG
tech-stack:
  added: []
  patterns:
    - Pure-lib discipline (no I/O, no imports) — mirrors src/backend/fleet-status/liveness-check.ts split
key-files:
  created:
    - src/backend/distributor/catalog.ts
    - src/backend/distributor/catalog.test.ts
  modified: []
decisions:
  - Per-file rows (not per-item): 19 rows for 15 conceptual items so Plan 03's byte-compare works file-by-file
  - Mode not declared per entry: git IS the source of truth; push helpers read mode from bundled disk at push time
  - Zero runtime imports in catalog.ts: data + type only, keeps the module trivially testable and impossible to accidentally depend on
metrics:
  duration: ~10 minutes
  completed: 2026-09-04
---

# Phase 72 Plan 01: Fleet-Substrate Catalog Summary

Hand-maintained TypeScript catalog of the 15 fleet-substrate items (across 19 files) that the sweep in later plans of phase 72 will reconcile onto managed hosts.

## What Landed

- `src/backend/distributor/catalog.ts` — pure data module exporting:
  - `interface CatalogEntry { slug, bundledPath, installPath, restartHook }`
  - `const FLEET_SUBSTRATE_CATALOG: readonly CatalogEntry[]` with 19 entries
  - Top-of-file docblock cross-referencing 72-CONTEXT.md and explaining the pure-lib discipline + mode-preservation contract + restart-hook verbatim-pass invariant
- `src/backend/distributor/catalog.test.ts` — 7 structural tests (all green)

## Row Count (19 rows, 15 conceptual items)

| Section | Rows | Breakdown |
|---|---:|---|
| id skill | 4 | SKILL.md + actor-status-prompt.md + clone-picker-prompt.md + coordinator-instructions.md |
| agent-relay skill | 2 | SKILL.md + recv.sh |
| Single-file skills | 7 | backlog, bounty, claude-code-harness-auth, next-bounty, promote-to-coordinator, queue, role |
| Helper scripts | 6 | agent-supervisor, wakeup-scheduler, context-watch, usage-reporter, install-usage-reporter, claude-usage-collector |
| **Total** | **19** | 13 skill-side + 6 scripts-side |

## Restart Hooks

Exactly one entry has a non-null `restartHook`: **agent-supervisor** → `agent-supervisor.service`. All other 18 entries carry `restartHook: null` (skills pick up bytes on next identity reload; on-demand scripts pick up bytes on next invocation; KillMode=process makes the supervisor restart safe per feature-02 doc).

## Verification Evidence

Scoped test run (from acceptance criteria):

```
npx vitest run src/backend/distributor/catalog.test.ts

Test Files  1 passed (1)
     Tests  7 passed (7)
  Duration  2.75s
```

Source-level acceptance criteria (all pass):
- `grep -c "^export const FLEET_SUBSTRATE_CATALOG" catalog.ts` → **1** ✓
- `grep -c "^export interface CatalogEntry" catalog.ts` → **1** ✓
- non-comment `"agent-supervisor.service"` occurrences → **1** ✓
- non-comment `/app/fleet-substrate/` occurrences → **19** ✓
- `grep -c "^import" catalog.ts` → **0** ✓

Plan-level verification:
- `ls src/backend/distributor/` → exactly `catalog.test.ts` and `catalog.ts` ✓
- `npx tsc --noEmit --project tsconfig.node.json` on catalog.ts → no errors introduced ✓

## Deviations from Plan

**None.** The 19-row enumeration and per-file breakdown in the plan's `<action>` block matched the on-disk `substrate/skills/` (13 files across 9 dirs) and `substrate/scripts/` (6 executable files) exactly. All 6 script bundled files have mode 755 as slice 1 established, so Test 7 passes cleanly on the dev machine.

## TDD Gate Compliance

RED gate: `c1dc374f` — `test(72-01): add failing structural tests` (verified failing before catalog.ts existed: `Cannot find module './catalog.js'`)

GREEN gate: `24bf6755` — `feat(72-01): implement fleet-substrate catalog (19 rows, 15 items)` (verified all 7 tests pass)

No REFACTOR commit — the initial GREEN implementation was already clean and readable (no duplication, single-responsibility rows, docblock covers all cross-references).

## Pure-Lib Confirmation

`catalog.ts` has **zero runtime imports**. `grep -c "^import" src/backend/distributor/catalog.ts` returns `0`. The module is data + type declarations only, matching the discipline established by `src/backend/fleet-status/liveness-check.ts` (though liveness-check does have utility imports — catalog.ts is stricter).

## Commits

| Hash | Type | Message |
|---|---|---|
| `c1dc374f` | test | add failing structural tests for fleet-substrate catalog |
| `24bf6755` | feat | implement fleet-substrate catalog (19 rows, 15 items) |

## Self-Check: PASSED

- `[ -f src/backend/distributor/catalog.ts ]` → FOUND
- `[ -f src/backend/distributor/catalog.test.ts ]` → FOUND
- `git log --oneline | grep c1dc374f` → FOUND
- `git log --oneline | grep 24bf6755` → FOUND
