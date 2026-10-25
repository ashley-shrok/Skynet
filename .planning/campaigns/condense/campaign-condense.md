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

- **[declared] shape-compaction-groundwork** — Upgrade Claude Code fleet-wide to a version with a separate idle-compaction switch; turn idle compaction off; keep near-limit compaction on with its trigger at 95% (aligned with what the app's context meter calls 95%); remove the setting that never did anything and the wrong comments around it. — closed
- **[declared] shape-reground-after-compaction** — After every compaction, put the current id skill, role file(s), identity file and project file back into the agent's context in full, and tell the summarizer to leave out what those files hold. — in_progress
- **[declared] shape-condense-operation** — Replace reset with Condense end to end: agent-triggered request file now compacts instead of restarting; the button next to the context meter gets the new name and an inward-arrows icon; the id skill, build skill and campaign skill speak Condense; the broken context watch and its 90% nudge are retired (or replaced, depending on what groundwork settles); what's-new note. — in_progress
- **[declared] shape-compaction-divider** — In the chat view, a compaction shows as a slim divider with the summary collapsed and expandable instead of a user bubble; fixes the summary wrongly clearing a pending sent message. — in_progress

## Other work

- Cross-session "load more" (paging back into an earlier session's transcript) — dropped: with Condense keeping one continuous transcript, only crashes produce new sessions; revisit only if a second harness arrives. — dropped
- The app's context meter scales usage against an older auto-compaction buffer figure; check during groundwork that "95%" means the same thing to the meter and to the trigger. — done (the meter reads the raw 1M window; the trigger is tuned to fire at 950,000 tokens, and the window it's measured against is pinned so it can't drift)
- **Campaign-close handoff:** agents running at deploy time keep today's no-compaction behavior until their next session start (agreed: no forced restarts). — noted-only (say it at campaign close)
- **Campaign-close handoff, needs Ashley's call:** during rollout each healthy box gets the new settings a few minutes before its new harness version, and any agent started in that gap runs the old version with idle compaction on until its next restart. That's the same kind of exposure Ashley accepted for boxes that fail to upgrade; lean: accept and mention it. — noted-only (ask at campaign close)
- **Campaign-close deploy check:** on the first upgraded box, confirm from Claude Code's own debug output that the window it measures against is 980,000 and the trigger 950,000 for every model the fleet uses, before relying on it fleet-wide. — noted-only (do at campaign close)

- **Must land before campaign close (found by Katniss, confirmed in code):** from 2.1.304 on, resuming a session that has been quiet a while can show a blocking "this will use N% of your usage limit" dialog, which would leave a supervisor-woken agent stuck. The resume-threshold settings don't suppress it; only Claude Code's own "never ask again" flag in its per-user state file does. Write that flag fleet-wide without disturbing the rest of the file, and prove it on a real old session (dialog appears without the flag, gone with it) before relying on it. — open
- **After the campaign ships:** run Keep an Eye for a week on how often agents actually re-load themselves after a compaction (Ashley's call, 2026-10-25). — noted-only (do after campaign close)
- Leftover September prototype compaction hooks removed from t1000's live settings; none on workstation, thenasty, zoeybattlestation; beelink and laptop offline, unchecked. — done

## Lingerers (explicitly approved)

## Open questions

- ~~Background summary~~ — settled in shape 2: it gets the same instructions and stays on; work after its cut-off stays word for word.

- ~~Re-grounding size problem~~ — settled in shape 2: the summary tells the agent to invoke the id skill itself (arrives in full); no hook carries the files.
- ~~Mid-turn compaction~~ — settled in shape 2: the directive rides in the summary, which is in place before the agent's next step even mid-work.
- ~~Who pulls the 95% trigger~~ — settled in groundwork: Claude Code's own threshold; the context watch is retired in shape 3.
- ~~How Claude Code gets upgraded on fleet boxes~~ — settled in groundwork: Skynet's pinned version moves every box on the next sweep (pin now 2.1.310). Turning off the idle switch really stops idle compaction; turning it "on" does nothing, so the docs don't conflict.
