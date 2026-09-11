---
phase: 99-spawn-request-watcher-skynet-side-noticing-of-coord-dropped-
verified: 2026-09-10T06:20:00Z
status: passed
score: 22/22 must-haves verified
overrides_applied: 0
re_verification: null
gaps: []
deferred: []
human_verification: []
---

# Phase 99: spawn-request-watcher Verification Report

**Phase Goal:** Extend Skynet's fleet-status per-host sweep with atomic observation-and-claim of coordinator-dropped request files at `~/fleet/spawn-requests/<uuid>.json`; back with an in-memory queue + async birth-worker that invokes the existing identity-birth flow (Tina's Phase 77) with role + task; drop success/failure response files back on the requesting host keyed by the same uuid.

**Verified:** 2026-09-10T06:20:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                     | Status     | Evidence                                                                                                      |
|----|-------------------------------------------------------------------------------------------|------------|---------------------------------------------------------------------------------------------------------------|
| 1  | PendingBirth objects can be enqueued into an in-memory queue (D-06)                       | ✓ VERIFIED | `queue.ts`: module-level `const pending: PendingBirth[] = []`; `enqueue()` pushes to it; no DB/persist       |
| 2  | A serialized worker drains the queue one item at a time (never concurrent) (D-07)         | ✓ VERIFIED | `queue.ts:78`: `workerPromise = workerPromise.then(() => drainOne())`; Test 3 confirms serialization          |
| 3  | PendingBirth carries {role, task, requested_at, hostId, hostIdNum, uuid, userId} (D-08)  | ✓ VERIFIED | `types.ts:27-35`: exact 7-field interface; `hostIdNum: number` separate from `hostId: string`                 |
| 4  | Worker invokes birthIdentity with role + task + host-owner-userId via direct db.select    | ✓ VERIFIED | `worker.ts:173-186`: `getHostOwnerUserId` queries `hosts.userId` directly; `worker.ts:358-370`: BirthOptions  |
| 5  | On birth success, success JSON written to `$HOME/fleet/spawn-requests/<uuid>.success.json` | ✓ VERIFIED | `worker.ts:270`: `const targetPath = \`$HOME/fleet/spawn-requests/\${item.uuid}.\${kind}.json\``; Test 11    |
| 6  | On birth failure, failure JSON written to `$HOME/fleet/spawn-requests/<uuid>.failure.json` | ✓ VERIFIED | `worker.ts:291-302`: `writeFailureFile` calls `writeResponseFile` with kind="failure"; Tests 12-16            |
| 7  | Response files land in SAME folder as request (~/fleet/spawn-requests/) keyed by uuid    | ✓ VERIFIED | `worker.ts:270`: path literal `$HOME/fleet/spawn-requests/`; no alternate path in code                        |
| 8  | Response file write via `writeMarkdownFileAtomic` (NOT `writeIdentityFile`) (D-12)        | ✓ VERIFIED | `worker.ts:271`: `await deps.writeMarkdownFileAtomic(conn, targetPath, body)`; grep returns 0 for writeIdentityFile |
| 9  | Failure reason=="malformed" includes message; other reasons absent-or-terse (D-10)        | ✓ VERIFIED | `parseRequestBody` returns descriptive message; `writeFailureFile` passes `{reason}` only for non-malformed   |
| 10 | Request-file body: extra fields (coord_mxid, priority etc.) rejected as malformed (D-05) | ✓ VERIFIED | `parseRequestBody` only extracts `role`, `task`, `requested_at`; extra fields silently ignored; role/task/requested_at strictly validated |
| 11 | New backend module at src/backend/spawn-requests/ with types + queue + worker (D-18)     | ✓ VERIFIED | All 5 files exist: types.ts, queue.ts, queue.test.ts, worker.ts, worker.test.ts                                |
| 12 | Wire types live in types.ts as internal-to-backend contracts (D-19)                      | ✓ VERIFIED | `types.ts`: 5 exports; no frontend imports of this file in codebase                                           |
| 13 | identity-birth-orchestrator.ts UNCHANGED (D-20)                                           | ✓ VERIFIED | `git diff --stat src/backend/database/routes/identity-birth-orchestrator.ts` shows no output                  |
| 14 | No automatic retry anywhere in the worker (D-15)                                          | ✓ VERIFIED | grep for `retry` returns 0 in worker.ts; `writeFailureFile` logs and returns, no loop                         |
| 15 | Unit tests cover parseRequestBody, queue module, birth-worker (D-21)                     | ✓ VERIFIED | 5 queue tests + 20 worker tests; `npx vitest run --project backend src/backend/spawn-requests/` = 25 passed   |
| 16 | Fleet-status pollOneHost gains atomic read-and-delete exec step per tick (D-01 + D-02)   | ✓ VERIFIED | `ssh-poll-orchestrator.ts:1056`: `scanSpawnRequests(host, channel)` inside pollOneHost after pollDormantOnlyIdentities |
| 17 | Atomic exec uses mv-claim + UUID-length filter to skip response files (D-02 + Pitfall 7) | ✓ VERIFIED | `SPAWN_REQUESTS_SCAN_CMD:846-856`: `mv "$f" "$tmp"` + `[ ${#base} -eq 36 ]` length guard; TS UUID_RE double-check |
| 18 | Missing ~/fleet/spawn-requests folder returns empty result, not error (D-03)              | ✓ VERIFIED | Shell: `cd ~/fleet/spawn-requests 2>/dev/null || exit 0`; TS: `if (!stdout.trim()) return []`                  |
| 19 | enqueueSpawnRequest is OPTIONAL on OrchestratorDeps (Pitfall 5 backward-compat)          | ✓ VERIFIED | `ssh-poll-orchestrator.ts:112`: `enqueueSpawnRequest?: (item: PendingBirth) => void`; existing 128 tests pass  |
| 20 | starter.ts wires enqueue + setProcessBirth at orchestrator construction time              | ✓ VERIFIED | `starter.ts:702-703`: `setSpawnRequestProcessBirth` called at line 703, `createSshPollOrchestrator` at line 705 |
| 21 | Integration tests: 8 new scan tests cover atomic exec, fail-open, UUID filter, enqueue   | ✓ VERIFIED | `describe("spawn-request scan (Phase 99)")` at line 7221 in test file; 136 total tests pass                    |
| 22 | No push, no docker, no full-suite test during executor's remit (D-23)                    | ✓ VERIFIED | SUMMARY-02 self-attest; git log shows only feat/test/docs commits; no deploy markers in commits                |

