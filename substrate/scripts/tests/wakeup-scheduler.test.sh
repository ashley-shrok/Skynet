#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for Phase 126 Plan 02: wakeup-scheduler.py --mode scheduled-agents extension.
#
# Covers:
#   T-G1 — scheduled-agents-mode spec discovery reads nested slug-folder layout
#   T-G2 — scheduled-agents-mode ignores flat *.json specs (wrong layout)
#   T-G3 — per-identity mode unchanged — regression guard for D-07
#   T-G4 — orphan-check disabled in scheduled-agents mode; active in per-identity mode
#   T-G5 — one-shot spec self-deletes in scheduled-agents mode + sentinel written
#   T-G9 — malformed schedules refused loudly, never anchored
#   T-G10 — `count` stops firing in the real process
#   T-G11 — schedule engine suite (test_schedule_engine.py)
#   T-G12 — scheduled-agents state keyed by slug, name-keyed state migrated
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
# SA-G1: scheduled-agents-mode spec discovery reads nested slug-folder layout
# ============================================================
test_SA_G1_scheduled_agents_spec_discovery() {
  local scheduled_agents_dir home_dir out_log err_log

  # Synthetic ~/fleet/scheduled-agents root
  scheduled_agents_dir=$(make_tmpdir)
  # Synthetic HOME so spawn-requests land somewhere we control
  home_dir=$(make_tmpdir)

  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  # Create a nested slug-folder spec (the correct scheduled-agents layout)
  mkdir -p "$scheduled_agents_dir/test-slug"
  cat > "$scheduled_agents_dir/test-slug/scheduled-agent.json" <<'JSON'
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
  cat > "$scheduled_agents_dir/should-be-ignored.json" <<'JSON'
{
  "name": "flat",
  "enabled": true,
  "schedule": {"type": "interval", "every": "1s"},
  "instruction": "ignored",
  "roles": ["coordinator"]
}
JSON

  # Run in scheduled-agents mode for ~3 seconds (daemon exits via timeout; || true swallows exit 124).
  # WAKEUP_POLL_SEC=1 so the loop runs multiple times: first iteration anchors,
  # second fires (interval is "1s", so 1s after anchor the spec is due).
  HOME="$home_dir" WAKEUP_POLL_SEC=1 timeout 5 python3 "$PY_SCRIPT" "$scheduled_agents_dir" --mode scheduled-agents \
    >"$out_log" 2>"$err_log" || true

  # Assert at least one spawn-request was dropped under the overridden HOME
  local req_dir="$home_dir/fleet/spawn-requests"
  local req_count
  req_count=$(count_json_files "$req_dir")
  if [ "$req_count" -lt 1 ]; then
    fail "SA-G1: expected at least 1 spawn-request file, got $req_count (dir: $req_dir)"
    return
  fi

  # Find the first request file and validate its JSON body
  local req_file
  req_file=$(find "$req_dir" -maxdepth 1 -name "*.json" | head -1)
  if [ -z "$req_file" ]; then
    fail "SA-G1: no .json file found in $req_dir"
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
p = d.get('prompt', '')
if not isinstance(p, str):
    errors.append('prompt: expected str got=' + repr(type(p)))
elif 'pre-authorized' not in p:
    errors.append('prompt: missing pre-authorization framing; got=' + repr(p[:200]))
elif 'You are the agent that was spawned' not in p:
    errors.append('prompt: missing spawned-agent addressing; got=' + repr(p[:200]))
elif 'test-slug' not in p:
    errors.append('prompt: missing slug reference; got=' + repr(p[:200]))
elif '> hello' not in p:
    errors.append('prompt: original prompt not blockquoted verbatim; got=' + repr(p[:400]))
if 'skills' in d:
    errors.append('skills: expected absent (field removed) got=' + repr(d.get('skills')))
if d.get('task') != '⏰ T1':
    errors.append('task: expected=\"⏰ T1\" (clock-prefixed, de-slugged spec name) got=' + repr(d.get('task')))
if not isinstance(d.get('requested_at'), str) or not d['requested_at'].endswith('Z'):
    errors.append('requested_at: expected ISO-Z string got=' + repr(d.get('requested_at')))
if errors:
    print('FAIL: ' + '; '.join(errors))
else:
    print('OK')
" 2>&1)
  if [ "$check_result" != "OK" ]; then
    fail "SA-G1: spawn-request JSON invalid: $check_result"
  fi

  # Assert no ⏰ lines in stdout (scheduled-agents mode does not emit to harness)
  if grep -q "⏰" "$out_log" 2>/dev/null; then
    fail "SA-G1: scheduled-agents mode should NOT print ⏰ lines to stdout"
  fi
}

