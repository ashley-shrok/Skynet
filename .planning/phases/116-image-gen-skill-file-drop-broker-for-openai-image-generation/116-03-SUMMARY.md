---
phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation
plan: 03
subsystem: infra
tags: [image-gen, worker-pool, scan-orchestrator, sftp-atomic, backend, wiring]

# Dependency graph
requires:
  - phase: 99-spawn-request-watcher-skynet-side-noticing-of-coord-dropped-
    provides: file-drop broker (queue, worker, scan-orchestrator) pattern Phase 116 clones
  - phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation
    plan: 01
    provides: Wave-1 leaves (types, parse-request-body, token-bucket, adapter) consumed here
provides:
  - image-gen-requests/queue.ts — 5-worker pool with FIFO waiter list, WORKER_COUNT=5 constant (D-20), drain-error containment
  - image-gen-requests/worker.ts — processImageGen with malformed-shortcut → TTL-at-dequeue (D-22 Pitfall 5) → token acquire → adapter → PNGs-before-JSON drop
  - image-gen-requests/scan-orchestrator.ts — always-on IMAGE_GEN_SCAN_CMD tick + parseImageGenRequestBatch + companion-fetch, ZERO ssh-poll-orchestrator imports
  - identity-artifact-reader.ts::writeBinaryFileAtomic (public export) — atomic binary tmp+rename with LOCAL and REMOTE branches
  - starter.ts image-gen boot block — SKYNET_IMAGE_GEN_RPM → single tokenBucket → setWorkerDeps → setProcessImageGen → startPool → createImageGenScanOrchestrator (mirrors spawn-scan block at L1058-1184)
affects: 116-04 (helper script + skill body distribution — separate ship surface)

# Tech tracking
tech-stack:
  added: []  # zero new npm deps
  patterns:
    - "5-worker FIFO pool with direct waiter hand-off (waiters shift on enqueue instead of shift+reshift dance)"
    - "TTL-at-dequeue-not-scan (Pitfall 5) — worker compares deps.now() vs Date.parse(requested_at) + 5*60*1000; expired items drop failure.json with reason:'expired' and NEVER acquire a token"
    - "PNGs-before-JSON commit order (Pitfall 3 response side) — worker writes N binary files first, success.json last, so a caller polling for .success.json as the completion signal never sees a half-written state"
    - "Single-connection response drop — worker opens one connectOneShot for all N PNGs + 1 JSON in the REMOTE branch, avoiding N+1 round trips"
    - "Companion-ref two-exec fetch — scan-orchestrator does the main mv-claim scan, then per-item cat|base64 on the same channel; binary payload doesn't pollute the tab-separated main scan parser"
    - "Fully-decoupled scan-orchestrator — locally-defined SshChannel interface + no ssh-poll-orchestrator import (Q2 invariant), so lifecycles never contaminate"
    - "Boot-time-singleton token bucket wired via WorkerDeps injection — one createTokenBucket call in starter.ts, one instance shared across all 5 worker loops, so RPM cap applies fleet-wide"

key-files:
  created:
    - src/backend/image-gen-requests/queue.ts
    - src/backend/image-gen-requests/queue.test.ts
    - src/backend/image-gen-requests/worker.ts
    - src/backend/image-gen-requests/worker.test.ts
    - src/backend/image-gen-requests/scan-orchestrator.ts
    - src/backend/image-gen-requests/scan-orchestrator.test.ts
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts (add writeBinaryFileAtomic public export ~95 LOC after private sftpWriteBinaryAtomic)
    - src/backend/starter.ts (add ~170 LOC image-gen boot block immediately after spawn-scan block at L1184)

