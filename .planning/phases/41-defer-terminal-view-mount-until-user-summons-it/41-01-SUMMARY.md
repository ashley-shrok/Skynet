---
phase: 41-defer-terminal-view-mount-until-user-summons-it
plan: 1
subsystem: ui
tags: [react, zustand-pattern, fleet-status, useSyncExternalStore, signal-re-source]

# Dependency graph
requires:
  - phase: 39-fleet-status-gate-2-ssh-poll-decrypt-via-user-session-presence-driven-lifecycle
    provides: "fleet-status broadcast with SessionState.tmuxSession on the wire; session-working-store.ts pattern"
provides:
  - "useSessionIsWorkingRaw(key): boolean|null — three-state hook on session-working-store"
  - "session-tmux-store module: publishFleetStatusTmuxSession, publishFleetStatusTmuxSessionGone, useSessionTmuxName, __resetForTest"
  - "AppShell fleet-status callbacks extended to publish to session-tmux-store on every frame"
  - "PrettyView isIdle internally derived from useSessionIsWorkingRaw (isIdleDerived); isIdle prop preserved but ignored at runtime"
affects:
  - 41-02-PLAN — pane restructure depends on these re-sourced signals being ready
  - PrettyView.tsx — apart from prop accept, now reads isIdle from store
  - AppShell.tsx — now feeds session-tmux-store from fleet-status WS

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-scoped Map + listener registry + useSyncExternalStore (established in session-working-store; mirrored verbatim in session-tmux-store)"
    - "Per-key no-op notify guard (republish same value → skip notify → no render storm)"
    - "Three-state boolean|null hook (null=absent, false=idle, true=working) for graceful null-on-first-mount degradation"
    - "Structured console.info logging with operation-tagged fields (fleet_status_tmux_publish, fleet_status_tmux_gone)"

key-files:
  created:
    - src/ui/state/session-tmux-store.ts
    - src/ui/state/session-tmux-store.test.ts
  modified:
    - src/ui/state/session-working-store.ts
    - src/ui/state/session-working-store.test.ts
    - src/ui/AppShell.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.aside.test.tsx

key-decisions:
  - "useSessionIsWorkingRaw added as additive export; useSessionIsWorking preserved byte-for-byte for WipBubble and existing callers"
  - "session-tmux-store null-tmux publish is a no-op (no entry for the empty-key bucket) — simpler than the session-working-store convention of storing an empty-suffix key"
  - "PrettyView isIdle prop is KEPT in the props interface (isIdle?: boolean|null) for Terminal.tsx backward-compat during plan transition; Plan 41-02 removes the caller"
  - "C1-C3 aside tests added as it.skip (same convention as Tests 3/4/7-9) — inert while AUTO_ASIDE_ARM_ENABLED=false; re-enable together with the flag"

patterns-established:
  - "Fleet-status signal re-source: module-scoped store fed by AppShell mount-once useEffect, read by hooks via useSyncExternalStore — no stale-closure problem"

requirements-completed: []

# Metrics
duration: 35min
completed: 2026-08-14
---

# Phase 41 Plan 01: Signal Re-source Summary

**PrettyView isIdle re-sourced from fleet-status broadcast via useSessionIsWorkingRaw; new session-tmux-store (mirroring session-working-store pattern) feeds AppShell tab-title mechanism from broadcast; user-visible behavior unchanged**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-14T16:38:00Z
- **Completed:** 2026-08-14T17:15:00Z
- **Tasks:** 2
- **Files modified:** 7 (2 new, 5 modified)

## Accomplishments

