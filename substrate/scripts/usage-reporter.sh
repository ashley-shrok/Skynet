#!/bin/bash
# Claude Code statusLine wrapper. Reads stdin once; feeds it to the ORIGINAL statusline
# (preserving its output verbatim) and, detached + non-blocking, reports account rate_limits
# to the usage collector. Never delays or breaks the statusline.
CONF="${CLAUDE_USAGE_REPORTER_CONF:-$HOME/.claude/usage/usage-reporter.conf}"
WRAPPED=""
COLLECTOR="http://100.113.23.63:9421/report"
REPORTER="$HOME/.claude/usage/usage-report.js"
[ -f "$CONF" ] && . "$CONF"
INPUT=$(cat)
# 1) original statusline output first (fast path)
[ -n "$WRAPPED" ] && printf '%s' "$INPUT" | eval "$WRAPPED"
# 2) detached reporter (own session via setsid so statusline teardown can't kill it)
if command -v node >/dev/null 2>&1 && [ -f "$REPORTER" ]; then
  { printf '%s' "$INPUT" | setsid --fork env COLLECTOR="$COLLECTOR" node "$REPORTER" >/dev/null 2>&1; } &
fi
exit 0
