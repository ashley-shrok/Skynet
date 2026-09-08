---
phase: 88-relay-mediated-group-conversations-sub-slice-a-human-relay-i
plan: "04"
subsystem: matrix-delete-lifecycle
tags: [phase-88, delete-flow, matrix-deactivate, schema-comment, d-09, d-10, d-14]
dependency_graph:
  requires: ["88-01", "88-02", "88-03"]
  provides: [deactivate-before-row-delete-both-paths, d-14-schema-comment-cleanup]
  affects:
    - src/backend/database/routes/users.ts
    - src/backend/database/routes/delete-user-data.ts
    - src/backend/database/db/schema.ts
tech_stack:
  added: []
  patterns:
    - best-effort-deactivate-before-delete (D-10)
    - pitfall-5-mxid-captured-before-row-delete
key_files:
  modified:
    - src/backend/database/routes/users.ts
    - src/backend/database/routes/users.test.ts
    - src/backend/database/routes/delete-user-data.ts
    - src/backend/database/routes/delete-user-data.test.ts
    - src/backend/database/db/schema.ts
decisions:
  - "D-09: deactivateUser called before db.delete in both delete paths when mxid non-null"
  - "D-10: Synapse failure on deactivate logs warning + proceeds with row delete (never blocks user)"
  - "D-14: schema comments updated to reflect Skynet-owned provisioning; legacy human-owns-creds claim removed"
  - "Pitfall 5: mxid captured from already-loaded record (userRecord.mxid / avatarRow projection) before row DELETE"
metrics:
  duration: "~15 minutes"
  completed: "2026-09-08T10:45:00Z"
  tasks_completed: 5
  files_modified: 5
---

# Phase 88 Plan 04: deactivate-before-DELETE in both delete paths + schema.ts comment cleanup Summary

Wired `deactivateUser` into both Skynet delete paths (DELETE /users/delete-account and `deleteUserAndRelatedData`) with D-10 best-effort semantics. Added 6 new tests (3 per file) proving deactivate/skip/best-effort. Updated two schema comments to reflect Skynet-owned provisioning (D-14 housekeeping).

## Deactivate Insertion — Line Ranges

### users.ts DELETE /users/delete-account

- **Deactivate block inserted at:** lines 2418-2437 (after avatar-unlink try/catch, before `db.delete(users)`)
- **`await deactivateUser(userRecord.mxid)`:** line 2424
- **`await db.delete(users)`:** line 2439
- **mxid captured from:** `userRecord = user[0]` (already loaded from auth-time SELECT at line 2364); Pitfall 5 satisfied — no second SELECT needed
- **Line order confirmed:** 2424 < 2439 (deactivate before delete)

### delete-user-data.ts deleteUserAndRelatedData

- **avatarRow select extended at:** line 101 — `{ avatarPath: users.avatarPath, mxid: users.mxid }`
- **Deactivate block inserted at:** lines 109-127 (after avatar-unlink block, before `db.delete(users)`)
- **`await deactivateUser(avatarRow[0].mxid)`:** line 115
- **`await db.delete(users)`:** line 130
- **mxid captured from:** `avatarRow` select projection (extended above) — fetched BEFORE row DELETE (Pitfall 5 avoided)
- **Line order confirmed:** 115 < 130 (deactivate before delete)

## Pitfall 5 Confirmation

Both delete paths read the mxid from the database BEFORE the row DELETE executes:
- `users.ts`: `userRecord.mxid` from the initial `db.select().from(users).where(eq(users.id, userId))` at line 2364 — no extra query needed
- `delete-user-data.ts`: `avatarRow[0].mxid` from the extended `db.select({ avatarPath: users.avatarPath, mxid: users.mxid })` at line 101

## No forceSave in deleteUserAndRelatedData

Per RESEARCH Q3, `deleteUserAndRelatedData` is a helper called by admin routes and OIDC-merge paths — callers own persistence. No `DatabaseSaveTrigger.forceSave` was added to this helper. Confirmed by `grep -c 'DatabaseSaveTrigger\|forceSave' src/backend/database/routes/delete-user-data.ts` → 0.

## Test Run Output

```
Test Files  2 passed (2)
Tests  42 passed (42)
Duration  62.14s
```

- `users.test.ts`: 35 tests pass (32 pre-existing + 3 new DELETE deactivate tests)
- `delete-user-data.test.ts`: 7 tests pass (4 pre-existing + 3 new deactivate tests)

### New Tests Summary

**users.test.ts — DELETE describe block:**
- Test B: mxid populated → deactivateUser called exactly once with mxid, row deleted (D-09)
- Test C: mxid=null → deactivateUser NOT called, row deleted (legacy/OIDC user)
- Test D: Synapse 504 → response 200, row deleted despite failure (D-10 best-effort)

**delete-user-data.test.ts:**
- Test B: dave_id with mxid → deactivateUser called with mxid, row gone
- Test C: eve_id with mxid=null → deactivateUser NOT called, row gone
- Test D: frank_id, Synapse 504 → resolves.toBeUndefined(), row gone (D-10 best-effort)

## D-14 Schema Comment Verification

`grep -c 'human relay creds are owned by the human' src/backend/database/db/schema.ts` → **0** (legacy claim fully removed)

`grep -c 'Phase 88' src/backend/database/db/schema.ts` → **2** (one in users.mxid block, one in matrix_admin_creds block)

### No DDL Changes

`grep -c 'mxid: text("mxid")' src/backend/database/db/schema.ts` → 1 (column declaration unchanged)
`grep -c 'matrixAdminCreds = sqliteTable' src/backend/database/db/schema.ts` → 1 (table declaration unchanged)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] camelizeUser mock missing mxid field**
- **Found during:** Task 2 (writing users.test.ts tests)
- **Issue:** The `camelizeUser` function in users.test.ts that maps raw SQLite row columns to Drizzle-shaped objects did not include the `mxid` column. This would have caused `userRecord.mxid` to always be `undefined` in tests, making the mxid-populated test (Test B) always behave like the mxid-null path.
- **Fix:** Added `mxid: row.mxid ?? null` to the `camelizeUser` return object.
- **Files modified:** `src/backend/database/routes/users.test.ts`
- **Commit:** 29031a69

## End-of-Phase-88 Verification

`find .planning/phases/88-* -name "88-*-SUMMARY.md" | wc -l` → **4** (this SUMMARY is the fourth)

Phase 88 slice A plans complete:
- 88-01: username-to-mxid helper available
- 88-02: deactivateUser primitive available
- 88-03: POST /users/create wired with matrix-admin-client
- 88-04: deactivate-before-DELETE in both delete paths + schema comment cleanup (this plan)

Phase is ready for end-of-phase human-check + code review + closeout.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema DDL changes introduced. The deactivate calls use the existing `deactivateUser` primitive from Plan 02, which is already in the threat model for Plan 02's analysis. Test-file changes are test-only scope.

## Self-Check

Files confirmed present:
- src/backend/database/routes/users.ts — modified
- src/backend/database/routes/users.test.ts — modified
- src/backend/database/routes/delete-user-data.ts — modified
- src/backend/database/routes/delete-user-data.test.ts — modified
- src/backend/database/db/schema.ts — modified

Commits confirmed:
- e722a897: feat(88-04-01)
- 29031a69: test(88-04-02)
- 385ccbfe: feat(88-04-03)
- bc17a3a0: test(88-04-04)
- 2e1d8e2c: docs(88-04-05)

## Self-Check: PASSED
