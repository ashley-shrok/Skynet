#!/bin/bash
# resume-gap-notice.sh — UserPromptSubmit hook.
#
# A session that receives a message after a long silence has no way to tell
# how much time passed: a dormancy wake (the supervisor --resumes the old
# conversation), a crash-recovery relaunch, or an always-on identity left idle
# for days all look, from inside, like the next turn arriving immediately.
# Claude Code's own "the date has changed" line only covers calendar-day
# changes and carries no duration.
#
# This hook fires on every incoming prompt (user, relay, wake-up, file-watch —
# all arrive as prompts) and, when the conversation's previous activity is
# GAP_THRESHOLD_SECONDS or more in the past, attaches one bare-fact line via
# additionalContext stating the gap and both ends of it in UTC. Under the
# threshold, or with no prior activity (fresh session, recycled session), it
# stays silent.
#
# "Previous activity" = the newest timestamped assistant entry — the agent's
# own output. The arriving prompt is a user entry (its hook outputs are
# attachment entries), so it never counts as its own previous activity; a
# --resume writes no timestamped entries, so a reopen never looks like
# activity. System entries are deliberately excluded: some are written DURING
# the silence (a /loop "scheduled_task_fire" stamped at wake time, an
# "informational" idle-compaction notice) and would understate the gap.
#
# Applies to EVERY session on the box (no FLEET_IDENTITY gate — a gap is a
# gap). Silent no-op on any unmet precondition; never fails the parent turn.
#
# Canonical copy in the app's source repo at substrate/scripts/resume-gap-notice.sh;
# distributed to every managed host by the fleet substrate distributor
# (see src/backend/distributor/catalog.ts). Installed at
# ~/.local/bin/resume-gap-notice. Do NOT hand-edit the installed copy.

set -u

GAP_THRESHOLD_SECONDS=1800

command -v jq >/dev/null 2>&1 || exit 0

INPUT="$(cat)"
TRANSCRIPT="$(printf '%s' "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null)"
[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] || exit 0

# Read from the end: the newest activity is near the tail, and transcripts can
# be large. jq stops at the first match, so tac is cut short by SIGPIPE.
# fromjson? skips a partially-written trailing line — but tac glues a final
# line that lacks its newline onto the line before it, so terminate it first.
reversed() {
  if [ -n "$(tail -c1 "$TRANSCRIPT" 2>/dev/null)" ]; then
    { cat "$TRANSCRIPT"; echo; } | tac
  else
    tac "$TRANSCRIPT"
  fi
}
LAST="$(reversed 2>/dev/null \
  | jq -nRr 'first(inputs | fromjson? | select(type == "object" and .type == "assistant" and (.timestamp | type) == "string") | .timestamp)' 2>/dev/null)"
[ -n "$LAST" ] || exit 0

LAST_EPOCH="$(date -u -d "$LAST" +%s 2>/dev/null)" || exit 0
NOW_EPOCH="$(date -u +%s)"
GAP=$((NOW_EPOCH - LAST_EPOCH))
[ "$GAP" -ge "$GAP_THRESHOLD_SECONDS" ] || exit 0

# Duration rounded to its two largest units (days/hours/minutes); a zero
# second unit is dropped ("2 hours", not "2 hours 0 minutes").
unit() { [ "$1" -eq 1 ] && printf '1 %s' "$2" || printf '%d %ss' "$1" "$2"; }
D=$((GAP / 86400)); H=$((GAP % 86400 / 3600)); M=$((GAP % 3600 / 60))
if [ "$D" -gt 0 ]; then
  DUR="$(unit "$D" day)"; [ "$H" -gt 0 ] && DUR="$DUR $(unit "$H" hour)"
elif [ "$H" -gt 0 ]; then
  DUR="$(unit "$H" hour)"; [ "$M" -gt 0 ] && DUR="$DUR $(unit "$M" minute)"
else
  DUR="$(unit "$M" minute)"
fi

FMT='+%a %-d %b %H:%M UTC'
FROM="$(date -u -d "@$LAST_EPOCH" "$FMT")"
TO="$(date -u -d "@$NOW_EPOCH" "$FMT")"

jq -n --arg msg "It has been $DUR since your last activity in this conversation (last active $FROM; now $TO)." '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $msg
  }
}'

exit 0
