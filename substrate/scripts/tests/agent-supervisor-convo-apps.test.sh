#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2030,SC2031
# (SC2317 false positive: test functions are called indirectly via run_test)
#
# Test driver for the convo-scoped-apps additions to agent-supervisor.sh:
#   - retire_identity_apps()          stop + stash each conversation app on identity retire
#   - restore_identity_apps()         restore stashed conversation apps on identity un-archive
#   - unarchive_current_style_app()   sidebar-app un-archive for the five-unit layout,
#                                     reached through scan_app_unarchive_requested_sentinels()
#
# app-units.sh is replaced by a stub that records each call in $CALLS, so these tests
# check the supervisor's decisions, not systemd. app-units.sh itself is exercised end to
# end on a real box (see the app-development skill).
#
# Usage: bash substrate/scripts/tests/agent-supervisor-convo-apps.test.sh   (from repo root)

export AGENT_SUPERVISOR_LIB_ONLY=1
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"
[ -f "$SUPERVISOR" ] || { printf 'FATAL: supervisor not found at %s\n' "$SUPERVISOR" >&2; exit 1; }

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

# Scratch tree + stub app-units.sh. Echoes the scratch root.
setup() {
  local s; s=$(mktemp -d)
  mkdir -p "$s/identities" "$s/identities-archive" "$s/apps" "$s/apps-archive" "$s/units" "$s/.state"
  cat > "$s/app-units-stub.sh" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$s/calls"
exit "\${STUB_RC:-0}"
EOF
  chmod +x "$s/app-units-stub.sh"
  : > "$s/calls"
  printf '%s' "$s"
}

source_supervisor() {
  local s="$1"
  export AGENT_IDENTITIES_DIR="$s/identities"
  export AGENT_IDENTITIES_ARCHIVE_DIR="$s/identities-archive"
  export AGENT_ROLES_DIR="$s/roles"
  export AGENT_ROLES_ARCHIVE_DIR="$s/roles-archive"
  export AGENT_APPS_DIR="$s/apps"
  export AGENT_APPS_ARCHIVE_DIR="$s/apps-archive"
  export AGENT_SYSTEMD_UNIT_DIR="$s/units"
  export AGENT_APP_CREATE_LOCK="$s/.create-lock"
  export AGENT_APP_UNITS_SCRIPT="$s/app-units-stub.sh"
  export AGENT_SYSTEMCTL_BIN=true
  export DORMANCY_STATE_DIR="$s/.state"
  export SUPERVISOR_LOG="$s/supervisor.log"
  # shellcheck disable=SC1090
  source "$SUPERVISOR" 2>/dev/null || true
}

test_retire_stashes_and_uninstalls_each_app() {
  local s; s=$(setup)
  mkdir -p "$s/identities/alpha/apps/tally" "$s/identities/alpha/apps/notes"
  ( source_supervisor "$s"; retire_identity_apps alpha "$s/identities/alpha" >/dev/null 2>&1 )
  assert_eq "stash notes $s/identities/alpha/apps/notes
uninstall notes
stash tally $s/identities/alpha/apps/tally
uninstall tally" "$(cat "$s/calls")" "calls"
  rm -rf "$s"
}

test_retire_uninstalls_even_when_stash_fails() {
  local s; s=$(setup)
  mkdir -p "$s/identities/alpha/apps/tally"
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$*" >> "%s/calls"\n[ "$1" = stash ] && exit 1\nexit 0\n' "$s" > "$s/app-units-stub.sh"
  ( source_supervisor "$s"; retire_identity_apps alpha "$s/identities/alpha" >/dev/null 2>&1 )
  assert_eq "stash tally $s/identities/alpha/apps/tally
uninstall tally" "$(cat "$s/calls")" "uninstall still runs"
  rm -rf "$s"
}

test_retire_without_apps_is_a_noop() {
  local s; s=$(setup)
  mkdir -p "$s/identities/alpha"
  ( source_supervisor "$s"; retire_identity_apps alpha "$s/identities/alpha" >/dev/null 2>&1 )
  assert_eq "" "$(cat "$s/calls")" "no calls"
  rm -rf "$s"
}

test_retire_skips_invalid_folder_names() {
  local s; s=$(setup)
  mkdir -p "$s/identities/alpha/apps/Bad_Name" "$s/identities/alpha/apps/good"
  ( source_supervisor "$s"; retire_identity_apps alpha "$s/identities/alpha" >/dev/null 2>&1 )
  assert_eq "stash good $s/identities/alpha/apps/good
uninstall good" "$(cat "$s/calls")" "only the valid slug"
  rm -rf "$s"
}

