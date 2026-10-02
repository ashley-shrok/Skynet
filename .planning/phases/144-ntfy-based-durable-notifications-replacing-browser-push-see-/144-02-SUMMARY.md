---
phase: 144-ntfy-based-durable-notifications-replacing-browser-push-see-
plan: 02
subsystem: backend-notifications
tags: [ntfy, push-notifications, schema-migration, field-crypto, http-admin-api, backend]

# Dependency graph
requires:
  - "144-01: ntfy-config.ts (getNtfyAdminUser, getNtfyAdminPassword, getNtfyInternalPublishUrl, getNtfyPublishToken, getNtfyBaseUrl)"
  - "144-01: server.yml admin user provisioning at compose up (HC-2 bootstrap fix)"
provides:
  - "push_subscriptions table rebuilt to ntfy shape (user_id UNIQUE, topic_name UNIQUE, reading_credential encrypted, ntfy_username)"
  - "runPushSubscriptionsRebuild() boot-time schema migration (DROP old web-push shape, CREATE new ntfy shape)"
  - "FieldCrypto.ENCRYPTED_FIELDS.push_subscriptions encrypting reading_credential"
  - "ntfy-admin-client.ts: HTTP admin API client (createNtfyUser, deleteNtfyUser, grantTopicReadAccess, revokeTopicAccess, mintUserToken)"
  - "ntfy-sender.ts: fire-and-forget HTTP POST publisher + null-safe buildClickUrl (HC-4)"
  - "push-sender.ts: thin re-export shim preserving push-trigger-loop.ts import surface"
  - "push-subscriptions.ts: GET/POST /ntfy-setup, POST /ntfy-test, POST /ntfy-regenerate, DELETE /ntfy-setup"
  - "ntfy-bootstrap.ts: ensureSkynetPublisherUserExists belt-and-suspenders"
affects:
  - "144-03: frontend preferences pane reads from these routes"
  - "144-04: plan 04 removes VAPID remnants, removes push-sender shim, rewires imports"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ntfy HTTP admin API client with NtfyAdminError and Basic auth split (admin vs per-user)"
    - "fire-and-forget-with-logs ntfy publisher (AbortSignal.timeout + databaseLogger.warn)"
    - "buildClickUrl null-safe deep-link builder via URLSearchParams (HC-4 fix)"
    - "runPushSubscriptionsRebuild DROP+CREATE migration mirroring runTelegramBotTokensTableDrop"
    - "FieldCrypto per-user encryption for reading_credential column"
    - "MC-4 pattern: SELECT ntfy_username from DB before DELETE/regenerate (never reconstruct)"
    - "TDD RED/GREEN per task: test committed before implementation"

key-files:
  created:
    - src/backend/notifications/ntfy-admin-client.ts
    - src/backend/notifications/ntfy-admin-client.test.ts
    - src/backend/notifications/ntfy-sender.ts
    - src/backend/notifications/ntfy-sender.test.ts
    - src/backend/notifications/ntfy-bootstrap.ts
    - src/backend/notifications/ntfy-bootstrap.test.ts
  modified:
    - src/backend/database/db/schema.ts
    - src/backend/database/db/index.ts
    - src/backend/utils/field-crypto.ts
    - src/backend/database/db/schema.test.ts
    - src/backend/notifications/push-sender.ts
    - src/backend/database/routes/push-subscriptions.ts
    - src/backend/database/routes/push-subscriptions.test.ts
    - src/backend/starter.ts

key-decisions:
  - "HC-3: no ntfy_publish_config singleton table — publish token is env-var-only (NTFY_PUBLISH_TOKEN)"
  - "HC-4: buildClickUrl uses URLSearchParams and only appends host= when agentHostId is non-null — no host=null ever emitted"
  - "MC-4: DELETE and REGENERATE route handlers SELECT ntfy_username from the stored DB row; never reconstruct from userId"
  - "HC-1: ensureSkynetPublisherUserExists calls createNtfyUser(getNtfyAdminUser(), ...) — no hardcoded admin name"
  - "mintUserToken uses per-user Basic auth (not admin) — critical ntfy ensureUser vs ensureAdmin split"
  - "Regenerate pattern: delete+recreate ntfy user (since original password is not stored) rather than token-only rotation"
  - "push-sender.ts is a thin shim re-exporting from ntfy-sender.ts — push-trigger-loop.ts unchanged"

# Metrics
duration: 15min
completed: 2026-10-02T22:41:57Z
---

# Phase 144 Plan 02: Backend Swap Summary

