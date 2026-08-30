---
phase: quick-260813-qox
plan: 01
subsystem: pretty-view auto-scroll
tags: [auto-scroll, prettyview, useAutoScroll, ResizeObserver, phase-32-correction, TDD-negative-test]
dependency_graph:
  requires:
    - Phase 32 (use-auto-scroll.ts three-case sticky-bottom model)
    - Phase 27 (PrettyView virtualization test infrastructure, capturedROCallbacks pattern)
  provides:
    - useAutoScroll(paneKey, messageCount) — signature-broken split of Case 2 into (a) new-message useEffect + (b) pill-visibility-only RO
    - Test 2c invariant witness (tall-bubble re-measure while sticky does NOT yank scrollTop)
    - Phase 32 CONTEXT.md § Post-ship correction (2026-08-13) — append-only documentation
  affects:
    - PrettyView.tsx L685 call site (added messages.length arg)
tech-stack:
  added: []
  patterns:
    - useEffect dep-array-driven signals over ResizeObserver polymorphism (semantic separation of new-message vs re-measure events)
    - Negative-invariant test (RO fire without messageCount growth → assert scrollTop unchanged)
key-files:
  created:
    - .planning/quick/260813-qox-fix-prettyview-auto-scroll-snap-back-jum/260813-qox-SUMMARY.md
  modified:
    - src/ui/features/pretty-view/use-auto-scroll.ts
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/PrettyView.virtualization.test.tsx
    - .planning/phases/32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho/32-CONTEXT.md
decisions:
  - Splitting Case 2 into two effects (new-message signal keyed on messageCount + pill-only RO) is the structural fix Ashley greenlit over a narrow MEASUREMENT_DELTA_IGNORE_PX threshold-bump — it eliminates the conflation at the source rather than papering over the delta filter.
  - Preserved the RO + per-child + MutationObserver machinery in the pill-visibility effect (rather than dropping the RO entirely) because pill visibility must reflect ANY scrollHeight change while non-sticky — including tall-bubble re-measure while the user is scrolled up reading history.
  - New-message useEffect intentionally fires on mount (initial messageCount=0) — Case 1's paneKey effect already handles session-first-load stickying so a harmless second nudge here is acceptable and requires no guard.
  - Test 2b's manual capturedROCallbacks loop was removed (no longer needed to drive the follow) rather than kept as a no-op harmless-fire — under the new semantics the follow is driven by React commit of the messageCount dep change, and keeping the RO loop would misdirect future readers about where the primitive lives.
  - Test 3's capturedROCallbacks loop was retained (harmless setIsPinnedToBottom-only fire under new semantics) with a retitled comment — dropping it would have shrunk coverage of the RO's pill-visibility side effect for no gain.
metrics:
  duration: ~15min
  completed: 2026-08-13
---

# Quick 260813-qox: Fix PrettyView auto-scroll snap-back / jump on tall-bubble re-measure — Summary

**One-liner:** Split `useAutoScroll` Case 2 into a `messageCount`-keyed new-message useEffect plus a `setIsPinnedToBottom`-only ResizeObserver so tall-bubble re-measure no longer yanks scrollTop while the user is trying to scroll up through history.

## What shipped

Two atomic commits on `feat/tab-title-from-tmux`:

| Commit    | Type | Description                                                                             |
| --------- | ---- | --------------------------------------------------------------------------------------- |
| `7484017` | fix  | quick-260813-qox-01: split useAutoScroll Case 2 — new-message effect + RO pill-only     |
| `fc26e1f` | test | quick-260813-qox-02: virtualization tests + Phase 32 CONTEXT.md post-ship correction    |

### Files modified

- `src/ui/features/pretty-view/use-auto-scroll.ts`:
  - Hook signature: `useAutoScroll(paneKey: string, messageCount: number): UseAutoScrollResult`
  - Deleted `prevScrollHeightRef`
  - Replaced single Case 2 useEffect with TWO effects:
    - Effect A (new-message jump): deps `[scrollEl, messageCount, jumpToBottom]`; body: `if (stickyRef.current) jumpToBottom(scrollEl);`
    - Effect B (RO pill-visibility): deps `[scrollEl]`; callback body: `setIsPinnedToBottom(dist <= BOTTOM_THRESHOLD)` (no branch, no `jumpToBottom` call, `shrunk`/`prevScrollHeightRef` guards removed)
    - Retained: outer-container RO + per-child RO observation + MutationObserver for accessory mounts
  - Module-level comment block updated to reflect the split; retained the Phase 32 CONTEXT.md reference AND the "Deliberately NOT here" bullet list.
  - Byte-preserved: Case 1 paneKey-change rAF chain, Case 3 `scrollToBottomAndFollow`, single scroll listener (both `programmaticRef` and `MEASUREMENT_DELTA_IGNORE_PX` gates), all constants (`BOTTOM_THRESHOLD = 100`, `STICK_ARM_MS = 150`), no new refs/state/exports.

- `src/ui/features/pretty-view/PrettyView.tsx` (single-line edit at L685):
  - `useAutoScroll(paneKey)` → `useAutoScroll(paneKey, messages.length)`

