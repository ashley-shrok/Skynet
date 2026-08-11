---
phase: 31-whole-app-structured-logging-backfill
plan: "06"
subsystem: render-lifecycle-logging
tags: [render, pane-state, diag-registry, pretty-view, d13-prefix, d16-correlation, d18-discipline]
dependency_graph:
  requires:
    - 31-01 (log-dedup + [render] tick prefix in diag-emitter)
  provides:
    - "[render] pane-register/pane-unregister in diag-registry.ts"
    - "[render] pane-mount/pane-unmount in PrettyView.tsx"
    - "[pane-state] received phase= receive-side log in PrettyView.tsx"
    - "[pane-state] state-transition from= to= with D-18 guard in PrettyView.tsx"
    - paneStateRef stale-closure-safe mirror in PrettyView.tsx
  affects:
    - plan 31-08 (backend [pane-state-emitter] pairs with this frontend receive-side log for D-16 cross-side correlation)
    - plan 31-09 (final grep pass confirms no [DIAG-REPORT] survivors)
tech_stack:
  added: []
  patterns:
    - D-18 transition guard (if paneStateRef.current !== parsed.state) for no-op-write noise suppression
    - paneStateRef mirror useEffect pattern (matches dormantRef / isVisibleRef / autoplayArmedRef)
    - explicit cleanup wrapper pattern (unregister captured, console.info before calling it)
key_files:
  created: []
  modified:
    - src/ui/lib/diag-registry.ts
    - src/ui/features/pretty-view/PrettyView.tsx
decisions:
  - "paneStateRef (not stale closure read) used for from= in state-transition log — stale from= is more misleading than one additional ref"
  - "pane-mount/pane-unmount placed in the registerPane useEffect (not a separate effect) — the lifecycle of the pane in the diag-registry IS the lifecycle boundary"
  - "sessionId= field uses tmuxSession (in-scope prop at WS closure), not a non-existent sessionKey variable"
  - "Phase 27/28 virtualizer internals untouched — virtualizer-rebind opt-in hook not added (no clean hook point per plan guidance)"
  - "stale JSDoc in diag-registry.ts updated (was [DIAG-REPORT], now [render] tick) — Rule 1 auto-fix for misleading reference"
metrics:
  duration: "8 minutes"
  completed: "2026-08-11T11:54:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 2
---

# Phase 31 Plan 06: [render] Pane Lifecycle + [pane-state] Receive-Side Instrumentation Summary

**One-liner:** Per-pane register/mount/unmount [render] lifecycle events in diag-registry + PrettyView, plus [pane-state] receive-side and state-transition logs in PrettyView's case "pane_state": handler with D-18 transition guard via paneStateRef mirror.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 + 2 | Pane lifecycle + pane-state receive-side instrumentation | 44637f3 | diag-registry.ts (+4 lines), PrettyView.tsx (+34 lines) |

## What Was Built

### Task 1: diag-registry.ts — register/unregister lifecycle events

`registerPane(key, fn)` now emits:
- `console.info(\`[render] pane-register paneId=${key}\`)` — before `registry.set`
- `console.info(\`[render] pane-unregister paneId=${key}\`)` — inside the cleanup closure, before `registry.delete`

The cleanup closure race guard (`if registry.get(key) === fn`) is preserved — the unregister log only fires when the guard passes, so it is a faithful record of actual deletions (no false-positive logs when a fresh mount has already replaced the fn).

JSDoc comment at line 8 updated: `greps for [DIAG-REPORT]` → `greps for [render] tick (Phase 31 D-13 canonical prefix; was [DIAG-REPORT])` — stale reference that would mislead future grep searches.

### Task 1: PrettyView.tsx — pane-mount/pane-unmount lifecycle events

In the `registerPane` useEffect (line ~1726, deps `[hostId, tmuxSession]`):
- Added as first line of effect body: `console.info(\`[render] pane-mount paneId=${key} paneType=pretty-view hostId=${hostId} sessionKey=${tmuxSession ?? 'null'}\`)`
- Changed cleanup return from `return registerPane(key, snapshotFn)` to an explicit wrapper that logs before calling `unregister()`:
  `console.info(\`[render] pane-unmount paneId=${key} paneType=pretty-view hostId=${hostId} sessionKey=${tmuxSession ?? 'null'}\`)`

These events fire on deps change (`hostId`/`tmuxSession`) as well as true mount/unmount — each fires at a distinct pane identity boundary, which is the correct semantic (a new `hostId+tmuxSession` is a new pane).

Phase 27/28 virtualizer internals (`useVirtualizer`, `observeElementRect`, `overscan`, `scrollMargin`, Phase 28 M1-M4 fixes) NOT touched. The virtualizer-rebind opt-in (plan spec: "if no clean hook exists, do NOT add it") was not added because no clean instrumentation point exists at the H4 scrollElement re-bind path without touching Phase 28 stable code.

### Task 2: PrettyView.tsx — paneStateRef + [pane-state] receive-side logs

**paneStateRef mirror** added:
- Declaration: `const paneStateRef = useRef<PaneState | null>(null)` alongside the `paneState` state slot
- Mirror useEffect: `useEffect(() => { paneStateRef.current = paneState; }, [paneState])` after the dormantRef mirror effect — same pattern as `dormantRef` / `isVisibleRef` / `autoplayArmedRef`

**case "pane_state": handler** receives two new log lines (inserted BEFORE `setPaneState(parsed.state)`):

