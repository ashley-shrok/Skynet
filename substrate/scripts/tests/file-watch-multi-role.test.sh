#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for file-watch.py multi-role support.
#
# An identity may list zero, one OR MORE roles in its frontmatter. Agents edit these
# files freely and don't always stick to one YAML shape, so the parser
# (`parse_roles_frontmatter`, a copy of tests/fixtures/roles_frontmatter_reference.py)
# reads the `roles:` key in any shape: flow lists, block sequences, plain
# single values, bare comma-separated forms. The singular `role:` key is NOT read.
# This driver covers the end-to-end watch: with multiple roles in the identity
# frontmatter, both role files must be watched, edits to either must fire a
# correctly-tagged event, per-role role-skill baselines must not collide across
# roles, and legacy single-role baselines must migrate onto the primary role
# so a substrate upgrade doesn't lose continuity.
#
# Covers:
#   T-M1 — flow-list frontmatter (`roles: [roleA, roleB]`): baselines land
#          for both roles; edit to roleA fires [role-file: roleA]; edit to
#          roleB fires [role-file: roleB].
#   T-M2 — block-sequence frontmatter (`roles:\n  - roleA\n  - roleB\n`):
#          same behavior — parser normalizes shape.
#   T-M3 — nonexistent role in list is skipped (stderr warning), the valid
#          one still gets watched.
#   T-M4 — legacy `last-snapshot.role` (previous single-role scheme) is
#          promoted to `last-snapshot.role.<primary>` on cold-start, no
#          spurious diff event fires.
#   T-M5 — role-skill slug that exists in BOTH roles (e.g. both have a
#          "deploy" role skill) gets per-role baselines
#          (`last-snapshot.role-skill.<role>.<slug>`) and edits to one don't
#          bleed into the other.
#   T-M6 — bare comma-separated frontmatter (`roles: a, b`): both watched.
#   T-M7 — no `roles:` key (only a singular `role:`, which is not read):
#          zero roles — the watcher keeps running, watches the identity
#          file, id skill and project file, watches no role file, and logs
#          no warning.
#   T-M8 — role ADDED mid-session (identity-file edit): pointer line to the
#          new role file (+ role skills folder) emitted, watcher re-execs in
#          place, the new role file is then watched.
#   T-M9 — role REMOVED mid-session: removal line emitted, its baseline
#          dropped, its edits go silent, the remaining role still fires.
#   T-M10 — mid-session edit to a malformed `roles:` (names no valid slug):
#          no re-exec, stderr diagnostic, the old set is still watched.
#   T-M11 — last role REMOVED mid-session (`roles: []`): removal line
#          emitted, watcher re-execs and keeps running with no role targets,
#          identity-file edits still fire.
#   T-M12 — first role ADDED to a `roles: []` identity: pointer line, the
#          new role file is then watched.
#   T-M13 — last role REMOVED mid-session by writing `roles: null` (YAML
#          null = no roles): same as T-M11 — removal line, re-exec, no
#          "unusable" diagnostic, watcher keeps running.
#   T-M14 — startup with `roles: null` / `~` / `""` / `''`: zero roles, the
#          watcher keeps running, watches the identity file, logs nothing.
#
# Exits 0 on all-pass; 1 on any failure with a diagnostic naming the failing
# test.
#
# Usage: bash substrate/scripts/tests/file-watch-multi-role.test.sh
#   Run from the repo root.
#
# Requirements: bash, python3, inotifywait.

set -u

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PY_SCRIPT="$REPO_ROOT/substrate/scripts/file-watch.py"

if [ ! -f "$PY_SCRIPT" ]; then
  printf 'FATAL: file-watch.py not found at %s\n' "$PY_SCRIPT" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  printf 'FATAL: python3 not found\n' >&2
  exit 1
fi
if ! command -v inotifywait >/dev/null 2>&1; then
  printf 'FATAL: inotifywait not found — this test targets the inotify path\n' >&2
  exit 1
fi

# ---- test state ----
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
  local msg="${1:-unknown failure}"
  FAILURES+=("${CURRENT_TEST:-unknown}: $msg")
  FAIL=$((FAIL + 1))
}

run_test() {
  local test_fn="$1"
  local before_fail=$FAIL
  CURRENT_TEST="$test_fn"
  "$test_fn"
  if [ "$FAIL" -eq "$before_fail" ]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$test_fn"
  else
    printf 'FAIL  %s\n' "$test_fn"
  fi
}

# ---- fixture helpers ----

