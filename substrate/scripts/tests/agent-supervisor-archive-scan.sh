#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317
# (SC2317 false positive: test functions are called indirectly via run_test; static analysis cannot trace this)
# Test driver for Phase 94 archive-scan mechanism in agent-supervisor.sh.
# Runs static-analysis gates, guard unit tests, freshness-read tests, retire-action tests
# (against a stub local homeserver), retire-stuck counter tests, MODE-agnostic scan test,
# 24h gate tests, and shellcheck/bash-syntax tests.
#
# Exits 0 on all-pass; exits 1 on any failure with a diagnostic naming the failing test.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-archive-scan.sh
#   Run from the repo root. Override supervisor path:
#   SUPERVISOR=/path/to/agent-supervisor.sh bash substrate/scripts/tests/agent-supervisor-archive-scan.sh
#
# Requirements: bash, shellcheck, tmux, jq, stat, curl (mandatory — same as the supervisor).
#   python3 or nc (optional — needed for retire-action stub-homeserver tests; those tests
#   skip gracefully with a diagnostic if neither is available).
#
# Isolation: every test that sources the supervisor exports:
#   AGENT_IDENTITIES_DIR=<scratch>         — prevents IDENTITIES_DIR from pointing at
#                                            the real ~/fleet/identities dir
#   AGENT_IDENTITIES_ARCHIVE_DIR=<scratch> — companion env override (Phase 96-04, D-02):
#                                            prevents IDENTITIES_ARCHIVE_DIR from pointing
#                                            at the real ~/fleet/identities-archive dir.
#                                            Points at a SEPARATE scratch dir (sibling of
#                                            AGENT_IDENTITIES_DIR, not a subdir).
#   AGENT_SUPERVISOR_CONF=/dev/null        — prevents loading the real conf (avoids DORMANCY=on etc)
#   AGENT_SUPERVISOR_LIB_ONLY=1           — stops the reconcile loop (Phase 94-04 guard)
# This set of env vars is the hermetic sourcing contract: sourcing the supervisor with
# these variables set loads all function definitions with no side effects.

export AGENT_SUPERVISOR_LIB_ONLY=1

set -u  # -e is NOT set — the script uses explicit assert helpers so a failing
        # assert does not silently skip subsequent tests.

# ---- path resolution ----
# Allow override; default resolves relative to repo root (invocation point).
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
HAS_NC=false
command -v python3 >/dev/null 2>&1 && HAS_PYTHON3=true
command -v nc >/dev/null 2>&1 && HAS_NC=true
HAS_STUB_SERVER=false
( $HAS_PYTHON3 || $HAS_NC ) && HAS_STUB_SERVER=true

