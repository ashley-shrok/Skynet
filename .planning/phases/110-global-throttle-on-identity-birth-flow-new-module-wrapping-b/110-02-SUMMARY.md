---
phase: 110-global-throttle-on-identity-birth-flow-new-module-wrapping-b
plan: "02"
subsystem: api
tags: [throttle, concurrency, identity-birth, sse, 429, typescript, vitest]

requires:
  - "src/backend/identity-birth/global-throttle.ts — acquireBirthSlot + ThrottleRejectedError (Wave 1, commit 7dbeccc5)"

provides:
  - "src/backend/database/routes/identity-birth.ts — both POST / and POST /retry/:key handlers wrap orchestrator calls in acquireBirthSlot/release pair with 429-on-ThrottleRejectedError before SSE headers flush"
  - "src/backend/database/routes/identity-birth.test.ts — 2 new throttle integration tests: serialization (110-A) + 429-at-cap (110-B)"

affects:
  - "HTTP callers of POST /identities/birth: now subject to global birth throttle"
  - "HTTP callers of POST /identities/birth/retry/:key: same throttle discipline"
  - "110-03 (spawn-request wiring — orthogonal, file-disjoint)"

tech-stack:
  added: []
  patterns:
    - "acquireBirthSlot({source:'http'}) before res.flushHeaders() — 429 fast-fail with JSON body before SSE headers open"
    - "let release: (() => void) | null = null; try { release = await acquireBirthSlot(...) } catch { if (err instanceof ThrottleRejectedError) return 429 }"
    - "if (release) release() in outermost finally after res.end() — idempotent release guards against double-call"
    - "Deferred-Promise pattern for serialization test (makeDeferred + callOrder array)"
    - "Never-resolving mock + neverResolve() cleanup in afterEach for 429-at-cap test"

key-files:
  created: []
  modified:
    - src/backend/database/routes/identity-birth.ts
    - src/backend/database/routes/identity-birth.test.ts

key-decisions:
  - "acquire inserted AFTER getMatrixAdminCreds 503 gate: 503 means the box isn't ready at all — throttle gates on load, not foundational readiness"
  - "acquire inserted AFTER host-resolve 404 gate in retry route: bad hostId shouldn't wastefully hold a throttle slot"
  - "release called AFTER res.end() in finally: slot freed after all SSE frames flushed, before handler returns to Express"
  - "systemLogger added to logger mock: real global-throttle module imports systemLogger at module-init; the mock must export it to avoid vitest 'No export' error during module load"
  - "No vi.mock of global-throttle: integration test uses the real semaphore to prove end-to-end wiring; __resetForTests() provides clean-slate isolation"

requirements-completed: []

duration: 30min
completed: "2026-09-13"
---

# Phase 110 Plan 02: HTTP Handler Throttle Wiring Summary

**`acquireBirthSlot` wired into both POST `/identities/birth` and POST `/retry/:key` handlers — 429 JSON on `ThrottleRejectedError` BEFORE SSE headers flush — proven by 2 new integration tests (110-A serialization + 110-B 429-at-cap), all 29 tests passing.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-09-13T19:30:00Z
- **Completed:** 2026-09-13T19:36:00Z
- **Tasks:** 2 (committed atomically per task)
- **Files modified:** 2

## Accomplishments

### Task 1 — identity-birth.ts wiring (`7e46c75c`)

**POST `/` handler (lines ~330-345, ~535-540):**
- Acquire inserted at L~330: after `getMatrixAdminCreds()` 503 gate and BEFORE `res.setHeader("Content-Type", "text/event-stream")` at L~351 / `res.flushHeaders()` at L~355
- Release inserted in outermost `finally` at L~539: after `res.end()`, before handler returns
- 429 fast-fail: `res.status(429).json({ error: "identity_birth_queue_full", retry_after_ms: err.retryAfterMs })`