test_restore_only_touches_stashed_apps() {
  local s; s=$(setup)
  mkdir -p "$s/identities/alpha/apps/tally" "$s/identities/alpha/apps/fresh"
  : > "$s/identities/alpha/apps/tally/app-tally.socket.archived"
  ( source_supervisor "$s"; restore_identity_apps alpha "$s/identities/alpha" >/dev/null 2>&1 )
  assert_eq "restore tally $s/identities/alpha/apps/tally" "$(cat "$s/calls")" "calls"
  rm -rf "$s"
}

stash_current_style() {   # <archive-dir> <slug> <port>
  printf '[Socket]\nListenStream=127.0.0.1:%s\n' "$3" > "$1/app-$2.socket.archived"
  printf '[Service]\nEnvironment=PORT=%s\n' "$(( $3 + 10000 ))" > "$1/app-$2.service.archived"
}

test_unarchive_current_style_moves_and_restores() {
  local s; s=$(setup)
  mkdir -p "$s/apps-archive/tally"
  stash_current_style "$s/apps-archive/tally" tally 9510
  : > "$s/apps-archive/tally/.unarchive-requested"
  ( source_supervisor "$s"; scan_app_unarchive_requested_sentinels >/dev/null 2>&1 )
  assert_exists "$s/apps/tally" "folder moved to live"
  assert_absent "$s/apps-archive/tally" "archive slot emptied"
  assert_absent "$s/apps/tally/.unarchive-requested" "sentinel deleted"
  assert_eq "restore tally $s/apps/tally" "$(cat "$s/calls")" "restore called"
  rm -rf "$s"
}

test_unarchive_current_style_refuses_taken_port() {
  local s; s=$(setup)
  mkdir -p "$s/apps-archive/tally"
  stash_current_style "$s/apps-archive/tally" tally 9510
  : > "$s/apps-archive/tally/.unarchive-requested"
  printf '[Socket]\nListenStream=127.0.0.1:9510\n' > "$s/units/app-other.socket"
  ( source_supervisor "$s"; scan_app_unarchive_requested_sentinels >/dev/null 2>&1 )
  assert_exists "$s/apps-archive/tally" "folder stays archived"
  assert_absent "$s/apps-archive/tally/.unarchive-requested" "sentinel deleted (permanent refuse)"
  assert_eq "" "$(cat "$s/calls")" "no restore"
  rm -rf "$s"
}

test_unarchive_current_style_refuses_old_style_port_holder() {
  local s; s=$(setup)
  mkdir -p "$s/apps-archive/tally"
  stash_current_style "$s/apps-archive/tally" tally 9510
  : > "$s/apps-archive/tally/.unarchive-requested"
  printf '[Service]\nEnvironment=PORT=9510\n' > "$s/units/app-legacy.service"
  ( source_supervisor "$s"; scan_app_unarchive_requested_sentinels >/dev/null 2>&1 )
  assert_exists "$s/apps-archive/tally" "folder stays archived"
  assert_eq "" "$(cat "$s/calls")" "no restore"
  rm -rf "$s"
}

test_unarchive_old_style_does_not_use_app_units() {
  local s; s=$(setup)
  mkdir -p "$s/apps-archive/legacy"
  printf '[Service]\nWorkingDirectory=%s\nEnvironment=PORT=9520\n' "$s/apps/legacy" > "$s/apps-archive/legacy/app-legacy.service.archived"
  : > "$s/apps-archive/legacy/.unarchive-requested"
  ( source_supervisor "$s"; scan_app_unarchive_requested_sentinels >/dev/null 2>&1 )
  assert_exists "$s/apps/legacy" "folder moved to live"
  assert_exists "$s/units/app-legacy.service" "old-style unit installed by the existing path"
  assert_eq "" "$(cat "$s/calls")" "app-units.sh untouched"
  rm -rf "$s"
}

printf 'agent-supervisor convo-apps tests\n'
run_test test_retire_stashes_and_uninstalls_each_app
run_test test_retire_uninstalls_even_when_stash_fails
run_test test_retire_without_apps_is_a_noop
run_test test_retire_skips_invalid_folder_names
run_test test_restore_only_touches_stashed_apps
run_test test_unarchive_current_style_moves_and_restores
run_test test_unarchive_current_style_refuses_taken_port
run_test test_unarchive_current_style_refuses_old_style_port_holder
run_test test_unarchive_old_style_does_not_use_app_units

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
