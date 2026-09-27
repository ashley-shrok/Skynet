#!/usr/bin/env bash
# shellcheck shell=bash
#
# Hermetic test driver for substrate/scripts/allow-all-tools.sh — the
# PreToolUse hook that unconditionally emits permissionDecision:"allow"
# for every tool call the harness is about to run.
#
# The hook's contract is intentionally trivial:
#   1. Drain and discard stdin (whatever the harness sent).
#   2. Print a single JSON line on stdout matching the PreToolUse
#      allow-response envelope Claude Code expects, containing:
#        - hookSpecificOutput.hookEventName == "PreToolUse"
#        - hookSpecificOutput.permissionDecision == "allow"
#        - hookSpecificOutput.permissionDecisionReason (non-empty string)
#   3. Exit 0.
#
# The whole point of universal auto-allow is that the response DOES NOT
# depend on stdin. So the tests cover a variety of stdin shapes (empty,
# garbage, a realistic harness PreToolUse payload, a large blob, binary
# noise) and assert that stdout is byte-identical across all of them —
# regression guard against future edits that introduce accidental
# input-dependent behavior in the hook.
#
# Exits 0 on all-pass; exits 1 on any failure with a diagnostic naming
# the failing test.
#
# Usage: bash substrate/scripts/tests/allow-all-tools.test.sh
#   Run from the repo root.
#
# Requirements: bash, jq, coreutils (mktemp, printf, head, tr).

set -u  # -e NOT set — explicit assert helpers so a failing assert doesn't
        # silently skip subsequent tests.

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HOOK="$REPO_ROOT/substrate/scripts/allow-all-tools.sh"

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

# Run the hook with a given stdin payload; capture stdout, stderr, exit code.
# $1 = test name (for diagnostics; not used by this function but keeps the
#      call sites self-documenting)
# $2 = the stdin payload string (may be empty)
# Sets globals STDOUT, STDERR, EXITCODE.
#
# CRITICAL: do NOT use `<payload> | "$HOOK"` — bash runs the right side of a
# pipe in a subshell, so global assignments inside the pipeline don't
# propagate back. We write the payload to a temp file and redirect < instead.
STDOUT=""
STDERR=""
EXITCODE=0
run_hook() {
  local _payload="$2"
  local _tmpin _tmpout _tmperr
  _tmpin=$(mktemp)
  _tmpout=$(mktemp)
  _tmperr=$(mktemp)
  printf '%s' "$_payload" > "$_tmpin"
  "$HOOK" <"$_tmpin" >"$_tmpout" 2>"$_tmperr"
  EXITCODE=$?
  STDOUT=$(cat "$_tmpout")
  STDERR=$(cat "$_tmperr")
  rm -f "$_tmpin" "$_tmpout" "$_tmperr"
}

# Assert stdout matches the expected allow-response envelope. Uses jq so
# key ordering doesn't matter. Test name is $1 for diagnostics.
assert_valid_allow_response() {
  local _name="$1"

  if [ "$EXITCODE" -ne 0 ]; then
    fail "$_name" "exit code was $EXITCODE, expected 0"
    return
  fi

  # Parse stdout as JSON. If it doesn't parse, the hook is broken.
  local _parsed
  _parsed=$(printf '%s' "$STDOUT" | jq . 2>/dev/null)
  if [ -z "$_parsed" ]; then
    fail "$_name" "stdout was not valid JSON: $STDOUT"
    return
  fi

  local _event _decision _reason
  _event=$(printf '%s' "$STDOUT" | jq -r '.hookSpecificOutput.hookEventName // "MISSING"')
  _decision=$(printf '%s' "$STDOUT" | jq -r '.hookSpecificOutput.permissionDecision // "MISSING"')
  _reason=$(printf '%s' "$STDOUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // "MISSING"')

  if [ "$_event" != "PreToolUse" ]; then
    fail "$_name" "hookEventName was '$_event', expected 'PreToolUse'"
    return
  fi
  if [ "$_decision" != "allow" ]; then
    fail "$_name" "permissionDecision was '$_decision', expected 'allow'"
    return
  fi
  if [ "$_reason" = "MISSING" ] || [ -z "$_reason" ]; then
    fail "$_name" "permissionDecisionReason was missing or empty"
    return
  fi

  pass
}

# ---- tests ----

# Test 1: empty stdin (no bytes at all) → still returns allow.
# Guards against a future edit that accidentally makes the response
# depend on parsing stdin.
test_empty_stdin() {
  run_hook "empty_stdin" ""
  assert_valid_allow_response "empty_stdin"
}
test_empty_stdin

# Test 2: garbage stdin (random bytes, not JSON) → still returns allow.
# The hook must NOT try to parse or validate its stdin.
test_garbage_stdin() {
  # shellcheck disable=SC2016
  run_hook "garbage_stdin" 'not JSON $$$ lorem ipsum'
  assert_valid_allow_response "garbage_stdin"
}
test_garbage_stdin

# Test 3: realistic PreToolUse payload the harness actually sends → still
# returns allow. Shape verified empirically during shape-harness-permission
# -auto-accept.md spike (echoed by the harness into the hook process).
test_realistic_payload() {
  local _payload='{"session_id":"abc-123","transcript_path":"/tmp/x.jsonl","cwd":"/home/x","permission_mode":"default","effort":{"level":"high"},"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"rm -rf /some/path","description":"delete stuff"},"tool_use_id":"toolu_01ABC"}'
  run_hook "realistic_payload" "$_payload"
  assert_valid_allow_response "realistic_payload"
}
test_realistic_payload

# Test 4: a large stdin → still returns allow, doesn't hang, doesn't
# crash. The hook must drain input without choking (validates the
# `cat >/dev/null` drain works across meaningful volume).
test_large_stdin() {
  local _big
  _big=$(head -c 524288 /dev/urandom | tr -dc 'A-Za-z0-9' | head -c 262144)
  run_hook "large_stdin" "$_big"
  assert_valid_allow_response "large_stdin"
}
test_large_stdin

# Test 6: byte-identical stdout across a subset of the above inputs.
# The whole point of universal auto-allow is that the response DOES NOT
# depend on stdin. If two very different inputs produced two different
# outputs, that's a red flag — the hook is doing something conditional.
test_stdout_is_input_independent() {
  local _out_empty _out_realistic _out_garbage
  run_hook "input_indep_1" ""
  _out_empty="$STDOUT"
  run_hook "input_indep_2" "garbage"
  _out_garbage="$STDOUT"
  run_hook "input_indep_3" '{"tool_name":"Bash"}'
  _out_realistic="$STDOUT"

  if [ "$_out_empty" != "$_out_garbage" ] || [ "$_out_empty" != "$_out_realistic" ]; then
    fail "stdout_is_input_independent" "outputs differed across empty/garbage/realistic stdins — hook has conditional behavior"
    return
  fi
  pass
}
test_stdout_is_input_independent

# Test 7: the hook prints nothing to stderr on the happy path. Silence is
# a scope-in commitment (no per-fire logging; the volume would drown any
# real signal).
test_no_stderr_output() {
  run_hook "no_stderr" ""
  if [ -n "$STDERR" ]; then
    fail "no_stderr_output" "hook wrote to stderr: $STDERR"
    return
  fi
  pass
}
test_no_stderr_output

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
