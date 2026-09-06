---
phase: 75-server-side-substrate-bootstrap-startup-driven-install-pass-
verified: 2026-09-06T04:00:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
gaps: []
---

# Phase 75: Server-side Substrate Bootstrap Verification Report

**Phase Goal:** Reshape fleet-substrate distribution from per-user-browser-driven to system-driven. Startup pass walks every substrate-flagged host serially on container boot, on-add trigger fires immediately, retries piggyback on the 30s host-list refresh, credentials for substrate hosts get CSKEK-wrapped, browser-driven hook is removed, one-shot operator-run migration ships for existing hosts.
**Verified:** 2026-09-06T04:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from shape § "what would make it wrong")

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Freshly-provisioned host does NOT require a browser to bootstrap | VERIFIED | `server-substrate-orchestrator.ts` starts from `starter.ts` boot IIFE at line 707, independent of `subscription-registry` lifecycle. `listSubstrateHosts` uses CSKEK exclusively — zero `getUserDataKey` calls. Tests I-STARTUP prove orchestrator walks hosts without any browser session. |
| 2 | Substrate update ships in a deploy and existing hosts pick it up without owner login | VERIFIED | Container restart fires startup pass (D-01, D-05). The orchestrator is wired via `substrateOrch.start().catch(...)` in `starter.ts:840` — fires at every container boot regardless of who (if anyone) is logged in. |
| 3 | Briefly-unreachable host gets a second chance on the 30s tick | VERIFIED | `server-substrate-orchestrator.ts`: `sweepedThisInstance` only populated on `itemsFailed===0`. Failed hosts remain unmarked and are re-swept on every `setInterval(30000)` tick. Test I-RETRY confirms: 30s tick re-sweeps failed host, skips already-succeeded host. |
| 4 | Dead-forever host is loud, not silent | VERIFIED | `consecutiveFailures` Map + `persistentAlertFired` Set in orchestrator. `logPersistentFailure` fires at `persistentFailureThreshold=3` consecutive failures via `fleet_substrate_host_persistent_failure` operation tag (D-06/D-07). Tests I-PERSISTENT (1): alert fires exactly once at N=3; F2 (unit): 4th failure does NOT re-alert. Retries continue forever. |
| 5 | Existing substrate hosts are transitioned, not left in old model | VERIFIED | `scripts/migrate-substrate-credentials.ts` + `src/backend/utils/substrate-credential-migration.ts` ships in-phase. Migration: for each substrate-host owner, derives DEK via `UserCrypto.deriveDekForMigration` (sessionless PBKDF2), decrypts per-user-DEK fields, re-encrypts into CSKEK (`systemPassword`/`systemKey`/`systemKeyPassword`), flushes with `DatabaseSaveTrigger.forceSave`. D-19 round-trip test (H1) + passphrase-canary (H0) prove the wrap/unwrap chain is correct end-to-end. |
| 6 | Per-person credential lock NOT relaxed for non-substrate hosts | VERIFIED | `host-resolver.ts:90` gates the CSKEK branch on `runsFleetSubstrate === true` with an explicit `return host` after. Non-substrate hosts fall through to the unmodified per-user DEK path. Tests S1-S3 in host-resolver.test.ts assert CSKEK branch NOT triggered when `runsFleetSubstrate=false`. D-10 scope boundary explicitly documented in code comment. |
| 7 | Browser-driven install-pass hook is removed | VERIFIED | `ssh-poll-orchestrator.ts` (2202 lines post-deletion): 0 occurrences of `sweepedThisInstance`, `sweepInFlight`, `runSweepForHost`, `logSweepHookError`, `bundledReaderFromDisk`, `FLEET_SUBSTRATE_CATALOG`. 7 sweep-hook tests deleted. No distributor imports remain in orchestrator. |
| 8 | Initial startup pass is serial, not parallel | VERIFIED | `server-substrate-orchestrator.ts:271`: `// Serial sweep — for...of with await, not Promise.all (D-01 decision)`. Code: `for (const host of hosts) { ... await ...}`. Test S3 (unit) verifies call order matches enumeration order. No `Promise.all` in orchestrator. |

**Score: 8/8 truths verified**

---

### Decision Coverage (D-01 through D-19)

