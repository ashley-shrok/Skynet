#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317
#
# Test driver for substrate/skills/app-development/app-units.sh — the helper that owns
# how an app is run under systemd. Hermetic: unit dir and fleet dir are scratch folders
# (APP_UNITS_UNIT_DIR / APP_UNITS_FLEET_DIR) and systemctl is a stub that records calls
# (APP_UNITS_SYSTEMCTL). The real systemd behaviour (sleep, wake, marker, crash restart)
# was exercised end to end on a box when the layout was built.
#
# Usage: bash substrate/scripts/tests/app-units.test.sh   (from repo root)

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
UNITS="$REPO_ROOT/substrate/skills/app-development/app-units.sh"

PASS=0
FAIL=0
FAILURES=()
CURRENT_TEST=""

fail() { FAILURES+=("${CURRENT_TEST:-unknown}: ${1:-unknown failure}"); FAIL=$((FAIL + 1)); }
assert_eq() { [ "$1" = "$2" ] || fail "${3:-assert_eq}: expected='$1' got='$2'"; }
assert_exists() { [ -e "$1" ] || fail "${2:-assert_exists}: missing $1"; }
assert_absent() { [ ! -e "$1" ] || fail "${2:-assert_absent}: unexpectedly present $1"; }

run_test() {
  local fn="$1" before=$FAIL
  CURRENT_TEST="$fn"
  "$fn"
  if [ "$FAIL" -eq "$before" ]; then PASS=$((PASS + 1)); printf '  OK   %s\n' "$fn"; else printf '  FAIL %s\n' "$fn"; fi
  CURRENT_TEST=""
}

S=""
setup() {
  S=$(mktemp -d)
  mkdir -p "$S/units" "$S/fleet/apps" "$S/fleet/apps-archive" "$S/fleet/identities/alpha/apps" "$S/fleet/identities-archive"
  cat > "$S/systemctl" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$S/calls"
EOF
  chmod +x "$S/systemctl"
  : > "$S/calls"
  export APP_UNITS_UNIT_DIR="$S/units" APP_UNITS_FLEET_DIR="$S/fleet" APP_UNITS_SYSTEMCTL="$S/systemctl"
}
teardown() { rm -rf "$S"; }
u() { bash "$UNITS" "$@" 2>/dev/null; }

test_write_renders_five_units() {
  setup
  mkdir -p "$S/fleet/apps/tally"
  u write tally "$S/fleet/apps/tally" 9512
  for f in app-tally.socket app-tally-relay.service app-tally.service app-tally-marker.path app-tally-boot.service; do
    assert_exists "$S/units/$f" "$f"
  done
  assert_eq "ListenStream=127.0.0.1:9512" "$(grep ^ListenStream "$S/units/app-tally.socket")" "public port on the socket"
  assert_eq "Environment=PORT=19512" "$(grep ^Environment=PORT "$S/units/app-tally.service")" "private port on the app"
  assert_eq "ExecStart=/usr/lib/systemd/systemd-socket-proxyd 127.0.0.1:19512" "$(grep ^ExecStart "$S/units/app-tally-relay.service")" "relay target"
  assert_eq "PathChanged=$S/fleet/apps/tally/.may-sleep" "$(grep ^PathChanged "$S/units/app-tally-marker.path")" "marker watch"
  assert_eq "ConditionPathExists=!$S/fleet/apps/tally/.may-sleep" "$(grep ^ConditionPathExists "$S/units/app-tally-boot.service")" "boot check"
  assert_eq "Restart=on-failure" "$(grep ^Restart= "$S/units/app-tally.service")" "clean exit stays stopped"
  assert_eq "0" "$(grep -c __ "$S/units/app-tally.service")" "no unrendered markers"
  teardown
}

test_write_rejects_out_of_range_port() {
  setup
  mkdir -p "$S/fleet/apps/tally"
  u write tally "$S/fleet/apps/tally" 19512; local rc=$?
  assert_eq "1" "$rc" "exit code"
  assert_absent "$S/units/app-tally.socket" "nothing written"
  teardown
}

test_find_and_owner() {
  setup
  mkdir -p "$S/fleet/apps/side" "$S/fleet/identities/alpha/apps/convo"
  assert_eq "$S/fleet/apps/side" "$(u find side)" "sidebar folder"
  assert_eq "$S/fleet/identities/alpha/apps/convo" "$(u find convo)" "conversation folder"
  assert_eq "" "$(u owner side)" "sidebar app has no owner"
  assert_eq "alpha" "$(u owner convo)" "conversation app owner"
  u find nope; assert_eq "1" "$?" "missing app"
  teardown
}

test_port_new_old_and_stashed() {
  setup
  mkdir -p "$S/fleet/apps/new" "$S/fleet/apps-archive/gone"
  u write new "$S/fleet/apps/new" 9530
  printf '[Service]\nEnvironment=PORT=9531\n' > "$S/units/app-old.service"
  printf '[Socket]\nListenStream=127.0.0.1:9532\n' > "$S/fleet/apps-archive/gone/app-gone.socket.archived"
  assert_eq "9530" "$(u port new)" "new-style from socket"
  assert_eq "9531" "$(u port old)" "old-style from service"
  assert_eq "9532" "$(u port gone "$S/fleet/apps-archive/gone")" "from stash"
  teardown
}

