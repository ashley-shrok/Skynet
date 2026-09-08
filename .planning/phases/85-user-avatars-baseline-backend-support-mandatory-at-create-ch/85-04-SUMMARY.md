---
phase: 85-user-avatars-baseline-backend-support
plan: "04"
subsystem: api
tags: [phase-85, user-avatars, endpoints, change, serve, vitest]

dependency_graph:
  requires:
    - phase: 85-user-avatars-baseline-backend-support plan 01
      provides: avatar_path column on users table
    - phase: 85-user-avatars-baseline-backend-support plan 02
      provides: user-avatar-storage.ts helper (D-12 single source of truth)
    - phase: 85-user-avatars-baseline-backend-support plan 03
      provides: POST /users/create extended to multipart with mandatory avatar
  provides:
    - PUT /users/:id/avatar change endpoint (D-10) with own-or-admin auth + new-file-then-row-then-old-unlink ordering
    - GET /users/:id/avatar serve endpoint (D-11) with Content-Type from extension + ETag
    - userAvatarMulterErrorHandler scoped to /:id/avatar route (covers PUT only)
    - DatabaseSaveTrigger.forceSave("phase-85-user-avatar-change") paired with UPDATE (D-17)
    - 24-test vitest suite (7 create from Plan 03 + 10 change + 7 serve) all passing
  affects: [85-05, 85-06, 85-07]

tech_stack:
  added: []
  patterns:
    - "createHash from node:crypto for ETag computation (mirrors identities.ts:4)"
    - "own-or-admin guard reads isAdmin from DB not JWT (user-session-routes.ts:154 pattern)"
    - "new-file-then-row-UPDATE-then-old-unlink ordering per RESEARCH.md § 5"
    - "raw-SQL UPDATE via db.$client.prepare().run() (CONTEXT.md users-table write convention)"
    - "ENOENT-mapped to 404 (not 500) in serve endpoint (Pitfall 4 from RESEARCH.md)"
    - "authControl object pattern for configurable JWT mock across test suites"
    - "Symbol.for('drizzle:Name') for Drizzle table name extraction in mock (t?._.name is undefined in current Drizzle)"

key_files:
  created: []
  modified:
    - src/backend/database/routes/users.ts
    - src/backend/database/routes/users.test.ts

key_decisions:
  - "PUT /users/:id/avatar uses raw-SQL UPDATE (db.$client.prepare().run()) matching existing users-table write pattern — do NOT mix Drizzle orm and raw-SQL writes in same phase (CONTEXT.md invariant)"
  - "Rollback: new file unlinked only if newFilename !== oldFilename (ext-swap case) — same-filename means overwrite-in-place; unlinking would delete the still-in-use file"
  - "Old file unlinked AFTER successful UPDATE only (T-85-08 partial mitigation) — best-effort, ENOENT-tolerant"
  - "GET auth model: authenticateJWT-only, no per-user scoping (matches identity-avatar precedent per RESEARCH.md Q2)"
  - "ETag included on serve endpoint: per-response MD5 hash (no server-side store) mirrors identities.ts:626"
  - "authControl object (not primitives) in test mock so vi.mock factory closes over stable reference, reads current values at call time"
  - "Drizzle table name extracted via Symbol.for('drizzle:Name') not t?._.name — latter is undefined in Drizzle v0.30+"

requirements-completed: [D-10, D-11, D-12, D-14, D-15, D-16, D-17, D-18, D-23]

metrics:
  duration: 90min
  completed: 2026-09-08
  tasks_completed: 2
  files_modified: 2
---

# Phase 85 Plan 04: PUT/GET /users/:id/avatar — change and serve endpoints

**PUT /users/:id/avatar (D-10) with own-or-admin auth, new-file-then-row-then-old-unlink ordering, raw-SQL UPDATE, and labeled forceSave; GET /users/:id/avatar (D-11) with Content-Type from extension, ETag, and ENOENT→404 mapping; 17 new tests (10 change + 7 serve) + Drizzle Symbol table-name fix in mock infrastructure**

## Performance

- **Duration:** 90 min
- **Started:** 2026-09-08T04:00:00Z
- **Completed:** 2026-09-08T05:30:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

### Task 1: users.ts — PUT /users/:id/avatar + GET /users/:id/avatar

**Insertion points (post-Plan-03 line numbers):**

- **Line 299:** `router.put("/:id/avatar", ...)` — immediately after `router.use("/create", userAvatarMulterErrorHandler)` at line 287
- **Line 415:** `router.get("/:id/avatar", ...)` — immediately after the PUT handler body closes
- **Line 469:** `router.use("/:id/avatar", userAvatarMulterErrorHandler)` — scoped error handler for the change route

**Imports added:**
- `createHash` from `"node:crypto"` (line 3) — for ETag computation
- `readUserAvatar` added to the existing `user-avatar-storage.js` import group