# ============================================================
# SA-G2: scheduled-agents-mode ignores flat *.json specs at the root level
# ============================================================
test_SA_G2_scheduled_agents_ignores_flat_specs() {
  local scheduled_agents_dir home_dir out_log err_log

  scheduled_agents_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  # Only flat legacy specs at root — no nested slug-folder specs.
  # In per-identity mode these would fire; in scheduled-agents mode they are invisible.
  cat > "$scheduled_agents_dir/legacy-flat.json" <<'JSON'
{
  "name": "flat-legacy",
  "enabled": true,
  "schedule": {"type": "interval", "every": "1s"},
  "instruction": "should not fire in scheduled-agents mode",
  "roles": ["coordinator"]
}
JSON

  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$scheduled_agents_dir" --mode scheduled-agents \
    >"$out_log" 2>"$err_log" || true

  # No spawn-requests should have been dropped
  local req_dir="$home_dir/fleet/spawn-requests"
  local req_count
  req_count=$(count_json_files "$req_dir")
  if [ "$req_count" -ne 0 ]; then
    fail "SA-G2: scheduled-agents mode should not fire flat-root specs; got $req_count spawn-request(s)"
  fi
}

# ============================================================
# SA-G3: per-identity mode unchanged (regression guard for D-07)
# ============================================================
test_SA_G3_per_identity_mode_unchanged() {
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
    fail "SA-G3: per-identity mode should not drop spawn-request files; got $req_count"
  fi

  # Per-identity mode: first-sight should write .anchored (NOT .last — the
  # sentinel split 2026-10-05 reserves .last for actual fires so the Skynet
  # scheduled-agents modal can show honest "Last run" times).
  local anchored_file="$ident_dir/wakeups/.state/legacy.anchored"
  assert_file_exists "$anchored_file" "SA-G3: .anchored sentinel should exist after first-sight"
  local last_file="$ident_dir/wakeups/.state/legacy.last"
  if [ -f "$last_file" ]; then
    fail "SA-G3: .last must NOT be written on first-sight anchor (reserved for real fires)"
  fi

  # No ⏰ lines should appear because the interval is 1h and this is first sight
  if grep -q "⏰" "$out_log" 2>/dev/null; then
    fail "SA-G3: first-sight run should not emit ⏰ lines (anchor, don't fire)"
  fi
}

# ============================================================
# SA-G4: orphan-check disabled in scheduled-agents mode; present in per-identity mode
# ============================================================
test_SA_G4_orphan_check_mode_isolation() {
  local scheduled_agents_dir home_dir ident_dir out_log err_log

  scheduled_agents_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  # Run in scheduled-agents mode — stderr must contain the disabled diagnostic
  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$scheduled_agents_dir" --mode scheduled-agents \
    >"$out_log" 2>"$err_log" || true

  if ! grep -q "orphan-check disabled (no harness)" "$err_log"; then
    fail "SA-G4: scheduled-agents mode stderr must contain 'orphan-check disabled (no harness)'"
  fi

  # Run in per-identity mode — stderr must NOT contain the scheduled-agents diagnostic
  ident_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$ident_dir" \
    >"$out_log" 2>"$err_log" || true

  if grep -q "orphan-check disabled (no harness)" "$err_log"; then
    fail "SA-G4: per-identity mode stderr must NOT contain 'orphan-check disabled (no harness)'"
  fi
}