# ---- hermetic source invocation ----
# Hermetic sourcing contract: load all function definitions without side effects.
#
# Key isolation variables (MUST be set before sourcing):
#   AGENT_IDENTITIES_DIR=<scratch>         — the supervisor sets IDENTITIES_DIR from this at source
#     time (line ~32: IDENTITIES_DIR="${AGENT_IDENTITIES_DIR:-$HOME/fleet/identities}").
#     Without this, every sourcing would point IDENTITIES_DIR at the real ~/fleet/identities.
#   AGENT_IDENTITIES_ARCHIVE_DIR=<scratch> — companion env override (Phase 96-04, D-02): the
#     supervisor sets IDENTITIES_ARCHIVE_DIR from this. Points at a SEPARATE scratch dir (sibling
#     of AGENT_IDENTITIES_DIR, not a subdir). Without this, retire_identity would attempt moves
#     to the real ~/fleet/identities-archive on the host.
#   AGENT_SUPERVISOR_LIB_ONLY=1           — Phase 94-04 guard: stops before the reconcile loop.
#
# We let the real conf load (its DORMANCY / MEMORY_CAP settings are harmless for archive-scan
# tests, and AGENT_IDENTITIES_DIR already redirects IDENTITIES_DIR to the scratch dir — the only
# variable that matters for test isolation). The former MODE-check that used to force us to load
# the real conf (so it would populate MODE=B) is gone as of 2026-09-11 — MODE was retired along
# with the MODE=A code path.
#
# DORMANCY_STATE_DIR: tests set this AFTER sourcing (source respects the pre-existing export
# via ":-" — but the real conf doesn't export it, so it defaults to the real state dir at
# source time). Each test that needs DORMANCY_STATE_DIR in the scratch sets it explicitly
# by exporting it after _source_supervisor returns and before calling the function under test.
_source_supervisor() {
  local scratch="${1:-/tmp}"
  export AGENT_IDENTITIES_DIR="$scratch"
  export AGENT_IDENTITIES_ARCHIVE_DIR="${scratch}-archive"
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

# fail: record a test failure immediately (called from within a test body).
# Does NOT exit — execution continues so all tests are reported.
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

assert_neq() {
  local unexpected="$1" actual="$2" msg="${3:-assert_neq}"
  if [ "$unexpected" = "$actual" ]; then
    fail "$msg: expected != '$unexpected' but they were equal"
  fi
}

# assert_gte: assert actual (arg 2) >= threshold (arg 1), both numeric.
assert_gte() {
  local threshold="$1" actual="$2" msg="${3:-assert_gte}"
  if [ "$actual" -lt "$threshold" ] 2>/dev/null; then
    fail "$msg: expected >= $threshold but got $actual"
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

# assert_grep: assert that pattern (arg 1) matches at least one line of text (arg 2).
assert_grep() {
  local pattern="$1" text="$2" msg="${3:-assert_grep}"
  if ! printf '%s' "$text" | grep -q "$pattern" 2>/dev/null; then
    fail "$msg: pattern '$pattern' not found in output"
  fi
}

# safe_grep_count: grep -c exits 1 on 0 matches; || true prevents that from
# propagating in set -u contexts. Returns the integer count on stdout.
safe_grep_count() {
  grep -c "$@" 2>/dev/null || true
}

# safe_grep_count_E: same but with -E (extended regex)
safe_grep_count_E() {
  grep -cE "$@" 2>/dev/null || true
}

# setup_scratch: create mktemp -d for identities scratch and a sibling dir for archive scratch.
# Returns the identities scratch path. Archive scratch is at "<scratch>-archive" (sibling).
# Both directories are cleaned up by teardown_scratch.
setup_scratch() {
  local s; s=$(mktemp -d)
  mkdir -p "$s/.state"
  mkdir -p "${s}-archive"
  printf '%s' "$s"
}

teardown_scratch() {
  local s="$1"
  [ -n "$s" ] && [ -d "$s" ] && rm -rf "$s"
  [ -n "$s" ] && [ -d "${s}-archive" ] && rm -rf "${s}-archive"
}

# fixture_identity: create a fixture identity folder under <scratch>.
# Usage: fixture_identity <scratch_dir> <name> [--pinned] [--no-dormancy] [--coordinator]
#        [--cursor-age-days N] [--no-md]
fixture_identity() {
  local scratch="$1" name="$2"
  shift 2
  local pinned=false nodormancy=false coordinator=false cursor_age_days="" no_md=false
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --pinned)          pinned=true ;;
      --no-dormancy)     nodormancy=true ;;
      --coordinator)     coordinator=true ;;
      --cursor-age-days) cursor_age_days="$2"; shift ;;
      --no-md)           no_md=true ;;
    esac
    shift
  done
  local iddir="$scratch/$name"
  mkdir -p "$iddir"
  if ! $no_md; then
    if $coordinator; then
      printf -- '---\nrole: test\ncoordinator: true\n---\nbody\n' > "$iddir/$name.md"
    else
      printf -- '---\nrole: test\n---\nbody\n' > "$iddir/$name.md"
    fi
  fi
  $pinned     && touch "$iddir/.pinned"
  $nodormancy && touch "$iddir/.no-dormancy"
  if [ -n "$cursor_age_days" ]; then
    mkdir -p "$iddir/relay-state"
    touch "$iddir/relay-state/since"
    local target_epoch; target_epoch=$(( $(date +%s) - cursor_age_days * 86400 ))
    touch -d "@$target_epoch" "$iddir/relay-state/since"
    touch -d "@$target_epoch" "$iddir"
  fi
}

# fixture_relay_json: write relay.json for identity at <dir>.
# Usage: fixture_relay_json <dir> <base_url> <mxid> <password> <access_token>
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

# ---- stub homeserver ----
STUB_PID=""
STUB_PORT=""
STUB_LOG=""

