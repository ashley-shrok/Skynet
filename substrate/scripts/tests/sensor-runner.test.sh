#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for sensor-runner + sensor-fire.
#
# sensor-runner runs against a scratch fleet and a fake `systemctl` that records
# every call and keeps per-unit ActiveState in files; a oneshot "start" runs the
# unit's launcher synchronously, so cadence sensors really execute.
#
# Covers:
#   SR-01 — draft sensor (sensor.json.pending only) gets no unit, no health
#   SR-02 — published always sensor: unit written (marker, env, restart backoff),
#           enabled + restarted, sensor.unit + health written
#   SR-03 — cadence sensor: first pass anchors, a due pass runs it; the real
#           launcher runs the command, which calls sensor-fire → one fire file
#   SR-04 — a cadence run still going when due: slot skipped, overrunning
#   SR-05 — failed cadence run → health failed with the log tail
#   SR-06 — disabling the trigger stops + removes the unit; health "stopped"
#   SR-07 — removing the trigger folder (archive/delete) removes the unit
#   SR-08 — invalid settings (incl. fire controls) → no unit, health "invalid" naming the problem
#   SR-09 — units the runner doesn't own (no marker) are never touched
#   SR-10 — scheduled-task sensors are handled the same way
#   SR-11 — sensor-fire: arguments, stdin, walk-up discovery, refusal outside a trigger
#   SR-12 — a half-written sensor.json keeps the unit for a few passes, then it goes
#   SR-13 — a failed stop keeps the unit file and retries next pass
#   SR-14 — a sensor folder whose trigger spec is gone never gets a .state/ created
#
# Usage: bash substrate/scripts/tests/sensor-runner.test.sh   (from the repo root)

set -u

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
RUNNER="$REPO_ROOT/substrate/scripts/sensor-runner"
FIRE="$REPO_ROOT/substrate/scripts/sensor-fire"
ENGINE="$REPO_ROOT/substrate/scripts/wakeup-scheduler.py"

PASS=0
FAIL=0
FAILURES=()
CURRENT_TEST=""

fail() { FAIL=$((FAIL + 1)); FAILURES+=("$CURRENT_TEST: $1"); }
assert_eq() { [ "$1" = "$2" ] || fail "${3:-assert_eq}: expected='$1' got='$2'"; }
assert_file() { [ -f "$1" ] || fail "${2:-assert_file}: missing $1"; }
assert_no_file() { [ ! -e "$1" ] || fail "${2:-assert_no_file}: should not exist: $1"; }
run_test() {
  local before=$FAIL
  CURRENT_TEST="$1"
  setup
  "$1"
  teardown
  if [ "$FAIL" -eq "$before" ]; then PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; else printf 'FAIL  %s\n' "$1"; fi
}

SCRATCH=""
setup() {
  SCRATCH=$(mktemp -d)
  export HOME="$SCRATCH/home"
  mkdir -p "$HOME/.local/bin" "$SCRATCH/fleet/identities/jarvis" "$SCRATCH/units" "$SCRATCH/sysd"
  printf -- '---\nroles: [r]\n---\n' > "$SCRATCH/fleet/identities/jarvis/jarvis.md"
  ln -s "$FIRE" "$HOME/.local/bin/sensor-fire"
  # Fake systemctl: log calls; ActiveState lives in $SCRATCH/sysd/<unit>.
  cat > "$SCRATCH/systemctl" <<'SH'
#!/bin/bash
D="$FAKE_SYSD"
echo "$*" >> "$D/calls.log"
[ "$1" = "--user" ] && shift
cmd="$1"; shift
args=()
for a in "$@"; do case "$a" in --no-block|--now|--value|-p|ActiveState) ;; *) args+=("$a") ;; esac; done
unit="${args[0]:-}"
case "$cmd" in
  show) cat "$D/$unit" 2>/dev/null || echo inactive ;;
  start|restart)
    f="$FAKE_UNITS/$unit"
    if grep -q '^Type=oneshot' "$f"; then
      [ -f "$D/$unit.hold" ] && { echo activating > "$D/$unit"; exit 0; }
      launcher=$(sed -n 's/^ExecStart=\/bin\/sh "\(.*\)"$/\1/p' "$f")
      wd=$(sed -n 's/^WorkingDirectory=//p' "$f")
      td=$(sed -n 's/.*"SENSOR_TRIGGER_DIR=\([^"]*\)".*/\1/p' "$f")
      logf=$(sed -n 's/^StandardOutput=append://p' "$f")
      (cd "$wd" && SENSOR_DIR="$wd" SENSOR_TRIGGER_DIR="$td" PATH="$HOME/.local/bin:$PATH" /bin/sh "$launcher" >> "$logf" 2>&1)
      echo inactive > "$D/$unit"
    else
      echo active > "$D/$unit"
    fi ;;
  disable) [ -f "$D/fail-disable" ] && exit 1; [ -n "$unit" ] && echo inactive > "$D/$unit" ;;
