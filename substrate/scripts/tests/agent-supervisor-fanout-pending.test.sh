#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for agent-supervisor.sh pending_check vs role-file-watch's held
# fan-out lines.
#
# role-file-watch holds shared-file events in
# <identity>/role-file-watch/.state/pending/ for a fan-out delay. An identity
# with held lines must not be swept dormant, or the lines strand until some
# other trigger wakes it.
#
# Covers:
#   T-01 — nothing held → pending_check returns 0 (sweepable)
#   T-02 — a held .line → pending_check returns 1
#   T-03 — a .line.claimed (mid-delivery) → pending_check returns 1
#   T-04 — only a temp file (write in progress) → pending_check returns 0
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-fanout-pending.test.sh
#   Run from the repo root.

export AGENT_SUPERVISOR_LIB_ONLY=1

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"

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

# shellcheck disable=SC1090
source "$SUPERVISOR" 2>/dev/null || true
if ! declare -F pending_check >/dev/null 2>&1; then
  printf 'FATAL: pending_check not defined after sourcing supervisor\n' >&2
  exit 1
fi

SCRATCH=""
run_case() {
  CURRENT_TEST="$1"; shift
  SCRATCH=$(mktemp -d)
  IDENTITIES_DIR="$SCRATCH"
  SCHEDULE_PEEK_SNAPSHOT=()
  mkdir -p "$SCRATCH/alice/role-file-watch/.state/pending"
  printf -- '---\nroles: [test]\n---\n' > "$SCRATCH/alice/alice.md"
  PENDING="$SCRATCH/alice/role-file-watch/.state/pending"
  "$@"
  rm -rf "$SCRATCH"
}

t01() { if pending_check alice; then pass; else fail "expected 0 with nothing held"; fi; }
t02() {
  printf 'x' > "$PENDING/1760000000000-abcdef12.line"
  if pending_check alice; then fail "expected 1 with a held line"; else pass; fi
}
t03() {
  printf 'x' > "$PENDING/1760000000000-abcdef12.line.claimed"
  if pending_check alice; then fail "expected 1 with a claimed line"; else pass; fi
}
t04() {
  printf 'x' > "$PENDING/.1760000000000-abcdef12.line.tmp"
  if pending_check alice; then pass; else fail "expected 0 with only a temp file"; fi
}

run_case "T-01 nothing held" t01
run_case "T-02 held line blocks sweep" t02
run_case "T-03 claimed line blocks sweep" t03
run_case "T-04 temp file ignored" t04

printf '\n===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
