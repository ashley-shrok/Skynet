---
quick_id: 260812-uxk
status: complete
commit: 54322c0
files_modified:
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
  - src/ui/features/pretty-conversations/pretty-conversations.css
---

# 260812-uxk SUMMARY: Add mouse-drag swipe on desktop PrettyConversationRow

One-liner: Desktop mouse-drag swipe on `.pv-row--desktop` rows sharing the mobile touch swipe machine's refs, with TSD1-TSD8 test coverage.

## What Was Done

### Task 1: Add parallel mouse handlers + user-select CSS; extend past-threshold glow to desktop variant

**PrettyConversationRow.tsx:**
- Added a `Desktop mouse-drag swipe (quick-260812-uxk)` header comment block after the existing touch machine comment (documenting: shared refs, desktop-only+!isRdp gate, no long-press-on-mouse, CSS-side text-selection suppression, onMouseLeave=touchcancel-equivalent, no preventDefault)
- Added four `useCallback` handlers: `onMouseDown`, `onMouseMove`, `onMouseUp`, `onMouseLeave`
  - All share the SAME refs as touch handlers (`swipeStartRef`, `armedRef`, `disarmedRef`, `isSnappingRef`, `snapTimerRef`, `dxLive`, `resetSwipeGesture`, `beginSnapBack`, `clearSnapTimer`, `suppressNextClickRef`)
  - No new refs introduced
  - Each handler early-returns if `variant !== "desktop"` or `isRdp`
  - `onMouseUp` mirrors `onTouchEnd` branch-for-branch (below threshold snap-back, idempotency check, composite fire with suppressNextClickRef, beginSnapBack)
  - `onMouseLeave` = touchcancel-equivalent: if armed, beginSnapBack; if not, resetSwipeGesture; does NOT set suppressNextClickRef
- Wired four new props on the row body `<div role="button">`:
  ```
  onMouseDown={variant === "desktop" && !isRdp ? onMouseDown : undefined}
  onMouseMove={variant === "desktop" && !isRdp ? onMouseMove : undefined}
  onMouseUp={variant === "desktop" && !isRdp ? onMouseUp : undefined}
  onMouseLeave={variant === "desktop" && !isRdp ? onMouseLeave : undefined}
  ```

**pretty-conversations.css:**
- Updated CSS header comment at the swipe-to-act section to note "mobile touch AND desktop mouse-drag swipe (quick-260812-uxk)" and that scoping to `.pv-row` (no variant gate) is safe
- Changed `.pv-row.pv-row--mobile.swipe-past-threshold-right` → `.pv-row.swipe-past-threshold-right`
- Changed `.pv-row.pv-row--mobile.swipe-past-threshold-left` → `.pv-row.swipe-past-threshold-left`
- Added `user-select: none; -webkit-user-select: none;` to `.pv-row--desktop` block with inline rationale comment

### Task 2: Add TSD1-TSD8 desktop mouse-swipe test coverage

Added `describe("PrettyConversationRow: desktop mouse-drag swipe (quick-260812-uxk)", ...)` block in `PrettyConversationRow.test.tsx` after TS1-TS7 and before S1-S2, with:

| Test | Description |
|------|-------------|
| TSD1 | Swipe-right past threshold (unpinned+inActive=false) fires composite; trailing click suppressed |
| TSD2 | Swipe-right past threshold on pinned+inActive=true is silent no-op |
| TSD3 | Swipe-left past threshold (pinned+inActive=true) fires composite; trailing click suppressed |
| TSD4 | Swipe-left past threshold on unpinned+inActive=false is silent no-op |
| TSD5 | Release below threshold: no composite, trailing click DOES fire onSelect (tap path intact) |
| TSD6 | Vertical drag beyond tap floor never arms; no composite |
| TSD7 | RDP row: mouse handlers unbound (variant+isRdp gate); no composite |
| TSD8 | onMouseLeave mid-drag: snap back WITHOUT firing composite |

## Deviations from Plan

None. Plan executed exactly as written.

## Test Results

Full vitest suite: **170 tests passed, 0 failed** across 9 test files.
- New TSD1-TSD8 tests: all 8 pass
- Existing TS1-TS7 mobile tests: all pass unchanged
- Panel-level TS-P1 test at PrettyConversationsPanel.test.tsx:2618: passes unchanged
- No other test file regressed

```
 Test Files  9 passed (9)
      Tests  170 passed (170)
   Duration  160.51s
```

## Commit

`54322c0` — feat(pretty-conversations): mouse-drag swipe on desktop rows (quick-260812-uxk)

- 3 files changed, 516 insertions(+), 6 deletions(-)

## Self-Check

- [x] `PrettyConversationRow.tsx` modified with mouse handlers and JSX wiring
- [x] `pretty-conversations.css` updated: glow selectors widened, user-select added to desktop
- [x] `PrettyConversationRow.test.tsx` extended with TSD1-TSD8 describe block
- [x] No files outside the three-file scope modified
- [x] `skynet-patches.md` untouched
- [x] No push / build / deploy motion executed
- [x] Touch handlers (`onTouchStart`, `onTouchMove`, `onTouchEnd`) are byte-identical to pre-change form
- [x] `npx vitest run` exits 0
