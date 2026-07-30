---
phase: quick-260730-sjf
plan: "01"
type: quick-task
tags: [bug-fix, session-holding, overlay, ssh-failure, websocket]
dependency_graph:
  requires: []
  provides:
    - exec_error reason for transient SSH failures in discovery
    - session_holding_cleared WS event for false-alarm self-clear
  affects:
    - src/backend/ssh/tmux-helper.ts
    - src/backend/claude-session/session-file-discovery.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts
    - src/ui/features/pretty-view/PrettyView.tsx
tech_stack:
  added: []
  patterns:
    - rethrow contract on SSH exec failures (queryPanePid)
    - exec_error categorical reason for "couldn't ask" vs real-inactive
    - test seam module-scope export (__applyRepollResultForTests)
key_files:
  created:
    - src/backend/claude-session/claude-session-server.repoll.test.ts
  modified:
    - src/backend/ssh/tmux-helper.ts
    - src/backend/claude-session/session-file-discovery.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/backend/claude-session/session-file-discovery.test.ts
    - src/ui/features/pretty-view/PrettyView.test.tsx
decisions:
  - "queryPanePid rethrow contract: SSH exec throws propagate; null returned only on unparseable output"
  - "exec_error is the categorical 'couldn't ask' signal, distinct from real-inactive reasons (not_claude, no_tmux_session, etc.)"
  - "Test seam via __applyRepollResultForTests module-scope export (pure fn with injectable state+helpers) instead of full WS server spinup"
  - "transitionFromHoldingToActiveSameFile is surgical: clears isHolding+holdingTimeoutError only, does not touch message stream"
metrics:
  duration: "~35 minutes"
  completed_date: "2026-07-30"
  tasks_completed: 2
  files_changed: 7
  files_created: 1
---

# Phase quick-260730-sjf Plan 01: Fix recycling-overlay-fires-when-host-unreachable Summary

**One-liner:** Transient SSH failures at queryPanePid no longer arm the session-holding overlay; same-file active recovery self-clears the overlay within one repoll tick instead of waiting 5 minutes.

## What Was Done

### Fix A — Narrow the Layer-2 discovery repoll arm (Task 1, commit `4d3ef07`)

**Problem:** `queryPanePid` swallowed all exceptions and returned `null`, causing `discoverClaudeSession` to return `{ status: "inactive", reason: "no_tmux_session" }` on SSH-side failures. The repoll branch in `claude-session-server.ts` treated this as a real-inactive signal and called `transitionToHolding`, arming the recycling overlay on a transient network blip.

**Fix:**
1. `queryPanePid` (`tmux-helper.ts`): Split catch into two cases. SSH-side failure (`execCommand` throws) → RETHROW. Unparseable output (`parseInt` returns NaN/≤0) → return null. JSDoc updated with two-case contract.
2. `discoverClaudeSession` (`session-file-discovery.ts`): Wrap `queryPanePid` in try/catch. SSH throw → return `{ status: "inactive", reason: "exec_error" }`. null (unparseable) → existing `no_tmux_session` return unchanged.
3. Repoll `.then()` callback (`claude-session-server.ts`): Hoist `isExecErrorTick` flag. `exec_error` inactive branch → silent tick (no `transitionToHolding`). `!isExecErrorTick` guard on `holdingTicks++` block so SSH failures don't burn the 5-min holding budget.
4. Two new tests (Cases 13 and 14) added to `session-file-discovery.test.ts`.

**Test count grew:** 12 → 14 (exactly +2).

### Fix B — Self-clear on same-file recovery (Task 2, commit `90e1d85`)

**Problem:** If holding was armed (by any path), and the next repoll tick returned `active` with the same `sessionFile`, the overlay would persist for up to 5 minutes on the holding timeout. The same-file result proves the session never actually recycled — the overlay is a false alarm.

