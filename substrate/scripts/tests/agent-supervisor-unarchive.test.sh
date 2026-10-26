#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2030,SC2031
# (SC2317 false positive: test functions are called indirectly via run_test)
# (SC2030/SC2031 intentional: env exports live inside per-test ( ... ) subshells)
#
# Test driver for the un-archive host-side shape's three scanners in
# agent-supervisor.sh:
#   - scan_identity_unarchive_requested_sentinels()
#   - scan_role_unarchive_requested_sentinels()      (added by shape task 3)
#   - scan_app_unarchive_requested_sentinels()       (added by shape task 4)
#
# Also unit tests _extract_frontmatter_roles() across the three permitted
# YAML shapes (scalar, flow list, block list).
#
# Exits 0 on all-pass; exits 1 on any failure with a diagnostic naming the
# failing test.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-unarchive.test.sh
#   Run from the repo root. Override supervisor path:
#     SUPERVISOR=/path/to/agent-supervisor.sh bash <this>
#
# Requirements: bash, shellcheck, tmux, jq, stat, curl, python3 (mandatory —
# same as the supervisor, plus python3 for the frontmatter parser + the
# stub admin homeserver).
#
# Isolation: every test that sources the supervisor exports:
#   AGENT_IDENTITIES_DIR=<scratch>
#   AGENT_IDENTITIES_ARCHIVE_DIR=<scratch>-archive
#   AGENT_ROLES_DIR=<scratch>-roles
#   AGENT_ROLES_ARCHIVE_DIR=<scratch>-roles-archive
#   AGENT_SERVICE_REQUESTS_DIR=<scratch>-requests
#   AGENT_SUPERVISOR_LIB_ONLY=1
#
# Identity un-archive (one-path supervisor reactivation shape): the scanner
# asks the backend to reactivate the chat account through the
# identity-reactivate agent service (request files in
# $AGENT_SERVICE_REQUESTS_DIR), saves the returned password into the archived
# relay.json, logs in for a fresh token, then moves the folder live. The flow
# spans several reconcile ticks; tests drive it tick by tick, play the backend
# by writing <uuid>.response.json by hand, and play the homeserver with a
# python stub (whoami + /login). Refusals are asserted via the
# .unarchive-refused note the front end reads.
#
# AGENT_SERVICE_REQUESTS_DIR is ALWAYS pointed at a per-test scratch dir — the
# supervisor's default is the real ~/fleet/service-requests, which a live
# backend answers.

export AGENT_SUPERVISOR_LIB_ONLY=1
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"

if [ ! -f "$SUPERVISOR" ]; then
  printf 'FATAL: supervisor not found at %s\n' "$SUPERVISOR" >&2
  exit 1
fi

MISSING_MANDATORY=""
for _tool in shellcheck tmux jq curl stat python3; do
  command -v "$_tool" >/dev/null 2>&1 || MISSING_MANDATORY="$MISSING_MANDATORY $_tool"
done
if [ -n "$MISSING_MANDATORY" ]; then
  printf 'FATAL: mandatory tools missing:%s\n' "$MISSING_MANDATORY" >&2
  exit 1
fi

# ---- test state ----
PASS=0
FAIL=0
FAILURES=()
CURRENT_TEST=""

fail() {
  FAILURES+=("${CURRENT_TEST:-unknown}: ${1:-unknown failure}")
  FAIL=$((FAIL + 1))
}

assert_eq() {
  local expected="$1" actual="$2" msg="${3:-assert_eq}"
  if [ "$expected" != "$actual" ]; then
    fail "$msg: expected='$expected' got='$actual'"
  fi
}

assert_file() {
  local p="$1" msg="${2:-assert_file}"
  [ -e "$p" ] || fail "$msg: expected file/dir '$p' to exist"
}

assert_nofile() {
  local p="$1" msg="${2:-assert_nofile}"
  [ ! -e "$p" ] || fail "$msg: expected '$p' to NOT exist"
}

assert_grep() {
  local pattern="$1" haystack="$2" msg="${3:-assert_grep}"
  # `-- $pattern` disables option parsing so patterns beginning with `--`
  # (e.g. `--user daemon-reload`) aren't misread as grep flags.
  if ! printf '%s' "$haystack" | grep -qE -- "$pattern"; then
    fail "$msg: pattern '$pattern' not found in output"
  fi
}

assert_nogrep() {
  local pattern="$1" haystack="$2" msg="${3:-assert_nogrep}"
  if printf '%s' "$haystack" | grep -qE -- "$pattern"; then
    fail "$msg: unexpected match for '$pattern' in output"
  fi
}

run_test() {
  local test_fn="$1"
  CURRENT_TEST="$test_fn"
  local prev_fail=$FAIL
  stop_stub_admin 2>/dev/null || true
  "$test_fn"
  if [ "$FAIL" -eq "$prev_fail" ]; then
    PASS=$((PASS + 1))
    printf '  OK   %s\n' "$test_fn"
  else
    printf '  FAIL %s\n' "$test_fn"
  fi
  CURRENT_TEST=""
}

# ---- hermetic supervisor sourcing ----
_source_supervisor_unarchive() {
  local scratch="${1:-/tmp}"
  local systemctl_stub="${2:-}"
  export AGENT_IDENTITIES_DIR="$scratch"
  export AGENT_IDENTITIES_ARCHIVE_DIR="${scratch}-archive"
  export AGENT_ROLES_DIR="${scratch}-roles"
  export AGENT_ROLES_ARCHIVE_DIR="${scratch}-roles-archive"
  export AGENT_APPS_DIR="${scratch}-apps"
  export AGENT_APPS_ARCHIVE_DIR="${scratch}-apps-archive"
  export AGENT_SYSTEMD_UNIT_DIR="${scratch}-systemd-units"
  export AGENT_APP_CREATE_LOCK="$scratch/.create-lock"
  if [ -n "$systemctl_stub" ]; then
    export AGENT_SYSTEMCTL_BIN="$systemctl_stub"
  fi
  export DORMANCY_STATE_DIR="$scratch/.state"
  # Never the real ~/fleet/service-requests (a live backend answers there).
  export AGENT_SERVICE_REQUESTS_DIR="${scratch}-requests"
  export AGENT_SUPERVISOR_LIB_ONLY=1
  # shellcheck disable=SC1090
  source "$SUPERVISOR" 2>/dev/null || true
}

# ---- fixtures ----
setup_unarchive_scratch() {
  local s; s=$(mktemp -d)
  mkdir -p "$s/.state" "${s}-archive" "${s}-roles" "${s}-roles-archive" \
           "${s}-apps" "${s}-apps-archive" "${s}-requests"
  printf '%s' "$s"
}

teardown_unarchive_scratch() {
  local s="$1"
  [ -n "$s" ] && [ -d "$s" ] && rm -rf "$s"
  [ -n "$s" ] && [ -d "${s}-archive" ] && rm -rf "${s}-archive"
  [ -n "$s" ] && [ -d "${s}-roles" ] && rm -rf "${s}-roles"
  [ -n "$s" ] && [ -d "${s}-roles-archive" ] && rm -rf "${s}-roles-archive"
  [ -n "$s" ] && [ -d "${s}-apps" ] && rm -rf "${s}-apps"
  [ -n "$s" ] && [ -d "${s}-apps-archive" ] && rm -rf "${s}-apps-archive"
  [ -n "$s" ] && [ -d "${s}-requests" ] && rm -rf "${s}-requests"
}

