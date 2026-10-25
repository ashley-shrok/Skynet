# Shape: after every compaction, the agent comes back on its full directives

**Opened:** 2026-10-25

## What this is

When an agent's context is compacted, the summary that replaces its conversation is a lossy paraphrase, and the agent's standing directives (the id skill, its role files, its identity file, its project files) get paraphrased along with everything else. This shape makes every compaction of an identity's main session end with the agent re-loading itself the same way it loads at the start of a session, in full, before it does anything else. The summary is told to leave out what those files hold, since the agent is about to read them fresh, and to end with an instruction to the agent to load itself again.

## Shape

- **Before the summary is written,** a small step tells the summarizer two things: leave out whatever the id skill, the role files, the identity file and the project files contain; and end the summary with a firm directive, in the agent's own voice, to invoke the id skill for itself under its own name before doing anything else, because without it the agent is running without its directives. The step only needs to know the agent's name.
- **The summary carries the directive.** The summary is the one channel an agent treats as its own memory, so the instruction arrives with the agent's trust rather than as an outside message. Nothing is sent to the agent after compaction.
- **The agent invokes the id skill itself.** The whole id skill arrives in full this way (tested on the current version; checked again on the new one during the build).
- **The load brings the agent's own files too.** Today the identity, role and project files reach the agent through a step that runs only when the load is typed in as a message. That step is extended so it also runs when an agent invokes the id skill itself. A re-ground then loads exactly the files a fresh start does, with the same "too large, read it" handling.
- **The id skill has a short clause for this case.** If you're loading yourself because your compaction summary told you to, don't introduce yourself again; carry on where the summary left off.
- **Every kind of compaction is covered:** Claude Code's automatic one at 95%, and the manual ones that the next shape turns into Condense. The background summary prepared at about 78% stays on. It gets the same instructions, and everything after the point it covers stays in the conversation word for word.

## Philosophy

- The agent gets back on its directives the same way it got on them in the first place. No second, parallel loading method.
- Trust comes from the agent's own summary, not from injected text. Nothing tells the agent to do something it would have reason to question.
- Never block a compaction. An agent near its limit that can't shrink stops working, which is worse than an imperfect re-ground.
- Keep it simple first and watch it. If agents turn out to skip the re-load, revisit with heavier machinery then, not now.
- Stays harness-agnostic in spirit: "leave this out and end with this directive" is something any harness's shrink step can be asked to do.

## Prior context

- Today nothing re-grounds an agent after compaction. The summary paraphrases directives, and Claude Code puts back only about the first sixth of the id skill, or none of it if other skills were used since.
- A hook after compaction can add only about 10,000 characters of text; the id skill alone is about 137,000. A hook also can't make the agent take a turn after compaction (tested: the "submit a message" option is ignored then). The supervisor can only type once a turn ends, which misses compactions in the middle of work.
- A September prototype left two compaction hooks in this box's live settings: an on-screen-only "please re-read" notice and a payload logger. Removed from t1000 on 2026-10-25; none found on workstation, thenasty or zoeybattlestation. Beelink and laptop have been offline for three weeks and weren't checked; their settings never had these hooks from the repo.
- The load step that gathers identity, role and project files already keeps itself under the 10,000-character limit and points at oversized files.

## What would make it wrong

- An agent comes out of a compaction and keeps working on paraphrased directives because nothing told it, or told it convincingly, to re-load.
- The re-load brings back the id skill but not the agent's own role, identity and project files.
- The agent re-announces itself to the user after every compaction as if it were a new conversation.
- A compaction is held up or fails because the re-ground step couldn't do its part.
- Helper agents, or Claude sessions with no identity, get a "load yourself" directive aimed at nobody.
- The summary spends its space restating what the files will say anyway.

## Scope edges

- **In:** the before-summary instructions (leave out, end with directive); extending the load step to run when the agent invokes the id skill itself; the short id skill clause; covering automatic and manual compactions; only identity main sessions.
- **Out:** renaming reset to Condense, the agent-triggered and button-triggered condense, retiring the context watch (all shape 3); how a compaction looks in the chat (shape 4).
- **Deferred:** watching how often agents actually re-load after compactions. Done with Keep an Eye for a week after the campaign ships.
- **Tempting but no:** a hook after compaction that talks to the agent; building a file list for the summarizer; turning the background summary off; a separate skill for re-grounding.

## Handoff notes

