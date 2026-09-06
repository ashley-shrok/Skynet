---
phase: 75-server-side-substrate-bootstrap-startup-driven-install-pass-
plan: "04"
subsystem: substrate-credential-routing
tags:
  - cskek
  - host-resolver
  - substrate
  - credential-guard
  - d08
  - d09
  - d10
  - d16
dependency_graph:
  requires:
    - "75-01 (bundled-reader.ts extracted)"
    - "75-03 (list-substrate-hosts.ts — SWEEP-side CSKEK decrypt)"
  provides:
    - "credentialId-required guard in host.ts POST + PUT (API boundary enforcement)"
    - "CSKEK decrypt branch in host-resolver.ts (browser-terminal path for substrate hosts)"
  affects:
    - "src/backend/database/routes/host.ts — POST + PUT handlers"
    - "src/backend/ssh/host-resolver.ts — resolveHostById"
tech_stack:
  added:
    - "SystemCrypto.getInstance().getCredentialSharingKey() used in host-resolver.ts"
    - "FieldCrypto.decryptField used in host-resolver.ts for CSKEK field decryption"
  patterns:
    - "Fail-closed on CSKEK decrypt error (return null, never fall-through to user-DEK)"
    - "Explicit return after CSKEK branch (D-10 non-substrate hosts byte-unchanged)"
    - "Guard-at-API-boundary pattern for invariant enforcement"
key_files:
  created:
    - src/backend/database/routes/host.test.ts
    - src/backend/ssh/host-resolver.test.ts
  modified:
    - src/backend/database/routes/host.ts
    - src/backend/ssh/host-resolver.ts
decisions:
  - "Chose to insert CSKEK branch INSIDE the existing if(host.credentialId) block rather than as a separate block before it — avoids double credentialId check and keeps the structure clean. Non-substrate hosts (isSubstrate=false) fall through to the unchanged user-DEK block."
  - "Used direct db.select for runsFleetSubstrate lookup (not carried in the host input object) per plan's belt-and-suspenders guidance — prevents silent failures from upstream projection gaps."
  - "Chose outer try/catch for runsFleetSubstrate lookup that logs and falls through to user-DEK on failure — substrate check failure is not the same as confirmed-substrate CSKEK failure; the latter fails closed, the former logs a warning and degrades gracefully."
  - "host.test.ts uses direct handler invocation pattern (walk Express router.stack, extract last handler) rather than supertest — avoids HTTP server startup overhead and makes mock isolation precise."
  - "host.test.ts uses beforeAll (not beforeEach) for handler loading with 60s timeout — host.ts module import is slow due to large dependency graph; per-test reloading would hit vitest hook timeout."
metrics:
  duration: "~30 minutes"
  completed: "2026-09-06"
  tasks_completed: 2
  files_created: 2
  files_modified: 2
  tests_added: 21
---

# Phase 75 Plan 04: CSKEK Credential Guard + Browser-Terminal Decrypt Path Summary

**One-liner:** API-boundary 400 guard preventing inline-credential substrate hosts, plus CSKEK decrypt branch in host-resolver.ts so browser terminals to substrate hosts work without the owner's DEK.

## What Was Built

### Task 1: credentialId-required guard in host.ts POST + PUT

Added a D-08 guard immediately before `SimpleDBOps.insert` (POST handler) and `SimpleDBOps.update` (PUT handler) in `src/backend/database/routes/host.ts`.

Guard logic:
- POST: `if (effectiveRunsFleetSubstrate && !credentialId)` → 400 with `"Hosts with runsFleetSubstrate=true must use a named credential (credentialId required)"`
- PUT: `if (!!runsFleetSubstrate && !credentialId)` → same 400

Note on P3 (plan test): SSH hosts default `runsFleetSubstrate=true` (via `effectiveRunsFleetSubstrate` at host.ts:244-247). This means **every new SSH host now requires a credentialId**. This is intentional per the shape doc ("substrate is the norm, non-substrate is the exception"). Operators who want inline-cred SSH hosts must explicitly pass `runsFleetSubstrate: false`.

### Task 2: CSKEK decrypt branch in host-resolver.ts

Added to `src/backend/ssh/host-resolver.ts` inside the `if (host.credentialId)` block:

1. Fresh DB query for `hosts.runsFleetSubstrate` (belt-and-suspenders — not carried in host input object)
2. If `isSubstrate === true`: CSKEK decrypt path using `SystemCrypto.getInstance().getCredentialSharingKey()` + `FieldCrypto.decryptField` on `systemPassword`/`systemKey`/`systemKeyPassword` columns
3. Explicit `return host` after CSKEK decrypt — no fall-through to user-DEK path (D-10 scope boundary)
4. Fail-closed: any CSKEK error (missing cred row, decrypt throw, CSKEK load failure) returns `null` with a structured warn log

Non-substrate hosts with `credentialId` continue through the unchanged user-DEK path.

## Test Files

**host.test.ts** (new file, 11 tests):
- Testing pattern: direct handler invocation (walk Express router.stack → extract last route handler). Avoids supertest/HTTP server startup. Mock: SimpleDBOps, AuthManager (createAuthMiddleware passthrough), PermissionManager, db, multer.
- P1-P6: POST guard tests (3 trigger-400, 3 pass-through)
- U1-U5: PUT guard tests (2 trigger-400, 3 pass-through)

**host-resolver.test.ts** (new file, 10 tests):
- Testing pattern: vi.mock for getDb/SimpleDBOps/SystemCrypto/FieldCrypto/logger. Uses a `limitCallQueue` to differentiate direct `db.select().limit()` calls (CSKEK branch) from query-builder calls passed to `SimpleDBOps.select` (which are evaluated but never have `.limit()` awaited).
- C1-C3: CSKEK happy path (password, key, key+keyPassword)
- S1-S3: Non-substrate scope boundary (CSKEK branch not triggered, user-DEK path used)
- FC1-FC3: Fail-closed contract (decrypt throw, missing cred, CSKEK load failure)
- E1: Edge case (runsFleetSubstrate=true, credentialId=null → no CSKEK)

## Caller Impact Sweep

`resolveHostById` is called from ~40+ files across the codebase. The CSKEK branch only activates when `runsFleetSubstrate === true` in the DB. Existing substrate hosts in the DB that were created before this plan have inline credentials (no system_* columns populated) — those hosts will hit the CSKEK branch, find no `isSubstrate=true` (because the DB query returns the actual stored value), and fall through to the user-DEK path if the DB shows `runsFleetSubstrate=false`, or fail-closed with a null return if `runsFleetSubstrate=true` but system_* columns are empty. The 75-08 migration handles existing substrate hosts with unmigrated credentials.

**P3 behavior change note:** The POST handler now rejects SSH hosts with no credentialId (because SSH defaults `effectiveRunsFleetSubstrate=true`). Any caller that creates SSH hosts via the API without a credentialId will get a 400. No callers of `resolveHostById` are affected — this is an API-create/update boundary only.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Implementation Notes (not deviations)

**1. CSKEK branch placement:** Placed INSIDE the existing `if (host.credentialId)` block at the top, not as a separate preceding `if (host.credentialId)` block. This avoids double-checking credentialId and is semantically equivalent. Non-substrate hosts exit the `isSubstrate` check and fall through to the existing user-DEK code.

**2. Outer try/catch for runsFleetSubstrate lookup:** Added a catch around the substrate-check DB query. On failure, logs a warning and falls through to user-DEK (rather than fail-closed like the CSKEK decrypt itself). Rationale: inability to check substrate status is different from confirmed substrate host with bad CSKEK — the former is a DB failure that should degrade gracefully.

**3. host.test.ts beforeAll timeout:** Extended to 60s because `import('./host.js')` takes ~10-15s when all dependencies are freshly mocked. The default 10s vitest hook timeout hit when running alongside another test file.

## Known Stubs

None — no placeholder data flows to UI rendering from this plan's changes.

## Threat Flags

None beyond what was documented in the plan's threat model (T-75-04-01 through T-75-04-07). All mitigations in the threat register are implemented:
- T-75-04-01: 400 guard (Task 1) + fail-closed CSKEK branch (Task 2)
- T-75-04-02: `e.message` only in error logs (never `e.stack`)
- T-75-04-03: No credential plaintext in log calls

## Self-Check

Verifying claims before finalizing:

- host.test.ts EXISTS: FOUND
- host-resolver.test.ts EXISTS: FOUND
- All 4 task commits exist in git log: db371029, 73011d7e, 28572310, 06de491d
- 21 tests pass: confirmed via `npx vitest run` output

## Self-Check: PASSED
