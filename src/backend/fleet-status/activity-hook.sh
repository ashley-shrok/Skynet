#!/bin/bash
#
# Skynet fleet-status Activity hook — dropped onto each identity-hosting box
# by remote-hook-install.ts (Plan 62-02). Reads the harness JSON payload from
# stdin and atomic-touches the per-session activity marker file, whose mtime
# is read by the Skynet backend over SSH (via `stat -c %Y`) to answer the
# affordance's one question: "should Ashley look at this row?"
#
# Wired by Plan 62-02's installer to BOTH of these settings.json hooks:
#   - hooks.UserPromptSubmit[0].hooks[]  (Ashley submitted a prompt)
#   - hooks.PreToolUse[0].hooks[]         (agent began invoking a tool)
# This script is EVENT-AGNOSTIC — it does not branch on hook_event_name; the
# installer's routing (which events pipe to this script) is the entire event
# discrimination. Both events mean "activity happened, touch the marker."
#
# Marker path convention (matches stopped-hook.sh — Plan 62-03's backend
# predicate depends on the per-session directory invariant that BOTH scripts
# write into the same ${HOME}/.claude/fleet-status/hooks/<sid>/ dir, with only
# the filename differing: `activity` vs `stopped`):
#   ${HOME}/.claude/fleet-status/hooks/<sid>/activity
#
# Shape file: .planning/shapes/shape-wip-indicator-hook-based-rewrite.md.
# The predicate the Plan 62-03 backend evaluates:
#   activity_marker_mtime > stopped_marker_mtime → working (affordance lit)
# is what this script feeds. No smoothing, no state machine — just a fresh
# mtime on every activity event.
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
    touch "${session_dir}/activity"
  fi
' || true
exit 0
