#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for substrate/scripts/interactive-messages-gc.py
#
# Phase 140 Plan 03. Verifies:
#   1. Fresh box (no widgets root) — exits 0, logs "no widgets root".
#   2. All widgets fresh (age < 7 days) — checked=N tore_down=0, no teardown.
#   3. One old widget, dry-run — would-teardown logged, checked=2 tore_down=0.
#   4. One old widget, real teardown — old widget dir removed, fresh widget kept.
#   5. Malformed metadata.json — exit 0, skipped=1.
#   6. Missing created_at field — exit 0, skipped=1.
#   7. --age-days override — lower threshold triggers teardown on 3-day-old widget.
#
# Usage: bash substrate/scripts/tests/interactive-messages-gc.test.sh
#   Run from the repo root (or any directory; script resolves its own paths).
#
# Hermetic environment contract:
#   Each test builds a scratch HOME via mktemp and passes --root to point the
#   GC script at an isolated widget directory. The real ~/fleet/interactive-
#   messages is never touched.
#
# Requirements: bash, python3, date (GNU or BSD with -d or -v), mktemp.

set -u  # -e intentionally NOT set — explicit assert helpers used throughout

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GC="$REPO_ROOT/substrate/scripts/interactive-messages-gc.py"

if [ ! -f "$GC" ]; then
  printf 'FATAL: gc script not found at %s\n' "$GC" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  printf 'FATAL: python3 not found\n' >&2
  exit 1
fi

# ---- test state ----
PASS=0
FAIL=0
FAILURES=()
CURRENT_TEST=""

# ---- helpers ----

fail() {
  local msg="${1:-unknown failure}"
  FAILURES+=("${CURRENT_TEST:-unknown}: $msg")
  FAIL=$((FAIL + 1))
}

assert_exit() {
  local expected="$1" actual="$2" ctx="${3:-assert_exit}"
  if [ "$expected" != "$actual" ]; then
    fail "$ctx: expected exit=$expected got exit=$actual"
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" ctx="${3:-assert_contains}"
  if ! printf '%s' "$haystack" | grep -qF "$needle"; then
    fail "$ctx: expected '$needle' in output"
  fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" ctx="${3:-assert_not_contains}"
  if printf '%s' "$haystack" | grep -qF "$needle"; then
    fail "$ctx: did NOT expect '$needle' in output"
  fi
}

assert_dir_exists() {
  local path="$1" ctx="${2:-assert_dir_exists}"
  if [ ! -d "$path" ]; then
    fail "$ctx: directory should exist: $path"
  fi
}

assert_dir_missing() {
  local path="$1" ctx="${2:-assert_dir_missing}"
  if [ -d "$path" ]; then
    fail "$ctx: directory should NOT exist: $path"
  fi
}

# ---- date portability helper ----
# Returns an ISO8601 UTC timestamp offset by $1 days from now.
# Positive = future, negative = past.
# Supports both GNU date (-d) and BSD date (-v).
date_offset() {
  local days="$1"
  if date --version >/dev/null 2>&1; then
    # GNU date
    date -u -d "${days} days" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || \
    date -u -d "${days} day" '+%Y-%m-%dT%H:%M:%SZ'
  else
    # BSD date (macOS)
    date -u -v "${days}d" '+%Y-%m-%dT%H:%M:%SZ'
  fi
}

# ---- make_widget helper ----
# make_widget <root> <slug> <created_at_iso8601>
# Creates a minimal widget dir with metadata.json under <root>/<slug>/.
make_widget() {
  local root="$1" slug="$2" created_at="$3"
  mkdir -p "$root/$slug"
  printf '{"slug":"%s","created_at":"%s","template":"poll"}\n' \
    "$slug" "$created_at" > "$root/$slug/metadata.json"
}

