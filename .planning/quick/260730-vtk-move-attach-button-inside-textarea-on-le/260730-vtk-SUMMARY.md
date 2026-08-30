---
phase: 260730-vtk
plan: 01
subsystem: pretty-view-compose
tags: [ui, compose-box, paperclip, attach-button, layout, refactor]
requires:
  - src/ui/features/pretty-view/ComposeBox.tsx (Row 1 aux-button group with Paperclip; Row 2 textarea wrapper with Send button; `showPaperclip` prop; `handleOpenFilePicker` handler)
  - src/ui/features/pretty-view/ComposeBox.test.tsx (existing baseProps helper; existing Tests 3/4/5 covering paperclip visibility + click)
provides:
  - Paperclip attach button rendered INSIDE the Row 2 textarea wrapper on the LEFT, as a sibling of the Send button on the RIGHT
  - Conditional `pl-10` on the Textarea when `showPaperclip=true`, mirroring the existing `pr-10` reserved for Send
  - Test 4b regression guard asserting Paperclip and Send share the same `.relative.flex-1` wrapper ancestor
affects:
  - Aux-button group visual density (one fewer button in Row 1)
  - Textarea left padding when `showPaperclip=true` (reserves 40px for the new hit target)
tech-stack:
  added: []
  patterns:
    - "Inside-textarea bare <button> (not shadcn Button) at absolute positioning, mirroring Send's #129 wrapper-specificity workaround"
    - "cn() truthy-conditional pattern for `showPaperclip && \"pl-10\"` (matches existing file style)"
key-files:
  created: []
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/ComposeBox.test.tsx
decisions:
  - "Bare <button> not shadcn Button — same reason as Send's #129 (wrapper-specificity trap with `!` load-bearing bg classes)"
  - "Icon `size-6` (24×24), not the removed aux-group's `size-4`, so Paperclip visually matches Send's paper-plane"
  - "Insert placement inside Row 2 wrapper: after pending-overlay block, before Send-button slot — keeps JSX read-order pending-overlay → paperclip → send/recording slot"
  - "Update stale Phase 9 touch-target test to anchor on ThumbsUp (still in Row 1) instead of Paperclip — Rule 1 auto-fix, mirrors sibling desktop test at L479"
metrics:
  duration: "4m 49s"
  completed: "2026-07-30"
---

# Quick 260730-vtk: Move Paperclip Inside Textarea (Left) — Summary

Moved the Paperclip attach button from Row 1's aux-button group into the Row 2 textarea wrapper on the LEFT side (`absolute left-1 bottom-0.5`), mirroring the Send button's inside-textarea `right-1 bottom-0.5` pattern — puts both compose-primary actions on the composition surface with matching visual treatment.

## What Changed

### Edit 1 — Remove Row 1 aux-group Paperclip block (ComposeBox.tsx, was ~L1345-1378)

**Before:**
```jsx
{/* Aux-button group — least-used (paperclip) on the left,
    most-used (Queue) on the right, mirroring distance-from-
    meter logic. Converted from flex-col to flex-row for the
    horizontal Row 1 layout.
    Patch #83 marker: RotateCcw lives in the meter's reset cell.
    Patch #84 marker: Queue button arms the idle-watchdog. */}
<div className="flex flex-row gap-1">
  {/* Paperclip attach button (Phase 05 UPLOAD-03). Gated by ...
      ... Matches ThumbsUp's warm-neutral Glass treatment. */}
  {showPaperclip && (
    <Button size="icon-sm" variant="outline"
      onClick={handleOpenFilePicker}
      disabled={canSend === false || asideActive === true || recycleActive === true}
      aria-label="Attach file" title="Attach file"
      className={cn("rounded-md cursor-pointer", "border-white/10", ...bunch of warm-neutral Glass classes...)}
    >
      <Paperclip className="size-4" />
    </Button>
  )}
  {/* Patch #120: Stop button — safety valve for Ctrl-C ... */}
```

**After:**
```jsx
{/* Aux-button group — Paperclip moved OUT to inside the Row 2
    textarea (2026-07-30 vtk, mirroring Send on the LEFT); this
    group now hosts Stop, ThumbsUp, Lightbulb, Target, Queue,
    Hourglass with most-used (Queue) on the right, mirroring
    distance-from-meter logic.
    Patch #83 marker: RotateCcw lives in the meter's reset cell.
    Patch #84 marker: Queue button arms the idle-watchdog. */}
<div className="flex flex-row gap-1">
  {/* Patch #120: Stop button — safety valve for Ctrl-C ... */}
```

Comment block updated to reflect the removal; Patch #83/#84 markers preserved verbatim.

### Edit 2 — Add inside-textarea Paperclip button (ComposeBox.tsx, new block ~L1683-1710)

