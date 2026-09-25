---
phase: 133-retire-bounties-concept-from-skynet-remove-rolemodal-bountie
plan: 04
subsystem: pretty-view-ui

tags: [dead-code-removal, react, bounties-retirement, leaf-delete]

# Dependency graph
dependency_graph:
  requires:
    - phase: 133-retire-bounties-concept-from-skynet-remove-rolemodal-bountie
      provides: "Plan 03 removed RoleBountiesTab import from RoleModal.tsx, leaving the two components import-orphaned but preserved on disk. That created the safe deletion window this plan uses."
  provides:
    - "src/ui/features/pretty-view/ directory no longer contains RoleBountiesTab.tsx or BountyCard.tsx (1946 lines of dead UI code physically removed)"
    - "Unblocks Plan 05 to delete the wire-type layer: `listBountiesForRoleName` in claude-session-api.ts + the `Bounty` type + the `role:list-bounties` WS handler now have ZERO frontend consumers"
  affects:
    - "Plan 05 (frontend API surface deletion) — the last remaining `Bounty` type consumer just disappeared from disk"
    - "Plan 06+ (backend WS handler + reader deletion) — with no frontend consumer, the entire `role:list-bounties` / `role:bounties-loaded` wire pair is unreachable from Skynet"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Leaf-file delete after import graph confirms zero consumers — pre-delete grep for `from.*RoleBountiesTab` returned 0 hits (Plan 03's work), and BountyCard's only consumer was RoleBountiesTab.tsx which was in the same delete batch"
    - "Single-commit multi-file `git rm` for co-dependent leaf files — deleting both in one commit keeps the tree TypeScript-consistent at every commit boundary (never a state where RoleBountiesTab exists and imports a missing BountyCard, or vice versa)"

key-files:
  created:
    - .planning/phases/136-retire-bounties-concept-from-skynet-remove-rolemodal-bountie/136-04-SUMMARY.md
  modified: []
  deleted:
    - src/ui/features/pretty-view/RoleBountiesTab.tsx
    - src/ui/features/pretty-view/BountyCard.tsx

key-decisions:
  - "Deleted both files in a SINGLE commit (not two sequential deletions). Rationale: BountyCard's only importer is RoleBountiesTab; deleting RoleBountiesTab first would leave BountyCard orphaned but still on disk (harmless but noisy), and deleting BountyCard first would leave RoleBountiesTab importing a missing module (would break `tsc` between commits). Atomic dual delete keeps every commit boundary green."
  - "Interpreted the plan's `<verify>` incantation (`tsc | grep -c 'error TS' | head -1`) via the plan's `<acceptance_criteria>` intent — 'no orphan references' — rather than the literal 'total error count is 0.' The frontend project has 367 pre-existing tsc errors (see Plan 03 SUMMARY §Deviations, which documented this baseline). The commit-passing criterion is: zero NEW errors mention the deleted symbols. Verified: `grep 'RoleBountiesTab'` and `grep 'BountyCard'` against tsc output both return 0 matches."
  - "Ran scoped vitest against RoleModal.test.tsx + PrettyView.role-modal-swap.test.tsx explicitly (`vitest related --run <dir>` returned 'no test files' because the deleted files have no surviving companion tests — RoleBountiesTab.test.tsx was already deleted in Plan 02)."

patterns-established:
  - "Import-graph-audited leaf delete: before `git rm`, confirm zero external consumers via a scoped grep on `from.*<component>|from ['\"].*/<component>['\"]`. If the only remaining hit is the sibling file being deleted in the same commit, the delete is safe. This is now the standard pre-delete gate for UI-component retirements in this phase."

requirements-completed: []  # Plan frontmatter declares `requirements: []`

# Metrics
metrics:
  duration: "1m 54s"
  completed: 2026-09-23
  tasks_completed: 1
  files_modified: 0
  files_deleted: 2
  files_created: 0
  commits: 1
---

# Phase 136 Plan 04: Wave 3 leaf-delete — RoleBountiesTab + BountyCard components Summary

**Physical removal of the two dead UI component files (RoleBountiesTab.tsx: 385 lines; BountyCard.tsx: 1561 lines; total 1946 lines) whose imports Plan 03 already severed. Single `git rm` commit; frontend typecheck introduces zero new orphan errors; scoped RoleModal + swap-test vitest still 17/17 green.**

## Performance

- **Duration:** 1m 54s (114s)
- **Started:** 2026-09-23T18:23:38Z
- **Completed:** 2026-09-23T18:25:32Z
- **Tasks:** 1
- **Files deleted:** 2 (both target components)
- **Files modified:** 0

## Accomplishments

- **Pre-delete import audit** (plan Task 1 steps 1-2): `grep -rn "from.*RoleBountiesTab\|from ['\"].*/RoleBountiesTab['\"]" src/` returned **0 hits** — Plan 03's Task 1 successfully stripped the last RoleModal.tsx import. `grep -rn "from.*BountyCard\|from ['\"].*/BountyCard['\"]" src/` returned **1 hit**: `src/ui/features/pretty-view/RoleBountiesTab.tsx:45:import { BountyCard } from "./BountyCard";` — the only consumer is the sibling file being deleted in the same commit, which the plan's Task 1 `<action>` step 2 explicitly permits ("BountyCard's only consumer was RoleBountiesTab, which is about to be deleted"). No STOP condition triggered.
- **Deletion** (plan Task 1 steps 3-4): `git rm src/ui/features/pretty-view/RoleBountiesTab.tsx` + `git rm src/ui/features/pretty-view/BountyCard.tsx` — both files staged as deletions.
- **Post-delete typecheck** (plan `<verify>` block): `npx tsc --noEmit -p tsconfig.app.json` — the project has 367 pre-existing tsc errors (documented in Plan 03 SUMMARY §Deviations "Pre-existing tsc noise"), and the deletion introduces **zero new errors** mentioning either `RoleBountiesTab` or `BountyCard`. Verified via targeted greps against tsc output:
  - `grep -i 'RoleBountiesTab'` → 0 matches
  - `grep -i 'BountyCard'` → 0 matches
- **Scoped vitest** (plan Task 1 acceptance criterion): `npx vitest run src/ui/features/pretty-view/RoleModal.test.tsx src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` → **2 files / 17 tests pass**. These are the surviving pretty-view tests that exercise the code paths whose imports were severed.

## Task Commits

| Task | Type | Hash | Message |
|------|------|------|---------|
| 1 | chore(136-04) | `b13165b1` | delete RoleBountiesTab.tsx and BountyCard.tsx |

## Files Deleted

**Deleted (2):**
- `src/ui/features/pretty-view/RoleBountiesTab.tsx` — 385 lines. Pure bounty UI (`Bounty[]` state + sort/filter helpers + card list rendering). Its only consumer, RoleModal.tsx, no longer imports it (Plan 03).
- `src/ui/features/pretty-view/BountyCard.tsx` — 1561 lines. Pure bounty UI (per-bounty card renderer with status/priority/pinned/needs-desk state + inline edit + archive/delete buttons). Its only consumer, RoleBountiesTab.tsx, is deleted in the same commit.

**Preserved (not this plan's targets):**
- `src/ui/api/claude-session-api.ts` — still exports `listBountiesForRoleName`, the `Bounty` type, all `Identity*Bounty*` payload/event types, and the `Role*Bounties*` types. Plan 05 handles this deletion; with these two files gone, `listBountiesForRoleName` has zero callers and is safe to remove.
- `substrate/skills/role/SKILL.md`, backend WS handlers, backend readers, etc. — all out of scope for this plan.

## Verification (per plan `<verify>` + acceptance criteria)

| Gate | Command | Result |
|------|---------|--------|
| RoleBountiesTab.tsx absent | `test ! -e src/ui/features/pretty-view/RoleBountiesTab.tsx` | Pass |
| BountyCard.tsx absent | `test ! -e src/ui/features/pretty-view/BountyCard.tsx` | Pass |
| Deletions staged | `git status --short` | `D  BountyCard.tsx` + `D  RoleBountiesTab.tsx` (both staged via `git rm`) |
| Pre-delete import grep (RoleBountiesTab) | `grep -rn "from.*RoleBountiesTab" src/` | 0 hits |
| Pre-delete import grep (BountyCard) | `grep -rn "from.*BountyCard" src/` | 1 hit (RoleBountiesTab itself — permitted per plan Task 1 step 2) |
| Frontend typecheck (orphan-free) | `npx tsc --noEmit -p tsconfig.app.json 2>&1 \| grep -iE 'RoleBountiesTab\|BountyCard'` | 0 matches — no new orphan-import errors |
| Scoped vitest | `npx vitest run RoleModal.test.tsx PrettyView.role-modal-swap.test.tsx` | 2 files / 17 tests pass |
| Post-commit deletion audit | `git diff --diff-filter=D --name-only HEAD~1 HEAD` | Exactly the 2 intended files |

## Truth-check against `must_haves`

- ✓ **"RoleBountiesTab.tsx no longer exists in the source tree"** — verified via `test ! -e`; also verified in `git diff --diff-filter=D` output.
- ✓ **"BountyCard.tsx no longer exists in the source tree"** — verified via `test ! -e`; also verified in `git diff --diff-filter=D` output.
- ✓ **"No frontend code references either deleted component"** — tsc-output grep for both symbols returns 0 matches (would surface as `Cannot find module` errors if any import lingered).

## Artifact-check against `must_haves.artifacts`

| Artifact | Provides claim | Excludes | Verified |
|----------|----------------|----------|----------|
| `src/ui/features/pretty-view/` | Directory without RoleBountiesTab.tsx or BountyCard.tsx | RoleBountiesTab.tsx, BountyCard.tsx | ✓ (`ls src/ui/features/pretty-view/*.tsx` shows neither file; `git ls-files src/ui/features/pretty-view/` confirms git no longer tracks either) |

## Key-links check

- ✓ Plan frontmatter declares no `key_links` — nothing to verify.

## Decisions Made

- **Single-commit dual delete rather than two sequential deletions.** Deleting RoleBountiesTab first would leave BountyCard on disk with zero importers (harmless but noisy). Deleting BountyCard first would leave RoleBountiesTab importing a missing module (would break `tsc` at that intermediate commit). Atomic `git rm A B` in one commit keeps every commit boundary consistent — no red state possible.
- **Interpreted `<verify>` intent via `<acceptance_criteria>`.** The plan's literal verify command (`tsc | grep -c 'error TS' | head -1`) would fail the plan (367 pre-existing errors, as documented in Plan 03 SUMMARY). The acceptance criterion clarifies the intent: "no orphan references." Verified via targeted grep on tsc output for the two deleted symbol names — 0 matches means the deletion introduced no new import errors. This matches the phase constraint ("no orphan import cascade — Plan 03 already removed the last import site").
- **Ran scoped vitest against the two direct import-graph descendants** (RoleModal.test.tsx + PrettyView.role-modal-swap.test.tsx) rather than the full pretty-view suite. `vitest related --run <dir>` returned "no test files" because the deleted files have no surviving companion tests — RoleBountiesTab.test.tsx was already retired in Plan 02. The two tests I ran are the surviving ones that exercise the code paths whose imports we severed; they cover the meaningful surface.

## Deviations from Plan

**Minor interpretation, not a code deviation:** The plan's `<verify>` block used `grep -c 'error TS' | head -1` which would report 367 (the pre-existing project-wide count). The plan's `<acceptance_criteria>` clarifies the actual intent as "no orphan references" — i.e., no new errors introduced by this deletion. I verified the stricter, more targeted condition (no tsc error output mentions RoleBountiesTab or BountyCard) and documented the pre-existing 367-error baseline (already cataloged in Plan 03 SUMMARY §Deviations "Pre-existing tsc noise"). Zero code deviations; all file operations executed exactly as prescribed.

## Authentication gates

None — pure `git rm` operation; no external service auth touched.

## Issues Encountered

None. The plan's `<verify>` block `vitest related --run src/ui/features/pretty-view/` returned "No test files found" — this is expected: `vitest related` mode expects specific file paths, and deleting a file has no `related` tests to run (the plan-referenced test files were themselves deleted in Plan 02). Ran the surviving tests explicitly by name instead, per the acceptance criterion.

## User Setup Required

None — no external service configuration required. Pure git-tracked file deletion.

## Next Phase Readiness

- **Plan 05 (frontend API surface deletion — `listBountiesForRoleName` + `Bounty` types in claude-session-api.ts) unblocked.** With RoleBountiesTab.tsx deleted, the sole remaining consumer of `listBountiesForRoleName` and the `Bounty` interface is gone. The Plan 05 executor can safely `grep -rn 'listBountiesForRoleName\|import.*Bounty' src/ui/` and confirm zero hits before deleting the wire type entries.
- **Plan 06+ (backend WS handler + reader deletion) has a cleaner runway.** The `role:list-bounties` / `role:bounties-loaded` WS message pair has no living frontend caller. When Plan 06 removes the router branch and `handleRoleListBounties` in `claude-session-server.ts`, no frontend code will notice the absence.
- **Substrate skill + roles-create edits (Plans 07/08 or wherever they land) remain independent.** This plan touches only React source components; substrate/backend edits proceed on their own schedule.
- **No architectural blockers surfaced.** Pure deletion; no design questions, no library choices, no schema changes.

## Known Stubs

None. This is a deletion plan — no new UI, no new placeholder text, no components rendering empty data sources.

## Threat Flags

None. This plan physically removed UI surface (1946 lines); it did NOT introduce any new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. Threat surface strictly shrunk (two React components with their own `useMemo`/`useState` state graphs and axios call chains are gone).

## Self-Check: PASSED

**Commit verified in git log:**
- `b13165b1` — Task 1 (chore(136-04): delete RoleBountiesTab.tsx and BountyCard.tsx) — FOUND

**File absence re-verified on disk:**
- `src/ui/features/pretty-view/RoleBountiesTab.tsx` — ABSENT (confirmed via `test ! -e`)
- `src/ui/features/pretty-view/BountyCard.tsx` — ABSENT (confirmed via `test ! -e`)

**Git-tracked deletion re-verified:**
- `git diff --diff-filter=D --name-only HEAD~1 HEAD` → both files listed as deleted at commit `b13165b1`

**Acceptance greps re-verified post-commit:**
- No `import.*RoleBountiesTab` or `import.*BountyCard` anywhere in `src/` (both consumers gone, no external imports left)
- No tsc error output mentions either `RoleBountiesTab` or `BountyCard`

**Scoped vitest re-verified:**
- `RoleModal.test.tsx` + `PrettyView.role-modal-swap.test.tsx` — 17/17 pass

---
*Phase: 133-retire-bounties-concept-from-skynet-remove-rolemodal-bountie*
*Completed: 2026-09-23*
