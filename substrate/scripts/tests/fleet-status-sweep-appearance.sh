#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for Phase 111-01 appearance additions to fleet-status-sweep.py.
#
# Covers the new _read_frontmatter_cosmetics / _read_role_cosmetics /
# _build_identity_line appearance paths with a HOME-scoped scratch fixture.
# Every case is unreachable from the TypeScript fixture tests — the TS side
# tests the sweep-schema parser; this tests the Python emitter and its
# hand-rolled frontmatter parser.
#
# Exits 0 on all-pass; exits 1 on any failure with a diagnostic naming the
# failing test.
#
# Usage: bash substrate/scripts/tests/fleet-status-sweep-appearance.sh
#   Run from the repo root.
#
# Hermetic environment contract:
#   The sweep reads $HOME for its identity and role paths. This driver builds a
#   scratch tree at $FIXTURE and runs each test with HOME="$FIXTURE" so the real
#   ~/fleet/identities is never touched. Because $FIXTURE/.claude/sessions/
#   does not exist, the sweep emits only identity lines (no pid lines). The
#   scratch tree is removed on EXIT by a trap.
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

# Run a test function, record pass/fail.
run_test() {
  local test_fn="$1"
  local before_fail=$FAIL
  CURRENT_TEST="$test_fn"

  # Reset the fixture for every test so tests are independent.
  rm -rf "${FIXTURE:?}"/*

  "$test_fn"

  if [ "$FAIL" -eq "$before_fail" ]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$test_fn"
  else
    printf 'FAIL  %s\n' "$test_fn"
  fi
}

# run_sweep: run the sweep with HOME=$FIXTURE; capture stdout.
# Stderr goes to a temp file so we can check it separately from stdout.
LAST_STDERR=""
run_sweep() {
  local stderr_file
  stderr_file=$(mktemp)
  LAST_STDERR=$stderr_file
  HOME="$FIXTURE" python3 "$SWEEP" 2>"$stderr_file"
}

# make_identity: create a fixture identity folder.
# Usage: make_identity <name> [md_content]
#   If md_content is omitted, no .md file is created.
make_identity() {
  local name="$1"
  local md="${2:-}"
  mkdir -p "$FIXTURE/fleet/identities/$name"
  if [ -n "$md" ]; then
    printf '%s' "$md" > "$FIXTURE/fleet/identities/$name/$name.md"
  fi
}

# make_role: create a fixture role folder.
# Usage: make_role <name> [md_content]
make_role() {
  local name="$1"
  local md="${2:-}"
  mkdir -p "$FIXTURE/fleet/roles/$name"
  if [ -n "$md" ]; then
    printf '%s' "$md" > "$FIXTURE/fleet/roles/$name/$name.md"
  fi
}

# assert_identity_field: assert that a field on a named identity's JSONL line has a given value.
# Uses python3 for structural assertion rather than fragile string greps.
# Usage: assert_identity_field <stdout_var> <identity> <field_path> <expected_json>
#   field_path: dot-separated key path e.g. "role" or "identity_cosmetics.displayName"
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

# assert_identity_has_field: assert that a field EXISTS on the identity line (not null/absent).
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

# assert_identity_no_field: assert that a field is ABSENT (null/missing) on the identity line.
assert_identity_no_field() {
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
        print('absent' if node is None else 'present')
        sys.exit(0)
print('MISSING_LINE')
" 2>/dev/null)
  if [ "$result" = "MISSING_LINE" ]; then
    fail "assert_identity_no_field($identity.$field_path): identity line missing"
  elif [ "$result" != "absent" ]; then
    fail "assert_identity_no_field($identity.$field_path): field was present but expected absent"
  fi
}

# assert_line_count: assert that the number of identity lines equals expected.
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

# ============================================================
# TEST CASES
# ============================================================

# Case 1: Full inheritance case.
# Identity with role: + displayName: + task: and NO title/colorHue;
# role with title: + colorHue:. Assert identity_cosmetics has displayName and
# task but NOT title/colorHue; role_cosmetics has title and colorHue.
# Mirrors the live t1000 shape (pixel inherits from box-maintainer).
test_case_01_full_inheritance() {
  make_identity "archie" "---
role: archivist
displayName: Archie
task: catalog things: every day
---
body text here
"
  make_role "archivist" "---
title: Archivist
colorHue: 240
---
role body
"
  local out
  out=$(run_sweep)
  assert_identity_field "$out" "archie" "role" '"archivist"'
  assert_identity_has_field "$out" "archie" "identity_cosmetics.displayName"
  assert_identity_field "$out" "archie" "identity_cosmetics.displayName" '"Archie"'
  assert_identity_has_field "$out" "archie" "identity_cosmetics.task"
  assert_identity_field "$out" "archie" "identity_cosmetics.task" '"catalog things: every day"'
  assert_identity_no_field "$out" "archie" "identity_cosmetics.title"
  assert_identity_no_field "$out" "archie" "identity_cosmetics.colorHue"
  assert_identity_has_field "$out" "archie" "role_cosmetics.title"
  assert_identity_field "$out" "archie" "role_cosmetics.title" '"Archivist"'
  assert_identity_field "$out" "archie" "role_cosmetics.colorHue" '240'
}

# Case 2: Read-once-per-role.
# Three identities sharing one role. Assert all three lines carry an identical
# role_cosmetics object. Also assert the emitted line count is exactly 3.
test_case_02_read_once_per_role() {
  local role_md="---
title: Shared Role
colorHue: 120
---
"
  make_role "sharedrole" "$role_md"
  for name in alpha beta gamma; do
    make_identity "$name" "---
role: sharedrole
---
body
"
  done
  local out
  out=$(run_sweep)
  assert_identity_line_count "$out" "3"
  # All three must have identical role_cosmetics
  local rc_alpha rc_beta rc_gamma
  rc_alpha=$(printf '%s' "$out" | python3 -c "
import sys,json
for l in sys.stdin.read().splitlines():
    o=json.loads(l)
    if o.get('identity')=='alpha': print(json.dumps(o.get('role_cosmetics'),sort_keys=True))
" 2>/dev/null)
  rc_beta=$(printf '%s' "$out" | python3 -c "
import sys,json
for l in sys.stdin.read().splitlines():
    o=json.loads(l)
    if o.get('identity')=='beta': print(json.dumps(o.get('role_cosmetics'),sort_keys=True))
" 2>/dev/null)
  rc_gamma=$(printf '%s' "$out" | python3 -c "
import sys,json
for l in sys.stdin.read().splitlines():
    o=json.loads(l)
    if o.get('identity')=='gamma': print(json.dumps(o.get('role_cosmetics'),sort_keys=True))
" 2>/dev/null)
  assert_eq "$rc_alpha" "$rc_beta" "case 02: alpha and beta role_cosmetics must be identical"
  assert_eq "$rc_beta" "$rc_gamma" "case 02: beta and gamma role_cosmetics must be identical"
}

# Case 3: No frontmatter at all.
# Identity file with body text but no --- fences. Assert identity_cosmetics is
# null, role is null, role_cosmetics is null, and the line IS still present.
test_case_03_no_frontmatter() {
  make_identity "nofm" "this is just plain text with no YAML fences at all
second line
"
  local out
  out=$(run_sweep)
  assert_identity_line_count "$out" "1"
  assert_identity_field "$out" "nofm" "identity_cosmetics" 'null'
  assert_identity_field "$out" "nofm" "role" 'null'
  assert_identity_field "$out" "nofm" "role_cosmetics" 'null'
}

# Case 4: Missing identity file.
# Identity folder exists with no <key>.md. Assert the line is present with null cosmetics.
test_case_04_missing_identity_file() {
  # make_identity with no md content creates the folder but not the .md
  make_identity "nomdfolder"
  local out
  out=$(run_sweep)
  assert_identity_line_count "$out" "1"
  assert_identity_field "$out" "nomdfolder" "identity_cosmetics" 'null'
  assert_identity_field "$out" "nomdfolder" "role" 'null'
  assert_identity_field "$out" "nomdfolder" "role_cosmetics" 'null'
}

# Case 5: Path-traversal role.
# Identity with role: ../../tmp. Assert role is null and role_cosmetics is null.
test_case_05_path_traversal_role() {
  make_identity "traversal" "---
role: ../../tmp
displayName: Traversal
---
body
"
  local out
  out=$(run_sweep)
  assert_identity_field "$out" "traversal" "role" 'null'
  assert_identity_field "$out" "traversal" "role_cosmetics" 'null'
  # identity_cosmetics should still have displayName (appearance is independent of role)
  assert_identity_field "$out" "traversal" "identity_cosmetics.displayName" '"Traversal"'
}

# Case 6: Sentinels.
# One identity with .pinned present and .hidden absent,
# one with both present, one with neither.
test_case_06_sentinels() {
  make_identity "pinnedonly" "---\n---\n"
  touch "$FIXTURE/fleet/identities/pinnedonly/.pinned"

  make_identity "bothflags" "---\n---\n"
  touch "$FIXTURE/fleet/identities/bothflags/.pinned"
  touch "$FIXTURE/fleet/identities/bothflags/.hidden"

  make_identity "noflags" "---\n---\n"

  local out
  out=$(run_sweep)
  assert_identity_field "$out" "pinnedonly" "pinned" 'true'
  assert_identity_field "$out" "pinnedonly" "hidden" 'false'
  assert_identity_field "$out" "bothflags" "pinned" 'true'
  assert_identity_field "$out" "bothflags" "hidden" 'true'
  assert_identity_field "$out" "noflags" "pinned" 'false'
  assert_identity_field "$out" "noflags" "hidden" 'false'
}

# Case 7: colorHue out of range.
# Role with colorHue: 400. Assert colorHue is absent from role_cosmetics.
test_case_07_colorhue_out_of_range() {
  make_identity "badhue" "---
role: badrole
---
body
"
  make_role "badrole" "---
title: Bad Hue Role
colorHue: 400
---
body
"
  local out
  out=$(run_sweep)
  assert_identity_no_field "$out" "badhue" "role_cosmetics.colorHue"
  # title should still be present (only colorHue was invalid)
  assert_identity_field "$out" "badhue" "role_cosmetics.title" '"Bad Hue Role"'
}

# Case 8: Quoted and commented values.
# Identity with title: "Quoted Title"   # trailing comment and a # full-line
# comment inside the fence. Assert title is exactly Quoted Title.
test_case_08_quoted_and_commented() {
  make_identity "quotey" '---
# This is a full-line comment inside the fence
title: "Quoted Title"   # trailing comment
displayName: Quotey
---
body
'
  local out
  out=$(run_sweep)
  assert_identity_field "$out" "quotey" "identity_cosmetics.title" '"Quoted Title"'
  assert_identity_field "$out" "quotey" "identity_cosmetics.displayName" '"Quotey"'
}

# Case 9: Bounded read.
# Identity file whose opening --- fence is followed by 6000 characters of body
# before the closing fence. Assert identity_cosmetics is null (cap reached ->
# treated as no frontmatter -> plain row) and the line is still emitted.
test_case_09_bounded_read() {
  # Build a file: "---\n" + 6000 chars of 'x' + "\n---\n"
  # The closing fence is beyond FRONTMATTER_HEAD_BYTES (4096 chars), so the
  # capped read finds only one fence -> returns (None, None).
  mkdir -p "$FIXTURE/fleet/identities/bigfm"
  python3 -c "
content = '---\n' + 'x' * 6000 + '\n---\ntitle: ShouldNotAppear\n'
open('$FIXTURE/fleet/identities/bigfm/bigfm.md', 'w').write(content)
"

  local out
  out=$(run_sweep)
  assert_identity_line_count "$out" "1"
  assert_identity_field "$out" "bigfm" "identity_cosmetics" 'null'
}

# Case 10: stdout purity.
# Assert every non-empty stdout line parses as JSON and carries schema_version == 1.
test_case_10_stdout_purity() {
  make_identity "purity" "---
role: purerole
displayName: Purity
---
body
"
  make_role "purerole" "---
title: Pure Role
---
body
"
  local out
  out=$(run_sweep)
  local result
  result=$(printf '%s' "$out" | python3 -c "
import sys, json
lines = [l for l in sys.stdin.read().splitlines() if l.strip()]
bad_json = []
bad_version = []
for l in lines:
    try:
        obj = json.loads(l)
    except json.JSONDecodeError as e:
        bad_json.append(l[:80])
        continue
    if obj.get('schema_version') != 1:
        bad_version.append(l[:80])
if bad_json:
    print('BAD_JSON:' + str(bad_json))
elif bad_version:
    print('BAD_VERSION:' + str(bad_version))
else:
    print('ok')
" 2>/dev/null)
  assert_eq "ok" "$result" "case 10: stdout must contain only valid JSON with schema_version==1"
}

# Global stderr/stdout purity check:
# Run the sweep with stderr redirected to a file; assert the file is allowed
# to be non-empty while every stdout line still parses as JSON.
test_global_stderr_stdout_separation() {
  make_identity "sep" "---
title: Sep
---
body
"
  local stderr_file
  stderr_file=$(mktemp)
  local out
  out=$(HOME="$FIXTURE" python3 "$SWEEP" 2>"$stderr_file")
  local result
  result=$(printf '%s' "$out" | python3 -c "
import sys, json
lines = [l for l in sys.stdin.read().splitlines() if l.strip()]
for l in lines:
    try:
        json.loads(l)
    except:
        print('INVALID_JSON')
        sys.exit(0)
print('ok')
" 2>/dev/null)
  assert_eq "ok" "$result" "global: every stdout line must parse as JSON even when stderr has content"
  rm -f "$stderr_file"
}

# ============================================================
# MAIN
# ============================================================
printf '=== fleet-status-sweep-appearance test driver ===\n'
printf 'sweep: %s\n' "$SWEEP"
printf 'fixture: %s\n' "$FIXTURE"
printf '\n'

run_test test_case_01_full_inheritance
run_test test_case_02_read_once_per_role
run_test test_case_03_no_frontmatter
run_test test_case_04_missing_identity_file
run_test test_case_05_path_traversal_role
run_test test_case_06_sentinels
run_test test_case_07_colorhue_out_of_range
run_test test_case_08_quoted_and_commented
run_test test_case_09_bounded_read
run_test test_case_10_stdout_purity
run_test test_global_stderr_stdout_separation

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
