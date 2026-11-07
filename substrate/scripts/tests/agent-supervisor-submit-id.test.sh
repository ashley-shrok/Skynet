#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2034,SC2089,SC2090,SC2218
# Test driver for submit_id's landing detection: `/id NAME` must be recognised whether Claude Code
# writes it into a brand-new jsonl OR into the jsonl it already created at startup (newer Claude
# Code writes the session file before any prompt, so on a fast box it is already in the snapshot).
# A prior session's file — which already has a user turn — must never count as a landing.
#
# Covers:
#   T-01  — /id lands in a NEW jsonl → success on attempt 1, pasted once
#   T-02  — /id lands in the startup-written jsonl already in the snapshot → success on attempt 1,
#           pasted once (the double-/id regression)
#   T-03  — only a prior session's jsonl (already holding /id NAME) exists, nothing new lands →
#           NOT counted as landed (scrollback-proofing preserved); only the retry sends C-c
#   T-04  — attempt 1 sends no C-c (a C-c into a mid-mount Ink kills claude)
#   T-05  — compose prompt never shows → paste still goes out after the ~8s readiness bound
#   T-06  — cwd reached through a symlink (/home -> /var/home) → /id is found in the project dir
#           Claude Code names after the PHYSICAL cwd → success on attempt 1, pasted once
#   T-07  — _expected_project_dir resolves the same symlink
#   T-08  — `_` and `.` in the path become `-` (Claude Code's non-alphanumeric rule)
#   T-09  — slow start: /id lands after the old 15s budget but inside SUBMIT_ID_WAIT → pasted once
#   T-10  — /id still sitting unsent in the compose box → Enter pressed again (no C-c, no
#           re-paste), and the load lands
#   T-11  — /id lands between the attempts → the pre-retry check catches it, no second paste
#   T-12  — _id_unsent_in_compose reads only the compose box (between the last two rules), not the
#           transcript above it
#   T-13  — end_unloaded_harness ends the harness (SIGTERM; SIGKILL if it ignores that)
#   T-14  — drive() ends the harness when submit_id fails
#   T-15  — a second failure within UNLOADED_RETRY_MINUTES leaves the harness running (no
#           relaunch loop); once the window has passed it is ended again
#
# tmux (PATH stub) and claude_running are stubbed; the paste is simulated by appending a /id user
# turn to a target file. Poll budgets are shortened via SUBMIT_ID_WAIT / SUBMIT_ID_UNSENT_AFTER
# (set before sourcing); T-05 still waits the real ~8s compose-prompt bound.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-submit-id.test.sh  (from repo root)

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
export SUBMIT_ID_WAIT=4 SUBMIT_ID_UNSENT_AFTER=1
export AGENT_IDENTITIES_DIR="$SCRATCH/identities"
mkdir -p "$AGENT_PROJECTS_DIR" "$AGENT_IDENTITIES_DIR"

# shellcheck source=/dev/null
source "$SUPERVISOR" >/dev/null 2>&1
log() { :; }
claude_running() { return 0; }

NAME="newborn"
CWD="/fake/fleet/identities/$NAME/workspace"
mangle() { printf '%s' "$1" | sed 's/[^a-zA-Z0-9]/-/g'; }
PDIR="$AGENT_PROJECTS_DIR/$(mangle "$CWD")"
PHYS_SCRATCH="$(cd "$SCRATCH" && pwd -P)"   # expected paths are physical, even if TMPDIR is a symlink
PASTE_COUNT_FILE="$SCRATCH/paste-count"
LAND_TARGET=""   # file the simulated paste appends /id into; empty = paste lands nowhere

STARTUP_LINES='{"type":"mode","mode":"normal","sessionId":"s"}
{"type":"permission-mode","permissionMode":"bypassPermissions","sessionId":"s"}'
id_turn() { printf '{"type":"user","message":{"role":"user","content":"<command-message>id</command-message>\\n<command-name>/id</command-name>\\n<command-args>%s</command-args>"}}\n' "$1"; }

