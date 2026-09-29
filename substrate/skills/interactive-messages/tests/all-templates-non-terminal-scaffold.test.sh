#!/usr/bin/env bash
# all-templates-non-terminal-scaffold.test.sh — integrated Phase 139 non-terminal scaffold test
#
# Scaffolds one instance of every non-terminal template variant (poll, checklist,
# form, ranking, list-actions, color-picker — each with --mode non-terminal) in a
# SHARED temp HOME and asserts:
#   - Per-template: exit 0, widget.html exists, server.py exists,
#     metadata.json discriminator correct, metadata.json mode "non-terminal",
#     systemd unit in-range port.
#   - Cross-cutting non-terminal invariants (arc-wide):
#       * Zero widget-submit postMessages across all six widget.html files
#         (widget-resize postMessages for iframe auto-sizing are allowed)
#       * No window.parent usages outside the widget-resize height-reporter
#       * /update present in all six server.py files
#       * /submit ABSENT in all six server.py files
#       * updated_at present in all six widget.html files
#       * submitted_at ABSENT in all six widget.html files
#       * Zero submit-btn / done-btn id markers across all six widget.html files
#       * Six distinct unit files (9601-9699), six distinct ports, six folders
#       * All six metadata.json files contain "mode": "non-terminal"
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/all-templates-non-terminal-scaffold.test.sh
#
# Exit 0 on all pass; exit 1 with failure summary on any failure.

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
        pass "$label: exists"
    else
        fail "$label: does NOT exist — $path"
    fi
}

assert_file_contains() {
    local path="$1" pattern="$2" label="$3"
    if grep -q "$pattern" "$path" 2>/dev/null; then
        pass "$label"
    else
        fail "$label — pattern not found in $(basename "$path"): $pattern"
    fi
}

assert_file_not_contains() {
    local path="$1" pattern="$2" label="$3"
    local count
    count=$(grep -c "$pattern" "$path" 2>/dev/null || true)
    if [ "$count" -eq 0 ]; then
        pass "$label"
    else
        fail "$label — found $count occurrence(s) of '$pattern' in $(basename "$path")"
    fi
}

run_script() {
    local out_var="$1" err_var="$2" ec_var="$3"
    shift 3
    local tmpout tmperr
    tmpout=$(mktemp)
    tmperr=$(mktemp)
    local _ec=0
    "$CREATE_WIDGET" "$@" >"$tmpout" 2>"$tmperr" || _ec=$?
    eval "${out_var}=\$(cat \"\$tmpout\")"
    eval "${err_var}=\$(cat \"\$tmperr\")"
    eval "${ec_var}=\${_ec}"
    rm -f "$tmpout" "$tmperr"
}

# ── Setup one shared temp HOME ────────────────────────────────────────────────

SHARED_HOME=$(mktemp -d)
mkdir -p "$SHARED_HOME/fleet/interactive-messages"
mkdir -p "$SHARED_HOME/.config/systemd/user"
mkdir -p "$SHARED_HOME/fleet/host"
echo "42" > "$SHARED_HOME/fleet/host/id"
echo "https://test.example.com" > "$SHARED_HOME/fleet/host/parent"
export HOME="$SHARED_HOME"

# Cleanup on exit
trap 'rm -rf "$SHARED_HOME"' EXIT

# ── Template 1: poll --mode non-terminal ──────────────────────────────────────

printf '\n=== Template 1: poll (non-terminal) ===\n'

run_script out err ec \
    --slug im-nt-poll \
    --template poll \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "P" \
    --options "a,b"

if [ "$ec" = "0" ]; then
    pass "im-nt-poll: exits 0"
else
    fail "im-nt-poll: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-poll/widget.html"   "im-nt-poll widget.html"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-poll/server.py"     "im-nt-poll server.py"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-poll/metadata.json" "im-nt-poll metadata.json"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/im-nt-poll/metadata.json" \
    '"template": "poll"' \
    "im-nt-poll metadata.json discriminator"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/im-nt-poll/metadata.json" \
    '"mode": "non-terminal"' \
    "im-nt-poll metadata.json mode=non-terminal"

UNIT_POLL="$SHARED_HOME/.config/systemd/user/im-im-nt-poll.service"
assert_file_exists "$UNIT_POLL" "im-nt-poll systemd unit"

