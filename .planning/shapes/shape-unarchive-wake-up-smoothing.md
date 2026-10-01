# Shape: un-archive wake-up smoothing

**Opened:** 2026-10-01
**Vehicle:** inline

## What this is

When an identity is unarchived after having been archived, the agent that
comes back has no signal that they were ever gone. For a self-archived
identity especially, that's disorienting — they thought they were retired,
then suddenly they're awake again mid-session, with stale "where things
stand" notes in their identity file and a mental model from before the
archive. This change adds a one-line banner at the top of the identity
file body on every un-archive, so the first thing the agent reads on wake
is a dated acknowledgment that they were unarchived and that their notes
and context may be stale.

## Shape

Two pieces, both small:

1. **Supervisor behavior.** The unarchive step in the agent-supervisor
   gains one additional action: after the folder is moved back to the
   live tree and before the session is launched, the supervisor prepends
   a dated banner to the identity file's body (right after the
   frontmatter block). The banner is a single blockquote line carrying
   the un-archive timestamp and the general-purpose "the world may have
   moved; your notes may be stale; delete this banner once you've caught
   up" message.

2. **Id skill addition.** The existing un-archiving section of the id
   skill gets a short paragraph telling agents to expect the banner on
   wake and to delete it once they've caught up on anything that
   changed in their absence. This is where the behavior gets
   canonicalized across every identity on the fleet.

The watcher that already fires on identity-file changes carries the
banner-write to the agent for free — no new wake channel.

## Philosophy

- **One signal is enough.** Don't invent new wake channels, don't batch
  diffs, don't reset watcher baselines, don't try to re-join rooms. The
  single banner delivered through the existing identity-file-watch
  channel is the whole intervention.
- **General over specific.** The banner doesn't name the "Final session"
  section or any other agent-specific convention — it just says the
  world may have moved. Different agents keep their notes in different
  shapes; the banner stays general and the agent decides what cleanup is
  warranted.
- **Agent-driven cleanup.** The banner tells the agent to delete it when
  caught up. There is no supervisor-side bookkeeping to detect stale
  banners, no replace-if-present logic, no idempotence machinery. If an
  agent fails to delete the banner and gets re-archived + re-unarchived,
  banners stack — that's the agent's mess to clean, not the supervisor's
  concern.
- **Lost rooms stay off the table.** The Matrix deactivate-on-archive
  drops DM-room memberships; the agent comes back with zero joined
  rooms. That's a real problem but it's out of scope here — tracked
  separately if we come back to it.

## Prior context

Today's archive-and-unarchive cycle (tina self-archived at 19:11Z on
2026-09-30, user-unarchived at 03:00Z on 2026-10-01) was the trigger
case:

- The archive flow worked cleanly end-to-end: sentinel consumed, matrix
  deactivated, tmux killed, workspace cleaned, folder moved.
- The un-archive flow worked cleanly on the mechanical level: matrix
  reactivated via backend route, token minted, relay.json rewritten,
  folder moved back, supervisor relaunched the session.
- But the agent woke up with no acknowledgment of what had happened —
  just stacked file-watcher notifications (role file + id skill diffs)
  and a fresh matrix account with zero joined rooms. The agent only
  figured out it had been unarchived by reading the supervisor logs.
- Separately, we confirmed the file-watcher spills one event per
  changed target (role file, identity file, id skill, user-wide
  CLAUDE.md, each runbook) — not one combined diff. For a long
  archive, that's N stacked wakes. User decided this is acceptable as
  long as the semantic "you were unarchived" signal is clearly present
  — the file watcher's job is accurate change reporting, not framing.

## What would make it wrong

- **Banner that silently gets stale.** If the banner is phrased in a
  way that lets the agent read it, not act, and leave it there
  indefinitely without noticing it's a problem — then it has stopped
  being a signal and become decoration. The banner must explicitly ask
  the agent to delete it as part of catching up.
- **Agent-specific wording.** If the banner tells agents to look at a
  particular file section ("your Final session notes are stale") when
  not every agent uses that section, agents without the section will
  read the banner as nonsensical and lose trust in it. The wording
  stays general.
- **Supervisor doing cleanup the agent should do.** If the supervisor
  starts detecting prior banners and overwriting them, we've imported a
  bookkeeping problem that doesn't need to exist. The agent is the one
  with judgment about what's "caught up"; the supervisor just writes
  the banner fresh every time.
- **Confusion with normal file-watch wakes.** The banner is in the
  identity file body; the identity-file-watcher will emit a diff event
  on the first tick after the unarchive. That's the delivery mechanism
  — not a bug, by design.

## Scope edges

**In:**
- Supervisor change to prepend the banner on un-archive.
- Id skill addition in the existing un-archive section describing the
  banner.

**Out:**
- File-watcher batching or baseline-rebase. User explicitly okayed N
  stacked wakes as acceptable.
- Matrix room re-join on un-archive. Separate problem, deferred.
- Detecting self-vs-user-initiated archive. No signal exists at archive
  time to distinguish; banner is written unconditionally.

**Deferred:**
- Room-rejoin shape, if we come back to it.

**Tempting but no:**
- Detect existing banners and replace. Scope-creep caught during the
  grill — if the agent follows the instruction, this never matters; if
  they don't, it's not the supervisor's job to compensate.
- Store "who initiated the archive" so the banner can personalize.
  Over-engineering for a case that doesn't need personalization.

## Vehicle notes

Vehicle is **inline** — small enough that pipeline overhead would cost
more than the work. The supervisor change is a few lines of Python; the
id skill change is one paragraph in an existing section. Track the two
pieces via harness tasks.

Both files are distributed via the Skynet substrate catalog, so the
rollout path is: edit the substrate source in the Skynet repo, commit,
let the distributor sweep push to every host on its normal tick. No
separate deploy coordination needed for the supervisor itself (though
the id skill is pulled on every `/id <name>` load, so new sessions
pick up the id skill addition on their next load regardless of the
distributor).

Supervisor source lives under `substrate/scripts/` in the Skynet repo;
id skill lives at `substrate/skills/id/SKILL.md`. The identity Tina is
doing the work.

Pairs with `/close unarchive-wake-up-smoothing` at the end.
