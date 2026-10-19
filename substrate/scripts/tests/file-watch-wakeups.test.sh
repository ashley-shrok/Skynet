#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for file-watch.py wake-up coverage — the identity's own
# `wakeups/<slug>/wakeup.json` specs — and the self-edit hook's wake-up claims.
#
# Covers:
#   T-W1 — cold start: existing wake-ups snapshot silently, `wakeups-armed`
#          is written.
#   T-W2 — someone else adds / edits / deletes a wake-up: `added` (spec
#          inline), `changed` (diff) and `deleted` lines.
#   T-W3 — the agent's own Write-tool create, Bash edit and Bash `rm -rf`
#          stay silent (claimed by slug, marked on release).
#   T-W4 — a long Bash call that creates a wake-up (`mkdir && cat >`, release
#          well after the write) stays silent.
#   T-W5 — the scheduler's own removal of a fired one_shot (`.fired` marker
#          written first) stays silent; `.state` bookkeeping never emits.
#   T-W6 — restart: a wake-up added while the watcher was down is reported,
#          one deleted is reported, a fired one_shot swept while down is not.
#   T-W7 — deleting and re-creating a wake-up in one call (`rm -rf … && cat >`)
#          is the agent's own edit: silent.
#   T-W8 — a call working inside `wakeups/<slug>/sensor/` claims nothing, so
#          a user edit to that wake-up meanwhile is still reported; churn in
#          the sensor folder never emits.
#   T-W9 — a `.fired` left by an earlier wake-up of the same name does not
#          hide a user's delete of the new one.
#
# Exits 0 on all-pass; 1 on any failure with a diagnostic naming the failing
# test.
#
# Usage: bash substrate/scripts/tests/file-watch-wakeups.test.sh
#   Run from the repo root.
#
# Requirements: bash, python3, inotifywait, sha256sum.

set -u

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WATCHER="$REPO_ROOT/substrate/scripts/file-watch.py"
SYNC_SCRIPT="$REPO_ROOT/substrate/scripts/self-edit-baseline-sync.sh"

for f in "$WATCHER" "$SYNC_SCRIPT"; do
  if [ ! -f "$f" ]; then
    printf 'FATAL: script missing: %s\n' "$f" >&2
    exit 1
  fi
done
for cmd in python3 inotifywait sha256sum jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf 'FATAL: %s not found\n' "$cmd" >&2
    exit 1
  fi
done

PASS=0
FAIL=0
FAILURES=()

declare -a ALL_TMPDIRS=()
declare -a ALL_PIDS=()

cleanup() {
  for _p in "${ALL_PIDS[@]+"${ALL_PIDS[@]}"}"; do
    [ -n "$_p" ] && kill "$_p" 2>/dev/null
  done
  for _d in "${ALL_TMPDIRS[@]+"${ALL_TMPDIRS[@]}"}"; do
    [ -n "$_d" ] && [ -d "$_d" ] && rm -rf "$_d"
  done
}
trap cleanup EXIT

make_tmpdir() {
  local d
  d=$(mktemp -d)
  ALL_TMPDIRS+=("$d")
  printf '%s' "$d"
}

fail() {
  local msg="${1:-unknown failure}"
  FAILURES+=("${CURRENT_TEST:-unknown}: $msg")
  FAIL=$((FAIL + 1))
}

run_test() {
  local test_fn="$1"
  local before_fail=$FAIL
  CURRENT_TEST="$test_fn"
  "$test_fn"
  if [ "$FAIL" -eq "$before_fail" ]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$test_fn"
  else
    printf 'FAIL  %s\n' "$test_fn"
  fi
}

# ---- fixture helpers ----

# seed: hermetic HOME with a roleless identity. Sets HOME_DIR, NAME,
# IDENT_DIR, STATE_DIR, WAKE_DIR.
seed() {
  NAME="$1"
  HOME_DIR=$(make_tmpdir)
  IDENT_DIR="$HOME_DIR/fleet/identities/$NAME"
  STATE_DIR="$IDENT_DIR/file-watch"
  WAKE_DIR="$IDENT_DIR/wakeups"
  mkdir -p "$IDENT_DIR" "$WAKE_DIR"
  printf -- '---\nroles: []\n---\n\n# %s\n' "$NAME" > "$IDENT_DIR/$NAME.md"
}

