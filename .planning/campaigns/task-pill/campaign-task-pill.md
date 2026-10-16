# Campaign: replace the identity badge — the task pill becomes the conversation's handle

**Opened:** 2026-10-16
**Status:** in_progress
**Workspace:** .planning/campaigns/task-pill/ (in the Skynet repo); tasting snippet at ~/fleet/identities/cable-box-maintainer-3/workspace/tasting/badge-tasting.js (layout G is the chosen one)

## Concept

Everything in a conversation pane besides the bubbles and the compose box exists to give the user access to, or awareness of, things they'd otherwise have no way to reach or see. Today the big identity badge in the upper-right carries most of that, while the thing the user actually looks at constantly — what the agent is working on — sits beside it as a separate pill. Now that agents are mostly single-use, who the agent is matters far less than what it's doing. So the badge goes away, and the task pill takes over: it gains the agent's avatar (looking just like that conversation's row in the sidebar), and behaves just like that row too — click opens the agent window, the three-dots and right-click open the usual conversation menu, and it's what you drag to move or close the pane. Things that are only sometimes true — the agent's desktop is running, the agent has local work it hasn't pushed — appear as separate round buttons just to the right of the pill, only while true, each one jumping straight to the matching part of the agent window.

## Success criteria

- An open agent conversation shows one thing at the top: the pill with avatar and task. No identity badge.
- The pill behaves the same as that conversation's sidebar row: same look, same click, same menu, same drag.
- When the agent's desktop is running, the user notices without looking for it, and can jump to it in one click; when it stops, the signal goes away.
- Nothing the badge used to give access to is lost — agent window, every menu action, pane dragging, drop lane, filing into sidebar sections.
- Works on a phone.

## Shapes

- **[declared] shape-task-pill** — the task pill with avatar replaces the identity badge; ⋮ + right-click = the usual conversation menu; click = agent window; drag = pane handle; desktop-running and unpushed-work circles beside it — in_progress
- **[discovered] shape-touch-long-press-menu** — app-wide: anywhere that has a three-dots menu, a long-press on a phone/touch screen opens that same menu, the way right-click does on desktop (sidebar rows, the new task pill, everything) — not started
- **[discovered] shape-retire-coordinator** — remove the old "coordinator agent" idea from the whole system (agent creation, wake-ups, relay, box scripts), not just its visual mark; the mark itself is removed in shape-task-pill — not started

## Other work

## Lingerers (explicitly approved)

## Open questions

- Relay rooms (several participants) keep their current badge group for now — revisit later.
- Multi-role avatar stays the split-pie avatar for now — being worked on separately.
- Ashley wants to rework how the agent window itself is presented — separate later work, not this campaign.
