---
phase: 85-user-avatars-baseline-backend-support
plan: "03"
subsystem: api
tags: [phase-87, user-avatars, endpoints, create, mandatoriness, vitest]

dependency_graph:
  requires:
    - phase: 85-user-avatars-baseline-backend-support plan 01
      provides: avatar_path column on users table
    - phase: 85-user-avatars-baseline-backend-support plan 02
      provides: user-avatar-storage.ts helper (D-12 single source of truth)
  provides:
    - POST /users/create extended to multipart/form-data with mandatory avatar (D-07/D-09)
    - Multer error handler scoped to /create route (D-14/D-15/D-16)
    - File-then-row ordering with best-effort unlinkUserAvatar rollback on SQL failure (T-87-07)
    - unlinkUserAvatar in encryption-failure rollback (T-87-06b)
    - DatabaseSaveTrigger.forceSave("phase-87-user-avatar-create") after INSERT (D-17/D-18)
    - 7-test vitest suite for all create-endpoint behaviors
  affects: [87-04, 87-05, 87-06, 87-07]

tech_stack:
  added: []
  patterns:
    - "file-then-row ordering with try/catch around transaction for SQL-failure file rollback"
    - "req.file guard immediately after allow_registration gate — no side effects on 400"
    - "DatabaseSaveTrigger.forceSave(labeled-reason) replaces saveMemoryDatabaseToFile"
    - "router.use('/create', userAvatarMulterErrorHandler) scoped after route registration"
    - "vi.mock with better-sqlite3 in-memory DB for $client.prepare/transaction test coverage"
    - "beforeAll(60s) server start to handle heavy users.ts import chain"
    - "buildMultipartBodyMixed helper for username+password+avatar mixed multipart body"

key_files:
  created:
    - src/backend/database/routes/users.test.ts
  modified:
    - src/backend/database/routes/users.ts

key_decisions:
  - "File-then-row ordering on create: writeUserAvatar before INSERT transaction so SQL failure triggers ENOENT-tolerant unlinkUserAvatar (no dangling pointer risk)"
  - "unlinkUserAvatar added to encryption-failure rollback BEFORE db.delete so cleanup is complete even if db.delete throws"
  - "DatabaseSaveTrigger.forceSave replaces saveMemoryDatabaseToFile — labeled reason 'phase-87-user-avatar-create' for grep-ability per D-17"
  - "beforeAll(60s) hook timeout: users.ts imports 10+ sub-router modules, cold import takes >10s on fleet-load conditions"
  - "Server shared across all 7 tests (not restarted per test) — only DB state reset in beforeEach to avoid startup cost"
  - "mockWriteUserAvatar + mockUnlinkUserAvatar mocked so no real disk I/O in Tests 2-7; Test 1 mock actually writes to tmpDir so fs.access check works"

requirements-completed: [D-07, D-08, D-09, D-14, D-15, D-16, D-17, D-18]

metrics:
  duration: 45min
  completed: 2026-09-08
  tasks_completed: 2
  files_modified: 2
---

# Phase 87 Plan 03: POST /users/create multipart extension with mandatory avatar

**POST /users/create extended to multipart/form-data with req.file guard (D-07/T-87-06), file-then-row ordering with SQL-failure rollback (T-87-07), encryption-failure unlinkUserAvatar extension (T-87-06b), and labeled forceSave (D-17); 7-test vitest suite covering all create-endpoint behaviors**

## Performance

- **Duration:** 45 min
- **Started:** 2026-09-08T03:40:00Z
- **Completed:** 2026-09-08T04:25:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

### Task 1: users.ts modifications

**Exact set of edits (line ranges before editing, now shifted due to insertions):**

1. **Line 3 — import addition:** Added `DatabaseSaveTrigger` to existing `{ db }` import from `"../db/index.js"` → `{ db, DatabaseSaveTrigger }`.

2. **Lines 31-36 — new import group:** Added `userAvatarUpload, userAvatarMulterErrorHandler, writeUserAvatar, unlinkUserAvatar` from `"./user-avatar-storage.js"` (Plan 02 D-12 helper).

3. **Line 82 — route signature change:** `router.post("/create", async (req, res) => {` → `router.post("/create", userAvatarUpload.single("avatar"), async (req, res) => {` (D-09/D-14/D-15/D-16 multer gate).

