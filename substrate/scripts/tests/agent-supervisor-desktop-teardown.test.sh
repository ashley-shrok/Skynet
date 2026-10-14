#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317
# Covers the supervisor's desktop teardown — an identity's agent-desktop@ unit must not outlive
# its claude (dormancy) or its identity folder (archive):
#
#   T-01  — stop_identity_desktop, no desktop ever allocated → agent-desktop not called
#   T-02  — stop_identity_desktop, desktop allocated         → `down --identity <name>` called
#   T-03  — stop_identity_desktop, agent-desktop fails       → still returns 0 (never blocks caller)
#   T-04  — desktop_user_has_control: fresh lease true, stale lease false, no lease false
#   T-05  — reap_orphan_desktops stops only units whose identity folder is gone (escaped names)
#   T-06  — reap_orphan_desktops under DRY_RUN stops nothing
#   T-07  — static: retire_identity stops the desktop BEFORE the folder move
#   T-08  — static: do_kill_dormant stops the desktop, guarded by the control lease
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-desktop-teardown.test.sh
#   Run from the repo root.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"

if [ ! -f "$SUPERVISOR" ]; then
  printf 'FATAL: supervisor not found at %s\n' "$SUPERVISOR" >&2
  exit 1
fi

PASS=0
FAIL=0
FAILURES=()
CURRENT_TEST=""

pass() { PASS=$((PASS+1)); printf 'PASS: %s\n' "$CURRENT_TEST"; }
fail() {
  FAIL=$((FAIL+1))
  FAILURES+=("$CURRENT_TEST: $1")
  printf 'FAIL: %s — %s\n' "$CURRENT_TEST" "$1" >&2
}

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

export AGENT_SUPERVISOR_LIB_ONLY=1
export AGENT_IDENTITIES_DIR="$SCRATCH/identities"
export AGENT_IDENTITIES_ARCHIVE_DIR="$SCRATCH/identities-archive"
export DORMANCY_STATE_DIR="$SCRATCH/.state"
export AGENT_DESKTOP_BIN="$SCRATCH/stub-agent-desktop"
export AGENT_SYSTEMCTL_BIN="$SCRATCH/stub-systemctl"
DESKTOP_CALLS="$SCRATCH/agent-desktop.calls"
SYSTEMCTL_CALLS="$SCRATCH/systemctl.calls"
mkdir -p "$AGENT_IDENTITIES_DIR" "$DORMANCY_STATE_DIR"

# stub agent-desktop — records args; exit code from $SCRATCH/agent-desktop.rc (default 0).
cat > "$AGENT_DESKTOP_BIN" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$DESKTOP_CALLS"
exit "\$(cat "$SCRATCH/agent-desktop.rc" 2>/dev/null || echo 0)"
EOF
chmod +x "$AGENT_DESKTOP_BIN"

# stub systemctl — `list-units` prints $SCRATCH/units.txt; everything else is recorded.
cat > "$AGENT_SYSTEMCTL_BIN" <<EOF
#!/usr/bin/env bash
case " \$* " in
  *" list-units "*) cat "$SCRATCH/units.txt" 2>/dev/null ;;
  *) printf '%s\n' "\$*" >> "$SYSTEMCTL_CALLS" ;;
esac
exit 0
EOF
chmod +x "$AGENT_SYSTEMCTL_BIN"

# shellcheck disable=SC1090
source "$SUPERVISOR" 2>/dev/null || true
log() { :; }

for fn in stop_identity_desktop desktop_user_has_control reap_orphan_desktops; do
  if ! declare -F "$fn" >/dev/null 2>&1; then
    printf 'FATAL: %s not defined after sourcing supervisor\n' "$fn" >&2
    exit 1
  fi
done

reset_calls() { rm -f "$DESKTOP_CALLS" "$SYSTEMCTL_CALLS" "$SCRATCH/agent-desktop.rc" "$SCRATCH/units.txt"; }
plant_identity() { mkdir -p "$AGENT_IDENTITIES_DIR/$1"; }
plant_desktop() { mkdir -p "$AGENT_IDENTITIES_DIR/$1/desktop"; echo 100 > "$AGENT_IDENTITIES_DIR/$1/desktop/display"; }

