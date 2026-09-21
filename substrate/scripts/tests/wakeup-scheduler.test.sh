#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for Phase 126 Plan 02: wakeup-scheduler.py --mode global extension.
#
# Covers:
#   T-G1 — global-mode spec discovery reads nested slug-folder layout
#   T-G2 — global-mode ignores flat *.json specs (wrong layout)
#   T-G3 — per-identity mode unchanged — regression guard for D-07
#   T-G4 — orphan-check disabled in global mode; active in per-identity mode
#   T-G5 — one-shot spec self-deletes in global mode + sentinel written
#
# Exits 0 on all-pass; exits 1 on any failure with a diagnostic naming the
# failing test.
#
# Usage: bash substrate/scripts/tests/wakeup-scheduler.test.sh
#   Run from the repo root.
#
# Hermetic environment contract:
#   Each test creates a synthetic HOME_DIR via mktemp and passes
#   HOME="$HOME_DIR" to python invocations. The scheduler's
#   _drop_spawn_request uses os.path.expanduser("~"), so overriding HOME
#   redirects spawn-request drops to the test's controlled dir. No test
#   reads from or writes to the real ~/fleet/ tree.
#
# Requirements: bash, python3.

set -u  # -e intentionally NOT set — explicit assert helpers handle failures
        # without aborting subsequent tests.

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PY_SCRIPT="$REPO_ROOT/substrate/scripts/wakeup-scheduler.py"

if [ ! -f "$PY_SCRIPT" ]; then
  printf 'FATAL: wakeup-scheduler.py not found at %s\n' "$PY_SCRIPT" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  printf 'FATAL: python3 not found — required for this test driver\n' >&2
  exit 1
fi

# ---- test state ----
PASS=0
FAIL=0
FAILURES=()

# ---- tmpdir registry for cleanup ----
# All mktemp dirs are registered here; cleanup removes them all on EXIT.
declare -a ALL_TMPDIRS=()

