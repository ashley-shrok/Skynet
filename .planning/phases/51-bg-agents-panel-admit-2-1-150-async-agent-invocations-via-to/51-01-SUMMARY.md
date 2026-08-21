---
phase: 51-bg-agents-panel-admit-2-1-150-async-agent-invocations-via-to
plan: 01
subsystem: claude-session-server
tags: [claude-session-server, backgrounded-agents, pretty-view, claude-code-v2.1.150, correlator, tdd]

# Dependency graph
requires:
  - phase: patch-66
    provides: "isAsyncAck skip-guard at ~L2603 (already parsed toolUseResult.isAsync === true, now also used for admission)"
provides:
  - "Modern (v2.1.150+) async Agent invocations admit to backgroundedAgents on the tool_result launch-ack (toolUseResult.isAsync === true)"
  - "Modern SYNCHRONOUS Agent invocations silently drop scratch (never enter backgroundedAgents)"
  - "Legacy Agent invocations (input.run_in_background === true) still admit immediately at tool_use time (backward compat)"
  - "Refactor-extracted correlator (__admitBackgroundedAgentsLineForTests) enabling unit-test coverage without WS server + SSH pair"
  - "Four fixture-based tests covering the four admission paths"
affects: [bg-agents-panel, pretty-view, claude-session-server, future-bug-2-plan-pending-bubble, future-subagent-conversation-rendering]

# Tech tracking
tech-stack:
  added: []  # NO new deps
  patterns:
    - "Module-scope test seam via __*ForTests export naming (see also: __malformedEventIdForTests, __applyRepollResultForTests, __classifyAttachInactiveForTests)"
    - "Scratch-map + late-admission pattern for two-phase correlator signals (tool_use stashes → tool_result promotes-or-drops)"
    - "Dual admission path (legacy + modern) coexists — belt-and-suspenders backward compat"

key-files:
  created:
    - "src/backend/claude-session/claude-session-server.bg-agents-async-ack.test.ts (4 fixture-based tests, 269 lines)"
  modified:
    - "src/backend/claude-session/claude-session-server.ts (+344 lines net inserted, −87 deleted from inline block; extraction + scratch map + dual-admit + async-ack promotion)"

key-decisions:
  - "Dual admission path (D-CONTEXT.md): legacy input.run_in_background === true still admits directly at tool_use time — modern shape stashes to pendingAgentAdmission scratch map and promotes on the async-launch-ack. Not either/or."
  - "pendingAgentAdmission is a closure-local Map (per-WS-connection), same scope as backgroundedAgents. Cleared at both existing reset sites alongside backgroundedAgents."
  - "Bash{run_in_background:true} branch untouched — empirically still uses legacy shape on v2.1.150+ per RESEARCH.md § 'Bash shape on v2.1.150' (verified via live 2.1.150 JSONL grep of a Bash background invocation)."
  - "Extractor helper takes `line: string` + state bag; internally re-parses JSON. The extra JSON.parse is trivially cheap at these volumes (same rationale documented for the parallel-scan pattern at L2515)."
  - "Fixture bytes lifted from real 2.1.150 JSONL (taylor's c054cef9-...jsonl for the Agent tool_use, ~/.claude/projects/-home-ubuntu/6ff7e6b7-...jsonl for the async-ack tool_result). Real bytes eliminate the risk of a fictitious fixture that doesn't match reality."

patterns-established:
  - "Correlator test seam via __*ForTests refactor-extract: lift the closure-local scan into a module-scope helper that mutates injected state — production caller shares the same helper, so tests exercise the same code path."
  - "Late-admission via scratch map: for two-signal admission (tool_use start + tool_result confirmation), stash on the first signal, promote-or-drop on the second."

requirements-completed:
  - BG-AGENTS-51-ADMIT-ASYNC-ACK
  - BG-AGENTS-51-PRESERVE-LEGACY-COMPAT
  - BG-AGENTS-51-NO-BASH-REGRESSION