key-decisions:
  - "writeBinaryFileAtomic is a FULL LOCAL+REMOTE wrapper (not a small delegator). The REMOTE branch delegates to the existing private sftpWriteBinaryAtomic — but the LOCAL branch is a full implementation mirroring writeMarkdownFileAtomic's fleet-root/os.homedir() resolution + fs.writeFile(tmp)+rename+cleanup, because the private sftpWriteBinaryAtomic has no LOCAL branch of its own. Log tag is `image_gen_binary_write` for grep-ability."
  - "Companion-fetch uses a SECOND channel.exec with cat|base64, not batched into the main scan. Rationale: the main scan's tab-separated stdout parser was not designed for binary content, and interleaving binary bytes + newlines would break the parser. Sequential cost is negligible (N companion fetches × ~1KB base64 round-trip per tick vs the scan itself)."
  - "WorkerDeps interface lives in worker.ts and queue.ts imports it as TYPE ONLY. This is the opposite direction from Phase 99 (where the queue defines the deps shape) — Phase 116's queue holds the deps opaquely (never inspects fields) but the type name lives in worker.ts because that's where the deps' shape is authoritative. Type-only import (erased at runtime) prevents any transitive graph pollution."
  - "SshChannel is redeclared locally in scan-orchestrator.ts (byte-shape-identical to ssh-poll-orchestrator.ts:102's export). This satisfies the RESEARCH.md Q2 invariant that scan-orchestrator does NOT import from ssh-poll-orchestrator AT ALL — even type-only imports would violate the literal grep-based `<done>` invariant in the plan. Deduplicating the type is a 2-line cost; full decoupling is worth it."
  - "starter.ts boot block sits IMMEDIATELY AFTER the spawn-scan block at L1184 (post-edit L1185+). Structural mirror: dynamic imports, own hostClients map, own acquireChannel/releaseChannel closures reusing getHostSemaphore, fire-and-forget start(), SIGTERM cleanup. New in image-gen block vs spawn-scan: reads SKYNET_IMAGE_GEN_RPM at boot, creates the singleton tokenBucket, wires setWorkerDeps + setProcessImageGen + startPool BEFORE createImageGenScanOrchestrator (invariant: worker pool must be draining before the orch enqueues its first item)."
  - "REF_PATTERN embedded uuid == request uuid check is STILL deferred (not implemented in this plan). Plan 01's parser enforces the ref filename SHAPE; Plan 03's scan-orchestrator does NOT additionally check that the embedded uuid matches the request's own uuid. Rationale: the T-116-01-06 threat register entry marks this as PARTIAL — enforcing it here would require plumbing the request's uuid into parseImageGenRequestBatch's per-item scope (already available via the outer loop but the parser currently ignores its _uuid arg). Left for a small follow-up if the threat surface warrants it; parser + scan-orch shape check together prevent path-traversal already."
  - "TTL check uses `deps.now()` (test-injectable) not raw `Date.now()`. The done criteria explicitly requires this — verified by grep `deps.now()` returns 4 hits inside worker.ts. TTL comparison: `deps.now() > Date.parse(item.body.requested_at) + IMAGE_GEN_TTL_MS` where IMAGE_GEN_TTL_MS = 5 * 60 * 1000 (exported constant)."
  - "tsc-narrow workaround (`result.ok === true`) applied in three places: worker.ts adapter-result branch, scan-orchestrator.ts fetchCompanionRef result branch. Same tsc 6.0.3 discriminated-union narrowing quirk documented in Plan 01 SUMMARY.md and spawn-requests/parseSpawnRequestBatch. `if (result.ok)` and `if (!result.ok)` both fail to narrow under this codebase's strict build settings; explicit `=== true` works."

patterns-established:
  - "Full waves of the image-gen subsystem are now wired end-to-end: request file lands → scan claims → PendingImageGen enqueued → 5-worker pool dequeues → TTL check → token acquire → adapter call → response drop. All modules use dep injection + WorkerDeps wiring, so future integration tests can drive the whole subsystem with mock fetch + mock listSubstrateHosts + mock acquireChannel + mock isLocalHostId."
  - "Type-only cross-module imports as circular-dependency dissolvent — queue.ts imports WorkerDeps as `import type` from worker.ts (erased at runtime), avoiding a real runtime import that would drag the worker's transitive graph (adapter → fetch) into queue.test.ts's module surface."

requirements-completed: []

# Metrics
duration: ~14min
completed: 2026-09-18
---

# Phase 116 Plan 03: Wave-2 subsystem wiring — queue + worker + scan + starter Summary