**PUT /users/:id/avatar handler logic:**
1. `authenticateJWT` runs first (T-85-03 mitigation — unauthenticated blocked before multer parses bytes)
2. `userAvatarUpload.single("avatar")` — multer gate (D-14/D-15/D-16)
3. Caller lookup via `db.select().from(users).where(eq(users.id, userId))` — 404 if not found
4. Own-or-admin guard: `if (!callerRecord.isAdmin && targetUserId !== userId) → 403` — reads `isAdmin` from DB not JWT (T-85-03b mitigation)
5. Target lookup with `.limit(1)` — 404 if not found (admin gets clean 404, not 500, for bogus id)
6. `if (!req.file) → 400 "missing avatar field"` guard
7. `writeUserAvatar(targetUserId, req.file.mimetype, req.file.buffer)` → `newFilename`
8. Raw-SQL UPDATE: `db.$client.prepare("UPDATE users SET avatar_path = ? WHERE id = ?").run(newFilename, targetUserId)` — CONTEXT.md invariant preserved
9. On UPDATE failure: `unlinkUserAvatar(newFilename)` only if `newFilename !== oldFilename` (ext-swap rollback; same-name would delete in-use file)
10. `if (oldFilename && oldFilename !== newFilename) await unlinkUserAvatar(oldFilename)` — best-effort old-file cleanup after successful UPDATE
11. `DatabaseSaveTrigger.forceSave("phase-85-user-avatar-change")` — labeled D-17 invariant
12. Response: `200 { id: targetUserId, avatarPath: newFilename }`

**GET /users/:id/avatar handler logic:**
1. `authenticateJWT` — any logged-in user may fetch any user's avatar (D-11 auth model)
2. `db.select({ avatarPath: users.avatarPath }).from(users).where(eq(users.id, targetUserId)).limit(1)`
3. `if (rows.length === 0 || !rows[0].avatarPath) → 404 "no avatar for this user"` — covers both missing row and null pointer (pre-Phase-85 user)
4. `readUserAvatar(filename)` → `{ bytes, mime }` via D-12 helper
5. ETag: `"disk-<md5-hex>"` (per-response, no server-side store)
6. `res.setHeader("Content-Type", mime)`, `Content-Length`, `Cache-Control: no-store`, `ETag`
7. `res.send(bytes)` — raw bytes, no JSON wrapper
8. On ENOENT: `→ 404 "no avatar file on disk"` (Pitfall 4 from RESEARCH.md — row pointer valid, file missing)
9. On other errors: `→ 500 "avatar read failed"` (unrecognized extension = corruption, fail-closed)

**Verification (all passing):**
- `grep -c 'router.put("/:id/avatar"' users.ts` = 1 ✓
- `grep -c 'router.get("/:id/avatar"' users.ts` = 1 ✓
- `grep -c '"phase-85-user-avatar-change"' users.ts` = 1 ✓
- `grep -c 'Not authorized to change this user' users.ts` = 1 ✓
- `grep -c 'callerRecord.isAdmin' users.ts` = 1 ✓
- `grep -c 'writeUserAvatar(targetUserId' users.ts` = 1 ✓
- `grep -c 'unlinkUserAvatar' users.ts` = 5 (2 in create from Plan 03 + 1 rollback + 1 old-file-unlink in PUT + 1 import) ✓
- `grep -c 'no avatar for this user' users.ts` = 1 ✓
- `grep -c 'no avatar file on disk' users.ts` = 1 ✓
- `grep -c 'res.setHeader("Content-Type"' users.ts` = 1 ✓
- `npx tsc --noEmit` = 0 errors ✓

**forceSave label used:** `"phase-85-user-avatar-change"` (Test 10 asserts this)

**ETag included:** YES — per-response MD5 hash, mirrors identities.ts:626 pattern

**Auth model for serve:** `authenticateJWT`-only — no per-user scoping (matches identity-avatar precedent per RESEARCH.md § Q2; confirmed by Test 7)

**Own-or-admin guard reads isAdmin from:** DB row (`callerRecord.isAdmin`) not JWT payload — confirmed by Test 3 (non-admin → 403) and Test 2 (admin → 200)

### Task 2: users.test.ts — 17 new tests

**Test cases and their pass/fail status:**

#### PUT /users/:id/avatar (10 tests)

| # | Test | Status |
|---|------|--------|
| 1 | Own user happy path → 200, avatarPath in response | PASS |
| 2 | Admin changes another user → 200 | PASS |
| 3 | Non-admin changes another user → 403 "Not authorized to change this user's avatar" | PASS |
| 4 | Ext-swap (PNG→JPEG): old .png unlinked, new .jpg in row | PASS |
| 5 | Same-ext (PNG→PNG): no old-file unlink (overwrite in place) | PASS |
| 6 | SQL UPDATE failure: new file unlinked (rollback), row unchanged | PASS |
| 7 | Target user not found → 404 before any file write | PASS |
| 8 | Missing avatar field → 400 "missing avatar field" | PASS |
| 9 | 6 MB upload → 413 via scoped multer error handler | PASS |
| 10 | forceSave labeled "phase-85-user-avatar-change" | PASS |

#### GET /users/:id/avatar (7 tests)

