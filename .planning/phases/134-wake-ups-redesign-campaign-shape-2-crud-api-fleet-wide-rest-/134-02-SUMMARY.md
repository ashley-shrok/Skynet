---
phase: 128-wake-ups-redesign-campaign-shape-2-crud-api-fleet-wide-rest-
plan: 02
subsystem: role-scope-wakeup-retirement
tags:
  - wakeups
  - removal
  - cleanup
  - role-scope-retirement
dependency_graph:
  requires:
    - Plan 134-01 (global /wakeups REST surface live before role-scope removal per D-14)
    - Phase 127 (per-role wake-up specs migrated fleet-wide + scheduler stopped reading role dirs)
  provides:
    - Zero live callers of the retired per-role wake-up CRUD surface
    - identity-artifact-reader.ts post-D-10 state (6 role-wakeup functions removed)
    - claude-session-server.ts post-D-11 state (8 role-wakeup WS handlers + JSDoc pruned)
    - claude-session-api.ts post-D-12 state (5 role-wakeup helpers + 16 payload/event types removed)
    - RoleModal.tsx post-D-09 state (role-wakeups tab + state + effects + callbacks removed)
    - Backend build + frontend build both clean at HEAD
    - Full scoped-test sweep across every touched file green (133 test files, 2134 pass)
  affects:
    - Fleet-wide UI cleanup surfaces — RoleModal no longer shows a Wakeups tab
    - WS wire protocol — 8 message types no longer accepted (server drops silently now; matches "stale tab" A1 assumption)
    - Frontend bundle size — dead-code path removed
tech_stack:
  added: []
  patterns:
    - Grep-first deletion (locate each symbol by name, delete definition body-through-closing-brace inclusive)
    - Wholesale-file-delete for tests whose every case targets a to-be-deleted symbol
    - Surgical excision for tests that mix retired + surviving coverage (audit each describe block; delete only the retired ones)
    - Comment-block retention as historical breadcrumbs (e.g., "Phase 134 Plan 134-02: X was retired here")
key_files:
  created: []
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts (-632 lines)
    - src/backend/claude-session/claude-session-server.ts (-1099 lines from handlers + prologues + JSDoc)
    - src/backend/claude-session/claude-session-server.role-reads.test.ts (surgical — Rule 3 mop-up per audit-miss, -99 lines)
    - src/ui/api/claude-session-api.ts (-669 lines from 4 helpers + 16 payload/event types + JSDoc)
    - src/ui/api/claude-session-api.role-reads.test.ts (surgical per plan D-13 R5+R6 audit, -63 lines)
    - src/ui/features/pretty-view/RoleModal.tsx (-121 lines from imports + state + effect + callbacks + JSX tab)
    - src/ui/features/pretty-view/RoleModal.test.tsx (Rule 3 blocker per audit-miss, -12 lines)
    - src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx (surgical per D-13 audit, -4 lines)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx (Rule 3 blocker per audit-miss, -4 lines)
  deleted_wholesale:
    - src/backend/claude-session/identity-artifact-reader.role-wakeups.test.ts (445 lines)
    - src/backend/claude-session/claude-session-server.role-wakeups.test.ts (425 lines)
    - src/backend/claude-session/claude-session-server.role-wakeup-crud.test.ts (365 lines)
    - src/ui/api/claude-session-api.role-wakeup-crud.test.ts (268 lines)
  untouched_kept_live:
    - src/ui/features/pretty-view/WakeupsTab.tsx (byte-identical — used by IdentityModal for per-identity wake-ups per D-09)
    - src/ui/features/pretty-view/IdentityModal.tsx (per-identity WakeupsTab mount preserved)
    - src/backend/claude-session/identity-artifact-reader.wakeup-crud.test.ts (per-identity wakeup CRUD test — D-13 explicit KEEP)
