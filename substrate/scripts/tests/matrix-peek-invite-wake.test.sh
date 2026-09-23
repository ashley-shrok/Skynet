#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317
# Test driver for the invite-wake behavior of _matrix_peek_one in agent-supervisor.sh.
#
# Covers the fix for the dormant-DM black-hole: a peer creating a fresh DM room and
# messaging a dormant identity used to fail to wake (recv.sh wasn't running, and the
# supervisor's dormant peek only counted messages in already-joined rooms). After the
# fix, presence of any entry in .rooms.invite counts as a wake signal.
#
# Cases:
#   T-01 quiet sync (nothing new)                      -> no wake  (return 1)
#   T-02 joined-room message from peer                 -> wake     (return 0)
#   T-03 pending invite in .rooms.invite (THE FIX)     -> wake     (return 0)
#   T-04 state event only in joined room (regression   -> no wake  (return 1)
#        guard for 2026-09-12 registry-churn fix)
#   T-05 own message only (sender-filter guard)        -> no wake  (return 1)
#   T-06 combined: peer msg + invite                   -> wake     (return 0)
#
# Exits 0 on all-pass; 1 on any failure with a diagnostic naming the failing test.
#
# Usage: bash substrate/scripts/tests/matrix-peek-invite-wake.test.sh
#   Run from the repo root. Override supervisor path:
#   SUPERVISOR=/path/to/agent-supervisor.sh bash substrate/scripts/tests/matrix-peek-invite-wake.test.sh
#
# Requirements: bash, jq, curl, python3.
# Isolation contract (same as agent-supervisor-archive-scan.sh):
#   AGENT_IDENTITIES_DIR / AGENT_IDENTITIES_ARCHIVE_DIR redirect to a scratch dir;
#   AGENT_SUPERVISOR_LIB_ONLY=1 stops before the reconcile loop.

export AGENT_SUPERVISOR_LIB_ONLY=1

set -u

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"

if [ ! -f "$SUPERVISOR" ]; then
  printf 'FATAL: supervisor not found at %s\n' "$SUPERVISOR" >&2
  exit 1
fi

for _tool in jq curl python3; do
  command -v "$_tool" >/dev/null 2>&1 || {
    printf 'FATAL: %s not found — required for this test driver\n' "$_tool" >&2
    exit 1
  }
done

# ---- test state ----
PASS=0
FAIL=0
FAILURES=()
CURRENT_TEST=""

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

# ---- source supervisor hermetically ----
_source_supervisor() {
  local scratch="$1"
  export AGENT_IDENTITIES_DIR="$scratch"
  export AGENT_IDENTITIES_ARCHIVE_DIR="${scratch}-archive"
  export DORMANCY_STATE_DIR="$scratch/.state"
  export AGENT_SUPERVISOR_LIB_ONLY=1
  # shellcheck disable=SC1090
  source "$SUPERVISOR" 2>/dev/null || true
}

# ---- fixture helpers ----
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

# fixture_identity_with_relay: create $scratch/<name>/ with relay.json + relay-state
# containing a saved token and since cursor. Base URL uses STUB_PORT placeholder that
# tests substitute after start_sync_stub.
fixture_identity_with_relay() {
  local scratch="$1" name="$2" mxid="$3"
  local iddir="$scratch/$name"
  mkdir -p "$iddir/relay-state"
  printf -- '---\nrole: test\n---\nbody\n' > "$iddir/$name.md"
  jq -n --arg base "http://127.0.0.1:STUB_PORT/_matrix/client/v3" \
        --arg user_id "$mxid" \
        --arg password "pw" \
        --arg access_token "tok-fixture" \
    '{"base":$base,"user_id":$user_id,"password":$password,"access_token":$access_token,"token":$access_token}' \
    > "$iddir/relay.json"
  printf 'tok-fixture' > "$iddir/relay-state/token"
  printf 's_1_2_3'      > "$iddir/relay-state/since"
}

