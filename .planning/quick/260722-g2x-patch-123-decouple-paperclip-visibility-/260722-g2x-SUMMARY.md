---
phase: quick-260722-g2x
plan: 01
type: execute-summary
status: shipped-to-branch-not-deployed
commit: c656254
files_changed: 3
insertions: 45
deletions: 17
tests_touched: 2
tsc: clean
vitest_relevant: green
requirements:
  - QUICK-260722-g2x
tags:
  - compose-box
  - pretty-view
  - paperclip
  - patch-123
---

# Patch #123 — Decouple Paperclip Visibility from Touch-Target Height (Summary)

**One-liner:** Split ComposeBox's overloaded `showPaperclip` prop into two independent props (`showPaperclip` = paperclip Button mount; `isTouchDevice` = Row 1 min-h gate) so desktop pretty-view now gets the paperclip attach button in the compact `min-h-8` aux row without inheriting the WCAG 44px touch-target height.

**Commit SHA:** `c656254` on branch `feat/tab-title-from-tmux` (NOT pushed, NOT deployed — Tina handles batch deploy).

## Files Touched (diff shape)

| File | Diff shape |
|---|---|
| `src/ui/features/pretty-view/ComposeBox.tsx` | +1 prop on `ComposeBoxProps` (`isTouchDevice?: boolean`), +1 destructure entry, +JSDoc refresh on `showPaperclip` (dropped "desktop NEVER sees" language), +new JSDoc on `isTouchDevice` citing patch #102, Row 1 block comment rewrite citing patch #123 decoupling rationale, Row 1 ternary swap `showPaperclip ? ... : ...` → `isTouchDevice ? ... : ...`, Paperclip Button block comment rewrite (drops "desktop NEVER sees" language, cites patch #123). Button gate `{showPaperclip && (` UNCHANGED. |
| `src/ui/features/pretty-view/PrettyView.tsx` | Split 1 mount-site prop line into 2 (`showPaperclip={true}` + `isTouchDevice={isTouchDevice}`), rewrote adjacent block comment to describe the patch #123 split. `const isTouchDevice = useIsTouchDevice();` at L224 UNCHANGED. |
| `src/ui/features/pretty-view/ComposeBox.test.tsx` | 2 Phase 9 Layout row-height test titles updated (`showPaperclip=true/false` → `isTouchDevice=true/false`), 2 `baseProps({...})` calls each add `isTouchDevice: true` or `isTouchDevice: false` alongside the existing `showPaperclip` prop. Assertions unchanged. Tests 3 & 4 (paperclip visibility) UNCHANGED. |

Total: **3 files changed, +45 / -17**.

## Verification

### `npx tsc --noEmit` — CLEAN
Zero errors. Zero warnings. Zero new type diagnostics anywhere in the workspace.

### `npx vitest run src/ui/features/pretty-view/ComposeBox.test.tsx` — patch #123-relevant tests all green

**Per-test results (verbose reporter):**

- ✓ Test 1: no chip strip when stagedAttachments is empty
- ✓ Test 2: chip strip mounts above the textarea when attachments are staged
- ✓ **Test 3: paperclip hidden when `showPaperclip=false` (desktop)** — visibility prop still governs visibility, as designed
- ✓ **Test 4: paperclip visible when `showPaperclip=true` (touch)** — visibility prop still governs visibility, as designed
- ✓ Test 5: paperclip click opens the file picker
- ✓ Test 6: pasting file-shaped clipboardData invokes onAttachFiles
- ✓ Test 13: Enter still sends text-only messages via onSend
- ✓ Test 15: Retry button appears only on error state
- ✓ Phase 9 Layout: meter is horizontal — role='meter' present with flex-row
- ✓ **Phase 9 Layout: mobile touch target — top row carries `min-h-[44px]` when `isTouchDevice=true`** (my updated test)
- ✓ **Phase 9 Layout: desktop top row carries `min-h-8` when `isTouchDevice=false`** (my updated test)
- ✓ Phase 9 Layout: textarea rows starts at 1 with empty text

