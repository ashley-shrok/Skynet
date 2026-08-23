---
phase: 55-tap-to-load-discovery-reuse-teach-claude-session-attach-to-c
plan: "02"
subsystem: fleet-status/ssh-poll-orchestrator
tags: [cache, session-file, fleet-status, writer, backend-only]
dependency_graph:
  requires:
    - "55-01: session-file-cache module (writeSessionFileCache export)"
  provides:
    - "Source A writes resolved jsonlPath + pid to session-file cache on every happy-path poll tick"
    - "Six new orchestrator tests (55-A through 55-F) covering all write/skip guard cases"
  affects:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
tech_stack:
  added: []
  patterns:
    - "Guarded side-effect write inside existing poll tick — one import + one if-guarded call, no new SSH round-trips"
key_files:
  created: []
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts
decisions:
  - "Write inserted AFTER stale-liveness early-return (~L1191) and AFTER parseStopHookPayload block, BEFORE SessionState composition (line 1226) — ensures stale PIDs never reach the write site"
  - "Guard condition is jsonlPath !== null && tmuxSession !== null — no !stale guard needed because the early-return at L1191 already eliminates stale paths"
  - "Source B (pollDormantOnlyIdentities) has zero writeSessionFileCache call sites — enforced by awk grep in acceptance criteria and by Test 55-F"
  - "Import added to top-level imports block (line 55) alongside other fleet-status local imports — follows existing import ordering convention"
metrics:
  duration: "~25 minutes"
  completed: "2026-08-23"
  tasks_completed: 1
  tasks_total: 1
  files_created: 0
  files_modified: 2
---

# Phase 55 Plan 02: source-A cache write in processPid Summary

**One-liner:** One guarded writeSessionFileCache call at line 1226 of processPid publishes resolved jsonlPath + pid to the shared session-file cache after every live non-stale poll tick; six new orchestrator tests cover all write/skip guard cases.

## What Was Built

Modified `src/backend/fleet-status/ssh-poll-orchestrator.ts` to wire the source-A cache write:

| Change | Location | Description |
|--------|----------|-------------|
| Import added | Line 55 | `import { writeSessionFileCache } from "./session-file-cache.js"` |
| Guarded call added | Line 1226 | Inside `processPid`, after stale-liveness return and after parseStopHookPayload block, before SessionState composition |
| Comment block | Lines 1213–1220 | Prose comment explaining Phase 55 Plan 02 design decisions (source A only, guards, stale-early-return relationship) |

The exact insertion position (line 1226) places the write after:
- The stale-liveness early-return at ~L1191 (stale PIDs never reach this)
- The parseStopHookPayload block (~L1195–1210)

And before:
- The `const state: SessionState = {...}` composition at ~L1231

Guard condition: `if (jsonlPath !== null && tmuxSession !== null)` — consistent with the existing branch that gates all downstream state composition on having a resolved identity.

Modified `src/backend/fleet-status/ssh-poll-orchestrator.test.ts`:
- Added import for `readSessionFileCache` and `__clearAllSessionFileCacheForTests` at top-level (lines 29–32)
- Added `describe("Phase 55: session-file cache writes")` block at end of file with 6 new tests

## Test Results

**Scoped run:** `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts -t "Phase 55"` — **6/6 green**

| Test | Name | Result |
|------|------|--------|
| 55-A | source A happy path writes cache entry | PASS |
| 55-B | skips write when jsonlPath is null | PASS |
| 55-C | skips write when tmuxSession is null | PASS |
| 55-D | stale-liveness path does NOT reach cache write | PASS |
| 55-E | overwrite on second tick with same key updates entry | PASS |
| 55-F | source B never writes to cache | PASS |

**Full file run:** `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — **88/88 green** (zero regressions to pre-existing tests)

## Acceptance Criteria Verification

| Criterion | Result |
|-----------|--------|
| `grep -n "writeSessionFileCache" ssh-poll-orchestrator.ts` returns 2 lines (1 import + 1 call) | PASS — lines 55 and 1226 |
| Non-import match is exactly 1 (line 1226, inside processPid) | PASS |
| `awk '/function pollDormantOnlyIdentities/,/^  }$/' ... \| grep -c "writeSessionFileCache"` = 0 | PASS — 0 |
| All 6 Phase 55 tests pass | PASS |
| All 88 pre-existing orchestrator tests still green | PASS |
| `npm run build:backend` exit 0 | PASS |
| `publishSessionState\|deps.registry.` count unchanged from pre-plan baseline (6) | PASS — still 6 |

## Threat Model Compliance

| Threat | Disposition | Status |
|--------|-------------|--------|
| T-55-04 Source B pollutes cache with pid=0 sentinel | mitigate | `writeSessionFileCache` has zero call sites in `pollDormantOnlyIdentities`; acceptance grep + Test 55-F enforce this |
| T-55-05 Cache write inside poll loop adds latency | accept | Write is O(1) Map.set, no I/O; negligible vs SSH exec cost |
| T-55-06 Stale liveness PID writes fresh-looking cache entry | mitigate | Stale early-return at L1191 fires BEFORE new write site; Test 55-D proves this |

## Deviations from Plan

None — plan executed exactly as written. The write was inserted at line 1226 (between the parseStopHookPayload block and SessionState composition), consistent with the plan's `<action>` instructions. The comment was written as line comments (`//`) as required.

## Known Stubs

None. This plan wires a concrete side-effect into an existing code path; no data sources are stubbed.

## Threat Flags

None. This plan introduces no new network endpoints, auth paths, file access patterns, or schema changes. The write is a process-local Map.set.

## Self-Check: PASSED

- `src/backend/fleet-status/ssh-poll-orchestrator.ts` modified: VERIFIED (writeSessionFileCache at line 1226)
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` modified: VERIFIED (6 new tests, all green)
- Commit `cb80096a` exists: VERIFIED
- All 88 orchestrator tests: GREEN
- Backend build: EXIT 0
- Source B grep: 0 matches
- publishSessionState baseline count: 6 (unchanged)