**POST `/retry/:key` handler (lines ~620-635, ~750-755):**
- Acquire inserted at L~620: after `resolveHostById` 404 gate and BEFORE `res.setHeader("Content-Type", "text/event-stream")` at L~640 / `res.flushHeaders()` at L~644
- Release inserted in outermost `finally` at L~754: after `res.end()`, before handler returns
- Same 429 fast-fail discipline

**Import:** Single import statement at file top pulls both `acquireBirthSlot` and `ThrottleRejectedError` from `../../identity-birth/global-throttle.js`.

### Task 2 — identity-birth.test.ts extension (`08750d08`)

- `import { __resetForTests as __resetThrottleForTests } from "../../identity-birth/global-throttle.js"` added (aliased to avoid collision)
- `systemLogger` added to the `vi.mock("../../utils/logger.js")` factory — the real `global-throttle.ts` module calls `systemLogger.info(...)` at init time; the mock must export it so vitest doesn't throw "No systemLogger export" during module load
- `__resetThrottleForTests()` called in global `beforeEach` — gives each test a clean semaphore
- Module-scope env-var save + `afterEach` restore for `IDENTITY_BIRTH_MAX_CONCURRENT`, `IDENTITY_BIRTH_MAX_QUEUE_DEPTH`, `IDENTITY_BIRTH_MIN_INTERVAL_MS`
- **Test 110-A** (`throttle integration > Test 110-A: three concurrent POST /identities/birth serialize under maxConcurrent=1`): deferred-Promise pattern (`makeDeferred()`) controls when each `birthIdentity` resolves; asserts `mockBirthIdentity.mock.calls.length === 1` after 50ms, `=== 2` after first resolve, `=== 3` after second resolve; final `callOrder` asserted `["aaa", "bbb", "ccc"]` (FIFO)
- **Test 110-B** (`throttle integration > Test 110-B: 429 at queue-depth cap with maxConcurrent=1 + maxQueueDepth=2`): sets env vars + calls `__resetThrottleForTests()` to take effect; never-resolving mock holds slot; fires 4 requests in sequence with 50ms gaps; asserts request #4 returns `status 429`, `Content-Type: application/json`, `body.error === "identity_birth_queue_full"`, `typeof body.retry_after_ms === "number"` and `> 0`; `neverResolve()` called in cleanup to drain pending requests
- Test count: **27 pre-existing → 29 (+ 2)**. Test file now 1239 lines.

## Why Acquire Sits BEFORE res.flushHeaders()

Once `res.flushHeaders()` fires, the HTTP response status is committed at `200 OK` with `Content-Type: text/event-stream`. A subsequent `res.status(429)` call would be silently ignored (headers already sent). The frontend's SSE consumer would receive a `200` with SSE frames — it has no clean way to detect a 429 embedded in the stream. By acquiring the slot BEFORE the headers flush, a rejected caller receives a genuine HTTP 429 with `Content-Type: application/json` and the `{ error, retry_after_ms }` body — a proper error response the frontend can route to its retry logic.

## Insertion Points (Line-Range References)

| Handler | Gate before acquire | Acquire line | SSE flush line | Release in finally |
|---|---|---|---|---|
| POST `/` | `getMatrixAdminCreds()` 503 gate (~L314-321) | ~L330 | `res.flushHeaders()` ~L355 | ~L539 after `res.end()` |
| POST `/retry/:key` | `resolveHostById` 404 gate (~L574-589) | ~L620 | `res.flushHeaders()` ~L644 | ~L754 after `res.end()` |

## Edge Cases Discovered

1. **`systemLogger` in logger mock** — The vitest `vi.mock("../../utils/logger.js")` factory in `identity-birth.test.ts` only exported `databaseLogger`, `sshLogger`, and `logger`. When `global-throttle.ts` is imported without being mocked, its module-init code calls `systemLogger.info(...)` — vitest throws `No "systemLogger" export is defined on the mock`. Fix: added `systemLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }` to the mock factory. [Rule 3 - Blocking] auto-fixed.

