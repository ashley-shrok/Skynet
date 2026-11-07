#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2034
# Covers the alive-check's ambient-monitor repair: a live harness the supervisor didn't bring up
# (relaunched by hand, or left behind when drive() bailed past the launch) gets a monitor started,
# instead of running DEAF until someone notices.
#
#   T-01  — snapshot_ambient_monitors maps each monitor to its identity and harness PID, without
#           confusing a name that prefixes another
#   T-02  — a monitor bound to the live harness: no repair
#   T-03  — no monitor at all: repaired on the identity's session, marker written
#   T-04  — a second miss within MONITOR_REPAIR_MINUTES: not repaired again
#   T-05  — .archive-requested present: never repaired (retire owns the monitor then)
#   T-06  — only a stale monitor (its harness gone): repaired
#   T-07  — snapshot miss, but a monitor for the current harness started since: no repair
#   T-08  — harness PID can't be resolved: left alone
#   T-09  — reconcile takes the snapshot and calls the repair from the alive branch
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-monitor-repair.test.sh
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

# shellcheck disable=SC1090
source "$SUPERVISOR" 2>/dev/null || true
log() { printf '%s\n' "$*" >> "$SCRATCH/log"; }
metric() { :; }

for fn in snapshot_ambient_monitors ambient_monitor_bound repair_ambient_monitor; do
  if ! declare -F "$fn" >/dev/null 2>&1; then
    printf 'FATAL: %s not defined after sourcing supervisor\n' "$fn" >&2
    exit 1
  fi
done

# start_bg <var> <cmd...> — run in the background, PID into <var>.
start_bg() {
  local __v="$1"; shift
  "$@" >/dev/null 2>&1 </dev/null &
  local p=$!
  disown "$p" 2>/dev/null
  STARTED+=("$p")
  printf -v "$__v" '%s' "$p"
}
# start_fake_monitor <name> <session> <harness-pid> — PID lands in $FAKE_PID.
start_fake_monitor() {
  start_bg FAKE_PID bash "$SCRATCH/bin/ambient-monitor" "$IDENTITIES_DIR/$1" --inject-to "$2" --harness-pid "$3"
  sleep 0.3
}

# The "harness": a plain process whose PID resolve_harness_pid hands back.
start_bg HARNESS sleep 300
HARNESS_PID="$HARNESS"
resolve_harness_pid() { [ -n "$HARNESS_PID" ] && printf '%s' "$HARNESS_PID"; }
START_CALLS="$SCRATCH/start.calls"
start_ambient_monitor() { printf '%s %s\n' "$1" "$2" >> "$START_CALLS"; }
MARKER="$DORMANCY_STATE_DIR/alice.monitor-repaired"
reset() {
  rm -f "$START_CALLS" "$MARKER" "$AGENT_IDENTITIES_DIR/alice/.archive-requested"
  local p; for p in "${STARTED[@]}"; do [ "$p" = "$HARNESS" ] || kill -9 "$p" 2>/dev/null; done
  HARNESS_PID="$HARNESS"
  sleep 0.2
}
mkdir -p "$AGENT_IDENTITIES_DIR/alice" "$AGENT_IDENTITIES_DIR/alice-2"

CURRENT_TEST="T-01 snapshot maps monitors to identity + harness PID"
reset
start_fake_monitor alice sess-a 4242; start_fake_monitor alice-2 sess-b 4343
snapshot_ambient_monitors
a="${AMBIENT_MONITOR_SNAPSHOT[alice]:-}"; b="${AMBIENT_MONITOR_SNAPSHOT[alice-2]:-}"
if [ "$a" = "4242 " ] && [ "$b" = "4343 " ]; then pass; else fail "alice='$a' alice-2='$b'"; fi

CURRENT_TEST="T-02 monitor bound to the live harness: no repair"
reset
start_fake_monitor alice sess-a "$HARNESS"
snapshot_ambient_monitors
repair_ambient_monitor alice sess-a
if [ ! -e "$START_CALLS" ]; then pass; else fail "repaired: $(cat "$START_CALLS")"; fi

CURRENT_TEST="T-03 no monitor: repaired on its session, marker written"
reset
snapshot_ambient_monitors
repair_ambient_monitor alice sess-a
got="$(cat "$START_CALLS" 2>/dev/null)"
if [ "$got" = "alice sess-a" ] && [ -f "$MARKER" ] && grep -q "REPAIRED" "$SCRATCH/log"; then pass
else fail "start calls='$got' marker=$([ -f "$MARKER" ] && echo yes || echo no)"; fi

CURRENT_TEST="T-04 second miss within the window: not repaired again"
rm -f "$START_CALLS"
repair_ambient_monitor alice sess-a
if [ ! -e "$START_CALLS" ] && grep -q "not repairing" "$SCRATCH/log"; then pass
else fail "start calls='$(cat "$START_CALLS" 2>/dev/null)'"; fi

CURRENT_TEST="T-05 .archive-requested: never repaired"
reset
touch "$AGENT_IDENTITIES_DIR/alice/.archive-requested"
snapshot_ambient_monitors
repair_ambient_monitor alice sess-a
if [ ! -e "$START_CALLS" ] && [ ! -e "$MARKER" ]; then pass; else fail "repaired during a retire"; fi

CURRENT_TEST="T-06 only a stale monitor (harness gone): repaired"
reset
start_bg OLD sleep 300; kill -9 "$OLD"; wait "$OLD" 2>/dev/null
start_fake_monitor alice sess-a "$OLD"
snapshot_ambient_monitors
repair_ambient_monitor alice sess-a
got="$(cat "$START_CALLS" 2>/dev/null)"
if [ "$got" = "alice sess-a" ]; then pass; else fail "start calls='$got'"; fi

CURRENT_TEST="T-07 snapshot miss, monitor started since: no repair"
reset
snapshot_ambient_monitors
start_fake_monitor alice sess-a "$HARNESS"
repair_ambient_monitor alice sess-a
if [ ! -e "$START_CALLS" ]; then pass; else fail "repaired: $(cat "$START_CALLS")"; fi

CURRENT_TEST="T-08 harness PID unresolvable: left alone"
reset
HARNESS_PID=""
snapshot_ambient_monitors
repair_ambient_monitor alice sess-a
if [ ! -e "$START_CALLS" ]; then pass; else fail "repaired: $(cat "$START_CALLS")"; fi

CURRENT_TEST="T-09 reconcile wires the snapshot and the alive-branch repair"
body="$(declare -f reconcile)"
ok=1
printf '%s' "$body" | grep -q 'snapshot_ambient_monitors' || { ok=0; fail "no snapshot call"; }
printf '%s' "$body" | grep -B2 -A3 'repair_ambient_monitor "\$name" "\$actual"' | grep -q 'alive — skip' || { ok=0; fail "repair not in the alive branch"; }
[ "$ok" = 1 ] && pass

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  %s\n' "${FAILURES[@]}" >&2
  exit 1
fi
exit 0
