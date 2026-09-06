---
phase: 80
plan: 02
subsystem: backend/matrix
tags: [matrix, synapse-admin, primitive, tdd]
dependency_graph:
  requires: []
  provides:
    - "countUsersMatching(prefix) primitive — counts Synapse users whose MXID matches a prefix (includes deactivated)"
    - "CountUsersOk type"
  affects:
    - "Plan 80-04 (pool-pick endpoint) will consume this to check MXID handle availability"
    - "Plan 80-03b (ordinal derivation at birth) will consume this to compute suffix numbers"
tech_stack:
  added: []
  patterns:
    - "loginAsUser byte-shape mirror (creds gate → URL → AbortController+fetch → discriminated-union return)"
    - "encodeURIComponent on every external string in URL path/query"
    - "clearTimeout in BOTH success and error branches"
key_files:
  created: []
  modified:
    - "src/backend/matrix/matrix-admin-client.ts (+59 lines: CountUsersOk type + countUsersMatching function)"
    - "src/backend/matrix/matrix-admin-client.test.ts (+108 lines: 9 tests under new describe block)"
decisions:
  - "Reused loginAsUser's discriminated-union return + error taxonomy verbatim — zero new error strings introduced"
  - "Body missing `total` field → safe default {ok:true, total:0} (Synapse SHOULD always include it but defense in depth)"
  - "deactivated=true is CRITICAL — Synapse deactivates but never deletes MXID handles; skipping it would allow the pool allocator to hand out already-reserved names"
metrics:
  duration: "~15 min"
  completed: "2026-09-06T13:55:59Z"
tasks_completed: 1
tasks_total: 1
files_created: 0
files_modified: 2
---

# Phase 80 Plan 02: countUsersMatching primitive Summary

Added `countUsersMatching(prefix)` to `src/backend/matrix/matrix-admin-client.ts` mirroring the byte-shape of the existing `loginAsUser` primitive — one new admin API primitive (GET `/_synapse/admin/v2/users?user_id=<prefix>&deactivated=true&limit=1`) plus a 9-case unit test suite. Substrate for plans 80-04 (pool-pick endpoint) and 80-03b (ordinal derivation at identity birth).

## What was built

**Task 1 (TDD auto):** `countUsersMatching(prefix: string): Promise<CountUsersOk | AdminErr>`

- Same discriminated-union return shape as sibling primitives (`AdminOk<{ total: number }> | AdminErr`)
- Same auth (`Bearer creds.accessToken` + `Content-Type: application/json`)
- Same timeout (`AbortController` + `REQUEST_TIMEOUT_MS = 30_000`)
- Same error taxonomy (`ERR_CREDS_MISSING` / `ERR_NON_2XX` / `ERR_TIMEOUT` / `ERR_PROXY`) — zero new error strings
- `encodeURIComponent(prefix)` on URL query — defense against T-80-02-03 (URL param injection)
- Body missing `total` field → safe default `{ok:true, total:0}`
- `clearTimeout(timeoutId)` invoked in both success and error branches
- `databaseLogger.error("matrix admin proxy error", err, { operation: "matrix_admin_count_users" })` — only logs `err` + operation tag, never `parsed`/`response`/`accessToken` (T-80-02-01/02 mitigation)

## Test coverage (9 cases)

1. Happy 200 with `{total:5}` → `{ok:true, total:5}`
2. Happy 200 with body missing `total` → `{ok:true, total:0}` (safe default)
3. `getMatrixAdminCreds() → null` → `{ok:false, status:500, error:'matrix_admin_creds_missing'}` (fetch NOT called — stub throws if called)
4. Non-2xx 403 → `{ok:false, status:403, error:'admin_api_non_2xx'}` + explicit no-body-leak assertion (`M_FORBIDDEN` / `server-secret-detail` MUST NOT appear in result)
5. AbortError (timeout) → `{ok:false, status:504, error:'admin_api_timeout'}`
6. Network TypeError → `{ok:false, status:502, error:'admin_api_proxy_error'}`
7. URL shape assertion — contains `/_synapse/admin/v2/users`, `user_id=`, `deactivated=true`, `limit=1`
8. `encodeURIComponent` defense — `@Willow+test:host` → `%40Willow%2Btest%3Ahost` in URL
9. Method GET + Authorization Bearer + Content-Type headers

