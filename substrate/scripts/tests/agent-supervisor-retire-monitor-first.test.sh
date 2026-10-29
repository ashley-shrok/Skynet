#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2034
# Covers retire step 0 — the identity's ambient monitor (and so every watcher child) is stopped
# BEFORE its chat account is switched off. Otherwise the relay receiver sees M_UNKNOWN_TOKEN,
# injects "AUTH DEAD", and that paste merges with step 2's /exit into one ordinary message.
#
#   T-01  — stop_ambient_monitor stops the identity's monitor, not one whose name shares the prefix,
#           and reports the session from the monitor's own --inject-to argument
#   T-02  — a monitor that ignores SIGTERM is SIGKILLed after the cap, with its child's group
#   T-03  — retire_identity: the monitor is already gone when the account switch-off runs
#   T-04  — retire_identity: a failed switch-off restarts the monitor on the session it was
#           injecting into, and returns 1
#   T-05  — a second failed switch-off within 15 minutes does NOT restart it again
#   T-06  — no monitor running (sleeping agent): a failed switch-off restarts nothing
#   T-07  — a successful switch-off restarts nothing and clears the restart marker
#   T-08  — the real retire_deactivate_account (split out of retire_identity) returns 1 with no
#           relay.json, so retire_identity returns 1
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-retire-monitor-first.test.sh
#   Run from the repo root.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"

if [ ! -f "$SUPERVISOR" ]; then
  printf 'FATAL: supervisor not found at %s\n' "$SUPERVISOR" >&2
  exit 1
fi

PASS=0
FAIL=0
FAILURES=()
CURRENT_TEST=""

pass() { PASS=$((PASS+1)); printf 'PASS: %s\n' "$CURRENT_TEST"; }
fail() {
  FAIL=$((FAIL+1))
  FAILURES+=("$CURRENT_TEST: $1")
  printf 'FAIL: %s — %s\n' "$CURRENT_TEST" "$1" >&2
}

SCRATCH="$(mktemp -d)"
STARTED=()
cleanup() {
  local p
  for p in "${STARTED[@]}"; do kill -9 "$p" 2>/dev/null; done
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

export AGENT_SUPERVISOR_LIB_ONLY=1
export AGENT_IDENTITIES_DIR="$SCRATCH/identities"
export AGENT_IDENTITIES_ARCHIVE_DIR="$SCRATCH/identities-archive"
export DORMANCY_STATE_DIR="$SCRATCH/.state"
export AGENT_SUPERVISOR_CONF=/dev/null
mkdir -p "$AGENT_IDENTITIES_DIR" "$AGENT_IDENTITIES_ARCHIVE_DIR" "$DORMANCY_STATE_DIR" "$SCRATCH/bin"

# A stand-in monitor: its command line has the launch shape the supervisor matches on.
cat > "$SCRATCH/bin/ambient-monitor" <<'MON'
trap 'exit 0' TERM
while :; do sleep 0.1; done
MON
# One that ignores SIGTERM and has a child in its own process group (like the real watchers).
cat > "$SCRATCH/bin/hung-ambient-monitor" <<'MON'
trap '' TERM
setsid sleep 300 &
echo $! > "$HUNG_CHILD_FILE"
while :; do sleep 0.1; done
MON

# shellcheck disable=SC1090
source "$SUPERVISOR" 2>/dev/null || true
log() { :; }

for fn in stop_ambient_monitor retire_deactivate_account retire_identity wait_ambient_monitor_exit; do
  if ! declare -F "$fn" >/dev/null 2>&1; then
    printf 'FATAL: %s not defined after sourcing supervisor\n' "$fn" >&2
    exit 1
  fi
done
# Keep the real step-1 function for T-08 before stubbing it.
eval "real_$(declare -f retire_deactivate_account)"

# start_fake_monitor <name> <session> [script] — PID lands in $FAKE_PID.
# (Not printed: a $(...) caller would wait on the backgrounded process's stdout forever.)
start_fake_monitor() {
  bash "$SCRATCH/bin/${3:-ambient-monitor}" "$IDENTITIES_DIR/$1" --inject-to "$2" --harness-pid 1 \
    >/dev/null 2>&1 </dev/null &
  FAKE_PID=$!
  disown "$FAKE_PID" 2>/dev/null
  STARTED+=("$FAKE_PID")
  sleep 0.3
}
alive() { kill -0 "$1" 2>/dev/null; }

launch_newborns_midtick() { :; }
match_session() { return 1; }   # no tmux session: steps 2/3 are no-ops
START_CALLS="$SCRATCH/start.calls"
start_ambient_monitor() { printf '%s %s\n' "$1" "$2" >> "$START_CALLS"; }
DEACT_RC=1
MON_PID=""
retire_deactivate_account() {
  if alive "$MON_PID"; then echo alive > "$SCRATCH/at-deactivate"; else echo gone > "$SCRATCH/at-deactivate"; fi
  return "$DEACT_RC"
}
MARKER="$DORMANCY_STATE_DIR/alice.retire-monitor-restarted"
reset() { rm -f "$START_CALLS" "$SCRATCH/at-deactivate" "$MARKER"; MON_PID=""; DEACT_RC=1; }
mkdir -p "$AGENT_IDENTITIES_DIR/alice" "$AGENT_IDENTITIES_DIR/alice-2"

CURRENT_TEST="T-01 stops only the named monitor; session read from its argv"
start_fake_monitor alice sess-a; a=$FAKE_PID; start_fake_monitor alice-2 sess-b; b=$FAKE_PID
stop_ambient_monitor alice 3
ok=1
alive "$a" && { ok=0; fail "alice's monitor still running"; }
alive "$b" || { ok=0; fail "alice-2's monitor was stopped too"; }
[ "$STOPPED_MONITOR_SESSION" = sess-a ] || { ok=0; fail "session='$STOPPED_MONITOR_SESSION'"; }
kill "$b" 2>/dev/null
[ "$ok" = 1 ] && pass

CURRENT_TEST="T-02 a monitor ignoring SIGTERM is SIGKILLed with its child group"
export HUNG_CHILD_FILE="$SCRATCH/hung-child"
start_fake_monitor alice sess-a hung-ambient-monitor; h=$FAKE_PID
hc="$(cat "$HUNG_CHILD_FILE" 2>/dev/null)"; STARTED+=("$hc")
stop_ambient_monitor alice 1
sleep 0.3
ok=1
alive "$h" && { ok=0; fail "hung monitor still running"; }
[ -n "$hc" ] && alive "$hc" && { ok=0; fail "its child still running"; }
case "$STOPPED_MONITOR_OUTCOME" in *SIGKILL*) ;; *) ok=0; fail "outcome='$STOPPED_MONITOR_OUTCOME'";; esac
[ "$ok" = 1 ] && pass