| # | Test | Status |
|---|------|--------|
| 1 | PNG avatar → 200 Content-Type: image/png + correct bytes | PASS |
| 2 | WebP avatar → 200 Content-Type: image/webp | PASS |
| 3 | Null avatar_path (pre-Phase-85 user) → 404 "no avatar for this user" | PASS |
| 4 | Nonexistent user → 404 "no avatar for this user" | PASS |
| 5 | File missing on disk (ENOENT) → 404 "no avatar file on disk" (not 500) | PASS |
| 6 | No JWT (authControl.pass=false) → 401 | PASS |
| 7 | Any logged-in user can fetch any other user's avatar → 200 | PASS |

**Total passing:** 24/24 (7 Plan 03 create + 10 change + 7 serve)

**New test infrastructure:**

- `authControl = { userId: string, pass: boolean }` — module-scope object (not primitives) so vi.mock factory closes over stable reference; tests mutate `.userId` / `.pass` to control JWT behavior per-test
- `mockReadUserAvatar` added to user-avatar-storage mock (joins mockWriteUserAvatar, mockUnlinkUserAvatar)
- `putMultipartWithAuth(server, opts, jwt)` — PUT multipart with Bearer token
- `putNoBodyWithAuth(server, opts)` — PUT with no file part (for missing-avatar test)
- `putOversizeWithAuth(server, opts)` — PUT with 6 MB body (for 413 test)
- `getWithAuth(server, opts)` — GET with Bearer token; returns raw Buffer for binary, parsed JSON for errors
- `getNoAuth(server, opts)` — GET without Authorization header (for 401 test)
- `insertUser(opts)` — direct SQLite INSERT for test seeding

## Task Commits

1. **Task 1: Add PUT/GET /users/:id/avatar endpoints** - `ec3c5df5` (feat)
2. **Task 2: 17 tests for change + serve endpoints** - `62a0f60d` (test)

## Test Run Output

```
RUN  v4.1.8 /home/ubuntu/skynet-tina

 Test Files  1 passed (1)
      Tests  24 passed (24)
   Start at  04:23:15
   Duration  21.18s (transform 2.38s, setup 489ms, import 2.41s, tests 14.76s, environment 0ms)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Drizzle table name via Symbol.for("drizzle:Name") not t?._.name**
- **Found during:** Task 2 test execution
- **Issue:** All PUT and GET tests returned 404 because `buildSelectChainDynamic.from()` used `(t?._ as Record<string, unknown>)?.name` to get the table name from the Drizzle table object. In Drizzle v0.30+, `table._` is `undefined` — the table name lives at `table[Symbol.for("drizzle:Name")]`. This caused `fromTable` to be set to `"[object Object]"` for all `from(users)` calls, causing the mock's `then()` to fall to `else { resolve([]); }` and return empty arrays.
- **Why create tests still passed:** The POST /create handler's `db.select()` is used only for username-conflict checking on a fresh DB — empty result is the expected outcome, so the wrong `fromTable` never manifested.
- **Fix:** Added Symbol lookup in `buildSelectChainDynamic.from()` with fallback to legacy property path: `const tSym = (table as Record<symbol, unknown>)[Symbol.for("drizzle:Name")]; if (typeof tSym === "string") { fromTable = tSym; }` — runs first before the legacy `t?._.name` check.
- **Files modified:** `src/backend/database/routes/users.test.ts`
- **Commit:** included in `62a0f60d`

## Known Stubs

None — all D-10, D-11, D-12 behaviors are wired. Both endpoints are fully functional end-to-end.

## Threat Flags

No new security surface beyond the plan's `<threat_model>` documents. All STRIDE threats mitigated:
- T-85-03 (unauthenticated change): authenticateJWT before multer ✓
- T-85-03b (non-admin changes another): own-or-admin guard reads from DB ✓
- T-85-08 (old-file orphan): unlinkUserAvatar after successful UPDATE, ENOENT-tolerant ✓
- T-85-17 (UPDATE lost across restart): forceSave("phase-85-user-avatar-change") ✓
- T-85-02 (path traversal): GET reads avatar_path from DB, never from URL directly ✓
- T-85-XSS (SVG mime): Content-Type from extension; .svg extension never in store ✓

## Self-Check: PASSED

- FOUND: `src/backend/database/routes/users.ts` (modified — 184 net insertions: PUT + GET handlers + scoped error handler + imports)
- FOUND: `src/backend/database/routes/users.test.ts` (modified — 711 net insertions: 17 tests + helpers)
- FOUND commit: `ec3c5df5` (feat(85-04): add PUT/GET /users/:id/avatar endpoints to users.ts)
- FOUND commit: `62a0f60d` (test(85-04): 17 tests for PUT/GET /users/:id/avatar change + serve endpoints)
- `npx vitest run src/backend/database/routes/users.test.ts` = 24/24 pass ✓
- `npx tsc --noEmit` = 0 errors ✓

---
*Phase: 85-user-avatars-baseline-backend-support*
*Completed: 2026-09-08*