cleanup() {
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

# make_workdir: create a named work directory inside a fresh mktemp -d scratch.
# Used by tests that want a labelled sub-structure rather than a bare tmpdir.
make_workdir() {
  local label="$1"
  local base
  base=$(mktemp -d)
  ALL_TMPDIRS+=("$base")
  mkdir -p "$base/$label"
  printf '%s/%s' "$base" "$label"
}

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

assert_file_exists() {
  local path="$1" msg="${2:-assert_file_exists}"
  if [ ! -f "$path" ]; then
    fail "$msg: file not found: $path"
  fi
}

assert_file_absent() {
  local path="$1" msg="${2:-assert_file_absent}"
  if [ -f "$path" ]; then
    fail "$msg: file should not exist but does: $path"
  fi
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

# count_json_files <dir>: count *.json files in a directory (non-recursive).
count_json_files() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    printf '0'
    return
  fi
  local cnt
  cnt=$(find "$dir" -maxdepth 1 -name "*.json" | wc -l)
  printf '%s' "$cnt"
}

# json_field <file> <field>: extract a JSON field value via python3.
json_field() {
  local file="$1" field="$2"
  python3 -c "import json,sys; d=json.load(open('$file')); print(json.dumps(d.get('$field')))" 2>/dev/null || printf 'ERROR'
}

# ============================================================
# T-G1: global-mode spec discovery reads nested slug-folder layout
# ============================================================
test_T_G1_global_spec_discovery() {
  local wakeups_dir home_dir out_log err_log

  # Synthetic ~/fleet/wakeups root
  wakeups_dir=$(make_tmpdir)
  # Synthetic HOME so spawn-requests land somewhere we control
  home_dir=$(make_tmpdir)

  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  # Create a nested slug-folder spec (the correct global layout)
  mkdir -p "$wakeups_dir/test-slug"
  cat > "$wakeups_dir/test-slug/wakeup.json" <<'JSON'
{
  "name": "t1",
  "enabled": true,
  "schedule": {"type": "interval", "every": "1s"},
  "prompt": "hello",
  "roles": ["coordinator"],
  "skills": []
}
JSON

  # Create a flat spec at the root (wrong shape — should be ignored)
  cat > "$wakeups_dir/should-be-ignored.json" <<'JSON'
{
  "name": "flat",
  "enabled": true,
  "schedule": {"type": "interval", "every": "1s"},
  "instruction": "ignored",
  "roles": ["coordinator"]
}
JSON

  # Run in global mode for ~3 seconds (daemon exits via timeout; || true swallows exit 124).
  # WAKEUP_POLL_SEC=1 so the loop runs multiple times: first iteration anchors,
  # second fires (interval is "1s", so 1s after anchor the spec is due).
  HOME="$home_dir" WAKEUP_POLL_SEC=1 timeout 5 python3 "$PY_SCRIPT" "$wakeups_dir" --mode global \
    >"$out_log" 2>"$err_log" || true

  # Assert at least one spawn-request was dropped under the overridden HOME
  local req_dir="$home_dir/fleet/spawn-requests"
  local req_count
  req_count=$(count_json_files "$req_dir")
  if [ "$req_count" -lt 1 ]; then
    fail "T-G1: expected at least 1 spawn-request file, got $req_count (dir: $req_dir)"
    return
  fi

  # Find the first request file and validate its JSON body
  local req_file
  req_file=$(find "$req_dir" -maxdepth 1 -name "*.json" | head -1)
  if [ -z "$req_file" ]; then
    fail "T-G1: no .json file found in $req_dir"
    return
  fi

  # Validate JSON fields using python3
  local check_result
  check_result=$(python3 -c "
import json, sys
d = json.load(open('$req_file'))
errors = []
if d.get('roles') != ['coordinator']:
    errors.append('roles: expected=[\"coordinator\"] got=' + repr(d.get('roles')))
if d.get('prompt') != 'hello':
    errors.append('prompt: expected=hello got=' + repr(d.get('prompt')))
if d.get('skills') != []:
    errors.append('skills: expected=[] got=' + repr(d.get('skills')))
if d.get('task') is not None:
    errors.append('task: expected=null got=' + repr(d.get('task')))
if not isinstance(d.get('requested_at'), str) or not d['requested_at'].endswith('Z'):
    errors.append('requested_at: expected ISO-Z string got=' + repr(d.get('requested_at')))
if errors:
    print('FAIL: ' + '; '.join(errors))
else:
    print('OK')
" 2>&1)
  if [ "$check_result" != "OK" ]; then
    fail "T-G1: spawn-request JSON invalid: $check_result"
  fi

  # Assert no ⏰ lines in stdout (global mode does not emit to harness)
  if grep -q "⏰" "$out_log" 2>/dev/null; then
    fail "T-G1: global mode should NOT print ⏰ lines to stdout"
  fi
}

# ============================================================
# T-G2: global-mode ignores flat *.json specs at the root level
# ============================================================
test_T_G2_global_ignores_flat_specs() {
  local wakeups_dir home_dir out_log err_log

  wakeups_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  # Only flat legacy specs at root — no nested slug-folder specs.
  # In per-identity mode these would fire; in global mode they are invisible.
  cat > "$wakeups_dir/legacy-flat.json" <<'JSON'
{
  "name": "flat-legacy",
  "enabled": true,
  "schedule": {"type": "interval", "every": "1s"},
  "instruction": "should not fire in global mode",
  "roles": ["coordinator"]
}
JSON

  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$wakeups_dir" --mode global \
    >"$out_log" 2>"$err_log" || true

  # No spawn-requests should have been dropped
  local req_dir="$home_dir/fleet/spawn-requests"
  local req_count
  req_count=$(count_json_files "$req_dir")
  if [ "$req_count" -ne 0 ]; then
    fail "T-G2: global mode should not fire flat-root specs; got $req_count spawn-request(s)"
  fi
}

# ============================================================
# T-G3: per-identity mode unchanged (regression guard for D-07)
# ============================================================
test_T_G3_per_identity_mode_unchanged() {
  local ident_dir home_dir out_log err_log

  ident_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  # Build per-identity wakeups dir with a flat legacy-format spec
  mkdir -p "$ident_dir/wakeups"
  cat > "$ident_dir/wakeups/legacy.json" <<'JSON'
{
  "name": "legacy",
  "enabled": true,
  "schedule": {"type": "interval", "every": "1h"},
  "instruction": "Check the Kanban"
}
JSON

  # Run in per-identity mode (no --mode flag) for ~3 seconds.
  # This is the first-sight run, so the scheduler should ANCHOR (not fire).
  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$ident_dir" \
    >"$out_log" 2>"$err_log" || true

  # Per-identity mode: no spawn-request files should be created
  local req_dir="$home_dir/fleet/spawn-requests"
  local req_count
  req_count=$(count_json_files "$req_dir")
  if [ "$req_count" -ne 0 ]; then
    fail "T-G3: per-identity mode should not drop spawn-request files; got $req_count"
  fi

  # Per-identity mode: should have created a .last file (first-sight anchor)
  local last_file="$ident_dir/wakeups/.state/legacy.last"
  assert_file_exists "$last_file" "T-G3: .last anchor file should exist after first-sight"

  # No ⏰ lines should appear because the interval is 1h and this is first sight
  if grep -q "⏰" "$out_log" 2>/dev/null; then
    fail "T-G3: first-sight run should not emit ⏰ lines (anchor, don't fire)"
  fi
}

# ============================================================
# T-G4: orphan-check disabled in global mode; present in per-identity mode
# ============================================================
test_T_G4_orphan_check_mode_isolation() {
  local wakeups_dir home_dir ident_dir out_log err_log

  wakeups_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  # Run in global mode — stderr must contain the disabled diagnostic
  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$wakeups_dir" --mode global \
    >"$out_log" 2>"$err_log" || true

  if ! grep -q "orphan-check disabled (no harness)" "$err_log"; then
    fail "T-G4: global mode stderr must contain 'orphan-check disabled (no harness)'"
  fi

  # Run in per-identity mode — stderr must NOT contain the global diagnostic
  ident_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$ident_dir" \
    >"$out_log" 2>"$err_log" || true

  if grep -q "orphan-check disabled (no harness)" "$err_log"; then
    fail "T-G4: per-identity mode stderr must NOT contain 'orphan-check disabled (no harness)'"
  fi
}

# ============================================================
# T-G5: one-shot spec self-deletes in global mode, sentinel written, spawn-request dropped
# ============================================================
test_T_G5_one_shot_global_mode() {
  local wakeups_dir home_dir out_log err_log

  wakeups_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  # Create a global one_shot spec with a past `at` date so it fires immediately
  mkdir -p "$wakeups_dir/one-shot"
  cat > "$wakeups_dir/one-shot/wakeup.json" <<'JSON'
{
  "name": "one-shot",
  "enabled": true,
  "schedule": {"type": "one_shot", "at": "2020-01-01T00:00:00Z"},
  "prompt": "one-shot fire",
  "roles": ["coordinator"],
  "skills": []
}
JSON

  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$wakeups_dir" --mode global \
    >"$out_log" 2>"$err_log" || true

  # Assert wakeup.json was deleted (one-shot self-delete)
  assert_file_absent "$wakeups_dir/one-shot/wakeup.json" \
    "T-G5: one-shot spec wakeup.json should have been deleted after firing"

  # Assert .fired sentinel was written
  assert_file_exists "$wakeups_dir/.state/one-shot.fired" \
    "T-G5: .fired sentinel should exist after one-shot fires"

  # Assert a spawn-request was dropped
  local req_dir="$home_dir/fleet/spawn-requests"
  local req_count
  req_count=$(count_json_files "$req_dir")
  if [ "$req_count" -lt 1 ]; then
    fail "T-G5: expected at least 1 spawn-request file after one-shot fire, got $req_count"
    return
  fi

  # Validate the spawn-request body
  local req_file
  req_file=$(find "$req_dir" -maxdepth 1 -name "*.json" | head -1)
  local check_result
  check_result=$(python3 -c "
import json, sys
d = json.load(open('$req_file'))
errors = []
if d.get('roles') != ['coordinator']:
    errors.append('roles: expected=[\"coordinator\"] got=' + repr(d.get('roles')))
if d.get('prompt') != 'one-shot fire':
    errors.append('prompt: expected=\"one-shot fire\" got=' + repr(d.get('prompt')))
if d.get('task') is not None:
    errors.append('task: expected=null got=' + repr(d.get('task')))
if errors:
    print('FAIL: ' + '; '.join(errors))
else:
    print('OK')
" 2>&1)
  if [ "$check_result" != "OK" ]; then
    fail "T-G5: spawn-request JSON invalid: $check_result"
  fi
}

# ============================================================
# MAIN
# ============================================================
printf '=== wakeup-scheduler.py global-mode test driver ===\n'
printf 'script: %s\n' "$PY_SCRIPT"
printf '\n'

run_test test_T_G1_global_spec_discovery
run_test test_T_G2_global_ignores_flat_specs
run_test test_T_G3_per_identity_mode_unchanged
run_test test_T_G4_orphan_check_mode_isolation
run_test test_T_G5_one_shot_global_mode

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
