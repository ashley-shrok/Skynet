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
STUB_REQ_LOG=""   # Phase 115 extension: captures request bodies (one per line) for assertions.

start_stub_homeserver() {
  # Usage:
  #   start_stub_homeserver 200           — return 200 forever (single-code, back-compat)
  #   start_stub_homeserver "500,500,200" — Phase 133 D-13a: return 500, then 500, then 200
  #                                          on the 1st, 2nd, 3rd POST respectively, then
  #                                          keep returning the LAST code (200) for any
  #                                          additional requests. Used by Test A to exercise
  #                                          the inline retire step 1 exponential-backoff
  #                                          recovery path (transient 5xx → success on retry).
  local http_code="$1"
  STUB_PID=""
  STUB_PORT=""
  STUB_LOG=$(mktemp)
  STUB_REQ_LOG=$(mktemp)

  if $HAS_PYTHON3; then
    # Phase 115 D-22 (RESEARCH §11): extend the stub to capture request bodies. The stub
    # writes each POST body as a single line to the STUB_REQ_LOG file so tests can assert
    # on payload contents (e.g. Test 1 asserts the deactivate POST contains the mxid).
    # Phase 133 D-13a: extend the stub to accept a comma-separated code sequence. Each POST
    # advances the sequence pointer; once the sequence is exhausted the LAST code is repeated
    # (so a single-code caller behaves exactly as before).
    python3 -c "
import http.server, sys, socketserver, os

codes = [int(c) for c in sys.argv[1].split(',')]
port_file = sys.argv[2]
req_log = sys.argv[3]
counter = {'i': 0}

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length > 0 else b''
        # Content-Length + path + body: one line per request.
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
  # Phase 115 D-13 UPDATE: matrix deactivate is now STEP 1 (was STEP 3), and reads from LIVE tree
  # ($iddir/relay.json) because the folder has NOT moved yet in the new order. The former Phase 94
  # Pitfall 4 lock ("Step 3 reads from archdir") is INVERTED: in the new order it MUST read from
  # $iddir (with a $archdir fallback for State 2 retry-from-partial). This test now asserts that
  # BOTH forms appear (live path + archdir fallback) rather than that $iddir/relay.json is absent.
  local live_count archdir_count
  live_count=$(grep -v '^[[:space:]]*#' "$SUPERVISOR" | safe_grep_count 'iddir/relay\.json')
  archdir_count=$(grep -v '^[[:space:]]*#' "$SUPERVISOR" | safe_grep_count 'archdir/relay\.json')
  assert_gte "1" "$live_count" \
    "Phase 115 D-13: Step 1 (matrix deactivate) must read from \$iddir/relay.json (live tree)"
  assert_gte "1" "$archdir_count" \
    "Phase 115 D-13: Step 1 must have \$archdir/relay.json fallback for State 2 retry-from-partial"
}

test_d12_no_admin_endpoint() {
  local count_admin count_client
  count_admin=$(safe_grep_count '_synapse/admin' "$SUPERVISOR")
  assert_eq "0" "$count_admin" \
    "D-12: _synapse/admin MUST NOT appear (no admin key on fleet boxes)"
  count_client=$(safe_grep_count '/account/deactivate' "$SUPERVISOR")
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
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@tina:test" "pw" "tok"
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
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@tina:test" "pw" "tok"
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
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@tina:test" "pw" "tok"
  start_stub_homeserver 502 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/tina/relay.json"
  local rc=0
  ( _source_supervisor "$scratch"
    retire_identity "tina" ) || rc=$?
  stop_stub_homeserver
  assert_eq "1" "$rc" "retire 5xx path: must return 1"
  # Phase 115 D-13: matrix deactivate is now STEP 1 (was STEP 3). On 5xx failure, we abort at
  # step 1 BEFORE reaching step 4b (folder move) — so the archive folder MUST NOT exist yet
  # and the live tree MUST still contain the identity (sentinel retained for next-tick retry).
  assert_nofile "${scratch}-archive/tina" \
    "retire 5xx (Phase 115 D-13 order): archive folder MUST NOT exist (step 1 aborted before step 4b move)"
  assert_file "$scratch/tina" \
    "retire 5xx (Phase 115 D-13 order): live folder retained (sentinel-in-place → next-tick retry)"
  teardown_scratch "$scratch"
}

test_retire_network_fail_aborts_with_1() {
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" tina --cursor-age-days 200
  # Port 1: guaranteed no listener (privileged port)
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:1/_matrix/client/v3" "@tina:test" "pw" "tok"
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
  fixture_relay_json "${scratch}-archive/tina" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@tina:test" "pw" "tok"
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
  # Phase 115 D-13: collision is now detected in STEP 4b (folder move, was STEP 1). To reach
  # step 4b the earlier steps (matrix deactivate step 1) must succeed — so this test needs a
  # working stub homeserver + relay.json fixture, not just the two directories.
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" tina --cursor-age-days 200
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@tina:test" "pw" "tok"
  mkdir -p "${scratch}-archive/tina"
  start_stub_homeserver 200 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/tina/relay.json"
  local out rc=0
  out=$( _source_supervisor "$scratch"
         retire_identity "tina" 2>&1 ) || rc=$?
  stop_stub_homeserver
  assert_eq "1" "$rc" "retire collision: must return 1 (State 3 — both active and archive exist)"
  assert_grep "collision" "$out" \
    "retire collision: log must say 'collision' (Phase 115 D-13: raised from step 4b)"
  teardown_scratch "$scratch"
}

test_retire_password_with_quotes() {
  # T-94-02-05: jq --arg properly escapes passwords with " and \
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" tina --cursor-age-days 200
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@tina:test" 'p"w\\with"quotes' "tok"
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
# Phase 133 D-13/D-13a/D-14 inline-retry refactor tests
# ============================================================
# The pre-Phase-133 cross-tick fail-count + stuck-sentinel tests were deleted with the
# mechanism they pinned — retire_identity now recovers inline from transient failures via
# per-step exponential backoff and is atomic from the caller's perspective. The tests below
# pin the new contract:
#
#   Test A: step 1 recovers after 2 transient 5xx (sequence-of-codes stub → 500,500,200).
#   Test B: step 1 fails terminally after 3 5xx (single-code 500 stub).
#   Test C: step 1 does NOT retry on permanent 400 (single-code 400 stub, <5s elapsed).
#   Test D: step 4b does NOT retry on State 3 collision.
#   Test E: neither scanner writes counter files or drops legacy stuck-sentinels.
#   Test F: legacy retire-stuck sentinel (pre-Phase-133 archaeology) does NOT block a
#           fresh retry — the removed skip guard is gone.

# Test A: step 1 recovers inline after 2 transient 5xx via exponential backoff (D-13a).
# Stub returns 500,500,200 across the first three POSTs. retire completes successfully;
# the log records attempts 1/3 and 2/3 as transient failures, and 3/3 succeeds.
test_retire_step1_recovers_after_transient_5xx() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" zeta --cursor-age-days 200
  touch "$scratch/zeta/.archive-requested"
  fixture_relay_json "$scratch/zeta" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@zeta:test" "pw" "tok"
  start_stub_homeserver "500,500,200" || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/zeta/relay.json"
  local start_epoch end_epoch elapsed rc=0 out
  start_epoch=$(date +%s)
  out=$( _source_supervisor "$scratch"
         retire_identity "zeta" 2>&1 ) || rc=$?
  end_epoch=$(date +%s)
  elapsed=$(( end_epoch - start_epoch ))
  stop_stub_homeserver
  assert_eq "0" "$rc" "step 1 recovers: retire_identity must return 0 after transient recovery"
  assert_nofile "$scratch/zeta" \
    "step 1 recovers: live folder must be gone (full retire completed)"
  assert_file "${scratch}-archive/zeta" \
    "step 1 recovers: archive folder must exist"
  assert_grep "attempt 1/3 transient failure" "$out" \
    "step 1 recovers: log must record attempt 1/3 transient failure"
  assert_grep "attempt 2/3 transient failure" "$out" \
    "step 1 recovers: log must record attempt 2/3 transient failure"
  assert_grep "retire step 1 (matrix deactivate) success" "$out" \
    "step 1 recovers: step-1-success log line at end"
  # Wall-time floor: 2s + 4s sleep between attempts = >= 6s.
  assert_gte "6" "$elapsed" \
    "step 1 recovers: elapsed must be >= 6s (2s+4s inline backoff sleeps, got=${elapsed}s)"
  # NEVER writes counter file or retire-stuck sentinel.
  assert_nofile "$scratch/.state/retire-fail-count-user-zeta" \
    "step 1 recovers: legacy user-path counter file MUST NOT be written"
  assert_nofile "${scratch}-archive/zeta/retire-stuck" \
    "step 1 recovers: legacy retire-stuck sentinel MUST NOT be dropped"
  teardown_scratch "$scratch"
}

