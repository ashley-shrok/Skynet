---
phase: 85-user-avatars-baseline-backend-support
plan: "07"
subsystem: testing
tags: [phase-87, user-avatars, integration-test, end-to-end, lifecycle, nginx-smoke-checkpoint]

# Dependency graph
requires:
  - phase: 85-user-avatars plan 01
    provides: avatar_path column + addColumnIfNotExists migration + migration test
  - phase: 85-user-avatars plan 02
    provides: user-avatar-storage.ts (writeUserAvatar, unlinkUserAvatar, readUserAvatar, userAvatarUpload)
  - phase: 85-user-avatars plan 03
    provides: POST /users/create multipart + mandatory avatar enforcement
  - phase: 85-user-avatars plan 04
    provides: PUT /users/:id/avatar change endpoint + GET /users/:id/avatar serve endpoint
  - phase: 85-user-avatars plan 05
    provides: D-22 cleanup wiring in delete-user-data.ts + users.ts delete-account
  - phase: 85-user-avatars plan 06
    provides: client_max_body_size 6M in both nginx.conf + nginx-https.conf
provides:
  - End-to-end lifecycle integration test (create → serve → change → serve → delete → verify-clean)
  - REAL file I/O exercised: writeUserAvatar + readUserAvatar + unlinkUserAvatar with tmpdir
  - DatabaseSaveTrigger.forceSave spy confirms both "phase-87-user-avatar-create" + "phase-87-user-avatar-change" labels
  - Disk state assertions at 8 points across lifecycle (file-after-create, bytes-round-trip GET1, ext-swap-new-file, old-file-unlinked, bytes-round-trip-GET2, file-after-delete, dir-empty)
  - Nginx-edge smoke checkpoint documented for post-deploy verification
affects:
  - Phase 87 ship-gate: all prior unit tests + this integration test must pass before ship
  - Any downstream plan consuming GET /users/:id/avatar or PUT /users/:id/avatar

# Tech tracking
tech-stack:
  added: []  # no new packages — vitest, better-sqlite3, express already present
  patterns:
    - "Single-flow integration test: all lifecycle steps in one it() so state from step N feeds step N+1"
    - "Real file I/O in integration tests: tmpdir + process.env.DATA_DIR set before server import"
    - "saveSpy = forceSaveFn at module scope so vi.mock factory closure is stable across test lifecycle"
    - "Seed-admin-first pattern: pre-seed one admin so the test-created user is non-admin, avoids last-admin 403 on delete"
    - "bcryptjs stub for integration test: compare always returns true so delete-account password check passes without real hashing"

key-files:
  created:
    - src/backend/database/routes/user-avatars.integration.test.ts
  modified: []

key-decisions:
  - "Single it() for the full lifecycle — state-dependency makes split tests invalid (Step 3 GET needs Step 1's aliceId)"
  - "Real file I/O, mocked auth: filesystem is what we're proving end-to-end; auth chain (bcrypt + JWT + session) adds noise without adding coverage for D-12 through D-22"
  - "Module-scope forceSaveFn rather than vi.spyOn: avoids the captured-undefined problem that arises when vi.resetModules() re-runs the mock factory"
  - "Seed admin pre-populated in bootstrapDb: prevents the 403 from users.ts line 2235 (cannot delete last admin)"
  - "bcryptjs compare stubbed to true: delete-account needs password verification; stubbing avoids the real bcrypt cost + the test's purpose is file cleanup, not password security"
  - "beforeAll for server (one start for the suite), beforeEach for DB + spy reset: mirrors users.test.ts pattern, avoids cold import per test"

requirements-completed: [D-07, D-09, D-10, D-11, D-14, D-15, D-16, D-17, D-18, D-19, D-20, D-21, D-22]

# Metrics
duration: 45min
completed: 2026-09-08
---

# Phase 87 Plan 07: End-to-end Integration Test Summary

**902-line single-flow integration test proves the full Phase 87 lifecycle — create-with-avatar to delete-cleans-disk — with real file I/O, real in-memory SQLite, and forceSave spy assertions; nginx-edge smoke checkpoint documented for post-deploy execution**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-09-08
- **Tasks:** 1 auto task completed (Task 2 is a checkpoint — documented below)
- **Files modified:** 1 created

## Accomplishments

### Integration Test (Task 1)

File `src/backend/database/routes/user-avatars.integration.test.ts` — 902 lines, 1 test case, passes green.