test_used_ports_covers_live_archived_and_stashed() {
  setup
  mkdir -p "$S/fleet/apps/new" "$S/fleet/apps-archive/old" "$S/fleet/apps-archive/gone" "$S/fleet/identities-archive/beta/apps/kept"
  u write new "$S/fleet/apps/new" 9540
  printf '[Service]\nEnvironment=PORT=9541\n' > "$S/units/app-legacy.service"
  printf '[Service]\nEnvironment=PORT=9542\n' > "$S/fleet/apps-archive/old/app-old.service.archived"
  printf '[Socket]\nListenStream=127.0.0.1:9543\n' > "$S/fleet/apps-archive/gone/app-gone.socket.archived"
  printf '[Socket]\nListenStream=127.0.0.1:9544\n' > "$S/fleet/identities-archive/beta/apps/kept/app-kept.socket.archived"
  local got; got=$(u used-ports | grep -E '^95[0-9]{2}$' | tr '\n' ' ')
  assert_eq "9540 9541 9542 9543 9544 " "$got" "public ports"
  teardown
}

test_slug_taken_everywhere() {
  setup
  mkdir -p "$S/fleet/apps/a" "$S/fleet/apps-archive/b" "$S/fleet/identities/alpha/apps/c" "$S/fleet/identities-archive/beta/apps/d"
  printf 'x\n' > "$S/units/app-e.service"
  local s
  for s in a b c d e; do u slug-taken "$s"; assert_eq "0" "$?" "$s taken"; done
  u slug-taken free; assert_eq "1" "$?" "free slug"
  teardown
}

test_install_enables_and_starts() {
  setup
  mkdir -p "$S/fleet/apps/tally"
  u install tally "$S/fleet/apps/tally" 9550
  local calls; calls=$(cat "$S/calls")
  printf '%s' "$calls" | grep -q "^--user daemon-reload$" || fail "daemon-reload"
  printf '%s' "$calls" | grep -q "^--user enable app-tally.socket app-tally-marker.path app-tally-boot.service$" || fail "enable"
  printf '%s' "$calls" | grep -q "^--user start app-tally.socket app-tally-marker.path$" || fail "start socket + path"
  printf '%s' "$calls" | grep -q "^--user start app-tally-boot.service$" || fail "boot check run once"
  teardown
}

test_uninstall_removes_both_styles() {
  setup
  mkdir -p "$S/fleet/apps/tally"
  u write tally "$S/fleet/apps/tally" 9560
  printf 'x\n' > "$S/units/app-old.service"
  u uninstall tally
  u uninstall old
  assert_eq "0" "$(ls "$S/units" | wc -l | tr -d ' ')" "no unit files left"
  teardown
}

test_stash_then_restore_round_trip() {
  setup
  mkdir -p "$S/fleet/identities/alpha/apps/tally"
  local dir="$S/fleet/identities/alpha/apps/tally"
  u write tally "$dir" 9570
  u stash tally "$dir"
  assert_eq "5" "$(ls "$dir"/*.archived | wc -l | tr -d ' ')" "five stashed units"
  u uninstall tally
  # Simulate the identity having moved: restore renders for the CURRENT folder.
  mkdir -p "$S/fleet/elsewhere" && mv "$dir" "$S/fleet/elsewhere/tally"
  u restore tally "$S/fleet/elsewhere/tally"
  assert_eq "ListenStream=127.0.0.1:9570" "$(grep ^ListenStream "$S/units/app-tally.socket")" "same port"
  assert_eq "WorkingDirectory=$S/fleet/elsewhere/tally" "$(grep ^WorkingDirectory "$S/units/app-tally.service")" "new folder"
  assert_eq "0" "$(ls "$S/fleet/elsewhere/tally"/*.archived 2>/dev/null | wc -l | tr -d ' ')" "stash removed"
  teardown
}

test_restore_old_style_rewrites_folder() {
  setup
  mkdir -p "$S/fleet/apps/legacy"
  printf '[Service]\nWorkingDirectory=/old/place\nReadWritePaths=/old/place\nEnvironment=PORT=9580\n' > "$S/fleet/apps/legacy/app-legacy.service.archived"
  u restore legacy "$S/fleet/apps/legacy"
  assert_eq "WorkingDirectory=$S/fleet/apps/legacy" "$(grep ^WorkingDirectory "$S/units/app-legacy.service")" "folder rewritten"
  assert_absent "$S/units/app-legacy.socket" "stays old-style"
  teardown
}

test_invalid_slug_rejected() {
  setup
  u find "../etc"; assert_eq "1" "$?" "path traversal"
  u uninstall "Bad"; assert_eq "1" "$?" "uppercase"
  teardown
}

printf 'app-units.sh tests\n'
run_test test_write_renders_five_units
run_test test_write_rejects_out_of_range_port
run_test test_find_and_owner
run_test test_port_new_old_and_stashed
run_test test_used_ports_covers_live_archived_and_stashed
run_test test_slug_taken_everywhere
run_test test_install_enables_and_starts
run_test test_uninstall_removes_both_styles
run_test test_stash_then_restore_round_trip
run_test test_restore_old_style_rewrites_folder
run_test test_invalid_slug_rejected

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
