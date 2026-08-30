---
phase: 260813-0qx
plan: 01
subsystem: claude-session
tags:
  - claude-session
  - session-holding-overlay
  - discovery-repoll
  - fallback-01
  - reset-window
  - bug-fix
requires:
  - src/backend/claude-session/claude-session-server.ts
  - src/backend/claude-session/session-file-discovery.ts
  - src/backend/claude-session/pane-state-emitter.ts
provides:
  - Attach-path reset-window branch (holding + repoll instead of FALLBACK-01 on /id-reset window signals)
  - Shared startDiscoveryRepollTimer helper (single body used by steady-state + attach-path)
  - __classifyAttachInactiveForTests pure classifier (single source of truth for reset_window vs fallback_01 decision)
  - Coverage: 21 new repoll tests (Group A truth table, Group B post-holding recovery/timeout, Group C mixed-sequence integration smoke)
affects:
  - Initial-attach inactive handling for `no_pid_session_file`, `no_open_session_file`, and `not_claude` on identity-shape panes without `.dormant`
tech-stack:
  added: []
  patterns:
    - Test seam via module-scope pure classifier (`__classifyAttachInactiveForTests`) — same pattern as `__applyRepollResultForTests` (quick 260730-sjf)
    - Connection-scoped helper extraction (`startDiscoveryRepollTimer`) that closes over the same lets the inline block did — behavior-preserving refactor
    - Reuse of `transitionToHolding("discovery_diff")` from attach path — helper's `changeoverState !== "active"` guard passes at attach because module default is "active"
key-files:
  created: []
  modified:
    - src/backend/claude-session/claude-session-server.ts
    - src/backend/claude-session/claude-session-server.repoll.test.ts
decisions:
  - "Option A (shared helper) chosen over Option C (inlined copy) for the discovery-repoll timer setup — all closure vars (stopped, ws, sshConn, discoveryRepollInFlight, discoveryRepollTimer, currentSessionFile, changeoverState, holdingTicks) plus all four transition helpers are already in connection scope, so no TDZ ordering conflicts. Steady-state site's behavior is byte-preserved; both call sites now share the same body. Option A also mitigates threat T-260813-0qx-03 (code drift between the two sites)."
  - "Reused transitionToHolding('discovery_diff') from the attach-path reset-window branch rather than inlining the WS-send + emitter + log block. At attach time changeoverState === 'active' (module default L1690), so the helper's guard passes; it flips state to 'holding', sets holdingReason = 'discovery_diff', resets holdingTicks = 0, sends the {type:'session_holding'} frame, emits paneStateEmitter.emit('holding','discovery_diff'), and logs 'claude_session_holding'. Also added a reset-window-specific info log (operation: 'claude_session_holding_attach_reset_window') for post-deploy observability."
  - "Classifier maps `not_claude + isIdentityShapedCached:null` to fallback_01 (conservative). The SSH-throw catch at ~L5150-5152 sets isIdentityShapedCached = false on probe failure, so null is only reachable when the probe never ran (a defensive path). Group A test locks this in as a regression guard for the T-260813-0qx-04 threat-model mitigation."
metrics:
  duration: ~15min
  completed: 2026-08-13
tasks_completed: 2
tasks_total: 2
files_created: 0
files_modified: 2
tests_added: 21
tests_total: 32 (in claude-session-server.repoll.test.ts)
---

# Quick 260813-0qx: Deactivate → /id-reset window → reactivate latch fix Summary

One-liner: Adds an attach-path reset-window branch that enters `holding` + starts the discovery-repoll timer for `/id-reset`-window signals (`no_pid_session_file`, `no_open_session_file`, `not_claude` on identity-shape pane without `.dormant`) instead of terminating via FALLBACK-01, reusing the steady-state repoll reducer for recovery.

## What Was Built