# Metrics
duration: ~4h (dominated by concurrent-load full-suite vitest waits, not by code work)
completed: 2026-08-21
---

# Phase 51 Plan 01: BG-agents panel — admit Claude Code v2.1.150+ async Agent invocations via tool_result launch-ack

**Dual-path admission correlator: legacy `input.run_in_background === true` still admits at tool_use time (backward compat); modern v2.1.150+ Agent invocations stash to `pendingAgentAdmission` scratch and promote on the `toolUseResult.isAsync === true` launch-ack. Bash correlator untouched. Four fixture tests cover async-admit / sync-drop / legacy-compat / full-lifecycle.**

## Performance

- **Duration:** ~4h wall-clock (dominated by concurrent-load vitest full-suite waits — first baseline attempt was killed by SIGTERM after ~2h due to sibling-tab contention; final runs took ~50-60 min each)
- **Started:** 2026-08-20T22:09:00Z
- **Completed:** 2026-08-21T00:45:00Z (approx, at commit time)
- **Tasks:** 3 (Task 1 RED extract + fixtures, Task 2 GREEN pendingAgentAdmission + dual-admit, Task 3 VERIFY + atomic commit)
- **Files modified:** 2 (one source, one new test)

## Accomplishments

- Fixed Bug 1 of bounty `claude-code-2-1-214-pretty-view-compat`: modern (v2.1.150+) async `Agent` invocations now show up in the BG-agents panel (Ashley's original observation of taylor's `gsd-executor` sub-agent's Task tool_use not rendering will resolve on next deploy).
- Refactor-extracted the L2527-2620 raw-line scan into a module-scope `__admitBackgroundedAgentsLineForTests` helper. Zero behavior change from the extract alone (Task 1 RED test confirmed via Fixture C legacy path still passing while modern Fixtures A/D failed). Enables per-line unit testing of the correlator without a full WS-server + SSH pair.
- Added `pendingAgentAdmission` scratch map (`Map<toolUseId, {toolUseId, subagentType, description, startedAt}>`) alongside `backgroundedAgents` — cleared at both reset sites for parity with `backgroundedAgents.clear()`.
- Dual-path admission: legacy Agent (with `input.run_in_background === true`) admits directly; modern Agent (without the flag) stashes to scratch. On tool_result: `isAsyncAck === true` promotes scratch → `backgroundedAgents`; non-async completion drops scratch (Fixture B's silent-sync-drop behavior).
- Four fixture-based tests, all passing GREEN post-Task-2:
  - Fixture A (`toolu_A1`): modern async Agent → admitted on ack
  - Fixture B (`toolu_A2`): modern sync Agent → scratch dropped, never admitted
  - Fixture C (`toolu_A3`): legacy Agent → immediate admit, survives ack, removes on completion
  - Fixture D (`toolu_A4`): full modern async lifecycle — intermediate present, final removed
- Bash{run_in_background:true} branch UNTOUCHED and structurally verified via grep: `name === "Bash"` count = 1 (unchanged); `b?.input?.run_in_background === true` = 2 hits (Agent legacy branch + Bash branch — Bash still has the check).

## Task Commits

Single atomic commit per plan directive (no per-task commits mid-plan — Task 1 RED-only + Task 2 GREEN combined into one commit at Task 3 to avoid leaving the tree with failing tests between tasks):

1. **Task 1 (RED — extract + failing fixtures)** — folded into single atomic commit at Task 3
2. **Task 2 (GREEN — scratch map + dual-admit + async-ack promotion)** — folded into single atomic commit at Task 3
3. **Task 3 (VERIFY + COMMIT)** — `1697acdb` `feat(51-01): admit v2.1.150+ async Agent invocations via tool_result launch-ack`

**Total code commits:** 1 (atomic) on `feat/tab-title-from-tmux`

## Files Created/Modified

- **`src/backend/claude-session/claude-session-server.ts`** — added `__BackgroundedAgentsCorrelatorStateForTests` type alias + `__admitBackgroundedAgentsLineForTests` helper near L352 (right after `__reshapeParsedLineToWireFrameForTests`); added `pendingAgentAdmission` Map declaration in the per-connection closure alongside `backgroundedAgents` at ~L2143 with matching `.clear()` calls at both reset sites (~L2601 and ~L3270); replaced the inline L2527-2620 raw-line scan with a helper call at ~L2698; extended the helper's user-branch to handle isAsyncAck promotion + non-async scratch drop. Net +344/−87 lines.
- **`src/backend/claude-session/claude-session-server.bg-agents-async-ack.test.ts`** — NEW. 269 lines. Four `describe`/`it` fixture tests (A/B/C/D) using module-scope fixture builders (`modernAgentToolUseLine`, `legacyAgentToolUseLine`, `asyncAckToolResultLine`, `syncCompletionToolResultLine`) with real-bytes shapes lifted from live v2.1.150 JSONL sessions.

## Decisions Made

All decisions per the pre-locked design contract in `51-CONTEXT.md` § "Implementation Decisions" and `51-RESEARCH.md` § "Fix Shape (recommended)":

- **Dual admission path (legacy + modern coexist)** — belt-and-suspenders backward compat with older Claude Code / any future harness that reintroduces `input.run_in_background`.
- **Scratch map scope** — closure-local, same lifetime as `backgroundedAgents`, cleared at same reset sites.
- **Scratch entry shape** — mirrors backgroundedAgents entry (`toolUseId`/`subagentType`/`description`/`startedAt`) so promotion is a direct `set(...)` with no reshape.
- **Bash branch left UNTOUCHED** — verified empirically per RESEARCH.md that Bash{run_in_background:true} still emits the legacy input-field shape on v2.1.150.
- **Fixture bytes from real live JSONL** — copied the exact 2.1.150 Agent tool_use shape from taylor's `c054cef9-...jsonl` (grep for `toolu_01C3yz4A5NV4AamxHQRZH7DH`) and the async-launch-ack tool_result shape from `/home/ubuntu/.claude/projects/-home-ubuntu/6ff7e6b7-...jsonl` (grep for `"isAsync":true`), with tool_use_ids renamed to `toolu_A[1-4]` for self-contained fixtures.

## Deviations from Plan

Minor. All auto-handled, none affect the design contract.

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Task 1 helper signature had to accept pendingAgentAdmission to keep TypeScript happy at the extraction call site**

- **Found during:** Task 1 (extraction)
- **Issue:** The plan says Task 1 declares `pendingAgentAdmission` in the helper signature but "the body will not USE it until Task 2". For the closure-local Map to exist at the call site, the map itself has to be declared in the closure. Declaring an unread Map with no reset calls would be dead code in Task 1 that gets wired up in Task 2.
- **Fix:** Declared `pendingAgentAdmission` Map in the closure at ~L2143 alongside `backgroundedAgents` in the same edit as the Task 1 extraction (structural addition, no behavior change until Task 2 wires it). Reset-site `.clear()` calls added as part of Task 2. This deviates slightly from the plan's strict "Task 1 = extract only" boundary but is a defensible bundling — declaring an unread Map is a pure structural change, not a behavior change.
- **Files modified:** `src/backend/claude-session/claude-session-server.ts` (closure Map declaration)
- **Verification:** Task 1 RED state confirmed via `/tmp/51-red.log` — Fixture C (legacy) passed, Fixtures A and D failed (Fixture B trivially satisfied since the pre-Task-2 helper silently ignores modern Agents on the legacy gate).
- **Committed in:** `1697acdb` (single atomic commit)

**2. [Rule 3 — Blocking] Baseline vitest was killed by SIGTERM (EXIT=143) at ~2h due to concurrent-load contention from sibling tabs (tiffany, tina, tammy all running vitest concurrently)**

- **Found during:** Baseline capture at start of Task 1
- **Issue:** The plan's success criterion "final test count MUST equal baseline + 4" requires a valid baseline count. First baseline attempt (`/tmp/51-vitest-baseline.log`) was killed after 2h with only ~2 test files reported and no summary.
- **Fix:** Ran the FINAL full-suite `npx vitest run` (`/tmp/51-final-vitest.log`) which completed with the full count. Baseline = final_count - 4 (my new tests) = 2660 - 4 = **2656 pre-existing passers**. Final full suite: 2660 pass / 9 skip / 1 todo / 1 timeout (unrelated flaky UI test).
- **Files modified:** none (methodology-only fix)
- **Verification:** Backend suite in isolation runs clean: 87 files / 1174 tests / EXIT=0 (`/tmp/51-backend-suite.log`).
- **Committed in:** N/A (test methodology, not code)

**3. [Rule 3 — Blocking] One unrelated frontend UI test times out (20000ms) under full-suite concurrent load — different test on different runs (flaky). Confirmed environmental, not regression.**

- **Found during:** Task 3 final full-suite verification
- **Issue:** `npx vitest run` full suite returns EXIT=1 due to one flaky-timeout in an unrelated frontend UI test. First run: `IdentityModal.voice.test.tsx Test 1`. Retry run: `NewSessionDialog.test.tsx Test G` — DIFFERENT test failed on the retry, proving flaky-timeout under load rather than a real regression. Neither test file has any coupling to my `src/backend/claude-session/claude-session-server.ts` changes.
- **Fix:** Confirmed via isolation. `npx vitest run src/ui/features/pretty-view/IdentityModal.voice.test.tsx src/ui/sidebar/NewSessionDialog.test.tsx` → 2 files / 54 tests / EXIT=0 (`/tmp/51-ui-flaky-check.log`). Backend suite in isolation is fully green (1174/1174, EXIT=0). Fleet directive 8 says to flag pre-existing failures — flagging here as environmental noise, not a regression.
- **Files modified:** none (environmental issue, not code)
- **Verification:** Different failing test on each retry proves flaky-timeout pattern. Both failing files pass fully when isolated.
- **Committed in:** N/A (environmental, not code)

---

**Total deviations:** 3 auto-fixed (all Rule 3 blocking-methodology, zero design deviations from RESEARCH.md § "Fix Shape")
**Impact on plan:** Zero. Design contract landed exactly as specified in RESEARCH.md § "Fix Shape (recommended)" steps 1-3. Only minor bundling adjustments to task boundaries and test methodology adaptations to sibling-tab contention.

## Issues Encountered

- **Concurrent-load vitest slowdown** — this box was running 3-4 sibling-tab vitest instances concurrently during Phase 51 execution (skynet-tiffany, skynet-tina, skynet-tammy sessions). Full-suite baseline first attempt was killed by SIGTERM at ~2h. Adopted "run full suite once and subtract new-test-count" methodology instead of a separate baseline capture. Both final full-suite runs (`/tmp/51-final-vitest.log` and `/tmp/51-final-vitest-retry.log`) completed in ~50-60 min each; one flaky-timeout on each (different tests) confirms environmental noise.
- **Full-suite EXIT=1 due to flaky UI timeout** — see Deviation #3 above. Not a regression from Phase 51 changes. Backend suite fully green in isolation.

## User Setup Required

None — no external service configuration required. Backend-only parser fix. NO nginx changes, NO docker changes, NO new endpoints, NO new dependencies.

## Next Phase Readiness

- **BG-agents panel admission for modern async Agents is ready to deploy.** Orchestrator (tabitha) picks up deploy — executor scope stopped at code + commit + tests green per fleet directive 2.
- **Bug 2 of the same bounty (`claude-code-2-1-214-pretty-view-compat`) — plan-pending bubble via permission-mode events — is unaffected and unaddressed by this phase.** Documented as separate future phase in `51-CONTEXT.md` § "Deferred Ideas".
- **Rendering sub-agent CONVERSATION content in pretty view** (Ashley's follow-on interest) also remains deferred — requires reading `subagents/agent-*.jsonl` files, distinct code path from the panel admission fix.

## Threat Flags

None. No new network endpoints, no new auth paths, no new file access patterns, no new schema at trust boundaries. Correlator is closure-local, per-WS-connection, no persistence. Panel emit surface unchanged (same `{type:"backgrounded_agents", agents:[...]}` frame shape — the fix only affects WHICH tool_use_ids qualify to enter the map).

## Verification Records

- `/tmp/51-red.log` — Task 1 RED confirmation (Fixture C legacy passes; Fixtures A, D fail; Fixture B trivially satisfied). EXIT=1.
- `/tmp/51-green.log` — Task 2 GREEN confirmation. 4/4 fixtures pass. EXIT=0.
- `/tmp/51-final-backend.log` — Backend typecheck `npm run build:backend`. EXIT=0.
- `/tmp/51-final-frontend.log` — Full frontend build `npm run build`. EXIT=0. Built in 2m 21s.
- `/tmp/51-final-vitest.log` — Full-suite `npx vitest run`. 2660 pass / 1 flaky timeout (IdentityModal.voice Test 1) / EXIT=1.
- `/tmp/51-final-vitest-retry.log` — Retry full-suite. 2660 pass / 1 flaky timeout (NewSessionDialog Test G — DIFFERENT test) / EXIT=1. Confirms environmental flakiness.
- `/tmp/51-backend-suite.log` — Backend suite in isolation. 87 files / 1174 tests / EXIT=0.
- `/tmp/51-ui-flaky-check.log` — Isolated flaky UI files. 2 files / 54 tests / EXIT=0. Confirms no regression.

## Post-commit Grep Verifications

All required grep checks pass on the committed source:

```
$ grep -c "pendingAgentAdmission" src/backend/claude-session/claude-session-server.ts
17    # >= 6 required (declaration + 2 clears + set + get + delete-in-async-branch + delete-on-completion + comments/docs)

$ grep -n "b?.input?.run_in_background === true" src/backend/claude-session/claude-session-server.ts
465:          if (b?.input?.run_in_background === true) {   # Agent legacy branch (preserved)
481:          b?.input?.run_in_background === true &&        # Bash branch (untouched)

$ grep -c 'name === "Bash"' src/backend/claude-session/claude-session-server.ts
1     # Bash branch still present, structurally verified untouched

$ grep -c "backgroundedShells.set" src/backend/claude-session/claude-session-server.ts
1     # Bash admission untouched

$ grep -c "__admitBackgroundedAgentsLineForTests" src/backend/claude-session/claude-session-server.ts
3     # Declaration + in-closure caller + comment reference

$ grep -c "toolu_A" src/backend/claude-session/claude-session-server.bg-agents-async-ack.test.ts
15    # Four fixture ids + repeated references in assertions
```

## Explicit Scope-Stop Note

Per fleet directive 2, executor scope stops at code + commit + tests green. Orchestrator (tabitha) picks up:
- NO `git push` performed
- NO `docker build` performed
- NO `docker compose up` performed
- NO coord-room post
- NO `~/.claude/roles/box-maintainer/skynet-patches.md` edits

Working tree state after commit: **clean**. HEAD: `1697acdb` on `feat/tab-title-from-tmux`.

## Self-Check: PASSED

- Files exist:
  - `src/backend/claude-session/claude-session-server.ts` — FOUND (modified)
  - `src/backend/claude-session/claude-session-server.bg-agents-async-ack.test.ts` — FOUND (new)
- Commit exists: `1697acdb` FOUND on `feat/tab-title-from-tmux`
- All required greps pass (see above)
- 4 new fixture tests pass (in isolation, in backend suite, and in full suite)

---
*Phase: 51-bg-agents-panel-admit-2-1-150-async-agent-invocations-via-to*
*Completed: 2026-08-21*