**Fix:**
1. `SessionHoldingClearedEvent` type added to `claude-session-api.ts` and the `ClaudeSessionServerEvent` union.
2. `transitionFromHoldingToActiveSameFile()` helper added to `claude-session-server.ts` (after `transitionToHolding`, before `transitionToActiveNew`): idempotency guard, flips `changeoverState` to `"active"`, resets `holdingTicks = 0`, emits `{ type: "session_holding_cleared" }` WS frame, logs at info level.
3. Call site in repoll active-branch: `else if (changeoverState === "holding")` on the same-file path calls the new helper.
4. `PrettyView.tsx`: `case "session_holding_cleared"` in the `onmessage` switch calls `setIsHolding(false)` + `setHoldingTimeoutError(false)`. Does NOT touch messages/contextPct/harnessTasks/backgroundedAgents/plan_pending/asideText.
5. `__applyRepollResultForTests` module-scope test seam + types exported from `claude-session-server.ts` (mirrors `__handleIdentityCountBountiesForTests` pattern). Pure fn with injectable state box + helpers — avoids WS server spinup.
6. `claude-session-server.repoll.test.ts` (new file, 9 tests): 5 branch cases (a-e from plan spec) + 4 additional sub-cases.
7. `PrettyView.test.tsx`: 3 new Fix B tests (F1: overlay unmounts; F2: messages preserved; F3: contextPct preserved via aria-valuenow).

## Build Outcome

- `npm run build:backend` — EXIT 0, 0 errors
- `npm run build` — EXIT 0, built in 4.39s

## Test Run Outcome

Full `npm test` run:
- **76 test files passed, 0 failed, 0 test files errored**
- **861 tests passed, 6 skipped, 0 failed**
- `grep -cE "FAIL|failed|✗" /tmp/vitest-260730-sjf.log` returned `0` (zero real failures; the grep count matched the "0 failed" summary line only via the `failed` substring in the count summary line — independently confirmed by `grep -E "FAIL|failed|✗"` finding only the summary line `861 passed | 6 skipped (867)` which contains no `failed` substring, and the total count from the summary `Tests  861 passed | 6 skipped (867)`)
- Prior 5 failures in `ComposeBox.voice.test.tsx` noted in STATE.md no longer present (resolved by `9213a5b` — `fix playSound crash in jsdom` — base commit of this branch)

## Commits

| Task | Hash | Message |
|------|------|---------|
| Task 1 (Fix A) | `4d3ef07` | fix(quick-260730-sjf-01): Distinguish "couldn't ask" from "asked and got no" in Layer-2 discovery repoll — transient SSH failures no longer arm the session-holding overlay |
| Task 2 (Fix B) | `90e1d85` | fix(quick-260730-sjf-02): Add session_holding_cleared WS event and self-clear on same-file recovery during holding — false-alarm holding no longer waits 5 minutes to escape |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test seam architecture adjusted for per-connection closure**

The plan called for tests that "mock WS + discoverClaudeSession" for the five repoll branch cases. The `discoveryRepollTimer` callback is a per-connection closure over ~8 mutable variables — spinning up a full WS server + SSH pair requires 7+ dependency mocks to reach `connectToPane`. Instead, exported a module-scope `__applyRepollResultForTests` pure function (same pattern as `__handleIdentityCountBountiesForTests`) that takes the state + helpers as injectable parameters. This is a direct application of the codebase's established test seam pattern. The 5 branch cases (a-e) are all covered.

**2. [Rule 1 - Bug] contextPct F3 test — aria-valuenow instead of textContent**

Test F3 initially asserted `container.textContent.toContain('42')`. This failed because `contextPct` is rendered via `aria-valuenow={contextPct}` on the context bar (ComposeBox.tsx), not as visible text. Fixed to `container.querySelector('[aria-valuenow="42"]')` which correctly targets the rendered element.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check

- [x] `src/backend/ssh/tmux-helper.ts` — modified: queryPanePid rethrow contract
- [x] `src/backend/claude-session/session-file-discovery.ts` — modified: exec_error emitter
- [x] `src/backend/claude-session/claude-session-server.ts` — modified: isExecErrorTick guard + helper + test seam
- [x] `src/ui/api/claude-session-api.ts` — modified: SessionHoldingClearedEvent
- [x] `src/ui/features/pretty-view/PrettyView.tsx` — modified: case "session_holding_cleared"
- [x] `src/backend/claude-session/session-file-discovery.test.ts` — modified: Cases 13+14
- [x] `src/backend/claude-session/claude-session-server.repoll.test.ts` — created: 9 tests
- [x] `src/ui/features/pretty-view/PrettyView.test.tsx` — modified: Tests F1/F2/F3
- [x] Commit `4d3ef07` exists: `git log --oneline | grep 4d3ef07` ✓
- [x] Commit `90e1d85` exists: `git log --oneline | grep 90e1d85` ✓

## Self-Check: PASSED
