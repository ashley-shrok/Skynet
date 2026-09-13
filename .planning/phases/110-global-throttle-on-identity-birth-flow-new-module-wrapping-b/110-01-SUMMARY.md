---
phase: 110-global-throttle-on-identity-birth-flow-new-module-wrapping-b
plan: "01"
subsystem: api
tags: [semaphore, throttle, concurrency, identity-birth, typescript, vitest]

requires: []

provides:
  - "src/backend/identity-birth/global-throttle.ts — Option-B counter+waiter-queue semaphore for per-process birth concurrency"
  - "acquireBirthSlot(ctx) Promise API returning idempotent release fn"
  - "ThrottleRejectedError class with retryAfterMs for HTTP 429 responses"
  - "__resetForTests() for isolated unit testing"
  - "Env-var config: IDENTITY_BIRTH_MAX_CONCURRENT, IDENTITY_BIRTH_MIN_INTERVAL_MS, IDENTITY_BIRTH_MAX_QUEUE_DEPTH, IDENTITY_BIRTH_EXPECTED_DURATION_MS"
  - "12 unit tests covering all semaphore correctness scenarios"

affects:
  - "110-02 (HTTP entry point wiring — identity-birth.ts)"
  - "110-03 (spawn-request entry point wiring — worker.ts)"
  - "any phase that integrates with acquireBirthSlot"

tech-stack:
  added: []
  patterns:
    - "Option-B counter+waiter-queue semaphore: active/waiters/waiters.shift() on release — mirrors host-semaphore-registry.ts::makeSemaphore but at per-process birth scope"
    - "active++ before min-interval setTimeout: concurrency-cap invariant holds during the delay window"
    - "idempotent release via captured local `released` flag per-acquire"
    - "env-var LOUD-warn on malformed + one-shot identity_birth_throttle_config_loaded log at module init"
    - "bypassQueueDepth flag for spawn-request path: never rejects on queue-depth overflow"

key-files:
  created:
    - src/backend/identity-birth/global-throttle.ts
    - src/backend/identity-birth/global-throttle.test.ts
  modified: []

key-decisions:
  - "Option B (counter+waiter-queue) chosen over Option A (Promise-chain): cleaner for maxConcurrent>1 future tuning, honest with the concurrency model, ~20 lines"
  - "active++ placed before min-interval setTimeout so concurrent acquires during the delay window correctly see active===maxConcurrent and queue (plan-checker concern #1)"
  - "retryAfterMs heuristic = waiters.length * expectedBirthDurationMs: imperfect rough estimate, sufficient for a 429 retry hint; can be tuned with empirical data later"
  - "bypassQueueDepth=true for spawn-request path: disk-drop items already live on disk so silently dropping them on queue overflow is worse UX than piling up in memory"

patterns-established:
  - "identity_birth_throttle_{wait,grant,release,reject,config_loaded} operation keys: all five structured-log keys established for grep-ability in console-forward.log"
  - "__resetForTests() re-reads env vars so tests that mutate process.env see updated config on next acquire"

requirements-completed: []

duration: 25min
completed: "2026-09-13"
---

# Phase 110 Plan 01: Global Birth Throttle Module Summary

**Option-B counter+waiter-queue semaphore (`global-throttle.ts`) with env-var config, FIFO waiting, min-interval spacing, bypassQueueDepth flag, and 12 passing vitest unit tests — self-contained, zero integration surface.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-13T19:05:00Z
- **Completed:** 2026-09-13T19:30:23Z
- **Tasks:** 2 (committed together at plan close per plan spec)
- **Files modified:** 2 (both new)

## Accomplishments

