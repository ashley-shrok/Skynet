#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for Phase 115 Plan 115-05 unified walk over both
# ~/fleet/identities/ AND ~/fleet/identities-archive/ in fleet-status-sweep.py.
#
# Sibling to fleet-status-sweep-appearance.sh (which covers the Plan 111-01
# frontmatter/appearance code path). This driver targets the archive-tree
# enumeration specifically: does the unified walk emit an "archived: true"
# field on rows sourced from ~/fleet/identities-archive/ while live-tree rows
# either omit the field or emit "archived: false"?
#
# Exits 0 on all-pass; exits 1 on any failure with a diagnostic naming the
# failing test.
#
# Usage: bash substrate/scripts/tests/fleet-status-sweep.test.sh
#   Run from the repo root.
#
# Hermetic environment contract:
#   Each test builds a scratch tree at $FIXTURE and runs the sweep with
#   HOME="$FIXTURE" so the real ~/fleet/identities and ~/fleet/identities-archive
#   are never touched. Because $FIXTURE/.claude/sessions/ does not exist, the
#   sweep emits only identity lines (no pid lines). The scratch tree is removed
#   on EXIT via a trap.
#
# Requirements: bash, python3 (same python3 used for the sweep script itself).

set -u  # -e is NOT set — the script uses explicit assert helpers so a failing
        # assert does not silently skip subsequent tests.

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SWEEP="$REPO_ROOT/substrate/scripts/fleet-status-sweep.py"

if [ ! -f "$SWEEP" ]; then
  printf 'FATAL: sweep script not found at %s\n' "$SWEEP" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  printf 'FATAL: python3 not found — required for this test driver\n' >&2
  exit 1
fi

# ---- scratch fixture ----
FIXTURE=""
FIXTURE=$(mktemp -d)

cleanup() {
  [ -n "$FIXTURE" ] && [ -d "$FIXTURE" ] && rm -rf "$FIXTURE"
}
trap cleanup EXIT

# ---- test state ----
PASS=0
FAIL=0
FAILURES=()

# ---- helpers ----

fail() {
  local msg="${1:-unknown failure}"
  FAILURES+=("${CURRENT_TEST:-unknown}: $msg")
  FAIL=$((FAIL + 1))
}

assert_eq() {
  local expected="$1" actual="$2" msg="${3:-assert_eq}"
  if [ "$expected" != "$actual" ]; then
    fail "$msg: expected='$expected' got='$actual'"
  fi
}

