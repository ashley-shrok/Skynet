# Campaign: Make moving a conversation into a project not depend on drag-and-drop

**Opened:** 2026-09-23
**Status:** in_progress
**Workspace:** /home/ubuntu/fleet/identities/argon-box-maintainer-3/workspace/skynet/.planning/

## Concept

Today the only way to put a conversation into a project is to drag its sidebar
row onto the target project section. That fails in two real scenarios: (1) the
device has no usable drag surface — mobile is the load-bearing case — and (2)
the target project is scrolled off-screen, and the sidebar does not scroll
when you drag a row toward its top or bottom edge. The concept is to close
both gaps: give the row's context menu a "Move to project" affordance that
works everywhere the menu already works (desktop right-click AND mobile
long-press), and, separately, fix the sidebar so that dragging a row toward
its top or bottom edge makes the sidebar scroll in that direction.

## Success criteria

- A user with no drag capability — mobile is the primary case, but also
  disabled/broken drag or accessibility — can put a conversation into any
  project, and take it out again, from the row's context menu alone.
- A user on desktop who is scrolled far down a long sidebar can drag a row
  toward the top edge and have the sidebar scroll upward so a project at the
  top becomes reachable in the same drag gesture. Same behaviour toward the
  bottom edge.
- The context-menu path and the drop path have behaviour parity: same
  routing between identity rows and relay-room rows, same refusal for RDP
  rows, same "null clears the assignment" semantic.
- No regression to the existing drag-and-drop path or to the flat-middle
  drop-to-clear path.

## Shapes

- **[declared] shape-move-to-project-context-menu** — Add a "Move to project"
  affordance to the row context menu. Submenu picker: parent item opens a
  child list of projects with the currently-assigned project marked with a
  checkmark, and a "Remove from project" entry at the bottom (only active
  when the row is currently in a project). Hidden entirely for RDP rows and
  when there are zero projects. Wires into the same setSessionProject /
  setRelayRoomProject routing that the drop path uses. — in_progress
- **[declared] shape-sidebar-drag-autoscroll** — When a drag hovers within a
  small edge zone at the top or bottom of the sidebar, the sidebar scrolls
  in that direction so off-screen project sections become reachable in the
  same drag gesture. Applies to the sidebar drag surface generally, not
  scoped to project drops. — in_progress

## Sequencing

`shape-move-to-project-context-menu` first — it is the primary ask and the
mobile-critical path. `shape-sidebar-drag-autoscroll` second — it improves
drag-and-drop where drag is already working, so it is a quality-of-life
follow-up rather than a blocker for the primary path.

The two shapes are independent — neither depends on the other landing first.

## Side-bounties

None yet.

## Other work

None yet.

## Lingerers (explicitly approved)

None yet.

## Open questions

- **Submenu machinery in the context menu.** The existing
  PrettyConversationContextMenu is a flat button list with no submenu
  affordance. Adding a submenu means positioning, hover-intent, and mobile
  tap semantics all need shaping. Settled in shape-move-to-project-context-
  menu's `/open`.
- **Auto-scroll speed shape.** Linear vs accelerating vs ease-in, edge-zone
  size in pixels, and the scroll cadence. Settled in shape-sidebar-drag-
  autoscroll's `/open`.
- **Mobile drag scope for auto-scroll.** Mobile does not use HTML5 native
  drag today; the drag path in the sidebar is desktop-mouse-driven. Whether
  the auto-scroll shape extends to any mobile long-press-drag path — or
  whether mobile is entirely served by the context-menu path — is a scope
  question for shape-sidebar-drag-autoscroll's `/open`.
