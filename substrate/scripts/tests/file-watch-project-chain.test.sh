#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for file-watch.py nested-project (project chain) coverage.
#
# A project may name a parent with a `parent:` line in its project.md. An
# identity's watcher covers its own project file plus every ancestor's,
# drops ancestor member-list churn, and reports chain rearrangements as one
# `project-chain` notice.
#
# Covers:
#   T-C1  — chain resolution rules (missing parent, loops, archive, bad values)
#   T-C2  — in a sub-project at start: ancestor baselines silent; a parent
#           content edit fires [parent-project: <slug>] "your parent project …"
#   T-C3  — grandparent edit is labeled "ancestor project"
#   T-C4  — ancestor member-only edit is silent; a mixed edit reports the
#           content without the member lines
#   T-C5  — re-parenting the own project: one chain notice (new chain, file
#           to read, old parent dropped), no raw project-file diff
#   T-C6  — the agent's own re-parent edit (self-edit hook) still notifies
#   T-C7  — un-nesting: "now top level" + no longer inside
#   T-C8  — a change higher up (grandparent re-parented) notifies the whole chain
#   T-C9  — ancestor folder archived: chain shortens, watcher survives
#   T-C10 — joining a sub-project mid-session points at every file top-down
#   T-C11 — chain changes outside the watched files are still caught: a
#           missing parent created, an archived parent restored, a loop broken
#           from off the chain, a bare ancestor folder gaining its file
#   T-C12 — an ancestor's project.md deleted (folder kept): watcher keeps
#           working (no inotifywait failure loop)
#   T-C13 — moving from a sub-project to a top-level project says which
#           projects were left
#   T-C14 — member stripping follows the supervisor's block rule (blank and
#           comment lines inside the block)
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/file-watch-project-chain.test.sh
#   Run from the repo root.
#
# Requirements: bash, python3, inotifywait, jq.

set -u

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PY_SCRIPT="$REPO_ROOT/substrate/scripts/file-watch.py"
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

NAME="chainname"

