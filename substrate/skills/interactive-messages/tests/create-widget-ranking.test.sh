#!/usr/bin/env bash
# create-widget-ranking.test.sh — test harness for the ranking-terminal-on-submit template
#
# Runs in a temporary HOME (mktemp -d) to avoid polluting the real environment.
# Set SKIP_SYSTEMCTL=1 (default for this harness) to skip systemd enable/start
# and validate only the file scaffolding + port claim logic.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/create-widget-ranking.test.sh
#
# Exit 0 on all pass, exit 1 with a summary on any failure.

set -uo pipefail

export SKIP_SYSTEMCTL=1

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CREATE_WIDGET="$SCRIPT_DIR/../create-widget.sh"

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

assert_file_exists() {
    local path="$1" label="$2"
    if [ -f "$path" ]; then
        pass "$label: $path exists"
    else
        fail "$label: $path does NOT exist"
    fi
}

assert_file_contains() {
    local path="$1" pattern="$2" label="$3"
    if grep -q "$pattern" "$path" 2>/dev/null; then
        pass "$label"
    else
        fail "$label — pattern not found in $path: $pattern"
    fi
}

# Run the script, capture stdout + stderr separately, capture exit code
run_script() {
    local out_var="$1" err_var="$2" ec_var="$3"
    shift 3
    local tmpout
    tmpout=$(mktemp)
    local tmperr
    tmperr=$(mktemp)
    local _ec=0
    "$CREATE_WIDGET" "$@" >"$tmpout" 2>"$tmperr" || _ec=$?
    eval "${out_var}=\$(cat \"\$tmpout\")"
    eval "${err_var}=\$(cat \"\$tmperr\")"
    eval "${ec_var}=\${_ec}"
    rm -f "$tmpout" "$tmperr"
}

# Set up a fresh fake HOME for each test group
new_home() {
    local tmp
    tmp=$(mktemp -d)
    mkdir -p "$tmp/fleet/interactive-messages"
    mkdir -p "$tmp/.config/systemd/user"
    mkdir -p "$tmp/fleet/host"
    echo "42" > "$tmp/fleet/host/id"
    echo "https://test.example.com" > "$tmp/fleet/host/parent"
    echo "$tmp"
}

# ── Test 1: Happy path (4 items) ──────────────────────────────────────────────

printf '\n=== Test 1: Happy path (4 items) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug rank-happy \
    --template ranking \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Order these?" \
    --items "alpha,beta,gamma,delta"

if [ "$ec" = "0" ]; then
    pass "happy path exits 0"
else
    fail "happy path: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_HTML="$FAKE_HOME/fleet/interactive-messages/rank-happy/widget.html"
WIDGET_META="$FAKE_HOME/fleet/interactive-messages/rank-happy/metadata.json"
WIDGET_UNIT="$FAKE_HOME/.config/systemd/user/im-rank-happy.service"

assert_file_exists "$WIDGET_HTML" "widget.html scaffolded"

# All four item labels substituted into widget.html
assert_file_contains "$WIDGET_HTML" '"alpha"' "widget.html contains alpha"
assert_file_contains "$WIDGET_HTML" '"beta"' "widget.html contains beta"
assert_file_contains "$WIDGET_HTML" '"gamma"' "widget.html contains gamma"
assert_file_contains "$WIDGET_HTML" '"delta"' "widget.html contains delta"
assert_file_contains "$WIDGET_HTML" "Order these?" "widget.html contains prompt"
assert_file_contains "$WIDGET_HTML" "rank-happy" "widget.html contains slug (widget ID)"
assert_file_contains "$WIDGET_HTML" "/interactive/42/rank-happy/pane" "widget.html contains pane base URL"

# Mobile mandate (shape file: "Ranking specifically renders both drag-handles and arrow buttons")
assert_file_contains "$WIDGET_HTML" "up-btn" "widget.html contains up-btn (mobile mandate)"
assert_file_contains "$WIDGET_HTML" "down-btn" "widget.html contains down-btn (mobile mandate)"

# Desktop drag mode
assert_file_contains "$WIDGET_HTML" "drag-handle" "widget.html contains drag-handle (desktop drag mode)"
assert_file_contains "$WIDGET_HTML" 'draggable="true"' 'widget.html has draggable="true" (HTML5 drag)'

# metadata.json correctness
assert_file_exists "$WIDGET_META" "metadata.json written"
assert_file_contains "$WIDGET_META" '"template": "ranking"' 'metadata.json template=ranking'
assert_file_contains "$WIDGET_META" '"alpha"' "metadata.json contains alpha in items"
assert_file_contains "$WIDGET_META" '"beta"' "metadata.json contains beta in items"
assert_file_contains "$WIDGET_META" '"gamma"' "metadata.json contains gamma in items"
assert_file_contains "$WIDGET_META" '"delta"' "metadata.json contains delta in items"

# systemd unit exists with port in range
assert_file_exists "$WIDGET_UNIT" "systemd unit file created"
if [ -f "$WIDGET_UNIT" ]; then
    PORT_VAL=$(grep '^Environment=PORT=' "$WIDGET_UNIT" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_VAL" ] && [ "$PORT_VAL" -ge 9601 ] && [ "$PORT_VAL" -le 9699 ]; then
        pass "unit file port $PORT_VAL is in range 9601-9699"
    else
        fail "unit file port '$PORT_VAL' is NOT in range 9601-9699"
    fi
fi

# stdout assertions
if printf '%s' "$out" | grep -q "^SLUG=rank-happy$"; then
    pass "stdout: SLUG=rank-happy"
else
    fail "stdout missing SLUG=rank-happy — got: $out"
fi
if printf '%s' "$out" | grep -q "^URL=https://test.example.com/interactive/42/rank-happy/pane/$"; then
    pass "stdout: URL=/interactive/42/rank-happy/pane/"
else
    fail "stdout missing URL line — got: $out"
fi

rm -rf "$FAKE_HOME"

# ── Test 2: Missing --items ────────────────────────────────────────────────────

printf '\n=== Test 2: Missing --items ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug rank-noitems \
    --template ranking \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Rank these?"

if [ "$ec" != "0" ]; then
    pass "missing --items: exits non-zero"
else
    fail "missing --items: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "\-\-items"; then
    pass "missing --items: error names --items"
else
    fail "missing --items: error message unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 3: Single item (must require at least 2) ─────────────────────────────

printf '\n=== Test 3: Single item (must require at least 2) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug rank-oneitem \
    --template ranking \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Rank?" \
    --items "just-one"

if [ "$ec" != "0" ]; then
    pass "single item: exits non-zero"
else
    fail "single item: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "at least 2"; then
    pass "single item: error mentions 'at least 2'"
else
    fail "single item: error missing 'at least 2' — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 4: Empty item in list ────────────────────────────────────────────────

printf '\n=== Test 4: Empty item in list ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug rank-emptyitem \
    --template ranking \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Rank?" \
    --items "a,,b"

if [ "$ec" != "0" ]; then
    pass "empty item: exits non-zero"
else
    fail "empty item: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "empty item"; then
    pass "empty item: error mentions 'empty item'"
else
    fail "empty item: error missing 'empty item' — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 5: Custom submit label ────────────────────────────────────────────────

printf '\n=== Test 5: Custom submit label ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug rank-customlabel \
    --template ranking \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Order?" \
    --items "a,b" \
    --submit-label "Confirm order"

if [ "$ec" = "0" ]; then
    pass "custom submit label: exits 0"
else
    fail "custom submit label: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_HTML="$FAKE_HOME/fleet/interactive-messages/rank-customlabel/widget.html"
assert_file_contains "$WIDGET_HTML" '"Confirm order"' 'widget.html contains JSON-encoded custom submit label'

rm -rf "$FAKE_HOME"

# ── Test 6: Mobile-mandate assertion (from shape file) ────────────────────────
#
# Shape file mandate: "Ranking specifically renders both drag-handles and arrow
# buttons so it works on every input mode." (shape-interactive-messages.md)
#
# This test re-runs the happy path and explicitly asserts BOTH up-btn and
# down-btn are present in the scaffolded widget.html — one assertion per button
# direction — to make this mandate mechanically verifiable on every run.

printf '\n=== Test 6: Mobile-mandate assertion (shape-file requirement) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug rank-mobile \
    --template ranking \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Mandate check?" \
    --items "x,y,z"

if [ "$ec" = "0" ]; then
    pass "mobile mandate scaffold: exits 0"
else
    fail "mobile mandate scaffold: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_HTML="$FAKE_HOME/fleet/interactive-messages/rank-mobile/widget.html"

# Shape-file mandate: up-btn (move-up arrow button for touch / mobile users)
if grep -q "up-btn" "$WIDGET_HTML" 2>/dev/null; then
    pass "mobile mandate: up-btn (move-up arrow) present in scaffolded widget.html"
else
    fail "mobile mandate VIOLATION: up-btn missing from scaffolded widget.html — shape file requires both drag-handles and arrow buttons"
fi

# Shape-file mandate: down-btn (move-down arrow button for touch / mobile users)
if grep -q "down-btn" "$WIDGET_HTML" 2>/dev/null; then
    pass "mobile mandate: down-btn (move-down arrow) present in scaffolded widget.html"
else
    fail "mobile mandate VIOLATION: down-btn missing from scaffolded widget.html — shape file requires both drag-handles and arrow buttons"
fi

# Also assert drag-handle is present (desktop drag mode must coexist with arrows)
if grep -q "drag-handle" "$WIDGET_HTML" 2>/dev/null; then
    pass "mobile mandate: drag-handle present (desktop drag coexists with arrow fallback)"
else
    fail "mobile mandate: drag-handle missing from scaffolded widget.html"
fi

rm -rf "$FAKE_HOME"

# ── Summary ───────────────────────────────────────────────────────────────────

printf '\n=================================================\n'
printf 'PASS: %d tests passed, %d failed\n' "$PASS" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
    printf '\nFailed tests:%b\n' "$FAILURES"
    exit 1
fi

printf 'All ranking template tests passed.\n'
exit 0