spec() {  # slug, schedule-json
  mkdir -p "$WAKE_DIR/$1"
  printf '{"name":"%s","enabled":true,"schedule":%s,"instruction":"do %s"}' "$1" "$2" "$1" \
    > "$WAKE_DIR/$1/wakeup.json"
}

launch_watcher() {
  OUT_LOG=$(make_tmpdir)/out.log
  ERR_LOG=$(make_tmpdir)/err.log
  HOME="$HOME_DIR" \
    AMBIENT_MONITOR_HARNESS_PID="$$" \
    FILE_WATCH_SELF_EDIT_SETTLE_MS=50 \
    python3 "$WATCHER" "$IDENT_DIR" >/dev/null 2>"$ERR_LOG" &
  WATCHER_PID=$!
  ALL_PIDS+=("$WATCHER_PID")
  [ -n "${COLLECTOR_PID:-}" ] && kill "$COLLECTOR_PID" 2>/dev/null
  ( q="$IDENT_DIR/pending-context"
    while :; do
      for f in $(ls "$q" 2>/dev/null | grep '\.line$' | sort); do
        cat "$q/$f"; echo; rm -f "$q/$f"
      done
      sleep 0.05
    done ) >>"$OUT_LOG" 2>/dev/null &
  COLLECTOR_PID=$!
  ALL_PIDS+=("$COLLECTOR_PID")
}

stop_watcher() {
  kill "$WATCHER_PID" 2>/dev/null
  wait "$WATCHER_PID" 2>/dev/null
}

# Watches are armed once inotifywait reports them; the startup pass has
# written `wakeups-armed` by then. A short sleep covers the gap.
wait_for_watcher() {
  local elapsed=0
  while [ "$elapsed" -lt 150 ]; do
    if [ -f "$STATE_DIR/wakeups-armed" ]; then
      sleep 0.5
      return 0
    fi
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  return 1
}

wait_for_match() {
  local pattern="$1" elapsed=0
  while [ "$elapsed" -lt 50 ]; do
    grep -qE "$pattern" "$OUT_LOG" 2>/dev/null && return 0
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  return 1
}

assert_quiet() {  # what, seconds
  sleep "${2:-1}"
  if grep -q '\[wakeup:' "$OUT_LOG" 2>/dev/null; then
    fail "$1 emitted: $(cat "$OUT_LOG")"
    return 1
  fi
  return 0
}

hook() {  # event, tool id, tool name, tool_input json
  printf '{"hook_event_name":"%s","tool_use_id":"%s","tool_name":"%s","tool_input":%s}' "$1" "$2" "$3" "$4" \
    | HOME="$HOME_DIR" FLEET_IDENTITY="$NAME" bash "$SYNC_SCRIPT"
}

# ---- tests ----

test_T_W1_cold_start_silent() {
  seed w1name
  spec existing '{"type":"daily","at":"09:00"}'
  launch_watcher
  if ! wait_for_watcher; then
    fail "watcher never started; err=$(cat "$ERR_LOG")"
    return
  fi
  [ -f "$STATE_DIR/last-snapshot.wakeup.existing" ] || fail "no baseline for existing wake-up"
  assert_quiet "cold start" 0.5
}

test_T_W2_others_add_edit_delete() {
  seed w2name
  launch_watcher
  wait_for_watcher || { fail "watcher never started"; return; }

  spec standup '{"type":"daily","at":"09:00"}'
  if ! wait_for_match '📝 \[wakeup: standup\] added — \{"name": "standup".*"instruction": "do standup"\}'; then
    fail "no added line; out=$(cat "$OUT_LOG") err=$(cat "$ERR_LOG")"
    return
  fi
  printf '{"name":"standup","enabled":false,"schedule":{"type":"daily","at":"09:00"},"instruction":"do standup"}' \
    > "$WAKE_DIR/standup/wakeup.json.tmp"
  mv "$WAKE_DIR/standup/wakeup.json.tmp" "$WAKE_DIR/standup/wakeup.json"
  if ! wait_for_match '📝 \[wakeup: standup\] your standup wake-up changed — .*"enabled":false'; then
    fail "no changed line; out=$(cat "$OUT_LOG")"
    return
  fi
  rm -rf "$WAKE_DIR/standup"
  if ! wait_for_match '📝 \[wakeup: standup\] deleted'; then
    fail "no deleted line; out=$(cat "$OUT_LOG")"
    return
  fi
  if [ "$(grep -c 'deleted' "$OUT_LOG")" != 1 ]; then
    fail "delete reported more than once; out=$(cat "$OUT_LOG")"
  fi
}