esac
exit 0
SH
  chmod +x "$SCRATCH/systemctl"
  export FAKE_SYSD="$SCRATCH/sysd" FAKE_UNITS="$SCRATCH/units"
  export SENSOR_RUNNER_FLEET="$SCRATCH/fleet" SENSOR_RUNNER_UNIT_DIR="$SCRATCH/units"
  export SENSOR_RUNNER_SYSTEMCTL="$SCRATCH/systemctl" SENSOR_RUNNER_WAKEUP_SCHEDULER="$ENGINE"
}
teardown() { [ -n "$SCRATCH" ] && rm -rf "$SCRATCH"; SCRATCH=""; }

runner_pass() { python3 "$RUNNER" --once 2>>"$SCRATCH/runner.err"; }

# make_wakeup <slug> <enabled true|false> <sensor.json body or ""> [pending]
make_wakeup() {
  local w="$SCRATCH/fleet/identities/jarvis/wakeups/$1"
  mkdir -p "$w/sensor"
  printf '{"name":"%s","enabled":%s,"schedule":{"type":"sensor"},"instruction":"Judge these"}\n' "$1" "$2" > "$w/wakeup.json"
  if [ -n "$3" ]; then
    if [ "${4:-}" = "pending" ]; then printf '%s\n' "$3" > "$w/sensor/sensor.json.pending"
    else printf '%s\n' "$3" > "$w/sensor/sensor.json"; fi
  fi
  printf '%s' "$w"
}
unit_file() { ls "$SCRATCH/units"/sensor-w-* 2>/dev/null | head -1; }
health() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$1/.state/sensor-health.json" "$2" 2>/dev/null; }
# age_anchor <trigger>: pretend the cadence was anchored an hour ago so it's due now.
age_anchor() { printf '%s' "$(( $(date +%s) - 3600 ))" > "$1/.state/sensor.cadence-anchored"; }

ALWAYS='{"run":"always","command":"sleep 1000"}'
CADENCE_FIRE='{"run":"cadence","cadence":{"type":"interval","every":"5m"},"command":"sensor-fire \"two candidates\""}'

SR01() {
  local w; w=$(make_wakeup draft true "$ALWAYS" pending)
  runner_pass
  assert_eq "" "$(unit_file)" "no unit for a draft"
  assert_no_file "$w/.state/sensor-health.json" "no health for a draft"
}

SR02() {
  local w u; w=$(make_wakeup deliveries true "$ALWAYS")
  runner_pass
  u=$(unit_file)
  assert_file "$u" "unit written"
  grep -q '^# Managed by sensor-runner' "$u" || fail "unit carries the managed marker"
  grep -q "^# sensor-trigger: $w\$" "$u" || fail "unit names its trigger"
  grep -q '^Type=simple$' "$u" || fail "always → simple"
  grep -q '^Restart=always$' "$u" || fail "always restarts"
  grep -q '^RestartMaxDelaySec=60$' "$u" || fail "restarts back off to a minute"
  grep -q '^StartLimitIntervalSec=0$' "$u" || fail "never gives up"
  grep -q "\"SENSOR_TRIGGER_DIR=$w\"" "$u" || fail "trigger dir in env"
  grep -q "^WorkingDirectory=$w/sensor\$" "$u" || fail "runs inside its sensor folder"
  grep -q "enable $(basename "$u")" "$SCRATCH/sysd/calls.log" || fail "enabled"
  grep -q "restart $(basename "$u")" "$SCRATCH/sysd/calls.log" || fail "started"
  grep -q "daemon-reload" "$SCRATCH/sysd/calls.log" || fail "daemon-reload"
  assert_eq "$(basename "$u")" "$(cat "$w/.state/sensor.unit")" "sensor.unit names the unit"
  grep -q "sleep 1000" "$w/.state/sensor-launch.sh" || fail "launcher runs the command"
  assert_eq "always" "$(health "$w" run)" "health run style"
  assert_eq "True" "$(health "$w" healthy)" "a fresh always sensor is healthy (starting)"
  # A second pass with nothing changed doesn't restart it.
  : > "$SCRATCH/sysd/calls.log"
  runner_pass
  grep -q "restart" "$SCRATCH/sysd/calls.log" && fail "unchanged sensor must not be restarted"
  true
}

