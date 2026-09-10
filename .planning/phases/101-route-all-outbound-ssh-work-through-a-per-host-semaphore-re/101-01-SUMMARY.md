---
phase: 101
plan: "01"
subsystem: backend/ssh
tags: [semaphore, ssh, concurrency, registry, wilma-incident]
dependency_graph:
  requires: []
  provides: [host-semaphore-registry]
  affects: [starter.ts, all SSH producer sites in Phase 101 waves 2-5]
tech_stack:
  added: []
  patterns: [module-scope Map registry, lazy-init per key, FIFO counting semaphore]
key_files:
  created:
    - src/backend/ssh/host-semaphore-registry.ts
    - src/backend/ssh/host-semaphore-registry.test.ts
  modified:
    - src/backend/starter.ts
decisions:
  - "D-02 primary path chosen: makeSemaphore moved from starter.ts L103-122 into host-semaphore-registry.ts; starter.ts now does `export { makeSemaphore } from './ssh/host-semaphore-registry.js'` plus a local import for its own call sites. Both forms resolve the symbol; Plan 101-02 will migrate the 3 starter.ts call sites (L618/L666/L911) to getHostSemaphore()."
metrics:
  duration: "10 minutes"
  completed: "2026-09-10"
  tasks_completed: 2
  files_created: 2
  files_modified: 1
---

# Phase 101 Plan 01: Host Semaphore Registry Module + Tests Summary

Shared per-host SSH semaphore registry (Map<hostId, HostSemaphore>) with key normalization, lazy-init, and FIFO counting semaphore semantics lifted verbatim from starter.ts bounty b31a5c8e.

## What Was Built

### Task 1: Registry module (D-01, D-02)

`src/backend/ssh/host-semaphore-registry.ts` — the foundational module that
all Phase 101 downstream plans (101-02 through 101-05) will import.

Exports:
- `HostSemaphore` type — `{ run<T>(fn: () => Promise<T>): Promise<T> }`
- `makeSemaphore(limit)` — verbatim lift of the FIFO counting semaphore from `starter.ts:103-122` (bounty b31a5c8e; try/finally slot release, FIFO queue, error propagation unchanged)
- `getHostSemaphore(hostId, limit=8)` — lazy-init per normalized key (`String(hostId)`), returns existing instance on subsequent calls (same-instance guarantee, D-01)
- `__resetHostSemaphoreRegistryForTests()` — clears the Map; test-only, underscore-prefixed

`starter.ts` change (D-02 primary path):
- Inline `makeSemaphore` definition (L80-123) replaced with `export { makeSemaphore } from "./ssh/host-semaphore-registry.js"` + local import.
- All 3 existing call sites in starter.ts (L618 fleet-status sem, L666 fleet-status sem, L911 substrate sem) continue to compile and behave byte-identically.
- Plan 101-02 will migrate these call sites to `getHostSemaphore()` for aggregate cap enforcement.

### Task 2: Unit test suite (D-01, D-08)

`src/backend/ssh/host-semaphore-registry.test.ts` — 5 vitest cases:

| Test | What it covers |
|------|----------------|
| A    | Same hostId → same Semaphore instance (===) |
| B    | Different hostIds → distinct instances |
| C    | Key normalization (D-01): `getHostSemaphore(1)` === `getHostSemaphore('1')` |
| D    | cap=8 FIFO: 9th run() queues; resolving slot[0] starts slot[8] (D-08) |
| E    | Error path: throwing fn() still releases its slot via try/finally |

All 5 green: `npx vitest run src/backend/ssh/host-semaphore-registry.test.ts` → 5/5 pass.

## D-02 Path Decision (for Plan 101-02 context)

**Primary path chosen.** `makeSemaphore` lives in `host-semaphore-registry.ts`.
`starter.ts` imports+re-exports it.

Plan 101-02 downstream import path:
```ts
import { getHostSemaphore } from "../ssh/host-semaphore-registry.js";
```
(adjust relative path per producer file location)

`makeSemaphore` remains available from `starter.ts` for legacy consumers (starter.test.ts etc.) until Plan 101-02 completes the migration.

## Verification

- `npm run type-check` — clean (0 new errors)
- `npm run build:backend` — pre-existing AWS SDK TS2307 errors only (Phase 98, unrelated to this plan; confirmed present before our changes)
- `npx vitest run src/backend/ssh/host-semaphore-registry.test.ts` — 5/5 pass
- `grep -n "getHostSemaphore" src/backend/ssh/host-semaphore-registry.ts` — exactly one exported function (line 78)

## Deviations from Plan

None — plan executed exactly as written. D-02 primary path followed. Both tasks committed individually as specified.

## Self-Check

- `src/backend/ssh/host-semaphore-registry.ts` exists: FOUND
- `src/backend/ssh/host-semaphore-registry.test.ts` exists: FOUND
- Task 1 commit ef4d52a6: FOUND
- Task 2 commit 16c104df: FOUND
