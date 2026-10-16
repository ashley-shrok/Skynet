#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2016,SC2034
# Covers dormant sessions running the minimal shell (DORMANT_SHELL) instead of a full bash:
#
#   T-01  — minimize_dormant_pane swaps an idle bash for DORMANT_SHELL, keeps the session and its
#           working directory, and clears the scrollback
#   T-02  — a second call is a no-op (already minimal)
#   T-03  — a shell with a child process is left alone
#   T-04  — an attached session is left alone
#   T-05  — a pane whose foreground command isn't a shell is left alone
#   T-06  — DRY_RUN swaps nothing
#   T-07  — empty DORMANT_SHELL (dash not installed) swaps nothing
#   T-08  — the launch command a wake types into a minimal pane runs, with the identity env and
#           with SHELL still pointing at the full shell (what claude's own tool calls use)
#   T-09  — snapshot_claude_running records each session's pane command
#   T-10  — static: do_kill_dormant minimizes after a successful kill; the dormant branch creates
#           post-reboot sessions on DORMANT_SHELL and minimizes leftover full-shell sessions
#
# Runs against a private tmux server (its own socket dir), never the box's real sessions.
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-dormant-shell.test.sh
#   Run from the repo root.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"

if [ ! -f "$SUPERVISOR" ]; then
  printf 'FATAL: supervisor not found at %s\n' "$SUPERVISOR" >&2
  exit 1
