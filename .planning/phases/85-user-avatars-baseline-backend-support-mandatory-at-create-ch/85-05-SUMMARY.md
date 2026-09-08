---
phase: 85-user-avatars-baseline-backend-support
plan: 05
subsystem: api
tags: [phase-85, user-avatars, delete-cleanup, d-22]

# Dependency graph
requires:
  - phase: 85-user-avatars-baseline-backend-support plan 01
    provides: avatar_path column on users table
  - phase: 85-user-avatars-baseline-backend-support plan 02
    provides: unlinkUserAvatar (ENOENT-tolerant) from user-avatar-storage.ts
  - phase: 85-user-avatars-baseline-backend-support plan 03
    provides: users.ts create-endpoint rollback wiring at line 198/239
  - phase: 85-user-avatars-baseline-backend-support plan 04
    provides: users.ts change-endpoint unlinkUserAvatar wiring (old-file cleanup)
provides:
  - D-22 satisfied: all 3 real user-delete call sites wired to unlinkUserAvatar
  - delete-user-data.ts:91 wired — covers admin delete + OIDC-merge (2 sites via 1 edit)
  - users.ts DELETE /users/delete-account wired — self-serve delete path
  - delete-user-data.test.ts with 4-test suite including SOURCE ASSERTION
  - schema.ts D-22 invariant comment above users table def
affects: [85-06, 85-07]

# Tech tracking
tech-stack:
  added: []  # no new packages
  patterns:
    - "SELECT avatar_path from users row BEFORE db.delete(users) — pointer-then-delete ordering"
    - "let-throw on admin/helper path (FS error surfaces to operator), try/catch on self-delete path (user can still delete their account)"
    - "SOURCE ASSERTION test: fs.readFile the source file and assert SELECT index < DELETE index"
    - "vi.mock with real SQLite + Drizzle-shaped proxy for delete-user-data unit tests"

key-files:
  created:
    - src/backend/database/routes/delete-user-data.test.ts
  modified:
    - src/backend/database/routes/delete-user-data.ts
    - src/backend/database/routes/users.ts
    - src/backend/database/db/schema.ts

key-decisions:
  - "Policy split: delete-user-data.ts (admin/OIDC-merge) lets FS errors propagate (operator sees broken disk); users.ts delete-account wraps in try/catch with WARN log (FS error must not block self-service account deletion)"
  - "D-22 schema invariant comment added above users table def listing all wired + exempt sites"
  - "SOURCE ASSERTION test codifies SELECT-before-DELETE as a repeatable CI check, not just a one-time awk verification"
  - "vi.resetModules() avoided in test beforeEach (10s timeout risk); used static vi.mock + dynamic import per-test instead"

requirements-completed: [D-22]

# Metrics
duration: 20min
completed: 2026-09-08
---

# Phase 85 Plan 05: D-22 Avatar Delete Cleanup Summary

**Wire ENOENT-tolerant avatar unlink into all 3 real user-delete call sites; add SOURCE ASSERTION test and schema invariant comment**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-09-08T04:43Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

### Wired Call Sites (D-22)

| # | File | Line | Context | Status |
|---|------|------|---------|--------|
| 1 | `delete-user-data.ts` | 92–107 | Canonical bulk-delete helper — covers admin delete + OIDC-merge | Wired (Task 1) |
| 2 | `users.ts` | ~2243 | DELETE /users/delete-account (self-serve; does NOT call the helper) | Wired (Task 2) |
| 3 | `users.ts` | ~198 | POST /users/create SQL-rollback path | Already wired by Plan 03 — verified present |

### Explicit No-Op Sites (documented, no code change needed)

| # | File | Line | Context | Reason |
|---|------|------|---------|--------|
| 4 | `users.ts` | ~1284 | OIDC callback registerOIDCUser rollback | OIDC create bypasses D-07 mandatoriness gate — no avatar file ever written, comment present from Plan 03 |
| 5 | `users.ts` | ~2426 | DELETE /users/delete-user (admin) | Calls `deleteUserAndRelatedData` → covered by site 1 automatically |
| 6 | `user-oidc-account-routes.ts` | 178 | OIDC-merge deleteUserAndRelatedData call | Covered by site 1 automatically |

### Policy Split (T-85-DEL-BLOCK)