decisions:
  - D-09 WakeupsTab.tsx stays intact; RoleModal's tab + state + effects + callbacks + imports come out
  - D-10 6 backend service functions deleted from identity-artifact-reader.ts (plus deleteRoleWakeupByName as Rule 3 orphan cleanup — 7 total)
  - D-11 8 backend WS handlers deleted from claude-session-server.ts + wire-op JSDoc pruned + 6-name import block trimmed (plus deleteRoleWakeupByName consumer cleanup)
  - D-12 5 frontend API helpers + 16 payload/event types + JSDoc pruned from claude-session-api.ts; WakeupSpecWire STAYS
  - D-13 4 wholesale test-file deletions + 2 surgical audit-target edits per plan; 2 additional Rule 3 surgical edits (RoleModal.test.tsx + PrettyConversationsPanel.role-management-flow.test.tsx + claude-session-server.role-reads.test.ts) uncovered by scoped tests
  - D-14 sequencing satisfied — Plan 134-01 landed green before this plan started
metrics:
  duration: ~29 minutes
  completed_date: 2026-09-21
requirements: []
---

# Phase 134 Plan 134-02: Retire the per-role wake-up CRUD surface top-to-bottom — Summary

Deletion-only plan: 12 files touched (4 modified source + 5 surgical test edits + 4 wholesale test deletes + 0 new). Every retired symbol traced from its definition (backend service function -> WS handler -> frontend API helper -> UI consumer) and removed in dependency order per D-14. Backend + frontend builds clean at HEAD. Scoped test sweep across every touched file green.

## What Landed

### Task 1 — identity-artifact-reader.ts (D-10 + Rule 3 orphan)

Seven functions removed (six named in D-10 + one companion Rule 3):

- `readRoleWakeups` — Phase 72 Plan 01 two-step identity→role reader
- `readRoleWakeupsByName` — Phase 90 Plan 90-07 role-name-keyed reader
- `writeRoleWakeupUpdate` — Phase 72 Plan 01 two-step patch writer
- `writeRoleWakeupCreate` — Phase 72 Plan 01 two-step create-clobber-check
- `writeRoleWakeupDelete` — Phase 72 Plan 01 two-step idempotent unlink
- `writeRoleWakeupByName` — Phase 90 Plan 90-07 role-name-keyed create-or-update writer
- `deleteRoleWakeupByName` — Phase 90 Plan 90-07 role-name-keyed idempotent delete (Rule 3 auto-fix — not named in D-10 but its only consumer, `role:delete-wakeup`, comes out in Task 2)

Section header `6a2. writeRoleWakeupCreate` rewritten in-place to `6a2. Shared wake-up spec helpers` to reflect the two surviving occupants of that section (`normalizeWakeupSlug` + private `validateWakeupSpec`) — both consumed by `writeIdentityWakeupCreate` which stays.

**Kept live (verified via grep):** `humanizeWakeupSchedule`, `writeMarkdownFileAtomic`, `IDENTITY_SLUG_RE`, `isLocalHostId`, `normalizeWakeupSlug`, `validateWakeupSpec`, `getLocalWakeupsRoot` (added Plan 134-01), `getLocalIdentitiesRoot`, `getLocalRolesRoot`, `resolveRoleForIdentity`, `readIdentityWakeups`, `writeIdentityWakeupCreate`, `writeIdentityWakeupUpdate`, `writeIdentityWakeupDelete`.

**Commit:** `689ad7a4` (1 file, -632 net lines).

### Task 2 — claude-session-server.ts + 3 wholesale test-file deletes (D-11 + D-13 backend half)

Nine handler functions + their test seams deleted:

- `handleRoleListWakeups`, `handleRoleWriteWakeup`, `handleRoleCreateWakeup`, `handleRoleUpdateWakeup`, `handleRoleDeleteWakeup` (5 role-name-keyed handlers)
- `handleIdentityListRoleWakeups`, `handleIdentityUpdateRoleWakeup`, `handleIdentityCreateRoleWakeup`, `handleIdentityDeleteRoleWakeup` (4 identity role-scope handlers)
- Plus 9 `__*ForTests` seam exports.

