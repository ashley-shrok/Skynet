---
phase: 126-push-notifications-replacing-telegram-bridge
plan: 01
subsystem: database
tags: [push-notifications, telegram-teardown, schema, drizzle, sqlite, migration]

# Dependency graph
requires:
  - phase: 89-relay-room-sessions
    provides: "relayRoomSessions drizzle table + belt-and-suspenders migration probe pattern (byte-mirror for pushSubscriptions)"
  - phase: 68-drop-identities-table
    provides: "runIdentitiesTableDrop shape — DROP TABLE IF EXISTS + non-fatal warn-and-continue error discipline (byte-mirror for runTelegramBotTokensTableDrop)"
  - phase: 107-hidden-sentinel-migration
    provides: "runHiddenColumnDrop / drops-then-batched-forceSave pattern in migrateSchema (call-site anchor for the new drop)"
provides:
  - "push_subscriptions table: (id, user_id FK cascade, endpoint, p256dh, auth, created_at, last_delivered_at) + UNIQUE(user_id, endpoint) index"
  - "pushSubscriptions drizzle export at schema.ts:914"
  - "runTelegramBotTokensTableDrop(sqliteDb) — idempotent DROP TABLE IF EXISTS for the retired bridge table"
  - "Boot-time drop-migration wired into migrateSchema adjacent to runPinColumnDrop / runHiddenColumnDrop"
  - "Labelled forceSave phase-126-telegram-bot-tokens-table-drop persists the drop to the encrypted SQLite file"
affects: [128-02-push-sender, 128-03-push-trigger-loop, 128-04-vapid-config, 128-05-push-subscriptions-route, 128-06-service-worker, 128-07-enable-notifications-button, 128-08-nginx-routes, 128-09-telegram-source-teardown, 128-10-docker-compose-teardown, 128-11-close]

# Tech tracking
tech-stack:
  added: []  # No new npm deps in this plan — schema-only change
  patterns:
    - "byte-parallel schema DDL: test file re-declares CREATE TABLE + CREATE INDEX verbatim (Phase 89-01 precedent); PATTERNS.md §7"
    - "belt-and-suspenders migration probe: top-of-init CREATE TABLE for fresh installs + SELECT-probe-catch-CREATE block in migrateSchema for upgrade path (Phase 89-01 precedent at db/index.ts:1554-1588)"
    - "whole-table drop mirroring the runIdentitiesTableDrop shape (DROP TABLE IF EXISTS + non-fatal warn on failure)"
    - "drops-then-batched-forceSave: multiple schema mutations in migrateSchema batched under a single forceSave label named for the latest phase touching the file"

key-files:
  created:
    - src/backend/database/db/schema.test.ts
  modified:
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.ts
    - src/backend/database/db/index.migration.test.ts

key-decisions:
  - "Kept the telegramBotTokens drizzle export in schema.ts per Task 1 <action> — churn-diff avoidance; deletion deferred to Plan 09 alongside the wider src/backend/telegram/ teardown."
  - "Renamed the batched forceSave label from phase-107-hidden-sentinel-migration to phase-126-telegram-bot-tokens-table-drop per the file's 'label is always the LATEST migration touching this file' convention (Phase 92 Plan 03 precedent)."
  - "Regression trap Test P128-03 + P128-04: static source-scan asserting the CREATE and 'Phase 79 Plan 01' persist-comment strings are GONE from db/index.ts — traps future edits that re-introduce them before they reach a boot cycle."

patterns-established:
  - "Byte-parallel-copy schema test file at src/backend/database/db/schema.test.ts (mirrors index.phase89-schema.test.ts shape) — future schema additions in Phase 128 (VAPID config table if planner picks DB-row storage) drop into this file."
  - "Web Push subscription persistence uses a per-(user, endpoint) row model, NOT per-user — enforced by UNIQUE(user_id, endpoint) index at DDL layer."

requirements-completed: [D-11, D-13, D-18, D-20]

# Metrics
duration: 25min
completed: 2026-09-21
---

# Phase 128 Plan 01: DB Foundation for Push Notifications + Telegram Bridge Teardown Summary

