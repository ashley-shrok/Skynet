# Phase 58: Identity-badge drag as third gesture + drag-badge-to-conv-list = full close — Context

**Gathered:** 2026-08-28
**Status:** Ready for planning
**Source:** Direct-seeded from `.planning/shapes/shape-visual-session-management.md` §Vehicle Phase 3, plus Ashley's Phase 57 UAT observation (2026-08-28) that "trying to drag the identity badges to move stuff around or put the sessions back in the conversation list neither of those things seem to work" — which is Phase 58's whole point, not a Phase 57 regression. Discuss-phase skipped per `/build` convention when the shape file already captures scope + philosophy + failure modes (precedent: Phase 53, Phase 56, Phase 57).

## What this is

The THIRD and FINAL phase of the `bring-back-split-view` arc. Phase 56 shipped the recursive split-tree foundation with conv-list rows as the sole drag source. Phase 57 shipped the drop-preview overlay + edge-zone hit-testing that makes drop targets predictable. Phase 58 completes the arc by making the **identity badge** the second drag source: **press-and-drag rearranges sessions between Pane cells**, and **dragging a badge back onto the conversation list closes the session**. After this ships, the parent bounty `bring-back-split-view` closes.

**Shape file quote (§Vehicle Phase 3, verbatim):**

> **Badge-drag.** Add the third gesture on the identity badge — press-and-drag rearranges. Coexist with the existing short-click-opens-modal and long-press-swaps-to-terminal gestures. Route badge drops through the same handler as conv-list-row drops. Wire drag-badge-to-conv-list to the internal close-tab function (full close).

**Shape file philosophy that shapes this phase (§Shape para 5-6):**

- **"Sessions in the tree are movable via their identity badge.** The badge already has two jobs today — short click opens a modal, long-press swaps to terminal view — and this gains a third: press-and-drag rearranges. Native HTML5 drag disambiguates press-and-move from press-alone, so the three coexist without a mode-switch."
- **"Drop a badge on another cell's edge → the session moves to that new position, the tree re-hangs, and any resulting empty splits collapse cleanly."**
- **"Drop a badge back onto the conversation list → the session fully closes. WebSocket torn down, tab removed from the tabs array. This is the only close affordance; there is no dead-center replace, no button, no keyboard shortcut needed for close."**

## Discovery findings that make the estimate small

Two significant discoveries during Phase 58 CONTEXT gathering (2026-08-28):

**Discovery 1: `openSessionInTree` already handles the rearrange case for free.** `src/ui/AppShell.tsx:1555` (from Phase 56 Plan 02) has this comment block verbatim:

> *openSessionInTree is the single drop handler for both first-drop-into-empty and drop-onto-existing-cell paths. `removeLeaf-then-insertAtEdge` handles both "add a session that isn't in the tree" and "move a session that's already somewhere in the tree to a new position" uniformly:*
> - *If the session isn't in the tree, `removeLeaf` is a no-op (Object.is on input === output holds true) and `insertAtEdge` plants it.*
> - *If the session is already in the tree, `removeLeaf` collapses the source cell and `insertAtEdge` splits the target cell — same net effect as a move.*

Phase 56 already implemented the tree machinery for badge-drag rearrange. `removeLeaf` at `src/ui/lib/split-tree.ts:249` collapses source, `insertAtEdge` at `:127` plants at target. Phase 58's Pane drop path DOES NOT need any tree-logic changes — it just needs the badge to be a drag source with the same payload shape the Pane already reads via `openSessionInTree`.

**Discovery 2: Conv-list currently has NO drop handlers.** `grep -n "onDrop\|onDragOver\|onDragEnter" src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` returns zero matches. Row-level handlers exist (drag-source at `PrettyConversationRow.tsx:927`), but the panel-container itself does not accept drops today. Phase 58 adds the FIRST panel-level drop handler.

