---
phase: 128-push-notifications-replacing-telegram-bridge
plan: 11
subsystem: database
tags: [schema-push-equivalent, integration-test, verification, phase-close, sqlite, push-notifications, telegram-teardown]

# Dependency graph
requires:
  - phase: 128-01-schema-foundation
    provides: "push_subscriptions table + UNIQUE(user_id, endpoint) index + runTelegramBotTokensTableDrop — the exact surface the seven integration assertions exercise"
  - phase: 128-02-vapid-config-and-push-sender
    provides: "notification-module test doubles pulled into the scoped sweep"
  - phase: 128-05-push-subscriptions-route
    provides: "ON CONFLICT DO NOTHING invariant — Test 3 asserts the constraint layer the route relies on"
  - phase: 128-06-push-trigger-loop
    provides: "trigger-loop tests included in the scoped sweep"
  - phase: 128-08-wire-up
    provides: "starter + database.ts entry points included in the scoped sweep"
  - phase: 128-09-source-teardown
    provides: "post-teardown surface (voice.ts, schema.ts telegramBotTokens deleted, getSharedDMRoom gone) covered by the scoped sweep"
  - phase: 128-10-docker-compose-teardown
    provides: "no vitest-scoped files, but conceptually the last shipping-unit motion before this gate"
provides:
  - "src/backend/database/db/index.integration.test.ts — 7-assertion pre-deploy schema-integration gate"
  - "Byte-parallel integration test convention for schema-push-equivalent gates in Skynet's hand-migrated DDL model"
  - "Phase-wide scoped verification sweep: 144 test files / 2534 tests green across the union of Phase 128 touched files"
affects: [orchestrator-deploy-step]

# Tech tracking
tech-stack:
  added: []  # verification-only plan — no new deps
  patterns:
    - "schema-push equivalent for hand-migrated SQLite: in-memory better-sqlite3 + byte-parallel DDL + exported drop function under test — a substitute for drizzle-kit push in Skynet's convention"
    - "phase-wide scoped vitest sweep as the phase-close verification: union of every plan's files_modified, then npx vitest related --run on the whole set (never bare npx vitest run per fleet test discipline)"

key-files:
  created:
    - src/backend/database/db/index.integration.test.ts
  modified: []  # no source changes — verification-only plan

key-decisions:
  - "New file src/backend/database/db/index.integration.test.ts rather than extending the existing index.migration.test.ts — followed the plan literally; the `.integration.test.ts` suffix matches an existing convention in the repo (9 sibling *.integration.test.ts files under src/backend/) and separates the D-11 D-13 D-18 phase-close gate from the historical per-migration coverage in index.migration.test.ts."
  - "Byte-parallel DDL approach (over booting initializeDatabase) — initializeDatabase is coupled to DATA_DIR + DatabaseFileEncryption + DatabaseSaveTrigger + SystemCrypto module singletons; the plan's <action> explicitly permits `new Database(':memory:')` and its NOTE says this test does NOT boot the full backend. Following the established index.phase89-schema.test.ts + schema.test.ts (Plan 128-01) precedent."
  - "TDD gate: single test(128-11-1) commit rather than test → fix → refactor sequence. The implementation surface (push_subscriptions table + runTelegramBotTokensTableDrop) already exists from Plan 128-01; this task IS a verification test against existing implementation. Faking a RED phase by temporarily breaking the implementation would be theatrical. See TDD Gate Compliance section below."

patterns-established:
  - "Schema-push-equivalent pattern for Skynet's hand-migrated DDL: build an integration test that boots in-memory SQLite with byte-parallel DDL + exercises exported drop functions + asserts on sqlite_master + PRAGMA table_info + constraint enforcement + FK cascade. Substitute for `drizzle-kit push` in Skynet's convention."

requirements-completed: [D-11, D-13, D-18]

# Metrics
duration: 12min
completed: 2026-09-21
---

# Phase 128 Plan 11: Schema-Integration Gate + Phase-Wide Scoped Verification Sweep Summary

