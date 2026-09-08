---
phase: 79-middle-list-recency-from-skynet-side-send-log-replace-remote
plan: 01
subsystem: database

tags: [sqlite, drizzle, migration, schema, in-memory, forceSave, identity-send-log]

# Dependency graph
requires:
  - phase: 68
    provides: DatabaseSaveTrigger.forceSave post-schema-mutation persistence pattern
  - phase: 72
    provides: try/catch-wrapped forceSave-after-migration reference pattern (phase-72-add-runs-fleet-substrate)

provides:
  - identity_send_log SQLite table (identity_name TEXT PRIMARY KEY, last_send_at INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)
  - Drizzle identitySendLog table export at schema.ts
  - CREATE TABLE IF NOT EXISTS block wired into initializeCompleteDatabase() (idempotent on subsequent boots)
  - DatabaseSaveTrigger.forceSave("phase-85-create-identity-send-log") at tail of migrateSchema() with non-fatal try/catch
  - 4 new migration test cases (fresh, idempotent, PRAGMA shape, insert + upsert-via-replace)

affects:
  - phase-85-02 (frontend send-time stamp writer — needs this table to insert into)
  - phase-85-04 (ssh-poll-orchestrator source-swap — reads lastMessageAt from this store)
  - phase-85-05 (client-side optimistic advance — writes to the same store via the send-time path)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "New durable SQLite table introduction via in-process migration (CREATE TABLE IF NOT EXISTS inside initializeCompleteDatabase() multi-table exec block + tail-of-migrateSchema forceSave). Non-fatal try/catch on forceSave: idempotent CREATE means next boot retries."
    - "identity_name as freestanding string primary key (no FK to identities table since Phase 68 dropped it — identity names are the durable handle)."

key-files:
  created:
    - .planning/phases/85-middle-list-recency-from-skynet-side-send-log-replace-remote/deferred-items.md
  modified:
    - src/backend/database/db/schema.ts — added identitySendLog Drizzle export (+13 lines, after userPreferences at L741)
    - src/backend/database/db/index.ts — added CREATE TABLE IF NOT EXISTS block inside initializeCompleteDatabase()'s multi-table sqlite.exec (+9 lines after user_preferences at L525); added try/catch forceSave at tail of migrateSchema() before the "Schema migration completed" success log (+22 lines)
    - src/backend/database/db/index.migration.test.ts — new describe block "Phase 85 migration — identity_send_log table" with 4 test cases + IDENTITY_SEND_LOG_CREATE_SQL const + columnInfo() helper (+141 lines)

key-decisions:
  - "Placed CREATE TABLE IF NOT EXISTS in the existing multi-table exec block of initializeCompleteDatabase() (not in the migrateSchema() addColumnIfNotExists sweep) per plan action — preserves the 'single boot-time SQL block' convention that every other schema.ts table follows."
  - "forceSave call placed at the very tail of migrateSchema() immediately before the 'Schema migration completed' success log — non-fatal try/catch mirrors the phase-72 addColumnIfNotExists+forceSave pattern verbatim, so a first-boot save failure (DatabaseSaveTrigger not yet wired) is tolerated and retried next boot via the idempotent CREATE."
  - "PRAGMA table_info assertion for identity_name pk=1 does NOT also assert notnull=1: SQLite only reports notnull=1 in table_info when NOT NULL is written explicitly, even though PRIMARY KEY on non-INTEGER columns semantically implies not-null via primary-key uniqueness. The pk=1 assertion is the load-bearing check for the D-02 uniqueness contract."
  - "forceSave contract intentionally NOT covered in this test file per plan Task 3 constraint — it's a singleton-boot runtime concern (DatabaseSaveTrigger is a module-scope singleton, not testable against a passed-in db handle), and the live boot path exercises it when the phase ships."

patterns-established:
  - "New durable table pattern: (1) sqliteTable export in schema.ts with sql-tag CURRENT_TIMESTAMP default on updated_at, (2) CREATE TABLE IF NOT EXISTS inside initializeCompleteDatabase() multi-table exec block, (3) DatabaseSaveTrigger.forceSave at tail of migrateSchema() wrapped in non-fatal try/catch with stable phase-scoped reason string."
  - "Migration test template for new tables: inline CREATE_SQL const at top of describe block (mirroring OLD_IDENTITIES_CREATE_SQL / OLD_SSH_DATA_CREATE_SQL), test-owned :memory: Database handle, cover fresh + idempotent + PRAGMA-shape + insert-round-trip cases. No coupling to the module-level sqlite singleton."

requirements-completed: [D-01, D-02]

