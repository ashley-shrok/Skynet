---
phase: 75-server-side-substrate-bootstrap-startup-driven-install-pass-
plan: "03"
subsystem: distributor
tags: [substrate, cskek, credential-decrypt, session-less, tdd]
dependency_graph:
  requires:
    - src/backend/utils/system-crypto.ts (SystemCrypto.getCredentialSharingKey)
    - src/backend/utils/field-crypto.ts (FieldCrypto.decryptField)
    - src/backend/database/db/schema.ts (hosts, sshCredentials)
    - src/backend/utils/logger.ts (systemLogger)
  provides:
    - src/backend/distributor/list-substrate-hosts.ts (listSubstrateHosts, SubstrateHostRecord, ListSubstrateHostsDeps)
  affects:
    - 75-02 server-substrate-orchestrator.ts (consumer of listSubstrateHosts)
    - 75-05 starter.ts wiring (injects getDb dep into listSubstrateHosts)
tech_stack:
  added: []
  patterns:
    - deps-injection for DB (getDb function injection, crypto singletons mocked via vi.mock)
    - never-throw outer catch returning [] (mirrors starter.ts:436-441)
    - per-host try/catch to isolate one bad host from the rest of the list
    - LEFT JOIN (not INNER JOIN) so no-credentialId hosts surface for warn+skip
    - CSKEK-only credential decryption — zero per-user DEK paths
key_files:
  created:
    - src/backend/distributor/list-substrate-hosts.ts
    - src/backend/distributor/list-substrate-hosts.test.ts
  modified: []
decisions:
  - "DB injection via getDb function in deps (not module-scope import) — keeps the module a leaf with no boot-time side effects, consistent with distributor module conventions"
  - "LEFT JOIN on sshCredentials (not INNER JOIN) — exposes no-credential-id rows so the F1 defense-in-depth filter can warn and skip them rather than silently dropping"
  - "Crypto singletons mocked via vi.mock (not dep-injected) — consistent with every other distributor module; avoids injection surface explosion"
  - "key_password field name (snake_case) for system_key_password decrypt — confirmed at credential-system-encryption-migration.ts:93"
metrics:
  duration: "~4 minutes"
  completed: "2026-09-06"
  tasks_completed: 1
  files_created: 2
  files_modified: 0
---

# Phase 75 Plan 03: Session-less substrate-host enumerator (CSKEK decrypt) Summary

**One-liner:** Session-less `listSubstrateHosts` module that queries `enableSsh=true AND runsFleetSubstrate=true` hosts and decrypts their SSH credentials exclusively via `SystemCrypto.getCredentialSharingKey()` (CSKEK) — no browser session or per-user DEK required.

## What Was Built

New module `src/backend/distributor/list-substrate-hosts.ts` that is the input side of the Phase 75 startup pass. The existing `listIdentityHostingHosts` in `starter.ts:378-442` is unusable at container boot because it requires `currentSubscriberUserId` (a browser-session concept). This module builds the same return shape but uses CSKEK-based decryption instead of per-user DEK.

**Exports:**
- `listSubstrateHosts(deps: ListSubstrateHostsDeps): Promise<SubstrateHostRecord[]>`
- `type SubstrateHostRecord = { id: string; name: string; _connDetails: Record<string, unknown> }`
- `type ListSubstrateHostsDeps = { getDb: () => DrizzleDb }`

**Query shape:** drizzle `select(...).from(hosts).leftJoin(sshCredentials, eq(hosts.credentialId, sshCredentials.id)).where(and(eq(hosts.enableSsh, true), eq(hosts.runsFleetSubstrate, true)))`

**Credential decryption:** `FieldCrypto.decryptField(ciphertext, CSKEK, cred_id.toString(), fieldName)` for `password`, `key`, and `key_password` (snake_case confirmed at `credential-system-encryption-migration.ts:93`).

## Test Coverage (TDD)

13 tests across 5 groups, all green:

| Group | Tests | Coverage |
|-------|-------|---------|
| H1-H4 | Happy path — CSKEK decrypt + record shape | Password auth, key auth, key+passphrase, field-set assertion |
| N1-N2 | Scope narrowing (D-10) | WHERE clause called with args; mixed rows — only substrate rows decrypted |
| F1-F3 | Defense-in-depth filters | No credentialId, unmigrated creds, decrypt throws one host |
| NT1-NT2 | Never-throw contract | DB throws, CSKEK throws — both return [] + log `fleet_substrate_host_list_failed` |
| S1-S2 | Secret hygiene | CSKEK hex and plaintext credentials never appear in any log call arguments |

## Acceptance Criteria Verification

- `listSubstrateHosts` exported as async function: 1 match (grep returns 1)
- `SystemCrypto`/`getCredentialSharingKey` used: 4 matches (>= 1 required)
- `FieldCrypto.decryptField` used: 3 matches (>= 1 required)
- `DataCrypto.getUserDataKey`/`getUserDataKey` in code: 0 calls (only in security comment — D-08 enforced)
- `runsFleetSubstrate` in WHERE clause: 1 match (>= 1 required)
- All 4 defense-in-depth log tags present: confirmed (4 distinct tags)
- Test count: 13 (>= 11 required)
- `npx vitest run src/backend/distributor/list-substrate-hosts.test.ts`: exits 0
- `npx tsc --noEmit`: exits 0 (clean)

## Decisions Made

1. **getDb injection via deps** — The module accepts `deps: { getDb: () => DrizzleDb }` rather than calling `getDb()` at module scope. This keeps `list-substrate-hosts.ts` as a true leaf module with no boot-time side effects, consistent with the other distributor modules (`run-sweep.ts`, `run-bootstrap.ts`, `bundled-reader.ts`). The crypto singletons are imported at module scope and mocked via `vi.mock` (not injected), consistent with `run-bootstrap.test.ts` and `log-tags.test.ts` patterns.

2. **LEFT JOIN vs INNER JOIN** — Used LEFT JOIN so that substrate hosts with `credentialId=null` are returned as rows (with `cred_id=null`). This allows the F1 defense-in-depth filter to emit `fleet_substrate_host_no_credential_id` and skip them. An INNER JOIN would silently drop these rows without any warning.

3. **key_password field name (snake_case)** — The `system_key_password` column is decrypted with `FieldCrypto.decryptField(..., "key_password")` (snake_case), not `"keyPassword"`. Verified at `credential-system-encryption-migration.ts:93` where the migration uses the same convention.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The module is a pure reader of existing DB columns using an existing singleton (`SystemCrypto`). No new threat surface beyond what the plan's threat model already covers.

## Self-Check

Files created:
- `src/backend/distributor/list-substrate-hosts.ts`: EXISTS
- `src/backend/distributor/list-substrate-hosts.test.ts`: EXISTS

Commits:
- `2876eef0`: `test(75-03): add failing list-substrate-hosts test suite` (RED phase)
- `261859ff`: `feat(75-03): add session-less substrate-host enumerator with CSKEK decrypt` (GREEN phase)

## Self-Check: PASSED
