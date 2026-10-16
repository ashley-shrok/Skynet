# Shape: the task pill, with the avatar added, replaces the identity badge

**Opened:** 2026-10-16
**Campaign:** task-pill (campaign-task-pill.md, alongside)
**Vehicle:** inline — one focused piece of front-end work, tracked with harness tasks; no GSD phase.

## What this is

In an open agent conversation, the big identity badge in the upper-right goes away. The task pill at the top-center takes over everything it did: it gains the agent's avatar, so it looks just like that conversation's row in the sidebar, and it behaves just like that row too — clicking it opens the agent window, its three-dots and a right-click open the usual conversation menu, and dragging it moves, closes or files the pane. Two round buttons can appear just to the right of the pill, only while their condition is true: a green one while the agent's desktop is running (opens the Desktop tab), and an amber one while the agent has local work not pushed anywhere (opens Git). The same pill and buttons show in the terminal view too.

## Shape

- **The pill** — always present at the top-center of an agent conversation, in both the chat view and the terminal view.
  - Contents, left to right: the agent's avatar (the multi-role split avatar as it already exists), the task text, a three-dots button.
  - No task → the agent's name, exactly as the sidebar row falls back.
  - Click → opens the agent window, as clicking the badge does today.
  - Three-dots, and right-click on the pill → the usual conversation menu, the same items the badge's menu has today (move to new tab, switch view, move to, close, archive …). Nothing new is added to that menu.
  - Drag → the pane handle, with everything the badge's drag does today: the drop lane (close / archive), rearranging the split, dragging into another window, dropping on a sidebar section to file the conversation.
  - Hover (desktop) → a tooltip with the agent's name, roles, and project if any.
  - Width → may use most of the pane's width (no longer capped at half), keeping a margin each side and room for the round buttons. In narrow panes the task text shortens with "…" first; avatar, three-dots and round buttons always stay whole.
  - Look → the same glass treatment and role color the pill has today.