**Consequence for effort:** This is the smallest phase in the arc. Plan 58-01 = badge drag source (one file + component test). Plan 58-02 = conv-list panel drop target (one file + test) + belt-and-suspenders integration test that badge drop on Pane routes through the existing rearrange machinery correctly (assertion, not new code — the rearrange path is already wired).

## In-scope this phase

1. **Identity badge as drag source (Plan 58-01).** In `src/ui/features/terminal/IdentityBadge.tsx` (197 lines), flip `draggable={false}` at :90 to `draggable={true}` and add an `onDragStart` handler that carries the badge's tab id in `dataTransfer`. The tab id source: **IdentityBadge does not currently know its own tab id — it takes `identity` + gesture callbacks but not `tabId`**. Plumb the tabId prop through from the badge's parent render site(s) — the badge lives in Terminal/PrettyView/etc. surfaces that are mounted per-tab, so their `tab.id` is already in scope. Plan-phase locks the exact prop name (recommend `tabId?: string` — optional so any non-tab context that renders a badge continues to work without dragging; when absent, `draggable={false}` is the safe default).

2. **Badge dataTransfer payload contract (Plan 58-01).** Set **BOTH** MIME types on `dragstart`:
   - `text/plain: tabId` — matches Phase 56's Pane onDrop contract (the plain-text branch at `SplitView.tsx:340-355`), which routes to `openSessionInTree(tabId, path, edge)` and does the rearrange via `removeLeaf-then-insertAtEdge`.
   - `application/x-skynet-badge: JSON.stringify({tabId})` — a NEW MIME distinct from Phase 56's `application/x-skynet-row`. This is what the conv-list drop target reads to distinguish badge drops (which close) from stray row drags (which would be nonsensical to close on). Mirrors the `application/x-skynet-row` naming convention Phase 56 patch #511 established. Payload minimal: just `{tabId}`. Do NOT reuse `application/x-skynet-row` for badge drops — semantically wrong (a badge is not a row) and if the payload were ever misparsed with `fleetOnly: false`, the row-drop path's fleet-only fallback might do something surprising.
   - `effectAllowed: "move"` — matches conv-list row convention.

3. **Native HTML5 drag threshold disambiguates from click + long-press for free (Plan 58-01).** The existing conv-list row precedent (`PrettyConversationRow.tsx:920`) documents this verbatim: *"Browser's built-in drag threshold (~5px on desktop, long-press-and-move on touch) is the disambiguation mechanism — no manual dx/dy gate is needed."* The badge's existing short-click (`onClick`) and long-press (`onLongPress` via 500ms `pointerdown` timer + `longPressFiredRef` gate at :90-159) both work at the pointerdown/up level below the drag threshold — HTML5 drag fires only when the cursor moves past ~5px while pointer is down. Coexist cleanly with no explicit disambiguation code needed.

4. **Conv-list panel as drop target for badge close (Plan 58-02).** In `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`, add container-level `onDragOver` (preventDefault to permit drop + type-gate on `application/x-skynet-badge`) and `onDrop` (read the badge payload, parse tabId, call `closeTab(tabId)` — the internal function at `src/ui/AppShell.tsx:1520` reached via a prop or via a callback the parent passes down). NON-badge drops (row drags landing back on the conv-list — nonsensical, but defensively handled) fall through without action.

5. **`closeTab` prop plumb (Plan 58-02).** `closeTab` lives in AppShell (`:1520`) and takes a tab id. It handles the confirmation-dialog preference internally. `PrettyConversationsPanel` needs to receive it as a prop (mirror pattern for how `PrettyConversationsPanel` receives other AppShell-owned callbacks today — grep the existing props signature and add `onCloseSession(tabId: string)` alongside).

6. **Structured logging discipline** (per box-maintainer standing directive Ashley 2026-08-11). New prefix `[badge-drag]` for the badge dragstart log line; `[convlist-drop]` for the conv-list drop close log line. Format: `[badge-drag] tabId=<x> hasIdentity=<bool>` on dragstart, `[convlist-drop] close tabId=<x>` on drop-close. Zone-change logs already emit from Phase 57's Pane (`[pv-split-preview]`) — no changes there.

