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
#   T-G13 — per-identity fan-out spread suite (test_wakeup_fanout.py)
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

  # Build per-identity wakeups dir with a folder-layout spec
  mkdir -p "$ident_dir/wakeups/legacy"
  cat > "$ident_dir/wakeups/legacy/wakeup.json" <<'JSON'
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
  local anchored_file="$ident_dir/wakeups/legacy/.state/legacy.anchored"
  assert_file_exists "$anchored_file" "SA-G3: .anchored sentinel should exist after first-sight"
  local last_file="$ident_dir/wakeups/legacy/.state/legacy.last"
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
  mkdir -p "$ident_dir/wakeups/bad-yearly"
  cat > "$ident_dir/wakeups/bad-yearly/wakeup.json" <<'JSON'
{"name": "bad-yearly", "enabled": true,
 "schedule": {"type": "yearly", "date": "02-29", "at": "09:00"},
 "instruction": "never"}
JSON
  mkdir -p "$ident_dir/wakeups/bad-months"
  cat > "$ident_dir/wakeups/bad-months/wakeup.json" <<'JSON'
{"name": "bad-months", "enabled": true,
 "schedule": {"type": "interval", "every": "0mo"},
 "instruction": "never"}
JSON
  mkdir -p "$ident_dir/wakeups/bad-monthly"
  cat > "$ident_dir/wakeups/bad-monthly/wakeup.json" <<'JSON'
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
    assert_file_absent "$ident_dir/wakeups/$k/.state/$k.anchored" "SA-G9 $k must not anchor"
  done
}