**End-to-end image-gen file-drop broker is now wired: 5-worker pool with FIFO waiter hand-off + TTL-at-dequeue + boot-time-singleton token bucket + always-on scan orchestrator with atomic-mv claim + companion-ref fetch + PNGs-before-JSON response drop — 100 vitest cases green across 7 files, tsc clean, starter.ts boot block instantiates the whole stack from a single SKYNET_IMAGE_GEN_RPM env read.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-09-18T01:07:03Z
- **Completed:** 2026-09-18T01:21:09Z
- **Tasks:** 3 (all TDD, all green)
- **Files created:** 6 (3 source + 3 test)
- **Files modified:** 2 (identity-artifact-reader.ts +1 export; starter.ts +1 boot block)

## Accomplishments

- **5-worker FIFO pool with direct waiter hand-off (queue.ts).** WORKER_COUNT=5 named constant (D-20 grep-able). `dequeueBlocking()` returns pending head immediately or parks on a Promise the next `enqueue()` resolves directly (no shift-and-reshift, no polling). Drain-error containment: a throwing processImageGenFn is caught + warn-logged; the loop continues. `startPool()` is idempotent — double-call does not double the loop count. `stopPool()` sets stopped=true; parked waiters stay parked until process exit (matches Phase 99 D-06 in-memory-only invariant).
- **TTL-at-dequeue worker with PNGs-before-JSON drop (worker.ts).** processImageGen 7-step flow (log → malformed shortcut → TTL check → token acquire → adapter → success or failure drop). TTL check compares `deps.now()` (injectable) vs `Date.parse(item.body.requested_at) + 5*60*1000` — expired items drop `failure.json {reason:"expired"}` and NEVER acquire a token, NEVER call adapter. Success path writes N binary PNGs FIRST (per-index filenames tracked as they land), then success.json LAST — the caller polls for `.success.json` so this commit order guarantees no half-written visibility. Single connectOneShot connection covers all N+1 writes on the REMOTE branch.
- **Always-on scan orchestrator with atomic mv-claim + companion fetch (scan-orchestrator.ts).** IMAGE_GEN_SCAN_CMD byte-for-byte mirror of ssh-poll-orchestrator.ts:1198-1208 with folder swap. UUID length guard (`[ ${#base} -eq 36 ]`) rejects `.success.json` / `.failure.json` / `.ref.png` files at the shell level. Parser uses Plan 01's parseRequestBody (D-06 explicit-reject KNOWN_KEYS runs there). Companion-fetch loop: per-item with `body.ref` set, run a second `channel.exec("cat ... | base64 -w0")`, decode, attach as `refImage`; fetch failure sets `malformedReason` so the worker drops a proper malformed failure. Per-host in-flight guard (wilma pattern) prevents SSH session pileup on slow hosts. Locally-declared SshChannel type + zero ssh-poll-orchestrator import (RESEARCH.md Q2 invariant literal grep = 0).
- **Public writeBinaryFileAtomic export in identity-artifact-reader.ts.** Full wrapper with both branches. LOCAL branch mirrors writeMarkdownFileAtomic's fleet-root/$HOME resolution + fs.writeFile(tmp)+rename+cleanup-on-error (Buffer instead of UTF-8 string). REMOTE branch delegates to the existing private sftpWriteBinaryAtomic (which handles the SFTP tmp+ext_openssh_rename atomic overwrite). Log tag `image_gen_binary_write` grep-able for on-call debugging. All 820 pre-existing claude-session tests still green.
- **starter.ts boot wiring — one env read spawns the whole subsystem.** ~170 LOC block immediately after the spawn-scan block at L1184: dynamic imports, `Math.max(1, parseInt(process.env.SKYNET_IMAGE_GEN_RPM ?? "30", 10) || 30)` → single `createTokenBucket(rpm)` → `buildProductionDeps(tokenBucket)` → `setWorkerDeps` → `setProcessImageGen` → `startPool` (5 loops now draining) → own imageGenScanHostClients map + acquireChannel/releaseChannel closures reusing `getHostSemaphore` → `createImageGenScanOrchestrator(...)` with fire-and-forget start + SIGTERM cleanup. Boot sequence in principle: 1 token bucket → 5 worker loops → 1 scan orchestrator → SIGTERM cleanup wired.

