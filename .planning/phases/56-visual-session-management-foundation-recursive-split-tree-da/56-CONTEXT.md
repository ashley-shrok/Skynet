# Phase 56: Visual session management (foundation) — Context

**Gathered:** 2026-08-28
**Status:** Ready for planning
**Source:** Direct-seeded from `.planning/shapes/shape-visual-session-management.md` (produced by `/build` feature-mode `/open` beat). Discuss-phase skipped per `/build` convention when the shape file already captures scope + philosophy + failure modes.

## What this is (foundation-phase scope)

The FIRST of three phases delivering a drag-drop session-management model on the desktop PrettyView side of the Skynet chat surface. This phase does the load-bearing plumbing changes; the two follow-up phases build the visible polish on top.

**In-scope this phase:**

1. **Replace the fixed-grid data model with a recursive tree.** Today `SplitView.tsx` (766 lines, `src/ui/shell/SplitView.tsx`) uses a flat `paneTabIds: (string | null)[]` with mode-specific grid geometry (2-way through 6-way, defined in `src/ui/lib/theme.ts` — `SPLIT_MODES`, `PANE_COUNTS`, per-mode `defaultSizes` switch statement). Retire that model. New model: recursive tree of nodes, either `{kind:'session', tabId}` leaves or `{kind:'split', direction:'horizontal'|'vertical', children:[node, node]}` internal nodes.

2. **Move layout persistence from localStorage to URL.** Retire `localStorage["skynet_splitMode"]` and `localStorage["skynet_paneTabIds"]` in `AppShell.tsx` (lines 242-247, 282-287). URL becomes the source of truth for split-tree layout — refresh, share, tab-clone all reproduce the layout. Any vestigial multi-session URL encoding that predates this phase gets folded into the new tree encoding: multiple sessions in a URL means *and always means* a split arrangement.