| Decision | Description | Plan(s) | Evidence |
|----------|------------|---------|----------|
| D-01 | Startup pass runs at container boot, serially | 75-02, 75-05 | `for...of with await` in orchestrator; fire-and-forget in starter.ts:840 |
| D-02 | Host-create hook fires fire-and-forget | 75-06 | `queueMicrotask(async () => { ... sweepOneHost(...) })` in host.ts POST handler, after `res.json` |
| D-03 | Retry cadence piggybacks on 30s host-list refresh | 75-02 | `setInterval(retryIntervalMs=30000)` in orchestrator; test R1 confirms |
| D-04 | Browser-driven hook removed | 75-07 | All 6 sweep-hook identifiers zero-count in orchestrator; 7 tests deleted |
| D-05 | Once-per-host-per-Skynet-lifetime invariant preserved | 75-02 | `sweepedThisInstance` Set gating; `sweepInFlight` double-fire guard; tests G1, G2 |
| D-06 | Loud alerting after N=3 consecutive failures | 75-02 | `logPersistentFailure` at `fleet_substrate_host_persistent_failure`; N=3 chosen (threshold within 3-5 range); tests F1, F4, I-PERSISTENT |
| D-07 | Alert fires once per host per uptime; reset on success | 75-02 | `persistentAlertFired` Set; `consecutiveFailures.delete` + `persistentAlertFired.delete` on success; tests F2, F3 |
| D-08 | Substrate hosts get CSKEK-wrapped credentials at create/update/flip | 75-04 | 400 guard enforces `credentialId` requirement; `SimpleDBOps.insert` for `ssh_credentials` already writes CSKEK columns; PUT triggers fire on flag-flip-on + credential-rotation |
| D-09 | Owner browser terminal reads through CSKEK path | 75-04 | `host-resolver.ts:94-130` CSKEK branch; tests C1-C3 |
| D-10 | Non-substrate hosts unchanged | 75-04 | Explicit `return host` after CSKEK branch; `isSubstrate === false` falls through to unchanged user-DEK path; tests S1-S3 |
| D-11 | Substrate-flag-toggle-off deferred out-of-phase | — | Confirmed deferred; credential stays CSKEK-wrapped, sweep just stops for that host. No implementation gap. |
| D-12 | One-shot operator-run migration script ships in-phase | 75-08 | `scripts/migrate-substrate-credentials.ts` + `src/backend/utils/substrate-credential-migration.ts` exist |
| D-13 | Migration takes per-owner `{userId, password}` as input | 75-08 | CLI reads JSON array of `{userId, password}` from stdin |
| D-14 | Per-host atomicity: unwrap → re-wrap → update | 75-08 | Single `db.update(sshCredentials).set({...}).where(eq(...))` per credential; per-row try/catch means one failure doesn't abort the rest |
| D-15 | Migration retired after ship | 75-08 | Runbook instructs deleting the file post-migration; noted in CLI header comment |
| D-16 | Unit tests for CSKEK wrap/unwrap at host-create and host-update | 75-04 | 11 host.test.ts tests (P1-P6, U1-U5) covering guard behavior; 10 host-resolver.test.ts tests (C1-C3, S1-S3, FC1-FC3, E1) |
| D-17 | Integration test for startup pass | 75-09 | I-STARTUP (2 tests), I-RETRY (1 test) in server-substrate-integration.test.ts (1067 lines, 8 tests total) |
| D-18 | Integration test for on-add trigger | 75-09 | I-ON-ADD (3 tests): timing proof (response < 100ms, sweep delayed), singleton round-trip, non-substrate non-trigger |
| D-19 | Migration script test with fixture DB | 75-08 | 13 tests in substrate-credential-migration.test.ts; H0 passphrase-canary proves full fieldname chain; H1 proves D-19 round-trip |