# seed_multi_role_fixture: build a hermetic HOME with N role files and an
# identity whose frontmatter is a caller-supplied literal block.
#
# Args: <name> <frontmatter-literal> <role1> [role2] ...
# The frontmatter literal is inserted verbatim between the `---` fences,
# so the caller controls the YAML shape being tested.
#
# Sets globals: HOME_DIR, IDENT_DIR, IDENT_MD, plus ROLE_MD_<n> for each role
# (e.g. ROLE_MD_1, ROLE_MD_2). Also sets ROLE_1, ROLE_2, … as the role names.
seed_multi_role_fixture() {
  local name="$1"
  local frontmatter="$2"
  shift 2
  HOME_DIR=$(make_tmpdir)
  IDENT_DIR="$HOME_DIR/fleet/identities/$name"
  mkdir -p "$IDENT_DIR"
  IDENT_MD="$IDENT_DIR/$name.md"
  printf -- '---\n%s\n---\n\n# %s\n' "$frontmatter" "$name" > "$IDENT_MD"
  local i=1
  for role in "$@"; do
    mkdir -p "$HOME_DIR/fleet/roles/$role"
    local rm="$HOME_DIR/fleet/roles/$role/$role.md"
    printf '# %s role\n\nline 1\n' "$role" > "$rm"
    eval "ROLE_MD_$i='$rm'"
    eval "ROLE_$i='$role'"
    i=$((i + 1))
  done
}

atomic_write() {
  local target="$1" contents="$2"
  local tmp="$target.tmp"
  printf '%s' "$contents" > "$tmp"
  mv "$tmp" "$target"
}

launch_watcher() {
  local home_dir="$1" ident_dir="$2"
  OUT_LOG=$(make_tmpdir)/out.log
  STDOUT_LOG=$(make_tmpdir)/stdout.log
  ERR_LOG=$(make_tmpdir)/err.log
  HOME="$home_dir" AMBIENT_MONITOR_HARNESS_PID="$$" \
    python3 "$PY_SCRIPT" "$ident_dir" \
    >"$STDOUT_LOG" 2>"$ERR_LOG" &
  WATCHER_PID=$!
  ALL_PIDS+=("$WATCHER_PID")
  # Events are queued in <identity>/pending-context/, never printed: collect
  # them into OUT_LOG in queue order, the way the drain hook delivers them.
  [ -n "${COLLECTOR_PID:-}" ] && kill "$COLLECTOR_PID" 2>/dev/null
  ( q="$ident_dir/pending-context"
    while :; do
      for f in $(ls "$q" 2>/dev/null | grep '\.line$' | sort); do
        cat "$q/$f"; echo; rm -f "$q/$f"
      done
      sleep 0.05
    done ) >>"$OUT_LOG" 2>/dev/null &
  COLLECTOR_PID=$!
  ALL_PIDS+=("$COLLECTOR_PID")
}

wait_for_baseline() {
  local baseline="$1"
  local timeout="${2:-30}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if [ -f "$baseline" ]; then return 0; fi
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  return 1
}

wait_for_stdout_match() {
  local pattern="$1" out_log="$2" timeout="${3:-50}" elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if [ -f "$out_log" ] && grep -qE "$pattern" "$out_log"; then return 0; fi
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  return 1
}

# ============================================================
# T-M1: flow-list frontmatter — both role files get baselines,
# edits to each fire the correctly-tagged event.
# ============================================================
test_T_M1_flow_list_both_watched() {
  local name="multiname"
  seed_multi_role_fixture "$name" "roles: [rolealpha, rolebeta]" rolealpha rolebeta

  local baseline_a="$IDENT_DIR/file-watch/last-snapshot.role.rolealpha"
  local baseline_b="$IDENT_DIR/file-watch/last-snapshot.role.rolebeta"

  launch_watcher "$HOME_DIR" "$IDENT_DIR"

  if ! wait_for_baseline "$baseline_a"; then
    fail "T-M1: rolealpha baseline never landed (err=$(cat "$ERR_LOG" 2>&1))"
    return
  fi
  if ! wait_for_baseline "$baseline_b"; then
    fail "T-M1: rolebeta baseline never landed"
    return
  fi

  # Edit role A → expect [role-file: rolealpha] event.
  atomic_write "$ROLE_MD_1" "# rolealpha role (updated)

new alpha content
"
  if ! wait_for_stdout_match '📝 \[role-file: rolealpha\]' "$OUT_LOG"; then
    fail "T-M1: no rolealpha event; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"
    return
  fi
  if ! grep -q "new alpha content" "$baseline_a" 2>/dev/null; then
    fail "T-M1: rolealpha baseline not updated after edit"
    return
  fi

  # Edit role B → expect [role-file: rolebeta] event.
  atomic_write "$ROLE_MD_2" "# rolebeta role (updated)

new beta content
"
  if ! wait_for_stdout_match '📝 \[role-file: rolebeta\]' "$OUT_LOG"; then
    fail "T-M1: no rolebeta event; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"
    return
  fi
  if ! grep -q "new beta content" "$baseline_b" 2>/dev/null; then
    fail "T-M1: rolebeta baseline not updated after edit"
    return
  fi
}

