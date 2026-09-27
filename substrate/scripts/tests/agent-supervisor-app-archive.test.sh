#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2030,SC2031
# (SC2317 false positive: test functions are called indirectly via run_test)
# (SC2030/SC2031 intentional: STUB_APPS_* exports live inside the per-test
#  ( ... ) subshell for hermeticity; not "lost", scoped by design.)
#
# Test driver for the app-archive shape's scan_app_archive_requested_sentinels()
# in agent-supervisor.sh.
#
# Covers:
#   - happy path: sentinel present + stub archive script succeeds → script
#     invoked with slug arg, sentinel deleted from archived tree, log lines
#     match "archive-app.sh succeeded"
#   - failure: stub archive script exits non-zero → sentinel retained in live
#     tree, log line matches "FAILED"
#   - missing script: APP_ARCHIVE_SCRIPT path is not executable → log line
#     matches "not found", sentinel retained
#   - no-op: sentinel absent on an app folder → nothing happens, no log
#     lines match archive-app.sh
#
# Exits 0 on all-pass; exits 1 on any failure with a diagnostic naming the
# failing test.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-app-archive.test.sh
#   Run from the repo root. Override supervisor path:
#     SUPERVISOR=/path/to/agent-supervisor.sh bash <this>
#
# Isolation: every test that sources the supervisor exports:
#   AGENT_APPS_DIR=<scratch>-apps
#   AGENT_APPS_ARCHIVE_DIR=<scratch>-apps-archive
#   AGENT_APP_ARCHIVE_SCRIPT=<stub script path>
#   AGENT_SUPERVISOR_LIB_ONLY=1

export AGENT_SUPERVISOR_LIB_ONLY=1

set -u

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"

if [ ! -f "$SUPERVISOR" ]; then
  printf 'FATAL: supervisor not found at %s\n' "$SUPERVISOR" >&2
  exit 1
fi

# ---- test state ----
PASS=0
FAIL=0
FAILURES=()
CURRENT_TEST=""

fail() {
  FAILURES+=("${CURRENT_TEST:-unknown}: ${1:-unknown failure}")
  FAIL=$((FAIL + 1))
}

assert_eq() {
  local expected="$1" actual="$2" msg="${3:-assert_eq}"
  if [ "$expected" != "$actual" ]; then
    fail "$msg: expected='$expected' got='$actual'"
  fi
}

assert_file() {
  local p="$1" msg="${2:-assert_file}"
  [ -f "$p" ] || fail "$msg: file missing at $p"
}

assert_nofile() {
  local p="$1" msg="${2:-assert_nofile}"
  [ ! -e "$p" ] || fail "$msg: file present at $p (expected absent)"
}

assert_grep() {
  local pattern="$1" haystack="$2" msg="${3:-assert_grep}"
  if ! printf '%s' "$haystack" | grep -qE "$pattern"; then
    fail "$msg: no line matching '$pattern' in output"
  fi
}

assert_nogrep() {
  local pattern="$1" haystack="$2" msg="${3:-assert_nogrep}"
  if printf '%s' "$haystack" | grep -qE "$pattern"; then
    fail "$msg: unexpected match for '$pattern' in output"
  fi
}

run_test() {
  local test_fn="$1"
  CURRENT_TEST="$test_fn"
  local prev_fail=$FAIL
  "$test_fn"
  if [ "$FAIL" -eq "$prev_fail" ]; then
    PASS=$((PASS + 1))
    printf '  OK   %s\n' "$test_fn"
  else
    printf '  FAIL %s\n' "$test_fn"
  fi
  CURRENT_TEST=""
}

# ---- hermetic supervisor sourcing ----
# Sources supervisor with all app-archive env vars pointing at scratch dirs.
_source_supervisor_with_apps() {
  local scratch="${1:-/tmp}"
  local stub_script="${2:-/dev/null}"
  export AGENT_APPS_DIR="${scratch}-apps"
  export AGENT_APPS_ARCHIVE_DIR="${scratch}-apps-archive"
  export AGENT_APP_ARCHIVE_SCRIPT="$stub_script"
  # Also stub IDENTITIES_DIR / ROLES_DIR so any transitive supervisor init
  # code that walks them doesn't touch real filesystem.
  export AGENT_IDENTITIES_DIR="${scratch}-identities"
  export AGENT_IDENTITIES_ARCHIVE_DIR="${scratch}-identities-archive"
  export AGENT_ROLES_DIR="${scratch}-roles"
  export AGENT_ROLES_ARCHIVE_DIR="${scratch}-roles-archive"
  export DORMANCY_STATE_DIR="$scratch/.state"
  mkdir -p "$AGENT_APPS_DIR" "$AGENT_IDENTITIES_DIR" "$AGENT_ROLES_DIR" "$DORMANCY_STATE_DIR"
  export AGENT_SUPERVISOR_LIB_ONLY=1
  # shellcheck disable=SC1090
  source "$SUPERVISOR" 2>/dev/null || true
}

