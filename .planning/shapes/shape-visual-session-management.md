# Shape: Visual Session Management

**Opened:** 2026-08-28
**Vehicle:** GSD phase — three phases (foundation → drop-preview → badge-drag)

## What this is

Making the PrettyView side of the desktop layout hold multiple sessions at once, arranged in a free-form split tree that Ashley composes by dragging. Sessions come *in* from the conversation list — drag a row into any part of the PrettyView area (its empty state, or an edge of an existing cell to split at that edge). Sessions come *out* by dragging their identity badge back to the conversation list, which fully closes the session. Sessions get rearranged by dragging their identity badge onto a different cell's edge. The whole arrangement lives in the URL so it survives refresh, tab clone, and link sharing.

## Shape

Two panes side-by-side on desktop as today — conversation list on the left, PrettyView on the right. Nothing about that top-level split changes. What changes is that the PrettyView area becomes a **container for a recursive split tree of open sessions**, not a container for a single session at a time.

The tree is built by drops:

- **Drop onto an empty PrettyView.** The whole area becomes that one session.
- **Drop onto an edge of an existing cell.** That cell splits — the new session goes on the side you dropped, the existing session stays on the other. Which edge (top/bottom/left/right) picks the split direction and the new session's position.
- **Drop onto the center of an existing cell.** Nothing happens. The center is a dead zone by design so there is only one path to closing a session.

There is a live drop-preview overlay while a drag is over any cell. The overlay is a coral-tinted rectangle showing exactly where the future session will land if you release right now — half the target cell along whichever edge you're closest to. Move the cursor, the preview moves with it. Snap-to-nearest-edge means anywhere in a cell that isn't dead center always shows a valid drop.

Sessions in the tree are movable via their **identity badge**. The badge already has two jobs today — short click opens a modal, long-press swaps to terminal view — and this gains a third: **press-and-drag rearranges**. Native HTML5 drag disambiguates press-and-move from press-alone, so the three coexist without a mode-switch. A dragged badge behaves exactly like a dragged conv-list row — same drop-preview, same edge zones, same tree edits.

- **Drop a badge on another cell's edge** → the session moves to that new position, the tree re-hangs, and any resulting empty splits collapse cleanly.
- **Drop a badge back onto the conversation list** → the session **fully closes**. WebSocket torn down, tab removed from the tabs array. This is the only close affordance; there is no dead-center replace, no button, no keyboard shortcut needed for close.

The tree is encoded in the URL. Refresh, share the link, clone the tab — the layout comes back. Any localStorage-based split state is retired. Whatever vestigial multi-session URL encoding exists today gets subsumed into the split-tree encoding — going forward, multiple sessions in a URL means *and always means* a split arrangement.

## Philosophy

- **Drag is the language.** Everything about arranging your workspace is a drag — no menus, no mode-switches, no preset picker. The interaction *is* the entire feature; if it doesn't feel fast and fluid, the feature has failed.
- **No presets, no shortcuts, no window-manager knobs.** Every cell holds the same shape of thing (a session), so the constant-ratio splits from drops are enough. There is deliberately no divider-drag-to-resize, no "give me a 4-way immediately" button, no "swap two cells" affordance. If you want a different arrangement, drag your way there.
- **There is exactly one close path.** Drag the badge back to the conv list. Any other proposed close mechanism (dead-center replace, close-button-per-cell, keyboard shortcut with visible UI) violates the spirit — the drag *is* the close.
- **The URL is the layout.** If the URL doesn't hold the arrangement, the arrangement doesn't really exist. This is what makes "share your current view with future-you-across-devices" work.

## Prior context

- The parked bounty `bring-back-split-view` (2026-07-31) was Ashley's original ask. This is that bounty, expanded into the full interaction model.
- Split-view infrastructure is **already in the codebase**, currently gated off — a full 766-line `SplitView` component with fixed-grid geometries (2-way through 6-way), resizable dividers, per-tab always-mounted portal architecture, WS-per-tab lifecycle, and drop-tab-into-pane handlers already wired. What was removed was the UI trigger to turn it on, not the mechanism.
- The always-mounted portal architecture means every session's DOM tree stays alive whether or not it's visible, and moving a session between cells preserves its running React tree — no remount, no WS interruption. This is the load-bearing engineering piece; it was solved for the fixed-grid version and carries directly to the free-form tree.
- Persistence today uses localStorage (`skynet_splitMode`, `skynet_paneTabIds`), which is being retired in favor of URL-encoded layout.
- Identity badges today have two behaviors — short click opens a modal, long-press swaps to terminal view. Adding drag as a third gesture is a real interaction-design decision that the codebase must accommodate.
- There is no user-visible close-session affordance today; the close-tab function exists internally (called by a keyboard shortcut), but nothing user-visible triggers it. Drag-to-list becomes the new visible trigger.
- Reference prototype: `~/.claude/roles/box-maintainer/bounties/bring-back-split-view/prototype.html` — the drag-and-drop interaction model that this shape describes was validated live against that page.

