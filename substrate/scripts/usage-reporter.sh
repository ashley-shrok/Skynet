#!/bin/bash
# Claude Code statusLine wrapper. Reads stdin once; feeds it to the ORIGINAL statusline
# (preserving its output verbatim) and, detached + non-blocking, reports account rate_limits
# to the usage collector. Never delays or breaks the statusline.
CONF="${CLAUDE_USAGE_REPORTER_CONF:-$HOME/.claude/usage/usage-reporter.conf}"
WRAPPED=""
COLLECTOR="http://100.113.23.63:9421/report"
# Reporter ships via the fleet-substrate distributor (catalog slug: usage-report).
# Old boxes may still have a copy at ~/.claude/usage/usage-report.js — fall back to
# it so an out-of-order rollout (wrapper updates before install-usage-reporter reruns)
# doesn't silently stop reporting. install-usage-reporter.sh cleans up the legacy path.
REPORTER="$HOME/.local/bin/usage-report"
[ -x "$REPORTER" ] || REPORTER="$HOME/.claude/usage/usage-report.js"
[ -f "$CONF" ] && . "$CONF"
INPUT=$(cat)
# 1) original statusline output first (fast path)
[ -n "$WRAPPED" ] && printf '%s' "$INPUT" | eval "$WRAPPED"
# 2) detached reporter (own session via setsid so statusline teardown can't kill it)
if command -v node >/dev/null 2>&1 && [ -f "$REPORTER" ]; then
  { printf '%s' "$INPUT" | setsid --fork env COLLECTOR="$COLLECTOR" node "$REPORTER" >/dev/null 2>&1; } &
fi
exit 0