- Campaign: `campaign-condense.md` in this folder. Identity: blaze-box-maintainer-3. Shape ends at "committed, not pushed, not deployed".
- Fleet hooks are installed by the distributor's settings merge; the load step is the identity load-context script in the substrate scripts. The supervisor exports the identity name into every agent session's environment.
- Repeat the "invoke the id skill yourself, does it arrive in full" test on 2.1.310 (binary unpacked at /tmp/cc310/bin310).
- Prove end to end in a throwaway session on 2.1.310: compact, check the summary omits the files and ends with the directive, the agent invokes the id skill, the load files arrive, no re-announcement.
- Any agent-facing behavior change needs the id skill edit in the same work (that's the clause). No what's-new note: users don't see this.

---

## Close-Out

**Closed:** 2026-10-25
**Overall verdict:** closed-hit

### Shape features (conformance)

- **Before the summary is written, a small step instructs the summarizer** — present · Pre-compaction step tells the summarizer to leave out the id skill, role, identity and project files and to end with a verbatim first-person directive to invoke the id skill under its own name first; works from the identity name alone (quotes the identity file's location as a reference, not a list).
- **The summary carries the directive; nothing sent after compaction** — present · No after-compaction hook added; none in live settings.
- **The agent invokes the id skill itself, whole skill arrives in full** — present · Directive names the id skill and the agent's own name; the full-arrival retest on 2.1.310 is a run-time check, not visible in the material.
- **The load brings the agent's own files too** — present · The load step now also answers the agent's own id skill call, building the same context with the same size handling; wired in the fleet settings merge and check.
- **Short id skill clause** — present · "Re-loading after a compaction": load first, don't announce, carry on from the summary, don't act on the identity file's next action as if starting fresh (a direct consequence of carrying on from the summary).
- **Every kind of compaction covered; background summary stays on** — present · Fires on manual and automatic; nothing turns the background summary off.
- **Philosophy** — present · Same loading path as a fresh start, trust via the summary, never blocks, simple.
- **Prior context: prototype hooks removed** — present · None on t1000, workstation, thenasty, zoeybattlestation; beelink and laptop unchecked as stated.
- **Scope edges** — present · Nothing from shapes 3 or 4; no tempting-but-no items; Keep an Eye recorded.
- **Handoff notes** — cannot-verify · Committed, not pushed. The 2.1.310 retest and end-to-end proof are run-time checks with no evidence recorded in the material.
- **What would make it wrong: agent keeps working on paraphrased directives** — present · Firm verbatim first-person directive plus matching id skill clause.
- **What would make it wrong: re-load brings the id skill but not the agent's own files** — present · Load step runs on the agent's own id skill call.
- **What would make it wrong: agent re-announces itself** — present · Directive and clause both say don't.
- **What would make it wrong: a compaction is held up or fails** — present · Step catches every error and always exits cleanly.
- **What would make it wrong: helper agents or identity-less sessions get a directive** — present · Silent for helpers, no identity name, invalid names, missing identity file.
- **What would make it wrong: summary restates the files** — present · Summarizer told explicitly not to restate them.

### Additions (in the result, not in the shape)

None.

### Follow-ups

- Resume "usage limit" dialog that could leave a woken agent stuck — recorded in the campaign as must-land before close — issue
- Keep an Eye for a week on how often agents actually re-load after compaction, once the campaign ships — deferred

### Notes

No divergences. Run-time evidence for the record (from the implementer's session, not the reviewer): on 2.1.310 the agent-invoked id skill arrived in full with the load context attached; end to end, a compacted test agent re-loaded first, did not re-announce, and carried on. Without the new clause, the re-loaded test agent acted on a pre-authorized next action in its identity file mid-conversation; with the clause it did not.

### Post-close review fixes (2026-10-25)

The unbiased code review found that Claude Code doesn't mark a subagent's compaction in the pre-summary payload, so the "silent for helper agents" guard never fired; subagents and nested sessions also inherit the identity name. Fixed by having the summarizer instructions apply only when the conversation is the identity's own main session (began with its load, or with an earlier summary of one). Also: the agent-invoked load now refuses subagents and takes the first word of its argument as the name; the directive says it still holds when kept messages follow the summary (background-summary case); the pre-summary hook now runs on every compaction trigger rather than only manual and auto. Re-verified end to end on 2.1.310: a main session re-loaded after compaction without re-announcing or redoing its identity file's next action; a helper-style session's summary carried no re-load directive.
