#!/usr/bin/env bash
# create-widget-ranking-non-terminal.test.sh — test harness for the ranking-non-terminal template
#
# Runs in a temporary HOME (mktemp -d) to avoid polluting the real environment.
# Set SKIP_SYSTEMCTL=1 (default for this harness) to skip systemd enable/start
# and validate only the file scaffolding + port claim logic.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/create-widget-ranking-non-terminal.test.sh
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
        local count
        count=$(grep -c "$pattern" "$path" 2>/dev/null || true)
        fail "$label — pattern found ${count} time(s) in $path: $pattern"
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

# Set up a fresh fake HOME for each test group
new_home() {
    local tmp
    tmp=$(mktemp -d)
    mkdir -p "$tmp/fleet/interactive-messages"
    mkdir -p "$tmp/.config/systemd/user"
    mkdir -p "$tmp/fleet/host"
    echo "42" > "$tmp/fleet/host/id"
    echo "$tmp"
}

# ── Test 1: Happy path (4 options) ────────────────────────────────────────────

printf '\n=== Test 1: Happy path (4 options, --mode non-terminal) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug rank-nt \
    --template ranking \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Rank features" \
    --options "search,filter,sort,export"

if [ "$ec" = "0" ]; then
    pass "happy path exits 0"
else
    fail "happy path: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_HTML="$FAKE_HOME/fleet/interactive-messages/rank-nt/widget.html"
WIDGET_SERVER="$FAKE_HOME/fleet/interactive-messages/rank-nt/server.py"
WIDGET_META="$FAKE_HOME/fleet/interactive-messages/rank-nt/metadata.json"
WIDGET_UNIT="$FAKE_HOME/.config/systemd/user/im-rank-nt.service"

assert_file_exists "$WIDGET_HTML" "widget.html scaffolded"

# Prompt and all four options substituted into widget.html
assert_file_contains "$WIDGET_HTML" '"Rank features"' "widget.html contains prompt"
assert_file_contains "$WIDGET_HTML" '"search"' "widget.html contains search"
assert_file_contains "$WIDGET_HTML" '"filter"' "widget.html contains filter"
assert_file_contains "$WIDGET_HTML" '"sort"' "widget.html contains sort"
assert_file_contains "$WIDGET_HTML" '"export"' "widget.html contains export"

# /update endpoint present in widget.html
assert_file_contains "$WIDGET_HTML" '/update' "widget.html contains /update"

# Mobile mandate (shape file: "Ranking specifically renders both drag-handles and arrow buttons")
assert_file_contains "$WIDGET_HTML" 'up-btn' "widget.html has up-btn (arrow-up fallback)"
assert_file_contains "$WIDGET_HTML" 'down-btn' "widget.html has down-btn (arrow-down fallback)"

# Desktop drag mode preserved
assert_file_contains "$WIDGET_HTML" 'draggable' "widget.html has draggable (desktop drag-and-drop)"

# Non-terminal invariants — MUST NOT appear
assert_file_not_contains "$WIDGET_HTML" 'postMessage' "widget.html has no postMessage"
assert_file_not_contains "$WIDGET_HTML" 'window\.parent' "widget.html has no window.parent"
assert_file_not_contains "$WIDGET_HTML" 'submit-btn' "widget.html has no submit-btn"
assert_file_not_contains "$WIDGET_HTML" 'submitted_at' "widget.html has no submitted_at"
assert_file_not_contains "$WIDGET_HTML" '/submit' "widget.html has no /submit"

# server.py assertions
assert_file_exists "$WIDGET_SERVER" "server.py scaffolded"
assert_file_contains "$WIDGET_SERVER" '/update' "server.py has /update"
assert_file_not_contains "$WIDGET_SERVER" '/submit' "server.py has no /submit"

# metadata.json assertions
assert_file_exists "$WIDGET_META" "metadata.json written"
assert_file_contains "$WIDGET_META" '"template": "ranking"' 'metadata.json template=ranking'
assert_file_contains "$WIDGET_META" '"mode": "non-terminal"' 'metadata.json mode=non-terminal'

# metadata.json: options array with 4 entries
if [ -f "$WIDGET_META" ]; then
    META_OPTIONS=$(python3 -c "import json,sys; m=json.load(open(sys.argv[1])); print(len(m['config']['options']))" "$WIDGET_META" 2>/dev/null || echo "0")
    if [ "$META_OPTIONS" = "4" ]; then
        pass "metadata.json options array has 4 entries"
    else
        fail "metadata.json options array should have 4 entries, got: $META_OPTIONS"
    fi
fi

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
if printf '%s' "$out" | grep -q "^SLUG=rank-nt$"; then
    pass "stdout: SLUG=rank-nt"
else
    fail "stdout missing SLUG=rank-nt — got: $out"
fi
if printf '%s' "$out" | grep -q "^URL=/interactive/42/rank-nt/pane/$"; then
    pass "stdout: URL=/interactive/42/rank-nt/pane/"
else
    fail "stdout missing URL line — got: $out"
fi

rm -rf "$FAKE_HOME"

# ── Test 2: --submit-label rejected ──────────────────────────────────────────

printf '\n=== Test 2: --submit-label rejected ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug rank-nt-sl \
    --template ranking \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Rank?" \
    --options "a,b,c" \
    --submit-label "Save order"

if [ "$ec" != "0" ]; then
    pass "--submit-label rejected: exits non-zero"
else
    fail "--submit-label rejected: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -q '\-\-submit-label'; then
    pass "--submit-label rejected: stderr mentions --submit-label"
else
    fail "--submit-label rejected: stderr missing --submit-label — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 3: Missing --prompt ──────────────────────────────────────────────────

printf '\n=== Test 3: Missing --prompt ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug rank-nt-np \
    --template ranking \
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
    fail "missing --prompt: error message unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 4: Missing --options ─────────────────────────────────────────────────

printf '\n=== Test 4: Missing --options ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug rank-nt-no \
    --template ranking \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Rank?"

if [ "$ec" != "0" ]; then
    pass "missing --options: exits non-zero"
else
    fail "missing --options: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi '\-\-options'; then
    pass "missing --options: error names --options"
else
    fail "missing --options: error message unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 5: Fewer than 2 options ─────────────────────────────────────────────

printf '\n=== Test 5: Fewer than 2 options (single) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug rank-nt-one \
    --template ranking \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Rank?" \
    --options "single"

if [ "$ec" != "0" ]; then
    pass "single option: exits non-zero"
else
    fail "single option: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "at least 2"; then
    pass "single option: error mentions 'at least 2'"
else
    fail "single option: error missing 'at least 2' — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Summary ───────────────────────────────────────────────────────────────────

printf '\n=================================================\n'
printf 'PASS: %d tests passed, %d failed\n' "$PASS" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
    printf '\nFailed tests:%b\n' "$FAILURES"
    exit 1
fi

printf 'All ranking-non-terminal template tests passed.\n'
exit 0
