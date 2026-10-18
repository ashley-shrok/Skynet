#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2034  # the sourced supervisor reads the overrides
# Covers the supervisor's launch wiring for the box-wide desktop MCP server (desktop-mcp serve,
# run by desktop-mcp.service): the shared config file, start-if-down before a launch, passing the
# config only once the server answers, and the per-identity key in the launch env. Computed
# just-in-time at every launch, so a binary that appears (or disappears) is picked up by the next
# launch without a supervisor restart.
#
#   D-01  no binary installed        → no flag, no config written
#   D-02  binary + server answering  → flag, http config with the identity + key headers and a long
#                                       call timeout (claude's HTTP default is 60s), no start
#   D-03  server down, start works   → systemctl --user start desktop-mcp.service, then flag
#   D-04  server stays down          → no flag, bounded wait, ERROR log
#   D-05  second call is idempotent  → config not rewritten
#   D-06  jq unavailable             → no flag (graceful degradation)
#   D-07  launch env                 → DESKTOP_MCP_SECRET from `desktop-mcp secret <name>`
#   D-08  desktop down, relay up     → relay config only; the desktop's outage costs only its tools
#
# Usage: bash substrate/scripts/tests/agent-supervisor-desktop-mcp.test.sh   (from the repo root)

export AGENT_SUPERVISOR_LIB_ONLY=1
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"
[ -f "$SUPERVISOR" ] || { printf 'FATAL: supervisor not found at %s\n' "$SUPERVISOR" >&2; exit 1; }

PASS=0
FAIL=0
FAILURES=()
CURRENT_TEST=""
pass() { PASS=$((PASS+1)); printf 'PASS: %s\n' "$CURRENT_TEST"; }
fail() {
  FAIL=$((FAIL+1))
  FAILURES+=("$CURRENT_TEST: $1")
  printf 'FAIL: %s — %s\n' "$CURRENT_TEST" "$1" >&2
}

# shellcheck disable=SC1090
source "$SUPERVISOR" 2>/dev/null || true
for fn in ensure_desktop_mcp_config ensure_desktop_mcp_up compute_mcp_flags compute_mcp_env; do
  declare -F "$fn" >/dev/null 2>&1 || { printf 'FATAL: %s not defined after sourcing supervisor\n' "$fn" >&2; exit 1; }
done

SCRATCH=""
setup_scratch() {
  SCRATCH=$(mktemp -d)
  mkdir -p "$SCRATCH/.local/bin" "$SCRATCH/.claude" "$SCRATCH/stubs"
  DESKTOP_MCP_BIN="$SCRATCH/.local/bin/desktop-mcp"
  DESKTOP_MCP_CONFIG="$SCRATCH/.claude/desktop-mcp.json"
  DESKTOP_MCP_PORT=17794
  DESKTOP_MCP_WAIT_SEC=1
  RELAY_MCP_BIN="$SCRATCH/.local/bin/relay-mcp"
  RELAY_MCP_CONFIG="$SCRATCH/.claude/relay-mcp.json"
  RELAY_MCP_PORT=17793
  RELAY_MCP_WAIT_SEC=1
  # curl stub: the server on port P is healthy iff $SCRATCH/healthy-P exists.
  cat > "$SCRATCH/stubs/curl" <<EOF
#!/bin/sh
for a; do url="\$a"; done
port="\${url#http://127.0.0.1:}"; port="\${port%%/*}"
[ -f "$SCRATCH/healthy-\$port" ]
EOF
  # systemctl stub: records args; starting desktop-mcp.service makes it healthy iff start-works exists.
  cat > "$SCRATCH/stubs/systemctl" <<EOF
#!/bin/sh
echo "\$*" >> "$SCRATCH/systemctl.log"
case "\$*" in *"start desktop-mcp.service"*) [ -f "$SCRATCH/start-works" ] && touch "$SCRATCH/healthy-17794" ;; esac
exit 0
EOF
  chmod +x "$SCRATCH/stubs/curl" "$SCRATCH/stubs/systemctl"
  CURL_BIN="$SCRATCH/stubs/curl"
  SYSTEMCTL_BIN="$SCRATCH/stubs/systemctl"
}
teardown_scratch() { [ -n "$SCRATCH" ] && rm -rf "$SCRATCH"; SCRATCH=""; }
plant() { printf '#!/bin/sh\nexit 0\n' > "$1"; chmod +x "$1"; }
run_case() { CURRENT_TEST="$1"; shift; setup_scratch; "$@"; teardown_scratch; }

d01() {
  local flag; flag="$(compute_mcp_flags 2>/dev/null)"
  [ -z "$flag" ] || { fail "expected empty flag, got [$flag]"; return; }
  [ ! -f "$DESKTOP_MCP_CONFIG" ] || { fail "config written without a binary"; return; }
  pass
}