### Independence-of-props grep checks — all match plan spec

- `grep -c 'isTouchDevice ? "min-h-\[44px\]" : "min-h-8"' ComposeBox.tsx` → **1** (row-height line switched)
- `grep -c 'showPaperclip ? "min-h-\[44px\]"' ComposeBox.tsx` → **0** (old ternary gone)
- `grep -c 'showPaperclip={true}' PrettyView.tsx` → **1** (universal paperclip)
- `grep -c 'isTouchDevice={isTouchDevice}' PrettyView.tsx` → **1** (peer prop)
- `grep -c 'showPaperclip={isTouchDevice}' PrettyView.tsx` → **0** (old wiring gone)
- `grep -ci 'desktop NEVER sees' ComposeBox.tsx` → **0** (stale language purged from all three commented sites)

### Commit shape — as specified

```
c656254 feat(compose): patch #123 — decouple paperclip visibility from touch-target height (desktop paperclip)
 3 files changed, 45 insertions(+), 17 deletions(-)
 - src/ui/features/pretty-view/ComposeBox.test.tsx
 - src/ui/features/pretty-view/ComposeBox.tsx
 - src/ui/features/pretty-view/PrettyView.tsx
```

Exactly 3 files, exact subject line as specified in the plan, no push, no deploy, no container recreate.

## Deferred Items — Pre-existing Test Failures (NOT introduced by patch #123)

The scoped vitest run surfaces **3 pre-existing failures** unrelated to patch #123. All three tests reference `screen.getByLabelText(/send message/i)` — the compose-box Send button that **patch #121 removed** (`f452c2e feat(compose): patch #121 — remove vestigial send button from compose row`). The tests were not updated when the button was removed. Failures:

1. **Test 7: Send with attachments routes to onSendWithAttachments; without attachments still uses onSend** — clicks `/send message/i` button
2. **Test 8: Send button ENABLED with attachments even when caption text is empty; disabled without either** — queries `/send message/i` button
3. **Phase 9 Layout: aux button group renders in a row that precedes the Send button's row** — queries `/send message/i` button as anchor for Row 2 lookup

**Why not fixed here:** Per the GSD SCOPE BOUNDARY rule, "only auto-fix issues DIRECTLY caused by the current task's changes." These 3 failures pre-date the patch #123 execution wave; they are Tina's residual from the patch #121 quick task. Patch #123's job is decoupling paperclip visibility from touch-target height, not sweeping up prior test rot.

**Recommended follow-up (for Tina):** A companion quick task `260722-<slug>-fix-stale-send-button-test-references` that either rewires those 3 tests to a new anchor (ThumbsUp or Hourglass, which do still exist) or explicitly deletes the Send-button-shaped assertions from Tests 7, 8, and the aux-row layout test. Roughly a 10-line diff to `ComposeBox.test.tsx` only.

## Non-Goals Confirmed

- No `docker compose up` / container recreate — deferred to Tina's next batch deploy behind the 15-min deadman rollback
- No live browser walk / UAT — deferred to Tina + Ashley post-deploy
- No `git push` — commit stays on `feat/tab-title-from-tmux` locally

## Deployment Status

**Shipped:** to local `feat/tab-title-from-tmux` branch as commit `c656254`.
**NOT deployed:** Tina batches with pending patches #118 / #119 / #120 / #121 / #122 (all code-complete on same branch, awaiting one coordinated deploy) behind the mandatory 15-min deadman rollback.

## Self-Check: PASSED

- FOUND: `src/ui/features/pretty-view/ComposeBox.tsx`
- FOUND: `src/ui/features/pretty-view/PrettyView.tsx`
- FOUND: `src/ui/features/pretty-view/ComposeBox.test.tsx`
- FOUND: `.planning/quick/260722-g2x-patch-123-decouple-paperclip-visibility-/260722-g2x-SUMMARY.md`
- FOUND: commit `c656254`