# Create an archived identity fixture under $IDENTITIES_ARCHIVE_DIR.
# Usage: fixture_archived_identity <scratch> <name> <role_spec> [--no-dormancy] [--no-relay]
#   <role_spec> is one of:
#     scalar:<name>              → `roles: <name>`
#     flow:name1,name2,...       → `roles: [name1, name2]`
#     block:name1,name2,...      → `roles:\n  - name1\n  - name2`
#     legacy:<name>              → `role: <name>` (retired singular key; must be ignored)
#     none                       → no roles: line at all
#     empty                      → `roles: []`
#     malformed                  → no frontmatter fences
fixture_archived_identity() {
  local scratch="$1" name="$2" role_spec="$3"
  shift 3
  local no_dormancy=false no_relay=false
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --no-dormancy) no_dormancy=true ;;
      --no-relay) no_relay=true ;;
    esac
    shift
  done
  local d="${scratch}-archive/$name"
  mkdir -p "$d"

  local ident_file="$d/$name.md"
  case "$role_spec" in
    malformed)
      printf 'no frontmatter here\n' > "$ident_file"
      ;;
    none)
      printf -- '---\ndisplayName: test\n---\nbody\n' > "$ident_file"
      ;;
    empty)
      printf -- '---\nroles: []\ndisplayName: test\n---\nbody\n' > "$ident_file"
      ;;
    legacy:*)
      # Retired singular key — must NOT be read by any parser.
      local r="${role_spec#legacy:}"
      printf -- '---\nrole: %s\ndisplayName: test\n---\nbody\n' "$r" > "$ident_file"
      ;;
    scalar:*)
      local r="${role_spec#scalar:}"
      printf -- '---\nroles: %s\ndisplayName: test\n---\nbody\n' "$r" > "$ident_file"
      ;;
    flow:*)
      local list="${role_spec#flow:}"
      # Convert "a,b,c" to "a, b, c" for readable frontmatter.
      local flow; flow=$(printf '%s' "$list" | sed 's/,/, /g')
      printf -- '---\nroles: [%s]\ndisplayName: test\n---\nbody\n' "$flow" > "$ident_file"
      ;;
    block:*)
      local list="${role_spec#block:}"
      {
        printf -- '---\nroles:\n'
        # printf '%s\n' terminates the list with a newline so `read` picks up
        # the last field; using '%s' would drop it.
        printf '%s\n' "$list" | tr ',' '\n' | while IFS= read -r r; do
          [ -z "$r" ] && continue
          printf -- '  - %s\n' "$r"
        done
        printf -- 'displayName: test\n---\nbody\n'
      } > "$ident_file"
      ;;
    *)
      fail "fixture_archived_identity: unknown role_spec '$role_spec'"
      return 1
      ;;
  esac

  if ! $no_relay; then
    # Use STUB_PORT placeholder — tests sed it in after start_stub_admin.
    jq -n \
      --arg base       "http://127.0.0.1:STUB_PORT/_matrix/client/v3" \
      --arg user_id    "@$name:test" \
      --arg password   "pw-$name" \
      --arg access_token "stale-tok-$name" \
      '{base:$base,user_id:$user_id,password:$password,access_token:$access_token,token:$access_token}' \
      > "$d/relay.json"
  fi

  $no_dormancy && touch "$d/.no-dormancy"
  # Always drop the .unarchive-requested sentinel — that's what the scanner scans for.
  touch "$d/.unarchive-requested"
}

# Create a live role folder at $ROLES_DIR/<role>/.
fixture_live_role() {
  local scratch="$1" role="$2"
  mkdir -p "${scratch}-roles/$role"
  printf 'role-marker\n' > "${scratch}-roles/$role/role.md"
}

# ---- stub homeserver ----
# Three endpoints exercised:
#   GET  /_matrix/client/v3/account/whoami → canned status code (sequence)
#   GET  /_matrix/client/v3/profile/<mxid> → canned status code (sequence)
#   POST /_matrix/client/v3/login          → canned status code (sequence);
#        on 200 the body carries access_token "fresh-tok"
#
# Usage: start_stub_admin <get_codes> [post_codes] [profile_codes]
# profile_codes defaults to 200 — a live account has a profile; archiving's
# erase deletes it (404).
# post_codes defaults to 403 — what a deactivated account (or a stale
# password) gets, so step d's pre-login falls through to filing a request.
# Each is a comma-separated status-code sequence; once exhausted, the LAST
# code repeats. Every request (method, path, body) is appended to
# $STUB_REQ_LOG so tests can check what was sent.
STUB_PID=""
STUB_PORT=""
STUB_LOG=""
STUB_REQ_LOG=""

start_stub_admin() {
  local get_codes="${1:-200}" post_codes="${2:-403}" profile_codes="${3:-200}"
  STUB_PID=""
  STUB_PORT=""
  STUB_LOG=$(mktemp)
  STUB_REQ_LOG=$(mktemp)

  python3 -c "
import http.server, sys, socketserver, json

get_codes  = [int(c) for c in sys.argv[1].split(',')]
post_codes = [int(c) for c in sys.argv[2].split(',')]
port_file  = sys.argv[3]
req_log    = sys.argv[4]
profile_codes = [int(c) for c in sys.argv[5].split(',')]
counters   = {'GET': 0, 'POST': 0, 'PROFILE': 0}

class Handler(http.server.BaseHTTPRequestHandler):
    def _log_and_respond(self, method, codes, counter=None):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length > 0 else b''
        with open(req_log, 'ab') as f:
            f.write(('%s %s %d ' % (method, self.path, length)).encode('utf-8'))
            f.write(body.replace(b'\n', b' '))
            f.write(b'\n')
        counter = counter or method
        idx = min(counters[counter], len(codes) - 1)
        counters[counter] += 1
        code = codes[idx]
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        if code == 200 and method == 'GET':
            self.wfile.write(b'{\"user_id\":\"@test:test\",\"device_id\":\"TESTDEV\"}')
        elif code == 200 and method == 'POST':
            self.wfile.write(b'{\"user_id\":\"@test:test\",\"access_token\":\"fresh-tok\",\"device_id\":\"NEWDEV\"}')
        else:
            self.wfile.write(b'{\"errcode\":\"M_FORBIDDEN\"}')

    def do_GET(self):
        if self.path.startswith('/_matrix/client/v3/profile/'):
            self._log_and_respond('GET', profile_codes, 'PROFILE')
        else:
            self._log_and_respond('GET', get_codes)
    def do_POST(self): self._log_and_respond('POST', post_codes)
    def log_message(self, fmt, *args): pass

with socketserver.TCPServer(('127.0.0.1', 0), Handler) as server:
    port = server.server_address[1]
    with open(port_file, 'w') as f:
        f.write(str(port))
    server.serve_forever()
" "$get_codes" "$post_codes" "$STUB_LOG" "$STUB_REQ_LOG" "$profile_codes" &
  STUB_PID=$!

  local waited=0
  while [ "$waited" -lt 50 ] && [ ! -s "$STUB_LOG" ]; do
    sleep 0.1
    waited=$((waited + 1))
  done
  if [ ! -s "$STUB_LOG" ]; then
    fail "start_stub_admin: python3 stub did not write port within 5s"
    return 1
  fi
  STUB_PORT=$(cat "$STUB_LOG")
  return 0
}

stop_stub_admin() {
  if [ -n "${STUB_PID:-}" ]; then
    kill "$STUB_PID" 2>/dev/null || true
    wait "$STUB_PID" 2>/dev/null || true
    STUB_PID=""
  fi
  [ -n "${STUB_LOG:-}" ] && rm -f "$STUB_LOG"
  STUB_LOG=""
  [ -n "${STUB_REQ_LOG:-}" ] && rm -f "$STUB_REQ_LOG"
  STUB_REQ_LOG=""
  STUB_PORT=""
}

# ============================================================
# Frontmatter role parser unit tests
# ============================================================

test_extract_roles_scalar() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_archived_identity "$scratch" alpha "scalar:box-maintainer"
  local got
  got=$( _source_supervisor_unarchive "$scratch"
         _extract_frontmatter_roles "${scratch}-archive/alpha/alpha.md" )
  assert_eq '["box-maintainer"]' "$got" "scalar role should produce single-element JSON array"
  teardown_unarchive_scratch "$scratch"
}

test_extract_roles_flow_list() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_archived_identity "$scratch" beta "flow:box-maintainer,sky-uat"
  local got
  got=$( _source_supervisor_unarchive "$scratch"
         _extract_frontmatter_roles "${scratch}-archive/beta/beta.md" )
  assert_eq '["box-maintainer", "sky-uat"]' "$got" "flow list should produce 2-element JSON array"
  teardown_unarchive_scratch "$scratch"
}

test_extract_roles_block_list() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_archived_identity "$scratch" gamma "block:box-maintainer,sky-uat,test"
  local got
  got=$( _source_supervisor_unarchive "$scratch"
         _extract_frontmatter_roles "${scratch}-archive/gamma/gamma.md" )
  assert_eq '["box-maintainer", "sky-uat", "test"]' "$got" "block list should produce 3-element JSON array"
  teardown_unarchive_scratch "$scratch"
}

test_extract_roles_none() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_archived_identity "$scratch" delta "none"
  local got rc=0
  got=$( _source_supervisor_unarchive "$scratch"
         _extract_frontmatter_roles "${scratch}-archive/delta/delta.md" ) || rc=$?
  assert_eq "0" "$rc" "no roles: field is legal (returns empty array + rc=0)"
  assert_eq '[]' "$got" "no role field should produce empty JSON array"
  teardown_unarchive_scratch "$scratch"
}

test_extract_roles_singular_key_ignored() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_archived_identity "$scratch" legacy "legacy:box-maintainer"
  local got rc=0
  got=$( _source_supervisor_unarchive "$scratch"
         _extract_frontmatter_roles "${scratch}-archive/legacy/legacy.md" ) || rc=$?
  assert_eq "0" "$rc" "singular role: key: still a valid frontmatter (rc=0)"
  assert_eq '[]' "$got" "singular role: key is NOT read (empty JSON array)"
  teardown_unarchive_scratch "$scratch"
}

