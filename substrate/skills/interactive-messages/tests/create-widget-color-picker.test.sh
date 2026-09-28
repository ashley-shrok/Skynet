#!/usr/bin/env bash
# create-widget-color-picker.test.sh — end-to-end scaffold test for the color-picker template
#
# Runs in a temporary HOME (mktemp -d) to avoid polluting the real environment.
# Set SKIP_SYSTEMCTL=1 (default for this harness) to skip systemd enable/start
# and validate only the file scaffolding + port claim logic.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/create-widget-color-picker.test.sh
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
    # Bare minimum structure
    mkdir -p "$tmp/fleet/interactive-messages"
    mkdir -p "$tmp/.config/systemd/user"
    mkdir -p "$tmp/fleet/host"
    # Write a valid hostId
    echo "42" > "$tmp/fleet/host/id"
    echo "$tmp"
}

# ── Test 1: Happy path (default palette) ─────────────────────────────────────

printf '\n=== Test 1: Happy path (default palette) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cp-happy \
    --template color-picker \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Sign color?"

if [ "$ec" = "0" ]; then
    pass "happy path exits 0"
else
    fail "happy path: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_DIR="$FAKE_HOME/fleet/interactive-messages/cp-happy"

# widget.html exists and has substitutions
assert_file_exists "$WIDGET_DIR/widget.html" "widget.html scaffolded"
assert_file_contains "$WIDGET_DIR/widget.html" "Sign color?" "widget.html has prompt"
assert_file_contains "$WIDGET_DIR/widget.html" "cp-happy" "widget.html has widget ID substituted"
assert_file_contains "$WIDGET_DIR/widget.html" "/interactive/42/cp-happy/pane" "widget.html has pane base substituted"

# Default palette colors present
assert_file_contains "$WIDGET_DIR/widget.html" "#ef4444" "widget.html has default palette color #ef4444"
assert_file_contains "$WIDGET_DIR/widget.html" "#f97316" "widget.html has default palette color #f97316"
assert_file_contains "$WIDGET_DIR/widget.html" "#22c55e" "widget.html has default palette color #22c55e"

