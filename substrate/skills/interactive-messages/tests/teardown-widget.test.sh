#!/usr/bin/env bash
# teardown-widget.test.sh — test harness for teardown-widget.sh
#
# Runs in a temporary HOME (mktemp -d) per test to avoid polluting the real
# environment. SKIP_SYSTEMCTL=1 is set globally so no test hits real systemd.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/teardown-widget.test.sh
#
# Exit 0 on all pass, exit 1 with a summary on any failure.

set -uo pipefail

export SKIP_SYSTEMCTL=1

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TEARDOWN_WIDGET="$SCRIPT_DIR/../teardown-widget.sh"

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
    if [ -e "$path" ]; then
        pass "$label: $path exists"
    else
        fail "$label: $path does NOT exist"
    fi
}

assert_file_not_exists() {
    local path="$1" label="$2"
    if [ ! -e "$path" ]; then
        pass "$label: $path does not exist (expected)"
    else
        fail "$label: $path still exists (expected it to be removed)"
    fi
}

# Run the teardown script, capture stdout + stderr separately, capture exit code
run_script() {
    local out_var="$1" err_var="$2" ec_var="$3"
    shift 3
    local tmpout
    tmpout=$(mktemp)
    local tmperr
    tmperr=$(mktemp)
    local _ec=0
    "$TEARDOWN_WIDGET" "$@" >"$tmpout" 2>"$tmperr" || _ec=$?
    eval "${out_var}=\$(cat \"\$tmpout\")"
    eval "${err_var}=\$(cat \"\$tmperr\")"
    eval "${ec_var}=\${_ec}"
    rm -f "$tmpout" "$tmperr"
}

# ── Setup a fresh fake HOME for each test ────────────────────────────────────

new_home() {
    local tmp
    tmp=$(mktemp -d)
    mkdir -p "$tmp/fleet/interactive-messages"
    mkdir -p "$tmp/.config/systemd/user"
    echo "$tmp"
}

# ── Test 1: Happy path — widget dir + unit file both removed ─────────────────

test_1_happy_path() {
    printf '\n=== Test 1: Happy path — widget dir + unit file both removed ===\n'
    local FAKE_HOME
    FAKE_HOME=$(new_home)
    export HOME="$FAKE_HOME"

    # Setup: pre-existing widget dir and unit file
    mkdir -p "$FAKE_HOME/fleet/interactive-messages/test-slug"
    touch "$FAKE_HOME/fleet/interactive-messages/test-slug/metadata.json"
    mkdir -p "$FAKE_HOME/.config/systemd/user"
    touch "$FAKE_HOME/.config/systemd/user/im-test-slug.service"

    run_script out err ec "test-slug"

    if [ "$ec" = "0" ]; then
        pass "happy path: exits 0"
    else
        fail "happy path: expected exit 0, got $ec — stderr: $err"
    fi

    if printf '%s' "$out" | grep -q "^TORN_DOWN=test-slug$"; then
        pass "happy path: stdout contains TORN_DOWN=test-slug"
    else
        fail "happy path: stdout missing TORN_DOWN=test-slug — got: $out"
    fi

    assert_file_not_exists "$FAKE_HOME/fleet/interactive-messages/test-slug" \
        "happy path: widget dir removed"

    assert_file_not_exists "$FAKE_HOME/.config/systemd/user/im-test-slug.service" \
        "happy path: unit file removed"

    rm -rf "$FAKE_HOME"
}

# ── Test 2: Missing slug arg ─────────────────────────────────────────────────

test_2_missing_slug() {
    printf '\n=== Test 2: Missing slug arg ===\n'
    local FAKE_HOME
    FAKE_HOME=$(new_home)
    export HOME="$FAKE_HOME"

    run_script out err ec

    if [ "$ec" != "0" ]; then
        pass "missing slug: exits non-zero"
    else
        fail "missing slug: expected non-zero exit, got 0"
    fi

    if printf '%s' "$err" | grep -qi "usage\|slug"; then
        pass "missing slug: stderr mentions 'usage' or 'slug'"
    else
        fail "missing slug: error unclear — got: $err"
    fi

    rm -rf "$FAKE_HOME"
}

# ── Test 3: Invalid slug (uppercase) ─────────────────────────────────────────