**push_subscriptions table (per-user, per-endpoint, cascade FK) added to the SQLite schema, and the retired tg-bridge's telegram_bot_tokens table dropped by runTelegramBotTokensTableDrop() at boot — one motion, two atomic schema mutations.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-09-21T01:09:00Z
- **Completed:** 2026-09-21T01:34:00Z
- **Tasks:** 2
- **Files modified:** 4 (2 modified, 1 test file created, 1 test file extended)

## Accomplishments
- push_subscriptions drizzle table + runtime CREATE TABLE + UNIQUE(user_id, endpoint) index — D-11 (persist per-user-per-device) and D-14 (fire on every subscribed device) are now DDL-enforced invariants.
- runTelegramBotTokensTableDrop() drop-migration wired into migrateSchema; the CREATE TABLE for the retired table is deleted; the earlier-Telegram-bridge persist-comment/forceSave is deleted; the drop is batched into a labelled forceSave (phase-126-telegram-bot-tokens-table-drop) so it survives container restart.
- Colocated test coverage: 5 schema tests for push_subscriptions (column shape, UNIQUE enforcement, cascade FK, idempotency, drizzle mirror) + 4 drop-migration tests (hit / miss / static source-scan for the CREATE / static source-scan for the 'Phase 79 Plan 01' persist-comment) — all green.

## Task Commits

Each task followed the TDD gate sequence (test → feat):

1. **Task 1 RED — Add failing schema test for push_subscriptions table** — `fd9b82e3` (test)
2. **Task 1 GREEN — Add push_subscriptions table + UNIQUE(user_id, endpoint) index** — `08daa638` (feat)
3. **Task 2 RED — Add failing tests for runTelegramBotTokensTableDrop drop-migration** — `1c390de7` (test)
4. **Task 2 GREEN — Drop telegram_bot_tokens table via runTelegramBotTokensTableDrop** — `8606ef9e` (feat)

_(Metadata commit follows this SUMMARY.)_

## Files Created/Modified
- `src/backend/database/db/schema.ts` — MODIFIED: added `pushSubscriptions` drizzle table export (line 914) with cascade FK to users.
- `src/backend/database/db/index.ts` — MODIFIED: added top-of-init CREATE TABLE + CREATE UNIQUE INDEX for push_subscriptions; added belt-and-suspenders SELECT-probe migration block; added `runTelegramBotTokensTableDrop()` function + call in migrateSchema; deleted the CREATE TABLE for telegram_bot_tokens; deleted the phase-79-labelled forceSave; renamed the batched-drop forceSave label to phase-126-telegram-bot-tokens-table-drop; added labelled forceSave for phase-126-push-subscriptions-schema-init.
- `src/backend/database/db/schema.test.ts` — CREATED: 5-test byte-parallel schema test file for push_subscriptions.
- `src/backend/database/db/index.migration.test.ts` — MODIFIED: added `runTelegramBotTokensTableDrop` import + 4 new tests (P128-01..P128-04); added fs/path/fileURLToPath imports at file top to support the static source-scan tests.

## Decisions Made
- **VAPID key storage** — deferred to Plan 04 (vapid-config plan). This plan is schema-only for the push subscriptions themselves; VAPID key storage (env-var vs DB-row) is a Claude-discretion decision the vapid-config plan owns.
- **telegramBotTokens drizzle export retained in schema.ts** — plan's Task 1 action explicitly says to leave it for Plan 09 (wider telegram source teardown). The table itself is dropped by this plan; the export becomes orphan dead code until Plan 09.
- **Non-fatal try/catch on the drop call** — chose the runIdentitiesTableDrop shape (warn + continue on failure) over the runPinColumnDrop shape (throw on preflight failure). Whole-table drop doesn't need the SQLite-version preflight (DROP TABLE has been supported since SQLite 1.x), and a lingering table is deadweight not corruption per T-128-04 (accept disposition).

## Deviations from Plan

### Deferred Items

