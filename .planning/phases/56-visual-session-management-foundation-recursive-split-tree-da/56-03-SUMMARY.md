---
phase: 56-visual-session-management-foundation-recursive-split-tree-da
plan: 03
subsystem: ui-shell
tags:
  - split-tree
  - drag-drop
  - conv-list
  - dead-code-retirement
  - phase-56
  - foundation-close-out
dependency-graph:
  requires:
    - "src/ui/shell/SplitView.tsx (Plan 56-02 rewrite)"
    - "src/ui/AppShell.tsx openSessionInTree (Plan 56-02)"
    - "src/ui/lib/split-tree.ts DropEdge (Plan 56-01)"
  provides:
    - "Conv-list rows draggable via HTML5 native drag (dataTransfer text/plain payload = row.id)"
    - "Real nearest-edge geometry in SplitView Pane onDrop via exported computeNearestEdge()"
    - "SPLIT_MODES, PANE_COUNTS, SplitMode, splitDragging.ts fully retired from src/"
  affects:
    - "Phase 57 (drop-preview overlay + edge-zone hit-test) — layers on top of computeNearestEdge unchanged"
    - "Phase 58 (badge drag) — reuses the same dataTransfer text/plain contract"
tech-stack:
  added: []
  patterns:
    - "HTML5 native drag as the fourth pointer-class gesture — browser threshold disambiguation, no manual dx/dy gate"
    - "createEvent.drop + defineProperty(clientX/Y) idiom for jsdom drop tests (jsdom lacks window.DragEvent)"
key-files:
  created: []
  modified:
    - "src/ui/features/pretty-conversations/PrettyConversationRow.tsx (1353 → 1374 lines, +21)"
    - "src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx (3402 → 3503 lines, +101)"
    - "src/ui/shell/SplitView.tsx (340 → 380 lines net; +52 add / -12 remove)"
    - "src/ui/shell/SplitView.test.tsx (245 → 396 lines net; +180 add / -29 remove)"
    - "src/ui/lib/theme.ts (109 → 88 lines, −21)"
    - "src/types/ui-types.ts (310 → 302 lines, −8)"
  deleted:
    - "src/ui/lib/splitDragging.ts (15 lines)"
decisions:
  - "computeNearestEdge tie-break priority: left → top → right → bottom (first-match-wins). Matches CSS reading order; dead-center (all four distances equal) deterministically resolves to 'left'."
  - "Plan-56-02 Test 7 (Pane drop stub-era `'left'` assertion) DELETED rather than reshaped — superseded by Plan 03 describe block Tests 6-7 which assert geometry-driven edge against mocked getBoundingClientRect."
  - "createEvent.drop + Object.defineProperty(clientX/Y) idiom used for Tests 6-7 because jsdom does not implement window.DragEvent — RTL falls back to plain Event, whose constructor init drops clientX/clientY. The Wave-2 precedent (Deviation 3: jsdom rejects `flex: 1 1 0` shorthand) generalizes: jsdom shims are needed for foundation-phase drag geometry tests."
  - "onDragStart handler is named onRowDragStart to avoid collision with the JSX prop key `onDragStart`. Grep counts reflect this: `onRowDragStart` appears twice (decl + wire), `onDragStart` appears once (JSX prop key). Plan's grep criterion `onDragStart >= 2` is internally inconsistent with the plan's own naming; documented as Deviation 1."
  - "doCloseTab in AppShell.tsx already calls `setSplitTree(prev => removeLeaf(prev, id))` at L1466 as of Wave 2 (Plan 56-02's T-56-07 partial-mitigate). Plan 56-03 confirms it is in place; no follow-up bounty needed."
metrics:
  duration: "~12 minutes"
  completed: "2026-08-28"
  tasks-completed: 3
  files-created: 0
  files-modified: 6
  files-deleted: 1
  tests-added: 12   # 4 drag tests on the row + 8 nearest-edge tests on SplitView
---

# Phase 56 Plan 03: Row-drag, real nearest-edge, dead-code retirement — Summary