**push_subscriptions schema migrated to ntfy shape; ntfy-admin-client HTTP client + ntfy-sender fire-and-forget publisher + rebuilt routes with HC-4 null-safe buildClickUrl and MC-4 DB-read ntfy_username**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-10-02T22:26:51Z
- **Completed:** 2026-10-02T22:41:57Z
- **Tasks:** 3 (each TDD: RED + GREEN)
- **Files modified:** 8 modified + 6 created = 14 total

## Accomplishments

### Task 1: push_subscriptions schema rebuild + FieldCrypto + boot migration

- `schema.ts`: replaced Phase 128 web-push columns (endpoint/p256dh/auth/last_delivered_at) with ntfy shape: `user_id TEXT NOT NULL UNIQUE`, `topic_name TEXT NOT NULL UNIQUE`, `reading_credential TEXT NOT NULL`, `ntfy_username TEXT NOT NULL`, `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `field-crypto.ts`: added `push_subscriptions: new Set(["reading_credential"])` to `ENCRYPTED_FIELDS`
- `index.ts`: added `runPushSubscriptionsRebuild()` (DROP old index + old table, CREATE new ntfy schema); replaced Phase 128 migration probe with call to this function; updated forceSave label to `phase-144-push-subscriptions-rebuild`
- HC-3 scope guard enforced: no `ntfy_publish_config` table anywhere in DDL/Drizzle
- All 8 SCH tests pass (SCH-01..SCH-08)

### Task 2: ntfy-admin-client + ntfy-sender + push-sender shim

- `ntfy-admin-client.ts`: HTTP admin API client with `NtfyAdminError`, `createNtfyUser`, `deleteNtfyUser`, `grantTopicReadAccess`, `revokeTopicAccess`, `mintUserToken`; all with `AbortSignal.timeout(5000)`; critical admin-vs-per-user Basic auth split for `mintUserToken` (uses per-user credentials, not admin)
- `ntfy-sender.ts`: `sendPushToUser` with single SELECT + HTTP POST + fire-and-forget-with-logs; `buildClickUrl` with HC-4 null-safety (URLSearchParams, omits `host=` param when agentHostId is null)
- `push-sender.ts`: thin re-export shim preserving `push-trigger-loop.ts` import surface unchanged
- All 17 ADM+SND tests pass; push-trigger-loop 20 tests still green

### Task 3: push-subscriptions routes + ntfy-bootstrap

- `push-subscriptions.ts`: rebuilt with `handleGetNtfySetup`, `handlePostNtfySetup`, `handlePostNtfyRegenerate`, `handlePostNtfyTest`, `handleDeleteNtfySetup`; `GET /vapid-public-key` deliberately NOT mounted; all routes gated by `authenticateJWT`; FieldCrypto encrypts `reading_credential` via user data key from DataCrypto; MC-4 fix applied to DELETE and REGENERATE handlers
- `ntfy-bootstrap.ts`: belt-and-suspenders `ensureSkynetPublisherUserExists`; HC-1: uses `getNtfyAdminUser()` not hardcoded name; 409 swallowed as expected (server.yml already provisioned admin user); other errors logged at warn, do not throw
- `starter.ts`: fire-and-forget `void import("./notifications/ntfy-bootstrap.js")` after `assertNtfyConfigAtBoot()`
- All 14 RT+NB tests pass

## Task Commits

1. **Task 1 RED** — `e707b9f3` (test)
2. **Task 1 GREEN** — `ef64cf43` (feat)
3. **Task 2 RED** — `f1ee1988` (test)
4. **Task 2 GREEN** — `1c99c2d1` (feat)
5. **Task 3 RED** — `b54b7e1b` (test)
6. **Task 3 GREEN** — `6775cfcf` (feat)
7. **Task 3 fix** — `d78846ef` (fix)

## Files Created/Modified

- `src/backend/database/db/schema.ts` — pushSubscriptions table rebuilt (ntfy shape; no endpoint/p256dh/auth)
- `src/backend/database/db/index.ts` — top-of-init DDL updated; runPushSubscriptionsRebuild added + called in migrateSchema; forceSave label updated to phase-144
- `src/backend/utils/field-crypto.ts` — push_subscriptions: Set(['reading_credential']) added to ENCRYPTED_FIELDS
- `src/backend/database/db/schema.test.ts` — replaced Phase 128 tests with SCH-01..SCH-08
- `src/backend/notifications/ntfy-admin-client.ts` — HTTP admin API client (NEW)
- `src/backend/notifications/ntfy-admin-client.test.ts` — ADM-01..ADM-07 tests (NEW)
- `src/backend/notifications/ntfy-sender.ts` — fire-and-forget publisher + buildClickUrl (NEW)
- `src/backend/notifications/ntfy-sender.test.ts` — SND-01..SND-08 tests (NEW)
- `src/backend/notifications/push-sender.ts` — thin re-export shim (REPLACED)
- `src/backend/notifications/ntfy-bootstrap.ts` — belt-and-suspenders bootstrap (NEW)
- `src/backend/notifications/ntfy-bootstrap.test.ts` — NB-01..NB-02 tests (NEW)
- `src/backend/database/routes/push-subscriptions.ts` — rebuilt for ntfy routes (REPLACED)
- `src/backend/database/routes/push-subscriptions.test.ts` — RT-01..RT-09 tests (REPLACED)
- `src/backend/starter.ts` — added ensureSkynetPublisherUserExists fire-and-forget call

## Decisions Made

- **HC-3 enforced:** No `ntfy_publish_config` table — publish token is env-var-only. DDL checked and SCH-08 verifies at runtime.
- **HC-4 implemented:** `buildClickUrl` uses `URLSearchParams`; host param only added when `agentHostId !== null`. SND-06/07/08 tests and grep gate verify no `host=null` emission.
- **MC-4 implemented:** DELETE and REGENERATE route handlers `SELECT ntfy_username FROM push_subscriptions WHERE user_id = ?` before calling ntfy admin API. RT-07 verifies with weirdcase ntfy_username.
- **HC-1 implemented:** `ensureSkynetPublisherUserExists` calls `createNtfyUser(getNtfyAdminUser(), ...)`. The literal admin name string is not hardcoded anywhere in ntfy-bootstrap.ts.
- **mintUserToken auth split:** Uses per-user Basic auth for `/v1/account/token` (ensureUser gate in ntfy), not admin. ADM-05 verifies this critical distinction.
- **Regenerate pattern:** Since the original reader password is not stored (only the token), regenerate deletes + recreates the ntfy user to invalidate all existing tokens, then mints a new one.

## Deviations from Plan

**1. [Rule 1 - Bug] PushPayload.agentHostId changed to `number | null`**
- **Found during:** Task 2 implementation
- **Issue:** The existing push-sender.ts had `agentHostId: number`, but the plan requires buildClickUrl to handle `null` for /ntfy-test route. The push-trigger-loop already drops pushes when `agentHostId === null` before calling sendPushToUser, so making the type `number | null` is correct and doesn't break the trigger loop.
- **Fix:** Changed PushPayload.agentHostId from `number` to `number | null` in ntfy-sender.ts
- **Files modified:** src/backend/notifications/ntfy-sender.ts
- **Commit:** 1c99c2d1

## Known Stubs

None — all routes read/write real DB rows; FieldCrypto encryption is real; ntfy admin API calls are real HTTP. No hardcoded placeholder data in any rendered path.

## Threat Flags

None — all threat mitigations from the plan's `<threat_model>` are implemented:
- T-144-06: FieldCrypto.ENCRYPTED_FIELDS.push_subscriptions encrypts reading_credential (SCH-05 verified)
- T-144-07: NtfyAdminError caught, generic 500 returned — no credential leakage in responses
- T-144-08: All routes gated by authenticateJWT (RT-09 verified by construction)
- T-144-10: AbortSignal.timeout(5000) on all ntfy HTTP calls (ADM-06 verified)
- T-144-11: databaseLogger.warn on every ntfy_publish_failed + ntfy_publish_threw (SND-03/04 verified)
- T-144-23 (HC-4): buildClickUrl omits host param when null (SND-06/07/08 verified)
- T-144-24 (MC-4): DELETE/regenerate read ntfy_username from DB row (RT-07 weirdcase verified)

## Self-Check: PASSED

- `src/backend/notifications/ntfy-admin-client.ts` exists with 6 exports: VERIFIED
- `src/backend/notifications/ntfy-sender.ts` exists with buildClickUrl + sendPushToUser: VERIFIED
- `src/backend/notifications/push-sender.ts` is a shim re-exporting from ntfy-sender.js: VERIFIED
- `src/backend/notifications/ntfy-bootstrap.ts` exists with ensureSkynetPublisherUserExists: VERIFIED
- `src/backend/database/routes/push-subscriptions.ts` has /ntfy-setup + /ntfy-test + /ntfy-regenerate: VERIFIED
- `src/backend/database/db/schema.ts` has ntfy columns (topic_name, reading_credential, ntfy_username): VERIFIED
- `src/backend/utils/field-crypto.ts` has push_subscriptions: Set(['reading_credential']): VERIFIED
- All 59 tests pass across 6 test files: VERIFIED
- `npm run build:backend` exits 0: VERIFIED
- `npm run build` exits 0: VERIFIED
- Commits present: e707b9f3, ef64cf43, f1ee1988, 1c99c2d1, b54b7e1b, 6775cfcf, d78846ef: VERIFIED

---
*Phase: 144-ntfy-based-durable-notifications-replacing-browser-push-see-*
*Completed: 2026-10-02*
