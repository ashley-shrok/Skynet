# Shape: Add "Move to project" to the row context menu

**Opened:** 2026-09-23
**Vehicle:** inline (with harness task tracking)

## What this is

Today the only way to put a conversation into a project is to drag its sidebar
row onto a project section. That fails when there's no usable drag surface
(mobile is the load-bearing case) or when the target project is scrolled off
the visible sidebar. This shape adds a "Move to project" affordance to the
row's context menu — the same menu already opened by desktop right-click and
mobile long-press — so a user with no drag capability can put a conversation
into any project, and take it out again, from the menu alone. The context-menu
path lands in exactly the same place the drop path lands: same routing between
identity rows and relay-room rows, same refusal for RDP rows, same "null clears
the assignment" semantic. The drop path is left entirely untouched.

## Shape

A new item titled "Move to project" appears in the row's context menu,
positioned between "Open in new window" and the destructive group (Kill then
Archive in current order). Final menu order: Pin ・ Open in new window ・
Move to project ・ Kill ・ Archive. The item shows a right-pointing chevron
at its right edge to signal that it drills into a submenu.

Tapping or clicking the parent item swaps the menu's content in place with a
child submenu — a drill-in transition, the same interaction model on desktop
and mobile. There is no hover-to-open on desktop; entering the submenu requires
an explicit click or tap. The swap is instant, with no animation.

The submenu's top row is a back affordance labeled "‹ Back". Tapping it swaps
the outer menu content back in. Tapping anywhere outside the menu dismisses the
whole thing, not just the submenu — there is only one dismiss level.

Below the back row, the submenu lists every project. The list appears in the
same order the sidebar uses for its project sections, so the mental map is
consistent. The project the row is currently in (if any) is marked with a
checkmark on the left of its label. Long project names truncate with ellipsis
at the same max-width the outer menu uses; the submenu inherits the outer
menu's height constraint and scrolls internally when the list is longer than
that height allows.

Below the project list, when the row is currently in a project, a "Remove from
project" entry appears. When the row is not in any project, that entry is
hidden entirely — not shown greyed-out.

Picking a project or picking "Remove from project" closes the whole menu
immediately, just like Pin, Archive, and Kill do today. The move is silent —
no toast, no undo affordance, no confirmation dialog. Tapping the row's
currently-assigned project is a silent no-op: the menu closes, no setter fires.

The entire "Move to project" parent item is hidden entirely — not greyed — in
two cases: on RDP rows (which cannot be project members), and when there are
zero projects in the fleet (nothing to pick).

## Philosophy

This affordance is the mobile-accessible peer of the drag path, not a
replacement for it. Drag continues to work exactly as it does today — no
visual changes, no code changes, no "while we're in there" tweaks. The
context-menu path lands in the same underlying state setters (the identity-vs-
relay-room routing, the RDP refusal, the null-clears semantic), so a
conversation moved by menu is indistinguishable from one moved by drop.

Consistency of interaction over cross-platform polish. Drill-in on both
desktop and mobile keeps one mental model, one code path, one thing to test;
adding a side-layer submenu paradigm on desktop just because desktop can do
hover would double the machinery for a menu that has been flat-list since
forever. Similarly, no animation and no first-time onboarding: match how the
rest of the row context menu behaves today.

Hidden over disabled. Affordances that don't apply in the current state
disappear rather than show greyed. This matches how the flat menu already
handles pin-vs-unpin (one or the other appears, never both greyed). Users
never see dead items.

Silence over confirmation. Moving a conversation between projects is trivially
reversible (open the menu again, move it back). Toasts and confirmations
belong to destructive or irreversible actions; moving to a project is neither.

## Prior context

The row context menu already exists: a portal-mounted flat button list, opened
by desktop right-click on a row and by a 500 ms long-press on mobile. Its
current entries are Pin/Unpin, Open in new window, Kill, and Archive. The
menu has no submenu machinery today; adding drill-in is new surface built
inside the existing component.

The drop path already handles the routing: dropping a row on a project section
dispatches setSessionProject for identity rows or setRelayRoomProject for
relay-room rows, and both setters accept null as the assignment-clearing
value. RDP rows are refused as project members by the drop path already. The
new menu path calls those same setters — no new backend or state surface is
added.

The sidebar itself already renders project sections in some order, and the
useProjects hook already returns the fleet-hydrated project list. The submenu
consumes the same source and displays it in the same order.

Skynet has no message streaming anywhere in the app, so the submenu never has
to reason about mid-flight streaming state.

## What would make it wrong

