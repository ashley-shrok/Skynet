#!/usr/bin/env bash
# create-widget-list-actions-non-terminal.test.sh — test harness for the list-actions-non-terminal template
#
# Runs in a temporary HOME (mktemp -d) to avoid polluting the real environment.
# Set SKIP_SYSTEMCTL=1 (default for this harness) to skip systemd enable/start
# and validate only the file scaffolding + arg parsing logic.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/create-widget-list-actions-non-terminal.test.sh
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
    if grep -q "$pattern" "$path" 2>/dev/null; then
        fail "$label — pattern FOUND (should be absent) in $path: $pattern"
    else
        pass "$label"
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
    mkdir -p "$tmp/.claude"
    echo "42" > "$tmp/.claude/skynet-hostid"
    echo "$tmp"
}

# ── Test 1: Happy path ────────────────────────────────────────────────────────

printf '\n=== Test 1: Happy path (non-terminal list-actions) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug la-nt \
    --template list-actions \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Triage" \
    --items '["issue-a","issue-b","issue-c"]' \
    --actions "accept,reject,defer"

if [ "$ec" = "0" ]; then
    pass "happy path exits 0"
else
    fail "happy path: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_HTML="$FAKE_HOME/fleet/interactive-messages/la-nt/widget.html"
WIDGET_SERVER="$FAKE_HOME/fleet/interactive-messages/la-nt/server.py"
WIDGET_META="$FAKE_HOME/fleet/interactive-messages/la-nt/metadata.json"
UNIT_FILE="$FAKE_HOME/.config/systemd/user/im-la-nt.service"

assert_file_exists "$WIDGET_HTML" "widget.html scaffolded"
assert_file_exists "$WIDGET_SERVER" "server.py scaffolded"
assert_file_exists "$WIDGET_META" "metadata.json written"
assert_file_exists "$UNIT_FILE" "systemd unit file created: im-la-nt.service"

# widget.html — content checks
assert_file_contains "$WIDGET_HTML" '"Triage"' "widget.html has prompt: Triage"
assert_file_contains "$WIDGET_HTML" '"issue-a"' "widget.html has item: issue-a"
assert_file_contains "$WIDGET_HTML" '"issue-b"' "widget.html has item: issue-b"
assert_file_contains "$WIDGET_HTML" '"issue-c"' "widget.html has item: issue-c"
assert_file_contains "$WIDGET_HTML" '"accept"' "widget.html has action: accept"
assert_file_contains "$WIDGET_HTML" '"reject"' "widget.html has action: reject"
assert_file_contains "$WIDGET_HTML" '"defer"' "widget.html has action: defer"
assert_file_contains "$WIDGET_HTML" 'action-btn' "widget.html has action-btn class"
assert_file_contains "$WIDGET_HTML" '/update' "widget.html has /update endpoint"

# widget.html — absence checks (non-terminal invariants)
assert_file_not_contains "$WIDGET_HTML" 'postMessage' "widget.html has no postMessage"
assert_file_not_contains "$WIDGET_HTML" 'window.parent' "widget.html has no window.parent"
assert_file_not_contains "$WIDGET_HTML" 'done-btn' "widget.html has no done-btn"
assert_file_not_contains "$WIDGET_HTML" 'id="done-btn"' "widget.html has no id=done-btn"
assert_file_not_contains "$WIDGET_HTML" 'submit-btn' "widget.html has no submit-btn"
assert_file_not_contains "$WIDGET_HTML" 'submitted_at' "widget.html has no submitted_at"
assert_file_not_contains "$WIDGET_HTML" '/submit' "widget.html has no /submit"

# server.py checks
assert_file_contains "$WIDGET_SERVER" '/update' "server.py has /update endpoint"
assert_file_not_contains "$WIDGET_SERVER" '/submit' "server.py has no /submit"
assert_file_contains "$WIDGET_SERVER" '"list-actions"' "server.py has list-actions discriminator"

# metadata.json checks
assert_file_contains "$WIDGET_META" '"template": "list-actions"' "metadata.json has template=list-actions"
assert_file_contains "$WIDGET_META" '"mode": "non-terminal"' "metadata.json has mode=non-terminal"
assert_file_contains "$WIDGET_META" '"issue-a"' "metadata.json has item: issue-a"
assert_file_contains "$WIDGET_META" '"issue-b"' "metadata.json has item: issue-b"
assert_file_contains "$WIDGET_META" '"issue-c"' "metadata.json has item: issue-c"
assert_file_contains "$WIDGET_META" '"accept"' "metadata.json has action: accept"
assert_file_contains "$WIDGET_META" '"reject"' "metadata.json has action: reject"
assert_file_contains "$WIDGET_META" '"defer"' "metadata.json has action: defer"

# systemd unit port in range 9601-9699
if [ -f "$UNIT_FILE" ]; then
    PORT_VAL=$(grep '^Environment=PORT=' "$UNIT_FILE" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_VAL" ] && [ "$PORT_VAL" -ge 9601 ] && [ "$PORT_VAL" -le 9699 ]; then
        pass "unit file port $PORT_VAL is in range 9601-9699"
    else
        fail "unit file port '$PORT_VAL' is NOT in range 9601-9699"
    fi
fi

rm -rf "$FAKE_HOME"

# ── Test 2: --done-label rejected ────────────────────────────────────────────

printf '\n=== Test 2: --done-label rejected ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug la-nt-done \
    --template list-actions \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Triage" \
    --items '["a","b"]' \
    --actions "accept,reject" \
    --done-label "Done"

if [ "$ec" != "0" ]; then
    pass "--done-label: exits non-zero"
else
    fail "--done-label: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "done-label"; then
    pass "--done-label: error message mentions done-label"
else
    fail "--done-label: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 3: Missing --prompt ──────────────────────────────────────────────────

printf '\n=== Test 3: Missing --prompt ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug la-nt-noprompt \
    --template list-actions \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --items '["a","b"]' \
    --actions "accept,reject"

if [ "$ec" != "0" ]; then
    pass "missing --prompt: exits non-zero"
else
    fail "missing --prompt: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "\-\-prompt\|prompt"; then
    pass "missing --prompt: error message mentions --prompt"
else
    fail "missing --prompt: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 4: Missing --items ───────────────────────────────────────────────────

printf '\n=== Test 4: Missing --items ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug la-nt-noitems \
    --template list-actions \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Test?" \
    --actions "accept,reject"

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

# ── Test 5: Fewer than 2 actions ─────────────────────────────────────────────

printf '\n=== Test 5: Fewer than 2 actions (--actions "only") ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug la-nt-oneaction \
    --template list-actions \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Test?" \
    --items '["a","b"]' \
    --actions "only"

if [ "$ec" != "0" ]; then
    pass "fewer than 2 actions: exits non-zero"
else
    fail "fewer than 2 actions: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "at least 2"; then
    pass "fewer than 2 actions: error mentions at least 2"
else
    fail "fewer than 2 actions: error unclear — got: $err"
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