- **Attach-path reset-window branch** (`src/backend/claude-session/claude-session-server.ts` ~L5155): between the `enteredDormantPoll` early-return and the FALLBACK-01 block, a new branch fires when `__classifyAttachInactiveForTests(result, isIdentityShapedCached) === "reset_window"`. It seeds `currentHostId`/`currentTmuxSession`, calls `transitionToHolding("discovery_diff")`, logs the reset-window-specific `claude_session_holding_attach_reset_window` operation, starts the shared discovery-repoll timer, and returns without teardown (mirrors the `enteredDormantPoll` early-return pattern).
- **Shared discovery-repoll timer helper** (`startDiscoveryRepollTimer(activeTmuxSession)`) at connection scope, immediately after `transitionToDead` (~L2597). Extracted from the inline `discoveryRepollTimer = setInterval(...)` block that used to live inside `startActiveSessionFlow`. Both call sites (steady-state active flow + new attach-path reset-window branch) now share the same body. Byte-preserved behavior at the steady-state site (same closure vars, same helper calls, same interval, same catch/finally shape).
- **Pure classifier** `__classifyAttachInactiveForTests(result, isIdentityShapedCached)` at module scope (~L953). Single source of truth for the "reset_window vs fallback_01" decision — the production branch calls it directly and the tests exercise the same function, so drift between "what tests assert" and "what production does" cannot arise. Reset-window verdicts: `no_pid_session_file` (any identity-shape), `no_open_session_file` (any identity-shape), or `not_claude` AND `isIdentityShapedCached === true`. All other cases (including defensive `status === "active"` and `not_claude + isIdentityShapedCached === null`) fall through to fallback_01.
- **Test coverage** (`src/backend/claude-session/claude-session-server.repoll.test.ts`, +315 lines, +21 tests):
  - Group A (16 tests) — truth table for `__classifyAttachInactiveForTests` covering all 5 discovery reasons × 3 identity-shape cache states, plus a defensive `status: "active"` case.
  - Group B (4 tests) — post-holding handoff via the existing `__applyRepollResultForTests` reducer, proving that after the attach branch seeds `{changeoverState: "holding", holdingReason: "discovery_diff", holdingTicks: 0, currentSessionFile: null}`:
    - B1: active tick with new sessionFile → `transitionToActiveNew` fires; `transitionToHolding` does NOT (already holding).
    - B2: 199 `no_pid_session_file` ticks hold; 200th trips `transitionToDead("holding_timeout")` — proves `HOLDING_TIMEOUT_TICKS` budget intact across the handoff.
    - B3: `exec_error` tick from attach-seeded holding does NOT burn budget (Fix A `!isExecErrorTick` guard preserved).
    - B4: defensive active-with-new-file after 5 prior ticks still dispatches `transitionToActiveNew`.
  - Group C (1 test) — mixed-sequence integration smoke: `no_pid_session_file × 2` → `exec_error × 3` → `active` recovery, with exact call counts + state assertions at each step.

## Files Created / Modified

| File | Kind | Purpose |
|------|------|---------|
| src/backend/claude-session/claude-session-server.ts | modified | Added `__classifyAttachInactiveForTests` (module-scope pure classifier), `startDiscoveryRepollTimer` (connection-scoped helper), and attach-path reset-window branch; replaced inline timer setup inside `startActiveSessionFlow` with helper call. |
| src/backend/claude-session/claude-session-server.repoll.test.ts | modified | Added Groups A/B/C describe blocks with 21 new tests; added `__classifyAttachInactiveForTests` to imports. |

## Decisions Made

1. **Option A (shared helper) over Option C (inlined copy)** — All closure vars needed by the timer body (`stopped`, `ws`, `sshConn`, `discoveryRepollInFlight`, `discoveryRepollTimer`, `currentSessionFile`, `changeoverState`, `holdingTicks`) and all four transition helpers (`transitionToHolding`, `transitionToActiveNew`, `transitionFromHoldingToActiveSameFile`, `transitionToDead`) live at connection scope, declared BEFORE the helper. No TDZ conflicts. The helper takes a single param (`activeTmuxSession: string`), well under the plan's 5-param threshold for switching to Option C. Also mitigates threat T-260813-0qx-03 (code drift between the two sites) — single source of truth for the reducer body.

2. **Reused `transitionToHolding("discovery_diff")` from the attach path** — The plan gave this as the "prefer if it works cleanly" route. It works cleanly: at attach time `changeoverState === "active"` (module default at L1690), so the helper's `if (changeoverState !== "active") return;` guard passes. The helper's log payload references `currentSessionFile` which is `null` at attach (logs "null" — correct, there IS no old file). Kept the reset-window-specific info log (`operation: "claude_session_holding_attach_reset_window"`) separately for post-deploy observability — that's a distinct operation from the helper's `claude_session_holding` log.

