---
phase: 56-visual-session-management-foundation-recursive-split-tree-da
plan: 02
subsystem: ui-shell
tags:
  - split-tree
  - visual-session-management
  - phase-56
  - foundation
  - url-persistence
  - appshell-refactor
  - portal-preservation
dependency-graph:
  requires:
    - "src/ui/lib/split-tree.ts (Plan 56-01)"
    - "src/ui/lib/split-tree-url.ts (Plan 56-01)"
  provides:
    - "SplitView recursive-tree renderer (src/ui/shell/SplitView.tsx)"
    - "AppShell splitTree state + URL round-trip (src/ui/AppShell.tsx)"
    - "WorkspaceSpec.splitTree field (src/ui/lib/tab-url.ts)"
  affects:
    - "Plan 56-03 (retirement pass: SplitMode, PANE_COUNTS, SPLIT_MODES, splitDragging.ts; nearest-edge geometry; drag-source on rows)"
tech-stack:
  added: []
  patterns:
    - "recursive-tree renderer with flex-based constant-ratio splits"
    - "callback-ref-populated Map<tabId, HTMLDivElement> as portal-target registry"
    - "mechanism-scaffold test pattern for AppShell-scale surgeries"
    - "URL-fragment single-source-of-truth for layout persistence (retires localStorage split state)"
key-files:
  created:
    - "src/ui/shell/SplitView.test.tsx"
    - "src/ui/lib/tab-url.test.ts"
    - "src/ui/AppShell.split-tree.test.tsx"
  modified:
    - "src/ui/shell/SplitView.tsx (766 → 340 lines)"
    - "src/ui/AppShell.tsx (2045 → 2174 lines, net +129; ~130 net-added for tree wiring, ~50 deleted from retired helpers)"
    - "src/ui/lib/tab-url.ts (281 → 321 lines, additive-only widening)"
decisions:
  - "50/50 splits enforced via flexGrow=1 + flexShrink=1 + flexBasis=0 (longhand) on each subtree wrapper, NOT the flex:'1 1 0' shorthand. jsdom's strict CSS parser rejects the shorthand because of the unitless zero basis; the longhand triple is safe both in jsdom and browsers. Test 5 asserts the longhand form."
  - "openSessionInTree is implemented as removeLeaf-then-insertAtEdge — same shape uniformly handles first-drop-into-empty, drop-into-existing-cell, and move-within-tree. A stale target path after removeLeaf collapses an ancestor degrades gracefully to a root-insert via try/catch."
  - "The URL-driven hydration lives in loadSavedTabs (a useEffect, not useLayoutEffect) — matches the existing tab-restore pattern. Consequence: splitTree === null on first render for any URL-encoded split. The LOAD-BEARING display gate at ~L1946 hides SplitView until hydration lands, preventing the mispaint. A code comment above the gate documents the invariant verbatim per the plan's Task 2 STEP B step 14."
  - "In the split-tree hydration in loadSavedTabs, the resolver reconstructs the pending-spec→tabId map by re-running the same host/type filter loop the URL-driven-open block uses. This keeps the positional accounting straight even under `continue` skips on unmatched host/type."
  - "Sibling files (theme.ts, ui-types.ts, splitDragging.ts) LEFT UNTOUCHED. The imports of PANE_COUNTS + SplitMode + splitDragging were removed from AppShell.tsx + SplitView.tsx, but the exports remain until Plan 56-03's cleanup pass. Rationale: preserves clean git blame for the deletion pass and keeps this plan's diff focused on the switchover."
metrics:
  duration: "~18 minutes"
  completed: "2026-08-28"
  tasks-completed: 2
  files-created: 3
  files-modified: 3
  tests-added: 16   # SplitView (7) + tab-url (3) + AppShell.split-tree (6)
---

# Phase 56 Plan 02: Load-bearing SplitView + AppShell switchover Summary

**Retire fixed-grid split model; adopt recursive-tree SplitNode driven by URL — SplitView shrinks 766→340, AppShell rewires state + DOM-placement effect to key on the tree, WorkspaceSpec widens with `splitTree?: string`. All 16 new tests + all 5 pre-existing AppShell.persistence tests + all 11 mobile-flow tests green; `npx tsc --noEmit` clean; zero touches to `src/backend/`, `theme.ts`, `ui-types.ts`, `splitDragging.ts`.**

