---
phase: 91-relay-mediated-group-conversations-sub-slice-c-new-conversat
plan: 02
subsystem: backend-matrix
tags: [foundation, backend, matrix, primitive, tdd, slice-c]
dependency_graph:
  requires: [91-00, 91-01]
  provides: [inviteToRoom, createRoomAsUser]
  affects: [src/backend/matrix/matrix-admin-client.ts]
tech_stack:
  added: []
  patterns: [loginAsUser-then-authenticated-POST, AbortController-30s-timeout, discriminated-union-return]
key_files:
  created: []
  modified:
    - src/backend/matrix/matrix-admin-client.ts
    - src/backend/matrix/matrix-admin-client.test.ts
decisions:
  - inviteToRoom defaults to admin creds when senderMxid omitted; uses per-user token via loginAsUser when senderMxid provided
  - createRoomAsUser always uses loginAsUser (no admin fallback) — user is always PL100 creator
  - createRoomAsUser uses ERR_PROXY (502) for missing room_id in 200 response; mirrors createRoom's ERR_MISSING_FIELD semantic
metrics:
  duration: "~10 minutes"
  completed: "2026-09-09"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
  tests_added: 13
  tests_total: 120
---

# Phase 91 Plan 02: Matrix Admin Client Primitives — inviteToRoom + createRoomAsUser Summary

**One-liner:** `inviteToRoom` (POST /_matrix/client/v3/rooms/{roomId}/invite) and `createRoomAsUser` (POST /_matrix/client/v3/createRoom with per-user token) appended to matrix-admin-client.ts following the six per-primitive invariants, covering all seven inviteToRoom behaviors and six createRoomAsUser behaviors with fetch-mocked TDD.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| RED | Add failing tests for inviteToRoom + createRoomAsUser | 2122c42e | matrix-admin-client.test.ts |
| GREEN | Implement inviteToRoom + createRoomAsUser | 05f3eb06 | matrix-admin-client.ts |

## What Was Built

### inviteToRoom

Appended to `src/backend/matrix/matrix-admin-client.ts` at L1315:

```typescript
export async function inviteToRoom(
  roomId: string,
  mxidToInvite: string,
  senderMxid?: string,
): Promise<InviteToRoomOk | AdminErr>
```

- **Admin path** (`senderMxid` omitted): sends invite via `creds.accessToken`.
- **User path** (`senderMxid` provided): mints per-user token via `loginAsUser(senderMxid)`; loginAsUser failure short-circuits without calling the invite endpoint.
- `encodeURIComponent(roomId)` in URL path (T-91-02-T1 mitigate).
- AbortController + 30s timeout + `clearTimeout` in both success and error catch paths.
- `{ ok: true }` on 2xx; `{ ok: false, status, error }` for non-2xx / timeout / proxy errors.

### createRoomAsUser

Appended to `src/backend/matrix/matrix-admin-client.ts` at L1421:

```typescript
export async function createRoomAsUser(
  senderMxid: string,
  opts: { name: string; preset?: string; visibility?: 'private' | 'public'; roomAliasName?: string },
): Promise<CreateRoomAsUserOk | AdminErr>
```

- Always uses `loginAsUser(senderMxid)` — user is PL100 room creator per shape file.
- Optional `roomAliasName` forwarded as `room_alias_name` in JSON body.
- Defensive: 200 response missing `room_id` returns `{ ok: false, status: 502, error: ERR_PROXY }`.
- `{ ok: true, roomId, roomAlias? }` structurally interchangeable with `CreateRoomOk`.

## Test Coverage

13 new tests (7 + 6) appended to `matrix-admin-client.test.ts`:

**inviteToRoom:**
1. Happy path admin — URL contains encoded roomId, body `{ user_id }`, admin Bearer
2. Happy path user — loginAsUser called with senderMxid, invite uses per-user Bearer
3. Non-2xx 403 → `{ ok: false, status: 403, error: 'admin_api_non_2xx' }`
4. Timeout (AbortError) → `{ ok: false, status: 504, error: 'admin_api_timeout' }`; clearTimeout verified
5. loginAsUser failure short-circuits — only 1 fetch call, not 2
6. Null creds → `{ ok: false, status: 500, error: 'matrix_admin_creds_missing' }`
7. Special chars in roomId (`+`, `/`) → `%2B`, `%2F` in URL (not raw)

**createRoomAsUser:**
1. Happy path — userTok Bearer, /createRoom URL, body contains name/preset/visibility
2. loginAsUser failure short-circuits
3. Non-2xx 400 → `{ ok: false, status: 400, error: 'admin_api_non_2xx' }`
4. Timeout → `{ ok: false, status: 504, error: 'admin_api_timeout' }`; clearTimeout verified
5. 200 with missing room_id → `{ ok: false, status: 502, error: 'admin_api_proxy_error' }`
6. roomAliasName forwarded as `room_alias_name` in body

## Verification Results

```
Tests  120 passed (107 pre-existing + 13 new)
npx tsc --noEmit: clean
```

## Acceptance Criteria Check

| Criterion | Result |
|-----------|--------|
| `export async function inviteToRoom` == 1 | 1 |
| `InviteToRoomOk` occurrences >= 2 | 2 |
| `/_matrix/client/v3/rooms/` count increased (baseline 9) | 12 (+3) |
| `encodeURIComponent(roomId)` >= 1 | 7 |
| `ERR_TIMEOUT` count not decreased (baseline 15) | 17 (+2) |
| `ERR_NON_2XX` count not decreased (baseline 15) | 17 (+2) |
| `clearTimeout` count delta >= 2 (baseline 32) | 37 (+5, both paths x2 primitives) |
| `JSON.stringify(` — no new error-object serializations | 10 (+2 body-only; no err objects) |
| `export async function createRoomAsUser` == 1 | 1 |
| `CreateRoomAsUserOk` occurrences >= 2 | 3 |
| `/_matrix/client/v3/createRoom` >= 2 (existing + new) | 6 |
| `loginAsUser` call count increased (baseline 14) | 18 (+4) |
| Existing `createRoom` at L867 unchanged | Confirmed |
| All 7 inviteToRoom tests pass | PASS |
| All 6 createRoomAsUser tests pass | PASS |
| `npx tsc --noEmit` clean | PASS |

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

None. Both new primitives are internal extensions of the existing backend→Matrix trust boundary (already in the threat model). No new surface area introduced beyond what the plan's threat register anticipated.

## Self-Check: PASSED

- `src/backend/matrix/matrix-admin-client.ts` exists: FOUND
- `src/backend/matrix/matrix-admin-client.test.ts` exists: FOUND
- Commit `2122c42e` (RED tests): confirmed
- Commit `05f3eb06` (GREEN implementation): confirmed