## What would make it wrong

- **The drag feels laggy or the preview jumps.** The whole feature depends on the drop-preview being accurate and responsive. If Ashley has to wonder where the session will actually land, the interaction is broken.
- **Session state gets destroyed by a rearrange.** Moving a session between cells must preserve its React tree, its WebSocket, its scroll position, its compose-box draft. If a rearrange behaves like a close-and-reopen, the feature has missed the point.
- **A misclick or accidental drag closes a session unintentionally.** Full close on drag-to-list is the intended path — but it must require a genuine drag gesture, not a slightly-too-vigorous badge click. If the click-vs-drag disambiguation lets a stationary press fall through to "started a drag then dropped it," the feature is destructive in a way that violates the "one close path" philosophy.
- **The URL becomes an unreadable soup.** The tree needs a serialization compact enough to survive real-world URL length limits and legible enough that a debugger can read what layout a link encodes.
- **The split cells look substantially different from a non-split PrettyView.** A session in a cell should feel like the same PrettyView, just smaller. If the presence of siblings changes bubble padding, header sizing, or compose-box behavior, the surface has been split cosmetically as well as structurally, which is not the intent.
- **The affordance leaks onto mobile.** The whole thing is desktop-only. On mobile widths, split state should either collapse cleanly to whichever cell is focused, or not activate at all — but never render broken.
- **A dropped-into-URL layout silently breaks** because it references sessions that no longer exist. Reloading a saved URL to a stale layout should degrade gracefully (drop missing sessions, keep valid ones) rather than blank-screen.

## Scope edges

- **In:** the recursive split-tree data model; drop-preview overlay with edge-zone hit-testing; conv-list-row-drag → open-into-tree; badge-drag → rearrange-in-tree; badge-drag-to-list → full close; URL as layout persistence; retiring the localStorage split state; retiring vestigial multi-session URL encoding by folding it into the tree encoding.
- **Out:** draggable pane dividers (constant-ratio splits only); one-click preset layouts (2-way, 3-way, etc.); center-of-cell drop actions; new keyboard shortcuts for the split-tree; touch/gesture-driven layout on mobile (desktop only).
- **Deferred:** possible per-cell resize gesture later if constant-ratio starts to bite; possible layout-save-with-a-name later if URL-encoded proves insufficient; possible cross-device layout sync later.
- **Tempting-but-no:** persisting layout to a per-user preference in the backend; a "split-view" panel or menu with a mode picker; a dedicated close button on each cell.

## Vehicle notes

Three GSD phases, sequential, each UAT-verifiable as its own layer:

1. **Foundation.** Replace the flat fixed-grid data model with the recursive tree. URL becomes the source of truth; retire the localStorage split state. Retire whatever vestigial multi-session URL encoding exists today; fold it into the new tree encoding. Wire conv-list rows to be draggable and carry their tab id in `dataTransfer`. First-drop-into-empty-PrettyView works. Subsequent drops split at nearest edge as a temporary minimum-viable geometry — no drop-preview overlay yet, no dead-center guard yet. Ends the phase with a working split view driven by URL.
2. **Drop-preview.** Add the four edge zones with center-as-dead-zone. Add the coral hover-preview overlay showing the future split geometry. Snap-to-nearest-edge for any position that isn't dead center. The interaction becomes what the prototype demonstrated.
3. **Badge-drag.** Add the third gesture on the identity badge — press-and-drag rearranges. Coexist with the existing short-click-opens-modal and long-press-swaps-to-terminal gestures. Route badge drops through the same handler as conv-list-row drops. Wire drag-badge-to-conv-list to the internal close-tab function (full close).

**Handoff notes for the implementing agent:**

- Working directory: `/home/ubuntu/skynet-tanya` on branch `feat/tab-title-from-tmux`. Repo is the Skynet fork; deployment is single-image Docker on `t1000` via `/opt/skynet/`.
- Identity: `tanya` under role `box-maintainer`.
- Existing infrastructure to gut/adapt:
  - `src/ui/shell/SplitView.tsx` (766 lines) — fixed-grid geometry gets replaced by tree geometry.
  - `src/ui/lib/theme.ts` (`SPLIT_MODES`, `PANE_COUNTS`, per-mode default-sizes) — retired.
  - `src/ui/AppShell.tsx` `skynet_splitMode` + `skynet_paneTabIds` localStorage keys — retired.
- PrettyView surface at `src/ui/features/pretty-view/PrettyView.tsx` — already parameterized by `hostId` + `tmuxSession`, so multi-mount is fine as-is. Do NOT refactor this surface as part of this arc.
- Tab lifecycle in `AppShell.tsx` — `tabs`, `activeTabId`, `useKeyboardCloseTab` (source of the internal close-tab function that badge-drag-to-list will call).
- Reference prototype at `~/.claude/roles/box-maintainer/bounties/bring-back-split-view/prototype.html`.

`/close` at the end verifies conformance both ways: every feature in this shape must be present in the built result, and any behavior in the built result that is not in this shape gets called out.
