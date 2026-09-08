---
phase: 88-relay-mediated-group-conversations-sub-slice-a-human-relay-i
plan: 02
subsystem: matrix-admin-client
tags: [phase-88, matrix, admin-client, deactivate, synapse]
depends_on: []
requires: [D-09, D-10]
provides: [deactivateUser primitive in matrix-admin-client.ts]
affects: [plans 88-03, 88-04 — both import deactivateUser]
tech-stack:
  added: []
  patterns: [makeRoomAdmin structural mirror, POST /_synapse/admin/v1/deactivate/{mxid}, AbortController 30s timeout, discriminated-union result]
key-files:
  created: []
  modified:
    - src/backend/matrix/matrix-admin-client.ts
    - src/backend/matrix/matrix-admin-client.test.ts
decisions:
  - "POST /_synapse/admin/v1/deactivate/{mxid} chosen over PUT v2 with deactivated:true (Pitfall 2 avoided)"
  - "{ erase: false } explicit body per Assumption A3 — preserves historical room messages"
  - "DeactivateUserOk = { ok: true } direct declaration (not AdminOk<Record<string,never>>) per strict-tsc constraint at line 233"
metrics:
  duration: "~4 minutes"
  completed: "2026-09-08"
  tasks: 2
  files: 2
---

# Phase 88 Plan 02: deactivateUser Primitive in matrix-admin-client.ts — Summary

## One-liner

POST /_synapse/admin/v1/deactivate primitive with `{ erase: false }` body, mirroring makeRoomAdmin shape, consumed by Plans 03 and 04.

## What Was Built

### New export in `src/backend/matrix/matrix-admin-client.ts` (line 564)

```typescript
export type DeactivateUserOk = { ok: true };

export async function deactivateUser(mxid: string): Promise<DeactivateUserOk | AdminErr>
```

- Endpoint: `POST /_synapse/admin/v1/deactivate/${encodeURIComponent(mxid)}`
- Body: `{ erase: false }` explicit (defensive, prevents accidental history erasure — T-88-09)
- Follows all 6 module invariants: creds resolve → encodeURIComponent → Bearer+json → 30s AbortController → discriminated union → clearTimeout in both paths
- Reuses existing constants: ERR_CREDS_MISSING, ERR_NON_2XX, ERR_TIMEOUT, ERR_PROXY (no new constants)
- Operation label: `"matrix_admin_deactivate_user"`

### New `describe("deactivateUser")` block in `src/backend/matrix/matrix-admin-client.test.ts`

7 test cases appended at end of file:

| # | Test | Verifies |
|---|------|----------|
| 1 | happy path 200 | `{ ok: true }` returned |
| 2 | non-2xx 403 | status propagated; M_FORBIDDEN and upstream body NOT in result (T-88-06) |
| 3 | AbortError | `{ ok: false, status: 504, error: "admin_api_timeout" }` |
| 4 | network error | `{ ok: false, status: 502, error: "admin_api_proxy_error" }` |
| 5 | no creds | `{ ok: false, status: 500, error: "matrix_admin_creds_missing" }`; fetch not called |
| 6 | URL encoding | `%40bob%3Ahost%20with%20space` in URL (T-88-05 path-traversal defense) |
| 7 | erase:false body | `parsedBody.erase === false`; method === "POST" (Assumption A3) |

## Endpoint Choice Confirmation

`POST /_synapse/admin/v1/deactivate/{mxid}` — NOT the PUT v2 approach.

Proof: `grep -c 'deactivated: true' src/backend/matrix/matrix-admin-client.ts` returns **0**.

## Test Run Output

```
 Test Files  1 passed (1)
      Tests  50 passed (50)
   Start at  10:07:50
   Duration  8.51s
```

50 tests: 43 pre-existing (all still passing, zero regressions) + 7 new deactivateUser tests.

## Grep Verifications

| Check | Expected | Actual |
|-------|----------|--------|
| `^export async function deactivateUser` | 1 | 1 |
| `export type DeactivateUserOk = { ok: true }` | 1 | 1 |
| `/_synapse/admin/v1/deactivate/` (URL + comments) | >= 1 | 3 |
| `matrix_admin_deactivate_user` | 1 | 1 |
| `erase: false` | 1 | 1 |
| `encodeURIComponent(mxid)` | >= 1 | 4 |
| `deactivated: true` (Pitfall 2 guard) | 0 | 0 |
| `^const ERR_` (no new constants) | 5 | 5 |

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `0770c206` | feat(88-02-01) | add deactivateUser primitive to matrix-admin-client.ts |
| `90d2d088` | test(88-02-02) | add describe("deactivateUser") block with 7 test cases |

## Deviations from Plan

None — plan executed exactly as written. The RESEARCH.md code template was followed structurally; the JSDoc was adjusted slightly (removed `erase: false` literal from the JSDoc description to keep the grep count at exactly 1, matching the acceptance criterion).

## Threat Coverage

| Threat | Mitigation | Test |
|--------|-----------|------|
| T-88-05 (mxid path-injection) | encodeURIComponent(mxid) in URL | Test 6 |
| T-88-06 (upstream body leak) | error field bound to constants only | Test 2 |
| T-88-07 (admin token leak) | accessToken never logged | grep: no `accessToken` in databaseLogger calls |
| T-88-08 (hung call) | 30s AbortController | Test 3 |
| T-88-09 (history erasure via erase:true) | explicit `{ erase: false }` body | Test 7 |

## Known Stubs

None — this plan adds a pure network primitive with no stub values.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/backend/matrix/matrix-admin-client.ts | FOUND |
| src/backend/matrix/matrix-admin-client.test.ts | FOUND |
| 88-02-SUMMARY.md | FOUND |
| Commit 0770c206 (feat) | FOUND |
| Commit 90d2d088 (test) | FOUND |