# seed_fixture <project-line-or-empty> <slug[:parent]>...
seed_fixture() {
  local project_line="$1"
  shift
  HOME_DIR=$(make_tmpdir)
  IDENT_DIR="$HOME_DIR/fleet/identities/$NAME"
  IDENT_MD="$IDENT_DIR/$NAME.md"
  STATE="$IDENT_DIR/file-watch"
  ROLE_MD="$HOME_DIR/fleet/roles/rolex/rolex.md"
  mkdir -p "$IDENT_DIR" "$(dirname "$ROLE_MD")"
  printf '# rolex\n\nline 1\n' > "$ROLE_MD"
  write_identity "$project_line"
  local spec
  for spec in "$@"; do
    write_project "${spec%%:*}" "$( [ "${spec#*:}" != "$spec" ] && printf '%s' "${spec#*:}")"
  done
}

# write_project <slug> <parent-or-empty> [body-line] — atomic, like the app.
write_project() {
  local slug="$1" parent="$2" body="${3:-project body}" fm
  fm="displayName: ${slug^^}"
  [ -n "$parent" ] && fm="$fm
parent: $parent"
  mkdir -p "$HOME_DIR/fleet/projects/$slug"
  printf -- '---\n%s\nmembers:  # auto-maintained\n  - someone\n---\n\n%s\n' "$fm" "$body" \
    > "$HOME_DIR/fleet/projects/$slug/project.md.tmp"
  mv "$HOME_DIR/fleet/projects/$slug/project.md.tmp" "$HOME_DIR/fleet/projects/$slug/project.md"
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
  STDOUT_LOG=$(make_tmpdir)/stdout.log
  ERR_LOG=$(make_tmpdir)/err.log
  HOME="$HOME_DIR" AMBIENT_MONITOR_HARNESS_PID="$$" \
    python3 "$PY_SCRIPT" "$IDENT_DIR" >"$STDOUT_LOG" 2>"$ERR_LOG" &
  WATCHER_PID=$!
  ALL_PIDS+=("$WATCHER_PID")
  # Events are queued in <identity>/pending-context/, never printed: collect
  # them into OUT_LOG in queue order, the way the drain hook delivers them.
  [ -n "${COLLECTOR_PID:-}" ] && kill "$COLLECTOR_PID" 2>/dev/null
  ( q="$IDENT_DIR/pending-context"
    while :; do
      for f in $(ls "$q" 2>/dev/null | grep '\.line$' | sort); do
        cat "$q/$f"; echo; rm -f "$q/$f"
      done
      sleep 0.05
    done ) >>"$OUT_LOG" 2>/dev/null &
  COLLECTOR_PID=$!
  ALL_PIDS+=("$COLLECTOR_PID")
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


chain_of() {
  # chain_of <own-slug> — the watcher's own resolution, printed space-separated.
  HOME="$HOME_DIR" python3 - "$PY_SCRIPT" "$1" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("fw", sys.argv[1])
fw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fw)
print(" ".join(fw._resolve_chain(sys.argv[2])))
PY
}

expect_chain() {
  local got
  got=$(chain_of "$1")
  [ "$got" = "$2" ] || fail "chain of $1: want '$2' got '$got'"
}

test_T_C1_chain_resolution() {
  seed_fixture "" top mid:top leaf:mid orphan:ghost a:b b:a hang:a self:self
  expect_chain leaf "top mid leaf"
  expect_chain top "top"
  expect_chain orphan "orphan"
  expect_chain a "a"
  expect_chain hang "a hang"
  expect_chain self "self"
  expect_chain ghost ""
  # Unquoted null / bool / number names no parent; quoted strings do.
  write_project n1 "null"; write_project n2 "true"; write_project n3 "42"
  write_project q1 "'top'"; write_project q2 '"mid"'
  expect_chain n1 "n1"; expect_chain n2 "n2"; expect_chain n3 "n3"
  expect_chain q1 "top q1"; expect_chain q2 "top mid q2"
  # Archive folder and a project moved there are not projects.
  mkdir -p "$HOME_DIR/fleet/projects/archive"
  write_project arch "archive"
  expect_chain arch "arch"
  mv "$HOME_DIR/fleet/projects/top" "$HOME_DIR/fleet/projects/archive/top"
  expect_chain leaf "mid leaf"
}

test_T_C2_parent_edit() {
  seed_fixture "project: leaf" top mid:top leaf:mid
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.top" || { fail "top baseline never landed; $(logs)"; return; }
  wait_for 50 test -f "$STATE/last-snapshot.project.mid" || { fail "mid baseline never landed; $(logs)"; return; }
  wait_armed
  if [ -s "$OUT_LOG" ]; then fail "cold start not silent; $(logs)"; return; fi
  append_line "$(project_md mid)" "mid convention"
  if ! wait_for 50 out_has "📝 \[parent-project: mid\] your parent project MID's file changed — .*mid convention"; then
    fail "no parent-project event; $(logs)"; return
  fi
}

test_T_C3_grandparent_edit() {
  seed_fixture "project: leaf" top mid:top leaf:mid
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.top" || { fail "top baseline never landed; $(logs)"; return; }
  wait_armed
  append_line "$(project_md top)" "top convention"
  if ! wait_for 50 out_has "📝 \[parent-project: top\] your ancestor project TOP's file changed — .*top convention"; then
    fail "no ancestor event; $(logs)"; return
  fi
}

test_T_C4_member_churn_suppressed() {
  seed_fixture "project: leaf" top leaf:top
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.top" || { fail "top baseline never landed; $(logs)"; return; }
  wait_armed
  local pmd; pmd=$(project_md top)
  sed -i 's/^  - someone$/  - someone\n  - newcomer/' "$pmd"
  sleep 2
  if out_has 'newcomer'; then fail "ancestor member churn reported; $(logs)"; return; fi
  sed -i 's/^  - newcomer$/  - another/' "$pmd"
  append_line "$pmd" "real content"
  if ! wait_for 50 out_has '\[parent-project: top\].*real content'; then
    fail "mixed edit content not reported; $(logs)"; return
  fi
  if out_has 'another|newcomer'; then fail "member lines leaked into mixed edit; $(logs)"; return; fi
  # The own project's member changes are still reported, as today.
  sed -i 's/^  - someone$/  - ownjoiner/' "$(project_md leaf)"
  if ! wait_for 50 out_has '\[project-file: leaf\].*ownjoiner'; then
    fail "own project member change not reported; $(logs)"; return
  fi
}

test_T_C5_reparent_own() {
  seed_fixture "project: leaf" top other leaf:top
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.top" || { fail "top baseline never landed; $(logs)"; return; }
  wait_armed
  write_project leaf other
  if ! wait_for 50 out_has "📝 \[project-chain: leaf\] your project chain is now OTHER › LEAF — new above you, Read top-down: OTHER $(project_md other) — no longer inside TOP: drop their conventions"; then
    fail "no chain notice; $(logs)"; return
  fi
  if out_has '\[project-file: leaf\]'; then fail "raw project-file diff for a parent change; $(logs)"; return; fi
  wait_for 50 test -f "$STATE/last-snapshot.project.other" || { fail "other baseline never landed; $(logs)"; return; }
  [ -f "$STATE/last-snapshot.project.top" ] && { fail "old parent baseline kept"; return; }
  sleep 1
  append_line "$(project_md top)" "top after leaving"
  append_line "$(project_md other)" "other after joining"
  if ! wait_for 50 out_has '\[parent-project: other\].*other after joining'; then
    fail "new parent not watched; $(logs)"; return
  fi
  sleep 0.5
  if out_has 'top after leaving'; then fail "old parent still watched; $(logs)"; return; fi
  if [ "$(grep -c 'project-chain' "$OUT_LOG")" -ne 1 ]; then fail "chain notice not exactly once; $(logs)"; return; fi
}

test_T_C6_self_reparent_still_notifies() {
  seed_fixture "project: leaf" top other leaf:top
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.top" || { fail "top baseline never landed; $(logs)"; return; }
  wait_armed
  local pmd payload
  pmd=$(project_md leaf)
  payload=$(jq -nc --arg p "$pmd" '{hook_event_name:"PreToolUse",tool_name:"Write",tool_use_id:"toolu_c6",tool_input:{file_path:$p}}')
  printf '%s' "$payload" | HOME="$HOME_DIR" FLEET_IDENTITY="$NAME" bash "$SYNC_SCRIPT"
  sed -i 's/^parent: top$/parent: other/' "$pmd"
  sleep 0.5
  printf '%s' "${payload/PreToolUse/PostToolUse}" | HOME="$HOME_DIR" FLEET_IDENTITY="$NAME" bash "$SYNC_SCRIPT"
  if ! wait_for 50 out_has '\[project-chain: leaf\] your project chain is now OTHER › LEAF'; then
    fail "self-made chain change not told; $(logs)"; return
  fi
}

test_T_C7_unnest() {
  seed_fixture "project: leaf" top leaf:top
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.top" || { fail "top baseline never landed; $(logs)"; return; }
  wait_armed
  write_project leaf ""
  if ! wait_for 50 out_has '\[project-chain: leaf\] your project LEAF is now top level \(no parent project\) — no longer inside TOP: drop their conventions'; then
    fail "no top-level notice; $(logs)"; return
  fi
  wait_for 50 bash -c "! test -f '$STATE/last-snapshot.project.top'" || { fail "top baseline kept; $(logs)"; return; }
}

test_T_C8_change_higher_up() {
  seed_fixture "project: leaf" new top leaf:top
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.top" || { fail "top baseline never landed; $(logs)"; return; }
  wait_armed
  write_project top new
  if ! wait_for 50 out_has "\[project-chain: leaf\] your project chain is now NEW › TOP › LEAF — new above you, Read top-down: NEW $(project_md new)"; then
    fail "no chain notice for change higher up; $(logs)"; return
  fi
  if out_has 'no longer inside'; then fail "spurious no-longer-inside; $(logs)"; return; fi
}

test_T_C9_ancestor_archived() {
  seed_fixture "project: leaf" top leaf:top
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.top" || { fail "top baseline never landed; $(logs)"; return; }
  wait_armed
  mkdir -p "$HOME_DIR/fleet/projects/archive"
  mv "$HOME_DIR/fleet/projects/top" "$HOME_DIR/fleet/projects/archive/top"
  if ! wait_for 80 out_has '\[project-chain: leaf\] your project LEAF is now top level \(no parent project\) — no longer inside TOP'; then
    fail "archived ancestor not noticed by name; $(logs)"; return
  fi
  sleep 1
  if ! alive; then fail "watcher died; $(logs)"; return; fi
  append_line "$ROLE_MD" "role edit after archive"
  if ! wait_for 50 out_has '\[role-file: rolex\].*role edit after archive'; then
    fail "role-file events stopped; $(logs)"; return
  fi
}

test_T_C10_join_sub_project() {
  seed_fixture "" top leaf:top
  launch_watcher
  wait_armed
  write_identity "project: leaf"
  if ! wait_for 50 out_has "\[project-file: leaf\] you're now in project leaf, inside TOP — Read top-down: $(project_md top), $(project_md leaf)"; then
    fail "no chain-aware join pointer; $(logs)"; return
  fi
  wait_for 50 test -f "$STATE/last-snapshot.project.top" || { fail "top baseline never landed after join; $(logs)"; return; }
  sleep 1
  if out_has 'project-chain'; then fail "chain notice on join; $(logs)"; return; fi
  append_line "$(project_md top)" "after join"
  if ! wait_for 50 out_has '\[parent-project: top\].*after join'; then
    fail "parent not watched after join; $(logs)"; return
  fi
}

test_T_C11_unwatched_chain_changes() {
  seed_fixture "project: leaf" leaf:ghost a:b b:a
  launch_watcher
  wait_armed
  # Missing parent created.
  write_project ghost ""
  if ! wait_for 80 out_has '\[project-chain: leaf\] your project chain is now GHOST › LEAF'; then
    fail "created parent not noticed; $(logs)"; return
  fi
  # Archived parent restored: archive ghost, then bring it back.
  mkdir -p "$HOME_DIR/fleet/projects/archive"
  mv "$HOME_DIR/fleet/projects/ghost" "$HOME_DIR/fleet/projects/archive/ghost"
  wait_for 80 out_has 'your project LEAF is now top level' || { fail "archive not noticed; $(logs)"; return; }
  : > "$OUT_LOG"
  mv "$HOME_DIR/fleet/projects/archive/ghost" "$HOME_DIR/fleet/projects/ghost"
  if ! wait_for 80 out_has 'your project chain is now GHOST › LEAF'; then
    fail "restored parent not noticed; $(logs)"; return
  fi
  # Loop broken from off the chain: leaf → a, a ⇄ b; clearing b's parent.
  : > "$OUT_LOG"
  write_project leaf a
  wait_for 80 out_has 'your project chain is now A › LEAF' || { fail "loop chain wrong; $(logs)"; return; }
  : > "$OUT_LOG"
  write_project b ""
  if ! wait_for 80 out_has 'your project chain is now B › A › LEAF'; then
    fail "off-chain loop break not noticed; $(logs)"; return
  fi
  # Bare ancestor folder gains its project.md with a parent line.
  : > "$OUT_LOG"
  rm "$HOME_DIR/fleet/projects/a/project.md"
  sleep 4
  write_project a ghost
  if ! wait_for 80 out_has 'your project chain is now GHOST › A › LEAF'; then
    fail "bare ancestor gaining a file not noticed; $(logs)"; return
  fi
}

test_T_C12_ancestor_file_deleted() {
  seed_fixture "project: leaf" top leaf:top
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.top" || { fail "top baseline never landed; $(logs)"; return; }
  wait_armed
  rm "$(project_md top)"
  sleep 6
  if grep -q 'inotifywait exited' "$ERR_LOG"; then fail "inotifywait failure loop; $(logs)"; return; fi
  if ! alive; then fail "watcher died; $(logs)"; return; fi
  append_line "$ROLE_MD" "role edit after delete"
  if ! wait_for 30 out_has '\[role-file: rolex\].*role edit after delete'; then
    fail "role-file events slow or stopped; $(logs)"; return
  fi
}

test_T_C13_leave_sub_project_for_top_level() {
  seed_fixture "project: leaf" top leaf:top solo
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.top" || { fail "top baseline never landed; $(logs)"; return; }
  wait_armed
  write_identity "project: solo"
  if ! wait_for 50 out_has "you're now in project solo — Read $(project_md solo) — no longer inside TOP: drop their conventions"; then
    fail "left ancestors not named; $(logs)"; return
  fi
}

test_T_C14_member_block_rule() {
  seed_fixture "project: leaf" top leaf:top
  launch_watcher
  wait_for 50 test -f "$STATE/last-snapshot.project.top" || { fail "top baseline never landed; $(logs)"; return; }
  wait_armed
  local pmd; pmd=$(project_md top)
  sed -i 's/^  - someone$/  - someone\n\n  # note\n  - lateone/' "$pmd"
  sleep 2
  if out_has 'lateone|note'; then fail "member block lines leaked; $(logs)"; return; fi
}

run_test test_T_C1_chain_resolution
run_test test_T_C2_parent_edit
run_test test_T_C3_grandparent_edit
run_test test_T_C4_member_churn_suppressed
run_test test_T_C5_reparent_own
run_test test_T_C6_self_reparent_still_notifies
run_test test_T_C7_unnest
run_test test_T_C8_change_higher_up
run_test test_T_C9_ancestor_archived
run_test test_T_C10_join_sub_project
run_test test_T_C11_unwatched_chain_changes
run_test test_T_C12_ancestor_file_deleted
run_test test_T_C13_leave_sub_project_for_top_level
run_test test_T_C14_member_block_rule

printf '\n===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