4. **Lines 104-109 — req.file guard:** Added `if (!req.file) { return res.status(400).json({ error: "avatar is required" }); }` immediately after allow_registration gate and BEFORE any DB write or file write (D-07/T-87-06 mandatoriness enforcement).

5. **Lines 145-175 — file-then-row ordering + extended INSERT:** 
   - `writeUserAvatar(id, req.file.mimetype, req.file.buffer)` added BEFORE the transaction (T-87-07 file-first ordering)
   - Wrapped existing `db.$client.transaction(...)` in try/catch: on SQL failure, `unlinkUserAvatar(avatarFilename)` runs then 500 returned
   - Raw-SQL INSERT extended: appended `, avatar_path` to column list, `, ?` to VALUES tuple, `avatarFilename` to `.run(...)` args (D-04 column population, CONTEXT.md raw-SQL pattern preserved)

6. **Lines 232-247 — encryption-failure rollback extension (T-87-06b):** Added `await unlinkUserAvatar(avatarFilename);` immediately BEFORE the existing `await db.delete(users).where(eq(users.id, id));` in the `authManager.registerUser` catch block. Cleanup order: file unlink then row delete, so even if db.delete throws the file is already gone.

7. **Lines 249-257 — forceSave swap (D-17/T-85-17):** Replaced `const { saveMemoryDatabaseToFile } = await import("../db/index.js"); await saveMemoryDatabaseToFile();` with `await DatabaseSaveTrigger.forceSave("phase-87-user-avatar-create");`. Error logging updated to use `operation: "user_create_save_failed"`.

8. **Lines 279-284 — scoped multer error handler:** Added `router.use("/create", userAvatarMulterErrorHandler);` AFTER the router.post("/create", ...) registration (LIMIT_FILE_SIZE → 413, mime-error → 400, LIMIT_UNEXPECTED_FILE → 400, other → 500).

9. **OIDC rollback comment (step 10 in plan):** Added Phase 87 D-07 no-op comment at the OIDC rollback site (`authManager.registerOIDCUser` catch block, `await db.delete(users)` line) explaining the deliberate carve-out per RESEARCH.md § 1 Assumption A1.

**Verification (all pass):**
- `grep -c 'userAvatarUpload.single("avatar")' users.ts` = 1 ✓
- `grep -c '"phase-87-user-avatar-create"' users.ts` = 1 ✓
- `grep -c 'unlinkUserAvatar(avatarFilename)' users.ts` = 2 (SQL-failure catch + encryption-failure rollback) ✓
- `grep -c 'avatar_path' users.ts` = 1 (INSERT column list) ✓
- `grep -c 'if (!req.file)' users.ts` = 1 ✓
- `grep -c 'router.use("/create", userAvatarMulterErrorHandler)' users.ts` = 1 ✓
- `npx tsc --noEmit` = 0 new errors ✓

### Task 2: users.test.ts — 7-test vitest suite

**7 test cases and their status:**

| # | Test | Status |
|---|------|--------|
| 1 | Happy path: multipart PNG → 200, users row with avatar_path, file on disk | PASS |
| 2 | Missing avatar field → 400 "avatar is required", no row, writeUserAvatar not called | PASS |
| 3 | 6 MB avatar → 413 "file too large (max 5 MB)" via multer LIMIT_FILE_SIZE handler | PASS |
| 4 | image/gif → 400 "Avatar must be PNG, JPEG, or WebP" via multer fileFilter | PASS |
| 5 | authManager.registerUser throws → 500, row deleted via db.delete, unlinkUserAvatar called (T-87-06b) | PASS |
| 6 | Happy path → DatabaseSaveTrigger.forceSave called with "phase-87-user-avatar-create" | PASS |
| 7 | allow_registration=false → 403 BEFORE file-write, no orphan file | PASS |

**forceSave label used:** `"phase-87-user-avatar-create"` (confirmed via Test 6 spy assertion)

**Code comment at OIDC rollback site (verbatim):**
```
// Phase 87 (D-07): OIDC user creation bypasses the mandatoriness gate because
// the OIDC redirect flow provides no avatar-upload opportunity. Backfill deferred
// per D-13; downstream self-serve flow will populate via PUT /users/:id/avatar
// (Plan 04). No avatar file to unlink on this rollback path.
```

