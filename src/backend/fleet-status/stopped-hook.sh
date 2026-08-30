#!/bin/bash
#
# Skynet fleet-status Stopped hook — dropped onto each identity-hosting box
# by remote-hook-install.ts (Plan 62-02). Reads the harness JSON payload from
# stdin and atomic-touches the per-session STOPPED marker file, whose mtime
# is read by the Skynet backend over SSH (via `stat -c %Y`) to answer the
# affordance's one question: "should Ashley look at this row?"
#
# Wired by Plan 62-02's installer to ALL THREE of these settings.json hooks:
#   - hooks.Stop[0].hooks[]              (turn finished cleanly)
#   - hooks.StopFailure[0].hooks[]       (turn ended in error)
#   - hooks.PermissionRequest[0].hooks[] (agent blocked waiting on Ashley)
#
# The last one is a deliberate design choice per the shape file: from the
# affordance's perspective, "agent is waiting on you" is the same as "agent
# is done" — both mean the row deserves Ashley's attention right now. This
# script is EVENT-AGNOSTIC — it does not branch on hook_event_name; the
# installer's routing (which events pipe to this script) is the entire event
# discrimination.
#
# Marker path convention (matches activity-hook.sh — Plan 62-03's backend
# predicate depends on the per-session directory invariant that BOTH scripts
# write into the same ${HOME}/.claude/fleet-status/hooks/<sid>/ dir, with only
# the filename differing: `stopped` vs `activity`):
#   ${HOME}/.claude/fleet-status/hooks/<sid>/stopped
#
# Shape file: .planning/shapes/shape-wip-indicator-hook-based-rewrite.md.
# The predicate the Plan 62-03 backend evaluates:
#   activity_marker_mtime > stopped_marker_mtime → working (affordance lit)
# is what this script feeds (as the RHS of the comparison). Every Stop /
# StopFailure / PermissionRequest bumps this marker's mtime; the affordance
# goes dark unless a later activity-hook firing bumps its marker past ours.
#
# This script does NOT write to any legacy payload path — the old Phase 59
# per-session file at ~/.claude/fleet-status/stop-<sid>.json and the box-wide
# ~/.claude/fleet-status/last-stop-payload.json remain the responsibility of
# the legacy stop-hook.sh, which stays installed alongside this new script
# during the migration window (Plan 62-02 installer merges BOTH entries into
# hooks.Stop). The background-tasks-list consumer path is orthogonal and out
# of Phase 62's mutation scope per shape §Out of scope.
#
# MUST NOT block Claude Code — the hook fires synchronously during the turn
# lifecycle. All work is wrapped in `timeout 2 bash -c '...' || true` so a full
# disk or unreachable filesystem cannot hang the harness turn indefinitely.
#
# Path-traversal defense (T-62-01-01 Tampering): session_id is extracted from
# the piped stdin JSON via a strict bash regex whose character class rejects
# any path-traversal metacharacter (mirrors stop-hook.sh line 47). Any other
# character — `/`, `.`, `..`, `\`, `$`, `` ` ``, `;`, `(`, `)`, `&`, `|`, `>`,
# `<`, whitespace — fails the regex match and skips the touch entirely
# (fail-open: exit 0 with no marker created).
#
# The interpreter of the inner block is bash (not sh) because the `=~` regex
# operator is bash-specific (not POSIX-portable to dash/ash). The outer
# script's shebang already guarantees bash is available on every managed box.
#
set -eu
MARKER_ROOT="${HOME}/.claude/fleet-status/hooks"
mkdir -p "${MARKER_ROOT}"
# Belt-and-braces: wrap the extract-and-touch in a timeout so a full disk or
# unreachable filesystem cannot hang the hook indefinitely. Fire-and-forget
# beyond this point — inner failure is swallowed by `|| true`, outer `exit 0`
# fires unconditionally.
timeout 2 bash -c '
  payload="$(cat)"
  # Extract session_id via strict bash regex. The character class is the
  # Tampering defense — any other character fails the match and skips the
  # touch. Mirrors stop-hook.sh line 47 verbatim.
  if [[ "$payload" =~ \"session_id\"[[:space:]]*:[[:space:]]*\"([a-zA-Z0-9_-]+)\" ]]; then
    sid="${BASH_REMATCH[1]}"
    session_dir="'"${MARKER_ROOT}"'/${sid}"
    mkdir -p "$session_dir"
    touch "${session_dir}/stopped"
  fi
' || true
exit 0
