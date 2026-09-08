---
phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model
plan: 01
subsystem: database
tags: [sqlite, drizzle, matrix, relay-sessions, better-sqlite3, tdd]

# Dependency graph
requires:
  - phase: 88-relay-mediated-group-conversations-sub-slice-a-human-relay-i
    provides: users.mxid column populated for every user (later plans join relay-room rows to users via this)
  - phase: 75-matrix-admin
    provides: matrix-admin-client + matrix_admin_creds singleton (Plan 03 observation loop rides these)
  - phase: 85-identity-send-log
    provides: identity-send-log-store.ts pattern used as structural template for this plan's store modules
provides:
  - relay_room_sessions table (raw SQLite + Drizzle mirror) with (user_id, room_id) UNSCOPED uniqueness
  - admin_rooms table (raw SQLite + Drizzle mirror) as Skynet-instance-owned ignore-list
  - materializeRelayRoomSession + markRelayRoomSessionInactive + reactivateRelayRoomSession + listActiveRelayRoomSessions + refreshRelayRoomLastActivity primitives
  - isAdminRoom + addAdminRoom + listAdminRooms primitives
  - Locked schema shape from D-02 available to Plan 02 (registry-rooms + backfill), Plan 03 (observation loop), Plan 04 (/sessions/list merge)
affects: [89-02, 89-03, 89-04, slice-c-create-room-flow, slice-d-frontend-pane-render]

# Tech tracking
tech-stack:
  added: []  # No new deps — all use fleet-established stack (better-sqlite3, drizzle-orm, crypto.randomUUID)
  patterns:
    - "Two-peer-paths storage (D-01): new session-kind gets a new stored table; existing derived-at-request-time harness path stays byte-identical. NO discriminator column added to any existing table."
    - "Schema-as-coordinator (D-14): unique index on (user_id, room_id) makes both write paths (observation loop + slice C create-room) idempotent without cross-path logic. ON CONFLICT DO NOTHING is the coordination primitive."
    - "External-kick preserves the row (D-03): state transitions active↔inactive, row is never DELETEd. Uniqueness index MUST stay UNSCOPED so re-invite flips the same row rather than allowing a duplicate insert during the gap."
    - "Crown-jewel forceSave discipline: every mutating store primitive is paired with an inline DatabaseSaveTrigger.forceSave('phase-89-...') wrapped in try/catch that logs a databaseLogger.warn on failure and swallows — matches host-autostart-routes.ts:173-181 + identity-send-log-store.ts:167-181."
    - "Raw db.$client.prepare (better-sqlite3) in the store modules rather than Drizzle chain — matches the plan's read_first anchor and keeps hot-path stores lean."
    - "Byte-parallel DDL: same CREATE TABLE + INDEX literal appears in db/index.ts (init block), db/index.ts (migration block), and each store test's local scaffolding (three sites locked together per Phase 43/85 discipline; index.phase89-schema.test.ts Test 2 is the trip-wire if any site drifts)."

key-files:
  created:
    - src/backend/relay-sessions/relay-room-sessions-store.ts
    - src/backend/relay-sessions/relay-room-sessions-store.test.ts
    - src/backend/relay-sessions/admin-rooms-ignore-list.ts
    - src/backend/relay-sessions/admin-rooms-ignore-list.test.ts
    - src/backend/database/db/index.phase89-schema.test.ts
  modified:
    - src/backend/database/db/index.ts (added CREATE TABLE + UNIQUE INDEX blocks in the init exec block AND belt-and-suspenders migration probes; added labeled forceSave for phase-89-relay-sessions-schema-init)
    - src/backend/database/db/schema.ts (appended relayRoomSessions + adminRooms Drizzle mirrors after identitySendLog)

key-decisions:
  - "Table name relay_room_sessions (planner's choice per D-16) — follows the snake_case_plural_of_entity convention (sessions, trusted_devices, matrix_admin_creds)."
  - "admin_rooms shape: dedicated small table rather than JSON-in-settings row (D-16 planner-choice). Easier to inspect via SQL for ops debugging, negligible overhead for ~2 rows expected, extends cleanly to future admin-purposes-only rooms."
  - "randomUUID from 'crypto' (fleet idiom — matches ssh/opkssh-auth.ts + ssh/host-transfer.ts) for the id column."
  - "Inline forceSave call site rather than a hoisted safeForceSave helper — matches identity-send-log-store.ts pattern AND satisfies plan's grep verify spec (forceSave.*phase-89- appears 4x, one per mutating primitive)."
  - "Store modules use db.$client.prepare (raw better-sqlite3) rather than Drizzle chains — plan's read_first explicitly anchors this pattern."

