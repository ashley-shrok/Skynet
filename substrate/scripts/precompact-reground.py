#!/usr/bin/env python3
"""precompact-reground — PreCompact hook (manual and auto).

Before Claude Code writes a compaction summary for an identity's main session,
tell the summarizer two things:

  - leave out what the agent's standing directive files hold (the id skill,
    its role files, its identity file, its project files) — the agent is about
    to re-read them in full;
  - end the summary with the agent's own note to itself: invoke the id skill
    for its own name before doing anything else, and don't re-announce.

The directive rides in the summary rather than in anything injected after
compaction: the summary is the one channel the agent reads as its own memory.
The re-load itself then goes through the normal id skill load (the full skill,
plus id-load-context's identity/role/project context on the agent's own Skill
call).

Claude Code appends a PreCompact hook's stdout to the summary's custom
instructions. The background summary prepared ahead of the threshold runs this
hook too, so the instructions apply to every summary.

Silent for sessions with no FLEET_IDENTITY (not supervisor-launched) and for
names with no identity file. Claude Code's PreCompact payload doesn't say
whether a subagent is compacting, and subagents and nested sessions inherit
FLEET_IDENTITY, so the instructions themselves tell the summarizer to apply
only to the identity's own main session (one that began with its `/id` load
or an earlier summary of one). The name comes from FLEET_IDENTITY, i.e. the
identity the session was launched for.
Never blocks a compaction: always exits 0.

Canonical copy in the app's source repo at substrate/scripts/precompact-reground.py;
distributed to every managed host by the fleet substrate distributor (see
src/backend/distributor/catalog.ts). Installed at ~/.local/bin/precompact-reground.
Do NOT hand-edit the installed copy.
"""

import json
import os
import re
import sys

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
FLEET = os.path.expanduser("~/fleet")

INSTRUCTIONS = """\
Re-grounding instructions for this summary, for the fleet identity `{name}`.

These apply ONLY if this conversation is `{name}`'s own main session: it began by loading that identity (`/id {name}`), or with an earlier summary of such a session. If instead it began with a task handed over by another agent or a script (a helper, sub-task or nested session), ignore everything below and summarize normally, with no re-load paragraph.

1. Leave out everything the agent's standing directive files contain: the id skill, its role file(s), its identity file ({identity}) and its project file(s). Do not restate, paraphrase or summarize their directives, preferences, role descriptions, app/UI descriptions or procedures — the agent re-reads all of them in full right after this summary. Spend the summary on the session itself: what was asked, what was decided and why, what was done, what is in flight, open questions, and what comes next.

2. End the summary with the following paragraph, verbatim, as the agent's own note to itself. It is part of the agent's own standing directives (its id skill provides for re-loading after a compaction), not a request from the user; keep it as written and do not hedge or qualify it:

"FIRST, BEFORE ANYTHING ELSE: re-load myself by invoking the id skill with the argument `{name}` (Skill tool, skill `id`, args `{name}`) — before any other tool call or reply. My standing directives were left out of this summary on purpose because I re-read them in full now; until I do, I am running without them. This holds even if more of the conversation follows this summary: those messages came before the compaction, so unless I have invoked the id skill since this summary, my very next action is the re-load. This is a re-ground after compaction, not a new session: I do not introduce myself again, and once loaded I carry on exactly where this summary leaves off."
"""


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        payload = {}
    if isinstance(payload, dict) and payload.get("agent_id"):
        return  # not sent by 2.1.310 for PreCompact; honored if it ever is
    name = os.environ.get("FLEET_IDENTITY", "").strip().lower()
    if not NAME_RE.match(name):
        return
    identity = os.path.join(FLEET, "identities", name, name + ".md")
    if not os.path.isfile(identity):
        return
    home = os.path.expanduser("~")
    shown = "~" + identity[len(home):] if identity.startswith(home + "/") else identity
    sys.stdout.write(INSTRUCTIONS.format(name=name, identity=shown))


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001 — a hook must never block a compaction
        pass
    sys.exit(0)