SR03() {
  local w u; w=$(make_wakeup deliveries true "$CADENCE_FIRE")
  runner_pass
  u=$(unit_file)
  grep -q '^Type=oneshot$' "$u" || fail "cadence → oneshot"
  grep -q '^Restart=' "$u" && fail "cadence must not auto-restart"
  grep -q "enable" "$SCRATCH/sysd/calls.log" && fail "cadence units are not enabled"
  assert_file "$w/.state/sensor.cadence-anchored" "first pass anchors"
  [ -d "$w/fires" ] && [ -n "$(ls "$w/fires")" ] && fail "first pass must not run it"
  age_anchor "$w"
  runner_pass
  local fires; fires=$(ls "$w/fires" 2>/dev/null | grep -cE '^20[0-9]{6}T[0-9]{9}-[0-9a-f]{8}\.fire$')
  assert_eq "1" "$fires" "the run fired once"
  assert_eq "two candidates" "$(cat "$w"/fires/*.fire 2>/dev/null)" "findings verbatim"
  assert_eq "1" "$(cat "$w/.state/sensor.cadence-runs")" "run counted"
  grep -q "=== sensor run exited 0 ===" "$w/.state/sensor.log" || fail "log records the run"
  runner_pass
  assert_eq "idle" "$(health "$w" state)" "idle between runs"
  assert_eq "True" "$(health "$w" healthy)" "healthy after a good run"
  assert_eq "0" "$(health "$w" lastExitCode)" "exit code recorded"
}

SR04() {
  local w u; w=$(make_wakeup slow true "$CADENCE_FIRE")
  runner_pass
  u=$(basename "$(unit_file)")
  echo activating > "$SCRATCH/sysd/$u"          # a run is still going
  age_anchor "$w"
  runner_pass
  grep -q "start --no-block $u" "$SCRATCH/sysd/calls.log" && fail "must not start a second run"
  assert_eq "overrunning" "$(health "$w" state)" "marked overrunning"
  assert_eq "False" "$(health "$w" healthy)" "overrunning is unhealthy"
  assert_file "$w/.state/sensor.cadence-last" "the slot is used up, not queued"
}

SR05() {
  local w; w=$(make_wakeup broken true '{"run":"cadence","cadence":{"type":"interval","every":"5m"},"command":"echo boom-detail >&2; exit 3"}')
  runner_pass; age_anchor "$w"; runner_pass
  assert_eq "failed" "$(health "$w" state)" "failed run"
  assert_eq "False" "$(health "$w" healthy)" "unhealthy"
  assert_eq "3" "$(health "$w" lastExitCode)" "exit code"
  health "$w" error | grep -q "boom-detail" || fail "error carries the log tail"
  local since; since=$(health "$w" unhealthySince)
  [ -n "$since" ] && [ "$since" != "None" ] || fail "unhealthySince recorded"
  sleep 1; runner_pass
  assert_eq "$since" "$(health "$w" unhealthySince)" "unhealthySince carried forward while still broken"
}

SR06() {
  local w u; w=$(make_wakeup deliveries true "$ALWAYS")
  runner_pass
  u=$(unit_file)
  sed -i 's/"enabled":true/"enabled":false/' "$w/wakeup.json"
  runner_pass
  assert_no_file "$u" "unit removed when the trigger is switched off"
  grep -q "disable --now $(basename "$u")" "$SCRATCH/sysd/calls.log" || fail "stopped + disabled"
  assert_eq "stopped" "$(health "$w" state)" "health says stopped"
  sed -i 's/"enabled":false/"enabled":true/' "$w/wakeup.json"
  runner_pass
  assert_file "$u" "switching back on recreates it"
}

