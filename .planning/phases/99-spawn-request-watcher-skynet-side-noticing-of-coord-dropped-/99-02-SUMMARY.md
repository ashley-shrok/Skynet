---
phase: 99-spawn-request-watcher-skynet-side-noticing-of-coord-dropped-
plan: 02
subsystem: backend
tags: [spawn-requests, fleet-status, ssh-poll-orchestrator, atomic-scan, identity-birth, starter-wiring]

# Dependency graph
requires:
  - phase: 99-spawn-request-watcher-skynet-side-noticing-of-coord-dropped-
    plan: 01
    provides: "spawn-requests/types.ts PendingBirth + SpawnRequestBody, queue.ts enqueue + setProcessBirth, worker.ts processBirth + buildProductionDeps"

provides:
  - "src/backend/fleet-status/ssh-poll-orchestrator.ts — Extended pollOneHost with (d) atomic spawn-request scan step; new module-level exports scanSpawnRequests + parseSpawnRequestBatch; optional enqueueSpawnRequest field on OrchestratorDeps"
  - "src/backend/fleet-status/ssh-poll-orchestrator.test.ts — 8 new spawn-request scan tests in describe('spawn-request scan (Phase 99)'); default fleet/spawn-requests → '' response in buildDeps for backward-compat"
  - "src/backend/starter.ts — Wires spawn-requests/queue.enqueue as enqueueSpawnRequest dep; wires worker.processBirth (via buildProductionDeps) into queue via setSpawnRequestProcessBirth"

