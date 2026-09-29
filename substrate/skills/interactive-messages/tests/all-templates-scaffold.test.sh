#!/usr/bin/env bash
# all-templates-scaffold.test.sh — integrated Phase 138 scaffold test
#
# Scaffolds one instance of every template (poll, checklist, form, ranking,
# list-actions, color-picker, draft) in a SHARED temp HOME and asserts:
#   - Per-template: exit 0, widget.html exists, server.py exists,
#     metadata.json discriminator correct, systemd unit in-range port.
#   - Cross-cutting: 7 distinct unit files, 7 distinct ports, all in 9601-9699,
#     zero type="radio" across all widget.html files, all widget.html files
#     target window.location.origin (never "*") in postMessage.
#
# Usage:
#   bash substrate/skills/interactive-messages/tests/all-templates-scaffold.test.sh
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

# ── Template 1: poll ──────────────────────────────────────────────────────────

printf '\n=== Template 1: poll (terminal-on-click) ===\n'

run_script out err ec \
    --slug poll-int \
    --template poll \
    --message-id "m-poll" \
    --conversation-id "c-int" \
    --prompt "Pick one?" \
    --options "a,b,c"

if [ "$ec" = "0" ]; then
    pass "poll-int: exits 0"
else
    fail "poll-int: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$SHARED_HOME/fleet/interactive-messages/poll-int/widget.html"  "poll-int widget.html"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/poll-int/server.py"    "poll-int server.py"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/poll-int/metadata.json" "poll-int metadata.json"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/poll-int/metadata.json" \
    '"template": "poll"' \
    "poll-int metadata.json discriminator"

UNIT_POLL="$SHARED_HOME/.config/systemd/user/im-poll-int.service"
assert_file_exists "$UNIT_POLL" "poll-int systemd unit"