# ============================================================
# T-M2: block-sequence frontmatter — parser normalizes shape,
# same end-to-end behavior as T-M1.
# ============================================================
test_T_M2_block_sequence_both_watched() {
  local name="blockname"
  # NOTE: literal newlines inside the frontmatter block via $'...'
  local fm=$'roles:\n  - roleblockx\n  - roleblocky'
  seed_multi_role_fixture "$name" "$fm" roleblockx roleblocky

  local baseline_x="$IDENT_DIR/file-watch/last-snapshot.role.roleblockx"
  local baseline_y="$IDENT_DIR/file-watch/last-snapshot.role.roleblocky"

  launch_watcher "$HOME_DIR" "$IDENT_DIR"

  if ! wait_for_baseline "$baseline_x"; then
    fail "T-M2: roleblockx baseline never landed (err=$(cat "$ERR_LOG"))"
    return
  fi
  if ! wait_for_baseline "$baseline_y"; then
    fail "T-M2: roleblocky baseline never landed"
    return
  fi

  atomic_write "$ROLE_MD_2" "# roleblocky (updated)
new y
"
  if ! wait_for_stdout_match '📝 \[role-file: roleblocky\]' "$OUT_LOG"; then
    fail "T-M2: no roleblocky event; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"
    return
  fi
}

# ============================================================
# T-M3: nonexistent role in list → skipped with stderr warning,
# the valid role is still watched.
# ============================================================
test_T_M3_missing_role_skipped() {
  local name="skipname"
  # ghostrole has NO role file on disk; realrole does.
  seed_multi_role_fixture "$name" "roles: [ghostrole, realrole]" realrole
  # realrole exists (seed_multi_role_fixture only made THE ONE); ghostrole was
  # listed in frontmatter but never seeded.

  local baseline_real="$IDENT_DIR/file-watch/last-snapshot.role.realrole"
  local baseline_ghost="$IDENT_DIR/file-watch/last-snapshot.role.ghostrole"

  launch_watcher "$HOME_DIR" "$IDENT_DIR"

  if ! wait_for_baseline "$baseline_real"; then
    fail "T-M3: realrole baseline never landed (err=$(cat "$ERR_LOG"))"
    return
  fi
  if [ -f "$baseline_ghost" ]; then
    fail "T-M3: ghost baseline erroneously created"
    return
  fi
  # Watcher must still be alive (not exited rc=1).
  if ! kill -0 "$WATCHER_PID" 2>/dev/null; then
    fail "T-M3: watcher died after ghostrole skip (err=$(cat "$ERR_LOG"))"
    return
  fi
  # Stderr should contain the skip warning.
  if ! grep -q "role file not found for role 'ghostrole'" "$ERR_LOG"; then
    fail "T-M3: no ghost-skip warning in stderr; err=$(cat "$ERR_LOG")"
    return
  fi
}

# ============================================================
# T-M4: legacy `last-snapshot.role` → `last-snapshot.role.<primary>`
# migration. Seed the old baseline in the watcher's state dir
# BEFORE launch, then verify it's renamed onto the primary role
# and no diff event fires (baseline still matches current content).
# ============================================================
test_T_M4_legacy_baseline_migration() {
  local role="migrole" name="migname"
  seed_multi_role_fixture "$name" "roles: $role" "$role"

  local baseline_dir="$IDENT_DIR/file-watch"
  mkdir -p "$baseline_dir"
  # Pre-seed legacy baseline with the CURRENT role.md content — so if migration
  # succeeds, cold-start sees baseline == current → no diff event.
  cp "$ROLE_MD_1" "$baseline_dir/last-snapshot.role"

  launch_watcher "$HOME_DIR" "$IDENT_DIR"

  local new_baseline="$baseline_dir/last-snapshot.role.$role"

  if ! wait_for_baseline "$new_baseline"; then
    fail "T-M4: primary-role baseline never landed (err=$(cat "$ERR_LOG"))"
    return
  fi

  # Legacy file should be gone (renamed away).
  if [ -f "$baseline_dir/last-snapshot.role" ]; then
    fail "T-M4: legacy last-snapshot.role still present after migration"
    return
  fi

  # No spurious role-file diff event should fire (baseline matched current).
  # Give the watcher a moment to settle, then check stdout.
  sleep 0.5
  if grep -qE '📝 \[role-file: '"$role"'\].*changed' "$OUT_LOG" 2>/dev/null; then
    fail "T-M4: spurious role-file event fired despite matching migrated baseline; out=$(cat "$OUT_LOG")"
    return
  fi
}