# ============================================================
# SA-G5: one-shot spec self-deletes in scheduled-agents mode, sentinel written, spawn-request dropped
# ============================================================
test_SA_G5_one_shot_scheduled_agents_mode() {
  local scheduled_agents_dir home_dir out_log err_log

  scheduled_agents_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  # Create a scheduled-agents one_shot spec with a past `at` date so it fires immediately
  mkdir -p "$scheduled_agents_dir/one-shot"
  cat > "$scheduled_agents_dir/one-shot/scheduled-agent.json" <<'JSON'
{
  "name": "one-shot",
  "enabled": true,
  "schedule": {"type": "one_shot", "at": "2020-01-01T00:00:00Z"},
  "prompt": "one-shot fire",
  "roles": ["coordinator"],
  "skills": []
}
JSON

  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$scheduled_agents_dir" --mode scheduled-agents \
    >"$out_log" 2>"$err_log" || true

  # Assert scheduled-agent.json was deleted (one-shot self-delete)
  assert_file_absent "$scheduled_agents_dir/one-shot/scheduled-agent.json" \
    "SA-G5: one-shot spec scheduled-agent.json should have been deleted after firing"

  # Assert .fired sentinel was written
  assert_file_exists "$scheduled_agents_dir/.state/one-shot.fired" \
    "SA-G5: .fired sentinel should exist after one-shot fires"

  # Assert a spawn-request was dropped
  local req_dir="$home_dir/fleet/spawn-requests"
  local req_count
  req_count=$(count_json_files "$req_dir")
  if [ "$req_count" -lt 1 ]; then
    fail "SA-G5: expected at least 1 spawn-request file after one-shot fire, got $req_count"
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
p = d.get('prompt', '')
if not isinstance(p, str):
    errors.append('prompt: expected str got=' + repr(type(p)))
elif 'pre-authorized' not in p:
    errors.append('prompt: missing pre-authorization framing; got=' + repr(p[:200]))
elif 'You are the agent that was spawned' not in p:
    errors.append('prompt: missing spawned-agent addressing; got=' + repr(p[:200]))
elif 'one-shot' not in p:
    errors.append('prompt: missing slug reference; got=' + repr(p[:200]))
elif '> one-shot fire' not in p:
    errors.append('prompt: original prompt not blockquoted verbatim; got=' + repr(p[:400]))
if d.get('task') != '⏰ One shot':
    errors.append('task: expected=\"⏰ One shot\" (clock-prefixed, de-slugged spec name) got=' + repr(d.get('task')))
if errors:
    print('FAIL: ' + '; '.join(errors))
else:
    print('OK')
" 2>&1)
  if [ "$check_result" != "OK" ]; then
    fail "SA-G5: spawn-request JSON invalid: $check_result"
  fi
}

