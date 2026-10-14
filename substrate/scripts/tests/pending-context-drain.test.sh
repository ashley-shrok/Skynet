#!/usr/bin/env bash
# shellcheck shell=bash
#
# Hermetic test driver for substrate/scripts/pending-context-drain.sh — the
# UserPromptSubmit / PostToolUse / SessionStart hook that hands a supervised
# agent the notices queued in ~/fleet/identities/<name>/pending-context/
# instead of waking it for them — plus the producer side of that contract in
# file-watch.py (events land in the queue, never on stdout; the pre-rename
# role-file-watch/ state dir is migrated on startup).
#
# Exits 0 on all-pass; exits 1 on any failure with a diagnostic naming
# the failing test.
#
# Usage: bash substrate/scripts/tests/pending-context-drain.test.sh
#   Run from the repo root.
#
# Requirements: bash, jq, python3, GNU coreutils.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HOOK="$REPO_ROOT/substrate/scripts/pending-context-drain.sh"
WATCHER="$REPO_ROOT/substrate/scripts/file-watch.py"

if [ ! -x "$HOOK" ]; then
  printf 'FATAL: hook script not found or not executable at %s\n' "$HOOK" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  printf 'FATAL: jq not found — required for this test driver\n' >&2
  exit 1
fi

PASS=0
FAIL=0
FAILED_TESTS=()
fail() { FAIL=$((FAIL + 1)); FAILED_TESTS+=("$1"); printf 'FAIL: %s — %s\n' "$1" "$2" >&2; }
pass() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }

SCRATCH="$(mktemp -d)"
ALL_PIDS=()
cleanup() {
  for _p in "${ALL_PIDS[@]:-}"; do [ -n "$_p" ] && kill "$_p" 2>/dev/null; done
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

# new_home: fresh hermetic HOME with an identity folder; sets H and Q.
new_home() {
  H="$(mktemp -d -p "$SCRATCH")"
  mkdir -p "$H/fleet/identities/agent"
  Q="$H/fleet/identities/agent/pending-context"
}

# queue <name> <text>: drop one queued line the way file-watch does.
queue() { mkdir -p "$Q"; printf '%s' "$2" > "$Q/$1.line"; }

# drain <event> [source]: run the hook with a minimal payload; stdout only.
drain() {
  local payload
  payload=$(jq -cn --arg e "$1" --arg s "${2:-}" '{hook_event_name: $e, source: $s, session_id: "x"}')
  printf '%s' "$payload" | HOME="$H" FLEET_IDENTITY=agent "$HOOK"
}

ctx() { jq -r '.hookSpecificOutput.additionalContext'; }

test_no_identity_is_silent() {
  local t=no_identity_is_silent out
  new_home; queue 1-aa "📝 [role-file: r] x"
  out=$(printf '{}' | HOME="$H" env -u FLEET_IDENTITY "$HOOK")
  [ -z "$out" ] || { fail $t "expected no output, got: $out"; return; }
  [ -f "$Q/1-aa.line" ] || { fail $t "queue touched without an identity"; return; }
  pass $t
}

test_empty_queue_is_silent() {
  local t=empty_queue_is_silent out rc
  new_home
  out=$(HOME="$H" FLEET_IDENTITY=agent "$HOOK" </dev/null); rc=$?
  [ "$rc" -eq 0 ] && [ -z "$out" ] || { fail $t "rc=$rc out=$out"; return; }
  mkdir -p "$Q"
  out=$(HOME="$H" FLEET_IDENTITY=agent "$HOOK" </dev/null); rc=$?
  [ "$rc" -eq 0 ] && [ -z "$out" ] || { fail $t "empty dir: rc=$rc out=$out"; return; }
  pass $t
}

test_delivers_in_order_and_empties_queue() {
  local t=delivers_in_order_and_empties_queue out body ev
  for ev in PostToolUse UserPromptSubmit; do
    new_home
    queue 300-cc "third"; queue 100-aa "first"; queue 200-bb "second"
    out=$(drain "$ev")
    [ "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.hookEventName')" = "$ev" ] \
      || { fail $t "$ev: wrong hookEventName: $out"; return; }
    body=$(printf '%s' "$out" | ctx | tail -n +2)
    [ "$body" = $'first\nsecond\nthird' ] || { fail $t "$ev: body was: $body"; return; }
    [ -z "$(ls -A "$Q")" ] || { fail $t "$ev: queue not emptied: $(ls -A "$Q")"; return; }
    [ -z "$(drain "$ev")" ] || { fail $t "$ev: second drain not silent"; return; }
  done
  pass $t
}

test_session_start_fresh_discards() {
  local t=session_start_fresh_discards src out
  for src in startup clear; do
    new_home; queue 1-aa "stale diff"
    out=$(drain SessionStart "$src")
    [ -z "$out" ] || { fail $t "$src: expected no output, got: $out"; return; }
    [ ! -e "$Q/1-aa.line" ] || { fail $t "$src: queue not discarded"; return; }
  done
  pass $t
}

test_session_start_resume_keeps() {
  local t=session_start_resume_keeps src out
  for src in resume compact; do
    new_home; queue 1-aa "keep me"
    out=$(drain SessionStart "$src")
    [ -z "$out" ] || { fail $t "$src: expected no output, got: $out"; return; }
    [ -f "$Q/1-aa.line" ] || { fail $t "$src: queue was discarded"; return; }
  done
  pass $t
}

test_abandoned_claim_redelivered() {
  local t=abandoned_claim_redelivered out
  new_home; mkdir -p "$Q"
  printf 'orphan' > "$Q/1-aa.line.claimed"
  # Fresh claim: belongs to a live drain — left alone.
  out=$(drain PostToolUse)
  [ -z "$out" ] || { fail $t "fresh claim was delivered: $out"; return; }
  [ -f "$Q/1-aa.line.claimed" ] || { fail $t "fresh claim was moved"; return; }
  sleep 1.1
  out=$(printf '{"hook_event_name":"PostToolUse"}' \
    | HOME="$H" FLEET_IDENTITY=agent PENDING_CONTEXT_CLAIM_STALE_SEC=0 "$HOOK" | ctx)
  printf '%s' "$out" | grep -q '^orphan$' || { fail $t "stale claim not delivered: $out"; return; }
  [ -z "$(ls -A "$Q")" ] || { fail $t "queue not emptied: $(ls -A "$Q")"; return; }
  pass $t
}

test_concurrent_drains_deliver_once() {
  local t=concurrent_drains_deliver_once i total uniq
  new_home
  for i in $(seq 1 60); do queue "$(printf '%03d' "$i")-aa" "event-$i"; done
  for i in 1 2 3 4 5; do
    drain PostToolUse > "$SCRATCH/c$i.out" &
  done
  wait
  total=$(cat "$SCRATCH"/c*.out | jq -r '.hookSpecificOutput.additionalContext' | grep -c '^event-')
  uniq=$(cat "$SCRATCH"/c*.out | jq -r '.hookSpecificOutput.additionalContext' | grep '^event-' | sort -u | wc -l)
  rm -f "$SCRATCH"/c*.out
  [ "$total" -eq 60 ] && [ "$uniq" -eq 60 ] || { fail $t "total=$total uniq=$uniq (want 60/60)"; return; }
  pass $t
}

# ---- producer side: file-watch.py ----

seed_watch_fixture() {
  new_home
  mkdir -p "$H/fleet/roles/rolex"
  printf '# rolex\n\nline 1\n' > "$H/fleet/roles/rolex/rolex.md"
  IDENT_MD="$H/fleet/identities/agent/agent.md"
  printf -- '---\nroles: [rolex]\ntask: t\n---\n\n# agent\n' > "$IDENT_MD"
}

launch_watch() {
  STDOUT_LOG="$(mktemp -p "$SCRATCH")"
  HOME="$H" AMBIENT_MONITOR_HARNESS_PID="$$" FILE_WATCH_SELF_RELOAD_POLL_SEC=600 \
    python3 "$WATCHER" "$H/fleet/identities/agent" >"$STDOUT_LOG" 2>/dev/null &
  WATCH_PID=$!
  ALL_PIDS+=("$WATCH_PID")
}

# wait_for <ticks> <command...> — retry every 0.1s.
wait_for() {
  local n="$1"; shift
  while [ "$n" -gt 0 ]; do "$@" && return 0; n=$((n - 1)); sleep 0.1; done
  return 1
}
queue_has() { cat "$Q"/*.line 2>/dev/null | grep -q "$1"; }

test_watcher_queues_never_prints() {
  local t=watcher_queues_never_prints
  seed_watch_fixture
  launch_watch
  wait_for 100 test -f "$H/fleet/identities/agent/file-watch/last-snapshot.role.rolex" \
    || { fail $t "watcher never armed"; kill "$WATCH_PID" 2>/dev/null; return; }
  sleep 1
  printf 'line 2\n' >> "$H/fleet/roles/rolex/rolex.md"
  wait_for 100 queue_has '📝 \[role-file: rolex\] your role file changed' \
    || { fail $t "no queued role-file event: $(ls -A "$Q" 2>&1)"; kill "$WATCH_PID" 2>/dev/null; return; }
  kill "$WATCH_PID" 2>/dev/null; wait "$WATCH_PID" 2>/dev/null
  [ ! -s "$STDOUT_LOG" ] || { fail $t "watcher wrote to stdout (would wake): $(cat "$STDOUT_LOG")"; return; }
  pass $t
}

test_watcher_migrates_legacy_state() {
  local t=watcher_migrates_legacy_state legacy
  seed_watch_fixture
  legacy="$H/fleet/identities/agent/role-file-watch"
  mkdir -p "$legacy/.state/pending"
  cp "$H/fleet/roles/rolex/rolex.md" "$legacy/last-snapshot.role.rolex"
  cp "$IDENT_MD" "$legacy/last-snapshot.identity"
  printf 'held by old watcher' > "$legacy/.state/pending/123-deadbeef.line"
  launch_watch
  wait_for 100 test -d "$H/fleet/identities/agent/file-watch" \
    || { fail $t "file-watch/ never appeared"; kill "$WATCH_PID" 2>/dev/null; return; }
  sleep 1.5
  kill "$WATCH_PID" 2>/dev/null; wait "$WATCH_PID" 2>/dev/null
  [ ! -e "$legacy" ] || { fail $t "legacy dir still present"; return; }
  [ -f "$H/fleet/identities/agent/file-watch/last-snapshot.role.rolex" ] \
    || { fail $t "baseline not carried over"; return; }
  [ -f "$Q/123-deadbeef.line" ] || { fail $t "held line not moved to queue: $(ls -A "$Q" 2>&1)"; return; }
  [ "$(ls "$Q" | grep -c '\.line$')" -eq 1 ] \
    || { fail $t "spurious events queued: $(cat "$Q"/*.line)"; return; }
  pass $t
}

test_no_identity_is_silent
test_empty_queue_is_silent
test_delivers_in_order_and_empties_queue
test_session_start_fresh_discards
test_session_start_resume_keeps
test_abandoned_claim_redelivered
test_concurrent_drains_deliver_once
test_watcher_queues_never_prints
test_watcher_migrates_legacy_state

printf '\n===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failed: %s\n' "${FAILED_TESTS[*]}"
  exit 1
fi
exit 0