# ============================================================
# T-M5: same slug in two roles' role-skill trees gets per-role
# baselines and events don't collide.
# ============================================================
test_T_M5_role_skill_slug_per_role() {
  local name="rbname"
  seed_multi_role_fixture "$name" "roles: [rbrolea, rbroleb]" rbrolea rbroleb

  # Seed a `deploy` role skill in BOTH roles.
  local rba="$HOME_DIR/fleet/roles/rbrolea/skills/deploy"
  local rbb="$HOME_DIR/fleet/roles/rbroleb/skills/deploy"
  mkdir -p "$rba" "$rbb"
  printf 'rbrolea deploy v1\n' > "$rba/SKILL.md"
  printf 'rbroleb deploy v1\n' > "$rbb/SKILL.md"

  local baseline_a="$IDENT_DIR/file-watch/last-snapshot.role-skill.rbrolea.deploy"
  local baseline_b="$IDENT_DIR/file-watch/last-snapshot.role-skill.rbroleb.deploy"

  launch_watcher "$HOME_DIR" "$IDENT_DIR"

  # Both cold-start baselines should land.
  if ! wait_for_baseline "$baseline_a"; then
    fail "T-M5: rbrolea/deploy baseline never landed (err=$(cat "$ERR_LOG"))"
    return
  fi
  if ! wait_for_baseline "$baseline_b"; then
    fail "T-M5: rbroleb/deploy baseline never landed"
    return
  fi

  # Old unprefixed baseline should NOT be created (that would prove the
  # old naming scheme is still in use — regression guard).
  if [ -f "$IDENT_DIR/file-watch/last-snapshot.role-skill.deploy" ]; then
    fail "T-M5: unprefixed role-skill baseline created — regression"
    return
  fi

  # Edit rbrolea's deploy → expect [role-skill: rbrolea/deploy] event, NOT rbroleb.
  atomic_write "$rba/SKILL.md" "rbrolea deploy v2 — updated
"
  if ! wait_for_stdout_match '📝 \[role-skill: rbrolea/deploy\]' "$OUT_LOG"; then
    fail "T-M5: no rbrolea/deploy event; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"
    return
  fi
  # rbroleb baseline must NOT have moved (its role skill wasn't touched).
  if ! grep -q "rbroleb deploy v1" "$baseline_b" 2>/dev/null; then
    fail "T-M5: rbroleb baseline mutated by rbrolea edit — cross-role bleed"
    return
  fi
  # And no rbroleb event should have fired.
  if grep -q '📝 \[role-skill: rbroleb/deploy\]' "$OUT_LOG" 2>/dev/null; then
    fail "T-M5: rbroleb event fired when only rbrolea was edited"
    return
  fi
}

# ============================================================
# T-M6: bare comma-separated `roles: a, b` — both watched.
# ============================================================
test_T_M6_bare_comma_both_watched() {
  local name="commaname"
  seed_multi_role_fixture "$name" "roles: commaa, commab" commaa commab
  launch_watcher "$HOME_DIR" "$IDENT_DIR"
  local bdir="$IDENT_DIR/file-watch"
  if ! wait_for_baseline "$bdir/last-snapshot.role.commaa"; then
    fail "T-M6: commaa baseline never landed (err=$(cat "$ERR_LOG"))"; return
  fi
  if ! wait_for_baseline "$bdir/last-snapshot.role.commab"; then
    fail "T-M6: commab baseline never landed (err=$(cat "$ERR_LOG"))"; return
  fi
  wait_for_baseline "$bdir/last-snapshot.identity" || true
  sleep 1
  atomic_write "$ROLE_MD_2" "# commab role (updated)
"
  if ! wait_for_stdout_match '📝 \[role-file: commab\]' "$OUT_LOG"; then
    fail "T-M6: no commab event; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
}

# ============================================================
# T-M7: no `roles:` key (the singular `role:` is not read) → zero roles:
# watcher keeps running on the identity file, id skill and project file.
# ============================================================
test_T_M7_no_roles_key_keeps_running() {
  local name="singname"
  seed_multi_role_fixture "$name" "role: singrole
project: solo" singrole
  mkdir -p "$HOME_DIR/fleet/projects/solo" "$HOME_DIR/.claude/skills/id"
  printf -- '---\ndisplayName: solo\n---\n\nproject body\n' > "$HOME_DIR/fleet/projects/solo/project.md"
  printf '# id skill\n' > "$HOME_DIR/.claude/skills/id/SKILL.md"
  local bdir="$IDENT_DIR/file-watch"
  launch_watcher "$HOME_DIR" "$IDENT_DIR"
  local b
  for b in identity id-skill project.solo; do
    if ! wait_for_baseline "$bdir/last-snapshot.$b"; then
      fail "T-M7: $b baseline never landed (err=$(cat "$ERR_LOG"))"; return
    fi
  done
  sleep 1
  if ! kill -0 "$WATCHER_PID" 2>/dev/null; then
    fail "T-M7: watcher exited with zero roles (err=$(cat "$ERR_LOG"))"; return
  fi
  if [ -f "$bdir/last-snapshot.role.singrole" ]; then
    fail "T-M7: singrole baseline written from a singular role: key"; return
  fi
  if [ -s "$ERR_LOG" ]; then
    fail "T-M7: stderr not empty with zero roles; err=$(cat "$ERR_LOG")"; return
  fi
  atomic_write "$HOME_DIR/fleet/projects/solo/project.md" "$(printf -- '---\ndisplayName: solo\n---\n\nproject body edited\n')
"
  if ! wait_for_stdout_match '📝 \[project-file: solo\] .*project body edited' "$OUT_LOG"; then
    fail "T-M7: project edit not emitted; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
  atomic_write "$HOME_DIR/.claude/skills/id/SKILL.md" "# id skill (edited)
"
  if ! wait_for_stdout_match 'id skill \(edited\)' "$OUT_LOG"; then
    fail "T-M7: id skill edit not emitted; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
}