if [ -f "$UNIT_POLL" ]; then
    PORT_POLL=$(grep '^Environment=PORT=' "$UNIT_POLL" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_POLL" ] && [ "$PORT_POLL" -ge 9601 ] && [ "$PORT_POLL" -le 9699 ]; then
        pass "poll-int: port $PORT_POLL in 9601-9699"
    else
        fail "poll-int: port '$PORT_POLL' NOT in 9601-9699"
    fi
fi

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/poll-int/server.py" \
    'data\["template"\] *= *"poll"' \
    "poll-int server.py forces template discriminator"

# ── Template 2: checklist ─────────────────────────────────────────────────────

printf '\n=== Template 2: checklist (terminal-on-submit) ===\n'

run_script out err ec \
    --slug check-int \
    --template checklist \
    --message-id "m-check" \
    --conversation-id "c-int" \
    --prompt "Pick many?" \
    --options "x,y,z"

if [ "$ec" = "0" ]; then
    pass "check-int: exits 0"
else
    fail "check-int: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$SHARED_HOME/fleet/interactive-messages/check-int/widget.html"   "check-int widget.html"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/check-int/server.py"     "check-int server.py"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/check-int/metadata.json" "check-int metadata.json"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/check-int/metadata.json" \
    '"template": "checklist"' \
    "check-int metadata.json discriminator"

UNIT_CHECK="$SHARED_HOME/.config/systemd/user/im-check-int.service"
assert_file_exists "$UNIT_CHECK" "check-int systemd unit"

if [ -f "$UNIT_CHECK" ]; then
    PORT_CHECK=$(grep '^Environment=PORT=' "$UNIT_CHECK" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_CHECK" ] && [ "$PORT_CHECK" -ge 9601 ] && [ "$PORT_CHECK" -le 9699 ]; then
        pass "check-int: port $PORT_CHECK in 9601-9699"
    else
        fail "check-int: port '$PORT_CHECK' NOT in 9601-9699"
    fi
fi

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/check-int/server.py" \
    'data\["template"\] *= *"checklist"' \
    "check-int server.py forces template discriminator"

# ── Template 3: form ──────────────────────────────────────────────────────────

printf '\n=== Template 3: form (terminal-on-submit) ===\n'

run_script out err ec \
    --slug form-int \
    --template form \
    --message-id "m-form" \
    --conversation-id "c-int" \
    --prompt "Config?" \
    --field "host:text" \
    --field "port:number"

if [ "$ec" = "0" ]; then
    pass "form-int: exits 0"
else
    fail "form-int: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$SHARED_HOME/fleet/interactive-messages/form-int/widget.html"   "form-int widget.html"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/form-int/server.py"     "form-int server.py"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/form-int/metadata.json" "form-int metadata.json"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/form-int/metadata.json" \
    '"template": "form"' \
    "form-int metadata.json discriminator"

UNIT_FORM="$SHARED_HOME/.config/systemd/user/im-form-int.service"
assert_file_exists "$UNIT_FORM" "form-int systemd unit"

if [ -f "$UNIT_FORM" ]; then
    PORT_FORM=$(grep '^Environment=PORT=' "$UNIT_FORM" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_FORM" ] && [ "$PORT_FORM" -ge 9601 ] && [ "$PORT_FORM" -le 9699 ]; then
        pass "form-int: port $PORT_FORM in 9601-9699"
    else
        fail "form-int: port '$PORT_FORM' NOT in 9601-9699"
    fi
fi

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/form-int/server.py" \
    'data\["template"\] *= *"form"' \
    "form-int server.py forces template discriminator"

# ── Template 4: ranking ───────────────────────────────────────────────────────

printf '\n=== Template 4: ranking (terminal-on-submit) ===\n'

run_script out err ec \
    --slug rank-int \
    --template ranking \
    --message-id "m-rank" \
    --conversation-id "c-int" \
    --prompt "Order?" \
    --items "alpha,beta,gamma"

if [ "$ec" = "0" ]; then
    pass "rank-int: exits 0"
else
    fail "rank-int: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$SHARED_HOME/fleet/interactive-messages/rank-int/widget.html"   "rank-int widget.html"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/rank-int/server.py"     "rank-int server.py"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/rank-int/metadata.json" "rank-int metadata.json"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/rank-int/metadata.json" \
    '"template": "ranking"' \
    "rank-int metadata.json discriminator"

UNIT_RANK="$SHARED_HOME/.config/systemd/user/im-rank-int.service"
assert_file_exists "$UNIT_RANK" "rank-int systemd unit"

if [ -f "$UNIT_RANK" ]; then
    PORT_RANK=$(grep '^Environment=PORT=' "$UNIT_RANK" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_RANK" ] && [ "$PORT_RANK" -ge 9601 ] && [ "$PORT_RANK" -le 9699 ]; then
        pass "rank-int: port $PORT_RANK in 9601-9699"
    else
        fail "rank-int: port '$PORT_RANK' NOT in 9601-9699"
    fi
fi

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/rank-int/server.py" \
    'data\["template"\] *= *"ranking"' \
    "rank-int server.py forces template discriminator"

# ── Template 5: list-actions ──────────────────────────────────────────────────

printf '\n=== Template 5: list-actions (terminal-on-submit) ===\n'

run_script out err ec \
    --slug la-int \
    --template list-actions \
    --message-id "m-la" \
    --conversation-id "c-int" \
    --prompt "Review?" \
    --items '["PR1","PR2"]' \
    --actions "Merge,Skip"

if [ "$ec" = "0" ]; then
    pass "la-int: exits 0"
else
    fail "la-int: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$SHARED_HOME/fleet/interactive-messages/la-int/widget.html"   "la-int widget.html"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/la-int/server.py"     "la-int server.py"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/la-int/metadata.json" "la-int metadata.json"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/la-int/metadata.json" \
    '"template": "list-actions"' \
    "la-int metadata.json discriminator"

UNIT_LA="$SHARED_HOME/.config/systemd/user/im-la-int.service"
assert_file_exists "$UNIT_LA" "la-int systemd unit"

if [ -f "$UNIT_LA" ]; then
    PORT_LA=$(grep '^Environment=PORT=' "$UNIT_LA" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_LA" ] && [ "$PORT_LA" -ge 9601 ] && [ "$PORT_LA" -le 9699 ]; then
        pass "la-int: port $PORT_LA in 9601-9699"
    else
        fail "la-int: port '$PORT_LA' NOT in 9601-9699"
    fi
fi

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/la-int/server.py" \
    'data\["template"\] *= *"list-actions"' \
    "la-int server.py forces template discriminator"

# ── Template 6: color-picker ──────────────────────────────────────────────────

printf '\n=== Template 6: color-picker (terminal-on-click) ===\n'

run_script out err ec \
    --slug cp-int \
    --template color-picker \
    --message-id "m-cp" \
    --conversation-id "c-int" \
    --prompt "Color?"

if [ "$ec" = "0" ]; then
    pass "cp-int: exits 0"
else
    fail "cp-int: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$SHARED_HOME/fleet/interactive-messages/cp-int/widget.html"   "cp-int widget.html"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/cp-int/server.py"     "cp-int server.py"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/cp-int/metadata.json" "cp-int metadata.json"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/cp-int/metadata.json" \
    '"template": "color-picker"' \
    "cp-int metadata.json discriminator"

UNIT_CP="$SHARED_HOME/.config/systemd/user/im-cp-int.service"
assert_file_exists "$UNIT_CP" "cp-int systemd unit"

if [ -f "$UNIT_CP" ]; then
    PORT_CP=$(grep '^Environment=PORT=' "$UNIT_CP" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_CP" ] && [ "$PORT_CP" -ge 9601 ] && [ "$PORT_CP" -le 9699 ]; then
        pass "cp-int: port $PORT_CP in 9601-9699"
    else
        fail "cp-int: port '$PORT_CP' NOT in 9601-9699"
    fi
fi

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/cp-int/server.py" \
    'data\["template"\] *= *"color-picker"' \
    "cp-int server.py forces template discriminator"

# ── Template 7: draft ─────────────────────────────────────────────────────────

printf '\n=== Template 7: draft (terminal-on-submit) ===\n'

run_script out err ec \
    --slug draft-int \
    --template draft \
    --message-id "m-draft" \
    --conversation-id "c-int" \
    --prompt "Email to Bob" \
    --draft "Hi Bob, quick note..."

if [ "$ec" = "0" ]; then
    pass "draft-int: exits 0"
else
    fail "draft-int: expected exit 0, got $ec — stderr: $err"
fi

assert_file_exists "$SHARED_HOME/fleet/interactive-messages/draft-int/widget.html"   "draft-int widget.html"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/draft-int/server.py"     "draft-int server.py"
assert_file_exists "$SHARED_HOME/fleet/interactive-messages/draft-int/metadata.json" "draft-int metadata.json"

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/draft-int/metadata.json" \
    '"template": "draft"' \
    "draft-int metadata.json discriminator"

UNIT_DRAFT="$SHARED_HOME/.config/systemd/user/im-draft-int.service"
assert_file_exists "$UNIT_DRAFT" "draft-int systemd unit"

if [ -f "$UNIT_DRAFT" ]; then
    PORT_DRAFT=$(grep '^Environment=PORT=' "$UNIT_DRAFT" | sed 's/^Environment=PORT=//')
    if [ -n "$PORT_DRAFT" ] && [ "$PORT_DRAFT" -ge 9601 ] && [ "$PORT_DRAFT" -le 9699 ]; then
        pass "draft-int: port $PORT_DRAFT in 9601-9699"
    else
        fail "draft-int: port '$PORT_DRAFT' NOT in 9601-9699"
    fi
fi

assert_file_contains \
    "$SHARED_HOME/fleet/interactive-messages/draft-int/server.py" \
    'data\["template"\] *= *"draft"' \
    "draft-int server.py forces template discriminator"

# ── Cross-cutting assertions ──────────────────────────────────────────────────

printf '\n=== Cross-cutting assertions ===\n'

# 1. Exactly 7 distinct systemd unit files
# Use find rather than a quoted glob — a quoted path+glob doesn't expand in bash.
UNIT_COUNT=$(find "$SHARED_HOME/.config/systemd/user" -name "im-*.service" 2>/dev/null | wc -l)
if [ "$UNIT_COUNT" -eq 7 ]; then
    pass "cross: exactly 7 systemd unit files (got $UNIT_COUNT)"
else
    fail "cross: expected 7 systemd unit files, got $UNIT_COUNT"
fi

# 2. All 7 ports are distinct
ALL_PORTS=$(find "$SHARED_HOME/.config/systemd/user" -name "im-*.service" -exec grep '^Environment=PORT=' {} \; 2>/dev/null \
            | sed 's/^Environment=PORT=//' | sort -u)
UNIQUE_PORT_COUNT=$(printf '%s\n' "$ALL_PORTS" | grep -c .)
if [ "$UNIQUE_PORT_COUNT" -eq 7 ]; then
    pass "cross: 7 distinct ports claimed ($(printf '%s' "$ALL_PORTS" | tr '\n' ' '))"
else
    fail "cross: expected 7 distinct ports, got $UNIQUE_PORT_COUNT (ports: $(printf '%s' "$ALL_PORTS" | tr '\n' ' '))"
fi

# 3. All ports in 9601-9699
PORT_RANGE_FAIL=0
while IFS= read -r p; do
    if ! ( [ "$p" -ge 9601 ] && [ "$p" -le 9699 ] ); then
        PORT_RANGE_FAIL=1
        fail "cross: port $p is out of range 9601-9699"
    fi
done <<< "$ALL_PORTS"
if [ "$PORT_RANGE_FAIL" = "0" ]; then
    pass "cross: all 7 ports in range 9601-9699"
fi

# 4. All 7 widget folders are distinct (slug isolation)
# Use find rather than a quoted glob — a quoted path+glob with trailing / doesn't expand in bash.
WIDGET_COUNT=$(find "$SHARED_HOME/fleet/interactive-messages" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
if [ "$WIDGET_COUNT" -eq 7 ]; then
    pass "cross: exactly 7 widget folders (slug isolation confirmed)"
else
    fail "cross: expected 7 widget folders, got $WIDGET_COUNT"
fi

# 5. Zero type="radio" across all widget.html files (arc-wide affordance invariant)
RADIO_COUNT=$(find "$SHARED_HOME/fleet/interactive-messages" -name "widget.html" -exec grep -c 'type="radio"' {} + 2>/dev/null \
              | awk -F: '{sum+=$NF} END{print sum+0}')
if [ "$RADIO_COUNT" -eq 0 ]; then
    pass 'cross: zero type="radio" across all 7 widget.html files (affordance invariant)'
else
    fail "cross: found $RADIO_COUNT occurrence(s) of type=\"radio\" across widget.html files — affordance violation"
fi

# 6. Every widget.html targets window.location.origin in postMessage (never "*" as target)
# Grep for postMessage call with wildcard origin — excludes comment text like 'never "*"'
STAR_COUNT=$(find "$SHARED_HOME/fleet/interactive-messages" -name "widget.html" \
             -exec grep -c 'postMessage.*"\*"' {} + 2>/dev/null \
             | awk -F: '{sum+=$NF} END{print sum+0}')
if [ "$STAR_COUNT" -eq 0 ]; then
    pass 'cross: no postMessage("*") wildcard origin found in any widget.html'
else
    fail "cross: found $STAR_COUNT postMessage(\"*\") wildcard origin(s) — security violation"
fi

ORIGIN_COUNT=$(find "$SHARED_HOME/fleet/interactive-messages" -name "widget.html" \
               -exec grep -l 'window.location.origin' {} \; 2>/dev/null | wc -l)
if [ "$ORIGIN_COUNT" -eq 7 ]; then
    pass "cross: all 7 widget.html files use window.location.origin in postMessage"
else
    fail "cross: expected 7 widget.html files with window.location.origin, found $ORIGIN_COUNT"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

TOTAL=$((PASS + FAIL))
printf '\n=================================================\n'
printf 'all-templates-scaffold.test.sh: PASS: %d, FAIL: %d (total %d)\n' "$PASS" "$FAIL" "$TOTAL"

if [ "$FAIL" -gt 0 ]; then
    printf '\nFailed tests:%b\n' "$FAILURES"
    exit 1
fi

printf 'All tests passed.\n'
exit 0