# fn_body <name> — the source text of a supervisor function, from its header to the closing brace.
fn_body() { awk -v f="$1" '$0 ~ "^"f"\\(\\) *\\{" {on=1} on {print} on && /^}/ {exit}' "$SUPERVISOR"; }

CURRENT_TEST="T-01 no desktop allocated → agent-desktop not called"
reset_calls; plant_identity alice
stop_identity_desktop alice dormant
if [ -e "$DESKTOP_CALLS" ]; then fail "agent-desktop called: $(cat "$DESKTOP_CALLS")"; else pass; fi

CURRENT_TEST="T-02 desktop allocated → down --identity <name>"
reset_calls; plant_identity bob; plant_desktop bob
stop_identity_desktop bob retire
got="$(cat "$DESKTOP_CALLS" 2>/dev/null)"
if [ "$got" = "down --identity bob" ]; then pass; else fail "calls were: '$got'"; fi

CURRENT_TEST="T-03 agent-desktop failure never fails the caller"
reset_calls; echo 1 > "$SCRATCH/agent-desktop.rc"
if stop_identity_desktop bob retire; then pass; else fail "returned non-zero"; fi

CURRENT_TEST="T-04 desktop_user_has_control lease freshness"
plant_identity carol; plant_desktop carol
lock="$AGENT_IDENTITIES_DIR/carol/desktop/control-lock"
ok=1
desktop_user_has_control carol && { ok=0; fail "no lease read as control"; }
touch "$lock"
desktop_user_has_control carol || { ok=0; fail "fresh lease read as no control"; }
touch -d '-10 minutes' "$lock"
desktop_user_has_control carol && { ok=0; fail "stale lease read as control"; }
[ "$ok" = 1 ] && pass

CURRENT_TEST="T-05 reap stops only units whose identity folder is gone"
reset_calls; plant_identity live-agent-2
cat > "$SCRATCH/units.txt" <<'EOF'
agent-desktop@live\x2dagent\x2d2.service loaded active running Agent desktop — virtual X display + VNC for identity live-agent-2
agent-desktop@gone\x2dagent\x2d3.service loaded active running Agent desktop — virtual X display + VNC for identity gone-agent-3
EOF
reap_orphan_desktops
got="$(cat "$SYSTEMCTL_CALLS" 2>/dev/null)"
if [ "$got" = '--user stop agent-desktop@gone\x2dagent\x2d3.service' ]; then pass; else fail "calls were: '$got'"; fi

CURRENT_TEST="T-06 reap under DRY_RUN stops nothing"
rm -f "$SYSTEMCTL_CALLS"
DRY_RUN=1 reap_orphan_desktops
if [ -e "$SYSTEMCTL_CALLS" ]; then fail "systemctl called: $(cat "$SYSTEMCTL_CALLS")"; else pass; fi

CURRENT_TEST="T-07 retire_identity stops the desktop before the folder move"
body="$(fn_body retire_identity)"
stop_ln="$(printf '%s\n' "$body" | grep -n 'stop_identity_desktop "\$name" "retire"' | head -1 | cut -d: -f1)"
mv_ln="$(printf '%s\n' "$body" | grep -n 'mv "\$iddir" "\$archdir"' | head -1 | cut -d: -f1)"
if [ -n "$stop_ln" ] && [ -n "$mv_ln" ] && [ "$stop_ln" -lt "$mv_ln" ]; then pass
else fail "stop line '$stop_ln' not before mv line '$mv_ln'"; fi

CURRENT_TEST="T-08 do_kill_dormant stops the desktop unless the user has control"
body="$(fn_body do_kill_dormant)"
if printf '%s\n' "$body" | grep -q 'desktop_user_has_control "\$name"' \
   && printf '%s\n' "$body" | grep -q 'stop_identity_desktop "\$name" "dormant"'; then pass
else fail "do_kill_dormant missing control-lease guard or desktop stop"; fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  %s\n' "${FAILURES[@]}" >&2
  exit 1
fi
exit 0
