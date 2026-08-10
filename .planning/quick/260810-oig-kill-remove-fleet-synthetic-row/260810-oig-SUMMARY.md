---
phase: quick-260810-oig
plan: 01
subsystem: frontend/state
tags: [fleet, conversation-store, kill, ux, tdd]
dependency_graph:
  requires: [quick-260810-n3a]
  provides: [removeFleetSession mutator, fleet row instant removal on kill]
  affects: [conversation-store.ts, AppShell.tsx]
tech_stack:
  added: []
  patterns: [zustand-like notify/subscribe, localStorage cache trim, idempotent mutator]
key_files:
  created: []
  modified:
    - src/ui/state/conversation-store.ts
    - src/ui/state/conversation-store.test.ts
    - src/ui/AppShell.tsx
decisions:
  - removeFleetSession placed immediately after updateFleetSessions for co-location
  - writeFleetSessionsCache wrapped in try/catch to preserve the silent-failure policy
  - No new AppShell test file — R1-R4 store tests + existing K8-K10 panel tests sufficient
metrics:
  duration: ~15 minutes
  completed: 2026-08-10
---

# Phase quick-260810-oig Plan 01: Remove Fleet-Synthetic Row on Successful Kill Summary

**One-liner:** Added `removeFleetSession(hostId, sessionName)` store mutator + AppShell wiring so killed fleet rows disappear instantly without a page reload.

## What Was Built

### Task 1: removeFleetSession mutator + R1-R4 tests

Added `export function removeFleetSession(hostId: number, sessionName: string): void` to `src/ui/state/conversation-store.ts` immediately after `updateFleetSessions` (~line 832). The function:

- Filters `state.fleetSessions` by exact `(hostId, sessionName)` tuple match
- Short-circuits as a no-op (no state mutation, no notify, no cache write) when tuple not present
- Calls `notify()` after in-memory state update
- Trims the localStorage fleet cache via `writeFleetSessionsCache` with a silent try/catch (mirrors `writeFleetSessionsCache`'s own failure policy)

Added 4 tests (R1-R4) in a `describe("conversation-store (quick-260810-oig): removeFleetSession", ...)` block immediately after Test 27 in `conversation-store.test.ts`:

- R1: happy-path removal — tuple gone, sibling remains, notify fires 1x, cache trimmed to 1 entry
- R2: idempotent no-op — absent tuple, no notify, no cache write
- R3: selectivity — only exact (hostId + sessionName) match removed; same-hostId/different-name and different-hostId/same-name siblings preserved
- R4: cache-write failure resilience — StoragePrototype.setItem throws QuotaExceededError, state still trimmed, notify still fires, no propagated error

**TDD gate compliance:**
- RED: 4 failing tests before implementation (EXIT 1, 78 pass / 4 fail)
- GREEN: all 82 tests pass after implementation (EXIT 0)

### Task 2: AppShell.onKillRow wiring

Two edits to `src/ui/AppShell.tsx`:

1. Import: added `removeFleetSession` alongside `updateFleetSessions` in the conversation-store import block
2. Call: `removeFleetSession(parseInt(row.host.id, 10), row.targetTmuxSession)` added after `closeTab(row.id)` inside the `try` block, before `catch`

## Files Modified

| File | Lines Added | Lines Removed | Purpose |
|------|------------|---------------|---------|
| src/ui/state/conversation-store.ts | +37 | 0 | removeFleetSession export |
| src/ui/state/conversation-store.test.ts | +114 | 0 | R1-R4 tests |
| src/ui/AppShell.tsx | +2 | 0 | Import + call in onKillRow |

## Test Results

- `npx vitest run src/ui/state/conversation-store.test.ts`: **EXIT 0** — 82 tests passed (78 existing + 4 new R1-R4)
- `npx vitest run` (full suite): **EXIT 0** — 144 test files, 1847 passed, 7 skipped, 1 todo

## Build Results

- `npm run build:backend`: **EXIT 0** — TypeScript strict mode, no errors
- `npm run build`: **EXIT 0** — Vite production build, AppShell-BT0Qc9dj.js emitted successfully

## Commits

- `6fb76d8`: feat(quick-260810-oig-01): removeFleetSession(hostId, sessionName) mutator + R1-R4 tests
- `512eae1`: feat(quick-260810-oig-02): AppShell.onKillRow calls removeFleetSession after successful kill

## Deviations from Plan

None — plan executed exactly as written. `writeFleetSessionsCache` forward-reference resolved cleanly (function is defined after the call site in the file, but JavaScript hoists function declarations, and TypeScript accepted the reference without complaint).

## Known Stubs

None. No placeholder data, no TODO comments, no hardcoded empty values in the modified paths.

## Threat Flags

None. No new network endpoints, no new auth paths, no new file access patterns. The only surface change is a localStorage write (cache trim), which was already present via `writeFleetSessionsCache` in the existing `updateFleetSessions` path.

## Explicit Non-Actions (per constraints)

- NO git push performed
- NO docker build performed
- NO docker compose up performed
- Orchestrator (tanya) handles ship

## Self-Check

- [x] `src/ui/state/conversation-store.ts` modified — contains `export function removeFleetSession`
- [x] `src/ui/state/conversation-store.test.ts` modified — contains R1-R4 tests
- [x] `src/ui/AppShell.tsx` modified — contains `removeFleetSession(parseInt`
- [x] Commit `6fb76d8` exists (Task 1)
- [x] Commit `512eae1` exists (Task 2)
- [x] Full vitest suite EXIT 0 (144 files, 1847 passed)
- [x] build:backend EXIT 0
- [x] build (frontend) EXIT 0

## Self-Check: PASSED