The single-flow test covers 8 assertion points across 6 HTTP steps:

| Step | HTTP | Status | Assertion |
|------|------|--------|-----------|
| 1 | POST /users/create (PNG multipart) | 200 | row.avatar_path set + file on disk + spy("phase-87-user-avatar-create") |
| 2 | Set authControl.userId from real aliceId | — | simulated login |
| 3 | GET /users/:id/avatar | 200 | Content-Type: image/png + bytes byte-for-byte match validPngBytes |
| 4 | PUT /users/:id/avatar (WebP ext-swap) | 200 | row.avatar_path updated + new .webp on disk + old .png unlinked + spy("phase-87-user-avatar-change") |
| 5 | GET /users/:id/avatar | 200 | Content-Type: image/webp + bytes byte-for-byte match validWebpBytes |
| 6 | DELETE /users/delete-account | 200 | row gone + .webp file gone from disk + USER_AVATARS_DIR empty of image files |

### What is REAL (not mocked)

- `writeUserAvatar` / `readUserAvatar` / `unlinkUserAvatar` — actual fs.writeFile / fs.readFile / fs.unlink on tmpdir
- multer multipart parsing — runs end-to-end inside the real Express handler
- SQLite in-memory DB — real $client.prepare + transaction + raw SQL UPDATE/DELETE
- USER_AVATARS_DIR creation via mkdir { recursive: true }

### What is spied/mocked

- `DatabaseSaveTrigger.forceSave` — vi.fn() spy at module scope; records calls + resolves void
- `authenticateJWT` middleware — injects req.userId from `authControl.userId`
- `AuthManager.registerUser` — stubs encryption setup (not what this test exercises)
- `bcryptjs.compare` — always returns true (delete-account password check)
- `authLogger` / `databaseLogger` — suppressed (reduce noise)
- Misc sub-routers (registerUserApiKeyRoutes etc.) — vi.fn() no-ops

### Test Suite Verification

```
npx vitest run src/backend/database/routes/user-avatars.integration.test.ts
  → 1 passed (0 failed)

npx vitest run [all 5 Phase 87 test files combined]:
  → 5 passed (55 tests) — no regressions
  Files: user-avatar-storage.test.ts, users.test.ts, delete-user-data.test.ts,
         index.migration.test.ts, user-avatars.integration.test.ts
```

## Nginx-Edge Smoke Checkpoint (Task 2 — post-deploy gate)

**Status: DOCUMENTED — fires in the /build pipeline's Deploy step, NOT executed now.**

Reason: The integration test runs Express directly (bypasses nginx). The D-20/D-21 nginx `client_max_body_size 6M` edit (shipped in Plan 06, commit `29011798`) cannot be validated by vitest. The deploy hasn't happened yet — the actual edge still serves the old image.

### Exact Verification Procedure (for the operator after deploy)

**Step A — nginx config live check:**

```bash
docker exec skynet-nginx nginx -t
# Expected: "syntax is ok" AND "test is successful"

docker exec skynet-nginx nginx -s reload
# (or restart the nginx container if reload not supported)

docker exec skynet-nginx grep -A2 -B2 'client_max_body_size 6M' /etc/nginx/nginx.conf
# Expected: shows the directive inside the /users location block
```

**Step B — smoke the happy path (3 MB avatar, should REACH Express, must NOT 413):**

```bash
dd if=/dev/urandom of=/tmp/test-3mb.png bs=1M count=3
curl -v -X POST https://YOUR-DEV-HOST/users/create \
  -F "username=smoketest_$(date +%s)" \
  -F "password=s3cret" \
  -F "avatar=@/tmp/test-3mb.png;type=image/png"
```

**Expected:** HTTP response other than 413 (200 = user created, 400 = missing field, 409 = duplicate username — ALL of these are GOOD because nginx passed the body through to Express). HTTP 413 = FAIL (nginx rejected before Express saw it).

**Step C — smoke the sizing limit (10 MB avatar, MUST 413 at nginx):**

```bash
dd if=/dev/urandom of=/tmp/test-10mb.png bs=1M count=10
curl -v -X POST https://YOUR-DEV-HOST/users/create \
  -F "username=big_$(date +%s)" \
  -F "password=s3cret" \
  -F "avatar=@/tmp/test-10mb.png;type=image/png"
```

**Expected:** HTTP 413 with an nginx HTML error body (NOT JSON). This proves nginx caught the oversized body before Express. If the response is JSON `{"error":"..."}` from Express, nginx is NOT enforcing the limit.