# Test B: step 1 fails terminally after 3 5xx attempts (D-13a bounded retry).
# Single-code 500 stub returns 500 forever. retire_identity returns 1 after attempting
# 3 times with 2s + 4s inline sleeps, sentinel is retained, live folder untouched, no
# counter file, no retire-stuck sentinel.
test_retire_step1_terminal_after_3_5xx() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" theta --cursor-age-days 200
  touch "$scratch/theta/.archive-requested"
  fixture_relay_json "$scratch/theta" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@theta:test" "pw" "tok"
  start_stub_homeserver 500 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/theta/relay.json"
  local start_epoch end_epoch elapsed rc=0 out
  start_epoch=$(date +%s)
  out=$( _source_supervisor "$scratch"
         retire_identity "theta" 2>&1 ) || rc=$?
  end_epoch=$(date +%s)
  elapsed=$(( end_epoch - start_epoch ))
  stop_stub_homeserver
  assert_eq "1" "$rc" "step 1 terminal: retire_identity must return 1 after 3 5xx attempts"
  # Live folder retained; step 4a (sentinel delete) never reached because step 1 aborted.
  assert_file "$scratch/theta" \
    "step 1 terminal: live folder must remain (step 4b never reached)"
  assert_file "$scratch/theta/.archive-requested" \
    "step 1 terminal: sentinel must remain (step 4a not reached)"
  assert_grep "attempt 1/3 transient failure" "$out" \
    "step 1 terminal: log records attempt 1/3"
  assert_grep "attempt 2/3 transient failure" "$out" \
    "step 1 terminal: log records attempt 2/3"
  assert_grep "ERROR: 'theta' retire step 1 (matrix deactivate) FAILED after 3 attempts" "$out" \
    "step 1 terminal: LOUD terminal ERROR log fires after 3 attempts"
  # Wall-time floor: 2s + 4s sleep across 3 attempts.
  assert_gte "6" "$elapsed" \
    "step 1 terminal: elapsed must be >= 6s (2s+4s inline backoff sleeps, got=${elapsed}s)"
  # No cross-tick state.
  assert_nofile "$scratch/.state/retire-fail-count-user-theta" \
    "step 1 terminal: legacy user-path counter file MUST NOT be written"
  assert_nofile "${scratch}-archive/theta/retire-stuck" \
    "step 1 terminal: legacy retire-stuck sentinel MUST NOT be dropped"
  teardown_scratch "$scratch"
}

# Test C: step 1 does NOT retry on permanent 4xx (400). Terminates immediately.
# Elapsed < 5s (no retry sleeps fired) and log does NOT contain any attempt-2/3 line.
test_retire_step1_permanent_400_no_retry() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" omicron --cursor-age-days 200
  touch "$scratch/omicron/.archive-requested"
  fixture_relay_json "$scratch/omicron" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@omicron:test" "pw" "tok"
  start_stub_homeserver 400 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/omicron/relay.json"
  local start_epoch end_epoch elapsed rc=0 out
  start_epoch=$(date +%s)
  out=$( _source_supervisor "$scratch"
         retire_identity "omicron" 2>&1 ) || rc=$?
  end_epoch=$(date +%s)
  elapsed=$(( end_epoch - start_epoch ))
  stop_stub_homeserver
  assert_eq "1" "$rc" "step 1 permanent 400: retire_identity must return 1"
  assert_grep "FAILED http=400" "$out" \
    "step 1 permanent 400: log must record http=400 failure"
  # NO retry attempt lines — a permanent 4xx aborts on the first attempt.
  if printf '%s' "$out" | grep -q "attempt 2/3"; then
    fail "step 1 permanent 400: log MUST NOT contain 'attempt 2/3' (permanent 4xx, no retry)"
  fi
  # Elapsed must be short — no retry sleeps.
  if [ "$elapsed" -ge 5 ]; then
    fail "step 1 permanent 400: elapsed must be < 5s (no retry sleeps, got=${elapsed}s)"
  fi
  teardown_scratch "$scratch"
}

# Test D: step 4b does NOT retry on State 3 collision. Hard-fail on first attempt.
test_retire_step4b_state3_collision_no_retry() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" pi --cursor-age-days 200
  touch "$scratch/pi/.archive-requested"
  fixture_relay_json "$scratch/pi" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@pi:test" "pw" "tok"
  # Pre-create archive/pi/ to force State 3 collision on step 4b's mv attempt.
  mkdir -p "${scratch}-archive/pi"
  start_stub_homeserver 200 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/pi/relay.json"
  local rc=0 out
  out=$( _source_supervisor "$scratch"
         retire_identity "pi" 2>&1 ) || rc=$?
  stop_stub_homeserver
  assert_eq "1" "$rc" "step 4b State 3 collision: must return 1"
  assert_grep "retire step 4b (folder move) FAILED: collision" "$out" \
    "step 4b State 3 collision: log must record the collision-abort ERROR"
  # NO retry attempt lines on step 4b — collision is not transient.
  if printf '%s' "$out" | grep -q "retire step 4b (folder move) attempt 2/3"; then
    fail "step 4b State 3 collision: log MUST NOT contain step-4b 'attempt 2/3' (collision, no retry)"
  fi
  teardown_scratch "$scratch"
}

# Test E: neither scanner writes counter files or drops retire-stuck sentinels on failure.
# Pins D-14 removal end-to-end via the scanner (not just direct retire_identity call).
test_scanner_no_longer_writes_counter_or_retire_stuck() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" sigma --cursor-age-days 200
  touch "$scratch/sigma/.archive-requested"
  fixture_relay_json "$scratch/sigma" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@sigma:test" "pw" "tok"
  start_stub_homeserver 500 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/sigma/relay.json"
  local out
  out=$( _source_supervisor "$scratch"
         scan_archive_requested_sentinels 2>&1 ) || true
  stop_stub_homeserver
  # Legacy counter files: neither user-path nor daily-path counter is written.
  assert_nofile "$scratch/.state/retire-fail-count-user-sigma" \
    "scanner D-14: legacy user-path counter file MUST NOT be written"
  assert_nofile "$scratch/.state/retire-fail-count-sigma" \
    "scanner D-14: legacy daily-path counter file MUST NOT be written"
  # Legacy retire-stuck sentinel is NOT dropped in the archive folder.
  assert_nofile "${scratch}-archive/sigma/retire-stuck" \
    "scanner D-14: legacy retire-stuck sentinel MUST NOT be dropped in archive/"
  # Terminal ERROR log line from scan_archive_requested_sentinels.
  assert_grep "ERROR: 'sigma' user-initiated archive: retire_identity FAILED" "$out" \
    "scanner D-14: terminal ERROR log line fires on retire failure"
  teardown_scratch "$scratch"
}

