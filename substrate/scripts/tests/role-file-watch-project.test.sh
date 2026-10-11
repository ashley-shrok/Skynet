#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for role-file-watch.py project-file coverage.
#
# An identity in a project (`project: <slug>` frontmatter) watches
# ~/fleet/projects/<slug>/project.md like a role file. Moving into, between,
# or out of a project is an identity-file edit; the watcher restarts itself so
# the target follows. A project file that vanishes (project archived) must
# not kill the watcher.
#
# Covers:
#   T-P1 — in a project at start: baseline lands silently; an edit to
#          project.md fires [project-file: <slug>].
#   T-P2 — join mid-session: adding `project:` emits a "now in project"
#          pointer, then project.md edits fire.
#   T-P3 — move between projects: join pointer for the new one, old
#          baseline removed, old project's edits silent, new one's fire.
#   T-P4 — leave (remove `project:`): baseline removed, no pointer, watcher
#          still alive and still emitting role-file events.
#   T-P5 — project archived (folder moved away): watcher survives, baseline
#          removed, role-file events still fire.
#   T-P6 — `project:` naming a project with no folder: no project baseline,
#          watcher runs normally.
#   T-P7 — agent's own edit to project.md (claimed via the self-edit hook)
#          stays silent.
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/role-file-watch-project.test.sh
#   Run from the repo root.
#
# Requirements: bash, python3, inotifywait, jq.

set -u

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PY_SCRIPT="$REPO_ROOT/substrate/scripts/role-file-watch.py"
SYNC_SCRIPT="$REPO_ROOT/substrate/scripts/self-edit-baseline-sync.sh"

for bin in python3 inotifywait jq; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    printf 'FATAL: %s not found\n' "$bin" >&2
    exit 1
  fi
done

PASS=0
FAIL=0
FAILURES=()
declare -a ALL_TMPDIRS=()
declare -a ALL_PIDS=()

cleanup() {
  for _p in "${ALL_PIDS[@]+"${ALL_PIDS[@]}"}"; do
    [ -n "$_p" ] && kill "$_p" 2>/dev/null
  done
  for _d in "${ALL_TMPDIRS[@]+"${ALL_TMPDIRS[@]}"}"; do
    [ -n "$_d" ] && [ -d "$_d" ] && rm -rf "$_d"
  done
}
trap cleanup EXIT

make_tmpdir() {
  local d
  d=$(mktemp -d)
  ALL_TMPDIRS+=("$d")
  printf '%s' "$d"
}

fail() {
  FAILURES+=("${CURRENT_TEST:-unknown}: ${1:-unknown failure}")
  FAIL=$((FAIL + 1))
}

run_test() {
  local test_fn="$1"
  local before_fail=$FAIL
  CURRENT_TEST="$test_fn"
  "$test_fn"
  [ -n "${WATCHER_PID:-}" ] && kill "$WATCHER_PID" 2>/dev/null
  WATCHER_PID=""
  if [ "$FAIL" -eq "$before_fail" ]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$test_fn"
  else
    printf 'FAIL  %s\n' "$test_fn"
  fi
}

NAME="projname"

# seed_fixture <project-line-or-empty> <project-slug>...
# Builds a hermetic HOME with one role, an identity whose frontmatter carries
# the given `project:` line (or none), and one project folder per slug.
seed_fixture() {
  local project_line="$1"
  shift
  HOME_DIR=$(make_tmpdir)
  IDENT_DIR="$HOME_DIR/fleet/identities/$NAME"
  IDENT_MD="$IDENT_DIR/$NAME.md"
  STATE="$IDENT_DIR/role-file-watch"
  ROLE_MD="$HOME_DIR/fleet/roles/rolex/rolex.md"
  mkdir -p "$IDENT_DIR" "$(dirname "$ROLE_MD")"
  printf '# rolex\n\nline 1\n' > "$ROLE_MD"
  write_identity "$project_line"
  for slug in "$@"; do
    mkdir -p "$HOME_DIR/fleet/projects/$slug"
    printf -- '---\ndisplayName: %s\n---\n\nproject body\n' "$slug" \
      > "$HOME_DIR/fleet/projects/$slug/project.md"
  done
}