# submit_id calls tmux via `timeout`, which execs a binary — so the stub is a PATH executable.
# A paste appends the /id user turn to $LAND_TARGET (creating it with startup lines if absent).
mkdir -p "$SCRATCH/bin"
cat >"$SCRATCH/bin/tmux" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  capture-pane)
    if [ -n "${COMPOSE_UNSENT:-}" ]; then printf '────\n❯ /id %s\n────\n  status\n' "$NAME"
    elif [ -n "${PROMPT_VISIBLE:-}" ]; then printf '\n❯ \n'; fi
    exit 0 ;;
  send-keys)
    case " $* " in *" C-c "*) echo x >>"$CTRLC_COUNT_FILE" ;; esac
    case " $* " in
      *" Enter "*)
        if [ -n "${LAND_ON_ENTER:-}" ] && [ -n "$LAND_TARGET" ]; then
          echo x >>"$ENTER_COUNT_FILE"
          if [ "$(wc -l <"$ENTER_COUNT_FILE")" -eq "$LAND_ON_ENTER" ]; then
            [ -f "$LAND_TARGET" ] || printf '%s\n' "$STARTUP_LINES" >"$LAND_TARGET"
            printf '{"type":"user","message":{"role":"user","content":"<command-message>id</command-message>\\n<command-name>/id</command-name>\\n<command-args>%s</command-args>"}}\n' "$NAME" >>"$LAND_TARGET"
          fi
        fi ;;
    esac
    exit 0 ;;
  paste-buffer) ;;
  *) exit 0 ;;
esac
echo x >>"$PASTE_COUNT_FILE"
[ -n "$LAND_TARGET" ] || exit 0
[ -n "${LAND_ON_ENTER:-}" ] && exit 0   # lands on the Nth Enter instead (see send-keys)
if [ -n "${LAND_DELAY:-}" ]; then
  # slow start: the turn shows up LAND_DELAY seconds after the paste (first paste only)
  [ "$(wc -l <"$PASTE_COUNT_FILE")" -gt 1 ] && exit 0
  ( sleep "$LAND_DELAY"
    [ -f "$LAND_TARGET" ] || printf '%s\n' "$STARTUP_LINES" >"$LAND_TARGET"
    printf '{"type":"user","message":{"role":"user","content":"<command-message>id</command-message>\\n<command-name>/id</command-name>\\n<command-args>%s</command-args>"}}\n' "$NAME" >>"$LAND_TARGET"
  ) </dev/null >/dev/null 2>&1 &
  exit 0
fi
[ -f "$LAND_TARGET" ] || printf '%s\n' "$STARTUP_LINES" >"$LAND_TARGET"
printf '{"type":"user","message":{"role":"user","content":"<command-message>id</command-message>\\n<command-name>/id</command-name>\\n<command-args>%s</command-args>"}}\n' "$NAME" >>"$LAND_TARGET"
STUB
chmod +x "$SCRATCH/bin/tmux"
CTRLC_COUNT_FILE="$SCRATCH/ctrlc-count"
ENTER_COUNT_FILE="$SCRATCH/enter-count"
export PROMPT_VISIBLE=1
export PATH="$SCRATCH/bin:$PATH" PASTE_COUNT_FILE CTRLC_COUNT_FILE ENTER_COUNT_FILE STARTUP_LINES NAME

reset() { rm -rf "$PDIR"; mkdir -p "$PDIR"; : >"$PASTE_COUNT_FILE"; : >"$CTRLC_COUNT_FILE"; export LAND_TARGET="" LAND_DELAY="" COMPOSE_UNSENT="" LAND_ON_ENTER=""; : >"$ENTER_COUNT_FILE"; }
pastes() { wc -l <"$PASTE_COUNT_FILE" | tr -d ' '; }
ctrlcs() { wc -l <"$CTRLC_COUNT_FILE" | tr -d ' '; }

CURRENT_TEST="T-01 /id lands in a new jsonl"
reset; export LAND_TARGET="$PDIR/fresh.jsonl"
if submit_id "$NAME" sess "$CWD" && [ "$(pastes)" = 1 ]; then pass; else fail "rc/pastes wrong (pastes=$(pastes))"; fi

CURRENT_TEST="T-02 /id lands in the startup-written jsonl already in the snapshot"
reset; printf '%s\n' "$STARTUP_LINES" >"$PDIR/startup.jsonl"; export LAND_TARGET="$PDIR/startup.jsonl"
if submit_id "$NAME" sess "$CWD" && [ "$(pastes)" = 1 ]; then pass; else fail "rc/pastes wrong (pastes=$(pastes)) — /id re-pasted"; fi

