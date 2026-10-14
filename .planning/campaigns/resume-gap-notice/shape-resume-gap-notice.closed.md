# Shape: tell sessions that are resumed after a long time how long they were out

**Opened:** 2026-10-14

## What this is

When a message reaches a Claude session after the conversation has been silent for 30 minutes or more, the session is told — attached to that same message — how long it has been since its last activity, with both ends of the gap in absolute time. Today an agent woken from dormancy, relaunched after a crash, or simply left idle for days receives the next message as if no time had passed; this closes that blind spot.

## Shape

- **One small check that runs on every incoming message**, the same kind of thing as the existing "your task line is still Untitled conversation" reminder: a script shipped to every fleet box by the substrate distributor and registered to run each time a message arrives in any session.
- **It measures the gap** as: now, minus the time of the conversation's most recent recorded activity before the message that just arrived. The conversation record timestamps every turn; reopening a conversation adds no timestamped activity of its own, so the measurement is the true silence regardless of how the session slept or came back.
- **If the gap is 30 minutes or more**, it attaches one hidden note to the arriving message, shaped like: *"It has been 5 days 3 hours since your last activity in this conversation (last active Thu 9 Oct 02:30 UTC; now Tue 14 Oct 05:42 UTC)."* Duration rounded to its two largest units; both timestamps in UTC.
- **If the gap is under 30 minutes, or there is no earlier activity** (a brand-new session, a session reset to fresh), it does nothing.
- **It applies to every session on the box** — supervised fleet agents and hand-started sessions alike.

## Philosophy

- A bare fact, not advice. The note says how long; it does not tell the agent what to do about it. No id-skill guidance accompanies it — we add that only if a real problem shows up.
- One uniform rule for every cause of a gap. Dormancy, crash recovery, plain idleness, an agent waiting on its own background work — all get the same treatment. No exceptions that guess at the agent's intent.
- Lands with the message, not before or after it. The agent reads the gap and the message that ended it in the same turn, so there is no ordering race.
- A flat 30-minute cutoff, independent of any box's dormancy setting. The note is about time away, not about whether the supervisor put the agent to sleep.
- Never in the way. Any failure is silent; it must never block or delay a message.

## Prior context

- When an agent goes dormant the supervisor later reopens the same conversation; nothing tells the agent time passed. Same for crash recovery. Always-on agents are never reopened at all, so a supervisor-side fix would miss them — which is why this lives at the per-message level instead.
- Claude Code itself already adds a "the date has changed" line when the calendar day moves. It gives no duration and says nothing for a same-day gap. The two coexist; we don't try to suppress the built-in one.
- The existing task-line reminder is the template for packaging, distribution and registration.
- This very conversation is the motivating example: a five-day gap that the agent learned of only through the calendar-date line.

## What would make it wrong

- The note fires on short gaps and becomes noise the agent learns to ignore.
- The gap is measured from the wrong moment — e.g. counting the arriving message itself, so it always reads near zero, or counting a reopen as activity, so a dormancy gap looks short.
- It ever blocks, errors into, or slows down message delivery.
- It shows up as a visible bubble in the user's chat view.
- It only works for supervisor-woken agents and misses always-on or hand-started sessions.
- It editorializes — tells the agent what to do rather than stating the fact.

## Scope edges

- **In:** the per-message check, its distribution to every fleet box, its registration to run on every incoming message, tests.
- **Out:** any id-skill text about what to do with the note; any supervisor change; any change to how or when agents go dormant; suppressing Claude Code's own date-change line.
- **Deferred:** behavioral guidance for agents, if a problem is ever noticed.
- **Tempting but no:** making the cutoff follow each box's dormancy setting; special-casing background-task wakes; showing the note to the user.

## Handoff notes

- Implementing identity: echo-box-maintainer-3 (box-maintainer role), in its own Skynet tree.
- Follow the task-line reminder end to end as the pattern: its script in the substrate scripts folder, its entry in the distributor catalog, and the bootstrap step that registers it in each box's Claude Code settings for the every-incoming-message event.
- Usual box-maintainer gates apply: scoped tests during development; no push or deploy without the user's explicit greenlight.

---

## Close-Out

**Closed:** 2026-10-14
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Hidden note on the arriving message with duration and both ends in UTC.
- **Shape: one per-message check, packaged/shipped/registered like the task-line reminder** — present · Same folder, catalog entry, install location, no restart; bootstrap merge + check register it for every incoming message.
- **Shape: gap = now minus last recorded activity; reopen doesn't count** — present · Measured from the agent's own newest turn; system notices written during the silence deliberately don't count — conforming reading of "your last activity".
- **Shape: 30+ min → one note, agreed wording, two largest units, UTC** — present · Smaller unit truncated, zero smaller unit dropped.
- **Shape: under 30 min or no earlier activity → nothing** — present · Tests cover fresh session and threshold edges.
- **Shape: every session on the box** — present · No supervised-identity gate; test covers unsupervised session.
- **Philosophy: bare fact, no id-skill guidance** — present
- **Philosophy: one uniform rule** — present
- **Philosophy: lands with the message** — present
- **Philosophy: flat 30-minute cutoff** — present
- **Philosophy: never in the way** — present · All failures exit silently; tail-first read.
- **Scope In** — present
- **Scope Out / tempting-but-no** — present · None of the excluded things were done.
- **Handoff: task-line pattern; no push/deploy** — present · Local commit only.
- **What would make it wrong: noise on short gaps** — present (guarded)
- **What would make it wrong: measured from the wrong moment** — present (guarded)
- **What would make it wrong: blocks/slows delivery** — present (guarded)
- **What would make it wrong: visible bubble** — present (guarded)
- **What would make it wrong: supervisor-woken only** — present (guarded)
- **What would make it wrong: editorializes** — present (guarded)

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Two readings within the shape's latitude, recorded not escalated: "last activity" = the agent's own last turn (system notices written during the silence don't shorten the gap); the duration's smaller unit is truncated rather than rounded.
