#!/usr/bin/env bash
# shellcheck shell=bash
#
# Hermetic test driver for substrate/scripts/precompact-reground.py — the
# PreCompact hook that tells the summarizer to leave out an identity's
# directive files and to end the summary with the agent's own note to
# re-load itself via the id skill.
#
# Each test builds a scratch ~/fleet under a temp HOME, feeds the hook a
# PreCompact payload with FLEET_IDENTITY set (or not), and asserts on stdout
# (which Claude Code appends to the summary's custom instructions).
#
# Exits 0 on all-pass; exits 1 on any failure with a diagnostic naming
# the failing test.
#
# Usage: bash substrate/scripts/tests/precompact-reground.test.sh
#   Run from the repo root.
#
# Requirements: bash, python3.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HOOK="$REPO_ROOT/substrate/scripts/precompact-reground.py"

if [ ! -x "$HOOK" ]; then
  printf 'FATAL: hook script not found or not executable at %s\n' "$HOOK" >&2
  exit 1
fi

PASS=0
FAIL=0
FAILED_TESTS=()

fail() {
  FAIL=$((FAIL + 1))
  FAILED_TESTS+=("$1")
  printf 'FAIL: %s — %s\n' "$1" "$2" >&2
}

pass() {
  PASS=$((PASS + 1))
}

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

F="$SCRATCH/home/fleet"
mkdir -p "$F/identities/alpha"
printf -- '---\nroles: []\n---\n\n# alpha\n' > "$F/identities/alpha/alpha.md"

# Run the hook: identity env value ("-" = unset), payload JSON. Prints stdout;
# fails the caller if the exit code is not 0.
run_hook() {
  local rc out
  if [ "$1" = "-" ]; then
    out="$(printf '%s' "$2" | env -u FLEET_IDENTITY HOME="$SCRATCH/home" "$HOOK")"; rc=$?
  else
    out="$(printf '%s' "$2" | HOME="$SCRATCH/home" FLEET_IDENTITY="$1" "$HOOK")"; rc=$?
  fi
  [ "$rc" -eq 0 ] || printf 'EXIT %s' "$rc"
  printf '%s' "$out"
}

assert_contains() {  # test, haystack, needle
  case "$2" in
    *"$3"*) return 0 ;;
  esac
  fail "$1" "expected output to contain: $3"
  return 1
}

# ---- tests ----

test_main_session_gets_instructions() {
  local t=test_main_session_gets_instructions out trig
  for trig in manual auto; do
    out="$(run_hook Alpha "{\"hook_event_name\":\"PreCompact\",\"trigger\":\"$trig\"}")"
    assert_contains $t "$out" "fleet identity \`alpha\`" || return
    assert_contains $t "$out" "Leave out everything the agent's standing directive files contain" || return
    assert_contains $t "$out" "~/fleet/identities/alpha/alpha.md" || return
    assert_contains $t "$out" "invoking the id skill with the argument \`alpha\` (Skill tool, skill \`id\`, args \`alpha\`)" || return
    assert_contains $t "$out" "I do not introduce myself again" || return
  done
  pass
}

test_silent_cases() {
  local t=test_silent_cases out
  # subagent compaction
  out="$(run_hook alpha '{"hook_event_name":"PreCompact","trigger":"auto","agent_id":"a1"}')"
  [ -z "$out" ] || { fail $t "spoke for a subagent: $out"; return; }
  # no identity in the environment
  out="$(run_hook - '{"hook_event_name":"PreCompact","trigger":"auto"}')"
  [ -z "$out" ] || { fail $t "spoke with no FLEET_IDENTITY: $out"; return; }
  # name with no identity file, and an invalid name
  out="$(run_hook nobody '{"trigger":"auto"}')"
  [ -z "$out" ] || { fail $t "spoke for a missing identity: $out"; return; }
  out="$(run_hook '../x' '{"trigger":"auto"}')"
  [ -z "$out" ] || { fail $t "spoke for an invalid name: $out"; return; }
  # garbage payload still never blocks (exit 0) and still speaks for alpha
  out="$(run_hook alpha 'not json')"
  assert_contains $t "$out" "fleet identity \`alpha\`" || return
  pass
}

test_main_session_gets_instructions
test_silent_cases

printf '\n===============================\nPASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  printf '  - %s\n' "${FAILED_TESTS[@]}"
  exit 1
fi
exit 0
