# Shape: make the WIP indicator show when condensing, and rename condensing to compacting across the board

**Opened:** 2026-10-29

## What this is

Two changes to how an agent's conversation presents compaction. First, while a compaction is waiting to start or under way, the conversation shows the working orb with a fixed line, "Compacting the conversation…", so it never looks idle while the agent is actually busy summarising. Second, every word a user sees for this operation changes from condense to compact, and the description every agent carries of the app changes with it.

## Shape

- **When the orb shows.** The app already knows, per agent, when a compaction has been asked for or is running. That is the same knowledge that makes the memory pie say it is busy now. Whenever that knowledge is on, the orb shows, the same as it does for a turn. It starts the moment the user confirms (the app does not wait for the next status update), covers a sleeping agent being woken for the compaction, and hands straight over to the agent's follow-up turn once compaction is done.
- **What the orb is during compaction.** A plain orb, with no square inside and nothing to press. Stopping halfway through a compaction would leave it half-done. Standing rule (Ashley, 2026-10-29): any time the orb can't be tapped to stop things, it doesn't show the square. If the agent's own turn is also running (a compaction asked for mid-turn waits for the turn to end), the orb behaves exactly as it does today, and its Stop stops the turn.
- **The line beside it.** When the orb is showing only because of compaction, the line reads a fixed "Compacting the conversation…" rather than the usual step-by-step narration, which has nothing to describe here. While the agent's own turn is running, the usual narration stays.
- **The rename.** Every user-visible mention: the pie's "Compacting…", the pop-over's explanations, the "Compact conversation" button, the "Compact this conversation?" confirm and its "Compact" button, the "Couldn't compact" errors, the chat divider "Conversation compacted · <time>", and screen-reader labels. Applies to agent conversations and to each agent's pie in relay rooms.
- **The agent-facing description.** The app description every agent loads is updated to say compacting, and to mention that the orb shows while compacting.
- **No what's-new note** (Ashley, 2026-10-29: "No note").

## Philosophy

The conversation should never look idle while the agent is busy. The word change is about the user's vocabulary matching the agent's own and the harness's, so one word is used everywhere. Internal names in the code stay as they are, because renaming them gives users nothing and puts the wiring between the server and the app at risk.

## Prior context

Today, pressing Condense makes the pie read "Condensing…", but the conversation otherwise looks idle until compaction finishes and the agent takes its follow-up turn. That is because compaction is a built-in command, not a turn, so the signals that light the orb never fire. This was confirmed in a real transcript from 2026-10-29: 35 seconds with nothing lighting the orb. Automatic compaction at 95% happens in the middle of a turn and already shows the orb. The machinery underneath (the request and in-progress markers, the supervisor's log) already says "compact".

## What would make it wrong

- The orb flickers off between the compaction finishing and the follow-up turn starting, or stays stuck on after everything has finished.
- The orb shows the square (or anything pressable) at any moment a tap couldn't stop something, during compaction or otherwise.
- The "Compacting the conversation…" line replaces the narration of a real turn.
- Any user-visible "condense" survives anywhere, or the agent description still teaches the old word.
- A compaction that never starts leaves the orb on forever.

## Scope edges

- In: the orb and line during a requested compaction; every user-visible word; screen-reader text; relay-room pies; the agent description.
- Out: renaming internal code names, the server request address and data fields; changing how compaction itself works; anything on automatic compaction at 95% (it is already covered by the turn).
- Tempting but no: a progress estimate for compaction.

## Handoff notes

- bifrost-box-maintainer-4 is doing the work, on the shared branch.
- The orb, its Stop and the narration line all live in the agent-conversation view. The "is compacting" knowledge already exists per agent and feeds the pie through the task pill's memory hook; the relay-room badges have their own copy.
- The agent description is the distributed id skill source in the repo, never the installed copy.
- The tests that assert the old words need updating alongside.

---

## Close-Out

**Closed:** 2026-10-29
**Overall verdict:** closed-hit

### Shape features (conformance)

- **When the orb shows** — present · Driven by the shared "is compacting" knowledge (status poll or a just-accepted request), so pie, relay badges and orb switch together; on at confirm; covers a sleeping agent; held until the follow-up turn lights it.
- **What the orb is during compaction** — present · Compacting-only orb is plain, no square, nothing to press; a running turn keeps today's orb and Stop.
- **The line beside it** — present · Fixed "Compacting the conversation…" (short "Compacting…") only when no turn runs; narration untouched otherwise and only requested for a turn.
- **The rename** — present · Pie, pop-over, button, confirm, error, divider and screen-reader label all say compact; relay pies share the pie; no user-visible "condense" left.
- **The agent-facing description** — present · Says compact throughout, mentions the orb while compacting and lists compaction among times a tap can't stop; one "condense" kept only as a phrase users might say.
- **No what's-new note** — present · None added.
- **Philosophy: internal names stay** — present · Internal names, request address and data fields unchanged.
- **Scope edges: out items** — present · Compaction mechanics, automatic compaction and progress estimates untouched.
- **Handoff: tests updated** — present · Old-word tests updated; new test file covers the orb during compaction.
- **What would make it wrong: orb flickers off between compaction end and follow-up turn, or stays stuck on** — present · Held until the turn starts, 15 seconds at most.
- **What would make it wrong: square or anything pressable when a tap couldn't stop something** — present · Stop needs a running turn with no send in flight.
- **What would make it wrong: compacting line replaces a real turn's narration** — present · Fixed line only when no turn runs.
- **What would make it wrong: user-visible condense survives or agent description teaches the old word** — present · None found.
- **What would make it wrong: a compaction that never starts leaves the orb on forever** — present · Request flag expires after two minutes; hold lasts 15 seconds at most.

### Additions (in the result, not in the shape)

- The 15-second hold limit and diagnostic log lines — implementation of agreed hand-over and never-stuck guard — endorsed-as-drift
- The commit includes the shape's own planning files — endorsed-as-drift

### Follow-ups

None.

### Notes

Reviewed the latest commit against its parent by reading only. Neither addition needed a question to the user.
