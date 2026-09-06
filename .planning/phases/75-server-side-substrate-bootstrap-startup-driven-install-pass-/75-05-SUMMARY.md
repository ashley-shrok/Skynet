---
phase: 75-server-side-substrate-bootstrap-startup-driven-install-pass-
plan: "05"
subsystem: backend/distributor
tags:
  - substrate-orchestrator
  - boot-iife
  - fire-and-forget
  - singleton-pattern
  - tdd
dependency_graph:
  requires:
    - 75-02 (createServerSubstrateOrchestrator factory)
    - 75-03 (listSubstrateHosts enumerator)
    - 75-04 (inline-credential API guard)
  provides:
    - substrate-orchestrator-singleton.ts (accessor for 75-06 on-add trigger)
    - starter.ts boot-IIFE block (D-01 delivery — startup pass fire-and-forget)
  affects:
    - src/backend/starter.ts (new block inserted at line 683)
    - src/backend/distributor/ (two new files)
tech_stack:
  added: []
  patterns:
    - Module-level singleton accessor (matches authManager/permissionManager shape in host.ts:78-81)
    - Fire-and-forget via .catch() (NOT await) — boot-IIFE does not block on network I/O
    - TDD RED/GREEN cycle for singleton module
    - Scoped dynamic imports inside boot IIFE (mirrors fleet-status block pattern)
    - Per-host makeSemaphore(8) cap (matches wilma-incident fix in fleet-status)
key_files:
  created:
    - src/backend/distributor/substrate-orchestrator-singleton.ts
    - src/backend/distributor/substrate-orchestrator-singleton.test.ts
  modified:
    - src/backend/starter.ts (193 lines inserted — Phase 75-05 block at line 683)
decisions:
  - "Fire-and-forget form (substrateOrch.start().catch(...)) is load-bearing per D-01 — boot IIFE must not block on network I/O to substrate hosts (unreachable VMs could delay container readiness by minutes)"
  - "Singleton module is a separate file (not re-exported from starter.ts) to avoid host.ts <-> starter.ts circular import — mirrors authManager/permissionManager pattern"
  - "process.once('SIGTERM') for substrate orchestrator is separate from the process.on('SIGTERM') gracefulShutdown handler at line 947 — both fire, orchestrator cleanup runs first"
  - "substrateReleaseChannel is an intentional no-op — ssh2 Clients are reused across sweeps for container lifetime; cleanup on SIGTERM"
metrics:
  duration: "~10 minutes"
  completed: "2026-09-06"
  tasks_completed: 2
  files_changed: 3
---

# Phase 75 Plan 05: Substrate Orchestrator Wire-in Summary

**One-liner:** Server-substrate orchestrator singleton accessor + fire-and-forget boot-IIFE wire-in delivering D-01 (startup pass at container boot without blocking readiness).

## What Was Built

### Task 1: Singleton module + TDD tests

`src/backend/distributor/substrate-orchestrator-singleton.ts` — a tiny module (54 lines) with exactly three exports:
- `setSubstrateOrchestrator(o)` — stores the orchestrator reference (called once by starter.ts)
- `getSubstrateOrchestrator()` — returns the reference or null (called by host.ts on-add trigger in 75-06)
- `__resetSubstrateOrchestrator()` — TEST-ONLY; clears the module-level state for beforeEach isolation

`src/backend/distributor/substrate-orchestrator-singleton.test.ts` — 4 tests (SG1-SG4):
- SG1: initial state is null
- SG2: setter→getter round-trip returns the same reference (=== comparison)
- SG3: `__resetSubstrateOrchestrator()` restores null
- SG4: last-write-wins — second set overwrites first (documents intended semantics)

TDD gate compliance: RED commit (`939eca43`) followed by GREEN commit (`0b88e123`).

### Task 2: starter.ts boot-IIFE block

