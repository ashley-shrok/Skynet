---
phase: 50-optimistic-message-bubbles
plan: 04
subsystem: backend/claude-session
tags: [integration-tests, optimistic-bubbles, d-22, d-23, fake-timers, pv-send-watchdog, dedup, sha256, content-hash, adapt-not-delete]

# Dependency graph
requires:
  - phase: 50-01-PLAN.md
    provides: parseSessionLine queue-operation enqueue emission + __applyQueueDedupForTests seam + content-only sha256(content).slice(0,32) dedup Map key
  - phase: 50-02-PLAN.md
    provides: pv-send-watchdog three-stage escalation module + __applyInputMessageForTests widened seam + armPvSendWatchdog / notifyMatched / clearPvSendWatchdog / __resetPvSendWatchdogForTests exports + paste_send_failed / send_keys_error wire frames
  - phase: 50-03-PLAN.md
    provides: frontend optimistic-bubble state machine (consumer surface, cross-referenced by D-22(f) placeholder)
provides:
  - End-to-end integration test file covering 6 of 7 D-22 scenarios (a, b, c, d, e, g) with fake-timers + explicit millisecond assertions
  - D-22(f) placeholder skip block cross-referencing PrettyView.optimistic-bubbles.test.tsx Task 3b Test 14 for audit-trail traceability
  - Zero-hit grep gate for the Phase 50 audit patterns (armPvSubmitWatchdog / pvSubmitWatchdogs / COMPOSE-04 HARD LOCK / COMPOSE-04 / pv-adhoc) across the entire src/ tree — closes the D-23 adapt-not-delete audit
affects:
  - Phase 50 verification gate (independent verifier can now run the full suite as an end-to-end regression harness for the Phase 50 signal contract)

# Tech tracking
tech-stack:
  added: []  # zero new dependencies (uses node:crypto for computeContentHash + existing vitest fake-timers surface)
  patterns:
    - "Integration-test composition via source-of-truth seam wiring: pure-function seams (__applyInputMessageForTests + __applyQueueDedupForTests) plus a module-level state machine (pv-send-watchdog) plus a parser (parseSessionLine) compose without spinning up a WS server or SSH conn — mirrors the pattern established by claude-session-server.aside.integration.test.ts (Phase 14 Wave 5)"
    - "vi.useFakeTimers() + vi.advanceTimersByTimeAsync() for the full 20s watchdog escalation window — bounded time deltas (never vi.runAllTimersAsync which could infinite-loop on setInterval)"
    - "beforeEach + afterEach both call __resetPvSendWatchdogForTests to clear module-level Map state cleanly between scenarios — cross-test contamination mitigation (T-50-04-01)"
    - "Full logger mock surface (12 named exports) to prevent transitive-import failures from other backend modules that consume named loggers via re-exports (host-resolver.ts's `logger = systemLogger` re-export was the surfacing symptom)"

key-files:
  created:
    - src/backend/claude-session/claude-session-server.optimistic-bubbles.integration.test.ts (671 lines, 7 tests: 6 pass + 1 skip)
    - .planning/phases/50-optimistic-message-bubbles/50-04-SUMMARY.md
  modified:
    - src/backend/ssh/terminal-session-manager.ts (3 breadcrumb comments)
    - src/backend/ssh/terminal.ts (1 breadcrumb comment at former import site)
    - src/ui/shell/IdentitySessionPane.tsx (rationale-block comment)
    - src/ui/features/pretty-view/ComposeBox.test.tsx (test-file header comment)

