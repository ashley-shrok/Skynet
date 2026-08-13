#!/bin/bash
#
# verify-monitor-payload.sh — RESEARCH § OQ-2 closer.
#
# Usage: bash verify-monitor-payload.sh <scratch-identity-hostname>
#
# Assumes: (a) SSH access to the target host is already configured,
# (b) the target host has a Claude Code session available, (c) the
# Skynet backend is running and will pick up the SessionState frames
# via the ssh-poll-orchestrator once the hook is installed.
#
# This script does NOT install the hook — that is the orchestrator's
# (tina's) job via a small `node -e "import('./remote-hook-install.js')..."`
# snippet documented in scripts/README.md. This script assumes the hook
# is ALREADY installed on the target and simply cats the last-captured
# payload file, parses out the background_tasks[] entries, and prints
# each entry with jq so the operator can eyeball the shape.
#
set -euo pipefail
HOST="${1:?usage: verify-monitor-payload.sh <hostname>}"
PAYLOAD_PATH="$HOME/.claude/fleet-status/last-stop-payload.json"
echo "Reading Stop-hook payload from ${HOST}:${PAYLOAD_PATH} ..."
RAW=$(ssh -o ConnectTimeout=5 "${HOST}" "cat '${PAYLOAD_PATH}' 2>/dev/null || echo ''")
if [ -z "${RAW}" ]; then
  echo "ERROR: payload file is missing or empty on ${HOST}." >&2
  echo "  Ensure remote-hook-install has been run for this host, then trigger a Stop event in a Claude Code session (any turn completion) and re-run this script." >&2
  exit 2
fi
echo "--- All background_tasks[] entries (raw) ---"
echo "${RAW}" | jq '.background_tasks // []'
echo ""
echo "--- Monitor-type entries (RESEARCH § OQ-2 target) ---"
MON_COUNT=$(echo "${RAW}" | jq '[.background_tasks[]? | select(.type == "monitor")] | length')
if [ "${MON_COUNT}" = "0" ]; then
  echo "WARN: no type='monitor' entries in the captured payload." >&2
  echo "  This does NOT mean the pipeline is broken — it means the last Stop event on ${HOST} did not have any live Monitors." >&2
  echo "  Launch a Monitor from a Claude Code session on ${HOST}, trigger another Stop, and re-run." >&2
  exit 3
fi
echo "${RAW}" | jq '[.background_tasks[]? | select(.type == "monitor")]'
echo ""
echo "--- Field-presence check (RESEARCH § 1 field table) ---"
echo "${RAW}" | jq '.background_tasks[]? | select(.type == "monitor") | { id, type, status, has_description: (.description != null), description_prefix: (.description // "" | .[0:12]), has_server: (.server != null), has_tool: (.tool != null) }'
echo ""
echo "OK: ${MON_COUNT} monitor-type entries captured."
echo "If description_prefix shows '[ambient] ' for the persistent Monitors, Plan 05 ambient tagging is landed for this identity."