affects: ["fleet-status-sweep", "starter.ts", "spawn-request-queue", "birth-worker"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional OrchestratorDeps field pattern: enqueueSpawnRequest? — backward-compat extension without test churn (Pitfall 5)"
    - "Module-level export of helpers before factory: scanSpawnRequests + parseSpawnRequestBatch exported at module scope so tests can import them directly"
    - "Atomic mv-claim shell one-liner: UUID length guard (${#base} -eq 36) + mv for double-observation defense (Pitfall 7 + RESEARCH Security Note)"
    - "Fail-open exec result: null → warn + return [], empty → return [] (D-03 missing folder)"
    - "setSpawnRequestProcessBirth before createSshPollOrchestrator: ensures drain callback ready before first tick"

key-files:
  created: []
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
    - src/backend/starter.ts

key-decisions:
  - "Module-level exports for helpers: parseSpawnRequestBatch and scanSpawnRequests placed as module-level exports (not inside the factory) so test files can import them directly for unit testing (Test 5 calls parseSpawnRequestBatch directly)"
  - "Default fleet/spawn-requests → '' in buildDeps: the one surgical shared-code change that keeps all 128 existing tests green; without it, every existing test tick would get null response for the scan and log SSH-error warns"
  - "userId left as '' at sweep tier: PendingBirth.userId is empty string; worker re-fetches via getHostOwnerUserId(hostIdNum) at drain time per Plan 99-01 Task 2 contract"

requirements-completed: []

# Metrics
duration: 25min
completed: 2026-09-10
---

# Phase 99 Plan 02: Spawn-Request Watcher — Fleet-Status Sweep Extension + Starter Wiring Summary

**Atomic spawn-request scan piggy-backed on pollOneHost per tick via mv-claim shell one-liner (UUID-length guarded), parsed into PendingBirth[], enqueued via optional dep, wired end-to-end through starter.ts; 8 new scan tests + 128 existing tests all green (136 total)**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-10T05:46:00Z
- **Completed:** 2026-09-10T06:11:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Extended `ssh-poll-orchestrator.ts` with the (d) atomic spawn-request scan step at line 1056 inside pollOneHost (after pollDormantOnlyIdentities, before poll-end log)
- Added module-level exports: `SPAWN_REQUESTS_SCAN_CMD` constant (lines 846-857), `UUID_RE` regex (line 859), `parseSpawnRequestBatch` (line 876), `scanSpawnRequests` (line 915)
- Extended `OrchestratorDeps` interface with optional `enqueueSpawnRequest?` field (line 112) — backward-compat for 7207-line test file (Pitfall 5)
- Added default `fleet/spawn-requests` → `""` response in buildDeps — the critical one-line backward-compat change that keeps all 128 existing tests green
- Added 8 new tests in `describe("spawn-request scan (Phase 99)")` — total test count goes from 128 to 136
- Wired `setSpawnRequestProcessBirth` + `enqueueSpawnRequest` in `starter.ts` (lines 703, 733) with spawn-request imports at lines 17-18
- All scoped test gates green: 136 (ssh-poll-orchestrator) + 25 (spawn-requests) = 161 total
- `identity-birth-orchestrator.ts` and `identity-birth.ts` byte-identical to pre-phase state (D-20)

## Task Commits

1. **Task 1: Extend ssh-poll-orchestrator.ts** — `e57f25ac` (feat)
2. **Task 2: Extend ssh-poll-orchestrator.test.ts — 8 new scan tests** — `b971ffd9` (test)
3. **Task 3: Wire spawn-requests queue + worker into starter.ts** — `712a249b` (feat)

## Exact Insertion Points

### ssh-poll-orchestrator.ts

| What | Location |
|------|----------|
| `import type { PendingBirth, SpawnRequestBody }` | Line 55 (after existing type imports) |
| `enqueueSpawnRequest?` field on OrchestratorDeps | Line 112 (before closing `}` of interface) |
| `SPAWN_REQUESTS_SCAN_CMD` constant | Line 846 (module-level, before factory) |
| `UUID_RE` regex | Line 859 (module-level) |
| `parseSpawnRequestBatch` export | Line 876 (module-level, before factory) |
| `scanSpawnRequests` export | Line 915 (module-level, before factory) |
| (d) spawn-request scan block in pollOneHost | Line 1049-1059 (after pollDormantOnlyIdentities, before poll-end log) |
| `spawnClaimed` field in poll-end log | Line 1066 (observability enhancement) |

### Atomic Shell Command (exact JavaScript string)

```
"cd ~/fleet/spawn-requests 2>/dev/null || exit 0; for f in *.json; do [ -f \"$f\" ] || continue; base=\"${f%.json}\"; [ ${#base} -eq 36 ] || continue; tmp=\"$f.$$\"; mv \"$f\" \"$tmp\" 2>/dev/null || continue; printf '%s\\t' \"$f\"; cat \"$tmp\"; printf '\\n'; rm -f \"$tmp\"; done"
```

### ssh-poll-orchestrator.test.ts

| What | Location |
|------|----------|
| `import { parseSpawnRequestBatch }` | Line 22 (added to existing import) |
| `import type { PendingBirth }` | Line 28 (after existing type imports) |
| `channel.setResponse("fleet/spawn-requests", "")` | Line 252 (inside buildDeps default responses) |
| `describe("spawn-request scan (Phase 99)")` block | Lines 7209-7333 (end of file, after last existing describe) |

### starter.ts

| What | Location |
|------|----------|
| `import { enqueue as enqueueSpawnRequest, setProcessBirth as setSpawnRequestProcessBirth }` | Line 17 |
| `import { processBirth as processSpawnRequestBirth, buildProductionDeps as buildSpawnRequestWorkerDeps }` | Line 18 |
| `setSpawnRequestProcessBirth(...)` call | Line 703 (before createSshPollOrchestrator at line 705) |
| `enqueueSpawnRequest,` field in orchestrator literal | Line 733 |

## Test Count Before/After

| File | Before | After | Delta |
|------|--------|-------|-------|
| ssh-poll-orchestrator.test.ts | 128 | 136 | +8 |
| spawn-requests/ (unchanged) | 25 | 25 | 0 |
| starter.test.ts (unchanged) | 18 | 18 | 0 |
| **Total scoped** | **171** | **179** | **+8** |

## starter.test.ts

`src/backend/starter.test.ts` exists and was run. It exports `maybeInstallStopHook`, `makeSemaphore`, `projectRunsFleetSubstrate` — all tests pass (18/18). The IIFE guard (`if (process.env.VITEST !== "true")`) prevents the spawn-request wiring from running in test context.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Module-level vs factory-scoped exports**
- **Found during:** Task 1 (initial structural analysis)
- **Issue:** Plan.md's action said to add `export function` and `export async function` inside `createSshPollOrchestrator` factory. Functions inside a factory cannot be `export`ed in TypeScript — they would cause a compile error.
- **Fix:** Added `parseSpawnRequestBatch` and `scanSpawnRequests` as module-level exports BEFORE the factory function. The `SPAWN_REQUESTS_SCAN_CMD` constant and `UUID_RE` regex are also module-level. `pollOneHost` (inside the factory) calls `scanSpawnRequests` as a module-level function — this works correctly.
- **Files modified:** src/backend/fleet-status/ssh-poll-orchestrator.ts
- **Verification:** `grep -cE '^export (async )?function (scanSpawnRequests|parseSpawnRequestBatch)'` returns 2. All 128 existing tests pass.
- **Committed in:** e57f25ac (Task 1)

## Known Stubs

None. All wiring is live:
- `enqueueSpawnRequest` is the real `queue.enqueue` function
- `setSpawnRequestProcessBirth` wires the real `processBirth` with production deps
- The `userId: ""` in `parseSpawnRequestBatch` is intentional per the Plan 99-01 contract — the worker re-fetches `getHostOwnerUserId(hostIdNum)` at drain time (not a stub)

## Threat Flags

No new security surface beyond the plan's threat model (T-99-06 through T-99-SC). The UUID-length guard (`[ ${#base} -eq 36 ]` in shell + `UUID_RE.test(uuid)` in TS) mitigates T-99-06 path traversal and the response-file glob collision (RESEARCH Security Note). T-99-07 parser defense-in-depth (tab check, UUID regex, JSON.parse try/catch, typeof narrowing) is implemented as specified.

## D-20 Assertion

- `git diff --stat src/backend/database/routes/identity-birth-orchestrator.ts` — empty (0 changes)
- `git diff --stat src/backend/database/routes/identity-birth.ts` — empty (0 changes)

## No Push / No Deploy Attestation

No `git push`, `docker compose up`, `--force-recreate`, or `docker build` commands were run during execution of this plan. Executor's remit stops at scoped tests green + local commit (D-23).

## No New npm Packages

`git diff package.json package-lock.json | wc -l` returns 0. All implementation reuses existing backend imports.

## Self-Check: PASSED

- `src/backend/fleet-status/ssh-poll-orchestrator.ts` exists: YES
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` exists: YES
- `src/backend/starter.ts` exists: YES
- Commit `e57f25ac` (Task 1) exists: YES
- Commit `b971ffd9` (Task 2) exists: YES
- Commit `712a249b` (Task 3) exists: YES
- `npx vitest run --project backend src/backend/fleet-status/ssh-poll-orchestrator.test.ts` exits 0: YES (136 tests)
- `npx vitest run --project backend src/backend/spawn-requests/` exits 0: YES (25 tests)
- `git diff --stat src/backend/database/routes/identity-birth-orchestrator.ts`: empty (unchanged)
- `git diff --stat src/backend/database/routes/identity-birth.ts`: empty (unchanged)
- `grep -cE '^export (async )?function (scanSpawnRequests|parseSpawnRequestBatch)' src/backend/fleet-status/ssh-poll-orchestrator.ts` returns 2: YES
- `grep -c "enqueueSpawnRequest?:" src/backend/fleet-status/ssh-poll-orchestrator.ts` returns >= 1: YES (1)
- `grep -c "from.*spawn-requests/queue" src/backend/starter.ts` returns >= 1: YES (1)
- `grep -c "from.*spawn-requests/worker" src/backend/starter.ts` returns >= 1: YES (1)
- Exactly 3 modified files (+ __pycache__ noise predating phase): YES

---
*Phase: 99-spawn-request-watcher-skynet-side-noticing-of-coord-dropped-*
*Completed: 2026-09-10*