**Wired PrettyConversationRow as an HTML5 drag source, replaced the Plan-56-02 stub `computeEdgeFromDrop => 'left'` with a real `computeNearestEdge(rect, x, y)` in SplitView, and physically deleted SPLIT_MODES, PANE_COUNTS, SplitMode, and splitDragging.ts — closing Phase 56's foundation arc. 12 new tests (4 drag + 8 nearest-edge) green; 157 tests green across the wave-3-touched-and-adjacent test file set; `npx tsc --noEmit` clean; zero backend/ diff; zero PrettyView.tsx diff.**

## Line-count and diff table

| File                                                              | Before | After | Δ    | Notes                                                                                          |
| ----------------------------------------------------------------- | ------ | ----- | ---- | ---------------------------------------------------------------------------------------------- |
| `src/ui/features/pretty-conversations/PrettyConversationRow.tsx`  | 1353   | 1374  | +21  | +`DragEvent` type-only import; +14-line onRowDragStart useCallback + 8-line JSDoc; +2 JSX props (`draggable={true}` at L1097 + `onDragStart={onRowDragStart}` at L1123). |
| `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` | 3402 | 3503 | +101 | +Phase 56 describe block with 4 tests (dragstart writes tabId, effectAllowed='move', draggable="true", avatar img still draggable="false"). Zero pre-existing test edits. |
| `src/ui/shell/SplitView.tsx`                                      | 340    | 380   | +40  | +exported `computeNearestEdge` (26-line body + 14-line JSDoc); Pane onDrop rewritten to read `e.currentTarget.getBoundingClientRect()` + `e.clientX/Y` and call `computeNearestEdge`; `computeEdgeFromDrop` stub removed. |
| `src/ui/shell/SplitView.test.tsx`                                 | 245    | 396   | +151 | +import `computeNearestEdge` + `createEvent`; +Plan 03 describe block with 8 tests (5 unit + 2 integration + 1 negative); DELETED Plan-56-02 Test 7 stub-era assertion (superseded); file-top comment rewritten to reference the deletion. |
| `src/ui/lib/theme.ts`                                             | 109    | 88    | −21  | DELETED SPLIT_MODES + PANE_COUNTS + `SplitMode` type-only import. All other exports (DASHBOARD_CARDS, ACCENT_PRESET_COLORS, applyAccentColor, FONT_SIZES, applyFontSize, FOLDER_COLORS) preserved verbatim. |
| `src/types/ui-types.ts`                                           | 310    | 302   | −8   | DELETED `SplitMode` union type. ToolsTab's 'split-screen' string literal is a different token; preserved. |
| `src/ui/lib/splitDragging.ts`                                     | 15     | ∅     | −15  | DELETED via `git rm`. All three exports (splitDragState, notifyDragEnd, registerFitCallback) had zero live consumers post-Wave-2. |

**Net src/ delta: +340 add / −73 remove; +267 lines total across the plan.**

## Exact line numbers requested by plan's Output block

**Row drag wires:**
- `draggable={true}` on the row body `<div role="button">` — `PrettyConversationRow.tsx` L1097.
- `onDragStart={onRowDragStart}` on the same div — `PrettyConversationRow.tsx` L1123.
- `onRowDragStart` useCallback declaration — `PrettyConversationRow.tsx` L927 (immediately below `onMouseLeave`, above the cleanup useEffect).

**Tie-break priority chosen for computeNearestEdge:**
`left → top → right → bottom` (first-match-wins). Rationale: matches CSS reading order (left/top before right/bottom), gives deterministic dead-center → 'left'. Test 5 asserts this behavior.

**doCloseTab extension for removeLeaf:**
Already in place from Wave 2 — `src/ui/AppShell.tsx` L1466 has `setSplitTree((prev) => removeLeaf(prev, id));` inside doCloseTab at L1416. Wave 2's Summary documented this under threat T-56-07 (partial-mitigate). No Wave-3 change needed; no follow-up bounty logged.

## Grep-hygiene confirmations (per plan acceptance criteria)

**Retirement targets — zero across src/:**

