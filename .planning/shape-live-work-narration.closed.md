# Shape: A line next to the work indicator that says where the agent is in the job

**Opened:** 2026-10-25
**Campaign:** live-work-narration (one shape)

## What this is

While an agent is working and you have its conversation open, a short line appears next to the spinning work indicator. It says where the agent is in the job: what's already behind it, what it's doing now, and what's next. It's written so that someone glancing at it cold, with no other context, can tell how far along the agent is. A small, fast model writes the line from whatever started the turn plus the agent's recent steps. It runs on the box the agent lives on, on the fleet's existing subscription, and only while someone is watching that conversation.

## Shape

- **When it's live.** Only while the conversation view shows the work indicator, meaning the agent is mid-turn. The line sits beside the indicator and disappears with it. Nothing shows until the turn's first line has been written; there's no placeholder text.
- **When a new line is written.**
  - The first line of a turn comes once the agent has taken a few steps (about three), so there's something real to describe.
  - After that, a new line comes only when the agent has taken new steps *and* about 45 seconds have passed since the last line. The 45 seconds is a starting value, to be tuned after real use.
  - Opening a conversation where the agent is already mid-turn writes a line right away.
  - A long single step (a build, a test run) produces no new lines, because nothing has moved.
- **What the narrator sees.**
  - Whatever started the current turn: your message, a wake-up, a message from another agent, or a scheduled task's prompt.
  - The line it wrote last time *in this turn*.
  - The agent's last couple of dozen steps from its main transcript, including what each helper agent was asked to do.
  - Each turn starts fresh: nothing from the previous turn carries over.
- **What it writes.** Two versions of the same line in a single call:
  - a short one, about 9 words at most;
  - a fuller one, about 17 words at most.

  Both are plain present tense, with no "I", no file names or code jargon, and no repeating the task title, since that's already shown at the top of the conversation. Each leads with what's happening now and adds what's behind or ahead when that helps place it.
- **What you see.** The fuller version when it fits on one line in the space available. Otherwise the short one. It never wraps and never gets cut off. A new line replaces the old one with a quick fade. There's no timer and no staleness cue.
- **Where it runs.** On the agent's own box, over the connection the server already holds to that box for the open conversation. It uses that box's Claude and the fleet's subscription token, with the small fast model, thinking off, no tools, and none of the fleet's settings, hooks or extras loaded.
- **Sharing and limits.**
  - Every tab watching the same agent shares one narrator and sees the same line.
  - Each box runs at most one narration call at a time, so several open conversations never stack up memory-heavy calls.
  - When nobody has the conversation open, nothing runs.
- **Failure.** If a narration call fails or is slow, the previous line stays (or nothing shows, if there wasn't one), and nothing else in the conversation view is affected. Failures are logged on the server.

## Philosophy

- The line exists to show **how far along** the job is. A play-by-play of steps doesn't do that: "rewriting the function" means nothing without the path that led there, which is why the line has to make sense on its own.
- Accuracy comes before polish. The line should only claim what the steps actually show. What's next is phrased as the plan, never as something already done.
- The agent is never asked to do anything differently. It gets no extra instructions, nothing extra in its context, and nothing added to its transcript. Narration watches from outside.
- It costs nothing when nobody is looking, and it never becomes real API spend.
- It's quiet. One line, no timer, no history, no extra surfaces.

## Prior context

- Today the work indicator is a spinning image with no text. The server already follows each open conversation's transcript live and already reads the agent's task list from its box over the same connection.
- The free signals were looked at and set aside as the source of the line: the agent's own short descriptions of commands, fill-in sentences built from tool names, and the task list. They describe mechanics, not where the agent is in the job.
- Having agents write their own status line was also set aside, because of worry about adding load to the agents' thinking.
- Measurements, from the concept beat, on t1000:
  - A one-shot call through Claude Code on the subscription takes about 1.7 seconds and about 0.85 seconds of CPU, plus roughly 245 MB of memory for the couple of seconds the call runs.
  - Thinking must be off; with it on, each call took 12 to 39 seconds.
  - The minimal "bare" mode can't be used, because it ignores subscription auth.
  - The Agent SDK is no faster, because it runs the same program underneath.
  - At about one line a minute while agents work, narration is roughly half a percent of the agents' own usage.
- Line length was tested in the live app with a console snippet: 9 words is the most that fits on one line on a phone, 17 on desktop.

## What would make it wrong

- The line claims progress that didn't happen: "tests pass" when they haven't run, "shipped" when nothing shipped.
- The line can't be understood without having watched the conversation; it reads like a fun fact about one step rather than a position in the job.
- It flickers: lines changing faster than they can be read.
- It costs real money, or it runs for conversations nobody has open.
- Opening several conversations on a small box makes the box struggle.
- It changes how the agent itself behaves or what lands in the agent's transcript.
- A line from an earlier turn shows up during a new one.
- A narration failure breaks or slows anything else in the conversation view.

## Scope edges

- **In:**
  - Agent conversations, on desktop and phone.
  - Every box that hosts agents, including Stacy's install, always on, with no switch.
  - One shared narrator per watched agent.
  - The once-a-minute pacing (45 seconds to start).
  - The two-length line.
- **Out:**
  - Relay rooms.
  - The sidebar and any other surface.
  - Looking inside helper agents' own work.
  - A history or trail of past lines.
  - Timers and staleness cues.
  - Any on/off switch.
  - Narrating when nobody's watching.
  - Asking agents to narrate themselves.
- **Deferred:**
  - Tuning the pacing and the wording after real use.
  - Showing the line anywhere else.
  - A per-user switch, if anyone finds it distracting.
- **Tempting but no:**
  - Running the narrator centrally on the Skynet server.
  - An always-running narrator on each box.
  - Paid API calls.

## Handoff notes

- Implementing identity: verse-box-maintainer-3 (box-maintainer role), on the shared working branch.
- The working test invocation is in the identity workspace's narration-test folder: a one-shot call with the fleet's token, user settings skipped, no tools, no MCP, thinking off, a custom system prompt, and session saving off. The length-test console snippet is there too.
- The narrator prompt is a starting point and needs a little tuning. Ask for both lengths in one structured reply.
- Ship notes: Stacy's ping should mention the feature and the small extra subscription usage. It needs a user-facing what's-new note (approved by Ashley) and a matching update to the agent-facing guide's description of the work indicator.

---

## Close-Out

**Closed:** 2026-10-25
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · While an agent is mid-turn, a one-line status sits next to the work indicator. A small fast model writes it on the agent's own box using the fleet subscription, and only while someone has that conversation open.
- **Shape: When it's live** — present · The line shows only while the indicator is up and goes away with it. Nothing shows until the turn's first line exists; there's no placeholder.
- **Shape: When a new line is written** — present · The first line comes after three steps. Later lines need new steps and 45 seconds since the last line, and that interval is one adjustable value. Opening a conversation mid-turn writes a line once the history replay settles (about 1.5 seconds), or hands over the existing shared line straight away. A long single step writes no new line.
- **Shape: What the narrator sees** — present · The narrator gets what started the turn (any kind of starter, with reminders stripped), its own earlier line from this turn, and the last 24 main-transcript steps, including what each helper was asked to do. Everything resets on a new prompt and again when a turn ends or is interrupted.
- **Shape: What it writes** — present · One call returns both lengths, at most 9 and at most 17 words, in the agreed voice. The server trims any reply that runs over the limits.
- **Shape: What you see** — present · The fuller line when it fits on one line, otherwise the short one. It never wraps, a new line fades in over the old, and there's no timer.
- **Shape: Where it runs** — present · On the agent's box, over the existing connection, using that box's Claude and its stored subscription token, with the small fast model. Thinking is off. There are no tools, settings, hooks, plugins, project instruction files or memory, and the session isn't saved.
- **Shape: Sharing and limits** — present · One shared narrator per agent. Each box runs one call at a time. The narrator is removed when the last tab leaves, and nothing runs unless some tab is showing the indicator.
- **Shape: Failure** — present · The previous line stays (or nothing shows), the failure is logged, and the next try waits a full interval. Nothing else in the view is touched.
- **Philosophy** — present · The line is about how far along the job is, accuracy comes first, the agent itself is untouched, it costs nothing when nobody's watching, and it stays one quiet line.
- **Prior context (commitments)** — present · Thinking off, no bare mode, subscription auth. The line is built by the model from transcript steps, not from the free signals, and agents don't write their own.
- **What would make it wrong: the line claims progress that didn't happen** — present · The instructions say to claim only what the steps show and to state the next step as a plan. Failed steps are passed along as failures.
- **What would make it wrong: the line can't be understood cold** — present · The instructions are written for a cold reader. The narrator gets what started the turn plus its previous line.
- **What would make it wrong: it flickers** — present · At least 45 seconds between lines.
- **What would make it wrong: it costs real money or runs unwatched** — present · API keys and alternative endpoints are removed from the call, so only the subscription token is used. Calls run only while a visible tab is showing the indicator.
- **What would make it wrong: several conversations make a small box struggle** — present · Each box runs one call at a time, and a queued call is skipped if its turn moved on.
- **What would make it wrong: it changes the agent or its transcript** — present · The call runs separately with no session saving, and nothing is written to the agent's terminal or transcript.
- **What would make it wrong: an earlier turn's line shows in a new one** — present · The line is cleared on turn end, on interrupt and on a new prompt, in every tab. A late result from an ended turn is thrown away.
- **What would make it wrong: a failure breaks or slows the view** — present · Calls run in the background with a time limit, and errors are caught and logged.
- **Scope edges: In** — present
- **Scope edges: Out** — present · None of the out-of-scope items is there.
- **Scope edges: Tempting but no** — present · Nothing runs centrally, there's no always-running narrator, and there are no paid API calls.
- **Handoff notes (ship notes)** — present · The agent-facing guide is updated. At the user's request there's no what's-new note, and the Stacy ping waits for deploy.

### Additions (in the result, not in the shape)

- If even the short line doesn't fit the space, the view trims it visibly. The server also trims any reply over the word limits. — endorsed-as-drift
- "Someone is watching" means a visible tab showing the indicator; a hidden tab doesn't count. — endorsed-as-drift
- After a failed or unusable call, the next try waits a full interval. — endorsed-as-drift

### Follow-ups

- Tune the pacing and the narrator's wording after real use. — deferred
- Send Stacy the ship note (the feature plus the small extra subscription usage) at deploy time. — deferred

### Notes

Clean pass on the second review. The first review flagged one divergence: the narrator call loaded the box's normal settings. A survey of the agent boxes showed those settings can enable plugins, remote control at startup and push notifications. So the call now skips every settings file and reads the token on the box itself, as the shape said. The user also ruled that no what's-new note is needed.

---

## Post-close amendment (2026-10-25)

Ashley pointed out that the harness signs in many ways: the year-long subscription token, the shorter normal login, an API key, or AWS Bedrock (most of Stacy's boxes). Reading only the token would leave the narrator without a line on API-key and Bedrock boxes. Decision ("we have to go B"): **the narrator signs in however the agent does**. It carries over only the sign-in parts of the agent's settings (the environment entries for the token, API key, Bedrock or Vertex and AWS or Google, proxies, and the credential-helper settings) and nothing else. Plugins, remote control, push notifications, hooks and the model choice still stay behind. This replaces "it never becomes real API spend": on a paid sign-in, narration costs a small extra on top of what the agent itself costs, paid by whoever pays for the agent. Stacy's ship notice has to say so.
