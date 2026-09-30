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
#   AGENT_MATRIX_ADMIN_CREDS_PATH=<scratch>/admin-creds.json
#   AGENT_SUPERVISOR_LIB_ONLY=1

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
  export AGENT_MATRIX_ADMIN_CREDS_PATH="$scratch/admin-creds.json"
  if [ -n "$systemctl_stub" ]; then
    export AGENT_SYSTEMCTL_BIN="$systemctl_stub"
  fi
  export DORMANCY_STATE_DIR="$scratch/.state"
  export AGENT_SUPERVISOR_LIB_ONLY=1
  # shellcheck disable=SC1090
  source "$SUPERVISOR" 2>/dev/null || true
}

# ---- fixtures ----
setup_unarchive_scratch() {
  local s; s=$(mktemp -d)
  mkdir -p "$s/.state" "${s}-archive" "${s}-roles" "${s}-roles-archive" \
           "${s}-apps" "${s}-apps-archive"
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
}

# Create an archived identity fixture under $IDENTITIES_ARCHIVE_DIR.
# Usage: fixture_archived_identity <scratch> <name> <role_spec> [--no-dormancy] [--no-relay]
#   <role_spec> is one of:
#     scalar:<name>              → `role: <name>`
#     flow:name1,name2,...       → `role: [name1, name2]`
#     block:name1,name2,...      → `role:\n  - name1\n  - name2`
#     none                       → no role: line at all
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
    scalar:*)
      local r="${role_spec#scalar:}"
      printf -- '---\nrole: %s\ndisplayName: test\n---\nbody\n' "$r" > "$ident_file"
      ;;
    flow:*)
      local list="${role_spec#flow:}"
      # Convert "a,b,c" to "a, b, c" for readable frontmatter.
      local flow; flow=$(printf '%s' "$list" | sed 's/,/, /g')
      printf -- '---\nrole: [%s]\ndisplayName: test\n---\nbody\n' "$flow" > "$ident_file"
      ;;
    block:*)
      local list="${role_spec#block:}"
      {
        printf -- '---\nrole:\n'
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

# Write fleet admin creds fixture pointing at the stub.
fixture_admin_creds() {
  local scratch="$1" port="$2"
  jq -n \
    --arg hs   "http://127.0.0.1:$port" \
    --arg tok  "admin-tok" \
    --arg uid  "@skynet-admin:test" \
    '{homeserver:$hs, access_token:$tok, user_id:$uid, password:"admin-pw", server_name:"test"}' \
    > "$scratch/admin-creds.json"
}

# ---- stub admin homeserver ----
# Two endpoints exercised:
#   PUT  /_synapse/admin/v2/users/{mxid}            → reactivate (canned status codes)
#   POST /_synapse/admin/v1/users/{mxid}/login      → returns access_token
#
# Each takes a comma-separated status-code sequence; once exhausted, the LAST
# code repeats. On PUT 200/201 the body is a small JSON success blob. On
# POST 200 the body is `{"access_token":"fresh-tok-<counter>"}` so tests can
# assert the token was refreshed.
STUB_PID=""
STUB_PORT=""
STUB_LOG=""
STUB_REQ_LOG=""

start_stub_admin() {
  local put_codes="${1:-200}" post_codes="${2:-200}"
  STUB_PID=""
  STUB_PORT=""
  STUB_LOG=$(mktemp)
  STUB_REQ_LOG=$(mktemp)

  python3 -c "
import http.server, sys, socketserver, json

put_codes  = [int(c) for c in sys.argv[1].split(',')]
post_codes = [int(c) for c in sys.argv[2].split(',')]
port_file  = sys.argv[3]
req_log    = sys.argv[4]
counters   = {'PUT': 0, 'POST': 0}
mint_counter = {'i': 0}

class Handler(http.server.BaseHTTPRequestHandler):
    def _log_and_respond(self, method, codes):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length > 0 else b''
        with open(req_log, 'ab') as f:
            f.write(('%s %s %d ' % (method, self.path, length)).encode('utf-8'))
            f.write(body.replace(b'\n', b' '))
            f.write(b'\n')
        idx = min(counters[method], len(codes) - 1)
        counters[method] += 1
        code = codes[idx]
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        if method == 'POST' and code == 200:
            mint_counter['i'] += 1
            token = 'fresh-tok-%d' % mint_counter['i']
            self.wfile.write(json.dumps({'access_token': token, 'device_id': 'DEVICE-' + str(mint_counter['i'])}).encode('utf-8'))
        else:
            self.wfile.write(b'{\"status\":\"ok\"}\n')

    def do_PUT(self):  self._log_and_respond('PUT',  put_codes)
    def do_POST(self): self._log_and_respond('POST', post_codes)
    def log_message(self, fmt, *args): pass

with socketserver.TCPServer(('127.0.0.1', 0), Handler) as server:
    port = server.server_address[1]
    with open(port_file, 'w') as f:
        f.write(str(port))
    server.serve_forever()
" "$put_codes" "$post_codes" "$STUB_LOG" "$STUB_REQ_LOG" &
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
  assert_eq "0" "$rc" "no role: field is legal (returns empty array + rc=0)"
  assert_eq '[]' "$got" "no role field should produce empty JSON array"
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

test_identity_happy_path_scalar_role() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" alpha "scalar:box-maintainer"
  start_stub_admin 200 200 || { teardown_unarchive_scratch "$scratch"; return; }
  fixture_admin_creds "$scratch" "$STUB_PORT"
  sed -i "s|STUB_PORT|$STUB_PORT|" "${scratch}-archive/alpha/relay.json"

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_identity_unarchive_requested_sentinels 2>&1 ) || true
  stop_stub_admin

  assert_file   "$scratch/alpha"                       "happy path: live folder present after mv"
  assert_nofile "${scratch}-archive/alpha"             "happy path: archive folder gone after mv"
  assert_file   "$scratch/alpha/.dormant"              "happy path: .dormant travelled with folder"
  assert_nofile "$scratch/alpha/.unarchive-requested"  "happy path: un-archive sentinel deleted"

  # relay.json access_token replaced (was stale-tok-alpha; now fresh-tok-1).
  local tok; tok=$(jq -r '.access_token' "$scratch/alpha/relay.json")
  assert_eq "fresh-tok-1" "$tok" "happy path: access_token refreshed by step 3"
  local aliased; aliased=$(jq -r '.token' "$scratch/alpha/relay.json")
  assert_eq "fresh-tok-1" "$aliased" "happy path: token alias also refreshed"

  assert_grep "un-archive step 1 .matrix reactivate. success" "$out" "step 1 success log"
  assert_grep "un-archive step 2 .mint fresh access_token. success" "$out" "step 2 success log"
  assert_grep "un-archive step 3 .relay.json access_token refreshed" "$out" "step 3 success log"
  assert_grep "un-archive step 4: .dormant written" "$out" "step 4 wrote .dormant"
  assert_grep "un-archive COMPLETE" "$out" "completion log present"
  teardown_unarchive_scratch "$scratch"
}

test_identity_happy_path_flow_list_all_live() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_live_role "$scratch" sky-uat
  fixture_archived_identity "$scratch" beta "flow:box-maintainer,sky-uat"
  start_stub_admin 200 200 || { teardown_unarchive_scratch "$scratch"; return; }
  fixture_admin_creds "$scratch" "$STUB_PORT"
  sed -i "s|STUB_PORT|$STUB_PORT|" "${scratch}-archive/beta/relay.json"

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_identity_unarchive_requested_sentinels 2>&1 ) || true
  stop_stub_admin

  assert_file "$scratch/beta"           "flow-list happy path: live folder present"
  assert_file "$scratch/beta/.dormant"  "flow-list happy path: .dormant written"
  assert_grep "un-archive COMPLETE" "$out"
  teardown_unarchive_scratch "$scratch"
}

test_identity_happy_path_block_list_all_live() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_live_role "$scratch" sky-uat
  fixture_archived_identity "$scratch" gamma "block:box-maintainer,sky-uat"
  start_stub_admin 200 200 || { teardown_unarchive_scratch "$scratch"; return; }
  fixture_admin_creds "$scratch" "$STUB_PORT"
  sed -i "s|STUB_PORT|$STUB_PORT|" "${scratch}-archive/gamma/relay.json"

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_identity_unarchive_requested_sentinels 2>&1 ) || true
  stop_stub_admin

  assert_file "$scratch/gamma"           "block-list happy path: live folder present"
  assert_file "$scratch/gamma/.dormant"  "block-list happy path: .dormant written"
  assert_grep "un-archive COMPLETE" "$out"
  teardown_unarchive_scratch "$scratch"
}

test_identity_no_dormancy_preserved() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" delta "scalar:box-maintainer" --no-dormancy
  start_stub_admin 200 200 || { teardown_unarchive_scratch "$scratch"; return; }
  fixture_admin_creds "$scratch" "$STUB_PORT"
  sed -i "s|STUB_PORT|$STUB_PORT|" "${scratch}-archive/delta/relay.json"

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_identity_unarchive_requested_sentinels 2>&1 ) || true
  stop_stub_admin

  assert_file   "$scratch/delta"                       "no-dormancy: live folder present"
  assert_file   "$scratch/delta/.no-dormancy"          "no-dormancy: sentinel travelled with folder"
  assert_nofile "$scratch/delta/.dormant"              "no-dormancy: .dormant was NOT written"
  assert_grep "always-on intent preserved" "$out" "no-dormancy: log line names the preservation"
  teardown_unarchive_scratch "$scratch"
}

test_identity_role_missing_scalar_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  # DO NOT create the role live — it stays only in the (implicitly-empty) roles-archive.
  fixture_archived_identity "$scratch" epsilon "scalar:missing-role"

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_identity_unarchive_requested_sentinels 2>&1 ) || true

  assert_nofile "$scratch/epsilon"                              "role-missing: no folder moved"
  assert_file   "${scratch}-archive/epsilon"                    "role-missing: archive folder retained"
  assert_nofile "${scratch}-archive/epsilon/.unarchive-requested" "role-missing: sentinel deleted per REFUSE discipline"
  assert_grep "REFUSED: role.s. not live" "$out" "role-missing: LOUD refuse log"
  assert_grep "missing-role" "$out" "role-missing: log names the missing role"
  teardown_unarchive_scratch "$scratch"
}

test_identity_role_missing_multi_names_only_missing() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  # sky-uat is NOT created — it's the one that's missing.
  fixture_archived_identity "$scratch" zeta "flow:box-maintainer,sky-uat"

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_identity_unarchive_requested_sentinels 2>&1 ) || true

  assert_nofile "$scratch/zeta"                                "multi-role missing: no folder moved"
  assert_nofile "${scratch}-archive/zeta/.unarchive-requested" "multi-role missing: sentinel deleted"
  assert_grep "sky-uat" "$out" "multi-role missing: LOUD log names sky-uat"
  assert_nogrep "role.s. not live in.*box-maintainer" "$out" "multi-role missing: log does NOT list box-maintainer (which IS live)"
  teardown_unarchive_scratch "$scratch"
}

test_identity_name_collision_refuses() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" eta "scalar:box-maintainer"
  # Create a live-tree collision.
  mkdir -p "$scratch/eta"
  printf 'existing live identity\n' > "$scratch/eta/eta.md"

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_identity_unarchive_requested_sentinels 2>&1 ) || true

  # Live identity untouched.
  assert_file "$scratch/eta/eta.md" "name-collision: live identity untouched"
  # Archive folder still present (no mv), sentinel deleted per REFUSE.
  assert_file   "${scratch}-archive/eta"                        "name-collision: archive folder retained"
  assert_nofile "${scratch}-archive/eta/.unarchive-requested"  "name-collision: sentinel deleted"
  assert_grep "REFUSED: live identity already exists" "$out" "name-collision: LOUD refuse log"
  teardown_unarchive_scratch "$scratch"
}

test_identity_reactivate_5xx_transient_recovers() {
  # Two 500s then a 200 → retry loop recovers, un-archive completes.
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" theta "scalar:box-maintainer"
  start_stub_admin "500,500,200" "200" || { teardown_unarchive_scratch "$scratch"; return; }
  fixture_admin_creds "$scratch" "$STUB_PORT"
  sed -i "s|STUB_PORT|$STUB_PORT|" "${scratch}-archive/theta/relay.json"

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_identity_unarchive_requested_sentinels 2>&1 ) || true
  stop_stub_admin

  assert_file "$scratch/theta"          "5xx transient: recovered after retries"
  assert_file "$scratch/theta/.dormant" "5xx transient: .dormant written on recovered success"
  assert_grep "transient .http=500. — will retry" "$out" "5xx transient: retry log line fires"
  assert_grep "un-archive COMPLETE" "$out" "5xx transient: completion log after recovery"
  teardown_unarchive_scratch "$scratch"
}

test_identity_reactivate_4xx_permanent_retains_sentinel() {
  # 400 = permanent client error; scanner aborts, sentinel retained for operator inspection.
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" iota "scalar:box-maintainer"
  start_stub_admin "400" "200" || { teardown_unarchive_scratch "$scratch"; return; }
  fixture_admin_creds "$scratch" "$STUB_PORT"
  sed -i "s|STUB_PORT|$STUB_PORT|" "${scratch}-archive/iota/relay.json"

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_identity_unarchive_requested_sentinels 2>&1 ) || true
  stop_stub_admin

  assert_nofile "$scratch/iota"                              "4xx permanent: no folder moved"
  assert_file   "${scratch}-archive/iota"                    "4xx permanent: archive folder retained"
  assert_file   "${scratch}-archive/iota/.unarchive-requested" "4xx permanent: sentinel RETAINED (not deleted)"
  assert_grep "FAILED http=400" "$out" "4xx permanent: LOUD error log"
  teardown_unarchive_scratch "$scratch"
}

test_identity_relay_json_missing_user_id_retains_sentinel() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  fixture_archived_identity "$scratch" kappa "scalar:box-maintainer"
  # Overwrite relay.json with a broken shape.
  printf '{"base":"http://127.0.0.1:1","password":"pw"}' > "${scratch}-archive/kappa/relay.json"

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_identity_unarchive_requested_sentinels 2>&1 ) || true

  assert_nofile "$scratch/kappa"                              "relay.json broken: no folder moved"
  assert_file   "${scratch}-archive/kappa/.unarchive-requested" "relay.json broken: sentinel retained"
  assert_grep "relay.json missing user_id or password" "$out"
  teardown_unarchive_scratch "$scratch"
}

test_identity_no_sentinel_noop() {
  local scratch; scratch=$(setup_unarchive_scratch)
  fixture_live_role "$scratch" box-maintainer
  # Create an archived identity WITHOUT the un-archive sentinel.
  mkdir -p "${scratch}-archive/lambda"
  printf -- '---\nrole: box-maintainer\n---\nbody\n' > "${scratch}-archive/lambda/lambda.md"

  local out
  out=$( _source_supervisor_unarchive "$scratch"
         scan_identity_unarchive_requested_sentinels 2>&1 ) || true

  assert_file   "${scratch}-archive/lambda"          "no-sentinel: archive folder untouched"
  assert_nofile "$scratch/lambda"                    "no-sentinel: no folder moved"
  assert_nogrep "un-archive step 1" "$out" "no-sentinel: no step-1 log line fires"
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
  # They're in the identity-archive tree, holding "role: restored-role".
  mkdir -p "${scratch}-archive/orphan-a" "${scratch}-archive/orphan-b"
  printf -- '---\nrole: restored-role\n---\nbody\n' > "${scratch}-archive/orphan-a/orphan-a.md"
  printf -- '---\nrole: restored-role\n---\nbody\n' > "${scratch}-archive/orphan-b/orphan-b.md"

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
run_test test_extract_roles_malformed

run_test test_identity_happy_path_scalar_role
run_test test_identity_happy_path_flow_list_all_live
run_test test_identity_happy_path_block_list_all_live
run_test test_identity_no_dormancy_preserved
run_test test_identity_role_missing_scalar_refuses
run_test test_identity_role_missing_multi_names_only_missing
run_test test_identity_name_collision_refuses
run_test test_identity_reactivate_5xx_transient_recovers
run_test test_identity_reactivate_4xx_permanent_retains_sentinel
run_test test_identity_relay_json_missing_user_id_retains_sentinel
run_test test_identity_no_sentinel_noop

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