test_extract_roles_malformed() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_archived_identity "$scratch" epsilon "malformed"
  local rc=0
  ( _source_supervisor_unarchive "$scratch"
    _extract_frontmatter_roles "${scratch}-archive/epsilon/epsilon.md" >/dev/null ) || rc=$?
  assert_eq "1" "$rc" "malformed frontmatter should return rc=1"
  teardown_unarchive_scratch "$scratch"
}

# ============================================================
# scan_identity_unarchive_requested_sentinels — behavior tests
# ============================================================

# _tick <scratch> — one reconcile tick of the identity scanner (fresh source,
# like the real supervisor's next pass). Prints the scanner's log output.
_tick() {
  local scratch="$1"
  ( _source_supervisor_unarchive "$scratch"
    scan_identity_unarchive_requested_sentinels 2>&1 ) || true
}

# _point_relay <scratch> <name> — aim the fixture relay.json at the stub.
_point_relay() {
  sed -i "s|STUB_PORT|$STUB_PORT|" "${1}-archive/$2/relay.json"
}

# _request_files <scratch> — request files (not responses/claims) in the
# scratch service-requests dir, one per line.
_request_files() {
  local f
  for f in "${1}-requests"/*.json; do
    [ -e "$f" ] || continue
    case "$f" in *.response.json|*.claimed.json) continue ;; esac
    printf '%s\n' "$f"
  done
}

_request_count() { _request_files "$1" | grep -c . || true; }

# _all_request_files_count <scratch> — every file in the requests dir.
_all_request_files_count() { find "${1}-requests" -type f | wc -l | tr -d ' '; }

# _respond <scratch> <uuid> <json> — play the backend: write the response.
_respond() { printf '%s\n' "$3" > "${1}-requests/$2.response.json"; }

# _login_count — POST /login calls the stub has seen so far.
_login_count() { grep -c '^POST /_matrix/client/v3/login' "$STUB_REQ_LOG" || true; }

_state() { cat "${1}-archive/$2/.unarchive-reactivate" 2>/dev/null || true; }

# _assert_refused <scratch> <name> <note-pattern> <label>
_assert_refused() {
  local scratch="$1" name="$2" pat="$3" label="$4"
  local d="${scratch}-archive/$name"
  assert_nofile "$scratch/$name"               "$label: no folder moved"
  assert_file   "$d"                           "$label: archive folder retained"
  assert_nofile "$d/.unarchive-requested"      "$label: flag cleared"
  assert_nofile "$d/.unarchive-reactivate"     "$label: progress state cleared"
  assert_nofile "$d/.dormant"                  "$label: .dormant NOT written"
  assert_file   "$d/.unarchive-refused"        "$label: refusal note written"
  assert_grep "$pat" "$(cat "$d/.unarchive-refused" 2>/dev/null)" "$label: refusal note names the reason"
  assert_eq "0" "$(_all_request_files_count "$scratch")" "$label: no service-request files left behind"
}

# _assert_completed <scratch> <name> <label>
_assert_completed() {
  local scratch="$1" name="$2" label="$3"
  assert_file   "$scratch/$name"                       "$label: live folder present after mv"
  assert_nofile "${scratch}-archive/$name"             "$label: archive folder gone after mv"
  assert_nofile "$scratch/$name/.unarchive-requested"  "$label: flag cleared"
  assert_nofile "$scratch/$name/.unarchive-reactivate" "$label: progress state cleared"
  assert_nofile "$scratch/$name/.unarchive-refused"    "$label: no refusal note"
  assert_grep "You were unarchived at" "$(cat "$scratch/$name/$name.md" 2>/dev/null)" "$label: banner present"
}

# --- pre-flight refusals ---

test_identity_name_collision_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" eta "scalar:box-maintainer"
  mkdir -p "$scratch/eta"
  printf 'existing live identity\n' > "$scratch/eta/eta.md"

  local out; out=$(_tick "$scratch")

  assert_eq "existing live identity" "$(cat "$scratch/eta/eta.md")" "name-collision: live identity untouched"
  assert_file   "${scratch}-archive/eta"                       "name-collision: archive folder retained"
  assert_nofile "${scratch}-archive/eta/.unarchive-requested"  "name-collision: flag cleared"
  assert_grep "live identity named 'eta' already exists" "$(cat "${scratch}-archive/eta/.unarchive-refused" 2>/dev/null)" \
    "name-collision: refusal note names the collision"
  assert_eq "0" "$(_all_request_files_count "$scratch")" "name-collision: no reactivation requested"
  assert_grep "un-archive REFUSED" "$out" "name-collision: LOUD refuse log"
  teardown_unarchive_scratch "$scratch"
}

test_identity_role_missing_scalar_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_archived_identity "$scratch" epsilon "scalar:missing-role"

  local out; out=$(_tick "$scratch")

  _assert_refused "$scratch" epsilon "role\\(s\\) missing-role first" "role-missing"
  assert_grep "un-archive REFUSED" "$out" "role-missing: LOUD refuse log"
  teardown_unarchive_scratch "$scratch"
}

test_identity_role_missing_multi_names_only_missing() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" zeta "flow:box-maintainer,sky-uat"

  _tick "$scratch" >/dev/null

  _assert_refused "$scratch" zeta "sky-uat" "multi-role missing"
  assert_nogrep "box-maintainer" "$(cat "${scratch}-archive/zeta/.unarchive-refused" 2>/dev/null)" \
    "multi-role missing: note does NOT list box-maintainer (which IS live)"
  teardown_unarchive_scratch "$scratch"
}

test_identity_missing_relay_json_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" kappa "scalar:box-maintainer" --no-relay

  _tick "$scratch" >/dev/null

  _assert_refused "$scratch" kappa "relay.json is missing" "no relay.json"
  teardown_unarchive_scratch "$scratch"
}

test_identity_relay_json_without_account_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" kappa "scalar:box-maintainer"
  printf '{"base":"http://127.0.0.1:1","password":"pw"}' > "${scratch}-archive/kappa/relay.json"

  _tick "$scratch" >/dev/null

  _assert_refused "$scratch" kappa "missing its server or account" "relay.json without user_id"
  teardown_unarchive_scratch "$scratch"
}

# --- whoami fast path (account already live, e.g. crash recovery) ---

test_identity_whoami_fast_path_completes() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" alpha "scalar:box-maintainer"
  start_stub_admin "200" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" alpha

  local out; out=$(_tick "$scratch")
  local reqs; reqs=$(cat "$STUB_REQ_LOG")
  stop_stub_admin

  _assert_completed "$scratch" alpha "whoami fast path"
  assert_file "$scratch/alpha/.dormant" "whoami fast path: .dormant travelled with folder"
  assert_eq "stale-tok-alpha" "$(jq -r '.access_token' "$scratch/alpha/relay.json")" \
    "whoami fast path: working token left as-is"
  assert_eq "0" "$(_all_request_files_count "$scratch")" "whoami fast path: no reactivation requested"
  assert_grep "GET /_matrix/client/v3/account/whoami" "$reqs" "whoami fast path: whoami probed"
  assert_grep "GET /_matrix/client/v3/profile/%40alpha%3Atest" "$reqs" "whoami fast path: profile checked"
  assert_nogrep "^POST" "$reqs" "whoami fast path: no login attempted"
  assert_grep "chat login already works" "$out" "whoami fast path: log line"
  assert_grep "un-archive step 4: .dormant written" "$out" "whoami fast path: step 4 wrote .dormant"
  assert_grep "un-archive COMPLETE" "$out" "whoami fast path: completion log"
  teardown_unarchive_scratch "$scratch"
}

test_identity_happy_path_flow_list_all_live() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_live_role "$scratch" sky-uat
  fixture_archived_identity "$scratch" beta "flow:box-maintainer,sky-uat"
  start_stub_admin "200" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" beta

  _tick "$scratch" >/dev/null
  stop_stub_admin

  _assert_completed "$scratch" beta "flow-list happy path"
  assert_file "$scratch/beta/.dormant" "flow-list happy path: .dormant written"
  teardown_unarchive_scratch "$scratch"
}

test_identity_happy_path_block_list_all_live() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_live_role "$scratch" sky-uat
  fixture_archived_identity "$scratch" gamma "block:box-maintainer,sky-uat"
  start_stub_admin "200" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" gamma

  _tick "$scratch" >/dev/null
  stop_stub_admin

  _assert_completed "$scratch" gamma "block-list happy path"
  assert_file "$scratch/gamma/.dormant" "block-list happy path: .dormant written"
  teardown_unarchive_scratch "$scratch"
}

# _assert_roleless_unarchives <role_spec> — an identity with no roles has
# nothing to check in pre-flight 2 and un-archives like any other.
_assert_roleless_unarchives() {
  local spec="$1"
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_archived_identity "$scratch" zeta "$spec"
  start_stub_admin "200" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" zeta

  local out; out=$(_tick "$scratch")
  stop_stub_admin

  _assert_completed "$scratch" zeta "no-roles ($spec)"
  assert_nogrep "REFUSED" "$out" "no-roles ($spec): not refused"
  teardown_unarchive_scratch "$scratch"
}

test_identity_no_roles_unarchives() {
  _assert_roleless_unarchives "empty"
  _assert_roleless_unarchives "none"
}

test_identity_no_dormancy_preserved() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" delta "scalar:box-maintainer" --no-dormancy
  start_stub_admin "200" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" delta

  local out; out=$(_tick "$scratch")
  stop_stub_admin

  _assert_completed "$scratch" delta "no-dormancy"
  assert_file   "$scratch/delta/.no-dormancy" "no-dormancy: marker travelled with folder"
  assert_nofile "$scratch/delta/.dormant"     "no-dormancy: .dormant was NOT written"
  assert_grep "always-on intent preserved" "$out" "no-dormancy: log line names the preservation"
  teardown_unarchive_scratch "$scratch"
}

test_identity_old_refusal_note_removed_on_success() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" omicron "scalar:box-maintainer"
  printf 'an earlier attempt was refused\n' > "${scratch}-archive/omicron/.unarchive-refused"
  start_stub_admin "200" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" omicron

  _tick "$scratch" >/dev/null
  stop_stub_admin

  _assert_completed "$scratch" omicron "old refusal note"
  teardown_unarchive_scratch "$scratch"
}

# --- a working token on a switched-off account (admin-issued token survived the erase) ---

test_identity_whoami_ok_but_no_profile_reactivates() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" omicron "scalar:box-maintainer"
  # whoami 200 (the token outlived the deactivate), profile 404 (erased), old password 403s.
  start_stub_admin "200" "403" "404" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" omicron

  local out; out=$(_tick "$scratch")
  stop_stub_admin

  assert_nogrep "chat login already works" "$out" "no-profile: fast path not taken"
  assert_grep "account is switched off on the chat server" "$out" "no-profile: log line"
  assert_eq "1" "$(_request_count "$scratch")" "no-profile: reactivation requested"
  assert_nofile "$scratch/omicron" "no-profile: not moved yet"
  assert_file "${scratch}-archive/omicron/.unarchive-requested" "no-profile: flag retained"
  teardown_unarchive_scratch "$scratch"
}

test_identity_profile_check_transient_waits() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" pi "scalar:box-maintainer"
  start_stub_admin "200" "403" "502" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" pi

  local out; out=$(_tick "$scratch")
  local reqs; reqs=$(cat "$STUB_REQ_LOG")
  stop_stub_admin

  assert_grep "profile check failed http=502" "$out" "profile transient: log line"
  assert_eq "0" "$(_all_request_files_count "$scratch")" "profile transient: no reactivation requested"
  assert_nogrep "^POST" "$reqs" "profile transient: no login attempted"
  assert_nofile "$scratch/pi" "profile transient: not moved"
  assert_file "${scratch}-archive/pi/.unarchive-requested" "profile transient: flag retained"
  teardown_unarchive_scratch "$scratch"
}

test_identity_reactivation_request_without_display_name() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" rho "scalar:box-maintainer"
  sed -i '/^displayName:/d' "${scratch}-archive/rho/rho.md"
  start_stub_admin "401" "403" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" rho

  _tick "$scratch" >/dev/null
  stop_stub_admin

  local req; req=$(_request_files "$scratch" | head -1)
  assert_eq '{"account":"@rho:test"}' "$(jq -c '.input' "$req" 2>/dev/null)" "no displayName: input carries only the account"
  teardown_unarchive_scratch "$scratch"
}

# --- reactivation via the identity-reactivate service (multi-tick) ---

test_identity_full_reactivation_happy_path() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" nu "scalar:box-maintainer"
  # whoami always 401 (deactivated account's token is dead); tick 1's
  # pre-login with the old password 403s, tick 3's login with the new one 200s.
  start_stub_admin "401" "403,200" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" nu
  local d="${scratch}-archive/nu"

  # Tick 1: files a request naming only the account.
  local out; out=$(_tick "$scratch")
  assert_eq "1" "$(_request_count "$scratch")" "tick 1: exactly one request filed"
  local req uuid
  req=$(_request_files "$scratch" | head -1)
  uuid=$(basename "$req" .json)
  assert_eq "$uuid" "$(_state "$scratch" nu)" "tick 1: state holds the request uuid"
  assert_eq "identity-reactivate" "$(jq -r '.service' "$req" 2>/dev/null)" "tick 1: request names the service"
  assert_eq '{"account":"@nu:test","display_name":"test"}' "$(jq -c '.input' "$req" 2>/dev/null)" "tick 1: input carries the account and its display name"
  assert_grep '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' "$(jq -r '.requested_at' "$req" 2>/dev/null)" "tick 1: requested_at stamped"
  assert_nogrep 'password|pw-nu|stale-tok' "$(cat "$req" 2>/dev/null)" "tick 1: request carries no secret"
  assert_file   "$d/.unarchive-requested" "tick 1: flag retained"
  assert_nofile "$scratch/nu"             "tick 1: not moved yet"
  assert_nofile "$d/.unarchive-refused"   "tick 1: not refused"
  assert_grep "asked the backend to reactivate @nu:test" "$out" "tick 1: log line"
  assert_eq "1" "$(_login_count)" "tick 1: tried the saved password first"
  assert_grep '^POST /_matrix/client/v3/login .*pw-nu' "$(cat "$STUB_REQ_LOG")" "tick 1: pre-login used relay.json's password"

  # Tick 1.5: no response yet → nothing changes.
  _tick "$scratch" >/dev/null
  assert_eq "$uuid" "$(_state "$scratch" nu)" "waiting tick: state unchanged"
  assert_eq "1" "$(_request_count "$scratch")" "waiting tick: no duplicate request"

  # Backend answers ok with a fresh password.
  _respond "$scratch" "$uuid" '{"ok":true,"service":"identity-reactivate","result":{"password":"new-secret-pw"}}'

  # Tick 2: password saved (0600), state "saved", request files dropped.
  out=$(_tick "$scratch")
  assert_eq "new-secret-pw" "$(jq -r '.password' "$d/relay.json")" "tick 2: new password saved in relay.json"
  assert_eq "600" "$(stat -c %a "$d/relay.json")" "tick 2: relay.json mode 600"
  assert_eq "saved" "$(_state "$scratch" nu)" "tick 2: state is 'saved'"
  assert_eq "0" "$(_all_request_files_count "$scratch")" "tick 2: request + response dropped"
  assert_nofile "$scratch/nu" "tick 2: not moved yet"
  assert_nogrep "new-secret-pw" "$out" "tick 2: password never logged"
  assert_eq "1" "$(_login_count)" "tick 2: no login yet (only tick 1's pre-login)"

  # Tick 3: logs in with the new password, saves token, completes.
  out=$(_tick "$scratch")
  local reqs; reqs=$(cat "$STUB_REQ_LOG")
  stop_stub_admin
  assert_grep '^POST /_matrix/client/v3/login .*new-secret-pw' "$reqs" "tick 3: login used the new password"
  assert_grep '^POST /_matrix/client/v3/login .*@nu:test' "$reqs" "tick 3: login named the account"
  _assert_completed "$scratch" nu "tick 3"
  assert_file "$scratch/nu/.dormant" "tick 3: .dormant written"
  assert_eq "fresh-tok" "$(jq -r '.access_token' "$scratch/nu/relay.json")" "tick 3: access_token saved"
  assert_eq "fresh-tok" "$(jq -r '.token' "$scratch/nu/relay.json")" "tick 3: token saved"
  assert_eq "new-secret-pw" "$(jq -r '.password' "$scratch/nu/relay.json")" "tick 3: password kept"
  assert_eq "600" "$(stat -c %a "$scratch/nu/relay.json")" "tick 3: relay.json mode 600"
  assert_nogrep "fresh-tok|new-secret-pw" "$out" "tick 3: secrets never logged"
  assert_grep "un-archive COMPLETE" "$out" "tick 3: completion log"
  teardown_unarchive_scratch "$scratch"
}

test_identity_transient_error_rerequests() {
  local code
  for code in matrix_unavailable expired queue_full internal unknown_service not_configured; do
    local scratch; scratch=$(setup_unarchive_scratch)
    fixture_live_role "$scratch" box-maintainer
    fixture_archived_identity "$scratch" xi "scalar:box-maintainer"
    start_stub_admin "401" || { teardown_unarchive_scratch "$scratch"; return; }
    _point_relay "$scratch" xi
    local d="${scratch}-archive/xi"

    _tick "$scratch" >/dev/null
    local uuid1; uuid1=$(_state "$scratch" xi)
    _respond "$scratch" "$uuid1" "{\"ok\":false,\"error\":{\"code\":\"$code\",\"message\":\"try later\"}}"

    _tick "$scratch" >/dev/null
    assert_eq "0" "$(_all_request_files_count "$scratch")" "$code: failed request dropped"
    assert_nofile "$d/.unarchive-reactivate" "$code: state cleared"
    assert_file   "$d/.unarchive-requested"  "$code: flag retained"
    assert_nofile "$d/.unarchive-refused"    "$code: NOT refused"

    _tick "$scratch" >/dev/null
    stop_stub_admin
    local uuid2; uuid2=$(_state "$scratch" xi)
    assert_eq "1" "$(_request_count "$scratch")" "$code: re-filed on the next tick"
    if [ -z "$uuid2" ] || [ "$uuid2" = "$uuid1" ]; then
      fail "$code: re-filed request has a new uuid (old=$uuid1 new=$uuid2)"
    fi
    assert_file "${scratch}-requests/$uuid2.json" "$code: state names the new request"
    teardown_unarchive_scratch "$scratch"
  done
}

test_identity_permanent_error_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" pi "scalar:box-maintainer"
  start_stub_admin "401" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" pi

  _tick "$scratch" >/dev/null
  local uuid; uuid=$(_state "$scratch" pi)
  _respond "$scratch" "$uuid" '{"ok":false,"error":{"code":"human_account","message":"that account belongs to a person"}}'
  local out; out=$(_tick "$scratch")
  stop_stub_admin

  _assert_refused "$scratch" pi "human_account" "permanent error"
  assert_grep "belongs to a person" "$(cat "${scratch}-archive/pi/.unarchive-refused" 2>/dev/null)" \
    "permanent error: note carries the backend's message"
  assert_grep "un-archive REFUSED" "$out" "permanent error: LOUD refuse log"
  teardown_unarchive_scratch "$scratch"
}

test_identity_ok_response_without_password_rerequests() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" rho "scalar:box-maintainer"
  start_stub_admin "401" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" rho

  _tick "$scratch" >/dev/null
  local uuid; uuid=$(_state "$scratch" rho)
  _respond "$scratch" "$uuid" '{"ok":true,"result":{}}'
  _tick "$scratch" >/dev/null
  stop_stub_admin

  assert_eq "0" "$(_all_request_files_count "$scratch")" "no-password ok: request dropped"
  assert_nofile "${scratch}-archive/rho/.unarchive-reactivate" "no-password ok: state cleared (asks again)"
  assert_file   "${scratch}-archive/rho/.unarchive-requested"  "no-password ok: flag retained"
  assert_eq "pw-rho" "$(jq -r '.password' "${scratch}-archive/rho/relay.json")" "no-password ok: relay.json untouched"
  teardown_unarchive_scratch "$scratch"
}

test_identity_stale_request_dropped_and_refiled() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" sigma "scalar:box-maintainer"
  start_stub_admin "401" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" sigma
  local d="${scratch}-archive/sigma"

  _tick "$scratch" >/dev/null
  local uuid1; uuid1=$(_state "$scratch" sigma)
  # Leave a claim behind too, as a backend that took it and died would.
  printf '{}' > "${scratch}-requests/$uuid1.claimed.json"

  # Within the stale window (default 600s): kept.
  _tick "$scratch" >/dev/null
  assert_eq "$uuid1" "$(_state "$scratch" sigma)" "stale: fresh request kept"
  assert_file "${scratch}-requests/$uuid1.json" "stale: fresh request file kept"

  # Age the request past the window.
  touch -d "@$(( $(date +%s) - 700 ))" "$d/.unarchive-reactivate"
  local out; out=$(_tick "$scratch")
  assert_eq "0" "$(_all_request_files_count "$scratch")" "stale: request + claim dropped"
  assert_nofile "$d/.unarchive-reactivate" "stale: state cleared"
  assert_file   "$d/.unarchive-requested"  "stale: flag retained"
  assert_nofile "$d/.unarchive-refused"    "stale: NOT refused"
  assert_grep "unanswered after" "$out" "stale: log line"

  _tick "$scratch" >/dev/null
  local uuid2; uuid2=$(_state "$scratch" sigma)
  assert_eq "1" "$(_request_count "$scratch")" "stale: re-filed on the next tick"
  if [ -z "$uuid2" ] || [ "$uuid2" = "$uuid1" ]; then
    fail "stale: re-filed request has a new uuid (old=$uuid1 new=$uuid2)"
  fi

  # AGENT_UNARCHIVE_REQUEST_STALE_SECS=0 makes any pending request stale at once.
  out=$( export AGENT_UNARCHIVE_REQUEST_STALE_SECS=0; _tick "$scratch" )
  stop_stub_admin
  assert_eq "0" "$(_all_request_files_count "$scratch")" "stale (env 0): request dropped"
  assert_nofile "$d/.unarchive-reactivate" "stale (env 0): state cleared"
  teardown_unarchive_scratch "$scratch"
}

test_identity_prelogin_succeeds_without_request() {
  # relay.json already holds a working password (an earlier attempt saved it,
  # then was interrupted): step d's pre-login succeeds, no request filed.
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" chi "scalar:box-maintainer"
  start_stub_admin "401" "200" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" chi

  local out; out=$(_tick "$scratch")
  local reqs; reqs=$(cat "$STUB_REQ_LOG")
  stop_stub_admin

  assert_grep '^POST /_matrix/client/v3/login .*pw-chi' "$reqs" "pre-login: used relay.json's password"
  _assert_completed "$scratch" chi "pre-login"
  assert_file "$scratch/chi/.dormant" "pre-login: .dormant written"
  assert_eq "0" "$(_all_request_files_count "$scratch")" "pre-login: no reactivation requested"
  assert_eq "fresh-tok" "$(jq -r '.access_token' "$scratch/chi/relay.json")" "pre-login: access_token saved"
  assert_eq "fresh-tok" "$(jq -r '.token' "$scratch/chi/relay.json")" "pre-login: token saved"
  assert_nogrep "fresh-tok|pw-chi" "$out" "pre-login: secrets never logged"
  teardown_unarchive_scratch "$scratch"
}

test_identity_prelogin_transient_waits() {
  # Pre-login 503 (homeserver hiccup): wait, don't file a request yet.
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" psi "scalar:box-maintainer"
  start_stub_admin "401" "503" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" psi

  _tick "$scratch" >/dev/null
  stop_stub_admin

  local d="${scratch}-archive/psi"
  assert_nofile "$scratch/psi"              "pre-login 503: not moved"
  assert_file   "$d/.unarchive-requested"   "pre-login 503: flag retained"
  assert_nofile "$d/.unarchive-reactivate"  "pre-login 503: no state"
  assert_nofile "$d/.unarchive-refused"     "pre-login 503: NOT refused"
  assert_eq "0" "$(_all_request_files_count "$scratch")" "pre-login 503: no request filed"
  teardown_unarchive_scratch "$scratch"
}

test_identity_prelogin_without_password_files_request() {
  # No password in relay.json at all → nothing to try, file the request.
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" omega "scalar:box-maintainer"
  start_stub_admin "401" "200" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" omega
  local tmp; tmp=$(mktemp)
  jq 'del(.password)' "${scratch}-archive/omega/relay.json" > "$tmp" && mv "$tmp" "${scratch}-archive/omega/relay.json"

  _tick "$scratch" >/dev/null
  local logins; logins=$(_login_count)
  stop_stub_admin

  assert_eq "0" "$logins" "no password: no login attempted"
  assert_eq "1" "$(_request_count "$scratch")" "no password: request filed"
  assert_nofile "$scratch/omega" "no password: not moved"
  teardown_unarchive_scratch "$scratch"
}

test_identity_account_active_then_login_succeeds() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" alpha2 "scalar:box-maintainer"
  # tick 1 pre-login 403 (e.g. login briefly refused); tick 3 login 200.
  start_stub_admin "401" "403,200" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" alpha2
  local d="${scratch}-archive/alpha2"

  _tick "$scratch" >/dev/null
  local uuid; uuid=$(_state "$scratch" alpha2)
  _respond "$scratch" "$uuid" '{"ok":false,"error":{"code":"account_active","message":"account is already active"}}'

  _tick "$scratch" >/dev/null
  assert_eq "saved" "$(_state "$scratch" alpha2)" "account_active: state 'saved'"
  assert_eq "0" "$(_all_request_files_count "$scratch")" "account_active: request dropped"
  assert_file   "$d/.unarchive-requested" "account_active: flag retained"
  assert_nofile "$d/.unarchive-refused"   "account_active: NOT refused"
  assert_eq "1" "$(_login_count)" "account_active: login waits for the next tick"

  local out; out=$(_tick "$scratch")
  local reqs; reqs=$(cat "$STUB_REQ_LOG")
  stop_stub_admin
  assert_eq "2" "$(printf '%s\n' "$reqs" | grep -c '^POST /_matrix/client/v3/login')" "account_active: logged in on the next tick"
  _assert_completed "$scratch" alpha2 "account_active"
  assert_eq "pw-alpha2" "$(jq -r '.password' "$scratch/alpha2/relay.json")" "account_active: box's password kept"
  assert_eq "fresh-tok" "$(jq -r '.access_token' "$scratch/alpha2/relay.json")" "account_active: token saved"
  assert_grep "un-archive COMPLETE" "$out" "account_active: completion log"
  teardown_unarchive_scratch "$scratch"
}

test_identity_account_active_then_login_403_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" beta2 "scalar:box-maintainer"
  start_stub_admin "401" "403" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" beta2

  _tick "$scratch" >/dev/null
  local uuid; uuid=$(_state "$scratch" beta2)
  _respond "$scratch" "$uuid" '{"ok":false,"error":{"code":"account_active","message":"account is already active"}}'
  _tick "$scratch" >/dev/null
  assert_eq "saved" "$(_state "$scratch" beta2)" "account_active+403: state 'saved' after response"
  local out; out=$(_tick "$scratch")
  stop_stub_admin

  _assert_refused "$scratch" beta2 "saved password failed" "account_active+403"
  assert_grep "un-archive REFUSED" "$out" "account_active+403: LOUD refuse log"
  teardown_unarchive_scratch "$scratch"
}

test_identity_refusal_note_removed_at_pickup() {
  # A note from an earlier refusal is cleared as soon as a new flag is picked
  # up — the front end must not read it as this attempt's answer while the
  # request is still pending.
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" gamma2 "scalar:box-maintainer"
  printf 'an earlier attempt was refused\n' > "${scratch}-archive/gamma2/.unarchive-refused"
  start_stub_admin "401" "403" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" gamma2

  _tick "$scratch" >/dev/null
  stop_stub_admin

  local d="${scratch}-archive/gamma2"
  assert_nofile "$d/.unarchive-refused"   "pickup: old refusal note removed"
  assert_file   "$d/.unarchive-requested" "pickup: flag retained (still pending)"
  assert_eq "1" "$(_request_count "$scratch")" "pickup: request filed"
  assert_nofile "$scratch/gamma2" "pickup: not moved yet"
  teardown_unarchive_scratch "$scratch"
}

test_identity_login_401_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" tau "scalar:box-maintainer"
  start_stub_admin "401" "401" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" tau
  printf 'saved\n' > "${scratch}-archive/tau/.unarchive-reactivate"

  local out; out=$(_tick "$scratch")
  local reqs; reqs=$(cat "$STUB_REQ_LOG")
  stop_stub_admin

  assert_grep '^POST /_matrix/client/v3/login' "$reqs" "login 401: login attempted"
  _assert_refused "$scratch" tau "saved password failed" "login 401"
  assert_eq "stale-tok-tau" "$(jq -r '.access_token' "${scratch}-archive/tau/relay.json")" "login 401: token untouched"
  assert_grep "un-archive REFUSED" "$out" "login 401: LOUD refuse log"
  teardown_unarchive_scratch "$scratch"
}

test_identity_login_5xx_retries() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" upsilon "scalar:box-maintainer"
  start_stub_admin "401" "503" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" upsilon
  printf 'saved\n' > "${scratch}-archive/upsilon/.unarchive-reactivate"

  _tick "$scratch" >/dev/null
  stop_stub_admin

  local d="${scratch}-archive/upsilon"
  assert_nofile "$scratch/upsilon"          "login 503: not moved"
  assert_eq "saved" "$(_state "$scratch" upsilon)" "login 503: state still 'saved'"
  assert_file   "$d/.unarchive-requested"   "login 503: flag retained"
  assert_nofile "$d/.unarchive-refused"     "login 503: NOT refused"
  assert_eq "0" "$(_all_request_files_count "$scratch")" "login 503: no new request filed"
  teardown_unarchive_scratch "$scratch"
}

test_identity_refusal_drops_pending_request() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" phi "scalar:box-maintainer"
  start_stub_admin "401" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" phi

  _tick "$scratch" >/dev/null
  assert_eq "1" "$(_request_count "$scratch")" "pending refuse: request filed on tick 1"
  # A live identity with the same name appears while the request is pending.
  mkdir -p "$scratch/phi"
  _tick "$scratch" >/dev/null
  stop_stub_admin

  assert_nofile "${scratch}-archive/phi/.unarchive-requested"  "pending refuse: flag cleared"
  assert_nofile "${scratch}-archive/phi/.unarchive-reactivate" "pending refuse: state cleared"
  assert_grep "already exists" "$(cat "${scratch}-archive/phi/.unarchive-refused" 2>/dev/null)" "pending refuse: note written"
  assert_eq "0" "$(_all_request_files_count "$scratch")" "pending refuse: pending request dropped"
  teardown_unarchive_scratch "$scratch"
}

test_identity_no_sentinel_noop() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  mkdir -p "${scratch}-archive/lambda"
  printf -- '---\nroles: box-maintainer\n---\nbody\n' > "${scratch}-archive/lambda/lambda.md"

  local out; out=$(_tick "$scratch")

  assert_file   "${scratch}-archive/lambda"          "no-sentinel: archive folder untouched"
  assert_nofile "$scratch/lambda"                    "no-sentinel: no folder moved"
  assert_nofile "${scratch}-archive/lambda/.unarchive-refused" "no-sentinel: no refusal note"
  assert_eq "0" "$(_all_request_files_count "$scratch")" "no-sentinel: no request filed"
  assert_nogrep "un-archive" "$out" "no-sentinel: no un-archive log lines"
  teardown_unarchive_scratch "$scratch"
}

# Shape 5 — un-archive wake-up smoothing. On a completed un-archive, the
# scanner prepends a dated banner to the identity file body (right after
# frontmatter) so the agent that wakes has an in-session signal.
test_identity_banner_prepended_on_happy_path() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" mu "scalar:box-maintainer"
  start_stub_admin "200" || { teardown_unarchive_scratch "$scratch"; return; }
  _point_relay "$scratch" mu

  local out; out=$(_tick "$scratch")
  stop_stub_admin

  assert_file "$scratch/mu/mu.md" "banner-prepend: identity file lives at live path"

  # Banner wording invariant — the exact text the agent reads on wake.
  local body; body=$(cat "$scratch/mu/mu.md" 2>/dev/null)
  assert_grep "You were unarchived at" "$body"             "banner-prepend: banner opening phrase present"
  assert_grep "state of the world may have moved"  "$body" "banner-prepend: banner middle phrase present"
  assert_grep "Delete this banner once you've caught up" "$body" "banner-prepend: delete-when-done instruction present"
  assert_grep 'You were unarchived at 2[0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z' "$body" \
    "banner-prepend: ISO8601 UTC timestamp"

  # Placement invariant: banner sits AFTER the frontmatter close.
  local dashes_before
  dashes_before=$(printf '%s\n' "$body" | awk '/^You were unarchived at|^> .*You were unarchived at/ { exit } /^---[[:space:]]*$/ { c++ } END { print c+0 }')
  assert_eq "2" "$dashes_before" "banner-prepend: banner sits after frontmatter close (not inside / before)"

  assert_grep "un-archive step 7:" "$out" "banner-prepend: step 7 success log present"
  teardown_unarchive_scratch "$scratch"
}

# ============================================================
# scan_role_unarchive_requested_sentinels — behavior tests
# ============================================================

# Create an archived role fixture at $ROLES_ARCHIVE_DIR/<name>/.
# Usage: fixture_archived_role <scratch> <role_name> [--no-sentinel]
fixture_archived_role() {
  local scratch="$1" role_name="$2"
  shift 2
  local no_sentinel=false
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --no-sentinel) no_sentinel=true ;;
    esac
    shift
  done
  local d="${scratch}-roles-archive/$role_name"
  mkdir -p "$d"
  printf 'archived-role-marker\n' > "$d/role.md"
  if ! $no_sentinel; then
    touch "$d/.unarchive-requested"
  fi
}

test_role_happy_path() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_archived_role "$scratch" "cool-role"

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_role_unarchive_requested_sentinels 2>&1 ) || true

  assert_file   "${scratch}-roles/cool-role"                     "role happy: live folder present"
  assert_file   "${scratch}-roles/cool-role/role.md"             "role happy: role.md moved with folder"
  assert_nofile "${scratch}-roles-archive/cool-role"             "role happy: archive folder gone"
  assert_nofile "${scratch}-roles/cool-role/.unarchive-requested" "role happy: sentinel gone from live tree"
  assert_grep "role 'cool-role' un-archive COMPLETE" "$out"
  teardown_unarchive_scratch "$scratch"
}

test_role_name_collision_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_archived_role "$scratch" "collide-role"
  # Pre-existing live role with same name.
  mkdir -p "${scratch}-roles/collide-role"
  printf 'existing live role\n' > "${scratch}-roles/collide-role/role.md"

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_role_unarchive_requested_sentinels 2>&1 ) || true

  # Live role's contents preserved (marker text stays "existing live role").
  local live_content; live_content=$(cat "${scratch}-roles/collide-role/role.md")
  assert_eq "existing live role" "$live_content" "role collision: live role untouched"
  # Archive folder retained (mv did NOT happen), sentinel deleted.
  assert_file   "${scratch}-roles-archive/collide-role"                        "role collision: archive retained"
  assert_nofile "${scratch}-roles-archive/collide-role/.unarchive-requested"  "role collision: sentinel deleted"
  assert_grep "REFUSED: live role already exists" "$out"
  teardown_unarchive_scratch "$scratch"
}

test_role_no_sentinel_noop() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_archived_role "$scratch" "silent-role" --no-sentinel

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_role_unarchive_requested_sentinels 2>&1 ) || true

  assert_file   "${scratch}-roles-archive/silent-role"   "role no-sentinel: archive untouched"
  assert_nofile "${scratch}-roles/silent-role"           "role no-sentinel: no folder moved"
  assert_nogrep "user-initiated un-archive" "$out"       "role no-sentinel: no log line fires"
  teardown_unarchive_scratch "$scratch"
}

# Create an archived app fixture at $APPS_ARCHIVE_DIR/<slug>/.
# Usage: fixture_archived_app <scratch> <slug> <port> [--no-stash] [--no-port]
#   --no-stash  : don't write the .archived unit file (simulates missing stash)
#   --no-port   : write a stash but with no Environment=PORT= line
fixture_archived_app() {
  local scratch="$1" slug="$2" port="$3"
  shift 3
  local no_stash=false no_port=false
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --no-stash) no_stash=true ;;
      --no-port) no_port=true ;;
    esac
    shift
  done
  local d="${scratch}-apps-archive/$slug"
  mkdir -p "$d"
  printf 'archived-app-marker\n' > "$d/README.md"
  if ! $no_stash; then
    local stash="$d/app-$slug.service.archived"
    if $no_port; then
      cat > "$stash" <<UNIT_EOF
[Unit]
Description=$slug app
[Service]
ExecStart=/bin/true
[Install]
WantedBy=default.target
UNIT_EOF
    else
      cat > "$stash" <<UNIT_EOF
[Unit]
Description=$slug app
[Service]
Environment=PORT=$port
ExecStart=/bin/true
[Install]
WantedBy=default.target
UNIT_EOF
    fi
  fi
  touch "$d/.unarchive-requested"
}

# Create a live app fixture with a systemd unit file at the specified port.
# Used to seed a port-collision scenario.
fixture_live_app_on_port() {
  local scratch="$1" slug="$2" port="$3"
  local ud="${scratch}-systemd-units"
  mkdir -p "$ud" "${scratch}-apps/$slug"
  cat > "$ud/app-$slug.service" <<UNIT_EOF
[Unit]
Description=$slug live app
[Service]
Environment=PORT=$port
ExecStart=/bin/true
[Install]
WantedBy=default.target
UNIT_EOF
}

# Write a stub systemctl at <path>. Records every call to a per-call log file
# ($stub-calls-log — one line per invocation, args space-separated), and
# always returns success. Tests can assert against the calls log.
fixture_stub_systemctl() {
  local path="$1"
  local log="$path-calls-log"
  cat > "$path" <<STUB
#!/usr/bin/env bash
# stub systemctl — records args to $log, always exits 0.
printf '%s\n' "\$*" >> "$log"
exit 0
STUB
  chmod +x "$path"
  : > "$log"
  printf '%s' "$log"
}

test_role_no_cascade_to_identities() {
  # Un-archiving a role must NOT resurrect identities that were retired
  # alongside during archive. This test proves that: archive identities
  # holding the un-archived role remain archived after the role scanner runs.
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_archived_role "$scratch" "restored-role"
  # Pretend two identities were retired during that role's earlier archive.
  # They're in the identity-archive tree, holding "roles: restored-role".
  mkdir -p "${scratch}-archive/orphan-a" "${scratch}-archive/orphan-b"
  printf -- '---\nroles: restored-role\n---\nbody\n' > "${scratch}-archive/orphan-a/orphan-a.md"
  printf -- '---\nroles: restored-role\n---\nbody\n' > "${scratch}-archive/orphan-b/orphan-b.md"

  ( _source_supervisor_unarchive "$scratch"
    scan_role_unarchive_requested_sentinels >/dev/null 2>&1 ) || true

  # Role moved to live.
  assert_file "${scratch}-roles/restored-role"           "no-cascade: role folder in live tree"
  # Identities remain archived.
  assert_file   "${scratch}-archive/orphan-a"            "no-cascade: orphan-a still archived"
  assert_file   "${scratch}-archive/orphan-b"            "no-cascade: orphan-b still archived"
  assert_nofile "$scratch/orphan-a"                      "no-cascade: orphan-a NOT resurrected to live"
  assert_nofile "$scratch/orphan-b"                      "no-cascade: orphan-b NOT resurrected to live"
  teardown_unarchive_scratch "$scratch"
}

# ============================================================
# scan_app_unarchive_requested_sentinels — behavior tests
# ============================================================

test_app_happy_path() {
  local scratch; scratch=$(setup_unarchive_scratch)
  local systemctl_stub="$scratch/stub-systemctl"
  local calls_log; calls_log=$(fixture_stub_systemctl "$systemctl_stub")
  fixture_archived_app "$scratch" "cool-app" 3040

  local out
  out=$( _source_supervisor_unarchive "$scratch" "$systemctl_stub"
         scan_app_unarchive_requested_sentinels 2>&1 ) || true

  assert_file   "${scratch}-apps/cool-app"                                   "app happy: live folder present after mv"
  assert_file   "${scratch}-apps/cool-app/README.md"                         "app happy: folder contents travelled"
  assert_nofile "${scratch}-apps-archive/cool-app"                           "app happy: archive folder gone"
  assert_file   "${scratch}-systemd-units/app-cool-app.service"              "app happy: unit installed"
  assert_nofile "${scratch}-apps/cool-app/app-cool-app.service.archived"     "app happy: stash removed after install"
  assert_nofile "${scratch}-apps/cool-app/.unarchive-requested"              "app happy: sentinel gone"

  local port; port=$(grep '^Environment=PORT=' "${scratch}-systemd-units/app-cool-app.service" | sed 's/^Environment=PORT=//')
  assert_eq "3040" "$port" "app happy: installed unit carries the archived port"

  # Systemctl was called for daemon-reload + enable + is-active.
  local sysctl_calls; sysctl_calls=$(cat "$calls_log")
  assert_grep "--user daemon-reload"                       "$sysctl_calls" "app happy: daemon-reload invoked"
  assert_grep "--user enable --now app-cool-app.service"   "$sysctl_calls" "app happy: enable --now invoked"
  assert_grep "--user is-active --quiet app-cool-app.service" "$sysctl_calls" "app happy: is-active check invoked"

  assert_grep "app 'cool-app' un-archive COMPLETE" "$out"
  assert_grep "systemd unit active .running. on port 3040" "$out" "app happy: active log line with port"
  teardown_unarchive_scratch "$scratch"
}

test_app_live_folder_collision_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  local systemctl_stub="$scratch/stub-systemctl"
  fixture_stub_systemctl "$systemctl_stub" > /dev/null
  fixture_archived_app "$scratch" "collide-app" 3041
  # Pre-existing live folder with same slug.
  mkdir -p "${scratch}-apps/collide-app"
  printf 'existing live app\n' > "${scratch}-apps/collide-app/README.md"

  local out
  out=$( _source_supervisor_unarchive "$scratch" "$systemctl_stub"
         scan_app_unarchive_requested_sentinels 2>&1 ) || true

  # Live folder untouched.
  local content; content=$(cat "${scratch}-apps/collide-app/README.md")
  assert_eq "existing live app" "$content" "app live-collision: live folder untouched"
  assert_file   "${scratch}-apps-archive/collide-app"                            "app live-collision: archive retained"
  assert_nofile "${scratch}-apps-archive/collide-app/.unarchive-requested"       "app live-collision: sentinel deleted"
  assert_grep "REFUSED: live folder already exists" "$out"
  teardown_unarchive_scratch "$scratch"
}

test_app_unit_file_collision_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  local systemctl_stub="$scratch/stub-systemctl"
  fixture_stub_systemctl "$systemctl_stub" > /dev/null
  fixture_archived_app "$scratch" "unit-collide" 3042
  # Pre-existing unit file (but no live app folder — an orphan unit).
  mkdir -p "${scratch}-systemd-units"
  cat > "${scratch}-systemd-units/app-unit-collide.service" <<UEOF
[Unit]
Description=orphan unit
[Service]
Environment=PORT=9999
ExecStart=/bin/true
UEOF

  local out
  out=$( _source_supervisor_unarchive "$scratch" "$systemctl_stub"
         scan_app_unarchive_requested_sentinels 2>&1 ) || true

  assert_file   "${scratch}-apps-archive/unit-collide"                       "app unit-collide: archive retained"
  assert_nofile "${scratch}-apps-archive/unit-collide/.unarchive-requested"  "app unit-collide: sentinel deleted"
  assert_grep "REFUSED: systemd unit already installed" "$out"
  teardown_unarchive_scratch "$scratch"
}

test_app_missing_stashed_unit_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  local systemctl_stub="$scratch/stub-systemctl"
  fixture_stub_systemctl "$systemctl_stub" > /dev/null
  fixture_archived_app "$scratch" "no-stash-app" 3043 --no-stash

  local out
  out=$( _source_supervisor_unarchive "$scratch" "$systemctl_stub"
         scan_app_unarchive_requested_sentinels 2>&1 ) || true

  assert_file   "${scratch}-apps-archive/no-stash-app"                       "app no-stash: archive retained"
  assert_nofile "${scratch}-apps-archive/no-stash-app/.unarchive-requested"  "app no-stash: sentinel deleted"
  assert_grep "REFUSED: no stashed unit" "$out"
  teardown_unarchive_scratch "$scratch"
}

test_app_stash_without_port_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  local systemctl_stub="$scratch/stub-systemctl"
  fixture_stub_systemctl "$systemctl_stub" > /dev/null
  fixture_archived_app "$scratch" "no-port-app" 3044 --no-port

  local out
  out=$( _source_supervisor_unarchive "$scratch" "$systemctl_stub"
         scan_app_unarchive_requested_sentinels 2>&1 ) || true

  assert_file   "${scratch}-apps-archive/no-port-app"                       "app no-port: archive retained"
  assert_nofile "${scratch}-apps-archive/no-port-app/.unarchive-requested"  "app no-port: sentinel deleted"
  assert_grep "could not read PORT" "$out"
  teardown_unarchive_scratch "$scratch"
}

test_app_port_collision_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  local systemctl_stub="$scratch/stub-systemctl"
  fixture_stub_systemctl "$systemctl_stub" > /dev/null
  # Live app 'incumbent' on port 3050.
  fixture_live_app_on_port "$scratch" "incumbent" 3050
  # Archived app 'newcomer' wants the same port 3050.
  fixture_archived_app "$scratch" "newcomer" 3050

  local out
  out=$( _source_supervisor_unarchive "$scratch" "$systemctl_stub"
         scan_app_unarchive_requested_sentinels 2>&1 ) || true

  # Incumbent untouched.
  assert_file "${scratch}-apps/incumbent"                              "port-collision: incumbent live folder untouched"
  assert_file "${scratch}-systemd-units/app-incumbent.service"         "port-collision: incumbent unit untouched"
  # Newcomer archive retained; sentinel deleted; newcomer NOT moved.
  assert_file   "${scratch}-apps-archive/newcomer"                     "port-collision: newcomer archive retained"
  assert_nofile "${scratch}-apps-archive/newcomer/.unarchive-requested" "port-collision: newcomer sentinel deleted"
  assert_nofile "${scratch}-apps/newcomer"                             "port-collision: newcomer NOT moved to live"
  assert_grep "port 3050 is now in use" "$out"
  teardown_unarchive_scratch "$scratch"
}

test_app_mv_failure_after_sentinel_delete_retains_folder() {
  # rc-44 path: pre-flight passes, sentinel gets deleted inside the lock,
  # then mv fails. Force mv to fail by making $APPS_DIR a plain file (not a
  # directory) — mv can't create $APPS_DIR/<slug> when $APPS_DIR is a file.
  local scratch; scratch=$(setup_unarchive_scratch)
  local systemctl_stub="$scratch/stub-systemctl"
  fixture_stub_systemctl "$systemctl_stub" > /dev/null
  fixture_archived_app "$scratch" "unmovable" 3070
  # Replace $APPS_DIR with a file so the mv fails.
  rm -rf "${scratch}-apps"
  : > "${scratch}-apps"

  local out
  out=$( _source_supervisor_unarchive "$scratch" "$systemctl_stub"
         scan_app_unarchive_requested_sentinels 2>&1 ) || true

  # Archive folder retained (mv failed), sentinel deleted (pre-mv).
  assert_file   "${scratch}-apps-archive/unmovable"                       "mv-fail: archive folder retained"
  assert_nofile "${scratch}-apps-archive/unmovable/.unarchive-requested"  "mv-fail: sentinel deleted before mv"
  assert_grep "mv archive.live FAILED" "$out" "mv-fail: LOUD error log"
  teardown_unarchive_scratch "$scratch"
}

test_app_no_sentinel_noop() {
  local scratch; scratch=$(setup_unarchive_scratch)
  local systemctl_stub="$scratch/stub-systemctl"
  fixture_stub_systemctl "$systemctl_stub" > /dev/null
  # Archived app WITHOUT the un-archive sentinel.
  mkdir -p "${scratch}-apps-archive/quiet-app"
  printf 'archived\n' > "${scratch}-apps-archive/quiet-app/README.md"

  local out
  out=$( _source_supervisor_unarchive "$scratch" "$systemctl_stub"
         scan_app_unarchive_requested_sentinels 2>&1 ) || true

  assert_file   "${scratch}-apps-archive/quiet-app"    "app no-sentinel: archive untouched"
  assert_nofile "${scratch}-apps/quiet-app"            "app no-sentinel: not moved"
  assert_nogrep "user-initiated un-archive" "$out"
  teardown_unarchive_scratch "$scratch"
}

# ============================================================
# Test runner
# ============================================================
printf 'Un-archive host-side test driver: identity scanner + frontmatter helper.\n'

run_test test_extract_roles_scalar
run_test test_extract_roles_flow_list
run_test test_extract_roles_block_list
run_test test_extract_roles_none
run_test test_extract_roles_singular_key_ignored
run_test test_extract_roles_malformed

run_test test_identity_name_collision_refuses
run_test test_identity_role_missing_scalar_refuses
run_test test_identity_role_missing_multi_names_only_missing
run_test test_identity_missing_relay_json_refuses
run_test test_identity_relay_json_without_account_refuses
run_test test_identity_whoami_fast_path_completes
run_test test_identity_whoami_ok_but_no_profile_reactivates
run_test test_identity_profile_check_transient_waits
run_test test_identity_reactivation_request_without_display_name
run_test test_identity_happy_path_flow_list_all_live
run_test test_identity_happy_path_block_list_all_live
run_test test_identity_no_roles_unarchives
run_test test_identity_no_dormancy_preserved
run_test test_identity_old_refusal_note_removed_on_success
run_test test_identity_full_reactivation_happy_path
run_test test_identity_transient_error_rerequests
run_test test_identity_permanent_error_refuses
run_test test_identity_ok_response_without_password_rerequests
run_test test_identity_stale_request_dropped_and_refiled
run_test test_identity_prelogin_succeeds_without_request
run_test test_identity_prelogin_transient_waits
run_test test_identity_prelogin_without_password_files_request
run_test test_identity_account_active_then_login_succeeds
run_test test_identity_account_active_then_login_403_refuses
run_test test_identity_refusal_note_removed_at_pickup
run_test test_identity_login_401_refuses
run_test test_identity_login_5xx_retries
run_test test_identity_refusal_drops_pending_request
run_test test_identity_no_sentinel_noop
run_test test_identity_banner_prepended_on_happy_path

run_test test_role_happy_path
run_test test_role_name_collision_refuses
run_test test_role_no_sentinel_noop
run_test test_role_no_cascade_to_identities

run_test test_app_happy_path
run_test test_app_live_folder_collision_refuses
run_test test_app_unit_file_collision_refuses
run_test test_app_missing_stashed_unit_refuses
run_test test_app_stash_without_port_refuses
run_test test_app_port_collision_refuses
run_test test_app_mv_failure_after_sentinel_delete_retains_folder
run_test test_app_no_sentinel_noop

printf '===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILURES[@]}"; do
    printf '  - %s\n' "$f"
  done
  exit 1
fi
exit 0