- New `src/backend/identity-birth/` folder created with the throttle module as its first inhabitant
- `acquireBirthSlot(ctx)` semaphore: concurrency cap enforced, FIFO waiter queue, min-interval spacing, queue-depth reject (HTTP) / bypass (spawn-request), idempotent release
- Four env vars with LOUD-warn-on-malformed + one-shot config-loaded log: `IDENTITY_BIRTH_MAX_CONCURRENT` (default 1), `IDENTITY_BIRTH_MIN_INTERVAL_MS` (default 0), `IDENTITY_BIRTH_MAX_QUEUE_DEPTH` (default 100), `IDENTITY_BIRTH_EXPECTED_DURATION_MS` (default 30000)
- 12 unit tests: all pass in 19ms wall-clock; no banned imports; no changes to queue.ts or identity-birth-orchestrator.ts

## Task Commits

Both tasks committed atomically as a single commit per plan spec ("Module + tests land together as one commit at plan close"):

1. **Tasks 1+2: global-throttle module + 12 unit tests** - `7dbeccc5` (feat)

## Files Created/Modified

- `src/backend/identity-birth/global-throttle.ts` — Option-B semaphore, exports `acquireBirthSlot`, `ThrottleRejectedError`, `__resetForTests`; only Skynet-specific import is `../utils/logger.js`
- `src/backend/identity-birth/global-throttle.test.ts` — 12 tests: concurrency cap, FIFO, maxConcurrent=2, queue-depth reject, bypassQueueDepth bypass, release idempotency, min-interval fake-timer spacing, state clearing, env malformed fallback, config-loaded log, grant log source/requestId, ThrottleRejectedError shape

## The Option-B Semaphore Mechanics

Chosen over Option A (Promise-chain, mirrors spawn-requests/queue.ts) because:
- Option B is closer to what a semaphore actually is — honest with the concurrency model
- `maxConcurrent > 1` is a plausible future knob (spawn-request + HTTP separate lanes); Option A would need a rewrite
- ~20 lines, no abstraction needed

Mechanics mirror `host-semaphore-registry.ts::makeSemaphore` (`active`/`waiters`/`waiters.shift()` on release) but the scope is per-process birth concurrency, not per-host SSH concurrency. Do NOT reuse or merge the two scopes.

## Env Vars + Defaults + Malformed Fallback

| Env var | Default | Min | Malformed action |
|---|---|---|---|
| `IDENTITY_BIRTH_MAX_CONCURRENT` | 1 | 1 | `systemLogger.warn` + op `identity_birth_throttle_env_malformed` + fallback to 1 |
| `IDENTITY_BIRTH_MIN_INTERVAL_MS` | 0 | 0 | same pattern, fallback to 0 |
| `IDENTITY_BIRTH_MAX_QUEUE_DEPTH` | 100 | 1 | same pattern, fallback to 100 |
| `IDENTITY_BIRTH_EXPECTED_DURATION_MS` | 30000 | 1 | same pattern, fallback to 30000 |

One-shot `identity_birth_throttle_config_loaded` info log fires at module init (and on every `__resetForTests()` call) showing resolved values — the operator grep target when "births are slow today."

## Structured-Log Operation Keys

| Key | Level | When |
|---|---|---|
| `identity_birth_throttle_wait` | info | Enqueuing because all slots busy (`reason: "concurrency"`) OR waiting for min-interval spacing (`reason: "min_interval"`) |
| `identity_birth_throttle_grant` | info | Slot handed to caller after any min-interval delay |
| `identity_birth_throttle_release` | info | `release()` fn called by caller; slot freed and next waiter (if any) unblocked |
| `identity_birth_throttle_reject` | warn | HTTP path rejected because `waiters.length >= maxQueueDepth` |
| `identity_birth_throttle_config_loaded` | info | Module init or `__resetForTests()` — shows all four resolved config values |
| `identity_birth_throttle_env_malformed` | warn | Fired once per malformed env var at load time |

## The `retryAfterMs` Heuristic

`retryAfterMs = waiters.length * expectedBirthDurationMs`

Imperfect: assumes all queued births take exactly `expectedBirthDurationMs` ms and that the rejected caller would be last in line. In reality births can take anywhere from 10s to 120s+ (supervisor wait). The value is a rough hint for the 429 body; the HTTP frontend should use it as a backoff floor, not a guarantee. Future refinement if empirical data shows the estimate is systematically off: track p95 birth duration in the release log and substitute it for the static default.

