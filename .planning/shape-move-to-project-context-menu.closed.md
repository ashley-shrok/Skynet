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

---

## Close-Out

**Closed:** 2026-09-23
**Vehicle used:** inline (with harness task tracking)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Menu-path affordance for putting a conversation into a project without dragging; lands in the same setters as the drop path
- **Shape: parent item + position + chevron** — present · "Move to project" sits between "Open in new window" and Kill; ChevronRight rendered on the right edge; final order Pin / Open in new window / Move to project / Kill / Archive verified in row-level test
- **Shape: drill-in transition (same on desktop and mobile, click/tap only, instant swap)** — present · Drilled state swaps content in place inside the same container; no hover handlers; no CSS transitions
- **Shape: "‹ Back" row + one-level dismiss** — present · Back row is the only way back to outer; tap-outside and Escape both dismiss the whole menu regardless of drill state — asserted by two dedicated tests
- **Shape: project list in sidebar order** — present · submenuProjects derived from projectSections (the same source the sidebar renders); ordering flows straight through
- **Shape: checkmark on currently-assigned** — present · Check icon rendered on the left; row-level test asserts menuitemradio + aria-checked=true on the assigned project
- **Shape: "Remove from project" only when in a project** — present · Appended after project list iff currentProjectSlug !== null; row-level tests cover both the appears-when and hidden-when cases
- **Shape: silent close on pick / silent no-op on currently-assigned** — present · Pick fires onClick then deferred onClose (no toast, no dialog); tapping the currently-assigned project calls no setter but still closes the menu
- **Shape: truncation with ellipsis at outer-menu max-width; submenu inherits height constraint with internal scroll** — present · Container carries maxWidth 260, maxHeight calc(100vh - 16px), overflowY auto; label spans use textOverflow ellipsis + nowrap
- **Philosophy: peer of drag, not replacement; drag untouched** — present · handleProjectDrop and handleFlatMiddleDrop unchanged in this diff; handleRowMoveToProject is a sibling that hits the same setters
- **Philosophy: consistency of interaction (one drill-in model)** — present · Single code path for desktop and mobile; no side-layer submenu paradigm
- **Philosophy: hidden over disabled** — present · Parent item omitted (not greyed) when onMoveToProject or projects is missing/empty; "Remove from project" omitted when not in a project
- **Philosophy: silence over confirmation** — present · No toast, no confirm dialog anywhere in the menu path
- **Prior context: reuses existing setters via same routing** — present · Menu path calls setSessionProject / setRelayRoomProject with identical routing to handleProjectDrop; identityKey fallback via sessionMatchKey mirrors the drop path
- **Prior context: submenu consumes useProjects-fed source** — present · submenuProjects derives from projectSections which is fed by the derived selector alongside useProjects
- **What would make it wrong: menu path lands in a different state than drop path** — present · Same setters, same routing, same null-clears, same RDP refusal, same identityKey fallback
- **What would make it wrong: affordance appears on RDP row** — present · Panel returns undefined onMoveToProject for rdpHostRow=true; RDP zone render site also omits the prop entirely; row-side gate hides item when onMoveToProject is undefined
- **What would make it wrong: affordance appears when zero projects exist** — present · Panel returns undefined when submenuProjects.length === 0; row-side has defense-in-depth projects.length > 0 gate covered by test
- **What would make it wrong: drag path visibly changes** — present · handleProjectDrop / handleFlatMiddleDrop / section-header drop lane are all untouched in this diff
- **What would make it wrong: outside-tap drops back to outer instead of dismissing** — present · outside-click always fires onClose regardless of drilled state; test asserts this while drilled
- **What would make it wrong: parent label changes based on state** — present · Label is the string literal "Move to project"; no state interpolation
- **What would make it wrong: toast or confirmation on move** — present · No toast/dialog machinery in either the row handler or the panel handler
- **What would make it wrong: currently-assigned tap fires a network call** — present · Row-side guard `if (!isCurrent) onMoveToProject(p.slug)` short-circuits before any callback; test asserts the setter is not called
- **What would make it wrong: submenu project order diverges from sidebar order** — present · Both sourced from projectSections in the same iteration order
- **What would make it wrong: long names overflow or reflow the menu** — present · Container maxWidth 260 + label ellipsis/nowrap; no reflow surface
- **Scope edges: in-scope items delivered** — present · Parent item + drill-in machinery + Back row + project list + checkmark + Remove-from-project + hiding rules + wiring + silent no-op + tests all present
- **Scope edges: out-of-scope items untouched** — present · No changes to drag path, flat-middle clear path, undo/toast, animation, keyboard nav additions, multi-select, onboarding, or drag-autoscroll
- **Scope edges: tempting-but-no items resisted** — present · Parent label is static (no "In project: Foo"); drill-in even when exactly one project exists (no one-project short-circuit); no global undo/toast

### Additions (in the result, not in the shape)

- maxWidth 260 and maxHeight calc(100vh - 16px) with overflowY auto applied at the outer context-menu container level, which is a new invariant on the pre-existing flat-menu items (Pin / Open in new window / Kill / Archive) that did not have those constraints before this shape — endorsed-as-drift

### Follow-ups

None.

### Notes

The shape's inheritance language ("the outer menu's max-width", "the outer menu's height constraint") read as though those bounds already existed; in fact they were newly introduced here. Ashley endorsed applying them uniformly at the outer level rather than gating on drill state — cleaner invariant, and the pre-existing menu items have labels well under 260px and never grew tall enough to scroll, so no observable behaviour shift on the pre-existing menu path. The menu-path handler (handleRowMoveToProject) is a near-mirror of handleProjectDrop with two shape-driven deltas: (1) it accepts slug=null for the "Remove from project" leaf, and (2) it reads row.roomId directly rather than reading it out of a serialised DnD payload — same carrier, different plumbing. RDP defense-in-depth is layered: panel returns undefined for onMoveToProject on RDP; RDP row-render site also omits the prop entirely; row-side items[] gate hides on undefined; and handleRowMoveToProject itself early-returns on rdpHostRow. Any single one of those layers would suffice; all four are present.