| Path | Policy | Rationale |
|------|--------|-----------|
| `delete-user-data.ts` (admin / OIDC-merge) | Let-throw — FS errors propagate | Operator-facing; operator should see broken disk rather than a silent orphan-file |
| `users.ts` DELETE /delete-account (self-serve) | Try/catch with WARN log — continue with row DELETE | User-facing; FS errors must not block a user from deleting their own account |

## Task Commits

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 | Wire delete-user-data.ts:91 (admin helper) | `d0dc5cd0` | delete-user-data.ts |
| 2 | Wire users.ts delete-account + schema comment | `4c20221d` | users.ts, schema.ts |
| 3 | Create delete-user-data.test.ts (4 tests) | `fada20ac` | delete-user-data.test.ts |

## Test Suite (4 tests — all pass)

| # | Name | Status |
|---|------|--------|
| 1 | `deleteUserAndRelatedData unlinks avatar file before deleting row` | PASS |
| 2 | `deleteUserAndRelatedData no-ops on null avatar pointer` | PASS |
| 3 | `deleteUserAndRelatedData is ENOENT-tolerant when pointer is set but file was manually removed` | PASS |
| 4 | `SOURCE ASSERTION: delete-user-data.ts fetches avatar_path BEFORE db.delete(users)` | PASS |

Test 4 (SOURCE ASSERTION) codifies the SELECT-before-DELETE ordering invariant as a repeatable CI check — a future refactor that inverts the order will cause this test to fail immediately.

## Final Verification Results

```
npx tsc --noEmit           → zero new errors
npx vitest run delete-user-data.test.ts → 4 passed (0 failed)
awk ordering check         → SELECT+unlink line: 101, DELETE line: 109 — OK ordering
unlinkUserAvatar in users.ts → 6 occurrences (import + 5 usage sites)
Phase 85 (D-22) comments  → 1 in delete-user-data.ts, 1 in users.ts, 1 in schema.ts
```

## unlinkUserAvatar Usage Count in users.ts

`grep -c 'unlinkUserAvatar' src/backend/database/routes/users.ts` → **6**

Breakdown:
- Line 37: import
- Line 198: create-endpoint SQL-rollback (Plan 03)
- Line 239: create-endpoint encryption-rollback (Plan 03)
- Line 367: change-endpoint new-file SQL-rollback (Plan 04)
- Line 379: change-endpoint old-file cleanup after successful UPDATE (Plan 04)
- Line 2256: delete-account avatar cleanup before row DELETE (Plan 05 — Task 2)

## Deviations from Plan

### Auto-adjusted: vi.resetModules() not used in beforeEach

**Found during:** Task 3 test implementation

**Issue:** The plan proposed `vi.resetModules()` + dynamic `import()` inside `beforeEach` to isolate the DATA_DIR capture. With the full test harness (mocking db + drizzle-orm + logger + user-avatar-storage), the pattern caused a 10s hook timeout on Test 1 due to the cold module resolution chain.

**Fix:** Replaced with static `vi.mock()` declarations (hoisted per Vitest convention) and dynamic `import("./delete-user-data.js")` per-test (lightweight, no module cache bust). The controllable `testAvatarsDir` module-level variable is exposed via the `mockUnlinkUserAvatar` mock implementation so Test 1 can verify real file deletion without needing DATA_DIR injection.

**Impact:** Tests are functionally equivalent to the plan's intent — all 4 pass, Test 1 proves real file deletion, Tests 2–3 prove ENOENT-tolerance.

## Known Stubs

None. All wiring is complete and tested.

## Threat Flags

No new security surface introduced. This plan only adds defensive cleanup code (file deletion) to existing delete paths — it reduces attack surface (orphan files) rather than adding any.

## Self-Check: PASSED

- FOUND: `src/backend/database/routes/delete-user-data.ts` — contains `unlinkUserAvatar`, `avatarPath: users.avatarPath`, `Phase 85 (D-22)` comment
- FOUND: `src/backend/database/routes/users.ts` — contains `delete_account_avatar_unlink_failed`, `Phase 85 (D-22)` comment in delete-account handler
- FOUND: `src/backend/database/db/schema.ts` — contains `Phase 85 (D-22)` invariant comment above users table
- FOUND: `src/backend/database/routes/delete-user-data.test.ts` — 4 tests, all pass
- FOUND commits: `d0dc5cd0`, `4c20221d`, `fada20ac`
- SELECT-before-DELETE ordering: VERIFIED (awk + SOURCE ASSERTION test)

---
*Phase: 85-user-avatars-baseline-backend-support*
*Completed: 2026-09-08*