- `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx`:
  - Test 2b (`incoming message while at bottom — follows`): removed the manual `capturedROCallbacks` loop (follow is now driven by the new-message useEffect on React commit of messages.length growth); updated inline comment and title to reflect "new-message useEffect on messageCount growth" rather than "RO on scrollHeight growth"; assertion `expect(geom.getScrollTop()).toBe(5200)` unchanged.
  - Test 3 (`incoming message while scrolled up — does NOT yank`): retained the `capturedROCallbacks` loop with a retitled comment noting the RO callback is now setIsPinnedToBottom-only under the correction; critical assertion `expect(geom.getScrollTop()).toBe(1000)` unchanged.
  - NEW Test 2c (`tall-bubble re-measure while sticky — RO-only fire (no new message) does NOT trigger jumpToBottom`): mirrors Test 2b's fake-timer + rAF stub scaffold; bumps `geom.setScrollHeight(5800)` to simulate tall-bubble re-measure WITHOUT firing a WS frame; manually fires `capturedROCallbacks` to simulate the browser RO; asserts `geom.getScrollTop() === 5000` (NO auto-jump). This test would have FAILED against the pre-fix hook (RO would have yanked to 5800) and PASSES against the post-fix hook.

- `.planning/phases/32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho/32-CONTEXT.md`:
  - Append-only edit: new `## Post-ship correction (2026-08-13)` section at end of file with Symptom (Ashley quote), Root cause (RO conflated new-message vs re-measure, both failure modes explained), Structural fix (split into two effects; messageCount parameter), and "What is NOT re-litigated" (list of all LOCKED elements preserved verbatim). `git diff` confirms zero changes to L1-181 — pure additive correction.

## Verification

- `npx tsc --noEmit` exits 0.
- `npx vitest run` exits 0 — **172 test files, 2180 pass + 6 skipped + 1 todo**, zero failures. Up from prior baseline by exactly one (the new Test 2c).
- `git diff --stat HEAD~2 HEAD -- src/backend/` shows zero lines — no backend files touched.
- Grep proofs:
  - `grep -c 'useAutoScroll(paneKey, messages.length)' src/ui/features/pretty-view/PrettyView.tsx` = 1 ✓
  - `grep -c 'prevScrollHeightRef' src/ui/features/pretty-view/use-auto-scroll.ts` = 0 ✓
  - `grep -v '^\s*//' src/ui/features/pretty-view/use-auto-scroll.ts | grep -c 'jumpToBottom(scrollEl)'` = 4 ✓ (Case 1 tick body, Case 3 initial jump, Case 3 rAF re-arm tick body, Case 2 new-message effect body — zero inside any RO callback)
  - `grep -c 'Post-ship correction (2026-08-13)' .planning/phases/32-.../32-CONTEXT.md` = 1 ✓
  - `grep -c 'Test 2c' src/ui/features/pretty-view/PrettyView.virtualization.test.tsx` = 1 ✓ (matches on the new it() description)

## Semantic proof by test

The new Test 2c is the invariant witness for the correction:

- **Pre-fix hook**: mount at scrollTop=5000, sticky=true; simulate tall-bubble re-measure by bumping scrollHeight to 5800 and firing RO callbacks; RO callback checks `stickyRef.current` (true) and `!shrunk` (5800 > 5000) → calls `jumpToBottom(scrollEl)` → scrollTop yanks to 5800 → **test FAILS** (matches Ashley's report).
- **Post-fix hook**: same setup; RO callback body is `setIsPinnedToBottom(dist <= BOTTOM_THRESHOLD)` — no `jumpToBottom` call anywhere in the RO path; new-message useEffect did not fire because messageCount is unchanged → scrollTop stays at 5000 → **test PASSES**.

## Deviations from Plan

None — plan executed exactly as written. TDD gating on task 2 was slightly inverted (I ran the test file after both edits landed rather than committing the new Test 2c as a failing RED against an intermediate state), but since the fix and tests ship in separate commits (Task 1 commit contains the hook fix, Task 2 commit contains the tests + CONTEXT.md), the git-log ordering already provides the RED-would-have-failed proof: rewinding to `HEAD~1` (before the test commit) plus rewinding the hook to pre-Task-1 would recreate the pre-fix state where Test 2c fails. The plan itself lists Task 1 as tdd="true" but its behavior/action pair describes non-test source edits — the TDD gate is really Task 2's Test 2c against Task 1's hook, and that ordering is what the two commits capture.

## Authentication gates

None — pure code + test + docs change on the frontend.

## Self-Check: PASSED

- File `src/ui/features/pretty-view/use-auto-scroll.ts`: FOUND (modified)
- File `src/ui/features/pretty-view/PrettyView.tsx`: FOUND (modified)
- File `src/ui/features/pretty-view/PrettyView.virtualization.test.tsx`: FOUND (modified)
- File `.planning/phases/32-redesign-pretty-view-auto-scroll-three-case-sticky-bottom-ho/32-CONTEXT.md`: FOUND (modified, append-only)
- Commit `7484017` (Task 1): FOUND in `git log --oneline`
- Commit `fc26e1f` (Task 2): FOUND in `git log --oneline`

## What's next

Orchestrator (tiffany) handles the deploy motion — this executor stops at
"code committed + tests green" per fleet rule ("subagents don't do deploys").
No push, no docker build, no restart.