# ============================================================
# SA-G10: `count` stops a schedule in the real process. Interval 1s with a 1s
# poll: first poll anchors, then exactly `count` fires, then silence. The
# window is generous: under a loaded full-suite run, interpreter start-up can
# eat several seconds, and a longer window only lengthens the silence checked.
test_SA_G10_count_stops_firing() {
  local ident_dir home_dir out_log
  ident_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  mkdir -p "$ident_dir/wakeups/twice"
  cat > "$ident_dir/wakeups/twice/wakeup.json" <<'JSON'
{"name": "twice", "enabled": true,
 "schedule": {"type": "interval", "every": "1s", "count": 2},
 "instruction": "tick"}
JSON
  HOME="$home_dir" WAKEUP_POLL_SEC=1 timeout 15 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true
  local fires
  fires=$(grep -c "⏰ \[scheduled: twice" "$out_log")
  [ "$fires" -eq 2 ] || fail "SA-G10: expected exactly 2 fires, got $fires: $(cat "$out_log")"
  local runs
  runs=$(cat "$ident_dir/wakeups/twice/.state/twice.runs" 2>/dev/null)
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
# SA-G13: fan-out spread — same-minute wake-ups across running identities are
# offset; a lone agent fires on time.
test_SA_G13_fanout_suite() {
  local out
  if ! out=$(cd "$SCRIPT_DIR" && python3 -m unittest test_wakeup_fanout 2>&1); then
    fail "SA-G13: fan-out suite failed: $(printf '%s' "$out" | tail -30)"
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

# ============================================================
# SA-G14: per-identity wake-ups are folders — a flat <slug>.json is ignored,
# and a fired one_shot removes its wakeup.json (folder swept a day later).
# ============================================================
test_SA_G14_folder_layout_and_one_shot() {
  local ident_dir home_dir out_log
  ident_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  mkdir -p "$ident_dir/wakeups/once"
  cat > "$ident_dir/wakeups/flat.json" <<'JSON'
{"name": "flat", "enabled": true, "schedule": {"type": "one_shot", "at": "2020-01-01T00:00:00Z"}, "instruction": "flat"}
JSON
  cat > "$ident_dir/wakeups/once/wakeup.json" <<'JSON'
{"name": "Once", "enabled": true, "schedule": {"type": "one_shot", "at": "2020-01-01T00:00:00Z"}, "instruction": "go now"}
JSON
  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true
  grep -q "⏰ \[scheduled: once @ .*\] go now" "$out_log" \
    || fail "SA-G14: expected one_shot fire keyed by folder name, got: $(cat "$out_log")"
  grep -q "flat" "$out_log" && fail "SA-G14: flat legacy spec must be ignored, got: $(cat "$out_log")"
  assert_file_absent "$ident_dir/wakeups/once/wakeup.json" "SA-G14: fired one_shot spec removed"
  assert_file_exists "$ident_dir/wakeups/once/.state/once.fired" "SA-G14: .fired sentinel in the wake-up's own state"
  # Age the sentinel past the keep window: the leftover folder is swept.
  touch -d '2 days ago' "$ident_dir/wakeups/once/.state/once.fired"
  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$ident_dir" >/dev/null 2>&1 || true
  [ -d "$ident_dir/wakeups/once" ] && fail "SA-G14: fired one_shot folder should be swept after a day"
  [ -d "$ident_dir/wakeups/.state" ] || fail "SA-G14: scheduler's own .state must survive the sweep"
}

# ============================================================
# SA-G15: sensor wake-up — every waiting fire delivered oldest-first, inline
# when short, pointed at when long or multi-line, moved into delivered/, .last
# written; a disabled sensor wake-up leaves its fires waiting.
# ============================================================
test_SA_G15_sensor_wakeup_delivery() {
  local ident_dir home_dir out_log w
  ident_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  w="$ident_dir/wakeups/deliveries"
  mkdir -p "$w/fires" "$ident_dir/wakeups/paused/fires"
  cat > "$w/wakeup.json" <<'JSON'
{"name": "deliveries", "enabled": true, "schedule": {"type": "sensor"}, "instruction": "Judge these"}
JSON
  cat > "$ident_dir/wakeups/paused/wakeup.json" <<'JSON'
{"name": "paused", "enabled": false, "schedule": {"type": "sensor"}, "instruction": "x"}
JSON
  printf 'two candidates\n' > "$w/fires/20261014T143012345-a1b2c3d4.fire"
  printf 'line one\nline two\n' > "$w/fires/20261014T143012999-00000000.fire"
  : > "$w/fires/20261014T150000000-ffffffff.fire"
  printf 'ignored' > "$w/fires/not-a-fire.fire.tmp"
  printf 'waits' > "$ident_dir/wakeups/paused/fires/20261014T143012345-a1b2c3d4.fire"
  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true
  local lines
  lines=$(grep -c "📡 \[sensor: deliveries" "$out_log")
  assert_eq "3" "$lines" "SA-G15: one event per fire"
  sed -n 1p "$out_log" | grep -q "📡 \[sensor: deliveries @ 2026-10-14T14:30:12.345Z\] Judge these — findings: two candidates$" \
    || fail "SA-G15: first (oldest) fire inline (trailing newline trimmed) with its fire time, got: $(sed -n 1p "$out_log")"
  sed -n 2p "$out_log" | grep -q "findings (18 chars) at $w/fires/delivered/20261014T143012999-00000000.fire — Read it" \
    || fail "SA-G15: multi-line findings pointed at the delivered file, got: $(sed -n 2p "$out_log")"
  sed -n 3p "$out_log" | grep -q "Judge these — no findings$" \
    || fail "SA-G15: empty findings say so, got: $(sed -n 3p "$out_log")"
  [ -z "$(ls "$w/fires" | grep '\.fire$')" ] || fail "SA-G15: delivered fires must leave fires/: $(ls "$w/fires")"
  [ "$(ls "$w/fires/delivered" | wc -l)" = "3" ] || fail "SA-G15: three fires in delivered/"
  assert_file_exists "$w/fires/not-a-fire.fire.tmp" "SA-G15: odd-shaped files untouched"
  assert_file_exists "$w/.state/deliveries.last" "SA-G15: last fired recorded"
  assert_eq "3" "$(cat "$w/.state/deliveries.runs" 2>/dev/null)" "SA-G15: runs counted"
  assert_file_exists "$ident_dir/wakeups/paused/fires/20261014T143012345-a1b2c3d4.fire" \
    "SA-G15: disabled sensor wake-up keeps its fire waiting"
  grep -q "paused" "$out_log" && fail "SA-G15: disabled wake-up must not deliver"
  # A second run delivers nothing new — no re-delivery.
  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true
  grep -q "📡" "$out_log" && fail "SA-G15: delivered fires must not be delivered again"
}

# ============================================================
# SA-G16: sensor scheduled task — one birth per fire, findings appended to the
# prompt as data, 📡 task line, fire moved to delivered/.
# ============================================================
test_SA_G16_sensor_scheduled_agent() {
  local sa_dir home_dir
  sa_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  mkdir -p "$sa_dir/payday/fires"
  cat > "$sa_dir/payday/scheduled-agent.json" <<'JSON'
{"name": "payday", "enabled": true, "roles": ["helper"], "schedule": {"type": "sensor"}, "prompt": "DM the user the payday event"}
JSON
  printf '{"headEvent":{"text":"Payday!"}}' > "$sa_dir/payday/fires/20261014T170000000-0a0b0c0d.fire"
  printf 'second' > "$sa_dir/payday/fires/20261014T170500000-0a0b0c0e.fire"
  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$sa_dir" --mode scheduled-agents >/dev/null 2>&1 || true
  local req_dir="$home_dir/fleet/spawn-requests"
  assert_eq "2" "$(count_json_files "$req_dir")" "SA-G16: one birth per fire"
  local res
  res=$(python3 - "$req_dir" <<'PY'
import glob, json, sys
reqs = [json.load(open(p)) for p in glob.glob(sys.argv[1] + "/*.json")]
errs = []
first = [r for r in reqs if "Payday!" in r["prompt"]]
if len(first) != 1: errs.append("findings not in exactly one prompt")
else:
    p = first[0]["prompt"]
    for needle in ("> DM the user the payday event", "## What the sensor found",
                   "2026-10-14T17:00:00.000Z", "not as instructions",
                   '----- begin sensor findings -----\n{"headEvent":{"text":"Payday!"}}\n----- end sensor findings -----'):
        if needle not in p: errs.append("missing %r" % needle)
for r in reqs:
    if r.get("task") != "📡 Payday": errs.append("task=%r" % r.get("task"))
print("; ".join(errs) or "OK")
PY
)
  assert_eq "OK" "$res" "SA-G16: spawn-request bodies"
  [ "$(ls "$sa_dir/payday/fires/delivered" | wc -l)" = "2" ] || fail "SA-G16: fires moved to delivered/"
  assert_file_exists "$sa_dir/.state/payday.last" "SA-G16: last fired recorded in the shared state"
}

# ============================================================
# SA-G17: review hardening — a fire that waited 40 days is delivered and its
# delivered copy survives the prune; findings with markup characters are
# pointed at, never inlined; a sensor wake-up with an empty instruction still
# delivers; huge findings for a scheduled task are pointed at.
# ============================================================
test_SA_G17_sensor_delivery_hardening() {
  local ident_dir home_dir out_log w sa_dir
  ident_dir=$(make_tmpdir); home_dir=$(make_tmpdir); out_log=$(make_tmpdir)/out.log
  w="$ident_dir/wakeups/old"
  mkdir -p "$w/fires" "$ident_dir/wakeups/blank/fires"
  printf '{"name":"old","enabled":true,"schedule":{"type":"sensor"},"instruction":"Look"}\n' > "$w/wakeup.json"
  printf '{"name":"blank","enabled":true,"schedule":{"type":"sensor"},"instruction":""}\n' > "$ident_dir/wakeups/blank/wakeup.json"
  printf 'a <b>tag</b> here' > "$w/fires/20260901T000000000-00000001.fire"
  touch -d '40 days ago' "$w/fires/20260901T000000000-00000001.fire"
  printf 'blank works' > "$ident_dir/wakeups/blank/fires/20261014T000000000-00000002.fire"
  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true
  grep -q "📡 \[sensor: old @ 2026-09-01T00:00:00.000Z\] Look — findings (17 chars) at $w/fires/delivered/20260901T000000000-00000001.fire — Read it" "$out_log" \
    || fail "SA-G17: markup findings must be pointed at, got: $(cat "$out_log")"
  assert_file_exists "$w/fires/delivered/20260901T000000000-00000001.fire" "SA-G17: a long-waiting fire's delivered copy must survive"
  grep -q "📡 \[sensor: blank @ .*\]  — findings: blank works" "$out_log" \
    || fail "SA-G17: empty-instruction sensor wake-up still delivers, got: $(cat "$out_log")"
  sa_dir=$(make_tmpdir)
  mkdir -p "$sa_dir/big/fires"
  printf '{"name":"big","enabled":true,"roles":["r"],"schedule":{"type":"sensor"},"prompt":"p"}\n' > "$sa_dir/big/scheduled-agent.json"
  python3 -c "print('x' * 9000, end='')" > "$sa_dir/big/fires/20261014T000000000-00000003.fire"
  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$sa_dir" --mode scheduled-agents >/dev/null 2>&1 || true
  local res
  res=$(python3 - "$home_dir/fleet/spawn-requests" "$sa_dir" <<'PY'
import glob, json, sys
p = json.load(open(glob.glob(sys.argv[1] + "/*.json")[0]))["prompt"]
ok = "xxxxxxxxxx" not in p and "9000 characters" in p and sys.argv[2] + "/big/fires/delivered/20261014T000000000-00000003.fire" in p
print("OK" if ok else "BAD: " + p[-400:])
PY
)
  assert_eq "OK" "$res" "SA-G17: huge findings pointed at in the newborn's prompt"
}

# ============================================================
# SA-G18: one-time sensor — only the oldest waiting fire is delivered (with the
# retired note), then the spec goes and a .fired sentinel stays in the trigger's
# own state; later fires are never delivered; the folder is swept after a day.
# A disabled one-time sensor keeps its fire waiting. A one-time sensor task
# births one agent and retires the same way.
# ============================================================
test_SA_G18_one_time_sensor() {
  local ident_dir home_dir out_log w sa_dir
  ident_dir=$(make_tmpdir); home_dir=$(make_tmpdir); out_log=$(make_tmpdir)/out.log
  w="$ident_dir/wakeups/agent-done"
  mkdir -p "$w/fires" "$ident_dir/wakeups/paused/fires"
  printf '{"name":"agent-done","enabled":true,"schedule":{"type":"sensor","once":true},"instruction":"Tell the user"}\n' > "$w/wakeup.json"
  printf '{"name":"paused","enabled":false,"schedule":{"type":"sensor","once":true},"instruction":"x"}\n' > "$ident_dir/wakeups/paused/wakeup.json"
  printf 'the followed agent ended its turn' > "$w/fires/20261015T120000000-00000001.fire"
  printf 'again' > "$w/fires/20261015T120000500-00000002.fire"
  printf 'waits' > "$ident_dir/wakeups/paused/fires/20261015T120000000-00000003.fire"
  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true
  assert_eq "1" "$(grep -c "📡" "$out_log")" "SA-G18: exactly one heads-up"
  grep -q "📡 \[sensor: agent-done @ 2026-10-15T12:00:00.000Z\] Tell the user — findings: the followed agent ended its turn (one-time sensor — this wake-up has now retired)$" "$out_log" \
    || fail "SA-G18: oldest fire delivered with the retired note, got: $(cat "$out_log")"
  assert_file_absent "$w/wakeup.json" "SA-G18: spec removed after delivery"
  assert_file_exists "$w/.state/agent-done.fired" "SA-G18: .fired sentinel in the trigger's own state"
  assert_file_exists "$w/fires/delivered/20261015T120000000-00000001.fire" "SA-G18: delivered findings file kept"
  assert_file_absent "$w/fires/20261015T120000500-00000002.fire" "SA-G18: later fire dropped at retirement, never delivered"
  assert_file_absent "$w/fires/delivered/20261015T120000500-00000002.fire" "SA-G18: later fire not filed as delivered"
  assert_eq "20261015T120000000-00000001.fire" "$(cat "$w/.state/agent-done.fired")" "SA-G18: sentinel names the handed-over fire"
  assert_file_exists "$ident_dir/wakeups/paused/fires/20261015T120000000-00000003.fire" "SA-G18: disabled one-time sensor keeps its fire"
  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true
  grep -q "📡" "$out_log" && fail "SA-G18: a retired sensor never delivers again, got: $(cat "$out_log")"
  [ -d "$w" ] || fail "SA-G18: retired folder kept within the day"
  touch -d '2 days ago' "$w/.state/agent-done.fired"
  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$ident_dir" >/dev/null 2>&1 || true
  [ -d "$w" ] && fail "SA-G18: retired folder swept after a day"
  [ -d "$ident_dir/wakeups/paused" ] || fail "SA-G18: the disabled trigger is untouched by the sweep"

  # A spec that can't be removed must still never deliver a second fire.
  local w2="$ident_dir/wakeups/stuck"
  mkdir -p "$w2/fires"
  printf '{"name":"stuck","enabled":true,"schedule":{"type":"sensor","once":true},"instruction":"i"}\n' > "$w2/wakeup.json"
  printf 'one' > "$w2/fires/20261015T120000000-00000004.fire"
  printf 'two' > "$w2/fires/20261015T120001000-00000005.fire"
  mkdir -p "$w2/.state" && printf 'x' > "$w2/.state/stuck.fired" && touch -d '1 hour ago' "$w2/.state/stuck.fired"
  touch -d '2 hours ago' "$w2/wakeup.json"
  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true
  grep -q "📡" "$out_log" && fail "SA-G18: an already-fired one-time sensor never delivers again"
  assert_file_absent "$w2/wakeup.json" "SA-G18: an already-fired one-time sensor finishes retiring"
  # Crash after the hand-over but before the fire was filed: on restart the
  # handed-over fire (named by the sentinel) is filed into delivered/, never re-sent.
  local w4="$ident_dir/wakeups/crashed"
  mkdir -p "$w4/fires" "$w4/.state"
  printf '{"name":"crashed","enabled":true,"schedule":{"type":"sensor","once":true},"instruction":"i"}\n' > "$w4/wakeup.json"
  printf 'sent' > "$w4/fires/20261015T120000000-00000009.fire"
  printf 'later' > "$w4/fires/20261015T120002000-0000000a.fire"
  touch -d '2 hours ago' "$w4/wakeup.json"
  printf '20261015T120000000-00000009.fire' > "$w4/.state/crashed.fired" && touch -d '1 hour ago' "$w4/.state/crashed.fired"
  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true
  grep -q "📡" "$out_log" && fail "SA-G18: a crash-recovered one-time sensor never re-sends"
  assert_file_exists "$w4/fires/delivered/20261015T120000000-00000009.fire" "SA-G18: handed-over fire filed after a crash"
  assert_file_absent "$w4/fires/20261015T120002000-0000000a.fire" "SA-G18: the other waiting fire dropped after a crash"
  assert_file_absent "$w4/wakeup.json" "SA-G18: crash-recovered trigger retires"
  # A spec rewritten after the sentinel is a fresh trigger under the same name:
  # a fire left from the retired trigger (older than the new spec) is dropped,
  # never delivered; the fresh trigger's own fire is.
  local w3="$ident_dir/wakeups/again"
  mkdir -p "$w3/fires" "$w3/.state"
  printf 'old' > "$w3/.state/again.fired" && touch -d '1 hour ago' "$w3/.state/again.fired"
  printf 'leftover' > "$w3/fires/20200101T000000000-0000000b.fire"
  printf '{"name":"again","enabled":true,"schedule":{"type":"sensor","once":true},"instruction":"i"}\n' > "$w3/wakeup.json"
  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true
  grep -q "leftover" "$out_log" && fail "SA-G18: a retired trigger's leftover fire must never reach a fresh one"
  assert_file_absent "$w3/fires/20200101T000000000-0000000b.fire" "SA-G18: leftover fire dropped"
  assert_file_exists "$w3/wakeup.json" "SA-G18: the fresh trigger stays live"
  printf 'fresh' > "$w3/fires/$(date -u -d '+1 minute' +%Y%m%dT%H%M%S)000-00000006.fire"
  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true
  grep -q "📡 \[sensor: again .*findings: fresh" "$out_log" || fail "SA-G18: a rewritten spec is a fresh trigger, got: $(cat "$out_log")"

  sa_dir=$(make_tmpdir)
  mkdir -p "$sa_dir/follow/fires"
  printf '{"name":"follow","enabled":true,"roles":["r"],"schedule":{"type":"sensor","once":true},"prompt":"p"}\n' > "$sa_dir/follow/scheduled-agent.json"
  printf 'first' > "$sa_dir/follow/fires/20261015T120000000-00000007.fire"
  printf 'second' > "$sa_dir/follow/fires/20261015T120001000-00000008.fire"
  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$sa_dir" --mode scheduled-agents >/dev/null 2>&1 || true
  assert_eq "1" "$(count_json_files "$home_dir/fleet/spawn-requests")" "SA-G18: one-time sensor task births one agent"
  grep -q "first" "$home_dir"/fleet/spawn-requests/*.json || fail "SA-G18: the oldest fire is the one delivered"
  grep -q "retired" "$home_dir"/fleet/spawn-requests/*.json && fail "SA-G18: no retired note for a newborn"
  assert_file_absent "$sa_dir/follow/scheduled-agent.json" "SA-G18: task spec removed after delivery"
  assert_file_exists "$sa_dir/follow/.state/follow.fired" "SA-G18: task sentinel in the task's own folder"
  assert_file_exists "$sa_dir/follow/fires/delivered/20261015T120000000-00000007.fire" "SA-G18: task's delivered findings kept"
  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$sa_dir" --mode scheduled-agents >/dev/null 2>&1 || true
  assert_eq "1" "$(count_json_files "$home_dir/fleet/spawn-requests")" "SA-G18: retired task births nothing more"
  touch -d '2 days ago' "$sa_dir/follow/.state/follow.fired"
  HOME="$home_dir" timeout 2 python3 "$PY_SCRIPT" "$sa_dir" --mode scheduled-agents >/dev/null 2>&1 || true
  [ -d "$sa_dir/follow" ] && fail "SA-G18: retired task folder swept after a day"
  [ -d "$sa_dir/.state" ] || fail "SA-G18: the shared .state survives the sweep"
}

# ============================================================
# SA-G19: a broken sensor is told about once — after the grace period, never on
# a stale health record, again only after it has been healthy; a scheduled task
# births one agent to look into it.
# ============================================================
test_SA_G19_sensor_broken_alert() {
  local ident_dir home_dir out_log w now old older
  ident_dir=$(make_tmpdir)
  home_dir=$(make_tmpdir)
  out_log=$(make_tmpdir)/out.log
  w="$ident_dir/wakeups/deliveries"
  mkdir -p "$w/.state" "$ident_dir/wakeups/stale/.state"
  cat > "$w/wakeup.json" <<'JSON'
{"name": "deliveries", "enabled": true, "schedule": {"type": "sensor"}, "instruction": "Judge these"}
JSON
  cat > "$ident_dir/wakeups/stale/wakeup.json" <<'JSON'
{"name": "stale", "enabled": true, "schedule": {"type": "sensor"}, "instruction": "x"}
JSON
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  old=$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)
  older=$(date -u -d '-2 hour' +%Y-%m-%dT%H:%M:%SZ)
  # health <trigger dir> <state> <healthy> <updatedAt> <unhealthySince|null>
  health() { printf '{"state": "%s", "healthy": %s, "error": "boom", "unhealthySince": %s, "updatedAt": "%s"}' \
    "$2" "$3" "$5" "$4" > "$1/.state/sensor-health.json"; }
  run() { HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$ident_dir" >"$out_log" 2>/dev/null || true; }

  health "$w" failed false "$now" "\"$now\""
  health "$ident_dir/wakeups/stale" failed false "$old" "\"$older\""
  run
  grep -q "sensor broken" "$out_log" && fail "SA-G19: told inside the grace period: $(cat "$out_log")"

  health "$w" failed false "$now" "\"$old\""
  run
  assert_eq "1" "$(grep -c "📡 \[sensor broken: deliveries @ $old\]" "$out_log")" "SA-G19: told once after the grace period"
  grep -q "(failed) — its last error lines are in $w/.state/sensor-health.json — Read it" "$out_log" \
    || fail "SA-G19: line points at the health record, got: $(cat "$out_log")"
  grep -q "sensor broken: stale" "$out_log" && fail "SA-G19: a stale health record must never alert"

  run
  grep -q "sensor broken" "$out_log" && fail "SA-G19: told twice for one breakage"

  health "$w" idle true "$now" null
  run
  [ -e "$w/.state/deliveries.broken" ] && fail "SA-G19: healthy again must forget the told breakage"
  health "$w" failed false "$now" "\"$older\""
  run
  assert_eq "1" "$(grep -c 'sensor broken: deliveries' "$out_log")" "SA-G19: a new breakage is told again"

  # The supervisor's wake peek sees an untold breakage (wakes a dormant identity), not a told one.
  local peek
  peek=$(python3 - "$PY_SCRIPT" "$w" <<'PY'
import importlib.util, os, sys, time
from importlib.machinery import SourceFileLoader
l = SourceFileLoader("eng", sys.argv[1]); m = importlib.util.module_from_spec(importlib.util.spec_from_loader(l.name, l)); l.exec_module(m)
told = m.sensor_broken_due(sys.argv[2], "deliveries", time.time())
os.unlink(os.path.join(sys.argv[2], ".state", "deliveries.broken"))
untold = m.sensor_broken_due(sys.argv[2], "deliveries", time.time())
print("told=%r untold=%r" % (told, untold is not None))
PY
)
  assert_eq "told=None untold=True" "$peek" "SA-G19: due check for the supervisor peek"

  # scheduled task: one birth, the broken prompt instead of the task's own
  local sa_dir req_dir res
  sa_dir=$(make_tmpdir)
  mkdir -p "$sa_dir/payday/.state"
  cat > "$sa_dir/payday/scheduled-agent.json" <<'JSON'
{"name": "payday", "enabled": true, "roles": ["helper"], "schedule": {"type": "sensor"}, "prompt": "DM the user the payday event"}
JSON
  health "$sa_dir/payday" invalid false "$now" "\"$old\""
  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$sa_dir" --mode scheduled-agents >/dev/null 2>&1 || true
  HOME="$home_dir" timeout 3 python3 "$PY_SCRIPT" "$sa_dir" --mode scheduled-agents >/dev/null 2>&1 || true
  req_dir="$home_dir/fleet/spawn-requests"
  assert_eq "1" "$(count_json_files "$req_dir")" "SA-G19: one birth per breakage"
  res=$(python3 - "$req_dir" "$sa_dir" <<'PY'
import glob, json, sys
r = json.load(open(glob.glob(sys.argv[1] + "/*.json")[0]))
errs = []
if r.get("task") != "📡 Payday — sensor broken": errs.append("task=%r" % r.get("task"))
if r.get("roles") != ["helper"]: errs.append("roles=%r" % r.get("roles"))
p = r["prompt"]
for needle in ("sensor of the scheduled task \"payday\"", "invalid since", "do not carry out its prompt",
               sys.argv[2] + "/payday/.state/sensor-health.json"):
    if needle not in p: errs.append("missing %r" % needle)
if "DM the user the payday event" in p: errs.append("task prompt leaked into the broken prompt")
print("; ".join(errs) or "OK")
PY
)
  assert_eq "OK" "$res" "SA-G19: broken-sensor birth"
}

# ============================================================
# SA-G20: "archive_if_nothing_to_report" attaches the archive section after the
# prompt (before sensor findings); absent/false/non-boolean attaches nothing;
# the broken-sensor birth never carries it.
# ============================================================
test_SA_G20_archive_if_nothing_to_report() {
  local home_dir res
  home_dir=$(make_tmpdir)
  res=$(HOME="$home_dir" python3 - "$PY_SCRIPT" "$home_dir" <<'PY'
import glob, importlib.util, json, os, sys
from importlib.machinery import SourceFileLoader
l = SourceFileLoader("eng", sys.argv[1]); m = importlib.util.module_from_spec(importlib.util.spec_from_loader(l.name, l)); l.exec_module(m)
req_dir = os.path.join(sys.argv[2], "fleet", "spawn-requests")
def fire(flag, **kw):
    spec = {"name": "box check", "roles": ["helper"], "prompt": "check the box", "_slug": "box-check"}
    if flag is not None: spec["archive_if_nothing_to_report"] = flag
    _, path = m._drop_spawn_request(spec, sys.argv[2], **kw)
    return json.load(open(path))["prompt"]
sec = m.ARCHIVE_IF_NOTHING_TO_REPORT_SECTION
errs = []
p = fire(True)
if not p.endswith(sec): errs.append("ticked: section not at the end")
if p.index("> check the box") > p.index(sec): errs.append("ticked: section before the prompt")
for needle in ("/id archive", "deliberate exception", "your call"):
    if needle not in sec: errs.append("section missing %r" % needle)
for flag in (None, False, "true", 1):
    if sec in fire(flag): errs.append("flag=%r attached the section" % (flag,))
p = fire(True, sensor_fire=("2026-10-18T00:00:00Z", "found a thing", None))
if not (p.index(sec) < p.index("## What the sensor found")): errs.append("sensor: section not before findings")
if sec in fire(True, sensor_broken_prompt="fix the sensor"): errs.append("broken-sensor birth carried the section")
print("; ".join(errs) or "OK")
PY
)
  assert_eq "OK" "$res" "SA-G20: archive_if_nothing_to_report"
}

# ============================================================
# SA-G21: "project" files the newborn in the spec's project, but only while
# ~/fleet/projects/<slug>/project.md exists — a missing project, the archive
# folder, or a malformed slug leaves it off (newborn lands in Conversations).
# Applies to clock, sensor and broken-sensor births alike.
# ============================================================
test_SA_G21_project_filing() {
  local home_dir res
  home_dir=$(make_tmpdir)
  mkdir -p "$home_dir/fleet/projects/skynet" "$home_dir/fleet/projects/archive/old" "$home_dir/fleet/projects/empty"
  printf -- '---\ndisplayName: SKYNET\n---\n' > "$home_dir/fleet/projects/skynet/project.md"
  res=$(HOME="$home_dir" python3 - "$PY_SCRIPT" "$home_dir" <<'PY'
import importlib.util, json, sys
from importlib.machinery import SourceFileLoader
l = SourceFileLoader("eng", sys.argv[1]); m = importlib.util.module_from_spec(importlib.util.spec_from_loader(l.name, l)); l.exec_module(m)
def fire(project, **kw):
    spec = {"name": "box check", "roles": [], "prompt": "check the box", "_slug": "box-check"}
    if project is not None: spec["project"] = project
    _, path = m._drop_spawn_request(spec, sys.argv[2], **kw)
    return json.load(open(path))
errs = []
if fire("skynet").get("project") != "skynet": errs.append("live project not carried")
if fire("skynet", sensor_fire=("2026-10-18T00:00:00Z", "x", None)).get("project") != "skynet": errs.append("sensor fire not filed")
if fire("skynet", sensor_broken_prompt="fix it").get("project") != "skynet": errs.append("broken-sensor birth not filed")
for bad in (None, "gone", "archive", "empty", "Bad Slug", 7, "../skynet"):
    if "project" in fire(bad): errs.append("project=%r carried" % (bad,))
print("; ".join(errs) or "OK")
PY
)
  assert_eq "OK" "$res" "SA-G21: project filing"
}

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
run_test test_SA_G13_fanout_suite
run_test test_SA_G14_folder_layout_and_one_shot
run_test test_SA_G15_sensor_wakeup_delivery
run_test test_SA_G16_sensor_scheduled_agent
run_test test_SA_G17_sensor_delivery_hardening
run_test test_SA_G18_one_time_sensor
run_test test_SA_G19_sensor_broken_alert
run_test test_SA_G20_archive_if_nothing_to_report
run_test test_SA_G21_project_filing

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