**Score:** 22/22 truths verified

---

### D-XX Decisions Walkthrough

| Decision | Status | Evidence |
|----------|--------|----------|
| D-01: Piggyback on fleet-status sweep, no new subsystem | ✓ | Extension in `ssh-poll-orchestrator.ts:1049-1059` |
| D-02: Single atomic read-and-delete exec per tick | ✓ | `SPAWN_REQUESTS_SCAN_CMD` with `mv` claim; one `channel.exec()` call |
| D-03: Missing folder not an error | ✓ | `cd ... 2>/dev/null || exit 0`; TS `!stdout.trim() return []` |
| D-04: Request schema {role, task, requested_at} | ✓ | `types.ts:16-20`; `parseRequestBody` validates exactly these 3 fields |
| D-05: No coord_mxid, no target-host, no priority/ordinal/retry | ✓ | Not in `SpawnRequestBody`; accepted test confirms extra fields ignored |
| D-06: In-memory queue, no persistent backing | ✓ | `queue.ts`: `const pending: PendingBirth[] = []`; no DB imports |
| D-07: Worker concurrency = 1 (serialized) | ✓ | Promise-chain: `workerPromise.then(() => drainOne())`; Test 3 serial assert |
| D-08: PendingBirth carries parsed contents + sweep metadata | ✓ | `types.ts:27-35`; `parseSpawnRequestBatch` builds items with hostId/hostIdNum/uuid/userId |
| D-09: Success response {name, mxid, birthed_at} at <uuid>.success.json | ✓ | `types.ts:41-45`; `worker.ts:452-456`; Test 11 |
| D-10: Failure response {reason, message?}; malformed gets message | ✓ | `types.ts:51-68`; 6-value enum; `parseRequestBody` includes message; others terse |
| D-11: Response in SAME folder as request | ✓ | `$HOME/fleet/spawn-requests/${uuid}.${kind}.json` — no separate folder |
| D-12: Response write via SFTP (writeMarkdownFileAtomic) | ✓ | `worker.ts:265-278`: `connectOneShot` + `writeMarkdownFileAtomic` |
| D-13: Response cleanup is coordinator's job [informational, no Skynet-side must_have] | N/A | Correctly out-of-scope; no auto-reaper code present |
| D-14: userId = host-owner from direct Drizzle query | ✓ | `worker.ts:173-187`: `getHostOwnerUserId` with `.select({ userId: hosts.userId })` |
| D-15: No automatic retry anywhere | ✓ | `writeFailureFile` logs and returns; no retry loop; grep confirms 0 retry references |
| D-16: Coord-side safety timeout [informational, no Skynet-side must_have] | N/A | Correctly out-of-scope; set at 3 min in coord-instructions prose per RESEARCH |
| D-17: Extension to ssh-poll-orchestrator.ts only | ✓ | Only orchestrator.ts, orchestrator.test.ts, starter.ts modified in Plan 02 |
| D-18: New module at src/backend/spawn-requests/ | ✓ | 5 files created |
| D-19: Wire types internal-to-backend | ✓ | types.ts exports 5 types; no frontend import |
| D-20: identity-birth-orchestrator.ts UNCHANGED | ✓ | `git diff --stat` returns empty; `git log` shows no orchestrator commits in phase |
| D-21: Unit tests for parser, queue, worker | ✓ | 25 tests passing |
| D-22: End-to-end wire test | ✓ | Orchestrator Test 4 (enqueue correct PendingBirth) + orchestrator Test 7 (multi-file) + worker Tests 11-20 |
| D-23: No push/docker/force-recreate | ✓ | Self-attested in SUMMARY-02; git log confirms boundary respected |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/spawn-requests/types.ts` | SpawnRequestBody, PendingBirth, SuccessResponse, FailureResponse, FailureReason | ✓ VERIFIED | All 5 exported; 6-value FailureReason union |
| `src/backend/spawn-requests/queue.ts` | enqueue, isEmpty, setProcessBirth, __resetForTests + Promise-chain | ✓ VERIFIED | All 4 exported; workerPromise.then pattern; drainOne loop |
| `src/backend/spawn-requests/queue.test.ts` | 5 queue tests | ✓ VERIFIED | 5/5 passing |
| `src/backend/spawn-requests/worker.ts` | parseRequestBody, mapEndedEventToReason, processBirth, buildProductionDeps, WorkerDeps | ✓ VERIFIED | All 6 identifiers exported; birthIdentity (not runIdentityBirthOrchestrator) |
| `src/backend/spawn-requests/worker.test.ts` | 20 worker tests | ✓ VERIFIED | 20/20 passing |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | scanSpawnRequests, parseSpawnRequestBatch, enqueueSpawnRequest? on OrchestratorDeps | ✓ VERIFIED | Both functions exported at module scope; optional field added at line 112 |
| `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | 8 new scan tests | ✓ VERIFIED | describe("spawn-request scan (Phase 99)") at line 7221; 136 total tests pass |
| `src/backend/starter.ts` | enqueue + setProcessBirth wiring | ✓ VERIFIED | Imports at lines 17-18; wiring at lines 702-703, 733 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `worker.ts` | `identity-birth-orchestrator.ts` | `import { birthIdentity, ... }` | ✓ WIRED | Line 25 of worker.ts; grep returns 1 match |
| `worker.ts` | `identity-artifact-reader.ts` | `import { writeMarkdownFileAtomic, isLocalHostId }` | ✓ WIRED | Line 23 of worker.ts; writeMarkdownFileAtomic used in writeResponseFile |
| `worker.ts` | `schema.ts` | `getDb().select({ userId: hosts.userId }).from(hosts).where(eq(hosts.id, hostIdNum))` | ✓ WIRED | Lines 174-177; direct Drizzle query confirmed |
| `queue.ts` | `worker.ts` | `setProcessBirth(fn)` inversion | ✓ WIRED | Circular import avoided; starter.ts injects the binding |
| `ssh-poll-orchestrator.ts` | `spawn-requests/types.ts` | `import type { PendingBirth, SpawnRequestBody }` | ✓ WIRED | Line 55 of orchestrator |
| `starter.ts` | `spawn-requests/queue.ts` | `import { enqueue as enqueueSpawnRequest, setProcessBirth }` | ✓ WIRED | Line 17 of starter.ts |
| `starter.ts` | `spawn-requests/worker.ts` | `import { processBirth, buildProductionDeps }` | ✓ WIRED | Line 18 of starter.ts |
| `pollOneHost` | `scanSpawnRequests` | `const spawnBatch = await scanSpawnRequests(host, channel)` | ✓ WIRED | Line 1056 of orchestrator; after pollDormantOnlyIdentities, before poll-end log |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `queue.ts` | `pending: PendingBirth[]` | `enqueue(item)` push from sweep | Yes — populated by sweep execs | ✓ FLOWING |
| `worker.ts` / `processBirth` | `pool` from `deps.getVettedPool()` | `pool-loader.ts` (production wiring) | Yes — reads pool.json at runtime | ✓ FLOWING |
| `worker.ts` / `processBirth` | `creds` from `deps.getMatrixAdminCreds()` | `matrix-admin-creds-store.ts` | Yes — reads stored creds | ✓ FLOWING |
| `worker.ts` / `processBirth` | `currentUserId` from `getHostOwnerUserId(hostIdNum)` | Direct Drizzle query on `hosts` table | Yes — DB query not mocked in production | ✓ FLOWING |
| `worker.ts` / `writeResponseFile` | response file body | JSON.stringify of SuccessResponse / FailureResponse | Yes — real data from birthIdentity ended event | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| spawn-requests 25 tests pass | `npx vitest run --project backend src/backend/spawn-requests/` | 25 passed (2 test files) | ✓ PASS |
| orchestrator 136 tests pass (128 existing + 8 new) | `npx vitest run --project backend src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | 136 passed | ✓ PASS |
| identity-birth-orchestrator.ts unchanged | `git diff --stat src/backend/database/routes/identity-birth-orchestrator.ts` | (empty) | ✓ PASS |
| identity-birth.ts unchanged | `git diff --stat src/backend/database/routes/identity-birth.ts` | (empty) | ✓ PASS |
| No new npm packages | `git diff package.json package-lock.json | wc -l` | 0 | ✓ PASS |

---

### RESEARCH.md Pitfalls — Code Coverage

All 8 documented pitfalls are addressed in the shipped code:

| Pitfall | Description | Code Evidence |
|---------|-------------|---------------|
| P1: per-identity-file.ts whitelist blocks response writes | Use writeMarkdownFileAtomic, not writeIdentityFile | `worker.ts:23` imports `writeMarkdownFileAtomic`; 0 references to `writeIdentityFile` or `per-identity-file` |
| P2: hostId type mismatch (HostRecord.id is string, BirthOptions.hostId is number) | Store hostIdNum separately | `types.ts:29`: `hostIdNum: number`; `worker.ts:360`: `hostId: item.hostIdNum` |
| P3: resolveHostById fails without prior userId | Use direct Drizzle select | `worker.ts:174-177`: `getDb().select({ userId: hosts.userId }).from(hosts).where(eq(hosts.id, hostIdNum))` |
| P4: birthIdentity not runIdentityBirthOrchestrator | Import birthIdentity | `worker.ts:25`: `import { birthIdentity, ... } from "../database/routes/identity-birth-orchestrator.js"`; 0 references to runIdentityBirthOrchestrator |
| P5: OrchestratorDeps extension breaks 7207-line test file | Optional field + default buildDeps response | `orchestrator.ts:112`: `enqueueSpawnRequest?:` optional; buildDeps default `setResponse("fleet/spawn-requests", "")` |
| P6: sftp.rename not atomic (need ext_openssh_rename) | Use writeMarkdownFileAtomic | `worker.ts:271`: `deps.writeMarkdownFileAtomic(conn, targetPath, body)` wraps ext_openssh_rename internally |
| P7: Double-observation if read/delete split into two execs | Atomic mv-claim in single exec | `SPAWN_REQUESTS_SCAN_CMD:851-853`: `mv "$f" "$tmp" 2>/dev/null || continue` — atomic claim |
| P8: Response path uses wrong folder (fleet/identities vs fleet/spawn-requests) | Path literal in writeResponseFile | `worker.ts:270`: `$HOME/fleet/spawn-requests/`; 0 references to `fleet/identities` in worker.ts |

---

### Requirements Coverage

No REQ-IDs declared in plan frontmatter (`requirements: []`). Phase 99 is a new capability phase — no existing requirements tracked against it. All 22 observable truths satisfy the D-XX decisions which are the phase's requirement contract.

---

### Anti-Patterns Found

Scan of all 5 new source files and 3 modified files for debt markers and stubs:

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| All new files | No TBD/FIXME/XXX found | — | None |
| All new files | No `return null` / `return []` stubs found in production paths | — | None |
| `worker.ts` | `return null` in `getHostOwnerUserId` (only when host not found) | Info | Not a stub — this is the correct not-found sentinel; worker drops `birth_failed` and continues |
| `queue.ts` | `processBirthFn = null` initial state | Info | Not a stub — this is the DI seam before `setProcessBirth` is called; drainOne's `while (pending.length > 0 && processBirthFn)` guard handles it |

No blockers or warnings identified.

Standing directive check — structured logs at state transitions:
- `queue.ts`: 3 systemLogger calls (enqueued, drain-start, drain-error)
- `worker.ts`: 10+ systemLogger calls (worker-start, host-owner-lookup, pool/creds/host pre-flight, birth-event, unexpected-throw, no-ended-event, birth-success, response-dropped, response-host-not-found, response-write-failed, writing-failure)
- `ssh-poll-orchestrator.ts`: spawn_request_scan_complete + spawn_scan_ssh_error added

No message streaming found — response files are atomic writes; no EventSource / SSE / stream references.

---

### Human Verification Required

None. All deliverables are programmatically verifiable. The phase produces backend TypeScript only (no UI, no visual output, no real-time behavior). Test coverage of all behavioral paths verified by running 161 scoped tests (25 + 136).

---

## Gaps Summary

No gaps. All 22 must-have truths verified. All 23 D-XX decisions realized (D-13 and D-16 correctly marked [informational] with no Skynet-side must_have, as specified in CONTEXT.md). All 8 RESEARCH pitfalls addressed in shipped code. identity-birth-orchestrator.ts unchanged. Executor's remit boundary respected (no push, no docker, no full-suite run). No new npm packages.

---

_Verified: 2026-09-10T06:20:00Z_
_Verifier: Claude (gsd-verifier)_

---

## Post-verification: Unbiased Code Review Outcome

Ran a fresh general-purpose sub-agent code review against the shipped source
files with instructions to explicitly NOT read plans / must_haves / SUMMARY
files (guard against confirmation bias). Found real bugs the verifier PASS
missed — verifier checked plan-contract satisfaction (all 22 must_haves
realized) but did not audit for correctness bugs outside must_haves.

**Findings + fixes applied** (`fix(99-cr):` commit `f4ee4856` + coord-instructions
commit `80a748b6`):

| ID | Severity | Issue | Fix |
|----|----------|-------|-----|
| M1 | Medium | `mapEndedEventToReason` dead-code for `homeserver_unreachable` + `role_unknown` (emit callback discarded step:failed reasons; all failures collapsed to `birth_failed`) | Emit callback captures last `step:failed` reason; `mapEndedEventToReason` takes reason as 2nd arg |
| M2 | Medium | Malformed JSON silently dropped in sweep — coord stranded until safety timeout | Sweep calls full `parseRequestBody`; on failure enqueues with `malformedReason`; worker short-circuits and drops `{reason:"malformed", message}` failure file |
| M3 | Medium | Missing/invalid role collapsed to `birth_failed` instead of `malformed` | Same fix as M2 — sweep-time validation catches role-pattern violations |
| H1 | High | Success response `mxid` had port embedded (`@willow:thenasty:8008`) | Dropped `mxid` field entirely per H2 |
| H2 | High | Success response `mxid` localpart was pool key not derived MXID; orchestrator's ended event doesn't surface it | Dropped `mxid` from `SuccessResponse` — coord uses `name` for dispatch; directory-search resolves name → mxid when needed |
| L1 | Low | worker.test.ts mock used non-existent MatrixAdminCreds field names | Corrected to real shape |
| L2 | Low (cross-shape) | Shape 4 coord-instructions described coord watching for request-file deletion as "birth complete" — actual has request deleted at sweep-claim, response file dropped later | Rewrote § Wait for the response file / § Act on the response to describe the paired response-file protocol |
| L3 | Low | `drainOne` logged "drain start" when queue empty | Early-return when pending empty |
| L4 | Info | Coord instructions didn't include `requested_at` in request-file body spec | Added ISO-Z `requested_at` field (L2 commit) |

**Test result:** 165 tests pass (5 queue + 22 worker + 138 orchestrator, with 2
new fix-driven cases). identity-birth-orchestrator.ts UNCHANGED (D-20 re-verified).

**Verifier gap noted for future phases:** The verifier's "plan contract satisfied"
check does not detect bugs outside plan must_haves. Consider adding an unbiased
code-review sub-agent as a standing gate — this pattern is now confirmed twice
on this campaign (Phase 96's D-15 audit + Phase 99's code-review fixups).

_Code-review-fixup applied: 2026-09-10T06:22:00Z_
