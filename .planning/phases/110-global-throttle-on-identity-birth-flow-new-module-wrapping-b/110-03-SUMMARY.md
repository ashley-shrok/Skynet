---
phase: 110-global-throttle-on-identity-birth-flow-new-module-wrapping-b
plan: "03"
subsystem: api
tags: [semaphore, throttle, concurrency, identity-birth, spawn-request, typescript, vitest]

requires:
  - "src/backend/identity-birth/global-throttle.ts — acquireBirthSlot + __resetForTests (Wave 1, commit 7dbeccc5)"

provides:
  - "src/backend/spawn-requests/worker.ts — processBirth acquires global birth slot at top with {source:'spawn-request', bypassQueueDepth:true, requestId:item.uuid}; releases in finally wrapping doBirth() helper (all return paths covered)"
  - "src/backend/spawn-requests/worker.test.ts — 2 new throttle integration tests: serialization (110-W-A, deferred-Promise) + bypass semantics (110-W-B, 10 parallel never reject)"

affects:
  - "110-04 (coordinator-instructions docs update — orthogonal, file-disjoint)"
  - "Any phase that invokes processBirth: now subject to global birth throttle"

tech-stack:
  added: []
  patterns:
    - "doBirth() inner helper: processBirth's public surface does acquire/try/finally, inner doBirth holds original body — avoids 250-line indentation shift while keeping finally wrapper small and readable"
    - "bypassQueueDepth:true for spawn-request path: disk-drop items already durable on disk; silently dropping on queue overflow is worse UX than piling up in memory"
    - "deferred-Promise pattern for serialization test: let resolveA; new Promise(r => resolveA = r) controls timing of birthIdentity across two parallel processBirth calls"
    - "__resetThrottleForTests() in beforeEach: gives each test a clean semaphore; re-reads process.env so env-mutating tests see updated config"

key-files:
  created: []
  modified:
    - src/backend/spawn-requests/worker.ts
    - src/backend/spawn-requests/worker.test.ts

key-decisions:
  - "doBirth() helper approach chosen over inline try/finally indentation shift: 250-line body would shift one tab right making the diff noisy; the hoisted helper keeps processBirth's acquire/release wrapper small and the diff readable"
  - "release() variable non-optional (unlike HTTP path in 110-02): bypassQueueDepth:true means acquireBirthSlot never rejects for spawn-request callers, so the release fn is always available"
  - "callOrder assertion fixed: opts.hostId used instead of opts.userId because userId in birthIdentity opts is derived from getHostOwnerUserId mock ('user-test'), not item.userId ('user-abc') — the test verifies routing via hostId which IS from item.hostIdNum"
  - "afterEach env-var restore registered inside test body (not at describe level) to scope cleanup to the one test that mutates env vars (110-W-B only)"

patterns-established:
  - "processBirth: acquire at very top, doBirth() in try/finally — pattern for any future spawn-request worker extension that needs to add pre-acquisition logic"

requirements-completed: []

duration: 12min
completed: "2026-09-13"
---

# Phase 110 Plan 03: Spawn-Request Worker Throttle Wiring Summary

**`acquireBirthSlot` wired into `processBirth` via inner `doBirth()` helper + finally-release covering all return paths, proven by 2 new integration tests (110-W-A FIFO serialization + 110-W-B bypass semantics) — all 31 tests passing.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-09-13T19:38:00Z
- **Completed:** 2026-09-13T19:50:00Z
- **Tasks:** 2 (committed atomically per task)
- **Files modified:** 2

## Accomplishments

### Task 1 — worker.ts wiring (`6c46d86c`)