## TDD cycle

- **RED** (`0e4319a0`): 9 tests added; all fail with `TypeError: countUsersMatching is not a function`
- **GREEN** (`da93cb32`): primitive implemented; all 36 tests pass (27 pre-existing + 9 new); zero regressions

## Acceptance criteria (all green)

| Criterion | Expected | Actual |
|---|---|---|
| `grep -c "export async function countUsersMatching"` | 1 | 1 |
| `grep -c "encodeURIComponent"` | ≥ baseline+1 | 7 (was 6) |
| `grep -c "matrix_admin_count_users"` | 1 | 1 |
| `grep -c "deactivated=true"` | ≥1 | 3 (source, JSDoc, test) |
| `grep -c "limit=1"` | ≥1 | 3 |
| `grep -c "ERR_COUNT"` | 0 | 0 |
| `grep -E "console\.(log\|info)" \| wc -l` | baseline | 0 (baseline preserved) |
| `-t "countUsersMatching"` passing test count | ≥5 | 9 |

## Verification

- `npx vitest run src/backend/matrix/matrix-admin-client.test.ts` → 36/36 pass (0 fail, 0 skip), exit 0
- `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` → exit 0 (no output)
- No new npm dependencies (`git diff package.json` empty for this plan)
- Integration test against live Synapse deferred to orchestrator ship-gate per plan `<action>` scope fence

## Deviations from Plan

None — plan executed exactly as written. Zero deviation rules triggered. No auth gates. No checkpoints. No follow-up bounties.

## Threat model mitigations verified

| Threat ID | Mitigation | Verified via |
|---|---|---|
| T-80-02-01 (bearer token leak into logs) | Log call uses only `err` + `{operation}` tag; no `accessToken` reference | Code review — grep for `accessToken` in `databaseLogger.error` call: 0 hits |
| T-80-02-02 (response body leak into logs) | Log call uses only `err` + operation; no `parsed`/`response` reference | Code review — grep for `parsed`/`response` in `databaseLogger.error` call: 0 hits |
| T-80-02-03 (URL param injection via `prefix`) | `encodeURIComponent(prefix)` on URL assembly | Test 8 asserts `@Willow+test:host` → `%40Willow%2Btest%3Ahost` |
| T-80-02-04 (slow Synapse hangs request) | AbortController + `REQUEST_TIMEOUT_MS = 30_000` | Test 5 asserts abort → `{status:504, error:'admin_api_timeout'}` |

## Files & commits

| File | Change | Commit |
|---|---|---|
| `src/backend/matrix/matrix-admin-client.test.ts` | +108 (9 test cases in new describe block) | `0e4319a0` (RED) |
| `src/backend/matrix/matrix-admin-client.ts` | +59 (`CountUsersOk` type + `countUsersMatching` function + JSDoc) | `da93cb32` (GREEN) |

Local commits, NOT pushed / NOT built / NOT deployed per executor scope (fleet sequential-mode rule).

## Next plan

Plan 80-03 or 80-03b picks up ordinal derivation at identity birth-time — will consume this `countUsersMatching` primitive to compute suffix numbers (e.g. `Willow-Skynet-Maintainer-2` when `Willow-*` count is already 1).

## Self-Check: PASSED

- `src/backend/matrix/matrix-admin-client.ts` — FOUND (contains new `countUsersMatching` export)
- `src/backend/matrix/matrix-admin-client.test.ts` — FOUND (contains new `describe("countUsersMatching", ...)` block)
- Commit `0e4319a0` — FOUND (RED)
- Commit `da93cb32` — FOUND (GREEN)
