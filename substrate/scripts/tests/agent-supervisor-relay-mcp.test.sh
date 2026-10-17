#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317
# Covers the relay-mcp launch wiring in agent-supervisor.sh: ensure_relay_mcp_config,
# ensure_relay_mcp_up and compute_mcp_flags. relay-mcp is one HTTP server per host; a claude
# session that finds it down at launch never retries, so the supervisor must only pass the
# config once the server answers.
#
#   R-01  — no relay-mcp binary          → no relay config, flag empty
#   R-02  — binary + server healthy      → `--mcp-config <relay.json>`; config has the literal
#                                          ${FLEET_IDENTITY} header and the port
#   R-03  — server down, start brings it → systemctl --user start relay-mcp.service, flag present
#   R-04  — server never comes up        → flag absent, wait bounded, stdout stays clean
#   R-05  — desktop + relay both present → ONE `--mcp-config <desktop> <relay>` flag
#   R-06  — config rewrite is idempotent → mtime unchanged on second call
#   R-07  — compute_relay_env            → RELAY_MCP_SECRET=<64 hex> from `relay-mcp secret`;
#                                          nothing without the binary or on bad output
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-relay-mcp.test.sh   (from the repo root)

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
for fn in ensure_relay_mcp_config ensure_relay_mcp_up compute_mcp_flags compute_relay_env; do
  declare -F "$fn" >/dev/null 2>&1 || { printf 'FATAL: %s not defined after sourcing supervisor\n' "$fn" >&2; exit 1; }
done

SCRATCH=""
setup_scratch() {
  SCRATCH=$(mktemp -d)
  mkdir -p "$SCRATCH/.local/bin" "$SCRATCH/.claude" "$SCRATCH/stubs"
  DESKTOP_MCP_BIN="$SCRATCH/.local/bin/desktop-mcp"
  DESKTOP_MCP_CONFIG="$SCRATCH/.claude/desktop-mcp.json"
  RELAY_MCP_BIN="$SCRATCH/.local/bin/relay-mcp"
  RELAY_MCP_CONFIG="$SCRATCH/.claude/relay-mcp.json"
  RELAY_MCP_PORT=17793
  RELAY_MCP_WAIT_SEC=1
  # curl stub: healthy iff $SCRATCH/healthy exists.
  cat > "$SCRATCH/stubs/curl" <<EOF
#!/bin/sh
[ -f "$SCRATCH/healthy" ]
EOF
  # systemctl stub: records args; `start` makes the server healthy iff $SCRATCH/start-works exists.
  cat > "$SCRATCH/stubs/systemctl" <<EOF
#!/bin/sh
echo "\$*" >> "$SCRATCH/systemctl.log"
case "\$*" in *start*) [ -f "$SCRATCH/start-works" ] && touch "$SCRATCH/healthy" ;; esac
exit 0
EOF
  chmod +x "$SCRATCH/stubs/curl" "$SCRATCH/stubs/systemctl"
  CURL_BIN="$SCRATCH/stubs/curl"
  SYSTEMCTL_BIN="$SCRATCH/stubs/systemctl"
}
teardown_scratch() { [ -n "$SCRATCH" ] && rm -rf "$SCRATCH"; SCRATCH=""; }
plant() { printf '#!/bin/sh\nexit 0\n' > "$1"; chmod +x "$1"; }
run_case() { CURRENT_TEST="$1"; shift; setup_scratch; "$@"; teardown_scratch; }

r01() {
  local flag; flag="$(compute_mcp_flags 2>/dev/null)"
  [ -z "$flag" ] || { fail "expected empty flag, got [$flag]"; return; }
  [ ! -f "$RELAY_MCP_CONFIG" ] || { fail "relay config written without a binary"; return; }
  pass
}