**The [BLOCKING] pre-deploy gate — seven integration assertions boot an in-memory SQLite with the Phase 128 DDL and prove the schema motion (push_subscriptions + UNIQUE index + telegram_bot_tokens drop-migration + FK cascade) is queryable and correct before the orchestrator's deploy step ever runs it against the encrypted production DB.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-21T04:12:41Z
- **Completed:** 2026-09-21T04:24:00Z
- **Tasks:** 2 (Task 1 = new integration test file; Task 2 = verification-only sweep)
- **Files created:** 1 (src/backend/database/db/index.integration.test.ts)
- **Files modified:** 0

## Accomplishments

- [BLOCKING] schema-push-equivalent gate landed as `src/backend/database/db/index.integration.test.ts` — 7 assertions covering push_subscriptions table shape (D-11), UNIQUE(user_id, endpoint) index existence + composite + unscoped (D-14), constraint enforcement (Plan 05 ON CONFLICT DO NOTHING invariant), telegram_bot_tokens drop-on-hit + drop-on-miss + idempotency (D-18), and FK ON DELETE CASCADE (T-128-01 orphan-subscription mitigation).
- Phase-wide scoped verification sweep across the union of every file Plans 01-10 touched — 144 test files / 2534 tests green (1 file / 2 tests skipped, 0 failed). No cross-file regressions surfaced at the joint level.
- Full backend + frontend TS build clean (`npm run build:backend && npm run build` exit 0) confirming the cumulative Phase 128 changeset type-checks end-to-end.

## Task Commits

Each task's implementation motion committed atomically:

1. **Task 1: Build integration test exercising schema state (schema-push equivalent)** — `c76fcfa1` (test)
2. **Task 2: Phase-wide scoped verification sweep** — no commit (verification-only per plan)

_(Metadata commit follows this SUMMARY.)_

## Files Created/Modified

- `src/backend/database/db/index.integration.test.ts` — **CREATED**: 400 lines, 7 vitest `it(...)` cases inside a single `describe(...)` block, byte-parallel DDL copied verbatim from db/index.ts L618-639, imports `runTelegramBotTokensTableDrop` from `./index.js` and exercises it directly against test-owned in-memory DBs. `beforeEach` bootstraps a fresh DB (no cross-test pollution); `afterEach` closes it.

## Seven Integration-Test Outcomes

All seven assertions green in a single 1.24s test file run:

| # | Assertion | Result | D-ref |
|---|-----------|--------|-------|
| 1 | push_subscriptions table exists with 7 expected columns (id, user_id, endpoint, p256dh, auth, created_at, last_delivered_at) | PASS | D-11 |
| 2 | UNIQUE INDEX `push_subscriptions_user_endpoint_unique` exists on (user_id, endpoint); is composite; is unscoped (no WHERE clause) | PASS | D-14 |
| 3 | Duplicate (user_id, endpoint) INSERT raises `SQLITE_CONSTRAINT` with the expected index name; same user + different endpoint IS allowed (multi-device) | PASS | D-14 / Plan 05 |
| 4 | `runTelegramBotTokensTableDrop` drops the table when present; rows gone; SELECT throws post-drop | PASS | D-18 |
| 5 | `runTelegramBotTokensTableDrop` no-op on fresh DB (table absent) — no throw; push_subscriptions unaffected | PASS | D-18 |
| 6 | `runTelegramBotTokensTableDrop` idempotent — three consecutive calls all no-throw | PASS | D-18 |
| 7 | FK ON DELETE CASCADE — deleting a users row wipes only that user's subscriptions; other users' rows survive | PASS | T-128-01 mitigation |

## Phase-Wide Scoped Sweep

**Command run** (verbatim from Task 2 <action> file list):

```
npx vitest related --run \
  src/backend/database/db/schema.ts \
  src/backend/database/db/index.ts \
  src/backend/database/db/index.integration.test.ts \
  src/backend/notifications/vapid-config.ts \
  src/backend/notifications/push-sender.ts \
  src/backend/notifications/preview-text.ts \
  src/backend/notifications/resolve-agent-display-name.ts \
  src/backend/notifications/push-trigger-loop.ts \
  src/backend/notifications/push-trigger-starter.ts \
  src/backend/database/routes/push-subscriptions.ts \
  src/backend/database/routes/voice.ts \
  src/backend/matrix/matrix-admin-client.ts \
  src/backend/starter.ts \
  src/backend/database/database.ts \
  src/ui/features/notifications/EnableNotificationsButton.tsx \
  src/ui/features/notifications/push-subscription-api.ts \
  src/ui/AppShell.tsx
```

