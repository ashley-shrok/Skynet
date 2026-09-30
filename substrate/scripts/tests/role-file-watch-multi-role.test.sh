#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for role-file-watch.py multi-role support.
#
# An identity may list one OR MORE roles in its frontmatter. Agents edit these
# files freely and don't always stick to one YAML shape, so the parser
# (`_parse_roles_from_frontmatter`) accepts flow lists, block sequences, plain
# single values, bare comma-separated forms, and the `roles:` plural alias.
# This driver covers the end-to-end watch: with multiple roles in the identity
# frontmatter, both role files must be watched, edits to either must fire a
# correctly-tagged event, per-role runbook baselines must not collide across
# roles, and legacy single-role baselines must migrate onto the primary role
# so a substrate upgrade doesn't lose continuity.
#
# Covers:
#   T-M1 — flow-list frontmatter (`role: [roleA, roleB]`): baselines land
#          for both roles; edit to roleA fires [role-file: roleA]; edit to
#          roleB fires [role-file: roleB].
#   T-M2 — block-sequence frontmatter (`role:\n  - roleA\n  - roleB\n`):
#          same behavior — parser normalizes shape.
#   T-M3 — nonexistent role in list is skipped (stderr warning), the valid
#          one still gets watched.
#   T-M4 — legacy `last-snapshot.role` (previous single-role scheme) is
#          promoted to `last-snapshot.role.<primary>` on cold-start, no
#          spurious diff event fires.
#   T-M5 — runbook slug that exists in BOTH roles (e.g. both have a
#          "deploy" runbook) gets per-role baselines
#          (`last-snapshot.runbook.<role>.<slug>`) and edits to one don't
#          bleed into the other.
#
# Exits 0 on all-pass; 1 on any failure with a diagnostic naming the failing
# test.
#
# Usage: bash substrate/scripts/tests/role-file-watch-multi-role.test.sh
#   Run from the repo root.
#
# Requirements: bash, python3, inotifywait.

set -u

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PY_SCRIPT="$REPO_ROOT/substrate/scripts/role-file-watch.py"

if [ ! -f "$PY_SCRIPT" ]; then
  printf 'FATAL: role-file-watch.py not found at %s\n' "$PY_SCRIPT" >&2
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
  ERR_LOG=$(make_tmpdir)/err.log
  HOME="$home_dir" AMBIENT_MONITOR_HARNESS_PID="$$" \
    python3 "$PY_SCRIPT" "$ident_dir" \
    >"$OUT_LOG" 2>"$ERR_LOG" &
  WATCHER_PID=$!
  ALL_PIDS+=("$WATCHER_PID")
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
  seed_multi_role_fixture "$name" "role: [rolealpha, rolebeta]" rolealpha rolebeta

  local baseline_a="$IDENT_DIR/role-file-watch/last-snapshot.role.rolealpha"
  local baseline_b="$IDENT_DIR/role-file-watch/last-snapshot.role.rolebeta"

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
  local fm=$'role:\n  - roleblockx\n  - roleblocky'
  seed_multi_role_fixture "$name" "$fm" roleblockx roleblocky

  local baseline_x="$IDENT_DIR/role-file-watch/last-snapshot.role.roleblockx"
  local baseline_y="$IDENT_DIR/role-file-watch/last-snapshot.role.roleblocky"

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
  seed_multi_role_fixture "$name" "role: [ghostrole, realrole]" realrole
  # realrole exists (seed_multi_role_fixture only made THE ONE); ghostrole was
  # listed in frontmatter but never seeded.

  local baseline_real="$IDENT_DIR/role-file-watch/last-snapshot.role.realrole"
  local baseline_ghost="$IDENT_DIR/role-file-watch/last-snapshot.role.ghostrole"

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
  seed_multi_role_fixture "$name" "role: $role" "$role"

  local baseline_dir="$IDENT_DIR/role-file-watch"
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
# T-M5: same slug in two roles' runbooks trees gets per-role
# baselines and events don't collide.
# ============================================================
test_T_M5_runbook_slug_per_role() {
  local name="rbname"
  seed_multi_role_fixture "$name" "role: [rbrolea, rbroleb]" rbrolea rbroleb

  # Seed a `deploy` runbook in BOTH roles.
  local rba="$HOME_DIR/fleet/roles/rbrolea/runbooks/deploy"
  local rbb="$HOME_DIR/fleet/roles/rbroleb/runbooks/deploy"
  mkdir -p "$rba" "$rbb"
  printf 'rbrolea deploy v1\n' > "$rba/runbook.md"
  printf 'rbroleb deploy v1\n' > "$rbb/runbook.md"

  local baseline_a="$IDENT_DIR/role-file-watch/last-snapshot.runbook.rbrolea.deploy"
  local baseline_b="$IDENT_DIR/role-file-watch/last-snapshot.runbook.rbroleb.deploy"

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
  if [ -f "$IDENT_DIR/role-file-watch/last-snapshot.runbook.deploy" ]; then
    fail "T-M5: unprefixed runbook baseline created — regression"
    return
  fi

  # Edit rbrolea's deploy → expect [runbook: rbrolea/deploy] event, NOT rbroleb.
  atomic_write "$rba/runbook.md" "rbrolea deploy v2 — updated
"
  if ! wait_for_stdout_match '📝 \[runbook: rbrolea/deploy\]' "$OUT_LOG"; then
    fail "T-M5: no rbrolea/deploy event; out=$(cat "$OUT_LOG"); err=$(cat "$ERR_LOG")"
    return
  fi
  # rbroleb baseline must NOT have moved (its runbook wasn't touched).
  if ! grep -q "rbroleb deploy v1" "$baseline_b" 2>/dev/null; then
    fail "T-M5: rbroleb baseline mutated by rbrolea edit — cross-role bleed"
    return
  fi
  # And no rbroleb event should have fired.
  if grep -q '📝 \[runbook: rbroleb/deploy\]' "$OUT_LOG" 2>/dev/null; then
    fail "T-M5: rbroleb event fired when only rbrolea was edited"
    return
  fi
}

# ---- run ----

run_test test_T_M1_flow_list_both_watched
run_test test_T_M2_block_sequence_both_watched
run_test test_T_M3_missing_role_skipped
run_test test_T_M4_legacy_baseline_migration
run_test test_T_M5_runbook_slug_per_role

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