## Decisions Made

- Option B chosen over Option A (see above)
- `active++` before min-interval `setTimeout`: ensures concurrency-cap invariant holds during the delay window — a concurrent acquire that arrives during the pause sees `active === maxConcurrent` and queues correctly instead of racing into a second grant (plan-checker concern #1 addressed)
- `bypassQueueDepth: true` for spawn-request path: disk-drop items already live on disk; dropping them silently on overflow is worse UX than piling up in memory; HTTP path has no such guarantee so it gets the hard cap
- No changes to `spawn-requests/queue.ts` (orthogonal) or `identity-birth-orchestrator.ts` (out of scope per must-have 11/12)

## Deviations from Plan

### Auto-fixed Issues

**1. [Plan-checker concern #1 — Correctness] `active++` moved before min-interval `setTimeout`**
- **Found during:** Implementation review of Task 1 action spec vs. plan-checker concern #1
- **Issue:** Plan action placed `active++` after the min-interval delay. Plan-checker noted this breaks the concurrency-cap invariant: a second acquire arriving during the delay window would see `active < maxConcurrent` and enter a second grant path concurrently
- **Fix:** Moved `active++` to before the `sinceLastRelease` computation and any `setTimeout`, with an explanatory comment. All 12 tests still pass
- **Files modified:** `src/backend/identity-birth/global-throttle.ts`
- **Committed in:** `7dbeccc5`

---

**Total deviations:** 1 auto-fixed (correctness invariant)
**Impact on plan:** Required for correct semaphore behavior under concurrent load. No scope creep.

**2. Test 4 cleanup fix — serial release chain**
- **Found during:** Task 2 test run (first attempt timed out at 30s)
- **Issue:** Test 4 cleanup used `Promise.all([waiter1, waiter2]).then(fns => fns.forEach(fn => fn()))` — with `maxConcurrent=1`, `Promise.all` deadlocked because neither waiter could resolve until a slot was freed, but no slot was freed until both resolved
- **Fix:** Changed to serial `await waiter1 → release → await waiter2 → release` chain, which correctly lets each waiter unblock the next
- **Files modified:** `src/backend/identity-birth/global-throttle.test.ts`
- **Committed in:** `7dbeccc5`

## Issues Encountered

- `npx vitest run` failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'vite'` because `skynet-birch` workspace had no `node_modules` installed. Ran `npm install --prefer-offline` to install dependencies before running tests. This is an environment setup step, not a code issue.

## Pre-existing TSC Warnings

`npx tsc --noEmit -p tsconfig.node.json` reported zero errors attributable to the new file. Any pre-existing repo-wide warnings are unrelated to this plan.

## Threat Flags

None — module is purely in-process; no new network endpoints, no new auth paths, no file access, no schema changes. The throttle runs entirely in memory within the Skynet Node.js process.

## Known Stubs

None — module is fully implemented and self-contained. All env vars have documented defaults. No placeholder data, no TODO returns.

## Next Phase Readiness

- `acquireBirthSlot` is ready for Wave 2 integration into both HTTP and spawn-request entry points
- Wave 2 plans should import from `../identity-birth/global-throttle.js` (note `.js` extension per `moduleResolution: "nodenext"`)
- The `bypassQueueDepth: true` flag is the spawn-request caller's signal; the HTTP caller omits it (or passes `false`)
- Calling convention: `const release = await acquireBirthSlot({ source: "http" }); try { ... } finally { release(); }`

## Self-Check: PASSED

- `src/backend/identity-birth/global-throttle.ts` exists: YES
- `src/backend/identity-birth/global-throttle.test.ts` exists: YES
- Commit `7dbeccc5` exists: YES
- All 12 tests pass: YES (19ms wall-clock)
- No changes to queue.ts or identity-birth-orchestrator.ts: YES (git status shows only 2 new files)

---
*Phase: 110-global-throttle-on-identity-birth-flow-new-module-wrapping-b*
*Completed: 2026-09-13*
