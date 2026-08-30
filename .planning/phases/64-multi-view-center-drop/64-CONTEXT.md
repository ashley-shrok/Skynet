# Phase 64: multi-view drop-in-center = replace (from conv list) or swap (from open identity badge) — Context

**Gathered:** 2026-08-30
**Status:** Ready for planning
**Source:** Direct-seeded from `.planning/shapes/shape-multi-view-center-drop.md` (opened 2026-08-30, Ashley thumbs-upped after one pitch-recap turn). Discuss-phase skipped per `/build` convention when the shape file already captures scope + philosophy + failure modes and the scope is small and clear (precedent for this work family: Phase 53 backend-authoritative-recycling, Phase 56 visual-session-management foundation, Phase 57 drop-preview overlay, Phase 58 identity-badge drag, Phase 59 coral drop-target affordance).

## What this is

An additive extension of the existing multi-view drag-and-drop system built over Phases 56–59. The center-of-an-open-session's body — currently a silent no-op (Phase 57 "center dead zone") — becomes a valid drop target with source-conditioned behavior:

- **Drop from a conversation list row → replace.** The target session is removed from its grid cell, and the dragged session takes that cell in place. The displaced session drops out of the grid entirely (it's still present in the conv list — no longer occupying a slot).
- **Drop from an already-open session's identity badge → swap.** The two sessions trade slots; both remain live in the grid.

Both cases show a **whole-body coral highlight** on the target session while hovering. No visual distinction between replace-coral and swap-coral, no label, no confirmation. The source of the drag disambiguates and the user learns from context.

**Shape file quote (§Shape, verbatim):**

> There is currently one class of drop target — the coral seams between and around open sessions — and dropping there repositions. This change adds a second class of drop target: the body of an already-open session. When the drag is hovering over the body of an open session (i.e. inside its area, not over one of the seams), the whole body of that session lights coral. On release: if the drag came from a conversation list row, the target session is replaced in place by the dragged session (the session that was there drops out of the grid — it is still present in the conversation list, just no longer occupying a slot). If the drag came from an already-open session's identity badge, the two sessions swap slots (both remain live in the grid, they just trade positions).

**Shape file philosophy that shapes this phase (§Philosophy):**

> Small, consistent extension of a behavior that already exists. The coral vocabulary stays the same — coral means "you can drop here" — and the new drop target just adds another place the coral appears. Which of the two outcomes fires is determined structurally by where the drag started, not by a modifier key or a hold gesture; there is no mode to remember and no palette to consult.

## Discovery findings that make the estimate small

The Explore-agent survey (2026-08-30) surfaced three findings that keep this phase tight:

**Discovery 1: The change point is a single short-circuit branch.** `src/ui/shell/SplitView.tsx:349-355` currently reads:

```typescript
if (zone === "center") {
  console.info(
    `[pv-split-drop] center-dead-zone ignored path=${JSON.stringify(path)} clientX=${Math.round(e.clientX)} clientY=${Math.round(e.clientY)}`,
  );
  return; // Silent — no handler call, no visual feedback
}
```

This is the exact block that becomes the new center-drop path. The 5-zone `computeEdgeZone` hit-tester at `src/ui/lib/split-tree.ts:377-397` already returns `"center"` for the interior region; Phase 64 doesn't need to add a new zone — it re-purposes the existing `center` return value.

**Discovery 2: MIME-type discrimination is already in place — the disambiguation is free.**

- Conv-list rows (Phase 56 Plan 03, `PrettyConversationRow.tsx:927-951`) set `application/x-skynet-row` + `text/plain` on dragstart.
- Identity badges (Phase 58 Plan 01, `IdentityBadge.tsx`) set `application/x-skynet-badge` + `text/plain` on dragstart.

Reading which of those MIMEs is present in `e.dataTransfer` on drop tells us the source-of-drag with no additional plumbing. The disambiguation is: badge MIME present → swap path; row MIME present (or `text/plain` fallback) → replace path. This is the same MIME-discrimination pattern Phase 58 Plan 02 used to route conv-list-panel drops to close-only-if-badge.

**Discovery 3: No `replaceLeaf` / `swapLeaves` helpers exist in `split-tree.ts`.** Phase 64 must add them. Only `findLeaf`, `getNodeAt`, `insertAtEdge`, `removeLeaf`, `collectTabIds`, and `computeEdgeZone` exist today. The new helpers are small and can be built on top of the existing primitives:

- `replaceLeaf(root, targetTabId, replacementTabId)`: find target leaf's path, remove any pre-existing `replacementTabId` leaf from the tree (for the "session already in grid" case — see edge case #3 below), then set the target's cell to the replacement session. Preserves target's cell shape and location. Returns new root.
- `swapLeaves(root, tabIdA, tabIdB)`: find both leaves' paths, mutate each cell's `tabId` in place (both cells stay put in the tree; only their contents trade). Returns new root.

Both operate purely on the `SplitNode` tree; both are pure functions; both fit the existing test-adjacent style in `src/ui/lib/split-tree.test.ts`.

**Consequence for effort:** Two plans, two waves. Plan 01 = pure tree helpers + unit tests (standalone). Plan 02 = SplitView center-drop wiring + AppShell handlers + component/integration tests (depends on Plan 01).

## In-scope this phase

1. **New pure tree helpers in `src/ui/lib/split-tree.ts` (Plan 64-01).**
   - `replaceLeaf(root: SplitNode | null, targetTabId: string, replacementTabId: string): SplitNode | null` — replaces the target session in place; if `replacementTabId` was elsewhere in the tree, it's removed from its old position first (dedup via `removeLeaf`); if `targetTabId === replacementTabId`, returns root unchanged (benign no-op — see edge case #1). Preserves the target cell's ancestry (splits above it, ratios unchanged).
   - `swapLeaves(root: SplitNode | null, tabIdA: string, tabIdB: string): SplitNode | null` — swaps the sessions at two leaves' cells; if `tabIdA === tabIdB`, returns root unchanged (benign no-op — see edge case #1); if either leaf is not found in the tree, returns root unchanged and logs a warning (defensive — the AppShell handler should guard against this, but the helper is defensive too).
   - Both are pure — no side effects, no `console.info` from the helpers themselves. Structured logging belongs at the handler layer in AppShell.

2. **New AppShell handlers `replaceInTree` + `swapInTree` (Plan 64-02).**
   - `replaceInTree(replacementTabId: string, targetTabId: string)` — calls `setSplitTree((prev) => replaceLeaf(prev, targetTabId, replacementTabId))`. Structured log: `[pv-split-drop] replace target=<tabId> with=<tabId>`.
   - `swapInTree(tabIdA: string, tabIdB: string)` — calls `setSplitTree((prev) => swapLeaves(prev, tabIdA, tabIdB))`. Structured log: `[pv-split-drop] swap a=<tabId> b=<tabId>`.
   - Both mirror the mutation shape of the existing `openSessionInTree` handler at `AppShell.tsx:1600-1708` (functional-updater pattern; URL fragment auto-syncs via existing effect at `AppShell.tsx:868` since `splitTree` is the encoded axis).
   - **Focus semantics — SYMMETRIC.** Both handlers set focus to the "just-moved" session after the mutation. For `replaceInTree`: `setFocusedTabId(replacementTabId)` — the new occupant of the target cell gets focus. For `swapInTree`: `setFocusedTabId(tabIdA)` — the session that was dragged (source) gets focus in its new cell. Mental model in both cases: the session the user was "carrying" during the drag lands focused. This is the locked default; do not leave focus to executor discretion.

3. **SplitView center-zone drop handling (Plan 64-02).** Rewrite the short-circuit at `src/ui/shell/SplitView.tsx:349-355`:
   - On center-zone drop, read `e.dataTransfer.types`:
     - If `application/x-skynet-badge` is present → parse the badge payload for the source `tabId`, and if it differs from the target session's `tabId`, call the new prop `onSwapInTree(sourceTabId, targetTabId)`. If equal (self-drop), fall through silently — benign no-op.
     - Else if `application/x-skynet-row` is present (or `text/plain` as fallback per the existing Pane onDrop contract at `:359, :380`) → extract the row's `tabId` (from the row payload `id` field OR `text/plain`) and call `onReplaceInTree(sourceTabId, targetTabId)`. Guard: if the source tab isn't already an OPEN session (no matching entry in `tabs[]`), fall through to open-in-place-via-replace as if it's a new-into-grid drop — this handles the mainline "drag a conv-list row into an open session's center" case, since a row for a not-yet-open session still needs the session opened.
     - Else → silent no-op (no valid MIME) — logs `[pv-split-drop] center-drop-unknown-mime path=... types=...` for observability.
   - Handler props: `onReplaceInTree(replacementTabId, targetTabId)` and `onSwapInTree(tabIdA, tabIdB)` added to the Pane's props alongside existing `onOpenSessionInTree` and `onDropRowInTree`.

4. **Whole-body coral highlight (Plan 64-02).** Currently the overlay renders only when `dropPreview.zone !== "center"` (`SplitView.tsx:474-489`). Change:
   - When `dropPreview.zone === "center"` AND the drag has a valid source MIME (badge or row), render the overlay with FULL-CELL geometry: `{ left: 0, top: 0, width: rect.width, height: rect.height }`. Add a new branch to `overlayGeometryForZone` (or a sibling helper `overlayGeometryForCenter(rect)`) to compute this.
   - Same coral RGBA values as the existing edge-zone overlay — `rgba(255, 184, 150, 0.22)` fill, `rgba(255, 184, 150, 0.60)` border. This is the "same coral vocabulary" the shape file locks in.
   - `data-zone="center"` attribute for test hooks (mirrors existing `data-zone="left|right|top|bottom"`).
   - The overlay's existing `pointer-events:none` + `zIndex: 20` + geometry transitions all reused verbatim.

5. **Structured logging discipline** (box-maintainer standing directive, Ashley 2026-08-11). New handler-level logs from AppShell:
   - `[pv-split-drop] replace target=<tabId> with=<tabId>` on `replaceInTree` invocation.
   - `[pv-split-drop] swap a=<tabId> b=<tabId>` on `swapInTree` invocation.
   - Existing `[pv-split-preview] zone=... path=...` from SplitView continues to emit — extend it to also fire on `zone === "center"` (currently gated to non-center zones since center had no meaning).
   - New SplitView log on center-drop with unknown MIME: `[pv-split-drop] center-drop-unknown-mime path=... types=...`.

6. **Test coverage additions** (Plan 64-01 unit + Plan 64-02 component/integration — plan-phase locks the exact set).
   - Plan 64-01 unit tests for `replaceLeaf` + `swapLeaves` (extending `src/ui/lib/split-tree.test.ts`) — see § Test coverage additions below.
   - Plan 64-02 SplitView tests (extending `src/ui/shell/SplitView.test.tsx`) — center-zone dragover with badge MIME shows full-cell coral; with row MIME shows full-cell coral; without a Skynet MIME shows nothing. Center-zone drop with badge MIME calls `onSwapInTree`; with row MIME calls `onReplaceInTree`; with unknown MIME is silent.
   - Plan 64-02 AppShell integration tests (extending `src/ui/AppShell.split-tree.test.tsx`) — end-to-end swap between two open sessions preserves both in the tree with swapped positions; end-to-end replace from a conv-list drag removes the displaced session from the tree; displaced session still exists in `tabs[]` (not `closeTab`'d — just kicked out of the grid).

## Explicitly OUT of scope this phase

- **Any visual distinction between replace-coral and swap-coral.** Same RGBA, same border, same transition. No label, no icon, no differentiating word. Shape §Philosophy locked this.
- **Any guard, confirmation, or undo affordance for the replace case.** No "you are about to lose the session in that slot" prompt. The displaced session is still trivially reachable from the conv list.
- **Touch behavior.** Ashley has never exercised the current multi-view drag/drop on touch (her own words 2026-08-30: *"honestly, I've never tried it. I only use the app on my phone and desktop... on phone you can't use it because you can't see the conversation list and pretty view at the same time"*). Phase 64 inherits whatever the current touch story is — works, doesn't work, partially works — and does not add or subtract from it.
- **Any new drag source.** Only the two existing sources (conv-list rows from Phase 56, identity badges from Phase 58) are considered.
- **Any new drop target other than the body of an already-open session.** Empty PrettyView, conv-list panel, and edge-zone drop targets all stay exactly as Phase 56–59 built them.
- **The two shape-time trimmed edge cases:**
  - No visual distinction between replace-coral and swap-coral (see above).
  - "Drag a session that is already showing elsewhere in the grid onto a different open session" — normal drag semantics + tree invariants (unique tabId per leaf enforced by `removeLeaf-then-insertAtEdge`) handle it; see edge case #3 below for what falls out. No custom-per-case branch.
- **Any changes to `openSessionInTree`, `onDropRowInTree`, edge-zone drop paths, or the drop-preview overlay for non-center zones.** All prior-phase behavior is preserved verbatim.
- **Rearrange animation / drag-with-content-follows.** Native HTML5 drag ghost only (matches Phase 58 §Out).
- **Any URL-encoding changes.** The tree data model is unchanged; `replaceLeaf` and `swapLeaves` produce new `SplitNode` values that round-trip through the existing `src/ui/lib/split-tree-url.ts` unchanged.

## Edge cases the plan MUST cover

1. **Self-drop (source `tabId` === target `tabId`).** For swap: two same tabIds, `swapLeaves` returns root unchanged (helper-level guard). For replace: same-tabId replace is also a no-op (helper-level guard). No error, no visual glitch, no coral flicker — the coral lights up during hover (normal center-drop coral), on release the tree stays put. Assert with a test.

2. **Swap when either session is not present in the tree.** Defensive path — the AppShell handler should only be called from SplitView, which only fires on drops onto open cells, so both sessions SHOULD be in the tree by construction. But `swapLeaves` still returns root unchanged and logs a warning if either leaf isn't found (`[split-tree] swapLeaves: leaf not found tabId=<x>`). Assert with a test.

3. **Replace where the replacement session is already elsewhere in the tree** (the "already-in-grid" case the shape trimmed). Falls out cleanly from tree invariants: `replaceLeaf` first calls `removeLeaf(root, replacementTabId)` (no-op if not present); the source cell collapses if it was there; then the target cell's `tabId` flips to the replacement. Result: source moved from its old cell into the target's cell; target session kicked to conv-list-only. This is effectively a swap where one side goes "back to conv list only" instead of exchanging position — Ashley's "just let people manage their own sessions" call, no special-casing needed. Assert with a test.

4. **Replace where the replacement session is NOT already open** (the mainline "drag conv-list row of a not-yet-open session into an open session's center"). SplitView's guard falls back to `onReplaceInTree(replacementTabId, targetTabId)` regardless — `replaceLeaf` inserts the replacement at the target's cell whether or not it was previously in the tree. Result: session opens directly into the target's cell; displaced session drops to conv-list-only. Assert with a test.

5. **Center-drop with unknown MIME** (someone drags a browser element or a file onto an open session). `hasSkynetDragPayload` at the top of `onDragOver` already gates this (currently at `SplitView.tsx:275`); center-drop path inherits the same gate. If it slips through (e.g. a native HTML5 drag with `text/plain` set to something not-a-tabId), the SplitView guard falls through to silent-no-op with an observability log. Assert with a test.

6. **Coral overlay disappearance on drag-leave / drag-cancel.** Existing overlay state (`dropPreview`) is already cleared on `dragleave` at `SplitView.tsx:301-330` via a bounding-rect / contains guard added in Phase 57. Center-zone overlay uses the same `dropPreview` state, so leave/cancel clears cleanly with no additional wiring. Assert with a test (specifically that centering-then-leaving clears the overlay, no flicker on child DOM boundary crossings — Phase 57's flicker fix already covers this).

7. **Swap when both cells are in different subtrees (deep tree).** `swapLeaves` operates on paths independently — the pattern is: find path A, find path B, mutate each leaf's `tabId`. Both paths remain valid throughout because we're not doing structural mutation (no cell removal or insertion). Assert with a test that has a nested tree (e.g. `split(vertical, [leaf(A), split(horizontal, [leaf(B), leaf(C)])])` — swap A ↔ C keeps the tree shape identical, only the tabIds at the leaves change).

8. **Replace when target cell is a single-session root tree.** Replace at root: `findLeaf` returns `[]` (root path), `replaceLeaf` sets root's tabId. If the replacement is the same session, no-op (edge case #1). If the replacement is a different session that WAS elsewhere in a bigger tree, `removeLeaf` collapses that; but with a single-session root tree there IS nowhere else, so `removeLeaf` returns root unchanged. Assert with a test.

## Files most likely touched (implementation-side)

Small blast radius — 4 files (2 modified, 2 test files extended).

- **`src/ui/lib/split-tree.ts`** — add `replaceLeaf(root, targetTabId, replacementTabId)` and `swapLeaves(root, tabIdA, tabIdB)` pure helpers. ~40-60 lines of additions.
- **`src/ui/lib/split-tree.test.ts`** — extend with unit tests for both helpers (~10-15 new test cases: same-id no-op, deep-tree swap, replacement-already-elsewhere, replacement-not-in-tree, missing-leaf defensive path, root-cell replace, tree-shape preservation).
- **`src/ui/shell/SplitView.tsx`** — rewrite the center-dead-zone short-circuit at `:349-355` to dispatch replace-vs-swap based on `e.dataTransfer.types`; add whole-cell overlay geometry branch to `overlayGeometryForZone` (or sibling helper) + remove the `zone !== "center"` gate at `:474` when the drag has a valid source MIME; add `onReplaceInTree` + `onSwapInTree` props to Pane's interface. ~30-50 lines net.
- **`src/ui/shell/SplitView.test.tsx`** — extend with center-drop tests: full-cell coral highlight on badge-MIME hover, full-cell coral on row-MIME hover, no highlight on unknown-MIME hover; drop dispatches to `onSwapInTree` (badge), `onReplaceInTree` (row), silent-no-op (unknown-MIME). ~5-8 new test cases.
- **`src/ui/AppShell.tsx`** — add `replaceInTree` + `swapInTree` handler callbacks (mirror shape of `openSessionInTree` at `:1600-1708` — functional updater around the new helpers); wire as `onReplaceInTree={replaceInTree}` + `onSwapInTree={swapInTree}` on the SplitView render site. ~30-50 lines net.
- **`src/ui/AppShell.split-tree.test.tsx`** — extend with two end-to-end integration tests: (a) swap between two open sessions preserves both in `tabs[]` + swaps their tree positions; (b) replace from a conv-list drag kicks the displaced session out of the tree but keeps it in `tabs[]` (not `closeTab`'d). ~2-4 new test cases.

Files that stay untouched:

- `src/ui/lib/split-tree-url.ts` — URL encoding unchanged (tree shape produced by new helpers is byte-compatible with existing encoder).
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — drag source unchanged (Phase 56 payload contract preserved).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — drop target for badge-close unchanged (Phase 58).
- `src/ui/features/terminal/IdentityBadge.tsx` — drag source unchanged (Phase 58 payload contract preserved).
- `src/ui/features/pretty-view/PrettyView.tsx` — no changes.
- All backend files — Phase 64 is frontend-only.

## Test coverage additions (foreseen — plan-phase locks the exact set)

**Plan 64-01 unit tests (`src/ui/lib/split-tree.test.ts` extensions):**

`replaceLeaf`:
- Test 1: replace at root of single-session tree changes the tabId; tree shape preserved.
- Test 2: replace in a 2-cell tree with a not-yet-in-tree session; target cell's tabId flips; other cell untouched; tree shape preserved.
- Test 3: replace where the replacement is already elsewhere in a 3-cell tree; replacement removed from old cell (which collapses); target cell's tabId flips to replacement; net effect = move.
- Test 4: replace with `targetTabId === replacementTabId` returns root unchanged (no-op).
- Test 5: replace where `targetTabId` is not found in tree returns root unchanged (defensive — warn log).

`swapLeaves`:
- Test 6: swap 2 leaves in a 2-cell tree; each cell's tabId flips; tree shape identical.
- Test 7: swap in a deep tree (`split(vertical, [leaf(A), split(horizontal, [leaf(B), leaf(C)])])` — swap A ↔ C); tree shape preserved; A ends up where C was, C ends up where A was; B untouched.
- Test 8: swap with `tabIdA === tabIdB` returns root unchanged (no-op).
- Test 9: swap where either tabId is not found returns root unchanged (defensive — warn log).

**Plan 64-02 SplitView component tests (`src/ui/shell/SplitView.test.tsx` extensions):**

Overlay rendering:
- Test 10: dragover at center with `application/x-skynet-badge` MIME shows full-cell overlay (`data-zone="center"`, geometry = full rect).
- Test 11: dragover at center with `application/x-skynet-row` MIME shows full-cell overlay.
- Test 12: dragover at center with unknown MIME shows no overlay.
- Test 13: dragover at center then dragleave clears the overlay (state cleanup).

Drop dispatch:
- Test 14: center-drop with `application/x-skynet-badge` calls `onSwapInTree(sourceTabId, targetTabId)`; does NOT call `onOpenSessionInTree` or `onReplaceInTree`.
- Test 15: center-drop with `application/x-skynet-row` payload calls `onReplaceInTree(sourceTabId, targetTabId)`; does NOT call `onSwapInTree`.
- Test 16: center-drop with badge MIME where `sourceTabId === targetTabId` (self-drop) is silent — no handler call, structured log emits.
- Test 17: center-drop with unknown MIME is silent + emits `[pv-split-drop] center-drop-unknown-mime` log.
- Test 18: existing edge-zone drop behavior preserved (regression) — top edge drop still calls `onOpenSessionInTree` / `onDropRowInTree`.

**Plan 64-02 AppShell integration tests (`src/ui/AppShell.split-tree.test.tsx` extensions):**

- Test 19: with 2 open sessions in a split tree, badge-drag from one onto the center of the other → both sessions still present in `tabs[]`, tree positions swapped (leaf tabIds trade), URL fragment updated.
- Test 20: with 2 open sessions in the tree, conv-list-row drag (session A already open) onto the center of session B → session A now occupies B's cell; session B removed from the tree (still in `tabs[]`, not `closeTab`'d); source cell of session A collapsed.
- Test 21: portal-preservation — after a swap, both sessions' React trees are NOT unmounted (assert `unmountCallSpy` count unchanged pre/post swap, mirroring Phase 56 Test 6's portal-preservation assertion at `AppShell.split-tree.test.tsx:~500`).

## What would make Phase 64 wrong (checkpoints for /close)

- **Coral appearance inconsistent between replace and swap.** Different color, different border, different animation, one has a label and the other doesn't. The shape's "same coral vocabulary, source-decides-outcome" spine is broken.
- **Center-drop silently no-ops.** Coral appeared on hover → release with no action. The rule from the shape is: coral appeared → release always performs the corresponding action. Silent failure destroys trust in the affordance.
- **Displaced session on replace ends up half-mounted / half-torn-down.** The session should stay live in `tabs[]` and re-appear in the conv list normally. If it gets `closeTab`'d (WebSocket torn down), the promise "still there, just not in a slot" is broken.
- **Swap animation leaves cells blank / overlapping mid-swing.** The swap is atomic (a single `setSplitTree` call with the new tree); both cells re-render in the same React commit. If there's an intermediate state where one cell is empty or both show the same session, the atomicity was violated.
- **Center-drop competes with edge-zone drop for the same hover pixel.** `computeEdgeZone` returns `center` only for the interior; the edge zones (`top` / `right` / `bottom` / `left`) already have priority at the borders. If a pixel near an edge fires center-drop instead of edge-drop, the hit-tester is misconfigured.
- **Portal preservation broken on swap.** Phase 56's always-mounted portal architecture means the session's React subtree is portaled into whichever cell it's assigned to; a swap re-hangs which cell each portal lands in, but the tabs' underlying components should NOT re-mount. If swap causes WebSocket reconnect, scroll position loss, or compose-box draft loss, the portal architecture is being violated by the new mutation path.
- **`splitTree` state ends up with a stale tabId** referencing a tab that's not in `tabs[]`. Ownership invariants: every leaf tabId in `splitTree` MUST have a matching entry in `tabs[]`. `replaceLeaf` and `swapLeaves` must not introduce a leaf with a phantom tabId.
- **URL fragment does not update after replace or swap.** The URL-sync effect at `AppShell.tsx:1322` reads `splitTree` and encodes it on every change; new handlers use the same `setSplitTree` mutation path, so URL sync should fall out for free. If the URL doesn't update, the mutation didn't go through `setSplitTree` (probably called a helper directly without state wrapping).
- **Existing edge-zone drop, empty-PrettyView drop, or conv-list-close drop regressed.** All Phase 56–59 drop paths must still behave identically. Assert via regression tests (Tests 18 above, plus the existing Phase 56–59 test suite should stay green).
- **`[pv-split-drop]` log stream broken.** The existing `[pv-split-drop] center-dead-zone ignored ...` log line goes away (replaced by the new center-drop logs); if any dashboard, forensic query, or bounty context depends on that exact string, it needs updating. Check with a grep across `~/.claude/roles/box-maintainer/bounties/` for any references — none expected, but worth naming.

## Vehicle notes

**Skip discuss-phase** (precedent: Phase 53, 56, 57, 58, 59). This CONTEXT.md IS the discuss-phase output.

**Plan-phase**: expected to produce 2 plans, roughly:

- **64-01: Pure tree helpers.** Add `replaceLeaf` + `swapLeaves` to `src/ui/lib/split-tree.ts` with unit tests. Standalone — no UI wiring, no side effects, no AppShell touch. Wave 1.
- **64-02: SplitView center-drop wiring + AppShell handlers + component + integration tests.** Depends on 64-01. Wave 2.

**Executor scope**: code + commit + scoped tests green. Full-suite + docker build + deploy are orchestrator-only per box-maintainer role directive (Ashley 2026-08-08).

**TDD suitability**: both plans are TDD-friendly — pure helpers have precise I/O contracts; SplitView drop behavior is a state machine with clear inputs (MIME, source tabId, target tabId) and outputs (handler calls). Planner should apply `type: tdd` to eligible tasks per `TDD_MODE` if enabled.

**Rebase risk**: LOW. `split-tree.ts` is fork-local and rarely touched cross-fleet. `SplitView.tsx` has moderate cross-fleet activity from the Phase 56–59 arc but is now stable. `AppShell.tsx` has heavy cross-fleet activity, but Phase 64's additions are two new handler declarations + one render-site prop update — additive, low collision surface. Coord at ship time per role rule.

**Parent bounty**: none (this is a shape-file-driven /build phase, not attached to a bounty). If Ashley wants a bounty tracker, plan-phase can create one — but the shape file already captures the trail.

**Reference prototype**: `~/.claude/roles/box-maintainer/bounties/bring-back-split-view/prototype.html` demonstrates the badge-drag interaction model from Phase 58 — the "center = valid drop target" mechanic is a natural next step over what that prototype shows. Consult if plan-phase wants a visual reference for the hit-testing.

**No worktrees** (Ashley 2026-07-31, fleet rule).