r02() {
  plant "$RELAY_MCP_BIN"; touch "$SCRATCH/healthy"
  local flag; flag="$(compute_mcp_flags 2>/dev/null)"
  [ "$flag" = "--mcp-config $RELAY_MCP_CONFIG" ] || { fail "got [$flag]"; return; }
  # shellcheck disable=SC2016
  jq -e '.mcpServers.relay.type == "http"
         and .mcpServers.relay.url == "http://127.0.0.1:17793/mcp"
         and .mcpServers.relay.headers["X-Fleet-Identity"] == "${FLEET_IDENTITY}"
         and .mcpServers.relay.headers["X-Fleet-Relay-Key"] == "${RELAY_MCP_SECRET}"' "$RELAY_MCP_CONFIG" >/dev/null \
    || { fail "config content wrong: $(cat "$RELAY_MCP_CONFIG")"; return; }
  # written atomically: no temp files left behind
  [ -z "$(find "$SCRATCH/.claude" -name 'relay-mcp.json.tmp.*')" ] || { fail "temp file left behind"; return; }
  [ ! -f "$SCRATCH/systemctl.log" ] || { fail "systemctl called while healthy"; return; }
  pass
}

r03() {
  plant "$RELAY_MCP_BIN"; touch "$SCRATCH/start-works"
  local flag; flag="$(compute_mcp_flags 2>/dev/null)"
  [ "$flag" = "--mcp-config $RELAY_MCP_CONFIG" ] || { fail "got [$flag]"; return; }
  grep -qx -- "--user start relay-mcp.service" "$SCRATCH/systemctl.log" \
    || { fail "expected systemctl --user start relay-mcp.service, log: $(cat "$SCRATCH/systemctl.log" 2>/dev/null)"; return; }
  pass
}

r04() {
  plant "$RELAY_MCP_BIN"
  local flag start end err="$SCRATCH/stderr"
  start=$(date +%s)
  flag="$(compute_mcp_flags 2>"$err")"
  end=$(date +%s)
  [ -z "$flag" ] || { fail "expected no flag when server stays down, got [$flag]"; return; }
  [ $((end - start)) -le 4 ] || { fail "wait not bounded: $((end - start))s"; return; }
  grep -q "this launch gets NO relay tools" "$err" || { fail "missing ERROR log on stderr: $(cat "$err")"; return; }
  pass
}

r05() {
  plant "$RELAY_MCP_BIN"; plant "$DESKTOP_MCP_BIN"; touch "$SCRATCH/healthy"
  local flag; flag="$(compute_mcp_flags 2>/dev/null)"
  [ "$flag" = "--mcp-config $DESKTOP_MCP_CONFIG $RELAY_MCP_CONFIG" ] || { fail "got [$flag]"; return; }
  pass
}

r06() {
  plant "$RELAY_MCP_BIN"; touch "$SCRATCH/healthy"
  compute_mcp_flags >/dev/null 2>&1
  local m1 m2; m1=$(stat -c %Y.%N "$RELAY_MCP_CONFIG" 2>/dev/null || stat -c %Y "$RELAY_MCP_CONFIG")
  sleep 1.1
  compute_mcp_flags >/dev/null 2>&1
  m2=$(stat -c %Y.%N "$RELAY_MCP_CONFIG" 2>/dev/null || stat -c %Y "$RELAY_MCP_CONFIG")
  [ "$m1" = "$m2" ] || { fail "config rewritten on second call ($m1 vs $m2)"; return; }
  pass
}

r07() {
  local out
  out="$(compute_relay_env alpha)"
  [ -z "$out" ] || { fail "expected nothing without the binary, got [$out]"; return; }
  printf '#!/bin/sh\n[ "$1" = secret ] && [ "$2" = alpha ] && echo %s\n' "$(printf 'a%.0s' $(seq 64))" > "$RELAY_MCP_BIN"
  chmod +x "$RELAY_MCP_BIN"
  out="$(compute_relay_env alpha)"
  [ "$out" = "RELAY_MCP_SECRET=$(printf 'a%.0s' $(seq 64))" ] || { fail "got [$out]"; return; }
  printf '#!/bin/sh\necho not-a-key\n' > "$RELAY_MCP_BIN"
  out="$(compute_relay_env alpha)"
  [ -z "$out" ] || { fail "bad key output should yield nothing, got [$out]"; return; }
  pass
}

run_case R-01 r01
run_case R-02 r02
run_case R-03 r03
run_case R-04 r04
run_case R-05 r05
run_case R-06 r06
run_case R-07 r07

printf '\n--- summary: %d pass, %d fail ---\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f" >&2; done
  exit 1
fi
exit 0
