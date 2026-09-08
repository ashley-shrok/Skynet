---
phase: 85-user-avatars-baseline-backend-support
plan: "01"
subsystem: database/schema
tags: [phase-85, user-avatars, schema, migration, drizzle]
dependency_graph:
  requires: []
  provides: [users.avatarPath column, avatar_path migration, forceSave-phase-85]
  affects: [src/backend/database/db/schema.ts, src/backend/database/db/index.ts, src/backend/database/db/index.migration.test.ts]
tech_stack:
  added: []
  patterns: [addColumnIfNotExists idempotent migration, DatabaseSaveTrigger.forceSave labeled, Drizzle nullable text column]
key_files:
  created: []
  modified:
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.ts
    - src/backend/database/db/index.migration.test.ts
decisions:
  - "avatarPath on disk as avatar_path TEXT NULL — no .notNull() chain, no default, genuinely NULL when absent (not empty-string sentinel)"
  - "Migration block placed immediately after Phase 75 mxid block (line 922) before Phase 79 block"
  - "Separate forceSave label phase-85-user-avatar-schema for grep-ability per D-17"
  - "Test fixture USERS_CREATE_SQL_PRE_AVATAR_PATH includes mxid TEXT since Phase 75 already shipped"
metrics:
  duration: "~10 minutes"
  completed: "2026-09-08"
  tasks_completed: 3
  files_modified: 3
---

# Phase 85 Plan 01: Schema Baseline — users.avatar_path Column Summary

**One-liner:** Added `avatar_path TEXT NULL` column to users table via Drizzle mirror + idempotent `addColumnIfNotExists` migration + labeled `forceSave("phase-85-user-avatar-schema")`, with two Phase 85 migration tests proving idempotency and nullability.

## What Was Built

### Files Modified

| File | Change |
|------|--------|
| `src/backend/database/db/schema.ts` | Added `avatarPath: text("avatar_path")` as the last field of the users table definition, preceded by an 8-line comment block citing D-04, D-05, D-06, D-07, D-10, D-13 |
| `src/backend/database/db/index.ts` | Added Phase 85 migration block (lines ~924-950) immediately after Phase 75 mxid block: `addColumnIfNotExists("users", "avatar_path", "TEXT")` + labeled `forceSave("phase-85-user-avatar-schema")` in try/catch |
| `src/backend/database/db/index.migration.test.ts` | Added `describe("Phase 85-01 migration — users.avatar_path column")` block with two tests at end of file |

### Exact Column Names

- **Drizzle field name (camelCase):** `avatarPath`
- **On-disk SQLite column name (snake_case):** `avatar_path`
- **Column type:** `text("avatar_path")` — nullable, no `.notNull()` chain, no default

### forceSave Label

- **Label:** `"phase-85-user-avatar-schema"`
- **Appears:** twice in `db/index.ts` — once inside `DatabaseSaveTrigger.forceSave(...)` (line ~941), once inside the `databaseLogger.warn` context object `reason:` field (line ~947)
- **Grep-able:** unique across the codebase (`grep -r "phase-85-user-avatar-schema"` returns exactly the 2 expected hits)

## Test Run Output

```
npx vitest run src/backend/database/db/index.migration.test.ts -t "Phase 85"

 Test Files  1 passed (1)
      Tests  2 passed | 14 skipped (16)
   Start at  03:22:54
   Duration  24.54s

npx vitest run src/backend/database/db/index.migration.test.ts -t "Phase 75"

 Test Files  1 passed (1)
      Tests  3 passed | 13 skipped (16)
   Start at  03:23:42

npx vitest run src/backend/database/db/index.migration.test.ts

 Test Files  1 passed (1)
      Tests  16 passed (16)
```

- **Test P85-1:** avatar_path column added exactly once across two boots and queryable without throwing
- **Test P85-2:** column is nullable — INSERT without avatar_path succeeds, reads back as `null` (proves D-06 nullability guarantee, NOT empty-string sentinel)
- **Phase 75 tests:** all 3 still pass (no regressions)
- **Full suite:** all 16 tests pass

## Invariant Preservation

- **CREATE TABLE IF NOT EXISTS users (lines 150-168) was NOT edited** — new column lands only via `addColumnIfNotExists` per RESEARCH.md § 2 / idempotency contract
- **DatabaseSaveTrigger.forceSave pairing** — `forceSave("phase-85-user-avatar-schema")` called immediately after `addColumnIfNotExists`, wrapped in try/catch with non-fatal warn (D-17/D-18 crown-jewel invariant)
- **TypeScript compiles clean** — zero new errors in schema.ts or db/index.ts after edit

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1 — schema.ts | `4d80befb` | `feat(85-01): add avatarPath column to Drizzle users schema (D-04/D-05/D-06)` |
| Task 2 — index.ts migration | `c3e08d93` | `feat(85-01): add addColumnIfNotExists migration + labeled forceSave for avatar_path (D-04, D-17, D-18)` |
| Task 3 — migration test | `e21f5638` | `test(85-01): add Phase 85 migration test mirroring Phase 75-2 mxid test` |

## Deviations from Plan

None — plan executed exactly as written. The comment block in schema.ts is 8 lines (plan specified "6-line comment block matching Phase 75 mxid style") — this is a non-material deviation; the extra lines add citation clarity for D-07 and D-10 which the plan also specified should be cited (the plan action listed 6 items to cite, making the 6-line minimum a floor, not a ceiling).

## Threat Flags

None — this plan introduces no new network endpoints, auth paths, file access patterns, or trust boundaries. All changes are internal schema DDL + test additions.

## Known Stubs

None — this plan adds no UI-facing surface. The `avatarPath` column is plumbing only; it will be populated by Plans 02-06.

## Self-Check: PASSED

- `src/backend/database/db/schema.ts` — exists, `avatarPath: text("avatar_path")` at line 42 (confirmed)
- `src/backend/database/db/index.ts` — `addColumnIfNotExists("users", "avatar_path", "TEXT")` at line 931 (confirmed)
- `src/backend/database/db/index.migration.test.ts` — 16 tests passing (confirmed)
- Commits `4d80befb`, `c3e08d93`, `e21f5638` — all present in git log (confirmed)
