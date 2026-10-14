#!/usr/bin/env bash
# shellcheck shell=bash
#
# Hermetic test driver for substrate/scripts/resume-gap-notice.sh — the
# UserPromptSubmit hook that tells a session how long it has been since its
# previous activity when that gap is 30 minutes or more.
#
# Each test builds a scratch transcript (JSONL, one entry per line, shaped
# like Claude Code's) with timestamps relative to now, feeds the hook a
# UserPromptSubmit payload pointing at it, and asserts on stdout / exit code.
#
# Exits 0 on all-pass; exits 1 on any failure with a diagnostic naming
# the failing test.
#
# Usage: bash substrate/scripts/tests/resume-gap-notice.test.sh
#   Run from the repo root.
#
# Requirements: bash, jq, GNU coreutils (date -d, tac, mktemp).

set -u  # -e NOT set — explicit assert helpers so a failing assert doesn't
        # silently skip subsequent tests.

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HOOK="$REPO_ROOT/substrate/scripts/resume-gap-notice.sh"

if [ ! -x "$HOOK" ]; then
  printf 'FATAL: hook script not found or not executable at %s\n' "$HOOK" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  printf 'FATAL: jq not found — required for this test driver\n' >&2
  exit 1
fi

# ---- bookkeeping ----
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

# ISO-Z timestamp N seconds before now.
ago() { date -u -d "@$(( $(date -u +%s) - $1 ))" +%Y-%m-%dT%H:%M:%S.000Z; }

# Transcript line helpers.
entry()   { printf '{"type":"%s","timestamp":"%s","message":{"content":"x"}}\n' "$1" "$(ago "$2")"; }
untimed() { printf '{"type":"%s"}\n' "$1"; }

# Run the hook against transcript file $1. Sets STDOUT, STDERR, EXITCODE.
STDOUT=""
STDERR=""
EXITCODE=0
run_hook_on() {
  local _in _out _err
  _in=$(mktemp -p "$SCRATCH"); _out=$(mktemp -p "$SCRATCH"); _err=$(mktemp -p "$SCRATCH")
  jq -n --arg t "$1" '{session_id:"s",transcript_path:$t,cwd:"/tmp",hook_event_name:"UserPromptSubmit",prompt:"hello"}' > "$_in"
  "$HOOK" <"$_in" >"$_out" 2>"$_err"
  EXITCODE=$?
  STDOUT=$(cat "$_out"); STDERR=$(cat "$_err")
}

context() { printf '%s' "$STDOUT" | jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null; }

assert_silent() {
  if [ "$EXITCODE" -ne 0 ]; then fail "$1" "exit code $EXITCODE, expected 0"; return; fi
  if [ -n "$STDOUT" ]; then fail "$1" "expected no output, got: $STDOUT"; return; fi
  if [ -n "$STDERR" ]; then fail "$1" "expected no stderr, got: $STDERR"; return; fi
  pass
}

# $2 = expected duration phrase, e.g. "5 days 3 hours"
assert_notice() {
  if [ "$EXITCODE" -ne 0 ]; then fail "$1" "exit code $EXITCODE, expected 0"; return; fi
  local _ev; _ev=$(printf '%s' "$STDOUT" | jq -r '.hookSpecificOutput.hookEventName // ""' 2>/dev/null)
  if [ "$_ev" != "UserPromptSubmit" ]; then fail "$1" "hookEventName '$_ev', stdout: $STDOUT"; return; fi
  local _c; _c=$(context)
  case "$_c" in
    "It has been $2 since your last activity in this conversation (last active "*" UTC; now "*" UTC).") pass ;;
    *) fail "$1" "unexpected context: $_c" ;;
  esac
}

T="$SCRATCH/t.jsonl"

# ---- tests ----

# Multi-day gap: the arriving prompt (user entry, now) and its attachments
# must not count as previous activity; the last assistant turn does.
test_multi_day_gap() {
  { entry user 450000; entry assistant 446500; entry system 446450
    untimed last-prompt; untimed file-history-snapshot
    entry user 0; entry attachment 0; } > "$T"
  run_hook_on "$T"
  assert_notice multi_day_gap "5 days 4 hours"
}
test_multi_day_gap

# Hours + minutes.
test_hours_minutes() {
  { entry assistant $((2*3600 + 15*60 + 5)); entry user 0; } > "$T"
  run_hook_on "$T"
  assert_notice hours_minutes "2 hours 15 minutes"
}
test_hours_minutes

