#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for Phase 118 Plan 118-01 source-C (~/fleet/apps/*) enumeration
# in fleet-status-sweep.py.
#
# Sibling to fleet-status-sweep.test.sh (which covers the Plan 115-05 archive-
# tree walk) and fleet-status-sweep-appearance.sh (which covers the Plan
# 111-01 frontmatter/appearance branch). This driver targets the new
# `line_kind: "app"` emission specifically: does the sweep enumerate
# ~/fleet/apps/*/, cross-check each folder against the systemd user unit
# FILE on disk, and emit the D-05 shape for apps that pass D-01 (and the
# D-02 carve-out for unit-exists-but-port-not-listening)?
#
# 2026-09-19 REWRITE — the sweep no longer shells out to `systemctl --user`
# (see the module docblock above `_read_app_unit_file` in the sweep script
# for the container-namespace context that motivated the change). Health is
# now a TCP loopback probe on 127.0.0.1:<port> extracted from the unit file
# body. This driver mirrors that: it drops all `systemctl --user` calls,
# writes unit files directly into the fixture at
# `$FIXTURE/.config/systemd/user/`, and spins up a Python `http.server` port
# listener in the background for cases that need "active" state.
#
# Test cases (per RESEARCH § Q7 + PLAN.md Task 2):
#   1. good app       — app.json + unit file + port listening → line, healthy
#   2. malformed json — bad app.json + unit + listening        → no line, stderr log
#   3. no unit        — app.json + NO unit file                → no line (D-01 (b))
#   4. stopped unit   — app.json + unit file + no listener     → line, unhealthy
#   5. no icon        — app.json + unit + listening, no icon   → has_icon: false
#   6. with icon      — app.json + unit + listening + icon     → has_icon: true
#   7. slug injection — bad folder name (uppercase, >40)       → no line, stderr log
#   8. folder count cap — 51 valid apps → ≤50 lines + cap_hit warn (MEDIUM-4)
#
# Exits 0 on all-pass; exits 1 on any failure with a diagnostic naming the
# failing test. No SKIP gate — the driver now needs only python3 (already a
# hard sweep dependency) and free loopback ports.
#
# Usage: bash substrate/scripts/tests/fleet-status-sweep-apps.test.sh
#   Run from the repo root.
#
# Hermetic environment contract:
#   Each test builds a scratch tree at $FIXTURE and runs the sweep with
#   HOME="$FIXTURE" so both `~/fleet/apps/` AND `~/.config/systemd/user/`
#   resolve entirely under the fixture — the real host state is never read
#   or written. Port listeners bind 127.0.0.1:<port> in the driver's own
#   process namespace, are tracked in LISTENER_PIDS, and are killed on EXIT.
#   HOME_HOST_DIR is unset in `run_sweep` so the sweep exercises its
#   port-probe branch (not the container-namespace trust branch — see
#   `_build_app_line` for that split).
#
# Requirements: bash, python3.

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

# ---- port-listener tracking ----
# Every listener PID spawned by create_test_unit(active=true) gets appended
# here so cleanup() can kill them regardless of test success/failure.
LISTENER_PIDS=()

cleanup() {
  cleanup_test_units
  [ -n "$FIXTURE" ] && [ -d "$FIXTURE" ] && rm -rf "$FIXTURE"
}
trap cleanup EXIT

# ---- test state ----
PASS=0
FAIL=0
FAILURES=()
CURRENT_TEST=""
STDERR_FILE=""

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

