#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2034,SC2089,SC2090
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
#
# tmux (PATH stub) and claude_running are stubbed; the paste is simulated by appending a /id user
# turn to a target file. Poll budget is real (15s per attempt) — T-03 takes ~30s, T-05 ~8s.
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
  capture-pane) [ -n "${PROMPT_VISIBLE:-}" ] && printf '\n❯ \n'; exit 0 ;;
  send-keys) case " $* " in *" C-c "*) echo x >>"$CTRLC_COUNT_FILE" ;; esac; exit 0 ;;
  paste-buffer) ;;
  *) exit 0 ;;
esac
echo x >>"$PASTE_COUNT_FILE"
[ -n "$LAND_TARGET" ] || exit 0
[ -f "$LAND_TARGET" ] || printf '%s\n' "$STARTUP_LINES" >"$LAND_TARGET"
printf '{"type":"user","message":{"role":"user","content":"<command-message>id</command-message>\\n<command-name>/id</command-name>\\n<command-args>%s</command-args>"}}\n' "$NAME" >>"$LAND_TARGET"
STUB
chmod +x "$SCRATCH/bin/tmux"
CTRLC_COUNT_FILE="$SCRATCH/ctrlc-count"
export PROMPT_VISIBLE=1
export PATH="$SCRATCH/bin:$PATH" PASTE_COUNT_FILE CTRLC_COUNT_FILE STARTUP_LINES NAME

reset() { rm -rf "$PDIR"; mkdir -p "$PDIR"; : >"$PASTE_COUNT_FILE"; : >"$CTRLC_COUNT_FILE"; export LAND_TARGET=""; }
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

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  for f in "${FAILURES[@]}"; do printf '  %s\n' "$f" >&2; done
  exit 1
fi
exit 0