patterns-established:
  - "Pattern: New relay-sessions subsystem directory at src/backend/relay-sessions/ (previously did not exist). Plan 03's observation loop lands here as observation-loop.ts."
  - "Pattern: Store-module contract tests use vi.mock('../database/db/index.js') with a getter that returns { \\$client: sqliteInstance } backed by fresh in-memory better-sqlite3 per beforeEach. Byte-parallel DDL scaffolding lives in the test file."
  - "Pattern: labeled forceSave reason strings prefixed 'phase-89-*' so `grep -c '\"phase-89-' | wc` is an audit primitive."

requirements-completed: [D-01, D-02, D-03, D-14, D-16]

# Metrics
duration: ~13min
completed: 2026-09-08
---

# Phase 89 Plan 01: Session-model storage substrate Summary

**Two new SQLite tables (relay_room_sessions + admin_rooms) with raw+Drizzle mirror parity, plus store modules exposing 8 primitives — schema-as-coordinator for slice B's observation-loop / create-room idempotency, external-kick row-preservation, and crown-jewel forceSave discipline.**

## Performance

- **Duration:** ~13 min (from first RED at 13:49:57Z to last GREEN at 14:02:30Z)
- **Started:** 2026-09-08T13:49:00Z
- **Completed:** 2026-09-08T14:02:30Z
- **Tasks:** 3 (all TDD RED → GREEN cycles)
- **Files modified:** 2 (db/index.ts + schema.ts)
- **Files created:** 5 (3 source + 2 test + 1 schema test)
- **Test count:** 22 new scoped tests across 3 files (5 schema + 9 store + 8 ignore-list); all 57 tests across phase-89 + immediate neighbors (db.migration, tokens-store, identity-send-log-store) pass green

## Accomplishments

- Two new tables landed in both raw SQLite init block (top-of-init exec) AND belt-and-suspenders migration block (probe-then-create pattern) — matches sessions/trusted_devices/network_topology precedent.
- Unique index on (user_id, room_id) is UNSCOPED per D-02 — enforced live in schema tests (Test 2 asserts UNIQUE constraint fires when a second row is inserted for the same pair regardless of state value).
- All 5 store primitives + 3 ignore-list primitives exported with the exact signatures locked in plan spec.
- Every mutating primitive paired with a labeled `phase-89-*` forceSave in inline try/catch matching the identity-send-log-store.ts pattern.
- Zero new dependencies — reuses fleet-established better-sqlite3 + drizzle-orm + crypto.randomUUID.
- No regressions in adjacent stores (telegram tokens, identity send log, db migration test all still green).

## Task Commits

Each task followed strict RED → GREEN TDD cycles:

1. **Task 1: relay_room_sessions + admin_rooms schema (raw SQL + Drizzle mirror)**
   - RED: `2fd3d92d` — `test(89-01-task1): RED — schema tests for relay_room_sessions + admin_rooms`
   - GREEN: `571e09cc` — `feat(89-01-task1): GREEN — relay_room_sessions + admin_rooms schema`
2. **Task 2: relay-room-sessions store module with idempotent primitives**
   - RED: `3e8c3bfa` — `test(89-01-task2): RED — relay-room-sessions-store contract tests`
   - GREEN: `8bb6b8c4` — `feat(89-01-task2): GREEN — relay-room-sessions-store with 5 primitives`
3. **Task 3: Admin-rooms ignore-list module**
   - RED: `595066c5` — `test(89-01-task3): RED — admin-rooms ignore-list contract tests`
   - GREEN: `ea344af5` — `feat(89-01-task3): GREEN — admin-rooms ignore-list module`

## Files Created/Modified

### Created
- `src/backend/database/db/index.phase89-schema.test.ts` — 5-test scoped coverage of the new schema (columns, FK, unscoped uniqueness index, DDL idempotency, Drizzle mirror parity)
- `src/backend/relay-sessions/relay-room-sessions-store.ts` — 5-primitive store module (materialize / markInactive / reactivate / listActive / refreshLastActivity), inline forceSave discipline, structured logging at boundaries
- `src/backend/relay-sessions/relay-room-sessions-store.test.ts` — 9-test scoped coverage of the store's contract (idempotency, state transitions, preserve-on-inactivate, forceSave labeling, log-and-swallow)
- `src/backend/relay-sessions/admin-rooms-ignore-list.ts` — 3-primitive ignore-list module (isAdminRoom / addAdminRoom / listAdminRooms)
- `src/backend/relay-sessions/admin-rooms-ignore-list.test.ts` — 8-test scoped coverage (empty-table, add-then-query, idempotent add, list, forceSave labeling, log-and-swallow)