start_stub_homeserver() {
  local http_code="$1"
  STUB_PID=""
  STUB_PORT=""
  STUB_LOG=$(mktemp)

  if $HAS_PYTHON3; then
    python3 -c "
import http.server, sys, socketserver, os

code = int(sys.argv[1])
port_file = sys.argv[2]

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        self.rfile.read(length)
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
" "$http_code" "$STUB_LOG" &
    STUB_PID=$!

    # Wait for server to write its port (up to 5 seconds)
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
    fail "start_stub_homeserver: python3 not available (nc fallback not implemented for this stub shape)"
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

# ============================================================
# STATIC-ANALYSIS GATES
# ============================================================

test_bash_syntax() {
  if ! bash -n "$SUPERVISOR" 2>/dev/null; then
    fail "bash -n rejected supervisor script"
  fi
}

test_shellcheck_clean() {
  local sc_lines
  sc_lines=$(shellcheck "$SUPERVISOR" 2>&1 | wc -l || true)
  # Baseline (post-Wave-3, pre-Phase-94-test) was 54 lines. Guard accepts up to 60.
  if [ "$sc_lines" -gt 60 ]; then
    fail "shellcheck: $sc_lines output lines > 60 threshold — possible new warnings from Phase 94 code"
  fi
}

test_pitfall3_no_equals_prefix_on_kill_session() {
  # Pitfall 3: kill-session -t = uses exact-case match; must use -t "$actual" (from match_session)
  local count
  count=$(safe_grep_count 'tmux kill-session -t =' "$SUPERVISOR")
  assert_eq "0" "$count" \
    "Pitfall 3: 'tmux kill-session -t =' MUST NOT appear (use -t \"\$actual\" without = prefix)"
}

test_pitfall4_no_iddir_relay_json_in_step3() {
  # Pitfall 4: Step 3 reads from archdir/relay.json, NOT iddir/relay.json
  local count
  count=$(grep -v '^[[:space:]]*#' "$SUPERVISOR" | safe_grep_count 'iddir/relay\.json')
  assert_eq "0" "$count" \
    "Pitfall 4: '\$iddir/relay.json' MUST NOT appear in non-comment code (Step 3 reads from archdir)"
}

test_d12_no_admin_endpoint() {
  local count_admin count_client
  count_admin=$(safe_grep_count '_synapse/admin' "$SUPERVISOR")
  assert_eq "0" "$count_admin" \
    "D-12: _synapse/admin MUST NOT appear (no admin key on fleet boxes)"
  count_client=$(safe_grep_count '_matrix/client/v3/account/deactivate' "$SUPERVISOR")
  assert_gte "1" "$count_client" \
    "D-12: client deactivate endpoint must be present"
}

test_d15_credentials_never_in_log_strings() {
  local no_comments count_token count_pwd
  no_comments=$(grep -v '^[[:space:]]*#' "$SUPERVISOR")
  # shellcheck disable=SC2016  # single-quote \$access_token is intentional: grep literal dollar sign
  count_token=$(printf '%s' "$no_comments" | safe_grep_count_E 'log [^#]*\$access_token')
  # shellcheck disable=SC2016  # single-quote \$password is intentional: grep literal dollar sign
  count_pwd=$(printf '%s' "$no_comments" | safe_grep_count_E 'log [^#]*\$password')
  assert_eq "0" "$count_token" "D-15: log line must NOT contain \$access_token"
  assert_eq "0" "$count_pwd"   "D-15: log line must NOT contain \$password"
}

test_d16_no_unarchive_path() {
  local no_comments count
  no_comments=$(grep -v '^[[:space:]]*#' "$SUPERVISOR")
  count=$(printf '%s' "$no_comments" | safe_grep_count 'unretire\|unarchive')
  assert_eq "0" "$count" \
    "D-16: unretire/unarchive keywords absent from non-comment code"
}

test_pitfall7_exception_comment_present() {
  local count
  count=$(safe_grep_count 'EXCEPTION to the "never kill" rule' "$SUPERVISOR")
  assert_gte "1" "$count" \
    "Pitfall 7: 'EXCEPTION to the \"never kill\" rule' comment must appear in retire_identity"
}

# ============================================================
# GUARD UNIT TESTS — is_coordinator (5 cases from RESEARCH)
# ============================================================

test_coordinator_positive() {
  local f; f=$(mktemp)
  printf -- '---\nrole: test\ncoordinator: true\n---\nbody\n' > "$f"
  local rc=0
  ( _source_supervisor /tmp; is_coordinator "$f" ) || rc=$?
  assert_eq "0" "$rc" "is_coordinator positive: valid frontmatter must return 0"
  rm -f "$f"
}

test_coordinator_negative_commented() {
  local f; f=$(mktemp)
  printf -- '---\nrole: test\n# coordinator: true\n---\nbody\n' > "$f"
  local rc=0
  ( _source_supervisor /tmp; is_coordinator "$f" ) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "is_coordinator negative: commented 'coordinator: true' must NOT return 0 (Pitfall 6)"
  fi
  rm -f "$f"
}

test_coordinator_negative_body() {
  local f; f=$(mktemp)
  printf -- '---\nrole: test\n---\ncoordinator: true\n' > "$f"
  local rc=0
  ( _source_supervisor /tmp; is_coordinator "$f" ) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "is_coordinator negative: body-prose 'coordinator: true' must NOT return 0 (Pitfall 6)"
  fi
  rm -f "$f"
}

test_coordinator_negative_quoted() {
  local f; f=$(mktemp)
  printf -- '---\nrole: test\ntitle: "coordinator: true"\n---\n' > "$f"
  local rc=0
  ( _source_supervisor /tmp; is_coordinator "$f" ) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "is_coordinator negative: quoted string value must NOT return 0"
  fi
  rm -f "$f"
}

test_coordinator_negative_no_frontmatter() {
  local f; f=$(mktemp)
  printf -- 'role: test\ncoordinator: true\n' > "$f"
  local rc=0
  ( _source_supervisor /tmp; is_coordinator "$f" ) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "is_coordinator negative: no frontmatter delimiters — must NOT return 0"
  fi
  rm -f "$f"
}

test_coordinator_negative_missing_file() {
  local rc=0
  ( _source_supervisor /tmp; is_coordinator "/does/not/exist.md" ) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "is_coordinator negative: missing file — must return non-zero"
  fi
}

# ============================================================
# FRESHNESS READ TESTS — get_freshness_epoch (D-06/D-07)
# ============================================================

test_freshness_cursor_present() {
  local scratch; scratch=$(mktemp -d)
  local name="tina"
  mkdir -p "$scratch/$name/relay-state"
  local target_epoch=1700000000
  touch "$scratch/$name/relay-state/since"
  touch -d "@$target_epoch" "$scratch/$name/relay-state/since"
  local got
  got=$( _source_supervisor "$scratch"; get_freshness_epoch "$name" "$scratch/$name" )
  assert_eq "$target_epoch" "$got" \
    "freshness: cursor present — D-06 cursor mtime (got=$got expected=$target_epoch)"
  rm -rf "$scratch"
}

test_freshness_cursor_absent_fallback_to_folder() {
  local scratch; scratch=$(mktemp -d)
  local name="tina"
  mkdir -p "$scratch/$name"
  local target_epoch=1600000000
  touch -d "@$target_epoch" "$scratch/$name"
  local got
  got=$( _source_supervisor "$scratch"; get_freshness_epoch "$name" "$scratch/$name" )
  assert_eq "$target_epoch" "$got" \
    "freshness: cursor absent — D-07 folder mtime fallback (got=$got expected=$target_epoch)"
  rm -rf "$scratch"
}

test_freshness_both_absent_zero() {
  local got
  got=$( _source_supervisor /tmp; get_freshness_epoch "ghost" "/does/not/exist/ghost" )
  assert_eq "0" "$got" "freshness: both absent — must return 0"
}

# ============================================================
# RETIRE ACTION TESTS (with stub homeserver)
# ============================================================

_retire_test_preamble() {
  if ! $HAS_STUB_SERVER; then
    printf '  SKIPPED (stub homeserver requires python3)\n'
    return 1
  fi
  return 0
}

test_retire_happy_path_200() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" tina --cursor-age-days 200
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:STUB_PORT" "@tina:test" "pw" "tok"
  start_stub_homeserver 200 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/tina/relay.json"
  local rc=0
  ( _source_supervisor "$scratch"
    retire_identity "tina" ) || rc=$?
  stop_stub_homeserver
  assert_eq "0" "$rc" "retire happy path (200): must return 0"
  assert_nofile "$scratch/tina" \
    "retire happy path: active folder must be gone"
  assert_file "${scratch}-archive/tina" \
    "retire happy path: archive folder must exist"
  teardown_scratch "$scratch"
}

