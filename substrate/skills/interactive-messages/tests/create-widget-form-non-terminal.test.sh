#!/usr/bin/env bash
# create-widget-form-non-terminal.test.sh — test harness for the form-non-terminal template
#
# Runs in a temporary HOME (mktemp -d) to avoid polluting the real environment.
# Set SKIP_SYSTEMCTL=1 (default for this harness) to skip systemd enable/start
# and validate only the file scaffolding + arg parsing logic.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/create-widget-form-non-terminal.test.sh
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

# ── Test 1: Happy path (mixed field types) ────────────────────────────────────

printf '\n=== Test 1: Happy path (mixed text + number + select, --mode non-terminal) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug form-nt \
    --template form \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Config" \
    --field "name:text" \
    --field "count:number" \
    --field "level:select:low,medium,high"

if [ "$ec" = "0" ]; then
    pass "happy path exits 0"
else
    fail "happy path: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_HTML="$FAKE_HOME/fleet/interactive-messages/form-nt/widget.html"
WIDGET_META="$FAKE_HOME/fleet/interactive-messages/form-nt/metadata.json"
SERVER_PY="$FAKE_HOME/fleet/interactive-messages/form-nt/server.py"

# widget.html exists and has prompt + all fields (field names appear in FIELDS JSON array)
assert_file_exists "$WIDGET_HTML" "widget.html scaffolded"
assert_file_contains "$WIDGET_HTML" '"Config"' "widget.html has prompt substituted"
assert_file_contains "$WIDGET_HTML" '"name": "name"' "widget.html FIELDS JSON has field: name"
assert_file_contains "$WIDGET_HTML" '"name": "count"' "widget.html FIELDS JSON has field: count"
assert_file_contains "$WIDGET_HTML" '"name": "level"' "widget.html FIELDS JSON has field: level"

# widget.html FIELDS JSON has all three field types
assert_file_contains "$WIDGET_HTML" '"type": "text"' "widget.html FIELDS JSON has type:text"
assert_file_contains "$WIDGET_HTML" '"type": "number"' "widget.html FIELDS JSON has type:number"
assert_file_contains "$WIDGET_HTML" '"type": "select"' "widget.html FIELDS JSON has type:select"

# widget.html has /update and NOT /submit
assert_file_contains "$WIDGET_HTML" '/update' "widget.html has /update endpoint"
assert_file_not_contains "$WIDGET_HTML" '/submit' "widget.html has ZERO /submit occurrences"

# widget.html has NO submit button, NO postMessage, NO window.parent
assert_file_not_contains "$WIDGET_HTML" 'submit-btn' "widget.html has ZERO submit-btn occurrences"
assert_file_not_contains "$WIDGET_HTML" 'postMessage' "widget.html has ZERO postMessage occurrences"
assert_file_not_contains "$WIDGET_HTML" 'window.parent' "widget.html has ZERO window.parent occurrences"

# widget.html has updated_at and NOT submitted_at
assert_file_contains "$WIDGET_HTML" 'updated_at' "widget.html has updated_at"
assert_file_not_contains "$WIDGET_HTML" 'submitted_at' "widget.html has ZERO submitted_at occurrences"

# widget.html has debouncing (scheduleSave or setTimeout or debounce)
if grep -qE 'scheduleSave|setTimeout|debounce' "$WIDGET_HTML" 2>/dev/null; then
    pass "widget.html has debouncing marker (scheduleSave/setTimeout/debounce)"
else
    fail "widget.html missing debouncing marker — no scheduleSave/setTimeout/debounce found"
fi

# server.py has /update and NOT /submit
assert_file_exists "$SERVER_PY" "server.py scaffolded"
assert_file_contains "$SERVER_PY" '/update' "server.py has /update endpoint"
assert_file_not_contains "$SERVER_PY" '/submit' "server.py has ZERO /submit occurrences"

# metadata.json has template=form, mode=non-terminal, and 3-entry fields array
assert_file_exists "$WIDGET_META" "metadata.json written"
assert_file_contains "$WIDGET_META" '"template": "form"' "metadata.json has template=form"
assert_file_contains "$WIDGET_META" '"mode": "non-terminal"' "metadata.json has mode=non-terminal"
assert_file_contains "$WIDGET_META" '"fields"' "metadata.json has fields key"

# metadata.json has 3 field entries (by counting "name" keys inside the fields array)
FIELD_NAME_COUNT=$(grep -c '"name"' "$WIDGET_META" 2>/dev/null || echo "0")
if [ "$FIELD_NAME_COUNT" -ge 3 ]; then
    pass "metadata.json has 3 field entries (name count: $FIELD_NAME_COUNT)"
else
    fail "metadata.json has fewer than 3 field entries (name count: $FIELD_NAME_COUNT)"
fi

# metadata.json does NOT have submit_label
assert_file_not_contains "$WIDGET_META" 'submit_label' "metadata.json has ZERO submit_label occurrences"

rm -rf "$FAKE_HOME"

# ── Test 2: --submit-label is rejected ───────────────────────────────────────

printf '\n=== Test 2: --submit-label is rejected ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug form-nt-sl \
    --template form \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Config" \
    --field "name:text" \
    --submit-label "Save"

if [ "$ec" != "0" ]; then
    pass "--submit-label rejected: exits non-zero"
else
    fail "--submit-label rejected: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi '\-\-submit-label'; then
    pass "--submit-label rejected: error mentions --submit-label"
else
    fail "--submit-label rejected: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 3: Missing --prompt ──────────────────────────────────────────────────

printf '\n=== Test 3: Missing --prompt ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug form-nt-noprompt \
    --template form \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --field "name:text"

if [ "$ec" != "0" ]; then
    pass "missing --prompt: exits non-zero"
else
    fail "missing --prompt: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi '\-\-prompt\|prompt'; then
    pass "missing --prompt: error mentions --prompt"
else
    fail "missing --prompt: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 4: No --field passed ─────────────────────────────────────────────────

printf '\n=== Test 4: No --field passed ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug form-nt-nofield \
    --template form \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Config"

if [ "$ec" != "0" ]; then
    pass "no --field: exits non-zero"
else
    fail "no --field: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qiE 'at least one.*--field|--field.*required|field'; then
    pass "no --field: error mentions at least one --field"
else
    fail "no --field: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 5: Invalid --field spec (bad type) ───────────────────────────────────

printf '\n=== Test 5: Invalid --field spec (bad type) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug form-nt-badtype \
    --template form \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Config" \
    --field "name:bogus"

if [ "$ec" != "0" ]; then
    pass "invalid field type: exits non-zero"
else
    fail "invalid field type: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qE "text\|number\|select|text|number|select"; then
    pass "invalid field type: error mentions text|number|select"
else
    fail "invalid field type: error does not mention valid types — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 6: Invalid --field spec (select with <2 options) ────────────────────

printf '\n=== Test 6: Invalid --field spec (select with fewer than 2 options) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug form-nt-selone \
    --template form \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Config" \
    --field "level:select:only"

if [ "$ec" != "0" ]; then
    pass "select with <2 options: exits non-zero"
else
    fail "select with <2 options: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qE ">=2|at least 2|at least two|options"; then
    pass "select with <2 options: error mentions >=2 / 'at least 2' / options"
else
    fail "select with <2 options: error unclear — got: $err"
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