write_identity() {
  local project_line="$1" fm="roles: rolex"
  [ -n "$project_line" ] && fm="$fm
$project_line"
  printf -- '---\n%s\ntask: t\n---\n\n# %s\n' "$fm" "$NAME" > "$IDENT_MD.tmp"
  mv "$IDENT_MD.tmp" "$IDENT_MD"
}

project_md() { printf '%s' "$HOME_DIR/fleet/projects/$1/project.md"; }

append_line() { printf '%s\n' "$2" >> "$1"; }

launch_watcher() {
  OUT_LOG=$(make_tmpdir)/out.log
  ERR_LOG=$(make_tmpdir)/err.log
  HOME="$HOME_DIR" AMBIENT_MONITOR_HARNESS_PID="$$" \
    python3 "$PY_SCRIPT" "$IDENT_DIR" >"$OUT_LOG" 2>"$ERR_LOG" &
  WATCHER_PID=$!
  ALL_PIDS+=("$WATCHER_PID")
}

wait_for() {
  # wait_for <timeout-ticks> <test-command...> — 0.1s ticks
  local timeout="$1" elapsed=0
  shift
  while [ "$elapsed" -lt "$timeout" ]; do
    "$@" && return 0
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  return 1
}

out_has() { [ -f "$OUT_LOG" ] && grep -qE "$1" "$OUT_LOG"; }
alive() { kill -0 "$WATCHER_PID" 2>/dev/null; }
logs() { printf 'out=%s err=%s' "$(cat "$OUT_LOG" 2>/dev/null)" "$(cat "$ERR_LOG" 2>/dev/null)"; }

# Baselines land in the startup pass, before inotifywait arms; the watcher
# re-diffs once its watches are up, so a short sleep past the identity
# baseline is enough for an edit to be seen either way.
wait_armed() { wait_for 50 test -f "$STATE/last-snapshot.identity"; sleep 1; }

test_T_P1_in_project_at_start() {
  seed_fixture "project: alpha" alpha
  launch_watcher
  if ! wait_for 50 test -f "$STATE/last-snapshot.project.alpha"; then
    fail "project baseline never landed; $(logs)"; return
  fi
  wait_armed
  if [ -s "$OUT_LOG" ]; then fail "cold start not silent; $(logs)"; return; fi
  append_line "$(project_md alpha)" "alpha edit one"
  if ! wait_for 50 out_has '📝 \[project-file: alpha\] your project file changed — .*alpha edit one'; then
    fail "no project-file event; $(logs)"; return
  fi
}

test_T_P2_join_mid_session() {
  seed_fixture "" alpha
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.identity" || { fail "identity baseline never landed; $(logs)"; return; }
  wait_armed
  write_identity "project: alpha"
  if ! wait_for 50 out_has "📝 \[project-file: alpha\] you're now in project alpha — Read $(project_md alpha)"; then
    fail "no join pointer; $(logs)"; return
  fi
  if ! wait_for 50 test -f "$STATE/last-snapshot.project.alpha"; then
    fail "project baseline never landed after join; $(logs)"; return
  fi
  sleep 1
  append_line "$(project_md alpha)" "after join"
  if ! wait_for 50 out_has '\[project-file: alpha\] your project file changed — .*after join'; then
    fail "no project-file event after join; $(logs)"; return
  fi
}

test_T_P3_move_between_projects() {
  seed_fixture "project: alpha" alpha beta
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.alpha" || { fail "alpha baseline never landed; $(logs)"; return; }
  wait_armed
  write_identity "project: beta"
  if ! wait_for 50 out_has "you're now in project beta"; then
    fail "no join pointer for beta; $(logs)"; return
  fi
  wait_for 50 test -f "$STATE/last-snapshot.project.beta" || { fail "beta baseline never landed; $(logs)"; return; }
  if [ -f "$STATE/last-snapshot.project.alpha" ]; then
    fail "alpha baseline not removed after move"; return
  fi
  sleep 1
  append_line "$(project_md alpha)" "alpha after leaving"
  append_line "$(project_md beta)" "beta after joining"
  if ! wait_for 50 out_has '\[project-file: beta\] your project file changed — .*beta after joining'; then
    fail "no beta event; $(logs)"; return
  fi
  sleep 0.5
  if out_has 'alpha after leaving'; then
    fail "old project's edit still emitted; $(logs)"; return
  fi
}

