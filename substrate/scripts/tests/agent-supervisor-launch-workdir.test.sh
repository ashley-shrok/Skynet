#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2034
# Covers where launch() starts an identity and whether it resumes:
#
#   T-01  — recorded workdir exists: resume there
#   T-02  — recorded workdir missing, workspace present: still resume, in the workspace
#   T-03  — recorded workdir missing, no workspace: still resume, in $HOME
#   T-04  — no prior session, workspace present: fresh /id in the workspace
#   T-05  — no prior session, workspace missing: workspace created, fresh /id there
#   T-06  — launch_line cd's into the workdir first (quoted — spaces survive), with and without
#           --resume; no workdir → no cd
#   T-07  — a real shell already sitting in another dir: the typed launch line still starts the
#           command in the chosen workdir
#   T-08  — every launch site (drive fresh/resume, redrive) types launch_line with the workdir
#   T-09  — the launch line's cd works in dash (the dormant pane's shell) for awkward paths
#   T-10  — do_wake uses the same workdir rules: no session, no workspace → created, driven there
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

RESOLVED=""
run "T-05 no prior session, no workspace → created, fresh there" eve "resume= cwd=$AGENT_IDENTITIES_DIR/eve/workspace"
[ -d "$AGENT_IDENTITIES_DIR/eve/workspace" ] || fail "T-05: workspace not created"
grep -q "workspace/ was missing — created" "$LOG" || fail "T-05: no log line for the created workspace"

CURRENT_TEST="T-06 launch_line cd's into the (quoted) workdir first"
MEMORY_WRAPPER="" CLAUDE_LAUNCH_ENV="" CLAUDE=claude CLAUDE_LAUNCH_FLAGS="--x"
compute_mcp_env() { :; }; compute_mcp_flags() { :; }
ok=1
l1="$(launch_line zed "" "$REAL")"; l2="$(launch_line zed sid-1 "$REAL")"; l3="$(launch_line zed "" "")"
case "$l1" in "cd '$REAL' && "*" claude --x"*) ;; *) ok=0; fail "fresh line: $l1" ;; esac
case "$l2" in "cd '$REAL' && "*" claude --resume sid-1 --x"*) ;; *) ok=0; fail "resume line: $l2" ;; esac
case "$l3" in cd*) ok=0; fail "no-cwd line still cd's: $l3" ;; esac
[ "$ok" = 1 ] && pass

CURRENT_TEST="T-07 a shell sitting elsewhere still starts the command in the workdir"
CLAUDE="pwd >"; CLAUDE_LAUNCH_FLAGS="$(printf '%q' "$SCRATCH/where")"
line="$(launch_line zed "" "$REAL")"
( cd "$SCRATCH" && eval "$line" )
got="$(cat "$SCRATCH/where" 2>/dev/null)"
if [ "$got" = "$REAL" ]; then pass; else fail "command ran in '$got', want '$REAL'"; fi

CURRENT_TEST="T-08 every launch site types launch_line with the workdir"
src="$(cat "$SUPERVISOR")"
n_sites="$(printf '%s\n' "$src" | grep -c 'send-keys -t "$sess" -l "$(launch_line "$name" "[^"]*" "$cwd")"')"
n_raw="$(printf '%s\n' "$src" | grep -c 'send-keys .*-l "$MEMORY_WRAPPER')"
n_redrive="$(printf '%s\n' "$src" | grep -E 'redrive_claude "\$name" "\$sess" "[^"]*"' | grep -vc '"\$cwd"$')"
if [ "$n_sites" = 4 ] && [ "$n_raw" = 0 ] && [ "$n_redrive" = 0 ]; then pass
else fail "launch_line sites=$n_sites (want 4), raw launch lines=$n_raw, redrives without cwd=$n_redrive"; fi

CURRENT_TEST="T-09 the cd works in dash for a path with a quote, a space and non-ASCII"
ODD="$SCRATCH/it's a dir é"; mkdir -p "$ODD"; rm -f "$SCRATCH/where"
line="$(launch_line zed "" "$ODD")"
if command -v dash >/dev/null 2>&1; then
  ( cd "$SCRATCH" && dash -c "$line" )
  got="$(cat "$SCRATCH/where" 2>/dev/null)"
  if [ "$got" = "$ODD" ]; then pass; else fail "dash ran it in '$got', want '$ODD'"; fi
else pass; fi

CURRENT_TEST="T-10 do_wake: no session, no workspace → workspace created and driven there"
RESOLVED=""; DRIVEN=""; mkdir -p "$AGENT_IDENTITIES_DIR/fay"
do_wake fay fay test >/dev/null 2>&1
if [ "$DRIVEN" = "resume= cwd=$AGENT_IDENTITIES_DIR/fay/workspace" ] && [ -d "$AGENT_IDENTITIES_DIR/fay/workspace" ]; then pass
else fail "drive got '$DRIVEN'"; fi

printf '\nPASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