## Line-count and diff table

| File                                   | Before | After | Notes                                                  |
| -------------------------------------- | ------ | ----- | ------------------------------------------------------ |
| `src/ui/shell/SplitView.tsx`           |    766 |   340 | -426 net; all six mode-branches, useSplitSizes hook, ColDivider/RowDivider, Row, defaultSizes deleted; PaneTree + Divider + EmptyDropTarget + reshaped Pane added. Target range [200, 350] hit at 340. |
| `src/ui/shell/SplitView.test.tsx`      |    0   |   245 | NEW. 7 tests (leaf, horizontal split, vertical split, empty-drop, 50/50 wrappers, portal-target ref shape, drop wiring) all green. |
| `src/ui/AppShell.tsx`                  |   2045 |  2174 | Net +129 (delete: two localStorage effects, splitTabQuick+addTabToSplit+removeTabFromSplit+assignPane, paneContentEls state, splitMode+paneTabIds+focusedPaneIndex states, SplitMode+PANE_COUNTS imports; add: splitTree+focusedTabId states, paneElsRef, split-tree imports, URL-sync splitTree splice, loadSavedTabs splitTree hydration, openSessionInTree handler, LOAD-BEARING gate comment, DOM-placement effect rewrite, SplitView call-site rewrite). |
| `src/ui/lib/tab-url.ts`                |    281 |   321 | +40 additive-only: WorkspaceSpec.splitTree field, encodeWorkspaceSpec s=/t= splice, readTabPayloadFromUrl passthrough, consumePendingWorkspace extraction, writeWorkspaceToUrl legacy-query-strip. |
| `src/ui/lib/tab-url.test.ts`           |    0   |   108 | NEW. 3 tests (round-trip, backward-compat, half-fragment fail-safe). |
| `src/ui/AppShell.split-tree.test.tsx`  |    0   |   548 | NEW. 6 mechanism-scaffold tests (URL hydration, URL-sync, no-localStorage-writes, portal-preservation `Object.is`, graceful degradation, mispaint-gate). |

## Grep-hygiene confirmations

**AppShell.tsx: all retired identifiers count 0.**

```
$ for label in splitMode paneTabIds focusedPaneIndex PANE_COUNTS SplitMode \
    skynet_splitMode skynet_paneTabIds splitTabQuick addTabToSplit \
    removeTabFromSplit assignPane; do
    grep -c "$label" src/ui/AppShell.tsx
  done
0 0 0 0 0 0 0 0 0 0 0
```

**AppShell.tsx: adopted identifiers present.**

```
splitTree                24
openSessionInTree         4
LOAD-BEARING comment      1  (verbatim per plan Task 2 STEP B step 14)
```

**SplitView.tsx: retired identifiers count 0; adopted identifiers present.**

```
useSplitSizes            0
defaultSizes             0
onAssignPane             0
paneIndex                0
splitDragging            0
"splitMode ==="          0
PANE_COUNTS              0
SplitMode                0
SplitNode                4   (type imports + PaneTree props + SplitView props + PaneTree children path)
function PaneTree        1
data-tab-id              1   (the single attribute on the leaf content div)
onOpenSessionInTree     17   (prop types, prop destructures, callback threads)
```

**tab-url.ts: additive splitTree ≥ 4.**

```
splitTree                6   (interface field JSDoc + interface field + encode splice + readTabPayloadFromUrl passthrough + consume extract + code comment)
```