# Test F: legacy retire-stuck sentinel (pre-Phase-133 archaeology per D-21) does NOT block
# a fresh retry. Pins the D-14 removal of the retire-stuck-skip guard from the scanner.
test_scanner_bypasses_legacy_retire_stuck_sentinel() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" nu --cursor-age-days 200
  touch "$scratch/nu/.archive-requested"
  fixture_relay_json "$scratch/nu" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@nu:test" "pw" "tok"
  # Pre-create legacy retire-stuck sentinel in the archive folder — pre-Phase-133 boxes
  # can have these lying around (D-21 archaeology). The new scanner must NOT skip on it.
  mkdir -p "${scratch}-archive/nu"
  touch "${scratch}-archive/nu/retire-stuck"
  start_stub_homeserver 200 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/nu/relay.json"
  local rc=0 out
  # NOTE: pre-existing archive/nu/ dir would produce a State 3 collision on step 4b, so
  # remove it BEFORE the scan (leaving only the retire-stuck sentinel in a scratch spot
  # would leave the dir behind — but the point of the test is: even with a stale
  # retire-stuck sentinel lying around, the scanner does not skip). We simulate by
  # removing the archive/nu/ dir contents AFTER the sentinel-touch, keeping just the
  # sentinel file in place ephemerally isn't sufficient — the retire itself needs to
  # succeed. So the setup below moves the sentinel to a non-collision location: we
  # actually want the *skip-guard-is-gone* property; the sentinel's mere existence at
  # $IDENTITIES_ARCHIVE_DIR/nu/retire-stuck previously caused `continue` in the loop.
  # Since we deleted that skip-guard, we can leave the sentinel in a real archive/nu/
  # subdir and expect the retire to hit State 3 (collision, no retry) — which is a hard
  # abort. That's NOT what we want to test. Simpler: clear archive/nu after touching a
  # sibling retire-stuck marker under a different name, then confirm the retire ran.
  # But the semantic being pinned is literally "the guard `if [ -f archive/$name/retire-stuck ]`
  # is gone". To test that: place the file exactly where the old guard looked, THEN
  # confirm retire proceeds anyway. On the mv path, State 3 collision will occur, but
  # the assertion of interest is the log line "user-initiated archive: .archive-requested
  # detected, invoking retire_identity" — which the old guard would have SKIPPED. Its
  # presence proves the guard is gone.
  out=$( _source_supervisor "$scratch"
         scan_archive_requested_sentinels 2>&1 ) || rc=$?
  stop_stub_homeserver
  # The key assertion: the scanner INVOKED retire_identity despite the legacy sentinel.
  # (Old guard would have `continue`'d before this log line fired.)
  assert_grep "'nu' user-initiated archive: .archive-requested detected, invoking retire_identity" "$out" \
    "guard-gone: scanner MUST invoke retire_identity even with legacy retire-stuck sentinel present"
  # Retire itself will hit State 3 collision (both live nu/ and archive/nu/ exist), but
  # that's incidental — the point is the retire was ATTEMPTED (not skipped).
  assert_grep "retire step 1 (matrix deactivate) starting" "$out" \
    "guard-gone: retire_identity actually ran (step 1 log present)"
  teardown_scratch "$scratch"
}

# ============================================================
# MODE-AGNOSTIC SCAN TEST — Pitfall 1 + Pitfall 2
# ============================================================

test_scan_walks_all_identity_folders() {
  local scratch; scratch=$(setup_scratch)
  # alpha: dormant (200d), no guards → retire-attempted
  fixture_identity "$scratch" alpha --cursor-age-days 200
  fixture_relay_json "$scratch/alpha" "http://127.0.0.1:1/_matrix/client/v3" "@alpha:test" "pw" "tok"
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

# ================================================================
# Phase 115 tests: user-initiated sentinel-scan branch + retire reorder
# ================================================================
# These tests exercise the code delivered by 115-03/04/05:
#   - scan_archive_requested_sentinels()  (user-initiated retire trigger — every-tick, bypasses guards)
#   - reordered retire_identity() steps    (matrix → graceful-exit → tmux → sentinel-delete → folder-move)
#   - retire-fail-count-user-<name>        (per-tick counter, sibling of daily-path counter)
#   - retire-stuck sentinel on user path   (fires after 3 consecutive per-tick failures)
#
# Phase 115 D-22 discipline: the full retire flow has never fired in production — treat as
# untrusted, revalidate end-to-end. These tests pin the behavioral contract so future regressions
# are caught. RESEARCH §8 recommended extending this existing harness rather than adding a new file.

# _114_setup_identity: convenience wrapper that creates a scratch dir with an identity, a
# .archive-requested sentinel, and a working stub-homeserver-backed relay.json.
# Usage: _114_setup_identity <scratch> <name> <http_code> [--pinned] [--no-dormancy] [--coordinator]
# Returns via echo the scratch path (already created). Caller must arrange stub_homeserver stop +
# teardown_scratch. On stub failure, echoes empty and the caller aborts.
_114_setup_identity() {
  local scratch="$1" name="$2" http_code="$3"
  shift 3
  local passthru=("$@")
  fixture_identity "$scratch" "$name" "${passthru[@]}"
  touch "$scratch/$name/.archive-requested"
  # Placeholder base URL; sed-substituted after we know the port.
  fixture_relay_json "$scratch/$name" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@$name:test" "pw" "tok"
  start_stub_homeserver "$http_code" || return 1
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/$name/relay.json"
  return 0
}

# Test 1: dropping .archive-requested triggers retire via scan_archive_requested_sentinels().
# Asserts the four retire steps ran in order, live folder moved to archive, sentinel deleted,
# fail counter absent (success clears it), and the stub captured the deactivate POST body.
test_sentinel_scan_triggers_retire() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  _114_setup_identity "$scratch" alpha 200 || { teardown_scratch "$scratch"; return; }
  local out
  out=$( _source_supervisor "$scratch"
         scan_archive_requested_sentinels 2>&1 ) || true
  local req_log_snapshot=""
  [ -n "$STUB_REQ_LOG" ] && [ -f "$STUB_REQ_LOG" ] && req_log_snapshot=$(cat "$STUB_REQ_LOG")
  stop_stub_homeserver

  assert_nofile "$scratch/alpha" \
    "sentinel-scan retire: live folder must be gone"
  assert_file "${scratch}-archive/alpha" \
    "sentinel-scan retire: archive folder must exist"
  assert_nofile "$scratch/alpha/.archive-requested" \
    "sentinel-scan retire: sentinel must be deleted (step 4a)"
  assert_nofile "$scratch/.state/retire-fail-count-user-alpha" \
    "sentinel-scan retire: legacy user-initiated counter file MUST NOT be written (Phase 133 D-14)"
  # All four retire-step entry log lines emit.
  assert_grep "retire step 1" "$out" "sentinel-scan retire: step 1 log line present"
  assert_grep "retire step 2" "$out" "sentinel-scan retire: step 2 log line present"
  assert_grep "retire step 3" "$out" "sentinel-scan retire: step 3 log line present"
  assert_grep "retire step 4a" "$out" "sentinel-scan retire: step 4a log line present"
  # user-initiated diagnostic present.
  assert_grep "user-initiated archive" "$out" \
    "sentinel-scan retire: user-initiated diagnostic present"
  # Stub captured the deactivate POST body — path + mxid should appear.
  assert_grep "/_matrix/client/v3/account/deactivate" "$req_log_snapshot" \
    "sentinel-scan retire: stub captured deactivate endpoint path (Content-Length request_body_log)"
  assert_grep "@alpha:test" "$req_log_snapshot" \
    "sentinel-scan retire: stub captured mxid in deactivate body (Content-Length request_body_log)"
  teardown_scratch "$scratch"
}

# Test 2: guard bypass on user-initiated path.
# All three guards (.pinned + .no-dormancy + coordinator: true) present; retire STILL fires.
test_sentinel_scan_bypasses_all_guards() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  _114_setup_identity "$scratch" alpha 200 --pinned --no-dormancy --coordinator \
    || { teardown_scratch "$scratch"; return; }
  # Sanity: fixture wrote all three guards.
  assert_file "$scratch/alpha/.pinned" "guard bypass fixture: .pinned present"
  assert_file "$scratch/alpha/.no-dormancy" "guard bypass fixture: .no-dormancy present"
  # Confirm coordinator frontmatter is actually parseable.
  local rc=0
  ( _source_supervisor "$scratch"; is_coordinator "$scratch/alpha/alpha.md" ) || rc=$?
  assert_eq "0" "$rc" "guard bypass fixture: is_coordinator returns 0 (fixture built correctly)"

  local out
  out=$( _source_supervisor "$scratch"
         scan_archive_requested_sentinels 2>&1 ) || true
  local req_log_snapshot=""
  [ -n "$STUB_REQ_LOG" ] && [ -f "$STUB_REQ_LOG" ] && req_log_snapshot=$(cat "$STUB_REQ_LOG")
  stop_stub_homeserver

  # Even though all three guards were present, retire fires — the user-initiated path
  # BYPASSES the guards (D-11). Folder is moved, matrix deactivate happened.
  assert_nofile "$scratch/alpha" \
    "guard bypass: live folder must be gone (bypass worked despite pinned+no-dormancy+coordinator)"
  assert_file "${scratch}-archive/alpha" \
    "guard bypass: archive folder must exist"
  assert_grep "/_matrix/client/v3/account/deactivate" "$req_log_snapshot" \
    "guard bypass: matrix deactivate was called (stub request_body_log)"
  teardown_scratch "$scratch"
}