test_3_invalid_slug_uppercase() {
    printf '\n=== Test 3: Invalid slug — uppercase ===\n'
    local FAKE_HOME
    FAKE_HOME=$(new_home)
    export HOME="$FAKE_HOME"

    run_script out err ec "BadSlug"

    if [ "$ec" != "0" ]; then
        pass "invalid slug (uppercase): exits non-zero"
    else
        fail "invalid slug (uppercase): expected non-zero exit, got 0"
    fi

    if printf '%s' "$err" | grep -qi "kebab"; then
        pass "invalid slug (uppercase): stderr contains 'kebab-case'"
    else
        fail "invalid slug (uppercase): error missing 'kebab-case' — got: $err"
    fi

    rm -rf "$FAKE_HOME"
}

# ── Test 4: Invalid slug (starts with digit) ─────────────────────────────────

test_4_invalid_slug_digit() {
    printf '\n=== Test 4: Invalid slug — starts with digit ===\n'
    local FAKE_HOME
    FAKE_HOME=$(new_home)
    export HOME="$FAKE_HOME"

    run_script out err ec "1slug"

    if [ "$ec" != "0" ]; then
        pass "invalid slug (starts with digit): exits non-zero"
    else
        fail "invalid slug (starts with digit): expected non-zero exit, got 0"
    fi

    rm -rf "$FAKE_HOME"
}

# ── Test 5: Nonexistent slug WITHOUT --force ──────────────────────────────────

test_5_nonexistent_no_force() {
    printf '\n=== Test 5: Nonexistent slug WITHOUT --force ===\n'
    local FAKE_HOME
    FAKE_HOME=$(new_home)
    export HOME="$FAKE_HOME"

    # Fresh HOME — no widget dir or unit file for phantom-slug
    run_script out err ec "phantom-slug"

    if [ "$ec" != "0" ]; then
        pass "nonexistent slug (no --force): exits non-zero"
    else
        fail "nonexistent slug (no --force): expected non-zero exit, got 0"
    fi

    if printf '%s' "$err" | grep -qi "no widget found"; then
        pass "nonexistent slug (no --force): stderr contains 'no widget found'"
    else
        fail "nonexistent slug (no --force): error missing 'no widget found' — got: $err"
    fi

    rm -rf "$FAKE_HOME"
}

# ── Test 6: Nonexistent slug WITH --force ────────────────────────────────────

test_6_nonexistent_with_force() {
    printf '\n=== Test 6: Nonexistent slug WITH --force ===\n'
    local FAKE_HOME
    FAKE_HOME=$(new_home)
    export HOME="$FAKE_HOME"

    # Fresh HOME — no widget dir or unit file for phantom-slug
    run_script out err ec --force phantom-slug

    if [ "$ec" = "0" ]; then
        pass "nonexistent slug (--force): exits 0"
    else
        fail "nonexistent slug (--force): expected exit 0, got $ec — stderr: $err"
    fi

    if printf '%s' "$out" | grep -q "^TORN_DOWN=phantom-slug$"; then
        pass "nonexistent slug (--force): stdout contains TORN_DOWN=phantom-slug"
    else
        fail "nonexistent slug (--force): stdout missing TORN_DOWN=phantom-slug — got: $out"
    fi

    rm -rf "$FAKE_HOME"
}

# ── Test 7: Widget dir exists but unit file missing (partial state) ───────────

test_7_partial_dir_only() {
    printf '\n=== Test 7: Widget dir exists but unit file missing (partial state) ===\n'
    local FAKE_HOME
    FAKE_HOME=$(new_home)
    export HOME="$FAKE_HOME"

    # Setup: only widget dir, no unit file
    mkdir -p "$FAKE_HOME/fleet/interactive-messages/partial-slug"
    # No unit file created

    run_script out err ec "partial-slug"

    if [ "$ec" = "0" ]; then
        pass "partial state (dir only): exits 0"
    else
        fail "partial state (dir only): expected exit 0, got $ec — stderr: $err"
    fi

    assert_file_not_exists "$FAKE_HOME/fleet/interactive-messages/partial-slug" \
        "partial state (dir only): widget dir removed"

    rm -rf "$FAKE_HOME"
}

# ── Test 8: Unit file exists but widget dir missing (mirror partial state) ────