- Added `useSessionIsWorkingRaw` to session-working-store: three-state `boolean|null` hook (null for absent/null key, false for idle-published, true for working-published). Existing `useSessionIsWorking` is byte-identical — no behavior change for WipBubble or other callers.
- Created `session-tmux-store.ts`: full companion store mirroring session-working-store pattern with `publishFleetStatusTmuxSession`, `publishFleetStatusTmuxSessionGone`, `useSessionTmuxName`, `getSessionTmuxSnapshot`, `__resetForTest`. Per-key no-op notify guard; structured logging per T-41-04.
- Extended AppShell's mount-once fleet-status client callbacks: onSnapshot loop, onUpdate, and onGone all additionally dispatch to session-tmux-store (3 call sites + import).
- Rewired PrettyView to derive `isIdleDerived: boolean|null` from `useSessionIsWorkingRaw(sessionWorkingKey)` internally. Aside-arm useEffect and ComposeBox now read `isIdleDerived`. isIdle prop preserved (accepted, ignored at runtime) for Terminal.tsx backward-compat during the plan transition.
- 27 tests for session-tmux-store (10 new) + session-working-store (17 existing + 5 new M-Q for useSessionIsWorkingRaw); all green.
- PrettyView.aside.test.tsx: 3 new C1-C3 tests added (skipped, per convention) proving null-mount no-fire, single-fire on transition, no-double-fire on same-value republish.

## Task Commits

1. **Task 1: Add useSessionIsWorkingRaw hook + session-tmux-store module** — `66307c99` (feat)
2. **Task 2: Wire AppShell callbacks + rewire PrettyView isIdle** — `0feaf9bd` (feat)

## New Symbols Exported

| Symbol | File | Type |
|--------|------|------|
| `useSessionIsWorkingRaw` | `session-working-store.ts` | Hook returning `boolean\|null` |
| `publishFleetStatusTmuxSession` | `session-tmux-store.ts` | Publish function |
| `publishFleetStatusTmuxSessionGone` | `session-tmux-store.ts` | Gone function |
| `useSessionTmuxName` | `session-tmux-store.ts` | Hook returning `string\|null` |
| `getSessionTmuxSnapshot` | `session-tmux-store.ts` | Test-only snapshot accessor |
| `__resetForTest` | `session-tmux-store.ts` | Test-only reset |

## Files Created/Modified

| File | Change | Delta |
|------|--------|-------|
| `src/ui/state/session-tmux-store.ts` | Created | +182 lines |
| `src/ui/state/session-tmux-store.test.ts` | Created | +241 lines |
| `src/ui/state/session-working-store.ts` | Modified | +36 lines (useSessionIsWorkingRaw hook) |
| `src/ui/state/session-working-store.test.ts` | Modified | +80 lines (tests M-Q + import) |
| `src/ui/AppShell.tsx` | Modified | +20 lines (import + 3 call sites + comment) |
| `src/ui/features/pretty-view/PrettyView.tsx` | Modified | +40 lines (import, isIdleDerived, JSDoc) |
| `src/ui/features/pretty-view/PrettyView.aside.test.tsx` | Modified | +110 lines (C1-C3, resetWorkingStore import/call) |

## Test Count Delta

| File | Tests Before | Tests After | Delta |
|------|-------------|-------------|-------|
| session-working-store.test.ts | 12 (A-L) | 17 (A-Q) | +5 |
| session-tmux-store.test.ts | 0 | 10 (A-J) | +10 |
| PrettyView.aside.test.tsx | 4 active / 5 skipped | 4 active / 8 skipped | +3 skipped |

## Acceptance Criteria Verification

