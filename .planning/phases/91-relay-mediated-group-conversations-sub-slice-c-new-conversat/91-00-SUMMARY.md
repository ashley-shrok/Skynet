---
phase: 91-relay-mediated-group-conversations-sub-slice-c-new-conversat
plan: "00"
subsystem: users-list-basic / user-management-api
tags:
  - foundation
  - backend-and-frontend-type
  - users-list-basic
  - phase-88-mxid-source
  - tdd
  - slice-c
dependency_graph:
  requires:
    - Phase 88 slice A (users.mxid column on users table)
  provides:
    - BasicUser.mxid: string | null (frontend type)
    - /users/list-basic response includes mxid field on every row
  affects:
    - Phase 91 Plan 01 (useNewConversationForm — PickedParticipant.mxid from BasicUser.mxid)
    - Phase 91 Plan 05 (NewConversationModal — filter mxid-null users from Humans picker)
tech_stack:
  added: []
  patterns:
    - Drizzle explicit-column SELECT widening (additive, no WHERE clause change)
    - TypeScript interface additive field addition (non-breaking for existing consumers)
    - TDD RED/GREEN cycle with in-memory DB shim test scaffold
key_files:
  created: []
  modified:
    - src/backend/database/routes/user-admin-routes.ts
    - src/backend/database/routes/users-list-basic.test.ts
    - src/ui/api/user-management-api.ts
decisions:
  - "mxid: string | null (not optional) — nullable required because a mxid-less user is a real state we surface to callers; Slice C modal filters them client-side"
  - "Test 4 updated from exact-keys=[id,username] to [id,mxid,username] — widened contract replaces the old one rather than adding a fifth test"
  - "WHERE clause (ne(users.id, userId)) byte-unchanged per plan constraint"
metrics:
  duration: "~10 minutes"
  completed: "2026-09-09"
  tasks_completed: 1
  files_changed: 3
---

# Phase 91 Plan 00: Widen /users/list-basic + BasicUser — Summary

**One-liner:** Additive `mxid: string | null` widening of `/users/list-basic` SELECT and `BasicUser` interface, unblocking Phase 91 Plans 01 + 05 from consuming `user.mxid` client-side.

## What Was Built

Two-line widening (backend SELECT + frontend type) plus test coverage:

1. **Backend** (`src/backend/database/routes/user-admin-routes.ts`): Added `mxid: users.mxid` to the explicit-column drizzle `select()` in the `/users/list-basic` handler. The `WHERE ne(users.id, userId)` self-exclusion clause is byte-unchanged. Updated OpenAPI/JSDoc docblock to describe `mxid` as `string | null` (Phase 88 relay identity; null for pre-Phase-88 users).

2. **Frontend type** (`src/ui/api/user-management-api.ts`): Widened `BasicUser` interface with `mxid: string | null` (JSDoc explains the null case). Added JSDoc to `getUsersListBasic()` describing the shape change. Additive-only — existing `BasicUser` consumers (Phase 38 identity-sharing picker) never read `.mxid` so no breakage.

3. **Tests** (`src/backend/database/routes/users-list-basic.test.ts`): Added `mxid` column to the schema mock + `UserRow` type; updated Test 4 to assert the new three-key set `{id, mxid, username}`; added Test 6 (mxid strings present on every row) and Test 7 (null mxid preserved as null, not coerced to `""`, not omitted). All 7 tests pass.

## Files Touched

| File | Change |
|------|--------|
| `src/backend/database/routes/user-admin-routes.ts` | SELECT widened; docblock updated |
| `src/backend/database/routes/users-list-basic.test.ts` | Schema mock + UserRow type updated; Test 4 updated; Tests 6 + 7 added |
| `src/ui/api/user-management-api.ts` | `BasicUser.mxid: string | null` added; JSDoc updated on interface + function |

## Tests Written + Green Gate Output

**RED commit:** `096e7c06` — 3 new/updated test assertions failing (Tests 4, 6, 7).

**GREEN commit:** `9ed09641` — all 7 tests pass.

```
 RUN  v4.1.8 /home/ubuntu/skynet-taylor

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  11:09:45
   Duration  436ms
```

**Acceptance criteria verification:**
- `grep -c "mxid: users.mxid" user-admin-routes.ts` → 1 ✓
- `grep -c "mxid" user-admin-routes.ts` → 32 ✓ (>= 2)
- `grep -c "mxid: string | null" user-management-api.ts` → 1 ✓
- `grep -c "mxid" users-list-basic.test.ts` → 28 ✓ (>= 3)
- `npx tsc --noEmit` → clean ✓

## Deviations from Plan

None. Plan executed exactly as written.

The only interpretation decision: Test 4 originally asserted `Object.keys(row).sort()).toEqual(["id", "username"])`. Plan says the row shape is now `{id, username, mxid}`, so Test 4 was updated to assert `["id", "mxid", "username"]`. This is consistent with the plan's behavior items which state mxid must be present on every row.

## Post-Plan Followups

- **Plan 01** (`useNewConversationForm`) can now shape `PickedParticipant.mxid` from `BasicUser.mxid` — the dependency is resolved.
- **Plan 05** (`NewConversationModal`) can filter out `user.mxid === null` users from the Humans picker before feeding `humanMxids` into the create-room request.
- **Pre-Phase-88 users**: `mxid=null` rows are surfaced by the API and visible to Plan 05's filter. The filter keeps them out of the Humans picker. No special backend handling needed.

## Self-Check: PASSED

- `src/backend/database/routes/user-admin-routes.ts` — modified and verified via grep ✓
- `src/backend/database/routes/users-list-basic.test.ts` — modified and 7 tests green ✓
- `src/ui/api/user-management-api.ts` — modified and tsc clean ✓
- Commits `096e7c06` (RED) and `9ed09641` (GREEN) exist in git log ✓
