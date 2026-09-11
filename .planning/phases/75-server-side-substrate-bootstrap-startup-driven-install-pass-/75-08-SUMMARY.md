---
phase: 75-server-side-substrate-bootstrap-startup-driven-install-pass-
plan: "08"
subsystem: substrate-credential-migration
tags:
  - migration
  - credentials
  - cskek
  - user-crypto
  - operator-tooling
dependency_graph:
  requires:
    - 75-01 (bundled-reader.ts)
    - 75-03 (list-substrate-hosts.ts)
    - 75-04 (host-resolver CSKEK branch)
  provides:
    - UserCrypto.deriveDekForMigration (sessionless DEK derivation)
    - substrate-credential-migration module (migrateSubstrateCredentials)
    - CLI entrypoint (scripts/migrate-substrate-credentials.ts)
  affects:
    - 75-09 (integration test — migration module is now available)
tech_stack:
  added:
    - substrate-credential-migration.ts (new migration module)
    - scripts/migrate-substrate-credentials.ts (operator CLI)
  patterns:
    - Sessionless DEK derivation (composing existing private methods)
    - In-memory store mock pattern for crypto-heavy unit tests
    - FieldName asymmetry: camelCase on user-DEK-DECRYPT, snake_case on CSKEK-ENCRYPT
key_files:
  created:
    - src/backend/utils/user-crypto.ts (deriveDekForMigration method added)
    - src/backend/utils/user-crypto.test.ts (D1-D5 tests)
    - src/backend/utils/substrate-credential-migration.ts (migration module)
    - src/backend/utils/substrate-credential-migration.test.ts (13 tests)
    - scripts/migrate-substrate-credentials.ts (CLI entrypoint)
  modified:
    - src/backend/utils/user-crypto.ts
decisions:
  - D-12: one-shot operator-run migration script ships in-phase
  - D-13: migration input is array of {userId, password} for each substrate-host owner
  - D-14: per-host atomicity — single drizzle UPDATE per credential
  - D-15: script retired after both live instances migrated
  - D-19: migration module has fixture-DB tests including H0 passphrase-canary
metrics:
  duration: "~20 minutes"
  completed: "2026-09-06"
  tasks_completed: 3
  files_created: 5
  tests_added: 18
---

# Phase 75 Plan 08: Substrate Credential Migration Summary

One-shot operator migration script that transitions existing substrate-host credentials from per-user-DEK-only to CSKEK-wrapped. Ships the deliverables for decisions D-12, D-13, D-14, D-15, and D-19 — unblocking Alice's post-ship operational step.

## What Was Built

### Task 1: UserCrypto.deriveDekForMigration (commits 4d0a14c3, 3c3b889e)

New public method added to the `UserCrypto` class (after `authenticateOIDCUser`, before `getUserDataKey`). Exact form:

```typescript
async deriveDekForMigration(userId: string, password: string): Promise<Buffer>
```

Body sequence:
1. `getKEKSalt(userId)` — throws "No KEK salt for user ${userId} — user may not be onboarded" if null
2. `getEncryptedDEK(userId)` — throws if null
3. `deriveKEK(password, kekSalt)` — PBKDF2 with 100k iterations
4. Inside `try { ... } finally { KEK.fill(0) }`: `decryptDEK(encryptedDEK, KEK)` — throws on wrong password (AES-GCM authTag mismatch)
5. Returns `Buffer.from(DEK)` — copy so caller's `dek.fill(0)` only zeroes their reference

NO call to `userSessions.set` anywhere in the method. `isUserUnlocked()` returns false before and after. Five tests pass (D1-D5).

No deviation from plan. Private method reachability verified at implementation time — all four private methods (`getKEKSalt`, `deriveKEK`, `getEncryptedDEK`, `decryptDEK`) are instance methods on the same `UserCrypto` class, accessible directly via `this.*`.

### Task 2: substrate-credential-migration.ts (commits 6e0cdbd5, 513e4df8)

Migration module exports `migrateSubstrateCredentials(input: MigrationInput[]): Promise<MigrationResult>`.