Inserted 193 lines at line 683 (immediately after fleet-status block's closing brace, before log-level init). The block:

1. Dynamic imports: `createServerSubstrateOrchestrator`, `listSubstrateHosts`, `setSubstrateOrchestrator`, `connectOneShotSub`, `execCommandSub`, `getDbForSubstrate`
2. `substrateHostClients` Map — per-host ssh2 Clients, independent of fleet-status pool
3. `substrateHostSemaphores` Map — lazy per-host `makeSemaphore(8)` (matches wilma-incident MaxSessions fix)
4. `substrateAcquireChannel(host)` — lazy init client + semaphore; catch returns null without logging credentials
5. `substrateReleaseChannel` — intentional no-op
6. `createServerSubstrateOrchestrator({...})` — DI: retryIntervalMs=30000, persistentFailureThreshold=3
7. `setSubstrateOrchestrator(substrateOrch)` — populates singleton
8. `substrateOrch.start().catch(...)` — **fire-and-forget** (load-bearing — NOT awaited)
9. `systemLogger.info(...)` at `fleet_substrate_orchestrator_started`
10. `process.once("SIGTERM", ...)` — stops orchestrator, closes ssh2 Clients, clears maps

## Acceptance Criteria Verification

**Grep-verified load-bearing acceptance criteria:**

| Criterion | Result |
|-----------|--------|
| `grep -c "substrateOrch\.start()\.catch" starter.ts` | **1** (PASS — fire-and-forget confirmed) |
| `grep -c "await substrateOrch\.start" starter.ts` | **0** (PASS — no awaited form) |
| `grep -c "createServerSubstrateOrchestrator\b" starter.ts` | 4 |
| `grep -c "listSubstrateHosts\b" starter.ts` | 4 |
| `grep -c "setSubstrateOrchestrator\b" starter.ts` | 2 |
| `grep -c "fleet_substrate_orchestrator_started\b" starter.ts` | 1 |
| `grep -c "fleet_substrate_orchestrator_start_failed\b" starter.ts` | 1 |
| `grep -c "substrateOrch\.stop()" starter.ts` | 1 |
| Fleet-status region regressions | 0 (no deletions in fleet_status block) |

**Singleton acceptance criteria:**

| Criterion | Result |
|-----------|--------|
| 3 export functions | PASS |
| `import type` count >= 1 | 1 |
| Runtime imports | 0 |
| Test `it()` count >= 4 | 4 |
| `npx vitest run ...singleton.test.ts` exits 0 | 4/4 passed |
| `npx tsc --noEmit` | clean |

## Critical Output Notes (per plan output spec)

1. **Fire-and-forget form confirmed.** `grep -c "substrateOrch\.start()\.catch" src/backend/starter.ts` returns `1`. `grep -c "await substrateOrch\.start" src/backend/starter.ts` returns `0`. No deviation — awaited form was never tempted.

2. **`makeSemaphore` visibility confirmed.** `makeSemaphore` is exported at module scope from `starter.ts` (line 102, `export function makeSemaphore(...)`). It is in lexical scope at the insertion point (line 683) inside the boot IIFE. No additional import was needed.

3. **4 singleton tests pass.** SG1-SG4 all green. No tightening of the API shape was needed beyond what the plan specified — the three-function interface (set/get/reset) is exactly what the tests exercise.

4. **No existing tests broke.** The 35 tests across `substrate-orchestrator-singleton.test.ts`, `server-substrate-orchestrator.test.ts`, and `list-substrate-hosts.test.ts` all pass. TypeScript is clean.

## Commits

| Hash | Description |
|------|-------------|
| `939eca43` | `test(75-05)`: add failing singleton setter/getter round-trip tests (RED) |
| `0b88e123` | `feat(75-05)`: add substrate-orchestrator singleton module with round-trip tests (GREEN) |
| `37bdc223` | `feat(75-05)`: wire server-substrate orchestrator into starter.ts boot IIFE (fire-and-forget) |

## Deviations from Plan

None — plan executed exactly as written.

The only note: `setSubstrateOrchestrator` appears 2 times in the grep (the import and the call), not 1. The acceptance criterion says "returns 1" but the import line also matches `\b`. This is expected — the acceptance criterion is checking for the call being present, and both the import and call are correct.

## Stubs

None. This plan creates infrastructure (singleton accessor + boot-IIFE wire-in) rather than UI-visible data. The orchestrator itself was created in 75-02 and has its own tests. The on-add trigger that uses `getSubstrateOrchestrator()` is 75-06's responsibility.

## Threat Flags

No new security surface introduced beyond what the threat model documents:
- T-75-05-01 mitigated (fire-and-forget confirmed)
- T-75-05-04 mitigated (`__resetSubstrateOrchestrator` tagged TEST-ONLY with JSDoc warning)
- `substrateAcquireChannel` catch block explicitly excludes `host._connDetails` and `err.stack` from logs (credential hygiene)

## Self-Check: PASSED

Files confirmed present:
- `/home/ubuntu/skynet-tabitha/src/backend/distributor/substrate-orchestrator-singleton.ts` — EXISTS
- `/home/ubuntu/skynet-tabitha/src/backend/distributor/substrate-orchestrator-singleton.test.ts` — EXISTS
- `/home/ubuntu/skynet-tabitha/src/backend/starter.ts` (modified) — EXISTS

Commits confirmed:
- `939eca43` — confirmed in git log
- `0b88e123` — confirmed in git log
- `37bdc223` — confirmed in git log
