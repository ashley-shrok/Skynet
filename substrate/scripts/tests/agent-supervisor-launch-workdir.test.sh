#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2034
# Covers where launch() starts an identity and whether it resumes:
#
#   T-01  — recorded workdir exists: resume there
#   T-02  — recorded workdir missing, workspace present: still resume, in the workspace
#   T-03  — recorded workdir missing, no workspace: still resume, in $HOME
#   T-04  — no prior session, workspace present: fresh /id in the workspace
#
# resolve_session, drive and the trust/dialog helpers are stubbed; tmux runs on a private server.
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-launch-workdir.test.sh
#   Run from the repo root.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"
[ -f "$SUPERVISOR" ] || { printf 'FATAL: supervisor not found at %s\n' "$SUPERVISOR" >&2; exit 1; }

PASS=0
FAIL=0
CURRENT_TEST=""
pass() { PASS=$((PASS+1)); printf 'PASS: %s\n' "$CURRENT_TEST"; }
fail() { FAIL=$((FAIL+1)); printf 'FAIL: %s — %s\n' "$CURRENT_TEST" "$1" >&2; }

SCRATCH="$(mktemp -d)"
unset TMUX TMUX_PANE
export TMUX_TMPDIR="$SCRATCH/tmux"
mkdir -p "$TMUX_TMPDIR"
cleanup() { tmux kill-server 2>/dev/null; rm -rf "$SCRATCH"; }
trap cleanup EXIT

export AGENT_SUPERVISOR_LIB_ONLY=1
export AGENT_IDENTITIES_DIR="$SCRATCH/identities"
export AGENT_IDENTITIES_ARCHIVE_DIR="$SCRATCH/identities-archive"
export DORMANCY_STATE_DIR="$SCRATCH/.state"
export AGENT_SUPERVISOR_CONF=/dev/null
mkdir -p "$AGENT_IDENTITIES_DIR" "$AGENT_IDENTITIES_ARCHIVE_DIR" "$DORMANCY_STATE_DIR"

# shellcheck source=/dev/null
source "$SUPERVISOR"
LOG="$SCRATCH/log"
log() { printf '%s\n' "$*" >> "$LOG"; }
metric() { :; }
sleep() { :; }
accept_trust_for_workdir() { :; }
dismiss_resume_return_dialog() { :; }
RESOLVED=""                                   # "<cwd>\t<sid>" or empty = no prior session
resolve_session() { [ -n "$RESOLVED" ] || return 1; printf '%s\n' "$RESOLVED"; }
DRIVEN=""
drive() { DRIVEN="resume=$3 cwd=$4"; }

run() {
  CURRENT_TEST="$1"; local name="$2" want="$3"
  DRIVEN=""; : > "$LOG"
  launch "$name" fresh "$name"
  tmux kill-session -t "=$name" 2>/dev/null
  if [ "$DRIVEN" = "$want" ]; then pass; else fail "drive got '$DRIVEN', want '$want'"; fi
}

REAL="$SCRATCH/real dir"; mkdir -p "$REAL"
mkdir -p "$AGENT_IDENTITIES_DIR/ann/workspace" "$AGENT_IDENTITIES_DIR/bea/workspace" "$AGENT_IDENTITIES_DIR/cat" "$AGENT_IDENTITIES_DIR/dot/workspace"

RESOLVED="$REAL"$'\t'"sid-ann"
run "T-01 recorded workdir exists → resume there" ann "resume=sid-ann cwd=$REAL"

RESOLVED="$SCRATCH/gone"$'\t'"sid-bea"
run "T-02 recorded workdir missing → resume in the workspace" bea "resume=sid-bea cwd=$AGENT_IDENTITIES_DIR/bea/workspace"
grep -q "missing — resuming in" "$LOG" || fail "T-02: no log line for the missing workdir"

RESOLVED="$SCRATCH/gone"$'\t'"sid-cat"
run "T-03 recorded workdir missing, no workspace → resume in \$HOME" cat "resume=sid-cat cwd=$HOME"

RESOLVED=""
run "T-04 no prior session → fresh in the workspace" dot "resume= cwd=$AGENT_IDENTITIES_DIR/dot/workspace"

printf '\nPASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
