# Campaign: extra attention drawn to trying to archive identities with active wakeups

**Opened:** 2026-10-29
**Status:** closed (2026-10-29)
**Workspace:** ~/fleet/identities/saturn-box-maintainer-4/workspace/skynet/.planning/

## Concept

Archiving an agent silently ends its wake-ups forever: they belong to that one
agent and are never moved anywhere. Whenever someone is about to archive an
agent that still has wake-ups that will fire again, the moment of archiving
says so plainly — naming them and that they will never fire again, and
pointing at a scheduled task if the work should carry on. This holds on every
route a person archives by (sidebar row, task pill, drop lane, phone swipe,
whole project, whole role) and when an agent archives itself (asked to, or
after a scheduled-task run set to archive if there's nothing to report).

## Success criteria

- No route a person can archive an agent by lets an agent with active
  wake-ups go without the person being told which wake-ups stop.
- "Active" means switched on and still able to fire: past one-time wake-ups
  and repeating ones that have run out are not counted; switched-on sensor
  wake-ups are.
- Agents with no active wake-ups archive exactly as they do today (no extra
  step, phone swipe stays instant).
- If the wake-ups can't be checked, the normal confirm shows with a line
  saying so — archiving is never blocked on the check.
- An agent never archives itself past active wake-ups without naming them to
  the user first; a scheduled-task run treats having them as worth reporting.

## Shapes

- **[declared] shape-archive-wakeup-warning** — the warning across every archive route, plus the agent-side instructions — closed

## Other work

- What's new note — dropped (the user: "No note")

## Lingerers (explicitly approved)

## Open questions
