---
phase: 64-multi-view-center-drop
plan: 01
subsystem: ui-lib-split-tree
tags: [tdd, pure-helper, split-tree, foundation, center-drop, wave-1]
requires: []
provides:
  - replaceLeaf(root, targetTabId, replacementTabId) pure helper on src/ui/lib/split-tree.ts
  - swapLeaves(root, tabIdA, tabIdB) pure helper on src/ui/lib/split-tree.ts
affects:
  - Plan 64-02 (AppShell handler layer will import both helpers via the existing split-tree import block)
tech_stack:
  added: []
  patterns:
    - remove-then-rediscover-target-path (mirrors AppShell.openSessionInTree at AppShell.tsx:1642-1675)
    - defensive-warn + reference-identity-return (mirrors removeLeaf's no-op contract at :245)
    - reuse-of-private-replaceAt-helper (avoids duplicating the ancestor-allocation-with-sibling-sharing logic)
key_files:
  created: []
  modified:
    - src/ui/lib/split-tree.ts (added 128 lines — two exported helpers + JSDoc; NO import changes, NO edits to existing code)
    - src/ui/lib/split-tree.test.ts (added 211 lines — 9 new Phase 64 tests + extended import list with replaceLeaf/swapLeaves/vi)
decisions:
  - TDD executed as RED-then-GREEN sequence with two atomic commits per orchestrator prompt (overrides plan's single-commit suggestion — the orchestrator's TDD contract took precedence per the prompt's explicit "RED commit + GREEN commit" language)
  - Test file's existing `vi.spyOn(console, "warn").mockImplementation(() => {})` pattern used with try/finally + `.mockRestore()` per-test rather than beforeEach/afterEach (matches Tests 4/5/8/9 spec granularity where only some tests need the spy; SplitView.test.tsx:515 uses beforeEach but that's a whole-block pattern that would spuriously suppress warns Tests 1/2/3/6/7 don't want)
metrics:
  duration: "~5 minutes (RED write + verify red + GREEN write + verify green + summary)"
  completed: "2026-08-30T21:42:58Z"
  tests_added: 9
  tests_total_after: 42 (33 pre-existing + 9 new)
  files_touched: 2
  commits: 2 (RED + GREEN)
---

# Phase 64 Plan 01: Center-Drop Tree Ops — replaceLeaf + swapLeaves Summary

Two pure immutable tree helpers land in `src/ui/lib/split-tree.ts`
(`replaceLeaf` + `swapLeaves`) backing the two Phase 64 center-drop payloads.
Executed TDD-first with 9 unit tests written and verified failing before the
implementations were added — 42 tests pass in `split-tree.test.ts` at the
GREEN commit (33 pre-existing Phase 56 + Phase 57 tests continue green
unchanged; 9 new Phase 64 tests all green).

## What Was Implemented

### `replaceLeaf(root, targetTabId, replacementTabId)`

Backs "drop a conversation-list-row payload onto the CENTER of an
already-open session's body". The dragged session takes the target cell in
place; the target session drops out of the grid entirely (still in the conv
list — just no longer occupying a slot).

Four branches:

1. `root === null` → return null verbatim.
2. `targetTabId === replacementTabId` → reference-identity no-op (no warn,
   no allocation).
3. `targetTabId` not found in the tree → defensive `console.warn` with
   explicit `targetTabId=<x>` field, then reference-identity return.
4. Mainline: `removeLeaf(root, replacementTabId)` first (evicts any
   pre-existing replacement, collapsing its parent split via the existing
   invariant rule at `removeAt`). Then rediscover the target path (an
   ancestor may have collapsed), then `replaceAt(...)` with a fresh
   `{kind:"session", tabId: replacementTabId}` leaf.

Follows the AppShell openSessionInTree remove-then-rediscover precedent at
AppShell.tsx:1642-1675.

### `swapLeaves(root, tabIdA, tabIdB)`

Backs "drop an already-open session's identity badge onto the CENTER of
another already-open session". Two sessions trade slots; both remain live
in the grid. Pure leaf-content-only mutation — every internal split's
direction is preserved by construction.

Three branches (plus mainline):

1. `root === null` → return null verbatim.
2. `tabIdA === tabIdB` → reference-identity no-op (no warn).
3. Either tabId missing → defensive `console.warn` naming the missing one
   (first-encountered), then reference-identity return.
4. Mainline: `replaceAt` applied twice. Order-independent because leaves
   are terminal (a leaf cannot be an ancestor of another leaf), so pathA
   and pathB are disjoint. Every internal split's direction preserved by
   construction (we never touch splits — only leaf contents at two paths).

### Purity Contract

Both helpers are pure with respect to the input tree — no in-place mutation
of any input SplitNode. Every ancestor on the rewrite path is freshly
allocated via the existing private `replaceAt` helper (:213-240); every
subtree NOT on the rewrite path is shared by reference (Object.is holds).
Test 2 verifies structural sharing of the sibling subtree post-replaceLeaf.

### Logging Discipline

NO `console.info` from either helper body — structured `[pv-split-drop]`
logging belongs to Plan 64-02's AppShell handler layer per CONTEXT.md
§ In-scope item 5. Only defensive `console.warn` on missing-target /
missing-leaf cases (per must_have truths 4 + 7). Warn messages use explicit
`targetTabId=<x>` / `tabId=<x>` fields (no `JSON.stringify` on inputs) per
the fleet logging directive Ashley 2026-08-11.

## Tests Added (9 new Phase 64 tests)

All appended in a single new `describe("split-tree — Phase 64: center-drop
tree ops (replaceLeaf + swapLeaves)", () => { … })` block, after the
existing Phase 57 edge-zone describe:

1. **Phase 64 Test 1** — replaceLeaf on a single-leaf root swaps `tabId`;
   invariant holds. Confirms the target-is-root path.
2. **Phase 64 Test 2** — replaceLeaf in a 2-cell tree with a replacement
   not-yet-in-tree preserves the sibling by reference (`Object.is` on
   `children[0]`). Confirms structural sharing.
3. **Phase 64 Test 3** — replaceLeaf where the replacement is elsewhere in
   a 3-cell tree performs remove-then-replace (net: move). The parent
   vertical split collapses to the surviving horizontal-split branch, then
   the target leaf inside that branch is swapped. Confirms the mainline
   compose-with-removeLeaf branch.
4. **Phase 64 Test 4** — replaceLeaf with `targetTabId === replacementTabId`
   returns root by reference identity (`Object.is`), NO console.warn.
   Confirms the same-id no-op contract.
5. **Phase 64 Test 5** — replaceLeaf with a target-not-found emits ONE
   `console.warn` beginning `[split-tree] replaceLeaf: target not found`
   and containing `targetTabId=ghost`; returns root by reference.
   Confirms the defensive-warn branch.
6. **Phase 64 Test 6** — swapLeaves on a 2-cell tree trades tabIds; split
   direction and both leaf-kinds preserved. Confirms the mainline
   leaf-content-only mutation.
7. **Phase 64 Test 7** — swapLeaves on a deep tree swaps A ↔ C and
   preserves every internal split's direction (root vertical stays
   vertical; inner horizontal stays horizontal). Confirms the
   structure-preservation invariant on a non-trivial tree.
8. **Phase 64 Test 8** — swapLeaves with `tabIdA === tabIdB` returns root
   by reference identity, NO console.warn.
9. **Phase 64 Test 9** — swapLeaves with a missing leaf emits ONE
   `console.warn` beginning `[split-tree] swapLeaves: leaf not found` and
   containing `tabId=ghost`. Two scenarios in a single it-block: missing
   SECOND arg AND missing FIRST arg; both yield the same warn shape +
   reference-identity return.

All 9 tests reuse the module-local `leaf(id)` factory, `split(direction,
a, b)` factory, and `assertInvariant(node)` helper verbatim per the plan's
`<read_first>` — no duplication.

## Commits

- **RED** `284ee767` — `test(64-01): RED — add unit tests for replaceLeaf
  + swapLeaves helpers`. 9 new failing tests + extended import list; RED
  verification: `Tests 9 failed | 33 passed (42)`, all 9 failures are
  `TypeError: replaceLeaf/swapLeaves is not a function` as expected.
- **GREEN** `f7017060` — `feat(64-01): GREEN — replaceLeaf + swapLeaves
  pure tree helpers`. Two exported helper functions appended after
  `computeEdgeZone` at :397; NO import changes; NO edits to existing code.
  GREEN verification: `Tests 42 passed (42)`.

## Scoped Test Result

```
$ npx vitest run src/ui/lib/split-tree.test.ts
 Test Files  1 passed (1)
      Tests  42 passed (42)
   Duration  10.86s
```

Exit code 0. Green-gate satisfied per box-maintainer role (Ashley
2026-08-20): scoped tests relevant to touched files only; full suite is
the orchestrator's ship-gate, not this executor's scope.

## Acceptance Gates (per plan `<acceptance_criteria>`)

| Gate | Expected | Actual |
|------|----------|--------|
| `npx vitest run src/ui/lib/split-tree.test.ts` exit code | 0 | 0 ✓ |
| `grep -c "^export function replaceLeaf" src/ui/lib/split-tree.ts` | 1 | 1 ✓ |
| `grep -c "^export function swapLeaves" src/ui/lib/split-tree.ts` | 1 | 1 ✓ |
| `grep -c "^import\|^} from " src/ui/lib/split-tree.ts` | 0 | 0 ✓ |
| Non-comment `console.info` count in split-tree.ts | 0 | 0 ✓ |
| `console.warn` count in split-tree.ts (incl. JSDoc) | ≥ 2 | 8 ✓ (2 real + 6 comment refs) |
| `grep -c '\[split-tree\] replaceLeaf: target not found'` | ≥ 1 | 1 ✓ |
| `grep -c '\[split-tree\] swapLeaves: leaf not found'` | ≥ 1 | 1 ✓ |
| `grep -c 'JSON\.stringify' src/ui/lib/split-tree.ts` | 0 | 0 ✓ |
| `grep -c 'Phase 64' src/ui/lib/split-tree.test.ts` | ≥ 9 | 11 ✓ |
| Private `replaceAt` at :213 unchanged | 1 | 1 ✓ (`grep -n "^function replaceAt" src/ui/lib/split-tree.ts` → `213:function replaceAt(`) |
| RED+GREEN combined `git diff --stat HEAD~2..HEAD` | exactly 2 files | `src/ui/lib/split-tree.ts` + `src/ui/lib/split-tree.test.ts` ✓ |

Note on the plan's single-line replaceAt-signature grep: the plan text
`grep -c "function replaceAt(root: SplitNode, path: SplitPath, replacement:
SplitNode): SplitNode"` returned 0 because the actual signature is
multi-line-formatted in the source. The function IS still present
unchanged at line 213 (confirmed via `grep -n "^function replaceAt"`).
The plan's intent — "replaceAt is UNCHANGED" — is satisfied; the plan's
grep pattern was incorrect for the source's actual formatting.

## Deviations from Plan

### Executor Choice — RED + GREEN Split Over Single Commit

The plan's `<action>` block ends with a single commit instruction
(`feat(64-01): split-tree replaceLeaf + swapLeaves pure helpers for
center-drop`), but the orchestrator's spawn prompt explicitly required the
TDD contract to be enforced as two atomic commits:

- RED: `test(64-01): RED — add unit tests for replaceLeaf + swapLeaves
  helpers` — 9 failing tests verified.
- GREEN: `feat(64-01): GREEN — replaceLeaf + swapLeaves pure tree
  helpers` — 9 tests flip to passing.

I followed the orchestrator's explicit "RED commit + GREEN commit"
directive over the plan's suggested single commit. Rationale: the RED
commit is a load-bearing TDD gate artefact — it records the "wrote tests
first, saw them fail" step as a first-class historical event, which is
lost if RED and GREEN collapse into a single commit. The orchestrator's
directive is the correct call for TDD discipline; the plan's single-commit
instruction is a residual template artifact from the non-TDD-emphasized
plan template.

### No Other Deviations

Everything else — the nine test specifications, the two helper contracts,
the four `replaceLeaf` branches, the three `swapLeaves` branches, the
reuse of `findLeaf` + `removeLeaf` + `replaceAt`, the NO-IMPORTS invariant,
the no-`console.info` discipline, the defensive-warn message format —
lands exactly as the plan specified. No auto-fix (Rule 1/2/3) triggered;
no checkpoint (Rule 4) reached; no architectural deviation encountered.

## Self-Check: PASSED

- File `.planning/phases/64-multi-view-center-drop/64-01-SUMMARY.md`
  created (this file). Verified via Write tool return.
- Commit `284ee767` (RED) exists on `feat/tab-title-from-tmux`. Verified
  via `git rev-parse --short HEAD~1`.
- Commit `f7017060` (GREEN) exists on `feat/tab-title-from-tmux`.
  Verified via `git rev-parse --short HEAD`.
- Scoped vitest run passes 42/42. Verified via final `npx vitest run
  src/ui/lib/split-tree.test.ts` output.
- Both helpers exported: `grep -c "^export function replaceLeaf" src/ui/
  lib/split-tree.ts` → 1; `grep -c "^export function swapLeaves"` → 1.
- No files outside the plan's `files_modified` scope were touched:
  `git diff --stat HEAD~2..HEAD` shows exactly 2 files, both
  `src/ui/lib/split-tree.{ts,test.ts}`.