if [ -f "$UNIT_POLL" ]; then
    PORT_POLL=$(grep '^Environment=PORT=' "$UNIT_POLL" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_POLL" ] && [ "$PORT_POLL" -ge 9601 ] && [ "$PORT_POLL" -le 9699 ]; then
        pass "im-nt-poll: port $PORT_POLL in 9601-9699"
    else
        fail "im-nt-poll: port '$PORT_POLL' NOT in 9601-9699"
    fi
fi

# ── Template 2: checklist --mode non-terminal ─────────────────────────────────

printf '\n=== Template 2: checklist (non-terminal) ===\n'

run_script out err ec \
    --slug im-nt-check \
    --template checklist \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "P" \
    --options "a,b"

if [ "$ec" = "0" ]; then
    pass "im-nt-check: exits 0"
else
    fail "im-nt-check: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-check/widget.html"   "im-nt-check widget.html"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-check/server.py"     "im-nt-check server.py"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-check/metadata.json" "im-nt-check metadata.json"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/im-nt-check/metadata.json" \
    '"template": "checklist"' \
    "im-nt-check metadata.json discriminator"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/im-nt-check/metadata.json" \
    '"mode": "non-terminal"' \
    "im-nt-check metadata.json mode=non-terminal"

UNIT_CHECK="$SHARED_HOME/.config/systemd/user/im-im-nt-check.service"
assert_file_exists "$UNIT_CHECK" "im-nt-check systemd unit"

if [ -f "$UNIT_CHECK" ]; then
    PORT_CHECK=$(grep '^Environment=PORT=' "$UNIT_CHECK" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_CHECK" ] && [ "$PORT_CHECK" -ge 9601 ] && [ "$PORT_CHECK" -le 9699 ]; then
        pass "im-nt-check: port $PORT_CHECK in 9601-9699"
    else
        fail "im-nt-check: port '$PORT_CHECK' NOT in 9601-9699"
    fi
fi

# ── Template 3: form --mode non-terminal ──────────────────────────────────────

printf '\n=== Template 3: form (non-terminal) ===\n'

run_script out err ec \
    --slug im-nt-form \
    --template form \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "P" \
    --field "name:text"

if [ "$ec" = "0" ]; then
    pass "im-nt-form: exits 0"
else
    fail "im-nt-form: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-form/widget.html"   "im-nt-form widget.html"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-form/server.py"     "im-nt-form server.py"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-form/metadata.json" "im-nt-form metadata.json"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/im-nt-form/metadata.json" \
    '"template": "form"' \
    "im-nt-form metadata.json discriminator"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/im-nt-form/metadata.json" \
    '"mode": "non-terminal"' \
    "im-nt-form metadata.json mode=non-terminal"

UNIT_FORM="$SHARED_HOME/.config/systemd/user/im-im-nt-form.service"
assert_file_exists "$UNIT_FORM" "im-nt-form systemd unit"

if [ -f "$UNIT_FORM" ]; then
    PORT_FORM=$(grep '^Environment=PORT=' "$UNIT_FORM" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_FORM" ] && [ "$PORT_FORM" -ge 9601 ] && [ "$PORT_FORM" -le 9699 ]; then
        pass "im-nt-form: port $PORT_FORM in 9601-9699"
    else
        fail "im-nt-form: port '$PORT_FORM' NOT in 9601-9699"
    fi
fi

# ── Template 4: ranking --mode non-terminal ───────────────────────────────────

printf '\n=== Template 4: ranking (non-terminal) ===\n'

run_script out err ec \
    --slug im-nt-rank \
    --template ranking \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "P" \
    --options "a,b"

if [ "$ec" = "0" ]; then
    pass "im-nt-rank: exits 0"
else
    fail "im-nt-rank: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-rank/widget.html"   "im-nt-rank widget.html"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-rank/server.py"     "im-nt-rank server.py"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-rank/metadata.json" "im-nt-rank metadata.json"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/im-nt-rank/metadata.json" \
    '"template": "ranking"' \
    "im-nt-rank metadata.json discriminator"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/im-nt-rank/metadata.json" \
    '"mode": "non-terminal"' \
    "im-nt-rank metadata.json mode=non-terminal"

UNIT_RANK="$SHARED_HOME/.config/systemd/user/im-im-nt-rank.service"
assert_file_exists "$UNIT_RANK" "im-nt-rank systemd unit"

if [ -f "$UNIT_RANK" ]; then
    PORT_RANK=$(grep '^Environment=PORT=' "$UNIT_RANK" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_RANK" ] && [ "$PORT_RANK" -ge 9601 ] && [ "$PORT_RANK" -le 9699 ]; then
        pass "im-nt-rank: port $PORT_RANK in 9601-9699"
    else
        fail "im-nt-rank: port '$PORT_RANK' NOT in 9601-9699"
    fi
fi

# ── Template 5: list-actions --mode non-terminal ──────────────────────────────

printf '\n=== Template 5: list-actions (non-terminal) ===\n'

run_script out err ec \
    --slug im-nt-la \
    --template list-actions \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c" \
    --prompt "P" \
    --items '["i1","i2"]' \
    --actions "a1,a2"

if [ "$ec" = "0" ]; then
    pass "im-nt-la: exits 0"
else
    fail "im-nt-la: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-la/widget.html"   "im-nt-la widget.html"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-la/server.py"     "im-nt-la server.py"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-la/metadata.json" "im-nt-la metadata.json"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/im-nt-la/metadata.json" \
    '"template": "list-actions"' \
    "im-nt-la metadata.json discriminator"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/im-nt-la/metadata.json" \
    '"mode": "non-terminal"' \
    "im-nt-la metadata.json mode=non-terminal"

UNIT_LA="$SHARED_HOME/.config/systemd/user/im-im-nt-la.service"
assert_file_exists "$UNIT_LA" "im-nt-la systemd unit"

if [ -f "$UNIT_LA" ]; then
    PORT_LA=$(grep '^Environment=PORT=' "$UNIT_LA" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_LA" ] && [ "$PORT_LA" -ge 9601 ] && [ "$PORT_LA" -le 9699 ]; then
        pass "im-nt-la: port $PORT_LA in 9601-9699"
    else
        fail "im-nt-la: port '$PORT_LA' NOT in 9601-9699"
    fi
fi

# ── Template 6: color-picker --mode non-terminal ──────────────────────────────

printf '\n=== Template 6: color-picker (non-terminal) ===\n'

run_script out err ec \
    --slug im-nt-cp \
    --template color-picker \
    --mode non-terminal \
    --message-id "m" \
    --conversation-id "c"

if [ "$ec" = "0" ]; then
    pass "im-nt-cp: exits 0"
else
    fail "im-nt-cp: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-cp/widget.html"   "im-nt-cp widget.html"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-cp/server.py"     "im-nt-cp server.py"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/im-nt-cp/metadata.json" "im-nt-cp metadata.json"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/im-nt-cp/metadata.json" \
    '"template": "color-picker"' \
    "im-nt-cp metadata.json discriminator"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/im-nt-cp/metadata.json" \
    '"mode": "non-terminal"' \
    "im-nt-cp metadata.json mode=non-terminal"

UNIT_CP="$SHARED_HOME/.config/systemd/user/im-im-nt-cp.service"
assert_file_exists "$UNIT_CP" "im-nt-cp systemd unit"

if [ -f "$UNIT_CP" ]; then
    PORT_CP=$(grep '^Environment=PORT=' "$UNIT_CP" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_CP" ] && [ "$PORT_CP" -ge 9601 ] && [ "$PORT_CP" -le 9699 ]; then
        pass "im-nt-cp: port $PORT_CP in 9601-9699"
    else
        fail "im-nt-cp: port '$PORT_CP' NOT in 9601-9699"
    fi
fi

# ── Cross-cutting non-terminal invariants ─────────────────────────────────────

printf '\n=== Cross-cutting non-terminal invariants ===\n'

# 1. Exactly 6 distinct systemd unit files (all from this test, shared HOME starts empty)
UNIT_COUNT=$(find "$SHARED_HOME/.config/systemd/user" -name 'im-im-nt-*.service' 2>/dev/null | wc -l)
if [ "$UNIT_COUNT" -eq 6 ]; then
    pass "cross: exactly 6 systemd unit files (got $UNIT_COUNT)"
else
    fail "cross: expected 6 systemd unit files, got $UNIT_COUNT"
fi

# 2. 6 distinct ports in 9601-9699
ALL_PORTS=$(find "$SHARED_HOME/.config/systemd/user" -name 'im-im-nt-*.service' -exec grep '^Environment=PORT=' {} \; 2>/dev/null \
            | sed 's/^Environment=PORT=//' | sort -u)
UNIQUE_PORT_COUNT=$(printf '%s\n' "$ALL_PORTS" | grep -c .)
if [ "$UNIQUE_PORT_COUNT" -eq 6 ]; then
    pass "cross: 6 distinct ports claimed ($(printf '%s' "$ALL_PORTS" | tr '\n' ' '))"
else
    fail "cross: expected 6 distinct ports, got $UNIQUE_PORT_COUNT (ports: $(printf '%s' "$ALL_PORTS" | tr '\n' ' '))"
fi

PORT_RANGE_FAIL=0
while IFS= read -r p; do
    if ! ( [ "$p" -ge 9601 ] && [ "$p" -le 9699 ] ); then
        PORT_RANGE_FAIL=1
        fail "cross: port $p is out of range 9601-9699"
    fi
done <<< "$ALL_PORTS"
if [ "$PORT_RANGE_FAIL" = "0" ]; then
    pass "cross: all 6 ports in range 9601-9699"
fi

# 3. 6 distinct widget folders
WIDGET_COUNT=$(find "$SHARED_HOME/fleet/interactive-messages" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
if [ "$WIDGET_COUNT" -eq 6 ]; then
    pass "cross: exactly 6 widget folders (slug isolation confirmed)"
else
    fail "cross: expected 6 widget folders, got $WIDGET_COUNT"
fi

# 4. Zero widget-submit postMessages across all six widget.html files
# Non-terminal widgets do send widget-resize postMessages (Phase 143 iframe
# auto-sizing), but MUST NOT send widget-submit — that would fire a wake and
# break the "user's next text reply is the wake" contract.
SUBMIT_MSG_COUNT=$(find "$SHARED_HOME/fleet/interactive-messages" -name "widget.html" \
                   -exec grep -c 'widget-submit' {} + 2>/dev/null \
                   | awk -F: '{sum+=$NF} END{print sum+0}')
if [ "$SUBMIT_MSG_COUNT" -eq 0 ]; then
    pass "cross: zero widget-submit messages across all 6 non-terminal widget.html files"
else
    fail "cross: found $SUBMIT_MSG_COUNT widget-submit occurrence(s) — non-terminal widgets must not fire wake signals"
fi

# 5. Non-terminal templates may reference window.parent only inside the
# widget-resize height-reporter — confirm no OTHER window.parent usages.
# Simple check: every window.parent line must be inside a reportHeight()
# function body that posts widget-resize. Approximation: count total
# window.parent occurrences and total inside widget-resize context; they
# must match. Uses per-file check to catch a stray parent call anywhere.
STRAY_PARENT_COUNT=0
for html in $(find "$SHARED_HOME/fleet/interactive-messages" -name "widget.html"); do
    total_parent=$(grep -c 'window\.parent' "$html")
    # window.parent occurrences that are part of the widget-resize height
    # postMessage — same pattern used by every template.
    resize_parent=$(grep -B1 'widget-resize' "$html" | grep -c 'window\.parent')
    if [ "$total_parent" -ne "$resize_parent" ]; then
        STRAY_PARENT_COUNT=$((STRAY_PARENT_COUNT + total_parent - resize_parent))
    fi
done
if [ "$STRAY_PARENT_COUNT" -eq 0 ]; then
    pass "cross: no window.parent usages outside widget-resize height-reporter across all 6 non-terminal widget.html files"
else
    fail "cross: found $STRAY_PARENT_COUNT stray window.parent occurrence(s) outside widget-resize — non-terminal widgets must not communicate with parent frame beyond height reporting"
fi

# 6. /update present in all six server.py files
UPDATE_FOUND=0
for dir in "$SHARED_HOME/fleet/interactive-messages"/im-nt-*; do
    if [ -f "$dir/server.py" ]; then
        if grep -q '/update' "$dir/server.py" 2>/dev/null; then
            UPDATE_FOUND=$((UPDATE_FOUND + 1))
        else
            fail "cross: /update endpoint MISSING in $(basename "$dir")/server.py"
        fi
    fi
done
if [ "$UPDATE_FOUND" -eq 6 ]; then
    pass "cross: /update endpoint present in all 6 non-terminal server.py files"
fi

# 7. /submit ABSENT in all six server.py files
SUBMIT_COUNT=$(find "$SHARED_HOME/fleet/interactive-messages" -name "server.py" \
               -exec grep -c '/submit' {} + 2>/dev/null \
               | awk -F: '{sum+=$NF} END{print sum+0}')
if [ "$SUBMIT_COUNT" -eq 0 ]; then
    pass "cross: /submit endpoint absent from all 6 non-terminal server.py files"
else
    fail "cross: found $SUBMIT_COUNT /submit occurrence(s) in server.py files — non-terminal servers must not have /submit"
fi

# 8. updated_at present in all six widget.html files
UPDATED_AT_FOUND=0
for dir in "$SHARED_HOME/fleet/interactive-messages"/im-nt-*; do
    if [ -f "$dir/widget.html" ]; then
        if grep -q 'updated_at' "$dir/widget.html" 2>/dev/null; then
            UPDATED_AT_FOUND=$((UPDATED_AT_FOUND + 1))
        else
            fail "cross: updated_at MISSING in $(basename "$dir")/widget.html"
        fi
    fi
done
if [ "$UPDATED_AT_FOUND" -eq 6 ]; then
    pass "cross: updated_at present in all 6 non-terminal widget.html files"
fi

# 9. submitted_at ABSENT in all six widget.html files
SUBMITTED_AT_COUNT=$(find "$SHARED_HOME/fleet/interactive-messages" -name "widget.html" \
                     -exec grep -c 'submitted_at' {} + 2>/dev/null \
                     | awk -F: '{sum+=$NF} END{print sum+0}')
if [ "$SUBMITTED_AT_COUNT" -eq 0 ]; then
    pass "cross: submitted_at absent from all 6 non-terminal widget.html files"
else
    fail "cross: found $SUBMITTED_AT_COUNT submitted_at occurrence(s) in widget.html files — non-terminal widgets must not use submitted_at"
fi

# 10. Zero submit-btn / done-btn id markers across all six widget.html files
#     (defense-in-depth: no non-terminal widget renders a terminal-style submit button)
SUBMIT_BTN_COUNT=$(find "$SHARED_HOME/fleet/interactive-messages" -name "widget.html" \
                   -exec grep -c 'submit-btn\|done-btn' {} + 2>/dev/null \
                   | awk -F: '{sum+=$NF} END{print sum+0}')
if [ "$SUBMIT_BTN_COUNT" -eq 0 ]; then
    pass 'cross: zero submit-btn / done-btn markers across all 6 non-terminal widget.html files'
else
    fail "cross: found $SUBMIT_BTN_COUNT submit-btn/done-btn occurrence(s) — non-terminal widgets must not render terminal-style submit buttons"
fi

# 11. All six metadata.json files contain "mode": "non-terminal"
MODE_FOUND=0
for dir in "$SHARED_HOME/fleet/interactive-messages"/im-nt-*; do
    if [ -f "$dir/metadata.json" ]; then
        if grep -q '"mode": "non-terminal"' "$dir/metadata.json" 2>/dev/null; then
            MODE_FOUND=$((MODE_FOUND + 1))
        else
            fail "cross: mode=non-terminal MISSING in $(basename "$dir")/metadata.json"
        fi
    fi
done
if [ "$MODE_FOUND" -eq 6 ]; then
    pass 'cross: all 6 metadata.json files contain "mode": "non-terminal"'
fi

# ── Summary ───────────────────────────────────────────────────────────────────

TOTAL=$((PASS + FAIL))
printf '\n=================================================\n'
printf 'all-templates-non-terminal-scaffold.test.sh: PASS: %d, FAIL: %d (total %d)\n' "$PASS" "$FAIL" "$TOTAL"

if [ "$FAIL" -gt 0 ]; then
    printf '\nFailed tests:%b\n' "$FAILURES"
    exit 1
fi

printf 'All tests passed.\n'
exit 0