SR07() {
  local w u; w=$(make_wakeup deliveries true "$ALWAYS")
  runner_pass
  u=$(unit_file)
  mkdir -p "$SCRATCH/fleet/identities-archive"
  mv "$SCRATCH/fleet/identities/jarvis" "$SCRATCH/fleet/identities-archive/jarvis"
  runner_pass
  assert_no_file "$u" "archived identity's sensor unit removed"
  grep -q "disable --now $(basename "$u")" "$SCRATCH/sysd/calls.log" || fail "stopped on archive"
}

SR08() {
  local w; w=$(make_wakeup bad true '{"run":"sometimes","command":"x"}')
  runner_pass
  assert_eq "" "$(unit_file)" "no unit for invalid settings"
  assert_eq "invalid" "$(health "$w" state)" "health invalid"
  health "$w" error | grep -q '`run` must be' || fail "problem named: $(health "$w" error)"
  printf '{"run":"always","command":"x","maxPerHour":0}\n' > "$w/sensor/sensor.json"
  runner_pass
  assert_eq "" "$(unit_file)" "no unit for an invalid fire control"
  health "$w" error | grep -q '`maxPerHour` must be' || fail "fire-control problem named: $(health "$w" error)"
  printf '{"name":"x","enabled":true,"schedule":{"type":"daily","at":"09:00"},"instruction":"x"}\n' > "$w/wakeup.json"
  printf '%s\n' "$ALWAYS" > "$w/sensor/sensor.json"
  runner_pass
  assert_eq "" "$(unit_file)" "no unit when the trigger isn't sensor-typed"
  health "$w" error | grep -q 'not {"type": "sensor"}' || fail "problem named: $(health "$w" error)"
}

SR09() {
  printf '[Service]\nExecStart=/bin/true\n' > "$SCRATCH/units/sensor-check-for-deliveries-riley.service"
  printf '[Service]\nExecStart=/bin/true\n' > "$SCRATCH/units/sensor-runner.service"
  runner_pass
  assert_file "$SCRATCH/units/sensor-check-for-deliveries-riley.service" "hand-made unit untouched"
  assert_file "$SCRATCH/units/sensor-runner.service" "the runner's own unit untouched"
}

SR10() {
  local t="$SCRATCH/fleet/scheduled-agents/payday"
  mkdir -p "$t/sensor"
  printf '{"name":"payday","enabled":true,"roles":["r"],"schedule":{"type":"sensor"},"prompt":"p"}\n' > "$t/scheduled-agent.json"
  printf '%s\n' "$CADENCE_FIRE" > "$t/sensor/sensor.json"
  runner_pass; age_anchor "$t"; runner_pass
  ls "$SCRATCH/units"/sensor-t-payday-*.service >/dev/null 2>&1 || fail "task sensor unit"
  assert_eq "1" "$(ls "$t/fires" | grep -c '\.fire$')" "task sensor fired"
  rm -rf "$t"
  runner_pass
  ls "$SCRATCH/units"/sensor-t-payday-*.service >/dev/null 2>&1 && fail "deleted task's unit removed"
  true
}

SR11() {
  local w out; w=$(make_wakeup manual true "")
  out=$(cd "$w/sensor" && env -u SENSOR_TRIGGER_DIR python3 "$FIRE" found one)
  assert_file "$out" "fire written from walk-up discovery"
  assert_eq "found one" "$(cat "$out")" "argument findings"
  out=$(printf 'line1\nline2\n' | SENSOR_TRIGGER_DIR="$w" python3 "$FIRE")
  assert_eq "$(printf 'line1\nline2')" "$(cat "$out")" "stdin findings verbatim"
  [[ "$(basename "$out")" =~ ^20[0-9]{6}T[0-9]{9}-[0-9a-f]{8}\.fire$ ]] || fail "fire name shape: $out"
  (cd "$SCRATCH" && env -u SENSOR_TRIGGER_DIR python3 "$FIRE" x </dev/null >/dev/null 2>&1) && fail "refuses outside a trigger"
  true
}