Import block at L81+ trimmed of 7 names (readRoleWakeupsByName, readRoleWakeups, writeRoleWakeupUpdate, writeRoleWakeupCreate, writeRoleWakeupDelete, writeRoleWakeupByName, deleteRoleWakeupByName). The 4 role-scope dispatchers under the main WS handler (identity:list-/update-/create-/delete-role-wakeup) and the 4 role-name dispatchers (role:list-/create-/update-/delete-wakeup) both retired.

Wire-op JSDoc: removed 8 client-to-server entries and 8 server-to-client response-type entries from the top-of-file protocol block. Prologue blocks at L1625+ and L1987+ rewritten to describe only the survivors (role:get-file + role:list-bounties on the role-name side; identity:create-wakeup + identity:delete-wakeup on the identity-scope side).

**Rule 3 mop-up:** `claude-session-server.role-reads.test.ts` — the plan audit missed this file. It had the `role:list-wakeups WS handler` describe block (5 test cases) mixed alongside R1 (role:get-file) + R2 (role:list-bounties). Surgical treatment matching the plan-called-out audit files: removed the `describe` block + `readRoleWakeupsByName` mock/import/reset + `__handleRoleListWakeupsForTests` import. R1 + R2 blocks stay.

**Wholesale test-file deletes (D-13 backend, 3 of 4 total):**
- `identity-artifact-reader.role-wakeups.test.ts` (445 lines)
- `claude-session-server.role-wakeups.test.ts` (425 lines)
- `claude-session-server.role-wakeup-crud.test.ts` (365 lines)

**Verified kept live (D-13 explicit KEEP):** `identity-artifact-reader.wakeup-crud.test.ts` (per-identity wake-up CRUD — 7/7 pass throughout the plan).

**Commit:** `bc18bbcb` (5 files, -1903 net lines).

### Task 3 — claude-session-api.ts + 1 wholesale test-file delete + 1 surgical (D-12 + D-13 frontend half)

Five helpers removed (four named in D-12 + one Rule 3 orphan cleanup collapse):
- `listRoleWakeupsByName`
- `createRoleWakeupByName`
- `updateRoleWakeupByName`
- `deleteRoleWakeupByName`

Sixteen payload/event type declarations removed across two blocks:

**Identity role-scope quad (8 types):** `IdentityListRoleWakeupsPayload`, `IdentityRoleWakeupsEvent`, `IdentityUpdateRoleWakeupPayload`, `IdentityRoleWakeupUpdatedEvent`, `IdentityCreateRoleWakeupPayload`, `IdentityRoleWakeupCreatedEvent`, `IdentityDeleteRoleWakeupPayload`, `IdentityRoleWakeupDeletedEvent`.

**Role-name-keyed quad (8 types):** `RoleListWakeupsPayload`, `RoleWakeupsLoadedEvent`, `RoleCreateWakeupPayload`, `RoleWakeupCreatedEvent`, `RoleUpdateWakeupPayload`, `RoleWakeupUpdatedEvent`, `RoleDeleteWakeupPayload`, `RoleWakeupDeletedEvent`.

Discriminated-union `ClaudeSessionEvent` at ~L410 trimmed of the 4 identity role-wakeup event members. JSDoc header blocks at ~L710 and ~L1296 rewritten to reflect the retired scope. `WakeupSpecWire` STAYS at ~L729 — verified via `grep -c "^export type WakeupSpecWire"` -> 1.

**Wholesale delete (D-13 frontend, 1 of 4 total):** `src/ui/api/claude-session-api.role-wakeup-crud.test.ts` (268 lines).

**Surgical edit (D-13 frontend R5+R6 audit, per PATTERNS.md audit result):** `claude-session-api.role-reads.test.ts` — removed the `describe("listRoleWakeupsByName one-shot helper", ...)` block covering R5 + R6 (~L179-241 previously). R1 (`getRoleFileByName one-shot helper`, L57) + R3 (`listBountiesForRoleName one-shot helper`, L115) both STAY. Header docstring updated.

**Interim build status noted in commit body:** `npm run build` fails after Task 3 alone (RoleModal.tsx still imports the deleted helpers — cleaned in Task 4). `npm run build:backend` clean.