CURRENT_TEST="T-03 prior session's jsonl with /id NAME is not counted as a landing (attempt 2 C-c's)"
reset; { printf '%s\n' "$STARTUP_LINES"; id_turn "$NAME"; } >"$PDIR/prior.jsonl"; LAND_TARGET=""
if submit_id "$NAME" sess "$CWD"; then fail "prior session counted as landed"
elif [ "$(pastes)" != 2 ] || [ "$(ctrlcs)" != 1 ]; then fail "want 2 pastes / 1 C-c (retry only), got $(pastes)/$(ctrlcs)"
else pass; fi

CURRENT_TEST="T-04 attempt 1 on a fresh compose sends NO C-c"
reset; export LAND_TARGET="$PDIR/fresh.jsonl"
if submit_id "$NAME" sess "$CWD" && [ "$(ctrlcs)" = 0 ]; then pass; else fail "C-c sent on attempt 1 ($(ctrlcs))"; fi

CURRENT_TEST="T-05 compose prompt never appears → still pastes after the ~8s bound"
reset; export LAND_TARGET="$PDIR/fresh.jsonl"; PROMPT_VISIBLE=""
t0=$(date +%s); submit_id "$NAME" sess "$CWD"; rc=$?; el=$(( $(date +%s) - t0 )); PROMPT_VISIBLE=1
if [ "$rc" = 0 ] && [ "$(pastes)" = 1 ] && [ "$el" -ge 7 ] && [ "$el" -le 12 ]; then pass; else fail "rc=$rc pastes=$(pastes) elapsed=${el}s"; fi

CURRENT_TEST="T-06 symlinked cwd: /id lands in the physical-path project dir"
mkdir -p "$SCRATCH/var/home/$NAME/workspace"; ln -s "$SCRATCH/var/home" "$SCRATCH/home"
LINK_CWD="$SCRATCH/home/$NAME/workspace"
PHYS_PDIR="$AGENT_PROJECTS_DIR/$(mangle "$PHYS_SCRATCH/var/home/$NAME/workspace")"
reset; mkdir -p "$PHYS_PDIR"; export LAND_TARGET="$PHYS_PDIR/fresh.jsonl"
if submit_id "$NAME" sess "$LINK_CWD" && [ "$(pastes)" = 1 ]; then pass; else fail "rc/pastes wrong (pastes=$(pastes)) — looked in the symlink-named dir"; fi

CURRENT_TEST="T-07 _expected_project_dir resolves a symlinked identities dir"
mkdir -p "$SCRATCH/var/ids/$NAME/workspace"; ln -s "$SCRATCH/var/ids" "$SCRATCH/ids"
got="$(IDENTITIES_DIR="$SCRATCH/ids" _expected_project_dir "$NAME")"
want="$AGENT_PROJECTS_DIR/$(mangle "$PHYS_SCRATCH/var/ids/$NAME/workspace")"
if [ "$got" = "$want" ]; then pass; else fail "got $got, want $want"; fi

CURRENT_TEST="T-08 non-alphanumerics in the path (_ and .) are mangled to - like Claude Code does"
got="$(_expected_project_dir "my_agent.v2")"; got="${got#"$AGENT_PROJECTS_DIR/"}"
if [ -n "$got" ] && ! printf '%s' "$got" | grep -q '[^a-zA-Z0-9-]' && case "$got" in *-my-agent-v2-workspace) true ;; *) false ;; esac
then pass; else fail "got $got"; fi

CURRENT_TEST="T-09 slow start: /id lands at ~2.5s (inside SUBMIT_ID_WAIT) → pasted once"
reset; export LAND_TARGET="$PDIR/fresh.jsonl" LAND_DELAY=2.5
if ! grep -q 'SUBMIT_ID_WAIT="${SUBMIT_ID_WAIT:-60}"' "$SUPERVISOR"; then fail "default SUBMIT_ID_WAIT is no longer 60s"
elif submit_id "$NAME" sess "$CWD" && [ "$(pastes)" = 1 ] && [ "$(ctrlcs)" = 0 ]; then pass
else fail "pastes=$(pastes) ctrlcs=$(ctrlcs) — re-pasted on a slow start"; fi

CURRENT_TEST="T-10 /id unsent in the compose box → Enter pressed again, load lands"
reset; export COMPOSE_UNSENT=1 LAND_TARGET="$PDIR/fresh.jsonl" LAND_ON_ENTER=2
submit_id "$NAME" sess "$CWD"; rc=$?
if [ "$rc" = 0 ] && [ "$(pastes)" = 1 ] && [ "$(ctrlcs)" = 0 ]; then pass
else fail "rc=$rc pastes=$(pastes) ctrlcs=$(ctrlcs) (want landed on the 2nd Enter, 1 paste, no C-c)"; fi

