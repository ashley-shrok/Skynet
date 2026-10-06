#!/usr/bin/env bash
# shellcheck shell=bash
#
# Hermetic test driver for the per-identity agent desktop:
#   substrate/scripts/agent-desktop     (lifecycle CLI)
#   substrate/scripts/desktop-mcp.py    (stdio MCP server)
#
# Mirrors the image-gen.test.sh conventions: mktemp scratch fixture with
# trap-cleanup, fail()/assert_eq() helpers, PASS/FAIL bookkeeping.
#
# Hermetic environment contract:
#   HOME="$FIXTURE" for every invocation, so the real ~/fleet/ tree is never
#   touched. AGENT_DESKTOP_NO_SYSTEMD=1 (no systemd units are started) and
#   AGENT_DESKTOP_BASE_DISPLAY=700 (well clear of any real desktops).
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
ln -s "$HELPER" "$BIN/agent-desktop"

export HOME="$FIXTURE"
export PATH="$BIN:$PATH"
export AGENT_DESKTOP_NO_SYSTEMD=1
export AGENT_DESKTOP_BASE_DISPLAY=700
export DESKTOP_MCP_SETTLE_SECONDS=0.1
# Browser bridge: a fake Playwright MCP instead of `npx @playwright/mcp`.
export DESKTOP_MCP_PLAYWRIGHT_CMD="$FAKE_PW"
export FAKE_PW_PIDFILE="$FIXTURE/fake-pw.pids"
unset FLEET_IDENTITY

cleanup() {
  local d
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
  assert_eq test_up_alice_first DISPLAY=:700 "$a1"
  assert_eq test_up_bob_second DISPLAY=:701 "$b1"
  assert_eq test_up_idempotent "$a1" "$a2"

  local st
  st="$(agent-desktop status --identity alice --json)"
  assert_eq test_status_running true "$(jq -r .running <<<"$st")"
  assert_eq test_status_port 16600 "$(jq -r .vncPort <<<"$st")"
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
  assert_eq test_up_after_down_same_display DISPLAY=:701 "$(agent-desktop up --identity bob --quiet)"
  agent-desktop down --identity bob
}

test_run_launches_app() {
  local out
  out="$(FLEET_IDENTITY=alice agent-desktop run -- sleep 30)"
  case "$out" in "started pid "*" on DISPLAY=:700") pass test_run_output ;;
    *) fail test_run_output "$out" ;; esac
  local pid="${out#started pid }"; pid="${pid%% *}"
  if kill -0 "$pid" 2>/dev/null; then pass test_run_detached_alive; kill "$pid"; else fail test_run_detached_alive "pid $pid not running"; fi
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
  rm -f "$lock"
  case "$(sed -n 1p <<<"$out" | jq -r '.result.content[0].text')" in
    *"taken control"*) pass test_mcp_control_lock_blocks_input ;;
    *) fail test_mcp_control_lock_blocks_input "$(sed -n 1p <<<"$out")" ;;
  esac
  assert_eq test_mcp_control_lock_allows_screenshot image "$(sed -n 2p <<<"$out" | jq -r '.result.content[1].type')"
  assert_eq test_status_reports_no_control false \
    "$(agent-desktop status --identity alice --json | jq -r .userHasControl)"
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
  out="$(FLEET_IDENTITY=alice "$SESSION" "$MCP" init \
    'call:browser_navigate:{"url":"https://example.com"}' \
    "touch:$lock" \
    'call:browser_navigate:{"url":"https://example.org"}' \
    'call:browser_snapshot:{}' \
    "rm:$lock")"
  local echo1
  echo1="$(sed -n 2p <<<"$out" | jq -r '.content[0].text')"
  assert_eq test_browser_call_forwarded https://example.com "$(jq -r .arguments.url <<<"$echo1")"
  assert_eq test_browser_child_on_identity_display :700 "$(jq -r .display <<<"$echo1")"
  assert_eq test_browser_profile_per_identity "$FIXTURE/fleet/identities/alice/desktop/browser-profile" \
    "$(jq -r '.argv as $a | $a[($a | index("--user-data-dir")) + 1]' <<<"$echo1")"
  case "$(sed -n 3p <<<"$out" | jq -r '.content[0].text')" in
    *"taken control"*) pass test_browser_input_blocked_by_lock ;;
    *) fail test_browser_input_blocked_by_lock "$(sed -n 3p <<<"$out")" ;;
  esac
  assert_eq test_browser_snapshot_allowed_under_lock browser_snapshot \
    "$(sed -n 4p <<<"$out" | jq -r '.content[0].text | fromjson | .tool')"
  # One child for the whole session, gone once the session ends.
  assert_eq test_browser_single_child 1 "$(wc -l < "$FAKE_PW_PIDFILE" | tr -d ' ')"
  pid="$(head -1 "$FAKE_PW_PIDFILE")"
  sleep 0.5
  if kill -0 "$pid" 2>/dev/null; then fail test_browser_child_reaped "pid $pid still alive"; else pass test_browser_child_reaped; fi
}

# ---- run ---------------------------------------------------------------------

echo "agent-desktop tests (fixture: $FIXTURE)"
test_invalid_identity_rejected
test_no_identity_rejected
test_status_json_when_never_started
test_mcp_protocol
test_mcp_unknown_protocol_falls_back
test_mcp_without_identity_is_tool_error
test_browser_tools_cold_then_cached
if [ "$HAVE_X" = 1 ]; then
  test_up_allocates_stable_unique_displays
  test_down_then_up_keeps_display
  test_run_launches_app
  test_mcp_actions_and_control_lock
  test_browser_call_runs_on_desktop
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
