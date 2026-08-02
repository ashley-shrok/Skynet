---
quick_id: 260802-pq2
type: summary
wave: 1
depends_on: []
tags:
  - mobile
  - pretty-conversations
  - bounty-fix
  - long-press
  - context-menu
tech_stack:
  patterns:
    - "setTimeout-based long-press timer with movement gate + navigator.vibrate feature detection"
    - "shared setCtxMenu state as single entry point for BOTH desktop right-click AND mobile long-press → PrettyConversationContextMenu"
key_files:
  modified:
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
    - src/ui/features/pretty-conversations/tokens.ts
    - src/ui/features/pretty-conversations/pretty-conversations.css
    - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx
decisions:
  - "Split TL5 into TL5a (navigator.vibrate present) and TL5b (navigator.vibrate absent) rather than run both phases in a single `it()`; RTL auto-cleanup runs between `it()` blocks (globals: true + RTL loaded), so splitting avoids Phase A's portal-mounted menu bleeding into Phase B's `screen.getByRole('menu')` assertion."
  - "Kept unused local `isMobileVariant` in the panel rather than removing it; tsconfig `noUnusedLocals: false` — removing it would be unrelated churn."
  - "Left CSS blocks for `.pv-pin-action[data-size=\"mobile\"]` / `.pv-deactivate-action[data-size=\"mobile\"]` / `.pv-hide-action[data-size=\"mobile\"]` and their desktop hover-reveal rules in place, updating only the stale swipe-strip comments. Plan explicitly directed 'err on the side of leaving desktop hover-reveal rules alone — this quick is scoped to mobile swipe removal.'"
  - "Kept the PinAction/DeactivateAction/HideAction component files (only removed their imports from the row) — they may re-mount elsewhere in the future and are still consumed by their own test files."
metrics:
  duration: "~40 minutes"
  completed_date: "2026-08-02"
  tasks_completed: 2
  files_touched: 6
  commits: 2
---

# Quick 260802-pq2: Replace mobile swipe-to-reveal with long-press context menu

## One-liner

Retire mobile swipe-to-reveal action strip on `PrettyConversationRow`; wire a 500ms long-press with <10px movement gate to open the SAME `PrettyConversationContextMenu` desktop right-click uses, killing the `swipe-actions-visible-through-translucent-rows` bounty architecturally (nothing paints behind rows anymore).

## Purpose

The prior swipe-to-reveal strip absolutely-positioned action buttons (PinAction / DeactivateAction / HideAction) BEHIND the row body and revealed them by translating the body left. On rows with translucent ambient/hidden backgrounds, those action buttons bled visually through the row itself — Ashley's bounty `swipe-actions-visible-through-translucent-rows`.

Fix approach: delete the entire class of bug by deleting the class of DOM that causes it. If nothing paints behind rows, nothing can bleed through. Ashley's own comment at `PrettyConversationRow.tsx:429` already noted: "to hide, long-press → menu" — the intent was pre-loaded; this quick just executes it.

## What shipped

### Task 1 — Row + tokens + CSS (commit `2318460`)

**Row (`PrettyConversationRow.tsx`)** — full rewrite of the touch-handling / swipe machinery:

