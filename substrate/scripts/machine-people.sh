#!/bin/bash
# machine-people.sh — SessionStart hook.
#
# Hands every Claude session on this machine the people file the app keeps at
# ~/fleet/host/people.md: everyone with access to this machine and their relay
# IDs. The app rewrites the file whenever it sets this machine up, so the list
# reaches every session on every instance without anything hand-written.
#
# Fires on every SessionStart source (startup, resume, clear, compact) — a
# condensed or resumed session gets it back too. SessionStart stdout is added
# to the session's context. Missing or empty file = silent no-op; this hook
# never fails a session.

F="$HOME/fleet/host/people.md"
[ -s "$F" ] || exit 0
cat "$F" 2>/dev/null
exit 0