# ============================================================
# SA-G6: _prettify_name de-slugs the ⏰ task-prefix on spawn-requests
# ============================================================
# Direct unit test on the helper via `python3 -c` import, plus an end-to-end
# check that a slug-shape `name` on disk renders prettified in the
# spawn-request `task` field. Byte-parallels prettifyScheduledAgentName in
# src/ui/features/pretty-conversations/ScheduledAgentsModalRow.tsx — if either
# helper drifts, modal row and ⏰ prefix stop matching.
test_SA_G6_prettify_name_de_slugs_task_prefix() {
  # Direct unit test — import _prettify_name and assert transformation cases.
  local unit_result
  unit_result=$(python3 -c "
import importlib.util, sys
spec = importlib.util.spec_from_file_location('ws', '$PY_SCRIPT')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cases = [
    ('daily-box-check', 'Daily box check'),
    ('workstation_logind_flush', 'Workstation logind flush'),
    ('Already Pretty', 'Already Pretty'),
    ('mixed-hyphen_underscore', 'Mixed hyphen underscore'),
    ('', ''),
    ('a', 'A'),
]
errors = []
for inp, want in cases:
    got = m._prettify_name(inp)
    if got != want:
        errors.append('%r → %r (wanted %r)' % (inp, got, want))
print('FAIL: ' + '; '.join(errors) if errors else 'OK')
" 2>&1)
  if [ "$unit_result" != "OK" ]; then
    fail "SA-G6 unit: _prettify_name mismatches: $unit_result"
    return
  fi

  # End-to-end — slug-shape spec on disk → prettified task on spawn-request.
  local scheduled_agents_dir home_dir out_log err_log
  scheduled_agents_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  mkdir -p "$scheduled_agents_dir/daily-box-check"
  cat > "$scheduled_agents_dir/daily-box-check/scheduled-agent.json" <<'JSON'
{
  "name": "daily-box-check",
  "enabled": true,
  "schedule": {"type": "one_shot", "at": "2020-01-01T00:00:00Z"},
  "prompt": "fire",
  "roles": ["coordinator"],
  "skills": []
}
JSON

  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$scheduled_agents_dir" --mode scheduled-agents \
    >"$out_log" 2>"$err_log" || true

  local req_dir="$home_dir/fleet/spawn-requests"
  local req_file
  req_file=$(find "$req_dir" -maxdepth 1 -name "*.json" | head -1)
  if [ -z "$req_file" ]; then
    fail "SA-G6: expected spawn-request file in $req_dir"
    return
  fi

  local check_result
  check_result=$(python3 -c "
import json
d = json.load(open('$req_file'))
want = '⏰ Daily box check'
got = d.get('task')
print('OK' if got == want else 'FAIL: task got=%r want=%r' % (got, want))
" 2>&1)
  if [ "$check_result" != "OK" ]; then
    fail "SA-G6 e2e: $check_result"
  fi
}

# ============================================================
# SA-G7: scheduled-agents-mode propagates spec's users:[…] onto the spawn-request body
# ============================================================
test_SA_G7_users_propagation() {
  local scheduled_agents_dir home_dir out_log err_log
  scheduled_agents_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  mkdir -p "$scheduled_agents_dir/users-slug"
  cat > "$scheduled_agents_dir/users-slug/scheduled-agent.json" <<'JSON'
{
  "name": "zoey mail",
  "enabled": true,
  "schedule": {"type": "interval", "every": "1s"},
  "prompt": "triage inbox",
  "roles": ["news-watcher"],
  "skills": [],
  "users": ["zoey"]
}
JSON

  HOME="$home_dir" WAKEUP_POLL_SEC=1 timeout 5 python3 "$PY_SCRIPT" "$scheduled_agents_dir" --mode scheduled-agents \
    >"$out_log" 2>"$err_log" || true

  local req_dir="$home_dir/fleet/spawn-requests"
  local req_file
  req_file=$(find "$req_dir" -maxdepth 1 -name "*.json" | head -1)
  if [ -z "$req_file" ]; then
    fail "SA-G7: expected spawn-request file in $req_dir"
    return
  fi

  local check_result
  check_result=$(python3 -c "
import json
d = json.load(open('$req_file'))
got = d.get('users')
print('OK' if got == ['zoey'] else 'FAIL: users got=%r want=[\"zoey\"]' % got)
" 2>&1)
  if [ "$check_result" != "OK" ]; then
    fail "SA-G7: $check_result"
  fi
}

# ============================================================
# SA-G8: scheduled-agents-mode omits users key when spec has no users
# ============================================================
test_SA_G8_users_absent_absent_in_body() {
  local scheduled_agents_dir home_dir out_log err_log
  scheduled_agents_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  err_log=$(make_tmpdir)/err.log

  mkdir -p "$scheduled_agents_dir/nousers-slug"
  cat > "$scheduled_agents_dir/nousers-slug/scheduled-agent.json" <<'JSON'
{
  "name": "generic",
  "enabled": true,
  "schedule": {"type": "interval", "every": "1s"},
  "prompt": "do a thing",
  "roles": ["coordinator"],
  "skills": []
}
JSON

  HOME="$home_dir" WAKEUP_POLL_SEC=1 timeout 5 python3 "$PY_SCRIPT" "$scheduled_agents_dir" --mode scheduled-agents \
    >"$out_log" 2>"$err_log" || true

  local req_dir="$home_dir/fleet/spawn-requests"
  local req_file
  req_file=$(find "$req_dir" -maxdepth 1 -name "*.json" | head -1)
  if [ -z "$req_file" ]; then
    fail "SA-G8: expected spawn-request file in $req_dir"
    return
  fi

  local check_result
  check_result=$(python3 -c "
import json
d = json.load(open('$req_file'))
print('OK' if 'users' not in d else 'FAIL: users key present when spec has no users; got=%r' % d.get('users'))
" 2>&1)
  if [ "$check_result" != "OK" ]; then
    fail "SA-G8: $check_result"
  fi
}

# ============================================================
# MAIN
# ============================================================
# SA-G9: malformed schedules are refused LOUDLY and never anchor. The engine's
# own logic is covered exhaustively by test_schedule_engine.py; this checks the
# real process wiring.
test_SA_G9_malformed_schedules_refused() {
  local ident_dir home_dir out_log
  ident_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  mkdir -p "$ident_dir/wakeups"
  cat > "$ident_dir/wakeups/bad-yearly.json" <<'JSON'
{"name": "bad-yearly", "enabled": true,
 "schedule": {"type": "yearly", "date": "02-29", "at": "09:00"},
 "instruction": "never"}
JSON
  cat > "$ident_dir/wakeups/bad-months.json" <<'JSON'
{"name": "bad-months", "enabled": true,
 "schedule": {"type": "interval", "every": "0mo"},
 "instruction": "never"}
JSON
  cat > "$ident_dir/wakeups/bad-monthly.json" <<'JSON'
{"name": "bad-monthly", "enabled": true,
 "schedule": {"type": "monthly", "day": 1, "at": "09:00", "every": 3},
 "instruction": "never"}
JSON
  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true
  grep -q "bad-yearly.*02-29 is not supported.*DOES NOT FIRE" "$out_log" \
    || fail "SA-G9: expected loud 02-29 alert, got: $(cat "$out_log")"
  grep -q "bad-months.*every.*DOES NOT FIRE" "$out_log" \
    || fail "SA-G9: expected loud months alert, got: $(cat "$out_log")"
  grep -q "bad-monthly.*needs a .start.*DOES NOT FIRE" "$out_log" \
    || fail "SA-G9: expected loud every-needs-start alert, got: $(cat "$out_log")"
  local k
  for k in bad-yearly bad-months bad-monthly; do
    assert_file_absent "$ident_dir/wakeups/.state/$k.anchored" "SA-G9 $k must not anchor"
  done
}

# ============================================================
# SA-G10: `count` stops a schedule in the real process. Interval 1s with a 1s
# poll: first poll anchors, then exactly `count` fires, then silence.
test_SA_G10_count_stops_firing() {
  local ident_dir home_dir out_log
  ident_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  mkdir -p "$ident_dir/wakeups"
  cat > "$ident_dir/wakeups/twice.json" <<'JSON'
{"name": "twice", "enabled": true,
 "schedule": {"type": "interval", "every": "1s", "count": 2},
 "instruction": "tick"}
JSON
  HOME="$home_dir" WAKEUP_POLL_SEC=1 timeout 7 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true
  local fires
  fires=$(grep -c "⏰ \[scheduled: twice" "$out_log")
  [ "$fires" -eq 2 ] || fail "SA-G10: expected exactly 2 fires, got $fires: $(cat "$out_log")"
  local runs
  runs=$(cat "$ident_dir/wakeups/.state/twice.runs" 2>/dev/null)
  [ "$runs" = "2" ] || fail "SA-G10: expected .runs=2, got '$runs'"
}

# ============================================================
# SA-G11: the engine's full test suite (validation table, hand-checked cases,
# differential vs brute-force oracle, poll-loop simulation).
test_SA_G11_engine_suite() {
  local out
  if ! out=$(cd "$SCRIPT_DIR" && python3 -m unittest test_schedule_engine 2>&1); then
    fail "SA-G11: engine suite failed: $(printf '%s' "$out" | tail -30)"
  fi
}

# ============================================================
# SA-G12: scheduled-agents state is keyed by slug (what the app reads back),
# and sentinels an older build wrote under the display `name` carry over once.
test_SA_G12_scheduled_agents_state_keyed_by_slug() {
  local root home_dir
  root=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  mkdir -p "$root/morning-triage" "$root/.state"
  cat > "$root/morning-triage/scheduled-agent.json" <<'JSON'
{"name": "Morning Triage", "enabled": true,
 "schedule": {"type": "daily", "at": "09:00"},
 "prompt": "triage", "roles": ["coordinator"]}
JSON
  # Fired a moment ago, so no slot is due and the content must survive untouched.
  local stamp
  stamp="$(date +%s).5"
  printf '%s' "$stamp" > "$root/.state/Morning Triage.last"
  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$root" --mode scheduled-agents >/dev/null 2>&1 || true
  assert_file_exists "$root/.state/morning-triage.last" "SA-G12: name-keyed .last should move to the slug key"
  assert_file_absent "$root/.state/Morning Triage.last" "SA-G12: old name-keyed .last should be gone"
  assert_file_absent "$root/.state/morning-triage.anchored" "SA-G12: a migrated .last means no re-anchor"
  [ "$(cat "$root/.state/morning-triage.last")" = "$stamp" ] || fail "SA-G12: .last content changed"
}

# ============================================================
printf '=== wakeup-scheduler.py scheduled-agents-mode test driver ===\n'
printf 'script: %s\n' "$PY_SCRIPT"
printf '\n'

run_test test_SA_G1_scheduled_agents_spec_discovery
run_test test_SA_G2_scheduled_agents_ignores_flat_specs
run_test test_SA_G3_per_identity_mode_unchanged
run_test test_SA_G4_orphan_check_mode_isolation
run_test test_SA_G5_one_shot_scheduled_agents_mode
run_test test_SA_G6_prettify_name_de_slugs_task_prefix
run_test test_SA_G7_users_propagation
run_test test_SA_G8_users_absent_absent_in_body
run_test test_SA_G9_malformed_schedules_refused
run_test test_SA_G10_count_stops_firing
run_test test_SA_G11_engine_suite
run_test test_SA_G12_scheduled_agents_state_keyed_by_slug

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
