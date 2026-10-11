#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317
# Test driver for snapshot_schedule_peek() — the dormant-wake check for
# scheduled wake-ups. Regression coverage for the `.anchored`/`.last` split
# (commit 9676e820): a recurring spec that has only been anchored (never
# fired) must still wake a dormant identity when its first slot comes due.
#
# Covers:
#   T-01  — daily, only .anchored, slot overdue → due
#   T-02  — daily, .last after today's slot → not due
#   T-03  — interval, only .anchored, anchor+every passed → due
#   T-04  — interval, only .anchored, anchor+every in future → not due
#   T-05  — weekly, only .anchored, this week's slot overdue → due
#   T-06  — no .last and no .anchored (never seen by scheduler) → not due
#   T-07  — .last wins over .anchored when both present
#   T-08  — yearly, only .anchored, this year's slot overdue → due
#   T-09  — yearly, .last after this year's slot → not due
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-schedule-peek.test.sh
#   Run from the repo root.

export AGENT_SUPERVISOR_LIB_ONLY=1

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

SCRATCH=""
setup_scratch() {
  SCRATCH=$(mktemp -d)
  IDENTITIES_DIR="$SCRATCH"
  METRICS_LOG="$SCRATCH/metrics.jsonl"
  IDENTITIES=(alice)
  mkdir -p "$SCRATCH/alice/wakeups/.state"
}

teardown_scratch() {
  [ -n "$SCRATCH" ] && [ -d "$SCRATCH" ] && rm -rf "$SCRATCH"
  SCRATCH=""
}

# shellcheck disable=SC1090
source "$SUPERVISOR" 2>/dev/null || true

if ! declare -F snapshot_schedule_peek >/dev/null 2>&1; then
  printf 'FATAL: snapshot_schedule_peek not defined after sourcing supervisor\n' >&2
  exit 1
fi

# Pin the window so the assertions don't depend on the box's conf.
FALSE_KILL_MINUTES=5

write_spec() { printf '%s\n' "$1" > "$SCRATCH/alice/wakeups/w.json"; }
write_state() { printf '%s' "$2" > "$SCRATCH/alice/wakeups/.state/w.$1"; }

expect_due() {
  snapshot_schedule_peek
  if schedule_peek alice; then pass; else fail "expected due, got not-due"; fi
}
expect_not_due() {
  snapshot_schedule_peek
  if schedule_peek alice; then fail "expected not-due, got due (${SCHEDULE_PEEK_SNAPSHOT[alice]:-})"; else pass; fi
}

run_case() {
  local name="$1"; shift
  CURRENT_TEST="$name"
  setup_scratch
  "$@"
  teardown_scratch
}

NOW=$(date +%s)
# A daily slot 10 minutes ago, box-local (no timezone key → box-local wall clock).
SLOT_PAST=$(date -d "@$((NOW - 600))" +%H:%M)
# Skip around midnight: a slot 10 min ago would land on yesterday's date.
if [ "$(date -d "@$((NOW - 600))" +%F)" != "$(date +%F)" ]; then
  printf 'SKIP: within 10 min of local midnight; rerun shortly\n'
  exit 0
fi

t01() {
  write_spec "{\"name\":\"w\",\"schedule\":{\"type\":\"daily\",\"at\":\"$SLOT_PAST\"},\"instruction\":\"x\"}"
  write_state anchored "$((NOW - 86400))"
  expect_due
}

t02() {
  write_spec "{\"name\":\"w\",\"schedule\":{\"type\":\"daily\",\"at\":\"$SLOT_PAST\"},\"instruction\":\"x\"}"
  write_state last "$((NOW - 60))"
  expect_not_due
}

t03() {
  write_spec '{"name":"w","schedule":{"type":"interval","every":"1h"},"instruction":"x"}'
  write_state anchored "$((NOW - 7200))"
  expect_due
}

t04() {
  write_spec '{"name":"w","schedule":{"type":"interval","every":"1h"},"instruction":"x"}'
  write_state anchored "$((NOW - 60))"
  expect_not_due
}

t05() {
  local day
  day=$(date -d "@$((NOW - 600))" +%a | tr '[:upper:]' '[:lower:]')
  write_spec "{\"name\":\"w\",\"schedule\":{\"type\":\"weekly\",\"day\":\"$day\",\"at\":\"$SLOT_PAST\"},\"instruction\":\"x\"}"
  write_state anchored "$((NOW - 3 * 86400))"
  expect_due
}

t06() {
  write_spec "{\"name\":\"w\",\"schedule\":{\"type\":\"daily\",\"at\":\"$SLOT_PAST\"},\"instruction\":\"x\"}"
  expect_not_due
}

t07() {
  write_spec '{"name":"w","schedule":{"type":"interval","every":"1h"},"instruction":"x"}'
  write_state anchored "$((NOW - 7200))"
  write_state last "$((NOW - 60))"
  expect_not_due
}

t08() {
  local date
  date=$(date -d "@$((NOW - 600))" +%m-%d)
  write_spec "{\"name\":\"w\",\"schedule\":{\"type\":\"yearly\",\"date\":\"$date\",\"at\":\"$SLOT_PAST\"},\"instruction\":\"x\"}"
  write_state anchored "$((NOW - 30 * 86400))"
  expect_due
}

t09() {
  local date
  date=$(date -d "@$((NOW - 600))" +%m-%d)
  write_spec "{\"name\":\"w\",\"schedule\":{\"type\":\"yearly\",\"date\":\"$date\",\"at\":\"$SLOT_PAST\"},\"instruction\":\"x\"}"
  write_state last "$((NOW - 60))"
  expect_not_due
}

run_case "T-01 daily anchored-only overdue → due" t01
run_case "T-02 daily fired after slot → not due" t02
run_case "T-03 interval anchored-only overdue → due" t03
run_case "T-04 interval anchored-only future → not due" t04
run_case "T-05 weekly anchored-only overdue → due" t05
run_case "T-06 no state at all → not due" t06
run_case "T-07 .last wins over .anchored" t07
run_case "T-08 yearly anchored-only overdue → due" t08
run_case "T-09 yearly fired after slot → not due" t09

printf '\n===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