**All 19 decisions delivered (D-11 is the only deferred item — explicitly scoped out-of-phase by design).**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/distributor/bundled-reader.ts` | Extracted bundledReaderFromDisk | VERIFIED | 1300 bytes; exports `bundledReaderFromDisk`; byte-equivalent to former orchestrator implementation |
| `src/backend/distributor/bundled-reader.test.ts` | 4 unit tests | VERIFIED | 4 tests: success, ENOENT, EACCES, never-throw |
| `src/backend/distributor/server-substrate-orchestrator.ts` | Startup pass + 30s retry + N-failure alerting | VERIFIED | 13359 bytes; `createServerSubstrateOrchestrator` factory; serial `for...of`; `sweepedThisInstance`/`sweepInFlight`/`consecutiveFailures`/`persistentAlertFired` state; `persistentFailureThreshold=3` |
| `src/backend/distributor/server-substrate-orchestrator.test.ts` | 18+ unit tests (D-17, D-18 unit-level) | VERIFIED | 22 tests (S1-S3, R1-R3, G1-G2, F1-F4, NT1-NT2, L1-L3, O1) covering all decisions |
| `src/backend/distributor/log-tags.ts` | `logPersistentFailure` added | VERIFIED | `fleet_substrate_host_persistent_failure` operation tag at line 153 |
| `src/backend/distributor/list-substrate-hosts.ts` | Session-less CSKEK-only enumerator | VERIFIED | CSKEK decrypt via `getCredentialSharingKey` + `FieldCrypto.decryptField`; 0 `getUserDataKey` calls; LEFT JOIN exposes no-credentialId rows for warn+skip |
| `src/backend/distributor/list-substrate-hosts.test.ts` | 13 tests | VERIFIED | 13 tests (H1-H4, N1-N2, F1-F3, NT1-NT2, S1-S2) |
| `src/backend/distributor/substrate-orchestrator-singleton.ts` | set/get/__reset singleton | VERIFIED | 3 exports; 4 tests (SG1-SG4) |
| `src/backend/distributor/server-substrate-integration.test.ts` | 8 integration tests | VERIFIED | 1067 lines; 8 tests (I-STARTUP ×2, I-RETRY ×1, I-PERSISTENT ×2, I-ON-ADD ×3); mocks pushed to DB/SSH/filesystem boundary only |
| `src/backend/database/routes/host.ts` | 400 guard + on-add/on-update triggers | VERIFIED | 400 guard at lines 401-402 (POST) and 1094-1095 (PUT); `queueMicrotask` triggers at POST line 460 and PUT line 1165; both fire AFTER `res.json` |
| `src/backend/database/routes/host.test.ts` | 21 tests | VERIFIED | 11 (75-04) + 10 (75-06) = 21 tests |
| `src/backend/ssh/host-resolver.ts` | CSKEK branch for substrate hosts | VERIFIED | Branch at lines 78-135; explicit `return host` prevents fall-through; fail-closed on CSKEK error (returns null, never user-DEK) |
| `src/backend/ssh/host-resolver.test.ts` | 10 tests | VERIFIED | C1-C3, S1-S3, FC1-FC3, E1 |
| `src/backend/starter.ts` | Substrate orchestrator boot-IIFE wire-in | VERIFIED | Block at line 707; after `serverReady` gate (line 302); `substrateOrch.start().catch(...)` fire-and-forget (grep: 1 `.catch`, 0 `await substrateOrch.start`); SIGTERM cleanup |
| `src/backend/utils/user-crypto.ts` | `deriveDekForMigration` method | VERIFIED | Public method at line 263; PBKDF2 chain (`getKEKSalt` → `getEncryptedDEK` → `deriveKEK` → `decryptDEK`); no `userSessions.set`; `KEK.fill(0)` in finally |
| `src/backend/utils/substrate-credential-migration.ts` | Migration module | VERIFIED | 10197 bytes; pre-check aborts on inline-credential substrate hosts; camelCase decrypt (`"keyPassword"`) + snake_case CSKEK-encrypt (`"key_password"`); `DatabaseSaveTrigger.forceSave` per user batch; DEK zeroed in finally |
| `src/backend/utils/substrate-credential-migration.test.ts` | 13 tests including H0 + SEC1 + SEC2 | VERIFIED | 13 tests; H0 passphrase-canary (full fieldname chain); SEC1 (no plaintext in logs); SEC2 (DEK all-zero after use) |
| `scripts/migrate-substrate-credentials.ts` | Operator CLI entrypoint | VERIFIED | 8458 bytes; stdin JSON input; validates shape before DB init; zeroes password strings from input array post-migration; stdout is result JSON only (no passwords); exit codes 0/1/2 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `starter.ts` | `server-substrate-orchestrator.ts` | `createServerSubstrateOrchestrator` dynamic import + `substrateOrch.start().catch(...)` | WIRED | Lines 707-864 in starter.ts; fire-and-forget confirmed (grep: 1 `.catch`, 0 `await`) |
| `starter.ts` | `substrate-orchestrator-singleton.ts` | `setSubstrateOrchestrator(substrateOrch)` at line 824 | WIRED | Singleton populated at boot |
| `host.ts` POST handler | `substrate-orchestrator-singleton.ts` | `getSubstrateOrchestrator()?.sweepOneHost(...)` inside `queueMicrotask` | WIRED | Line 460; null-checked; fires after `res.json` |
| `host.ts` PUT handler | `substrate-orchestrator-singleton.ts` | `getSubstrateOrchestrator()?.sweepOneHost(...)` inside `queueMicrotask` | WIRED | Line 1165; change-detection via `flagFlippedOn`/`credentialChangedOnSubstrate` |
| `server-substrate-orchestrator.ts` | `list-substrate-hosts.ts` | `listSubstrateHosts` in `ServerSubstrateOrchestratorDeps` | WIRED | Injected via starter.ts wiring; used in startup pass and `sweepOneHost` |
| `host-resolver.ts` | CSKEK path | `SystemCrypto.getCredentialSharingKey()` + `FieldCrypto.decryptField` | WIRED | Lines 78-135; only when `runsFleetSubstrate === true`; explicit return prevents non-substrate hosts from using it |
| `substrate-credential-migration.ts` | `UserCrypto.deriveDekForMigration` | Method call per user entry | WIRED | Import + call at migration loop; sessionless (no `getUserDataKey`) |
| Browser-driven sweep hook | (removed) | — | REMOVED | 0 occurrences of all 6 hook identifiers in ssh-poll-orchestrator.ts |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `server-substrate-orchestrator.ts` | `hosts` (substrate host list) | `listSubstrateHosts(deps)` → Drizzle query `WHERE enableSsh=true AND runsFleetSubstrate=true` | DB query confirmed in list-substrate-hosts.ts | FLOWING |
| `host-resolver.ts` CSKEK branch | `systemPassword`/`systemKey`/`systemKeyPassword` | Direct Drizzle `db.select().from(sshCredentials).where(eq(id, credentialId)).limit(1)` + `FieldCrypto.decryptField` with live CSKEK | Real DB query; CSKEK from `SystemCrypto.getInstance().getCredentialSharingKey()` | FLOWING |
| `substrate-credential-migration.ts` | Per-user credentials | Drizzle join `sshCredentials INNER JOIN hosts WHERE runsFleetSubstrate=true AND userId=userId` | Real DB query; DEK via PBKDF2 from input password | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Check | Result | Status |
|----------|-------|--------|--------|
| `bundledReaderFromDisk` exported from correct module | `grep -c "^export const bundledReaderFromDisk" src/backend/distributor/bundled-reader.ts` | 1 | PASS |
| Orchestrator in ssh-poll-orchestrator.ts is clean of sweep hook | `grep -c "sweepedThisInstance\|runSweepForHost\|FLEET_SUBSTRATE_CATALOG\|logSweepHookError\|bundledReaderFromDisk\|sweepInFlight" src/backend/fleet-status/ssh-poll-orchestrator.ts` | 0 | PASS |
| starter.ts fire-and-forget form | `grep -c "substrateOrch\.start()\.catch"` = 1; `grep -c "await substrateOrch\.start"` = 0 | 1 / 0 | PASS |
| startup pass is serial (no Promise.all) | `grep "Promise\.all" server-substrate-orchestrator.ts` | no match | PASS |
| queueMicrotask fires AFTER res.json in POST handler | Lines 437 (`res.json`) precedes line 460 (`queueMicrotask`) in host.ts | ordering confirmed | PASS |
| CSKEK explicit return (D-10 boundary) | `host-resolver.ts:130` has `return host; // EXPLICIT return — no fall-through` after CSKEK branch | confirmed | PASS |
| Migration never logs passwords | `grep "systemLogger\|databaseLogger" substrate-credential-migration.ts` logs only metadata (userId, credentialId, error.message); no password field in any log call | confirmed | PASS |
| DEK zeroed after migration | `userDEK.fill(0)` in `finally` block in migration module; SEC2 test verifies | confirmed | PASS |
| Migration stdout contains only result JSON | `process.stdout.write(JSON.stringify(result, ...))` only; result shape contains `{preCheck, perUser, aborted}` — no password fields | confirmed | PASS |
| ssh-poll-orchestrator.ts line count matches removal claim | `wc -l` = 2202 | matches 75-07 SUMMARY claim | PASS |
| `deriveDekForMigration` has no `userSessions.set` | method body at lines 263-297 has no `userSessions` reference | confirmed | PASS |

