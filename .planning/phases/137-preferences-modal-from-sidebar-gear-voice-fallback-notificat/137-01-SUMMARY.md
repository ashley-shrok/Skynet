---
phase: 137-preferences-modal-from-sidebar-gear-voice-fallback-notificat
plan: "01"
subsystem: backend-schema-routes-frontend-types
tags:
  - schema-migration
  - user-preferences
  - fallback-voice
  - avatar-path
  - type-foundation
dependency_graph:
  requires: []
  provides:
    - fallbackVoice column in user_preferences schema + migration
    - fallbackVoice GET/PUT on /user-preferences
    - avatarPath on /users/me
    - UserInfo.avatarPath frontend type
    - UserPreferences.fallbackVoice frontend type
  affects:
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.ts
    - src/backend/database/routes/user-preferences.ts
    - src/backend/database/routes/users.ts
    - src/ui/main-axios.ts
    - src/ui/api/open-tabs-api.ts
tech_stack:
  added: []
  patterns:
    - runReopenTabsColumnDrop mirrors runHiddenColumnDrop (byte-for-byte per phase precedent)
    - forceSave label renamed to latest phase per "one forceSave batches all prior mutations" discipline
key_files:
  created: []
  modified:
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.ts
    - src/backend/database/routes/user-preferences.ts
    - src/backend/database/routes/users.ts
    - src/backend/database/routes/user-preferences.test.ts
    - src/ui/main-axios.ts
    - src/ui/api/open-tabs-api.ts
decisions:
  - "Used comment-deletion style for reopenTabsOnLogin removal in schema.ts (not wholesale line removal) to preserve audit trail in git diff"
  - "forceSave label renamed from phase-128-... to phase-137-fallback-voice-schema per one-forceSave-batches-all-priors precedent"
  - "Test REG 1 repurposed from reopenTabsOnLogin validation to fallbackVoice validation; legacy reopenTabsOnLogin test cases replaced with P137-01..P137-03 Phase 137 tests"
metrics:
  duration: "583 seconds"
  completed: "2026-09-27"
  tasks_completed: 3
  files_modified: 7
---

# Phase 137 Plan 01: Backend + Type Foundation Summary

**One-liner:** SQLite schema migration adding `fallback_voice` + dropping `reopen_tabs_on_login`, route updates exposing `fallbackVoice` and `avatarPath`, and frontend type extensions locking the shape for downstream plans.

## Files Touched

| File | Summary |
|------|---------|
| `src/backend/database/db/schema.ts` | Removed `reopenTabsOnLogin` integer column from `userPreferences` sqliteTable; added `fallbackVoice: text("fallback_voice")` (nullable per D-14) |
| `src/backend/database/db/index.ts` | Deleted `reopen_tabs_on_login INTEGER NOT NULL DEFAULT 0` from CREATE TABLE fresh-install block; added `runReopenTabsColumnDrop()` helper (byte-mirror of `runHiddenColumnDrop`); wired it into `migrateSchema()` with fatal-preflight error handling; added `addColumnIfNotExists("user_preferences", "fallback_voice", "TEXT")` to upgrade sweep; renamed forceSave label to `"phase-137-fallback-voice-schema"` |
| `src/backend/database/routes/user-preferences.ts` | Removed `reopenTabsOnLogin` from `pickPreferences`, destructure, type cast, and validation block; added `fallbackVoice` throughout all of these plus the string-validation loop and `updates.fallbackVoice` assignment; updated OpenAPI docs |
| `src/backend/database/routes/users.ts` | Added `avatarPath: user[0].avatarPath ?? null` to `/users/me` response (Phase 137 D-30) |
| `src/backend/database/routes/user-preferences.test.ts` | Updated `Row` type (removed `reopenTabsOnLogin`, added `fallbackVoice`); updated all `rows.set()` fixtures; updated GET-92-01 assertion to assert `reopenTabsOnLogin` absent; repurposed REG 1 test for `fallbackVoice` validation; added P137-01..P137-03 test cases |
| `src/ui/main-axios.ts` | Added `avatarPath?: string | null` to `UserInfo` interface with Phase 137 D-30 docstring |
| `src/ui/api/open-tabs-api.ts` | Removed `reopenTabsOnLogin: boolean` from `UserPreferences`; added `fallbackVoice?: string | null` (Phase 137 D-14) |

## Test Results

All three scoped suites passed:

```
src/backend/database/db            4 files  41 tests PASSED
src/backend/database/routes/user-preferences.test.ts  1 file   32 tests PASSED (includes P137-01..P137-03)
src/backend/database/routes/users  2 files  46 tests PASSED
TOTAL: 7 test files, 119 tests, all PASSED
```

Backend build: `npm run build:backend` exits 0, no type errors.

## Schema State

After `migrateSchema()` runs:
- Fresh install: `user_preferences` table created WITHOUT `reopen_tabs_on_login`, WITH `fallback_voice TEXT`
- Upgrade: `runReopenTabsColumnDrop()` drops `reopen_tabs_on_login` if present; `addColumnIfNotExists` adds `fallback_voice`
- Both paths converge on the same schema shape (Pitfall 9 resolved)

## Deferred to Plan 137-06

`AppShell.tsx` has 3 consumer sites for `reopenTabsOnLogin` that will produce TypeScript compile errors now that the field is removed from `UserPreferences`:

| File | Line | Pattern |
|------|------|---------|
| `src/ui/AppShell.tsx` | L362 | Initial state seed: `{ reopenTabsOnLogin: false }` |
| `src/ui/AppShell.tsx` | L1621 | Read site: `if (userPrefs.reopenTabsOnLogin && !pending?.only)` |
| `src/ui/AppShell.tsx` | L1579 | Comment referencing the gate |

These are **intentional** — they serve as the Plan 06 cleanup checklist. Frontend compile errors at these sites do NOT affect the backend build or the scoped test suite. Plan 137-06 will address these cleanup sites.

## Deviations from Plan

None — plan executed exactly as written.

All tasks completed per their `<done>` criteria:
- Task 1: Schema layer for Phase 137 complete. `fallback_voice` column exists on both fresh installs and upgrades; `reopen_tabs_on_login` dropped on upgrades and never created on fresh installs; Drizzle mirror agrees.
- Task 2: Backend GET/PUT handlers surface `fallbackVoice` and hide `reopenTabsOnLogin`; `/users/me` surfaces `avatarPath`; route test suite green.
- Task 3: Frontend type shapes agree with backend: `UserInfo` carries `avatarPath`, `UserPreferences` carries `fallbackVoice` and no longer carries `reopenTabsOnLogin`.

## Self-Check: PASSED

Files exist:
- `src/backend/database/db/schema.ts` — FOUND (contains `fallback_voice`)
- `src/backend/database/db/index.ts` — FOUND (contains `runReopenTabsColumnDrop`)
- `src/backend/database/routes/user-preferences.ts` — FOUND (contains `fallbackVoice`)
- `src/backend/database/routes/users.ts` — FOUND (contains `avatarPath`)
- `src/ui/main-axios.ts` — FOUND (contains `avatarPath?: string | null`)
- `src/ui/api/open-tabs-api.ts` — FOUND (contains `fallbackVoice?: string | null`)

Commits exist:
- `13cee3ec` — Task 1: schema + migration
- `bd59bc45` — Task 2: backend routes + test file
- `5e57ed61` — Task 3: frontend types