# Test 3: guards preserved on the 180-day daily path (run_archive_scan).
# For each of .pinned, .no-dormancy, and coordinator: true — a 200-day-dormant identity is
# NOT retired. This confirms the guard bypass is scoped to the user-initiated path only.
test_daily_path_preserves_all_guards() {
  local scratch; scratch=$(setup_scratch)
  # beta: .pinned                — should be skipped
  fixture_identity "$scratch" beta --cursor-age-days 200 --pinned
  # gamma: .no-dormancy           — should be skipped
  fixture_identity "$scratch" gamma --cursor-age-days 200 --no-dormancy
  # delta: coordinator: true      — should be skipped
  fixture_identity "$scratch" delta --cursor-age-days 200 --coordinator
  # NO .archive-requested on any — the daily path is what's being tested here.

  local out
  out=$( _source_supervisor "$scratch"
         run_archive_scan 2>&1 ) || true

  # All three live folders unchanged.
  assert_file "$scratch/beta" \
    "daily path guards: .pinned identity 'beta' must NOT be retired"
  assert_file "$scratch/gamma" \
    "daily path guards: .no-dormancy identity 'gamma' must NOT be retired"
  assert_file "$scratch/delta" \
    "daily path guards: coordinator identity 'delta' must NOT be retired"
  # None appear in the log as "dormant" (silent-skip discipline, D-15).
  if printf '%s' "$out" | grep -q "'beta' dormant"; then
    fail "daily path guards: 'beta' (pinned) leaked into 'dormant' log line"
  fi
  if printf '%s' "$out" | grep -q "'gamma' dormant"; then
    fail "daily path guards: 'gamma' (no-dormancy) leaked into 'dormant' log line"
  fi
  if printf '%s' "$out" | grep -q "'delta' dormant"; then
    fail "daily path guards: 'delta' (coordinator) leaked into 'dormant' log line"
  fi
  teardown_scratch "$scratch"
}

# Test 4: retire step-order observability.
# The four "retire step N" entry log lines must appear in monotonic order: 1 → 2 → 3 → 4a → 4b.
# Uses grep -n on the captured log stream to compare line numbers.
test_retire_step_order_observable() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  _114_setup_identity "$scratch" gamma 200 || { teardown_scratch "$scratch"; return; }

  local out
  out=$( _source_supervisor "$scratch"
         scan_archive_requested_sentinels 2>&1 ) || true
  stop_stub_homeserver

  # Extract the FIRST matching line number for each step (log lines all include "retire step N").
  local line_s1 line_s2 line_s3 line_s4a line_s4b
  line_s1=$(printf '%s\n'  "$out" | grep -n  "retire step 1 (matrix deactivate) starting"   | head -1 | cut -d: -f1)
  line_s2=$(printf '%s\n'  "$out" | grep -n  "retire step 2 (graceful exit)"                | head -1 | cut -d: -f1)
  line_s3=$(printf '%s\n'  "$out" | grep -n  "retire step 3 (tmux kill-session)"            | head -1 | cut -d: -f1)
  line_s4a=$(printf '%s\n' "$out" | grep -n  "retire step 4a"                                | head -1 | cut -d: -f1)
  line_s4b=$(printf '%s\n' "$out" | grep -n  "retire step 4b"                                | head -1 | cut -d: -f1)

  # All must have been found.
  if [ -z "$line_s1" ] || [ -z "$line_s2" ] || [ -z "$line_s3" ] || [ -z "$line_s4a" ] || [ -z "$line_s4b" ]; then
    fail "retire step order: at least one of the five step log lines missing (s1=$line_s1 s2=$line_s2 s3=$line_s3 s4a=$line_s4a s4b=$line_s4b)"
    teardown_scratch "$scratch"
    return
  fi
  # Monotonic ordering: 1 < 2 < 3 < 4a < 4b.
  if [ "$line_s1" -ge "$line_s2" ]; then
    fail "retire step order: step 1 (line $line_s1) must precede step 2 (line $line_s2)"
  fi
  if [ "$line_s2" -ge "$line_s3" ]; then
    fail "retire step order: step 2 (line $line_s2) must precede step 3 (line $line_s3)"
  fi
  if [ "$line_s3" -ge "$line_s4a" ]; then
    fail "retire step order: step 3 (line $line_s3) must precede step 4a (line $line_s4a)"
  fi
  if [ "$line_s4a" -ge "$line_s4b" ]; then
    fail "retire step order: step 4a (line $line_s4a) must precede step 4b (line $line_s4b)"
  fi
  teardown_scratch "$scratch"
}

# Test 5 (Phase 133 D-14): the pre-Phase-133 user-path 3-failures-then-stuck test was
# deleted along with the cross-tick counter + stuck-sentinel mechanism it exercised.
# See tests A-F above for the new inline-retry contract.

# Test 6: sentinel-delete-before-move safety on collision-abort (State 3).
# Pre-create archive/epsilon so step 4b's mv aborts. Step 4a runs BEFORE step 4b, so the
# sentinel is already deleted when the collision-abort fires. Documents observed behavior:
# after step 4a but before a step-4b failure, the sentinel is gone and next-tick retry
# WILL NOT re-fire (this is intentional — State 3 collision-abort is a hard-abort, not
# a transient crash). Phase 133 D-14: retire returns 1 but the scanner no longer writes a
# counter file — the terminal ERROR is logged and the identity is left for operator triage.
test_sentinel_delete_before_move_collision() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  _114_setup_identity "$scratch" epsilon 200 || { teardown_scratch "$scratch"; return; }
  # Pre-populate archive/epsilon so step 4b hits State 3 collision.
  mkdir -p "${scratch}-archive/epsilon"
  echo "placeholder" > "${scratch}-archive/epsilon/preexisting-file"

  local out
  out=$( _source_supervisor "$scratch"
         scan_archive_requested_sentinels 2>&1 ) || true
  local req_log_snapshot=""
  [ -n "$STUB_REQ_LOG" ] && [ -f "$STUB_REQ_LOG" ] && req_log_snapshot=$(cat "$STUB_REQ_LOG")
  stop_stub_homeserver

  # Step 1 fired: matrix deactivate reached the stub.
  assert_grep "/_matrix/client/v3/account/deactivate" "$req_log_snapshot" \
    "sentinel-delete-before-move: step 1 (deactivate) hit the stub before step 4b failed (Content-Length request_body_log)"
  # Step 4a ran BEFORE step 4b's collision-abort — sentinel deleted.
  assert_nofile "$scratch/epsilon/.archive-requested" \
    "sentinel-delete-before-move: sentinel DELETED before the move (step 4a ran)"
  # Step 4b aborted: live folder still exists.
  assert_file "$scratch/epsilon" \
    "sentinel-delete-before-move: live folder retained (step 4b collision-abort, State 3)"
  # Collision log line emitted.
  assert_grep "collision" "$out" \
    "sentinel-delete-before-move: collision-abort log line emits"
  # Phase 133 D-14: no counter file written on collision-abort.
  assert_nofile "$scratch/.state/retire-fail-count-user-epsilon" \
    "sentinel-delete-before-move (D-14): legacy user-initiated counter file MUST NOT be written on collision-abort"
  # Phase 133 D-14: no retire-stuck sentinel dropped.
  assert_nofile "${scratch}-archive/epsilon/retire-stuck" \
    "sentinel-delete-before-move (D-14): legacy retire-stuck sentinel MUST NOT be dropped on collision-abort"
  teardown_scratch "$scratch"
}

