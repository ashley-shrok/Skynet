#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2034
# Test driver for wait_for_claude_ready: a resumed claude counts as ready only once its own
# ~/.claude/sessions/<pid>.json names the resumed session and carries a "status" field — not when
# the process merely exists, and not when the file exists without a status (claude writes that at
# startup, before its REPL).
#
# Covers:
#   T-01  — session file with "status":"idle" → ready immediately
#   T-02  — session file with "status":"busy" → ready (a REPL running a turn took input)
#   T-03  — session file without a status → not ready; returns 1 after the budget
#   T-04  — status appears partway through → ready once it does, before the budget
#   T-05  — no session file at all → not ready
#   T-06  — status file belongs to a non-claude process on the tty → ignored
#   T-07  — status file names a different session (stale file, reused pid) → ignored
#   T-08  — ps is asked for the pane's tty without its /dev/ prefix
#
# tmux (PATH stub) and ps (function) are stubbed. T-03/T-05/T-06/T-07 each spend their budget.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-claude-ready.test.sh  (from repo root)

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

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
export AGENT_PROJECTS_DIR="$SCRATCH/projects"
export AGENT_IDENTITIES_DIR="$SCRATCH/identities"
mkdir -p "$AGENT_PROJECTS_DIR" "$AGENT_IDENTITIES_DIR"

# shellcheck source=/dev/null
source "$SUPERVISOR" >/dev/null 2>&1
log() { :; }
CLAUDE_SESSIONS_DIR="$SCRATCH/sessions"
mkdir -p "$CLAUDE_SESSIONS_DIR"

# wait_for_claude_ready calls tmux via `timeout`, which execs a binary — so the stub is a PATH
# executable. ps is called directly, so a function stub is enough.
mkdir -p "$SCRATCH/bin"
cat >"$SCRATCH/bin/tmux" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  list-panes) echo /dev/pts/77 ;;
esac
exit 0
STUB
chmod +x "$SCRATCH/bin/tmux"
export PATH="$SCRATCH/bin:$PATH"

PS_COMM="claude"
PS_ARGS_FILE="$SCRATCH/ps-args"
ps() { printf '%s\n' "$*" >"$PS_ARGS_FILE"; printf '  4242 %s\n' "$PS_COMM"; }

reset() { rm -f "$CLAUDE_SESSIONS_DIR"/*; PS_COMM="claude"; }

# run_ready <budget> → sets RC and ELAPSED (whole seconds)
run_ready() {
  local t0=$SECONDS
  wait_for_claude_ready "sess" "s" "$1"; RC=$?
  ELAPSED=$((SECONDS-t0))
}

CURRENT_TEST="T-01 status idle → ready"
reset
printf '{"pid":4242,"sessionId":"s","status":"idle"}' >"$CLAUDE_SESSIONS_DIR/4242.json"
run_ready 2
if [ "$RC" -eq 0 ] && [ "$ELAPSED" -le 2 ]; then pass; else fail "rc=$RC elapsed=$ELAPSED"; fi

CURRENT_TEST="T-02 status busy → ready"
reset
printf '{"pid":4242,"sessionId":"s","status":"busy"}' >"$CLAUDE_SESSIONS_DIR/4242.json"
run_ready 2
if [ "$RC" -eq 0 ]; then pass; else fail "rc=$RC"; fi

CURRENT_TEST="T-03 file without status → not ready after budget"
reset
printf '{"pid":4242,"sessionId":"s","kind":"interactive"}' >"$CLAUDE_SESSIONS_DIR/4242.json"
run_ready 3
if [ "$RC" -eq 1 ] && [ "$ELAPSED" -ge 2 ]; then pass; else fail "rc=$RC elapsed=$ELAPSED"; fi

CURRENT_TEST="T-04 status appears partway → ready before budget"
reset
printf '{"pid":4242,"sessionId":"s"}' >"$CLAUDE_SESSIONS_DIR/4242.json"
( sleep 1; printf '{"pid":4242,"sessionId":"s","status":"idle"}' >"$CLAUDE_SESSIONS_DIR/4242.json" ) &
run_ready 5
wait
if [ "$RC" -eq 0 ] && [ "$ELAPSED" -lt 4 ]; then pass; else fail "rc=$RC elapsed=$ELAPSED"; fi

CURRENT_TEST="T-05 no session file → not ready"
reset
run_ready 2
if [ "$RC" -eq 1 ]; then pass; else fail "rc=$RC"; fi

CURRENT_TEST="T-06 non-claude process's file ignored"
reset
PS_COMM="bash"
printf '{"pid":4242,"sessionId":"s","status":"idle"}' >"$CLAUDE_SESSIONS_DIR/4242.json"
run_ready 2
if [ "$RC" -eq 1 ]; then pass; else fail "rc=$RC"; fi

CURRENT_TEST="T-07 file for a different session ignored"
reset
printf '{"pid":4242,"sessionId":"other","status":"idle"}' >"$CLAUDE_SESSIONS_DIR/4242.json"
run_ready 2
if [ "$RC" -eq 1 ]; then pass; else fail "rc=$RC"; fi

CURRENT_TEST="T-08 ps queried with the bare tty name"
reset
printf '{"pid":4242,"sessionId":"s","status":"idle"}' >"$CLAUDE_SESSIONS_DIR/4242.json"
run_ready 2
if [ "$RC" -eq 0 ] && grep -q -- '-t pts/77 ' "$PS_ARGS_FILE"; then pass; else fail "rc=$RC ps args: $(cat "$PS_ARGS_FILE" 2>/dev/null)"; fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  %s\n' "${FAILURES[@]}" >&2
  exit 1
fi
exit 0