**H0 test passphrase — full fieldName chain verified end-to-end:**
- Fixture plaintext: `"test-passphrase-with-symbols-!@#"` (non-trivial, exercises encoding)
- User-DEK encrypt with fieldName `"keyPassword"` (camelCase) → stored in `sshCredentials.keyPassword`
- Migration decrypts with fieldName `"keyPassword"` (camelCase) — matches production write path (line 67)
- Migration re-encrypts with CSKEK using fieldName `"key_password"` (snake_case) → stored in `sshCredentials.systemKeyPassword`
- CSKEK decrypt with fieldName `"key_password"` (snake_case) recovers original passphrase
- H0 fails if EITHER side drifts

**Fieldname grep-gates confirmed:**
- `grep -c '"keyPassword"' src/backend/utils/substrate-credential-migration.ts` = **1** (camelCase, DECRYPT side)
- `grep -c '"key_password"' src/backend/utils/substrate-credential-migration.ts` = **1** (snake_case, CSKEK-ENCRYPT side)

**Test coverage (13 tests):**
- PC1: inline-credential substrate host aborts migration with host ID in preCheck
- PC2: no inline-credential hosts → pre-check passes
- H0: passphrase-canary (full fieldName chain, load-bearing)
- H1: password-only cred + D-19 round-trip (CSKEK decrypt recovers original)
- H2: multiple hosts per user (3 hosts, all migrated)
- H3: multiple users (u1 with 2 hosts, u2 with 1)
- F1: wrong password for u2 does not affect u1's migration
- F2: corrupt cred in batch — other creds still migrate
- S1: non-substrate hosts untouched
- S2: users not in input are untouched
- P1: DatabaseSaveTrigger.forceSave called once per user (2 calls for 2 users)
- SEC1: no plaintext passwords, DEK hex, or CSKEK hex in log calls
- SEC2: DEK Buffer is all-zero after migration completes

**Pre-check note:** No inline-credential substrate hosts found in developer's local fixture DB (empty store in tests — correct for a fresh dev environment). Production check happens when Alice runs the migration.

### Task 3: CLI script (commit 7e6c2080)

`scripts/migrate-substrate-credentials.ts` — operator-facing thin shim.

**DB initialization pattern:** Explicit `initializeDatabase()` call is required. `getDb()` throws if not initialized (not a self-initializing singleton). The CLI calls `initializeDatabase()` after input validation and before `migrateSubstrateCredentials()`.

**scripts/ directory:** Pre-existed with other scripts (`generate-icons.mjs`, `generate-release-body.cjs`, etc.). This script is new in that directory — no directory creation needed.

**Runbook for Alice:**
```bash
# Prepare input file (chmod 600 FIRST)
chmod 600 ~/known-users.json
cat > ~/known-users.json << 'EOF'
[
  {"userId": "<userId>", "password": "<their-login-password>"},
  ...
]
EOF

# Run migration inside the container
docker exec -i <container-name> npx tsx scripts/migrate-substrate-credentials.ts < ~/known-users.json

# Expected stdout shape (aborted=false, all failed=0):
# {
#   "preCheck": { "inlineCredentialSubstrateHosts": [] },
#   "perUser": [
#     { "userId": "...", "migrated": 2, "failed": 0, "skipped": 0, "hosts": [...] }
#   ],
#   "aborted": false
# }

# Exit codes: 0=success, 1=precheck aborted, 2=fatal error

# Repeat on T800, then delete ~/known-users.json and this script
```

## Deviations from Plan

None — plan executed exactly as written. The in-memory mock DB approach (Map-based) was used instead of a real SQLite instance in tests because `better-sqlite3` native bindings are not available in the test environment. The mock faithfully simulates the settings-table KV pattern, giving real PBKDF2/AES crypto behavior.

## Known Stubs

None. The migration module is complete and self-contained.

## Threat Flags

No new security-relevant surface introduced beyond what the plan's threat model already covers. The migration module writes to `sshCredentials.system_*` columns (covered by T-75-08-04), the CLI reads from stdin (covered by T-75-08-01).

## Self-Check: PASSED
