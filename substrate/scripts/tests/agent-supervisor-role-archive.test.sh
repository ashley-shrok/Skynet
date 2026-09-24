#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317
# (SC2317 false positive: test functions are called indirectly via run_test; static analysis cannot trace this)
#
# Test driver for Phase 133 role-archive scanner in agent-supervisor.sh.
#
# Covers: scan_role_archive_requested_sentinels() (fresh-enumeration cascade,
# fail-soft partial, empty degenerate, guard bypass, sentinel-always-deleted,
# no-op when sentinel absent) and identity_has_role() unit tests (substring
# safety, quoted-variant WARN, body-line ignored).
#
# Exits 0 on all-pass; exits 1 on any failure with a diagnostic naming the failing test.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-role-archive.test.sh
#   Run from the repo root. Override supervisor path:
#   SUPERVISOR=/path/to/agent-supervisor.sh bash substrate/scripts/tests/agent-supervisor-role-archive.test.sh
#
# Requirements: bash, shellcheck, tmux, jq, stat, curl (mandatory — same as the supervisor).
#   python3 (mandatory for stub-homeserver-backed retire_identity calls; tests
#   using retire_identity skip gracefully if python3 is unavailable).
#
# Isolation: every test that sources the supervisor exports:
#   AGENT_IDENTITIES_DIR=<scratch>              — points IDENTITIES_DIR at scratch
#   AGENT_IDENTITIES_ARCHIVE_DIR=<scratch>-archive — points IDENTITIES_ARCHIVE_DIR at sibling
#   AGENT_ROLES_DIR=<scratch>-roles             — points ROLES_DIR at sibling (Phase 133)
#   AGENT_ROLES_ARCHIVE_DIR=<scratch>-roles-archive — points ROLES_ARCHIVE_DIR at sibling
#   AGENT_SUPERVISOR_LIB_ONLY=1                 — stops before the reconcile loop
#
# TODO: the harness (helpers + fixture_identity + start_stub_homeserver + assertion macros)
# is duplicated from agent-supervisor-archive-scan.sh — a future phase could extract to
# substrate/scripts/tests/lib/test-harness.sh. Kept inline here for scope-tight execution
# (the sibling file is stable and the duplication is bounded ~300 lines).

export AGENT_SUPERVISOR_LIB_ONLY=1

set -u  # -e is NOT set — the script uses explicit assert helpers so a failing
        # assert does not silently skip subsequent tests.

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"

if [ ! -f "$SUPERVISOR" ]; then
  printf 'FATAL: supervisor not found at %s\n' "$SUPERVISOR" >&2
  exit 1
fi

# ---- tool availability checks ----
MISSING_MANDATORY=""
for _tool in shellcheck tmux jq curl stat; do
  command -v "$_tool" >/dev/null 2>&1 || MISSING_MANDATORY="$MISSING_MANDATORY $_tool"
done
if [ -n "$MISSING_MANDATORY" ]; then
  printf 'FATAL: mandatory tools missing (same as supervisor requirements):%s\n' "$MISSING_MANDATORY" >&2
  exit 1
fi

HAS_PYTHON3=false
command -v python3 >/dev/null 2>&1 && HAS_PYTHON3=true
HAS_STUB_SERVER=false
$HAS_PYTHON3 && HAS_STUB_SERVER=true

# ---- hermetic source invocation ----
# Sources the supervisor with all Phase 133 role-archive env vars pointing at scratch dirs
# (siblings, not subdirs — mirrors the identity-archive pattern from the Phase 94-04 tests).
_source_supervisor_with_roles() {
  local scratch="${1:-/tmp}"
  export AGENT_IDENTITIES_DIR="$scratch"
  export AGENT_IDENTITIES_ARCHIVE_DIR="${scratch}-archive"
  export AGENT_ROLES_DIR="${scratch}-roles"
  export AGENT_ROLES_ARCHIVE_DIR="${scratch}-roles-archive"
  export DORMANCY_STATE_DIR="$scratch/.state"
  export AGENT_SUPERVISOR_LIB_ONLY=1
  # shellcheck disable=SC1090  # dynamic path
  source "$SUPERVISOR" 2>/dev/null || true
}

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

