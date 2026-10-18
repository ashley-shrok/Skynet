# Shape: the interrupt button does one honest thing in each situation

**Opened:** 2026-10-18

## What this is

The interrupt button in the chat view is redesigned so that one press always does the honest thing for the situation it lands in:
- **While a message is still being delivered,** the button is unavailable.
- **If the agent is stopped before it has done anything with the latest message,** the message is cancelled. It disappears from the conversation and the user gets their words and attachments back.
- **If the agent had already started,** the agent stops, the message stays, and an "Interrupted" reply from the agent confirms it.

The harness's own compose box is never left holding stale text, and the harness is never shut down by a press. Every decision comes from the session transcript, never from reading the harness's screen.

## Shape

**One press, one decision, one verdict.** A press goes to the harness side, which:
1. sends Escape,
2. waits briefly (up to about a second and a half) to see what the transcript records,
3. reaches one of three verdicts and reports it back to the chat view:
   - **Stop:** the harness wrote its "interrupted" line.
   - **Cancel:** no interrupted line was written, and nothing from the agent follows the latest message. In this case the harness side also sends one Ctrl-C to clear the words the harness put back in its own compose box.
   - **Nothing to do:** anything else, for example the agent was already idle. Nothing more is sent.

A message already treated as cancelled is never treated as cancelled again, so a second press can't send a stray Ctrl-C.

**The three situations, as the user sees them.**
- **Still being delivered:** the message has not landed in the transcript yet.
  - The button is greyed out, with no label or tooltip changes.
  - It stays that way through a dormant agent's wake-up, however long that takes.
- **Cancel:**
  - Until the verdict arrives, the bubble stays exactly as it was, with no in-between look.
  - Then the bubble disappears.
  - The words and any attachments come back into the compose box. If the user has already started typing something new, they go into a new queued-message box instead, so nothing is overwritten and nothing is lost.
- **Stop:**
  - The user's bubble stays, because the agent really received it.
  - The harness's interrupted line (either version, plain or "for tool use") appears as an ordinary agent-side bubble that says just "Interrupted". It is read aloud in voice mode like any agent bubble.
  - The work indicator turns off when that line is the latest thing in the conversation.

**After the live moment, the transcript decides.** Nothing extra is stored anywhere.
- A message the harness skipped over (the next message attaches to what came before it) stays hidden, on reload and forever.
- If the harness restarts before the next message, it revives the cancelled message and the agent then really has it. The transcript shows this, and the bubble comes back.
- A reload in the gap between a cancel and the next message shows the bubble, because the transcript can't yet say which way it will go.
- The harness's interrupted line is never mistaken for a message the user sent. In particular, it never counts as the delivery of a message still in flight.

**Several open views.** When the same conversation is open in more than one place, a cancel makes the bubble disappear everywhere. The words come back only where the button was pressed.

**Diagnosability.** Every decision point is logged with enough context to reconstruct a misfire afterwards: the press, the wait, the verdict and why, the clear, the restore, and the transcript-based hiding.

**The agents' guide to the app** is updated to describe what the button now does in each situation.

## Philosophy

- What the chat view shows must match what the agent actually has. Hiding a message the agent received is as wrong as showing one it never got.
- The transcript is the only source of truth for deciding. The harness's screen is never read. This keeps the design valid for a future headless harness.
- One press never risks the harness. Escape stops and rewinds without ever arming the harness's exit. The only Ctrl-C is the single clear in a cancel, which is safe because presses are already spaced at least two and a half seconds apart.
- Cancelled words are never lost.
- No guessing in place of knowing. Where the transcript can't yet tell (the gap before the next message), the view shows what the transcript shows rather than inventing a stored belief.

## Prior context

- Today the button sends a single Ctrl-C, is never disabled, and is limited to one press every two and a half seconds on both ends.
- Pressing it in the quick-cancel window leaves the words in the harness's own compose box, where they silently ride along with the next send.
- The cancelled message's bubble survives reloads, even though the agent never saw it.
- The harness's interrupted line shows up raw, as if the user had typed it, and also wrongly counts as delivery of a message still in flight.
- After an interrupt the work indicator stays on, because the harness doesn't send its "turn finished" signal for interrupts.
- Original design conversation: Xenon, 2026-10-05.
- Research and live proving: Chorus, 2026-10-16 and 2026-10-18.
  - The proving kit's 14 scenarios all pass with Escape and transcript-only decisions, on Opus with the fleet's launch settings.
  - Sending two Ctrl-Cs to an idle harness shuts it down, which ruled out the original "always send two" idea.
  - Across all 499 transcripts on this box, the dead-end shape identifies every real cancellation (26 of them) and none of the answered messages.
- A harness bug was found and reported (https://github.com/anthropics/claude-code/issues/103213): the cancel lives only in the harness's memory, so a restart before the next message revives it. This is why the design follows the transcript instead of storing a note.

## What would make it wrong

- A press ever shuts the harness down, opens its Rewind menu, or leaves text in its compose box.
- The chat view hides a message the agent has, or shows one it never got once the transcript has settled.
- Cancelled words or attachments disappear without coming back somewhere.
- Restored words overwrite something the user was in the middle of typing.
- Any decision depends on what the harness's screen shows.
- The "Interrupted" reply looks like something the user said, or the work indicator keeps running after a confirmed stop.
- A misfire can't be explained from the logs.

## Scope edges

- **In:**
  - the chat view's interrupt button and the harness-side handling of its press
  - cancel and stop rendering, live and on reload
  - the work indicator after a stop
  - the in-flight delivery mismatch fix
  - logging
  - the agents' app guide update
- **Out:**
  - the raw terminal view's own interrupt, which stays a direct Ctrl-C
  - queued follow-ups, which an interrupt doesn't cancel (the harness starts them after the stop)
  - relay rooms
- **Deferred:**
  - closing the revive-on-restart gap, which waits on the harness bug fix
- **Tempting but no:**
  - storing a cancellation note
  - editing the harness's transcript
  - reading the harness's screen
  - dynamic button labels or tooltips
  - an in-between "cancelling" look

## Handoff notes

- Implementer: Chorus (box-maintainer).
- The research findings and the proving kit (test driver, scenarios, logs, resume tests) are in Chorus's workspace under `interrupt-proof/`. Re-run the kit against the real implementation where possible.
- Notes with exact timings and harness behaviors are in Chorus's identity file.
- Known harness behaviors that matter:
  - A cancel writes nothing to the transcript.
  - The next message attaches to the point before the cancelled one.
  - A cancelled first-ever message in a harness session doesn't form a dead end. This is an accepted gap, because the first message is almost always the agent-loading command.
  - The interrupted line is written immediately on a stop, including when a long reply is mid-stream.
  - Two Escapes in quick succession on an idle harness open its Rewind menu.
- Role rules apply: commit and test locally, and stop before push. Pushing and deploying each need their own greenlight.

---

## Close-Out

**Closed:** 2026-10-18
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · All three situations are built: greyed out while delivering, cancel with the bubble removed and words given back, stop with an "Interrupted" reply; the harness's compose box is cleared on cancel; decisions come only from the transcript.
- **Shape: one press, one decision, one verdict** — present · Escape, then a wait of up to 1.5s for the interrupted line, then stop / cancel / nothing-to-do; one Ctrl-C only on cancel; the verdict goes back to the pressing view.
- **Shape: a message already cancelled is never cancelled again** — present · An already-cancelled prompt gives "nothing to do", so no second Ctrl-C.
- **Shape: still being delivered** — present · Disabled while any send is still being delivered, no label or tooltip change; a dormant wake uses the existing widened delivery window.
- **Shape: cancel as the user sees it** — present · Bubble unchanged until the verdict, then hidden; words into the empty compose box or a new queued box; attachments fetched back and re-staged on the same box.
- **Shape: stop as the user sees it** — present · User bubble stays; both marker versions show as an agent-side "Interrupted" bubble read aloud in voice mode; work indicator held off while it is the latest message.
- **Shape: after the live moment, the transcript decides** — present · Sibling dead ends hidden on replay; revive unhides; nothing stored; reload in the gap shows the bubble; the interrupted line never counts as delivery.
- **Shape: several open views** — present · Hide sent to every open view; words come back only where pressed.
- **Shape: diagnosability** — present · Press, verdict with reason and wait, clear, fan-out, transcript hide and revive, restore target and attachment results are logged.
- **Shape: agents' guide updated** — present · Describes all three situations, the idle case and several views.
- **Philosophy** — present · Transcript-only decisions; Escape for the stop; the only Ctrl-C is the single clear; no stored belief.
- **Prior context commitments** — present · Each prior defect addressed; 2.5s press spacing kept.
- **What would make it wrong: a press shuts the harness down, opens Rewind, or leaves text in its compose box** — present · One Escape per press, presses 2.5s apart, one Ctrl-C only after a cancel.
- **What would make it wrong: the view hides a message the agent has or shows one it never got once settled** — present · Hidden only on the transcript's dead end or a live cancel; unhidden on revive.
- **What would make it wrong: cancelled words or attachments disappear without coming back** — present · Words come back; attachments fetched back and staged, failures logged by name.
- **What would make it wrong: restored words overwrite what the user is typing** — present · Primary box only when empty of text and attachments; otherwise a new queued box.
- **What would make it wrong: any decision depends on the harness's screen** — present · Only transcript lines are read.
- **What would make it wrong: "Interrupted" looks like the user's words, or the indicator keeps running after a stop** — present · Agent-side bubble; indicator held off and the finished-working status set.
- **What would make it wrong: a misfire can't be explained from the logs** — present · Every decision point logged with prompt id, verdict, reason and wait.
- **Scope edges: In** — present · Every in-scope item present.
- **Scope edges: Out** — present · Terminal view interrupt untouched; queued follow-ups not cancelled; relay rooms unaffected.
- **Scope edges: Deferred** — present · Revive gap not closed; the view follows the transcript.
- **Scope edges: Tempting but no** — present · No stored note, no transcript edits, no screen reading, no dynamic labels, no in-between look.
- **Handoff: re-run the proving kit against the real implementation** — cannot-verify · Not re-run; the kit drives a harness directly while the logic lives in the server, so a real re-run needs the deployed build.

### Additions (in the result, not in the shape)

- On a cancel as well as a stop, the harness's own "finished working" status is set, so the work indicator goes off everywhere it is shown (including the sidebar row) — endorsed-as-drift
- The agents' guide told agents to ask before acting on an unanswered message found after a restart — removed (the user: the bubble coming back already shows the agent has it; the agent shouldn't have to make up for the harness bug)
- Words given back from a cancelled voice message drop the hidden "sent by voice" tag — endorsed-as-drift

### Follow-ups

- Re-run the proving kit's scenarios against the deployed build — deferred (after deploy)
- Close the revive-on-restart gap once anthropics/claude-code#103213 is fixed — deferred

### Notes

Harness-injected prompts the view never shows (slash commands, task notifications) can also be cancelled by a press in the rewind window; nothing visible is hidden and nothing is given back. The delivering-state greying uses the existing delivery window (about 220s on a dormant wake), after which the send counts as failed and the button comes back.
