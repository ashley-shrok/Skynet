#!/usr/bin/env bash
# create-widget-poll-non-terminal.test.sh — end-to-end scaffold test for the poll-non-terminal template
#
# Phase 139: interactive-messages non-terminal mode variants
#
# Runs in a temporary HOME (mktemp -d) to avoid polluting the real environment.
# SKIP_SYSTEMCTL=1 skips systemd enable/start so the test only validates file
# scaffolding + substitution output.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/create-widget-poll-non-terminal.test.sh
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

# ── Test 1: Happy path ────────────────────────────────────────────────────────

printf '\n=== Test 1: poll-non-terminal happy path ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug pn-happy \
    --template poll \
    --mode non-terminal \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Which region?" \
    --options "us-east,eu-west,ap-south"

if [ "$ec" = "0" ]; then
    pass "happy path: exits 0"
else
    fail "happy path: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_DIR="$FAKE_HOME/fleet/interactive-messages/pn-happy"

# Core files exist
assert_file_exists "$WIDGET_DIR/widget.html" "widget.html scaffolded"
assert_file_exists "$WIDGET_DIR/server.py"   "server.py scaffolded"
assert_file_exists "$WIDGET_DIR/metadata.json" "metadata.json written"

# widget.html: prompt substituted
assert_file_contains "$WIDGET_DIR/widget.html" "Which region?" "widget.html: prompt substituted"

# widget.html: options substituted
assert_file_contains "$WIDGET_DIR/widget.html" '"us-east"' 'widget.html: us-east option present'
assert_file_contains "$WIDGET_DIR/widget.html" '"eu-west"' 'widget.html: eu-west option present'
assert_file_contains "$WIDGET_DIR/widget.html" '"ap-south"' 'widget.html: ap-south option present'

# widget.html: passive-radio affordance
assert_file_contains "$WIDGET_DIR/widget.html" 'type="radio"' 'widget.html: type="radio" present (passive affordance)'

# widget.html: POSTs to /update
assert_file_contains "$WIDGET_DIR/widget.html" '/update' 'widget.html: POSTs to /update'

# widget.html: ZERO occurrences of the postMessage function call string
POSTMSG_COUNT=$(grep -c 'postMessage' "$WIDGET_DIR/widget.html" || true)
if [ "$POSTMSG_COUNT" -eq 0 ]; then
    pass "widget.html: zero postMessage occurrences (non-terminal invariant)"
else
    fail "widget.html: found $POSTMSG_COUNT postMessage occurrences — must be 0"
fi

# widget.html: no window.parent
assert_file_not_contains "$WIDGET_DIR/widget.html" 'window.parent' 'widget.html: no window.parent (defense-in-depth)'

# widget.html: no submit button
assert_file_not_contains "$WIDGET_DIR/widget.html" 'submit-btn' 'widget.html: no submit-btn'
assert_file_not_contains "$WIDGET_DIR/widget.html" 'done-btn' 'widget.html: no done-btn'

# widget.html: uses updated_at, no submitted_at
assert_file_contains "$WIDGET_DIR/widget.html" 'updated_at' 'widget.html: uses updated_at'
assert_file_not_contains "$WIDGET_DIR/widget.html" 'submitted_at' 'widget.html: no submitted_at'

# widget.html: no /submit endpoint reference
assert_file_not_contains "$WIDGET_DIR/widget.html" '/submit' 'widget.html: no /submit reference'

# server.py: has /update, no /submit
assert_file_contains "$WIDGET_DIR/server.py" '/update' 'server.py: /update endpoint present'
assert_file_not_contains "$WIDGET_DIR/server.py" '/submit' 'server.py: no /submit endpoint'

# server.py: forces template discriminator
assert_file_contains "$WIDGET_DIR/server.py" '"poll"' 'server.py: template=poll discriminator forced'