assert_file() {
  local path="$1" msg="${2:-assert_file}"
  if [ ! -e "$path" ]; then
    fail "$msg: expected file/dir '$path' to exist"
  fi
}

assert_nofile() {
  local path="$1" msg="${2:-assert_nofile}"
  if [ -e "$path" ]; then
    fail "$msg: expected '$path' to NOT exist, but it does"
  fi
}

assert_grep() {
  local pattern="$1" text="$2" msg="${3:-assert_grep}"
  if ! printf '%s' "$text" | grep -q "$pattern" 2>/dev/null; then
    fail "$msg: pattern '$pattern' not found in output"
  fi
}

assert_nogrep() {
  local pattern="$1" text="$2" msg="${3:-assert_nogrep}"
  if printf '%s' "$text" | grep -q "$pattern" 2>/dev/null; then
    fail "$msg: pattern '$pattern' unexpectedly found in output"
  fi
}

# setup_role_scratch: create mktemp -d for identities scratch and siblings for identity-archive,
# roles, and roles-archive. Returns the identities scratch path. teardown_role_scratch cleans up all four.
setup_role_scratch() {
  local s; s=$(mktemp -d)
  mkdir -p "$s/.state" "${s}-archive" "${s}-roles" "${s}-roles-archive"
  printf '%s' "$s"
}

teardown_role_scratch() {
  local s="$1"
  [ -n "$s" ] && [ -d "$s" ] && rm -rf "$s"
  [ -n "$s" ] && [ -d "${s}-archive" ] && rm -rf "${s}-archive"
  [ -n "$s" ] && [ -d "${s}-roles" ] && rm -rf "${s}-roles"
  [ -n "$s" ] && [ -d "${s}-roles-archive" ] && rm -rf "${s}-roles-archive"
}

# fixture_identity: create an identity folder <scratch>/<name>/ with a <name>.md carrying the
# requested role in its frontmatter (default role: test, matching the sibling harness).
# Usage: fixture_identity <scratch> <name> [--role <role_name>] [--pinned] [--no-dormancy] [--coordinator]
fixture_identity() {
  local scratch="$1" name="$2"
  shift 2
  local role="test"
  local pinned=false nodormancy=false coordinator=false
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --role)         role="$2"; shift ;;
      --pinned)       pinned=true ;;
      --no-dormancy)  nodormancy=true ;;
      --coordinator)  coordinator=true ;;
    esac
    shift
  done
  local iddir="$scratch/$name"
  mkdir -p "$iddir"
  if $coordinator; then
    printf -- '---\nrole: %s\ncoordinator: true\n---\nbody\n' "$role" > "$iddir/$name.md"
  else
    printf -- '---\nrole: %s\n---\nbody\n' "$role" > "$iddir/$name.md"
  fi
  $pinned     && touch "$iddir/.pinned"
  $nodormancy && touch "$iddir/.no-dormancy"
}

# fixture_relay_json: write relay.json for an identity at <dir>.
fixture_relay_json() {
  local dir="$1" base="$2" mxid="$3" password="$4" token="$5"
  jq -n \
    --arg base       "$base" \
    --arg user_id    "$mxid" \
    --arg password   "$password" \
    --arg access_token "$token" \
    '{"base":$base,"user_id":$user_id,"password":$password,"access_token":$access_token,"token":$access_token}' \
    > "$dir/relay.json"
}