test_T_W3_own_write_edit_delete_silent() {
  seed w3name
  launch_watcher
  wait_for_watcher || { fail "watcher never started"; return; }

  local path="$WAKE_DIR/mine/wakeup.json"
  hook PreToolUse toolu_w3a Write "{\"file_path\":\"$path\"}"
  [ -f "$STATE_DIR/claims/last-snapshot.wakeup.mine.toolu_w3a" ] || fail "Write did not claim the new wake-up"
  spec mine '{"type":"interval","every":"2h"}'
  sleep 0.5
  hook PostToolUse toolu_w3a Write "{\"file_path\":\"$path\"}"
  assert_quiet "own Write create" || return

  local cmd="{\"command\":\"sed -i s/2h/3h/ ~/fleet/identities/w3name/wakeups/mine/wakeup.json\"}"
  hook PreToolUse toolu_w3b Bash "$cmd"
  sed -i s/2h/3h/ "$path"
  sleep 0.5
  hook PostToolUse toolu_w3b Bash "$cmd"
  assert_quiet "own Bash edit" || return

  cmd='{"command":"rm -rf ~/fleet/identities/w3name/wakeups/mine"}'
  hook PreToolUse toolu_w3c Bash "$cmd"
  [ -f "$STATE_DIR/claims/last-snapshot.wakeup.mine.toolu_w3c" ] || fail "rm -rf of the folder did not claim it"
  rm -rf "$WAKE_DIR/mine"
  sleep 0.5
  hook PostToolUse toolu_w3c Bash "$cmd"
  assert_quiet "own Bash delete" || return
  [ -f "$STATE_DIR/last-snapshot.wakeup.mine" ] && fail "baseline survived the delete"
  [ -f "$STATE_DIR/last-snapshot.wakeup.mine.self-delete" ] && fail "self-delete marker not consumed"
  return 0
}

test_T_W4_long_bash_create_silent() {
  seed w4name
  launch_watcher
  wait_for_watcher || { fail "watcher never started"; return; }

  local cmd='{"command":"mkdir -p ~/fleet/identities/w4name/wakeups/later && cat > ~/fleet/identities/w4name/wakeups/later/wakeup.json <<EOF ... EOF && sleep 3"}'
  hook PreToolUse toolu_w4 Bash "$cmd"
  [ -f "$STATE_DIR/claims/last-snapshot.wakeup.later.toolu_w4" ] || fail "Bash create did not claim the slug"
  spec later '{"type":"one_shot","at":"2030-01-01T09:00:00Z"}'
  sleep 1.5
  if grep -q '\[wakeup:' "$OUT_LOG"; then
    fail "emitted while the claiming call was in flight; out=$(cat "$OUT_LOG")"
    return
  fi
  hook PostToolUse toolu_w4 Bash "$cmd"
  assert_quiet "own long Bash create"
}

test_T_W5_scheduler_retire_and_state_quiet() {
  seed w5name
  spec once '{"type":"one_shot","at":"2020-01-01T09:00:00Z"}'
  launch_watcher
  wait_for_watcher || { fail "watcher never started"; return; }

  mkdir -p "$WAKE_DIR/once/.state"
  printf '1790000000' > "$WAKE_DIR/once/.state/once.last"
  printf '1790000000' > "$WAKE_DIR/once/.state/once.fired"
  rm -f "$WAKE_DIR/once/wakeup.json"
  assert_quiet "scheduler retiring a fired one_shot"
}