# write_identity_fm <frontmatter-literal> — atomically rewrite IDENT_MD.
write_identity_fm() {
  atomic_write "$IDENT_MD" "$(printf -- '---\n%s\n---\n\n# body\n' "$1")
"
}

# ============================================================
# T-M8: role added mid-session → pointer line, re-exec, new role watched.
# ============================================================
test_T_M8_role_added_mid_session() {
  local name="addname"
  seed_multi_role_fixture "$name" "roles: addbase" addbase addnew
  mkdir -p "$HOME_DIR/fleet/roles/addnew/skills"
  local bdir="$IDENT_DIR/file-watch"
  launch_watcher "$HOME_DIR" "$IDENT_DIR"
  if ! wait_for_baseline "$bdir/last-snapshot.identity"; then
    fail "T-M8: identity baseline never landed (err=$(cat "$ERR_LOG"))"; return
  fi
  sleep 1
  if [ -f "$bdir/last-snapshot.role.addnew" ]; then
    fail "T-M8: addnew watched before it was added"; return
  fi
  write_identity_fm "roles: [addbase, addnew]"
  local rf="$HOME_DIR/fleet/roles/addnew/addnew.md"
  if ! wait_for_stdout_match "📝 \[role-file: addnew\] you now hold role addnew — Read $rf \(role skills: $HOME_DIR/fleet/roles/addnew/skills\)" "$OUT_LOG"; then
    fail "T-M8: no add pointer; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
  if ! wait_for_baseline "$bdir/last-snapshot.role.addnew"; then
    fail "T-M8: addnew baseline never landed after add (err=$(cat "$ERR_LOG"))"; return
  fi
  if ! kill -0 "$WATCHER_PID" 2>/dev/null; then
    fail "T-M8: watcher died across the re-exec (err=$(cat "$ERR_LOG"))"; return
  fi
  if grep -q 'you now hold role addbase' "$OUT_LOG"; then
    fail "T-M8: pointer emitted for an already-held role"; return
  fi
  sleep 1
  atomic_write "$ROLE_MD_2" "# addnew role (edited after add)
"
  if ! wait_for_stdout_match '📝 \[role-file: addnew\] your role file changed — .*edited after add' "$OUT_LOG"; then
    fail "T-M8: addnew edit not emitted after add; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
}

# ============================================================
# T-M9: role removed mid-session → removal line, baseline dropped,
# its edits silent, remaining role still fires.
# ============================================================
test_T_M9_role_removed_mid_session() {
  local name="rmname"
  seed_multi_role_fixture "$name" "roles: [rmkeep, rmdrop]" rmkeep rmdrop
  local bdir="$IDENT_DIR/file-watch"
  launch_watcher "$HOME_DIR" "$IDENT_DIR"
  if ! wait_for_baseline "$bdir/last-snapshot.role.rmdrop"; then
    fail "T-M9: rmdrop baseline never landed (err=$(cat "$ERR_LOG"))"; return
  fi
  wait_for_baseline "$bdir/last-snapshot.identity" || true
  sleep 1
  write_identity_fm "roles: rmkeep"
  if ! wait_for_stdout_match '📝 \[role-file: rmdrop\] you no longer hold role rmdrop' "$OUT_LOG"; then
    fail "T-M9: no removal line; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
  local elapsed=0
  while [ -f "$bdir/last-snapshot.role.rmdrop" ] && [ "$elapsed" -lt 50 ]; do
    sleep 0.1; elapsed=$((elapsed + 1))
  done
  if [ -f "$bdir/last-snapshot.role.rmdrop" ]; then
    fail "T-M9: rmdrop baseline not removed"; return
  fi
  sleep 1.5
  if ! kill -0 "$WATCHER_PID" 2>/dev/null; then
    fail "T-M9: watcher died across the re-exec (err=$(cat "$ERR_LOG"))"; return
  fi
  atomic_write "$ROLE_MD_2" "# rmdrop (edited after removal)
"
  atomic_write "$ROLE_MD_1" "# rmkeep (edited after removal)
"
  if ! wait_for_stdout_match '📝 \[role-file: rmkeep\] your role file changed' "$OUT_LOG"; then
    fail "T-M9: rmkeep edit not emitted; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
  sleep 0.5
  if grep -q 'rmdrop (edited after removal)' "$OUT_LOG"; then
    fail "T-M9: removed role's edit still emitted; out=$(cat "$OUT_LOG")"; return
  fi
}