# fixture_role_folder: create a role folder under $scratch-roles/, optionally with the
# .archive-requested sentinel present.
# Usage: fixture_role_folder <scratch> <role_name> [--with-sentinel]
fixture_role_folder() {
  local scratch="$1" role_name="$2"
  shift 2
  local with_sentinel=false
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --with-sentinel) with_sentinel=true ;;
    esac
    shift
  done
  local role_dir="${scratch}-roles/$role_name"
  mkdir -p "$role_dir"
  # Drop a marker file so the folder actually contains something (roles typically have
  # a role.md or similar; the exact content is irrelevant to the archive gesture per D-17).
  printf 'role-content-marker\n' > "$role_dir/role.md"
  if $with_sentinel; then
    touch "$role_dir/.archive-requested"
  fi
}

# ---- stub homeserver ----
STUB_PID=""
STUB_PORT=""
STUB_LOG=""
STUB_REQ_LOG=""

# start_stub_homeserver: same shape as the sibling harness (single-code OR comma-sequence).
start_stub_homeserver() {
  local http_code="$1"
  STUB_PID=""
  STUB_PORT=""
  STUB_LOG=$(mktemp)
  STUB_REQ_LOG=$(mktemp)

  if $HAS_PYTHON3; then
    python3 -c "
import http.server, sys, socketserver

codes = [int(c) for c in sys.argv[1].split(',')]
port_file = sys.argv[2]
req_log = sys.argv[3]
counter = {'i': 0}

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length > 0 else b''
        with open(req_log, 'ab') as f:
            f.write(('%s %d ' % (self.path, length)).encode('utf-8'))
            f.write(body.replace(b'\n', b' '))
            f.write(b'\n')
        idx = min(counter['i'], len(codes) - 1)
        counter['i'] += 1
        code = codes[idx]
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{\"status\":\"ok\"}\n')
    def log_message(self, fmt, *args): pass

with socketserver.TCPServer(('127.0.0.1', 0), Handler) as server:
    port = server.server_address[1]
    with open(port_file, 'w') as f:
        f.write(str(port))
    server.serve_forever()
" "$http_code" "$STUB_LOG" "$STUB_REQ_LOG" &
    STUB_PID=$!

    # Wait for server to write its port (up to 5s)
    local waited=0
    while [ "$waited" -lt 50 ] && [ ! -s "$STUB_LOG" ]; do
      sleep 0.1
      waited=$((waited + 1))
    done
    if [ ! -s "$STUB_LOG" ]; then
      fail "start_stub_homeserver: python3 stub did not write port within 5s"
      return 1
    fi
    STUB_PORT=$(cat "$STUB_LOG")
    return 0
  else
    fail "start_stub_homeserver: python3 not available"
    return 1
  fi
}

stop_stub_homeserver() {
  if [ -n "$STUB_PID" ]; then
    kill "$STUB_PID" 2>/dev/null || true
    wait "$STUB_PID" 2>/dev/null || true
    STUB_PID=""
  fi
  [ -n "$STUB_LOG" ] && rm -f "$STUB_LOG"
  STUB_LOG=""
  [ -n "$STUB_REQ_LOG" ] && rm -f "$STUB_REQ_LOG"
  STUB_REQ_LOG=""
  STUB_PORT=""
}

# ---- run_test wrapper ----
run_test() {
  local test_fn="$1"
  local before_fail=$FAIL
  CURRENT_TEST="$test_fn"

  stop_stub_homeserver 2>/dev/null || true
  "$test_fn"

  if [ "$FAIL" -eq "$before_fail" ]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$test_fn"
  else
    printf 'FAIL  %s\n' "$test_fn"
  fi
}

# ---- shared preamble ----
_stub_preamble() {
  if ! $HAS_STUB_SERVER; then
    printf '  SKIPPED (stub homeserver requires python3)\n'
    return 1
  fi
  return 0
}

# ============================================================
# PHASE 133 D-01/D-05/D-06/D-07/D-08/D-09/D-10/D-12: ROLE CASCADE SCANNER
# ============================================================

# Test A — happy path: 2 identities holding the role, both retire cleanly, folder moves.
test_role_cascade_happy_path_2_identities() {
  _stub_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_role_scratch)
  local role="box-maintainer"
  fixture_role_folder "$scratch" "$role" --with-sentinel
  fixture_identity "$scratch" alpha --role "$role"
  fixture_identity "$scratch" beta  --role "$role"
  fixture_relay_json "$scratch/alpha" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@alpha:test" "pw" "tok"
  fixture_relay_json "$scratch/beta"  "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@beta:test"  "pw" "tok"
  start_stub_homeserver 200 || { teardown_role_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/alpha/relay.json"
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/beta/relay.json"

  local out
  out=$( _source_supervisor_with_roles "$scratch"
         scan_role_archive_requested_sentinels 2>&1 ) || true
  stop_stub_homeserver

  # Both identities gone from live tree, present in identity archive.
  assert_nofile "$scratch/alpha"          "happy path: alpha live folder must be gone"
  assert_nofile "$scratch/beta"           "happy path: beta live folder must be gone"
  assert_file   "${scratch}-archive/alpha" "happy path: alpha archive folder must exist"
  assert_file   "${scratch}-archive/beta"  "happy path: beta archive folder must exist"

  # Role folder gone from live tree, present in roles archive.
  assert_nofile "${scratch}-roles/$role"          "happy path: role folder must be gone from live tree"
  assert_file   "${scratch}-roles-archive/$role"  "happy path: role folder must exist in roles archive"

  # Sentinel deleted (travelled with mv, then cleanup rm).
  assert_nofile "${scratch}-roles/$role/.archive-requested"          "happy path: sentinel MUST NOT exist in live tree"
  assert_nofile "${scratch}-roles-archive/$role/.archive-requested"  "happy path: sentinel MUST NOT exist in roles archive"

  # Log traces.
  assert_grep "cascade: 2 identities hold this role" "$out" "happy path: enumeration log line for count=2"
  assert_grep "cascade complete: 2 identities retired, folder moved to archive" "$out" "happy path: completion log line"
  assert_nogrep "PARTIAL" "$out" "happy path: no PARTIAL cascade log line"

  teardown_role_scratch "$scratch"
}

# Test B — fail-soft partial: gamma retires cleanly (200), delta fails (500).
# Role folder retained, sentinel deleted, LOUD ERROR fires.
test_role_cascade_fail_soft_partial() {
  _stub_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_role_scratch)
  local role="doomed-role"
  fixture_role_folder "$scratch" "$role" --with-sentinel
  fixture_identity "$scratch" gamma --role "$role"
  fixture_identity "$scratch" delta --role "$role"

  # gamma → good stub (200)
  local good_log good_req_log good_pid good_port
  good_log=$(mktemp); good_req_log=$(mktemp)
  python3 -c "
import http.server, sys, socketserver
codes = [int(c) for c in sys.argv[1].split(',')]
port_file = sys.argv[2]
req_log = sys.argv[3]
counter = {'i': 0}
class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length > 0 else b''
        with open(req_log, 'ab') as f:
            f.write(('%s %d ' % (self.path, length)).encode('utf-8'))
            f.write(body.replace(b'\n', b' ')); f.write(b'\n')
        idx = min(counter['i'], len(codes) - 1); counter['i'] += 1
        self.send_response(codes[idx]); self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(b'{\"status\":\"ok\"}\n')
    def log_message(self, fmt, *args): pass
with socketserver.TCPServer(('127.0.0.1', 0), Handler) as server:
    port = server.server_address[1]
    with open(port_file, 'w') as f: f.write(str(port))
    server.serve_forever()
" "200" "$good_log" "$good_req_log" &
  good_pid=$!
  local waited=0
  while [ "$waited" -lt 50 ] && [ ! -s "$good_log" ]; do sleep 0.1; waited=$((waited + 1)); done
  good_port=$(cat "$good_log")

  # delta → bad stub (500) — retire_identity's inline retry will exhaust 3 attempts (~6s)
  local bad_log bad_req_log bad_pid bad_port
  bad_log=$(mktemp); bad_req_log=$(mktemp)
  python3 -c "
import http.server, sys, socketserver
codes = [int(c) for c in sys.argv[1].split(',')]
port_file = sys.argv[2]
req_log = sys.argv[3]
counter = {'i': 0}
class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length > 0 else b''
        with open(req_log, 'ab') as f:
            f.write(('%s %d ' % (self.path, length)).encode('utf-8'))
            f.write(body.replace(b'\n', b' ')); f.write(b'\n')
        idx = min(counter['i'], len(codes) - 1); counter['i'] += 1
        self.send_response(codes[idx]); self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(b'{\"status\":\"err\"}\n')
    def log_message(self, fmt, *args): pass
with socketserver.TCPServer(('127.0.0.1', 0), Handler) as server:
    port = server.server_address[1]
    with open(port_file, 'w') as f: f.write(str(port))
    server.serve_forever()
" "500" "$bad_log" "$bad_req_log" &
  bad_pid=$!
  waited=0
  while [ "$waited" -lt 50 ] && [ ! -s "$bad_log" ]; do sleep 0.1; waited=$((waited + 1)); done
  bad_port=$(cat "$bad_log")

  fixture_relay_json "$scratch/gamma" "http://127.0.0.1:$good_port/_matrix/client/v3" "@gamma:test" "pw" "tok"
  fixture_relay_json "$scratch/delta" "http://127.0.0.1:$bad_port/_matrix/client/v3"  "@delta:test" "pw" "tok"

  local out
  out=$( _source_supervisor_with_roles "$scratch"
         scan_role_archive_requested_sentinels 2>&1 ) || true

  # Cleanup the two stubs.
  kill "$good_pid" 2>/dev/null || true; wait "$good_pid" 2>/dev/null || true
  kill "$bad_pid"  2>/dev/null || true; wait "$bad_pid"  2>/dev/null || true
  rm -f "$good_log" "$good_req_log" "$bad_log" "$bad_req_log"

  # gamma retired cleanly.
  assert_nofile "$scratch/gamma"          "fail-soft: gamma live folder must be gone"
  assert_file   "${scratch}-archive/gamma" "fail-soft: gamma archive folder must exist"

  # delta stays put (retire_identity aborted at step 1 → folder not moved, sentinel retained per D-14).
  assert_file "$scratch/delta"           "fail-soft: delta live folder must remain (retire failed at step 1)"
  # Note: the .archive-requested sentinel inside the delta identity folder was never dropped
  # (retire_identity was invoked directly by the scanner, not via a per-identity sentinel).
  # No assertion here for delta/.archive-requested — the cascade path doesn't drop that.

  # Role folder retained in live tree (D-09).
  assert_file   "${scratch}-roles/$role"          "fail-soft: role folder must be retained in live tree"
  assert_nofile "${scratch}-roles-archive/$role"  "fail-soft: role folder MUST NOT be in roles archive"

  # Sentinel on the role folder deleted (D-06 always).
  assert_nofile "${scratch}-roles/$role/.archive-requested" "fail-soft: role sentinel MUST be deleted (D-06)"

  # LOUD ERROR log lines.
  assert_grep "cascade: 2 identities hold this role" "$out" "fail-soft: enumeration log line for count=2"
  assert_grep "ERROR: role '$role' cascade: identity 'delta' FAILED to retire" "$out" "fail-soft: per-identity ERROR log line for delta"
  assert_grep "ERROR: role '$role' cascade PARTIAL: 1/2 identities failed: delta" "$out" "fail-soft: PARTIAL cascade summary log line"
  assert_grep "Retry via UI" "$out" "fail-soft: log names retry mechanism"

  teardown_role_scratch "$scratch"
}