## Explicitly OUT of scope this phase

- Any changes to `openSessionInTree` / `removeLeaf` / `insertAtEdge` — the rearrange path is ALREADY wired from Phase 56 and works as-is when a payload matching Phase 56's Pane contract fires from a new source.
- Any changes to the Phase 57 Pane drop-preview overlay or edge-zone hit-testing — Phase 58 badge drops go through the exact same Pane drop machinery; no new overlay per source needed.
- Any changes to URL encoding / tree data model.
- Any changes to the badge's existing `onClick` / `onLongPress` gesture callbacks or the `longPressFiredRef` disambiguation — those keep working because HTML5 drag fires only when the cursor crosses the drag-threshold while pointer is down, which the click + long-press paths never trigger.
- Rearrange animation (drag-with-content-follows) — Phase 58 uses the native browser drag ghost only. If Ashley later wants a custom drag-preview showing the whole session mini-thumbnail, that's a follow-up phase.
- Any confirm-before-close prompt specific to badge drag — reuse the existing `localStorage["confirmTabClose"]` preference respected by `closeTab` at `AppShell.tsx:1520`. If she wants badge-drag to bypass the confirm (since a deliberate drag-and-drop IS the confirmation), that's a plan-phase decision worth flagging — Ashley's rule of thumb was "the drag IS the confirmation" (shape file philosophy §3).

## Edge cases the plan MUST cover

1. **Badge dragged onto its own Pane's edge in a multi-session tree.** Source path prefix and target path prefix collide. `removeLeaf` collapses source (sibling promoted into parent slot, path indices shift), then `insertAtEdge` splits target at the possibly-relocated path. The `openSessionInTree` comment at AppShell.tsx:1555 explicitly says this pattern works uniformly — but the code path deserves an integration test proving it (assertion: tree shape mutates predictably, no orphaned leaf, no thrown error).

2. **Badge dragged onto its own Pane in a single-session tree.** Only one session in the tree; user drags its badge back onto its own Pane. `removeLeaf(root, tabId)` returns null (removed the root). `insertAtEdge(null, [], leaf, edge)` returns `leaf` verbatim (Phase 56's "first drop into empty layout" branch). Net effect: tree unchanged (still that one session as root). Benign no-op — no error, no visual change. Assert this with a test.

3. **Badge dragged onto the conv-list in a single-session tree.** Tab closes. `closeTab(tabId)` → `doCloseTab` → tab removed from `tabs[]`. The tree still holds a stale `leaf(tabId)` at root until AppShell reconciles — check how Phase 56 handled this reconcile (search for post-`closeTab` tree cleanup logic; may already exist, may need a `removeLeaf` call added inside `doCloseTab`). If it doesn't already exist, add it — otherwise the URL would encode a stale leaf and the layout would reference a torn-down session. Plan-phase to verify this reconcile path.

4. **Badge dragged onto the center-dead-zone of ANOTHER Pane.** Phase 57's center-dead-zone short-circuit fires (Pane's onDrop returns silently before calling `openSessionInTree`). Result: nothing happens — the badge drag is cancelled visually. Correct per Phase 57 shape. Assert with a test.

5. **Badge dragged onto empty PrettyView area (no split-tree, just the "drop to open" empty state).** Currently the empty PrettyView is a drop target for conv-list rows (from Phase 56). Same payload contract (text/plain: tabId) means badge drops there will hit the same handler and plant the tab as root. But the tab is ALREADY in the tree as root of a single-session tree. So this is the same case as edge case #2 — benign no-op.

6. **Multi-select / modifier keys during drag.** Out of scope this phase — no shift-click-multi-select, no ctrl-drag-copy semantics. HTML5 drag defaults apply.