CURRENT_TEST="T-11 /id lands between attempts → no second paste"
reset; LATE="$SCRATCH/late"; rm -f "$LATE"
log() { case "$*" in *"elapsed, no jsonl"*) : >"$LATE" ;; esac; }
eval "real_$(declare -f _id_landed)"
_id_landed() { [ -e "$LATE" ] && { printf '%s' late.jsonl; return 0; }; real__id_landed "$@"; }
submit_id "$NAME" sess "$CWD"; rc=$?
eval "$(declare -f real__id_landed | sed '1s/^real_//')"; log() { :; }
if [ "$rc" = 0 ] && [ "$(pastes)" = 1 ] && [ "$(ctrlcs)" = 0 ]; then pass
else fail "rc=$rc pastes=$(pastes) ctrlcs=$(ctrlcs)"; fi

CURRENT_TEST="T-12 compose check ignores /id in the transcript above the box"
reset
cat >"$SCRATCH/bin/tmux-pane" <<'P'
❯ /id newborn
────
❯ 
────
  status
P
tmux_saved="$(cat "$SCRATCH/bin/tmux")"
printf '#!/usr/bin/env bash\ncat "%s"\n' "$SCRATCH/bin/tmux-pane" >"$SCRATCH/bin/tmux"
ok=1
_id_unsent_in_compose sess "$NAME" && { ok=0; fail "transcript /id counted as unsent"; }
printf '────\n❯ /id newborn\n────\n' >"$SCRATCH/bin/tmux-pane"
_id_unsent_in_compose sess "$NAME" || { ok=0; fail "compose /id not seen"; }
printf '%s\n' "$tmux_saved" >"$SCRATCH/bin/tmux"
[ "$ok" = 1 ] && pass

CURRENT_TEST="T-13 end_unloaded_harness ends the harness, SIGKILL if SIGTERM is ignored"
metric() { :; }
sleep 300 >/dev/null 2>&1 & H1=$!
bash -c "trap '' TERM; while :; do sleep 0.1; done" </dev/null >/dev/null 2>&1 & H2=$!
disown "$H1" "$H2" 2>/dev/null
sleep 0.3
resolve_harness_pid() { printf '%s' "$CUR_H"; }
CUR_H=$H1; end_unloaded_harness "$NAME" sess
CUR_H=$H2; end_unloaded_harness "$NAME" sess
sleep 0.3
ok=1
kill -0 "$H1" 2>/dev/null && { ok=0; fail "harness still running"; kill -9 "$H1"; }
kill -0 "$H2" 2>/dev/null && { ok=0; fail "SIGTERM-ignoring harness still running"; kill -9 "$H2"; }
[ "$ok" = 1 ] && pass

CURRENT_TEST="T-14 drive() ends the harness when submit_id fails"
if declare -f drive | grep -A14 'if ! submit_id' | grep -q 'end_unloaded_harness'; then pass
else fail "drive's submit_id failure branch doesn't call end_unloaded_harness"; fi

CURRENT_TEST="T-15 repeated failure within the window leaves the harness running"
export DORMANCY_STATE_DIR="$SCRATCH/.state"; mkdir -p "$DORMANCY_STATE_DIR"
ENDS="$SCRATCH/ends"; : >"$ENDS"
eval "real_$(declare -f submit_id)"
submit_id() { return 1; }
end_unloaded_harness() { echo x >>"$ENDS"; }
wait_for_claude() { return 0; }
accept_trust_for_workdir() { :; }
drive "$NAME" sess "" "$CWD"; drive "$NAME" sess "" "$CWD"
first="$(wc -l <"$ENDS" | tr -d ' ')"
touch -d '-11 minutes' "$DORMANCY_STATE_DIR/$NAME.unloaded-ended"
drive "$NAME" sess "" "$CWD"
second="$(wc -l <"$ENDS" | tr -d ' ')"
eval "$(declare -f real_submit_id | sed '1s/^real_//')"
if [ "$first" = 1 ] && [ "$second" = 2 ]; then pass
else fail "ends after 2 quick failures=$first (want 1), after the window=$second (want 2)"; fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  for f in "${FAILURES[@]}"; do printf '  %s\n' "$f" >&2; done
  exit 1
fi
exit 0
