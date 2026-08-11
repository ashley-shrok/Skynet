---
phase: 31-whole-app-structured-logging-backfill
plan: "07"
subsystem: backend-log-transport
tags: [d03-backend-log-unification, console-forward-transport, logger-hook, debug-ts, starter-ts]
dependency_graph:
  requires:
    - 31-01 (foundations — console-forward endpoint + getLogPath in debug.ts)
  provides:
    - enqueueBackendLog / flushBackendLogs API (src/backend/utils/console-forward-transport.ts)
    - source="backend" marker in console-forward.log
    - LogEntry.source optional field (debug.ts — backward compat)
  affects:
    - 31-08 (wave 3 — can now correlate backend + frontend log lines by sessionId)
    - every Logger.* call in the backend now lands in console-forward.log
tech_stack:
  added: []
  patterns:
    - batched-buffer + setTimeout FLUSH_INTERVAL_MS=500 (mirrors frontend console-forwarder)
    - MAX_BATCH=20 synchronous auto-flush
    - best-effort file write with stderr note on failure (D-19)
    - inline getLogPath() via same SKYNET_CONSOLE_FORWARD_LOG_PATH env var (avoids AuthManager import side-effect)
key_files:
  created:
    - src/backend/utils/console-forward-transport.ts
    - src/backend/utils/console-forward-transport.test.ts
  modified:
    - src/backend/utils/logger.ts
    - src/backend/database/routes/debug.ts
    - src/backend/starter.ts
decisions:
  - "Inlined getLogPath() logic (same env var) rather than importing from debug.ts to avoid AuthManager.getInstance() side-effect at module load in test environments"
  - "gracefulShutdown extended (not newly-created) with flushBackendLogs() call BEFORE db save"
  - "debug.ts isValidEntry source validator is additive — no pre-existing test fixtures rejected"
  - "Transport is 144 LOC (< 200 D-19 budget)"
metrics:
  duration: "8 minutes"
  completed: "2026-08-11T12:04:30Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 3
---

# Phase 31 Plan 07: Backend→Frontend Log Unification Transport (D-03) Summary

**One-liner:** D-03 backend log unification — new `console-forward-transport.ts` buffers every `Logger.*` call (MAX_BATCH=20, FLUSH_INTERVAL_MS=500) and appends `source="backend"` JSON lines to the same `console-forward.log` the frontend writes to.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing smoke suite | 625ced8 | console-forward-transport.test.ts (new) |
| 1 (GREEN) | Create console-forward-transport.ts | 0c37c77 | console-forward-transport.ts (new) |
| 2 | Wire logger.ts + debug.ts + starter.ts | 764e430 | logger.ts, debug.ts, starter.ts, console-forward-transport.ts (fix) |

## What Was Built

### Task 1: src/backend/utils/console-forward-transport.ts (144 lines, < 200 LOC budget)

New backend transport module. Public API:
- `export type BackendLogEntry` — `{ ts, level, msg, source: "backend" }`
- `export function enqueueBackendLog(entry: Omit<BackendLogEntry, "ts" | "source">): void` — buffers entry; auto-flushes at MAX_BATCH=20 or schedules timer
- `export function flushBackendLogs(): void` — synchronous flush (called at SIGTERM)
- `export function __test_reset(): void` — clears buffer + timer
- `export function __test_getBuffer(): BackendLogEntry[]` — shallow copy for test inspection

Internal design mirrors `src/ui/lib/console-forwarder.ts`:
- `const MAX_BATCH = 20; const FLUSH_INTERVAL_MS = 500`
- Rotation at 5 MB with `[LOG_ROTATED at <ts>]` marker (matches debug.ts — T-31-17 safe)
- Uses same `SKYNET_CONSOLE_FORWARD_LOG_PATH` env var as debug.ts (inline `getLogPath()`, no import from debug.ts — see Deviations)
- All file errors swallowed with `process.stderr.write(...)` (D-19)

**6 smoke tests, all green:**
1. enqueue + flush → JSON line with source=backend, ts/level/msg
2. 20 enqueues → MAX_BATCH auto-flush (no explicit call)
3. 5 enqueues + 600ms fake-timer advance → FLUSH_INTERVAL_MS flush, 5 lines in file
4. empty buffer flush → file not created (no-op)
5. appendFileSync throwing → does not propagate (swallowed)
6. concurrent enqueues in same tick → single appendFileSync call

### Task 2: Three existing files modified

**src/backend/utils/logger.ts (+9 lines):**
- Import `enqueueBackendLog` from `./console-forward-transport.js`
- `info/warn/error/success` methods each capture `formatMessage()` result into a local `formatted` variable, call `console.log/warn/error()` with it, then call `enqueueBackendLog({ level, msg: formatted })`
- `success` maps to `level: "info"` on transport (consumer categorization)
- All enqueues are INSIDE the `shouldLog()` branch — rate-limit applies to transport too (D-17 shape preserved)
- 5 occurrences of `enqueueBackendLog` (import + 4 call sites = 5 grep hits)

**src/backend/database/routes/debug.ts (+2 lines):**
- `LogEntry.source?: "frontend" | "backend"` added (optional; absent = frontend, backward compat)
- `isValidEntry` gains source validator: `if ("source" in e && e.source !== "frontend" && e.source !== "backend") return false`
- No other behavior changed; existing tests unaffected (source field absent in fixtures → not checked)