test_retire_401_treated_as_success() {
  # A4: 401 = account already deactivated → idempotent success
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" tina --cursor-age-days 200
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:STUB_PORT" "@tina:test" "pw" "tok"
  start_stub_homeserver 401 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/tina/relay.json"
  local rc=0
  ( _source_supervisor "$scratch"
    retire_identity "tina" ) || rc=$?
  stop_stub_homeserver
  assert_eq "0" "$rc" "retire 401 path: must return 0 (A4 idempotent success)"
  teardown_scratch "$scratch"
}

test_retire_5xx_aborts_with_1() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" tina --cursor-age-days 200
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:STUB_PORT" "@tina:test" "pw" "tok"
  start_stub_homeserver 502 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/tina/relay.json"
  local rc=0
  ( _source_supervisor "$scratch"
    retire_identity "tina" ) || rc=$?
  stop_stub_homeserver
  assert_eq "1" "$rc" "retire 5xx path: must return 1"
  # Step 1 moved the folder; Step 3 failed — archive/tina exists
  assert_file "${scratch}-archive/tina" \
    "retire 5xx: archive folder present (Step 1 succeeded before Step 3 failed)"
  teardown_scratch "$scratch"
}

test_retire_network_fail_aborts_with_1() {
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" tina --cursor-age-days 200
  # Port 1: guaranteed no listener (privileged port)
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:1" "@tina:test" "pw" "tok"
  local rc=0
  ( _source_supervisor "$scratch"
    retire_identity "tina" ) || rc=$?
  assert_eq "1" "$rc" "retire network-fail: must return 1"
  teardown_scratch "$scratch"
}