key-decisions:
  - "TDD gate degeneracy for test-only tasks: Task 1 is TDD=true but ADDS ZERO production code — every seam it consumes was already shipped by Plans 50-01/50-02/50-03. Wrote the test file as a single test(...) commit; the RED/GREEN cycle collapses because no production behavior is added. Ran the file post-write to confirm all 6 scenarios pass as intended (which they did — the composition is correct end-to-end)."
  - "Full logger mock surface required. Initial vi.mock returned only 3 named exports (sshLogger, authLogger, databaseLogger) — vitest failed with 'No `logger` export is defined on the mock' because host-resolver.ts:8 does `const sshLogger = logger;` and the mock stripped the `logger` re-export. Expanded to all 12 named exports (systemLogger, apiLogger, fileLogger, statsLogger, tunnelLogger, dashboardLogger, guacLogger, versionLogger + logger + setGlobalLogLevel + getGlobalLogLevel) plus success() method on every logger. Pattern reusable for any future integration test that touches claude-session-server.ts."
  - "Watchdog arm time = split-send end time. __applyInputMessageForTests fires body then waits 250ms then fires Enter then arms the watchdog. All watchdog-relative timing assertions (T+2500ms retry, T+5500ms full-resend, T+20000ms escalation) are measured from AFTER the split-send completes — the outer test t=0 aligns with the input call, so watchdog timers fire at outer t=250+2500=2750ms / 250+5500=5750ms / 250+20000=20250ms. Test scenarios advance in per-stage deltas that account for the 250ms split-send offset."
  - "computeContentHash helper mirrors both the parser dedup key AND the watchdog arm-time key byte-for-byte. Content-only sha256(content).slice(0, 32) — no sessionId, no timestamp. Inline documentation cross-references 50-01-PLAN.md § objective 'Hash-derivation contract' so a future editor cannot accidentally 'improve' the derivation to include a session or timestamp component (which would silently break every scenario in the file)."
  - "Scenario (b)'s 2-minute enqueue→dequeue span uses vi.advanceTimersByTimeAsync(120_000 - 300) then a full 30s post-check advance. The exact 2-minute number is load-bearing per 50-CONTEXT.md § Empirical evidence — Warning #9 (checker iteration 1) revised the dedup key from a ±2-second bucket to content-only-with-10-min-TTL specifically because the empirical enqueue→dequeue span is ~2 minutes. Warning #10's re-verification requires this test to EXPLICITLY exercise the 2-minute span (not a synthetic 5-second span that would pass under either derivation)."
  - "D-22(f) latest-only rendering placeholder as it.skip. The scenario is a frontend-only concern (only the newest 'sending' pending shows spinner) and is fully covered by PrettyView.optimistic-bubbles.test.tsx Task 3b Test 14. Kept as it.skip (not deleted) so a grepper scanning for D-22 audit coverage finds a reference in this file with a pointer to the frontend test that owns the concern. Plan explicitly permits this pattern."
  - "D-23 grep gate takes precedence over descriptive breadcrumbs. Plans 50-02 and 50-03 both hit the same tension (Deviation #1 in each): their strict grep gates require zero hits for removed identifiers, but their breadcrumb comments literally quoted the old identifiers. This plan's Task 2 finishes the sweep by rewording every remaining breadcrumb to use descriptive language ('former submit-watchdog' / 'former local generation site' / 'prior HARD LOCK sweep') instead of quoting the removed identifiers. Zero code paths change; only comment wording. Semantics preserved."

patterns-established:
  - "Full logger mock template for integration tests that touch claude-session-server.ts (or any file that transitively imports named loggers through host-resolver.ts). Copy-paste template lives at the top of claude-session-server.optimistic-bubbles.integration.test.ts."
  - "Composition-test recipe for backend seams: (1) vi.useFakeTimers + __resetPvSendWatchdogForTests in beforeEach; (2) fire __applyInputMessageForTests to arm the pipeline; (3) advance past 250ms split-send; (4) advance to timing checkpoints (2500/5500/20000ms watchdog stages); (5) feed synthetic JSONL through simulateOnLine helper that mimics production onLine's parseSessionLine → __applyQueueDedupForTests → notifyMatched chain; (6) assert on exec/wsSend call counts and shape. Reusable for any future send-path integration coverage."
  - "D-22 scenario one-to-one test-block mapping: each D-22 letter gets one `it(...)` block whose title includes the letter — enables grep-based audit trail from CONTEXT.md decision list to test coverage."

requirements-completed: []  # Phase 50 has no formal REQ-ID mapping per 50-CONTEXT.md; coverage is against D-22 (7 scenarios) + D-23 (adapt-not-delete audit)

# Metrics
duration: ~30min
completed: 2026-08-20
---

# Phase 50 Plan 04: End-to-end integration tests + D-23 audit finish Summary

**Integration test file exercises all 7 D-22 scenarios (6 pass + 1 skip for the frontend-only D-22(f)) via composed backend seams under fake timers; D-23 audit gate finished by rewording residual breadcrumb comments so grep -rn 'armPvSubmitWatchdog|pvSubmitWatchdogs|COMPOSE-04 HARD LOCK|COMPOSE-04|pv-adhoc' src/ returns zero hits.**