### Modified
- `src/backend/database/db/index.ts` — 4 changes:
  - Added CREATE TABLE IF NOT EXISTS relay_room_sessions (8 columns per D-02, FK to users ON DELETE CASCADE) in top-of-init exec block
  - Added CREATE UNIQUE INDEX IF NOT EXISTS relay_room_sessions_user_room_uidx (UNSCOPED) immediately after
  - Added CREATE TABLE IF NOT EXISTS admin_rooms in top-of-init exec block
  - Added belt-and-suspenders migration probes (SELECT LIMIT 1 → CREATE on throw) for both tables after the network_topology probe
  - Added labeled forceSave("phase-89-relay-sessions-schema-init") in try/catch matching phase-75/79/85 precedent
- `src/backend/database/db/schema.ts` — Appended relayRoomSessions + adminRooms Drizzle mirrors after identitySendLog with matching column names and references(() => users.id, { onDelete: "cascade" }) shape

## Decisions Made

All decisions followed plan spec verbatim (no architectural deviations). Two planner-discretion choices lifted from the plan's `<action>` blocks:

- **relay_room_sessions table name** (D-16 discretion): chose snake_case plural of entity per fleet convention (sessions, trusted_devices, matrix_admin_creds).
- **admin_rooms storage shape** (D-16 discretion): dedicated small table rather than JSON-in-settings row — easier ops inspection via raw SQL, negligible overhead for ~2 rows.

## Deviations from Plan

**Total:** 1 minor refactor (self-caught during grep verification, immediately corrected)

### Auto-fixed Issues

**1. [Rule 3 - Blocking (grep-verify)] Refactored hoisted safeForceSave helper back to inline try/catch calls**
- **Found during:** Task 2 (relay-room-sessions-store GREEN verification)
- **Issue:** Initial GREEN implementation extracted the four `forceSave` call sites into a `safeForceSave(reason, ctx)` helper for DRY. The plan's human-check grep spec (`grep -v '^ *[/\*]' | grep -c 'forceSave.*"phase-89-'` must return >= 4) is looking for inline `forceSave("phase-89-*")` string co-location. The DRY helper hid this pattern from the grep (returned 0).
- **Fix:** Inlined the try/catch + forceSave call at each of the four mutating primitives with the label string co-located at the `forceSave(...)` call site. Matches the identity-send-log-store.ts pattern exactly (which also inlines rather than extracting a helper).
- **Files modified:** `src/backend/relay-sessions/relay-room-sessions-store.ts`
- **Verification:** Grep returns 4 (one per mutating primitive: materialize, markInactive, reactivate, refreshLastActivity). All 9 store tests still pass.
- **Committed in:** `8bb6b8c4` (Task 2 GREEN — refactor was applied before the commit landed, so this shows as the initial GREEN implementation)

Also worth noting (not a deviation, but a self-caught test bug):

- **Task 1 RED Test 2** initially failed with `SqliteError: FOREIGN KEY constraint failed` because I enabled `PRAGMA foreign_keys = ON` in the scaffolding (to match production db init) but didn't seed a users row before the relay_room_sessions insert. Fixed by seeding user-A before the INSERT — matches production semantics rather than working around the FK. Fix landed in the same RED commit before it was signed off.

---

**Impact on plan:** Refactor was self-caught during human-check grep verification and corrected before Task 2 GREEN commit. Plan letter + intent both preserved. No scope creep. No architectural changes.

## Issues Encountered

- **vitest 4.1.8 flag syntax:** Plan's `<verify>` block specifies `npx vitest run --related <files>` but that flag isn't recognized on vitest 4.1.8 (`--related` was renamed to a `related` subcommand: `npx vitest related --run <files>`). Used the subcommand form. This is a minor plan-spec discrepancy worth flagging for future plans (not a code issue).
- **Pre-existing EADDRINUSE error** in an unrelated test file (`claude-session-server.aside.test.ts` — port 30011 already in use) surfaced during the `vitest related` sweep. Verified this is pre-existing (not caused by phase-89 changes) — 68 test files passed, 1163 tests passed in the sweep despite the port collision. Out of scope per executor Rule (Scope Boundary); logged here rather than fixed.
- **`.husky/pre-commit` and `.husky/commit-msg` hooks not executable:** git printed a warning on every commit ("hook was ignored because it's not set as executable"). Pre-existing environment condition — not phase-89 code. No commit failed; hooks were simply skipped.

