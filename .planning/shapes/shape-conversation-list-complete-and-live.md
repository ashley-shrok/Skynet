# Shape: the conversation list should arrive complete and never lag behind

**Opened:** 2026-09-16
**Vehicle:** gsd phase (multiple plans)
**Supersedes:** all three declared shapes of campaign-conversation-list-live
(dequeue-cosmetics, cache-cosmetics, live-updates) — see § Vehicle notes

## What this is

Opening the app should hand you a finished conversation list: the right
conversations, in the right order, each already wearing its colour, name, title
and description, with pinned ones at the top and hidden ones absent. Not a list
that appears and then settles. And once it is open, anything that changes out in
the fleet — a conversation starting or ending somewhere else, an agent rewriting
its own description, a colour changing on disk — reaches the list on its own,
without the page being reloaded.

Today neither is true. The list is assembled by two questions asked one after
the other, the second waiting on the first, so rows appear undressed and dress
themselves a moment later. And the whole thing is asked exactly once per page
load, so from that moment on the list is frozen until you reload.

## Shape

**One description of what the list needs.** There is a single answer shape that
contains everything required to render the list correctly: which conversations
exist, what each one looks like with inheritance already resolved, whether each
is pinned, whether each is hidden. Not two answers that have to be combined by
the viewer — one answer that is complete on its own.

**Two moments, one answer.** Opening the app asks for that answer. The repeating
pulse that already visits every machine every couple of seconds delivers that
same answer, continuously. These are not an initial-load path and a separate
live-update path with different contents; the opening request is simply the
first delivery of the same thing. That is what makes them incapable of
disagreeing.

**The server holds the picture; the browser is a viewer.** The machines are
already being watched continuously. So the opening request should be answered
from what the server already knows, immediately, without going out to the
machines at all. The browser stops being the thing that triggers discovery. This
is what lets the list be both instant and complete rather than trading one for
the other — and it is why remembering the list on the browser's own side becomes
largely unnecessary.

**Appearance has exactly one home.** The store that already holds what each
agent looks like keeps being the only place appearance lives. The early complete
answer feeds that same store through the same door; it is the same fact arriving
sooner, not a second competing authority. Writing into it is additive, never
wholesale-replacing, so an answer that knows less can never blank out one that
knew more.

**Membership and appearance are independent even though they arrive together.** A
conversation is in the list because something is running. It is dressed if its
record could be read. Those two facts travel in one answer now, but a failure to
read a record must never remove a conversation from the list.

**Coming back is the same path as arriving.** Returning to a backgrounded app
reconnects and asks once for the current answer — the same request a cold open
makes. There is one path to build and one path to get right, and correctness
never rests on catch-up reconciliation being perfect.

## Philosophy

**Stop discarding what was already read.** The expensive work of looking at every
agent's record on every machine is already happening, twice over — once to find
out which role each agent holds, and separately to find out what it looks like.
The first read throws away everything except one line. This shape is mostly not
new work; it is keeping what is already in hand.

**Simple and complete beats clever and partial.** The list asks for everything it
needs, every time, and does not try to be smart about asking for less. This was
measured rather than assumed: the added reading costs about a millisecond
against a pulse that already spends six to seven hundred milliseconds per
machine per tick on unrelated work. A mechanism that decides "nothing changed,
skip it" can be wrong, and when it is wrong the symptom is a silently stale list
with nothing to indicate it. Trading a millisecond for a class of invisible
staleness bugs is a bad trade, so we are deliberately not making it.

**No state a user can see the app growing out of.** The bar is not a shorter
undressed window, or a faster settle. It is that there is no moment where a row
is visible in a state it is about to change out of. A correction that flickers
into place is a failure of this shape even when the final state is right —
especially so, because a rare machine-dependent flicker is the hardest kind of
wrongness to ever track down.

**One authority per fact, structurally.** Appearance is written in exactly one
place, and both the early and the fuller path go through it. If a future change
needs a second write path for appearance, that is a design conversation, not a
convenience.

**Degrade honestly.** A machine that cannot answer in time contributes plain rows,
exactly as today. It never contributes missing rows, and it never holds up
machines that are healthy.

## Prior context

- **A partial memory of the list already exists.** It remembers which
  conversations there were, so rows paint fast — but it stores nothing about
  appearance. That half-measure is what makes the undressed paint the
  *guaranteed* experience rather than an occasional one.
- **The second question waits for something that is thrown away.** It waits to be
  told which agent lives on which machine, and the server ignores the agent
  names entirely — it uses only the set of machines, then looks at each machine
  to see who lives there. The waiting buys nothing.
- **The first question already reads the exact records the second one needs.** It
  opens each agent's record to find one line naming that agent's role, and
  discards the name, colour, title and description sitting in the same place.
- **The list is fetched exactly once per page load**, by deliberate design — no
  polling, no refetch on focus. Two features later needed hand-wired exceptions
  to force a refresh. Nothing else re-asks, which is why the list freezes for
  the life of the tab.
- **A continuous pulse already exists and is proven.** It visits every machine
  every couple of seconds and already enumerates every agent's folder, checking
  small marker files. Nothing in it can create or remove a row, and appearance
  is not on it at all. The transport for a live list is already there; only its
  scope is narrow.