- Import: `import { acquireBirthSlot } from "../identity-birth/global-throttle.js";`
- `processBirth` acquires at the very top (before the "processing birth" info log) with `{ source: "spawn-request", bypassQueueDepth: true, requestId: item.uuid }`
- Body hoisted into private `doBirth(item, deps)` helper; `processBirth` wraps the `await doBirth()` call in `try { } finally { release(); }` — all early-return paths inside `doBirth` (malformed short-circuit, pool_exhausted, matrix_creds_missing, host-owner null, locally-exhausted pool, no-ended-event, and both success/failure writes) fire their response-file writes BEFORE `release()` fires
- `release` variable is non-optional — `bypassQueueDepth:true` guarantees `acquireBirthSlot` never throws for this caller, so the `const release = await acquireBirthSlot(...)` pattern is safe without a null guard (contrast with 110-02's HTTP path which needs `let release: (() => void) | null`)
- `npx tsc --noEmit -p tsconfig.json`: zero new errors attributable to worker.ts

### Task 2 — worker.test.ts extension (`a0ed4911`)

- Import: `import { __resetForTests as __resetThrottleForTests } from "../identity-birth/global-throttle.js";`
- Module-scope constants capture original env values: `_origMaxConcurrent`, `_origMaxQueueDepth`
- `beforeEach` extended with `__resetThrottleForTests()` — clean semaphore + fresh config read for every test
- **Test 110-W-A** (`throttle integration (Phase 110) > Test 110-W-A: two parallel processBirth calls serialize under maxConcurrent=1`): deferred-Promise controls when A's `birthIdentity` resolves; asserts `callOrder` contains "A-birth-start" but NOT "B-birth-start" after microtask flush; resolves A; asserts final order `["A-birth-start","A-birth-end","B-birth-start","B-birth-end"]`
- **Test 110-W-B** (`throttle integration (Phase 110) > Test 110-W-B: bypassQueueDepth honored — 10 parallel processBirth calls never reject`): sets `IDENTITY_BIRTH_MAX_CONCURRENT=1`, `IDENTITY_BIRTH_MAX_QUEUE_DEPTH=2` then calls `__resetThrottleForTests()`; fires 10 parallel `processBirth` calls via `Promise.allSettled`; asserts 0 rejections, `birthIdentity` called 10 times, `writeMarkdownFileAtomic` called ≥ 10 times
- Test count: **29 → 31** (+2 new tests in `describe("throttle integration (Phase 110)", ...)`)
- Total test file: 999 lines (above 850 minimum)

## Wrap Approach: doBirth() Helper vs. Inline Indentation Shift

**Chosen: doBirth() helper.** The plan offered two options:

1. Inline — wrap the existing 250-line body in `try { } finally { }` directly, shifting indentation one level
2. Hoist — extract body into `const doBirth = async (...) => { <existing body> }`, call it from `try { await doBirth(); } finally { release(); }`

Option 2 was chosen because:
- The diff is much cleaner: 29 added lines (import + acquire + wrapper), zero indentation-only churn across 250 existing lines
- `processBirth`'s public surface stays small and legible: acquire, try, await doBirth, finally release
- Reviewers can see the acquire/release discipline at a glance without scrolling through 250 lines of pre-flight and loop logic

The plan explicitly noted: "Executor's call — pick whichever produces a cleaner code-review diff." Option 2 wins.

## Env-Var Mutation and Restore Discipline (Test 110-W-B)

- Module-scope `_origMaxConcurrent` / `_origMaxQueueDepth` capture original values before any test runs
- Only Test 110-W-B mutates these vars (sets `"1"` and `"2"` respectively)
- Restore is registered via `afterEach(() => { ... __resetThrottleForTests(); })` inside the test body, scoping cleanup to exactly this test
- The global `beforeEach` already calls `__resetThrottleForTests()`, so non-mutating tests always see the original default config (maxConcurrent=1, maxQueueDepth=100) without needing their own restore

## Microtask Flush Detail (Test 110-W-A)

The deferred-Promise serialization test needs several microtask flushes before asserting "A-birth-start" present / "B-birth-start" absent:

1. `processBirth(itemA)` → `acquireBirthSlot` (active=0 < 1) → grants synchronously → `active++` → enters `doBirth` → calls `birthIdentity`
2. `processBirth(itemB)` → `acquireBirthSlot` (active=1 >= 1) → enqueues as waiter → awaits waiter Promise
3. B's acquire resolves after A's `release()` fires (from `finally` after `doBirth` completes)

Four consecutive `await Promise.resolve()` flushes are sufficient for A to reach the `await deferredA` inside `birthIdentity`. After `resolveA()`, a `setTimeout(r, 20)` flush lets the remaining Promise chain drain completely (A's `birthIdentity` continuation → A's `writeResponseFile` → A's `doBirth` return → A's `finally` → `release()` → B's acquire resolves → B's `birthIdentity` runs synchronously → B's `writeResponseFile` → B's `doBirth` return).

## Task Commits

1. **Task 1: Wire acquireBirthSlot into processBirth** — `6c46d86c` (feat)
2. **Task 2: Throttle integration tests** — `a0ed4911` (test)

## Files Modified

- `src/backend/spawn-requests/worker.ts` — +29 lines: import, acquire block, doBirth helper declaration (body unchanged from original processBirth body)
- `src/backend/spawn-requests/worker.test.ts` — +169 lines: __resetThrottleForTests import, env-var save consts, afterEach import, beforeEach reset call, 2 new integration tests in `describe("throttle integration (Phase 110)", ...)`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed opts.userId assertion in Test 110-W-A**
- **Found during:** Task 2 first test run
- **Issue:** Test asserted `opts.userId === itemA.userId` ("user-abc"), but `birthIdentity`'s `opts.userId` is derived from `getHostOwnerUserId` mock which returns `"user-test"`. The plan spec says "assert first with itemA, then with itemB" — the correct per-item discriminator is `opts.hostId` (derived from `item.hostIdNum`), not `opts.userId`.
- **Fix:** Changed assertion to `opts.hostId === itemA.hostIdNum` / `opts.hostId === itemB.hostIdNum`, with an explanatory comment about the userId derivation.
- **Files modified:** `src/backend/spawn-requests/worker.test.ts`
- **Committed in:** `a0ed4911`

---

**Total deviations:** 1 auto-fixed (correctness — wrong opts field in test assertion)
**Impact on plan:** Minimal; test still proves A and B were called in the correct order with the correct host routing.

## Issues Encountered

None — TypeScript compiled clean, both tests passed on second attempt (after the opts.userId → opts.hostId fix).

## Acceptance Criteria Verification

- Import `acquireBirthSlot` from `../identity-birth/global-throttle.js`: YES
- Exactly one `acquireBirthSlot({` call site in worker.ts: YES
- All three fields present: `source: "spawn-request"`, `bypassQueueDepth: true`, `requestId: item.uuid`: YES
- `release();` invocation in finally block: YES
- Acquire before "processing birth" log (L286 < L309): YES
- `npx tsc --noEmit -p tsconfig.json` no new errors: YES
- No modification to `identity-birth-orchestrator.ts` or `spawn-requests/queue.ts`: YES
- `npx vitest run src/backend/spawn-requests/worker.test.ts` all 31 passing: YES
- Test names "Test 110-W-A" and "Test 110-W-B" in vitest verbose output: YES
- `__resetForTests` imported from global-throttle under alias: YES
- Test 110-W-A asserts exact order `["A-birth-start","A-birth-end","B-birth-start","B-birth-end"]`: YES
- Test 110-W-B asserts `birthIdentity` called exactly 10 times: YES

## Threat Flags

None — wiring is purely in-process; no new network endpoints, no new auth paths, no file access changes, no schema changes. The throttle acquire/release wraps existing SFTP writes that were already present.

## Known Stubs

None — all wiring is live. Both new tests exercise the real semaphore against real `processBirth` logic.

## Next Phase Readiness

- Both Wave 2 plans (110-02 HTTP + 110-03 spawn-request) are complete
- The global birth throttle is now active on both entry points into `birthIdentity()`
- 110-04 (coordinator-instructions docs update) is the remaining plan in this phase
- No blockers

## Self-Check: PASSED

- `src/backend/spawn-requests/worker.ts` modified with import + acquire + doBirth wrapper: YES
- `src/backend/spawn-requests/worker.test.ts` has 31 tests (29 + 2): YES
- Commit `6c46d86c` exists: YES
- Commit `a0ed4911` exists: YES
- `npx vitest run src/backend/spawn-requests/worker.test.ts` exit 0, 31/31: YES
- No changes to `identity-birth-orchestrator.ts` or `spawn-requests/queue.ts`: YES

---
*Phase: 110-global-throttle-on-identity-birth-flow-new-module-wrapping-b*
*Completed: 2026-09-13*
