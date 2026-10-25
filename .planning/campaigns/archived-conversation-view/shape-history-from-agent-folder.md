# Shape: find every conversation's history from the agent's own folder, not through its terminal

**Opened:** 2026-10-25

## What this is

Every place Skynet needs an agent's conversation history finds it the same
way: go to that agent's own history folder and take the newest history file
whose first real message is the agent's own load (`/id <name>`). The folder
is known from the agent's name alone, because Claude names it after the
folder the agent works in, and every agent works in its own. That works the
same for a running agent, a sleeping one and an archived one, since
archiving moves the agent but leaves its history where it was. The
conversation view stops finding history by going through the agent's
terminal, the separate loader for sleeping agents goes away, and search, the
sidebar and the memory pie stop reading the start of every history file on
the machine. Nothing looks different to the user; this is the ground the
next step (opening archived conversations) is built on.

## Shape

- **The one lookup.** Given an agent's name: look only in that agent's
  history folder; among the files there whose first real user message is
  that agent's load, take the newest. Records the harness writes before the
  first message don't count; files started some other way (someone running
  a bare Claude in the agent's folder while testing) are never picked. No
  machine-wide fallback.
- **Who uses it.** Everything that finds an agent's history today:
  - the conversation view, for running and sleeping agents alike;
  - the sidebar's background status reading (titles, last-message times);
  - the memory pie;
  - search — newest file only, the same file the conversation view shows;
  - the check that a newborn agent has started.
  The agent-restarter already looks this way and is the model for it.
- **The conversation view.** On open it finds the file with the lookup and
  shows its history straight away, whatever state the agent is in. If there
  is no file yet (a brand-new agent), it keeps looking until the first one
  appears, then stops. There is no ongoing check for a newer file.
- **Running, sleeping, restarting.** Still worked out exactly as today,
  including the "is it running?" check that goes through the terminal — but
  that answer no longer decides which history is shown. Waking a sleeping
  agent no longer swaps the history underneath the view; it's the same file.
- **Gone.** The terminal route to the history file, the separate
  sleeping-agent loader, and the machine-wide scans.

## Philosophy

History belongs to the agent, not to whatever process happens to be
running it. The view reads the agent's own record directly; the terminal is
for talking to a running agent, not for finding out what it said. One
lookup, used everywhere, so the view, search, the sidebar and the pie can
never disagree about which history is the agent's.

It deliberately does not change how running/sleeping is detected, does not
add any new access check (who an agent is listed for is organization, not
access — machine access stays the only boundary), and does not change
anything the user sees.

## Prior context

- Today a running agent's history is found by following its terminal to the
  Claude process and reading which file that process says it is writing;
  that was built to stop the view showing another agent's messages.
- A sleeping agent's history is found by a separate loader that reads the
  start of every history file on the machine and needs the agent's live
  folder plus its sleep marker. Search, the sidebar and the memory pie use
  machine-wide scans of the same kind.
- Since the condense change, an agent keeps one history file for life:
  compacting and waking append to it. A new file only appears on an agent's
  first launch (or when the restarter starts one fresh, which is to be
  removed separately).
- Survey on this machine: 441 agent history folders; only 4 hold files
  that weren't started by the agent's load. One archived agent ("tina")
  ran from outside its own folder under the old layout and drops out of
  search — accepted. Agents whose history Claude Code already deleted have
  nothing to find today either.

## What would make it wrong

- The view ever showing another agent's messages, or a bare test session
  that happened to be started in the agent's folder.
- A sleeping agent's conversation looking any different, slower, or
  emptier than today; or waking one making its history flicker or reload.
- Sending, Stop, permission prompts, the working indicator or new messages
  arriving behaving any differently for a running agent.
- Any remaining place still finding history through the terminal or by
  scanning the whole machine.
- Two parts of the app disagreeing about which file is an agent's history.

## Scope edges

- **In:** the lookup; moving every history-finding place onto it; removing
  the terminal route, the sleeping-agent loader and the machine-wide scans;
  confirming the folder naming and first-message shape on the other
  machines before relying on them there.
- **Out:** how running/sleeping is detected (stays on the terminal for now);
  opening archived conversations (next shape); any access check.
- **Outside this campaign:** the restarter starting a known agent fresh
  (Ashley: that should never happen) — handled separately.
- **Tempting but no:** a periodic check for a newer history file; a
  machine-wide fallback for agents with no folder; searching an agent's
  older files.

## Handoff notes

- Built by piano-box-maintainer-5 in the Skynet repo, on the shared branch;
  shape 1 of 2 in the archived-conversation-view campaign. Ends at
  committed, not pushed, not deployed.
- The restarter's own lookup (expected folder, first `/id` load, newest
  first) is the reference; its folder naming only swaps slashes, while
  Claude also swaps dots — match Claude's rule.
- Paths handed to remote readers must be the host's view of the path, not
  the container's.
- The id skill doesn't need an edit unless something user-visible changes.
