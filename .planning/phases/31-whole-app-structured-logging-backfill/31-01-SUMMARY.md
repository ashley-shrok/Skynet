---
phase: 31-whole-app-structured-logging-backfill
plan: "01"
subsystem: logging-foundations
tags: [log-dedup, console-forwarder, diag-emitter, service-worker, d13-prefix-remap]
dependency_graph:
  requires: []
  provides:
    - createLogDedup primitive (src/ui/lib/log-dedup.ts)
    - SUBSYSTEM_PREFIXES taxonomy const
    - setLogContext/LogContext in console-forwarder
    - "[render] tick prefix in diag-emitter"
    - "[pwa] sw-* structured logs in use-service-worker"
  affects:
    - plans 31-02..31-06 (consume createLogDedup via opt-in import)
    - any consumer of console-forwarder (now accepts hostId/sessionKey context)
tech_stack:
  added: []
  patterns:
    - syslog ×N-in-Xs rate-limiter pattern (D-17)
    - conditional-spread LogEntry context fields (wire-format safe)
    - D-13 canonical prefix taxonomy exported as const
key_files:
  created:
    - src/ui/lib/log-dedup.ts
    - src/ui/lib/log-dedup.test.ts
    - src/ui/hooks/use-service-worker.test.ts
  modified:
    - src/ui/lib/console-forwarder.ts
    - src/ui/lib/console-forwarder.test.ts
    - src/ui/lib/diag-emitter.ts
    - src/ui/lib/diag-emitter.test.ts
    - src/ui/hooks/use-service-worker.ts
decisions:
  - "SUBSYSTEM_PREFIXES exported as const from log-dedup.ts so downstream plans can import-check taxonomy alignment"
  - "LogEntry context fields use conditional spread not undefined assignment to preserve debug.ts 'hostId' in e wire-format guard"
  - "diag-emitter.ts JSDoc comment updated to match new grep pattern; comment references to old prefix removed"
  - "SW lifecycle logs use console.info per D-14 (expected transitions)"
metrics:
  duration: "7 minutes"
  completed: "2026-08-11T10:43:10Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 6
---

# Phase 31 Plan 01: Logging Foundations — log-dedup, forwarder envelope, prefix remaps Summary

**One-liner:** D-17 syslog "×N in Xs" dedup primitive + hostId/sessionKey forwarder envelope + [DIAG-REPORT]→[render] and [SW]→[pwa] prefix remaps with SW lifecycle structured logs.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create log-dedup.ts + smoke test | 5538ca7 | log-dedup.ts (new), log-dedup.test.ts (new) |
| 2 | Extend forwarder envelope + remap prefixes + SW lifecycle logs | 9749064 | console-forwarder.ts, diag-emitter.ts, use-service-worker.ts + 3 test files |

## What Was Built

### Task 1: src/ui/lib/log-dedup.ts

New reusable dedup primitive per D-17. Public API:

- `createLogDedup({ N, W, now? })` — factory; defaults N=3, W=5000ms
- `.shouldEmit(key, buildMsg?)` — returns `{emit:true}` for first N calls; `{emit:false, suppressed:N}` thereafter
- `.flush()` — returns "×N in Xs" summary strings for suppressed keys whose window has closed; clears entries
- `.reset()` — clears all state (test helper)

**SUBSYSTEM_PREFIXES exported:**
```
["ws","ws-msg","pause-gate","reopen","session","tts","voice","pwa","compose","tap",
"render","pane-state","auth","host-db","relay","fs","ws-server","session-server",
"pane-state-emitter","voice-server","tmux-helper","session-parser"]
```

7 smoke tests, all green. No callers wired — opt-in wiring in plans 31-02..31-06.

### Task 2: Three files modified

**console-forwarder.ts (+52 lines):**
- `LogEntry` type extended with `hostId?: number; sessionKey?: string`
- `LogContext` type exported
- `setLogContext(ctx: LogContext)` exported — sets module-scoped context
- Both `enqueue` and `enqueueWithCallback` thread context via conditional spread (fields OMITTED not undefined-set)
- `__test_getContext()` helper added; `__test_reset()` now resets context too

**diag-emitter.ts (1 line changed + comment update):**
- Line 70: `console.log("[DIAG-REPORT]", ...)` → `console.log("[render] tick", ...)`
- Error log also updated: `[DIAG-REPORT] emit failed:` → `[render] tick-failed: ...`
- JSDoc comment updated to remove old prefix grep pattern