# ---- run_gc helper ----
# run_gc <root> [extra args...]
# Runs the GC script with --root <root>; captures stdout into $GC_OUT and
# stderr into $GC_ERR; captures exit code into $GC_EXIT.
GC_OUT=""
GC_ERR=""
GC_EXIT=0
run_gc() {
  local root="$1"
  shift
  local tmpout tmperr
  tmpout=$(mktemp)
  tmperr=$(mktemp)
  python3 "$GC" --root "$root" "$@" >"$tmpout" 2>"$tmperr"
  GC_EXIT=$?
  GC_OUT=$(cat "$tmpout")
  GC_ERR=$(cat "$tmperr")
  rm -f "$tmpout" "$tmperr"
}

# ---- per-test scratch dir ----
SCRATCH=""

setup_scratch() {
  SCRATCH=$(mktemp -d)
}

teardown_scratch() {
  [ -n "$SCRATCH" ] && [ -d "$SCRATCH" ] && rm -rf "$SCRATCH"
  SCRATCH=""
}

# ---- run_test wrapper ----
run_test() {
  local test_fn="$1"
  local before_fail=$FAIL
  CURRENT_TEST="$test_fn"

  setup_scratch
  "$test_fn"
  teardown_scratch

  if [ "$FAIL" -eq "$before_fail" ]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$test_fn"
  else
    printf 'FAIL  %s\n' "$test_fn"
  fi
}

# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

test_fresh_box_no_widgets_root() {
  # Root dir does NOT exist — fresh box.
  local root="$SCRATCH/fleet/interactive-messages"
  # Deliberately do NOT create the root dir.

  run_gc "$root"

  assert_exit 0 "$GC_EXIT" "exit code"
  assert_contains "$GC_OUT" "no widgets root" "stdout should mention no widgets root"
  assert_contains "$GC_OUT" "done." "stdout should contain summary done line"
}

test_all_widgets_fresh_no_teardown() {
  # Two fresh widgets (2 days old and 6 days old) — neither should be torn down.
  local root="$SCRATCH/fleet/interactive-messages"
  local ts2 ts6
  ts2=$(date_offset -2)
  ts6=$(date_offset -6)

  make_widget "$root" "widget-alpha" "$ts2"
  make_widget "$root" "widget-beta"  "$ts6"

  run_gc "$root" --dry-run

  assert_exit 0 "$GC_EXIT" "exit code"
  assert_contains "$GC_OUT" "checked=2 tore_down=0" "summary line"
  assert_not_contains "$GC_OUT" "TEARDOWN"    "no TEARDOWN lines expected"
  assert_not_contains "$GC_OUT" "would-teardown" "no would-teardown lines expected"
}

test_one_old_widget_dry_run() {
  # One old widget (8 days old) and one fresh (3 days old). --dry-run.
  local root="$SCRATCH/fleet/interactive-messages"
  local ts_old ts_fresh
  ts_old=$(date_offset -8)
  ts_fresh=$(date_offset -3)

  make_widget "$root" "old-widget"   "$ts_old"
  make_widget "$root" "fresh-widget" "$ts_fresh"

  run_gc "$root" --dry-run

  assert_exit 0 "$GC_EXIT" "exit code"
  assert_contains "$GC_OUT" "would-teardown slug=old-widget" "dry-run teardown logged"
  assert_contains "$GC_OUT" "checked=2 tore_down=0" "summary line"
  assert_not_contains "$GC_OUT" "would-teardown slug=fresh-widget" "fresh widget not touched"
}

test_one_old_widget_real_teardown() {
  # One old widget (8 days old) and one fresh (3 days old). Real teardown
  # via a mock teardown script.
  local root="$SCRATCH/fleet/interactive-messages"
  local ts_old ts_fresh
  ts_old=$(date_offset -8)
  ts_fresh=$(date_offset -3)

  make_widget "$root" "old-widget"   "$ts_old"
  make_widget "$root" "fresh-widget" "$ts_fresh"

  # Write a mock teardown script: accepts --force <slug>, removes the widget dir.
  local mock_teardown
  mock_teardown="$SCRATCH/mock-teardown.sh"
  cat > "$mock_teardown" <<'MOCK'
#!/usr/bin/env bash
# Mock teardown-widget.sh: accepts --force <slug>
# The GC script calls: bash <path> --force <slug>
# argv[0]=bash argv[1]=<path> argv[2]=--force argv[3]=<slug>
# But we're invoked as: bash mock-teardown.sh --force <slug>
# so $1=--force $2=<slug>
SLUG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force) shift ;;
    *)       SLUG="$1"; shift ;;
  esac