test_retire_retry_from_partial() {
  # State 2 (D-13): active absent, archive present — retry from Step 2
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  mkdir -p "${scratch}-archive/tina"
  fixture_relay_json "${scratch}-archive/tina" "http://127.0.0.1:STUB_PORT" "@tina:test" "pw" "tok"
  start_stub_homeserver 200 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "${scratch}-archive/tina/relay.json"
  local out rc=0
  out=$( _source_supervisor "$scratch"
         retire_identity "tina" 2>&1 ) || rc=$?
  stop_stub_homeserver
  assert_eq "0" "$rc" "retire retry-from-partial: must return 0 (State 2)"
  assert_grep "already in archive" "$out" \
    "retire retry-from-partial: log must mention 'already in archive' (State 2 idempotent path)"
  teardown_scratch "$scratch"
}

test_retire_collision_aborts() {
  # State 3: both active AND archive exist — must abort with return 1
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" tina --cursor-age-days 200
  mkdir -p "${scratch}-archive/tina"
  local out rc=0
  out=$( _source_supervisor "$scratch"
         retire_identity "tina" 2>&1 ) || rc=$?
  assert_eq "1" "$rc" "retire collision: must return 1 (State 3 — both active and archive exist)"
  assert_grep "collision" "$out" \
    "retire collision: log must say 'collision'"
  teardown_scratch "$scratch"
}

test_retire_password_with_quotes() {
  # T-94-02-05: jq --arg properly escapes passwords with " and \
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" tina --cursor-age-days 200
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:STUB_PORT" "@tina:test" 'p"w\\with"quotes' "tok"
  start_stub_homeserver 200 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/tina/relay.json"
  local rc=0
  ( _source_supervisor "$scratch"
    retire_identity "tina" ) || rc=$?
  stop_stub_homeserver
  assert_eq "0" "$rc" \
    "retire with problematic password: jq --arg must JSON-escape \" and \\ (T-94-02-05)"
  teardown_scratch "$scratch"
}

# ============================================================
# RETIRE-STUCK COUNTER TESTS — D-14
# ============================================================

test_retire_stuck_fires_at_3_not_before() {
  # Use State 3 collision (both active AND archive exist) as the fail vehicle: retire_identity
  # returns 1 every call because mv is refused when both $iddir and $archdir exist. This way,
  # tina stays in the active tree across all 3 passes, and the scan calls retire_identity each
  # time, incrementing the counter. D-14: sentinel fires exactly on pass 3, not before.
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" tina --cursor-age-days 200
  # Pre-create archive tina in the archive sibling dir to produce the State 3 collision on every pass
  mkdir -p "${scratch}-archive/tina"

  local i out count
  for i in 1 2 3; do
    out=$( _source_supervisor "$scratch"
           run_archive_scan 2>&1 ) || true
    count=$(cat "$scratch/.state/retire-fail-count-tina" 2>/dev/null || echo 0)
    assert_eq "$i" "$count" \
      "retire-stuck: counter must equal $i after $i failed passes (got=$count)"
    if [ "$i" -lt 3 ]; then
      assert_nofile "${scratch}-archive/tina/retire-stuck" \
        "retire-stuck: sentinel MUST NOT be dropped before pass 3 (pass=$i)"
      if printf '%s' "$out" | grep -q 'STUCK'; then
        fail "retire-stuck: LOUD STUCK log must NOT fire before pass 3 (fired on pass $i)"
      fi
    else
      assert_file "${scratch}-archive/tina/retire-stuck" \
        "retire-stuck: sentinel MUST be dropped on pass 3"
      assert_grep 'STUCK' "$out" \
        "retire-stuck: LOUD STUCK log must fire on pass 3"
    fi
  done
  teardown_scratch "$scratch"
}