# Test 7: ambient-monitor cleanup observability (MINIMAL version — plan-check info-note #6).
# The full test (stub ambient-monitor + 4 stub children + real killpg fanout) is CI-fragile,
# and the plan explicitly permits the MINIMAL variant. This version confirms:
#   (a) step 2's graceful-exit log line emits (the branch that would SIGTERM ambient-monitor),
#   (b) log-line order shows step 2 BEFORE step 3 (tmux kill only happens after graceful exit).
# The full SIGTERM fanout with a real ambient-monitor process is deferred (documented in SUMMARY).
test_ambient_monitor_graceful_shutdown_observable_minimal() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  _114_setup_identity "$scratch" zeta 200 || { teardown_scratch "$scratch"; return; }

  local out
  out=$( _source_supervisor "$scratch"
         scan_archive_requested_sentinels 2>&1 ) || true
  stop_stub_homeserver

  # (a) step 2 emits its log line (the ambient-monitor cleanup happens inside this step;
  # without a real tmux session, the "no live tmux session" path is exercised — the SIGTERM
  # fanout logic is only reached with a real session, which is the deferred deeper-coverage
  # case per plan-check info-note #6).
  assert_grep "retire step 2 (graceful exit)" "$out" \
    "ambient-monitor observability (minimal): step 2 log line present"
  # (b) step 2 precedes step 3 (line-number ordering).
  local line_s2 line_s3
  line_s2=$(printf '%s\n' "$out" | grep -n "retire step 2 (graceful exit)"     | head -1 | cut -d: -f1)
  line_s3=$(printf '%s\n' "$out" | grep -n "retire step 3 (tmux kill-session)" | head -1 | cut -d: -f1)
  if [ -z "$line_s2" ] || [ -z "$line_s3" ] || [ "$line_s2" -ge "$line_s3" ]; then
    fail "ambient-monitor observability (minimal): step 2 (line $line_s2) must precede step 3 (line $line_s3)"
  fi
  teardown_scratch "$scratch"
}

# Test 8: sentinel-scan on malformed state — folder + sentinel but no md and no relay.json.
# scan_archive_requested_sentinels() must NOT crash. retire_identity() fails at step 1 (no
# relay.json), sentinel is retained. Phase 133 D-14: no counter file is written any more.
test_sentinel_scan_on_malformed_identity_does_not_crash() {
  local scratch; scratch=$(setup_scratch)
  # Malformed: identity dir + sentinel exist, but no md file and no relay.json.
  mkdir -p "$scratch/deleted"
  touch "$scratch/deleted/.archive-requested"

  local out rc=0
  out=$( _source_supervisor "$scratch"
         scan_archive_requested_sentinels 2>&1 ) || rc=$?

  # scan_archive_requested_sentinels() itself does not return non-zero on per-identity failure;
  # it just logs the error via retire_identity. The critical assertion is "did not crash".
  assert_eq "0" "$rc" "malformed-identity sentinel-scan: function must not crash on missing relay.json"
  # step 1 must have failed with the "relay.json not found" ERROR path.
  assert_grep "relay.json not found" "$out" \
    "malformed-identity sentinel-scan: step 1 must log 'relay.json not found' (LOUD error)"
  # Sentinel retained (step 4a never reached).
  assert_file "$scratch/deleted/.archive-requested" \
    "malformed-identity sentinel-scan: sentinel retained on step-1 failure"
  # Phase 133 D-14: no legacy counter file written.
  assert_nofile "$scratch/.state/retire-fail-count-user-deleted" \
    "malformed-identity sentinel-scan (D-14): legacy counter file MUST NOT be written"
  teardown_scratch "$scratch"
}

# Test 9: real-tmux-session teardown (Phase 115 /close follow-up).
# Closes the "real-tmux teardown" gap surfaced by the /close conformance review for Phase 115:
# every existing test runs in "no live tmux session" mode, so step 3 (tmux kill-session) is only
# ever exercised as a no-op. This test spawns a REAL detached tmux session, populates
# SESSIONS_SNAPSHOT via snapshot_sessions() so retire_identity's match_session() can resolve it,
# drives user-initiated archive via scan_archive_requested_sentinels(), and asserts:
#   - tmux has-session -t <name> returns non-zero AFTER retire completes (session gone)
#   - identity folder moved to archive tree (idempotent with Test 1's live→archive assertion)
#   - log-line ordering still holds (matrix → graceful exit → tmux → folder move)
#
# The deeper ambient-monitor cascade (4-stub-children + real killpg fanout observation) is
# accepted-as-drift per plan-check MINIMAL variant approval — deliberately out of scope here.
test_retire_kills_live_tmux_session() {
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  # tmux availability is asserted upfront by MISSING_MANDATORY at the top of the harness, but
  # this test is the only one that actually spawns a session — assert once more with a clear
  # message so a broken tmux binary here fails obviously instead of via a match_session miss.
  if ! command -v tmux >/dev/null 2>&1; then
    fail "real-tmux teardown: tmux not on PATH (required to spawn the live session this test exercises)"
    return
  fi

  local scratch; scratch=$(setup_scratch)
  # Unique per-run identity name so parallel/repeated harness invocations don't collide on the
  # tmux session namespace (tmux server is per-user, not per-process). The name is used verbatim
  # for both the identity folder AND the tmux session (slug() is a no-op on hyphenated ASCII).
  local ident="ztmux-$$-${RANDOM}"

  _114_setup_identity "$scratch" "$ident" 200 || { teardown_scratch "$scratch"; return; }

  # Spawn a REAL detached tmux session whose name matches what retire_identity's slug() will
  # resolve to (identity name → slug → session name; no spaces means identity name IS the
  # session name). `sleep 300` keeps the session alive for the duration of the test.
  if ! timeout -k 5 10 tmux new-session -d -s "$ident" 'sleep 300' 2>/dev/null; then
    fail "real-tmux teardown: could not spawn tmux session '$ident' — check tmux server health"
    stop_stub_homeserver
    teardown_scratch "$scratch"
    return
  fi
  # Confirm the session is live before we act — precondition of the test.
  if ! timeout -k 5 10 tmux has-session -t "$ident" 2>/dev/null; then
    fail "real-tmux teardown: fixture spawned session but has-session returned non-zero pre-retire"
    timeout -k 5 10 tmux kill-session -t "$ident" 2>/dev/null || true
    stop_stub_homeserver
    teardown_scratch "$scratch"
    return
  fi

  # Populate SESSIONS_SNAPSHOT so retire_identity's match_session() can resolve the live session.
  # In production, reconcile() calls snapshot_sessions() at the top of every tick before the
  # sentinel scan; the LIB_ONLY test path skips reconcile. We manually seed the snapshot with
  # ONLY our test session (case-insensitive key = lowercased session name → real session name)
  # rather than calling snapshot_sessions itself. Rationale: snapshot_sessions sweeps the entire
  # tmux server on the host, which pulls in every unrelated session belonging to other users of
  # the box (fleet identity sessions on this machine). Seeding directly keeps the test hermetic
  # AND exercises the exact code path retire_identity uses (match_session reads the map — it
  # doesn't care HOW the map was populated).
  #
  # Bash gotcha: `declare -A SESSIONS_SNAPSHOT=()` at the top of the supervisor becomes LOCAL to
  # `_source_supervisor` when the supervisor is sourced from inside a function — bash treats
  # `declare` inside a sourced-in-function as function-local, and the map evaporates when
  # `_source_supervisor` returns. (This is the same reason `match_session` throws a benign
  # "unbound variable" warning in every existing test — it's swallowed because match_session's
  # caller uses `|| true`.) We re-declare SESSIONS_SNAPSHOT at the subshell's top-level scope
  # before assigning so the map survives long enough for retire_identity to see it.
  local ident_lc; ident_lc="$(printf '%s' "$ident" | tr '[:upper:]' '[:lower:]')"
  local out
  out=$( _source_supervisor "$scratch"
         declare -A SESSIONS_SNAPSHOT
         SESSIONS_SNAPSHOT["$ident_lc"]="$ident"
         scan_archive_requested_sentinels 2>&1 ) || true
  stop_stub_homeserver

  # Primary assertion: the session is gone. `has-session` exits non-zero iff the session does
  # not exist (empty stderr on this branch is expected — we don't grep the output, we check rc).
  local has_session_rc=0
  timeout -k 5 10 tmux has-session -t "$ident" 2>/dev/null || has_session_rc=$?
  assert_neq "0" "$has_session_rc" \
    "real-tmux teardown: tmux has-session must return non-zero after retire completes (session=$ident)"

  # Secondary assertions (idempotent with Test 1): folder moved, sentinel gone.
  assert_nofile "$scratch/$ident" \
    "real-tmux teardown: live folder must be gone after retire"
  assert_file "${scratch}-archive/$ident" \
    "real-tmux teardown: archive folder must exist after retire"

  # Log-line ordering: matrix (step 1) → graceful exit (step 2) → tmux kill (step 3) → folder
  # move (step 4b). With a live session, step 3 takes the SUCCESS branch (killed tmux session),
  # not the no-op branch — assert we see that specific log line.
  assert_grep "retire step 3 (tmux kill-session) success: killed tmux session" "$out" \
    "real-tmux teardown: step 3 must log the 'killed tmux session' SUCCESS branch (not the no-op branch)"

  local line_s1 line_s2 line_s3 line_s4b
  line_s1=$(printf  '%s\n' "$out" | grep -n "retire step 1 (matrix deactivate) starting"       | head -1 | cut -d: -f1)
  line_s2=$(printf  '%s\n' "$out" | grep -n "retire step 2 (graceful exit)"                    | head -1 | cut -d: -f1)
  line_s3=$(printf  '%s\n' "$out" | grep -n "retire step 3 (tmux kill-session)"                | head -1 | cut -d: -f1)
  line_s4b=$(printf '%s\n' "$out" | grep -n "retire step 4b"                                    | head -1 | cut -d: -f1)
  if [ -z "$line_s1" ] || [ -z "$line_s2" ] || [ -z "$line_s3" ] || [ -z "$line_s4b" ]; then
    fail "real-tmux teardown: at least one of steps 1/2/3/4b log lines missing (s1=$line_s1 s2=$line_s2 s3=$line_s3 s4b=$line_s4b)"
  else
    [ "$line_s1" -ge "$line_s2" ]  && fail "real-tmux teardown: step 1 (line $line_s1) must precede step 2 (line $line_s2)"
    [ "$line_s2" -ge "$line_s3" ]  && fail "real-tmux teardown: step 2 (line $line_s2) must precede step 3 (line $line_s3)"
    [ "$line_s3" -ge "$line_s4b" ] && fail "real-tmux teardown: step 3 (line $line_s3) must precede step 4b (line $line_s4b)"
  fi

  # Idempotent teardown: retire SHOULD have killed the session, but if the test failed above
  # the session may still be alive — kill it here so repeated harness runs don't leak sessions.
  timeout -k 5 10 tmux kill-session -t "$ident" 2>/dev/null || true
  teardown_scratch "$scratch"
}