## User Setup Required

None — pure backend infrastructure. Nothing user-visible ships in this plan (per plan's `<objective>`: "No behavior surfaces to users in this plan — pure infrastructure").

## Next Phase Readiness

**Ready for Plan 89-02 (Wave 2 — registry rooms + backfill script):**
- `addAdminRoom(roomId)` primitive available for Plan 89-02 to populate the ignore-list with the agents-registry + humans-registry room IDs at creation time (D-13).
- `relay_room_sessions` schema in place — no downstream schema changes needed in later plans.

**Ready for Plan 89-03 (Wave 3 — observation loop):**
- `materializeRelayRoomSession` / `markRelayRoomSessionInactive` / `reactivateRelayRoomSession` / `refreshRelayRoomLastActivity` / `isAdminRoom` all available as the primitive vocabulary the observation loop calls.
- `listActiveRelayRoomSessions` available for reads.

**Ready for Plan 89-04 (Wave 4 — /sessions/list merge):**
- `listActiveRelayRoomSessions(userId)` returns the exact shape (`{ id, roomId, roomTitle, lastActivityAt, createdAt, updatedAt }`) the merge integration will append to the derived harness sessions list.

**Ready for slice C (parallel arc, sub-slice C — create-room flow):**
- `materializeRelayRoomSession` is the shared coordinator primitive slice C's create-room flow calls (D-14). Observation loop is the safety net if slice C's insert fails mid-way — schema uniqueness makes both paths idempotent regardless of order.

No blockers, no concerns. All three tasks landed clean.

## Self-Check: PASSED

**Files verified to exist:**
- `src/backend/database/db/index.phase89-schema.test.ts` — FOUND
- `src/backend/relay-sessions/relay-room-sessions-store.ts` — FOUND
- `src/backend/relay-sessions/relay-room-sessions-store.test.ts` — FOUND
- `src/backend/relay-sessions/admin-rooms-ignore-list.ts` — FOUND
- `src/backend/relay-sessions/admin-rooms-ignore-list.test.ts` — FOUND
- `src/backend/database/db/index.ts` — MODIFIED (verified via git log)
- `src/backend/database/db/schema.ts` — MODIFIED (verified via git log)

**Commits verified via `git log --oneline`:**
- `2fd3d92d` test(89-01-task1) RED — FOUND
- `571e09cc` feat(89-01-task1) GREEN — FOUND
- `3e8c3bfa` test(89-01-task2) RED — FOUND
- `8bb6b8c4` feat(89-01-task2) GREEN — FOUND
- `595066c5` test(89-01-task3) RED — FOUND
- `ea344af5` feat(89-01-task3) GREEN — FOUND

**Plan `<verify>` blocks:**
- Task 1 automated: `npx vitest related --run src/backend/database/db/index.ts src/backend/database/db/schema.ts` — 68 test files passed, 1163 tests passed (1 pre-existing port-collision error unrelated to phase-89)
- Task 1 human-check greps: all 5 grep-count expectations met (2, 2, 1, 1, 2 vs. expected 2, 2, 1, 1, ≥1)
- Task 2 automated: `npx vitest run src/backend/relay-sessions/relay-room-sessions-store.test.ts` — 9 tests passed
- Task 2 human-check greps: all 3 grep-count expectations met (1, 4, 3 vs. expected 1, ≥4, ≥2)
- Task 3 automated: `npx vitest run src/backend/relay-sessions/admin-rooms-ignore-list.test.ts` — 8 tests passed
- Task 3 human-check greps: all 3 grep-count expectations met (1, 3, 1 vs. expected 1, ≥1, 1)

## TDD Gate Compliance

Each task followed strict RED → GREEN cycles:
- Task 1: `test(89-01-task1): RED` (2fd3d92d) → `feat(89-01-task1): GREEN` (571e09cc). RED verified failing (Drizzle mirror export missing) before GREEN. No REFACTOR needed.
- Task 2: `test(89-01-task2): RED` (3e8c3bfa) → `feat(89-01-task2): GREEN` (8bb6b8c4). RED verified failing (module import error) before GREEN. No REFACTOR needed.
- Task 3: `test(89-01-task3): RED` (595066c5) → `feat(89-01-task3): GREEN` (ea344af5). RED verified failing (module import error) before GREEN. No REFACTOR needed.

All three RED commits are strictly before their GREEN counterparts in git log. Gate sequence compliant.

---
*Phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model*
*Plan: 01*
*Completed: 2026-09-08*
