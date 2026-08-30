---
phase: 260724-bwi
plan: 01
subsystem: pretty-view
tags:
  - websocket
  - pretty-view
  - reconnect
  - ios-pwa
dependency_graph:
  requires:
    - src/ui/api/claude-session-api.ts (openClaudeSessionSocket — unchanged)
    - Terminal.tsx (pattern source — unchanged)
  provides:
    - PrettyView WebSocket auto-reconnect (patch #148)
  affects:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.test.tsx
tech_stack:
  added: []
  patterns:
    - retryKey state + useEffect re-run mechanic (mirrors Terminal.tsx)
    - paneKeyRef guard (distinguish fresh pane mount from retry re-run)
    - statusRef mirror useEffect (read status in WS callbacks without double-setState)
key_files:
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.test.tsx
decisions:
  - MAX_RECONNECT_ATTEMPTS=5 module-scope const (not magic number)
  - Linear-with-cap backoff 2/4/6/8/8s — cheaper than Terminal.tsx's exponential since claude-session WS is cheap to open
  - retryKey + useEffect re-run pattern chosen over inline reconnect loop (idiomatic React)
  - statusRef mirror avoids functional-update double-setState in WS callbacks
  - "inactive" server state hard short-circuits ALL retry paths (FALLBACK-01 preservation)
  - paneKeyRef guards full-reset so retry re-runs preserve messages (no blank-flash)
  - reconnectAttemptsRef NOT reset on ws.onopen (would defeat cap on rapid open/close cycles)
  - visibilitychange:visible always resets counter to 0 (fresh budget for each foreground event)
metrics:
  duration: "~35min"
  completed: "2026-07-24"
  tasks: 2
  files_changed: 2
---

# Phase 260724-bwi Plan 01: PrettyView WebSocket Auto-Reconnect (patch #148) Summary

**One-liner:** WebSocket auto-reconnect in PrettyView mirroring Terminal.tsx's proven pattern — 5 attempts with 2/4/6/8/8s linear-capped backoff plus visibilitychange:visible fresh-budget reset for Ashley's iOS PWA persistent "Connection closed" bug.

## What Was Built

PrettyView.tsx previously had a dead-end `ws.onclose` handler with an explicit "Do NOT auto-reopen" comment that only set status="error" and errorMessage="Connection closed" — with no retry. This meant any transient WS drop (deploy container recreate, iOS PWA backgrounding) would leave Ashley staring at "Connection closed" until she manually toggled the pretty-view off and on.

Patch #148 replaces that dead-end with:

1. **`MAX_RECONNECT_ATTEMPTS = 5` module-scope const** above the component function.

2. **Three new refs + one new state:**
   - `reconnectAttemptsRef` — attempt counter, persists across retryKey re-runs, resets on hostId/tmuxSession change and visibilitychange:visible
   - `reconnectTimeoutRef` — pending retry timer, cleared on cleanup/unmount/visibility-hide
   - `paneKeyRef` — `"${hostId}::${tmuxSession}"` mirror for distinguishing fresh pane mounts from retry re-runs inside the WS effect
   - `retryKey` state — bumped by retry scheduler and visibilitychange handler; added to WS-setup useEffect deps

3. **`statusRef` mirror useEffect** — keeps `statusRef.current` in sync with `status` state so WS callbacks read current status without triggering functional-update double-renders.

4. **Modified WS-setup useEffect:**
   - Full-reset block (setMessages, setStatus("connecting"), etc.) gated by `paneKey !== paneKeyRef.current` — retry re-runs skip the reset, preserving conversation state so the UI doesn't flash blank while reconnecting
   - `ws.onopen` clears `errorMessage(null)` to remove stale "Connection closed" banner on successful reconnect
   - `ws.onclose` replaced with retry-scheduling handler: reads `statusRef.current`, short-circuits on "inactive" (FALLBACK-01 preservation), sets status="error" + errorMessage="Connection closed" then schedules retry if under cap with `Math.min(2000 * (attempt+1), 8000)` backoff
   - Cleanup clears `reconnectTimeoutRef` before `ws.close()` so unmount never fires a stale retry
   - Deps array: `[hostId, tmuxSession, retryKey]`

5. **visibilitychange useEffect (mount-once, deps=[]):**
   - Hidden branch: clears pending reconnect timer (avoid background wake)
   - Visible branch: no-ops if status="inactive" or WS already OPEN; otherwise resets `reconnectAttemptsRef.current = 0` and bumps `retryKey` immediately — this is the direct Ashley iOS PWA fix

6. **4 new reconnect tests** in a dedicated `describe("PrettyView — patch #148 WebSocket auto-reconnect")` block with fake timers:
   - Test A: retry-on-close fires fresh WS after 2s backoff and clears errorMessage on onopen
   - Test B: max-attempt cap — no 7th WS after 5 consecutive closes reach attempt=5
   - Test C: visibilitychange:visible resets counter and opens fresh WS after cap
   - Test D: inactive status short-circuits retry — no new WS after onclose

## Deviations from Plan

### Scope Adjustment

**[Rule 2 - Missing] wsStubs mock factory: readyState mutation in fireClose helper**
- **Found during:** Test C implementation
- **Issue:** The WS stub mock always returns `readyState: 1`. The visibilitychange handler guards on `wsRef.current?.readyState === 1` to skip reconnect if still connected. With a mock that never changes readyState, the handler would always think the WS is still OPEN and skip the reconnect, making Test C impossible to pass.
- **Fix:** `fireClose(ws)` helper now also sets `ws.readyState = 3` (WebSocket.CLOSED) before calling `ws.onclose?.()`. This correctly simulates a closed WS — the real browser WebSocket always has readyState=3 by the time onclose fires.
- **Files modified:** `PrettyView.test.tsx` (fireClose helper only)
- **Plan alignment:** Plan said "If that doesn't match reality in the jsdom environment (React 18/19 batching), fall back to a single advance(0) to flush microtasks" — this is the correct jsdom-reality adjustment.

**[Rule 3 - Blocking] ResizeObserver not defined in jsdom under fake timers**
- **Found during:** Initial test run with fake timers
- **Issue:** The Phase 05 describe block (pre-existing tests) didn't hit `ResizeObserver is not defined` because their real timers let React's passive effects flush differently. With fake timers, `useAutoScroll`'s `new ResizeObserver(...)` triggered synchronously during React commit.
- **Fix:** Added `vi.stubGlobal('ResizeObserver', ...)` in the reconnect describe's `beforeEach`. Used `vi.fn(function() { return {...} })` (regular function, not arrow fn) so `new ResizeObserver(...)` works as a constructor.
- **Files modified:** `PrettyView.test.tsx` (reconnect describe block's beforeEach/afterEach only)

**[Planned] Separate describe blocks for fake vs real timers**
- Plan explicitly anticipated this: "if any of them rely on real timers, either add vi.useRealTimers() at the start of those tests OR move the fake-timer setup to a separate describe block"
- Chose separate describe block — cleaner isolation, no per-test timer setup/teardown

**[Size] Net additions slightly over plan budget**
- Plan: "~40-60 net new lines in PrettyView.tsx"
- Actual: 117 net additions (137 add, 20 delete)
- Reason: The plan required thorough comment documentation of the mirror-of-Terminal pattern, the "inactive" short-circuit rationale, the backoff schedule, and the visibilitychange:visible path. The comments account for the majority of additions; the functional code changes are minimal (~30-40 lines of actual logic).

## Verification Results

All grep gates pass:
- `grep -c 'reconnectAttemptsRef' PrettyView.tsx` = 9 (>= 3)
- `grep -c 'MAX_RECONNECT_ATTEMPTS' PrettyView.tsx` = 4 (>= 2)
- `grep -c 'visibilitychange' PrettyView.tsx (non-comment)` = 2 (>= 2)
- `grep -c 'Do NOT auto-reopen' PrettyView.tsx` = 0 (required 0)
- `grep -c 'reconnectTimeoutRef' PrettyView.tsx` = 10 (>= 3)
- `grep -c 'retryKey' PrettyView.tsx` = 11 (>= 3)

Test results:
- `npm test -- pretty-view/PrettyView --run`: 7/7 tests pass (3 Phase 05 + 4 new reconnect)
- `npm run type-check`: clean (no new errors)
- `npm run build`: clean (4.09s)
- Protected files unchanged: Terminal.tsx, ConnectionLogContext.tsx, claude-session-api.ts, IdentityModal.tsx

## Known Stubs

None — implementation is fully wired. No placeholder text, no hardcoded empty values flowing to UI.

## Self-Check: PASSED

- `src/ui/features/pretty-view/PrettyView.tsx` exists and contains MAX_RECONNECT_ATTEMPTS, reconnectAttemptsRef, visibilitychange, retryKey
- `src/ui/features/pretty-view/PrettyView.test.tsx` exists and contains 4 new reconnect tests
- Commit `742a98a` exists on `feat/tab-title-from-tmux` with correct subject
- No Co-Authored-By trailer in commit
- No push to origin, no deploy, skynet-patches.md not updated
