---
phase: 106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s
plan: 03
subsystem: backend
tags: [tests, sse, birth-flow, supervisor, wait-poll, log-forensics]

# Dependency graph
requires:
  - phase: 106-01 (commit 8626dbc6, 934fae06)
    provides: retired step:3/4/5 orchestrator wire; new BirthDeps.discoverIdentitySessionFile injection point; widened BirthEvent.ended.reason; wait-for-supervisor poll block; SSE keepalive; exported sanitizeError helper
provides:
  - Test coverage refresh across the four backend birth test files reflecting the new Phase 106 wire (step:3/4/5 assertions removed; discoverIdentitySessionFile wired into every BirthDeps mock; new wait-poll happy-path / timeout / SSH-error tests; D-12 log-forensic breadcrumb preservation test; D-11 wire-parity SSE stream tests for both failure paths)
  - Rule 3 auto-fix: sanitizeError stub added to identity-birth.test.ts orchestrator mock so Test 4 (orchestrator throws) can exercise the outer-catch's reason-widened emit
affects: [106-04 (verification + downstream deploy — this plan closes the backend test-file gap that was expected to fail after 106-01 landed)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Test-side mock discipline: every BirthDeps construction site (orchestrator tests, sibling frontmatter/mxid tests, SSE route tests) must ship a happy-path discoverIdentitySessionFile stub or hang the wait-poll loop"
    - "Log-forensic assertion via vi.mock('utils/logger.js') + typed Mock reference to inspect databaseLogger.warn payload on operation-key identity_birth_supervisor_wait_timeout"
    - "Fake-timer discipline for the wait-poll loop: vi.runAllTimersAsync drains both Step 2's STEP_2_SLEEP_MS and the wait-block's 2s-cadence poll sleeps in a single tick"

key-files:
  created: []
  modified:
    - src/backend/database/routes/identity-birth-orchestrator.test.ts (Task 1)
    - src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts (Task 2)
    - src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts (Task 2)
    - src/backend/database/routes/identity-birth.test.ts (Task 2 + Rule 3 auto-fix on sanitizeError mock stub)

key-decisions:
  - "Test 15 (Step 5's /id name send-keys) DELETED rather than rewritten — the assertion has no successor under Phase 106; agent-supervisor.sh handles the /id first-turn and Skynet no longer participates. A comment marker was left in the file so a future reader knows why the test-number gap exists."
  - "Rule 3 auto-fix: sanitizeError stub added to identity-birth.test.ts's `vi.mock('./identity-birth-orchestrator.js', ...)` block. Plan 106-01 Task 2 widened the SSE route's outer-catch to call `sanitizeError(err)` — the mock had no stub, so Test 4's rejected-orchestrator path tripped on `undefined(err)` and the SSE frame never landed. Adding a real message-slice(0,200) stub closes this gap AND preserves the existing test's tolerance envelope."
  - "Test 4 (orchestrator throws → 500 or SSE-ended) is now GREEN under Plan 106-03; it was RED before this plan (confirmed via `git stash` bisect). Fix was inside my scope because it was blocking the plan's acceptance criteria (`vitest run` exit 0) on a file I was already editing — Rule 3 blocking-issue auto-fix."

patterns-established:
  - "When widening an SSE wire contract at the route layer (like Phase 106 Plan 106-01's D-11 reason-widening), sibling test files that mock the module MUST expose every newly-imported helper as a real function stub, not just the exports the test explicitly references — the mock's export surface is a contract with every consumer of the mocked module."

requirements-completed: [D-05, D-06, D-07, D-08, D-09, D-10, D-11, D-20]

# Metrics
duration: ~40min
completed: 2026-09-11
---

# Phase 106 Plan 106-03: backend birth test rewire — Summary

**Four backend test files updated to consume the new Phase-106 birth wire (steps 3/4/5 retired; wait-for-supervisor poll block; ended.reason field on failure); new wait-poll happy-path / timeout / SSH-error tests + D-12 log-forensic breadcrumb preservation test added to the orchestrator suite; D-11 wire-parity SSE tests added to the route suite; a Rule 3 auto-fix on the orchestrator mock (missing sanitizeError stub) unblocked a pre-existing Test 4 red.**

## Performance

- **Duration:** ~40 min (plan read + reads + edits + build + scoped tests + commits + summary)
- **Started:** 2026-09-11T17:02:00Z (approximate — first tool call)
- **Completed:** 2026-09-11T17:17:00Z
- **Tasks:** 2 (both `type="auto"`)
- **Files modified:** 4 (all four in-plan; zero source files touched — pure test-file plan)

## Accomplishments

- **step:3/4/5 assertions purged from all four backend test files.** `grep -c 'n: 3' <file>` returns 0 for every one of the four target files; same for `n: 4` and `n: 5`. `grep -c 'startHarnessOnIdentity' <file>` returns 0 for both orchestrator files. The retired-harness attack surface no longer has ANY green test pinning its old shape.
- **`discoverIdentitySessionFile` wired into every BirthDeps mock across all three orchestrator-consuming test files.** Default returns `"/mock/session.jsonl"` on the first call so happy-path tests exit the wait-poll immediately with success — no fake-timer dance needed for the majority of tests that don't care about the wait-block cadence.
- **Three new wait-poll tests added to the orchestrator suite (Tests A/B/C) plus one D-12 forensics test (Test D):**
  - **Test A** (`success on 3rd poll`): mock returns null twice then a path; asserts `ended:ok:true`, exactly 3 mock calls, discovery invoked with `(conn, identityName)`, step:6/7/8 breadcrumbs fire before ended.
  - **Test B** (`supervisor_wait_timeout after 120s of nulls`): mock always returns null; asserts `ended{ok:false, reason:'supervisor_wait_timeout'}`, ~60 mock calls (allow ±1 off-by-one), AND `databaseLogger.warn` fires on operation-key `identity_birth_supervisor_wait_timeout` with `identityKey/hostId/timeoutMs` payload — proves the log-forensic breadcrumb lands.
  - **Test C** (`SSH-error-during-poll → same timeout shape`): mock returns null throughout (matches the discover-identity-session-file.ts:319-321 fail-safe contract); asserts same terminal event as Test B; asserts NO step:N:failed event (the wait-poll timeout is NOT a step failure). Guards against a future refactor treating discovery errors as a hard-failure emit.
  - **Test D** (`D-12 forensics — step:6/7/8 breadcrumbs still emit`): literal `expect(events).toContainEqual({ type: "step", n: 6, phase: "started" })` shape assertions so grep-based acceptance-criteria guards catch this test explicitly. Ordering pin: all three step breadcrumb pairs fire before the `ended` event.
- **New D-11 wire-parity tests added to the SSE route suite (identity-birth.test.ts).** Two tests exercise the two distinct failure paths that both populate `ended.reason`:
  - Step-6 failure path: emits `admin_mint_failed` reason on `ended{ok:false, failedStep:6}` — asserts both `failedStep` AND `reason` are on the wire frame.
  - Wait-timeout path: emits `supervisor_wait_timeout` reason on `ended{ok:false}` with NO `failedStep` (the timeout isn't attributable to any single step). Both tests parse the SSE `data:` line back into JSON and assert on the parsed object shape.
- **Test 16 (call ordering) in role-frontmatter.test.ts REWRITTEN around the Phase 106 shape.** Old shape asserted tmux-new-session → writeMarkdownFileAtomic → mkdir/touch → hasTrustDialogAccepted → Enter train → /id name. New shape asserts path-mkdir → wakeups-mkdir + touch-handoff → writeMarkdownFileAtomic ordering AND explicitly asserts the four retired exec fragments (`tmux-new-session`, `hasTrustDialogAccepted`, `dangerously-skip-permissions`, `/id testkey` send-keys) DID NOT fire. Semantic invariant preserved: identity folder + files are created BEFORE any downstream step depends on them.
- **`identity-harness-start.test.ts` byte-untouched per D-20.** `git diff --stat` returns empty. The harness helper is still called by identity-clone.ts:632 (D-03), so its test suite stays intact.
- **Backend TS build stays green** — zero source files touched by this plan, only test files.

## Task Commits

1. **Task 1: retire step:3/4/5 assertions + add wait-for-supervisor tests** — `4c626136` (test)
2. **Task 2: update sibling birth tests for new wait-for-supervisor wire** — `341d3a21` (test)

_Executor does not commit metadata — orchestrator handles the final SUMMARY.md + STATE.md commit._

## Files Created/Modified

- `src/backend/database/routes/identity-birth-orchestrator.test.ts` — Task 1. File header comment rewritten to reflect the Phase 106 wire. New imports for `WAIT_FOR_SUPERVISOR_POLL_MS/WAIT_FOR_SUPERVISOR_TIMEOUT_MS` constants and for the mocked `databaseLogger`. Constants sanity block gained two new tests pinning the exported wait-block constants. Tests 6, 6b rewritten (Step 2 no longer opens tmux — assertions now target the `mkdir -p <path>` exec only). Tests 7, 8, 9, 10, 11, 12, 13, 14 DELETED (all pinned retired harness behavior). Test 18 rewritten (path normalization now inspects the bare `mkdir -p` exec since the tmux tail is retired). Test 1 event count 17 → 11; explicit assertion that steps 3/4/5 have ZERO events on the wire. Test 2 (local self-birth) event count 11 → 5 (Steps 6/7/8 also skipped on local branch per L1228). Four new Phase 106 tests (A, B, C, D) added to the same describe scope. `makeDeps` gained `discoverIdentitySessionFile` + `matrixCountUsersMatching` fields with happy-path defaults.

- `src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts` — Task 2. `makeDeps` gained `discoverIdentitySessionFile` field with happy-path default. Test 14 event count 17 → 11; expected step-numbers narrowed from [1..8] to [1, 2, 6, 7, 8]. Test 15 DELETED (Step 5's `/id name` send-keys retired). Test 16 (call ordering) rewritten (see Accomplishments above). Two `Step 3 never fires after Step 2 failure` guards updated to target Step 6 instead (semantic invariant preserved — "later steps don't fire on Step 2 failure").

- `src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts` — Task 2. `makeDeps` gained `discoverIdentitySessionFile` field with happy-path default. NO other changes — this file's step:N assertions were already limited to Step 6 (composeMxidLocalpart + deriveMxidWithOrdinal integration tests). All 22 tests pass unchanged in behavior.

- `src/backend/database/routes/identity-birth.test.ts` — Task 2 + Rule 3 auto-fix. Test 5's dep-key coverage extended to assert `d.discoverIdentitySessionFile` is a function. Two new D-11 wire-parity tests added at the end of the file (Step-6 failure path + wait-timeout path, both asserting the parsed SSE `ended` frame carries `reason`). Rule 3 auto-fix: added a `sanitizeError` function stub to the `vi.mock('./identity-birth-orchestrator.js', ...)` block — Plan 106-01 Task 2 widened the route's outer-catch to call `sanitizeError(err)`, but the mock had no stub, so Test 4's rejected-orchestrator path was tripping on `undefined(err)` and the SSE frame never landed. Real stub mirrors the orchestrator's implementation (message.slice(0, 200)).

- `src/backend/database/routes/identity-harness-start.test.ts` — UNCHANGED per D-20. `git diff --stat` returns empty. 13 tests still pass under `npx vitest run`.

## Test Results Per File

| File                                                                                       | Tests | Passed | Failed | Exit |
| ------------------------------------------------------------------------------------------ | ----- | ------ | ------ | ---- |
| src/backend/database/routes/identity-birth-orchestrator.test.ts                            | 46    | 46     | 0      | 0    |
| src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts           | 24    | 24     | 0      | 0    |
| src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts            | 22    | 22     | 0      | 0    |
| src/backend/database/routes/identity-birth.test.ts                                         | 25    | 25     | 0      | 0    |
| src/backend/database/routes/identity-harness-start.test.ts (untouched, verification only)  | 13    | 13     | 0      | 0    |
| **Combined 5-file scoped run**                                                             | 130   | 130    | 0      | 0    |

**Backend build:** `npm run build:backend` exits 0 (zero source files touched).

## Acceptance criteria verification (per plan)

### Task 1

| Criterion | Expected | Actual |
| --------- | -------- | ------ |
| `grep -c 'n: 3' identity-birth-orchestrator.test.ts` | 0 | 0 ✓ |
| `grep -c 'n: 4' identity-birth-orchestrator.test.ts` | 0 | 0 ✓ |
| `grep -c 'n: 5' identity-birth-orchestrator.test.ts` | 0 | 0 ✓ |
| `grep -c 'startHarnessOnIdentity' identity-birth-orchestrator.test.ts` | 0 | 0 ✓ |
| `grep -c 'supervisor_wait_timeout' identity-birth-orchestrator.test.ts` | ≥ 2 | 14 ✓ |
| `grep -c 'discoverIdentitySessionFile' identity-birth-orchestrator.test.ts` | ≥ 4 | 12 ✓ |
| `grep -c 'WAIT_FOR_SUPERVISOR' identity-birth-orchestrator.test.ts` | ≥ 2 | 11 ✓ |
| `grep -c 'n: 6' identity-birth-orchestrator.test.ts` (D-12) | ≥ 1 | 3 ✓ |
| `grep -c 'n: 8' identity-birth-orchestrator.test.ts` (D-12) | ≥ 1 | 3 ✓ |
| `npx vitest run identity-birth-orchestrator.test.ts` | exits 0 | exits 0 ✓ |

### Task 2

| Criterion | Expected | Actual |
| --------- | -------- | ------ |
| role-frontmatter: `grep -c 'n: 3'` | 0 | 0 ✓ |
| role-frontmatter: `grep -c 'n: 4'` | 0 | 0 ✓ |
| role-frontmatter: `grep -c 'n: 5'` | 0 | 0 ✓ |
| role-frontmatter: `grep -c 'discoverIdentitySessionFile'` | ≥ 1 | 2 ✓ |
| mxid-derivation: `grep -c 'n: 3'` | 0 | 0 ✓ |
| mxid-derivation: `grep -c 'discoverIdentitySessionFile'` | ≥ 1 | 1 ✓ |
| birth-route: `grep -c 'n: 3'` | 0 | 0 ✓ |
| birth-route: `grep -c 'reason'` | ≥ 1 | 14 ✓ |
| harness: `git diff --stat identity-harness-start.test.ts` | empty | empty ✓ |
| Scoped 3-file `npx vitest run` | exits 0 | exits 0 ✓ |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Add `sanitizeError` stub to identity-birth.test.ts orchestrator mock**

- **Found during:** Task 2 initial scoped run (`npx vitest run identity-birth.test.ts`)
- **Issue:** Test 4 (`orchestrator throws synchronously → 500 JSON, not SSE`) was failing with `expected '' to contain 'ended'` — the SSE response body was empty despite the test's tolerance envelope accepting either 500 JSON or SSE-with-ended. Root cause: Plan 106-01 Task 2 widened the birth route's outer-catch at identity-birth.ts:456-467 to call `sanitizeError(err)` for D-11 wire-parity on the safety-net ended:false emit. The test-file's `vi.mock('./identity-birth-orchestrator.js', ...)` block never exposed `sanitizeError` — so the outer-catch was calling `undefined(err)`, throwing again mid-catch, and the `res.write(...)` for the ended frame never fired. The response body was empty; the ended frame was lost on the wire.
- **Bisect confirmation:** `git stash && npx vitest run identity-birth.test.ts` showed the same failure BEFORE any of my Task 2 edits — this was a pre-existing gap left over from Plan 106-01 landing but not surfaced then (Plan 106-01 didn't run scoped vitest on this file).
- **Fix:** Added a real `sanitizeError` function stub inside the `vi.mock('./identity-birth-orchestrator.js', ...)` block — mirrors the orchestrator's `message.slice(0, 200)` implementation. Test 4 now passes; all 25 tests in the file pass.
- **Files modified:** src/backend/database/routes/identity-birth.test.ts
- **Verification:** `npx vitest run identity-birth.test.ts` exits 0 (25 pass / 0 fail); the fix is contained to the mock block and does not affect any other test in the file.
- **Committed in:** 341d3a21 (Task 2 commit, since I was already editing this file for Task 2's SSE stream-shape tests).
- **Scope rationale:** Rule 3 blocking — the plan's Task 2 acceptance criterion "Test command `npx vitest run ... identity-birth.test.ts` exits 0" would have failed on this pre-existing red WITHOUT my Task 2 edits closing it. Fixing was strictly required to meet acceptance. Fix is minimal (one function stub inside an existing mock block) and does not modify any source files or expand plan scope.

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking).

**Impact on plan:** The fix is strictly required to meet Task 2's `vitest run exits 0` acceptance criterion. No scope creep — the fix is confined to the mock block inside a file that Task 2 was already editing. No source-file changes.

## Issues Encountered

- **Bulk file rewrite required for Task 1.** Tests 6-14 in identity-birth-orchestrator.test.ts formed a contiguous block of harness-specific assertions (~530 lines) that all had to go together with a replacement block for the new Phase 106 shape. Used the head-middle-tail split-and-concat approach via `/tmp/head.ts + /tmp/middle.ts + /tmp/tail.ts` rather than a single massive Edit call — safer against off-by-one boundary errors and easier to review. Final `wc -l` went from 2242 lines → 2042 lines (net 200-line reduction; 441 deletions + 334 insertions per `git diff --stat`).

- **Fake-timer coordination in Test A (success on 3rd poll).** The wait-poll loop sleeps 2s between polls. Test A's mock returns null twice then a path on the 3rd call. `vi.runAllTimersAsync()` in a single call drains the whole cascade because the mock resolves synchronously in the same microtask — no explicit `advanceTimersByTimeAsync(WAIT_FOR_SUPERVISOR_POLL_MS * 3)` needed. This is cleaner than the plan's action-step suggestion because the loop's `await deps.discoverIdentitySessionFile(...)` resolves on the same tick the mock's `mockResolvedValueOnce` returns — no wall-clock waiting.

## User Setup Required

None — this plan installs zero new npm packages, adds zero new environment variables, and touches zero source files. Downstream deploy motion (per D-22) is orchestrator's remit and happens after the full Phase 106 arc lands.

## Next Phase Readiness

- **Ready for Plan 106-04 verification pass.** The backend test-file gap that Plan 106-01's SUMMARY predicted (21 failures across the four birth test files after the wire retirement) is now closed. All four test files pass; harness test file untouched; backend build green. The verifier can trust that any future regression on the retired step:3/4/5 harness surface OR the new wait-poll block will be caught by these tests.

- **Wave 2 parallelism preserved.** This plan touched only backend test files under `src/backend/database/routes/`. Plan 106-04 (parallel Wave 2) touches only frontend test files under `src/ui/sidebar/` — zero file overlap; commits landed cleanly on the shared branch.

- **Executor remit ends here per D-22.** No push, no deploy, no `docker build`, no `docker compose up` invoked. Container-mutation coordination (coord-room announce, git pull --rebase, full test suite gate, deploy motion) is the orchestrator's remit at ship time for the full Phase 106 arc.

## Verifier double-check callouts

- **Rule 3 auto-fix scope.** The `sanitizeError` stub added to identity-birth.test.ts's orchestrator mock is a real function (not just `vi.fn()`) mirroring the orchestrator's implementation. If the orchestrator's `sanitizeError` implementation changes in a future phase (e.g. to strip additional PII patterns), the test-mock stub will silently drift. Consider whether the test file should import the real function via `vi.importActual` for future-proofing — deferred as out of 106-03 scope.

- **Test 15 deletion (Step 5 `/id name` send-keys) in role-frontmatter.test.ts.** No successor test replaces it. The behavior it pinned (Skynet dispatching `/id <name>` via tmux send-keys after Enter train) is now agent-supervisor's job, so a functional-equivalent test would live in the supervisor's own test suite (out of Skynet's repo). Verify that agent-supervisor.sh's tests still cover the `/id <name>` first-turn dispatch after tmux launch — the coverage moved boxes, but should still exist somewhere in the fleet.

- **Fake-timer race in Test B (120s timeout).** Test B uses `vi.runAllTimersAsync()` after starting the birth. On a heavily-loaded CI, if the mock resolution introduces microtask ordering variance, the ±1 off-by-one call-count assertion (`≥ 59 && ≤ 61`) may be tight. If flaky on CI, widen the tolerance to ±2 (`≥ 58 && ≤ 62`) — recommend the verifier watch the first CI run of this test on a real Playwright pass for flakiness.

- **Optional keepalive-behavior test in identity-birth.test.ts.** Per Task 2 action step 3 ("Add ONE new keepalive-behavior test if the file has infrastructure"): SKIPPED. The file's httpPost helper collects the full response body via `res.on("data") ... res.on("end")` — it doesn't support timing-based inspection of the SSE stream mid-flight (which is what would be needed to observe the 30s `:keepalive` frame). Adding such infrastructure was out of scope for this test-refresh plan; the D-11 wire-parity tests I added (Step-6 failure + wait-timeout) cover the ended-frame contract the plan actually required. If keepalive-behavior test coverage is desired, it's a natural fit for Plan 106-04 or a follow-up quick that adds a proper SSE mid-flight consumer helper.

- **`matrixCountUsersMatching` added to makeDeps in identity-birth-orchestrator.test.ts.** The original file's `makeDeps` return object omitted this field even though BirthDeps requires it. TypeScript was silent because `makeDeps` had a return-type cast that widened to `BirthDeps` without strict checking. I added a happy-path default `{ ok: true, total: 0 }` for defense-in-depth so any test that opts into `poolPicked=true` behavior gets a sane default instead of crashing on `undefined`. This is additive and pre-existing behavior for tests that don't touch pool-picked is unchanged.

## Self-Check

- **File:** `.planning/phases/106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s/106-03-SUMMARY.md` created (this file).
- **Commit 4c626136** (Task 1) exists in `git log --oneline`.
- **Commit 341d3a21** (Task 2) exists in `git log --oneline`.
- **src/backend/database/routes/identity-birth-orchestrator.test.ts** modified in commit 4c626136 (334 insertions, 441 deletions per `git diff --stat`).
- **src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts** modified in commit 341d3a21.
- **src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts** modified in commit 341d3a21.
- **src/backend/database/routes/identity-birth.test.ts** modified in commit 341d3a21.
- **src/backend/database/routes/identity-harness-start.test.ts** UNCHANGED (`git diff --stat` returns empty).
- All 10 Task 1 acceptance-criteria greps return expected values.
- All 10 Task 2 acceptance-criteria greps return expected values (including the harness-untouched invariant).
- `npx vitest run` on the 4 in-scope files + the untouched harness file → 130 tests / 130 pass / 0 fail.
- `npm run build:backend` exits 0.

## Self-Check: PASSED

---
*Phase: 106-birth-flow-rework-chunk-3-retire-skynet-tmux-claude-launch-s*
*Completed: 2026-09-11*