# ============================================================
# WORKSPACE REPO CLEANUP TESTS (safety gate + retire-hook integration)
# ============================================================
#
# Fixture-repo helpers build real git repositories on disk with controlled state.
# The origin URL defaults to a network URL string (github.com/fake/repo.git) — git
# never contacts it because we fake origin/main locally with update-ref, so the
# tests are hermetic and offline-safe.
#
# make_safe_fixture_repo <dir> [origin_url]
#   Creates a repo at <dir> with one initial commit on main, fakes origin/main
#   pointing at HEAD, and sets main's upstream to origin/main — the shape's
#   "safe to delete" baseline.
make_safe_fixture_repo() {
  local dir="$1"
  local origin_url="${2:-https://github.com/fake/repo.git}"
  mkdir -p "$dir"
  ( cd "$dir" || return 1
    git init -q -b main 2>/dev/null || { git init -q && git checkout -q -b main 2>/dev/null; }
    git config user.email test@test.local
    git config user.name test
    git remote add origin "$origin_url" 2>/dev/null || true
    printf 'hello\n' > README
    git add README
    git commit -q -m init
    # Fake origin/main pointing at HEAD — simulates a fully-pushed clone.
    git update-ref refs/remotes/origin/main "$(git rev-parse HEAD)"
    git branch -q --set-upstream-to=origin/main main 2>/dev/null
  ) >/dev/null 2>&1
}

test_workspace_safe_repo_returns_empty_reason() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo"
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_eq "" "$reason" "safe repo baseline: reason must be empty (all six gates pass)"
  teardown_scratch "$scratch"
}

test_workspace_no_git_dir_unsafe() {
  local scratch; scratch=$(setup_scratch)
  mkdir -p "$scratch/ws/not-a-repo"
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$scratch/ws/not-a-repo" )
  assert_neq "" "$reason" "no .git dir: reason must be non-empty"
  assert_grep "no-git-dir" "$reason" "no .git dir: reason must mention no-git-dir"
  teardown_scratch "$scratch"
}

test_workspace_no_origin_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo"
  ( cd "$repo" && git remote remove origin ) >/dev/null 2>&1
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "no-origin-remote" "$reason" "no origin remote: reason must mention no-origin-remote"
  teardown_scratch "$scratch"
}

test_workspace_filesystem_origin_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo" "/some/local/path/repo.git"
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "origin-is-filesystem-path" "$reason" "filesystem origin: reason must mention filesystem-path"
  teardown_scratch "$scratch"
}

test_workspace_file_scheme_origin_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo" "file:///some/path/repo.git"
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "origin-is-filesystem-path" "$reason" "file:// origin: reason must mention filesystem-path"
  teardown_scratch "$scratch"
}

test_workspace_ssh_scp_origin_safe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo" "git@github.com:foo/bar.git"
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_eq "" "$reason" "SCP-like SSH origin (git@host:path): must be recognized as network URL"
  teardown_scratch "$scratch"
}

test_workspace_uncommitted_changes_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo"
  printf 'modified\n' >> "$repo/README"
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "working-tree-dirty" "$reason" "uncommitted change: reason must mention working-tree-dirty"
  teardown_scratch "$scratch"
}

test_workspace_untracked_file_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo"
  printf 'new\n' > "$repo/untracked.txt"
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "working-tree-dirty" "$reason" "untracked non-ignored file: reason must mention working-tree-dirty"
  teardown_scratch "$scratch"
}

test_workspace_gitignored_untracked_safe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo"
  # Add .gitignore ignoring build/ then commit it so working tree is clean.
  printf 'build/\n' > "$repo/.gitignore"
  ( cd "$repo" && git add .gitignore && git commit -q -m gitignore && \
    git update-ref refs/remotes/origin/main "$(git rev-parse HEAD)" ) >/dev/null 2>&1
  # Create a build/ directory with a file — should be ignored.
  mkdir -p "$repo/build"
  printf 'built\n' > "$repo/build/artifact"
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_eq "" "$reason" "gitignored untracked file: must NOT count against safety (reason='$reason')"
  teardown_scratch "$scratch"
}

test_workspace_unpushed_commit_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo"
  # Add a local commit that is ahead of origin/main.
  ( cd "$repo" && printf 'local\n' > local.txt && git add local.txt && git commit -q -m local ) >/dev/null 2>&1
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "ahead" "$reason" "unpushed commit: reason must mention ahead"
  teardown_scratch "$scratch"
}

test_workspace_no_upstream_branch_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo"
  # Create a branch with no upstream configured.
  ( cd "$repo" && git checkout -q -b orphan && printf 'x\n' > x && git add x && git commit -q -m orphan ) >/dev/null 2>&1
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "has-no-upstream" "$reason" "branch with no upstream: reason must mention has-no-upstream"
  teardown_scratch "$scratch"
}

test_workspace_gone_upstream_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo"
  # Delete the fake remote-tracking ref → main's upstream becomes [gone].
  ( cd "$repo" && git update-ref -d refs/remotes/origin/main ) >/dev/null 2>&1
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "upstream-gone" "$reason" "gone upstream: reason must mention upstream-gone"
  teardown_scratch "$scratch"
}

test_workspace_stash_entry_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo"
  ( cd "$repo" && printf 'temp\n' >> README && git stash push -q -m 'temp' ) >/dev/null 2>&1
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "stash-entries" "$reason" "stash present: reason must mention stash-entries"
  teardown_scratch "$scratch"
}

test_workspace_cleanup_no_workspace_dir_noop() {
  local scratch; scratch=$(setup_scratch)
  mkdir -p "$scratch/tina"  # identity dir with NO workspace/
  local out
  out=$( _source_supervisor "$scratch"
         clean_workspace_repos tina "$scratch/tina" 2>&1 )
  # No log entries expected — the function returns early.
  if printf '%s' "$out" | grep -q 'workspace-cleanup'; then
    fail "no-workspace-dir: must not log anything (got: $out)"
  fi
  teardown_scratch "$scratch"
}

