#!/usr/bin/env bash
# create-widget-checklist.test.sh — test harness for the checklist template
#
# Runs in a temporary HOME (mktemp -d) to avoid polluting the real environment.
# SKIP_SYSTEMCTL=1 skips systemd enable/start so the test only validates file
# scaffolding + substitution output.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/create-widget-checklist.test.sh
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

assert_file_not_contains() {
    local path="$1" pattern="$2" label="$3"
    if ! grep -q "$pattern" "$path" 2>/dev/null; then
        pass "$label"
    else
        fail "$label — unexpected pattern found in $path: $pattern"
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

# ── Setup a fresh fake HOME for each test group ───────────────────────────────

new_home() {
    local tmp
    tmp=$(mktemp -d)
    mkdir -p "$tmp/fleet/interactive-messages"
    mkdir -p "$tmp/.config/systemd/user"
    mkdir -p "$tmp/.claude"
    echo "42" > "$tmp/.claude/skynet-hostid"
    echo "$tmp"
}

# ── Test 1: Happy path (flag form) ────────────────────────────────────────────

printf '\n=== Test 1: Checklist happy path (flag form) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cl-happy \
    --template checklist \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Which to keep?" \
    --options "logs,cache,tmp"

if [ "$ec" = "0" ]; then
    pass "happy path: exits 0"
else
    fail "happy path: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_DIR="$FAKE_HOME/fleet/interactive-messages/cl-happy"

# Core files exist
assert_file_exists "$WIDGET_DIR/widget.html" "widget.html scaffolded"
assert_file_exists "$WIDGET_DIR/server.py"   "server.py scaffolded"
assert_file_exists "$WIDGET_DIR/metadata.json" "metadata.json written"

# widget.html has options substituted
assert_file_contains "$WIDGET_DIR/widget.html" '"logs"' 'widget.html: "logs" present'
assert_file_contains "$WIDGET_DIR/widget.html" '"cache"' 'widget.html: "cache" present'
assert_file_contains "$WIDGET_DIR/widget.html" '"tmp"' 'widget.html: "tmp" present'

# widget.html has prompt substituted
assert_file_contains "$WIDGET_DIR/widget.html" 'Which to keep?' 'widget.html: prompt substituted'

# widget.html has widget id substituted
assert_file_contains "$WIDGET_DIR/widget.html" 'cl-happy' 'widget.html: widget id substituted'

# widget.html has pane base substituted
assert_file_contains "$WIDGET_DIR/widget.html" '/interactive/42/cl-happy/pane' 'widget.html: pane base substituted'

# widget.html has checkboxes (type="checkbox" — from comment + JS pattern)
CB_COUNT=$(grep -c 'type="checkbox"' "$WIDGET_DIR/widget.html" || true)
if [ "$CB_COUNT" -ge 1 ]; then
    pass "widget.html: type=\"checkbox\" present ($CB_COUNT occurrences)"
else
    fail "widget.html: type=\"checkbox\" not found (count=$CB_COUNT)"
fi

# widget.html has NO radio inputs (affordance rule)
RADIO_COUNT=$(grep -c 'type="radio"' "$WIDGET_DIR/widget.html" || true)
if [ "$RADIO_COUNT" -eq 0 ]; then
    pass "widget.html: no type=\"radio\" (affordance rule satisfied)"
else
    fail "widget.html: found type=\"radio\" — affordance rule violated (count=$RADIO_COUNT)"
fi

# metadata.json has correct template and options
assert_file_contains "$WIDGET_DIR/metadata.json" '"template": "checklist"' 'metadata.json: template=checklist'
assert_file_contains "$WIDGET_DIR/metadata.json" '"logs"' 'metadata.json: logs in options'
assert_file_contains "$WIDGET_DIR/metadata.json" '"cache"' 'metadata.json: cache in options'
assert_file_contains "$WIDGET_DIR/metadata.json" '"tmp"' 'metadata.json: tmp in options'

# systemd unit exists with port in 9601-9699
UNIT_FILE="$FAKE_HOME/.config/systemd/user/im-cl-happy.service"
assert_file_exists "$UNIT_FILE" "systemd unit created"
if [ -f "$UNIT_FILE" ]; then
    PORT_VAL=$(grep '^Environment=PORT=' "$UNIT_FILE" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_VAL" ] && [ "$PORT_VAL" -ge 9601 ] && [ "$PORT_VAL" -le 9699 ]; then
        pass "unit file port $PORT_VAL is in range 9601-9699"
    else
        fail "unit file port '$PORT_VAL' is NOT in range 9601-9699"
    fi
fi

# server.py forces template discriminator
assert_file_contains "$WIDGET_DIR/server.py" '"checklist"' 'server.py: template=checklist discriminator preserved'

# stdout has SLUG and URL
if printf '%s' "$out" | grep -q "^SLUG=cl-happy$"; then
    pass "stdout: SLUG=cl-happy"
else
    fail "stdout: missing SLUG=cl-happy — got: $out"
fi
if printf '%s' "$out" | grep -q "^URL=/interactive/42/cl-happy/pane/$"; then
    pass "stdout: URL=/interactive/42/cl-happy/pane/"
else
    fail "stdout: missing URL line — got: $out"
fi

rm -rf "$FAKE_HOME"

# ── Test 2: Missing --options ─────────────────────────────────────────────────

printf '\n=== Test 2: Missing --options ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cl-no-opts \
    --template checklist \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Pick one"

if [ "$ec" != "0" ]; then
    pass "missing --options: exits non-zero"
else
    fail "missing --options: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "\-\-options"; then
    pass "missing --options: error names --options"
else
    fail "missing --options: error does not name --options — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 3: Fewer than 2 options ──────────────────────────────────────────────

printf '\n=== Test 3: Fewer than 2 options ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cl-one-opt \
    --template checklist \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Pick?" \
    --options "just-one"

if [ "$ec" != "0" ]; then
    pass "single option: exits non-zero"
else
    fail "single option: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "at least 2\|at least two"; then
    pass "single option: error mentions 'at least 2'"
else
    fail "single option: error does not mention 'at least 2' — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 4: Custom submit label ───────────────────────────────────────────────

printf '\n=== Test 4: Custom submit label ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cl-custom-label \
    --template checklist \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Pick files to delete" \
    --options "a,b" \
    --submit-label "Delete {N} items"

if [ "$ec" = "0" ]; then
    pass "custom submit label: exits 0"
else
    fail "custom submit label: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_DIR="$FAKE_HOME/fleet/interactive-messages/cl-custom-label"
# widget.html should contain the submit label template (either raw or JSON-encoded)
if grep -q 'Delete {N} items' "$WIDGET_DIR/widget.html" 2>/dev/null || \
   grep -q 'Delete \\{N\\} items\|Delete.*N.*items' "$WIDGET_DIR/widget.html" 2>/dev/null; then
    pass "custom submit label: label text appears in widget.html"
else
    # Check for JSON-encoded form: "Delete {N} items"
    if grep -q '"Delete {N} items"' "$WIDGET_DIR/widget.html" 2>/dev/null; then
        pass "custom submit label: JSON-encoded label appears in widget.html"
    else
        fail "custom submit label: label not found in widget.html"
    fi
fi

rm -rf "$FAKE_HOME"

# ── Test 5: Invalid submit label (missing {N}) ────────────────────────────────

printf '\n=== Test 5: Invalid submit label — missing {N} ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cl-bad-label \
    --template checklist \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Pick?" \
    --options "a,b" \
    --submit-label "Delete"

if [ "$ec" != "0" ]; then
    pass "invalid submit label: exits non-zero"
else
    fail "invalid submit label: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -q '{N}'; then
    pass "invalid submit label: error mentions {N}"
else
    fail "invalid submit label: error does not mention {N} — got: $err"
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