- A conversation moved via the menu ends up in a different state than one
  moved via the drop path — different routing, different RDP handling,
  different clearing semantic. Parity means "indistinguishable from the drop
  path once it lands."
- The affordance appears on an RDP row. The item MUST be hidden entirely
  there, because the drop path refuses RDP rows and the menu path must match.
- The affordance appears when zero projects exist. There is nothing to pick,
  and showing a parent item that opens an empty submenu is user-hostile.
- The drag-and-drop path visibly changes in any way — different hit target,
  different visual feedback, different acceptance rules. Drag stays exactly
  as it was.
- Tapping outside the submenu drops back to the outer menu instead of
  dismissing entirely. The dismiss model is one-level; two-level dismiss
  makes users unsure which "outside" they just tapped.
- The parent item's label changes based on state (e.g. "In project: Foo").
  The label is static; state is communicated by the checkmark inside the
  submenu.
- A move fires a toast, a confirmation dialog, or any modal interruption. The
  move is silent to match the rest of the row context menu.
- Tapping the row's currently-assigned project fires a network call. It's a
  no-op; nothing should reach the setter.
- The submenu's project order diverges from the sidebar's project order.
  Users' mental map of "where projects live in the sidebar" must transfer to
  the submenu unchanged.
- Long project names overflow the submenu width or cause the menu to reflow
  unpredictably. Truncate with ellipsis at the outer-menu max-width.

## Scope edges

**In scope:**
- Adding the "Move to project" parent item to the row context menu, in the
  right position with the right chevron, on both identity rows and relay-room
  rows.
- Adding drill-in submenu machinery to the context menu component. This is
  new surface built inside the existing flat-list component; no new component
  layer.
- The "‹ Back" row, the project list ordered to match the sidebar with a
  checkmark on the currently-assigned entry, and the "Remove from project"
  entry that appears only when the row is in a project.
- Hiding rules: hide entirely on RDP rows, hide entirely when zero projects
  exist.
- Wiring picks into setSessionProject / setRelayRoomProject via the same
  routing the drop path uses.
- The silent-no-op behavior when tapping the currently-assigned project.
- In-process tests exercising the context-menu path: happy paths (assign,
  reassign, remove), routing (identity vs relay-room), refusals (RDP row,
  zero projects), and the currently-assigned no-op.

**Out of scope:**
- Any change to the drag-and-drop path. Untouched entirely.
- Any change to the flat-middle drop-to-clear path. Untouched entirely.
- Undo, toast, or confirmation machinery — deliberately not added.
- Animation for the drill-in transition.
- Keyboard navigation additions beyond whatever the current context menu
  already supports.
- Multi-select scope. The context menu opens on ONE row and applies to ONE
  row; multi-row bulk actions are a separate affordance.
- First-time discoverability affordances (tooltips, hints, onboarding).
- Sidebar drag-autoscroll — that is the campaign's second shape,
  shape-sidebar-drag-autoscroll, and it is a separate session's work.

**Deferred:**
- Nothing deferred within this shape's own scope.

**Tempting but no:**
- State-reflecting parent-item label ("In project: Foo"). Complicates
  truncation and mixes label semantics; the checkmark handles state
  communication.
- Short-circuiting the parent item to a flat "Move to Foo" when exactly one
  project exists. Adds a mode; the drill-in path is one code path.
- Adding a global undo/toast pattern just for this affordance.

## Vehicle notes

Inline, tracked with harness tasks. The work fits in one session with care:
the submenu machinery is a contained addition to a single component, and the
routing already exists in the drop path for the menu path to reuse. Splitting
into a phase would fragment the design context across a plan-execute handoff
and lose the small-cost benefit of one-agent-one-session for a focused
affordance.

Harness task list gives the atomic-checkbox discipline of a phase without the
plan-review cycle. Each piece — component skeleton, drill-in mechanism, item
wiring, hiding rules, tests — becomes a task, worked in order, checked off as
it lands.

Code map (from session-carry, confirmed with the identity file):
- Row context menu item construction: PrettyConversationRow.tsx, items[]
  array around L1393-1476.
- Menu rendering: PrettyConversationContextMenu.tsx (adds drill-in).
- Existing routing (identity vs relay-room, RDP refusal, null clears):
  PrettyConversationsPanel.tsx L1746-1823 (handleProjectDrop) plus the two
  setters in session-project-api.ts.
- Fleet project list: useProjects() from conversation-store.ts L2461.

Ashley is aware this is inline and has explicitly asked me to take the time
to do it carefully. Test discipline follows the standing role directive:
scoped tests during development, full suite only at the deploy gate.