# ---- fixtures ----

# Create an app folder at $APPS_DIR/<slug>/ with a placeholder file, optionally
# with the .archive-requested sentinel.
# Usage: fixture_app_folder <scratch> <slug> [--with-sentinel]
fixture_app_folder() {
  local scratch="$1" slug="$2"
  shift 2
  local with_sentinel=false
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --with-sentinel) with_sentinel=true ;;
    esac
    shift
  done
  local app_dir="${scratch}-apps/$slug"
  mkdir -p "$app_dir"
  printf 'app-content-marker\n' > "$app_dir/app.json"
  if $with_sentinel; then
    touch "$app_dir/.archive-requested"
  fi
}

# Create a stub archive-app.sh at <path> that emulates the real script's
# folder-move semantics (moves live folder to archive location) and exits
# with <exit_code>. On non-zero exit, does NOT move the folder.
fixture_stub_archive_script() {
  local path="$1" exit_code="$2"
  local dir
  dir="$(dirname "$path")"
  mkdir -p "$dir"
  cat > "$path" <<STUB
#!/usr/bin/env bash
# Stub archive-app.sh for tests. Emulates the real script's mv-folder-to-archive
# behavior on success only. Reads scratch paths from env vars set by the caller.
set -u
SLUG="\${1:-}"
if [ -z "\$SLUG" ]; then
  echo "stub: missing slug" >&2
  exit 2
fi
if [ "$exit_code" -eq 0 ]; then
  mkdir -p "\$STUB_APPS_ARCHIVE_DIR" 2>/dev/null || true
  if mv "\$STUB_APPS_DIR/\$SLUG" "\$STUB_APPS_ARCHIVE_DIR/\$SLUG" 2>/dev/null; then
    echo "stub: moved \$SLUG to archive"
  else
    echo "stub: mv failed" >&2
    exit 3
  fi
fi
exit $exit_code
STUB
  chmod +x "$path"
}

# ---- tests ----

test_happy_path() {
  local scratch
  scratch="$(mktemp -d)"
  local stub_script="$scratch/stub-archive-app.sh"
  fixture_stub_archive_script "$stub_script" 0

  ( _source_supervisor_with_apps "$scratch" "$stub_script"
    fixture_app_folder "$scratch" "my-app" --with-sentinel

    # STUB_APPS_DIR / STUB_APPS_ARCHIVE_DIR let the stub know where to move
    # (mimicking the real script's HOME-relative paths without our test
    # depending on the caller's real HOME).
    export STUB_APPS_DIR="$AGENT_APPS_DIR"
    export STUB_APPS_ARCHIVE_DIR="$AGENT_APPS_ARCHIVE_DIR"

    out="$(scan_app_archive_requested_sentinels 2>&1)"

    # Live app folder gone (stub moved it)
    assert_nofile "${scratch}-apps/my-app/.archive-requested" \
      "happy: live sentinel gone"
    assert_nofile "${scratch}-apps/my-app/app.json" \
      "happy: live app folder gone"
    # Archived folder present at target
    assert_file "${scratch}-apps-archive/my-app/app.json" \
      "happy: app folder moved to archive"
    # Sentinel deleted from archive tree (our scanner cleaned it up)
    assert_nofile "${scratch}-apps-archive/my-app/.archive-requested" \
      "happy: archived sentinel cleaned"

    assert_grep "archive-app.sh succeeded" "$out" \
      "happy: success log line"
    assert_grep "\\.archive-requested detected" "$out" \
      "happy: detection log line"
    assert_nogrep "FAILED" "$out" \
      "happy: no FAILED log lines"
  )

  rm -rf "$scratch" "${scratch}-apps" "${scratch}-apps-archive" \
         "${scratch}-identities" "${scratch}-roles" 2>/dev/null || true
}

test_script_exits_nonzero() {
  local scratch
  scratch="$(mktemp -d)"
  local stub_script="$scratch/stub-archive-app.sh"
  fixture_stub_archive_script "$stub_script" 4

  ( _source_supervisor_with_apps "$scratch" "$stub_script"
    fixture_app_folder "$scratch" "my-app" --with-sentinel

    export STUB_APPS_DIR="$AGENT_APPS_DIR"
    export STUB_APPS_ARCHIVE_DIR="$AGENT_APPS_ARCHIVE_DIR"

    out="$(scan_app_archive_requested_sentinels 2>&1)"

    # Sentinel retained in live tree (next tick will retry)
    assert_file "${scratch}-apps/my-app/.archive-requested" \
      "fail: live sentinel retained"
    # App folder still live (stub did NOT move on failure)
    assert_file "${scratch}-apps/my-app/app.json" \
      "fail: live app folder retained"
    # No archive move happened
    assert_nofile "${scratch}-apps-archive/my-app/app.json" \
      "fail: no archive move"

    assert_grep "FAILED \\(rc=4\\)" "$out" \
      "fail: FAILED log line with rc"
    assert_grep "sentinel retained" "$out" \
      "fail: retention log line"
  )

  rm -rf "$scratch" "${scratch}-apps" "${scratch}-apps-archive" \
         "${scratch}-identities" "${scratch}-roles" 2>/dev/null || true
}

