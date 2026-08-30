---
phase: quick-260829-n5z
plan: "01"
subsystem: pv-inject
tags: [bug-fix, queue-and-replay, ws-race, structured-logging, tdd]
dependency_graph:
  requires: []
  provides: [useInjectedTurnRelay hook, pv-inject structured logs, queue-and-replay on WS reconnect]
  affects: [src/ui/shell/IdentitySessionPane.tsx, PrettyView onInjectedTurnReady prop]
tech_stack:
  added: [use-injected-turn-relay.ts (new hook)]
  patterns: [queue-and-replay via pendingRef + queueMicrotask, getSendFn accessor pattern (no stale capture), StrictMode double-invoke guard]
key_files:
  created:
    - src/ui/shell/use-injected-turn-relay.ts
    - src/ui/shell/use-injected-turn-relay.test.ts
  modified:
    - src/ui/shell/IdentitySessionPane.tsx
decisions:
  - "Shape B (extracted hook) chosen over Shape A (inline) for unit-testability without PrettyView/Terminal mock scaffolding"
  - "getSendFn accessor pattern: hook reads pvSendInputRef.current at call-time via getSendFn(); never captures stale ref value"
  - "queueMicrotask for drain: pane assigns pvSendInputRef.current = fn first (so getSendFn() returns fresh fn), then notifies hook; microtask fires after assignment, StrictMode second-invoke sees null pending and skips"
  - "pendingRef clear before send in drain: prevents double-drain if two concurrent microtasks (StrictMode) both reach the drain body"
metrics:
  duration: "~15 minutes"
  completed: "2026-08-29T17:00:00Z"
  tasks_completed: 1
  files_changed: 3
---

# Quick 260829-n5z: Fix handleInjectedTurnReady silent null-drop Summary

**One-liner:** useInjectedTurnRelay hook with single-slot pendingRef queue-and-replay via queueMicrotask, replacing the silent-null-drop `if (!send) return` in IdentitySessionPane.

## Objective

Eliminate the silent-null-drop failure mode where `handleInjectedTurnReady` silently discarded
the injected turn when `pvSendInputRef.current === null` during a WS mid-reconnect / mount-race.
Ashley hit this 1-in-8 UAT sends (tina, 496KB PNG, 2026-08-29 16:20:52) — compose cleared
(outcome.ok=true), message never arrived, no error surface, no retry.

## Task Outcome

**Task 1 — RED/GREEN extraction: COMPLETE**

Created `useInjectedTurnRelay({ getSendFn })` hook + wire-up in IdentitySessionPane.

### What was built

**`src/ui/shell/use-injected-turn-relay.ts`** (new):
- `pendingRef`: single-slot `{ text, messageQueueItemId } | null` that stashes the turn when `getSendFn()` returns null.
- `onInjectedTurnReady`: entry log + branch on ref-liveness. Null path: displace-with-WARN if pending already exists, stash new. Live path: immediate split-send (byte-identical to former inline code).
- `onRegisterSendInput`: if pending exists, `queueMicrotask(() => { drain pending; send })`. Clears `pendingRef.current = null` BEFORE dispatching (StrictMode double-invoke guard).
- `onUnregisterSendInput`: emits `[pv-inject] ref unregistered` log; does NOT touch `pvSendInputRef` (pane owns the ref).
- 9 `[pv-inject]` log branches: entry, dispatching-immediately, queued-for-replay, stale-displacement WARN, draining-on-rebind, ref-went-null-before-microtask-drain, ref-went-null-in-60ms-window (×2: immediate path + drain path).

**`src/ui/shell/use-injected-turn-relay.test.ts`** (new, 6 tests):
- T1: live-ref immediate dispatch (body sync, `\r`+mqid at +60ms)
- T2: null-ref queue-and-replay (stash + drain on register + microtask flush)
- T3: stale-pending displacement (second turn displaces first with WARN; only second replays)
- T4: register/unregister/register with no pending (no replay, unregister log fires)
- T5: log assertions matrix (all 6 branch log categories asserted including 60ms-window WARN)
- T6: StrictMode double-invoke guard (two rapid onRegisterSendInput calls → exactly 2 total mockSend calls, not 4)

**`src/ui/shell/IdentitySessionPane.tsx`** (modified):
- Removed: `handleInjectedTurnReady` inline `useCallback` with silent `if (!send) return` drop.
- Added: `useInjectedTurnRelay` import + `const injectedTurnRelay = useInjectedTurnRelay({ getSendFn: () => pvSendInputRef.current })`.
- PrettyView props: `onInjectedTurnReady={injectedTurnRelay.onInjectedTurnReady}`, `onRegisterSendInput` and `onUnregisterSendInput` now call both the ref assignment AND the hook notification (ref assigned FIRST so getSendFn() returns fresh value when microtask fires).
- Removed unused `useCallback` from React import (no longer has any local useCallback calls).

## Verification Results

```
npx vitest run src/ui/shell/use-injected-turn-relay src/ui/shell/IdentitySessionPane
  Test Files  2 passed (2)
       Tests  13 passed (13)  [6 new + 7 existing P1-P7]
```

`[pv-inject]` runtime log count (comments filtered): **9** (>= 6 required).

`git diff --name-only HEAD~1 HEAD` shows exactly 2 files: `IdentitySessionPane.tsx`, `use-injected-turn-relay.ts`. Zero diff on PrettyView.tsx, use-pretty-view-uploads.ts, SplitView.tsx, CollapsedPanelCloseLane.tsx, AppShell.tsx.

## Commits

| Hash | Type | Message |
|------|------|---------|
| `931d25b7` | RED | `test(quick-260829-n5z): failing regression for handleInjectedTurnReady queue-and-replay` |
| `ba5c7944` | GREEN | `fix(quick-260829-n5z): queue-and-replay in useInjectedTurnRelay hook + pv-inject structured logs` |

## Deviations from Plan

**1. [Rule 1 - Cleanup] Removed unused `useCallback` import from React import line**

- **Found during:** Task 1, GREEN phase, wire-up step (2c).
- **Issue:** After removing the inline `handleInjectedTurnReady = useCallback(...)` block, `useCallback` was no longer used anywhere in the file. Leaving it would produce a lint warning.
- **Fix:** Removed `useCallback` from the React import — `{ forwardRef, useEffect, useImperativeHandle, useRef, useState }`.
- **Files modified:** `src/ui/shell/IdentitySessionPane.tsx`
- **Commit:** `ba5c7944` (same GREEN commit)

None other — plan executed as written.

## Ship-gate Handoff

- Scoped tests green: 13/13.
- Full-suite run and push: orchestrator scope (not executor scope per constraints).
- Bounty JSON updated: first 5 todos marked `done: true`; last 2 (full-suite + push) remain `done: false`.
- No docker build, no push, no full suite run performed.

## Follow-up Bounty Candidate

Similar pattern exists in `MessageQueueDrawer`'s `onSend` prop in `IdentitySessionPane.tsx` (line ~243): `if (!send) return false` — the drawer send also silently drops if `pvSendInputRef.current` is null. Less likely to be hit (drawer sends are user-initiated, WS usually stable by then) but worth the same queue-and-replay treatment if Ashley observes drawer sends fizzling.
