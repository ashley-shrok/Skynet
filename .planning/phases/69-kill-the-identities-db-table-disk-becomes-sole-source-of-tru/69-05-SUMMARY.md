---
phase: 69-kill-the-identities-db-table-disk-becomes-sole-source-of-tru
plan: "05"
subsystem: identity-schema identity-migration
tags: [db-removal, disk-authoritative, tdd, migration, drop-table, phase-69-wave4]
dependency_graph:
  requires: [69-01, 69-02, 69-03, 69-04]
  provides:
    - "runIdentitiesTableDrop(sqliteDb) — idempotent DROP TABLE IF EXISTS identities"
    - "migrateSchema() async — wires Phase 69 table drop after Phase 66 cosmetic drops"
    - "schema.ts identities export deleted — TSC gate for any future reintroduction attempt"
    - "CREATE TABLE IF NOT EXISTS identities deleted — fresh installs never create the table"
    - "identities.ts schema import removed — zero DB touches remain in the route file"
  affects:
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.ts
    - src/backend/database/db/index.migration.test.ts
    - src/backend/database/routes/identities.ts
tech_stack:
  added: []
  patterns:
    - "idempotent DROP TABLE IF EXISTS at boot time (mirrors Phase 66 Plan 04 runIdentitiesCosmeticDrops shape)"
    - "inline forceSave with try/catch null-safety (checker iteration 1 WARNING 4 fix)"
    - "async migrateSchema() — caller (initializeCompleteDatabase) already async"
key_files:
  created: []
  modified:
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.ts
    - src/backend/database/db/index.migration.test.ts
    - src/backend/database/routes/identities.ts
decisions:
  - "forceSave wrapper: inline-with-null-safety option (per checker iteration 1 WARNING 4 fix). forceSave() already returns early when not initialized (logs warn, does not throw) — try/catch is added as extra defense-in-depth. The DROP itself persists because runIdentitiesTableDrop runs first and is idempotent."
  - "Test 7 implemented (not skipped): runIdentitiesCosmeticDrops + runIdentitiesTableDrop sequence on legacy 5-column schema. Simple enough that setup complexity was not an issue."
  - "migrateSchema made async: single call site (initializeCompleteDatabase, already async) updated to await. No synchronous top-level callers found."
  - "Task 2 RED: TSC produced zero errors post-Task-1 because Option A (410 GONE) was chosen in 69-02 — the identities import was unused and TypeScript does not error on unused imports without noUnusedLocals. The Task 2 change proceeded directly to import cleanup without a failing-test RED commit."
  - "Removed dead imports from identities.ts: nanoid, db (from db/index.js), identities (from db/schema.js), eq, and (from drizzle-orm), DatabaseSaveTrigger. All became dead when POST / became 410 GONE in 69-02."
metrics:
  duration: "~25 minutes"
  completed: "2026-09-02T04:30:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 4
---

# Phase 69 Plan 05: Wave 4 — Kill the identities DB Table (Migration + Schema Removal) Summary

Physically dropped the `identities` table from Skynet's encrypted SQLite. The table is gone from the schema, deleted from the CREATE TABLE initialization block, and removed via an idempotent `DROP TABLE IF EXISTS` boot migration. Identity IS the disk folder on some host — structurally enforced now by the absence of the table itself.

## Tasks Completed

| # | Name | Commit | Files Changed |
|---|------|--------|---------------|
| 1 (RED) | runIdentitiesTableDrop tests | 6880c461 | index.migration.test.ts |
| 1 (GREEN) | runIdentitiesTableDrop + schema cleanup | aae87c92 | schema.ts, index.ts, index.migration.test.ts |
| 2 (GREEN) | identities.ts schema import removal | 5f20f669 | identities.ts |

## Task 1: runIdentitiesTableDrop + migrateSchema wiring + schema deletion

### New exported function

`runIdentitiesTableDrop(sqliteDb: Database.Database): void` added to `src/backend/database/db/index.ts` immediately after `runIdentitiesCosmeticDrops`. Wraps `sqliteDb.exec("DROP TABLE IF EXISTS identities;")` in try/catch that logs a warn on failure (non-fatal per T-66-04-01 precedent — failed drop leaves deadweight, not corruption; next boot retries via IF EXISTS).

### migrateSchema() — async + Phase 69 wiring