# Test C — empty cascade: zero identities hold the role, folder moves immediately (D-12).
test_role_cascade_empty_immediate_folder_move() {
  local scratch; scratch=$(setup_role_scratch)
  local role="orphan-role"
  fixture_role_folder "$scratch" "$role" --with-sentinel
  # Deliberately: no identities holding the role. (Two identities that hold OTHER roles
  # exist to prove the enumeration walk is happening + not accidentally matching.)
  fixture_identity "$scratch" bystander1 --role "other-role"
  fixture_identity "$scratch" bystander2 --role "unrelated"

  local out
  out=$( _source_supervisor_with_roles "$scratch"
         scan_role_archive_requested_sentinels 2>&1 ) || true

  # Role folder moved immediately.
  assert_nofile "${scratch}-roles/$role"          "empty cascade: role folder must be gone from live tree"
  assert_file   "${scratch}-roles-archive/$role"  "empty cascade: role folder must exist in roles archive"
  # Sentinel deleted.
  assert_nofile "${scratch}-roles/$role/.archive-requested"         "empty cascade: sentinel deleted from live tree"
  assert_nofile "${scratch}-roles-archive/$role/.archive-requested" "empty cascade: sentinel deleted from roles archive"
  # Bystanders untouched.
  assert_file "$scratch/bystander1" "empty cascade: bystander1 must be untouched"
  assert_file "$scratch/bystander2" "empty cascade: bystander2 must be untouched"

  # Log traces (D-12 degenerate empty cascade).
  assert_grep "cascade: 0 identities hold this role" "$out" "empty cascade: enumeration log line for count=0"
  assert_grep "cascade complete: 0 identities retired, folder moved to archive" "$out" "empty cascade: completion log line"

  teardown_role_scratch "$scratch"
}