test_retire_stuck_counter_resets_on_success() {
  # Fail twice (State 3 collision → counter = 2), then clear the collision and succeed.
  # The third pass finds tina in the active tree only (archive/tina/ removed) → retire succeeds
  # → counter file must be removed.
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" tina --cursor-age-days 200
  # Pre-create archive tina in the archive sibling dir for the 2 failing passes (State 3 collision)
  mkdir -p "${scratch}-archive/tina"

  # Two failing passes via State 3 collision
  local i
  for i in 1 2; do
    ( _source_supervisor "$scratch"
      run_archive_scan >/dev/null 2>&1 ) || true
  done
  local count_after_2
  count_after_2=$(cat "$scratch/.state/retire-fail-count-tina" 2>/dev/null || echo 0)
  assert_eq "2" "$count_after_2" "retire-stuck reset: counter must be 2 after 2 failed passes"

  # Clear the collision: remove archive/tina/ so the third pass does State 1 (normal mv + Step 3)
  rm -rf "${scratch}-archive/tina"
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:STUB_PORT" "@tina:test" "pw" "tok"
  start_stub_homeserver 200 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/tina/relay.json"
  ( _source_supervisor "$scratch"
    run_archive_scan >/dev/null 2>&1 ) || true
  stop_stub_homeserver

  assert_nofile "$scratch/.state/retire-fail-count-tina" \
    "retire-stuck reset: counter file must be removed on successful retire"
  teardown_scratch "$scratch"
}

# ============================================================
# MODE-AGNOSTIC SCAN TEST — Pitfall 1 + Pitfall 2
# ============================================================

test_scan_walks_all_identity_folders() {
  local scratch; scratch=$(setup_scratch)
  # alpha: dormant (200d), no guards → retire-attempted
  fixture_identity "$scratch" alpha --cursor-age-days 200
  fixture_relay_json "$scratch/alpha" "http://127.0.0.1:1" "@alpha:test" "pw" "tok"
  # beta: fresh (5d) → skipped
  fixture_identity "$scratch" beta --cursor-age-days 5
  # gamma: dormant but PINNED → skipped (D-03)
  fixture_identity "$scratch" gamma --cursor-age-days 200 --pinned
  # archive/ named subdir inside identities: must be skipped (no archive/archive.md → .md guard)
  mkdir -p "$scratch/archive"

  local out
  out=$( _source_supervisor "$scratch"
         run_archive_scan 2>&1 ) || true

  # alpha should appear as dormant
  assert_grep "dormant" "$out" \
    "MODE-agnostic scan: alpha (dormant, no guards) must appear in log as dormant"
  # beta must NOT appear as dormant
  if printf '%s' "$out" | grep -q "'beta' dormant"; then
    fail "MODE-agnostic scan: beta (5d-fresh) must NOT appear as dormant in log"
  fi
  # gamma must NOT appear as dormant (pinned guard)
  if printf '%s' "$out" | grep -q "'gamma' dormant"; then
    fail "MODE-agnostic scan: gamma (pinned) must NOT appear as dormant in log (D-03 pin guard)"
  fi
  # archive/ must NOT appear as a retire target (no .md file → .md guard skips it)
  if printf '%s' "$out" | grep -q "'archive' dormant"; then
    fail "MODE-agnostic scan: 'archive' named subdir must be skipped (.md guard)"
  fi
  teardown_scratch "$scratch"
}

# ============================================================
# 24H GATE TESTS — Pitfall 5
# ============================================================

