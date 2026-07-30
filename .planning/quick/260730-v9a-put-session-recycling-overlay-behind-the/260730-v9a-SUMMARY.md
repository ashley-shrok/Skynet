---
phase: quick-260730-v9a
plan: 01
subsystem: pretty-view/stacking
tags: [z-index, overlay, IdentityBadge, session-recycle, quick]
dependency_graph:
  requires: []
  provides: [SessionHoldingOverlay z-[99] stacking]
  affects: [SessionHoldingOverlay.tsx, SessionHoldingOverlay.test.tsx, PrettyView.tsx, DropOverlay.tsx]
tech_stack:
  added: []
  patterns: [tailwind z-index class, component comment narrative]
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/SessionHoldingOverlay.tsx
    - src/ui/features/pretty-view/SessionHoldingOverlay.test.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/DropOverlay.tsx
decisions:
  - Chose z-[99] (not z-[100]) to mirror DropOverlay's z-[95] pattern and sit clearly below IdentityBadge's z-[101] while still above unstyled chat content
  - Used space-anchored regex `/(^| )z-\[99\]( |$)/` in the A4 test assertion rather than `\bz-\[99\]\b` because `]` is a non-word character so `\b` does not anchor after it — caught as a Rule 1 bug in the plan-specified pattern
  - Removed z-[110] mention from the SessionHoldingOverlay.tsx comment body to satisfy the grep-gate (count=0); historical context referenced only via "supersedes patch #111 rationale" phrase
metrics:
  duration: ~8 minutes
  completed: 2026-07-30
  tasks_completed: 1
  files_modified: 4
---

# Quick 260730-v9a: Put session-recycle overlay behind IdentityBadge — Summary

**One-liner:** Reversed SessionHoldingOverlay z-index from z-[110] to z-[99] so IdentityBadge (z-[101]) stays visible and clickable during the 2-15s session recycle window.

## What Was Done

Task 1 (only task): Reversed the z-index on the `SessionHoldingOverlay` scrim root from `z-[110]` to `z-[99]`, making the overlay sit BELOW `IdentityBadge` (z-[101]) instead of above it. Updated adjacent stacking comments across all four files to keep the narrative consistent. Added a new A4 test assertion pinning the z-[99] value.

### Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `src/ui/features/pretty-view/SessionHoldingOverlay.tsx` | Behavior + comment | z-[110] → z-[99] on scrim root; updated adjacent comment block with reversed rationale + "supersedes patch #111 rationale" historical trail |
| `src/ui/features/pretty-view/SessionHoldingOverlay.test.tsx` | Test | Added A4 assertion pinning z-[99]; extended docblock from three to four invariants |
| `src/ui/features/pretty-view/PrettyView.tsx` | Comment only | Updated mount-site comment from "above IdentityBadge (z-[110] > z-[101])" to "BELOW IdentityBadge (z-[99] < z-[101])" with reversed rationale |
| `src/ui/features/pretty-view/DropOverlay.tsx` | Comment only | Updated orientation parenthetical from (z-[110]) to (z-[99]) |

### Files NOT Changed

- `src/ui/features/pretty-view/IdentityModal.tsx` — L584-589 z-[110] modal-backdrop is a different concept (covers IdentityBadge while the identity modal is OPEN). Left completely untouched. Pre-existing count of 3 z-[110] hits in that file is unchanged.

## Verification Results

- `npx tsc --noEmit`: exit 0
- Colocated tests: 4 passed (A1 geometry, A2 error variant, A3 motion guardrail, A4 z-index below badge)
- Full suite: 873 passed / 6 skipped / 0 failed (baseline was 872 + 6; A4 is the +1 new test)
- grep-gate: `z-[110]` count in SessionHoldingOverlay.tsx = 0
- grep-gate: `z-[99]` count in SessionHoldingOverlay.tsx >= 1
- grep-gate: IdentityModal.tsx z-[110] count = 3 (pre-existing; untouched by this change)
- Failure-marker grep on full log: 0

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Regex word-boundary issue in plan-specified test pattern**
- **Found during:** Task 1 (GREEN phase — A4 test failed even after implementation)
- **Issue:** The plan specified `expect(cls).toMatch(/\bz-\[99\]\b/)` but `]` is a non-word character (not in `\w` set), so `\b` does not create a word boundary between `]` and the following space. The regex literal match `\[99\]` was fine but the trailing `\b` never matched.
- **Fix:** Changed to `expect(cls).toMatch(/(^| )z-\[99\]( |$)/)` — anchors on actual space/string boundaries, which correctly isolates the class token.
- **Files modified:** `src/ui/features/pretty-view/SessionHoldingOverlay.test.tsx`
- **Commit:** 90f71c7 (same task commit)

**2. [Rule 1 - Bug] Plan comment required removing z-[110] mention from component comment**
- **Found during:** Task 1 grep-gate verification
- **Issue:** The plan instructed adding a "supersedes patch #111 rationale" comment but my initial draft mentioned `z-[110]` in the comment body to explain the history. This caused `grep -c 'z-\[110\]' SessionHoldingOverlay.tsx` to return 1 instead of 0.
- **Fix:** Rewrote the comment to convey the historical context via "supersedes patch #111 rationale" and "prior elevation" without explicitly stating the old z-value.
- **Files modified:** `src/ui/features/pretty-view/SessionHoldingOverlay.tsx`
- **Commit:** 90f71c7 (same task commit)

**3. [Information] IdentityModal.tsx z-[110] count is 3, not 2 as plan expected**
- **Found during:** Task 1 pre-execution verification
- **Issue:** Plan stated `grep -c 'z-\[110\]' IdentityModal.tsx` = 2, but actual file has 3 hits (L584 comment, L589 live class, and L619 reference comment). This is a pre-existing condition — the file was not modified by this quick task.
- **Action:** Left IdentityModal.tsx completely untouched. The count of 3 is the baseline; the constraint is that OUR changes do not alter it, which they do not.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. Pure z-index CSS token change.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 90f71c7 | feat | Reverse SessionHoldingOverlay z-index to z-[99], update comments, add A4 test |

## Self-Check

### Created files exist:
- SUMMARY.md: this file

### Commits exist:
- 90f71c7: confirmed via `git rev-parse --short HEAD`

### Grep-gates passed:
- `z-[110]` in SessionHoldingOverlay.tsx: 0 - PASS
- `z-[99]` in SessionHoldingOverlay.tsx: >= 1 - PASS
- `supersedes patch #111` in SessionHoldingOverlay.tsx: 1 - PASS
- IdentityModal.tsx unchanged (pre-existing 3 hits, unmodified): PASS

## Self-Check: PASSED
