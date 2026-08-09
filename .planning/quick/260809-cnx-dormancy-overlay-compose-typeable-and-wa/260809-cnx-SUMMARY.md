---
phase: quick-260809-cnx
plan: 01
subsystem: pretty-view / dormancy-overlay
tags: [dormancy, compose-box, waking-reset, visibility-edge, ux]
dependency_graph:
  requires: [quick-260808-cd6, quick-260808-b74]
  provides: [CNX-A, CNX-B]
  affects: [PrettyView, DormancyOverlay, ComposeBox]
tech_stack:
  added: []
  patterns: [prevIsVisibleRef-edge-detector, dormant-mount-gate-extension]
key_files:
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.test.tsx
decisions:
  - "Used prevIsVisibleRef initialized to current isVisible so initial mount does not trigger waking reset"
  - "Defined local mountDormancyPV/sendDormantFrame copies in new describe block (additive, no hoisting refactor)"
  - "onSend reference captured from mountDormancyPV() and reused across rerenders in Fix B test for React tree stability"
metrics:
  duration: ~15 minutes
  completed: 2026-08-09
  tasks_completed: 2
  files_modified: 2
---

# Phase quick-260809-cnx Plan 01: Dormancy Overlay ComposeBox Typeable + Waking-Reset Summary

**One-liner:** Two additive dormant-flow refinements: ComposeBox mount gate extended to include `dormant` (CNX-A), and a prevIsVisibleRef edge-detector useEffect added to clear stale waking state on isVisible false→true (CNX-B).

## What Was Built

### Fix A (CNX-A) — ComposeBox mount gate extension

`PrettyView.tsx:~1858`: Changed

```
{onSend && (status === "streaming" || status === "error") && (
```

to

```
{onSend && (status === "streaming" || status === "error" || dormant) && (
```

When the backend emits `{type:'dormant', dormant:true}` the ComposeBox now mounts alongside the DormancyOverlay. The pre-existing `dormantActive={dormant || waking}` prop already disables Send/reset/queue/thumbsUp/paperclip while keeping textarea + mic typeable, so no further prop changes were needed.

### Fix B (CNX-B) — Visibility-edge waking-state reset

Added immediately after the existing `dormantRef` mirror useEffect (~line 1158-1163):

1. `const prevIsVisibleRef = useRef<boolean>(isVisible)` — initialized to current `isVisible` so initial mount with `isVisible=true` does NOT fire the reset (the `!prev && isVisible` guard is false).
2. A new `useEffect(() => { ... }, [isVisible])` that detects the false→true edge and calls `setWaking(false)`, `setWakingStartTs(null)`, `setElapsedSeconds(0)`, `setWakeError(null)`.

This prevents the stuck "Waking up…" overlay when Ashley returns to a pane whose WS was closed by patch #344 during hidden-time and whose session has since re-dormanted.

## Tests Added

New `describe("quick 260809-cnx dormant flow refinements", ...)` block placed between `quick 260808-cd6` and `quick 260808-ho2` describes in `PrettyView.test.tsx`:

- **Fix A test:** After `mountDormancyPV()` + `sendDormantFrame(ws, true)`: asserts DormancyOverlay is in DOM, `button[aria-label="Send"]` is present and `disabled`, and `textarea` is present and NOT disabled.
- **Fix B test:** After mounting, sending dormant frame, clicking Wake (enters "Waking up…" state), rerenders with `isVisible={false}` then `isVisible={true}`: asserts `container.textContent` does NOT contain `'Waking up…'`.

Both tests reuse module-scope `wsStubs`, `getCurrentWs`, `flipToStreaming` with local copies of `mountDormancyPV`/`sendDormantFrame` (additive — no hoisting refactor needed).

## Verification Results

- `npx tsc --noEmit`: no errors
- `npx vitest run src/ui/features/pretty-view/PrettyView.test.tsx`: 30 passed, 1 skipped (pre-existing)
- `npx vitest run` (full suite): 133 files, 1670 passed, 6 skipped, 0 failures

## Deviations from Plan

None — plan executed exactly as written.

No architectural changes. No DormancyOverlay.tsx or ComposeBox.tsx modifications.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary changes.

## Self-Check: PASSED

- `src/ui/features/pretty-view/PrettyView.tsx` — modified, verified via grep
- `src/ui/features/pretty-view/PrettyView.test.tsx` — modified, verified via grep
- Commit `cc58fa2` (Task 1 — PrettyView.tsx): exists
- Commit `4277b33` (Task 2 — PrettyView.test.tsx): exists
- Full suite green: 1670 passed, 0 failures