test_missing_script() {
  local scratch
  scratch="$(mktemp -d)"

  ( _source_supervisor_with_apps "$scratch" "$scratch/does-not-exist.sh"
    fixture_app_folder "$scratch" "my-app" --with-sentinel

    out="$(scan_app_archive_requested_sentinels 2>&1)"

    # Sentinel retained (misconfig should retry once distributor lands the script)
    assert_file "${scratch}-apps/my-app/.archive-requested" \
      "missing-script: sentinel retained"

    assert_grep "not found or not executable" "$out" \
      "missing-script: error log line"
    assert_grep "sentinel retained" "$out" \
      "missing-script: retention log line"
  )

  rm -rf "$scratch" "${scratch}-apps" "${scratch}-apps-archive" \
         "${scratch}-identities" "${scratch}-roles" 2>/dev/null || true
}

test_no_sentinel_noop() {
  local scratch
  scratch="$(mktemp -d)"
  local stub_script="$scratch/stub-archive-app.sh"
  fixture_stub_archive_script "$stub_script" 0

  ( _source_supervisor_with_apps "$scratch" "$stub_script"
    # App folder exists but NO .archive-requested sentinel.
    fixture_app_folder "$scratch" "my-app"

    export STUB_APPS_DIR="$AGENT_APPS_DIR"
    export STUB_APPS_ARCHIVE_DIR="$AGENT_APPS_ARCHIVE_DIR"

    out="$(scan_app_archive_requested_sentinels 2>&1)"

    # App folder untouched
    assert_file "${scratch}-apps/my-app/app.json" \
      "no-sentinel: app folder untouched"
    # No archive activity
    assert_nofile "${scratch}-apps-archive/my-app/app.json" \
      "no-sentinel: no archive move"

    assert_nogrep "detected" "$out" \
      "no-sentinel: no detection log"
    assert_nogrep "archive-app.sh" "$out" \
      "no-sentinel: script never invoked"
  )

  rm -rf "$scratch" "${scratch}-apps" "${scratch}-apps-archive" \
         "${scratch}-identities" "${scratch}-roles" 2>/dev/null || true
}

test_multiple_apps_mixed() {
  # Two apps, only one has the sentinel. Scanner should archive only that one.
  local scratch
  scratch="$(mktemp -d)"
  local stub_script="$scratch/stub-archive-app.sh"
  fixture_stub_archive_script "$stub_script" 0

  ( _source_supervisor_with_apps "$scratch" "$stub_script"
    fixture_app_folder "$scratch" "app-a" --with-sentinel
    fixture_app_folder "$scratch" "app-b"

    export STUB_APPS_DIR="$AGENT_APPS_DIR"
    export STUB_APPS_ARCHIVE_DIR="$AGENT_APPS_ARCHIVE_DIR"

    out="$(scan_app_archive_requested_sentinels 2>&1)"

    # app-a archived, app-b untouched
    assert_nofile "${scratch}-apps/app-a/app.json" "mixed: app-a moved"
    assert_file   "${scratch}-apps-archive/app-a/app.json" "mixed: app-a in archive"
    assert_file   "${scratch}-apps/app-b/app.json" "mixed: app-b untouched"
    assert_nofile "${scratch}-apps-archive/app-b/app.json" "mixed: app-b not archived"

    assert_grep "app-a.*archive-app.sh succeeded" "$out" "mixed: app-a success log"
    assert_nogrep "app-b.*detected" "$out" "mixed: app-b never detected"
  )

  rm -rf "$scratch" "${scratch}-apps" "${scratch}-apps-archive" \
         "${scratch}-identities" "${scratch}-roles" 2>/dev/null || true
}

# ---- driver ----
main() {
  printf 'scan_app_archive_requested_sentinels tests\n'
  run_test test_happy_path
  run_test test_script_exits_nonzero
  run_test test_missing_script
  run_test test_no_sentinel_noop
  run_test test_multiple_apps_mixed

  printf '\n=====\n'
  printf 'PASS: %d\n' "$PASS"
  printf 'FAIL: %d\n' "$FAIL"
  if [ "$FAIL" -gt 0 ]; then
    printf '\nFailures:\n'
    for f in "${FAILURES[@]}"; do
      printf '  - %s\n' "$f"
    done
    exit 1
  fi
  exit 0
}

main