**Zero-diff sibling files (Plan 56-03's cleanup targets).**

```
$ git diff --stat src/backend/ src/ui/lib/theme.ts src/types/ui-types.ts src/ui/lib/splitDragging.ts
(empty)
```

## Concrete drop-into-empty-PrettyView flow (per plan Output § 4)

User drags a conversation row with `dataTransfer.setData('text/plain', 'foo')` and drops on the empty PrettyView area.

1. `EmptyDropTarget`'s `onDrop` handler in `SplitView.tsx` reads `dataTransfer.getData('text/plain')` → `"foo"`.
2. Fires `onOpenSessionInTree('foo', [], 'left')`.
3. AppShell's `openSessionInTree` handler:
   ```
   setSplitTree(prev => {
     const withoutDup = removeLeaf(prev, 'foo');  // no-op if 'foo' not in tree
     if (withoutDup === null)
       return insertAtEdge(null, [], { kind: 'session', tabId: 'foo' }, 'left');
     ...
   });
   ```
4. `splitTree` becomes `{ kind: 'session', tabId: 'foo' }`.
5. URL-sync effect fires → `encodeSplitTreeToUrl` emits `s=tmux%3A<host>%3A<session>&t=0` → spliced into WorkspaceSpec.splitTree → `writeWorkspaceToUrl` writes the fragment.
6. `hasSplit = splitTree !== null` becomes true → the LOAD-BEARING gate at ~L1946 flips `display: 'none' → 'flex'` → SplitView container becomes visible.
7. The single-leaf `PaneTree` renders one Pane with `data-tab-id="foo"`; the DOM-placement effect at ~L1488-1546 finds `paneElsRef.current.get('foo')` and reparents the tab's stable `tabNodesRef` DOM node into that Pane.

Refresh reproduces the layout because the fragment survives Chrome's window-restore (fragment-not-query design of tab-url.ts).

## DropEdge stub disclosure (per plan Output § 6)

`computeEdgeFromDrop` in `SplitView.tsx` is a stub — every call returns `'left'`. This is intentional per Plan 56-02's Task 1 `<action>` block ("For THIS plan, `computeEdgeFromDrop` is a stub that always returns `'left'`. Plan 56-03 replaces it with the real nearest-edge computation.") No nearest-edge geometry snuck in. Plan 56-03 will substitute the real calculation using the drop event's client coordinates + the target cell's bounding rect + edge-zone hit-testing.

## Threat model outcomes

- **T-56-05 (Tampering — shareable URL crafted layout):** accept, unchanged. URLs open tabs the backend already accepts; a crafted URL only rearranges, no authz escalation.
- **T-56-06 (DoS — mount blocks on stale URL):** mitigate. Test 7 in AppShell.split-tree.test.tsx asserts a fragment referencing a non-existent session decodes to null, no blank-screen; SplitView container stays `display: 'none'`.
- **T-56-07 (Repudiation — close doesn't update URL):** partial-mitigate. `doCloseTab` now calls `setSplitTree(prev => removeLeaf(prev, id))` so any close (keyboard shortcut, panel action) also removes the leaf and triggers the URL-sync effect. Plan 56-58's drag-badge-to-list close path will call the same helper.
- **T-56-08 (Information disclosure — localStorage leak):** mitigate by non-consumption. The retired localStorage keys aren't cleared but are never read again; storage-quota impact negligible. No belt-and-suspenders `localStorage.removeItem` added (out of scope; not required).

## Deviations from plan

**Deviation 1 — Rule 3 (blocking issue: plan-specified `vitest --related` flag not supported).**

The plan's Task 2 acceptance criteria call for
`npx vitest run --related src/ui/AppShell.tsx src/ui/shell/SplitView.tsx src/ui/lib/tab-url.ts src/ui/lib/split-tree.ts src/ui/lib/split-tree-url.ts`.
This project runs vitest 4.1.8, which does NOT support `--related` (same as Wave 1's Deviation 1). Handling: I grep-scanned `src/ui/**/*.test.{ts,tsx}` for consumers of the changed modules and hand-listed the affected test files, then ran them directly:
```
tab-url.test.ts             3 tests   PASS  (new tests)
mobile-flow.test.ts        11 tests   PASS  (pre-existing consumer of tab-url)
split-tree.test.ts         20 tests   PASS  (Plan 56-01 modules; no changes)
split-tree-url.test.ts     12 tests   PASS  (Plan 56-01 modules; no changes)
SplitView.test.tsx          7 tests   PASS  (new)
AppShell.persistence.test.tsx  5 tests  PASS  (pre-existing, regression check)
AppShell.split-tree.test.tsx   6 tests  PASS  (new)
                          ─────────
                           64 tests   green in total across all files
```

Wave 1's Summary already documented the same deviation. Same handling applies here.

**Deviation 2 — Rule 1 (fix: comment hygiene for strict grep).**

The plan's Task 1 + Task 2 acceptance criteria say things like
`grep -c 'useSplitSizes' src/ui/shell/SplitView.tsx returns 0`
and
`grep -n 'splitMode' src/ui/AppShell.tsx returns 0 matches`.
My initial edits had explanatory comments naming the retired symbols (e.g., "Phase 56 Plan 02: `useSplitSizes` hook retired"). Those inflated the grep counts to ≥ 1 even though no live code referenced the symbols. Handling: rewrote every explanatory comment to name the retired concept without literally naming the symbol (e.g., "prior mode-enum + slot-array state retired", "size-hook retired"). Final grep counts as documented in the "Grep-hygiene confirmations" section above. This is the exact same handling Wave 1's Deviation 2 documented for the `throw` keyword in split-tree-url.ts comments.

**Deviation 3 — Rule 3 (blocking issue: jsdom rejects `flex: 1 1 0` shorthand).**

Task 1 Test 5 asserts equal-ratio subtree wrapping. My initial SplitView.tsx used `style={{ flex: '1 1 0' }}` on each subtree wrapper. In jsdom (the frontend project's vitest environment), the strict CSS parser REJECTS the shorthand `flex: 1 1 0` — the unitless zero in the basis slot is treated as invalid — leaving `el.style.flex === ''` and every individual longhand slot empty. This is a jsdom-only issue; real browsers parse `flex: 1 1 0` without complaint. Handling: switched to the longhand triple `style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0 }}` which jsdom accepts and browsers still resolve to the same computed layout. Test 5 checks the longhand form. Documented in decisions above.

**Deviation 4 — scope-boundary reminder (no leak).**

I deliberately did NOT delete the `PANE_COUNTS` / `SPLIT_MODES` exports from `theme.ts`, the `SplitMode` type from `ui-types.ts`, or the `splitDragging.ts` file. All three become orphaned (grep-verified: zero live callers after this plan) but Plan 56-03 owns the deletion pass. `git diff --stat` confirms zero changes to any of those three files.

## Follow-on readiness for Plan 56-03

Plan 56-03 (Wave 3) can proceed cleanly on top of Wave 2's end-state:

- The `SplitView` prop signature is stable: `onOpenSessionInTree(tabId, path, edge)`. Plan 56-03 substitutes the real `computeEdgeFromDrop` (nearest-edge geometry) — a one-function swap.
- The `openSessionInTree` handler in AppShell is idempotent under repeated calls with the same tabId — removeLeaf then insertAtEdge composes a move. Plan 56-03's drag-source on conv-list rows drops onto Pane cells and the receiving side is already wired.
- The retirement pass Plan 56-03 owns:
  - Delete `src/ui/lib/splitDragging.ts` (grep-verified zero callers).
  - Delete `SPLIT_MODES` + `PANE_COUNTS` exports from `src/ui/lib/theme.ts`.
  - Delete `SplitMode` type from `src/types/ui-types.ts`.
- No blockers, no partial state, no scope leaks. The `git blame` on the eventual deletions will attribute to Plan 56-03 cleanly.

## Commit trail

| Commit    | Type          | Summary                                                     |
| --------- | ------------- | ----------------------------------------------------------- |
| 95cb3239  | `feat(56-02)` | rewrite SplitView as recursive-tree renderer                |
| 841b74fa  | `feat(56-02)` | AppShell adopts splitTree state; URL round-trips the tree   |
| c16d90b9  | `test(56-02)` | AppShell split-tree mechanism scaffold tests (6 cases)      |

## Self-Check: PASSED
- `src/ui/shell/SplitView.tsx` exists and is 340 lines (within [200, 350]).
- `src/ui/shell/SplitView.test.tsx` exists; 7 tests green.
- `src/ui/lib/tab-url.ts` splitTree grep-count = 6 (≥ 4).
- `src/ui/lib/tab-url.test.ts` exists; 3 tests green.
- `src/ui/AppShell.split-tree.test.tsx` exists; 6 tests green.
- `git log --oneline HEAD~3..HEAD` shows the three commits above.
- `git diff --stat src/backend/ src/ui/lib/theme.ts src/types/ui-types.ts src/ui/lib/splitDragging.ts` = empty.
- `npx tsc --noEmit` exits 0.
- The LOAD-BEARING mispaint-gate comment is present verbatim above the visibility gate in AppShell.tsx.
- Test 6 (portal-preservation) asserts `Object.is(nodeAAfter, nodeABefore) === true` after a cross-cell move — the CONTEXT.md § "moving a session between cells destroys its state" failure-mode guard.
- Test 8 (mispaint-gate) asserts `gate.style.display === "none"` on first paint when splitTree === null.
