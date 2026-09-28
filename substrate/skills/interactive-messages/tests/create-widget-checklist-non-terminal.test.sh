#!/usr/bin/env bash
# create-widget-checklist-non-terminal.test.sh — test harness for checklist-non-terminal template
#
# Runs in a temporary HOME (mktemp -d) to avoid polluting the real environment.
# SKIP_SYSTEMCTL=1 skips systemd enable/start so the test only validates file
# scaffolding + substitution output.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/create-widget-checklist-non-terminal.test.sh
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

printf '\n=== Test 1: Checklist non-terminal happy path ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cl-nt \
    --template checklist \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Pick tasks" \
    --options "task-a,task-b,task-c"

if [ "$ec" = "0" ]; then
    pass "happy path: exits 0"
else
    fail "happy path: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_DIR="$FAKE_HOME/fleet/interactive-messages/cl-nt"

# Core files exist
assert_file_exists "$WIDGET_DIR/widget.html" "widget.html scaffolded"
assert_file_exists "$WIDGET_DIR/server.py"   "server.py scaffolded"
assert_file_exists "$WIDGET_DIR/metadata.json" "metadata.json written"

# widget.html has prompt and options substituted
assert_file_contains "$WIDGET_DIR/widget.html" '"Pick tasks"' 'widget.html: prompt substituted'
assert_file_contains "$WIDGET_DIR/widget.html" '"task-a"' 'widget.html: task-a present'
assert_file_contains "$WIDGET_DIR/widget.html" '"task-b"' 'widget.html: task-b present'
assert_file_contains "$WIDGET_DIR/widget.html" '"task-c"' 'widget.html: task-c present'

# widget.html has checkboxes (affordance preserved)
assert_file_contains "$WIDGET_DIR/widget.html" 'type="checkbox"' 'widget.html: type="checkbox" present'

# widget.html uses /update not /submit
assert_file_contains "$WIDGET_DIR/widget.html" '/update' 'widget.html: /update present'
assert_file_not_contains "$WIDGET_DIR/widget.html" '/submit' 'widget.html: no /submit'

# widget.html has no submit button
assert_file_not_contains "$WIDGET_DIR/widget.html" 'submit-btn' 'widget.html: no submit-btn'
assert_file_not_contains "$WIDGET_DIR/widget.html" '<button' 'widget.html: no <button tag'

# widget.html has no postMessage or window.parent (non-terminal — no terminal wake signal)
assert_file_not_contains "$WIDGET_DIR/widget.html" 'postMessage' 'widget.html: no postMessage'
assert_file_not_contains "$WIDGET_DIR/widget.html" 'window.parent' 'widget.html: no window.parent'

# widget.html uses updated_at not submitted_at
assert_file_contains "$WIDGET_DIR/widget.html" 'updated_at' 'widget.html: updated_at present'
assert_file_not_contains "$WIDGET_DIR/widget.html" 'submitted_at' 'widget.html: no submitted_at'

# server.py uses /update not /submit
assert_file_contains "$WIDGET_DIR/server.py" '/update' 'server.py: /update present'
assert_file_not_contains "$WIDGET_DIR/server.py" '/submit' 'server.py: no /submit'

# server.py forces template discriminator
assert_file_contains "$WIDGET_DIR/server.py" '"checklist"' 'server.py: template=checklist discriminator preserved'

# metadata.json has correct template + mode
assert_file_contains "$WIDGET_DIR/metadata.json" '"template": "checklist"' 'metadata.json: template=checklist'
assert_file_contains "$WIDGET_DIR/metadata.json" '"mode": "non-terminal"' 'metadata.json: mode=non-terminal'
assert_file_contains "$WIDGET_DIR/metadata.json" '"task-a"' 'metadata.json: task-a in options'
assert_file_contains "$WIDGET_DIR/metadata.json" '"task-b"' 'metadata.json: task-b in options'
assert_file_contains "$WIDGET_DIR/metadata.json" '"task-c"' 'metadata.json: task-c in options'

# stdout: SLUG and URL lines
if printf '%s' "$out" | grep -q "^SLUG=cl-nt$"; then
    pass "stdout: SLUG=cl-nt"
else
    fail "stdout: missing SLUG=cl-nt — got: $out"
fi
if printf '%s' "$out" | grep -q "^URL=/interactive/42/cl-nt/pane/$"; then
    pass "stdout: URL=/interactive/42/cl-nt/pane/"
else
    fail "stdout: missing URL line — got: $out"
fi

rm -rf "$FAKE_HOME"

# ── Test 2: --submit-label is rejected ───────────────────────────────────────

printf '\n=== Test 2: --submit-label rejected in non-terminal mode ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cl-nt-sl \
    --template checklist \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Pick tasks" \
    --options "task-a,task-b" \
    --submit-label "Save {N}"

if [ "$ec" != "0" ]; then
    pass "--submit-label rejected: exits non-zero"
else
    fail "--submit-label rejected: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -q '\-\-submit-label'; then
    pass "--submit-label rejected: error names --submit-label"
else
    fail "--submit-label rejected: error does not name --submit-label — got: $err"
fi
if printf '%s' "$err" | grep -qi 'not accepted\|no submit button'; then
    pass "--submit-label rejected: error explains why (not accepted / no submit button)"
else
    fail "--submit-label rejected: error does not explain why — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 3: Missing --prompt ──────────────────────────────────────────────────

printf '\n=== Test 3: Missing --prompt ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cl-nt-np \
    --template checklist \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --options "a,b"

if [ "$ec" != "0" ]; then
    pass "missing --prompt: exits non-zero"
else
    fail "missing --prompt: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi '\-\-prompt'; then
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
    --slug cl-nt-no \
    --template checklist \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Pick tasks"

if [ "$ec" != "0" ]; then
    pass "missing --options: exits non-zero"
else
    fail "missing --options: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi '\-\-options'; then
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
    --slug cl-nt-one \
    --template checklist \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Pick tasks" \
    --options "one"

if [ "$ec" != "0" ]; then
    pass "fewer than 2 options: exits non-zero"
else
    fail "fewer than 2 options: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "at least 2\|at least two"; then
    pass "fewer than 2 options: error mentions 'at least 2'"
else
    fail "fewer than 2 options: error does not mention 'at least 2' — got: $err"
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
