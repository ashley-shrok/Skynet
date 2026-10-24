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

---

## Close-Out

**Closed:** 2026-10-24
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · The fleet pin moves to a version with a separate idle switch; idle compaction is off and near-limit compaction fires at the meter's 95%; wrong settings and notes are removed or corrected.
- **Shape: the fleet's harness version** — present · The pin moves from 2.1.286 to 2.1.310. The 2.1.310 binary has the idle switch, separate from the main auto-compact switch.
- **Shape: the fleet's shared harness settings and presence check** — present · "All automatic compaction off" is replaced by idle compaction off plus the lowered trigger; the presence check requires both, and requires the old setting to be gone.
- **Shape: what 95% means** — present · The trigger value fires at 950,000 tokens, checked against the 2.1.310 formula; the default is 967,000.
- **Shape: the agent launch line** — present · The do-nothing percentage is removed; the supervisor says the shared settings are the one place compaction is configured.
- **Shape: corrected explanations** — present · The meter's note, the supervisor's notes, the settings writer's reasoning, and the polling code's assumption are corrected. Two polling-test notes and a stale supervisor note were missed at first and fixed in a follow-up commit.
- **Philosophy** — present · One place, the harness's own threshold, no watcher, configuration and wording only.
- **Prior context** — present · The 2.1.290 floor is recorded next to the pin; the newest version was chosen.
- **Scope edges** — present · All in-scope items are present, including migration tests. Nothing from shapes 2-4, no watcher, no meter rescale, no version-aware settings, no what's-new note.
- **Handoff notes** — present · Version and formula re-checked against 2.1.302 and 2.1.310; committed, not pushed.
- **What would make it wrong: Idle compaction still happens on a box that's on the new version** — present · Idle off is written to every box and enforced by the presence check; the binary confirms false stops it.
- **What would make it wrong: Near-limit compaction fires somewhere other than what the meter calls 95%, or never fires** — present · The old all-off setting is removed and checked for absence; the trigger works out to exactly 950,000.
- **What would make it wrong: A setting is left that claims to do something it doesn't, or a note still describes compaction wrongly** — present · After the follow-up commit, a full repo sweep finds no wrong compaction note.
- **What would make it wrong: Compaction can be configured from more than one place** — present · Only the shared settings configure compaction.

### Additions (in the result, not in the shape)

- The presence check also flags a box that still has the old "all compaction off" setting, and the settings writer actively deletes it (a natural reading of "replaced"). — endorsed-as-drift

### Follow-ups

- The campaign-close handoff must say that agents running at deploy time keep the old behavior until their next session start. — deferred
- The context watch's header still describes it as the guard against drift; retiring it belongs to shape 3. — deferred

### Notes

One divergence (leftover wrong notes) was an unintended omission, fixed in a follow-up commit; a re-sweep found nothing else. Not evaluated by the reviewer: the 2.1.310 binary's separate "precompute" threshold path.