# assert_json_line_has: parse each JSONL line, find one with
# line_kind==app and slug==<slug>, then assert the value at <key> equals
# <expected_json>. Emits "MISSING_LINE" if no matching line exists.
# Usage: assert_json_line_has "<stdout_blob>" <slug> <key> <expected_json> <msg>
assert_json_line_has() {
  local stdout_blob="$1" slug="$2" key="$3" expected_json="$4"
  local msg="${5:-assert_json_line_has}"
  local result
  # ensure_ascii=False so JSON string values containing non-ASCII (e.g. the
  # em-dash in the D-03 health_message) round-trip in their raw UTF-8 form.
  # Without this, `json.dumps` defaults to \uXXXX escapes and callers passing
  # the literal UTF-8 form in <expected_json> would spuriously mismatch.
  result=$(printf '%s' "$stdout_blob" | python3 -c "
import sys, json
target = None
for l in sys.stdin.read().splitlines():
    l = l.strip()
    if not l:
        continue
    try:
        obj = json.loads(l)
    except json.JSONDecodeError:
        continue
    if obj.get('line_kind') == 'app' and obj.get('slug') == '$slug':
        target = obj
        break
if target is None:
    print('MISSING_LINE')
else:
    print(json.dumps(target.get('$key'), ensure_ascii=False))
" 2>/dev/null)
  if [ "$result" = "MISSING_LINE" ]; then
    fail "$msg: no app line for slug='$slug' in output"
  elif [ "$result" != "$expected_json" ]; then
    fail "$msg: expected $key=$expected_json got $key=$result"
  fi
}

# assert_no_app_line: assert ZERO app lines exist for the given slug.
assert_no_app_line() {
  local stdout_blob="$1" slug="$2" msg="${3:-assert_no_app_line}"
  local count
  count=$(printf '%s' "$stdout_blob" | python3 -c "
import sys, json
n = 0
for l in sys.stdin.read().splitlines():
    l = l.strip()
    if not l:
        continue
    try:
        obj = json.loads(l)
    except json.JSONDecodeError:
        continue
    if obj.get('line_kind') == 'app' and obj.get('slug') == '$slug':
        n += 1
print(n)
" 2>/dev/null)
  if [ "$count" != "0" ]; then
    fail "$msg: expected 0 app lines for slug='$slug', got $count"
  fi
}

# assert_stderr_contains: assert the captured stderr file contains a substring.
assert_stderr_contains() {
  local needle="$1" msg="${2:-assert_stderr_contains}"
  if [ ! -f "$STDERR_FILE" ]; then
    fail "$msg: STDERR_FILE not set or missing"
    return
  fi
  if ! grep -q -- "$needle" "$STDERR_FILE"; then
    fail "$msg: stderr missing '$needle' (see $STDERR_FILE)"
  fi
}

# ---- unit lifecycle helpers ----
#
# create_test_unit <slug> <port> <active>
#   Writes $FIXTURE/.config/systemd/user/app-<slug>.service with a minimal
#   [Service] section carrying Environment=PORT=<port>. If active=true, also
#   spawns a Python `http.server` bound to 127.0.0.1:<port> and appends its
#   PID to LISTENER_PIDS. No systemctl calls — the sweep reads the file
#   directly and probes the port via TCP connect, so real systemd
#   registration is unnecessary.
create_test_unit() {
  local slug="$1" port="$2" active="$3"
  local unit_dir="$FIXTURE/.config/systemd/user"
  local unit_path="$unit_dir/app-${slug}.service"

  mkdir -p "$unit_dir"
  cat > "$unit_path" <<UNIT
[Unit]
Description=Phase 118 test unit for slug=${slug}

[Service]
Type=simple
Environment=PORT=${port}
ExecStart=/bin/sleep 3600
UNIT

  if [ "$active" = "true" ]; then
    # http.server binds a listening socket on the given port. `--bind
    # 127.0.0.1` matches how apps declare their bind address; the sweep's
    # probe uses 127.0.0.1 too. stdout/stderr are silenced so port-listener
    # noise doesn't leak into $STDERR_FILE (which asserts against sweep
    # output only). PID captured into LISTENER_PIDS for cleanup.
    python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1 &
    LISTENER_PIDS+=("$!")

    # Small settle so the accept() socket is bound before the sweep probes.
    # http.server binds synchronously so 50 ms is more than enough; timing
    # test flakiness would show up as case1 is_healthy=false and be obvious.
    local tries=0
    while [ "$tries" -lt 10 ]; do
      if python3 -c "
import socket, sys
try:
    socket.create_connection(('127.0.0.1', $port), timeout=0.2).close()
except OSError:
    sys.exit(1)
" 2>/dev/null; then
        break
      fi
      tries=$((tries + 1))
      sleep 0.05
    done
    if [ "$tries" -eq 10 ]; then
      fail "create_test_unit: port-listener for app-${slug} did not come up on 127.0.0.1:${port}"
    fi
  fi
}

cleanup_test_units() {
  local pid
  # Under `set -u`, iterating an empty array via "${arr[@]}" is unbound; the
  # `+` alt-value expansion is the portable safe idiom (works when either the
  # array is unset OR has zero elements). Same pattern used elsewhere in the
  # fleet-substrate shell drivers.
  for pid in ${LISTENER_PIDS[@]+"${LISTENER_PIDS[@]}"}; do
    [ -z "$pid" ] && continue
    # kill first with SIGTERM; if the http.server is looping fast, escalate.
    kill "$pid" >/dev/null 2>&1 || true
    # brief wait then SIGKILL as insurance. http.server responds to SIGTERM
    # in practice, so this is a belt.
    sleep 0.02
    kill -9 "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
  done
  LISTENER_PIDS=()
  # Fixture-side unit files are wiped along with $FIXTURE in reset_test_state
  # / cleanup, so no separate rm loop.
}

# ---- sweep runner ----
#
# run_sweep: HOME=$FIXTURE python3 $SWEEP; capture stdout to stdout, stderr
# to $STDERR_FILE. HOME is the fixture so BOTH ~/fleet/apps/ AND
# ~/.config/systemd/user/ resolve entirely under the fixture — the sweep's
# `_read_app_unit_file(slug, home)` reads unit files written by
# `create_test_unit`, and `_probe_app_port` probes the listener we spawned.
# HOME_HOST_DIR is explicitly unset so the sweep does NOT take the
# container-namespace trust branch (see `_build_app_line` in the sweep).
run_sweep() {
  env -u HOME_HOST_DIR HOME="$FIXTURE" python3 "$SWEEP" 2>"$STDERR_FILE"
}

# ---- per-test setup ----
#
# reset_test_state: wipe fixture + stderr file. Called from run_test.
reset_test_state() {
  # Kill any listeners spawned by a prior test so ports are free for the
  # next case. Must happen BEFORE the fixture wipe so `$FIXTURE/.config/...`
  # still exists to reference (though nothing here reads it).
  cleanup_test_units
  rm -rf "${FIXTURE:?}"/*
  if [ -n "$STDERR_FILE" ] && [ -f "$STDERR_FILE" ]; then
    rm -f "$STDERR_FILE"
  fi
  STDERR_FILE=$(mktemp)
}

run_test() {
  local test_fn="$1"
  local before_fail=$FAIL
  CURRENT_TEST="$test_fn"

  reset_test_state
  "$test_fn"

  if [ "$FAIL" -eq "$before_fail" ]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$test_fn"
  else
    printf 'FAIL  %s\n' "$test_fn"
  fi
}

# ---- fixture helpers ----

# make_app_folder <slug> <title> <description>
make_app_folder() {
  local slug="$1" title="$2" description="$3"
  local dir="$FIXTURE/fleet/apps/$slug"
  mkdir -p "$dir"
  python3 -c "
import json, sys
sys.stdout.write(json.dumps({'title': '$title', 'description': '$description'}))
" > "$dir/app.json"
}

make_malformed_app_folder() {
  local slug="$1"
  local dir="$FIXTURE/fleet/apps/$slug"
  mkdir -p "$dir"
  # Deliberately truncated JSON — parser must raise JSONDecodeError.
  printf '{"title": "unclosed' > "$dir/app.json"
}

# ============================================================
# TEST CASES
# ============================================================

# Case 1: good app — app.json + valid active unit → one line, all D-05 fields
# present, is_healthy=true, port=9591, has_icon=false.
test_case_01_good_app() {
  make_app_folder "sweep-t116-good" "Good App" "A test app that runs"
  create_test_unit "sweep-t116-good" 9591 true

  local out
  out=$(run_sweep)

  assert_json_line_has "$out" "sweep-t116-good" "line_kind" '"app"' "case1 line_kind"
  assert_json_line_has "$out" "sweep-t116-good" "title" '"Good App"' "case1 title"
  assert_json_line_has "$out" "sweep-t116-good" "description" '"A test app that runs"' "case1 description"
  assert_json_line_has "$out" "sweep-t116-good" "is_healthy" 'true' "case1 is_healthy"
  assert_json_line_has "$out" "sweep-t116-good" "port" '9591' "case1 port"
  assert_json_line_has "$out" "sweep-t116-good" "has_icon" 'false' "case1 has_icon"
  assert_json_line_has "$out" "sweep-t116-good" "health_message" 'null' "case1 health_message"
  assert_json_line_has "$out" "sweep-t116-good" "schema_version" '1' "case1 schema_version"
}

# Case 2: malformed app.json → no line for this slug, stderr logs
# app_json_missing_or_malformed. Also verify a sibling good app in the same
# fixture still emits (belt-and-braces per D-18: one bad app must not break
# the sweep for the good app).
test_case_02_malformed_json() {
  make_malformed_app_folder "sweep-t116-malformed"
  create_test_unit "sweep-t116-malformed" 9592 true

  # Sibling good app to prove per-app fail-open discipline.
  make_app_folder "sweep-t116-good" "Good App" "A test app that runs"
  create_test_unit "sweep-t116-good" 9593 true

  local out
  out=$(run_sweep)

  assert_no_app_line "$out" "sweep-t116-malformed" "case2 malformed not emitted"
  assert_stderr_contains "app_json_missing_or_malformed" "case2 stderr log"
  # The good sibling still emits.
  assert_json_line_has "$out" "sweep-t116-good" "is_healthy" 'true' "case2 sibling still emits"
}

# Case 3: no unit — folder + app.json but no systemd unit → no line (D-01 (b)).
test_case_03_no_unit() {
  make_app_folder "sweep-t116-no-unit" "No Unit App" "Never registered"
  # NO create_test_unit call.

  local out
  out=$(run_sweep)

  assert_no_app_line "$out" "sweep-t116-no-unit" "case3 no-unit not emitted"
}

# Case 4: stopped unit (D-02 carve-out) — folder + app.json + unit registered
# but inactive → one line, is_healthy=false, literal D-03 health_message.
test_case_04_stopped_unit() {
  make_app_folder "sweep-t116-stopped" "Stopped App" "Registered but not running"
  create_test_unit "sweep-t116-stopped" 9594 false

  local out
  out=$(run_sweep)

  assert_json_line_has "$out" "sweep-t116-stopped" "is_healthy" 'false' "case4 is_healthy false"
  assert_json_line_has "$out" "sweep-t116-stopped" "health_message" \
    '"not running — ask an agent to check on it"' "case4 D-03 message"
}

# Case 5: no icon — folder + app.json + valid active unit, no icon.webp → line
# with has_icon=false.
test_case_05_no_icon() {
  make_app_folder "sweep-t116-no-icon" "No Icon App" "No icon on disk"
  create_test_unit "sweep-t116-no-icon" 9595 true

  local out
  out=$(run_sweep)

  assert_json_line_has "$out" "sweep-t116-no-icon" "has_icon" 'false' "case5 has_icon false"
}

# Case 6: with icon — same as case 5 but icon.webp file exists (any bytes) →
# line with has_icon=true.
test_case_06_with_icon() {
  make_app_folder "sweep-t116-with-icon" "With Icon App" "Has icon on disk"
  # Test doesn't validate icon content — any file at the exact filename works.
  printf 'not-really-webp-just-bytes' > "$FIXTURE/fleet/apps/sweep-t116-with-icon/icon.webp"
  create_test_unit "sweep-t116-with-icon" 9596 true

  local out
  out=$(run_sweep)

  assert_json_line_has "$out" "sweep-t116-with-icon" "has_icon" 'true' "case6 has_icon true"
}

# Case 7: slug-injection defense (T-118-01-SL) — a folder name that fails
# APP_SLUG_RE (uppercase char) must be rejected BEFORE any subprocess call,
# with app_slug_skipped on stderr and zero app lines for that name.
test_case_07_slug_injection() {
  local bad_slug="Bad-Slug"
  # Note: the app.json + icon.webp are inert here; the slug regex trips
  # before any of them get read.
  mkdir -p "$FIXTURE/fleet/apps/$bad_slug"
  printf '{"title":"Bad","description":"Should never be emitted"}' \
    > "$FIXTURE/fleet/apps/$bad_slug/app.json"

  local out
  out=$(run_sweep)

  assert_no_app_line "$out" "$bad_slug" "case7 bad slug not emitted"
  assert_stderr_contains "app_slug_skipped" "case7 slug_skipped log"
}

# Case 8: MEDIUM-4 folder-count cap — 51 valid apps must produce at most
# APP_ENUM_CAP (50) app lines + a stderr warn tagged
# fleet_status_apps_cap_hit. Unit files exist for every app but no port
# listener is spawned — the D-02 carve-out emits each as unhealthy, so all
# 51 still count toward the cap even though none pass the port probe.
# Proves the cap fires on emission count, not on any subset.
test_case_08_folder_count_cap() {
  local unit_dir="$FIXTURE/.config/systemd/user"
  mkdir -p "$unit_dir"

  local i slug port=9700
  for i in $(seq 1 51); do
    slug="sweep-t116-cap-$i"
    mkdir -p "$FIXTURE/fleet/apps/$slug"
    python3 -c "
import json, sys
sys.stdout.write(json.dumps({'title': 'Cap $i', 'description': 'MEDIUM-4 test'}))
" > "$FIXTURE/fleet/apps/$slug/app.json"

    # Fixture-side unit file — sweep reads it directly. No systemctl
    # registration needed. Port probe will fail (no listener) so each app
    # emits with is_healthy=false via the D-02 carve-out — but they still
    # emit and thus still count against APP_ENUM_CAP.
    cat > "$unit_dir/app-${slug}.service" <<UNIT
[Unit]
Description=Phase 118 MEDIUM-4 test unit for slug=${slug}

[Service]
Type=simple
Environment=PORT=$((port + i))
ExecStart=/bin/sleep 3600
UNIT
  done

  local out
  out=$(run_sweep)

  # Count emitted app lines with the sweep-t116-cap- prefix.
  local emitted_count
  emitted_count=$(printf '%s' "$out" | python3 -c "
import sys, json
n = 0
for l in sys.stdin.read().splitlines():
    l = l.strip()
    if not l:
        continue
    try:
        obj = json.loads(l)
    except json.JSONDecodeError:
        continue
    if obj.get('line_kind') == 'app' and obj.get('slug', '').startswith('sweep-t116-cap-'):
        n += 1
print(n)
" 2>/dev/null)

  # At most APP_ENUM_CAP (50) app lines from the cap-prefix set.
  if [ "$emitted_count" -gt 50 ]; then
    fail "case8 cap: expected ≤ 50 app lines, got $emitted_count"
  fi
  if [ "$emitted_count" -lt 50 ]; then
    fail "case8 cap: expected exactly 50 cap-prefix app lines (cap value), got $emitted_count"
  fi

  # Stderr must contain the fleet_status_apps_cap_hit warn.
  assert_stderr_contains "fleet_status_apps_cap_hit" "case8 cap_hit log"
}

# ============================================================
# RUNNER
# ============================================================

printf '=== fleet-status-sweep apps (source-C) test driver ===\n'
printf 'sweep: %s\n' "$SWEEP"
printf 'fixture: %s\n' "$FIXTURE"
printf '\n'

run_test test_case_01_good_app
run_test test_case_02_malformed_json
run_test test_case_03_no_unit
run_test test_case_04_stopped_unit
run_test test_case_05_no_icon
run_test test_case_06_with_icon
run_test test_case_07_slug_injection
run_test test_case_08_folder_count_cap

printf '\n===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
  printf '\nFailures:\n'
  for f in "${FAILURES[@]}"; do
    printf '  - %s\n' "$f"
  done
  exit 1
fi

exit 0
