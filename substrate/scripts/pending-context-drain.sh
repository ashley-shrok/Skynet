#!/bin/bash
# pending-context-drain.sh — UserPromptSubmit + PostToolUse + SessionStart hook.
#
# Delivers queued ambient notices to a supervised agent at its NEXT activation
# instead of waking it for them. Producers (today: the file-watch ambient
# watcher) drop one event per file into
#   ~/fleet/identities/$FLEET_IDENTITY/pending-context/<ns-timestamp>-<hex>.line
# and this hook hands everything queued to the model as additionalContext:
#   - UserPromptSubmit — the next turn, whatever started it (user, relay DM,
#     scheduled wake-up).
#   - PostToolUse — between tool calls of a turn already running, so a busy
#     agent sees a change after its next tool call rather than after the turn.
#   - SessionStart (startup / clear) — discards the queue instead: a fresh
#     session re-reads every watched file at /id load, so diffs queued against
#     the previous session's copy are noise. resume / compact keep the queue.
#
# Lines are delivered in name order (write order) — each file-watch line is a
# diff against the previous one for the same file. Each file is claimed by an
# atomic rename before it is read, so concurrent drains (parallel tool calls)
# never deliver one twice; a claim older than a minute is a drain that died
# mid-way and is picked up again.
#
# Silent no-op on any unmet precondition (no FLEET_IDENTITY, no queue, empty
# queue). Never fails the parent claude turn.
#
# Canonical copy in the app's source repo at
# substrate/scripts/pending-context-drain.sh; distributed to every managed host
# by the fleet substrate distributor (see src/backend/distributor/catalog.ts).
# Installed at ~/.local/bin/pending-context-drain. Do NOT hand-edit the
# installed copy.

set -u

[ -z "${FLEET_IDENTITY:-}" ] && exit 0
QUEUE="$HOME/fleet/identities/$FLEET_IDENTITY/pending-context"

# Fast path — this runs after EVERY tool call of every supervised session, so
# bail before reading stdin or spawning jq when there is nothing queued.
shopt -s nullglob
queued=("$QUEUE"/*.line "$QUEUE"/*.line.claimed)
[ "${#queued[@]}" -eq 0 ] && exit 0

INPUT="$(cat)"
EVENT="$(printf '%s' "$INPUT" | jq -r '.hook_event_name // ""' 2>/dev/null)"

if [ "$EVENT" = "SessionStart" ]; then
  SOURCE="$(printf '%s' "$INPUT" | jq -r '.source // ""' 2>/dev/null)"
  case "$SOURCE" in
    startup|clear) rm -f "$QUEUE"/*.line ;;
  esac
  exit 0
fi

# Re-queue claims abandoned by a drain that died between claim and delete.
# Age is by ctime, which the claiming rename resets (mtime is the event's
# write time and would make every old event's fresh claim look abandoned).
STALE_SEC="${PENDING_CONTEXT_CLAIM_STALE_SEC:-60}"
now=$(date +%s)
for f in "$QUEUE"/*.line.claimed; do
  changed=$(stat -c %Z "$f" 2>/dev/null) || continue
  [ $((now - changed)) -gt "$STALE_SEC" ] && mv -f "$f" "${f%.claimed}" 2>/dev/null
done

body=""
for f in "$QUEUE"/*.line; do
  claimed="$f.claimed"
  mv "$f" "$claimed" 2>/dev/null || continue   # another drain took it
  line="$(cat "$claimed" 2>/dev/null)"
  rm -f "$claimed"
  [ -n "$line" ] && body+="$line"$'\n'
done
[ -z "$body" ] && exit 0

HEADER="Files you hold in context changed (queued by the supervisor's file-watch instead of waking you; not from the user). Act on whatever bears on your work; no reply needed:"

if [ -z "$EVENT" ] || ! command -v jq >/dev/null 2>&1; then
  # Plain stdout from an exit-0 hook still reaches the model as context.
  printf '%s\n%s' "$HEADER" "$body"
  exit 0
fi
jq -n --arg e "$EVENT" --arg c "$HEADER"$'\n'"${body%$'\n'}" \
  '{hookSpecificOutput: {hookEventName: $e, additionalContext: $c}}'
exit 0