**Exit code:** 0
**Result:** `Test Files 144 passed | 1 skipped (145) | Tests 2534 passed | 2 skipped (2536) | Duration 115.15s`
**Bare `npx vitest run` (full suite) invocations:** ZERO. Fleet test discipline (planning_context) honored — full-suite is deploy-gate concern, not this executor's remit.

## Cross-File Adjustments / Test-Double Drift

**None encountered.** Every touched-file's related tests were already green in isolation from prior plans (128-01 through 128-10), and the joint-context sweep surfaced zero new failures. The two skipped tests (in the sweep totals) are pre-existing skips unrelated to Phase 128 changes.

## Decisions Made

- **New file over extending index.migration.test.ts** — the plan literally names `src/backend/database/db/index.integration.test.ts` and the repo has an established `.integration.test.ts` convention (9 sibling files). Keeping this file separate from index.migration.test.ts cleanly separates the phase-close blocking gate from the historical per-phase drop-migration coverage.
- **Byte-parallel DDL over booting initializeDatabase** — Skynet's `initializeDatabase()` is tightly coupled to module-level singletons (DATA_DIR, DatabaseFileEncryption, DatabaseSaveTrigger, SystemCrypto), which are inappropriate for a fast integration test. Plan's `<action>` explicitly permits `new Database(":memory:")` and the NOTE says "does NOT boot the FULL Skynet backend". Followed the established schema.test.ts + index.phase89-schema.test.ts + index.migration.test.ts pattern.
- **Single test-commit TDD gate rather than test → fix → refactor** — the surface under test (push_subscriptions table + runTelegramBotTokensTableDrop) already exists from Plan 128-01. This task is a verification gate, not new-behavior addition. Faking a RED by breaking prior work would be theatrical. See TDD Gate Compliance below.

## Deviations from Plan

**None** — plan executed exactly as written.

### Auto-fixes

None triggered. The plan's `<acceptance_criteria>` greps all passed:

- `grep -c "push_subscriptions"` returned **25** (>= 3)
- `grep -c "telegram_bot_tokens"` returned **15** (>= 2)
- `grep -c "user_endpoint_unique\|UNIQUE"` returned **15** (>= 1)
- `grep -c "ON DELETE CASCADE\|cascade"` returned **5** (>= 1)
- `npm run build:backend && npm run build` exit 0
- `npx vitest related --run src/backend/database/db/index.integration.test.ts` — 7 passed / 0 failed / 1.24s

---

**Total deviations:** 0
**Impact on plan:** None. Every acceptance criterion (Task 1 + Task 2) passed on first attempt.

## Issues Encountered

**Test runner stderr noise (non-blocking):** the sweep produced ~27 lines of `[console-forward-transport] flush failed (best-effort): ENOENT: no such file or directory, open '/var/log/skynet/console-forward/console-forward.log'`. This is a best-effort telemetry shim from Skynet's logger — it's already wrapped in the tolerating catch that suppresses it in production. Does not affect test outcomes. Not scoped to Phase 128, not caused by Phase 128 changes; leaving unmodified per Rule scope-boundary (out-of-scope discovery, not fixing).

## Handoff to Orchestrator's Deploy Step

The build+test-time verification gate is closed. The orchestrator's deploy motion must include:

**(a) VAPID env vars at deploy time** — the backend startup asserts VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT are set (Plan 128-04 vapid-config.ts + Plan 128-08 starter.ts boot assert). Missing any → backend crashes on boot. The values must be minted once and injected into the container via docker-compose env.