# Test D — guard bypass: pinned + coordinator identity gets cascade-retired regardless (D-10).
test_role_cascade_guard_bypass() {
  _stub_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_role_scratch)
  local role="protected-role"
  fixture_role_folder "$scratch" "$role" --with-sentinel
  fixture_identity "$scratch" pinned-one --role "$role" --pinned --no-dormancy
  fixture_identity "$scratch" coord-one  --role "$role" --coordinator
  fixture_relay_json "$scratch/pinned-one" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@pinned-one:test" "pw" "tok"
  fixture_relay_json "$scratch/coord-one"  "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@coord-one:test"  "pw" "tok"
  start_stub_homeserver 200 || { teardown_role_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/pinned-one/relay.json"
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/coord-one/relay.json"

  # Sanity: fixture wrote the guards that D-10 says to bypass.
  assert_file "$scratch/pinned-one/.pinned"      "guard-bypass fixture: .pinned present"
  assert_file "$scratch/pinned-one/.no-dormancy" "guard-bypass fixture: .no-dormancy present"

  local out
  out=$( _source_supervisor_with_roles "$scratch"
         scan_role_archive_requested_sentinels 2>&1 ) || true
  stop_stub_homeserver

  # Both retired despite guards.
  assert_nofile "$scratch/pinned-one"           "guard-bypass: pinned-one live folder must be gone"
  assert_nofile "$scratch/coord-one"            "guard-bypass: coord-one live folder must be gone"
  assert_file   "${scratch}-archive/pinned-one" "guard-bypass: pinned-one archive folder must exist"
  assert_file   "${scratch}-archive/coord-one"  "guard-bypass: coord-one archive folder must exist"

  # Role folder moved.
  assert_file "${scratch}-roles-archive/$role" "guard-bypass: role folder moved to archive"

  # Log: 2 identities retired.
  assert_grep "cascade complete: 2 identities retired" "$out" "guard-bypass: completion log line count=2"

  teardown_role_scratch "$scratch"
}