- **The pulse's cost is dominated by something else entirely.** Measured: six to
  seven hundred milliseconds per machine per tick, almost all of it hunting and
  scanning transcript tails. Everything this shape wants to add measured at
  about one millisecond on a host with 73 agents — far more than the small hosts
  being targeted will ever carry.
- **There is no file watching anywhere.** Everything is discovered by visiting
  and comparing, server-side.
- **The live connection gives up permanently** after roughly half a minute of
  failed reconnection — well inside the time a phone spends with the app in the
  background.
- **There is a real ceiling on how much can be asked of one machine at once**,
  put in place because this fanout has been overrun before. This shape must
  respect it rather than assume headroom.

## What would make it wrong

- **A row is ever seen in a state it then grows out of.** Undressed then dressed,
  plain then coloured, in one position then another, present then hidden. Any of
  these means the list is still settling in front of the user, which is the
  thing this exists to end.
- **A failed record read removes a conversation.** Dressing is allowed to fail;
  existing is not. If a conversation can vanish because a machine was slow, this
  has traded a cosmetic bug for a serious one.
- **One struggling machine delays the whole list.** Machines are answered
  independently today and must stay that way. Agents on healthy machines must
  never wait on a machine that is having trouble.
- **Appearance ends up with two sources.** If the list and an open conversation
  can ever disagree about an agent's colour, the single-authority rule was
  broken somewhere, and the drift will be blamed on something else for weeks.
- **The list goes quietly stale.** A list that is wrong while looking settled is
  worse than one that is visibly loading. Whatever keeps it current must fail
  loudly rather than silently stop.
- **Something that changed is only visible after a reload.** If the answer is
  "refresh the page", the live half of this has missed the point.
- **The steady-state pulse gets materially more expensive.** The added work is
  supposed to be noise against what the pulse already spends. If it becomes a
  multiple of today's cost, the shape was implemented wrong, not the budget
  misjudged.
- **A brand-new agent breaks something.** It exists before it is running, so the
  fast path structurally cannot see it. That must be a non-event, not a gap.

## Scope edges

**In:**
- One complete answer shape covering existence, appearance, inheritance, pinned
  and hidden.
- The opening request answered from what the server already knows, without
  going out to the machines.
- The pulse widened to carry that same answer: conversations appearing create
  rows, conversations going away remove them, changed records update appearance.
- Inheritance resolved as part of "fully dressed", with a role's record read at
  most once per machine per tick regardless of how many agents share it.
- Fixing the give-up-forever reconnection, since returning-to-current on a phone
  depends on it.
- A floor so that a missed change degrades to slightly-stale rather than
  permanently-wrong.

**Out:**
- The slow first-ever load with nothing remembered — what to show when real work
  must happen before anything can be shown, and telling "still looking" apart
  from "found nothing" apart from "couldn't reach some machines". Deferred by
  explicit decision; becomes its own work later.
- Making an individual conversation open faster. Different surface, adjacent
  complaint, not this.

**Deferred / handled elsewhere:**
- Brand-new agents that exist but are not yet running stay served by the fuller
  question, which already triggers its own refresh at birth. Deliberately not
  special-cased into the fast path — the third part of this shape makes rows
  able to appear on their own, which serves that case naturally rather than by
  hand-wiring.
- The fuller appearance question stays alive and unchanged for opening an
  agent's settings, avatars, and role-inheritance display. The list stops
  *depending* on it; it is not being removed.

**Tempting but no:**
- Change-detection cleverness to avoid re-reading records that did not change.
  Measured as unnecessary, and it introduces a mechanism that can be wrong in a
  way nobody can see. Explicitly rejected on evidence, not overlooked.
- Running the two existing questions side by side instead of merging them. That
  shortens the undressed window instead of removing it, and leaves two sources
  of appearance.
- Browser-side memory of appearance as the primary fix. Largely unnecessary once
  the server can answer instantly from what it already knows.

## Vehicle notes

A GSD phase with several plans. It crosses the per-machine sweep, the server's
held picture of the fleet, the answer shape both moments share, and the
browser's store — and it must not regress ordering, pinning, hiding, relay-room
rows, or the per-conversation work indicators.

**This shape replaces the three declared shapes of
`campaign-conversation-list-live`.** That campaign planned a sequence —
de-queue, then remember, then make live — on the assumption that the added
reading was expensive enough to stage carefully. Measurement during this session
showed it is about a thousandth of what the pulse already spends, which collapses
the sequence: once the pulse carries the complete answer and the server can hand
it over instantly, the de-queue is a consequence rather than a step, and
browser-side remembering becomes largely unnecessary. The campaign artifact at
`.planning/shapes/campaign-conversation-list-live.md` is updated to record this.

**Overlapping bounties in the role pool**, each needing a terminal state or an
explicit link at close: `client-cache-session-list`,
`conversation-rows-render-colourless-silent-refresh-failure`,
`sidebar-fleet-sessions-refresh-after-identity-create`,
`conversation-list-scroll-delay-on-load`. Adjacent but explicitly out of scope:
`speed-up-pretty-view-initial-load`.

**Seed the phase's context from this file** rather than re-eliciting it.

Closed with `/close conversation-list-complete-and-live`.
