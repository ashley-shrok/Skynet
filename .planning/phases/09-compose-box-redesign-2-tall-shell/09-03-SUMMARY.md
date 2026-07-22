---
phase: 09-compose-box-redesign-2-tall-shell
plan: "03"
subsystem: ComposeBox / pretty-view / tests
tags: [tests, structural-tests, compose-box, layout, regression-prevention]
dependency_graph:
  requires:
    - 09-01 (2-row shell JSX restructure — layout invariants being tested)
    - 09-02 (horizontal meter rotation — flex-row meter being tested)
  provides:
    - Structural test coverage locking Phase 9 layout contracts
  affects:
    - src/ui/features/pretty-view/ComposeBox.test.tsx
tech_stack:
  added: []
  patterns:
    - "closestFlexRowAncestor walker helper — parentElement traversal matching className regex"
    - "compareDocumentPosition & Node.DOCUMENT_POSITION_FOLLOWING for DOM order assertion"
    - "getByRole('meter') + className inspection for horizontal meter assertion"
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/ComposeBox.test.tsx
decisions:
  - "closestFlexRowAncestor defined inside describe block (not file-top) — scoped to Phase 9 block, reuses existing outer-scope baseProps and mkAtt helpers"
  - "Test A uses pattern /flex items-(?:center|end) gap-2/ to find both Row 1 (items-center) and Row 2 (items-end) generically; Row 1 found via ThumbsUp proximity, Row 2 found via Send proximity"
  - "Test C/D use narrower pattern /flex items-center gap-2/ to specifically land on Row 1 (items-center), not Row 2 (items-end)"
  - "contextPct passed inline at Test B render site (not via baseProps extension) — no backward-compat risk"
metrics:
  duration: "180s"
  completed: "2026-07-22"
  tasks: 1
  files: 1
---

# Phase 9 Plan 03: Phase 9 Structural Tests Summary

**One-liner:** Appended 5 structural tests to ComposeBox.test.tsx locking the 2-row shell (DOM order), horizontal meter (flex-row), touch-target min-h (44px vs 8), and 1-row textarea floor — all 477 project tests green.

## Tasks

| # | Name | Commit | Status |
|---|------|--------|--------|
| 1 | Add Phase 9 structural tests to ComposeBox.test.tsx | 6321e80 | Complete |

## What Was Built

Appended a new `describe("ComposeBox — Phase 9 layout", () => { … })` block to the end of `ComposeBox.test.tsx` (after the existing Phase 05 describe block). Zero pre-existing tests modified or deleted.

### Helper defined in new describe block

`closestFlexRowAncestor(el: Element, pattern: RegExp): Element | null` — walks `el.parentElement` upward until a parent's `className` matches the pattern, or returns null at root.

### Test A: Row order

Renders with default props. Gets ThumbsUp via `getByLabelText(/send 'yes'/i)` and Send via `getByLabelText(/send message/i)`. Walks each to closest ancestor matching `/flex items-(?:center|end) gap-2/`. Asserts: (1) two distinct nodes, (2) `thumbsUpRow.compareDocumentPosition(sendRow) & Node.DOCUMENT_POSITION_FOLLOWING` is truthy — Row 1 precedes Row 2.

### Test B: Horizontal meter

Renders with `contextPct: 50`. Gets `role="meter"` element. Asserts `className` includes `flex-row` and does NOT include `flex-col`.

### Test C: Mobile touch target (showPaperclip=true)

Renders with `showPaperclip: true`. Gets paperclip via `getByLabelText(/attach file/i)`. Walks to closest ancestor matching `/flex items-center gap-2/`. Asserts `className` includes `min-h-[44px]` and does NOT include `min-h-8`.

### Test D: Desktop height (showPaperclip=false)

Renders with `showPaperclip: false`. Gets ThumbsUp, walks to closest ancestor matching `/flex items-center gap-2/`. Asserts `className` includes `min-h-8` and does NOT include `min-h-[44px]`.

### Test E: Textarea 1-row floor

Renders with default props (empty text). Gets textarea via `getByPlaceholderText(/message/i)`. Asserts `textarea.rows === 1` — confirms the rows floor dropped from 2→1 in Plan 09-01.

## Verification

- `describe("ComposeBox — Phase 9 layout")` block present in file
- `it(` count: **15** (10 pre-existing + 5 new; threshold ≥14 met)
- ComposeBox test file: 15/15 tests pass
- Full project test suite: **477/477 tests pass** (39 test files)
- Typecheck: **clean** (`sudo npm run type-check` exits 0, no output)
- `git diff --stat HEAD~1 HEAD src/ui/features/pretty-view/ComposeBox.test.tsx`: **85 insertions, 0 deletions**

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes. Test-only additions. STRIDE mitigations confirmed:

- T-09-03-01: Tests gate only on structural invariants (row order, flex direction, min-h class presence, textarea rows number). No gradient/color/shadow class values asserted.
- T-09-03-02: 0 deletions in diff; `it(` count = 15 ≥ 14; all 477 project tests green.

## Known Stubs

None.

## Self-Check: PASSED

- [x] `src/ui/features/pretty-view/ComposeBox.test.tsx` modified and committed at 6321e80
- [x] Commit 6321e80 exists in git log
- [x] `describe("ComposeBox — Phase 9 layout")` block present
- [x] 15 `it(` invocations (≥14 required)
- [x] 15/15 ComposeBox tests pass
- [x] 477/477 project tests pass
- [x] Typecheck clean
- [x] Zero pre-existing tests deleted or modified