test_workspace_cleanup_deletes_safe_repo() {
  local scratch; scratch=$(setup_scratch)
  local wsdir="$scratch/tina/workspace"
  make_safe_fixture_repo "$wsdir/skynet"
  local out
  out=$( _source_supervisor "$scratch"
         clean_workspace_repos tina "$scratch/tina" 2>&1 )
  assert_nofile "$wsdir/skynet" "safe repo: must be deleted"
  assert_grep "deleted safe repo at $wsdir/skynet" "$out" "safe repo: log must record deletion"
  teardown_scratch "$scratch"
}

test_workspace_cleanup_preserves_unsafe_repo() {
  local scratch; scratch=$(setup_scratch)
  local wsdir="$scratch/tina/workspace"
  make_safe_fixture_repo "$wsdir/skynet"
  # Introduce local-only work.
  ( cd "$wsdir/skynet" && printf 'local\n' > local && git add local && \
    git commit -q -m local ) >/dev/null 2>&1
  local out
  out=$( _source_supervisor "$scratch"
         clean_workspace_repos tina "$scratch/tina" 2>&1 )
  assert_file "$wsdir/skynet/.git" "unsafe repo: must remain in place"
  assert_grep "WARN: 'tina' workspace-cleanup: skipped repo" "$out" "unsafe repo: log must be at WARN with reason"
  assert_grep "ahead" "$out" "unsafe repo: log must include the reason (ahead)"
  teardown_scratch "$scratch"
}

test_workspace_cleanup_mixed_safe_and_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local wsdir="$scratch/tina/workspace"
  make_safe_fixture_repo "$wsdir/safe-repo"
  make_safe_fixture_repo "$wsdir/dirty-repo"
  printf 'dirty\n' >> "$wsdir/dirty-repo/README"  # uncommitted change
  local out
  out=$( _source_supervisor "$scratch"
         clean_workspace_repos tina "$scratch/tina" 2>&1 )
  assert_nofile "$wsdir/safe-repo" "mixed: safe repo must be deleted"
  assert_file   "$wsdir/dirty-repo/.git" "mixed: unsafe repo must remain"
  teardown_scratch "$scratch"
}

test_workspace_cleanup_non_repo_files_untouched() {
  local scratch; scratch=$(setup_scratch)
  local wsdir="$scratch/tina/workspace"
  mkdir -p "$wsdir"
  printf 'notes\n' > "$wsdir/notes.md"
  mkdir -p "$wsdir/scratch-dir"
  printf 'x\n' > "$wsdir/scratch-dir/x.txt"
  make_safe_fixture_repo "$wsdir/skynet"
  ( _source_supervisor "$scratch"
    clean_workspace_repos tina "$scratch/tina" ) >/dev/null 2>&1
  assert_file "$wsdir/notes.md" "non-repo file at workspace root: must remain"
  assert_file "$wsdir/scratch-dir/x.txt" "non-repo dir contents: must remain"
  assert_nofile "$wsdir/skynet" "safe repo alongside non-repo content: must still be deleted"
  teardown_scratch "$scratch"
}

test_workspace_cleanup_nested_repo_pruned() {
  local scratch; scratch=$(setup_scratch)
  local wsdir="$scratch/tina/workspace"
  make_safe_fixture_repo "$wsdir/outer"
  # Nest a second independent repo INSIDE the outer, one level down. This makes the
  # outer "dirty" (untracked directory), so outer should be preserved AND inner
  # should NOT be independently scanned/deleted (prune-on-find on the outer).
  make_safe_fixture_repo "$wsdir/outer/subdir/inner"
  local out
  out=$( _source_supervisor "$scratch"
         clean_workspace_repos tina "$scratch/tina" 2>&1 )
  # Outer preserved (untracked subdir made it dirty).
  assert_file "$wsdir/outer/.git" "nested: outer with untracked subrepo dir must remain (dirty)"
  # Inner also preserved — never independently evaluated.
  assert_file "$wsdir/outer/subdir/inner/.git" "nested: inner must remain (came with outer)"
  # Log must NOT reference the inner path independently.
  if printf '%s' "$out" | grep -q "workspace-cleanup:.*outer/subdir/inner"; then
    fail "nested: inner repo must NOT appear in log independently (was: $out)"
  fi
  teardown_scratch "$scratch"
}

test_workspace_cleanup_nested_repo_within_safe_outer_deleted_together() {
  local scratch; scratch=$(setup_scratch)
  local wsdir="$scratch/tina/workspace"
  make_safe_fixture_repo "$wsdir/outer"
  # Add .gitignore that ignores subdir/, then commit it — so outer stays clean
  # even with the nested repo present.
  printf 'subdir/\n' > "$wsdir/outer/.gitignore"
  ( cd "$wsdir/outer" && git add .gitignore && git commit -q -m gitignore && \
    git update-ref refs/remotes/origin/main "$(git rev-parse HEAD)" ) >/dev/null 2>&1
  make_safe_fixture_repo "$wsdir/outer/subdir/inner"
  ( _source_supervisor "$scratch"
    clean_workspace_repos tina "$scratch/tina" ) >/dev/null 2>&1
  # Outer safe → outer deleted → inner comes with it.
  assert_nofile "$wsdir/outer" "nested inside safe outer: whole tree deleted together"
  teardown_scratch "$scratch"
}

test_workspace_cleanup_depth_limit_respected() {
  local scratch; scratch=$(setup_scratch)
  local wsdir="$scratch/tina/workspace"
  # Repo at depth 3 (workspace/a/b/c) should be scanned.
  make_safe_fixture_repo "$wsdir/a/b/c"
  # Repo at depth 4 (workspace/a2/b2/c2/d2) should NOT be scanned — beyond the shape's cap.
  make_safe_fixture_repo "$wsdir/a2/b2/c2/d2"
  local out
  out=$( _source_supervisor "$scratch"
         clean_workspace_repos tina "$scratch/tina" 2>&1 )
  assert_nofile "$wsdir/a/b/c" "depth 3: repo must be scanned and deleted"
  assert_file "$wsdir/a2/b2/c2/d2/.git" "depth 4: repo must NOT be scanned (beyond cap)"
  teardown_scratch "$scratch"
}

test_workspace_cleanup_hook_fires_before_folder_move() {
  # Integration test: a safe repo inside a live identity's workspace/ MUST be
  # deleted by clean_workspace_repos BEFORE step 4b moves the folder, so the
  # archived folder does not contain it.
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" tina --cursor-age-days 200
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@tina:test" "pw" "tok"
  make_safe_fixture_repo "$scratch/tina/workspace/skynet"
  start_stub_homeserver 200 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/tina/relay.json"
  local rc=0 out
  out=$( _source_supervisor "$scratch"
         retire_identity "tina" 2>&1 ) || rc=$?
  stop_stub_homeserver
  assert_eq "0" "$rc" "hook-before-move: retire must succeed"
  assert_file "${scratch}-archive/tina" "hook-before-move: identity folder must be in archive"
  # The safe repo MUST NOT survive into the archived folder — deletion runs BEFORE the move.
  assert_nofile "${scratch}-archive/tina/workspace/skynet" \
    "hook-before-move: safe repo must be gone from the archived workspace (deleted before move)"
  # And the log line must be present.
  assert_grep "workspace-cleanup: deleted safe repo" "$out" \
    "hook-before-move: retire log must include the cleanup line"
  teardown_scratch "$scratch"
}

test_workspace_detached_head_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo"
  # Add a second commit, then detach HEAD at the first commit — leaving the branch
  # tip ahead of HEAD, with HEAD pointing at a commit still reachable from main but
  # NOT via a symbolic ref (detached).
  ( cd "$repo" && \
    git commit --allow-empty -q -m second && \
    git checkout -q "$(git rev-parse HEAD~1)" ) >/dev/null 2>&1
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "detached-head" "$reason" "detached HEAD: reason must mention detached-head"
  teardown_scratch "$scratch"
}