# ============================================================
# T-M10: mid-session edit to a malformed roles list → no re-exec,
# stderr diagnostic, old set still watched.
# ============================================================
test_T_M10_invalid_roles_edit_keeps_old_set() {
  local name="badname"
  seed_multi_role_fixture "$name" "roles: [badkeep, badother]" badkeep badother
  local bdir="$IDENT_DIR/file-watch"
  launch_watcher "$HOME_DIR" "$IDENT_DIR"
  if ! wait_for_baseline "$bdir/last-snapshot.role.badother"; then
    fail "T-M10: badother baseline never landed (err=$(cat "$ERR_LOG"))"; return
  fi
  wait_for_baseline "$bdir/last-snapshot.identity" || true
  sleep 1
  write_identity_fm "roles: [Bad Name]"
  local elapsed=0
  while ! grep -q 'identity roles unusable' "$ERR_LOG" 2>/dev/null && [ "$elapsed" -lt 50 ]; do
    sleep 0.1; elapsed=$((elapsed + 1))
  done
  if ! grep -q 'identity roles unusable' "$ERR_LOG"; then
    fail "T-M10: no stderr diagnostic; err=$(cat "$ERR_LOG")"; return
  fi
  if grep -q 'reloading in place' "$ERR_LOG"; then
    fail "T-M10: watcher re-execed on a malformed roles list; err=$(cat "$ERR_LOG")"; return
  fi
  if grep -q 'no longer hold role' "$OUT_LOG"; then
    fail "T-M10: removal line emitted for a malformed roles list"; return
  fi
  if ! kill -0 "$WATCHER_PID" 2>/dev/null; then
    fail "T-M10: watcher died (err=$(cat "$ERR_LOG"))"; return
  fi
  atomic_write "$ROLE_MD_2" "# badother (still watched)
"
  if ! wait_for_stdout_match '📝 \[role-file: badother\] your role file changed — .*still watched' "$OUT_LOG"; then
    fail "T-M10: old set no longer watched; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
}

# ============================================================
# T-M11: last role removed mid-session → removal line, re-exec, watcher
# keeps running with no role targets.
# ============================================================
test_T_M11_last_role_removed() {
  local name="lastname"
  seed_multi_role_fixture "$name" "roles: [lastrole]" lastrole
  local bdir="$IDENT_DIR/file-watch"
  launch_watcher "$HOME_DIR" "$IDENT_DIR"
  if ! wait_for_baseline "$bdir/last-snapshot.role.lastrole"; then
    fail "T-M11: lastrole baseline never landed (err=$(cat "$ERR_LOG"))"; return
  fi
  wait_for_baseline "$bdir/last-snapshot.identity" || true
  sleep 1
  write_identity_fm "roles: []"
  if ! wait_for_stdout_match '📝 \[role-file: lastrole\] you no longer hold role lastrole' "$OUT_LOG"; then
    fail "T-M11: no removal line; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
  local elapsed=0
  while [ -f "$bdir/last-snapshot.role.lastrole" ] && [ "$elapsed" -lt 50 ]; do
    sleep 0.1; elapsed=$((elapsed + 1))
  done
  if [ -f "$bdir/last-snapshot.role.lastrole" ]; then
    fail "T-M11: lastrole baseline not removed"; return
  fi
  sleep 1.5
  if ! kill -0 "$WATCHER_PID" 2>/dev/null; then
    fail "T-M11: watcher died after dropping to zero roles (err=$(cat "$ERR_LOG"))"; return
  fi
  if grep -q 'unusable' "$ERR_LOG"; then
    fail "T-M11: zero roles reported as unusable; err=$(cat "$ERR_LOG")"; return
  fi
  atomic_write "$ROLE_MD_1" "# lastrole (edited after removal)
"
  write_identity_fm "roles: []
task: still watched"
  if ! wait_for_stdout_match '📝 \[identity-file: lastname\] .*still watched' "$OUT_LOG"; then
    fail "T-M11: identity edit not emitted with zero roles; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
  if grep -q 'lastrole (edited after removal)' "$OUT_LOG"; then
    fail "T-M11: removed role's edit still emitted; out=$(cat "$OUT_LOG")"; return
  fi
}