**Commit:** `5c37ebf1` (3 files, -669 net lines).

### Task 4 — RoleModal.tsx + 3 UI test surgical edits (D-09 + D-13 UI half)

`RoleModal.tsx` — the destination surface for D-09:

- Removed `AlarmClock` from the lucide-react import.
- Removed `WakeupsTab` from the local `./WakeupsTab` import (component itself STAYS byte-identical — IdentityModal keeps consuming it).
- Removed 6 symbols from the `@/api/claude-session-api` import: `listRoleWakeupsByName`, `createRoleWakeupByName`, `updateRoleWakeupByName`, `deleteRoleWakeupByName`, `type WakeupSpecWire`, `type Wakeup` — the last two removed after audit confirmed no other in-file references remained.
- Removed the `role-wakeups` `NAV_SECTIONS` entry (line 89 previously — bottom-nav is now 3 items: role / runbooks / bounties).
- Removed the `roleWakeupsState` state declaration + its `setRoleWakeupsState({status:"loading"})` reset in the mount effect.
- Removed the entire `void (async () => { ...listRoleWakeupsByName... })()` fetch invocation in the mount effect.
- Removed the entire `updateRoleWakeup` / `createRoleWakeup` / `deleteRoleWakeup` `useCallback` block including its preceding header comment.
- Removed the `<TabsContent value="role-wakeups">...</TabsContent>` JSX block.
- Header docstring D-09 clause and the `roleName` prop JSDoc updated to reflect the retired tab.

**Verified byte-identical:** `WakeupsTab.tsx` — `git diff --stat HEAD~4..HEAD src/ui/features/pretty-view/WakeupsTab.tsx` reports 0 changes. **Verified preserved:** IdentityModal.tsx's `import { WakeupsTab } from "./WakeupsTab"` at L79 + mount at L1586 unchanged.

**Surgical edit per plan D-13 (audit, 1 of 2):** `PrettyView.role-modal-swap.test.tsx` — removed the 4 `vi.mock` stub lines at L82-85 (`listRoleWakeupsByName`, `createRoleWakeupByName`, `updateRoleWakeupByName`, `deleteRoleWakeupByName`). Swap-coordination test bodies from L261+ untouched.

**Rule 3 mop-up (2 additional test files uncovered by scoped-tests):**

- `RoleModal.test.tsx` — the plan audit didn't call this out but the file mocked the 4 retired helpers + Test A asserted 4 tabs. Removed the 4 vi.mock stubs, the `mockListRoleWakeupsByName` const + its beforeEach mockResolvedValue, and rewrote Test A from "renders 4 tabs — Role file / Runbooks / Bounties / Wakeups" to "renders 3 tabs — Role file / Runbooks / Bounties" (navButtons length 4 → 3, Wakeups assertion removed). Header docstring + test-plan table updated.
- `PrettyConversationsPanel.role-management-flow.test.tsx` — removed the 4 vi.mock stubs at L248-251. Test bodies unchanged.

**Commit:** `eab253d6` (4 files, -106 net lines).

## Test Coverage

**Full phase-wide scoped `npx vitest related --run` over the six primary touched files:**

| File in scope | Result |
|---|---|
| `src/backend/claude-session/identity-artifact-reader.ts` | pass |
| `src/backend/claude-session/claude-session-server.ts` | pass |
| `src/ui/api/claude-session-api.ts` | pass |
| `src/ui/features/pretty-view/RoleModal.tsx` | pass |
| `src/ui/features/pretty-view/WakeupsTab.tsx` | pass (untouched, still consumed by IdentityModal) |
| `src/ui/features/pretty-view/IdentityModal.tsx` | pass (untouched, per-identity WakeupsTab mount preserved) |

**Aggregate:** 133 test files, 2134 pass, 10 skipped, 1 todo. Zero failures across every scoped test related to any of the 6 files.

Per-identity `identity-artifact-reader.wakeup-crud.test.ts` explicitly re-run after Task 1 → 7/7 pass (per-identity path intact — D-09 preservation verified).