## Files most likely touched (implementation-side)

Small blast radius — 4 files.

- **`src/ui/features/terminal/IdentityBadge.tsx`** (197 lines today) — flip `draggable={false}` → `draggable={true}` when a `tabId` prop is supplied; add `onDragStart` handler with the dual-MIME payload. Add `tabId?: string` prop to the interface. All existing click + long-press behavior preserved verbatim.
- **`src/ui/features/terminal/IdentityBadge.test.tsx`** — extend with 3-5 new tests: dragstart with tabId sets both MIME types, dragstart without tabId is a no-op (draggable=false), existing click + long-press tests continue to pass (regression), long-press-and-move does NOT fire the click callback (existing) AND does fire dragstart if pointerdown-then-drag-threshold-crossed (new).
- **`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`** — add container-level `onDragOver` + `onDrop` handlers on the panel's outermost DOM element. Add `onCloseSession(tabId: string)` prop to the interface. Route badge drops to it.
- **Some test file for the conv-list panel** — likely add to an existing PrettyConversationsPanel test or create a new drop-target test file. 3-5 tests: badge drop closes the tab, row drag does NOT close (defensive), dragover with no badge payload does NOT preventDefault (so it doesn't accidentally capture unrelated drags).
- **`src/ui/AppShell.tsx`** — plumb `closeTab` down to `<PrettyConversationsPanel closeTab={closeTab} .../>` render site as `onCloseSession={closeTab}` prop. Verify (or add) that `doCloseTab` also calls `setSplitTree(removeLeaf(splitTree, id))` so a closed session doesn't leave a stale leaf in the tree — this is edge case #3's reconcile.

Files that stay untouched:
- `src/ui/lib/split-tree.ts` — `removeLeaf`, `insertAtEdge`, `openSessionInTree` machinery all reused as-is.
- `src/ui/lib/split-tree-url.ts` — URL encoding unaffected.
- `src/ui/shell/SplitView.tsx` — Pane drop handler unchanged; badge drops route through the existing `text/plain` branch.
- `src/ui/features/pretty-view/PrettyView.tsx` — no changes.
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — row drag source unchanged.

## Test coverage additions (foreseen — plan-phase locks the exact set)

Plan 58-01 (IdentityBadge):
- Test A: dragstart with tabId sets both MIME types (assert both `text/plain` + `application/x-skynet-badge` are set, payload shapes correct).
- Test B: dragstart WITHOUT tabId is not fireable (draggable=false when tabId is undefined).
- Test C: existing click callback still fires on short-click after Phase 58 changes (regression).
- Test D: existing long-press callback still fires on 500ms pointerdown (regression).
- Test E: `[badge-drag] tabId=... hasIdentity=...` structured log emits on dragstart.

Plan 58-02 (Conv-list panel drop target + AppShell plumbing):
- Test A: badge drop on conv-list panel calls `onCloseSession(tabId)` with the payload tab id.
- Test B: row drag (application/x-skynet-row payload) on conv-list panel does NOT call `onCloseSession`.
- Test C: drop with only text/plain (ambiguous) does NOT call `onCloseSession` (requires the explicit `application/x-skynet-badge` marker — belt-and-suspenders against future rich-payload sources).
- Test D: dragover on conv-list panel preventDefaults ONLY when the drag types include `application/x-skynet-badge` (otherwise doesn't capture unrelated drags).
- Test E: badge drop on ANOTHER Pane routes through `openSessionInTree` correctly — this is an AppShell integration test that mounts SplitView + AppShell, dispatches a badge dragstart from Pane A's badge, then a drop on Pane B's edge, then asserts the tree reshaped to reflect the move (source cell collapsed, target cell split). This is the load-bearing "rearrange" assertion.
- Test F: `[convlist-drop] close tabId=<x>` structured log emits.
- Test G: after `closeTab(tabId)` fires, if the tab was in `splitTree`, `splitTree` is reconciled via `removeLeaf` (either an existing reconcile fires OR Plan 58-02 adds one — plan decides).

## What would make Phase 58 wrong (checkpoints for /close)

- **Long-press or short-click stops working after badge is draggable.** HTML5 drag threshold is supposed to disambiguate, but if the executor accidentally intercepts pointerdown in a way that pre-empts the existing gestures, this would regress. Test C + D are the guard.
- **A stationary press-and-release accidentally triggers a drag-and-close.** The shape file explicitly warns against this: *"A misclick or accidental drag closes a session unintentionally. Full close on drag-to-list is the intended path — but it must require a genuine drag gesture, not a slightly-too-vigorous badge click."* Native HTML5 drag threshold (~5px) is the guard. If the drag threshold is being bypassed somehow (custom drag layer, gesture library), it's wrong.
- **Session state destroyed by rearrange.** Shape file §Failure mode: *"Moving a session between cells must preserve its React tree, its WebSocket, its scroll position, its compose-box draft."* Phase 56's always-mounted portal architecture guarantees this — the tree edit only re-hangs which Pane hosts which tab's portal-target div; the tab's actual DOM subtree is portaled and preserves state across the reparent. If a rearrange somehow re-mounts the tab (WS reconnect, PrettyView remount), the portal architecture was violated.
- **Badge drop on conv-list closes ALL open tabs or wrong tab.** The payload must uniquely identify ONE tab. Test A asserts this.
- **Row drag accidentally closes a tab on conv-list drop.** Test B asserts this — MIME type discrimination is the guard.
- **Stale leaf in `splitTree` after `closeTab` fires.** Edge case #3 — if `doCloseTab` doesn't call `removeLeaf` on the tree, URL-encoded layout would reference a torn-down session. Test G asserts the reconcile fires.
- **Badge drag on mobile causes issues.** Phase 57 confirmed SplitView is desktop-only via AppShell.tsx:2372's `{!isMobile && (<SplitView …/>)}` gate. The badge itself is rendered in mobile too (on Terminal / PrettyView surfaces), but on mobile there's no split-tree to rearrange into. Plan-phase to confirm: does mobile need to disable badge draggable entirely (to prevent confused UX where a long-press-and-move does nothing useful)? Recommend: `draggable={!isMobile}` at the badge level to match the split-view mount gate. Simplest safe path.

## Vehicle notes

**Skip discuss-phase** (Phase 53 + 56 + 57 precedent). This CONTEXT.md IS the discuss-phase output.

**Plan-phase**: expected to produce 2 plans, roughly:
- 58-01: IdentityBadge drag source — draggable=true + dragstart handler + payload + tabId prop + tests. Standalone.
- 58-02: Conv-list panel drop target + AppShell closeTab plumb + doCloseTab tree reconcile + integration test that badge-drop-on-Pane-edge rearranges via existing openSessionInTree. Depends on 58-01.

**Executor scope**: code + commit + scoped tests green. Full-suite + docker build + deploy are orchestrator-only per role directive.

**Rebase risk**: LOW — fork-local surfaces only. `IdentityBadge.tsx` sees cross-fleet activity but Phase 58's changes are additive (new prop + new handler). `PrettyConversationsPanel.tsx` sees moderate cross-fleet activity; new drop handlers at the container level are additive too. `AppShell.tsx` sees heavy cross-fleet activity — the only touch is a one-line prop plumb + potentially a one-line `removeLeaf` call inside `doCloseTab`. Coordinate at ship time.

**Parent bounty**: `bring-back-split-view` — Phase 58 is todo #2 on the parent's todo list. On ship, the bounty CLOSES (status → done, archive).

**Reference prototype**: `~/.claude/roles/box-maintainer/bounties/bring-back-split-view/prototype.html` — the badge-drag interaction model demonstrated there is what Phase 58 makes real. Consult for the exact drag-close-on-list-drop mechanic Ashley validated live.