d02() {
  plant "$DESKTOP_MCP_BIN"; touch "$SCRATCH/healthy-17794"
  local flag; flag="$(compute_mcp_flags 2>/dev/null)"
  [ "$flag" = "--mcp-config $DESKTOP_MCP_CONFIG" ] || { fail "got [$flag]"; return; }
  # shellcheck disable=SC2016
  jq -e '.mcpServers.desktop.type == "http"
         and .mcpServers.desktop.url == "http://127.0.0.1:17794/mcp"
         and .mcpServers.desktop.timeout == 1800000
         and .mcpServers.desktop.headers["X-Fleet-Identity"] == "${FLEET_IDENTITY}"
         and .mcpServers.desktop.headers["X-Fleet-Desktop-Key"] == "${DESKTOP_MCP_SECRET}"' "$DESKTOP_MCP_CONFIG" >/dev/null \
    || { fail "config content wrong: $(cat "$DESKTOP_MCP_CONFIG")"; return; }
  [ -z "$(find "$SCRATCH/.claude" -name 'desktop-mcp.json.tmp.*')" ] || { fail "temp file left behind"; return; }
  [ ! -f "$SCRATCH/systemctl.log" ] || { fail "systemctl called while healthy"; return; }
  pass
}

d03() {
  plant "$DESKTOP_MCP_BIN"; touch "$SCRATCH/start-works"
  local flag; flag="$(compute_mcp_flags 2>/dev/null)"
  [ "$flag" = "--mcp-config $DESKTOP_MCP_CONFIG" ] || { fail "got [$flag]"; return; }
  grep -qx -- "--user start desktop-mcp.service" "$SCRATCH/systemctl.log" \
    || { fail "expected systemctl --user start desktop-mcp.service, log: $(cat "$SCRATCH/systemctl.log" 2>/dev/null)"; return; }
  pass
}

d04() {
  plant "$DESKTOP_MCP_BIN"
  local flag start end err="$SCRATCH/stderr"
  start=$(date +%s)
  flag="$(compute_mcp_flags 2>"$err")"
  end=$(date +%s)
  [ -z "$flag" ] || { fail "expected no flag when the server stays down, got [$flag]"; return; }
  [ $((end - start)) -le 4 ] || { fail "wait not bounded: $((end - start))s"; return; }
  grep -q "desktop-mcp: still not answering after 1s — this launch gets NO desktop tools" "$err" \
    || { fail "missing ERROR log on stderr: $(cat "$err")"; return; }
  pass
}

d05() {
  plant "$DESKTOP_MCP_BIN"; touch "$SCRATCH/healthy-17794"
  compute_mcp_flags >/dev/null 2>&1
  local m1 m2; m1=$(stat -c %Y.%N "$DESKTOP_MCP_CONFIG")
  sleep 1.1
  compute_mcp_flags >/dev/null 2>&1
  m2=$(stat -c %Y.%N "$DESKTOP_MCP_CONFIG")
  [ "$m1" = "$m2" ] || { fail "config rewritten on second call ($m1 vs $m2)"; return; }
  pass
}

d06() {
  plant "$DESKTOP_MCP_BIN"; touch "$SCRATCH/healthy-17794"
  local flag; flag="$(PATH=/nonexistent compute_mcp_flags 2>/dev/null)"
  [ -z "$flag" ] || { fail "expected empty flag without jq, got [$flag]"; return; }
  pass
}

d07() {
  local out k
  k="$(printf 'b%.0s' $(seq 64))"
  out="$(compute_mcp_env alpha)"
  [ -z "$out" ] || { fail "expected nothing without the binary, got [$out]"; return; }
  printf '#!/bin/sh\n[ "$1" = secret ] && [ "$2" = alpha ] && echo %s\n' "$k" > "$DESKTOP_MCP_BIN"
  chmod +x "$DESKTOP_MCP_BIN"
  out="$(compute_mcp_env alpha)"
  [ "$out" = " DESKTOP_MCP_SECRET=$k" ] || { fail "got [$out]"; return; }
  printf '#!/bin/sh\necho %s\n' "$(printf 'a%.0s' $(seq 64))" > "$RELAY_MCP_BIN"
  chmod +x "$RELAY_MCP_BIN"
  out="$(compute_mcp_env alpha)"
  [ "$out" = "RELAY_MCP_SECRET=$(printf 'a%.0s' $(seq 64)) DESKTOP_MCP_SECRET=$k" ] || { fail "both keys: got [$out]"; return; }
  printf '#!/bin/sh\necho not-a-key\n' > "$DESKTOP_MCP_BIN"
  out="$(compute_mcp_env alpha)"
  [ "$out" = "RELAY_MCP_SECRET=$(printf 'a%.0s' $(seq 64))" ] || { fail "bad desktop key should be dropped, got [$out]"; return; }
  pass
}

d08() {
  plant "$DESKTOP_MCP_BIN"; plant "$RELAY_MCP_BIN"; touch "$SCRATCH/healthy-17793"
  local flag; flag="$(compute_mcp_flags 2>/dev/null)"
  [ "$flag" = "--mcp-config $RELAY_MCP_CONFIG" ] || { fail "got [$flag]"; return; }
  pass
}

run_case D-01 d01
run_case D-02 d02
run_case D-03 d03
run_case D-04 d04
run_case D-05 d05
run_case D-06 d06
run_case D-07 d07
run_case D-08 d08

printf '\n--- summary: %d pass, %d fail ---\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f" >&2; done
  exit 1
fi
exit 0