---

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files exist for this phase. Phase produces library/service code, not standalone runnable probes.

---

### Requirements Coverage

All 19 requirements (D-01 through D-19) verified against shipped code. D-11 (substrate-flag-toggle-off) is the only intentionally deferred item — it is out-of-scope by design and does not constitute a gap.

| Requirement | Status | Evidence |
|------------|--------|----------|
| D-01 through D-10 | SATISFIED | See Decision Coverage table above |
| D-11 | DEFERRED (by design) | Explicitly scoped out-of-phase in CONTEXT.md and shape doc |
| D-12 through D-15 | SATISFIED | Migration module + CLI + test exist |
| D-16 through D-19 | SATISFIED | 22 unit tests (75-02) + 21 route tests (75-04/06) + 13 migration tests (75-08) + 5 UserCrypto tests + 8 integration tests (75-09) |

---

### Threat Model Coverage

| Threat | Expected Mitigation | Status | Evidence |
|--------|---------------------|--------|---------|
| Server-KEK blast radius | CSKEK scoped to substrate hosts only; D-10 non-substrate unchanged | VERIFIED | Explicit `isSubstrate` gate in host-resolver; 400 guard prevents inline-cred substrate hosts; tests S1-S3 |
| credentialId-enforcement | API-layer 400 guard rejects inline-credential substrate hosts | VERIFIED | host.ts POST line 401-402; PUT line 1094-1095; tests P1-P3 |
| Migration credential exposure | stdin passwords never logged; result JSON never contains passwords; DEK zeroed after use | VERIFIED | `databaseLogger.warn` calls log only userId/credentialId/error.message; `(entry as any).password = ""` post-migration; `userDEK.fill(0)` in finally; SEC1/SEC2 tests |
| Fire-and-forget error surfacing | 3 independent defenses: microtask ordering + null-check + try/catch inside microtask | VERIFIED | Tests T3/T4/T5 (POST) and T6-T10 (PUT) prove no error surface to HTTP response |
| `runSweepForHost` never-reject | try/catch around every call site; defense-in-depth documented | VERIFIED | Tests NT1/NT2 in orchestrator unit tests; I-ON-ADD proves no unhandledRejection |