- `const migrateSchema = () => {` → `const migrateSchema = async () => {`
- `migrateSchema();` at call site → `await migrateSchema();`
- After the `runIdentitiesCosmeticDrops(sqlite)` block, added:
  1. `runIdentitiesTableDrop(sqlite)` — the drop itself
  2. `await DatabaseSaveTrigger.forceSave("phase-69-drop-identities-table")` in try/catch — persist to encrypted SQLite file

### Inline forceSave with null-safety (checker iteration 1 WARNING 4 fix)

The try/catch wrapping forceSave protects against the first-boot race: `handlePostInitFileEncryption` initializes `DatabaseSaveTrigger` AFTER `migrateSchema` returns. On first-ever boot with Phase 69 code, the forceSave call finds `isInitialized = false`, logs a warn, and returns. The DROP still happened in RAM. On the next boot, the drop re-fires via idempotency and forceSave succeeds (trigger is initialized by then).

In practice, `DatabaseSaveTrigger.forceSave()` already handles the uninitialized case by logging a warn and returning — it does NOT throw. The try/catch is extra defense-in-depth. No first-boot crash path exists.

**SUMMARY confirmation per plan spec:** Inline forceSave with try/catch null-safety wrapper LANDED AS SPECIFIED.

### CREATE TABLE identities block deleted

Lines 466-479 in index.ts (the `CREATE TABLE IF NOT EXISTS identities (...)` block) deleted. Replaced with a Phase 69 comment noting the table is dropped at boot time. Fresh installs never create the table.

### schema.ts identities export deleted

Lines 654-672 in schema.ts (the `export const identities = sqliteTable(...)` block and its Phase 66 comment) deleted. Replaced with a one-line Phase 69 comment. Any future code attempting to reintroduce a DB-side identity roster fails at TSC.

### Tests 5, 6, 7 in index.migration.test.ts

- **Test 5:** Create table + seed row → `runIdentitiesTableDrop` → `sqlite_master` returns `[]`, PRAGMA table_info returns `[]`. PASS.
- **Test 6:** No table created → two `runIdentitiesTableDrop` calls → no throw, PRAGMA returns `[]`. PASS.
- **Test 7:** 5-column legacy schema → `runIdentitiesCosmeticDrops` (no-op) → `runIdentitiesTableDrop` → table gone. PASS.

Existing Phase 66 Tests 1-4 all still pass.

### DROP TABLE runs successfully on better-sqlite3 v12.9.0 bundled SQLite

SQLite's `DROP TABLE IF EXISTS` has been supported since pre-3.0. No version preflight needed (unlike Phase 66's ALTER TABLE DROP COLUMN which required SQLite 3.35). Tests confirm the drop executes without error on the bundled SQLite version.

## Task 2: identities.ts schema import removal

### Option A confirmed (per 69-02-SUMMARY.md)

POST / has been 410 GONE since plan 69-02. No INSERT to remove.

### Imports removed

All dead imports resulting from the schema drop and the Option A 410-stub:
- `import { identities } from "../db/schema.js"` — schema symbol deleted in Task 1
- `import { db } from "../db/index.js"` — no DB queries survive
- `import { eq, and } from "drizzle-orm"` — no Drizzle queries
- `import { nanoid } from "nanoid"` — POST / no longer generates IDs
- `import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js"` — no row updatedAt bump

Removed `import type { Request, Response }` duplicate (was `import type { Request, Response }` on L12 alongside `import express` on L2 which already provides the types via express) — kept the type import since the route handlers reference these types explicitly.

### Done criteria verified

```
grep -c 'from "../db/schema"' identities.ts   → 0
grep -c 'db\.insert|db\.update|db\.delete|db\.select' identities.ts → 0
grep -c '410' identities.ts → 2 (POST / handler)
npx tsc --noEmit → clean (exit 0)
```

## Test Results

| File | Tests | Status |
|------|-------|--------|
| index.migration.test.ts | 7 (4 Phase 66 + 3 Phase 69) | PASS |
| identities.get-disk.test.ts | 15 | PASS |
| identities.put-disk.test.ts | 11 | PASS |
| **Total** | **33** | **PASS** |

`npx tsc --noEmit` exits 0.

## Phase 69 Arc Closeout

Phase 69 is complete. The shape file's commitments are structurally enforced:

- **Roster elimination:** No DB-side identity list. GET / fans out to hosts per request (Plan 69-02).
- **Name is the key:** Internal `id` field gone from wire type and all consumers (Plans 69-02, 69-03, 69-04).
- **Birth flow:** Disk-only, no DB INSERT (Plan 69-03).
- **Clone flow:** Disk-only, no DB INSERT (Plan 69-03).
- **Share flow:** Deleted entirely (Plan 69-01).
- **Delete endpoint:** Deleted entirely (Plan 69-01).
- **Migration:** Table physically dropped at boot (Plan 69-05, this plan).

Any attempt to reintroduce the identities table:
1. Fails at TSC — `schema.ts` has no `identities` export
2. Fails at runtime — no `CREATE TABLE IF NOT EXISTS identities` block remains; only `DROP TABLE IF EXISTS identities` runs at boot

The encrypted SQLite database no longer contains an identities table on any install (fresh or upgraded).

## Deviations from Plan

### Task 2 RED cycle: no failing test to commit

The plan specified committing a RED test for Task 2. However, since Option A was chosen in 69-02 (POST / is already 410), TSC produced zero errors post-Task-1 (TypeScript does not error on unused imports without `noUnusedLocals`). There was no meaningful RED signal. The GREEN cleanup (import removal) proceeded without a separate RED commit.

**Classification:** Process-only deviation (no behavioral difference). The import cleanup is correct; the absence of a RED commit is a TDD-formality artifact from the Option A choice.

## First-Boot Race Note

On the very first boot with Phase 69 code:
1. `migrateSchema` runs — `runIdentitiesTableDrop` drops the table in RAM
2. `DatabaseSaveTrigger.forceSave("phase-69-drop-identities-table")` fires — but `isInitialized = false` (handlePostInitFileEncryption hasn't run yet)
3. forceSave logs a warn and returns; DROP survives in RAM only
4. handlePostInitFileEncryption runs — first `saveMemoryDatabaseToFile()` persists the RAM DB (including the dropped table) to the encrypted SQLite file
5. From boot 2 onward: DROP is idempotent (IF EXISTS), forceSave succeeds immediately

**Result:** The table is gone from RAM from boot 1. Persistence to disk happens at step 4 (same first boot, via the existing `saveMemoryDatabaseToFile()` call in `handlePostInitFileEncryption`). The forceSave in migrateSchema is additive — the existing boot flow already handles persistence.

## Known Stubs

None. All Phase 69 disk-authoritative flows are real. The 410 stub for POST / is intentional and documented since 69-02.

## Threat Flags

None. No new network endpoints. The boot migration mutates the encrypted SQLite DB (DROP TABLE) — covered by T-69-05-01 in the plan's threat register. DLM daily snapshot is the 7-day recovery path (unchanged from Phase 66 Plan 04).

## Handoff to Orchestrator

Phase 69 ship-gate (NOT performed by this executor per CLAUDE.md constraints):
1. Full `npx vitest run` suite green
2. Docker build + `docker compose up` on a dev container — verify boot log shows the drop running and no drop-related errors
3. First-boot log inspection: expect `[phase-69]` related log lines on first deploy; second boot should show no drop-related warns
4. Deadman rollback: DLM snapshot restore path unchanged — `git revert + docker recreate + DLM restore` recovers pre-Phase-68 SQLite file including the identities table and all its rows

## Self-Check

**Files confirmed exist:**
- `src/backend/database/db/schema.ts` — identities export deleted
- `src/backend/database/db/index.ts` — runIdentitiesTableDrop added, migrateSchema async, CREATE TABLE deleted
- `src/backend/database/db/index.migration.test.ts` — Tests 5+6+7 added
- `src/backend/database/routes/identities.ts` — dead imports removed

**Commits confirmed:**
- 6880c461 — test(69-05): RED — runIdentitiesTableDrop
- aae87c92 — feat(69-05): GREEN — drop identities table
- 5f20f669 — feat(69-05): GREEN — identities.ts final schema-symbol removal

**Grep gates:**
- `grep -c "export const identities" schema.ts` → 0
- `grep -c "CREATE TABLE IF NOT EXISTS identities" index.ts` → 0
- `grep -c "export function runIdentitiesTableDrop" index.ts` → 1
- `grep -c "DROP TABLE IF EXISTS identities" index.ts` → 1
- `grep -c 'from "../db/schema"' identities.ts` → 0
- `grep -c 'db\.insert\|db\.update\|db\.delete\|db\.select' identities.ts` → 0

**TSC:** `npx tsc --noEmit` exits 0

## Self-Check: PASSED
