---
quick: 260812-x5f
plan: 01
subsystem: frontend/websocket
tags: [debounce, websocket, hidden-pane, voice-send, nav-away]
requires: []
provides: [HIDDEN_PANE_WS_CLOSE_DEBOUNCE_MS, debounced-ws-close]
affects: [PrettyView, Terminal]
tech-stack:
  patterns: [setTimeout-debounce, useRef-timer-handle, cleanup-return-fn]
key-files:
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.test.tsx
    - src/ui/features/terminal/Terminal.tsx
    - src/ui/features/terminal/Terminal.wiring.test.ts
decisions:
  - "Debounce delay is 60_000ms (60s) per Ashley proposal — gives in-flight nav-away work time to finish"
  - "Constant is duplicated per-file (PrettyView + Terminal) — no shared helper per bounty guidance"
  - "hiddenPaneCloseTimerRef type: ReturnType<typeof setTimeout> in PrettyView, NodeJS.Timeout in Terminal — match existing style per-file"
  - "Cancellation fires on EVERY isVisible=true (not just false→true edge) for race-safety"
  - "Test (e) assertion adjusted to account for main WS-setup cleanup calling ws.close() on unmount (expected behavior)"
  - "Existing eqk-2 and ih9-2 wiring test block windows bumped 8000→10000 chars (Rule 3 auto-fix: effect body expanded beyond prior window)"
metrics:
  duration: "~35 minutes"
  completed: "2026-08-13"
  tasks: 3
  files: 4
---

# Quick 260812-x5f: Debounce Hidden-Pane WS Close by ~60s Summary

Debounced `ws.close()` at both hidden-pane pause-effect sites (Terminal.tsx and PrettyView.tsx) with a 60s timer, cancellation on isVisible=true, and unmount cleanup. Fixes Ashley's voice-record + send + immediate nav-away regression.

## Files Changed

### src/ui/features/pretty-view/PrettyView.tsx

Lines changed: ~L67-L79 (new constant), ~L668-L672 (new ref), ~L1653-L1728 (pause effect rewrite).

Key regions:
- **L67-L79**: Added `HIDDEN_PANE_WS_CLOSE_DEBOUNCE_MS = 60_000` module-scope constant with bounty reference comment.
- **L668-L672**: Added `hiddenPaneCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)` adjacent to `reconnectTimeoutRef`.
- **L1653-L1728**: Replaced immediate `ws.close()` in the `!isVisible` branch with:
  - `clearTimeout` + reassign on re-enter (restart-timer semantics)
  - `console.info` schedule log at schedule time
  - `setTimeout(() => { readyState-check + reconnectTimeoutRef-clear + close-log + ws.close() }, 60_000)` assigned to `hiddenPaneCloseTimerRef.current`
  - Visible branch: `clearTimeout(hiddenPaneCloseTimerRef.current)` at top (every isVisible=true, not edge-gated)
  - Cleanup `return () => { clearTimeout(hiddenPaneCloseTimerRef.current) }` added (effect previously had no cleanup)

### src/ui/features/pretty-view/PrettyView.test.tsx

Lines added: 1782-1919 (new describe block).

- New describe: `quick 260812-x5f — PrettyView hidden-pane WS close debounce (~60s)`
- 5 runtime tests using `vi.useFakeTimers()`:
  - **(a)** hide 30s then show: `ws.close` never called (timer cancelled)
  - **(b)** hide 70s: `ws.close` fires exactly once at 60s mark (split advance: 59999ms → not called, +2ms → called once)
  - **(c)** hide 30s → show 5s → hide 45s + 20s: second hide restarts timer, close fires once at 65s from second hide
  - **(d)** rapid flap (hide 10s / show 10s × 4 loops): close never called
  - **(e)** unmount while pending: records `callCountAtUnmount` (main WS-setup cleanup closes WS on unmount as expected), then asserts no additional calls after +60s timer advance

### src/ui/features/terminal/Terminal.tsx

Lines changed: ~L84-L96 (new constant), ~L353-L358 (new ref), ~L676-L800 (pause effect rewrite).

Key regions:
- **L84-L96**: Added `HIDDEN_PANE_WS_CLOSE_DEBOUNCE_MS = 60_000` module-scope constant (after `wsMsgDedup`).
- **L353-L358**: Added `hiddenPaneCloseTimerRef = useRef<NodeJS.Timeout | null>(null)` adjacent to `reconnectTimeoutRef`.
- **L676-L800**: Replaced immediate `ws.close()` in the `!isVisible` branch with debounced setTimeout pattern (identical shape to PrettyView). Added:
  - isVisible=true cancellation guard BEFORE `if (!isVisible)` (fires on every isVisible=true, independent of prev-gated reopen)
  - `setTimeout` with debounce constant, handle assigned to `hiddenPaneCloseTimerRef.current`
  - `reconnectTimeoutRef` clear moved INSIDE the setTimeout callback (only fires at actual-close time)
  - `console.info` schedule + close logs
  - Cleanup `return () => { clearTimeout(hiddenPaneCloseTimerRef.current) }`