SR12() {
  local w u; w=$(make_wakeup deliveries true "$ALWAYS")
  runner_pass
  u=$(unit_file)
  printf '{"run": "alw' > "$w/sensor/sensor.json"        # caught mid-write
  runner_pass
  assert_file "$u" "unit kept through an unreadable pass"
  grep -q "disable --now" "$SCRATCH/sysd/calls.log" && fail "must not stop a sensor over one unreadable read"
  printf '%s\n' "$ALWAYS" > "$w/sensor/sensor.json"
  runner_pass
  assert_file "$u" "still there once readable again"
  printf 'garbage' > "$w/sensor/sensor.json"
  # The unreadable count lives in the running process: give one runner several passes.
  SENSOR_RUNNER_POLL_SEC=0.3 timeout 3 python3 "$RUNNER" 2>>"$SCRATCH/runner.err"
  assert_no_file "$u" "persistently unreadable → unit removed"
  assert_eq "invalid" "$(health "$w" state)" "health invalid"
}

SR13() {
  local w u; w=$(make_wakeup deliveries true "$ALWAYS")
  runner_pass
  u=$(unit_file)
  sed -i 's/"enabled":true/"enabled":false/' "$w/wakeup.json"
  touch "$SCRATCH/sysd/fail-disable"
  runner_pass
  assert_file "$u" "unit file kept when the stop fails"
  rm -f "$SCRATCH/sysd/fail-disable"
  runner_pass
  assert_no_file "$u" "retried and removed next pass"
}

SR14() {
  local w="$SCRATCH/fleet/identities/jarvis/wakeups/ghost"
  mkdir -p "$w/sensor"
  printf '%s\n' "$ALWAYS" > "$w/sensor/sensor.json"     # sensor, but no wakeup.json
  runner_pass
  [ -e "$w/.state" ] && fail "no state folder for a trigger without a spec"
  assert_eq "" "$(unit_file)" "no unit"
}

SR15() {
  # Off means off even while the wake-up's identity sleeps; a tripped trigger
  # switched back on starts fresh; the box's own notes aren't error lines.
  local off on
  off=$(make_wakeup off false "$ALWAYS")
  mkdir -p "$off/fires"; printf 'x' > "$off/fires/20261014T100000000-00000001.fire"
  printf 'k' > "$off/fires/20261014T100000000-00000001.fire.key"
  on=$(make_wakeup on true '{"run":"always","command":"exit 3"}')
  mkdir -p "$on/.state"
  printf '{"at":"2026-10-14T00:00:00Z","limit":10,"fires":2,"specMtimeNs":1}' > "$on/.state/sensor-tripped.json"
  printf '{"deliveries":[%s],"keys":{"a":%s}}' "$(date +%s)" "$(date +%s)" > "$on/.state/sensor-ledger.json"
  printf '[2026-10-14T00:00:00Z] box: dropped duplicate fire x (key %s was delivered recently)\n' "'a'" > "$on/.state/sensor.log"
  runner_pass
  [ -e "$off/fires/20261014T100000000-00000001.fire" ] && fail "switched-off trigger's waiting fire discarded"
  [ -e "$off/fires/20261014T100000000-00000001.fire.key" ] && fail "its key file goes too"
  grep -q "box: discarded fire" "$off/.state/sensor.log" || fail "discard noted in the sensor's log"
  [ -e "$on/.state/sensor-tripped.json" ] && fail "trip record cleared once switched back on"
  python3 -c "import json,sys; l=json.load(open(sys.argv[1])); assert l['deliveries']==[] and 'a' in l['keys']" "$on/.state/sensor-ledger.json" \
    || fail "delivery count starts fresh, keys kept"
  printf 'boom\n[2026-10-14T00:00:01Z] box: discarded fire y\n' >> "$on/.state/sensor.log"
  python3 - "$RUNNER" "$on/.state/sensor.log" <<'PYX' || fail "box notes left out of error lines"
import importlib.util, sys
from importlib.machinery import SourceFileLoader
l = SourceFileLoader("sr", sys.argv[1]); sp = importlib.util.spec_from_loader("sr", l)
m = importlib.util.module_from_spec(sp); l.exec_module(m)
assert m.tail_lines(sys.argv[2], 10) == "boom", repr(m.tail_lines(sys.argv[2], 10))
PYX
}

for t in SR01 SR02 SR03 SR04 SR05 SR06 SR07 SR08 SR09 SR10 SR11 SR12 SR13 SR14 SR15; do run_test "$t"; done

printf '\n===============================\nPASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'; for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