```
$ grep -rn "SPLIT_MODES"                                     src/ | wc -l   →  0
$ grep -rn "PANE_COUNTS"                                     src/ | wc -l   →  0
$ grep -rnE "\bSplitMode\b"                                  src/ | wc -l   →  0
$ grep -rn "splitDragState\|notifyDragEnd\|registerFitCallback" src/ | wc -l → 0
$ grep -rn "@/lib/splitDragging"                             src/ | wc -l   →  0
$ test -e src/ui/lib/splitDragging.ts                                       → non-zero exit (deleted)
```

**PrettyConversationRow.tsx wires:**

```
$ grep -c "draggable={true}"          → 1  (row body, added by this plan)
$ grep -c "draggable={false}"         → 1  (avatar <img> at L1160, preserved)
$ grep -c "onDragStart"               → 1  (JSX prop wire at L1123 only)
$ grep -c "onRowDragStart"            → 2  (useCallback decl at L927 + JSX prop-value at L1123)
$ grep -c 'dataTransfer.setData("text/plain"'  → 1  (handler body)
$ git diff … | grep -cE "^\+.*e\.(preventDefault|stopPropagation)"  → 0
```

**SplitView.tsx nearest-edge wires:**

```
$ grep -c "^export function computeNearestEdge"  → 1
$ grep -c "computeNearestEdge"                    → 3  (JSDoc mention + decl + call site)
$ grep -c "computeEdgeFromDrop"                   → 0  (stub gone)
$ grep -cE "edge\s*=\s*['\"]left['\"]"           → 0  (hardcoded assignment gone)
```

**SplitView.test.tsx Plan-56-02 stub-era assertion retirement:**

```
$ grep -cE "spy.*'left'" src/ui/shell/SplitView.test.tsx  → 0
```

(Remaining `'left'` string literals in the test file — Test 4 for the null-tree
EmptyDropTarget, Test 1 unit for the left-biased drop, Test 5 unit for dead-center
tie-break, Test 6 integration for a 200×100 rect at (15,50) — are all
legitimate geometry-driven assertions, not stub-era carryover.)

## Concrete drop flow validation

**Row grabbed by cursor → row moved to right-half of an already-split PrettyView:**

1. Ashley presses mouse on a `PrettyConversationRow` body. Browser threshold-triggers
   `dragstart` at ~5px cursor motion. `onRowDragStart(e)` fires:
   - `e.dataTransfer.setData("text/plain", row.id)` writes the tab id.
   - `e.dataTransfer.effectAllowed = "move"` sets the drag cursor to the move variant.
   - No preventDefault / stopPropagation — mouse-swipe machine's `swipeStartRef` is
     armed but never advances past the 8px disambiguation gate because the browser
     preempts pointermove with drag events at 5px, so the swipe machine self-cancels
     on next mouseup (which never comes; the drag ends via `drop`/`dragend`).

2. Cursor enters a `Pane` in the existing tree. `onDragOver(e)` fires → `e.preventDefault()`
   accepts the drop; `isDragOver` state → coral overlay renders.

3. Cursor lands 10px from the pane's right edge. `onDrop(e)` fires:
   - `payloadTabId = e.dataTransfer.getData("text/plain")` → the tab id.
   - `edge = computeNearestEdge(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY)`
     → `'right'` because `dRight (10)` is the minimum of the four distances.
   - `onOpenSessionInTree(tabId, path, 'right')` fires.

4. AppShell's `openSessionInTree(tabId, path, 'right')`:
   - `removeLeaf(prev, tabId)` drops the tab's existing leaf (if any) — no-op if
     this is the tab's first tree appearance.
   - `insertAtEdge(withoutDup, path, {kind:'session', tabId}, 'right')` splits the
     target cell vertically, new session on the right, existing on the left.

5. `splitTree` mutates → URL-sync effect fires → new fragment written. Refresh
   reproduces the layout verbatim.

6. `Object.is(oldNodeForTabId, newNodeForTabId) === true` (portal-preservation
   invariant per Wave 2 Test 6) — no remount, no WS reset.

## Deviations from plan

**Deviation 1 — Rule 3 (blocking issue: plan grep criterion internally inconsistent).**