## Build Results

- `npm run build:backend` — clean after every task (0 errors).
- `npm run build` — clean at HEAD (Task 3 interim state had expected `MISSING_EXPORT` errors from RoleModal.tsx still importing the deleted helpers; Task 4 resolves).

## Deviations from Plan

### Rule 3 auto-fix (blocking-issue): 7th function deleted in Task 1

**Found during:** Task 1 (grep-first survey of role-wakeup functions).
**Issue:** `deleteRoleWakeupByName` (Phase 90 Plan 90-07 role-name-keyed delete) was not named in D-10's list of 6 functions, but grep showed its only callsite is `role:delete-wakeup` — retired in Task 2 as part of D-11. Leaving it live would create a dead-code orphan that `tsc --noEmit` doesn't flag (unused exports are legal).
**Fix:** Deleted alongside the six named functions in Task 1.
**Files modified:** src/backend/claude-session/identity-artifact-reader.ts
**Commit:** `689ad7a4`

### Rule 3 auto-fix (blocking-issue): Task 2 surgical mop-up in claude-session-server.role-reads.test.ts

**Found during:** Task 2 verification (scoped vitest after handler removals).
**Issue:** The plan's D-13 audit listed 4 wholesale-delete test files + 2 surgical-edit files. `claude-session-server.role-reads.test.ts` was not in either bucket — but scoped tests surfaced 5 failing test cases in a `describe("role:list-wakeups WS handler", ...)` block that referenced the retired `__handleRoleListWakeupsForTests` seam. The file also carries R1 (role:get-file) + R2 (role:list-bounties) coverage that MUST stay per the plan philosophy (parallels claude-session-api.role-reads.test.ts audit result).
**Fix:** Surgical audit-style edit — deleted the `role:list-wakeups WS handler` describe block (5 cases, L297-393 previously) + the `readRoleWakeupsByName` mock/import/reset + the `__handleRoleListWakeupsForTests` import. R1 + R2 blocks left intact.
**Files modified:** src/backend/claude-session/claude-session-server.role-reads.test.ts
**Commit:** `bc18bbcb`

### Rule 3 auto-fix (blocking-issue): Task 4 surgical mop-up in 2 additional UI test files

**Found during:** Task 4 verification (Task 3 acceptance criterion `npm run build` failed because RoleModal.tsx still imported the retired helpers).
**Issue:** The plan's D-09/D-13 audit called out `PrettyView.role-modal-swap.test.tsx` for surgical edit, but not `RoleModal.test.tsx` (which mocks the 4 retired helpers + has a Test A asserting 4 tabs — the plan didn't audit tab-count expectations against the removal) nor `PrettyConversationsPanel.role-management-flow.test.tsx` (which also mocks the 4 retired helpers). Both files caused `frontend build` and scoped-test failures until cleaned.
**Fix:** Applied the same surgical-edit pattern the plan established for the two audit-called-out files: removed the 4 `vi.mock` stubs in both, plus the `mockListRoleWakeupsByName` const + Test A tab-count assertion update in RoleModal.test.tsx. Test bodies unchanged everywhere.
**Files modified:**
  - src/ui/features/pretty-view/RoleModal.test.tsx
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx
**Commit:** `eab253d6`

### No architectural changes (no Rule 4 STOP)

Every rule-1/2/3 auto-fix stayed within scope. No new packages installed. No new files created. No new modules invented.

## Deferred Items

**AddWakeupDialog.tsx `scope: "role" | "identity"` prop cleanup** — the component's `scope="role"` code path is now unreachable UI. Only IdentityModal renders the sub-modal after this plan, and it always passes `scope="identity"`. Not removed in this plan because:
1. Not in any of D-09..D-13's named-file scope.
2. Adds a "component API cleanup" concern orthogonal to "retire the per-role wake-up CRUD surface."
3. Backend + frontend build both clean without touching it.

Follow-up opportunity if AddWakeupDialog.tsx is ever refactored — drop the `scope` prop entirely and hardcode the identity-scope labels ("Add identity-scope wakeup") that are the only ones ever reached now.

