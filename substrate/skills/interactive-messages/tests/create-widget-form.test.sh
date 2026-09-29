#!/usr/bin/env bash
# create-widget-form.test.sh — test harness for the form-terminal-on-submit template
#
# Runs in a temporary HOME (mktemp -d) to avoid polluting the real environment.
# Set SKIP_SYSTEMCTL=1 (default for this harness) to skip systemd enable/start
# and validate only the file scaffolding + arg parsing logic.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/create-widget-form.test.sh
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
    mkdir -p "$tmp/fleet/host"
    echo "42" > "$tmp/fleet/host/id"
    echo "https://test.example.com" > "$tmp/fleet/host/parent"
    echo "$tmp"
}

# ── Test 1: Happy path (mixed field types) ────────────────────────────────────

printf '\n=== Test 1: Happy path (mixed text + number + select) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug form-happy \
    --template form \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Config?" \
    --field "host:text" \
    --field "port:number" \
    --field "auth:select:password,ssh-key"

if [ "$ec" = "0" ]; then
    pass "happy path exits 0"
else
    fail "happy path: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_HTML="$FAKE_HOME/fleet/interactive-messages/form-happy/widget.html"
WIDGET_META="$FAKE_HOME/fleet/interactive-messages/form-happy/metadata.json"
UNIT_FILE="$FAKE_HOME/.config/systemd/user/im-form-happy.service"

# widget.html exists and has field names + options + prompt + slug + pane base
assert_file_exists "$WIDGET_HTML" "widget.html scaffolded"
assert_file_contains "$WIDGET_HTML" '"host"' "widget.html has field: host"
assert_file_contains "$WIDGET_HTML" '"port"' "widget.html has field: port"
assert_file_contains "$WIDGET_HTML" '"auth"' "widget.html has field: auth"
assert_file_contains "$WIDGET_HTML" '"password"' "widget.html has option: password"
assert_file_contains "$WIDGET_HTML" '"ssh-key"' "widget.html has option: ssh-key"
assert_file_contains "$WIDGET_HTML" '"Config?"' "widget.html has prompt substituted"
assert_file_contains "$WIDGET_HTML" 'form-happy' "widget.html has widget ID substituted"
assert_file_contains "$WIDGET_HTML" '/interactive/42/form-happy/pane' "widget.html has pane base substituted"

# widget.html has field type descriptors (from FIELDS JSON array)
assert_file_contains "$WIDGET_HTML" '"type":"text"' "widget.html has type:text field descriptor"
assert_file_contains "$WIDGET_HTML" '"type":"number"' "widget.html has type:number field descriptor"
assert_file_contains "$WIDGET_HTML" '"type":"select"' "widget.html has type:select field descriptor"

# no radio inputs
assert_file_not_contains "$WIDGET_HTML" 'type="radio"' "widget.html has ZERO type=radio occurrences"

# metadata.json has "template": "form" and fields array
assert_file_exists "$WIDGET_META" "metadata.json written"
assert_file_contains "$WIDGET_META" '"template": "form"' "metadata.json has template=form"
assert_file_contains "$WIDGET_META" '"fields"' "metadata.json has fields array"

# systemd unit file exists with port in 9601-9699
assert_file_exists "$UNIT_FILE" "systemd unit file created: im-form-happy.service"
if [ -f "$UNIT_FILE" ]; then
    PORT_VAL=$(grep '^Environment=PORT=' "$UNIT_FILE" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_VAL" ] && [ "$PORT_VAL" -ge 9601 ] && [ "$PORT_VAL" -le 9699 ]; then
        pass "unit file port $PORT_VAL is in range 9601-9699"
    else
        fail "unit file port '$PORT_VAL' is NOT in range 9601-9699"
    fi
fi

# stdout: SLUG= and URL=
if printf '%s' "$out" | grep -q "^SLUG=form-happy$"; then
    pass "stdout: SLUG=form-happy"
else
    fail "stdout missing SLUG=form-happy — got: $out"
fi
if printf '%s' "$out" | grep -q "^URL=https://test.example.com/interactive/42/form-happy/pane/$"; then
    pass "stdout: URL=/interactive/42/form-happy/pane/"
else
    fail "stdout missing URL — got: $out"
fi

rm -rf "$FAKE_HOME"

# ── Test 2: Missing --field ───────────────────────────────────────────────────

printf '\n=== Test 2: Missing --field (no fields at all) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug form-nofield \
    --template form \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Config?"

if [ "$ec" != "0" ]; then
    pass "missing --field: exits non-zero"
else
    fail "missing --field: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "\-\-field\|field"; then
    pass "missing --field: error message mentions --field"
else
    fail "missing --field: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 3: Invalid field type ────────────────────────────────────────────────

printf '\n=== Test 3: Invalid field type (blob) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug form-badtype \
    --template form \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Q?" \
    --field "x:blob"

if [ "$ec" != "0" ]; then
    pass "invalid type: exits non-zero"
else
    fail "invalid type: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qE "text\|number\|select|text|number|select"; then
    pass "invalid type: error mentions text|number|select"
else
    fail "invalid type: error does not mention valid types — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 4: Malformed field name (uppercase) ──────────────────────────────────

printf '\n=== Test 4: Malformed field name (uppercase) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug form-badname \
    --template form \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Q?" \
    --field "Host:text"

if [ "$ec" != "0" ]; then
    pass "uppercase field name: exits non-zero"
else
    fail "uppercase field name: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qiE "snake_case|lowercase|snake"; then
    pass "uppercase field name: error mentions snake_case or lowercase"
else
    fail "uppercase field name: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 5: Select without options ────────────────────────────────────────────

printf '\n=== Test 5: Select without options ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug form-selnoopt \
    --template form \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Q?" \
    --field "auth:select"

if [ "$ec" != "0" ]; then
    pass "select without options: exits non-zero"
else
    fail "select without options: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qiE "select requires|options"; then
    pass "select without options: error mentions 'select requires' or 'options'"
else
    fail "select without options: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 6: Select with one option ───────────────────────────────────────────

printf '\n=== Test 6: Select with one option (needs >=2) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug form-seloneopt \
    --template form \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Q?" \
    --field "auth:select:only-one"

if [ "$ec" != "0" ]; then
    pass "select one option: exits non-zero"
else
    fail "select one option: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qE ">=2|2|at least"; then
    pass "select one option: error mentions >=2 or 2 requirement"
else
    fail "select one option: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 7: Text with options (spurious third part) ───────────────────────────

printf '\n=== Test 7: Text field with spurious options ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug form-textopts \
    --template form \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Q?" \
    --field "host:text:foo,bar"

if [ "$ec" != "0" ]; then
    pass "text with options: exits non-zero"
else
    fail "text with options: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qiE "does not accept options|accept"; then
    pass "text with options: error mentions 'does not accept options'"
else
    fail "text with options: error unclear — got: $err"
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
