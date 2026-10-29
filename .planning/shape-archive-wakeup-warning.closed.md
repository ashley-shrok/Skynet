# Shape: extra attention drawn to trying to archive identities with active wakeups

**Opened:** 2026-10-29

## What this is

When someone is about to archive an agent that still has wake-ups that will
fire again, the archive moment says so plainly: it names those wake-ups, says
they will never fire again, and suggests making the work a scheduled task if
it should keep running. This covers every way a person archives an agent, and
the instructions agents follow when they archive themselves.

## Shape

- **What counts as an active wake-up.** Switched on and still able to fire.
  A one-time wake-up whose time has passed doesn't count, nor does a repeating
  one past its end date or out of runs. A switched-on sensor wake-up counts.
- **The check.** Pressing Archive first asks the agent's machine for its
  active wake-ups, then opens the confirm. The check gives up after about
  four seconds.
- **The single-agent confirm** (sidebar row menu, task pill menu, drop lane's
  Archive). Same title and opening line as today. When the agent has active
  wake-ups, it adds "It has N wake-up(s) that will never fire again:" with one
  line per wake-up (name — schedule as shown in the Wake-ups tab), then "If
  this work should keep running, set it up as a scheduled task (clock icon)
  first." With none, the confirm is exactly as today. If the check failed or
  timed out, it adds "Couldn't check this agent's wake-ups — any it has will
  stop." Archive stays red and works the same in every case.
- **Phone swipe.** The row slides away and the Undo bar shows as today, while
  the check runs alongside. If the agent has active wake-ups, the Undo bar is
  withdrawn without archiving, the row comes back and the warning confirm
  opens. Confirming archives it; cancelling leaves the agent as it was.
  With none, nothing changes. If the check failed, the swipe proceeds as
  normal and the Undo bar says wake-ups couldn't be checked.
- **Whole project / whole role archive.** The existing confirm adds a line
  naming the agents being archived that have active wake-ups, each with how
  many (e.g. "3 of these agents have wake-ups that will stop: Wren (2),
  Finch (1), Robin (1)"), plus the scheduled-task pointer. If some agents
  couldn't be checked, it says so.
- **Agents archiving themselves.** The instructions every agent reads say:
  before archiving itself, an agent with active wake-ups names them to the
  user. The "archive if nothing to report" wording given to scheduled-task
  runs gains: having active wake-ups is something to report, so don't
  archive.
- **What's new note** for users, wording approved by Ashley before it's
  committed.

## Philosophy

A warning, not a gate: archiving is never blocked, never slower than the
short check, and never different for agents without active wake-ups. It
exists so nobody loses scheduled work without knowing. It names things
concretely rather than giving a generic "this agent may have wake-ups".

## Prior context

Today's confirm says only that the agent is retired and its conversation
leaves the sidebar; phone swipe has no confirm; project and role archives
count or name agents. Nothing mentions wake-ups, which are lost with the
agent. The app only reads wake-ups when the agent window opens; the sidebar
doesn't know who has them.

## What would make it wrong

- An agent with active wake-ups archived by any person-facing route without
  its wake-ups being named.
- Warning about wake-ups that can no longer fire (past one-time, run out,
  switched off) — noise that trains people to ignore it.
- An agent with no active wake-ups getting any extra step, delay beyond the
  check, or changed swipe behavior.
- A broken or slow check blocking or failing the archive.
- The confirm opening before the check returns so the warning can be clicked
  past unseen.

## Scope edges

- In: every person-facing archive route, agent self-archive instructions,
  scheduled-task archive wording, What's new note.
- Out: a sidebar marker for agents with wake-ups; a button that turns a
  wake-up into a scheduled task; moving wake-ups anywhere on archive.
- Tempting but no: blocking archive until wake-ups are switched off.

## Handoff notes

Saturn (saturn-box-maintainer-4) does the work. The agent instructions are
the id skill in the repo's substrate (never the installed copy). The
scheduled-task wording lives in two byte-identical places (the scheduler and
the Run now path). Committed with scoped tests green, not pushed or deployed
without Ashley's per-push / deploy greenlight.

---

## Close-Out

**Closed:** 2026-10-29
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What counts as an active wake-up** — present · Switched on and still able to fire; off, malformed, already-gone one-time, past-end and run-out repeating ones excluded; switched-on sensors count (a one-time sensor stops counting once it has gone). An overdue one-time wake-up still owed a late catch-up counts — endorsed by Ashley.
- **The check** — present · Archive waits for the agent's machine before the confirm opens; gives up after about four seconds and treats that as "couldn't check".
- **The single-agent confirm** — present · Row menu, task pill and drop lane all check first; same title and opening line; names each wake-up with its schedule plus the scheduled-task line; unchanged with none; "couldn't check" line on failure; Archive stays red.
- **Phone swipe** — present · Undo bar as today while the check runs; active wake-ups withdraw the bar, bring the row back and open the warning confirm; an early-closed bar waits for the check; failed check archives with the bar saying so.
- **Whole project / whole role archive** — present · Names agents with wake-ups and their counts, unchecked agents, and the scheduled-task line.
- **Agents archiving themselves** — present · Id skill step names active wake-ups and waits for the user's go-ahead (endorsed); scheduled-task wording changed identically in both places.
- **What's new note** — drifted · Ashley decided no note.
- **Philosophy** — present · A warning, never a gate; no change for agents without active wake-ups.
- **Scope edges** — present · No sidebar marker, no convert-to-task button, no moving wake-ups, no blocking.
- **Handoff notes** — present · Substrate id skill edited; commit pending at close time (by design, after review).
- **What would make it wrong: archived without its wake-ups named** — present
- **What would make it wrong: warning about wake-ups that can no longer fire** — present · Overdue one-time and older-backend fallback endorsed.
- **What would make it wrong: extra step or delay for agents with none** — present
- **What would make it wrong: a broken or slow check blocking the archive** — present
- **What would make it wrong: confirm opening before the check returns** — present

### Additions (in the result, not in the shape)

- A self-archiving agent with active wake-ups waits for the user's go-ahead, not just names them — endorsed-as-drift
- An overdue one-time wake-up still owed a late catch-up is named — endorsed-as-drift
- If the machine doesn't report whether a wake-up can still fire, every switched-on one is named — endorsed-as-drift

### Follow-ups

None.

### Notes

What's new note dropped at Ashley's call. Every person-facing archive route was covered by reading.

---

## Close-Out (re-check after code-review fixes)

**Closed:** 2026-10-29
**Overall verdict:** closed-hit

### Additions (in the result, not in the shape)

- Whole project / role archives: checks run a few at a time per machine with a shared limit of about eight seconds before the confirm opens — endorsed-as-drift (Ashley: "Up to about 8 seconds")
- A second Archive press on an agent whose check or confirm is already up does nothing — endorsed-as-drift (Ashley: "Yes, ignore it")
- Self-archive may skip naming wake-ups when the user already knew — already endorsed in the first Close-Out

### Notes

Code-review fixes: a leftover "already fired" mark older than the wake-up no longer hides it; a failed remote read now reads as "couldn't check" for the archive check; a "couldn't check" notice still shows if the swipe's bar went before the check came back.