# ---- GET-serving stub homeserver ----
# The stub returns the contents of $STUB_BODY_FILE for every GET request (including
# /sync). Tests write a fresh canned response to that file before invoking
# _matrix_peek_one so each case exercises a different sync payload without restarting
# the server.
STUB_PID=""
STUB_PORT=""
STUB_LOG=""
STUB_BODY_FILE=""

start_sync_stub() {
  STUB_PID=""
  STUB_PORT=""
  STUB_LOG=$(mktemp)
  STUB_BODY_FILE=$(mktemp)
  printf '{}' > "$STUB_BODY_FILE"   # sensible default so an unset test returns valid JSON

  python3 -c "
import http.server, sys, socketserver

port_file = sys.argv[1]
body_file = sys.argv[2]

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        with open(body_file, 'rb') as f:
            body = f.read()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        # accept but do nothing — _matrix_peek_one only POSTs on 401 which these tests avoid
        length = int(self.headers.get('Content-Length', 0))
        if length > 0:
            self.rfile.read(length)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{}')
    def log_message(self, fmt, *args): pass

with socketserver.TCPServer(('127.0.0.1', 0), Handler) as server:
    port = server.server_address[1]
    with open(port_file, 'w') as f:
        f.write(str(port))
    server.serve_forever()
" "$STUB_LOG" "$STUB_BODY_FILE" &
  STUB_PID=$!

  local waited=0
  while [ "$waited" -lt 50 ] && [ ! -s "$STUB_LOG" ]; do
    sleep 0.1
    waited=$((waited + 1))
  done
  if [ ! -s "$STUB_LOG" ]; then
    fail "start_sync_stub: python3 stub did not write port within 5s"
    return 1
  fi
  STUB_PORT=$(cat "$STUB_LOG")
  return 0
}

stop_sync_stub() {
  if [ -n "$STUB_PID" ]; then
    kill "$STUB_PID" 2>/dev/null || true
    wait "$STUB_PID" 2>/dev/null || true
    STUB_PID=""
  fi
  [ -n "$STUB_LOG" ]       && rm -f "$STUB_LOG"
  [ -n "$STUB_BODY_FILE" ] && rm -f "$STUB_BODY_FILE"
  STUB_LOG=""
  STUB_BODY_FILE=""
  STUB_PORT=""
}

# set_stub_body <json>  — atomically replace the stub's canned response body.
set_stub_body() {
  printf '%s' "$1" > "$STUB_BODY_FILE"
}

# ---- run_test wrapper ----
run_test() {
  local test_fn="$1"
  local before_fail=$FAIL
  CURRENT_TEST="$test_fn"
  stop_sync_stub 2>/dev/null || true
  "$test_fn"
  if [ "$FAIL" -eq "$before_fail" ]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$test_fn"
  else
    printf 'FAIL  %s\n' "$test_fn"
  fi
}

# Cleanup on any exit
cleanup() {
  stop_sync_stub 2>/dev/null || true
}
trap cleanup EXIT

# ---- shared test scaffolding ----
# _run_peek_with_body: given a scratch dir, fixture identity name, mxid, and canned
# sync response JSON, source the supervisor, start the stub, seat the response, invoke
# _matrix_peek_one, and echo its return code. Caller asserts on the echoed value.
_run_peek_with_body() {
  local scratch="$1" name="$2" mxid="$3" body="$4"
  fixture_identity_with_relay "$scratch" "$name" "$mxid"
  start_sync_stub || return 1
  sed -i "s|STUB_PORT|$STUB_PORT|" "$scratch/$name/relay.json"
  set_stub_body "$body"
  _source_supervisor "$scratch"
  # silence the metric() logger to keep test output clean
  metric() { :; }
  local rc=0
  _matrix_peek_one "$name" "$scratch/$name/relay.json" "$scratch/$name/relay-state" >/dev/null 2>&1 || rc=$?
  stop_sync_stub
  echo "$rc"
}