2. **env-var restore order in afterEach** — `afterEach` restores env vars BEFORE calling `await stopServer(server)`. This ensures the throttle env state is cleaned up even if `stopServer` throws. The `__resetThrottleForTests()` call in `beforeEach` re-reads env at the start of each test, so the restore order doesn't affect cross-test isolation — the reset at beforeEach is the definitive clean-slate moment.

3. **never-resolving mock cleanup** — The 110-B test holds a `neverResolve` reference and calls it in cleanup (before `Promise.all([pending1, pending2, pending3])`) to drain the pending requests. Without this, `afterEach`'s `stopServer` would timeout waiting for active connections to close.

## Acceptance Criteria Verification

- `acquireBirthSlot({` appears exactly 2 times: YES
- `if (release) release();` appears exactly 2 times: YES
- `error: "identity_birth_queue_full"` literal present: YES
- `retry_after_ms: err.retryAfterMs` literal present: YES
- Acquire before flushHeaders in both handlers (L337 < L355; L628 < L644): YES
- `npx tsc --noEmit -p tsconfig.json` reports no new errors on identity-birth.ts: YES
- No modifications to `identity-birth-orchestrator.ts` or `spawn-requests/queue.ts`: YES
- All 29 tests pass (27 pre-existing + 2 new): YES
- `__resetForTests` imported from global-throttle under alias: YES
- 429 test asserts `error === "identity_birth_queue_full"` and `typeof retry_after_ms === "number"`: YES

## Task Commits

1. **Task 1: Wire throttle into HTTP handlers** — `7e46c75c`
2. **Task 2: Throttle integration tests** — `08750d08`

## Files Modified

- `src/backend/database/routes/identity-birth.ts` — +53 lines: import block, 2 acquire blocks, 2 release calls in finally
- `src/backend/database/routes/identity-birth.test.ts` — +193 lines: systemLogger mock, env-var save/restore, __resetThrottleForTests call in beforeEach, 2 new integration tests (1239 total lines)

## Threat Flags

None — no new network endpoints, no new auth paths, no schema changes. The throttle wiring is pure in-process Express middleware logic; it does not open any new attack surface.

## Known Stubs

None — both handlers are fully wired. The throttle module is live and gate-enforcing. No placeholder paths.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] systemLogger missing from logger mock**
- **Found during:** Task 2 first test run
- **Issue:** `vi.mock("../../utils/logger.js")` factory did not export `systemLogger`. `global-throttle.ts` calls `systemLogger.info(...)` at module-init time (the `config = loadConfig()` line at module scope). Vitest threw `Error: [vitest] No "systemLogger" export is defined on the "../../utils/logger.js" mock` — test file failed to load.
- **Fix:** Added `systemLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }` to the mock factory. This is the minimal fix: the logger is stubbed out so the throttle module initializes cleanly without logging noise, while the real semaphore logic runs end-to-end.
- **Files modified:** `src/backend/database/routes/identity-birth.test.ts`
- **Committed in:** `08750d08`

---

**Total deviations:** 1 auto-fixed (blocking test-load failure)
**Impact on plan:** Minimal — one additional line in the logger mock factory. No scope change, no architectural impact.

## Self-Check: PASSED

- `src/backend/database/routes/identity-birth.ts` modified with 2 acquire + 2 release calls: YES
- `src/backend/database/routes/identity-birth.test.ts` has 29 tests (27 + 2): YES
- Commit `7e46c75c` exists: YES
- Commit `08750d08` exists: YES
- `npx vitest run src/backend/database/routes/identity-birth.test.ts` exit 0, 29/29: YES
- No changes to `identity-birth-orchestrator.ts` or `spawn-requests/queue.ts`: YES

---
*Phase: 110-global-throttle-on-identity-birth-flow-new-module-wrapping-b*
*Completed: 2026-09-13*