**Insertion point:** Inside the Row 2 `<div className="relative flex-1 self-stretch">` wrapper, immediately after the `{queueArmed && (...)}` pending-overlay block and immediately before the Send-button slot comment block.

**Added:**
```jsx
{/* Quick 260730-vtk: Paperclip attach button moved from Row 1
    aux group to here per Ashley 2026-07-30. Mirrors Send's
    inside-textarea pattern on the LEFT (Send is right-1
    bottom-0.5; Paperclip is left-1 bottom-0.5). Bare <button>
    not shadcn Button — same reason as Send (#129 wrapper-
    specificity trap). aria-label / title / onClick preserved
    verbatim from the old aux-group Paperclip so Tests 3/4/5
    keep passing. */}
{showPaperclip && (
  <button
    type="button"
    onClick={handleOpenFilePicker}
    disabled={canSend === false || asideActive === true || recycleActive === true}
    aria-label="Attach file"
    title="Attach file"
    className={cn(
      "absolute left-1 bottom-0.5",
      "p-2",
      "text-[rgba(240,235,224,0.3)] hover:text-[rgba(240,235,224,0.9)]",
      "disabled:text-[rgba(240,235,224,0.15)]",
      "disabled:cursor-not-allowed",
      "transition-[color,transform] duration-120",
      "active:scale-95",
      "cursor-pointer",
    )}
  >
    <Paperclip className="size-6" />
  </button>
)}
```