## Performance

- **Duration:** ~30 minutes
- **Started:** 2026-08-20T16:14:58Z
- **Completed:** 2026-08-20T16:44:19Z
- **Tasks:** 2 (Task 1 as a single test-only commit; Task 2 as a single breadcrumb-sweep commit)
- **Files created:** 2 (integration test + this SUMMARY)
- **Files modified:** 4 (three breadcrumb-only files + one test-file header)

## Accomplishments

- **End-to-end proof that the Phase 50 signal contract composes.** Unit tests on each seam (parseSessionLine, __applyQueueDedupForTests, __applyInputMessageForTests, armPvSendWatchdog/notifyMatched) already covered their internal invariants. This plan verifies they cooperate: the content-only sha256(content).slice(0,32) hash derived by the parser dedup EQUALS the hash derived by the watchdog arm site EQUALS the hash derived by the notifyMatched call site. If any pair drifts, no unit test catches it — only an integration test does.
- **D-22 scenario coverage:** 6 backend-side scenarios (a, b, c, d, e, g) each get one `it(...)` block with explicit millisecond assertions under fake timers. Scenario (b) uses the empirical 2-minute enqueue→dequeue span from 50-CONTEXT.md § Empirical evidence to prove the Warning #9 dedup revision (content-only key + 10-min TTL) still holds — Warning #10's re-verification requirement satisfied.
- **Retry-fired-once invariant asserted.** Scenario (d) advances past T+2500ms (retry fires), then feeds a matching signal at T+3000ms; the assertion `expect(exec).toHaveBeenCalledTimes(3)` verifies the watchdog did NOT fire a second retry when the signal-during-retry-window scenario played out. This is the Fleet directive + D-06 discretion invariant.
- **paste_send_failed timing chain fully asserted.** Scenario (c) advances step-wise through T+2500 → T+5500 → T+20000ms and asserts the exact tmux commands at each stage: retry Enter (no -l), full-resend C-u + literal body + Enter, then the escalation frame `{type:'paste_send_failed', mqid:'m1', reason:'no_signal_after_full_resend'}`.
- **D-22(f) cross-reference preserved.** Latest-only rendering is a frontend concern — covered fully by PrettyView.optimistic-bubbles.test.tsx Task 3b Test 14. A placeholder `it.skip("(f) latest-only rendering — see PrettyView.optimistic-bubbles.test.tsx Task 3b Test 14", ...)` provides audit-trail traceability for greppers scanning the file for D-22 letter coverage.
- **D-23 audit finished.** Plans 50-02 and 50-03 both left residual breadcrumb comments literally quoting the removed identifiers — the grep gate had 7 remaining hits pre-Task-2. Rewording each breadcrumb (identifier-quoting → descriptive language) reduces the grep to ZERO hits across the entire src/ tree without changing any code paths. D-23's "adapt-not-delete" mandate is honored — every pre-existing test still passes; no test file was deleted by this plan.
- **Full-suite baseline maintained.** Full-repo `node_modules/.bin/vitest run` = 204 files / **2714 pass** / 10 skip / 1 todo, exit 0 (up +6 from Plan 50-03's 2708 baseline — 6 new integration tests + 1 new skip from D-22(f) placeholder). Backend build + full frontend build + tsc all exit 0.

## Task Commits

Each task was committed atomically on `feat/tab-title-from-tmux`:

1. **Task 1: integration test file for D-22 scenarios (a-g)** — `dee335e8` (test)
2. **Task 2: D-23 audit — remove residual banned-string breadcrumbs** — `bf1d1e55` (chore)

Plan metadata commit follows this SUMMARY (final commit — includes SUMMARY.md + STATE.md + ROADMAP.md).

## Files Created/Modified

- `src/backend/claude-session/claude-session-server.optimistic-bubbles.integration.test.ts` (NEW, 671 lines) — Integration test with 7 `it(...)` blocks under one describe. Full logger vi.mock (12 named exports) to prevent transitive-import failures. `computeContentHash` helper mirrors both Plan 50-01 T2 dedup key AND Plan 50-02 T1 watchdog arm key byte-for-byte. `makeEnqueueLine` + `makeUserTurnLine` helpers build JSONL that matches empirical Claude Code writer shapes. `simulateOnLine` helper mimics production onLine's parseSessionLine → __applyQueueDedupForTests → notifyMatched chain (~L3095-3160 in claude-session-server.ts). Scenario (b) advances the full 2-minute enqueue→dequeue span; scenario (c) walks all three watchdog stages with per-command assertions.
- `src/backend/ssh/terminal-session-manager.ts` — 3 breadcrumb comments reworded from `pvSubmitWatchdogs field REMOVED` / `pvSubmitWatchdogs detach cleanup REMOVED` / `pvSubmitWatchdogs destroy cleanup REMOVED` to `former submit-watchdog field REMOVED` / etc. Zero code changes.
- `src/backend/ssh/terminal.ts` — 1 breadcrumb comment at former import site reworded from `armPvSubmitWatchdog import REMOVED` to `former submit-watchdog import REMOVED`. Zero code changes.
- `src/ui/shell/IdentitySessionPane.tsx` — rationale block reworded to describe "the former local generation scheme" and "the previous local generation site" instead of quoting the removed `pv-adhoc-<uuid>` identifier. Zero code changes.
- `src/ui/features/pretty-view/ComposeBox.test.tsx` — one describe-block header comment reworded from `COMPOSE-04 sweep is verified` to `prior HARD LOCK sweep is verified`. Zero test-behavior changes.

## Decisions Made

- **Task 1 written as a single `test(...)` commit, not a TDD RED/GREEN pair.** The task is marked `tdd="true"` in the plan, but ADDS ZERO production code — every seam it consumes (parseSessionLine, __applyQueueDedupForTests, __applyInputMessageForTests, armPvSendWatchdog, notifyMatched, clearPvSendWatchdog, __resetPvSendWatchdogForTests) was already shipped by Plans 50-01/50-02/50-03. The TDD RED/GREEN cycle degenerates for pure test-only tasks because there is no production behavior to write between the RED and GREEN gates. Ran the file post-write to confirm all 6 scenarios pass as intended (Task 1's whole purpose is to prove the composition is correct end-to-end — which it is).
- **Full logger vi.mock surface (12 named exports).** First attempt with only sshLogger + authLogger + databaseLogger failed at import time: `[vitest] No "logger" export is defined on the "../utils/logger.js" mock`. Root cause: `src/backend/ssh/host-resolver.ts:8` re-exports `logger = systemLogger` and claude-session-server.ts transitively imports host-resolver. Expanded the mock to include every named export from logger.ts (sshLogger, authLogger, databaseLogger, apiLogger, systemLogger, fileLogger, statsLogger, tunnelLogger, dashboardLogger, guacLogger, versionLogger, logger, setGlobalLogLevel, getGlobalLogLevel) with a shared `makeLogger()` helper. This pattern is reusable for any future integration test that touches claude-session-server.ts.
- **Watchdog arm time = split-send END time, not START time.** __applyInputMessageForTests fires body, waits 250ms, fires Enter, THEN arms the watchdog. All test scenarios advance in per-stage deltas that account for this 250ms offset. Scenario (c) example: outer test t=0 fires input; t=250ms body+Enter complete + watchdog arms; t=2750ms retry Enter fires (250+2500); t=5750ms full-resend fires (250+5500); t=20250ms paste_send_failed fires (250+20000). Documented inline in each scenario's step comments to prevent a future editor from "fixing" the arithmetic.
- **Scenario (b) advances 120000 - 300 ms between enqueue and dequeue, not exactly 120000ms.** The 300ms accounts for the split-send offset (250ms) + the parser signal offset used in the test (50ms after split-send completes). The load-bearing property is "the dequeue happens ~2 MINUTES after the enqueue" — the exact-to-the-millisecond number is unimportant as long as it's much larger than the ±2-second bucket that the pre-Warning-#9 dedup would have needed. Warning #10 re-verification is preserved.
- **it.skip for D-22(f), not deletion.** The frontend-only concern is fully covered by PrettyView.optimistic-bubbles.test.tsx Task 3b Test 14. Kept as it.skip with a clear cross-reference title + inline pointer so a grepper scanning this file for all 7 D-22 letters finds a placeholder that redirects to the frontend test. Plan explicitly permits this pattern (Task 1 § behavior: "Add a placeholder it.skip(...) for D-22 audit-trail traceability").
- **Task 2 breadcrumb rewording strategy: descriptive language instead of identifier quoting.** Same tension pattern as Plan 50-02 Deviation #1 and Plan 50-03 § Decisions Made (COMPOSE-04 sweep). The grep gate is load-bearing — it proves no code path calls the removed identifiers. Breadcrumbs serve documentation; identifier-quoting is one of many ways to write a breadcrumb. Replaced every hit with descriptive language ("former submit-watchdog" / "former local generation site" / "prior HARD LOCK sweep") that preserves the intent (a future reader knows what was here + where the replacement lives) without failing the grep gate.

## Deviations from Plan

None substantive — plan executed as written. Three minor procedural notes:

1. **Task 1 committed as a single `test(...)` commit, not a TDD RED+GREEN pair.** Documented in Decisions Made above. Rationale: the task ADDS ZERO production code; every consumed seam was already shipped by prior plans in the phase. The TDD RED/GREEN cycle degenerates for pure test-composition tasks. This matches the exception noted implicitly in the executor's `<tdd_execution>` section — RED phase MUST fail before GREEN, but if the test is written correctly and all seams exist, the "failure-first" gate doesn't apply because there is no new production behavior to gate.

2. **Task 2's scope expanded to include 1 file NOT listed in the plan's `<files>` metadata.** The plan's Task 2 `<files>` line was `src/backend/claude-session/claude-session-server.compose-send.test.ts` — but the actual audit swept 5 files: terminal-session-manager.ts (3 breadcrumbs), terminal.ts (1 breadcrumb), IdentitySessionPane.tsx (1 rationale block), ComposeBox.test.tsx (1 test-file header comment), AND the new integration test file itself (1 D-23 audit-note comment). All five had residual banned-string breadcrumbs from Plans 50-02 / 50-03 that Task 2's strict grep gate required to reach zero. Not a substantive deviation — the plan's `<action>` step 1 says "enumerate every hit in .test.ts/.test.tsx files", and step 2 says "adapt each test-file hit" — but the audit gate itself applies across the WHOLE src/ tree, so source-file breadcrumbs also needed to reach zero. Same pattern as Plan 50-03 Deviation #3 (test-file pv-adhoc rename scope expansion).

3. **compose-send.test.ts (the file explicitly listed in Task 2's `<files>` metadata) required no changes.** Its post-50-02/50-03 state already used `"pv-test-mqid-*"` placeholders (renamed by Plan 50-03 Task 4 test-file hygiene pass). Verified by targeted grep + full-run passing.

## Issues Encountered

- **First `vitest run` on the new integration test file failed at import time** with `[vitest] No "logger" export is defined on the "../utils/logger.js" mock`. Root cause + fix documented in Decisions Made above (full 12-export mock template).
- **Two `it.skip` grep hits initially instead of the required 1.** My placeholder scenario's inline comment described the pattern with the phrase "placeholder it.skip for D-22 audit-trail traceability" — the grep target for the acceptance criterion was `grep -c 'it.skip'` which counted the literal string in the comment too. Reworded the comment to avoid the substring while preserving the meaning ("Deliberately skipped (not deleted) per Plan 50-04 Task 1 § action — a placeholder scenario provides D-22 audit-trail traceability"). Grep now returns exactly 1.
- **Third audit-grep hit in my own new test file's D-23 note.** After Task 2's breadcrumb sweep across the 5 pre-existing files, `grep -rn 'armPvSubmitWatchdog|pvSubmitWatchdogs|COMPOSE-04 HARD LOCK|COMPOSE-04|pv-adhoc' src/` reported one remaining hit — in my own new integration test file's D-23 audit-note comment which happened to quote both `COMPOSE-04 sweep` and `pv-adhoc rename` while describing what Plan 50-03 had done. Reworded to "prior HARD LOCK sweep + mqid-arg update + local-mqid rename" — same intent, no banned strings. Included in the Task 2 commit's file list.

## User Setup Required

None — no external service configuration required. Zero new dependencies. Zero deploy or infrastructure changes.

## Next Phase Readiness

- **Phase 50 code complete.** All 4 plans (50-01 backend parser + dedup, 50-02 backend watchdog + wire frames, 50-03 frontend state machine + Blocker #4 fix, 50-04 integration tests + D-23 audit finish) shipped code + tests green on `feat/tab-title-from-tmux`. Full-suite baseline 2714 pass / 10 skip / 1 todo, exit 0. Backend build + frontend build + tsc all exit 0.
- **Phase 50 verification is now unblocked.** An independent verifier can run `node_modules/.bin/vitest run src/backend/claude-session/claude-session-server.optimistic-bubbles.integration.test.ts` as the primary regression harness for the Phase 50 signal contract; the file's 6 pass + 1 skip is the canonical acceptance signal. Individual seam coverage lives in pv-send-watchdog.test.ts (11 tests), claude-session-server.compose-send.test.ts (17 tests including the 6 Phase 50 additions), claude-session-server.queue-dedup.test.ts (8 tests), session-file-parser.test.ts (66 tests including the 9 Phase 50 additions), and PrettyView.optimistic-bubbles.test.tsx (17 frontend tests including the D-22(f) latest-only Test 14 cross-referenced from this plan).
- **NO worktrees. NOT pushed. NOT built container. NOT deployed.** Executor scope ends at code + commit + tests green per the sequential-executor contract. Orchestrator handles the ship coordination (Ashley approved shipping the full Phase 50 bundle at end of phase — plus the two pre-existing unpushed commits `38eadffb` identity forceSave + `1e45b73a` context-meter diag from before the phase started).

## Self-Check: PASSED

All claimed files exist:
- `.planning/phases/50-optimistic-message-bubbles/50-04-SUMMARY.md` — this file
- `src/backend/claude-session/claude-session-server.optimistic-bubbles.integration.test.ts` — created (671 lines, 7 tests)
- `src/backend/ssh/terminal-session-manager.ts` — modified (3 breadcrumbs reworded)
- `src/backend/ssh/terminal.ts` — modified (1 breadcrumb reworded)
- `src/ui/shell/IdentitySessionPane.tsx` — modified (rationale block reworded)
- `src/ui/features/pretty-view/ComposeBox.test.tsx` — modified (1 test-file header comment reworded)

All claimed commits exist on `feat/tab-title-from-tmux`:
- `dee335e8` test(50-04): integration tests for optimistic bubbles (D-22 scenarios a-g)
- `bf1d1e55` chore(50-04): D-23 audit — remove residual banned-string breadcrumbs

Verification commands all pass:
- `node_modules/.bin/vitest run src/backend/claude-session/claude-session-server.optimistic-bubbles.integration.test.ts` → 6 pass + 1 skip, exit 0
- `node_modules/.bin/vitest run src/backend/` → 88 files / 1199 pass, exit 0
- `node_modules/.bin/vitest run src/ui/` → 116 files / 1515 pass / 9 skip / 1 todo, exit 0
- `node_modules/.bin/vitest run` (full repo) → 204 files / 2714 pass / 10 skip / 1 todo, exit 0
- `npm run build:backend` → exit 0
- `npm run build` → exit 0
- `node_modules/.bin/tsc --noEmit` → exit 0
- `grep -rn 'armPvSubmitWatchdog|pvSubmitWatchdogs|COMPOSE-04 HARD LOCK|COMPOSE-04|pv-adhoc' src/` → ZERO hits (grep exit code 1)
- `grep -Ec 'it(\.skip)?\(' src/backend/claude-session/claude-session-server.optimistic-bubbles.integration.test.ts` → 7 (one per D-22 scenario)
- `grep -c 'it.skip' src/backend/claude-session/claude-session-server.optimistic-bubbles.integration.test.ts` → 1 (only the D-22(f) placeholder)
- `grep -Ec 'armPvSendWatchdog|__applyInputMessageForTests|__applyQueueDedupForTests|parseSessionLine|notifyMatched|__resetPvSendWatchdogForTests' src/backend/claude-session/claude-session-server.optimistic-bubbles.integration.test.ts` → 47 hits (all six seam identifiers exercised)
- `grep -n 'function computeContentHash' src/backend/claude-session/claude-session-server.optimistic-bubbles.integration.test.ts` → 1 hit with signature `(content: string)` (content-only derivation, not eventId form)
- `grep -c 'paste_send_failed' src/backend/claude-session/claude-session-server.optimistic-bubbles.integration.test.ts` → 15 (positive assertion in c; negative assertions in a/b/d/e)

---
*Phase: 50-optimistic-message-bubbles*
*Completed: 2026-08-20*