# At least 12 palette colors embedded in the PALETTE JS variable (one per default swatch)
# Swatches are rendered dynamically from the PALETTE array; count hex entries in it.
swatch_count=$(python3 -c "
import re, pathlib, json, sys
html = pathlib.Path(sys.argv[1]).read_text()
m = re.search(r'var PALETTE\s*=\s*(\[.*?\]);', html)
if m:
    palette = json.loads(m.group(1))
    print(len(palette))
else:
    print(0)
" "$WIDGET_DIR/widget.html" 2>/dev/null || echo "0")
if [ "$swatch_count" -ge 12 ]; then
    pass "widget.html PALETTE has at least 12 colors (got $swatch_count)"
else
    fail "widget.html PALETTE count: expected >=12, got $swatch_count"
fi

# NO submit button (terminal-on-click — clicking IS the submit)
assert_file_not_contains "$WIDGET_DIR/widget.html" "submit-btn" "widget.html has no submit-btn"
assert_file_not_contains "$WIDGET_DIR/widget.html" "done-btn" "widget.html has no done-btn"

# metadata.json has template=color-picker + palette with >=12 entries
assert_file_exists "$WIDGET_DIR/metadata.json" "metadata.json written"
assert_file_contains "$WIDGET_DIR/metadata.json" '"template": "color-picker"' "metadata.json template=color-picker"
palette_entries=$(python3 -c "import json,sys; m=json.load(open(sys.argv[1])); print(len(m.get('config',{}).get('palette',[])))" "$WIDGET_DIR/metadata.json" 2>/dev/null || echo "0")
if [ "$palette_entries" -ge 12 ]; then
    pass "metadata.json palette has >=12 entries (got $palette_entries)"
else
    fail "metadata.json palette entries: expected >=12, got $palette_entries"
fi

# stdout machine-parseable output
if printf '%s' "$out" | grep -q "^SLUG=cp-happy$"; then
    pass "stdout: SLUG=cp-happy"
else
    fail "stdout missing SLUG=cp-happy — got: $out"
fi
if printf '%s' "$out" | grep -q "^URL=/interactive/42/cp-happy/pane/$"; then
    pass "stdout: URL=/interactive/42/cp-happy/pane/"
else
    fail "stdout missing URL line — got: $out"
fi

rm -rf "$FAKE_HOME"

# ── Test 2: Happy path (no prompt, custom palette) ────────────────────────────

printf '\n=== Test 2: Happy path (no prompt, custom palette) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cp-nop \
    --template color-picker \
    --message-id "m1" \
    --conversation-id "c1" \
    --palette "#000000,#ffffff,#808080"

if [ "$ec" = "0" ]; then
    pass "no-prompt custom-palette exits 0"
else
    fail "no-prompt custom-palette: expected exit 0, got $ec — stderr: $err"
fi

WIDGET_DIR="$FAKE_HOME/fleet/interactive-messages/cp-nop"

# Custom palette colors present
assert_file_contains "$WIDGET_DIR/widget.html" "#000000" "widget.html has #000000"
assert_file_contains "$WIDGET_DIR/widget.html" "#ffffff" "widget.html has #ffffff"
assert_file_contains "$WIDGET_DIR/widget.html" "#808080" "widget.html has #808080"

# Default palette color NOT present (custom palette replaced default)
assert_file_not_contains "$WIDGET_DIR/widget.html" "#ef4444" "widget.html does NOT contain default palette color #ef4444"

# metadata.json has the custom palette
assert_file_contains "$WIDGET_DIR/metadata.json" '"#000000"' "metadata.json has #000000 in palette"
assert_file_contains "$WIDGET_DIR/metadata.json" '"#ffffff"' "metadata.json has #ffffff in palette"
assert_file_contains "$WIDGET_DIR/metadata.json" '"#808080"' "metadata.json has #808080 in palette"

rm -rf "$FAKE_HOME"

# ── Test 3: Invalid palette (3-digit hex) ─────────────────────────────────────

printf '\n=== Test 3: Invalid palette (3-digit hex) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cp-bad3 \
    --template color-picker \
    --message-id "m1" \
    --conversation-id "c1" \
    --palette "#f00,#0f0"

if [ "$ec" != "0" ]; then
    pass "3-digit hex: exits non-zero"
else
    fail "3-digit hex: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qiE "6-digit hex|hex"; then
    pass "3-digit hex: error mentions hex"
else
    fail "3-digit hex: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 4: Invalid palette (named color) ─────────────────────────────────────

printf '\n=== Test 4: Invalid palette (named color) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cp-named \
    --template color-picker \
    --message-id "m1" \
    --conversation-id "c1" \
    --palette "red,blue"

if [ "$ec" != "0" ]; then
    pass "named color: exits non-zero"
else
    fail "named color: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qiE "6-digit hex|hex"; then
    pass "named color: error mentions hex"
else
    fail "named color: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 5: Invalid palette (bad hex char) ────────────────────────────────────

printf '\n=== Test 5: Invalid palette (bad hex char) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cp-badchar \
    --template color-picker \
    --message-id "m1" \
    --conversation-id "c1" \
    --palette "#gggggg,#000000"

if [ "$ec" != "0" ]; then
    pass "bad hex char: exits non-zero"
else
    fail "bad hex char: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qiE "hex|gggggg"; then
    pass "bad hex char: error mentions hex or the bad value"
else
    fail "bad hex char: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 6: Palette too small (1 color) ───────────────────────────────────────

printf '\n=== Test 6: Palette too small (1 color) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cp-one \
    --template color-picker \
    --message-id "m1" \
    --conversation-id "c1" \
    --palette "#ef4444"

if [ "$ec" != "0" ]; then
    pass "1-color palette: exits non-zero"
else
    fail "1-color palette: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qiE "at least 2|least 2"; then
    pass "1-color palette: error mentions at least 2"
else
    fail "1-color palette: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 7: Palette empty string ──────────────────────────────────────────────

printf '\n=== Test 7: Palette empty string ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cp-empty \
    --template color-picker \
    --message-id "m1" \
    --conversation-id "c1" \
    --palette ""

if [ "$ec" != "0" ]; then
    pass "empty palette: exits non-zero"
else
    fail "empty palette: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qiE "at least 2|hex"; then
    pass "empty palette: error mentions at least 2 or hex"
else
    fail "empty palette: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Summary ───────────────────────────────────────────────────────────────────

printf '\n=================================================\n'
printf 'Results: %d passed, %d failed\n' "$PASS" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
    printf '\nFailed tests:%b\n' "$FAILURES"
    exit 1
fi

printf 'All tests passed.\n'
exit 0
