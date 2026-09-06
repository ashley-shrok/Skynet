---
phase: 75-server-side-substrate-bootstrap-startup-driven-install-pass-
plan: 09
subsystem: testing
tags: [vitest, integration-test, substrate, server-substrate, orchestrator, fake-timers]

requires:
  - phase: 75-02
    provides: createServerSubstrateOrchestrator factory with startup pass + retry loop + persistent-failure alerting
  - phase: 75-03
    provides: listSubstrateHosts CSKEK-based session-less enumerator
  - phase: 75-05
    provides: substrate-orchestrator-singleton.ts with set/get/__reset exports
  - phase: 75-06
    provides: POST /host/db/host on-add fire-and-forget trigger via singleton

provides:
  - "End-to-end integration coverage proving the composed wire-up works: enumerator + orchestrator + sweep composer + log-tags + singleton all in one green run"
  - "I-STARTUP test: startup pass walks all hosts serially, marks successes done"
  - "I-RETRY test: 30s tick re-sweeps failures, skips already-succeeded hosts"
  - "I-PERSISTENT tests: loud alert fires exactly once at N=3 failures per host, per-host isolation"
  - "I-ON-ADD tests: POST route -> real singleton -> real orchestrator path exercises singleton round-trip and confirms response does not block"

affects: [75-10, future-phase-75-regression-detection]

tech-stack:
  added: []
  patterns:
    - "Integration test exec mock sentinel contract: channel.exec returns exact sentinel strings (__READ_ENOENT__, __WRITE_OK__, __RELOAD_OK__, EXIT:0, __SETTINGS_OK__, __CLEANUP_OK__) to avoid retryOnTransport setTimeout backoff blocking under fake timers"
    - "Fake-timer-safe exec mock: distinguish ENOENT (readOk:true, not transient) from transport (readOk:false, transient) to prevent retryOnTransport entering real-time sleep loops"
    - "Real singleton integration pattern: import substrate-orchestrator-singleton without vi.mock, call setSubstrateOrchestrator with real orchestrator, exercise getSubstrateOrchestrator in route handler"
    - "Manual tick capture: vi.fn setInterval captures the retry callback; tests call capturedTickFn!() directly to advance retry semantics without fake timer advanceByTime"

key-files:
  created:
    - src/backend/distributor/server-substrate-integration.test.ts
  modified: []

key-decisions:
  - "Exec mock sentinel contract: the single most load-bearing implementation decision. retryOnTransport has a backoffMs=200 setTimeout between retries; under fake timers that setTimeout never resolves unless vi.advanceTimersByTime is called. The fix is to return __READ_ENOENT__ (not empty string) for read-installed-bytes calls so readInstalledBytes returns {readOk:true, bytes:null} which is NOT transient — retryOnTransport exits immediately on the first try. An empty string return causes 'unknown shape -> transport failure' which IS transient, triggering the blocked setTimeout and a 30-second test timeout."
  - "Manual tick capture over vi.advanceTimersByTimeAsync: the retry interval callback was captured at setInterval-call-time via vi.fn and invoked directly (capturedTickFn!()) rather than advancing fake timers by 30000ms. This avoids racing with fake-timer internal state and gives precise control over when each tick fires."
  - "POST route handler invocation: mirrors host.test.ts pattern exactly — dynamic import of host.js router, walk router.stack to extract last handler for /db/host POST route, invoke with makePostReq+makeMockRes. The substrate-orchestrator-singleton is NOT mocked in this file so the real singleton state is used."
  - "acquireChannel slow-path for I-ON-ADD: setTimeout(500) inside acquireChannel is blocked by fake timers, confirming the HTTP response resolves before the sweep completes (elapsed < 100ms), while still allowing microtask draining to confirm acquireChannel was actually called."

patterns-established:
  - "Exec sentinel contract for integration tests under fake timers: document every caller's expected sentinel string in the channel mock"
  - "Real singleton integration test: set singleton with real orchestrator before invoking route handler"

requirements-completed: []

duration: 15min
completed: 2026-09-06
---

# Phase 75 Plan 09: Server-Substrate Integration Test Summary