# Metrics
duration: 8m 34s
completed: 2026-09-07
---

# Phase 85 Plan 01: identity_send_log SQLite table Summary

**New durable `identity_send_log` SQLite table (identity_name TEXT PK + last_send_at INTEGER + updated_at) wired into initializeCompleteDatabase() with forceSave persistence, unblocks every subsequent Phase 85 plan that reads or writes the middle-zone recency signal.**

## Performance

- **Duration:** 8m 34s (514s)
- **Started:** 2026-09-07T16:10:46Z
- **Completed:** 2026-09-07T16:19:20Z
- **Tasks:** 3
- **Files modified:** 4 (3 source, 1 deferred-items log)

## Accomplishments
- **Drizzle schema export** `identitySendLog` in `src/backend/database/db/schema.ts` — text primary key on identity_name, notNull integer last_send_at, standard CURRENT_TIMESTAMP updated_at audit column. No user column (Skynet single-tenant per D-01), no FK references (identity names are freestanding strings post-Phase-68).
- **Boot-time CREATE TABLE** appended to the existing multi-table `sqlite.exec(...)` block in `initializeCompleteDatabase()` right after `user_preferences`, preserving the single-boot-block convention. Idempotent via `IF NOT EXISTS` on every subsequent boot.
- **forceSave persistence** — `DatabaseSaveTrigger.forceSave("phase-85-create-identity-send-log")` fires at the tail of `migrateSchema()` wrapped in a non-fatal try/catch mirroring the phase-72 pattern (Skynet in-memory DB invariant: schema mutations must be flushed to the encrypted disk copy so they survive non-graceful shutdown).
- **Migration test coverage** — 4 new test cases (85-01/02/03/04) in `db/index.migration.test.ts` covering fresh install, idempotent re-run, PRAGMA table_info shape, and INSERT + INSERT OR REPLACE upsert semantics. 15 tests pass in the file (was 11, +4).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add identitySendLog Drizzle table export** — `14ddf0c2` (feat)
2. **Task 2: Add CREATE TABLE + forceSave in db/index.ts** — `9f4a8149` (feat)
3. **Task 3: Migration test coverage for Phase 85 identity_send_log table** — `e8946403` (test)

_TDD flow: Tasks 1 and 2 landed the shape declarations first because the load-bearing "test" is Task 3's migration test suite (schema.ts is a static-shape file whose runtime contract is exercised by the boot-time CREATE TABLE assertions in the migration test). Task 3's tests exercise the exact CREATE SQL from Task 2._

## Files Created/Modified

- `src/backend/database/db/schema.ts` — added `identitySendLog` sqliteTable declaration with header comment referencing D-01/D-02 (13 lines after `userPreferences` at L741).
- `src/backend/database/db/index.ts` — CREATE TABLE IF NOT EXISTS block (9 lines inside `initializeCompleteDatabase()` multi-table exec at L525-535) + forceSave try/catch (22 lines at tail of `migrateSchema()` before the "Schema migration completed" success log at L1716).
- `src/backend/database/db/index.migration.test.ts` — new `describe("Phase 85 migration — identity_send_log table")` block with 4 test cases, `IDENTITY_SEND_LOG_CREATE_SQL` inline const, and `columnInfo()` helper (141 lines appended after the Phase 72 block).
- `.planning/phases/85-middle-list-recency-from-skynet-side-send-log-replace-remote/deferred-items.md` — pre-existing backend tsc errors in unrelated `host.ts` + `pretty-view-fetch-host-file.ts` files logged out of scope (see Deviations below).

## Decisions Made

None beyond the ones already locked in the plan / CONTEXT.md / above key-decisions block. Executor followed plan-authored action bodies verbatim.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written. Grep-gate discrepancy noted below is a plan-authoring inconsistency (see Issues Encountered), not an executor deviation.

### Deferred (out-of-scope pre-existing issues)

**Pre-existing backend TS errors NOT introduced by this plan** — logged to `.planning/phases/79.../deferred-items.md` per SCOPE BOUNDARY. Three errors in files not touched by this plan:

- `src/backend/database/routes/host.ts(473,15)` — TS2322 Type 'unknown' not assignable to 'string'
- `src/backend/database/routes/host.ts(1182,17)` — TS2322 Type 'unknown' not assignable to 'string'
- `src/backend/database/routes/pretty-view-fetch-host-file.ts(440,56)` — TS2345 Argument type 'string | string[]' not assignable to 'string'

Verified via `grep -E "src/backend/database/db/(schema|index)\.ts"` on the tsc output: zero hits in touched files. Left for a dedicated typecheck-cleanup plan or ship-gate cleanup pass.