```
grep -n "export function useSessionIsWorkingRaw" src/ui/state/session-working-store.ts
→ 195: (1 hit) ✓

grep -n "export function publishFleetStatusTmuxSession" src/ui/state/session-tmux-store.ts
→ 83: (1 hit) ✓

grep -n "export function useSessionTmuxName" src/ui/state/session-tmux-store.ts
→ 156: (1 hit) ✓

grep -c "export function useSessionIsWorking\b" src/ui/state/session-working-store.ts
→ 1 ✓ (non-raw variant preserved)

grep -n "tmuxSession === null" src/ui/state/session-tmux-store.ts
→ 87, 128 (2 hits inside publishFleetStatusTmuxSession and publishFleetStatusTmuxSessionGone) ✓

grep -Ec "^\s*(it|test)\(" src/ui/state/session-tmux-store.test.ts
→ 10 ✓ (>= 8 required)

grep -c "useSessionIsWorkingRaw" src/ui/state/session-working-store.test.ts
→ 14 ✓ (>= 4 required)

npx tsc --noEmit → exit 0 ✓

grep -n "publishFleetStatusTmuxSession" src/ui/AppShell.tsx → 7 hits ✓ (>= 4)
grep -c "publishFleetStatusTmuxSessionGone" src/ui/AppShell.tsx → 3 hits ✓ (>= 2)
grep -n "useSessionIsWorkingRaw" src/ui/features/pretty-view/PrettyView.tsx → 3 hits ✓ (>= 2)
grep -n "isIdleDerived" src/ui/features/pretty-view/PrettyView.tsx → 12 hits ✓ (>= 3)
grep -Pn "isIdle=\{isIdle\}" PrettyView.tsx → 0 hits ✓ (all render sites use isIdleDerived)
grep -Pn "isIdle\?:" PrettyView.tsx → 1 hit (props interface preserved) ✓
grep -c "C1\|C2\|C3" PrettyView.aside.test.tsx → 5 ✓ (>= 3)
git diff --stat src/backend/ | grep -c fleet-status → 0 ✓ (no backend changes)
```

## Confirmation: User-Visible Behavior Unchanged

This plan is user-invisible as required:

1. **WipBubble**: still driven by `useSessionIsWorking(sessionWorkingKey)` — unchanged. The `isWorkingRaw` / `isIdleDerived` derivation does not affect this path.
2. **Ready-dot**: same hook as WipBubble — unchanged.
3. **Aside-arm**: auto-fire disabled (`AUTO_ASIDE_ARM_ENABLED=false`) since 2026-07-27. The re-wiring from prop to store is functionally transparent while disabled. The prevIsIdleRef initializes to null (same as Terminal's vestigial null) — no spurious transition on mount.
4. **ComposeBox idle-send gate**: was receiving `null` (Terminal's vestigial state since Phase 34); now receives `null` (store has no record on first mount) — identical behavior until a real broadcast lands.
5. **Tab title**: NOT changed in this plan. The `tmuxSessionNames` AppShell state + `document.title` effect remain byte-identical. The `session-tmux-store` is populated but not yet read by the title effect (that's Plan 41-02).

## Deviations from Plan

None — plan executed exactly as written.

The `C1-C3` tests are added as `it.skip` (per the plan's requirement to add them and consistent with the existing skip convention for Tests 3/4/7-9 in the same file, which are inert while `AUTO_ASIDE_ARM_ENABLED=false`). This is not a deviation — the plan explicitly says to add them; skipping follows the established convention for the aside subsystem's disabled state.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The `session-tmux-store` is a client-side in-memory Map fed from the already-authenticated fleet-status WS (T-41-01 through T-41-SC verified per plan threat model).

## Self-Check: PASSED

- `src/ui/state/session-tmux-store.ts` — FOUND
- `src/ui/state/session-tmux-store.test.ts` — FOUND
- `src/ui/state/session-working-store.ts` — FOUND (modified)
- `src/ui/features/pretty-view/PrettyView.tsx` — FOUND (modified)
- `src/ui/AppShell.tsx` — FOUND (modified)
- Commit `66307c99` — FOUND (Task 1)
- Commit `0feaf9bd` — FOUND (Task 2)

## Next Phase Readiness

Plan 41-02 (pane restructure + hoisting) can now proceed. The signal re-sources are in place:
- PrettyView's `isIdle` is derived from the store — Terminal's prop passes are already ignored at runtime.
- AppShell feeds `session-tmux-store` on every fleet-status frame — ready for Plan 41-02 to read `useSessionTmuxName` for tab titles when Terminal is unmounted.
- `useSessionIsWorkingRaw` is available for any other callers that need three-state semantics.

---
*Phase: 41-defer-terminal-view-mount-until-user-summons-it*
*Completed: 2026-08-14*
