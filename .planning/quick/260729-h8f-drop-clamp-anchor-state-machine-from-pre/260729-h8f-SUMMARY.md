---
phase: quick/260729-h8f
plan: "01"
subsystem: pretty-view/scroll
tags: [scroll, hook, refactor, patch-185]
dependency_graph:
  requires: []
  provides: [follow-bottom-when-near-bottom scroll contract (Phase-01)]
  affects: [src/ui/features/pretty-view]
tech_stack:
  added: []
  patterns: [follow-bottom-when-near-bottom, ResizeObserver, callback-ref]
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/use-auto-scroll.ts
    - src/ui/features/pretty-view/use-auto-scroll.test.ts
    - src/ui/features/pretty-view/PrettyView.tsx
decisions:
  - "Adapted Test O scenario: old test assumed clamp-mode hold behavior (scrollTop stays fixed while content grows past anchor ceiling); new hook scrolls to bottom when pinned, so Test O now guards the held-position-when-scrolled-up case (RO must call syncPinned even when not writing scrollTop)"
metrics:
  duration: 12min
  completed: "2026-07-29"
  tasks: 3
  files: 3
---

# Quick 260729-h8f: Drop Clamp-Anchor State Machine from Pretty-View Summary

**One-liner:** Rewrote `useAutoScroll` to Phase-01 follow-bottom-when-near-bottom contract, removing ~200 lines of clamp-anchor state machine (patches #96/#98) and the `lastUserMsgIdx` IIFE from PrettyView.tsx.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite use-auto-scroll.ts + update PrettyView.tsx call site | 54652b7 | use-auto-scroll.ts, PrettyView.tsx |
| 2 | Rewrite use-auto-scroll.test.ts | ffeb428 | use-auto-scroll.test.ts |
| 3 | Regression check — broader pretty-view suite | (no code changes) | — |

## What Changed

### use-auto-scroll.ts
- Removed: `computeAnchorPinTop`, `computeClampTarget`, `applyClampRule`, `AnchorMessage` interface, Effect 3 (anchor-key change), `modeRef`, `anchorElRef`, `anchorEventIdRef`.
- Removed: `anchorRefCallback` from return value. Hook now takes no arguments.
- Simplified internal state: one `followBottomRef` (bool, initial: true) + `isPinnedToBottom` React state (initial: true).
- ResizeObserver callback: if pinned → `scrollEl.scrollTop = scrollEl.scrollHeight`; always calls `syncPinned` to recompute pill visibility.
- Net: ~200 lines removed.

### PrettyView.tsx
- L470: `useAutoScroll(messages)` → `useAutoScroll()`, `anchorRefCallback` dropped from destructure.
- L1172–1220: Replaced IIFE (with `lastUserMsgIdx` reverse scan) with plain `messages.map((m) => <div key={m.eventId}>...</div>)`. Wrapper div has no `ref` prop.
- Updated stale jump-pill comment (removed reference to "user-driving/followBottom").

### use-auto-scroll.test.ts
- Dropped: `computeAnchorPinTop`, `computeClampTarget`, `AnchorMessage` imports; `makeAnchorEl` helper.
- Dropped test blocks: `computeAnchorPinTop`, `computeClampTarget` (Tests C/D/E), Test A (anchor selection), Test B (anchor reset), Test F' (mode-flip regression).
- Removed all `messages` arrays from `useAutoScroll()` calls.
- Adapted Test O: old scenario tested clamp-mode anchor ceiling behavior. New scenario tests that RO always calls `syncPinned` even when not writing scrollTop (guards against future regression where the `if (followBottomRef.current)` gate skips `syncPinned` for the not-pinned path).
- Added: "held position when scrolled up" — RO does NOT write scrollTop when `followBottomRef.current === false`.
- Added: "follows bottom when pinned" — RO writes `scrollTop = scrollHeight` when `followBottomRef.current === true`.
- Final count: 19 tests (all pass).

## Verification

- `npm run build:backend`: EXIT 0
- `npm run build`: EXIT 0
- `npx vitest run src/ui/features/pretty-view/use-auto-scroll.test.ts`: 19/19 pass
- `npx vitest run src/ui/features/pretty-view/`: 19 files, 172 passed, 6 skipped (pre-existing skips, not caused by this change)
- Grep: `anchorRefCallback|lastUserMsgIdx|computeAnchorPinTop|computeClampTarget|AnchorMessage|applyClampRule|user-driving|'clamp'` returns no matches in production files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test O scenario incompatible with new hook contract**
- **Found during:** Task 2 — test run
- **Issue:** Test O was written for clamp-mode behavior: initial geometry pinned (scrollTop=100, scrollHeight=500, distFromBottom=0), then content grows to scrollHeight=2000. Old hook kept scrollTop=100 (anchor-ceiling hold), so distFromBottom jumped to 1500 → pill should show (isPinnedToBottom=false). New hook: followBottomRef=true → RO writes scrollTop=2000, distFromBottom=2000-2000-400=-400 → still pinned. Test expectation of `false` was wrong for new contract.
- **Fix:** Rewrote Test O scenario to a "scrolled up, content grows, RO still calls syncPinned" guard: scrollTop=0, scrollHeight=1000, distFromBottom=600 (not pinned), then scrollHeight→2000, RO fires, assert isPinnedToBottom stays false. This validates that `syncPinned` is called unconditionally in the RO callback.
- **Files modified:** use-auto-scroll.test.ts
- **Commit:** ffeb428

## Task 3: Sibling Test Status

No sibling test file needed changes. The broader pretty-view suite (19 test files) passed without modification. No test in `PrettyView.test.tsx`, `PrettyView.aside.test.tsx`, or any other sibling file asserted anchor-ref behavior or `lastUserMsgIdx` scanning.

## Known Stubs

None.

## Threat Flags

None — this is a pure scroll behavior refactor with no new network, auth, or file access surface.

## Developer Notes

- Remember to update `~/.claude/identities/tina/skynet-patches.md` with patch #185 entry.
- Remember to update the bounty folder `~/.claude/identities/tina/bounties/pretty-view-drop-last-user-message-scroll-anchor/` to mark the bounty resolved.

## Self-Check

- [x] `src/ui/features/pretty-view/use-auto-scroll.ts` exists and contains only `BOTTOM_THRESHOLD`, `SCROLL_KEYS`, `computeFollowBottomTop`, `useAutoScroll`.
- [x] `src/ui/features/pretty-view/use-auto-scroll.test.ts` exists with 19 passing tests.
- [x] `src/ui/features/pretty-view/PrettyView.tsx` exists; no `anchorRefCallback` or `lastUserMsgIdx` references.
- [x] Commit 54652b7 exists (Task 1).
- [x] Commit ffeb428 exists (Task 2).

## Self-Check: PASSED