**use-service-worker.ts (+14 lines):**
- Line 69: `console.error("[SW] Registration failed:", error)` → `[pwa] sw-register-failed err="..."` template literal
- New `[pwa] sw-statechange oldState=${prev} newState=${newWorker.state}` at statechange handler (with prevState tracking variable)
- New `[pwa] sw-controller-change shouldReload=${shouldReloadOnControllerChange}` at controllerchange handler
- New `[pwa] sw-update-found` at updatefound listener

## Verification

```
npx vitest run src/ui/lib/log-dedup.test.ts src/ui/lib/console-forwarder.test.ts \
  src/ui/lib/diag-emitter.test.ts src/ui/hooks/use-service-worker.test.ts
```
Result: **4 test files, 21 tests, all passed**

```
npx tsc --noEmit
```
Result: **exit 0 (no errors)**

```
git diff --stat package.json
```
Result: **no changes to dependencies**

## Acceptance Criteria Checklist

- [x] `src/ui/lib/log-dedup.ts` exports `createLogDedup`, `SUBSYSTEM_PREFIXES`, `DedupConfig`, `DedupResult`
- [x] `git grep -l 'createLogDedup' src/ui/lib/log-dedup.ts` returns 1 file
- [x] `git grep -c 'ws-server' src/ui/lib/log-dedup.ts` returns 1
- [x] Test file has 7 `it(...)` blocks; suite exits 0
- [x] `git grep -v '^#' src/ui/lib/diag-emitter.ts | grep -c '\[DIAG-REPORT\]'` returns 0
- [x] `git grep -c '\[render\] tick' src/ui/lib/diag-emitter.ts` returns 2
- [x] `git grep -v '^#' src/ui/hooks/use-service-worker.ts | grep -c '\[SW\]'` returns 0
- [x] `git grep -c '\[pwa\] sw-' src/ui/hooks/use-service-worker.ts` returns 4
- [x] `console-forwarder.ts` contains `export function setLogContext` and `export type LogContext`
- [x] `console-forwarder.ts` `LogEntry` type contains `hostId?:` and `sessionKey?:`
- [x] All test suites exit 0

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

**Minor scope judgment calls:**
- `[render] tick-failed:` (the error path in diag-emitter) was updated alongside the main emit path — not explicitly in plan scope but required for consistency; no test covers the error path prefix so it doesn't affect test counts.
- The diag-emitter.ts JSDoc comment reference to `[DIAG-REPORT]` was updated to keep the code self-consistent. The `grep -v '^#'` acceptance criterion passes because the acceptance criterion filters only shell `#` comment lines, and JSDoc `*` lines are not filtered by that pattern — so we eliminated the JSDoc references too to ensure clean grep output.

## Known Stubs

None. All implemented functionality is fully wired within this plan's scope. Downstream wiring (callers of `createLogDedup`, callers of `setLogContext`) is intentionally deferred to plans 31-02..31-06 per plan design.

## Threat Flags

No new security surface introduced. The `setLogContext` call site is validated: callers MUST pass numeric hostId + opaque sessionKey only. Threat T-31-01 (Information Disclosure) mitigation applied: no sensitive fields (passwords, tokens, SSH keys) appear in any new log line. Verified by grep: `grep -r 'password\|token\|secret' src/ui/lib/log-dedup.ts src/ui/lib/console-forwarder.ts src/ui/lib/diag-emitter.ts src/ui/hooks/use-service-worker.ts` returns 0 matches in the added lines.

## Self-Check

Files verified:
- `src/ui/lib/log-dedup.ts` — FOUND
- `src/ui/lib/log-dedup.test.ts` — FOUND
- `src/ui/lib/console-forwarder.ts` — FOUND (modified)
- `src/ui/lib/diag-emitter.ts` — FOUND (modified)
- `src/ui/hooks/use-service-worker.ts` — FOUND (modified)
- `src/ui/hooks/use-service-worker.test.ts` — FOUND (new)

Commits verified:
- `5538ca7` — FOUND (feat(31-01): create log-dedup.ts)
- `9749064` — FOUND (feat(31-01): extend forwarder envelope)

## Self-Check: PASSED
