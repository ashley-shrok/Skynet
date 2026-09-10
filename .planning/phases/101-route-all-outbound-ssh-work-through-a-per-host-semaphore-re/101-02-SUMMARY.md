---
phase: 101
plan: "02"
subsystem: backend/starter
tags: [semaphore, ssh, concurrency, registry, wilma-incident, fleet-status, substrate]
dependency_graph:
  requires: [host-semaphore-registry]
  provides: [fleet-status-registry-migration, substrate-registry-migration]
  affects: [starter.ts, fleet-status IIFE, substrate orchestrator IIFE]
tech_stack:
  added: []
  patterns: [shared registry lookup, single-instance per hostId, registry replaces local Map]
key_files:
  created: []
  modified:
    - src/backend/starter.ts
decisions:
  - "D-04 landed: fleet-status (acquireSshChannel L608/L658) + substrate (substrateAcquireChannel L903) now call getHostSemaphore(host.id) — one shared 8-slot pool per hostId across all three call sites."
  - "D-02 path was primary (makeSemaphore in registry, re-exported from starter.ts) — local import { makeSemaphore } replaced with import { getHostSemaphore }; export { makeSemaphore } re-export retained for starter.test.ts."
  - "substrateHostSemaphores Map removed entirely — declaration, lazy-init block, and SIGTERM .clear() all dropped."
metrics:
  duration: "8 minutes"
  completed: "2026-09-10"
  tasks_completed: 2
  files_created: 0
  files_modified: 1
---

# Phase 101 Plan 02: starter.ts Fleet-Status + Substrate Migration to Shared Registry Summary

Migrated the two heaviest SSH producers in starter.ts (fleet-status acquireSshChannel + substrateAcquireChannel) from independent `makeSemaphore(8)` instances to the shared `getHostSemaphore(host.id)` registry — D-04 correct aggregate policy per Bounty b31a5c8e.

## What Was Built

### Task 1 — Fleet-status acquireSshChannel registry migration

`src/backend/starter.ts` — both acquireSshChannel branches:

- **Health-check-reuse branch (L608):** `makeSemaphore(8)` → `getHostSemaphore(host.id)`. The channel adapter, health probe, and try/catch → null outer wrapper are unchanged.
- **Fresh-connect branch (L658):** `makeSemaphore(8)` → `getHostSemaphore(host.id)`. The channelAdapter, hookInstallAttempted fire-and-forget, and all client event handlers are unchanged.
- **Import change:** `import { makeSemaphore }` → `import { getHostSemaphore }` from `./ssh/host-semaphore-registry.js`. The `export { makeSemaphore }` re-export line is retained so `starter.test.ts` can still import `makeSemaphore` directly.

### Task 2 — substrateAcquireChannel + substrateHostSemaphores Map removal

`src/backend/starter.ts` — substrate orchestrator section:

- **Map declaration removed:** `const substrateHostSemaphores = new Map<string, ReturnType<typeof makeSemaphore>>()` (4 lines) replaced with a comment block explaining the Phase 101 D-04 migration.
- **Lazy-init block replaced:** The 5-line `let sem = substrateHostSemaphores.get(host.id); if (!sem) { sem = makeSemaphore(8); ... }` replaced with single `const sem = getHostSemaphore(host.id);`.
- **SIGTERM cleanup:** `substrateHostSemaphores.clear()` removed. The rest of the SIGTERM block (systemLogger.info, substrateOrch.stop(), for-loop over substrateHostClients, substrateHostClients.clear()) is unchanged.
- **Captured references:** `capturedClient`/`capturedSem` shape preserved — `sem` now sourced from the registry instead of the local Map.

### Result (D-04)

Fleet-status + substrate producers running on the same `host.id` now share ONE 8-slot semaphore pool. Previously each had an independent 8-cap, allowing a single host to burn 16+ concurrent exec channels — past OpenSSH's default MaxSessions=10 (wilma-incident failure mode).

## makeSemaphore D-02 Path (for Plan 101-06 CI guard calibration)

**Primary path confirmed.** `makeSemaphore` lives in `host-semaphore-registry.ts`.
`starter.ts` re-exports it via `export { makeSemaphore } from "./ssh/host-semaphore-registry.js"`.

`grep -c "makeSemaphore" src/backend/starter.ts` will find hits (in re-export line + comments).
`grep -c "makeSemaphore(8)" src/backend/starter.ts` (call sites only) should return 0.

The CI guard in Plan 101-06 should grep for `makeSemaphore(8)` (the call pattern), not `makeSemaphore` (which appears in the legitimate re-export).

## Verification

- `npm run build:backend` — clean (only pre-existing AWS SDK TS2307 errors for polly-adapter + transcribe-adapter, present before this plan; confirmed in 101-01 SUMMARY)
- `npm run build` — clean (frontend + backend, same pre-existing errors only)
- `npx vitest run src/backend/starter.test.ts` — 18/18 pass
- `grep -n "makeSemaphore(8)" src/backend/starter.ts` — 0 hits (fleet-status + substrate call sites fully migrated)
- `grep -v "^[0-9]*:\s*//" ... | grep -c "substrateHostSemaphores"` — 0 (map removed, only in comments)
- SIGTERM block: `substrateHostClients.clear()` still present at L1008

## Deviations from Plan

None — plan executed exactly as written. Both task edits landed in a single commit (77ede0ab) because the import change (replacing `import { makeSemaphore }` with `import { getHostSemaphore }`) is shared infrastructure that makes the two tasks atomically interdependent at the TypeScript compiler level — Task 1 alone with the new import would cause TS2304 on the substrate Map's `ReturnType<typeof makeSemaphore>` type annotation. Both tasks committed together to maintain a always-compilable git history.

## Self-Check

- `src/backend/starter.ts` modified: CONFIRMED (1 file changed, 30 insertions(+), 24 deletions(-))
- Task commit 77ede0ab: CONFIRMED
- No unexpected file deletions: CONFIRMED
- starter.test.ts 18/18 green: CONFIRMED