Plan Task 1 acceptance says `grep -c "onDragStart" src/ui/features/pretty-conversations/PrettyConversationRow.tsx` returns "at least 2 (the handler declaration + the JSX prop wire)". But the plan's Action step 3 names the handler `onRowDragStart` (not `onDragStart`). Since `onRowDragStart` does not contain the literal substring `onDragStart`, the declaration line does NOT match the `onDragStart` grep. Actual counts: `onDragStart` = 1 (JSX prop key on L1123), `onRowDragStart` = 2 (decl at L927 + JSX prop value at L1123). The semantic spirit — "the handler exists as a declaration AND is wired into JSX" — is verified by `onRowDragStart >= 2`. No code change needed; documented as a plan-text issue. This is the same class of Wave-1/Wave-2 grep-versus-implementation resolution called out in Wave 2 Deviation 2.

**Deviation 2 — Rule 3 (blocking issue: `vitest --related` not supported in vitest 4.1.8).**

Plan Task 3 acceptance calls for `npx vitest run --related src/ui/lib/theme.ts src/types/ui-types.ts src/ui/shell/SplitView.tsx src/ui/AppShell.tsx`. The project runs vitest 4.1.8 without the `--related` flag (same as Wave 1 Deviation 1 + Wave 2 Deviation 1). Handling: grep-scan for consumers of the changed modules, hand-list the affected test files, run them directly. The run:

```
src/ui/shell/SplitView.test.tsx              14 tests   PASS
src/ui/AppShell.persistence.test.tsx          5 tests   PASS
src/ui/AppShell.split-tree.test.tsx           6 tests   PASS
src/ui/features/pretty-conversations/
   PrettyConversationRow.test.tsx            94 tests   PASS  (90 pre-existing + 4 new)
   PrettyConversationRow.clone-menu.test.tsx  3 tests   PASS  (adjacent regression)
src/ui/lib/tab-url.test.ts                    3 tests   PASS  (transitively touches split-tree URL encoding)
src/ui/lib/split-tree.test.ts                20 tests   PASS
src/ui/lib/split-tree-url.test.ts            12 tests   PASS
                                            ─────
                                            157 tests   green (8 files)
```