done
[ -z "$SLUG" ] && exit 1
# Use WIDGETS_ROOT env var set by the test.
rm -rf "${WIDGETS_ROOT}/${SLUG}"
printf 'TORN_DOWN=%s\n' "$SLUG"
exit 0
MOCK
  chmod +x "$mock_teardown"

  INTERACTIVE_MESSAGES_TEARDOWN_CMD="$mock_teardown" \
    WIDGETS_ROOT="$root" \
    run_gc "$root"

  assert_exit 0 "$GC_EXIT" "exit code"
  assert_dir_missing "$root/old-widget"    "old widget dir should be removed"
  assert_dir_exists  "$root/fresh-widget"  "fresh widget dir should remain"
  assert_contains "$GC_OUT" "TEARDOWN slug=old-widget" "teardown logged"
  assert_contains "$GC_OUT" "tore_down=1" "tore_down count"
}

test_malformed_metadata_json_skip() {
  # Widget with invalid JSON in metadata.json — should skip with skipped=1.
  local root="$SCRATCH/fleet/interactive-messages"
  mkdir -p "$root/bad-widget"
  printf 'THIS IS NOT JSON\n' > "$root/bad-widget/metadata.json"

  run_gc "$root"

  assert_exit 0 "$GC_EXIT" "exit code"
  assert_contains "$GC_OUT" "skipped=1" "skipped count should be 1"
  # Teardown must not have been invoked.
  assert_not_contains "$GC_OUT" "TEARDOWN" "no teardown for malformed metadata"
}

test_missing_created_at_field_skip() {
  # Widget with metadata.json that lacks created_at — should skip with skipped=1.
  local root="$SCRATCH/fleet/interactive-messages"
  mkdir -p "$root/no-ts-widget"
  printf '{"template":"poll","slug":"no-ts-widget"}\n' > "$root/no-ts-widget/metadata.json"

  run_gc "$root"

  assert_exit 0 "$GC_EXIT" "exit code"
  assert_contains "$GC_OUT" "skipped=1" "skipped count should be 1"
  assert_not_contains "$GC_OUT" "TEARDOWN" "no teardown for missing created_at"
}

test_age_days_override() {
  # Widget is 3 days old — fresh under default (7), but old under --age-days 2.
  local root="$SCRATCH/fleet/interactive-messages"
  local ts3
  ts3=$(date_offset -3)

  make_widget "$root" "recent-widget" "$ts3"

  run_gc "$root" --age-days 2 --dry-run

  assert_exit 0 "$GC_EXIT" "exit code"
  assert_contains "$GC_OUT" "would-teardown slug=recent-widget" "threshold override worked"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

run_all() {
  run_test test_fresh_box_no_widgets_root
  run_test test_all_widgets_fresh_no_teardown
  run_test test_one_old_widget_dry_run
  run_test test_one_old_widget_real_teardown
  run_test test_malformed_metadata_json_skip
  run_test test_missing_created_at_field_skip
  run_test test_age_days_override
}

run_all

printf '\n'
if [ "$FAIL" -eq 0 ]; then
  printf 'ALL %d TESTS PASSED\n' "$PASS"
  exit 0
else
  printf '%d/%d TESTS FAILED:\n' "$FAIL" "$((PASS + FAIL))"
  for f in "${FAILURES[@]}"; do
    printf '  - %s\n' "$f"
  done
  exit 1
fi
