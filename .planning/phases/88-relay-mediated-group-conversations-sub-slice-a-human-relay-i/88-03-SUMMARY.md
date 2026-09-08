---
phase: 88-relay-mediated-group-conversations-sub-slice-a-human-relay-i
plan: 03
subsystem: backend/users
tags: [phase-88, users-create, matrix-mint, relay-identity, integration]
dependency_graph:
  requires: [88-01, 88-02]
  provides: [mint-first-user-create, post-mint-rollback-deactivate, mxid-insert]
  affects: [src/backend/database/routes/users.ts, src/backend/database/routes/users.test.ts, src/backend/database/routes/user-avatars.integration.test.ts]
tech_stack:
  added: []
  patterns: [mint-first-ordering, best-effort-deactivate-on-rollback, discriminated-union-returns, hoisting-safe-vi-mock]
key_files:
  created: []
  modified:
    - src/backend/database/routes/users.ts
    - src/backend/database/routes/users.test.ts
    - src/backend/database/routes/user-avatars.integration.test.ts
decisions:
  - D-03: POST /users/create mints the full Matrix account + stores mxid; admin endpoint untouched
  - D-04: Synapse-unreachable returns 500 before any local side effect
  - D-05: Mint before avatar write; post-mint rollback branches call bestEffortDeactivate
  - D-08: relayPassword declared + passed inline, then goes out of scope (grep-verified: exactly 2 occurrences)
  - D-11: Displayname = title-cased pre-@ local part of username
metrics:
  duration: "~35 minutes"
  completed: "2026-09-08"
  tasks_completed: 3
  files_modified: 3
---

# Phase 88 Plan 03: mint-first integration + INSERT column extension + tests Summary

**One-liner:** Wired mint-first Matrix account provisioning into POST /users/create with three rollback branches calling bestEffortDeactivate, extended the raw INSERT to persist mxid, and added vi.mock scaffolding + 3 new tests covering mint-success, mint-failure, and post-mint rollback.

## What Was Built

### Task 1 — users.ts extension (D-03, D-04, D-05, D-08, D-11)

**New imports (lines 40-42):**
- `createOrUpdateUser`, `deactivateUser` from `../../matrix/matrix-admin-client.js`
- `buildHumanMxid`, `generateHumanRelayPassword`, `extractServerName` from `../../matrix/username-to-mxid.js`
- `getMatrixAdminCreds` from `../../matrix/matrix-admin-creds-store.js`

**Step 3.5 insertion point:** lines 165-208 (between uniqueness check at line 158 and avatar write at line 210).

**Step 3.5 flow:**
1. `getMatrixAdminCreds()` → null → 500 with log `user_create_admin_creds_missing` (D-04)
2. `extractServerName(adminCreds.homeserverBase)` → pure, no throw
3. `buildHumanMxid(username, serverName)` → `@<sanitized>_human:<server>` (D-06/D-07)
4. `deriveDisplayname(username)` → title-case pre-`@` local part (D-11)
5. `const relayPassword = generateHumanRelayPassword()` + `createOrUpdateUser(mintedMxid, relayPassword, displayname)`
6. mintResult.ok===false → 500 with log `user_create_matrix_mint_failed`, including mxid+status+error but NOT password (D-08)
7. relayPassword goes out of scope; password is discarded (D-08)

**deriveDisplayname helper:** defined at module scope above the router (lines 57-62). Takes `username: string`, returns title-cased local part. `"ashley"` → `"Ashley"`, `"ashley@aitherhealth.com"` → `"Ashley"`.

**INSERT extension (line 244 — Pitfall 1 fix):**
```
INSERT INTO users (id, username, password_hash, is_admin, is_oidc, client_id, client_secret, issuer_url, authorization_url, token_url, identifier_path, name_path, scopes, totp_secret, totp_enabled, totp_backup_codes, avatar_path, mxid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```
`mintedMxid` is passed as the 18th positional argument.

**bestEffortDeactivate helper (lines 195-208):** captures `mintedMxid` in closure, calls `deactivateUser(mintedMxid)`, logs on non-ok but does NOT block the 500 response.

**Three rollback branches with deactivation:**
- Avatar-write catch (mime-mismatch 400 path): `user_create_deactivate_after_avatar_fail` (line 225)
- Avatar-write catch (other 500 path): `user_create_deactivate_after_avatar_fail` (line 231)
- SQL INSERT catch: `user_create_deactivate_after_insert_fail` (line 272)
- Encryption-setup catch: `user_create_deactivate_after_encryption_fail` (line 316)

Total: 4 deactivate calls across the rollback branches (label count ≥ 3 per criteria — ✓).

**Outer catch:** documented NOT to call deactivation — if we reach here the mint state is ambiguous and best-effort orphan cleanup via log sweep handles it.