## Task Commits

1. **Task 1: queue.ts + queue.test.ts + writeBinaryFileAtomic export (+ worker.ts type stub)** — `7b857c46` (feat)
2. **Task 2: worker.ts full implementation + worker.test.ts** — `763144cf` (feat)
3. **Task 3: scan-orchestrator.ts + scan-orchestrator.test.ts + starter.ts wiring** — `73a42389` (feat)

_TDD note: this plan used the "TDD-style" flow (test + implementation written together per task, then verified green in one commit) rather than strict RED-then-GREEN separate commits — same interpretation as Plan 01. All behaviour listed in each task's `<behavior>` block is covered by the accompanying `.test.ts` file and all tests were run against the implementation before commit._

## Files Created/Modified

**Created (6):**
- `src/backend/image-gen-requests/queue.ts` (243 LOC) — 5-worker pool, FIFO waiter list, drain-error containment, WORKER_COUNT constant, ProcessImageGenFn type, `enqueue` / `setProcessImageGen` / `setWorkerDeps` / `startPool` / `stopPool` / `isEmpty` / `__resetForTests` exports.
- `src/backend/image-gen-requests/queue.test.ts` (240 LOC) — 9 tests: fresh isEmpty, drain, N=5 concurrency cap, FIFO waiter wake-up, drain-error containment, __resetForTests, sync-return, WORKER_COUNT export, stopPool no-op-after-stop.
- `src/backend/image-gen-requests/worker.ts` (370 LOC) — WorkerDeps interface (Task 1 stub replaced by full impl in Task 2), buildProductionDeps(tokenBucket), writeFailureFile, writeSuccessResponse (single SSH connection, PNGs-before-JSON), processImageGen (7-step flow), IMAGE_GEN_TTL_MS + IMAGE_GEN_MODEL exports.
- `src/backend/image-gen-requests/worker.test.ts` (285 LOC) — 9 tests: (a) success n=3 order + filenames, (b) rate_limited failure, (c) malformed shortcut, (d) TTL expiry, (e) refImage passthrough, (f) LOCAL branch conn=null, (g) write-failure containment, REMOTE single-connection reuse, missing-host warn path.
- `src/backend/image-gen-requests/scan-orchestrator.ts` (410 LOC) — locally-declared SshChannel type (no ssh-poll-orchestrator import), IMAGE_GEN_SCAN_CMD, parseImageGenRequestBatch, fetchCompanionRef (cat|base64), scanImageGenRequests, createImageGenScanOrchestrator factory (start / stop / getScanTickCount).
- `src/backend/image-gen-requests/scan-orchestrator.test.ts` (395 LOC) — 21 tests: S1-S3 start, T1-T2 tick, E1-E3 enqueue, G1 in-flight guard, F1-F2 never-throw, L1 lifecycle, R1-R3 companion-fetch, P1-P4 parse batch, SC1-SC2 scan fail-open direct.

**Modified (2):**
- `src/backend/claude-session/identity-artifact-reader.ts` — added public `writeBinaryFileAtomic(conn, targetPath, bytes)` (~95 LOC) directly after private `sftpWriteBinaryAtomic`. Full wrapper: LOCAL branch mirrors writeMarkdownFileAtomic's $HOME/fleet resolution + Node fs tmp+rename + best-effort cleanup on error; REMOTE branch delegates to the existing private helper. Log tag `image_gen_binary_write`. All 820 pre-existing claude-session tests still green.
- `src/backend/starter.ts` — added ~170 LOC image-gen boot block immediately after the spawn-scan block at L1184. Dynamic imports for createImageGenScanOrchestrator + createTokenBucket + queue/worker exports + listSubstrateHosts + ssh primitives. Reads SKYNET_IMAGE_GEN_RPM (default 30), creates singleton tokenBucket, wires worker+queue via buildProductionDeps → setWorkerDeps → setProcessImageGen → startPool, own imageGenScanHostClients map + acquireChannel/releaseChannel closures, createImageGenScanOrchestrator with fire-and-forget start + SIGTERM cleanup that drains hostClients + stopPool.

## Decisions Made