# Test E — sentinel deleted even on full failure (D-06); scanner is a no-op on second invocation
# (fresh UI click needed for retry — D-11).
test_role_cascade_sentinel_deleted_on_full_failure() {
  _stub_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_role_scratch)
  local role="failing-role"
  fixture_role_folder "$scratch" "$role" --with-sentinel
  fixture_identity "$scratch" epsilon --role "$role"
  fixture_relay_json "$scratch/epsilon" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@epsilon:test" "pw" "tok"
  start_stub_homeserver 500 || { teardown_role_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/epsilon/relay.json"

  local out
  out=$( _source_supervisor_with_roles "$scratch"
         scan_role_archive_requested_sentinels 2>&1 ) || true

  # epsilon retire failed → live folder retained; role folder retained; sentinel DELETED.
  assert_file   "$scratch/epsilon"                                  "full-fail: epsilon live folder retained"
  assert_file   "${scratch}-roles/$role"                            "full-fail: role folder retained in live tree"
  assert_nofile "${scratch}-roles/$role/.archive-requested"         "full-fail: sentinel MUST be deleted (D-06)"
  assert_grep   "PARTIAL: 1/1" "$out"                               "full-fail: PARTIAL cascade log line for 1/1"

  # Second invocation with NO fresh sentinel → total no-op (D-11 retry semantic = fresh UI click).
  local out2
  out2=$( _source_supervisor_with_roles "$scratch"
          scan_role_archive_requested_sentinels 2>&1 ) || true
  assert_file "$scratch/epsilon"           "second-scan: epsilon still retained (no fresh sentinel → scanner no-op)"
  assert_file "${scratch}-roles/$role"     "second-scan: role folder still retained"
  assert_nogrep "cascade" "$out2"          "second-scan: no cascade log line without a sentinel"
  assert_nogrep "detected" "$out2"         "second-scan: no 'detected' log line without a sentinel"

  stop_stub_homeserver
  teardown_role_scratch "$scratch"
}