### Task 2 — users.test.ts mocks + 3 new tests

**New vi.mock blocks (after line 330):**
- `../../matrix/matrix-admin-client.js` — `mockCreateOrUpdateUser` + `mockDeactivateUser` (hoisting-safe wrapper pattern)
- `../../matrix/username-to-mxid.js` — fixed happy-path stubs (buildHumanMxid returns `@alice_human:thenasty.taild9b663.ts.net`)
- `../../matrix/matrix-admin-creds-store.js` — resolves non-null creds

**beforeEach additions:** `mockCreateOrUpdateUser.mockClear()` + default `{ ok: true, mxid: "@alice_human:...", status: 201 }`, `mockDeactivateUser.mockClear()` + default `{ ok: true }`.

**New tests:**
- Test B `(88-03-B)`: mint-success — response 200, `mockCreateOrUpdateUser` called once with minted mxid, `users.mxid` equals the minted mxid, `mockDeactivateUser` never called.
- Test C `(88-03-C)`: mint-failure — `mockCreateOrUpdateUser.mockResolvedValueOnce({ ok: false, status: 502, error: "admin_api_proxy_error" })` → response 500, body `{ error: "relay identity provisioning failed" }`, no row, no file write, no deactivate.
- Test D `(88-03-D)`: post-mint avatar-write failure — `mockWriteUserAvatar.mockRejectedValueOnce(new Error("disk full"))` → response 500, `mockDeactivateUser` called once with `@alice_human:thenasty.taild9b663.ts.net`, no row inserted.

### Task 3 — user-avatars.integration.test.ts mocks

Three new vi.mock blocks added after the existing mock cluster (after `shared-credential-manager.js` mock), using inline `vi.fn()` — same shape as users.test.ts but simpler (no hoisted module-level refs needed since no per-test overrides). Existing integration test (`create → serve → change → serve → delete → verify-clean`) still passes with 0 assertion changes.

## Displayname Derivation Rule (D-11)

Title-cased pre-`@` local part:
- `"ashley"` → `"Ashley"` (simple username)
- `"ashley@aitherhealth.com"` → `"Ashley"` (email username, T800 use case)
- `"ALICE"` → `"ALICE"` (already uppercase — charAt(0).toUpperCase() is idempotent)

## Test Run Output

```
Test Files  2 passed (2)
Tests       33 passed (33)
  - users.test.ts: 32 tests (7 pre-existing POST /users/create + 3 new + other describe blocks)
  - user-avatars.integration.test.ts: 1 test (unchanged)
Duration    53.61s
```

## D-08 Discipline Verification

```
grep -c 'relayPassword' src/backend/database/routes/users.ts
→ 2 (line 179: declaration; line 180: createOrUpdateUser call)
```

Only these two occurrences — never in `authLogger`, never in `res.json`, never in any response body.

## INSERT Column-List Extension Verification

```
grep -cE 'INSERT INTO users \(.*, mxid\) VALUES' src/backend/database/routes/users.ts
→ 1
```

## Pitfall 2 Avoidance Verification (deactivation uses POST v1/deactivate, not PUT v2 with deactivated:true)

```
grep -c 'deactivated: true' src/backend/database/routes/users.ts
→ 0  (no hand-rolled deactivation via PUT v2)
```

The deactivation path uses `deactivateUser(mintedMxid)` from `matrix-admin-client.ts`, which uses `POST /_synapse/admin/v1/deactivate/{mxid}` (implemented and tested in Plan 02).

## Rollback-Branch Log Operation Codes

| Branch | Operation label |
|--------|----------------|
| Avatar-write fail (mime-mismatch 400 + generic 500) | `user_create_deactivate_after_avatar_fail` |
| SQL INSERT fail | `user_create_deactivate_after_insert_fail` |
| Encryption-setup fail | `user_create_deactivate_after_encryption_fail` |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/backend/database/routes/users.ts` — file exists and modified ✓
- `src/backend/database/routes/users.test.ts` — file exists and modified ✓
- `src/backend/database/routes/user-avatars.integration.test.ts` — file exists and modified ✓
- Commit `d6d2e503` (feat 88-03-01) — exists ✓
- Commit `11ac5c3e` (test 88-03-02) — exists ✓
- Commit `f18dce96` (test 88-03-03) — exists ✓
- `npx tsc --noEmit` — zero errors ✓
- All 33 tests pass ✓

## Threat Flags

None — no new network endpoints, no new auth paths introduced. Trust boundaries are all internal
(users.ts backend → Synapse admin API via existing matrix-admin-client.ts primitives).
The T-88-03 relayPassword-leak mitigation is confirmed by grep (2 occurrences, neither in logger or response body).