3. **Conservative `not_claude + isIdentityShapedCached: null` → fallback_01** — The plan called this out as the T-260813-0qx-04 mitigation. The dormant-probe SSH-throw catch at ~L5150-5152 sets `isIdentityShapedCached = false` on probe failure, so `null` only remains when the probe never ran at all (e.g. `result.reason !== "not_claude"` — a defensive path since the classifier's `not_claude` arm requires `=== true`). Group A locks this in as a regression guard.

4. **Local `TIMEOUT = 200` const in the test file, with a sync-with-server comment** — The plan explicitly said "don't modify `HOLDING_TIMEOUT_TICKS` at L187". Re-exporting would count as a modification (touches the export surface). The local const with `← MUST equal HOLDING_TIMEOUT_TICKS in claude-session-server.ts:187` comment is the surgical minimum.

## Deviations from Plan

None — plan executed exactly as written. Both wiring-choice decision points (Option A vs C, and reuse `transitionToHolding` vs inline the emit block) resolved cleanly in favor of the plan's preferred paths.

## Verification

- **Repoll test file:** `npx vitest run src/backend/claude-session/claude-session-server.repoll.test.ts` → 32 tests passed (11 pre-existing + 21 new), 0 failures.
- **Wider claude-session suite:** `npx vitest run src/backend/claude-session/` → 26 test files, 363 tests passed, 0 failures.
- **Full vitest suite:** `npx vitest run` → 154 test files, 1990 passed, 6 skipped, 1 todo, 0 failures. Duration ~7min.
- **Backend TypeScript compile:** `npm run build:backend` → exit 0 (backend TypeScript compile passes; no new type errors introduced by the module-scope classifier or the connection-scoped helper).

## Success Criteria Confirmation

- On initial-attach `discoverClaudeSession` returning `{status:"inactive", reason:"no_pid_session_file"}` (or `"no_open_session_file"`, or `"not_claude"` on identity-shape pane without `.dormant`), the WS enters holding + starts the discovery-repoll timer instead of FALLBACK-01. **Verified via Group A truth table + Group B B1/B2/B3/B4.**
- On initial-attach with `reason:"no_tmux_session"` or `"exec_error"` (or `"not_claude"` on a non-identity-shape pane), FALLBACK-01 runs unchanged. **Verified via Group A truth table (no_tmux_session × 3, exec_error × 3, not_claude+false, not_claude+null → all fallback_01).**
- After entering holding via the new attach-path branch, the existing repoll timer recovers the WS on active-with-new-file or times out to terminal-inactive at `HOLDING_TIMEOUT_TICKS`. **Verified via Group B B1 (recovery) + B2 (timeout at 200) + Group C (mixed sequence end-to-end).**
- Existing repoll tests still pass (no regression to steady-state behavior). **Verified — all 11 pre-existing tests green.**
- New tests cover the classifier truth table + post-holding repoll cases + integration smoke. **Delivered as Groups A/B/C.**
- `npm run build:backend` exits 0. **Verified.**
- No new wire-frame types; no frontend edits; `HOLDING_TIMEOUT_TICKS` unchanged. **Verified — only reused existing `session_holding` + `pane_state:holding` shapes; no frontend files touched; L187 constant untouched.**

## Commits

- `024b9a3` feat(quick-260813-0qx): attach-path reset-window branch + shared discovery-repoll timer
- `6a14e28` test(quick-260813-0qx): coverage for attach-path reset-window classifier + post-holding handoff

## Self-Check: PASSED

- Files exist:
  - src/backend/claude-session/claude-session-server.ts — FOUND (modified)
  - src/backend/claude-session/claude-session-server.repoll.test.ts — FOUND (modified)
  - .planning/quick/260813-0qx-deactivate-reactivate-during-reset-latch/260813-0qx-SUMMARY.md — this file
- Commits exist:
  - 024b9a3 — FOUND in `git log`
  - 6a14e28 — FOUND in `git log`
- All verification gates green (repoll: 32/32; claude-session: 363/363; full suite: 1990/1990; backend build: exit 0).
