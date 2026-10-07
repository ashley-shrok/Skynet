#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317
# Covers compute_desktop_mcp_flag — the just-in-time variant of the desktop-mcp
# launch-flag plumbing that replaces the module-scope ensure_desktop_mcp_config
# cache. The cache was fragile under a distributor race where the supervisor
# restarted a beat before `~/.local/bin/desktop-mcp` landed on disk — the
# ensure check ran once at module scope, saw no binary, baked an empty flag
# into CLAUDE_LAUNCH_FLAGS for the supervisor's whole lifetime, and the
# feature was silently dead until the supervisor restarted for an unrelated
# reason. These cases lock in the just-in-time replacement:
#
#   T-01  — no binary installed       → compute returns empty, no config written
#   T-02  — binary planted            → compute returns `--mcp-config <path>`, config written
#   T-03  — second call is idempotent → same flag, config mtime unchanged
#   T-04  — binary removed after use  → compute returns empty (self-heal downward)
#   T-05  — jq unavailable            → compute returns empty (graceful degradation)
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-desktop-mcp.test.sh
#   Run from the repo root.

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

# ---- test state ----
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

SCRATCH=""
setup_scratch() {
  SCRATCH=$(mktemp -d)
  mkdir -p "$SCRATCH/.local/bin" "$SCRATCH/.claude"
  # Supervisor was sourced once at the top; DESKTOP_MCP_BIN/CONFIG captured the
  # real $HOME path then. Override here so compute_desktop_mcp_flag reads scratch.
  DESKTOP_MCP_BIN="$SCRATCH/.local/bin/desktop-mcp"
  DESKTOP_MCP_CONFIG="$SCRATCH/.claude/desktop-mcp.json"
}

teardown_scratch() {
  [ -n "$SCRATCH" ] && [ -d "$SCRATCH" ] && rm -rf "$SCRATCH"
  SCRATCH=""
}

# ---- source supervisor hermetically ----
# shellcheck disable=SC1090
source "$SUPERVISOR" 2>/dev/null || true

if ! declare -F compute_desktop_mcp_flag >/dev/null 2>&1; then
  printf 'FATAL: compute_desktop_mcp_flag not defined after sourcing supervisor\n' >&2
  exit 1
fi
if ! declare -F ensure_desktop_mcp_config >/dev/null 2>&1; then
  printf 'FATAL: ensure_desktop_mcp_config not defined after sourcing supervisor\n' >&2
  exit 1
fi

plant_binary() {
  printf '#!/bin/sh\nexit 0\n' > "$DESKTOP_MCP_BIN"
  chmod +x "$DESKTOP_MCP_BIN"
}

run_case() {
  local name="$1"; shift
  CURRENT_TEST="$name"
  setup_scratch
  "$@"
  teardown_scratch
}

# ---- T-01: no binary installed ----
t01() {
  local flag
  flag="$(compute_desktop_mcp_flag)"
  if [ -n "$flag" ]; then
    fail "expected empty flag, got [$flag]"
    return
  fi
  if [ -f "$DESKTOP_MCP_CONFIG" ]; then
    fail "config file should not exist when binary is absent"
    return
  fi
  pass
}

# ---- T-02: binary planted → flag emitted, config written ----
t02() {
  plant_binary
  local flag
  flag="$(compute_desktop_mcp_flag)"
  local expected="--mcp-config $DESKTOP_MCP_CONFIG"
  if [ "$flag" != "$expected" ]; then
    fail "expected [$expected], got [$flag]"
    return
  fi
  if [ ! -f "$DESKTOP_MCP_CONFIG" ]; then
    fail "config file should have been written"
    return
  fi
  if ! grep -q '"command": "'"$DESKTOP_MCP_BIN"'"' "$DESKTOP_MCP_CONFIG"; then
    fail "config file should name the binary; got:\n$(cat "$DESKTOP_MCP_CONFIG")"
    return
  fi
  pass
}

# ---- T-03: idempotent — second call doesn't rewrite ----
t03() {
  plant_binary
  compute_desktop_mcp_flag >/dev/null
  local mtime1 mtime2
  mtime1=$(stat -c '%Y' "$DESKTOP_MCP_CONFIG")
  # Sleep a hair so a stat-granularity rewrite WOULD show a different mtime.
  sleep 1
  compute_desktop_mcp_flag >/dev/null
  mtime2=$(stat -c '%Y' "$DESKTOP_MCP_CONFIG")
  if [ "$mtime1" != "$mtime2" ]; then
    fail "config file was rewritten on second call (mtime $mtime1 → $mtime2)"
    return
  fi
  pass
}

# ---- T-04: binary removed after use → empty flag (self-heal downward) ----
t04() {
  plant_binary
  compute_desktop_mcp_flag >/dev/null
  rm -f "$DESKTOP_MCP_BIN"
  local flag
  flag="$(compute_desktop_mcp_flag)"
  if [ -n "$flag" ]; then
    fail "expected empty flag after binary removal, got [$flag]"
    return
  fi
  pass
}

# ---- T-05: jq unavailable → empty flag (graceful degradation) ----
t05() {
  plant_binary
  # Shadow jq with a PATH that excludes it. ensure_desktop_mcp_config uses
  # `command -v jq`, which honors PATH, so a scrubbed PATH makes jq invisible.
  local flag
  flag="$(PATH=/nonexistent compute_desktop_mcp_flag)"
  if [ -n "$flag" ]; then
    fail "expected empty flag when jq is unavailable, got [$flag]"
    return
  fi
  pass
}

run_case T-01 t01
run_case T-02 t02
run_case T-03 t03
run_case T-04 t04
run_case T-05 t05

printf '\n--- summary: %d pass, %d fail ---\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f" >&2; done
  exit 1
fi
exit 0