- **Round buttons beside the pill** — sit just to the right of the pill, outside it; the pill stays centered whether or not they show. Each appears only while its condition holds, with a short pulse on appearing and then a steady color.
  - **Desktop** (green, monitor) — shows while the agent's desktop is running. Appears within a few seconds of it starting and disappears within a few seconds of it stopping, checked continuously while the conversation is open (not only while the agent window is open, and never "stuck on"). Click → the agent window on the Desktop tab.
  - **Unpushed work** (amber) — shows while the agent has local work not pushed to any remote (the same condition the badge's small amber mark shows today). Click → the agent window on the Git tab.
  - When both show, desktop is nearer the pill.
- **Phone** — the pill shows the same way and stays clear of the back button at top-left (shortening its text if needed). Tap → agent window; the three-dots is always visible and is the way into the menu. No drag. The round buttons work the same. (Long-press opening the menu is a separate, later shape, app-wide; the pill must use the same menu wiring as everywhere else so it inherits that automatically.)
- **Removed**
  - The identity badge in agent conversations, in both chat and terminal views.
  - The pin mark from the pane (the sidebar shows pinned).
  - The coordinator watermark, everywhere it is drawn (badge, sidebar row, and anywhere else) — the idea is retired. Only the mark; the underlying coordinator idea is a later shape.
- **Unchanged**
  - Relay rooms (several participants) keep their group of badges.
  - The agent window itself.
- **The id skill** — its description of the conversation view, the badge, drag-and-drop and the menu surfaces is updated in the same change to describe the pill, the round buttons and the removals.

## Philosophy

The pane shows only what the user needs constantly — what this agent is doing — plus whatever is only sometimes true, only while it is true. Everything else is one click or one menu away. The pill deliberately mirrors the sidebar row in look and in every interaction, so a conversation behaves the same wherever you touch it. The round buttons are separate, obviously clickable things, never icons squeezed inside the pill, so the pill's drag and click are never confused with them and the task text never loses room to them. Who the agent is no longer gets prime real estate.

## Prior context

- Today: a large badge upper-right (avatar, name, roles, project, pin mark, unpushed-work mark, coordinator watermark; click → agent window; three-dots/right-click → menu; drag → pane handle), plus a separate task pill at top-center that does nothing.
- The terminal view shows a smaller version of the same badge with the same behavior.
- The agent window decides whether to show a Desktop tab by asking whether the desktop is running, but only while it is open, and once it sees "running" it never switches back off.
- Apps have a full-width bar across the top; Ashley considers that bar worse than floating pills and wants conversations to stay floating.
- Tasting: a console snippet tried seven layouts (A–G); G is this shape. Snippet: ~/fleet/identities/cable-box-maintainer-3/workspace/tasting/badge-tasting.js.

## What would make it wrong

- The pill and the conversation's sidebar row look or behave differently — different click result, different menu, different drag.
- Anything the badge gave access to becomes unreachable, or any drag destination stops working.
- The desktop button shows while the desktop isn't running, or stays after it stops, or takes long enough to appear that the user misses it.
- The round buttons blink or animate continuously.
- The pill jumps sideways when a round button appears or disappears.
- The task text gets squeezed by indicators inside the pill.
- Chat view and terminal view show different things at the top.
- A phone user can't reach the menu, or the pill collides with the back button.

## Scope edges

- **In:** the pill, the two round buttons, the reliable desktop-running signal, badge removal in chat and terminal views, coordinator mark removal everywhere, the tooltip, width behavior, phone behavior, the id-skill update, tests.
- **Out / later shapes in this campaign:** long-press opens the menu app-wide (shape-touch-long-press-menu); retiring the coordinator idea itself (shape-retire-coordinator).
- **Deferred, not this campaign:** relay rooms' badge group; the multi-role avatar's design; reworking the agent window's presentation.
- **Tempting but no:** a merged "agent card" combining menu and sections; new items in the conversation menu; an "agent is working right now" indicator; any other new indicator.

## Handoff notes

- Implementer: cable-box-maintainer-3, inline, in this session.
- Role rules apply: scoped tests during work, full suite only at deploy; commit, then stop and report — no push or deploy without Ashley's separate greenlight.
- The current badge is shared with relay rooms, which keep it; only agent conversations (chat + terminal view) switch to the pill.

---

## Close-Out

**Closed:** 2026-10-16
**Overall verdict:** closed-hit (reviewer returned closed-partial on two open points; both resolved with Ashley — see below)

### Shape features (conformance)

- **The pill: top-center in chat and terminal views** — present · same pill mounts in both views
- **The pill: contents (avatar, task, three-dots)** — present · same avatar source as the sidebar row
- **The pill: no task → agent's name** — present · matches the sidebar row's fallback
- **The pill: click → agent window** — present · both views
- **The pill: three-dots + right-click → usual menu, nothing new** — present · same items and menu wiring as the badge/row
- **The pill: drag = pane handle** — present · identical payload via one shared writer; three-dots blocks drag
- **The pill: hover tooltip (name, roles, project)** — present
- **The pill: width and truncation** — present · half-width cap gone; symmetric reserve; only text truncates
- **The pill: same glass + role color** — present
- **Round buttons: outside the pill, pill stays centered** — present
- **Round buttons: short pulse then steady** — present · three-cycle pulse, off under reduced motion
- **Desktop button: reliable continuous signal → Desktop tab** — present · measured every sweep tick, fails closed, clears with the session
- **Unpushed-work button → Git tab** — present · same condition as the badge's amber mark
- **Desktop nearer the pill when both show** — present
- **Phone behavior** — present · no drag, three-dots always visible, clear of the back button
- **Removed: badge in agent conversations** — present · badge remains only for relay rooms
- **Removed: pin mark from the pane** — present
- **Removed: coordinator watermark everywhere** — present · stale comments also cleaned after review
- **Unchanged: relay rooms' badge group** — present
- **Unchanged: the agent window** — drifted → fixed · opening on a requested tab (needed by the buttons) is the only change; an unintended "reopen on remembered Desktop" side effect was reverted
- **The id skill updated** — present · omission of the admin-only switch-view item is intended (role rule: admin-only features never go in the id skill)
- **Tests** — present
- **What would make it wrong: pill vs sidebar row differ** — present (guarded)
- **What would make it wrong: anything unreachable / drag destination broken** — present (guarded)
- **What would make it wrong: desktop button wrong, stuck, or slow** — present (guarded)
- **What would make it wrong: buttons animate continuously** — present (guarded)
- **What would make it wrong: pill jumps sideways** — present (guarded)
- **What would make it wrong: task text squeezed by indicators** — present (guarded)
- **What would make it wrong: chat and terminal views differ** — present (guarded)
- **What would make it wrong: phone menu unreachable / collides with back button** — present (guarded)

### Additions (in the result, not in the shape)

- The agent window stayed on a remembered Desktop tab on reopen while the desktop ran — unsanctioned → reverted (Ashley, 2026-10-16: "Agreed")

### Follow-ups

- id skill leaves out the admin-only switch-view menu item — accepted-as-drift (intended; role rule)
- Stale coordinator-watermark comments in row styles / badge — fixed in the same session

### Notes

None of the "tempting but no" items appeared: no merged agent card, no new menu items, no "working now" indicator, no other indicators.