# ============================================================
# TESTS
# ============================================================

test_quiet_sync_no_wake() {
  local scratch; scratch=$(setup_scratch)
  local rc
  rc=$(_run_peek_with_body "$scratch" "quiet" "@quiet:test" '{}')
  assert_eq "1" "$rc" "quiet sync should NOT wake (rc=1)"
  teardown_scratch "$scratch"
}

test_joined_room_peer_message_wakes() {
  local scratch; scratch=$(setup_scratch)
  local body='{"rooms":{"join":{"!r1:test":{"timeline":{"events":[{"sender":"@peer:test","type":"m.room.message","content":{"body":"hi"}}]}}}}}'
  local rc
  rc=$(_run_peek_with_body "$scratch" "hasmsg" "@hasmsg:test" "$body")
  assert_eq "0" "$rc" "joined-room peer message SHOULD wake (rc=0)"
  teardown_scratch "$scratch"
}

# THE FIX: pending invite alone must count as a wake signal.
test_pending_invite_wakes() {
  local scratch; scratch=$(setup_scratch)
  local body='{"rooms":{"invite":{"!newroom:test":{"invite_state":{"events":[{"type":"m.room.member","sender":"@peer:test","state_key":"@dormant:test","content":{"membership":"invite"}}]}}}}}'
  local rc
  rc=$(_run_peek_with_body "$scratch" "dormant" "@dormant:test" "$body")
  assert_eq "0" "$rc" "pending invite SHOULD wake (rc=0) — the dormant-DM fix"
  teardown_scratch "$scratch"
}

# Regression guard: registry-room membership churn (m.room.member state events on JOINED
# rooms from other identity mints) must NOT wake — that was the 2026-09-12 fix.
test_state_event_only_no_wake() {
  local scratch; scratch=$(setup_scratch)
  local body='{"rooms":{"join":{"!registry:test":{"timeline":{"events":[{"sender":"@newpeer:test","type":"m.room.member","state_key":"@newpeer:test","content":{"membership":"join"}}]}}}}}'
  local rc
  rc=$(_run_peek_with_body "$scratch" "regreg" "@regreg:test" "$body")
  assert_eq "1" "$rc" "state event in joined room should NOT wake (regression guard)"
  teardown_scratch "$scratch"
}

# Regression guard: sender-is-self must not wake (a self-echo isn't a signal).
test_own_message_no_wake() {
  local scratch; scratch=$(setup_scratch)
  local body='{"rooms":{"join":{"!r1:test":{"timeline":{"events":[{"sender":"@me:test","type":"m.room.message","content":{"body":"my own"}}]}}}}}'
  local rc
  rc=$(_run_peek_with_body "$scratch" "me" "@me:test" "$body")
  assert_eq "1" "$rc" "own message should NOT wake (sender-filter guard)"
  teardown_scratch "$scratch"
}

test_combined_message_and_invite_wakes() {
  local scratch; scratch=$(setup_scratch)
  local body='{"rooms":{"join":{"!r1:test":{"timeline":{"events":[{"sender":"@peer:test","type":"m.room.message","content":{"body":"hi"}}]}}},"invite":{"!newroom:test":{"invite_state":{"events":[]}}}}}'
  local rc
  rc=$(_run_peek_with_body "$scratch" "both" "@both:test" "$body")
  assert_eq "0" "$rc" "combined message+invite SHOULD wake (rc=0)"
  teardown_scratch "$scratch"
}

# ============================================================
# DRIVER
# ============================================================

run_test test_quiet_sync_no_wake
run_test test_joined_room_peer_message_wakes
run_test test_pending_invite_wakes
run_test test_state_event_only_no_wake
run_test test_own_message_no_wake
run_test test_combined_message_and_invite_wakes

echo "==============================="
echo "PASS: $PASS  FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
exit 0