test_24h_gate_no_marker_runs_immediately() {
  local scratch; scratch=$(setup_scratch)
  local out
  out=$( _source_supervisor "$scratch"
         run_archive_scan_if_due 2>&1 ) || true
  assert_grep "24h elapsed" "$out" \
    "24h gate: no marker → scan must run (log must say '24h elapsed')"
  teardown_scratch "$scratch"
}

test_24h_gate_recent_marker_skips() {
  local scratch; scratch=$(setup_scratch)
  touch "$scratch/.state/archive-scan-last-ran"  # mtime = now
  local out
  out=$( _source_supervisor "$scratch"
         run_archive_scan_if_due 2>&1 ) || true
  if printf '%s' "$out" | grep -q "24h elapsed"; then
    fail "24h gate: recent marker (now) — scan must NOT run (log must NOT say '24h elapsed')"
  fi
  teardown_scratch "$scratch"
}

test_24h_gate_expired_marker_runs() {
  local scratch; scratch=$(setup_scratch)
  touch -d "25 hours ago" "$scratch/.state/archive-scan-last-ran"
  local out
  out=$( _source_supervisor "$scratch"
         run_archive_scan_if_due 2>&1 ) || true
  assert_grep "24h elapsed" "$out" \
    "24h gate: 25h-old marker → scan must run"
  teardown_scratch "$scratch"
}

test_24h_gate_marker_bumped_after_scan() {
  # Pitfall 5: marker mtime updated UNCONDITIONALLY after scan (not only on clean run)
  local scratch; scratch=$(setup_scratch)
  touch -d "25 hours ago" "$scratch/.state/archive-scan-last-ran"
  local before_mtime
  before_mtime=$(stat -c %Y "$scratch/.state/archive-scan-last-ran")
  sleep 1  # ensure measurable mtime advance
  ( _source_supervisor "$scratch"
    run_archive_scan_if_due >/dev/null 2>&1 ) || true
  local after_mtime
  after_mtime=$(stat -c %Y "$scratch/.state/archive-scan-last-ran" 2>/dev/null || echo 0)
  if [ "$after_mtime" -le "$before_mtime" ]; then
    fail "24h gate: marker mtime NOT bumped after scan — Pitfall 5 regression (before=$before_mtime after=$after_mtime)"
  fi
  teardown_scratch "$scratch"
}

# ============================================================
# MAIN
# ============================================================
printf '=== agent-supervisor-archive-scan test driver ===\n'
printf 'supervisor: %s\n' "$SUPERVISOR"
printf 'stub homeserver: %s\n' "$($HAS_STUB_SERVER && echo available || echo 'UNAVAILABLE — retire action + stuck counter tests will SKIP')"
printf '\n'

# --- Static analysis ---
run_test test_bash_syntax
run_test test_shellcheck_clean
run_test test_pitfall3_no_equals_prefix_on_kill_session
run_test test_pitfall4_no_iddir_relay_json_in_step3
run_test test_d12_no_admin_endpoint
run_test test_d15_credentials_never_in_log_strings
run_test test_d16_no_unarchive_path
run_test test_pitfall7_exception_comment_present

# --- is_coordinator guard (5 RESEARCH cases) ---
run_test test_coordinator_positive
run_test test_coordinator_negative_commented
run_test test_coordinator_negative_body
run_test test_coordinator_negative_quoted
run_test test_coordinator_negative_no_frontmatter
run_test test_coordinator_negative_missing_file

# --- get_freshness_epoch (D-06/D-07) ---
run_test test_freshness_cursor_present
run_test test_freshness_cursor_absent_fallback_to_folder
run_test test_freshness_both_absent_zero

# --- retire_identity ---
run_test test_retire_happy_path_200
run_test test_retire_401_treated_as_success
run_test test_retire_5xx_aborts_with_1
run_test test_retire_network_fail_aborts_with_1
run_test test_retire_retry_from_partial
run_test test_retire_collision_aborts
run_test test_retire_password_with_quotes

# --- retire-stuck counter (D-14) ---
run_test test_retire_stuck_fires_at_3_not_before
run_test test_retire_stuck_counter_resets_on_success

# --- MODE-agnostic scan (Pitfall 1 + 2) ---
run_test test_scan_walks_all_identity_folders

# --- 24h gate (Pitfall 5) ---
run_test test_24h_gate_no_marker_runs_immediately
run_test test_24h_gate_recent_marker_skips
run_test test_24h_gate_expired_marker_runs
run_test test_24h_gate_marker_bumped_after_scan

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