run_test() {
  local test_fn="$1"
  local before_fail=$FAIL
  CURRENT_TEST="$test_fn"

  # Reset the fixture for every test so tests are independent.
  rm -rf "${FIXTURE:?}"/*

  # Set STDERR_FILE to a per-test path outside $FIXTURE so it survives the
  # subshell in `out=$(run_sweep)`.
  STDERR_FILE=$(mktemp)

  "$test_fn"

  rm -f "$STDERR_FILE"

  if [ "$FAIL" -eq "$before_fail" ]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$test_fn"
  else
    printf 'FAIL  %s\n' "$test_fn"
  fi
}

# run_sweep: HOME=$FIXTURE python3 $SWEEP; capture stdout.
# Stderr is captured to $STDERR_FILE (a fixed per-test path under $FIXTURE so
# a subshell-scoped variable would not lose it). Callers reset STDERR_FILE via
# reset_test_state before every test.
STDERR_FILE=""
run_sweep() {
  HOME="$FIXTURE" python3 "$SWEEP" 2>"$STDERR_FILE"
}

# make_live_identity: create a fixture identity in the LIVE tree.
# Usage: make_live_identity <name> [md_content]
make_live_identity() {
  local name="$1"
  local md="${2:-}"
  mkdir -p "$FIXTURE/fleet/identities/$name"
  if [ -n "$md" ]; then
    printf '%s' "$md" > "$FIXTURE/fleet/identities/$name/$name.md"
  fi
}

# make_archive_identity: create a fixture identity in the ARCHIVE tree.
# Usage: make_archive_identity <name> [md_content]
make_archive_identity() {
  local name="$1"
  local md="${2:-}"
  mkdir -p "$FIXTURE/fleet/identities-archive/$name"
  if [ -n "$md" ]; then
    printf '%s' "$md" > "$FIXTURE/fleet/identities-archive/$name/$name.md"
  fi
}

# assert_identity_field: assert a field on a named identity's JSONL line
# has a given value.
# Usage: assert_identity_field <stdout_var> <identity> <field_path> <expected_json>
assert_identity_field() {
  local stdout_var="$1" identity="$2" field_path="$3" expected_json="$4"
  local result
  result=$(printf '%s' "$stdout_var" | python3 -c "
import sys, json
lines = [l for l in sys.stdin.read().splitlines() if l.strip()]
target = None
for l in lines:
    obj = json.loads(l)
    if obj.get('line_kind') == 'identity' and obj.get('identity') == '$identity':
        target = obj
        break
if target is None:
    print('MISSING_LINE')
    sys.exit(0)
path = '$field_path'.split('.')
node = target
for k in path:
    if node is None or not isinstance(node, dict):
        node = None
        break
    node = node.get(k)
print(json.dumps(node))
" 2>/dev/null)
  if [ "$result" = "MISSING_LINE" ]; then
    fail "assert_identity_field($identity.$field_path): identity line missing from output"
  elif [ "$result" != "$expected_json" ]; then
    fail "assert_identity_field($identity.$field_path): expected=$expected_json got=$result"
  fi
}

# assert_identity_has_field / no_field: existence-only assertions.
assert_identity_has_field() {
  local stdout_var="$1" identity="$2" field_path="$3"
  local result
  result=$(printf '%s' "$stdout_var" | python3 -c "
import sys, json
lines = [l for l in sys.stdin.read().splitlines() if l.strip()]
for l in lines:
    obj = json.loads(l)
    if obj.get('line_kind') == 'identity' and obj.get('identity') == '$identity':
        path = '$field_path'.split('.')
        node = obj
        for k in path:
            if node is None or not isinstance(node, dict):
                node = None
                break
            node = node.get(k)
        print('present' if node is not None else 'absent')
        sys.exit(0)
print('MISSING_LINE')
" 2>/dev/null)
  if [ "$result" = "MISSING_LINE" ]; then
    fail "assert_identity_has_field($identity.$field_path): identity line missing"
  elif [ "$result" != "present" ]; then
    fail "assert_identity_has_field($identity.$field_path): field is absent or null"
  fi
}

# assert_identity_line_count: total identity JSONL lines emitted.
assert_identity_line_count() {
  local stdout_var="$1" expected="$2"
  local count
  count=$(printf '%s' "$stdout_var" | python3 -c "
import sys, json
lines = [l for l in sys.stdin.read().splitlines() if l.strip()]
print(sum(1 for l in lines if json.loads(l).get('line_kind') == 'identity'))
" 2>/dev/null)
  if [ "$count" != "$expected" ]; then
    fail "assert_identity_line_count: expected=$expected got=$count"
  fi
}

# assert_identity_line_missing: no identity line for this name in the output.
assert_identity_line_missing() {
  local stdout_var="$1" identity="$2"
  local result
  result=$(printf '%s' "$stdout_var" | python3 -c "
import sys, json
lines = [l for l in sys.stdin.read().splitlines() if l.strip()]
for l in lines:
    obj = json.loads(l)
    if obj.get('line_kind') == 'identity' and obj.get('identity') == '$identity':
        print('present')
        sys.exit(0)
print('absent')
" 2>/dev/null)
  if [ "$result" = "present" ]; then
    fail "assert_identity_line_missing($identity): line was emitted but should have been skipped"
  fi
}

# ============================================================
# TEST CASES
# ============================================================

# Case 1: live-tree only.
# ~/fleet/identities/alpha/ present. Sweep emits an identity line for alpha
# WITHOUT archived==true (either archived: false or absent — we assert
# archived == false since the emit dict always carries the key).
test_case_01_live_tree_only() {
  make_live_identity "alpha" "---
displayName: Alpha
---
body
"
  local out
  out=$(run_sweep)
  assert_identity_line_count "$out" "1"
  assert_identity_field "$out" "alpha" "archived" 'false'
}

# Case 2: archive-tree only.
# ~/fleet/identities-archive/beta/ present. Sweep emits an identity line for
# beta WITH archived==true.
test_case_02_archive_tree_only() {
  make_archive_identity "beta" "---
displayName: Beta (archived)
---
body
"
  local out
  out=$(run_sweep)
  assert_identity_line_count "$out" "1"
  assert_identity_field "$out" "beta" "archived" 'true'
}

# Case 3: both roots.
# alpha in live tree, beta in archive tree. Both identity lines emit;
# alpha has archived==false, beta has archived==true.
test_case_03_both_roots() {
  make_live_identity "alpha" "---
displayName: Alpha
---
body
"
  make_archive_identity "beta" "---
displayName: Beta
---
body
"
  local out
  out=$(run_sweep)
  assert_identity_line_count "$out" "2"
  assert_identity_field "$out" "alpha" "archived" 'false'
  assert_identity_field "$out" "beta" "archived" 'true'
}

# Case 4: missing archive tree.
# No ~/fleet/identities-archive/ dir at all (a common case — many hosts have
# never retired an identity). Sweep does NOT crash; emits only live-tree rows.
test_case_04_missing_archive_tree() {
  make_live_identity "alpha" "---
---
"
  # Deliberately do NOT create the archive tree.
  [ ! -d "$FIXTURE/fleet/identities-archive" ] || fail "case 4: archive tree pre-created — test isolation broken"

  local out
  out=$(run_sweep)
  assert_identity_line_count "$out" "1"
  assert_identity_field "$out" "alpha" "archived" 'false'
}

# Case 5: unsafe folder name in archive tree.
# A folder like `..evil` in the archive tree — SAFE_NAME_RE rejects it.
# Sweep does not emit a line for it, but does emit the safe live-tree line.
# (Note: `..evil` is used instead of `../evil` because a literal `../` in a
# subdir under identities-archive/ would either become a real path traversal
# in mkdir or get normalised — `..evil` is a directory name that fails
# SAFE_NAME_RE without breaking mkdir.)
test_case_05_unsafe_archive_name() {
  make_live_identity "alpha" "---
---
"
  mkdir -p "$FIXTURE/fleet/identities-archive/..evil"

  local out
  out=$(run_sweep)
  # Only the live alpha line — the ..evil folder is rejected.
  assert_identity_line_count "$out" "1"
  assert_identity_field "$out" "alpha" "archived" 'false'
  assert_identity_line_missing "$out" "..evil"

  # A grep of stderr should reveal the identity_name_skipped log tag.
  if [ ! -f "$STDERR_FILE" ] || ! grep -q "identity_name_skipped" "$STDERR_FILE"; then
    fail "case 5: expected identity_name_skipped log tag in stderr"
  fi
}

# Case 6: missing role.md / jsonl in archive tree.
# Archive-tree identity is a bare folder with no *.md file, no .pinned, etc.
# Sweep still emits its line without crashing. Cosmetic fields land as null.
test_case_06_bare_archive_dir() {
  # Bare folder: no <name>.md file.
  mkdir -p "$FIXTURE/fleet/identities-archive/gamma"

  local out
  out=$(run_sweep)
  assert_identity_line_count "$out" "1"
  assert_identity_field "$out" "gamma" "archived" 'true'
  assert_identity_field "$out" "gamma" "identity_cosmetics" 'null'
  assert_identity_field "$out" "gamma" "role" 'null'
  assert_identity_field "$out" "gamma" "role_cosmetics" 'null'
}

# Case 7 (post-code-review fix 2): State 3 anomaly — same identity name in
# BOTH live and archive trees. The shape says this must be impossible (retire
# flow is move+delete with collision-abort), but the sweep now defends
# explicitly: emit ONCE (live-tree wins because it walks first) and log an
# identity_name_collision warning on stderr for the archive-tree copy.
test_case_07_name_collision_both_trees() {
  make_live_identity "delta" "---
displayName: Delta (live)
---
body
"
  make_archive_identity "delta" "---
displayName: Delta (archived)
---
body
"

  local out
  out=$(run_sweep)
  # Exactly ONE line — the live-tree copy wins because it walks first.
  assert_identity_line_count "$out" "1"
  assert_identity_field "$out" "delta" "archived" 'false'

  # The archive-tree copy is anomalous — assert the structured warning fired.
  if [ ! -f "$STDERR_FILE" ] || ! grep -q "identity_name_collision" "$STDERR_FILE"; then
    fail "case 7: expected identity_name_collision log tag in stderr"
  fi
  if [ -f "$STDERR_FILE" ] && ! grep -q '"identities-archive"' "$STDERR_FILE"; then
    fail "case 7: expected collision log to name root=identities-archive"
  fi
}

# ============================================================
# MAIN
# ============================================================
printf '=== fleet-status-sweep archive-walk test driver ===\n'
printf 'sweep: %s\n' "$SWEEP"
printf 'fixture: %s\n' "$FIXTURE"
printf '\n'

run_test test_case_01_live_tree_only
run_test test_case_02_archive_tree_only
run_test test_case_03_both_roots
run_test test_case_04_missing_archive_tree
run_test test_case_05_unsafe_archive_name
run_test test_case_06_bare_archive_dir
run_test test_case_07_name_collision_both_trees

printf '\n===============================\n'
printf 'PASS: %s  FAIL: %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for _f in "${FAILURES[@]}"; do
    printf '  - %s\n' "$_f"
  done
  exit 1
fi
exit 0