**1. Plan's verification counter `grep -c "telegram_bot_tokens" src/backend/database/db/index.ts in {1, 2}`**
- **Actual count:** 8 (down from 10 pre-trim; trimmed two purely-explanatory tombstones during Task 2).
- **Why:** The remaining 8 references are all load-bearing — function declaration docblock (1), actual DROP TABLE statement (1), error log message text (1), error log context field value (2, one per call site), migration-call docblock (1), and forceSave batching comment (2). Trimming further would lose docs that future maintainers of this destructive migration need.
- **Verification-block spirit is met:** the per-task acceptance criteria (`CREATE = 0`, `DROP >= 1`, `Phase 79 Plan 01 = 0`) all pass. The `{1, 2}` heuristic was aspirational — it didn't distinguish between load-bearing exec statements + log fields vs. dead CREATE + persist-comment. Both dead references are gone.
- **Impact on plan:** none — spirit met, per-task criteria met, downstream plans read the same DDL surface either way.

No auto-fixes needed under Rules 1-3; no Rule 4 architectural questions triggered. The `runTelegramBotTokensTableDrop` implementation followed the byte-mirror pattern from `runIdentitiesTableDrop` exactly.

---

**Total deviations:** 0 auto-fixed; 1 deferred/documented (verification-counter over-count justified by load-bearing log content).
**Impact on plan:** None on architecture. All per-task acceptance criteria pass; full backend build + 2533-test broader-sweep test suite green (139 test files pulled in by db/index.ts as a central dep).

## Issues Encountered

**1. Blocker cleared: fresh workspace had no node_modules + native binding for better-sqlite3 targeted the wrong Node version.**
- Ran `npm install --ignore-scripts` (49s), then `npm run postinstall` for the required patches (electron/nan/guacamole), then `npm rebuild better-sqlite3` to match the local Node 24 ABI.
- One-time workspace bootstrap cost — not a Plan-defined step; documented here for context so future executors on a fresh workspace don't burn time diagnosing the same missing-binding error.
- No source code change needed.

## Threat Flags

None found — the changes add DDL to a table + drop DDL for a retired table. No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what's already in the threat model.

## User Setup Required

None — pure schema/migration change. The drop is destructive per D-20 (user-accepted); on the deployed host's next boot, the persisted telegram_bot_tokens rows disappear. The deploy step is orchestrator-owned per fleet rule and out of this plan's remit.

## Next Phase Readiness

- **DB foundation ready** for Plan 02 (push-sender) — the store module Plan 02 owns will INSERT into push_subscriptions and DELETE on 410/404 pruning; the schema is queryable.
- **DB foundation ready** for Plan 05 (push-subscriptions route) — the POST handler will INSERT with ON CONFLICT DO NOTHING keyed on (user_id, endpoint); the UNIQUE index is in place.
- **Bridge state ready to be swept** for later plans (09-10) that delete src/backend/telegram/* and the docker/compose service — the DB row that solely supports the bridge is gone; the remaining `telegramBotTokens` drizzle export is orphan dead code awaiting Plan 09's deletion.
- **No blockers** — build clean, all tests green, no architectural questions surfaced.

## Self-Check: PASSED

Verified all claims:

- **Files created/modified exist:**
  - `src/backend/database/db/schema.test.ts` → FOUND
  - `src/backend/database/db/schema.ts` → FOUND (contains `export const pushSubscriptions`)
  - `src/backend/database/db/index.ts` → FOUND (contains `runTelegramBotTokensTableDrop` + `CREATE TABLE IF NOT EXISTS push_subscriptions` + zero `CREATE TABLE IF NOT EXISTS telegram_bot_tokens`)
  - `src/backend/database/db/index.migration.test.ts` → FOUND (contains Phase 128 test block)
- **Task commits exist:**
  - `fd9b82e3` → FOUND (test 128-01-1)
  - `08daa638` → FOUND (feat 128-01-1)
  - `1c390de7` → FOUND (test 128-01-2)
  - `8606ef9e` → FOUND (feat 128-01-2)

## TDD Gate Compliance

TDD gate sequence verified for BOTH tasks: `test(128-01-N)` → `feat(128-01-N)`, in chronological git-log order. No REFACTOR commits were needed — the byte-mirror shape from the analogs (Phase 89-01 relay_room_sessions + Phase 68 runIdentitiesTableDrop) landed cleanly in GREEN.

---
*Phase: 126-push-notifications-replacing-telegram-bridge*
*Completed: 2026-09-21*
