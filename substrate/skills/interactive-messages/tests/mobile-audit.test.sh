#!/usr/bin/env bash
# mobile-audit.test.sh — grep-audit of mobile-friendly patterns across all 12 templates
#
# Audits every SOURCE template widget.html in
#   substrate/skills/interactive-messages/templates/*/widget.html
# for the following invariants:
#
#   1. Viewport meta tag present (<meta name="viewport" ...>)
#   2. At least one 44px touch target (min-height: 44px on interactive element)
#   3. No horizontal-scroll hacks (overflow-x: auto|scroll)
#   4. postMessage origin discipline (never "*"; must use window.location.origin)
#   5. No streaming/polling markers (EventSource, WebSocket, setInterval)
#
# This is a grep-based audit — no scaffolding or temp HOME required.
# The templates directory is the source of truth being audited.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/mobile-audit.test.sh
#
# Exit 0 on all pass; exit 1 with failure summary on any failure.
# Accumulates failures across all checks (does NOT abort on first failure).

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TEMPLATES_DIR="$SCRIPT_DIR/../templates"

PASS=0
FAIL=0
FAILURES=""

# ── Test helpers ──────────────────────────────────────────────────────────────

pass() {
    PASS=$((PASS + 1))
    printf '  [PASS] %s\n' "$1"
}

fail() {
    FAIL=$((FAIL + 1))
    FAILURES="$FAILURES\n  [FAIL] $1"
    printf '  [FAIL] %s\n' "$1"
}

# assert_file_contains path pattern label
# Passes if grep -q finds pattern in path.
assert_file_contains() {
    local path="$1" pattern="$2" label="$3"
    if grep -q "$pattern" "$path" 2>/dev/null; then
        pass "$label"
    else
        fail "$label — pattern not found in $(basename "$path"): $pattern"
    fi
}

# assert_file_not_contains path pattern label
# Passes if grep finds zero occurrences of pattern in path.
assert_file_not_contains() {
    local path="$1" pattern="$2" label="$3"
    local count
    count=$(grep -c "$pattern" "$path" 2>/dev/null || true)
    if [ "$count" -eq 0 ]; then
        pass "$label"
    else
        fail "$label — found $count occurrence(s) of '$pattern' in $(basename "$path")"
    fi
}

# ── Discover templates ────────────────────────────────────────────────────────

# Collect all widget.html files from the templates directory.
# Use an array so the loop handles paths with spaces safely.
mapfile -t HTML_FILES < <(find "$TEMPLATES_DIR" -name 'widget.html' | sort)

TEMPLATE_COUNT="${#HTML_FILES[@]}"
if [ "$TEMPLATE_COUNT" -eq 0 ]; then
    printf 'ERROR: no widget.html files found under %s\n' "$TEMPLATES_DIR" >&2
    exit 1
fi

printf 'mobile-audit.test.sh: auditing %d template widget.html files\n' "$TEMPLATE_COUNT"

# ── Per-template audit ────────────────────────────────────────────────────────

for html in "${HTML_FILES[@]}"; do
    # Derive a short template name for labels (parent directory name)
    template=$(basename "$(dirname "$html")")

    printf '\n=== Template: %s ===\n' "$template"

    # ── Check 1: viewport meta present ───────────────────────────────────────
    assert_file_contains "$html" '<meta name="viewport"' \
        "${template}: viewport meta present"

    # ── Check 2: ≥44px touch target ──────────────────────────────────────────
    # At least one interactive element must declare min-height: 44px.
    if grep -qE 'min-height:\s*44px' "$html" 2>/dev/null; then
        pass "${template}: has min-height 44px on interactive element"
    else
        fail "${template}: has min-height 44px on interactive element — pattern not found: min-height: 44px"
    fi

    # ── Check 3: no horizontal-scroll hacks ──────────────────────────────────
    # overflow-x: auto|scroll papers over layout bugs; it must not appear.
    if grep -qE 'overflow-x:\s*(auto|scroll)' "$html" 2>/dev/null; then
        fail "${template}: no overflow-x hack — found overflow-x: auto|scroll"
    else
        pass "${template}: no overflow-x hack"
    fi

    # ── Check 4: postMessage origin discipline ────────────────────────────────
    # Non-terminal templates have zero postMessage calls (checked defensively).
    # Terminal templates must use window.location.origin, never "*".
    pm_count=$(grep -c 'postMessage(' "$html" 2>/dev/null || true)

    if [ "$pm_count" -gt 0 ]; then
        # (a) No wildcard origin: postMessage(anything, "*") or single-quote variant
        star_count=$(grep -cE "postMessage\(.*,\s*['\"]\\*['\"]" "$html" 2>/dev/null || true)
        if [ "$star_count" -eq 0 ]; then
            pass "${template}: postMessage never uses \"*\" origin"
        else
            fail "${template}: postMessage never uses \"*\" origin — found $star_count wildcard origin call(s)"
        fi

        # (b) Must use window.location.origin as the target
        if grep -qE 'window\.location\.origin' "$html" 2>/dev/null; then
            pass "${template}: postMessage uses window.location.origin"
        else
            fail "${template}: postMessage uses window.location.origin — window.location.origin not found"
        fi
    fi
    # Non-terminal templates (pm_count == 0): skip sub-assertions (b) — by design.

    # ── Check 5: no streaming/polling markers ─────────────────────────────────
    # Widgets render atomically; they must not use EventSource, WebSocket, or
    # setInterval (polling). setTimeout is permitted (retry-load-fail pattern
    # lives in WidgetBubble.tsx, outside widget.html; but widgets themselves
    # must not poll).

    # 5a: no EventSource (SSE client)
    es_count=$(grep -cE 'EventSource\(' "$html" 2>/dev/null || true)
    if [ "$es_count" -eq 0 ]; then
        pass "${template}: no EventSource"
    else
        fail "${template}: no EventSource — found $es_count EventSource() call(s)"
    fi

    # 5b: no WebSocket client
    ws_count=$(grep -cE 'new WebSocket\(' "$html" 2>/dev/null || true)
    if [ "$ws_count" -eq 0 ]; then
        pass "${template}: no WebSocket"
    else
        fail "${template}: no WebSocket — found $ws_count new WebSocket() call(s)"
    fi

    # 5c: no setInterval (polling loop)
    si_count=$(grep -cE 'setInterval\(' "$html" 2>/dev/null || true)
    if [ "$si_count" -eq 0 ]; then
        pass "${template}: no setInterval"
    else
        fail "${template}: no setInterval — found $si_count setInterval() call(s)"
    fi
done

# ── Summary ───────────────────────────────────────────────────────────────────

TOTAL=$((PASS + FAIL))
printf '\n=================================================\n'
printf 'mobile-audit.test.sh: %d/%d assertions passed\n' "$PASS" "$TOTAL"

if [ "$FAIL" -gt 0 ]; then
    printf '\nFailed assertions:%b\n' "$FAILURES"
    exit 1
fi

printf 'All assertions passed.\n'
exit 0