- `aria-label`, `title`, `onClick`, and `disabled` preserved verbatim → existing Tests 3/4/5 pass unchanged.
- Bare `<button>`, not shadcn Button — dodges the #129 wrapper-specificity trap (same reason Send uses a raw button).
- Icon bumped `size-4 → size-6` (24×24) to match Send's paper-plane.
- No `asideActive` morph state — Paperclip stays a paperclip (Send's morph classes intentionally omitted).

### Edit 3 — Add conditional `pl-10` to Textarea (ComposeBox.tsx, ~L1650)

**Before:**
```jsx
// Patch #129: 40px right padding reserves space for the
// inside-textarea Send button ...
"pr-10",
"placeholder:text-[var(--color-pv-fg-dim)]",
```

**After:**
```jsx
// Patch #129: 40px right padding reserves space for the
// inside-textarea Send button ...
"pr-10",
// Quick 260730-vtk: mirrors the `pr-10` above on the LEFT
// when the inside-textarea Paperclip is present
// (showPaperclip=true → 40px hit target at absolute left-1
// bottom-0.5 needs matching left padding on the Textarea so
// text doesn't underlap the icon).
showPaperclip && "pl-10",
"placeholder:text-[var(--color-pv-fg-dim)]",
```

Follows the file's existing `cn()` truthy-conditional style (see the `showTranscribingSend && …` pattern nearby).

### Edit 4 — Add Test 4b regression guard (ComposeBox.test.tsx, between Test 4 and Test 5)

```js
it("Test 4b: paperclip renders INSIDE the textarea wrapper (sibling of Send), not in the Row 1 aux group", () => {
  render(
    <ComposeBox
      {...baseProps({
        stagedAttachments: [],
        onRemoveAttachment: vi.fn(),
        showPaperclip: true,
        onAttachFiles: vi.fn(),
      })}
    />,
  );
  const paperclip = screen.getByLabelText(/attach file/i);
  const sendButton = screen.getByRole("button", { name: "Send" });
  // Regression guard: paperclip and send must share the same
  // `.relative.flex-1` textarea wrapper ancestor. If a future
  // refactor moves paperclip back to Row 1 or into a separate
  // wrapper, `.closest` returns null OR the ancestor won't
  // contain the send button — either way this test fails.
  const wrapper = paperclip.closest(".relative.flex-1");
  expect(wrapper).not.toBeNull();
  expect(wrapper?.contains(sendButton)).toBe(true);
});
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed stale Phase 9 touch-target test that used Paperclip as its Row 1 anchor**

- **Found during:** First vitest run after edits 1-4 landed
- **Issue:** `ComposeBox.test.tsx:446` ("Phase 9 Layout: mobile touch target — top row carries min-h-[44px] when isTouchDevice=true") looked up the paperclip via `getByLabelText(/attach file/i)` and then walked to its `.flex items-center gap-2` ancestor to verify `min-h-[44px]`. After the move, the paperclip's closest such ancestor is Row 2's flex, not Row 1's flex — so the check failed with "expected null not to be null".
- **Fix:** Swapped the anchor from Paperclip to ThumbsUp (aria-label `Send 'let's go'`), which still lives in Row 1's aux group. This mirrors the anchor the sibling desktop test at L479 already uses for the exact same invariant. The test still guards Row 1's `min-h-[44px]` invariant on touch — it just uses a stable Row 1 element as the anchor instead of an element we intentionally moved out. Added a comment explaining the swap.
- **Files modified:** src/ui/features/pretty-view/ComposeBox.test.tsx (Phase 9 touch-target test only)
- **Commit:** 575baff (folded into the same atomic commit — the fix is inseparable from the move)

### Auth gates

None.

## Test Results

- `npx tsc --noEmit` — exit 0, no type errors
- `npx vitest run src/ui/features/pretty-view/ComposeBox.test.tsx` — **27 passed** (26 pre-existing + new Test 4b), 0 failed
- `npx vitest run --reporter=verbose` (full suite) — **874 passed | 6 skipped (880 total) across 77 files**, 0 failed
- Independent grep verification of `/tmp/build.log` per tina.md #209→#211 preference:
  - `grep -E "^ FAIL |^FAIL "` → 0 matches (no test-file failure markers)
  - `grep -E "Tests +[0-9]+ failed"` → 0 matches (no failed-test summary line)
  - Raw `grep -E "FAIL|failed|✗"` matches were all either passing test names (`✓ ... failed attempts`, `✓ ... upload_failed marks chip`, etc.) or deliberate backend log lines emitted by passing error-path tests (`aside injectBtw failed [op:aside_inject]`, `Database decryption authentication failed`)
- Vitest summary independently corroborated by the grep — no #209→#211-style hidden failure

## Grep Spot-Checks (from plan verification)

| Grep | Expected | Actual |
|------|----------|--------|
| `Paperclip className` in ComposeBox.tsx | 1 match | 1 (`<Paperclip className="size-6" />` at L1707) |
| `absolute left-1 bottom-0\.5` in ComposeBox.tsx | 1 match | 1 (new Paperclip button, L1697) |
| `absolute right-1 bottom-0\.5` in ComposeBox.tsx | ≥1 match | 1 (existing Send button, L1785) |
| `aria-label="Attach file"` in ComposeBox.tsx | 1 match | 1 (new bare `<button>`, L1694) |
| `showPaperclip && "pl-10"` in ComposeBox.tsx | 1 match | 1 (Textarea cn conditional, L1650) |
| `Test 4b:` in ComposeBox.test.tsx | 1 match | 1 (L118) |

## Git State

- Branch: `feat/tab-title-from-tmux`
- Commit: `575baff feat(quick-260730-vtk-01): move paperclip inside textarea on left, mirror send`
- Local branch ahead of `origin/feat/tab-title-from-tmux` by 1 commit — **NOT pushed**
- No `docker compose` build/deploy attempted
- No files touched under `~/.claude/identities/tina/`
- No modifications to `tina.md` or `skynet-patches.md`
- Post-commit `git diff --diff-filter=D` shows 0 deletions (edits were pure text replacement)
- `git status` clean apart from the two untracked orchestrator-managed planning dirs (`.planning/quick/260727-s8g-deactivate-fleetid-purge/`, `.planning/quick/260730-vtk-move-attach-button-inside-textarea-on-le/`)

## Known Stubs

None. The move is a wiring-preserving refactor — `onClick={handleOpenFilePicker}` still routes clicks to the existing file-picker infrastructure; no data source was left disconnected.

## Success Criteria Check

- [x] Paperclip out of Row 1 `flex flex-row gap-1` aux-button group
- [x] Paperclip inside Row 2 `<div className="relative flex-1 self-stretch">` textarea wrapper as sibling of Send `<button>`
- [x] Paperclip at `absolute left-1 bottom-0.5` (LEFT); Send unchanged at `absolute right-1 bottom-0.5` (RIGHT)
- [x] Icon `size-6` (24×24) mirrors Send
- [x] Textarea gets conditional `pl-10` when `showPaperclip=true`
- [x] `aria-label="Attach file"`, `title="Attach file"`, `onClick={handleOpenFilePicker}`, `disabled={canSend===false || asideActive===true || recycleActive===true}` all preserved verbatim
- [x] Tests 3/4/5 pass unchanged; new Test 4b passes
- [x] `npx tsc --noEmit` exits 0
- [x] Full vitest suite passes (874 passed, 6 skipped, 0 failed); independent grep verification of `/tmp/build.log` shows no compose-related failures
- [x] Single atomic commit; NOT pushed, NOT built, NOT deployed
- [x] Identity/bookkeeping files untouched

## Self-Check: PASSED

Verification:
- src/ui/features/pretty-view/ComposeBox.tsx — modified (grep `showPaperclip && "pl-10"` returns L1650)
- src/ui/features/pretty-view/ComposeBox.test.tsx — modified (grep `Test 4b:` returns L118)
- Commit `575baff` exists on `feat/tab-title-from-tmux` (`git log --oneline -1` confirmed)
- No files created; no files deleted