**8-test integration suite proving the composed server-substrate wire-up: enumerator + orchestrator + sweep composer + log-tags + singleton all executing real code with mocks pushed to DB/SSH/filesystem boundary only**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-09-06
- **Tasks:** 1
- **Files created:** 1
- **Test suite runtime:** 424ms (well under 30s target)

## Accomplishments

- I-STARTUP (D-17): Two tests verify startup pass walks all 3 hosts serially in order, marks each done; also verifies mixed password/key-auth host handling
- I-RETRY (D-17): One test verifies 30s tick re-sweeps the failed host and does NOT re-sweep the already-succeeded host (once-per-lifetime gating)
- I-PERSISTENT (D-06): Two tests verify loud alert fires exactly once at N=3 failures per host, fires twice when two separate hosts each hit the threshold
- I-ON-ADD (D-18): Three tests — slow-sweep POST response timing, singleton round-trip, non-substrate POST does not trigger sweep

## Task Commits

1. **Task 1: Create end-to-end integration test suite** - `b21d491a` (test)

## Files Created

- `/home/ubuntu/skynet-tabitha/src/backend/distributor/server-substrate-integration.test.ts` — 1067 lines, 8 tests covering all four load-bearing D-17/D-18 behaviors

## POST Route Invocation Pattern

The I-ON-ADD block uses the same router-stack-walk invocation pattern as host.test.ts:
1. Dynamic `import("../database/routes/host.js")` (mocks in place first)
2. Walk `router.stack` to find route with `path === "/db/host"` and `methods["post"]`
3. Extract last handler in the middleware stack (after multer)
4. Invoke with `makePostReq` + `makeMockRes`

The key difference from host.test.ts: `substrate-orchestrator-singleton.js` is NOT vi.mocked here, so the real singleton state populated by `setSubstrateOrchestrator(orch)` is what the route handler reads via `getSubstrateOrchestrator()`.

## Behaviors Discovered Not in Unit Tests

Unit test 75-02 mocked `runSweepForHost` directly. The integration test revealed:

1. **Exec sentinel contract is the critical correctness invariant** for fake-timer safety: `runSweepForHost` -> `retryOnTransport` -> `readInstalledBytes` -> `channel.exec`. If exec returns an unrecognized string (not `__READ_ENOENT__` or `__READ_OK__`), `readInstalledBytes` returns `{readOk:false, reason:"transport"}` which IS transient, triggering `retryOnTransport`'s `setTimeout(200ms)` backoff. Under `vi.useFakeTimers()`, that setTimeout never resolves, causing 30-second test timeouts. This was the first composition-level failure found.

2. **run-bootstrap.ts makes 3 exec calls per host** (is-enabled check, daemon-reload, settings-patch, gsd-context-monitor cleanup — actually 4 in some paths), each with its own sentinel check. The integration test must mock all four sentinels correctly or `hadError=true` propagates through the sweep result.

3. **sweepOneHost microtask chain depth**: After `postHandler` resolves, reaching `acquireChannel` requires 5+ `Promise.resolve()` drains (queueMicrotask in route handler -> sweepOneHost async -> listSubstrateHosts await -> queueMicrotask for executeSweeForHost -> acquireChannel). Unit tests for the route handler mocked sweepOneHost directly and only needed 2 drains.

## Deviations from Plan

None — plan executed exactly as written. The exec sentinel design noted in the plan's docblock was implemented as specified. The test file is 1067 lines (≥250 required). All acceptance criteria satisfied.

## Issues Encountered

Initial test run produced 3 x 30-second timeouts due to the `retryOnTransport` + fake-timers interaction described above. Diagnosed by reading `run-sweep.ts:72-85` (retryOnTransport) and `ssh-push.ts:75-109` (readInstalledBytes sentinel dispatch). Fixed by changing the exec mock for read-installed-bytes commands from returning `""` (unknown shape -> transport) to returning `"__READ_ENOENT__"` (file absent -> readOk:true, not transient). All 8 tests then passed in 424ms.

## Next Phase Readiness

Phase 75 is complete. The integration test suite provides ongoing regression protection for the composed startup-pass + retry + persistent-failure-alert + on-add-trigger wire-up. Any future change that breaks the import paths, singleton scope, or microtask draining semantics will be caught by this suite.

---
*Phase: 75-server-side-substrate-bootstrap-startup-driven-install-pass-*
*Completed: 2026-09-06*