---

### Anti-Patterns Found

| File | Pattern | Severity | Assessment |
|------|---------|---------|------------|
| None found | — | — | No TBD/FIXME/XXX in any Phase 75 shipped file. No return-null/return-[]/return-{} stub patterns in rendering paths. No hardcoded empty data in wired artifacts. |

---

### Human Verification Required

None. All must-haves are verifiable via code inspection and grep. No visual UI, no external service integration, no real-time behavior requiring human observation is part of this phase's deliverables.

---

### Gaps Summary

No gaps. All 8 observable truths verified, all 18 non-deferred decisions delivered, all key links wired, all threat model mitigations present in shipped code, no debt markers found.

---

## Specific Verification Findings (Adversarial Checks)

The following are the targeted checks from the verification focus — each verified against actual codebase, not SUMMARY claims.

**"4 imports removed from ssh-poll-orchestrator.ts in 75-07 genuinely not referenced elsewhere in the file":**
- `grep -c "runSweepForHost|logSweepHookError|bundledReaderFromDisk|FLEET_SUBSTRATE_CATALOG" ssh-poll-orchestrator.ts` = 0
- Zero distributor imports remain in the file
- VERIFIED

**"starter.ts wire-in is fire-and-forget (.catch chain, no await)":**
- `grep -c "substrateOrch\.start()\.catch" starter.ts` = 1
- `grep -c "await substrateOrch\.start" starter.ts` = 0
- Code at starter.ts:840: `substrateOrch.start().catch((err) => { systemLogger.warn(...) })`
- VERIFIED

**"host.ts on-add trigger fires AFTER res.json (post-response)":**
- `res.json(resolvedHost)` at line 437; `queueMicrotask(async () => {...})` at line 460
- Comment at line 448: "the HTTP response has ALREADY been sent (res.json above); the microtask runs after the response resolves"
- VERIFIED

**"Migration script never echoes owner passwords / DEK material to stdout/logs":**
- stdout path: `process.stdout.write(JSON.stringify(result, null, 2) + "\n")` where `result` is `{preCheck, perUser, aborted}` — no password fields
- Log calls: all `databaseLogger.warn` calls include only `userId`, `credentialId`, `hostId`, `error: err.message` — no password or key material
- Input passwords zeroed after use: `(entry as any).password = ""`
- VERIFIED

**"Substrate host credentials genuinely CSKEK-wrapped end-to-end (no user-DEK path for substrate)":**
- `list-substrate-hosts.ts`: 0 calls to `getUserDataKey`; 7 calls to `getCredentialSharingKey`/`decryptField`
- `host-resolver.ts`: CSKEK branch reads `systemPassword`/`systemKey`/`systemKeyPassword` only when `isSubstrate=true`
- `SimpleDBOps.insert` for `ssh_credentials` tableName already writes CSKEK columns (verified in simple-db-ops.ts:32-44)
- 400 guard at API boundary prevents inline-credential substrate hosts from being created
- VERIFIED

---

_Verified: 2026-09-06T04:00:00Z_
_Verifier: Claude (gsd-verifier)_
