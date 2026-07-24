---
phase: quick-260720-8nj
plan: "01"
subsystem: pretty-view/scroll-state-machine
tags: [scroll, state-machine, patch-98, user-gesture, wheel, touchmove, keydown, hotfix]
one_liner: "Patch #98 — user-gesture detection (wheel/touchmove/keydown) replaces the scroll-event mode-flip in useAutoScroll; delayed scroll events no longer misclassify as user gestures."
key_files:
  modified:
    - src/ui/features/pretty-view/use-auto-scroll.ts
    - src/ui/features/pretty-view/use-auto-scroll.test.ts
decisions:
  - "Gesture listeners (wheel/touchmove/keydown) are the authoritative mode-flip signal; scroll event handler is read-only (only syncs isPinnedToBottom and followBottomRef when already user-driving)"
  - "SCROLL_KEYS const defined at module level to keep keydown filter co-located with the rationale"
  - "{ passive: true } on all three gesture listeners for consistency with the existing scroll listener"
  - "Test L uses Event('touchmove') not TouchEvent for JSDOM compatibility (hook reads only event type)"
metrics:
  duration: ~5min
  completed: "2026-07-20"
  tasks_completed: 2
  files_changed: 2
---

# Phase quick-260720-8nj Plan 01: Patch #98 Gesture-Based Mode Flip Summary

## One-liner

Patch #98 — user-gesture detection (wheel/touchmove/keydown) replaces the scroll-event mode-flip in useAutoScroll; delayed scroll events no longer misclassify as user gestures.

## What Was Done

### Task 1 — Rewrite use-auto-scroll.ts

- **Removed** `programmaticScrollRef` ref and its counter increment/decrement pattern entirely.
- **Simplified** `doProgScroll(newTop)` to a bare guarded assignment (`scrollEl.scrollTop = newTop`) — no rAFs.
- **Rewrote** effect 1 (`handleScroll`): removes the mode-flip branch entirely; now only updates `followBottomRef` when mode is already `user-driving`, and always calls `setIsPinnedToBottom` for jump-pill freshness.
- **Added** `SCROLL_KEYS` module-level const: `['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ']`.
- **Added** effect 1b (user gesture listeners): `handleUserGesture` flips `modeRef` from `clamp` to `user-driving`, recomputes `distFromBottom`, sets `followBottomRef` and calls `setIsPinnedToBottom`. `handleKeyDown` calls `handleUserGesture` only for keys in `SCROLL_KEYS`. Attaches `wheel`, `touchmove`, `keydown` to `scrollEl` with `{ passive: true }`.
- **Updated** header comment block to describe gesture-based approach and add patch #98 rationale.

### Task 2 — Update use-auto-scroll.test.ts

- **Removed** Test F (programmatic scroll gate — counter mechanism no longer exists).
- **Added** Test F' (patch #98 regression guard): a scroll event dispatched after a 250ms delay does NOT produce a mode-flip; `isPinnedToBottom` reflects only the geometric `distFromBottom <= 100` calculation.
- **Added** Test K: wheel event → `isPinnedToBottom` reflects distFromBottom (400 > 100 → false).
- **Added** Test L: touchmove event (via `new Event('touchmove')` for JSDOM compatibility) → `isPinnedToBottom` reflects distFromBottom (0 ≤ 100 → true).
- **Added** Test M: 7 parametrized scroll-key keydowns each flip mode (assert `isPinnedToBottom === false` with distFromBottom=600); `key='a'` keydown does NOT change state (negative case).
- **Added** Test N: two sub-cases — mid-content wheel → false; bottom wheel → true.

## Grep-Based Evidence

| Check | Expected | Actual |
|-------|----------|--------|
| `grep -c 'programmaticScrollRef' use-auto-scroll.ts` | 0 | 0 |
| `grep -cE 'addEventListener\("(wheel\|touchmove\|keydown)"' use-auto-scroll.ts` | 3 | 3 |
| `grep -c 'handleUserGesture' use-auto-scroll.ts` | >=1 | 6 |
| `grep -v '^[[:space:]]*//' use-auto-scroll.ts \| grep -cE 'requestAnimationFrame'` | 1 | 1 |
| `grep -c 'Test F:.*programmatic scroll gate' use-auto-scroll.test.ts` | 0 | 0 |
| `grep -cE "Test F'" use-auto-scroll.test.ts` | >=1 | 2 |
| `grep -cE 'Test K: wheel' use-auto-scroll.test.ts` | >=1 | 2 |
| `grep -cE 'Test L: touchmove' use-auto-scroll.test.ts` | >=1 | 2 |
| `grep -cE 'Test M: keydown' use-auto-scroll.test.ts` | >=1 | 2 |
| `grep -cE 'Test N:.*distance' use-auto-scroll.test.ts` | >=1 | 2 |

## Test Suite Before / After

| Metric | Before (#96) | After (#98) |
|--------|-------------|-------------|
| Tests in use-auto-scroll.test.ts | 12 | 24 |
| Full suite (vitest run) | 279 | 301 |
| Failed | 0 | 0 |

## Commits

| Hash | Message |
|------|---------|
| `56676b3` | feat(quick-260720-8nj-01): gesture-based mode flip in useAutoScroll (patch #98) |
| `7edd1d8` | test(quick-260720-8nj-01): replace Test F with F' and add K/L/M/N for gesture-based mode flip |

## Unchanged Contracts

- **PrettyView.tsx**: untouched (confirmed via `git status` — no changes).
- **ComposeBox.tsx**: untouched (confirmed via `git status` — no changes).
- **Public API**: `{ scrollRef, contentRef, anchorRefCallback, scrollToBottomAndFollow, isPinnedToBottom }` shape unchanged.
- **Exported pure helpers**: `computeAnchorPinTop`, `computeFollowBottomTop`, `computeClampTarget` unchanged.
- **`AnchorMessage` interface**: unchanged.
- **`BOTTOM_THRESHOLD`**: unchanged (100px).

## Regression Case Closed

The `06:07:44` log line `RESIZE scrollTop=14207 clampTgt=14101 anchor.top=-106 drift=BROKEN Δheight=+132px` was caused by a delayed browser scroll event (200ms–7.9s after `scrollTop` write) flipping mode to `user-driving`, defeating the anchor ceiling. With patch #98, the scroll handler never touches `modeRef`. Test F' directly guards this case.

## Pin-Time Reminder

The `skynet-patches.md` header bump (97 → 98) and per-patch entry belong to PIN time — do NOT edit skynet-patches.md here (per brief constraint and Ashley's pin-time-only rule for `/home/ubuntu/.claude/identities/tina/skynet-patches.md`).

## Deviations from Plan

None — plan executed exactly as written. No new dependencies added to `package.json`.

## Self-Check: PASSED

- `src/ui/features/pretty-view/use-auto-scroll.ts` — exists and modified
- `src/ui/features/pretty-view/use-auto-scroll.test.ts` — exists and modified
- Commit `56676b3` — confirmed in git log
- Commit `7edd1d8` — confirmed in git log
- `npx tsc --noEmit` — 0 errors
- `npx vitest run` — 301/301 passed
- `npm run build` — clean (21.67s)