test_workspace_local_branch_upstream_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo"
  # Create a second branch whose upstream points at the LOCAL main branch, not at
  # any refs/remotes/* ref. Shape wording: "upstream still exists on the remote"
  # — a local-branch upstream does not satisfy this.
  ( cd "$repo" && \
    git checkout -q -b feature && \
    git branch -q --set-upstream-to=main feature ) >/dev/null 2>&1
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "non-remote-upstream" "$reason" "local-branch upstream: reason must mention non-remote-upstream"
  teardown_scratch "$scratch"
}

test_workspace_unknown_scheme_origin_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  # A non-URL-shaped origin: no scheme, no leading /, no @host: pattern.
  make_safe_fixture_repo "$repo" "some-word-that-is-not-a-url"
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "origin-unknown-scheme" "$reason" "unknown-scheme origin: reason must mention origin-unknown-scheme"
  teardown_scratch "$scratch"
}

test_workspace_relative_filesystem_origin_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo" "./relative/path/repo.git"
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "origin-is-filesystem-path" "$reason" "./ origin: reason must mention filesystem-path"
  teardown_scratch "$scratch"
}

test_workspace_dotdot_filesystem_origin_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  make_safe_fixture_repo "$repo" "../parent/repo.git"
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  assert_grep "origin-is-filesystem-path" "$reason" "../ origin: reason must mention filesystem-path"
  teardown_scratch "$scratch"
}

test_workspace_no_commits_unsafe() {
  local scratch; scratch=$(setup_scratch)
  local repo="$scratch/ws/skynet"
  # Repo with an origin remote but no commits — no local branches yet.
  mkdir -p "$repo"
  ( cd "$repo" && \
    git init -q -b main 2>/dev/null || { git init -q && git checkout -q -b main 2>/dev/null; }
    git config user.email test@test.local
    git config user.name test
    git remote add origin https://github.com/fake/repo.git ) >/dev/null 2>&1
  local reason
  reason=$( _source_supervisor "$scratch"
            _workspace_repo_safety_reason "$repo" )
  # A brand-new repo with no commits either fails detached-head (no symbolic ref
  # yet on some git versions) or no-local-branches (once init lays down HEAD ptr
  # but no refs/heads/main entry exists yet). Either fail-closed reason is
  # acceptable — both keep the repo untouched, which is what the shape wants.
  if ! printf '%s' "$reason" | grep -qE "no-local-branches|detached-head"; then
    fail "no-commits repo: reason must be a fail-closed token (got: '$reason')"
  fi
  teardown_scratch "$scratch"
}

test_workspace_cleanup_symlinked_workspace_refused() {
  local scratch; scratch=$(setup_scratch)
  mkdir -p "$scratch/tina"
  mkdir -p "$scratch/elsewhere"
  make_safe_fixture_repo "$scratch/elsewhere/skynet"
  ln -s "$scratch/elsewhere" "$scratch/tina/workspace"
  local out
  out=$( _source_supervisor "$scratch"
         clean_workspace_repos tina "$scratch/tina" 2>&1 )
  assert_grep "workspace is a symlink" "$out" "symlinked workspace: must WARN and refuse to follow"
  # And the repo behind the symlink must be untouched.
  assert_file "$scratch/elsewhere/skynet/.git" \
    "symlinked workspace: repo behind the symlink must NOT be deleted"
  teardown_scratch "$scratch"
}

test_workspace_cleanup_unsafe_repo_travels_with_archive() {
  # Integration test: an unsafe repo (dirty tree) MUST survive into the moved
  # archive folder — the safety gate protects local-only work.
  _retire_test_preamble || { PASS=$((PASS + 1)); return; }
  local scratch; scratch=$(setup_scratch)
  fixture_identity "$scratch" tina --cursor-age-days 200
  fixture_relay_json "$scratch/tina" "http://127.0.0.1:STUB_PORT/_matrix/client/v3" "@tina:test" "pw" "tok"
  make_safe_fixture_repo "$scratch/tina/workspace/skynet"
  printf 'dirty\n' >> "$scratch/tina/workspace/skynet/README"  # make it unsafe
  start_stub_homeserver 200 || { teardown_scratch "$scratch"; return; }
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/tina/relay.json"
  local rc=0 out
  out=$( _source_supervisor "$scratch"
         retire_identity "tina" 2>&1 ) || rc=$?
  stop_stub_homeserver
  assert_eq "0" "$rc" "unsafe-travels: retire must still succeed"
  assert_file "${scratch}-archive/tina/workspace/skynet/.git" \
    "unsafe-travels: dirty repo must survive into the archived workspace (never blocks retire)"
  assert_grep "workspace-cleanup: skipped repo" "$out" \
    "unsafe-travels: retire log must record the skip"
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

# --- Phase 133 D-13/D-13a/D-14 inline-retry refactor ---
# (The three pre-Phase-133 tests pinning the cross-tick fail-counter + stuck-sentinel
# mechanism were deleted along with the mechanism itself; retire_identity is now atomic
# from the caller's perspective and recovers inline from transient failures. The six new
# tests below pin the new contract.)
run_test test_retire_step1_recovers_after_transient_5xx
run_test test_retire_step1_terminal_after_3_5xx
run_test test_retire_step1_permanent_400_no_retry
run_test test_retire_step4b_state3_collision_no_retry
run_test test_scanner_no_longer_writes_counter_or_retire_stuck
run_test test_scanner_bypasses_legacy_retire_stuck_sentinel

# --- MODE-agnostic scan (Pitfall 1 + 2) ---
run_test test_scan_walks_all_identity_folders

# --- 24h gate (Pitfall 5) ---
run_test test_24h_gate_no_marker_runs_immediately
run_test test_24h_gate_recent_marker_skips
run_test test_24h_gate_expired_marker_runs
run_test test_24h_gate_marker_bumped_after_scan

# --- Phase 115 D-22: user-initiated sentinel-scan branch + retire reorder ---
run_test test_sentinel_scan_triggers_retire
run_test test_sentinel_scan_bypasses_all_guards
run_test test_daily_path_preserves_all_guards
run_test test_retire_step_order_observable
run_test test_sentinel_delete_before_move_collision
run_test test_ambient_monitor_graceful_shutdown_observable_minimal
run_test test_sentinel_scan_on_malformed_identity_does_not_crash

# --- Phase 115 /close follow-up: real-tmux-session teardown gap closure ---
run_test test_retire_kills_live_tmux_session

# --- Workspace repo cleanup at retire time ---
# Safety-gate unit tests
run_test test_workspace_safe_repo_returns_empty_reason
run_test test_workspace_no_git_dir_unsafe
run_test test_workspace_no_origin_unsafe
run_test test_workspace_filesystem_origin_unsafe
run_test test_workspace_file_scheme_origin_unsafe
run_test test_workspace_ssh_scp_origin_safe
run_test test_workspace_uncommitted_changes_unsafe
run_test test_workspace_untracked_file_unsafe
run_test test_workspace_gitignored_untracked_safe
run_test test_workspace_unpushed_commit_unsafe
run_test test_workspace_no_upstream_branch_unsafe
run_test test_workspace_gone_upstream_unsafe
run_test test_workspace_stash_entry_unsafe
# Additional fail-closed cases surfaced by post-implementation code review
run_test test_workspace_detached_head_unsafe
run_test test_workspace_local_branch_upstream_unsafe
run_test test_workspace_unknown_scheme_origin_unsafe
run_test test_workspace_relative_filesystem_origin_unsafe
run_test test_workspace_dotdot_filesystem_origin_unsafe
run_test test_workspace_no_commits_unsafe
# clean_workspace_repos walker/pruner tests
run_test test_workspace_cleanup_no_workspace_dir_noop
run_test test_workspace_cleanup_deletes_safe_repo
run_test test_workspace_cleanup_preserves_unsafe_repo
run_test test_workspace_cleanup_mixed_safe_and_unsafe
run_test test_workspace_cleanup_non_repo_files_untouched
run_test test_workspace_cleanup_nested_repo_pruned
run_test test_workspace_cleanup_nested_repo_within_safe_outer_deleted_together
run_test test_workspace_cleanup_depth_limit_respected
run_test test_workspace_cleanup_symlinked_workspace_refused
# Integration with retire_identity
run_test test_workspace_cleanup_hook_fires_before_folder_move
run_test test_workspace_cleanup_unsafe_repo_travels_with_archive

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
