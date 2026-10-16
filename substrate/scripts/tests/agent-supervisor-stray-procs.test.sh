#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2016,SC2034
# Covers the supervisor's stray-process teardown — nothing an identity started may outlive its
# archive, even when it was backgrounded out of the tmux session:
#
#   T-01  — procs_with_cwd_under finds a process working inside the dir (and a subdir), and not
#           one working in a sibling whose name shares the prefix
#   T-02  — procs_with_cwd_under still finds a process whose working directory was deleted
#   T-03  — procs_with_cwd_under honours min-age: a fresh process is spared
#   T-04  — kill_procs_under kills matching processes and leaves the others running
#   T-05  — kill_procs_under SIGKILLs a process that ignores SIGTERM
#   T-06  — kill_procs_under under DRY_RUN kills nothing
#   T-07  — reap_archived_strays kills an old process inside identities-archive/, spares a young one
#   T-08  — static: retire_identity kills strays BEFORE the folder move; reconcile calls the reaper
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-stray-procs.test.sh
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
mkdir -p "$AGENT_IDENTITIES_DIR" "$AGENT_IDENTITIES_ARCHIVE_DIR" "$DORMANCY_STATE_DIR"

# shellcheck source=/dev/null
source "$SUPERVISOR"
STRAY_KILL_GRACE=1
LOG="$SCRATCH/log"
log() { printf '%s\n' "$*" >> "$LOG"; }

# start_in <dir> [ignore-term] — start a long sleep working in <dir>, detached into its own
# session like a backgrounded dev server. Sets PID (not $(...) — a subshell would lose STARTED).
PID=""
start_in() {
  local dir="$1" ignore="${2:-}" pidfile="$SCRATCH/pid.$RANDOM"
  mkdir -p "$dir"
  if [ -n "$ignore" ]; then
    ( cd "$dir" && setsid bash -c 'trap "" TERM; echo $$ > "$1"; exec sleep 300' _ "$pidfile" </dev/null >/dev/null 2>&1 & )
  else
    ( cd "$dir" && setsid bash -c 'echo $$ > "$1"; exec sleep 300' _ "$pidfile" </dev/null >/dev/null 2>&1 & )
  fi
  local i
  for ((i = 0; i < 50; i++)); do [ -s "$pidfile" ] && break; sleep 0.1; done
  PID="$(cat "$pidfile")"
  STARTED+=("$PID")
}

alive() { kill -0 "$1" 2>/dev/null; }

# ---- T-01 ----
CURRENT_TEST="T-01 matches inside the dir, not a prefix-sharing sibling"
ID="$AGENT_IDENTITIES_DIR/ada"
start_in "$ID"; p_root="$PID"
start_in "$ID/workspace/repo"; p_sub="$PID"
start_in "$AGENT_IDENTITIES_DIR/ada-2/workspace"; p_sib="$PID"
# (A short-lived setsid wrapper working in the same dir may show up too — that is correct.)
found="$(procs_with_cwd_under "$ID")"
if ! printf '%s\n' "$found" | grep -qx "$p_root"; then fail "pid $p_root (dir root) not found"
elif ! printf '%s\n' "$found" | grep -qx "$p_sub"; then fail "pid $p_sub (subdir) not found"
elif printf '%s\n' "$found" | grep -qx "$p_sib"; then fail "prefix-sharing sibling $p_sib matched"
else pass; fi

# ---- T-02 ----
CURRENT_TEST="T-02 deleted working directory still matches"
start_in "$ID/workspace/gone"; p_del="$PID"
rm -rf "$ID/workspace/gone"
if procs_with_cwd_under "$ID" | grep -qx "$p_del"; then pass; else fail "pid $p_del not found after its cwd was deleted"; fi

# ---- T-03 ----
CURRENT_TEST="T-03 min-age spares a fresh process"
if procs_with_cwd_under "$ID" 3600 | grep -q .; then fail "fresh processes returned with min-age 3600"; else pass; fi

# ---- T-04 ----
CURRENT_TEST="T-04 kill_procs_under kills matches, leaves others"
kill_procs_under "$ID" "ada" "test"
sleep 0.3
if alive "$p_root" || alive "$p_sub" || alive "$p_del"; then
  fail "a matching process survived"
elif ! alive "$p_sib"; then
  fail "prefix-sharing sibling was killed"
elif ! grep -q "'ada' killing stray process(es) (test)" "$LOG"; then
  fail "no kill log line"
else
  pass
fi

# ---- T-05 ----
CURRENT_TEST="T-05 SIGTERM-ignoring process gets SIGKILLed"
start_in "$ID/stubborn" ignore; p_stub="$PID"
kill_procs_under "$ID" "ada" "test"
sleep 0.3
if alive "$p_stub"; then fail "pid $p_stub survived"
elif ! grep -q "SIGKILLed: *$p_stub" "$LOG"; then fail "no SIGKILL log line"
else pass; fi

# ---- T-06 ----
CURRENT_TEST="T-06 DRY_RUN kills nothing"
start_in "$ID"; p_dry="$PID"
DRY_RUN=1 kill_procs_under "$ID" "ada" "test"
if alive "$p_dry"; then pass; else fail "pid $p_dry killed under DRY_RUN"; fi
kill -9 "$p_dry" 2>/dev/null

# ---- T-07 ----
CURRENT_TEST="T-07 reap_archived_strays: old killed, young spared"
start_in "$AGENT_IDENTITIES_ARCHIVE_DIR/bea/workspace"; p_young="$PID"
STRAY_REAP_MIN_AGE=3600
reap_archived_strays
if ! alive "$p_young"; then fail "young process killed despite min-age"
else
  STRAY_REAP_MIN_AGE=0
  reap_archived_strays
  sleep 0.3
  if alive "$p_young"; then fail "archived stray survived the reaper"; else pass; fi
fi

# ---- T-08 ----
CURRENT_TEST="T-08 static: retire kills strays before the move; reconcile runs the reaper"
body="$(declare -f retire_identity)"
kill_line="$(printf '%s\n' "$body" | grep -n 'kill_procs_under "\$iddir"' | head -1 | cut -d: -f1)"
move_line="$(printf '%s\n' "$body" | grep -n 'mv ' | head -1 | cut -d: -f1)"
if [ -z "$kill_line" ]; then fail "retire_identity never calls kill_procs_under \"\$iddir\""
elif [ -z "$move_line" ] || [ "$kill_line" -ge "$move_line" ]; then fail "kill (line $kill_line) is not before the folder move (line ${move_line:-?})"
elif ! declare -f reconcile | grep -q 'reap_archived_strays'; then fail "reconcile does not call reap_archived_strays"
else pass; fi

kill -9 "$p_sib" 2>/dev/null

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  %s\n' "${FAILURES[@]}" >&2
  exit 1
fi
exit 0