CURRENT_TEST="T-03 the monitor is gone before the account switch-off runs"
reset; start_fake_monitor alice sess-a; MON_PID=$FAKE_PID
retire_identity alice
got="$(cat "$SCRATCH/at-deactivate" 2>/dev/null)"
if [ "$got" = gone ]; then pass; else fail "monitor at switch-off was '${got:-not called}'"; fi

CURRENT_TEST="T-04 failed switch-off restarts the monitor on its own session, returns 1"
reset; start_fake_monitor alice sess-a; MON_PID=$FAKE_PID
retire_identity alice; rc=$?
got="$(cat "$START_CALLS" 2>/dev/null)"
if [ "$rc" = 1 ] && [ "$got" = "alice sess-a" ] && [ -f "$MARKER" ]; then pass
else fail "rc=$rc restart calls='$got' marker=$([ -f "$MARKER" ] && echo yes || echo no)"; fi

CURRENT_TEST="T-05 a second failure within 15 minutes does not restart again"
rm -f "$START_CALLS"; start_fake_monitor alice sess-a; MON_PID=$FAKE_PID
retire_identity alice; rc=$?
if [ "$rc" = 1 ] && [ ! -e "$START_CALLS" ]; then pass
else fail "rc=$rc restart calls='$(cat "$START_CALLS" 2>/dev/null)'"; fi

CURRENT_TEST="T-06 no monitor running: a failed switch-off restarts nothing"
reset
retire_identity alice; rc=$?
if [ "$rc" = 1 ] && [ ! -e "$START_CALLS" ]; then pass
else fail "rc=$rc restart calls='$(cat "$START_CALLS" 2>/dev/null)'"; fi

CURRENT_TEST="T-07 successful switch-off restarts nothing and clears the marker"
reset; touch "$MARKER"; DEACT_RC=0
mkdir -p "$AGENT_IDENTITIES_DIR/bob"; : > "$AGENT_IDENTITIES_DIR/bob/bob.md"
MARKER="$DORMANCY_STATE_DIR/bob.retire-monitor-restarted"; touch "$MARKER"
start_fake_monitor bob sess-bob; MON_PID=$FAKE_PID
retire_identity bob >/dev/null 2>&1
ok=1
[ -e "$START_CALLS" ] && { ok=0; fail "restart called: $(cat "$START_CALLS")"; }
[ -e "$MARKER" ] && { ok=0; fail "marker not cleared"; }
alive "$MON_PID" && { ok=0; fail "monitor still running"; }
[ "$ok" = 1 ] && pass
MARKER="$DORMANCY_STATE_DIR/alice.retire-monitor-restarted"

CURRENT_TEST="T-08 real step-1 function: no relay.json → retire_identity returns 1"
reset
eval "$(declare -f real_retire_deactivate_account | sed '1s/^real_//')"
mkdir -p "$AGENT_IDENTITIES_DIR/carol"
retire_identity carol >/dev/null 2>&1; rc=$?
if [ "$rc" = 1 ] && [ -d "$AGENT_IDENTITIES_DIR/carol" ]; then pass; else fail "rc=$rc"; fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  %s\n' "${FAILURES[@]}" >&2
  exit 1
fi
exit 0