- **writeBinaryFileAtomic: full LOCAL+REMOTE wrapper, not a small delegator.** The plan text suggested the wrapper could be a small delegator around `sftpWriteBinaryAtomic`, but the private helper has no LOCAL branch. Implemented the LOCAL branch inline (mirroring writeMarkdownFileAtomic exactly, only substituting `bytes` for `contents`) and delegated the REMOTE branch. This matches the plan's `<action>` Step A which specifies "Copy the LOCAL branch from writeMarkdownFileAtomic (lines 1968-2005)."
- **Companion-fetch mechanism: second `channel.exec("cat ... | base64 -w0")`, not batched into the main scan.** The plan offered a choice; picked two-exec because binary payload can't safely interleave with tab-separated stdout parsing. Sequential-exec cost is negligible.
- **starter.ts image-gen block placement: immediately after spawn-scan at L1184 (post-edit L1185+).** Same DB-readiness precondition, same session-less enumeration primitive, cleanly isolated SSH-client pool. Placement matches the plan's `<action>` Step C recommendation.
- **WorkerDeps interface lives in worker.ts; queue.ts imports as `import type`.** Type-only import is erased at runtime so no transitive graph pollution. Queue holds the deps opaquely — never inspects fields.
- **SshChannel redeclared locally in scan-orchestrator.ts to satisfy the literal Q2 grep-based invariant.** The `<done>` block specifies `grep -c "from ['\"].*ssh-poll-orchestrator" src/backend/image-gen-requests/scan-orchestrator.ts` must return 0. Even a type-only import would have violated the literal grep. Duplicating the 2-line interface satisfies the invariant with negligible cost.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tsc 6.0.3 discriminated-union narrowing quirk (worker.ts + scan-orchestrator.ts)**
- **Found during:** Task 2 (worker.ts initial tsc check) and Task 3 (scan-orchestrator.ts tsc check).
- **Issue:** `npx tsc --noEmit -p tsconfig.node.json` failed with `TS2339: Property 'reason' does not exist on type ...` inside `if (result.ok) { ... } else { ... }` blocks. Same tsc 6.0.3 quirk documented in Plan 01 SUMMARY.md and spawn-requests/parseSpawnRequestBatch — the union's `ok:false` branch is not narrowed by `!result.ok` or by the implicit `else`.
- **Fix:** Explicit `if (result.ok === true) { ... } else { ... }` narrowing in two places (worker.ts main flow, scan-orchestrator.ts fetchCompanionRef result branch). Inline comment cites the Plan 01 precedent and the identity-birth-orchestrator.ts mintResult/loginResult pattern.
- **Files modified:** src/backend/image-gen-requests/worker.ts, src/backend/image-gen-requests/scan-orchestrator.ts
- **Verification:** `npx tsc --noEmit -p tsconfig.node.json` returns 0 image-gen-requests errors after the fix; all tests still green.
- **Committed in:** 763144cf (Task 2 fix), 73a42389 (Task 3 fix)