# ============================================================
# T-M12: first role added to a roleless identity → pointer, then watched.
# ============================================================
test_T_M12_first_role_added() {
  local name="firstname"
  seed_multi_role_fixture "$name" "roles: []" firstrole
  local bdir="$IDENT_DIR/file-watch"
  launch_watcher "$HOME_DIR" "$IDENT_DIR"
  if ! wait_for_baseline "$bdir/last-snapshot.identity"; then
    fail "T-M12: identity baseline never landed (err=$(cat "$ERR_LOG"))"; return
  fi
  sleep 1
  if ! kill -0 "$WATCHER_PID" 2>/dev/null; then
    fail "T-M12: watcher exited with roles: [] (err=$(cat "$ERR_LOG"))"; return
  fi
  if [ -f "$bdir/last-snapshot.role.firstrole" ]; then
    fail "T-M12: firstrole watched before it was added"; return
  fi
  write_identity_fm "roles: [firstrole]"
  if ! wait_for_stdout_match "📝 \[role-file: firstrole\] you now hold role firstrole — Read $ROLE_MD_1" "$OUT_LOG"; then
    fail "T-M12: no add pointer; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
  if ! wait_for_baseline "$bdir/last-snapshot.role.firstrole"; then
    fail "T-M12: firstrole baseline never landed after add (err=$(cat "$ERR_LOG"))"; return
  fi
  sleep 1
  atomic_write "$ROLE_MD_1" "# firstrole (edited after add)
"
  if ! wait_for_stdout_match '📝 \[role-file: firstrole\] your role file changed — .*edited after add' "$OUT_LOG"; then
    fail "T-M12: firstrole edit not emitted after add; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
}

# ============================================================
# T-M13: last role removed mid-session by writing `roles: null` → treated
# as zero roles (same as `roles: []`), not as malformed.
# ============================================================
test_T_M13_last_role_removed_via_null() {
  local name="nullname"
  seed_multi_role_fixture "$name" "roles: [nullrole]" nullrole
  local bdir="$IDENT_DIR/file-watch"
  launch_watcher "$HOME_DIR" "$IDENT_DIR"
  if ! wait_for_baseline "$bdir/last-snapshot.role.nullrole"; then
    fail "T-M13: nullrole baseline never landed (err=$(cat "$ERR_LOG"))"; return
  fi
  wait_for_baseline "$bdir/last-snapshot.identity" || true
  sleep 1
  write_identity_fm "roles: null"
  if ! wait_for_stdout_match '📝 \[role-file: nullrole\] you no longer hold role nullrole' "$OUT_LOG"; then
    fail "T-M13: no removal line; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
  local elapsed=0
  while [ -f "$bdir/last-snapshot.role.nullrole" ] && [ "$elapsed" -lt 50 ]; do
    sleep 0.1; elapsed=$((elapsed + 1))
  done
  if [ -f "$bdir/last-snapshot.role.nullrole" ]; then
    fail "T-M13: nullrole baseline not removed"; return
  fi
  sleep 1.5
  if ! kill -0 "$WATCHER_PID" 2>/dev/null; then
    fail "T-M13: watcher died after roles: null (err=$(cat "$ERR_LOG"))"; return
  fi
  if grep -qE "unusable|role 'null'" "$ERR_LOG"; then
    fail "T-M13: roles: null not read as zero roles; err=$(cat "$ERR_LOG")"; return
  fi
  atomic_write "$ROLE_MD_1" "# nullrole (edited after removal)
"
  write_identity_fm "roles: null
task: still watched"
  if ! wait_for_stdout_match '📝 \[identity-file: nullname\] .*still watched' "$OUT_LOG"; then
    fail "T-M13: identity edit not emitted with roles: null; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
  fi
  if grep -q 'nullrole (edited after removal)' "$OUT_LOG"; then
    fail "T-M13: removed role's edit still emitted; out=$(cat "$OUT_LOG")"; return
  fi
}

# ============================================================
# T-M14: startup with a YAML-null / empty-string roles value → zero roles,
# watcher keeps running (no exit, no diagnostic).
# ============================================================
test_T_M14_startup_null_roles_keeps_running() {
  local val i=0
  for val in "null" "~" '""' "''"; do
    i=$((i + 1))
    local name="nullstart$i"
    seed_multi_role_fixture "$name" "roles: $val" somerole
    local bdir="$IDENT_DIR/file-watch"
    launch_watcher "$HOME_DIR" "$IDENT_DIR"
    if ! wait_for_baseline "$bdir/last-snapshot.identity"; then
      fail "T-M14[roles: $val]: identity baseline never landed (err=$(cat "$ERR_LOG"))"; return
    fi
    sleep 1
    if ! kill -0 "$WATCHER_PID" 2>/dev/null; then
      fail "T-M14[roles: $val]: watcher exited at startup (err=$(cat "$ERR_LOG"))"; return
    fi
    if [ -s "$ERR_LOG" ]; then
      fail "T-M14[roles: $val]: stderr not empty; err=$(cat "$ERR_LOG")"; return
    fi
    if ls "$bdir"/last-snapshot.role.* >/dev/null 2>&1; then
      fail "T-M14[roles: $val]: a role baseline was written"; return
    fi
    write_identity_fm "roles: $val
task: edited $i"
    if ! wait_for_stdout_match "📝 \[identity-file: $name\] .*edited $i" "$OUT_LOG"; then
      fail "T-M14[roles: $val]: identity edit not emitted; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"; return
    fi
    kill "$WATCHER_PID" 2>/dev/null
  done
}

