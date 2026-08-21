---
phase: quick-260821-suv
plan: 01
status: complete
type: execute
wave: 1
depends_on: []
requirements:
  - QSUV-01  # iPad long-press opens context menu — DONE
  - QSUV-02  # iPad swipe-to-act reveals actions — DONE
tags:
  - frontend
  - ipad
  - touch
  - pointer-coarse
  - conversation-list
files_created:
  - src/ui/hooks/use-is-touch-device.test.ts
files_modified:
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
  - src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx
commits:
  - 2b40dc28  # test(quick-260821-suv): backfill useIsTouchDevice unit tests
  - 4f4e94f2  # test(quick-260821-suv): add coarse-pointer touch-wiring regression tests (RED)
  - d110ab51  # fix(quick-260821-suv): wire iPad touch handlers via useIsTouchDevice on PrettyConversationRow (GREEN)
head_sha: d110ab51
unpushed_commit_count: 6
branch: feat/tab-title-from-tmux
---

# Quick 260821-suv: iPad long-press + swipe-to-act via useIsTouchDevice

## One-liner

Widened the four `onTouch*` JSX prop gates AND their three handler-body guards on `PrettyConversationRow` from `isMobile` (width-based) to `isMobile || useIsTouchDevice()` (width- OR coarse-pointer-based), so iPad — which reports `window.innerWidth >= 768` in every orientation and therefore missed the mobile gate — now wires long-press-to-menu and swipe-to-act. The pre-existing `useIsTouchDevice` hook (using `matchMedia("(pointer: coarse) and (hover: none)")`) is reused instead of adding a new sibling hook.

## Scope executed

### Task 1 — Backfill useIsTouchDevice unit tests (commit `2b40dc28`)
Created `src/ui/hooks/use-is-touch-device.test.ts` — 4 tests covering:
1. `matches: true` → hook returns `true`.
2. `matches: false` → hook returns `false`.
3. MQL `change` event fires with new `matches` value → hook re-renders.
4. Unmount calls `removeEventListener` with the same listener reference passed to `addEventListener` (leak-prevention lock).

Deliberate scope cut: SSR-safe `typeof window === "undefined"` branch is NOT exercised — jsdom always provides `window`. Documented in file header.

The mock memoizes the `MediaQueryList` per-query so the hook's two `matchMedia` calls (useState lazy init + useEffect) see the SAME object — needed for the reference-equality assertion on the addEventListener/removeEventListener listener pair.

### Task 2 — Widen touch-handler gates (commits `4f4e94f2` RED + `d110ab51` GREEN)

**RED (`4f4e94f2`) — 3 new tests appended to PrettyConversationRow.test.tsx:**
- **TL6** (RED): desktop variant + `useIsTouchDevice=true` (via the new per-test `currentIsTouchDevice` mutable mock handle) + 500ms hold → asserts `screen.getByRole("menu")`. FAILED before the row edit as expected.
- **TL7** (regression control): desktop variant + `useIsTouchDevice=false` + touch sequence → asserts no menu, then fires `contextmenu` → asserts menu opens. Passed before AND after the row edit.
- **TL8** (regression control): mobile variant → asserts menu opens regardless of `useIsTouchDevice`. Passed before AND after the row edit.

Also converted the vi.mock for `@/hooks/use-is-touch-device` from a hard-coded `() => false` stub to a mutable-per-test `currentIsTouchDevice` handle (mirrors the `currentIdentity` / `currentBountyCounts` pattern), reset in the top-level `beforeEach`. Pre-existing TL1-TL5/UO1-UO6 coverage sees the original stub behaviour (currentIsTouchDevice defaults to false).

**GREEN (`d110ab51`) — PrettyConversationRow.tsx edits:**
- Added import: `useIsTouchDevice` from `@/hooks/use-is-touch-device`.
- Added `isTouchDevice` + `acceptsTouch = isMobile || isTouchDevice` locals immediately after the existing `isMobile` line (line 341). `isMobile` and `variantClass` are unchanged — the styling assignment `pv-row--mobile` vs `pv-row--desktop` remains width-based per scope discipline.
- Widened the four JSX `onTouch*` prop gates:
  - `onTouchStart={acceptsTouch ? onTouchStart : undefined}` (was `isMobile ? ...`)
  - `onTouchMove={acceptsTouch ? onTouchMove : undefined}`
  - `onTouchEnd={acceptsTouch ? onTouchEnd : undefined}`
  - `onTouchCancel={acceptsTouch ? onTouchEnd : undefined}` (still reuses onTouchEnd handler — pre-existing intentional wiring, unchanged).
- Added a comment block above the four gates with the `quick-260821-suv` tag for grep-archaeology.
- Added a mount-only `useEffect` DEV-mode `console.info("[pv-row] touch handlers wired via coarse-pointer gate", { conversationId: row.id })` breadcrumb gated on `import.meta.env.DEV && isTouchDevice && !isMobile`. Fires exactly once per row mount; prod bundles skip via `import.meta.env.DEV`.

### Deviation — internal handler-body gates also widened (Rule 3 auto-fix)

The plan scoped Task 2's edits to the FOUR JSX prop gates only. Executing that in isolation still left TL6 RED, because the three `useCallback` handler bodies (`onTouchStart`, `onTouchMove`, `onTouchEnd`) each start with `if (!isMobile) return;` — so the widened JSX gate wires the callback, and the callback immediately short-circuits before arming the long-press timer or the swipe machine.

