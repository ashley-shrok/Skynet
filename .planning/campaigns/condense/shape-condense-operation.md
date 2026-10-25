# Shape: replace reset with Condense, end to end

**Opened:** 2026-10-25

## What this is

Today an agent gets more room by being reset: it saves notes, its session is killed, and a fresh one starts. This shape replaces that, everywhere, with Condense: the agent's conversation is compacted in place, it stays the same agent in the same conversation, and it is guaranteed to take a turn afterwards just as a reset guaranteed one. Users press **Condense conversation**; agents know the same thing as compaction. The never-working context watch and its 90% nudge are retired with it.

## Shape

- **One way in: the condense request.** Every condense goes through a request the supervisor carries out. The agent drops it itself, where today it drops the restart request; the button drops the same request through the app. Claude Code's own automatic compaction at 95% stays as it is and needs nothing from this.
- **The supervisor carries it out.** If the agent is asleep, it wakes it, the same way pressing reset on a sleeping agent does today. Once the agent is at rest at its prompt, the supervisor tells the harness to compact, passing along any guidance the user typed, and straight after types the after-compaction nudge. Claude Code holds a message typed during a compaction and delivers it the moment the compaction lands (verified on the new version), so the nudge always starts a turn.
- **The nudge is a system event, never a user message.** It comes in the same marked envelope as wake-ups and relay messages, named as delivered by the supervisor, and says, in substance: compaction done; this is not from the user and answers nothing you asked; re-load yourself, then carry on with work you were already cleared to do; if you were waiting on the user, keep waiting. The same generic wording every time, with no per-request note. An agent that compacted at a shape boundary carries its own plan for what's next in the summary.
- **The button.** In the agent memory pop-over (and the same pop-over on relay-room badges), **Start fresh** becomes **Condense conversation** with an inward-arrows icon. The pop-over's words explain that agents can only hold so much of a conversation, that condensing summarises it to give the agent more room, and, when nearly full, that at 95% the agent condenses on its own, so condensing at a good stopping point loses less mid-task. The confirm asks "Condense this conversation?", says the agent summarises everything so far to make room and carries on as the same agent in the same conversation, and that anything typed in the box guides what the summary keeps. The button's action reads **Condense**.
- **While it condenses.** The meter says "Condensing…" until the compaction has landed in the conversation record. The composer stays usable; anything the user sends waits and reaches the agent afterwards. No lock-out overlay.
- **The restart machinery goes.** The supervisor's restart-into-a-fresh-session path, the "recycling" state the app tracks and shows (overlay, disabled composer, held conversation), the app route that typed the reset command into the agent, and the detection of that command in the conversation record are removed. Handling of a new session after a crash or fresh launch stays.
- **Agents are taught in compaction terms.** The id skill drops its reset section and gains a section on compacting yourself: what it is, how to request it, that you'll be woken with the supervisor's nudge, and that the nudge is never permission. It tells agents plainly that users see a **Condense conversation** button and will talk about condensing (or compaction, if they know agents), and that it is the harness's compaction underneath. Everywhere else the id skill mentioned reset, the context watch or the 90% nudge is updated. Posture is unchanged from reset: an agent compacts itself only when the user asks, or at the build and campaign boundaries that call for it. If a user still types the old reset command, the agent treats it as a request to compact.
- **Build and campaign skills** (the user's own copies on this box) compact where they reset today: campaigns compact between shapes instead of starting a fresh session per shape, and the emergency "nudge fired mid concept-open" rule is reworded for the 95% automatic compaction.
- **The context watch is retired completely:** the watcher, its 90% nudge and 95% ping, its distribution to boxes, its installed copy and state folders on every box, and every mention of it.

## Philosophy

- One operation with one entry point. No second way for an agent to get more room, and no hidden restart.
- Same guarantees reset gave (a turn afterwards, works on a sleeping agent), without its losses (the conversation and its history continue).
- Nothing from the machinery ever reads as the user speaking. The nudge is marked as an event and says outright that it isn't permission.
- Agents and users each get their own word for the same thing, and the id skill bridges the two.
- Posture doesn't loosen just because the operation became gentler.

## Prior context

- Reset today: the button types the reset command into the agent; the agent saves, drops a restart request, and the supervisor exits it and launches a fresh session. The app holds the conversation in a "recycling" state with an overlay until the new session appears, and the chat can't scroll back past the restart.
- Shape 1 turned idle compaction off and set Claude Code's own compaction at meter 95%. Shape 2 makes every compaction end with the agent re-loading itself in full and not re-announcing; it relies on the agent taking a turn, which this shape guarantees.
- The context watch has never fired: it reads files nothing writes any more.
- Tested on the new version: a message typed during a compaction is held and sent once it finishes, and starts a turn; the finish leaves a clear marker in the conversation record.

## What would make it wrong

- An agent is restarted into a fresh session to get more room, by any path.
- After a condense the user or agent asked for, the agent sits idle with no turn.
- An agent treats the after-compaction nudge as the user's yes to something it asked.
- The nudge shows up in the chat as if the user had typed it.
- Pressing Condense on a sleeping agent does nothing, or the request is silently lost.
- The user is locked out of typing while the agent condenses, or a message sent meanwhile is lost.
- Agents start compacting themselves on their own initiative outside the build and campaign boundaries.
- Anything still says reset or start fresh, or still mentions the context watch, in the app, the id skill, or the build and campaign skills.
- Leftover machinery: the restart path, the recycling state or the context watch remain on disk or on the boxes.

## Scope edges

- **In:** the condense request and the supervisor carrying it out (including waking), the system-event nudge, the button and its words and confirm, the "Condensing…" meter state, removing the restart and recycling machinery, the id skill rewrite of everything reset- and context-watch-related, the build and campaign skill edits, retiring the context watch fleet-wide.
- **Out:** how a compaction shows in the chat (the divider, folding the nudge into it, the summary as a giant bubble) is shape 4. The resume dialog and the running-agents rollout notes stay as campaign-close items.
- **Deferred:** none.
- **Tempting but no:** a hidden restart kept as an escape hatch; letting agents compact themselves whenever they like; a per-request "carry on with…" note; a what's-new note (the user said none is needed).

## Handoff notes

- Campaign: `campaign-condense.md` in this folder. Identity: blaze-box-maintainer-3. Shape ends at "committed, not pushed, not deployed".
- The build and campaign skills aren't in the repo; they're the user's personal copies on this box. Editing them needs the user's yes on the exact changes, as for any skill.
- The supervisor's existing paste pattern and the ambient monitor's event envelope are the models for sending the compaction and the nudge. The archive path shares the restart code's exit step by copy, so it must keep working when restart goes.
- Retiring the context watch from boxes needs a cleanup step in the distributor, like earlier retired helpers.
- Prove end to end on the new version: the button on an awake and on a sleeping agent, an agent-requested compaction, a message sent mid-condense, and an agent that had asked a question staying put after the nudge.