## Banned-strings Gate

`grep -rin '\buser\b' src/ | grep -v -E '(the user|test-context|// user|/\* user)'` — 10 pre-existing test-context matches in files this plan does NOT touch (users-list-basic.test.ts, participants-classifier.test.ts, matrix-admin-routes.test.ts, observation-loop.test.ts, registry-rooms.test.ts). None of my 4 commits introduced new occurrences: `git diff --name-only HEAD~4..HEAD | xargs grep -l "$BANNED_TOKEN"` → empty.

## Signal for Orchestrator (D-18/D-19 deploy motion)

D-14 sequencing satisfied on Plan 134-01. This plan is green (scoped tests + backend build + frontend build all clean). The retired role-scope surface no longer exists in the tree. The A1 assumption (stale-tab-sending-role:list-wakeups-after-deploy-hangs-until-refresh) documented in RESEARCH.md and accepted in the threat register.

Phase 134 is now orchestrator-ready for the full-suite + docker-build + docker-compose-up-force-recreate + playwright-smoke deploy motion (D-18/D-19). Executor's remit stops at the current commit; the container motion + full-suite gate is orchestrator-scope.

## Commits

| Commit | Task | Message |
|--------|------|---------|
| `689ad7a4` | Task 1 | refactor(134-02): delete 7 role-wakeup service functions from identity-artifact-reader.ts |
| `bc18bbcb` | Task 2 | refactor(134-02): remove 9 role-wakeup WS handlers + imports + wire-op JSDoc; delete 3 wholesale test files |
| `5c37ebf1` | Task 3 | refactor(134-02): remove 4 frontend role-wakeup helpers + payload/event types from claude-session-api.ts |
| `eab253d6` | Task 4 | refactor(134-02): remove role-wakeups tab from RoleModal + surgical mock cleanup in 3 UI tests |

## Self-Check: PASSED

- Files verified present after deletions:
  - src/backend/claude-session/identity-artifact-reader.ts ✓ (7 role-wakeup functions removed; per-identity + shared helpers intact)
  - src/backend/claude-session/claude-session-server.ts ✓ (9 role-wakeup handlers + imports + JSDoc removed; per-identity handlers intact)
  - src/backend/claude-session/claude-session-server.role-reads.test.ts ✓ (surgical — R1/R2 preserved)
  - src/ui/api/claude-session-api.ts ✓ (5 role-wakeup helpers + 16 types removed; WakeupSpecWire STAYS)
  - src/ui/api/claude-session-api.role-reads.test.ts ✓ (surgical — R1/R3 preserved, R5/R6 removed)
  - src/ui/features/pretty-view/RoleModal.tsx ✓ (role-wakeups tab retired)
  - src/ui/features/pretty-view/RoleModal.test.tsx ✓ (surgical — Test A rewritten)
  - src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx ✓ (surgical — 4 mock lines removed)
  - src/ui/features/pretty-view/WakeupsTab.tsx ✓ (byte-identical — used by IdentityModal)
  - src/ui/features/pretty-view/IdentityModal.tsx ✓ (untouched — per-identity mount preserved)
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx ✓ (surgical — 4 mock lines removed)
  - src/backend/claude-session/identity-artifact-reader.wakeup-crud.test.ts ✓ (untouched per D-13 explicit KEEP)
- Files verified deleted:
  - src/backend/claude-session/identity-artifact-reader.role-wakeups.test.ts ✓ (`ls` → No such file)
  - src/backend/claude-session/claude-session-server.role-wakeups.test.ts ✓ (`ls` → No such file)
  - src/backend/claude-session/claude-session-server.role-wakeup-crud.test.ts ✓ (`ls` → No such file)
  - src/ui/api/claude-session-api.role-wakeup-crud.test.ts ✓ (`ls` → No such file)
- Commits verified in git log: 689ad7a4, bc18bbcb, 5c37ebf1, eab253d6 all present on feat/tab-title-from-tmux.
