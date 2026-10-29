#!/usr/bin/env bash
# Hermetic test driver for substrate/scripts/machine-people.sh — the
# SessionStart hook that prints ~/fleet/host/people.md into every session.
#
# Usage: bash substrate/scripts/tests/machine-people.test.sh  (from repo root)
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$(cd "$SCRIPT_DIR/../../.." && pwd)/substrate/scripts/machine-people.sh"
FAIL=0
fail() { echo "FAIL: $1"; FAIL=1; }
pass() { echo "ok: $1"; }

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PAYLOAD='{"hook_event_name":"SessionStart","source":"startup"}'

out="$(printf '%s' "$PAYLOAD" | HOME="$T" bash "$HOOK")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && pass "missing file: silent, exit 0" || fail "missing file (rc=$rc out=$out)"

mkdir -p "$T/fleet/host"; : > "$T/fleet/host/people.md"
out="$(printf '%s' "$PAYLOAD" | HOME="$T" bash "$HOOK")"; rc=$?
[ "$rc" -eq 0 ] && [ -z "$out" ] && pass "empty file: silent, exit 0" || fail "empty file (rc=$rc out=$out)"

printf 'People on this machine — x\n\n- amy · relay ID @amy:x\n' > "$T/fleet/host/people.md"
for src in startup resume clear compact; do
  out="$(printf '{"hook_event_name":"SessionStart","source":"%s"}' "$src" | HOME="$T" bash "$HOOK")"; rc=$?
  [ "$rc" -eq 0 ] && [ "$out" = "$(cat "$T/fleet/host/people.md")" ] && pass "source=$src prints the file" || fail "source=$src (rc=$rc)"
done

chmod 000 "$T/fleet/host/people.md"
out="$(printf '%s' "$PAYLOAD" | HOME="$T" bash "$HOOK" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && pass "unreadable file: exit 0" || fail "unreadable file (rc=$rc)"
chmod 644 "$T/fleet/host/people.md"

exit "$FAIL"