1. Receive-side: `console.info(\`[pane-state] received phase=${parsed.state} reason="${parsed.reason ?? ''}" sessionId=${tmuxSession ?? 'null'} hostId=${hostId}\`)`
   - `tmuxSession` is the in-scope prop name for the session identifier; no `sessionKey` or `paneId` variable exists in the WS closure scope
   - `parsed.reason` uses `?? ''` so `undefined` renders as empty string, not literal `reason=undefined`
   - Fires on EVERY pane_state frame (no dedup per D-17 opt-out — pane_state is low-frequency, 1-10 per session)

2. State-transition (D-18 guarded): `if (paneStateRef.current !== parsed.state) console.info(\`[pane-state] state-transition from=${paneStateRef.current ?? 'null'} to=${parsed.state} trigger=pane-state-frame sessionId=${tmuxSession ?? 'null'} hostId=${hostId}\`)`
   - `paneStateRef.current` provides the previous value without stale-closure risk
   - Guard suppresses same-value frames (React coalesces them too; this prevents log noise on idempotent re-emits)

D-16 note: the backend `[pane-state-emitter]` lines (plan 31-08) will pair with these frontend receive-side logs via matching `sessionId=` fields. Plan 31-08 had NOT shipped at time of this plan's execution (grep returns 0 matches). Per plan instructions this is expected — 31-06 and 31-08 are peer plans in the same wave; the D-16 cross-side correlation is unlocked when 31-08 ships.

## Line-Count Deltas

| File | Before | After | Delta |
|------|--------|-------|-------|
| `src/ui/lib/diag-registry.ts` | 88 | 92 | +4 |
| `src/ui/features/pretty-view/PrettyView.tsx` | ~2150 | ~2184 | +34 |

(Approximate counts — PrettyView is large; only instrumentation-related lines added.)

## Verification

```
npx tsc --noEmit  →  EXIT 0
npx vitest run src/ui/features/pretty-view/PrettyView  →  8 test files, 91 passed | 7 skipped | 1 todo
```

## Acceptance Criteria

- [x] `git grep -c '\[render\] pane-register' src/ui/lib/diag-registry.ts` → 1
- [x] `git grep -c '\[render\] pane-unregister' src/ui/lib/diag-registry.ts` → 1
- [x] `git grep -c '\[render\] pane-mount' src/ui/features/pretty-view/PrettyView.tsx` → 1
- [x] `git grep -c '\[render\] pane-unmount' src/ui/features/pretty-view/PrettyView.tsx` → 1
- [x] `git grep '\[DIAG-REPORT\]' src/ui/lib/diag-registry.ts src/ui/features/pretty-view/PrettyView.tsx` → only stale JSDoc comment in diag-registry.ts (updated to reference [render] tick); zero code occurrences
- [x] `git grep -c '\[pane-state\] received phase=' src/ui/features/pretty-view/PrettyView.tsx` → 1
- [x] `git grep -c '\[pane-state\] state-transition' src/ui/features/pretty-view/PrettyView.tsx` → 1 (log line) + 1 (comment)
- [x] `git grep -c 'setPaneState' src/ui/features/pretty-view/PrettyView.tsx` → 5 (same as before; no new state writes)
- [x] `git grep -c '\[pane-state-emitter\]' src/backend/` → 0 (plan 31-08 not yet shipped; D-16 correlation will be unlocked when 31-08 ships)
- [x] `npx tsc --noEmit` → exit 0
- [x] `npx vitest run src/ui/features/pretty-view/PrettyView` → exit 0

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale JSDoc reference in diag-registry.ts**
- **Found during:** Task 1
- **Issue:** Line 8 still said `greps for [DIAG-REPORT]` — misleading after plan 31-01 renamed the emit prefix to `[render] tick`. Future maintainers or operators using this as a grep guide would look for the wrong string.
- **Fix:** Updated to `greps for [render] tick (Phase 31 D-13 canonical prefix; was [DIAG-REPORT])`
- **Files modified:** `src/ui/lib/diag-registry.ts`
- **Commit:** 44637f3

### D-16 Correlation Status

Plan 31-06 ships the FRONTEND receive-side `[pane-state]` logs. The BACKEND emit-side `[pane-state-emitter]` logs (plan 31-08) had not shipped at execution time. This is expected wave-2 parallelism — 31-06 and 31-08 execute as peers. The correlation is unlocked when 31-08 ships and operators can then grep both sides by `sessionId=`.

### Virtualizer opt-in skipped

Plan spec: "If no such hook exists cleanly, do NOT add it." No clean instrumentation point at the Phase 28 H4 scrollElement re-bind path exists without touching stable code. Virtualizer-rebind log omitted per plan guidance.

## Known Stubs

None. All log lines are fully wired. `paneStateRef` is immediately used by the state-transition guard.

## Threat Flags

No new security surface introduced. Log lines contain only: paneId (hostId+tmuxSession composite, no user content), paneType (constant "pretty-view"), hostId (numeric), tmuxSession (session name, opaque identifier). The `parsed.reason` field from `[pane-state]` is printed to the console-forward stream only (not UI), consistent with T-30-03-03 mitigation in the threat model at line 1131-1135 of PrettyView.tsx.

## Phase 27/28 Virtualizer Invariant Confirmation

Phase 27/28 internals NOT edited. Verified by diff: no lines added or modified in `useVirtualizer`, `observeElementRect`, `overscan`, `scrollMargin`, `initialRect`, `getItemKey`, `estimatePvBubbleSize`, or the H3/H4 fix comment blocks.

## Self-Check

Files verified:
- `src/ui/lib/diag-registry.ts` — FOUND (modified)
- `src/ui/features/pretty-view/PrettyView.tsx` — FOUND (modified)

Commits verified:
- `44637f3` — FOUND

## Self-Check: PASSED
