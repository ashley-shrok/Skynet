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

# Cases 2-7 originally covered the Phase 115 archive-tree walk. The Phase 122
# shape follow-up retired that walk: the sweep reads ONLY the live tree, so
# anything under ~/fleet/identities-archive/ must produce no identity line,
# no log noise, and must never shadow a live identity.

# Case 2: archive tree only → no identity lines.
test_case_02_archive_tree_only() {
  make_archive_identity "beta" "---
displayName: Beta (archived)
---
body
"
  local out
  out=$(run_sweep)
  assert_identity_line_count "$out" "0"
  assert_identity_line_missing "$out" "beta"
}

# Case 3: both roots → only the live identity emits.
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
  assert_identity_line_count "$out" "1"
  assert_identity_field "$out" "alpha" "archived" 'false'
  assert_identity_line_missing "$out" "beta"
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

# Case 5: an unsafe folder name in the archive tree is never even looked at.
test_case_05_unsafe_archive_name() {
  make_live_identity "alpha" "---
---
"
  mkdir -p "$FIXTURE/fleet/identities-archive/..evil"

  local out
  out=$(run_sweep)
  assert_identity_line_count "$out" "1"
  assert_identity_field "$out" "alpha" "archived" 'false'
  assert_identity_line_missing "$out" "..evil"
}

# Case 6: a bare archive-tree folder → no identity line, no crash.
test_case_06_bare_archive_dir() {
  mkdir -p "$FIXTURE/fleet/identities-archive/gamma"

  local out
  out=$(run_sweep)
  assert_identity_line_count "$out" "0"
  assert_identity_line_missing "$out" "gamma"
}

# Case 7: same name in both trees → exactly the live copy, untouched by the
# archived one.
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
  assert_identity_line_count "$out" "1"
  assert_identity_field "$out" "delta" "archived" 'false'
  assert_identity_field "$out" "delta" "identity_cosmetics.displayName" '"Delta (live)"'
}

# Case 8: project-list line carries `parent` — bare and quoted slugs survive,
# self-reference / malformed / absent → null.
test_case_08_project_parent() {
  local root="$FIXTURE/fleet/projects"
  mkdir -p "$root/top" "$root/child" "$root/quoted" "$root/selfie" "$root/bad"
  printf -- '---\ndisplayName: Top\n---\n' > "$root/top/project.md"
  printf -- '---\ndisplayName: Child\nparent: top  # nest\n---\n' > "$root/child/project.md"
  printf -- '---\nparent: "child"\ndisplayName: Quoted\n---\n' > "$root/quoted/project.md"
  printf -- '---\ndisplayName: Self\nparent: selfie\n---\n' > "$root/selfie/project.md"
  printf -- '---\ndisplayName: Bad\nparent: ../etc\n---\n' > "$root/bad/project.md"

  local out parents
  out=$(run_sweep)
  parents=$(printf '%s' "$out" | python3 -c "
import json, sys
for ln in sys.stdin:
    ln = ln.strip()
    if not ln:
        continue
    rec = json.loads(ln)
    if rec.get('line_kind') == 'project-list':
        print(','.join('%s=%s' % (p['slug'], p.get('parent', 'MISSING')) for p in rec['projects']))
")
  assert_eq "bad=None,child=top,quoted=child,selfie=None,top=None" "$parents" "project-list parents"
}

# Case 9: unquoted YAML null/bool/number names no parent (parity with the
# backend's YAML read); a quoted "null" is a slug; a long members list
# doesn't push `parent` out of the read.
test_case_09_project_parent_yaml_scalars_and_long_frontmatter() {
  local root="$FIXTURE/fleet/projects"
  mkdir -p "$root/null" "$root/a" "$root/b" "$root/c" "$root/d" "$root/long"
  printf -- '---\ndisplayName: Null\n---\n' > "$root/null/project.md"
  printf -- '---\ndisplayName: A\nparent: null\n---\n' > "$root/a/project.md"
  printf -- '---\ndisplayName: B\nparent: true\n---\n' > "$root/b/project.md"
  printf -- '---\ndisplayName: C\nparent: 123\n---\n' > "$root/c/project.md"
  printf -- '---\ndisplayName: D\nparent: "null"\n---\n' > "$root/d/project.md"
  {
    printf -- '---\ndisplayName: Long\nmembers:\n'
    for i in $(seq 1 400); do printf '  - some-fairly-long-member-name-%s\n' "$i"; done
    printf 'parent: a\n---\n'
  } > "$root/long/project.md"

  local out parents
  out=$(run_sweep)
  parents=$(printf '%s' "$out" | python3 -c "
import json, sys
for ln in sys.stdin:
    ln = ln.strip()
    if not ln:
        continue
    rec = json.loads(ln)
    if rec.get('line_kind') == 'project-list':
        print(','.join('%s=%s' % (p['slug'], p.get('parent', 'MISSING')) for p in rec['projects']))
")
  assert_eq "a=None,b=None,c=None,d=null,long=a,null=None" "$parents" "project-list parents (yaml scalars, long frontmatter)"
}

# Case 10: condense sentinels. `.compact-requested` (dropped by the agent or
# the app) → compact_requested; `.compacting` (held by the supervisor while
# /compact runs) → compacting. The retired recycle fields are no longer emitted.
test_case_10_condense_sentinels() {
  make_live_identity "idle" "---
---
"
  make_live_identity "queued" "---
---
"
  make_live_identity "running" "---
---
"
  touch "$FIXTURE/fleet/identities/queued/.compact-requested"
  touch "$FIXTURE/fleet/identities/running/.compacting"
  # Legacy sentinels must not leak into the new fields.
  touch "$FIXTURE/fleet/identities/idle/.recycle-requested"
  touch "$FIXTURE/fleet/identities/idle/.recycled-at"

  local out
  out=$(run_sweep)
  assert_identity_line_count "$out" "3"
  assert_identity_field "$out" "idle" "compact_requested" 'false'
  assert_identity_field "$out" "idle" "compacting" 'false'
  assert_identity_field "$out" "queued" "compact_requested" 'true'
  assert_identity_field "$out" "queued" "compacting" 'false'
  assert_identity_field "$out" "running" "compact_requested" 'false'
  assert_identity_field "$out" "running" "compacting" 'true'
  local f
  for f in recycled_at recycle_requested layer1_recycling; do
    assert_identity_field "$out" "idle" "$f" 'null'
  done
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
run_test test_case_08_project_parent
run_test test_case_09_project_parent_yaml_scalars_and_long_frontmatter
run_test test_case_10_condense_sentinels

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
