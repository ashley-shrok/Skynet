---
phase: 88-relay-mediated-group-conversations-sub-slice-a-human-relay-i
verified: 2026-09-08T10:55:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 88: Relay-Human Identities as First-Class — Verification Report

**Phase Goal:** Every new Skynet user gets a durable Matrix relay identity (mxid + live Synapse account), provisioned by Skynet at user-create time. User-delete paths deactivate the account before row removal. Pure infrastructure — no user-visible UI shipped.

**Verified:** 2026-09-08T10:55:00Z
**Status:** PASSED
**Score:** 12/12 must-haves verified
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every new user gets mxid minted + Matrix account created at POST /users/create | VERIFIED | users.ts:165-208 — Step 3.5 calls getMatrixAdminCreds → buildHumanMxid → createOrUpdateUser BEFORE avatar write; INSERT column list includes mxid at line 244 with mintedMxid as 18th arg |
| 2 | Refuse on Synapse-down (D-04) — 500 with no local side effects | VERIFIED | users.ts:181-191 — `mintResult.ok === false` → returns 500 `{"error":"relay identity provisioning failed"}` before any avatar write or SQL INSERT |
| 3 | Post-mint rollback deactivates (D-05) | VERIFIED | bestEffortDeactivate called at: avatar mime-mismatch (line 225), avatar generic fail (line 231), SQL INSERT fail (line 272), encryption-setup fail (line 316) — 4 branches total |
| 4 | Deactivate on delete — both paths (D-09/D-10) | VERIFIED | users.ts:2423-2437 (DELETE /users/delete-account) and delete-user-data.ts:114-128 (deleteUserAndRelatedData) — both call deactivateUser BEFORE db.delete; mxid-null skips; failure is log-and-proceed |
| 5 | Bijective sanitizer with `_` → `__` FIRST (D-06/D-07) | VERIFIED | username-to-mxid.ts:31-35 — ESCAPE_TABLE index 0 is `[/_/g, "__"]`; tests confirm `foo@bar` → `foo_at_bar` and `foo_at_bar` → `foo__at__bar` (distinct outputs) |
| 6 | Password discarded on the spot (D-08) | VERIFIED | `grep relayPassword users.ts` → exactly 2 hits: line 179 (declaration) + line 180 (arg to createOrUpdateUser); not in any logger call or response body |
| 7 | Telegram bridge unbroken | VERIFIED | bridge-config-writer.ts NOT in the phase 88 commit changeset; only src/backend/matrix/*, src/backend/database/routes/{users,delete-user-data,user-avatars integration}.ts, schema.ts touched |
| 8 | OIDC path NOT touched (D-12) | VERIFIED | registerOIDCUser at users.ts:1436 is unmodified; phase 88 commit diff for users.ts adds no lines touching that function |
| 9 | No user-facing UI (scope anchor) | VERIFIED | git log phase-88 commits -- src/ui/ returns empty; no UI files in changeset |
| 10 | Schema comments updated (D-14) — legacy phrase removed | VERIFIED | `grep "human relay creds are owned by the human" schema.ts` → exit 1 (0 matches); `grep "Phase 88" schema.ts` → 2 matches (users.mxid block line 35 + matrix_admin_creds block line 709) |
| 11 | All 32 new tests pass (scoped runs) | VERIFIED | username-to-mxid.test.ts: 16/16 pass; matrix-admin-client.test.ts: 50/50 (43 pre-existing + 7 new); users.test.ts: 35/35 (3 new create + 3 new delete + pre-existing); delete-user-data.test.ts: 7/7 (3 new + 4 pre-existing); user-avatars.integration.test.ts: 1/1 (unchanged). Total new: 32. |
| 12 | No deploy tasks in commits | VERIFIED | git log with --grep="push\|docker\|deploy" for phase-88 period returns no matching phase-88 commits; git worktree list shows single tree only |

**Score:** 12/12 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/matrix/username-to-mxid.ts` | Pure sanitizer + mxid builder + password gen + extractServerName | VERIFIED | 127 lines; 4 exports; only import is `node:crypto`; ESCAPE_TABLE ordering correct |
| `src/backend/matrix/username-to-mxid.test.ts` | 16 pure unit tests, 5 describe blocks | VERIFIED | 135 lines; 16 tests pass; covers sanitize, bijectivity, buildHumanMxid, password, extractServerName |
| `src/backend/matrix/matrix-admin-client.ts` | deactivateUser at ~line 564 | VERIFIED | Lines 552-602; POST /_synapse/admin/v1/deactivate/{mxid}; erase:false body; encodeURIComponent; 30s AbortController |
| `src/backend/matrix/matrix-admin-client.test.ts` | 7 new deactivateUser tests | VERIFIED | 50 total; 7 in `describe("deactivateUser")` block: happy path, 403, timeout, network error, no creds, URL encoding, erase:false body |
| `src/backend/database/routes/users.ts` | Mint-first + INSERT mxid column + rollback branches | VERIFIED | Step 3.5 at lines 165-208; INSERT with mxid at line 244; 4 rollback branches calling bestEffortDeactivate; DELETE deactivate at lines 2419-2437 |
| `src/backend/database/routes/users.test.ts` | vi.mock blocks + 3 create tests + 3 delete tests | VERIFIED | 35 tests pass; new mock blocks for matrix-admin-client, username-to-mxid, matrix-admin-creds-store |
| `src/backend/database/routes/user-avatars.integration.test.ts` | vi.mock blocks added, existing test unchanged | VERIFIED | 1 test passes; lifecycle test unbroken |
| `src/backend/database/routes/delete-user-data.ts` | deactivateUser before db.delete; mxid from avatarRow projection | VERIFIED | Lines 102-130; avatarRow select extended to include mxid (line 102); deactivate at lines 114-128 before db.delete at line 130 |
| `src/backend/database/routes/delete-user-data.test.ts` | 3 new deactivate tests | VERIFIED | 7 total; 3 new: deactivate called with mxid, null skips, failure is best-effort |
| `src/backend/database/db/schema.ts` | Legacy phrase removed; Phase 88 mentions added | VERIFIED | "human relay creds are owned by the human" → 0 occurrences; "Phase 88" → 2 occurrences |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| users.ts POST /users/create | matrix-admin-client.ts createOrUpdateUser | import line 40 + call line 180 | WIRED | createOrUpdateUser called with (mintedMxid, relayPassword, displayname) |
| users.ts POST /users/create | username-to-mxid.ts buildHumanMxid | import line 41 + call line 177 | WIRED | buildHumanMxid(username, serverName) called; result stored as mintedMxid |
| users.ts POST /users/create | matrix-admin-client.ts deactivateUser | import line 40 + closure call lines 197, 225, 231, 272, 316 | WIRED | bestEffortDeactivate closure calls deactivateUser(mintedMxid) in all 4 rollback branches |
| users.ts DELETE /users/delete-account | matrix-admin-client.ts deactivateUser | import line 40 + call line 2424 | WIRED | deactivateUser(userRecord.mxid) before db.delete line 2439 |
| delete-user-data.ts deleteUserAndRelatedData | matrix-admin-client.ts deactivateUser | import + call line 115 | WIRED | deactivateUser(avatarRow[0].mxid) before db.delete line 130 |
| users.ts INSERT | users.mxid column | raw SQL line 244 | WIRED | "INSERT INTO users (..., mxid) VALUES (...)" with mintedMxid as 18th positional arg |

---

## Anti-Patterns Found

None detected. Scanned all 10 modified source files for: TBD/FIXME/XXX, placeholder strings, return null/[]/{}
stubs, hardcoded empty props, console.log-only implementations. No matches that represent
incomplete behavior. No new packages added.

---

## Commit Prefix Conformance

All 13 phase-88 implementation commits carry correct `feat(88-XX-YY)`, `test(88-XX-YY)`, or
`docs(88-XX-YY)` prefixes. All SHAs present in git history (verified with `git cat-file -t`).

| SHA | Prefix | Note |
|-----|--------|------|
| e8c71f60 | feat(88-01-01) | username-to-mxid.ts source |
| dc672f33 | test(88-01-02) | username-to-mxid tests |
| 4ec9583c | feat(88-02-01) | deactivateUser primitive |
| a54af84c | test(88-02-02) | deactivateUser tests |
| d6d2e503 | feat(88-03-01) | mint-first wiring |
| 11ac5c3e | test(88-03-02) | users.test.ts mocks + 3 create tests |
| f18dce96 | test(88-03-03) | user-avatars integration mocks |
| e722a897 | feat(88-04-01) | DELETE deactivate in users.ts |
| 29031a69 | test(88-04-02) | DELETE deactivate tests + camelizeUser mxid fix |
| 385ccbfe | feat(88-04-03) | DELETE deactivate in delete-user-data.ts |
| bc17a3a0 | test(88-04-04) | delete-user-data deactivate tests |
| 2e1d8e2c | docs(88-04-05) | schema.ts comment cleanup (D-14) |

---

## Notable Auto-Fixed Issues

One deviation was documented and correctly auto-fixed by the executor:

- **camelizeUser mock missing mxid field** (commit 29031a69): The test helper in users.test.ts that maps raw SQLite rows to Drizzle-shaped objects was missing `mxid`. Without this fix, the D-09 test for mxid-populated path would have always resolved to the mxid-null branch. Fix was correct: `mxid: row.mxid ?? null` added to the camelizeUser return object.

---

## Human Verification Required

None — this phase is pure backend infrastructure with no user-visible UI and no new HTTP endpoints reachable from browsers. All observable behaviors are testable programmatically.

---

## Gaps Summary

No gaps. All 12 must-haves verified against actual code, not SUMMARY.md claims.

---

_Verified: 2026-09-08T10:55:00Z_
_Verifier: Claude (gsd-verifier)_
