#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317
# Test driver for dismiss_resume_return_dialog() — the supervisor's pre-launch write of the
# top-level resumeReturnDismissed flag into ~/.claude.json, which keeps Claude Code's cold-resume
# "usage limit" dialog (2.1.304+) from blocking a supervisor-woken agent.
#
# Covers:
#   T-01 — no ~/.claude.json: created holding just the flag; logged.
#   T-02 — existing config: flag added, every other key kept; mode 0600; no temp file left.
#   T-03 — flag already true: file not rewritten (inode + mtime unchanged), nothing logged.
#   T-04 — unparseable ~/.claude.json: left byte-for-byte alone (never clobbered).
#   T-05 — non-object JSON (an array): left alone.
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-resume-dialog.test.sh
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
command -v node >/dev/null 2>&1 || { printf 'FATAL: node not on PATH\n' >&2; exit 1; }

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

if ! declare -F dismiss_resume_return_dialog >/dev/null 2>&1; then
  printf 'FATAL: dismiss_resume_return_dialog not defined after sourcing supervisor\n' >&2
  exit 1
fi

SCRATCH=""
LOGF=""
REAL_HOME="$HOME"
setup_scratch() {
  SCRATCH=$(mktemp -d)
  export HOME="$SCRATCH"
  LOGF="$SCRATCH/log"
  : > "$LOGF"
}
teardown_scratch() {
  export HOME="$REAL_HOME"
  [ -n "$SCRATCH" ] && [ -d "$SCRATCH" ] && rm -rf "$SCRATCH"
  SCRATCH=""
}
run_case() {
  CURRENT_TEST="$1"; shift
  setup_scratch
  "$@"
  teardown_scratch
}

log() { printf '%s\n' "$*" >> "$LOGF"; }
cfg() { cat "$SCRATCH/.claude.json"; }
key() { node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(JSON.stringify(d[process.argv[2]]))' "$SCRATCH/.claude.json" "$1"; }

t01() {
  dismiss_resume_return_dialog
  [ "$(key resumeReturnDismissed)" = "true" ] || { fail "flag: $(cfg)"; return; }
  grep -q 'set resumeReturnDismissed' "$LOGF" || { fail "not logged"; return; }
  pass
}

t02() {
  printf '{"numStartups":5,"projects":{"/w":{"hasTrustDialogAccepted":true}}}' > "$SCRATCH/.claude.json"
  dismiss_resume_return_dialog
  [ "$(key resumeReturnDismissed)" = "true" ] || { fail "flag: $(cfg)"; return; }
  [ "$(key numStartups)" = "5" ] || { fail "numStartups lost: $(cfg)"; return; }
  [ "$(key projects)" = '{"/w":{"hasTrustDialogAccepted":true}}' ] || { fail "projects lost: $(cfg)"; return; }
  [ "$(stat -c %a "$SCRATCH/.claude.json")" = "600" ] || { fail "mode $(stat -c %a "$SCRATCH/.claude.json")"; return; }
  ls -A "$SCRATCH" | grep -q '\.tmp$' && { fail "temp file left: $(ls -A "$SCRATCH")"; return; }
  pass
}

t03() {
  printf '{"resumeReturnDismissed":true,"a":1}' > "$SCRATCH/.claude.json"
  touch -d '2020-01-01' "$SCRATCH/.claude.json"
  local before after
  before=$(stat -c '%i %Y' "$SCRATCH/.claude.json")
  dismiss_resume_return_dialog
  after=$(stat -c '%i %Y' "$SCRATCH/.claude.json")
  [ "$before" = "$after" ] || { fail "rewritten ($before → $after)"; return; }
  [ -s "$LOGF" ] && { fail "logged on noop: $(cat "$LOGF")"; return; }
  pass
}

t04() {
  printf '{"a":' > "$SCRATCH/.claude.json"
  dismiss_resume_return_dialog
  [ "$(cfg)" = '{"a":' ] || { fail "clobbered: $(cfg)"; return; }
  pass
}

t05() {
  printf '[1,2]' > "$SCRATCH/.claude.json"
  dismiss_resume_return_dialog
  [ "$(cfg)" = '[1,2]' ] || { fail "clobbered: $(cfg)"; return; }
  pass
}

run_case "T-01 missing config created with flag" t01
run_case "T-02 flag added, rest kept, 0600, no temp" t02
run_case "T-03 already set: no rewrite, no log" t03
run_case "T-04 unparseable config left alone" t04
run_case "T-05 non-object config left alone" t05

printf '\n===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