# ============================================================
# T-M15: runbook → role-skill conversion. A baseline the watcher kept under
# the old runbook name (`last-snapshot.runbook.<role>.<slug>`, content already
# matching the converted SKILL.md) is renamed onto the role-skill name at
# startup and diffs clean — no notice. A role skill added afterwards emits
# its description with the Read pointer.
# ============================================================
test_T_M15_runbook_baseline_renamed_and_added_has_description() {
  local name="convname"
  seed_multi_role_fixture "$name" "roles: [convrole]" convrole

  local sk="$HOME_DIR/fleet/roles/convrole/skills/deploy"
  mkdir -p "$sk" "$IDENT_DIR/file-watch" "$HOME_DIR/fleet/roles/convrole/runbooks/pending"
  printf -- '---\nname: deploy\ndescription: Ship it.\n---\nsteps\n' > "$sk/SKILL.md"
  ln -s ../skills/deploy "$HOME_DIR/fleet/roles/convrole/runbooks/deploy"
  cp "$sk/SKILL.md" "$IDENT_DIR/file-watch/last-snapshot.runbook.convrole.deploy"
  # A runbook not converted yet keeps its old baseline and says nothing.
  printf 'p\n' > "$HOME_DIR/fleet/roles/convrole/runbooks/pending/runbook.md"
  printf 'p\n' > "$IDENT_DIR/file-watch/last-snapshot.runbook.convrole.pending"

  launch_watcher "$HOME_DIR" "$IDENT_DIR"

  local migrated="$IDENT_DIR/file-watch/last-snapshot.role-skill.convrole.deploy"
  if ! wait_for_baseline "$migrated"; then
    fail "T-M15: runbook baseline not renamed onto role-skill (err=$(cat "$ERR_LOG"))"
    return
  fi
  if [ -e "$IDENT_DIR/file-watch/last-snapshot.runbook.convrole.deploy" ]; then
    fail "T-M15: legacy runbook baseline left behind"
    return
  fi

  local added="$HOME_DIR/fleet/roles/convrole/skills/restore"
  mkdir -p "$added"
  atomic_write "$added/SKILL.md" "---
name: restore
description: >-
  Bring a backup
  back.
---
steps
"
  if ! wait_for_stdout_match "📝 \[role-skill: convrole/restore\] added — Bring a backup back\. — Read $added/SKILL.md" "$OUT_LOG"; then
    fail "T-M15: added notice missing description; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"
    return
  fi
  if [ ! -f "$IDENT_DIR/file-watch/last-snapshot.runbook.convrole.pending" ] \
     || [ -e "$IDENT_DIR/file-watch/last-snapshot.role-skill.convrole.pending" ]; then
    fail "T-M15: an unconverted runbook's baseline was moved"
    return
  fi
  if grep -q 'convrole/pending' "$OUT_LOG" 2>/dev/null; then
    fail "T-M15: unconverted runbook emitted a notice; out=$(cat "$OUT_LOG")"
    return
  fi
  if grep -q 'convrole/deploy' "$OUT_LOG" 2>/dev/null; then
    fail "T-M15: converted role skill emitted a notice; out=$(cat "$OUT_LOG")"
    return
  fi
}

# ---- run ----

run_test test_T_M1_flow_list_both_watched
run_test test_T_M2_block_sequence_both_watched
run_test test_T_M3_missing_role_skipped
run_test test_T_M4_legacy_baseline_migration
run_test test_T_M5_role_skill_slug_per_role
run_test test_T_M6_bare_comma_both_watched
run_test test_T_M7_no_roles_key_keeps_running
run_test test_T_M8_role_added_mid_session
run_test test_T_M9_role_removed_mid_session
run_test test_T_M10_invalid_roles_edit_keeps_old_set
run_test test_T_M11_last_role_removed
run_test test_T_M12_first_role_added
run_test test_T_M13_last_role_removed_via_null
run_test test_T_M14_startup_null_roles_keeps_running
run_test test_T_M15_runbook_baseline_renamed_and_added_has_description

# ---- summary ----

printf '\n===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILURES[@]}"; do
    printf '  - %s\n' "$f"
  done
  exit 1
fi

exit 0