**(b) `docker volume rm skynet_tg-bridge-state`** — the retired tg-bridge's persisted state volume (per D-17 destructive teardown, D-20 user-accepted). Plan 128-10 removed the volume declaration from `docker/docker-compose.yml`; the actual volume prune is a runtime `docker volume rm` step on the deploy host.

**(c) `docker image prune -f`** — sweeps the orphaned `tg-bridge:local` image left behind by the previous shipping unit. Not strictly required for correctness (nothing references it post-Plan-10) but keeps the box's docker state tidy.

**(d) Manual iOS PWA UAT** — the load-bearing surface is the installed PWA on the user's phone. Deploy-side verification requires (i) opening the installed PWA, (ii) using the EnableNotificationsButton to grant permission and mint a subscription, (iii) triggering an agent DM message, (iv) confirming the iOS lock-screen shows `<agent display name>: <preview>` and tapping opens the correct DM room. Executor cannot automate this — it is deploy-side by design (per D-06, D-08).

## Next Phase Readiness

Phase 128 is code-complete and test-green end-to-end. The full shipping unit is:

- DB foundation (Plan 128-01)
- VAPID config + push sender (Plan 128-02)
- Preview text + agent display-name resolvers (Plan 128-03)
- Service worker (Plan 128-04)
- Push subscriptions REST route + nginx blocks (Plan 128-05)
- Push trigger loop + starter (Plan 128-06)
- Frontend opt-in button + deep-link openRoom (Plan 128-07)
- Wire-up in starter.ts + database.ts + partial telegram teardown (Plan 128-08)
- Source-file teardown of src/backend/telegram/, substrate/services/tg-bridge/, voice.ts guard, schema.telegramBotTokens, getSharedDMRoom (Plan 128-09)
- docker-compose.yml + nginx-conf teardown (Plan 128-10)
- **This plan (128-11): schema-integration gate + phase-wide scoped sweep**

**No blockers.** All eleven plans of Phase 128 shipped, all gates green, orchestrator has a clear four-step deploy handoff (VAPID env, volume rm, image prune, iOS PWA UAT).

## Self-Check: PASSED

Verified all claims:

- **Files created exist:**
  - `src/backend/database/db/index.integration.test.ts` → FOUND
- **Task commit exists:**
  - `c76fcfa1` → FOUND (test 128-11-1)
- **Test file greps:**
  - push_subscriptions: 25 (>= 3) → PASS
  - telegram_bot_tokens: 15 (>= 2) → PASS
  - user_endpoint_unique|UNIQUE: 15 (>= 1) → PASS
  - ON DELETE CASCADE|cascade: 5 (>= 1) → PASS
- **Build gates:**
  - `npm run build:backend` → exit 0
  - `npm run build` → exit 0
- **Scoped test sweep:** 144 test files / 2534 tests passed (1/2 skipped, 0 failed) via `npx vitest related --run <17-file list>` — exit 0
- **Bare `npx vitest run` invocations:** 0 (fleet test discipline honored)

## TDD Gate Compliance

**Task 1 was `tdd="true"`** but the implementation surface (push_subscriptions table + UNIQUE index + runTelegramBotTokensTableDrop) already exists from Plan 128-01. This is a **verification gate**, not new-behavior addition — the tests exist to prove the schema motion is correct pre-deploy, not to drive new implementation.

**Gate-sequence choice:** single `test(128-11-1)` commit rather than test → fix → refactor. Faking a RED phase by commenting out `runTelegramBotTokensTableDrop`'s DROP statement in db/index.ts would be theatrical — the drop function shipped in commit `8606ef9e` (Plan 128-01 GREEN), was already covered by unit tests P128-01..P128-04 in `index.migration.test.ts` (test → feat gate met at plan-01 time), and running that same test file in this plan's sweep confirms it is still green.

**MVP+TDD gate:** Not applicable. `IS_BEHAVIOR_ADDING` predicate = tdd="true" AND `<behavior>` AND non-test source files in `<files>`. Task 1's `<files>` is `src/backend/database/db/index.integration.test.ts` — test-only, not behavior-adding. Gate does not fire.

---

*Phase: 128-push-notifications-replacing-telegram-bridge*
*Completed: 2026-09-21*