# Test F — no-op when no sentinel present.
test_scanner_noop_when_no_sentinel() {
  local scratch; scratch=$(setup_role_scratch)
  local role="some-role"
  # Role folder exists but NO .archive-requested sentinel.
  fixture_role_folder "$scratch" "$role"
  fixture_identity "$scratch" alpha --role "$role"
  fixture_identity "$scratch" beta  --role "$role"

  local out
  out=$( _source_supervisor_with_roles "$scratch"
         scan_role_archive_requested_sentinels 2>&1 ) || true

  # Role folder untouched.
  assert_file   "${scratch}-roles/$role"          "no-sentinel: role folder untouched in live tree"
  assert_nofile "${scratch}-roles-archive/$role"  "no-sentinel: role folder MUST NOT be in roles archive"

  # Identities untouched.
  assert_file "$scratch/alpha" "no-sentinel: alpha identity untouched"
  assert_file "$scratch/beta"  "no-sentinel: beta identity untouched"

  # No cascade log lines.
  assert_nogrep "cascade" "$out"           "no-sentinel: no cascade log line"
  assert_nogrep ".archive-requested detected" "$out" "no-sentinel: no 'detected' log line"

  teardown_role_scratch "$scratch"
}

# ============================================================
# IDENTITY_HAS_ROLE HELPER (Pitfall 2 substring-safety + quoted-variant + body-line)
# ============================================================

# Test G — substring safety: "role: foo" must NOT match against "foo-bar" (nor vice versa).
test_identity_has_role_substring_safety() {
  local scratch; scratch=$(setup_role_scratch)
  local f_foo="$scratch/f_foo.md"
  local f_foo_bar="$scratch/f_foo_bar.md"
  printf -- '---\nrole: foo\n---\nbody\n' > "$f_foo"
  printf -- '---\nrole: foo-bar\n---\nbody\n' > "$f_foo_bar"

  local rc
  # positive cases
  rc=0; ( _source_supervisor_with_roles "$scratch"; identity_has_role "$f_foo" "foo" ) || rc=$?
  assert_eq "0" "$rc" "substring-safety: identity_has_role foo file, want=foo → 0"

  rc=0; ( _source_supervisor_with_roles "$scratch"; identity_has_role "$f_foo_bar" "foo-bar" ) || rc=$?
  assert_eq "0" "$rc" "substring-safety: identity_has_role foo-bar file, want=foo-bar → 0"

  # negative cases (Pitfall 2 lock)
  rc=0; ( _source_supervisor_with_roles "$scratch"; identity_has_role "$f_foo_bar" "foo" ) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "substring-safety: 'role: foo-bar' MUST NOT match want=foo (Pitfall 2)"
  fi

  rc=0; ( _source_supervisor_with_roles "$scratch"; identity_has_role "$f_foo" "foo-bar" ) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "substring-safety: 'role: foo' MUST NOT match want=foo-bar (Pitfall 2)"
  fi

  teardown_role_scratch "$scratch"
}