**2. [Rule 3 - Blocking] Redeclare SshChannel locally to satisfy Q2 grep invariant**
- **Found during:** Task 3 (verifying `<done>` grep for ssh-poll-orchestrator imports).
- **Issue:** Initial scan-orchestrator.ts had `import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js"` — a type-only import (erased at runtime). But the plan's `<done>` literal invariant is `grep -c "from ['\"].*ssh-poll-orchestrator" src/backend/image-gen-requests/scan-orchestrator.ts` → 0. Even the type-only import triggers the grep and violates the literal check.
- **Fix:** Redeclared the SshChannel interface locally in scan-orchestrator.ts (2 lines — structural mirror of ssh-poll-orchestrator.ts:102). Also exported it from scan-orchestrator.ts so the test file can import from the local module. Structural typing makes the two shapes interchangeable — starter.ts can hand the same channel wrappers to either orchestrator without a mismatch.
- **Files modified:** src/backend/image-gen-requests/scan-orchestrator.ts (add local SshChannel), src/backend/image-gen-requests/scan-orchestrator.test.ts (import SshChannel from local module).
- **Verification:** `grep -c "from ['\"].*ssh-poll-orchestrator" src/backend/image-gen-requests/scan-orchestrator.ts` → 0; all 21 scan-orchestrator tests still green.
- **Committed in:** 73a42389 (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both blocking — one tsc narrowing quirk, one grep-invariant compliance).
**Impact on plan:** Both are trivial mechanical corrections that preserve the plan's INTENT. No scope creep, no behaviour delta from the plan's `<behavior>` blocks.

## Issues Encountered

- **worker.ts created as a stub in Task 1.** Task 1's file list didn't include worker.ts, but queue.ts needs the WorkerDeps type by name and Task 1 tests need it too. Created worker.ts as a type-only stub in Task 1 (only the WorkerDeps interface and a WorkerSshClient alias), then Task 2 replaced the whole file with the full runtime implementation. This is documented in Task 1's commit body and is the only way to keep queue.ts type-safe without a forward-reference / circular graph.
- **`node_modules` already present.** No `npm install` needed at execution start — Plan 01 already populated it.

## User Setup Required

- **SKYNET_IMAGE_GEN_RPM env (optional).** starter.ts reads this at boot with a default of 30. Operators on higher OpenAI tiers can bump it via the container's env. Missing/invalid values fall back to 30 (Math.max(1, ...) floor prevents deadlock).
- **OPENAI_API_KEY env (already required).** No new setup — the adapter (Plan 01) reads it at request time and returns `not_configured` failure when unset. Matches the existing avatar-batch route convention (D-25).

## Threat Model Compliance

All 8 threats in the plan's `<threat_model>` register are addressed by the code shipped in this plan:

| Threat ID | Category | Mitigation Status |
|-----------|----------|-------------------|
| T-116-03-01 | Tampering — scan parses caller-supplied JSON | MITIGATED. parseImageGenRequestBatch calls parseRequestBody (Plan 01's D-06 explicit-reject KNOWN_KEYS parser) for every entry; unknown-key rejection produces malformedReason → worker converts to malformed failure file. |
| T-116-03-02 | DoS — unbounded queue growth | MITIGATED. In-memory FIFO with WORKER_COUNT=5 workers + token bucket + 5-min TTL-at-dequeue drops backlog. Filesystem mv-based claim is per-tick, so the same host can't re-enqueue an already-claimed request. |
| T-116-03-03 | Info Disclosure — companion bytes in log | ACCEPTED per threat register. Scan does not log companion bytes — only filename + logs "companion ref fetch failed" or "malformed" without base64 content. |
| T-116-03-04 | Tampering — caller-supplied ref filename → path traversal | MITIGATED. parseRequestBody restricts `ref` to strict `<uuid>.ref.<ext>` shape (Plan 01 REF_PATTERN); scan-orchestrator prepends `$HOME/fleet/image-gen-requests/` before shell-interpolating. Uuid-in-ref == request-uuid additional check is DEFERRED (T-116-01-06 PARTIAL — same as Plan 01; shape check + backend-controlled prefix already prevent path traversal). |
| T-116-03-05 | DoS — slow OpenAI stalls a worker slot | MITIGATED. Plan 01 adapter has 60s AbortController timeout. Worst case: 5 stalled workers for 60s, then all return provider_unavailable, resume normal drain. |
| T-116-03-06 | DoS — slow SSH host blocks all scans | MITIGATED. Per-host in-flight guard (wilma pattern) — a slow host's still-awaiting scan doesn't block scans for other hosts on the same tick. Verified by test G1. |
| T-116-03-07 | Tampering — writeBinaryFileAtomic export widens attack surface | MITIGATED. Wrapper delegates to existing private sftpWriteBinaryAtomic on REMOTE (no new SFTP behaviour); LOCAL branch is a byte-shape mirror of writeMarkdownFileAtomic's LOCAL branch (no new path allowlist behaviour — writeMarkdownFileAtomic has no path allowlist either, per RESEARCH.md Open Question 1 answered by code review). Audit shows no regression vs status quo. |
| T-116-03-08 | Info Disclosure — response-file writes race leak partial images | MITIGATED. Worker writes PNGs FIRST, success.json LAST (commit-order = observe-order). Test (a) asserts write order via a shared writeOrder array. |

## Test Coverage

**Full image-gen-requests test suite (Plan 01 + Plan 03):**
- `npx vitest run src/backend/image-gen-requests/` → 7 files, 100 tests, all green.

**Breakdown:**
- Plan 01: 4 files, 61 tests (types, parse-request-body, token-bucket, adapter — verified in Plan 01 SUMMARY).
- Plan 03: 3 files, 39 tests
  - queue.test.ts: 9 tests
  - worker.test.ts: 9 tests
  - scan-orchestrator.test.ts: 21 tests

**Regression:**
- `npx vitest run src/backend/claude-session/` → 52 files, 820 tests + 1 skipped, all green (no regression from writeBinaryFileAtomic export).

**Type check:**
- `npx tsc --noEmit -p tsconfig.node.json` → clean.

## Manual Review Checklist (from plan `<verification>`)

- [x] Worker's TTL check happens BEFORE token-bucket.acquire() and BEFORE adapter call (Pitfall 5) — verified by test (d): TTL-expired item does NOT call tokenBucket.acquire, does NOT call callOpenAiImageGen.
- [x] Worker writes PNG files BEFORE the success JSON (commit-order invariant) — verified by test (a): writeOrder assertion enforces `BIN:*.png` comes before `JSON:*.json`.
- [x] Scan-orchestrator does NOT import from ssh-poll-orchestrator.ts (Q2 correction) — grep count = 0.
- [x] starter.ts image-gen block is placed AFTER the spawn-scan block (not before, not interleaved) — inserted at post-edit position after L1184.
- [x] Token bucket is a boot-time SINGLETON — one instance created in starter.ts, passed to every worker via WorkerDeps — verified by starter.ts source (single createTokenBucket call, one buildProductionDeps(tokenBucket) call).
- [x] Queue's `startPool()` is called from starter.ts after `setWorkerDeps` and `setProcessImageGen` — verified by starter.ts source (three calls in this order).
- [x] Adapter is never called if item.malformedReason is set (worker short-circuits) — verified by test (c).
- [x] Adapter is never called if TTL expired (worker short-circuits AFTER malformed check but BEFORE token acquire) — verified by test (d).

## Grep Invariants (from plan `<verification>`)

- `grep -c "createImageGenScanOrchestrator\|SKYNET_IMAGE_GEN_RPM\|createTokenBucket" src/backend/starter.ts` → **7** (required >= 3).
- `grep -c "from ['\"].*ssh-poll-orchestrator" src/backend/image-gen-requests/scan-orchestrator.ts` → **0** (Q2 invariant).
- `grep -c "^export async function writeBinaryFileAtomic" src/backend/claude-session/identity-artifact-reader.ts` → **1**.
- `grep -c "scanSpawnRequests" src/backend/image-gen-requests/scan-orchestrator.ts` → **0** (scan-orch uses its own scanImageGenRequests).

## Self-Check: PASSED

**Files verified:**
- FOUND: src/backend/image-gen-requests/queue.ts
- FOUND: src/backend/image-gen-requests/queue.test.ts
- FOUND: src/backend/image-gen-requests/worker.ts
- FOUND: src/backend/image-gen-requests/worker.test.ts
- FOUND: src/backend/image-gen-requests/scan-orchestrator.ts
- FOUND: src/backend/image-gen-requests/scan-orchestrator.test.ts
- FOUND: src/backend/claude-session/identity-artifact-reader.ts (modified — writeBinaryFileAtomic export present)
- FOUND: src/backend/starter.ts (modified — image-gen boot block present)

**Commits verified:**
- FOUND: 7b857c46 — feat(116-03): add 5-worker image-gen queue + writeBinaryFileAtomic export
- FOUND: 763144cf — feat(116-03): implement image-gen worker with TTL-at-dequeue + token acquire + response drops
- FOUND: 73a42389 — feat(116-03): add always-on image-gen scan orchestrator + starter.ts wiring

**Test suite:** 7 files, 100 tests, all green in ~1.5s (image-gen-requests) + 820 tests green (claude-session regression).
**Type check:** `npx tsc --noEmit -p tsconfig.node.json` clean.

---
*Phase: 116-image-gen-skill-file-drop-broker-for-openai-image-generation*
*Completed: 2026-09-18*