**src/backend/starter.ts (+2 lines):**
- Import `flushBackendLogs` from `./utils/console-forward-transport.js`
- `flushBackendLogs()` added to existing `gracefulShutdown` function BEFORE the `saveMemoryDatabaseToFile()` db save — ensuring diagnostic log lines are persisted even if db save fails

## Verification

```
npm run build:backend
```
Result: **exit 0** (backend TS clean with tsconfig.node.json)

```
npm run build
```
Result: **exit 0** (frontend Vite build unaffected)

```
npx vitest run src/backend/
```
Result: **58 test files, 714 tests, all passed**

```
grep -c 'enqueueBackendLog' src/backend/utils/logger.ts
```
Result: **5** (>= 4 required)

```
grep -c '"source":"backend"' src/backend/utils/console-forward-transport.ts
```
Result: **1** (>= 1 required)

```
grep -c 'fetch.*console-log' src/backend/utils/console-forward-transport.ts
```
Result: **0** (no HTTP loop-back confirmed)

## Acceptance Criteria Checklist

- [x] `console-forward-transport.ts` exists and exports `enqueueBackendLog`, `flushBackendLogs`, `BackendLogEntry`, `__test_reset`, `__test_getBuffer`
- [x] `grep -c 'source: "backend"'` returns >=1
- [x] `grep -c 'getLogPath'` returns >=1 (inline function, same semantics)
- [x] `grep -c 'MAX_BATCH = 20'` returns 1
- [x] `grep -c 'FLUSH_INTERVAL_MS = 500'` returns 1
- [x] Test file has 7 `it(...)` blocks (6 tests + 1 describe wrapper)
- [x] `npx vitest run src/backend/utils/console-forward-transport.test.ts` exits 0
- [x] After 5 enqueues + timer advance, file contains 5 JSON lines each with `"source":"backend"`
- [x] `grep -c 'enqueueBackendLog' src/backend/utils/logger.ts` returns 5 (>= 4)
- [x] `grep -c 'source?: "frontend" | "backend"' src/backend/database/routes/debug.ts` returns 1
- [x] `grep -c 'flushBackendLogs' src/backend/starter.ts` returns 2 (import + call)
- [x] `grep -c 'fetch.*console-log' src/backend/utils/console-forward-transport.ts` returns 0
- [x] `npm run build:backend` exits 0
- [x] `npx vitest run src/backend/` exits 0 (all 714 tests)

## Plan Output Confirmations

- **Transport LOC:** 144 lines (< 200 D-19 budget — confirmed)
- **`npm run build:backend` passed:** Yes — exit 0
- **Graceful shutdown:** EXTENDED (not newly-created) — `flushBackendLogs()` added to existing `gracefulShutdown` function in starter.ts
- **isValidEntry backward compat:** Zero pre-existing test fixtures rejected — source field is optional; existing fixtures omit it, so the `"source" in e` guard is never triggered by old entries

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Avoided importing debug.ts directly — inlined getLogPath() instead**

- **Found during:** Task 2 wiring (running full backend test suite after adding import)
- **Issue:** `console-forward-transport.ts` had a top-level static import of `getLogPath` from `../database/routes/debug.js`. When tests import `logger.ts` (which now imports `console-forward-transport.ts`), the entire `debug.ts` module loads at module-init time. `debug.ts` calls `AuthManager.getInstance()` at top level (line 136), which fails in test environments that don't boot the full server stack. This broke 5 `claude-session` test suites (0 tests run, TypeError at import time).
- **Fix:** Removed the import of `debug.ts`. Inlined an equivalent `getLogPath()` function using the identical `process.env.SKYNET_CONSOLE_FORWARD_LOG_PATH ?? DEFAULT_LOG_PATH` pattern. Both use the same env var, so the path is guaranteed to be the same file. The plan's acceptance criterion `git grep -c 'getLogPath'` still returns >= 1 (the inline function is named `getLogPath`).
- **Impact:** No behavior change — same file, same env var. The plan's `must_haves.key_links` entry said "Import `getLogPath` from debug.ts" but noted "either implementation is valid" for writing to the same file.
- **Files modified:** `src/backend/utils/console-forward-transport.ts`
- **Commit:** 764e430

## Known Stubs

None. All implemented functionality is fully wired within this plan's scope.

## Threat Flags

No new security surface introduced beyond what the threat model in the plan documents:
- T-31-16: Logger.formatMessage already masks sensitive fields — confirmed (no new exposure)
- T-31-17: Simultaneous rotation safe — confirmed (both frontend and inline getLogPath use same env var → same file; sync writes on Linux)
- T-31-18: Shutdown flush accepted
- T-31-19: source field validated in isValidEntry

No new network endpoints, auth paths, file access patterns beyond console-forward.log.

## Self-Check

Files verified:
- `src/backend/utils/console-forward-transport.ts` — FOUND
- `src/backend/utils/console-forward-transport.test.ts` — FOUND
- `src/backend/utils/logger.ts` — FOUND (modified)
- `src/backend/database/routes/debug.ts` — FOUND (modified)
- `src/backend/starter.ts` — FOUND (modified)

Commits verified:
- `625ced8` — test(31-07): add failing smoke suite for console-forward-transport
- `0c37c77` — feat(31-07): create console-forward-transport.ts
- `764e430` — feat(31-07): wire logger.ts + debug.ts + starter.ts to backend log transport