**Deviation 3 — Rule 3 (blocking issue: jsdom lacks window.DragEvent; RTL's fireEvent.drop init drops clientX/clientY).**

Plan Task 2 Tests 6-7 need to fire drop events at specific `clientX/Y` coordinates. First attempt used `fireEvent.drop(el, { clientX: 190, clientY: 50, dataTransfer: {...} })`. Test 7 failed: got `'left'` instead of `'right'`. Root cause: jsdom does not implement `window.DragEvent`; RTL's `createEvent` factory in `node_modules/@testing-library/dom/dist/events.js` at L56 falls back to `window.Event` (`window[EventType] || window.Event`). Plain `Event`'s constructor does not consume `clientX/clientY` from its init dictionary — those get silently dropped, so the fired event's `e.clientX` is `0`. With `getBoundingClientRect` mocked to `{left:100, right:200, ...}` and `clientX=0`, `computeNearestEdge` sees `dLeft = 0-100 = -100` (the minimum), returning `'left'`. Handling: use `createEvent.drop(el, {dataTransfer})` to build the event, then `Object.defineProperty(evt, "clientX", { value: 190 })` (and `clientY`) to explicitly attach the coords before dispatching via `fireEvent(el, evt)`. Wrapped in a `dispatchDropAt(el, x, y, dt)` helper co-located at the top of the Plan-03 describe block. Same class of jsdom-shim as Wave 2 Deviation 3 (`flex: 1 1 0` shorthand rejection). Documented in `<decisions>` above so the pattern is reusable.

## Threat model outcomes

- **T-56-09 (Tampering — adversarial dataTransfer):** unchanged from Plan 56-02. The wire contract is `dataTransfer.setData("text/plain", row.id)` on drag source; `dataTransfer.getData("text/plain")` on drop target. Cross-origin drag payloads are blocked by same-origin policy in Chrome/Firefox. Same-origin adversarial payload can only rearrange existing tabs, no authz escalation.
- **T-56-10 (DoS — gesture conflict):** accept, mitigated by design. Verified via non-regression: all 90 pre-existing `PrettyConversationRow.test.tsx` tests pass with `draggable={true}` and `onDragStart` added. The four native gestures coexist because HTML5 drag operates at a browser-owned threshold layer that preempts pointermove BEFORE React's synthetic mousemove reaches the mouse-swipe handler. Ashley's live UAT is the final gate for any brief-unresponsive frame edge case.
- **T-56-11 (Repudiation — nearest-edge tie-break floats):** accept. Test 5 asserts dead-center → `'left'` per documented left→top→right→bottom priority. computeNearestEdge uses strict `<` throughout, giving deterministic first-match-wins for equidistant candidates.

## No new threat flags

Scanned all Wave-3 modifications for new security-relevant surface (network endpoints, auth paths, file access, schema boundaries). Row-body drag → dataTransfer text/plain → Pane onDrop → openSessionInTree is entirely in-process; no new trust boundaries crossed. Nothing to flag.

## No known stubs

Scanned all touched files. `computeEdgeFromDrop`'s `=> 'left'` stub is DELETED, replaced by real geometry. `EmptyDropTarget`'s `onOpenSessionInTree(tabId, [], "left")` at `SplitView.tsx` L124 is NOT a stub — the null-root case has no cell to compute an edge on, and `insertAtEdge` ignores the edge parameter when the tree is null (per split-tree.ts's semantics). The literal `'left'` there is a required placeholder, not a stubbed geometry.

## Commit trail

| Commit    | Type          | Summary                                                                        |
| --------- | ------------- | ------------------------------------------------------------------------------ |
| 1ddb4045  | `feat(56-03)` | row is a drag source — draggable + onDragStart                                 |
| 65bda0a8  | `feat(56-03)` | SplitView Pane onDrop computes real nearest-edge                               |
| bca30fd5  | `chore(56-03)`| retire SPLIT_MODES, PANE_COUNTS, SplitMode, splitDragging.ts                   |

Phase-56 HEAD: `bca30fd5`.

## Self-Check: PASSED

- `PrettyConversationRow.tsx` L1097 has `draggable={true}`; L1123 has `onDragStart={onRowDragStart}`; L927 has the useCallback declaration — verified via `grep -n`.
- `SplitView.tsx` exports `computeNearestEdge` and Pane onDrop calls it against `e.currentTarget.getBoundingClientRect()` + `e.clientX/Y` — verified via `grep -c` (1 export, 3 total occurrences).
- All retirement targets return 0 across `src/`: `SPLIT_MODES`, `PANE_COUNTS`, `\bSplitMode\b`, `splitDragState`/`notifyDragEnd`/`registerFitCallback`, `@/lib/splitDragging`.
- `src/ui/lib/splitDragging.ts` deleted (verified via `test -e` non-zero exit and `git ls-files` empty).
- `npx tsc --noEmit` exits 0.
- 157 tests green across 8 scoped test files (SplitView 14 + AppShell.persistence 5 + AppShell.split-tree 6 + PrettyConversationRow 94 + PrettyConversationRow.clone-menu 3 + tab-url 3 + split-tree 20 + split-tree-url 12).
- 12 NEW tests explicitly on the Wave-3 acceptance surface: 4 drag tests (Tests 6-9 of the Phase 56 describe block in PrettyConversationRow.test.tsx) + 8 nearest-edge tests (Tests 1-8 of the Plan 03 describe block in SplitView.test.tsx).
- `git diff HEAD~3 src/backend/` = empty.
- `git diff HEAD~3 src/ui/features/pretty-view/PrettyView.tsx` = empty.
- `git log --oneline c7f410d2..HEAD` shows the three atomic commits above, in expected order.
- Plan-56-02 Test 7 stub-era `'left'` assertion is DELETED (grep `-cE "spy.*'left'"` → 0).
- Non-regression: all pre-existing tests across the 8-file scoped set remained green.