# metadata.json: correct shape
assert_file_contains "$WIDGET_DIR/metadata.json" '"template": "poll"' 'metadata.json: template=poll'
assert_file_contains "$WIDGET_DIR/metadata.json" '"mode": "non-terminal"' 'metadata.json: mode=non-terminal'
assert_file_contains "$WIDGET_DIR/metadata.json" '"us-east"' 'metadata.json: us-east in options'
assert_file_contains "$WIDGET_DIR/metadata.json" '"eu-west"' 'metadata.json: eu-west in options'
assert_file_contains "$WIDGET_DIR/metadata.json" '"ap-south"' 'metadata.json: ap-south in options'

# systemd unit exists with port in 9601-9699
UNIT_FILE="$FAKE_HOME/.config/systemd/user/im-pn-happy.service"
assert_file_exists "$UNIT_FILE" "systemd unit created"
if [ -f "$UNIT_FILE" ]; then
    PORT_VAL=$(grep '^Environment=PORT=' "$UNIT_FILE" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_VAL" ] && [ "$PORT_VAL" -ge 9601 ] && [ "$PORT_VAL" -le 9699 ]; then
        pass "unit file port $PORT_VAL is in range 9601-9699"
    else
        fail "unit file port '$PORT_VAL' is NOT in range 9601-9699"
    fi
fi

# stdout: SLUG and URL
if printf '%s' "$out" | grep -q "^SLUG=pn-happy$"; then
    pass "stdout: SLUG=pn-happy"
else
    fail "stdout: missing SLUG=pn-happy — got: $out"
fi
if printf '%s' "$out" | grep -q "^URL=/interactive/42/pn-happy/pane/$"; then
    pass "stdout: URL=/interactive/42/pn-happy/pane/"
else
    fail "stdout: missing URL line — got: $out"
fi

rm -rf "$FAKE_HOME"

# ── Test 2: --mode omitted → falls back to terminal-on-click (regression) ────

printf '\n=== Test 2: --mode omitted falls back to terminal-on-click (regression) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug pn-default \
    --template poll \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Default mode?" \
    --options "yes,no"

if [ "$ec" = "0" ]; then
    pass "default mode fallback: exits 0"
else
    fail "default mode fallback: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_DIR="$FAKE_HOME/fleet/interactive-messages/pn-default"

# The terminal-on-click template uses buttons and fires postMessage — proving
# that non-terminal is only reached via explicit --mode non-terminal.
assert_file_contains "$WIDGET_DIR/widget.html" 'postMessage' 'default mode widget.html: has postMessage (terminal-on-click affordance)'
assert_file_contains "$WIDGET_DIR/widget.html" '.btn' 'default mode widget.html: has .btn (button affordance)'

# And it does NOT have radio selectors
assert_file_not_contains "$WIDGET_DIR/widget.html" 'type="radio"' 'default mode widget.html: no radio inputs (correct terminal affordance)'

rm -rf "$FAKE_HOME"

# ── Test 3: Missing --prompt ──────────────────────────────────────────────────

printf '\n=== Test 3: Missing --prompt ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug pn-no-prompt \
    --template poll \
    --mode non-terminal \
    --message-id "m1" \
    --conversation-id "c1" \
    --options "a,b"

if [ "$ec" != "0" ]; then
    pass "missing --prompt: exits non-zero"
else
    fail "missing --prompt: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "\-\-prompt"; then
    pass "missing --prompt: error names --prompt"
else
    fail "missing --prompt: error does not name --prompt — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 4: Missing --options ─────────────────────────────────────────────────

printf '\n=== Test 4: Missing --options ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug pn-no-opts \
    --template poll \
    --mode non-terminal \
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

# ── Test 5: Fewer than 2 options ──────────────────────────────────────────────

printf '\n=== Test 5: Fewer than 2 options ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug pn-one-opt \
    --template poll \
    --mode non-terminal \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Pick?" \
    --options "only-one"

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

# ── Summary ───────────────────────────────────────────────────────────────────

printf '\n=================================================\n'
printf 'PASS: %d, FAIL: %d\n' "$PASS" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
    printf '\nFailed tests:%b\n' "$FAILURES"
    exit 1
fi

printf 'All tests passed.\n'
exit 0