---

**Total deviations:** 0 auto-fixed (plan followed verbatim).
**Impact on plan:** None — plan matched reality; the only surprises were pre-existing out-of-scope tsc errors that predate this plan.

## Issues Encountered

**1. Plan done-criteria inconsistency for Task 2 grep count.**

Task 2's `<done>` block asserts `grep -c "phase-85-create-identity-send-log" src/backend/database/db/index.ts` returns exactly 1. The plan's own `<action>` block quotes the try/catch template mirroring the phase-72 pattern verbatim — which contains the string TWICE (once in the `forceSave("phase-85-create-identity-send-log")` call argument, once in the log-context `reason: "phase-85-create-identity-send-log"` field). Executor followed the plan's action-body template (phase-72 mirror) since the try/catch pattern is the load-bearing contract; the grep-count inconsistency in the done-block is a plan-authoring mismatch, not a runtime concern. Current file: 2 hits, matches the phase-72 sibling exactly.

**2. `npx vitest --related <path>` unsupported.**

Plan Task 1's verify block specified `npx vitest run --related src/backend/database/db/schema.ts`. Vitest 4.1.8 (this project's version) rejects `--related` as an unknown option. Substituted the direct-path form `npx vitest run src/backend/database/db/index.migration.test.ts` (the only file with tests that exercise schema.ts + db/index.ts contract). All 11 pre-existing tests continued to pass after Task 1, 15 tests passed after Task 3 (+4 new).

## User Setup Required

None — no external service configuration required. The new table lives entirely inside the existing `skynet-data` SQLite database. On the next container recreate, the boot-time `CREATE TABLE IF NOT EXISTS` block creates the table; `forceSave` persists the schema mutation to the encrypted disk copy.

## Next Phase Readiness

- **Phase 85 Plan 02** (frontend send-time stamp writer): the table now exists at runtime, so the store-write route can INSERT / INSERT OR REPLACE against it without a schema-missing error.
- **Phase 85 Plan 04** (ssh-poll-orchestrator source-swap): the table exists at runtime; the read side (`SELECT last_send_at FROM identity_send_log WHERE identity_name = ?`) will hit the empty table on first boot and return no rows → middle zone falls through to insertion-order fallback per D-09 until natural fill.
- **Phase 85 Plan 05** (client-side optimistic advance): unaffected by this plan (frontend working-store change).
- **Ship blockers:** none from this plan. The three deferred pre-existing tsc errors are unrelated and predate the phase.
- **Executor exit posture:** three atomic commits (`14ddf0c2`, `9f4a8149`, `e8946403`) on `feat/tab-title-from-tmux`, NOT pushed / NOT docker-built / NOT deployed — held at executor's remit boundary. Orchestrator owns pull + full-suite + push + build + recreate + verify + coord per fleet directive.

## Self-Check

### Created files exist

- `/home/ubuntu/skynet-tiffany/.planning/phases/85-middle-list-recency-from-skynet-side-send-log-replace-remote/deferred-items.md` — FOUND
- `/home/ubuntu/skynet-tiffany/.planning/phases/85-middle-list-recency-from-skynet-side-send-log-replace-remote/85-01-SUMMARY.md` — FOUND (this file)

### Modified files contain the expected additions

- `src/backend/database/db/schema.ts` — `grep -c identitySendLog` = 1 ✓ ; `grep -c identity_send_log` = 2 ✓
- `src/backend/database/db/index.ts` — `grep -c identity_send_log` = 3 ✓ (CREATE TABLE + comment + forceSave-adjacent context)
- `src/backend/database/db/index.ts` — `grep -c phase-85-create-identity-send-log` = 2 ✓ (call arg + log reason field, phase-72 pattern mirror)
- `src/backend/database/db/index.migration.test.ts` — `grep -c "Phase 85"` = 2 ✓ ; `grep -c identity_send_log` = 15 ✓

### Commits exist on branch feat/tab-title-from-tmux

- `14ddf0c2` feat(85-01): add identitySendLog Drizzle table export — FOUND
- `9f4a8149` feat(85-01): add CREATE TABLE identity_send_log + forceSave in db/index.ts — FOUND
- `e8946403` test(85-01): add Phase 85 identity_send_log migration test coverage — FOUND

### Scoped tests green

- `npx vitest run src/backend/database/db/index.migration.test.ts` = 15/15 pass, exit 0.

## Self-Check: PASSED

---

*Phase: 79-middle-list-recency-from-skynet-side-send-log-replace-remote*
*Plan: 01*
*Completed: 2026-09-07*
