#!/usr/bin/env bash
# shellcheck shell=bash
#
# Hermetic test driver for the per-identity agent desktop:
#   substrate/scripts/agent-desktop     (lifecycle CLI)
#   substrate/scripts/desktop-mcp.py    (box-wide MCP server: HTTP via `serve`, stdio without args)
#
# Mirrors the image-gen.test.sh conventions: mktemp scratch fixture with
# trap-cleanup, fail()/assert_eq() helpers, PASS/FAIL bookkeeping.
#
# Hermetic environment contract:
#   HOME="$FIXTURE" for every invocation, so the real ~/fleet/ tree is never
#   touched. AGENT_DESKTOP_NO_SYSTEMD=1 (no systemd units are started) and
#   AGENT_DESKTOP_BASE_DISPLAY=D0, a random base in 700-895 (well clear of any real
#   desktops, and of another run of this suite on the same box).
#
# Tests that need a real X server (Xvnc, openbox, xdotool, import) are SKIPPED
# when those aren't installed; the allocation + MCP-protocol tests always run.
#
# Usage: bash substrate/scripts/tests/agent-desktop.test.sh   (from the repo root)

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HELPER="$REPO_ROOT/substrate/scripts/agent-desktop"
MCP="$REPO_ROOT/substrate/scripts/desktop-mcp.py"
FAKE_PW="$SCRIPT_DIR/fixtures/fake-playwright-mcp.py"
SESSION="$SCRIPT_DIR/fixtures/desktop-mcp-session.py"

for f in "$HELPER" "$MCP"; do
  [ -x "$f" ] || { printf 'FATAL: %s missing or not executable\n' "$f" >&2; exit 1; }
done

FIXTURE="$(mktemp -d)"
BIN="$FIXTURE/bin"
mkdir -p "$BIN" "$FIXTURE/fleet/identities"
for _id in alice bob carol; do
  mkdir -p "$FIXTURE/fleet/identities/$_id" && : > "$FIXTURE/fleet/identities/$_id/$_id.md"
done
ln -s "$HELPER" "$BIN/agent-desktop"
ln -s "$MCP" "$BIN/desktop-mcp"  # agent-desktop runs the browser host from it

export HOME="$FIXTURE"
export PATH="$BIN:$PATH"
export AGENT_DESKTOP_NO_SYSTEMD=1
D0=$((700 + RANDOM % 40 * 5))
D1=$((D0 + 1))
export AGENT_DESKTOP_BASE_DISPLAY=$D0
export DESKTOP_MCP_SETTLE_SECONDS=0.1
# Browser bridge: a fake Playwright MCP instead of `npx @playwright/mcp`.
export DESKTOP_MCP_PLAYWRIGHT_CMD="$FAKE_PW"
export FAKE_PW_PIDFILE="$FIXTURE/fake-pw.pids"
unset FLEET_IDENTITY