# Test H — quoted variant: matches quoted forms AND emits a WARN fleet-drift signal.
test_identity_has_role_quoted_variant_warns() {
  local scratch; scratch=$(setup_role_scratch)
  local f_dq="$scratch/f_dq.md"
  local f_sq="$scratch/f_sq.md"
  printf -- '---\nrole: "quoted-role"\n---\nbody\n' > "$f_dq"
  printf -- "---\nrole: 'quoted-role'\n---\nbody\n"  > "$f_sq"

  local rc out
  # Double-quoted variant matches + emits WARN.
  rc=0
  out=$( _source_supervisor_with_roles "$scratch"; identity_has_role "$f_dq" "quoted-role" 2>&1 ) || rc=$?
  assert_eq "0" "$rc" "quoted-dq: identity_has_role double-quoted variant matches → 0"
  assert_grep "WARN" "$out"                     "quoted-dq: WARN log line fires"
  assert_grep "quoted role frontmatter" "$out"  "quoted-dq: WARN carries fleet-drift signal message"

  # Single-quoted variant matches + emits WARN.
  rc=0
  out=$( _source_supervisor_with_roles "$scratch"; identity_has_role "$f_sq" "quoted-role" 2>&1 ) || rc=$?
  assert_eq "0" "$rc" "quoted-sq: identity_has_role single-quoted variant matches → 0"
  assert_grep "WARN" "$out"                     "quoted-sq: WARN log line fires"

  teardown_role_scratch "$scratch"
}

# Test I — body-line ignored: "role: foo" in the body (after the second `---`) must NOT match.
test_identity_has_role_body_line_ignored() {
  local scratch; scratch=$(setup_role_scratch)
  local f_body="$scratch/f_body.md"
  printf -- '---\nrole: actual-role\n---\nrole: foo\n' > "$f_body"

  local rc
  # Body-line "role: foo" MUST NOT match — awk stops at the second `---` fence.
  rc=0; ( _source_supervisor_with_roles "$scratch"; identity_has_role "$f_body" "foo" ) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "body-line: body-prose 'role: foo' MUST NOT match (Pitfall 6 frontmatter-only discipline)"
  fi

  # Sanity: frontmatter role: actual-role DOES match.
  rc=0; ( _source_supervisor_with_roles "$scratch"; identity_has_role "$f_body" "actual-role" ) || rc=$?
  assert_eq "0" "$rc" "body-line sanity: frontmatter role match works normally"

  teardown_role_scratch "$scratch"
}

# ============================================================
# TEST MANIFEST
# ============================================================

# ─── Phase 133 D-01/D-05/D-06/D-07/D-08/D-09/D-10/D-12: role cascade scanner ───
run_test test_role_cascade_happy_path_2_identities
run_test test_role_cascade_fail_soft_partial
run_test test_role_cascade_empty_immediate_folder_move
run_test test_role_cascade_guard_bypass
run_test test_role_cascade_sentinel_deleted_on_full_failure
run_test test_scanner_noop_when_no_sentinel

# ─── identity_has_role helper (Pitfall 2 substring-safety + quoted-variant handling) ───
run_test test_identity_has_role_substring_safety
run_test test_identity_has_role_quoted_variant_warns
run_test test_identity_has_role_body_line_ignored

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
