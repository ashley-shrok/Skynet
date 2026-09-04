#!/bin/bash
# install-usage-reporter.sh — make THIS box a Claude-usage reporter.
# Installs the statusLine reporter wrapper + node POSTer, PRESERVING the box's existing
# statusline (its output is passed through untouched), and points settings.json at the wrapper.
# Idempotent: re-running never wraps-the-wrapper and never loses the real original command.
# Requires: curl, jq, node (node is guaranteed wherever Claude Code runs).
set -euo pipefail
HUB="${CLAUDE_USAGE_HUB:-http://100.113.23.63}"
COLLECTOR_URL="${CLAUDE_USAGE_COLLECTOR:-http://100.113.23.63:9421/report}"
DEST="$HOME/.claude/usage"
SETTINGS="$HOME/.claude/settings.json"
WRAPPER="$DEST/usage-reporter.sh"
command -v jq   >/dev/null || { echo "need jq";   exit 1; }
command -v curl >/dev/null || { echo "need curl"; exit 1; }
command -v node >/dev/null || { echo "need node"; exit 1; }
mkdir -p "$DEST"
curl -fsS "$HUB/vms/home/usage-reporter.sh" -o "$WRAPPER"
curl -fsS "$HUB/vms/home/usage-report.js"  -o "$DEST/usage-report.js"
chmod +x "$WRAPPER" "$DEST/usage-report.js"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
CUR=$(jq -r '.statusLine.command // ""' "$SETTINGS" 2>/dev/null || echo "")
CONF="$DEST/usage-reporter.conf"
if [ "$CUR" = "$WRAPPER" ]; then
  # already our wrapper -> keep the existing conf (it holds the REAL original); never re-capture the wrapper
  [ -f "$CONF" ] || printf 'WRAPPED=""\nCOLLECTOR="%s"\n' "$COLLECTOR_URL" > "$CONF"
  echo "already installed; refreshed scripts, kept existing wrapped command."
else
  printf "WRAPPED='%s'\nCOLLECTOR=\"%s\"\n" "$CUR" "$COLLECTOR_URL" > "$CONF"
  cp "$SETTINGS" "$SETTINGS.bak.$(date +%Y%m%d-%H%M%S)"
  tmp=$(mktemp); jq --arg cmd "$WRAPPER" '.statusLine = {type:"command", command:$cmd}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  echo "installed; wraps original statusline: ${CUR:-<none>}"
fi
echo "statusLine -> $WRAPPER  |  collector -> $COLLECTOR_URL  |  (statusLine hot-reloads; no restart needed)"
