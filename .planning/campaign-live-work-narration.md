# Campaign: Narrate what the agent is doing, next to the work indicator

**Opened:** 2026-10-25
**Status:** in_progress
**Workspace:** /home/ubuntu/fleet/identities/verse-box-maintainer-3/workspace/skynet/.planning/

## Concept

While an agent works, the conversation view shows a short line next to the work indicator saying where the agent is in the job. The line has to make sense to someone glancing at it cold, with nothing else to go on: what's already behind the agent, what it's doing now, and what's still ahead. The point is to show how far along it is, not to give a play-by-play of individual steps. It doesn't repeat the task title, since that's already shown at the top of the conversation. A small, fast model (Haiku) writes the line from the user's request and the agent's recent steps. It runs on the box the agent lives on, using the fleet's existing subscription token, so there's no API bill. It only runs while someone has that conversation open, and the line exists only on screen.

## Success criteria

- While an agent works and its conversation is open, a line next to the work indicator says where it is in the job, readable on its own, without repeating the task title.
- The line changes at a pace you can read: when the agent's progress actually moves, not on every step.
- The line stays accurate to what the agent is actually doing.
- Narration runs on the subscription, never as paid API calls, and only while someone has the conversation open. Nothing runs for conversations nobody is watching.
- It stays light enough for the smallest supported host (a 4 GB box): narration calls don't pile up.
- Nothing the agent itself does changes. Agents aren't given extra instructions and their sessions aren't touched.

## Shapes

- **[declared] shape-live-work-narration**: generate the progress line on the agent's box while the conversation is open, and show it next to the work indicator. Status: closed

## Other work

## Lingerers (explicitly approved)

## Open questions

## Concept-beat findings (for reference)

- Free signals (the agent's own command descriptions, fill-in sentences built from tool names, the task list) are mostly mechanics. They can't say where the agent is in the job, so they aren't enough on their own.
- Having the agent write its own line was set aside because of worry about extra load on the agent's thinking.
- Measured on t1000 over 14 days: about 5.7 agent-hours and 1,300 tool calls on an average day. Narrating at roughly once a minute would be about half a percent of the agents' own model usage.
- Running Haiku through Claude Code's one-shot command-line mode on the fleet's subscription token: about 1.7 s per update and about 0.85 s of CPU, plus roughly 245 MB of memory for the couple of seconds the call runs. Thinking must be turned off, or each update takes 12 to 39 s. The bare minimal mode can't be used because it ignores subscription auth. The test scripts are in the identity workspace's narration-test folder.
- The Agent SDK is no faster, because it runs the same program underneath. Its only extra is keeping the process alive between calls, which means memory held permanently and a conversation that keeps growing.
- Where it runs: the options were the open conversation's own connection to the agent's box (chosen), the Skynet server centrally, a narrator always running on each agent's box, and that narrator gated by a "someone is watching" signal.