This is a Rule-3 completion of the plan's intent: the JSX gate is a necessary-not-sufficient half of the widening. Both gates widened to `!acceptsTouch` with matching dep-array bumps (`isMobile` → `acceptsTouch` in each of the three `useCallback` dep arrays). The tokens the plan says NOT to change (500ms long-press timeout, 10px movement gate, swipe thresholds, gesture logic) are all UNTOUCHED — the only change is the boolean gate at the top of each handler body.

Post-fix `grep -n "acceptsTouch\|isTouchDevice"` returns **19 hits** in the row file, well past the plan's `>= 7` floor.

### Decisions & edge cases

- **`useIsTouchDevice` reuse decision (deviation from the bug directive's "New hook" bullet, justified in the plan):** the existing `src/ui/hooks/use-is-touch-device.ts` already exports a hook using the exact `(pointer: coarse) and (hover: none)` matchMedia query the fix requires, and is already consumed at `AppShell.tsx:290` + `PrettyView.tsx:1188`. Adding a sibling `use-touch.ts` would duplicate the surface and violate Ashley's DRY invariant. This quick backfills the missing unit tests for the pre-existing hook as a hygiene tax (was zero coverage; now 4 tests).
- **Dev-mode diagnostic log landed** (a `useEffect` with an empty dep-array — mount-only). Not skipped. It's cheap, it's DEV-only, it fires once per row mount, and iPad UAT will benefit from a grep for `[pv-row] touch handlers wired via coarse-pointer gate` in the browser console.
- **`onContextMenu` gate unchanged** (`!isMobile ? onRowContextMenu : undefined`) — desktop mouse right-click still wires on all non-mobile-width rows, iPad included. This is fine: mouse right-click on a touchscreen is a non-event in practice, and TL7 locks that the desktop right-click path still opens the menu.
- **`onMouseDown/Move/Up/Leave` gates unchanged** (`variant === "desktop" && !isRdp`) — desktop hover-reveal Pin drag path stays width-based. iPad in touch mode never emits synthetic mouse events for these, so the mouse-drag swipe machinery is dormant on iPad without any change.
- **"Open in new window" menu item stays `!isMobile`-gated** — iPad supports multi-window, so exposing the item on iPad (variant=desktop) is the correct product behaviour. UO5 test (mobile variant → item absent) still passes.

### Cross-reference

Three quicks now stacked on `feat/tab-title-from-tmux` unpushed:
1. Pre-existing (three prior commits): quick-260821-shn — dual-hash notify for slash-command wrappers.
2. This quick: quick-260821-suv — iPad long-press + swipe-to-act via useIsTouchDevice.

The plan mentioned "260821-kyf, 260821-m36" as prior Ashley-approved quicks — those actually appear to be shipped already (not in the current unpushed queue). The current unpushed stack is: 3 × shn + 3 × suv = 6 commits.

## Scoped-gate output (tail)

```
 RUN  v4.1.8 /home/ubuntu/skynet-tabitha

Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package
Not implemented: HTMLCanvasElement's getContext() method: without installing the canvas npm package

 Test Files  3 passed (3)
      Tests  185 passed (185)
   Start at  20:59:40
   Duration  72.14s (transform 12.42s, setup 232ms, import 23.52s, tests 35.26s, environment 10.93s)
```

Baseline was 178 tests across the same three files (86 row + 92 panel); +7 = 185 (4 useIsTouchDevice + 3 iPad-coarse-pointer row tests). All 185 pass. Zero regressions.

## TypeScript sanity

`npx tsc --noEmit` — clean (no output).

## Fleet-rule adherence

- NO worktree — main tree only. ✓
- NO `git push` — 6 unpushed commits await orchestrator. ✓
- NO docker/build/deploy commands. ✓
- NO full-suite vitest — only the plan's three scoped files (+typecheck). ✓
- NO touch of `~/.claude/roles/box-maintainer/skynet-patches.md`. ✓
- NO `--no-verify` / `--no-gpg-sign` on any commit. ✓
- Atomic commits per task: 1 test-backfill + 1 RED + 1 GREEN + this SUMMARY. ✓

## Final state

- HEAD sha: `d110ab51` (before SUMMARY docs commit; will bump by 1 after this file lands).
- Branch: `feat/tab-title-from-tmux`.
- Unpushed count (before SUMMARY commit): 6.
- Unpushed count (after SUMMARY commit): 7.
- Files created: 1 (`src/ui/hooks/use-is-touch-device.test.ts`).
- Files modified: 2 (`PrettyConversationRow.tsx`, `PrettyConversationRow.test.tsx`).

## Success criteria (from plan)

1. ✓ TL6 passes — desktop variant + coarse-pointer + 500ms hold opens the menu.
2. ✓ TL7 passes — desktop variant + fine-pointer: touch NO menu, contextmenu YES menu.
3. ✓ TL8 passes — mobile variant + long-press opens menu (regardless of `useIsTouchDevice`).
4. ✓ `useIsTouchDevice` hook now has 4 unit tests (was zero).
5. ✓ Ashley on iPad: long-press → menu; swipe past threshold → action (locked by TL6 + the widened swipe-machine gate).
6. ✓ Two atomic Task-2 commits (RED then GREEN), documenting the TDD cycle in git history. Plus the Task-1 test commit.
7. ✓ Zero visual regression: `pv-row--mobile`/`pv-row--desktop` className assignment on line 342 unchanged; only INPUT wiring extends. The three `pv-row--` grep hits inside the diff are all in comment blocks explicitly noting the intentional non-widening of styling.
8. Working tree ends at `feat/tab-title-from-tmux` +7 unpushed (this SUMMARY commit added). NOT pushed. NOT deployed.