SERVE_PID=""
cleanup() {
  local d
  [ -n "$SERVE_PID" ] && kill "$SERVE_PID" 2>/dev/null
  for d in "$FIXTURE"/fleet/identities/*/; do
    [ -d "$d" ] && agent-desktop down --identity "$(basename "$d")" >/dev/null 2>&1
  done
  rm -rf "$FIXTURE"
}
trap cleanup EXIT

PASS=0
FAIL=0
FAILURES=()
fail() { FAIL=$((FAIL + 1)); FAILURES+=("$1"); printf '  FAIL %s: %s\n' "$1" "$2"; }
pass() { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
assert_eq() { # name expected actual
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected '$2', got '$3'"; fi
}

HAVE_X=1
for c in Xvnc vncpasswd openbox xdotool import; do
  command -v "$c" >/dev/null 2>&1 || HAVE_X=0
done

# Drive desktop-mcp with a list of JSON-RPC lines; prints one response per line.
mcp_session() {
  printf '%s\n' "$@" | "$MCP"
}

# ---- the box-wide HTTP server (desktop-mcp serve) ----
MCP_PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
start_mcp_server() {
  DESKTOP_MCP_PORT="$MCP_PORT" "$MCP" serve >>"$FIXTURE/serve.log" 2>&1 &
  SERVE_PID=$!
  local i
  for i in $(seq 1 100); do
    curl -sf -m 1 "http://127.0.0.1:$MCP_PORT/health" >/dev/null 2>&1 && return 0
    sleep 0.05
  done
  printf 'FATAL: desktop-mcp serve did not come up: %s\n' "$(cat "$FIXTURE/serve.log")" >&2
  exit 1
}
stop_mcp_server() {
  kill "$SERVE_PID" 2>/dev/null
  wait "$SERVE_PID" 2>/dev/null
  SERVE_PID=""
}
# http_rpc IDENTITY KEY JSON [extra curl args...] — prints the response body.
http_rpc() {
  local who="$1" key="$2" body="$3"
  shift 3
  curl -s -m 60 -X POST "http://127.0.0.1:$MCP_PORT/mcp" -H 'Content-Type: application/json' \
    ${who:+-H "X-Fleet-Identity: $who"} ${key:+-H "X-Fleet-Desktop-Key: $key"} "$@" -d "$body"
}
# http_call IDENTITY TOOL ARGS-JSON — a keyed tools/call; prints the result object.
http_call() {
  http_rpc "$1" "$("$MCP" secret "$1")" \
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$2\",\"arguments\":$3}}" | jq -c .result
}

# ---- tests: no X server needed ------------------------------------------------

test_invalid_identity_rejected() {
  local out rc
  out="$(agent-desktop status --identity '../etc' 2>&1)"; rc=$?
  assert_eq test_invalid_identity_rejected_rc 1 "$rc"
  case "$out" in *"invalid identity"*) pass test_invalid_identity_rejected_msg ;;
    *) fail test_invalid_identity_rejected_msg "$out" ;; esac
}

test_no_identity_rejected() {
  local out rc
  out="$(agent-desktop status 2>&1)"; rc=$?
  assert_eq test_no_identity_rejected_rc 1 "$rc"
  case "$out" in *"no identity"*) pass test_no_identity_rejected_msg ;;
    *) fail test_no_identity_rejected_msg "$out" ;; esac
}

test_status_json_when_never_started() {
  local out
  out="$(FLEET_IDENTITY=never agent-desktop status --json)"
  assert_eq test_status_json_running false "$(jq -r .running <<<"$out")"
  assert_eq test_status_json_display null "$(jq -r .display <<<"$out")"
}

test_refuses_gone_identity() {
  local rc=0
  agent-desktop up --identity ghost --quiet >/dev/null 2>&1 || rc=$?
  assert_eq test_up_gone_identity_fails 1 "$rc"
  rc=0
  agent-desktop control take --identity ghost >/dev/null 2>&1 || rc=$?
  assert_eq test_control_take_gone_identity_fails 1 "$rc"
  assert_eq test_gone_identity_no_stray_dir no "$([ -e "$FIXTURE/fleet/identities/ghost" ] && echo yes || echo no)"
}

test_mcp_protocol() {
  local out
  out="$(mcp_session \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
    '{"jsonrpc":"2.0","id":3,"method":"nope"}' \
    'not json' \
    '{"jsonrpc":"2.0","id":4,"method":"ping"}')"
  assert_eq test_mcp_response_count 5 "$(wc -l <<<"$out" | tr -d ' ')"
  assert_eq test_mcp_initialize_version 2025-06-18 "$(sed -n 1p <<<"$out" | jq -r .result.protocolVersion)"
  assert_eq test_mcp_server_name desktop "$(sed -n 1p <<<"$out" | jq -r .result.serverInfo.name)"
  local names
  names="$(sed -n 2p <<<"$out" | jq -r '[.result.tools[].name] | sort | join(",")')"
  assert_eq test_mcp_tool_names "click,cursor_position,drag,key,launch,move,screenshot,scroll,type,wait" "$names"
  assert_eq test_mcp_unknown_method -32601 "$(sed -n 3p <<<"$out" | jq -r .error.code)"
  assert_eq test_mcp_parse_error -32700 "$(sed -n 4p <<<"$out" | jq -r .error.code)"
  assert_eq test_mcp_ping '{}' "$(sed -n 5p <<<"$out" | jq -c .result)"
}

test_mcp_unknown_protocol_falls_back() {
  local out
  out="$(mcp_session '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}')"
  assert_eq test_mcp_protocol_fallback 2025-06-18 "$(jq -r .result.protocolVersion <<<"$out")"
}

test_mcp_without_identity_is_tool_error() {
  local out
  out="$(mcp_session '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"screenshot","arguments":{}}}')"
  assert_eq test_mcp_no_identity_iserror true "$(jq -r .result.isError <<<"$out")"
  case "$(jq -r '.result.content[0].text' <<<"$out")" in
    *FLEET_IDENTITY*) pass test_mcp_no_identity_msg ;;
    *) fail test_mcp_no_identity_msg "$out" ;;
  esac
}

# ---- tests: real X server -----------------------------------------------------

test_up_allocates_stable_unique_displays() {
  local a1 b1 a2
  a1="$(FLEET_IDENTITY=alice agent-desktop up --quiet)"
  b1="$(agent-desktop up --identity bob --quiet)"
  a2="$(FLEET_IDENTITY=alice agent-desktop up --quiet)"
  assert_eq test_up_alice_first DISPLAY=:$D0 "$a1"
  assert_eq test_up_bob_second DISPLAY=:$D1 "$b1"
  assert_eq test_up_idempotent "$a1" "$a2"

  local st
  st="$(agent-desktop status --identity alice --json)"
  assert_eq test_status_running true "$(jq -r .running <<<"$st")"
  assert_eq test_status_port $((15900 + D0)) "$(jq -r .vncPort <<<"$st")"
  assert_eq test_status_geometry 1280x800 "$(jq -r .geometry <<<"$st")"

  local mode
  mode="$(stat -c %a "$FIXTURE/fleet/identities/alice/desktop/vnc-password")"
  assert_eq test_password_mode 600 "$mode"
  assert_eq test_password_len 8 "$(tr -d '\n' < "$FIXTURE/fleet/identities/alice/desktop/vnc-password" | wc -c | tr -d ' ')"
}

test_down_then_up_keeps_display() {
  agent-desktop down --identity bob
  agent-desktop status --identity bob >/dev/null
  assert_eq test_down_stops 1 "$?"
  assert_eq test_up_after_down_same_display DISPLAY=:$D1 "$(agent-desktop up --identity bob --quiet)"
  agent-desktop down --identity bob
}

test_run_launches_app() {
  local out
  out="$(FLEET_IDENTITY=alice agent-desktop run -- sleep 30)"
  case "$out" in "started pid "*" on DISPLAY=:$D0") pass test_run_output ;;
    *) fail test_run_output "$out" ;; esac
  local pid="${out#started pid }"; pid="${pid%% *}"
  if kill -0 "$pid" 2>/dev/null; then pass test_run_detached_alive; kill "$pid"; else fail test_run_detached_alive "pid $pid not running"; fi
}

# A host's graphical login leaks WAYLAND_DISPLAY into agent sessions; apps
# started on the desktop must not see it or they draw on the host's screen.
test_run_strips_wayland() {
  local envfile="$FIXTURE/run-env.txt" out
  rm -f "$envfile"
  out="$(WAYLAND_DISPLAY=wayland-0 ELECTRON_OZONE_PLATFORM_HINT=wayland XDG_SESSION_TYPE=wayland \
    GDK_BACKEND=wayland QT_QPA_PLATFORM=wayland MOZ_ENABLE_WAYLAND=1 SDL_VIDEODRIVER=wayland \
    FLEET_IDENTITY=alice agent-desktop run -- sh -c "env > '$envfile'")"
  local i kv
  for i in $(seq 1 20); do [ -s "$envfile" ] && break; sleep 0.1; done
  if grep -qE '^(WAYLAND_DISPLAY|ELECTRON_OZONE_PLATFORM_HINT)=' "$envfile" 2>/dev/null; then
    fail test_run_strips_wayland_vars "$(grep -E '^(WAYLAND_DISPLAY|ELECTRON_OZONE_PLATFORM_HINT)=' "$envfile")"
  else pass test_run_strips_wayland_vars; fi
  for kv in GDK_BACKEND=x11 QT_QPA_PLATFORM=xcb MOZ_ENABLE_WAYLAND=0 SDL_VIDEODRIVER=x11 XDG_SESSION_TYPE=x11 DISPLAY=:$D0; do
    assert_eq "test_run_env_${kv%%=*}" "$kv" "$(grep "^${kv%%=*}=" "$envfile")"
  done
}

test_mcp_actions_and_control_lock() {
  local lock="$FIXTURE/fleet/identities/alice/desktop/control-lock"
  local call='{"jsonrpc":"2.0","id":%d,"method":"tools/call","params":{"name":"%s","arguments":%s}}'
  local out
  # shellcheck disable=SC2059  # format string is ours
  out="$(FLEET_IDENTITY=alice mcp_session \
    "$(printf "$call" 1 screenshot '{}')" \
    "$(printf "$call" 2 click '{"x":100,"y":120}')" \
    "$(printf "$call" 3 click '{"x":5000,"y":1}')" \
    "$(printf "$call" 4 key '{"keys":"Escape","screenshot":false}')" \
    "$(printf "$call" 5 cursor_position '{}')")"

  local shot
  shot="$(sed -n 1p <<<"$out")"
  assert_eq test_mcp_screenshot_ok false "$(jq -r .result.isError <<<"$shot")"
  assert_eq test_mcp_screenshot_is_png image/png "$(jq -r '.result.content[1].mimeType' <<<"$shot")"
  # PNG magic, base64-encoded, starts with iVBORw0KGgo
  case "$(jq -r '.result.content[1].data' <<<"$shot")" in iVBORw0KGgo*) pass test_mcp_screenshot_png_magic ;;
    *) fail test_mcp_screenshot_png_magic "not a PNG" ;; esac
  assert_eq test_mcp_click_returns_shot image "$(sed -n 2p <<<"$out" | jq -r '.result.content[1].type')"
  assert_eq test_mcp_offscreen_iserror true "$(sed -n 3p <<<"$out" | jq -r .result.isError)"
  assert_eq test_mcp_screenshot_false_no_image 1 "$(sed -n 4p <<<"$out" | jq '.result.content | length')"
  assert_eq test_mcp_cursor "Cursor at (100, 120)." "$(sed -n 5p <<<"$out" | jq -r '.result.content[0].text')"

  touch "$lock"
  # shellcheck disable=SC2059
  out="$(FLEET_IDENTITY=alice mcp_session \
    "$(printf "$call" 1 click '{"x":10,"y":10}')" \
    "$(printf "$call" 2 screenshot '{}')")"
  case "$(sed -n 1p <<<"$out" | jq -r '.result.content[0].text')" in
    *"taken control"*) pass test_mcp_control_lock_blocks_input ;;
    *) fail test_mcp_control_lock_blocks_input "$(sed -n 1p <<<"$out")" ;;
  esac
  assert_eq test_mcp_control_lock_allows_screenshot image "$(sed -n 2p <<<"$out" | jq -r '.result.content[1].type')"

  # A stale lease (tab closed, no renewals) no longer blocks the agent.
  touch -d '-120 seconds' "$lock"
  # shellcheck disable=SC2059
  out="$(FLEET_IDENTITY=alice mcp_session "$(printf "$call" 1 click '{"x":10,"y":10,"screenshot":false}')")"
  assert_eq test_mcp_stale_lock_allows_input "Clicked left at (10, 10)." "$(jq -r '.result.content[0].text' <<<"$out")"
  rm -f "$lock"
  assert_eq test_status_reports_no_control false \
    "$(agent-desktop status --identity alice --json | jq -r .userHasControl)"
}

test_control_lease() {
  local lock="$FIXTURE/fleet/identities/carol/desktop/control-lock"
  agent-desktop control take --identity carol --by user-A
  assert_eq test_control_take_status true "$(agent-desktop status --identity carol --json | jq -r .userHasControl)"
  assert_eq test_control_lock_records_who user-A "$(jq -r .by "$lock")"
  # Not renewed for longer than the lease: stale, the agent gets the desktop back.
  touch -d '-120 seconds' "$lock"
  assert_eq test_control_stale_lease false "$(agent-desktop status --identity carol --json | jq -r .userHasControl)"
  # Renewing is just taking again.
  agent-desktop control take --identity carol --by user-A
  assert_eq test_control_renew true "$(agent-desktop status --identity carol --json | jq -r .userHasControl)"
  agent-desktop control release --identity carol
  assert_eq test_control_release false "$(agent-desktop status --identity carol --json | jq -r .userHasControl)"
  if [ -e "$lock" ]; then fail test_control_release_removes_file "still there"; else pass test_control_release_removes_file; fi
}

# ---- tests: browser bridge -----------------------------------------------------

test_browser_tools_cold_then_cached() {
  local out
  # Cold cache: desktop tools now, browser tools announced via list_changed.
  out="$("$SESSION" "$MCP" init tools wait-list-changed tools)"
  assert_eq test_browser_cold_initial_count 10 "$(sed -n 2p <<<"$out" | jq '.tools | length')"
  assert_eq test_browser_list_changed true "$(sed -n 3p <<<"$out" | jq -r .list_changed)"
  assert_eq test_browser_tools_after_warm "browser_navigate,browser_snapshot" \
    "$(sed -n 4p <<<"$out" | jq -r '[.tools[] | select(startswith("browser_"))] | join(",")')"
  # Warm cache: listed straight away, no child spawned just to list them.
  : > "$FAKE_PW_PIDFILE"
  out="$("$SESSION" "$MCP" init tools)"
  assert_eq test_browser_cached_count 12 "$(sed -n 2p <<<"$out" | jq '.tools | length')"
  assert_eq test_browser_no_spawn_when_cached 0 "$(wc -l < "$FAKE_PW_PIDFILE" | tr -d ' ')"
}

test_browser_call_runs_on_desktop() {
  local lock="$FIXTURE/fleet/identities/alice/desktop/control-lock" out pid
  : > "$FAKE_PW_PIDFILE"
  out="$(WAYLAND_DISPLAY=wayland-0 ELECTRON_OZONE_PLATFORM_HINT=wayland XDG_SESSION_TYPE=wayland \
    GDK_BACKEND=wayland QT_QPA_PLATFORM=wayland MOZ_ENABLE_WAYLAND=1 SDL_VIDEODRIVER=wayland \
    FLEET_IDENTITY=alice "$SESSION" "$MCP" init \
    'call:browser_navigate:{"url":"https://example.com"}' \
    "touch:$lock" \
    'call:browser_navigate:{"url":"https://example.org"}' \
    'call:browser_snapshot:{}' \
    "rm:$lock")"
  local echo1
  echo1="$(sed -n 2p <<<"$out" | jq -r '.content[0].text')"
  assert_eq test_browser_call_forwarded https://example.com "$(jq -r .arguments.url <<<"$echo1")"
  assert_eq test_browser_child_on_identity_display :$D0 "$(jq -r .display <<<"$echo1")"
  assert_eq test_browser_child_x11_only \
    '{"ELECTRON_OZONE_PLATFORM_HINT":null,"GDK_BACKEND":"x11","MOZ_ENABLE_WAYLAND":"0","QT_QPA_PLATFORM":"xcb","SDL_VIDEODRIVER":"x11","WAYLAND_DISPLAY":null,"XDG_SESSION_TYPE":"x11"}' \
    "$(jq -cS .env <<<"$echo1")"
  assert_eq test_browser_profile_per_identity "$FIXTURE/fleet/identities/alice/desktop/browser-profile" \
    "$(jq -r '.argv as $a | $a[($a | index("--user-data-dir")) + 1]' <<<"$echo1")"
  case "$(sed -n 3p <<<"$out" | jq -r '.content[0].text')" in
    *"taken control"*) pass test_browser_input_blocked_by_lock ;;
    *) fail test_browser_input_blocked_by_lock "$(sed -n 3p <<<"$out")" ;;
  esac
  assert_eq test_browser_snapshot_allowed_under_lock browser_snapshot \
    "$(sed -n 4p <<<"$out" | jq -r '.content[0].text | fromjson | .tool')"
  # Reached over a socket only this user can open, never a TCP port.
  assert_eq test_browser_socket_private "socket 600" \
    "$(stat -c '%F %a' "$FIXTURE/fleet/identities/alice/desktop/browser.sock" | sed 's/^.* socket/socket/')"
  case " $(jq -r '.argv | join(" ")' <<<"$echo1") " in
    *" --port "*) fail test_browser_no_tcp_port "$(jq -c .argv <<<"$echo1")" ;;
    *) pass test_browser_no_tcp_port ;;
  esac
  # One browser for the whole session. It lives with the desktop, not the session:
  # gone once the desktop's browser is stopped.
  assert_eq test_browser_single_child 1 "$(wc -l < "$FAKE_PW_PIDFILE" | tr -d ' ')"
  pid="$(head -1 "$FAKE_PW_PIDFILE")"
  if kill -0 "$pid" 2>/dev/null; then pass test_browser_outlives_session; else fail test_browser_outlives_session "pid $pid gone"; fi
  agent-desktop browser down --identity alice
  if kill -0 "$pid" 2>/dev/null; then fail test_browser_down_reaps "pid $pid still alive"; else pass test_browser_down_reaps; fi
  # Each start turns off the password manager and the crash-restore bubble in the
  # profile, keeping whatever else the profile holds.
  local prefs="$FIXTURE/fleet/identities/alice/desktop/browser-profile/Default/Preferences"
  printf '%s' '{"keep_me":1,"profile":{"exit_type":"Crashed","exited_cleanly":false,"name":"Person 1"}}' > "$prefs"
  agent-desktop browser up --identity alice --quiet >/dev/null
  assert_eq test_browser_prefs_seeded \
    '{"autosignin":false,"cred":false,"exit":"Normal","keep":1,"leak":false,"name":"Person 1","pm":false,"clean":true}' \
    "$(jq -c '{autosignin: .credentials_enable_autosignin, cred: .credentials_enable_service,
      exit: .profile.exit_type, keep: .keep_me, leak: .profile.password_manager_leak_detection,
      name: .profile.name, pm: .profile.password_manager_enabled, clean: .profile.exited_cleanly}' "$prefs")"
  agent-desktop browser down --identity alice
}

# ---- tests: the box-wide HTTP server -----------------------------------------

# Cold tool cache: sessions launched while the list is being fetched hold their event
# stream open and get tools/list_changed once it's in (the stdio server pushed it too).
test_http_cold_cache_announces_tools() {
  local cache stream="$FIXTURE/stream.txt"
  cache="$(ls "$FIXTURE"/.cache/agent-desktop/*-tools.json)"
  stop_mcp_server
  rm -f "$cache"
  FAKE_PW_LIST_DELAY=2 start_mcp_server
  assert_eq test_http_cold_health_no_browser_tools false "$(curl -s "http://127.0.0.1:$MCP_PORT/health" | jq -r .browserTools)"
  curl -s -N -m 15 "http://127.0.0.1:$MCP_PORT/mcp" -H 'Accept: text/event-stream' > "$stream"
  case "$(cat "$stream")" in
    *'"method":"notifications/tools/list_changed"'*) pass test_http_cold_list_changed_sent ;;
    *) fail test_http_cold_list_changed_sent "$(cat "$stream")" ;;
  esac
  assert_eq test_http_cold_then_listed 12 \
    "$(http_rpc "" "" '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq '.result.tools | length')"
  # Warm: nothing to announce, so no stream is held.
  assert_eq test_http_warm_get_405 405 "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$MCP_PORT/mcp")"
}

# Two callers starting the same identity's browser at once get one browser.
test_browser_up_concurrent_single_host() {
  agent-desktop browser down --identity carol
  : > "$FAKE_PW_PIDFILE"
  local p1 p2
  agent-desktop browser up --identity carol --quiet >/dev/null & p1=$!
  agent-desktop browser up --identity carol --quiet >/dev/null & p2=$!
  wait "$p1" "$p2"  # not a bare wait: the MCP server is a background job too
  assert_eq test_browser_up_concurrent_one_browser 1 "$(wc -l < "$FAKE_PW_PIDFILE" | tr -d ' ')"
  agent-desktop down --identity carol
}

test_http_protocol_and_auth() {
  local init key out
  assert_eq test_http_health_ok true "$(curl -s "http://127.0.0.1:$MCP_PORT/health" | jq -r .ok)"
  init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}'
  out="$(http_rpc "" "" "$init")"
  assert_eq test_http_initialize_name desktop "$(jq -r .result.serverInfo.name <<<"$out")"
  assert_eq test_http_announces_list_changed true "$(jq -r .result.capabilities.tools.listChanged <<<"$out")"
  assert_eq test_http_tools_listed 12 \
    "$(http_rpc "" "" '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq '.result.tools | length')"
  assert_eq test_http_notification_202 202 "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "http://127.0.0.1:$MCP_PORT/mcp" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"notifications/initialized"}')"
  assert_eq test_http_get_405 405 "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$MCP_PORT/mcp")"
  assert_eq test_http_origin_refused 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "http://127.0.0.1:$MCP_PORT/mcp" -H 'Origin: http://evil.example' -H 'Content-Type: application/json' -d "$init")"

  local call='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"screenshot","arguments":{}}}'
  out="$(http_rpc "" "" "$call")"
  case "$(jq -r '.result.isError, .result.content[0].text' <<<"$out" | tr '\n' ' ')" in
    "true "*FLEET_IDENTITY*) pass test_http_no_identity_refused ;; *) fail test_http_no_identity_refused "$out" ;;
  esac
  out="$(http_rpc alice "$(printf '0%.0s' $(seq 64))" "$call")"
  case "$(jq -r '.result.isError, .result.content[0].text' <<<"$out" | tr '\n' ' ')" in
    "true "*"key is missing or wrong"*) pass test_http_wrong_key_refused ;; *) fail test_http_wrong_key_refused "$out" ;;
  esac
  # Another identity's key doesn't open alice's desktop.
  out="$(http_rpc alice "$("$MCP" secret bob)" "$call")"
  assert_eq test_http_other_identity_key_refused true "$(jq -r .result.isError <<<"$out")"

  key="$("$MCP" secret alice)"
  if [[ "$key" =~ ^[0-9a-f]{64}$ ]] && [ "$key" = "$("$MCP" secret alice)" ] && [ "$key" != "$("$MCP" secret bob)" ]; then
    pass test_secret_stable_per_identity
  else fail test_secret_stable_per_identity "$key"; fi
  assert_eq test_key_file_mode 600 "$(stat -c %a "$FIXTURE/.config/desktop-mcp/key")"
}

test_http_actions() {
  local out appdir="$FIXTURE/session-bin" marker="$FIXTURE/zzapp-ran"
  # launch finds programs on the calling session's PATH (X-Fleet-Path), not just the server's.
  mkdir -p "$appdir"
  printf '#!/bin/sh\necho "$FLEET_IDENTITY" > "%s"\n' "$marker" > "$appdir/zzapp"
  chmod +x "$appdir/zzapp"
  out="$(http_rpc alice "$("$MCP" secret alice)" \
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"launch","arguments":{"command":"zzapp","wait_seconds":0,"screenshot":false}}}' \
    -H "X-Fleet-Path: $appdir:/usr/bin:/bin")"
  assert_eq test_http_launch_ok false "$(jq -r .result.isError <<<"$out")"
  local _
  for _ in $(seq 1 20); do [ -s "$marker" ] && break; sleep 0.1; done
  assert_eq test_http_launch_uses_session_path alice "$(cat "$marker" 2>/dev/null)"

  out="$(http_call alice screenshot '{}')"
  assert_eq test_http_screenshot_ok false "$(jq -r .isError <<<"$out")"
  assert_eq test_http_screenshot_png image/png "$(jq -r '.content[1].mimeType' <<<"$out")"
  out="$(http_call bob cursor_position '{}')"
  case "$(jq -r '.content[0].text' <<<"$out")" in "Cursor at ("*) pass test_http_second_identity ;;
    *) fail test_http_second_identity "$out" ;; esac
}

# The point of running the browser outside desktop-mcp: restarting the server
# keeps the same browser and the same session with it (tabs), and a browser that
# died comes back on its own.
test_http_browser_survives_server_restart() {
  local out p1 p2 p3
  out="$(http_call alice browser_navigate '{"url":"https://example.com"}' | jq -r '.content[0].text')"
  p1="$(jq -r .pid <<<"$out")"
  assert_eq test_http_browser_on_display :$D0 "$(jq -r .display <<<"$out")"

  stop_mcp_server
  start_mcp_server
  out="$(http_call alice browser_snapshot '{}' | jq -r '.content[0].text')"
  p2="$(jq -r .pid <<<"$out")"
  assert_eq test_http_restart_keeps_browser "$p1" "$p2"
  assert_eq test_http_restart_keeps_session 1 "$(jq -r .sessions <<<"$out")"

  # Playwright died under us -> its host exits -> the next call starts a new one.
  kill "$p2"; sleep 0.5
  out="$(http_call alice browser_snapshot '{}')"
  assert_eq test_http_dead_browser_restarted false "$(jq -r .isError <<<"$out")"
  p3="$(jq -r '.content[0].text | fromjson | .pid' <<<"$out")"
  if [ -n "$p3" ] && [ "$p3" != "$p2" ]; then pass test_http_dead_browser_new_pid; else fail test_http_dead_browser_new_pid "$p2 -> $p3"; fi

  # Stopping the desktop takes its browser with it.
  agent-desktop down --identity alice
  if kill -0 "$p3" 2>/dev/null; then fail test_http_desktop_down_reaps_browser "pid $p3 alive"; else pass test_http_desktop_down_reaps_browser; fi
}

# ---- run ---------------------------------------------------------------------

echo "agent-desktop tests (fixture: $FIXTURE)"
test_invalid_identity_rejected
test_no_identity_rejected
test_status_json_when_never_started
test_refuses_gone_identity
test_mcp_protocol
test_mcp_unknown_protocol_falls_back
test_mcp_without_identity_is_tool_error
test_browser_tools_cold_then_cached
test_control_lease
start_mcp_server
test_http_protocol_and_auth
test_http_cold_cache_announces_tools
if [ "$HAVE_X" = 1 ]; then
  test_up_allocates_stable_unique_displays
  test_down_then_up_keeps_display
  test_run_launches_app
  test_run_strips_wayland
  test_mcp_actions_and_control_lock
  test_browser_call_runs_on_desktop
  test_http_actions
  test_http_browser_survives_server_restart
  test_browser_up_concurrent_single_host
else
  echo "  SKIP X-server tests (need Xvnc, vncpasswd, openbox, xdotool, import)"
fi

echo "==============================="
echo "PASS: $PASS  FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi
