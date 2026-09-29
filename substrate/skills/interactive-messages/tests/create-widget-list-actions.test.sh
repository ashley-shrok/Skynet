#!/usr/bin/env bash
# create-widget-list-actions.test.sh — test harness for the list-actions-terminal-on-submit template
#
# Runs in a temporary HOME (mktemp -d) to avoid polluting the real environment.
# Set SKIP_SYSTEMCTL=1 (default for this harness) to skip systemd enable/start
# and validate only the file scaffolding + arg parsing logic.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/create-widget-list-actions.test.sh
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

# ── Setup a fresh fake HOME ───────────────────────────────────────────────────

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

# ── Test 1: Happy path (string items) ────────────────────────────────────────

printf '\n=== Test 1: Happy path (string items) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug la-happy \
    --template list-actions \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Review these?" \
    --items '["PR #101","PR #102","PR #103"]' \
    --actions "Merge,Skip,Comment"

if [ "$ec" = "0" ]; then
    pass "happy path exits 0"
else
    fail "happy path: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_HTML="$FAKE_HOME/fleet/interactive-messages/la-happy/widget.html"
WIDGET_META="$FAKE_HOME/fleet/interactive-messages/la-happy/metadata.json"
UNIT_FILE="$FAKE_HOME/.config/systemd/user/im-la-happy.service"

assert_file_exists "$WIDGET_HTML" "widget.html scaffolded"
assert_file_exists "$WIDGET_META" "metadata.json written"
assert_file_exists "$UNIT_FILE" "systemd unit file created: im-la-happy.service"

# widget.html contains all item labels and action names
assert_file_contains "$WIDGET_HTML" '"PR #101"' "widget.html has item: PR #101"
assert_file_contains "$WIDGET_HTML" '"PR #102"' "widget.html has item: PR #102"
assert_file_contains "$WIDGET_HTML" '"PR #103"' "widget.html has item: PR #103"
assert_file_contains "$WIDGET_HTML" '"Merge"' "widget.html has action: Merge"
assert_file_contains "$WIDGET_HTML" '"Skip"' "widget.html has action: Skip"
assert_file_contains "$WIDGET_HTML" '"Comment"' "widget.html has action: Comment"
assert_file_contains "$WIDGET_HTML" '"Review these?"' "widget.html has prompt substituted"
assert_file_contains "$WIDGET_HTML" 'la-happy' "widget.html has widget ID substituted"
assert_file_contains "$WIDGET_HTML" '/interactive/42/la-happy/pane' "widget.html has pane base substituted"

# Both button classes present (distinct visual types)
assert_file_contains "$WIDGET_HTML" 'done-btn' "widget.html has done-btn class (widget-level Done button)"
assert_file_contains "$WIDGET_HTML" 'action-btn' "widget.html has action-btn class (per-row buttons)"

# metadata.json contains list-actions template and actions array
assert_file_contains "$WIDGET_META" '"template": "list-actions"' "metadata.json has template=list-actions"
assert_file_contains "$WIDGET_META" '"actions"' "metadata.json has actions key"
assert_file_contains "$WIDGET_META" '"Merge"' "metadata.json has action: Merge"
assert_file_contains "$WIDGET_META" '"Skip"' "metadata.json has action: Skip"
assert_file_contains "$WIDGET_META" '"Comment"' "metadata.json has action: Comment"

# systemd unit port in range 9601-9699
if [ -f "$UNIT_FILE" ]; then
    PORT_VAL=$(grep '^Environment=PORT=' "$UNIT_FILE" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_VAL" ] && [ "$PORT_VAL" -ge 9601 ] && [ "$PORT_VAL" -le 9699 ]; then
        pass "unit file port $PORT_VAL is in range 9601-9699"
    else
        fail "unit file port '$PORT_VAL' is NOT in range 9601-9699"
    fi
fi

# stdout: SLUG= and URL=
if printf '%s' "$out" | grep -q "^SLUG=la-happy$"; then
    pass "stdout: SLUG=la-happy"
else
    fail "stdout missing SLUG=la-happy — got: $out"
fi
if printf '%s' "$out" | grep -q "^URL=https://test.example.com/interactive/42/la-happy/pane/$"; then
    pass "stdout: URL=/interactive/42/la-happy/pane/"
else
    fail "stdout missing URL — got: $out"
fi

rm -rf "$FAKE_HOME"

# ── Test 2: Happy path (object items with label field) ────────────────────────

printf '\n=== Test 2: Happy path (object items with label field) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug la-objitems \
    --template list-actions \
    --message-id "m2" \
    --conversation-id "c2" \
    --prompt "Approve or reject?" \
    --items '[{"label":"Alpha","meta":"x"},{"label":"Beta","meta":"y"}]' \
    --actions "Approve,Reject"

if [ "$ec" = "0" ]; then
    pass "object items: exits 0"
else
    fail "object items: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_HTML="$FAKE_HOME/fleet/interactive-messages/la-objitems/widget.html"
assert_file_exists "$WIDGET_HTML" "object items: widget.html scaffolded"
assert_file_contains "$WIDGET_HTML" '"Alpha"' "object items: widget.html has label Alpha"
assert_file_contains "$WIDGET_HTML" '"Beta"' "object items: widget.html has label Beta"
assert_file_contains "$WIDGET_HTML" '"Approve"' "object items: widget.html has action Approve"
assert_file_contains "$WIDGET_HTML" '"Reject"' "object items: widget.html has action Reject"

rm -rf "$FAKE_HOME"

# ── Test 3: Missing --items ───────────────────────────────────────────────────

printf '\n=== Test 3: Missing --items ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug la-noitems \
    --template list-actions \
    --message-id "m3" \
    --conversation-id "c3" \
    --prompt "Test?" \
    --actions "a,b"

if [ "$ec" != "0" ]; then
    pass "missing --items: exits non-zero"
else
    fail "missing --items: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "\-\-items\|items"; then
    pass "missing --items: error message mentions --items"
else
    fail "missing --items: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 4: Malformed --items JSON ───────────────────────────────────────────

printf '\n=== Test 4: Malformed --items JSON ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug la-badjson \
    --template list-actions \
    --message-id "m4" \
    --conversation-id "c4" \
    --prompt "Test?" \
    --items 'not-json' \
    --actions "a,b"

if [ "$ec" != "0" ]; then
    pass "malformed JSON: exits non-zero"
else
    fail "malformed JSON: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qiE "JSON|valid JSON array"; then
    pass "malformed JSON: error mentions JSON or valid JSON array"
else
    fail "malformed JSON: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 5: Empty --items array ───────────────────────────────────────────────

printf '\n=== Test 5: Empty --items array ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug la-emptyitems \
    --template list-actions \
    --message-id "m5" \
    --conversation-id "c5" \
    --prompt "Test?" \
    --items '[]' \
    --actions "a,b"

if [ "$ec" != "0" ]; then
    pass "empty items: exits non-zero"
else
    fail "empty items: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "at least 1"; then
    pass "empty items: error mentions at least 1"
else
    fail "empty items: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 6: Invalid item shape (non-string, no label) ────────────────────────

printf '\n=== Test 6: Invalid item shape ({foo: bar} — no label field) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug la-badshape \
    --template list-actions \
    --message-id "m6" \
    --conversation-id "c6" \
    --prompt "Test?" \
    --items '[{"foo":"bar"}]' \
    --actions "a"

if [ "$ec" != "0" ]; then
    pass "invalid item shape: exits non-zero"
else
    fail "invalid item shape: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qiE "strings or|label"; then
    pass "invalid item shape: error mentions strings or label"
else
    fail "invalid item shape: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 7: Missing --actions ─────────────────────────────────────────────────

printf '\n=== Test 7: Missing --actions ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug la-noactions \
    --template list-actions \
    --message-id "m7" \
    --conversation-id "c7" \
    --prompt "Test?" \
    --items '["x"]'

if [ "$ec" != "0" ]; then
    pass "missing --actions: exits non-zero"
else
    fail "missing --actions: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "\-\-actions\|actions"; then
    pass "missing --actions: error message mentions --actions"
else
    fail "missing --actions: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 8: Empty --actions ───────────────────────────────────────────────────

printf '\n=== Test 8: Empty --actions ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug la-emptyactions \
    --template list-actions \
    --message-id "m8" \
    --conversation-id "c8" \
    --prompt "Test?" \
    --items '["x"]' \
    --actions ""

if [ "$ec" != "0" ]; then
    pass "empty --actions: exits non-zero"
else
    fail "empty --actions: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qiE "at least 1|empty|required"; then
    pass "empty --actions: error mentions at least 1 or empty or required"
else
    fail "empty --actions: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Summary ───────────────────────────────────────────────────────────────────

printf '\n=================================================\n'
printf 'PASS: %d, FAIL: %d\n' "$PASS" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
    printf '\nFailed tests:%b\n' "$FAILURES"
    exit 1
fi

printf 'All tests passed.\n'
exit 0
