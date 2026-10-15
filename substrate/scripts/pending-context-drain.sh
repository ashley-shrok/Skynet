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
# queue, no jq, not the harness's main conversation). Never fails the parent
# claude turn.
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

# The queue belongs to the identity, but FLEET_IDENTITY is inherited by every
# claude process under the harness. Only the harness's own main conversation
# may drain it — anything else would take the notices into a context that
# ignores them (and a nested session's SessionStart would wipe the queue):
#   - a sub-agent of the harness: same process, but its hook payloads carry
#     agent_id (the main conversation's never do);
#   - a nested claude (`claude -p` from Bash, an in-process teammate launch):
#     the claude process running this hook has another claude above it.
# jq is required to tell any of this apart, so without it the queue is left
# alone (run-bootstrap.ts asserts jq on every managed host).
command -v jq >/dev/null 2>&1 || exit 0
INPUT="$(cat)"
EVENT="$(printf '%s' "$INPUT" | jq -r '.hook_event_name // ""' 2>/dev/null)"
AGENT_ID="$(printf '%s' "$INPUT" | jq -r '.agent_id // ""' 2>/dev/null)"
[ -z "$EVENT" ] && exit 0
[ -n "$AGENT_ID" ] && exit 0

# nested_claude: 0 iff the nearest claude ancestor of this hook has a claude
# ancestor of its own.
nested_claude() {
  local pid=$PPID owner="" comm ppid
  while [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
    comm=$(cat "/proc/$pid/comm" 2>/dev/null) || return 1
    if [ "$comm" = "claude" ]; then
      [ -n "$owner" ] && return 0
      owner=$pid
    fi
    ppid=$(awk '/^PPid:/ {print $2}' "/proc/$pid/status" 2>/dev/null) || return 1
    pid=$ppid
  done
  return 1
}
nested_claude && exit 0

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

# Claim in name (= write) order. Claimed files are deleted only after the
# output is written, so a drain killed mid-way leaves them for the stale-claim
# pass above to redeliver.
claimed=()
lines=()
for f in "$QUEUE"/*.line; do
  mv "$f" "$f.claimed" 2>/dev/null || continue   # another drain took it
  claimed+=("$f.claimed")
  line="$(cat "$f.claimed" 2>/dev/null)"
  [ -n "$line" ] && lines+=("$line")
done
if [ "${#lines[@]}" -eq 0 ]; then
  rm -f "${claimed[@]}"
  exit 0
fi

HEADER="Files you hold in context changed (queued by the supervisor's file-watch instead of waking you; not from the user). Act on whatever bears on your work; no reply needed:"

# Cap what goes inline: an idle-but-running agent can build up a long queue,
# and the harness cuts long hook output short. Over the cap, the full list
# goes to a file and the newest lines (the current state) stay inline.
MAX_CHARS="${PENDING_CONTEXT_MAX_CHARS:-8000}"
body=$(printf '%s\n' "${lines[@]}")
if [ "${#body}" -gt "$MAX_CHARS" ]; then
  overflow="$QUEUE/overflow/$(date -u +%Y-%m-%dT%H-%M-%SZ)-$$.txt"
  mkdir -p "${overflow%/*}" && printf '%s\n' "$body" > "$overflow"
  tail_body=""
  for (( i=${#lines[@]}-1; i>=0; i-- )); do
    candidate="${lines[$i]}"$'\n'"$tail_body"
    [ "${#candidate}" -gt "$MAX_CHARS" ] && break
    tail_body="$candidate"
  done
  body="${#lines[@]} notices, too many to show inline — the full list is at $overflow (Read it). The newest:"$'\n'"${tail_body%$'\n'}"
fi

if jq -n --arg e "$EVENT" --arg c "$HEADER"$'\n'"$body" \
    '{hookSpecificOutput: {hookEventName: $e, additionalContext: $c}}'; then
  rm -f "${claimed[@]}"
else
  for f in "${claimed[@]}"; do mv -f "$f" "${f%.claimed}" 2>/dev/null; done
fi
exit 0