- **Deleted:**
  - Imports: `PinAction`, `DeactivateAction`, `HideAction`, `PC_SWIPE_ANGLE_TOLERANCE`, `PC_SWIPE_REVEAL`, `PC_SWIPE_THRESHOLD`.
  - Props: `onSwipeOpenChange`, `forceClosed` (with associated JSDoc).
  - State: `swipedOpen`, `dxLive`. Refs: `startXRef`, `startYRef`, `activeRef`, `baseDxRef`. Derived: `effectiveOpen`.
  - Callbacks: `emitSwipeOpenChange`, the entire swipe-state-machine trio (`onTouchStart` / `onTouchMove` / `onTouchEnd`), `onPinClick`, `onDeactivateClick`, `onHideClick` (the last three were only for the retired strip's button chrome).
  - JSX: the entire mobile swipe-reveal strip block (`{isMobile && !isRdp && (<div className="absolute … />)}`).
  - Attribute: `data-swiped-open` on the wrapper.
  - Style: the `transform: translateX(...)` + `transition: transform 180ms ease` branch in `bodyStyle`.
  - Behavior: the `if (isMobile && effectiveOpen) { setSwipedOpen(false); … return; }` swipe-close-instead-of-select branch inside `onBodyClick`.
  - Class: `overflow-hidden` on the mobile wrapper (no transform to clip).

- **Added:**
  - Import: `useEffect` (for timer cleanup on unmount).
  - Refs: `longPressTimerRef: useRef<number | null>`, `longPressStartRef: useRef<{x, y} | null>`, `suppressNextClickRef: useRef<boolean>`.
  - Helper: `clearLongPressTimer` callback (single source of truth for clearing the pending timer + nulling the ref).
  - New long-press hook trio: `onTouchStart` (arms a 500ms `window.setTimeout` capturing initial `(clientX, clientY)`), `onTouchMove` (guards; computes `Math.hypot(dx, dy)`; >10px cancels the timer), `onTouchEnd` / `onTouchCancel` (clears any pending timer, nulls `longPressStartRef` — DELIBERATELY does NOT touch `suppressNextClickRef` so the trailing click can read it).
  - Timer body: `setCtxMenu({ x, y })` + `navigator.vibrate?.(10)` (feature-checked with `?.`) + `suppressNextClickRef.current = true`.
  - `useEffect` cleanup on unmount that clears any pending timer (prevents setState-on-unmounted warning if the row unmounts mid-hold).
  - Suppression gate at top of `onBodyClick`: `if (suppressNextClickRef.current) { suppressNextClickRef.current = false; return; }` before `onSelect()`.

- **Preserved (unchanged):**
  - `PrettyConversationContextMenu` items[] builder at ~L339 — single source of truth for menu contents, feeds BOTH desktop right-click AND mobile long-press.
  - `!isRdp` guard on the `ctxMenu !== null && !isRdp` render — the single RDP safety net.
  - Desktop `onContextMenu` on non-RDP rows.
  - `subtitleMode` render paths, ready-dot logic, ambient/rdp class composition, avatar branches.

**Tokens (`tokens.ts`)** — collapsed to a header-only file:

- Deleted: `PC_SWIPE_REVEAL`, `PC_SWIPE_THRESHOLD`, `PC_SWIPE_ANGLE_TOLERANCE` exports + their JSDoc blocks.
- Replaced body with `export {};` and a comment explaining the retirement.
- Grep-verified: `grep -rn "PC_SWIPE_" src` returns 0 code hits (only comment references documenting the retirement remain).

**CSS (`pretty-conversations.css`)** — mobile long-press ergonomics + comment cleanup:

- Added to `.pv-row` base block: `-webkit-touch-callout: none;`, `user-select: none;`, `-webkit-user-select: none;` — suppresses iOS Safari's native text-selection callout and tap-and-hold UI so the 500ms handler doesn't fight the browser. `touch-callout` count went from 0 → 1 (matches the plan's verify target).
- Updated stale swipe-strip comments in the `.pv-pin-action`, `.pv-deactivate-action`, `.pv-hide-action` header blocks and the `[data-size="mobile"]` variant blocks. Comments now describe the retirement + explain why the mobile size variants and desktop hover-reveal rules stay in place (component may re-mount elsewhere; desktop hover-reveal rules are scoped to `.pv-row--desktop` and stay inert on mobile).
- Preserved: all desktop hover-reveal CSS rules per plan direction ("err on the side of leaving desktop hover-reveal rules alone — this quick is scoped to mobile swipe removal").

### Task 2 — Panel + tests (commit `8c9ea5e`)

**Panel (`PrettyConversationsPanel.tsx`)** — remove now-dead swipe coordination:

- Deleted: `currentlySwipedId` state + setter (L493-495 pre-edit).
- Deleted: `handleSwipeOpenChange` callback (L592-598 pre-edit).
- Deleted: `forceClosedFor` helper (L603-606 pre-edit).
- Deleted: the `if (isMobileVariant) setCurrentlySwipedId(null);` line in `handleRowSelect`.
- Deleted from `PrettyConversationRowLive` prop type: `onSwipeOpenChange?: (open: boolean) => void;` and `forceClosed?: boolean;`.
- Deleted from all four `PrettyConversationRowLive` render sites (active-set group, pinned group, non-RDP host groups, hidden section): the `onSwipeOpenChange={…}` and `forceClosed={forceClosedFor(row.id)}` prop passes.
- Updated file header comment to strike the "Swipe coordination (mobile)" bullet; documented the retirement in-line.

**Row tests (`PrettyConversationRow.test.tsx`)** — swap swipe coverage for long-press coverage:

- **Deleted:** Test 2 (swipe past threshold), Test 3 (swipe below threshold), Test 4 (vertical yield), Test 5 (tap-to-close on swiped-open row).
- **Rewrote:** Test 7 (mobile RDP row) — kept the RDP class + no-PinAction + `data-rdp-host-row` assertions; deleted the touch sequence + `data-swiped-open` assertion (RDP long-press guard now covered by TL4).
- **Rewrote:** Test 18f (mobile row context-menu regression) — kept the "mobile row body does NOT wire onContextMenu" assertion; flipped the trailing PinAction assertion from `.toBeTruthy()` to `.toBeNull()` (the row no longer renders PinAction in the DOM on mobile now that the swipe strip is gone).
- **Appended new describe block** — `PrettyConversationRow: mobile long-press context menu (quick-260802-pq2)` — 6 tests:
  - **TL1**: 500ms hold on a mobile non-RDP row → menu opens, Pin menuitem present, `onSelect` NOT called.
  - **TL2**: touchMove with `hypot(dx=15, dy=5) ≈ 15.8 > 10` cancels the pending long-press; no menu, no `onSelect`.
  - **TL3**: short tap (touchStart → touchEnd → fireEvent.click, no `advanceTimersByTime`) → `onSelect` called exactly once, no menu.
  - **TL4**: mobile RDP row + 500ms hold → no menu (touch handlers are `undefined` on RDP rows per the JSX wiring — no timer arms).
  - **TL5a**: `navigator.vibrate` stubbed → after 500ms hold, `vibrate` was called exactly once with `10`; original value restored in `finally`.
  - **TL5b**: `navigator.vibrate` absent (`delete navigator.vibrate`) → menu still opens, no throw. Locks the `navigator.vibrate?.(10)` optional-chain guarantee.
- Added imports: `afterEach` (already had `beforeEach`), `act` (for `vi.advanceTimersByTime` inside React).
- All timer control via `vi.useFakeTimers()` in the local `beforeEach` + `vi.useRealTimers()` in the local `afterEach`.

**Panel tests (`PrettyConversationsPanel.test.tsx`)** — drop the now-invalid swipe-strip assertions:

- **Deleted:** Test 20D (mobile active-set/ambient swipe-strip pin-action + deactivate-action DOM assertions).
- **Deleted:** Test (k) (mobile ambient hide-action), Test (l) (mobile hidden-row show-action), Test (m) (mobile active-set deactivate-action).
- The describe wrappers stay populated by their remaining tests (20A/20B/20C/20E/20F/20G/20H; (g)/(h)/(i)/(j)).
- Coverage rationale documented inline: menu contents are guaranteed by transitivity — the `items[]` builder in `PrettyConversationRow.tsx` is a single source of truth, and the desktop right-click paths in the retained tests exercise the same builder that mobile long-press now hits.
- Remaining `data-testid="pin-action"` / `data-testid="deactivate-action"` references in the panel test file are all **absence** assertions on desktop rows (Tests 20A, 20B, 20C) — those are still valid and load-bearing regression guards.

## Deviations from Plan

**None functional.**

Three minor documented departures from the exact plan sketch, all recorded above under `decisions:`:

1. **TL5 split into TL5a + TL5b.** The plan asked for a single TL5 with a `delete-then-restore` pattern. Running Phase A (vibrate stubbed) + Phase B (vibrate absent) in the same `it()` was hazardous because Phase A opens a portal-mounted menu that would still be attached to `document.body` when Phase B calls `screen.getByRole("menu")` — no automatic cleanup runs mid-test. Splitting into two `it()` blocks lets RTL's auto-registered `afterEach(cleanup)` fire between them, giving each phase a clean DOM. **Net effect:** 6 new tests (TL1-TL5b) instead of 5 (TL1-TL5). All 6 pass. Contract semantics identical to the plan.

2. **`isMobileVariant` left as a now-unused local in the panel.** After removing all four call sites' `onSwipeOpenChange={isMobileVariant ? … : undefined}` conditionals, `isMobileVariant` is defined but never read. `tsconfig.app.json` sets `noUnusedLocals: false`, so tsc doesn't complain. Removing it would be unrelated churn — left in place.

3. **PinAction/DeactivateAction/HideAction .tsx component files preserved.** The plan only asked to drop the imports from `PrettyConversationRow.tsx`, not delete the files. Their own test files (`PinAction.test.tsx` doesn't exist in the tree; the components are covered indirectly) and future re-mount sites keep them viable. Zero new dead files.

## Authentication gates

None — pure client-side refactor, no external services touched.

## Verification (whole-plan)

```
$ cd /home/ubuntu/skynet && npx tsc --noEmit
EXIT 0
0 lines of output

$ cd /home/ubuntu/skynet && npx vitest run src/ui/features/pretty-conversations
Test Files  5 passed (5)
     Tests  103 passed (103)
   Duration  ~15s
```

Grep gates (per plan's `<verify>` block):

```
$ grep -rn "PC_SWIPE_\|forceClosed\|onSwipeOpenChange\|currentlySwipedId\|data-swiped-open" \
    src/ui/features/pretty-conversations | grep -v ": //"
(empty — all references purged from live code; comment-only references remain
 documenting the retirement, which is intentional and per plan)

$ grep -c "touch-callout" src/ui/features/pretty-conversations/pretty-conversations.css
1
```

## Commits

| Task | Commit    | Files                                                                          |
| ---- | --------- | ------------------------------------------------------------------------------ |
| 1    | `2318460` | `PrettyConversationRow.tsx`, `tokens.ts`, `pretty-conversations.css`           |
| 2    | `8c9ea5e` | `PrettyConversationsPanel.tsx`, `PrettyConversationRow.test.tsx`, `PrettyConversationsPanel.test.tsx` |

## Follow-ups (out of scope for this quick)

- **Bounty closure**: `swipe-actions-visible-through-translucent-rows` is architecturally unreproducible after this ship. Whoever owns the bounty state should flip its status.
- **Real-browser UAT**: jsdom doesn't fire native touch synthesizers; a Wave-4-style UAT should confirm the 500ms haptic-and-menu affordance on an actual iOS device.
- **PinAction/DeactivateAction/HideAction TSX files**: unused by `PrettyConversationRow.tsx` now. If a future audit confirms zero call sites remain elsewhere, delete the files + their own test coverage in a follow-up quick.
- **CSS mobile-hit-target blocks for those three action components**: same — inert on mobile now, retained defensively. Prune in the same follow-up.

## Self-Check: PASSED

Files exist:
- FOUND: `src/ui/features/pretty-conversations/PrettyConversationRow.tsx`
- FOUND: `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`
- FOUND: `src/ui/features/pretty-conversations/tokens.ts`
- FOUND: `src/ui/features/pretty-conversations/pretty-conversations.css`
- FOUND: `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx`
- FOUND: `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx`

Commits exist on `feat/tab-title-from-tmux`:
- FOUND: `2318460` (Task 1)
- FOUND: `8c9ea5e` (Task 2)

tsc + vitest final status: BOTH GREEN.