**Step D — HTTPS listener verification (D-21):**

Repeat Steps B and C against the HTTPS endpoint if your dev environment has a separate HTTPS listener.

Confirm the response behavior is identical — proves BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` have the `client_max_body_size 6M` directive active.

### Smoke Test Success Criteria

| Step | Expected | PASS criterion | FAIL criterion |
|------|----------|----------------|----------------|
| A (nginx -t) | "syntax is ok" | Present in output | "syntax error" or any error |
| B (3 MB POST) | NOT 413 | Any non-413 HTTP status | 413 (nginx rejected before Express) |
| C (10 MB POST) | 413 with nginx HTML | 413 response with HTML body | Non-413, OR 413 with JSON body |
| D (HTTPS) | Same as B + C | Steps B+C repeated succeed via HTTPS | Any divergence from HTTP results |

### Signal Protocol

After running Steps A-D, report:
- `approved` — all four steps produced expected results → Plan 07 and Phase 87 are SHIP-READY
- `issues: <description>` — anything didn't match → triggers a revision loop against Plan 06 (nginx config); phase-completion is BLOCKED until Plan 06 is re-executed and this checkpoint re-run

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create user-avatars.integration.test.ts | `62888c53` | src/backend/database/routes/user-avatars.integration.test.ts |
| 2 | Nginx-edge smoke checkpoint | DOCUMENTED ABOVE (no source edits — post-deploy verification) | — |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Seed admin user pre-populated to prevent last-admin 403**

- **Found during:** Task 1 (first test run)
- **Issue:** POST /users/create makes Alice the first (and only) user, so she becomes admin. The delete-account handler at users.ts:2232-2240 checks `if (userRecord.isAdmin && adminCount <= 1) → 403`. Test failed with `expected [200, 204] to include 403`.
- **Fix:** Added `INSERT OR IGNORE INTO users (id, username, password_hash, is_admin, ...)` for a "seed-admin" user in `bootstrapDb()`. Alice is now the second user → non-admin → delete-account succeeds.
- **Files modified:** `user-avatars.integration.test.ts` (bootstrapDb helper)
- **Committed in:** `62888c53` (already in Task 1 commit)

**2. [Rule 1 - Bug] Module-scope forceSaveFn instead of vi.spyOn pattern**

- **Found during:** Task 1 (first test run attempt)
- **Issue:** First design used `capturedForceSave` variable assigned in the vi.mock factory but `vi.resetModules()` in beforeEach caused a second factory invocation, creating a new fn without updating `capturedForceSave`. `saveSpy.mockClear()` threw "Cannot read properties of undefined".
- **Fix:** Declared `const forceSaveFn = vi.fn(...)` at module scope BEFORE `vi.mock()`. The factory closure captures `forceSaveFn` by reference (stable). Removed `vi.resetModules()` from beforeEach (not needed since DATA_DIR is set once in beforeAll, matching the users.test.ts pattern).
- **Files modified:** `user-avatars.integration.test.ts` (spy wiring)
- **Committed in:** `62888c53`

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs found during first test run, both resolved in the single Task 1 commit)
**Impact on plan:** Both necessary for test correctness. No scope creep.

## Known Stubs

None. The integration test exercises REAL file I/O end-to-end (no mocked fs functions).

## Threat Flags

No new security surface introduced. This plan adds tests only.

## Self-Check: PASSED

- FOUND: `src/backend/database/routes/user-avatars.integration.test.ts` — 902 lines
- FOUND: `62888c53` — commit exists (`git log --oneline | grep 62888c53`)
- VERIFIED: `npx vitest run src/backend/database/routes/user-avatars.integration.test.ts` → 1 passed
- VERIFIED: All 5 Phase 87 test files combined → 55 tests passed, 0 failed
- VERIFIED: File count ≥ 150 lines (`wc -l` → 902)
- VERIFIED: Test uses REAL HTTP (node:http + ephemeral server on port 0, not mocked express req/res)
- VERIFIED: Test asserts disk state at 8 lifecycle points (create-file, create-bytes, PUT-new-file, PUT-old-gone, GET2-bytes, delete-file, dir-empty, spy-labels)
- VERIFIED: nginx smoke checkpoint documented with exact curl commands, success criteria, and post-deploy timing note

---
*Phase: 85-user-avatars-baseline-backend-support*
*Completed: 2026-09-08*