# Zero second unit is dropped; singular units.
test_exact_units() {
  { entry assistant $((86400 + 30)); } > "$T"; run_hook_on "$T"; assert_notice one_day "1 day"
  { entry assistant $((3600 + 20)); }  > "$T"; run_hook_on "$T"; assert_notice one_hour "1 hour"
  { entry assistant $((86400 + 3600 + 9)); } > "$T"; run_hook_on "$T"; assert_notice day_hour "1 day 1 hour"
}
test_exact_units

# Exactly at the threshold fires; just under stays silent.
test_threshold_edges() {
  { entry assistant 1800; } > "$T"; run_hook_on "$T"; assert_notice at_threshold "30 minutes"
  { entry assistant 1790; } > "$T"; run_hook_on "$T"; assert_silent under_threshold
}
test_threshold_edges

# A recent assistant turn after an old one: measured from the newest.
test_newest_activity_wins() {
  { entry assistant 90000; entry user 600; entry assistant 300; entry user 0; } > "$T"
  run_hook_on "$T"
  assert_silent newest_activity_wins
}
test_newest_activity_wins

# System entries written during the silence (a /loop wake stamp, an idle
# compaction notice) are not activity — the gap runs from the last assistant
# entry.
test_system_entries_ignored() {
  { entry assistant 7230; entry system 7200; entry system 5; entry user 0; } > "$T"
  run_hook_on "$T"
  assert_notice system_entries_ignored "2 hours"
}
test_system_entries_ignored

# A --resume writes a synthetic "Continue from where you left off." /
# "No response requested." pair stamped at reopen time, and failed API calls
# are recorded as synthetic assistant entries too — none of it is activity.
synthetic() { printf '{"type":"assistant","timestamp":"%s","message":{"model":"<synthetic>","content":"No response requested."}%s}\n' "$(ago "$1")" "${2:-}"; }
test_synthetic_entries_ignored() {
  { entry assistant $((5*3600 + 60)); entry user 5; synthetic 5; entry user 2; entry user 0; } > "$T"
  run_hook_on "$T"
  assert_notice resume_synthetic_pair "5 hours 1 minute"
  { entry assistant $((3*86400 + 60)); entry user 70; synthetic 65 ',"isApiErrorMessage":true'; entry user 0; } > "$T"
  run_hook_on "$T"
  assert_notice api_error_entry "3 days"
}
test_synthetic_entries_ignored

# Old user/attachment entries alone are not activity — a transcript with no
# assistant entries stays silent.
test_no_prior_activity() {
  { entry user 90000; entry attachment 90000; entry user 0; } > "$T"
  run_hook_on "$T"
  assert_silent no_prior_activity
}
test_no_prior_activity

# Partially-written trailing line is skipped, not fatal.
test_truncated_tail() {
  { untimed permission-mode; entry user 7300; entry assistant 7200; printf '{"type":"assistant","timest'; } > "$T"
  run_hook_on "$T"
  assert_notice truncated_tail "2 hours"
}
test_truncated_tail

# Missing transcript / empty payload / garbage payload: silent, exit 0.
test_bad_inputs() {
  run_hook_on "$SCRATCH/does-not-exist.jsonl"; assert_silent missing_transcript
  : > "$T"; run_hook_on "$T"; assert_silent empty_transcript
  local _out _rc
  _out=$(printf 'not json' | "$HOOK" 2>&1); _rc=$?
  if [ "$_rc" -eq 0 ] && [ -z "$_out" ]; then pass; else fail garbage_stdin "rc=$_rc out=$_out"; fi
  _out=$("$HOOK" </dev/null 2>&1); _rc=$?
  if [ "$_rc" -eq 0 ] && [ -z "$_out" ]; then pass; else fail empty_stdin "rc=$_rc out=$_out"; fi
}
test_bad_inputs

# No FLEET_IDENTITY gate — fires in an unsupervised session too.
test_no_identity_gate() {
  { entry assistant 7200; } > "$T"
  local _saved="${FLEET_IDENTITY-}" _had="${FLEET_IDENTITY+x}"
  unset FLEET_IDENTITY
  run_hook_on "$T"
  assert_notice no_identity_gate "2 hours"
  [ -n "$_had" ] && export FLEET_IDENTITY="$_saved"
}
test_no_identity_gate

# ---- summary ----

printf '\n===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for t in "${FAILED_TESTS[@]}"; do
    printf '  - %s\n' "$t"
  done
  exit 1
fi
exit 0