### src/ui/features/terminal/Terminal.wiring.test.ts

Lines added: 847-960 (new describe block) + 2 existing test window size bumps.

- New describe: `quick-260812-x5f — Terminal hidden-pane WS-close debounce (~60s)` with 8 structural-grep assertions (x5f-1 through x5f-8)
- **Auto-fix (Rule 3)**: Existing `eqk-2` and `ih9-2` tests used 8000-char block windows for the pause-effect anchor. After our additions the effect spans 8484 chars — bumped both windows from 8000→10000 to prevent regression.

## Test Tally

| | Before | After |
|---|---|---|
| Tests passed | 1953 | 1966 |
| Tests skipped | 6 | 6 |
| Tests todo | 1 | 1 |
| Tests failed | 0 | 0 |
| Net new tests | — | +13 (5 PV runtime + 8 Terminal structural) |

Full suite: `npx vitest run` = **1966 passed, 0 failed**.

Note: 2 `EnvironmentTeardownError` warnings from `IdentityModal.test.tsx` are pre-existing teardown race conditions unrelated to these changes (that file was not touched).

`npx tsc --noEmit` = clean (0 errors).

## Commit SHAs

| Commit | Files | Message |
|---|---|---|
| `daa2de0` | PrettyView.tsx, PrettyView.test.tsx | `patch: debounce PrettyView hidden-pane WS close by ~60s` |
| `6568f14` | Terminal.tsx, Terminal.wiring.test.ts | `patch: debounce Terminal hidden-pane WS close by ~60s` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Bumped eqk-2 + ih9-2 block windows 8000→10000 chars**
- **Found during:** Task 2 (Terminal.wiring.test.ts run)
- **Issue:** The expanded pause-effect body (debounce additions added ~490 chars of new code) pushed the effect past the existing 8000-char block window used by `eqk-2` and `ih9-2` wiring tests. Both tests failed on `}, [isVisible]);` assertion because the window was truncated before reaching the deps line.
- **Fix:** Bumped block window to 10000 chars in both tests. Added inline comment citing `quick-260812-x5f auto-fix Rule 3`.
- **Files modified:** Terminal.wiring.test.ts
- **Impact:** Zero behavior change — window size is a diagnostic parameter, not a semantic assertion.

**2. [Rule 1 - Bug] Adjusted test (e) assertion for expected unmount behavior**
- **Found during:** Task 1 (PrettyView.test.tsx run)
- **Issue:** Test (e) initially asserted `ws.close` was NEVER called after unmount. But the main WS-setup effect cleanup calls `ws.close()` on every unmount (correct, expected behavior — patch #148 design). This caused the assertion to fail with 1 unexpected call.
- **Fix:** Changed assertion to record `callCountAtUnmount` after `unmount()` and then assert no additional calls after advancing timers 60s. This correctly validates that the DEBOUNCE timer is cleared on unmount without asserting that the WS-setup cleanup doesn't run (which is expected).
- **Files modified:** PrettyView.test.tsx

## Confirming Untouched Invariants

- Reconnect logic (`reconnectAttemptsRef`, `reconnectTimeoutRef` retry scheduler): NOT touched — only moved inside the setTimeout callback where it belongs (fires at actual-close time, not at schedule time).
- `isVisibleRef` mirror effect: NOT touched.
- `isConnectingRef`, `wasConnectedRef`, `shouldNotReconnectRef`: NOT touched.
- Patch #148 reconnect scheduler: NOT touched — `isVisibleRef.current` guard on `attemptReconnection()` continues to hold during the 60s debounce window.
- `quick-260809-ih9` prevIsVisibleRef edge detector: preserved — `else if (!prev && isVisible)` gate unchanged.
- iOS PWA visibilitychange handler: NOT touched.
- Main WS-setup effect deps / body: NOT touched.
- Reopen path (`setRetryKey`, `attemptReconnection`): NOT touched.

## Ops Constraints Honored

- No `git push` — orchestrator ships.
- No `docker build`, `docker compose up`, `docker cp` — deploy is orchestrator-only.
- No edit to `~/.claude/roles/box-maintainer/skynet-patches.md`.
- No patch number invented — commit messages use `patch:` prefix only.
- Backend-only diff check: `frontend-only ✓` (no src/backend or src/server files touched).

## Out of Scope (per bounty premise)

The dot regression (working-store signal freezes for hidden panes after 60s when WSes close) is NOT addressed by this fix. After 60s the WSes still close and the working-store signal still freezes for hidden panes. Dot fix is a separate fleet-status-backend-signal phase and is explicitly out of scope here.

## Self-Check

All four modified files exist on disk. Both commits (`daa2de0`, `6568f14`) verified present in `git log --oneline -3`.

## Known Stubs

None — all changes are functional wiring with no placeholder values.

## Threat Flags

None — changes are purely frontend timer/ref management within existing WebSocket lifecycle effects. No new network endpoints, auth paths, file access patterns, or schema changes introduced.

---

Ready for tina to claim patch number + deploy.
