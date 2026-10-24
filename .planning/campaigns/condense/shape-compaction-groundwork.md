# Shape: Compaction groundwork — make compaction behave the way we configure it

**Opened:** 2026-10-24
**Campaign:** condense (shape 1 of 4)

## What this is

Every fleet box moves to a Claude Code version that has a separate switch for idle compaction. Idle compaction is switched off, and near-limit compaction is switched back on, firing when the app's context meter reads 95%. The old settings and explanations that described compaction wrongly are removed or corrected, so what the fleet is configured to do, what the code says it does, and what actually happens all agree.

## Shape

- **The fleet's harness version.** Skynet already pins one Claude Code version for every box and moves each box to it on its next sweep. The pin moves from the current version to the newest one available at build time, after checking that version still has the separate idle-compaction switch and that turning it off really stops idle compaction.
- **The fleet's shared harness settings.** The distributor writes these to every box and checks they're present. Today they carry "all automatic compaction off". That's replaced by two things: idle compaction off, and the near-limit trigger lowered to the point the meter calls 95%. The distributor's presence check is updated the same way, so a box missing either one is flagged.
- **What "95%" means.** The meter reads tokens used out of the full one-million window. Claude Code measures its trigger against a slightly smaller window, so the setting given to Claude Code is whatever number makes it fire at 950,000 tokens, which the meter shows as 95%. By default it fires at about 967,000.
- **The agent launch line.** It currently carries a compaction percentage that never did anything. That's removed; the shared settings are the one place compaction is configured.
- **Corrected explanations.** Every note that describes compaction wrongly is fixed or removed. That includes the meter's note saying compaction is off fleet-wide, the supervisor's notes crediting the do-nothing setting with fixing a bug, the settings writer's reasoning that the context watch owns the limit, and the polling code's assumption that compaction starts a new session.

## Philosophy

- Configure compaction in one place, and make that place true.
- Use Claude Code's own threshold for the 95% trigger. It works mid-turn and needs no watcher.
- Stay small. This shape fixes configuration and wording only. Re-grounding, the Condense operation, and the chat divider are later shapes.

## Prior context

- One day before the campaign's research, another agent switched off all automatic compaction fleet-wide to stop idle compaction. On the current version that was the only switch available. The context watch was supposed to take over at the limit, but it has never fired. So today nothing stops an agent from hitting the hard limit of its window.
- From version 2.1.290 on, Claude Code has an idle-compaction setting. Turning it off stops idle compaction; turning it on does nothing (the binary says so outright). That resolves the docs disagreement noted in the campaign.
- The installed version is 2.1.286. The newest available today is 2.1.310.

## What would make it wrong

- Idle compaction still happens on a box that's on the new version.
- Near-limit compaction fires somewhere other than what the meter calls 95%, or never fires.
- A setting is left that claims to do something it doesn't, or a note still describes compaction wrongly.
- Compaction can be configured from more than one place.

## Scope edges

- **In:** the version pin bump; the shared settings swap and their presence check; removing the do-nothing launch setting; correcting the notes and wording; tests for the new settings.
- **Out (later shapes):** re-grounding after compaction (shape 2); retiring the context watch, the Condense trigger, button and skill wording (shape 3); the chat divider and the cleared pending message (shape 4).
- **Agreed, not built:**
  - A box that fails to upgrade gets idle compaction back until it catches up. The upgrader's existing retries and loud alert cover it; no version-aware settings.
  - Agents running at deploy time keep today's behavior until their next session start. No forced restarts. Note this in the campaign-close handoff.
- **Tempting but no:** a Skynet-side 95% watcher; changing the meter's scale to match Claude Code's.

## Handoff notes

- Identity: blaze-box-maintainer-3. Inside the condense campaign, so the shape ends at "committed, not pushed, not deployed".
- Re-check the chosen version for the idle switch and the trigger formula before pinning; the formula was read from 2.1.302.
- No what's-new note: users won't notice this directly. Admin/infra only, so no id skill edit.
