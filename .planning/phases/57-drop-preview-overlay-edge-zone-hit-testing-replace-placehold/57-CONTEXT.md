# Phase 57: Drop-preview overlay + edge-zone hit-testing — Context

**Gathered:** 2026-08-28
**Status:** Ready for planning
**Source:** Direct-seeded from `.planning/shapes/shape-visual-session-management.md` §Vehicle notes Phase 2, plus Ashley's Phase 56 UAT observations (2026-08-28) that Phase 57 folds. Discuss-phase skipped per `/build` convention when the shape file already captures scope + philosophy + failure modes (precedent: Phase 53, Phase 56).

## What this is

The SECOND of three phases delivering drag-drop session management on the desktop PrettyView. Phase 56 shipped the foundation (recursive split-tree data model, URL persistence, conv-list drag-to-open, first-drop-into-empty-PrettyView, subsequent drops split at nearest edge as a temporary minimum-viable geometry driven by `computeNearestEdge` at drop-time). Phase 57 makes the drop interaction *predictable and legible* by adding live cursor-tracking preview + edge-zone hit-testing with a center dead zone. Phase 58 remains: identity-badge drag as third gesture + drag-badge-to-conv-list for full close.

**Shape file quote (Vehicle §Phase 2, verbatim):**

> **Drop-preview.** Add the four edge zones with center-as-dead-zone. Add the coral hover-preview overlay showing the future split geometry. Snap-to-nearest-edge for any position that isn't dead center. The interaction becomes what the prototype demonstrated.

**Shape file philosophy that shapes this phase:**

- **"Drag is the language."** The whole feature depends on drop-preview being accurate and responsive. If Ashley has to wonder where the session will land, the interaction is broken (shape §What would make it wrong).
- **"Snap-to-nearest-edge means anywhere in a cell that isn't dead center always shows a valid drop."** (shape §Shape para 4)
- **The center dead zone exists so there is one path to closing a session** — closing is Phase 58's drag-badge-to-list. Center-drop must do NOTHING: no replace, no swap, no no-op-with-visual-feedback — just: release does nothing, no drop registered.

## What Phase 56 shipped that Phase 57 replaces / builds on

Post-#514 state (HEAD `60207d36`), the live drop mechanics are in `src/ui/shell/SplitView.tsx`:

- **`Pane` component** (`src/ui/shell/SplitView.tsx:140-268`) — the leaf cell of the split tree. Uses **NATIVE DOM event listeners** (`dragover`/`dragleave`/`drop`) attached via `useEffect` on the Pane's outer div ref. React synthetic `onDrop` was replaced in patch #514 because React portals bubble events via the React tree, not the DOM tree, so portaled PrettyView content dropped onto a Pane's screen area never fired the Pane's synthetic handler. Native listeners on the Pane's outer div receive the bubble regardless of React parentage.
- **`isDragOver` local state** — a single boolean flag flipped on `dragover` / off on `dragleave`. Drives the current placeholder "Drop to split" overlay (`SplitView.tsx` around line 220).
- **`computeNearestEdge(rect, clientX, clientY)`** (`src/ui/lib/split-tree.ts:30-70`) — computes the closest of 4 edges (left/right/top/bottom) at DROP TIME only, measured as perpendicular distance to each edge's line. No hit-testing, no center dead zone.
- **`insertAtEdge(root, path, newLeaf, edge)`** (`src/ui/lib/split-tree.ts:127`) — inserts a session leaf into the tree at the chosen path + edge. Edge determines split direction and which side the new leaf lands. Called from AppShell's `onOpenSessionInTree` / `onDropRowInTree` handlers.
- **`DropEdge` type** = `"left" | "right" | "top" | "bottom"` — this stays; center-dead-zone means "no drop registered," not a fifth edge value.
- **Structured logging** (patch #512, prefix `[pv-split-drop]`) — logs path, edge, clientX/Y, rectLTRB, payload details on every drop. Keep the discipline: Phase 57's edge-zone + preview logic gets its own structured `[pv-split-preview]` prefix per box-maintainer's logging-first standing directive.

**Files carrying the current drop plumbing (post-#514):**

- `src/ui/shell/SplitView.tsx` (459 lines) — `Pane` (`:140`), `PaneTree` (`:314`), `SplitView` (`:403`).
- `src/ui/lib/split-tree.ts` (300 lines) — `computeNearestEdge`, `insertAtEdge`, `buildSplitForEdge`, `SplitNode` types.
- `src/ui/lib/split-tree-url.ts` (293 lines) — URL round-trip (stays, no changes expected).
- `src/ui/AppShell.tsx` — hosts the tree state, `onOpenSessionInTree` / `onDropRowInTree` handlers, portal-mount effect.

## The two Phase-57-inherent gaps Ashley observed in Phase 56 UAT

Phase 56 UAT (2026-08-28) confirmed drag-drop works end-to-end but surfaced two behaviors that Phase 57's whole point folds:

**Gap (a): drop-preview overlay flickers when moving.**
The `isDragOver` boolean flips off on `dragleave`, which fires every time the cursor crosses ANY child DOM boundary inside the Pane — including into the message bubbles, aside bubbles, compose box, and other portaled PrettyView children that live INSIDE the Pane's screen area. The overlay disappears, then reappears on the next `dragover` from the new child. Visible flicker. Standard fix classes:
- **Counter-based**: increment on `dragenter`, decrement on `dragleave`, hide only when counter hits 0.
- **Bounding-rect guard**: on `dragleave`, check if the new cursor position (`e.clientX`, `e.clientY`) is still inside the Pane's `getBoundingClientRect()`; only hide if it truly left.
- **`e.relatedTarget` guard**: on `dragleave`, check whether `e.relatedTarget` is still contained by the Pane element via `el.contains(...)`; only hide if not.

The bounding-rect guard has an advantage worth flagging: it's stateless (no counter to keep in sync), and combined with the always-mounted portal architecture (which already has `pointer-events` cascade quirks — see AppShell.tsx `tabNodesRef`), it's the most robust against React-tree/DOM-tree mismatches. Plan-phase to weigh the three.

**Gap (b): edge-selection unpredictable near equidistant points.**
`computeNearestEdge` runs at DROP TIME only, and the current placeholder overlay ("Drop to split") gives no visual signal about which edge will win. Near equidistant points (e.g. cursor near the pane's diagonal), Ashley cannot predict which edge she'll get until after release, which sometimes lands a split she didn't intend. This is inherent to Phase 56's minimum-viable geometry; Phase 57's live preview + edge-zone hit-testing directly fixes it — the coral overlay shows the incoming split BEFORE release, so if the wrong edge is highlighted, Ashley moves the cursor a few pixels and watches it snap to the intended edge.

Both gaps are what makes the shape file's "if Ashley has to wonder where the session will actually land, the interaction is broken" concrete.

## In-scope this phase

1. **Edge-zone hit-testing with center dead zone.** Divide each pane into 5 zones by cursor position: left / right / top / bottom edge zones + center dead zone. The four edge zones each occupy the outer band along that edge; the center zone occupies the middle. Exact geometry (rectangular bands vs. diagonal-triangle wedges vs. distance-to-edge threshold) is a plan-phase decision — the shape file locks the *behavior* (nearest-edge everywhere except center = no drop), not the *geometry* of the zones. Recommend rectangular bands with a % threshold: edge zones = outer 40% of the pane on each axis (top 40% of height for top zone, etc.), overlapping corners resolved by shortest-distance tiebreak; center = the remaining inner ~20% × ~20% rectangle. Plan-phase to lock the percentages against the prototype and Ashley taste.

2. **Live coral-tinted drop-preview overlay tracking the cursor.** Replace the placeholder "Drop to split" static overlay with a rectangle that:
   - Renders at HALF the target pane's dimensions along whichever edge zone the cursor is currently in (e.g. cursor in top zone → overlay is the top half of the pane).
   - Colored coral, matching the palette. Concrete token: reuse or extend `--color-pv-*` warm-coral tokens (`--color-pv-code-orange` = `#ffb896` is the current warm coral; the overlay may want a lower-alpha tint of it, e.g. `oklch(...) / 0.25`). Plan-phase to pick the exact alpha and whether to reuse or extend the token.
   - Updates on every `dragover` (cursor movement inside the pane).
   - Hides when the cursor enters the center dead zone (no drop will happen — no preview).
   - Hides when the drag leaves the pane entirely (flicker fix from Gap a).

3. **Snap-to-nearest-edge feedback while hovering.** The preview always snaps cleanly to the closest edge; there is no in-between state (no "you're kind of on the top-left corner" ambiguous overlay). Cursor in the top-left corner resolves to whichever of top/left is closer by a small margin — the plan-phase decision is which axis dominates in ties (recommend: horizontal edge dominance on exact ties, since horizontal splits feel more natural for the eye's landscape orientation, but plan-phase to validate against the prototype).

4. **Structured logging discipline.** Every dragover-that-changes-zone and every drop gets a `[pv-split-preview]` log line with cursor pos, computed zone, pane rect, and (on drop) the final edge picked. Backfills observability on this new axis per box-maintainer standing directive on logging.

5. **Center-dead-zone drop returns cleanly with no tree change.** The drop event still fires (browsers deliver drop even when there's no visual affordance), but the Pane's drop handler short-circuits before calling `onOpenSessionInTree` / `onDropRowInTree`. Logged as `[pv-split-drop] center-dead-zone ignored`. NO error, NO toast, NO visual "invalid drop" — the shape locks this as silent.

## Explicitly OUT of scope this phase (Phase 58)

- Identity-badge drag as third-gesture (short-click / long-press / press-drag disambiguation).
- Drag-badge-to-conv-list = full close (session teardown + WS lifecycle).
- Rearrangement (moving a session between cells).
- Any changes to badge behavior.
- Any changes to URL encoding, tree data model, or `insertAtEdge` semantics — those are locked from Phase 56.
- Any per-cell resize / draggable dividers (shape §Scope edges deferred).

## Files most likely touched (implementation-side)

Small blast radius — three files, one of them just types/geometry helpers.

- **`src/ui/shell/SplitView.tsx`** (459 lines today) — the `Pane` component (`:140-268`). Replace `isDragOver: boolean` state with `dropPreview: { edge: DropEdge | 'center'; rect: DOMRect } | null` (or similar shape TBD in plan-phase). Rewire the native DOM listeners to compute edge-zone on every `dragover`, guard `dragleave` with the flicker-fix, short-circuit drop on center dead zone. Add the coral overlay div rendered from `dropPreview` state.
- **`src/ui/lib/split-tree.ts`** (300 lines today) — add a new helper `computeEdgeZone(rect, clientX, clientY): DropEdge | 'center'` alongside the existing `computeNearestEdge`. Keep `computeNearestEdge` as-is; it may still be called from the drop path (with the new center-guard in the Pane) or be replaced entirely by `computeEdgeZone` — plan-phase decides. Do NOT change `insertAtEdge` or the tree ops — those are locked.
- **`src/ui/features/pretty-view/pretty-view.css`** (or `src/ui/shell/SplitView.tsx` inline styles) — the coral-overlay CSS. Match the visual language: warm-coral tint, rounded corners consistent with cell chrome (though Phase 56 patch #512 stripped `PaneHeader` chrome, so the pane has clean edges; the overlay's rounding should be minimal or 0 to match).

Files that stay untouched:
- `src/ui/lib/split-tree-url.ts` — URL round-trip is not affected.
- `src/ui/AppShell.tsx` — tree state, portal mount, `onOpenSessionInTree` handlers unchanged. The Pane's drop-handler contract to the outer layer stays identical (`(tabId, path, edge)` — center-dead-zone is handled entirely inside the Pane before calling out).
- `src/ui/features/pretty-view/PrettyView.tsx` — no changes.
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — drag source unchanged.

## Test coverage additions (foreseen — plan-phase locks the exact set)

- `computeEdgeZone` unit tests: 9-point matrix (each corner + each edge midpoint + center) against a 100×100 rect, asserting the expected zone. Plus explicit tests for the corner ties and the center-zone threshold.
- `SplitView.tsx` Pane component test: mount with a mock tree, fire `dragover` events at each zone, assert `dropPreview` state matches; fire `dragleave` while cursor is still inside pane bounds (simulate child-DOM boundary cross), assert overlay stays visible; fire drop in center zone, assert `onOpenSessionInTree` NOT called; fire drop in edge zone, assert called with expected edge.
- Regression: Phase 56 tests continue to pass — `SplitView.test.tsx`, `AppShell.split-tree.test.tsx`, `split-tree.test.ts`, `split-tree-url.test.ts`.

## What would make Phase 57 wrong (checkpoints for /close)

- **The preview lags the cursor.** Overlay must track without perceptible delay. If `dragover` throttles the overlay update (e.g. via rAF batching that visibly stutters), Ashley's promise of "you always know where it will land" is broken.
- **The preview flickers.** The Gap (a) fix must be robust — no flicker when moving across message bubbles / compose box / other portaled PrettyView content. If flicker recurs, the fix pattern was wrong; try the next option in the list above.
- **Center dead zone unclear where its boundaries are.** If Ashley can't tell she's in the center zone (overlay disappears without explanation), she can't intentionally use center-drop as a "cancel" gesture (which shape file confirms IS the intent — the shape says "release does nothing, no drop registered"). Consider: does the overlay need any center-zone visual (e.g. faint cursor-outline "no drop" affordance)? Shape says NO — leave the center as visually inert, matching the "silent" rule. Plan-phase to reconcile.
- **Overlay geometry doesn't match what actually happens on drop.** The coral rectangle must show the ACTUAL post-drop split shape (half the target pane along the chosen edge). If preview shows one thing and drop lands another, the whole feature fails its own promise.
- **Edge selection unpredictable at zone boundaries.** Between edge zones (e.g. cursor on the diagonal between top and right zones), the preview must resolve cleanly to ONE edge with the cursor's tiny movement, not oscillate. This is the plan-phase decision on tiebreak axis + zone geometry.
- **Drop-preview leaks into an unrelated surface.** The overlay is scoped to the Pane's outer div. If a CSS bug (z-index, positioning, portal) causes it to render outside the Pane or persist after the drag ends, it's a regression.
- **Affordance leaks onto mobile.** Shape file locks desktop-only. Mobile widths should not render the preview overlay. (Phase 56 foundation is already desktop-only via existing gates; Phase 57 must not regress this — plan-phase to verify against existing mobile-media-query patterns.)

## Vehicle notes

**Skip discuss-phase** (Phase 53 + 56 precedent). This CONTEXT.md IS the discuss-phase output — the shape file already locked the design, and this doc distills scope + prior context + gaps + files + failure modes for `/gsd:plan-phase`.

**Plan-phase**: expected to produce 2-3 plans, roughly:
- 57-01: Edge-zone hit-testing geometry — `computeEdgeZone` helper + tests. Standalone, pure-function, unit-test-only.
- 57-02: Pane drop-preview overlay — `Pane` component rewire (state shape, native-listener update, coral overlay render, flicker fix, center-dead-zone short-circuit) + component tests.
- 57-03: (optional) Structured-logging backfill + observability polish + any deferred visual tweaks Ashley calls out during plan review.

**Executor scope**: code + commit + scoped tests green (`npx vitest run --related src/ui/shell/SplitView.tsx src/ui/lib/split-tree.ts`). Full-suite + docker build + deploy are orchestrator-only per role directive.

**Rebase risk**: LOW — fork-local pretty-view / split-tree surfaces only; no upstream Skynet surfaces touched. Continuation of the Phase 56 same-file surgeries.

**Parent bounty**: `bring-back-split-view` — this phase is todo #1 on the parent's todo list. Update the parent bounty's timeline on ship.

**Reference prototype**: `~/.claude/roles/box-maintainer/bounties/bring-back-split-view/prototype.html` — the drag-drop interaction model demonstrated there is what Phase 57 makes real inside Skynet. Consult it for the exact edge-zone geometry + preview-overlay visual that Ashley validated live.
