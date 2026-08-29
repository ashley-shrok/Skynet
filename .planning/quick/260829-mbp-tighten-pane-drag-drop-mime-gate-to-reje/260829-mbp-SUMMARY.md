---
phase: quick-260829-mbp
plan: "01"
subsystem: split-view-drag-drop
tags: [drag-drop, mime-gate, regression-test, pane, splitview]
dependency_graph:
  requires: []
  provides: ["tightened-pane-drag-mime-gate"]
  affects:
    - src/ui/shell/SplitView.tsx
    - src/ui/shell/SplitView.test.tsx
    - src/ui/shell/SplitView.text-selection-drag.test.tsx
tech_stack:
  added: []
  patterns:
    - "Module-scope pure function guard (hasSkynetDragPayload) replaces inline MIME check at 3 call sites"
    - "Self-contained regression test file (no cross-file helper imports)"
key_files:
  created:
    - src/ui/shell/SplitView.text-selection-drag.test.tsx
  modified:
    - src/ui/shell/SplitView.tsx
    - src/ui/shell/SplitView.test.tsx
decisions:
  - "Gate shape B (helper extraction) chosen: hasSkynetDragPayload(dt) pure function. Three call sites (onDragOver, onDragLeave, onDrop) call the helper — cleaner than three inline expressions, easy to grep, easy to extend if a third skynet MIME is added later."
  - "Two atomic commits (RED + GREEN) matching recent quick-task pattern (quick-260829-fh3)."
  - "Existing test helpers in SplitView.test.tsx updated with application/x-skynet-row in default types — those tests are about geometry/zone, not MIME discrimination, so they should have had a skynet MIME all along."
metrics:
  duration: "~7 minutes"
  completed: "2026-08-29T16:14:46Z"
  tasks_completed: 1
  files_changed: 3
---

# Quick Task 260829-mbp: Tighten Pane Drag/Drop MIME Gate Summary

One-liner: Replaced text/plain gate in all three Pane native drag listeners with hasSkynetDragPayload helper requiring application/x-skynet-badge or application/x-skynet-row, rejecting browser text-selection drags that previously created stale split slots.

## Gate Shape Chosen

**Shape B — helper extraction.** A module-scope pure function `hasSkynetDragPayload(dt: DataTransfer | null | undefined): boolean` was added directly above the `Pane` component in `SplitView.tsx`. It returns `true` iff `dt.types` includes `application/x-skynet-badge` (IdentityBadge drags) OR `application/x-skynet-row` (conv-list-row drags).

Rationale for Shape B over Shape A (inline):
- Three call sites become one line each — no copy-paste drift risk if a third skynet MIME is added.
- Grep target: `hasSkynetDragPayload` finds all three gate sites instantly.
- Consistent with the codebase pattern of extracting multi-MIME discriminator logic (cf. `computeEdgeZone`, `overlayGeometryForZone`).

## Commit SHAs

| Commit | Type | Description |
|--------|------|-------------|
| `4d9d0d46` | RED (test) | `test(quick-260829-mbp): failing regression suite for tightened Pane MIME gate` |
| `ee88877c` | GREEN (fix) | `fix(quick-260829-mbp): tighten Pane drag/drop MIME gate to reject browser text-selection drags` |

Both commits are LOCAL ONLY on `feat/tab-title-from-tmux`. Not pushed.

## Scoped Test Count

Command: `npx vitest run src/ui/shell/SplitView`

| State | Test files | Tests |
|-------|------------|-------|
| Before (HEAD `5b3ff27a`, before RED) | 2 | 28 |
| After RED commit (existing tests + new failing tests) | 3 | 28 pass + 2 fail = 30 |
| After GREEN commit | 3 | **33 pass, 0 fail** |

New tests added: 5 (Tests 1, 2-3 combined, 4, 5 in `SplitView.text-selection-drag.test.tsx`).

## Production Changes

**`src/ui/shell/SplitView.tsx`:**

1. Added `hasSkynetDragPayload` pure function (13 lines) above the `Pane` component.
2. Replaced `if (!e.dataTransfer?.types.includes("text/plain")) return;` at three sites:
   - `onDragOver` listener (~line 276 post-patch)
   - `onDragLeave` listener (~line 302 post-patch)
   - `onDrop` listener (~line 335 post-patch)
   Each now reads: `if (!hasSkynetDragPayload(e.dataTransfer)) return;`
3. Updated the `onDragLeave` rationale comment: reworded from "row-drag payload only" to "skynet drag payloads", added quick-260829-mbp reference and explanation that text-selection drags were passing the old gate.
4. The `onDrop` rich/fallback dispatch block (lines 340-369 in original) is **byte-unchanged**.

**`src/ui/shell/SplitView.test.tsx`:**

Two-place edit — updated default `types` in shared helpers from `["text/plain"]` to `["application/x-skynet-row", "text/plain"]`:
- Phase 56 `dispatchDropAt` (~L287)
- Phase 57 `dispatchDragOverAt` (~L437), `dispatchDragLeaveAt` (~L453), `dispatchDropAt` (~L469)

These tests are about geometry/zone/edge computation, not MIME discrimination — they should have had a skynet MIME all along; the old permissive gate just masked the gap.

## Deviations from Plan

None. Plan executed exactly as written.

- Gate shape B chosen (plan listed both A and B as acceptable).
- Two atomic commits chosen (plan listed both 1 and 2 commits as acceptable).
- Test 5 (row-drag positive-control) added as specified alongside Tests 1-4.
- `src/ui/shell/SplitView.test.tsx` helper stubs updated exactly as the plan's behavior block described.

## Follow-up Bounty Candidate

During the diff review, the `EmptyDropTarget` component at `SplitView.tsx:154-159` was observed to have its own `onDrop` React synthetic handler that reads `text/plain` without any skynet-MIME gate. This is a separate (and less severe) surface — `EmptyDropTarget` only renders when the split tree is null, making accidental triggers require the user to drag text over a completely empty pane. The more significant scope fence noted: **AppShell outer onDrop** (patch #510, `AppShell.tsx:2265`) may have the same text/plain-only gate issue for drags that bypass the Pane native listener. Not addressed here per the explicit scope fence — candidate for a separate bounty.

## Confirmation

- HEAD is `ee88877c` on `feat/tab-title-from-tmux`.
- NOT pushed, no docker build, no deploy.
- Three files changed: `src/ui/shell/SplitView.tsx`, `src/ui/shell/SplitView.test.tsx`, `src/ui/shell/SplitView.text-selection-drag.test.tsx`.
- Scoped suite `npx vitest run src/ui/shell/SplitView`: 33/33 pass.
