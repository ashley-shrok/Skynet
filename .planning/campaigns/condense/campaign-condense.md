# Campaign: Condense — one story for how agents get more room

**Opened:** 2026-10-24
**Status:** in_progress
**Workspace:** .planning/campaigns/condense/ (in the Skynet repo)

## Concept

Today two half-working mechanisms shrink an agent's context: the id skill's "reset" (save notes to the identity file, kill the session, start a fresh one — which breaks scrolling back in the chat) and the harness's own compaction (which we believed was switched off but isn't, which also compacts idle sessions for no good reason, and whose summary shows up in the chat as a giant user bubble). The 90% context watch that was supposed to drive resets has never fired once. This campaign replaces both with a single Skynet-owned operation called **Condense**: the agent's context is shrunk and the agent carries on as the same agent, in the same continuous conversation. Skynet owns the contract — when it happens, and that the agent comes out of it re-grounded in its current id skill, role file(s), identity file and project file, in full rather than as a lossy summary. The harness supplies only the "shrink the context" step; on Claude Code that's its own compaction, isolated so a different harness (or Skynet as its own harness) could do that step differently later. Condense can be triggered by the agent itself (dropping a request file, as reset works today), by the user from the renamed button next to the context meter, or automatically at 95% context. There is no mandatory save step before condensing — the summary carries the session, and agents can still deliberately write to their identity file when it serves the work (task record for other agents, campaign structure). "Reset" disappears as a concept and as a word, because nothing ever goes back to zero.

## Success criteria

- An agent gets more room only through Condense — never by being restarted into a fresh session — whether the agent asks for it, the user presses the button, or it fires automatically at 95% context.
- Idle compaction never happens; nothing compacts an agent that isn't near its limit unless the agent or the user asked.
- After any compaction, however triggered (including one the harness starts on its own), the agent has the current id skill, its role file(s), its identity file and its project file in context in full, and the compaction summary does not restate what those files hold.
- The chat shows one continuous history across a condense: you can scroll and load back past it, and the condense appears as a slim divider with the summary available on demand — no giant user bubble, and no wrongly-cleared pending message.
- The word and idea of "reset" are gone from the app (button label and icon), the id skill, and the skills that lean on it (build, campaign); Condense replaces it everywhere.
- The Claude-Code-specific parts are confined to the "shrink the context" step and its hooks; the rest of the contract reads as Skynet's.
- No dead machinery left behind: the never-firing context watch, the setting that did nothing, and the stale comments about them are gone or replaced by something that works and complains loudly when it can't.

## Shapes

Ordering: groundwork first (everything else assumes compaction behaves as configured), then re-grounding (Condense is unsafe without it), then the operation itself, then the chat view.

- **[declared] shape-compaction-groundwork** — Upgrade Claude Code fleet-wide to a version with a separate idle-compaction switch; turn idle compaction off; keep near-limit compaction on with its trigger at 95% (aligned with what the app's context meter calls 95%); remove the setting that never did anything and the wrong comments around it. — in_progress
- **[declared] shape-reground-after-compaction** — After every compaction, put the current id skill, role file(s), identity file and project file back into the agent's context in full, and tell the summarizer to leave out what those files hold. — in_progress
- **[declared] shape-condense-operation** — Replace reset with Condense end to end: agent-triggered request file now compacts instead of restarting; the button next to the context meter gets the new name and an inward-arrows icon; the id skill, build skill and campaign skill speak Condense; the broken context watch and its 90% nudge are retired (or replaced, depending on what groundwork settles); what's-new note. — in_progress
- **[declared] shape-compaction-divider** — In the chat view, a compaction shows as a slim divider with the summary collapsed and expandable instead of a user bubble; fixes the summary wrongly clearing a pending sent message. — in_progress

## Other work

- Cross-session "load more" (paging back into an earlier session's transcript) — dropped: with Condense keeping one continuous transcript, only crashes produce new sessions; revisit only if a second harness arrives. — dropped
- The app's context meter scales usage against an older auto-compaction buffer figure; check during groundwork that "95%" means the same thing to the meter and to the trigger. — noted-only (folded into shape-compaction-groundwork)

## Lingerers (explicitly approved)

## Open questions

- **Re-grounding has a size problem.** Claude Code caps what a hook can put into context at about 10,000 characters; the id skill alone is about 120,000 and the box-maintainer role file about 20,000. "Verbatim, in full" therefore can't go through a hook as-is. Candidates: have the supervisor re-run the identity load after each compaction (which puts the whole id skill in context the same way loading does), or the hook points at files to read. To settle in shape-reground-after-compaction.
- **Mid-turn compaction.** Automatic compaction can fire in the middle of an agent's work; anything the supervisor types into the session only lands after that turn ends. Whether that gap matters, and how the re-grounding covers it, to settle in shape-reground-after-compaction.
- **Who pulls the 95% trigger** — the harness's own threshold setting (simplest, works mid-turn) or a Skynet watcher that sends the compact command when the agent is idle (harness-agnostic, but rebuilds the watcher that never worked). Lean: harness threshold, with the watcher retired. To settle in shape-compaction-groundwork.
- **How Claude Code gets upgraded on fleet boxes** and whether the newer idle-compaction switch behaves as documented (the two doc pages disagree on what turning it on means).