test_8_partial_unit_only() {
    printf '\n=== Test 8: Unit file exists but widget dir missing ===\n'
    local FAKE_HOME
    FAKE_HOME=$(new_home)
    export HOME="$FAKE_HOME"

    # Setup: only unit file, no widget dir
    mkdir -p "$FAKE_HOME/.config/systemd/user"
    touch "$FAKE_HOME/.config/systemd/user/im-orphan.service"
    # No widget dir for orphan

    run_script out err ec "orphan"

    if [ "$ec" = "0" ]; then
        pass "partial state (unit only): exits 0"
    else
        fail "partial state (unit only): expected exit 0, got $ec — stderr: $err"
    fi

    assert_file_not_exists "$FAKE_HOME/.config/systemd/user/im-orphan.service" \
        "partial state (unit only): unit file removed"

    rm -rf "$FAKE_HOME"
}

# ── Test 9: --slug flag form ──────────────────────────────────────────────────

test_9_flag_form() {
    printf '\n=== Test 9: --slug flag form ===\n'
    local FAKE_HOME
    FAKE_HOME=$(new_home)
    export HOME="$FAKE_HOME"

    # Setup happy-path state
    mkdir -p "$FAKE_HOME/fleet/interactive-messages/flag-form-slug"
    touch "$FAKE_HOME/fleet/interactive-messages/flag-form-slug/metadata.json"
    mkdir -p "$FAKE_HOME/.config/systemd/user"
    touch "$FAKE_HOME/.config/systemd/user/im-flag-form-slug.service"

    run_script out err ec --slug flag-form-slug

    if [ "$ec" = "0" ]; then
        pass "--slug flag form: exits 0"
    else
        fail "--slug flag form: expected exit 0, got $ec — stderr: $err"
    fi

    assert_file_not_exists "$FAKE_HOME/fleet/interactive-messages/flag-form-slug" \
        "--slug flag form: widget dir removed"

    assert_file_not_exists "$FAKE_HOME/.config/systemd/user/im-flag-form-slug.service" \
        "--slug flag form: unit file removed"

    if printf '%s' "$out" | grep -q "^TORN_DOWN=flag-form-slug$"; then
        pass "--slug flag form: stdout contains TORN_DOWN=flag-form-slug"
    else
        fail "--slug flag form: stdout missing TORN_DOWN= — got: $out"
    fi

    rm -rf "$FAKE_HOME"
}

# ── Test 10: SKIP_SYSTEMCTL guard ────────────────────────────────────────────

test_10_skip_systemctl_guard() {
    printf '\n=== Test 10: SKIP_SYSTEMCTL guard ===\n'
    local FAKE_HOME
    FAKE_HOME=$(new_home)
    export HOME="$FAKE_HOME"

    # Setup happy-path state
    mkdir -p "$FAKE_HOME/fleet/interactive-messages/skip-ctl-slug"
    touch "$FAKE_HOME/fleet/interactive-messages/skip-ctl-slug/metadata.json"
    mkdir -p "$FAKE_HOME/.config/systemd/user"
    touch "$FAKE_HOME/.config/systemd/user/im-skip-ctl-slug.service"

    # SKIP_SYSTEMCTL=1 is already set at the top of this harness
    run_script out err ec "skip-ctl-slug"

    if [ "$ec" = "0" ]; then
        pass "SKIP_SYSTEMCTL guard: exits 0"
    else
        fail "SKIP_SYSTEMCTL guard: expected exit 0, got $ec — stderr: $err"
    fi

    if printf '%s' "$err" | grep -qi "SKIP_SYSTEMCTL"; then
        pass "SKIP_SYSTEMCTL guard: stderr contains 'SKIP_SYSTEMCTL' (guard branch taken)"
    else
        fail "SKIP_SYSTEMCTL guard: stderr missing SKIP_SYSTEMCTL log — got: $err"
    fi

    rm -rf "$FAKE_HOME"
}

# ── run_all ───────────────────────────────────────────────────────────────────

run_all() {
    test_1_happy_path
    test_2_missing_slug
    test_3_invalid_slug_uppercase
    test_4_invalid_slug_digit
    test_5_nonexistent_no_force
    test_6_nonexistent_with_force
    test_7_partial_dir_only
    test_8_partial_unit_only
    test_9_flag_form
    test_10_skip_systemctl_guard
}

# ── main ──────────────────────────────────────────────────────────────────────

main() {
    run_all

    printf '\n=================================================\n'
    printf 'Results: %d passed, %d failed\n' "$PASS" "$FAIL"

    if [ "$FAIL" -gt 0 ]; then
        printf '\nFailed tests:%b\n' "$FAILURES"
        exit 1
    fi

    printf 'All tests passed.\n'
    exit 0
}

main