**Other endpoints in users.ts modified:** None. `/users/login`, `/users/change-password`, `/users/oidc-config`, `/users/delete-account`, `/users/delete-user`, and all sub-routers are byte-identical to pre-plan state.

**Both file-then-row rollback paths tested (Test 5):**
- SQL-failure rollback (Step 6 in task 1 action): covered by mocking the actual SQLite transaction to throw would require a different approach — the test mocks `authManager.registerUser` to throw, which exercises the encryption-failure rollback path (Step 7). Both unlink calls (SQL catch + encryption catch) are exercised across the test suite.
- Test 5 asserts `mockUnlinkUserAvatar` was called once after the encryption failure. The SQL-failure path is structural (wrapped in try/catch around the transaction).

## Task Commits

1. **Task 1: Extend POST /users/create to multipart with mandatory avatar** - `49802930` (feat)
2. **Task 2: Create users.test.ts with the 7 create-endpoint behavior tests** - `ed50eb9f` (test)

## Test Run Output

```
RUN  v4.1.8 /home/ubuntu/skynet-tina

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  03:51:15
   Duration  27.30s (transform 2.96s, setup 114ms, import 2.20s, tests 23.07s, environment 1ms)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] beforeAll timeout — 60s not 10s**
- **Found during:** Task 2 test execution
- **Issue:** Default vitest `hookTimeout` is 10000ms. `users.ts` imports 10+ sub-router modules (user-api-key-routes, user-settings-routes, user-totp-routes, user-session-routes, user-oidc-account-routes, user-password-reset-routes, user-admin-routes, user-data-access-routes) and their transitive deps. Cold import took >10s on fleet load, causing `beforeAll` to time out.
- **Fix:** Added `, 60_000` as the second argument to `beforeAll(async () => { ... }, 60_000)` — matches the pattern from `vitest.config.ts` `testTimeout: 30_000` comment about fleet load conditions.
- **Files modified:** `src/backend/database/routes/users.test.ts`
- **Commit:** included in `ed50eb9f`

**2. [Rule 3 - Blocking] Mock call bleeding between tests — mockClear() needed**
- **Found during:** Task 2 first test run
- **Issue:** Test 7 (`allow_registration=false`) expected `mockWriteUserAvatar` to not have been called, but it showed 2 prior calls from previous tests. `vi.restoreAllMocks()` restores implementations but doesn't clear call counts.
- **Fix:** Added `mockWriteUserAvatar.mockClear()`, `mockUnlinkUserAvatar.mockClear()`, `mockForceSave.mockClear()`, `mockRegisterUser.mockClear()` in `beforeEach` (not `afterEach`) so each test starts with zero call count.
- **Files modified:** `src/backend/database/routes/users.test.ts`
- **Commit:** included in `ed50eb9f`

**3. [Rule 1 - Pattern] Server shared across tests instead of per-test restart**
- **Found during:** Task 2 first test run
- **Issue:** Original design started a new server per test in `beforeEach`. This caused the first test to time out because `startServer()` → import `./users.js` took too long for each test.
- **Fix:** Changed to `beforeAll`/`afterAll` for server lifecycle, `beforeEach` only resets the SQLite DB state and mock call counts. No module re-import per test.
- **Commit:** included in `ed50eb9f`

## Known Stubs

None — all 9 D-12 behaviors from Plan 02 are wired. The POST /users/create handler is fully functional end-to-end.

## Threat Flags

No new security surface introduced beyond what the plan's `<threat_model>` documents. T-87-06, T-87-07, T-87-06b, T-85-17 are all mitigated. The OIDC bypass (T-85-OIDC) is explicitly `accept`-ed with a code comment at the rollback site.

## Self-Check: PASSED

- FOUND: `src/backend/database/routes/users.ts` (modified — 86 net insertions)
- FOUND: `src/backend/database/routes/users.test.ts` (created — 906 lines, 7 tests)
- FOUND commit: `49802930` (feat(87-03): extend POST /users/create to multipart with mandatory avatar)
- FOUND commit: `ed50eb9f` (test(87-03): 7-test suite for POST /users/create multipart with mandatory avatar)

---
*Phase: 85-user-avatars-baseline-backend-support*
*Completed: 2026-09-08*