3. **Wire conv-list rows to be draggable.** In `PrettyConversationRow.tsx`, add `draggable={true}` and a `dragstart` handler that sets the tab id in `dataTransfer` (`text/plain` payload, matching what `SplitView.tsx`'s existing `onDrop` handler at line 360 already reads). The existing swipe-to-pin + long-press-context-menu + tap-select gestures must coexist unchanged — drag is a new fourth gesture, native browser threshold-based, and does not steal from the others.

4. **First drop into empty PrettyView → session opens.** Dragging a conv-list row and dropping it onto the empty PrettyView area sets the tree root to that session. This is the minimum-viable entry point.

5. **Subsequent drops onto an existing cell → split at nearest edge (minimum-viable geometry).** No drop-preview overlay yet, no dead-center guard yet. Determine nearest edge from drop coordinates, split the target cell at that edge. This is enough to prove the recursive-tree model end-to-end; the polish (edge-zone hit-testing with center-dead-zone, coral preview overlay, snap-to-nearest-edge feedback while hovering) is Phase 57's whole point.

**Explicitly OUT of scope this phase (Phases 57 and 58):**

- Drop-preview overlay showing future split geometry during a drag-over (Phase 57).
- Edge-zone hit-testing with a center dead zone (Phase 57).
- Identity-badge drag as third-gesture-on-badge for rearrangement (Phase 58).
- Drag-badge-to-conv-list = full close (Phase 58).
- Any changes to badge behavior (short-click, long-press) (Phase 58 disambiguates).

## Discovery finding that shapes the estimate

**Split-view infrastructure was never removed** — it's fully implemented in the current codebase, just gated off by defaulting `splitMode` to `"none"` with no UI trigger to change it. Concretely:

- `src/ui/shell/SplitView.tsx` — 766-line component with fixed-grid geometries (2-way through 6-way), resizable dividers (`useSplitSizes`, `splitDragging.ts`), and drop-to-assign handlers already wired (`onDrop` at line 360 reads `tabId` from `dataTransfer` and calls `onAssignPane?.(paneIndex, tabId)`). The `onAssignPane` prop threads through 20+ pane renderers.
- `src/ui/AppShell.tsx` — already declares `const [splitMode, setSplitMode] = useState<SplitMode>(...)` (line 242), `const [paneTabIds, setPaneTabIds] = useState<(string|null)[]>(...)` (line 245), persistence to localStorage (lines 282-287), `splitTabQuick(tabId, mode)` helper (line 1392), `<SplitView tabs={tabs} paneTabIds={paneTabIds} splitMode={splitMode} focusedPaneIndex={focusedPaneIndex} onAssignPane={assignPane} ... />` rendered inside a `display: isSplit ? "flex" : "none"` gate (line 1946).
- **Always-mounted portal architecture** — every tab's DOM tree stays alive whether or not it's visible (`node.style.display = activeInline ? "" : "none"` at line 1542). Moving a session between cells preserves its React tree — no remount, no WS reset. This is the load-bearing engineering piece and it's solved.
- **WS lifecycle is per-tab, independent of visibility** — each `IdentitySessionPane` owns its `PrettyView` which owns its own claude-session WS (per `IdentitySessionPane.tsx:65` comment "Always-mounted: PrettyView is the primary surface for identity panes. It owns its claude-session WS independently of Terminal"). Multi-mount is fine as-is; **do NOT refactor `PrettyView.tsx`** for this phase.

**Consequence for effort:** This is a data-model swap on top of already-working multi-mount infrastructure, not a from-scratch build. The 766-line `SplitView.tsx` shrinks substantially — a large chunk is fixed-grid geometry (`defaultSizes` mode switch, per-mode child-count wiring, resizable dividers) that gets deleted. The `onAssignPane` handler wiring stays but is redirected from "assign to slot N" to "insert into tree at path".

## Prior context: parked bounty + reference prototype

- Parked bounty `bring-back-split-view` (`~/.claude/roles/box-maintainer/bounties/bring-back-split-view/bounty.json`, created 2026-07-31) is the seed for this arc. Ashley's verbatim ask was "bring back split view"; the /build /open beat expanded it into the full drag-drop dream.
- Reference prototype: `~/.claude/roles/box-maintainer/bounties/bring-back-split-view/prototype.html` — standalone HTML+JS prototype demonstrating the drag-drop tree, edge-zone hit-testing, and preview overlay. Ashley validated it live 2026-08-28. The recursive-tree algorithm (in vanilla JS in the prototype) ports directly to the phase; the drop-preview overlay + edge-zone hit-testing pieces are Phase 57's job.

## Locked decisions (Ashley, 2026-08-28)

- **Full dream, no minimal restoration.** Retire the fixed-grid model entirely; do not keep the 2-way / 3-way / 4-way presets as convenience.
- **No preset layouts.** Drag IS the fast path. No "give me a 4-way immediately" button.
- **No draggable pane dividers.** All splits are constant-ratio (50/50 at each split). Every cell holds the same shape of thing (a session), so a window-manager knob would over-engineer the affordance.
- **URL as source of truth for layout persistence.** Retire localStorage split state. Fold whatever vestigial multi-session URL encoding exists today into the new tree encoding — going forward, multi-session in URL means and always means split.
- **Center of a cell is a dead zone.** Center-drop does nothing (no replace, no swap, no no-op-with-visual-feedback — just: release does nothing, no drop registered). The only close path is drag-badge-back-to-conv-list, which is Phase 58's affordance.
- **Foundation phase's minimum viable geometry: nearest-edge snap on any drop position.** No edge-zone hit-test yet, no center dead zone yet — those are Phase 57. For foundation, any drop inside a cell picks the closest edge and splits there. Cheap heuristic that gets the tree exercising end-to-end.

## Philosophy (from the shape file, applies to Phase 56 too)

- **Drag is the language.** The interaction is the entire feature; no menus, no mode-switches, no preset picker.
- **The URL is the layout.** If the URL doesn't hold the arrangement, the arrangement doesn't really exist.
- **There is exactly one close path** (badge-to-conv-list, Phase 58). Phase 56 doesn't ship any close affordance — the existing `useKeyboardCloseTab` keyboard shortcut stays as the only way to close a tab until Phase 58 adds the visible drag path.

## What would make Phase 56 wrong

- **The URL becomes an unreadable soup.** The tree encoding needs to be compact enough to survive real-world URL length limits and legible enough that a debugger can read what layout a link encodes.
- **A saved URL layout silently breaks on reload** because it references sessions that no longer exist or references tab ids Skynet no longer honors. Degradation must be graceful: drop missing sessions from the layout, keep valid ones, never blank-screen.
- **Moving a session between cells destroys its state.** The always-mounted portal architecture in AppShell.tsx (lines 1490-1550, DOM-placement effect) must survive the tree refactor. If a rearrange behaves like a close-and-reopen, the phase has failed even before Phase 58's badge-drag lands.
- **Conv-list drag steals from an existing gesture.** Row swipe-to-pin, row long-press-context-menu, row tap-select all must coexist unchanged. Native HTML5 drag threshold-based disambiguation is expected to handle this, but the wiring must not intercept `pointerdown` in a way that breaks the others.
- **Persistence race on first load.** The URL-restore path in AppShell needs to hydrate the tree BEFORE first render, or a brief mispaint of the "no split" default state will happen. Phase 55's URL-restore precedent (persisted-restore + URL-driven-open pass, lines 761-777 of AppShell.tsx) is the reference pattern.

## Files most likely touched (implementation-side)

- `src/ui/shell/SplitView.tsx` — largest surgery. Delete fixed-grid geometry; add recursive-tree renderer. Existing `onDrop` handler stays but redirects to tree-insert not slot-assign.
- `src/ui/AppShell.tsx` — retire localStorage split state; add URL split-tree state hook; wire tree-insert handler.
- `src/ui/lib/theme.ts` — remove `SPLIT_MODES`, `PANE_COUNTS`, per-mode `defaultSizes` (or narrow to the new tree model).
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — add `draggable={true}` and dragstart handler. Existing gesture handlers stay.
- `src/ui/types/ui-types.ts` — `SplitMode` type retired or refactored to tree-shape type.
- URL-encoding helpers — likely a new module under `src/ui/lib/` for tree ↔ URL round-trip. Reference: URL encoding today lives in AppShell.tsx URL-restore paths (search `hash` / `URLSearchParams` in AppShell.tsx).

## Files NOT touched this phase

- `src/ui/features/pretty-view/PrettyView.tsx` — already parameterized by `hostId` + `tmuxSession`; multi-mount works today. Do NOT refactor.
- `src/ui/features/terminal/IdentityBadge.tsx` — Phase 58's territory (badge drag).
- Backend — this is a pure frontend layout change; no wire types touched.

## Reference material

- Shape file: `.planning/shapes/shape-visual-session-management.md` — the arc-wide agreement.
- Prototype: `~/.claude/roles/box-maintainer/bounties/bring-back-split-view/prototype.html` — served on `100.99.149.8:8899/prototype.html` during design. Ports directly for tree algorithm; drop-preview polish is Phase 57.
- Parked bounty: `~/.claude/roles/box-maintainer/bounties/bring-back-split-view/bounty.json`.