test_T_P4_leave_project() {
  seed_fixture "project: alpha" alpha
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.alpha" || { fail "alpha baseline never landed; $(logs)"; return; }
  wait_armed
  write_identity ""
  if ! wait_for 50 bash -c "! test -f '$STATE/last-snapshot.project.alpha'"; then
    fail "alpha baseline not removed after leaving; $(logs)"; return
  fi
  sleep 1
  if out_has "now in project"; then fail "join pointer on leave; $(logs)"; return; fi
  if ! alive; then fail "watcher died on leave; $(logs)"; return; fi
  append_line "$ROLE_MD" "role edit after leave"
  if ! wait_for 50 out_has '\[role-file: rolex\].*role edit after leave'; then
    fail "role-file events stopped after leave; $(logs)"; return
  fi
}

test_T_P5_project_archived() {
  seed_fixture "project: alpha" alpha
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.alpha" || { fail "alpha baseline never landed; $(logs)"; return; }
  wait_armed
  mkdir -p "$HOME_DIR/fleet/projects/archive"
  mv "$HOME_DIR/fleet/projects/alpha" "$HOME_DIR/fleet/projects/archive/alpha"
  # A folder move fires nothing on the watched file itself; the next event on
  # any target re-checks the project. Real archives also edit member
  # identity files, so drive one here.
  append_line "$IDENT_MD" "archived note"
  if ! wait_for 50 bash -c "! test -f '$STATE/last-snapshot.project.alpha'"; then
    fail "alpha baseline not removed after archive; $(logs)"; return
  fi
  sleep 1
  if ! alive; then fail "watcher died on archive; $(logs)"; return; fi
  append_line "$ROLE_MD" "role edit after archive"
  if ! wait_for 50 out_has '\[role-file: rolex\].*role edit after archive'; then
    fail "role-file events stopped after archive; $(logs)"; return
  fi
}

test_T_P6_missing_project_folder() {
  seed_fixture "project: ghost"
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.identity" || { fail "identity baseline never landed; $(logs)"; return; }
  wait_armed
  if compgen -G "$STATE/last-snapshot.project.*" >/dev/null; then
    fail "baseline written for a project with no folder"; return
  fi
  if ! alive; then fail "watcher died; $(logs)"; return; fi
  append_line "$ROLE_MD" "role edit ghost"
  if ! wait_for 50 out_has '\[role-file: rolex\].*role edit ghost'; then
    fail "role-file events not firing; $(logs)"; return
  fi
}

test_T_P7_self_edit_silent() {
  seed_fixture "project: alpha" alpha
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.alpha" || { fail "alpha baseline never landed; $(logs)"; return; }
  wait_armed
  local pmd payload
  pmd=$(project_md alpha)
  payload=$(jq -nc --arg p "$pmd" '{hook_event_name:"PreToolUse",tool_name:"Write",tool_use_id:"toolu_p7",tool_input:{file_path:$p}}')
  printf '%s' "$payload" | HOME="$HOME_DIR" FLEET_IDENTITY="$NAME" bash "$SYNC_SCRIPT"
  if ! compgen -G "$STATE/claims/last-snapshot.project.alpha.toolu_p7" >/dev/null; then
    fail "hook did not claim project.md"; return
  fi
  append_line "$pmd" "my own edit"
  sleep 0.5
  printf '%s' "${payload/PreToolUse/PostToolUse}" | HOME="$HOME_DIR" FLEET_IDENTITY="$NAME" bash "$SYNC_SCRIPT"
  sleep 1.5
  if out_has 'my own edit'; then fail "self-edit emitted; $(logs)"; return; fi
  append_line "$pmd" "peer edit"
  if ! wait_for 50 out_has '\[project-file: alpha\].*peer edit'; then
    fail "peer edit after self-edit not emitted; $(logs)"; return
  fi
}

run_test test_T_P1_in_project_at_start
run_test test_T_P2_join_mid_session
run_test test_T_P3_move_between_projects
run_test test_T_P4_leave_project
run_test test_T_P5_project_archived
run_test test_T_P6_missing_project_folder
run_test test_T_P7_self_edit_silent

printf '\n===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