fi
if ! command -v dash >/dev/null 2>&1; then
  printf 'SKIP: dash not installed — nothing to test\n'
  exit 0
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
# A private tmux server: own socket dir, and no inherited $TMUX pointing at the real one.
unset TMUX TMUX_PANE
export TMUX_TMPDIR="$SCRATCH/tmux"
mkdir -p "$TMUX_TMPDIR"
cleanup() {
  tmux kill-server 2>/dev/null
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
LOG="$SCRATCH/log"
log() { printf '%s\n' "$*" >> "$LOG"; }
metric() { :; }

WD="$SCRATCH/work dir"
mkdir -p "$WD"

pane_cmd() { tmux display-message -p -t "=$1:" '#{pane_current_command}' 2>/dev/null; }
pane_path() { tmux display-message -p -t "=$1:" '#{pane_current_path}' 2>/dev/null; }
history_size() { tmux display-message -p -t "=$1:" '#{history_size}' 2>/dev/null; }

# new_bash_session <name> — a session on a full bash in $WD, with some scrollback.
new_bash_session() {
  tmux new-session -d -s "$1" -x 120 -y 10 -c "$WD" "bash --norc --noprofile"
  local i
  for ((i = 0; i < 30; i++)); do [ "$(pane_cmd "$1")" = bash ] && break; sleep 0.1; done
  tmux send-keys -t "=$1:" 'for i in $(seq 1 50); do echo line$i; done' Enter
  for ((i = 0; i < 30; i++)); do [ "$(history_size "$1")" -gt 0 ] 2>/dev/null && break; sleep 0.1; done
}

# wait_cmd <session> <cmd> — wait up to 3s for the pane's foreground command to become <cmd>.
wait_cmd() {
  local i
  for ((i = 0; i < 30; i++)); do [ "$(pane_cmd "$1")" = "$2" ] && return 0; sleep 0.1; done
  return 1
}

# ---- T-01 ----
CURRENT_TEST="T-01 idle bash is swapped for dash, session + cwd kept, scrollback cleared"
new_bash_session s1
minimize_dormant_pane ada s1
if ! tmux has-session -t =s1: 2>/dev/null; then fail "session gone"
elif ! wait_cmd s1 dash; then fail "pane command is '$(pane_cmd s1)', want dash"
elif [ "$(pane_path s1)" != "$WD" ]; then fail "cwd is '$(pane_path s1)', want '$WD'"
elif [ "$(history_size s1)" != 0 ]; then fail "history_size is $(history_size s1), want 0"
elif ! grep -q "swapped idle bash" "$LOG"; then fail "no swap log line"
else pass; fi

# ---- T-02 ----
CURRENT_TEST="T-02 second call is a no-op"
before="$(tmux display-message -p -t =s1: '#{pane_pid}')"
: > "$LOG"
minimize_dormant_pane ada s1
after="$(tmux display-message -p -t =s1: '#{pane_pid}')"
if [ "$before" != "$after" ]; then fail "pane respawned again ($before -> $after)"
elif [ -s "$LOG" ]; then fail "logged on a no-op: $(cat "$LOG")"
else pass; fi

# ---- T-03 ----
CURRENT_TEST="T-03 shell with a child process is left alone"
new_bash_session s3
tmux send-keys -t =s3: 'sleep 300 &' Enter
sleep 0.5
pid3="$(tmux display-message -p -t =s3: '#{pane_pid}')"
minimize_dormant_pane bea s3
if [ "$(pane_cmd s3)" != bash ]; then fail "pane command is '$(pane_cmd s3)', want bash"
elif [ "$(tmux display-message -p -t =s3: '#{pane_pid}')" != "$pid3" ]; then fail "pane was respawned"
else pass; fi

# ---- T-04 ----
CURRENT_TEST="T-04 attached session is left alone"
new_bash_session s4
# A control-mode client counts as attached and needs no terminal; the sleep holds its stdin open.
( sleep 300 | tmux -C attach -t =s4 >/dev/null 2>&1 ) &
ATTACH_PID=$!
for ((i = 0; i < 100; i++)); do [ "$(tmux display-message -p -t =s4: '#{session_attached}')" = 1 ] && break; sleep 0.1; done
if [ "$(tmux display-message -p -t =s4: '#{session_attached}')" != 1 ]; then
  fail "could not attach a client for the test"
else
  minimize_dormant_pane cal s4
  if [ "$(pane_cmd s4)" != bash ]; then fail "pane command is '$(pane_cmd s4)', want bash"
  else pass; fi
fi
tmux detach-client -s =s4 2>/dev/null
pkill -P "$ATTACH_PID" 2>/dev/null; kill "$ATTACH_PID" 2>/dev/null; wait "$ATTACH_PID" 2>/dev/null

# ---- T-05 ----
CURRENT_TEST="T-05 non-shell foreground command is left alone"
tmux new-session -d -s s5 -c "$WD" "sleep 300"
minimize_dormant_pane dee s5
if [ "$(pane_cmd s5)" != sleep ]; then fail "pane command is '$(pane_cmd s5)', want sleep"
else pass; fi

# ---- T-06 ----
CURRENT_TEST="T-06 DRY_RUN swaps nothing"
new_bash_session s6
DRY_RUN=1 minimize_dormant_pane eve s6
if [ "$(pane_cmd s6)" != bash ]; then fail "pane command is '$(pane_cmd s6)', want bash"
else pass; fi

# ---- T-07 ----
CURRENT_TEST="T-07 empty DORMANT_SHELL swaps nothing"
_saved="$DORMANT_SHELL"; DORMANT_SHELL=""
minimize_dormant_pane eve s6
DORMANT_SHELL="$_saved"
if [ "$(pane_cmd s6)" != bash ]; then fail "pane command is '$(pane_cmd s6)', want bash"
else pass; fi

# ---- T-08 ----
CURRENT_TEST="T-08 a typed launch command runs in the dash pane with the identity env"
OUT="$SCRATCH/t08.out"
# Same shape as drive()'s launch line: optional wrapper, env assignments, a command with flags.
tmux send-keys -t =s1: -l "env FLEET_IDENTITY=ada CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999 sh -c 'printf \"%s|%s|%s\\n\" \"\$FLEET_IDENTITY\" \"\$SHELL\" \"\$PWD\" > \"$OUT\"' --flag"
tmux send-keys -t =s1: Enter
for ((i = 0; i < 30; i++)); do [ -s "$OUT" ] && break; sleep 0.1; done
got="$(cat "$OUT" 2>/dev/null)"
want_shell="$(tmux show-environment -g SHELL 2>/dev/null | cut -d= -f2)"
[ -n "$want_shell" ] || want_shell="${SHELL:-}"
if [ -z "$got" ]; then fail "launch command did not run"
elif [ "${got%%|*}" != ada ]; then fail "FLEET_IDENTITY not passed: '$got'"
else
  rest="${got#*|}"; got_shell="${rest%%|*}"; got_pwd="${rest#*|}"
  case "$got_shell" in
    */dash) fail "SHELL is '$got_shell' — claude's tool calls would run in dash" ;;
    *) if [ "$got_pwd" != "$WD" ]; then fail "PWD is '$got_pwd', want '$WD'"; else pass; fi ;;
  esac
fi

# ---- T-09 ----
CURRENT_TEST="T-09 snapshot_claude_running records pane commands"
snapshot_claude_running
if [ "${PANE_CMD_SNAPSHOT[s1]:-}" != dash ]; then fail "s1 snapshot is '${PANE_CMD_SNAPSHOT[s1]:-}', want dash"
elif [ "${PANE_CMD_SNAPSHOT[s5]:-}" != sleep ]; then fail "s5 snapshot is '${PANE_CMD_SNAPSHOT[s5]:-}', want sleep"
else pass; fi

# ---- T-10 ----
CURRENT_TEST="T-10 static wiring in do_kill_dormant and the dormant branch"
body_kill="$(declare -f do_kill_dormant)"
body_rec="$(declare -f reconcile)"
if ! printf '%s' "$body_kill" | grep -q 'minimize_dormant_pane'; then fail "do_kill_dormant doesn't minimize"
elif ! printf '%s' "$body_rec" | grep -q 'new-session -d -s "$slugname" -c "$_wd" ${DORMANT_SHELL:+"$DORMANT_SHELL"}'; then fail "post-reboot session not created on DORMANT_SHELL"
elif ! printf '%s' "$body_rec" | grep -q 'minimize_dormant_pane "$name" "$actual"'; then fail "dormant branch doesn't minimize leftover sessions"
else pass; fi

printf '\n===============================\nPASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