test_T_W6_changes_while_down() {
  seed w6name
  spec keep '{"type":"daily","at":"09:00"}'
  spec gone '{"type":"daily","at":"10:00"}'
  spec fired '{"type":"one_shot","at":"2020-01-01T09:00:00Z"}'
  launch_watcher
  wait_for_watcher || { fail "watcher never started"; return; }
  stop_watcher

  spec fresh '{"type":"weekly","day":"mon","at":"09:00"}'
  rm -rf "$WAKE_DIR/gone" "$WAKE_DIR/fired"
  launch_watcher
  wait_for_watcher || { fail "watcher never restarted"; return; }
  wait_for_match '📝 \[wakeup: fresh\] added' || fail "added-while-down not reported; out=$(cat "$OUT_LOG")"
  wait_for_match '📝 \[wakeup: gone\] deleted' || fail "deleted-while-down not reported; out=$(cat "$OUT_LOG")"
  if grep -qE '\[wakeup: (fired|keep)\]' "$OUT_LOG"; then
    fail "reported a swept one_shot or an unchanged wake-up; out=$(cat "$OUT_LOG")"
  fi
}

test_T_W7_delete_recreate_one_call_silent() {
  seed w7name
  spec swap '{"type":"daily","at":"09:00"}'
  launch_watcher
  wait_for_watcher || { fail "watcher never started"; return; }

  local cmd='{"command":"rm -rf ~/fleet/identities/w7name/wakeups/swap && mkdir -p ~/fleet/identities/w7name/wakeups/swap && cat > ~/fleet/identities/w7name/wakeups/swap/wakeup.json"}'
  hook PreToolUse toolu_w7 Bash "$cmd"
  rm -rf "$WAKE_DIR/swap"
  sleep 0.3
  spec swap '{"type":"daily","at":"10:00"}'
  sleep 0.5
  hook PostToolUse toolu_w7 Bash "$cmd"
  assert_quiet "own delete + re-create"
}

test_T_W8_sensor_work_claims_nothing() {
  seed w8name
  spec watcher '{"type":"sensor"}'
  mkdir -p "$WAKE_DIR/watcher/sensor"
  launch_watcher
  wait_for_watcher || { fail "watcher never started"; return; }

  local cmd='{"command":"cd ~/fleet/identities/w8name/wakeups/watcher/sensor && python3 check.py && sleep 3"}'
  hook PreToolUse toolu_w8 Bash "$cmd"
  if [ -n "$(find "$STATE_DIR/claims" -type f -name '*.toolu_w8' 2>/dev/null)" ]; then
    fail "sensor work claimed the spec: $(ls "$STATE_DIR/claims")"
    return
  fi
  for i in 1 2 3; do printf '%s' "$i" > "$WAKE_DIR/watcher/sensor/state.json"; done
  mkdir -p "$WAKE_DIR/watcher/sensor/node_modules/x"
  printf '{"name":"watcher","enabled":false,"schedule":{"type":"sensor"},"instruction":"do watcher"}' \
    > "$WAKE_DIR/watcher/wakeup.json"
  wait_for_match '📝 \[wakeup: watcher\] your watcher wake-up changed' \
    || fail "user edit during sensor work not reported; out=$(cat "$OUT_LOG")"
  hook PostToolUse toolu_w8 Bash "$cmd"
  if [ "$(grep -c '\[wakeup:' "$OUT_LOG")" != 1 ]; then
    fail "sensor folder churn emitted; out=$(cat "$OUT_LOG")"
  fi
}

test_T_W9_stale_fired_does_not_hide_delete() {
  seed w9name
  mkdir -p "$WAKE_DIR/again/.state"
  printf '1700000000' > "$WAKE_DIR/again/.state/again.fired"
  touch -d '2 hours ago' "$WAKE_DIR/again/.state/again.fired"
  spec again '{"type":"one_shot","at":"2030-01-01T09:00:00Z"}'
  launch_watcher
  wait_for_watcher || { fail "watcher never started"; return; }
  rm -f "$WAKE_DIR/again/wakeup.json"
  wait_for_match '📝 \[wakeup: again\] deleted' \
    || fail "user delete hidden by an old .fired; out=$(cat "$OUT_LOG")"
}

run_test test_T_W1_cold_start_silent
run_test test_T_W2_others_add_edit_delete
run_test test_T_W3_own_write_edit_delete_silent
run_test test_T_W4_long_bash_create_silent
run_test test_T_W5_scheduler_retire_and_state_quiet
run_test test_T_W6_changes_while_down
run_test test_T_W7_delete_recreate_one_call_silent
run_test test_T_W8_sensor_work_claims_nothing
run_test test_T_W9_stale_fired_does_not_hide_delete

printf '\n===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILURES[@]}"; do
    printf '  - %s\n' "$f"
  done
  exit 1
fi
exit 0
