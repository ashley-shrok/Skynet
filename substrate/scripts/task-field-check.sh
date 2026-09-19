#!/bin/bash
# task-field-check.sh — UserPromptSubmit hook.
#
# When Claude Code is running under agent-supervisor, the supervisor exports
# FLEET_IDENTITY=<name> into the claude launch env (see agent-supervisor.sh
# drive() / redrive_claude()). This hook fires on every user prompt in that
# session and, if the identity file's `task:` frontmatter is still the
# placeholder "Untitled conversation", emits additionalContext nudging the
# agent to fill it in based on the user's message.
#
# Rationale: the id skill directs agents to write the task field as soon as
# they get any hint of what they're working on, but that instruction slips.
# UserPromptSubmit fires with the user's message right there — the agent has
# the hint AND the reminder in the same turn, which is much stickier than a
# once-at-load-time directive.
#
# Silent no-op on any unmet precondition (no FLEET_IDENTITY, file absent,
# already-set, jq missing). Never fails the parent claude turn.
#
# Canonical copy in the Skynet repo at substrate/scripts/task-field-check.sh;
# distributed to every managed host by the fleet substrate distributor
# (see src/backend/distributor/catalog.ts). Installed at
# ~/.local/bin/task-field-check. Do NOT hand-edit the installed copy.

set -u

# Unsupervised claude session (Ashley's ad-hoc runs, or any launch not routed
# through agent-supervisor): silently no-op — we have no identity to check.
[ -z "${FLEET_IDENTITY:-}" ] && exit 0

FILE="$HOME/fleet/identities/$FLEET_IDENTITY/$FLEET_IDENTITY.md"
[ -f "$FILE" ] || exit 0

# grep -q on the exact frontmatter line. A user or agent who has replaced the
# placeholder with any other value — even an empty string — falls through and
# the hook stays silent forever for that identity's session.
grep -q '^task: Untitled conversation$' "$FILE" || exit 0

# jq is present on every fleet-managed host (asserted by run-bootstrap.ts).
# If it isn't, emit a plain-text fallback so we don't just silently do nothing.
if command -v jq >/dev/null 2>&1; then
  jq -n --arg f "$FILE" '{
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: ("Reminder from the id skill: your `task:` frontmatter in " + $f + " is still \"Untitled conversation\". If this user message gives you any hint of what this session is about, update the field in the same turn (silent, no announcement) per id skill § The task: frontmatter field.")
    }
  }'
else
  # Non-JSON output is still surfaced to the model as context per the hooks
  # contract for exit-0 stdout, so this is a safe fallback.
  printf 'Reminder: task: field in %s is still "Untitled conversation" — update it based on this message (see id skill).\n' "$FILE"
fi

exit 0
