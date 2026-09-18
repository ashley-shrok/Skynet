#!/usr/bin/env bash
# shellcheck shell=bash
#
# Hermetic test driver for the Phase 116 image-gen helper script
# (substrate/scripts/image-gen). Mirrors the fleet-status-sweep.test.sh
# conventions: mktemp scratch fixture with trap-cleanup, per-test isolation,
# fail()/assert_eq() helpers, PASS/FAIL bookkeeping.
#
# The tests here mock the backend by hand — the helper's contract is:
#   1. Drop a request JSON at $HOME/fleet/image-gen-requests/<uuid>.json
#      (and optional companion <uuid>.ref.<ext> BEFORE the JSON per Pitfall 3).
#   2. Poll for either <uuid>.success.json + <uuid>.success.<i>.png
#      OR <uuid>.failure.json, up to $IMAGE_GEN_TIMEOUT_SEC seconds.
#   3. On success: move PNGs out, print paths on stdout, JSON on stderr,
#      clean up wire files, exit 0.
#   4. On failure: print failure JSON on stderr, clean up wire files, exit 1.
#   5. On timeout: synthesize `{"reason":"expired"}` on stderr, exit 1.
#
# So the tests here: (a) spawn the helper in the background, (b) plant a fake
# response file (success or failure) into the request folder, (c) wait for the
# helper to exit, (d) assert exit code / stdout / stderr / wire cleanup.
#
# Hermetic environment contract:
#   Every helper invocation sets HOME="$FIXTURE" so the real ~/fleet/ tree is
#   never touched. Fixture is torn down on EXIT via trap.
#
# Usage: bash substrate/scripts/tests/image-gen.test.sh
#   Run from the repo root.
#
# Requirements: bash, coreutils (mktemp, dirname, mv, cp), jq (optional but
# preferred for parsing planted responses), inotifywait (optional — Test 2 is
# skipped if unavailable).

set -u  # -e is NOT set — the script uses explicit assert helpers so a failing
        # assert does not silently skip subsequent tests.

# ---- path resolution --------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HELPER="$REPO_ROOT/substrate/scripts/image-gen"

if [ ! -f "$HELPER" ]; then
  printf 'FATAL: helper script not found at %s\n' "$HELPER" >&2
  exit 1
fi
if [ ! -x "$HELPER" ]; then
  printf 'FATAL: helper script not executable at %s\n' "$HELPER" >&2
  exit 1
fi

# ---- scratch fixture --------------------------------------------------------
FIXTURE=""
FIXTURE=$(mktemp -d)

cleanup() {
  [ -n "$FIXTURE" ] && [ -d "$FIXTURE" ] && rm -rf "$FIXTURE"
}
trap cleanup EXIT

# ---- test state -------------------------------------------------------------
PASS=0
FAIL=0
SKIP=0
FAILURES=()

CURRENT_TEST=""

# ---- helpers ----------------------------------------------------------------

fail() {
  local msg="${1:-unknown failure}"
  FAILURES+=("${CURRENT_TEST:-unknown}: $msg")
  FAIL=$((FAIL + 1))
}

assert_eq() {
  local expected="$1" actual="$2" msg="${3:-assert_eq}"
  if [ "$expected" != "$actual" ]; then
    fail "$msg: expected='$expected' got='$actual'"
  fi
}

reset_fixture() {
  # Wipe fixture between tests so state doesn't leak. Keep the fixture root
  # itself so $FIXTURE stays valid.
  rm -rf "${FIXTURE:?}"/*
  mkdir -p "$FIXTURE/fleet/image-gen-requests" "$FIXTURE/fleet/image-gen-outputs"
}

run_test() {
  local test_fn="$1"
  local before_fail=$FAIL
  CURRENT_TEST="$test_fn"
  reset_fixture
  "$test_fn"
  if [ "$FAIL" -eq "$before_fail" ]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$test_fn"
  else
    printf 'FAIL  %s\n' "$test_fn"
  fi
}

# Extract .prompt from a JSON file — jq if available, sed fallback.
extract_prompt() {
  local file="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -r '.prompt' "$file"
  else
    # Naive extractor for the {"prompt":"..."} shape the helper's fallback
    # path produces; ok for tests where the prompt has no quotes/backslashes.
    grep -o '"prompt":"[^"]*"' "$file" | head -1 | sed 's/^"prompt":"\(.*\)"$/\1/'
  fi
}

# Extract a top-level key from a JSON file (present/absent test).
has_key() {
  local file="$1" key="$2"
  if command -v jq >/dev/null 2>&1; then
    [ "$(jq -r --arg k "$key" 'has($k)' "$file")" = "true" ]
  else
    grep -q "\"$key\":" "$file"
  fi
}

# Wait up to $1 seconds for a file to exist. Returns 0 if it appears, 1 otherwise.
wait_for_file() {
  local timeout="$1" path="$2"
  local i=0
  while [ "$i" -lt "$((timeout * 10))" ]; do
    [ -e "$path" ] && return 0
    sleep 0.1
    i=$((i + 1))
  done
  return 1
}

# ============================================================================
# TEST CASES
# ============================================================================

# Test 1: request-drop happy path.
# Spawn the helper with a short timeout in the background; wait long enough for
# it to write its request JSON; assert the request file exists with the correct
# prompt and requested_at fields. Then let it time out cleanly.
test_1_request_drop_happy_path() {
  IMAGE_GEN_TIMEOUT_SEC=2 HOME="$FIXTURE" bash "$HELPER" "test prompt" \
    >/dev/null 2>/dev/null &
  local helper_pid=$!

  # Wait for the request json to appear (helper writes ref-first-then-json).
  local i=0
  local req_file=""
  while [ "$i" -lt 20 ]; do
    for f in "$FIXTURE"/fleet/image-gen-requests/*.json; do
      if [ -f "$f" ]; then
        # Skip .success/.failure files which don't apply on the initial drop.
        case "$f" in
          *.success.json|*.failure.json) continue;;
          *) req_file="$f"; break 2;;
        esac
      fi
    done
    sleep 0.1
    i=$((i + 1))
  done

  if [ -z "$req_file" ]; then
    fail "no request json appeared under $FIXTURE/fleet/image-gen-requests/"
    wait "$helper_pid" 2>/dev/null || true
    return
  fi

  # Assert exactly one request json.
  local count
  count=$(ls "$FIXTURE"/fleet/image-gen-requests/*.json 2>/dev/null | wc -l)
  assert_eq 1 "$count" "expected exactly one request json"

  # Assert .prompt == "test prompt".
  local prompt
  prompt=$(extract_prompt "$req_file")
  assert_eq "test prompt" "$prompt" "request json .prompt"

  # Assert requested_at is present.
  if ! has_key "$req_file" "requested_at"; then
    fail "requested_at missing from request json"
  fi

  # Let the helper time out to completion so no zombie remains.
  wait "$helper_pid" 2>/dev/null || true
}

# Test 2: ref-before-json write order (Pitfall 3).
# Watch the request folder with inotifywait; run the helper with --ref;
# capture CREATE events; assert the *.ref.* CREATE event precedes the *.json
# CREATE event. Skipped if inotifywait is unavailable.
test_2_ref_before_json_write_order() {
  if ! command -v inotifywait >/dev/null 2>&1; then
    printf 'SKIP  %s (inotifywait unavailable)\n' "$CURRENT_TEST"
    SKIP=$((SKIP + 1))
    return
  fi

  # Fake ref file to pass as --ref.
  printf 'fake png bytes' > "$FIXTURE/fake.png"

  local events_log="$FIXTURE/inotify-events.log"

  # Start inotifywait watching for CREATE events on the request folder.
  # Note: use --format '%f' for just the filename; we also match 'moved_to'
  # events since the helper writes .tmp then mv's — the final filename shows
  # up as MOVED_TO for the .ref.png/.json and CREATE for the .tmp.
  inotifywait -m -e create -e moved_to --format '%f' \
    "$FIXTURE/fleet/image-gen-requests/" > "$events_log" 2>/dev/null &
  local iw_pid=$!
  # Give inotifywait a moment to spin up before we launch the helper.
  sleep 0.2

  IMAGE_GEN_TIMEOUT_SEC=2 HOME="$FIXTURE" bash "$HELPER" "prompt" \
    --ref "$FIXTURE/fake.png" >/dev/null 2>/dev/null &
  local helper_pid=$!

  # Let both the ref file and the request json land, then let the helper time out.
  sleep 1.0
  # Terminate inotifywait so the events log is flushed.
  kill "$iw_pid" 2>/dev/null || true
  wait "$iw_pid" 2>/dev/null || true
  wait "$helper_pid" 2>/dev/null || true

  # Find the first line ending in `.ref.png` (final commit) and the first line
  # matching a bare `<uuid>.json` (final commit — NOT .tmp.$$).
  local ref_line=0 json_line=0
  local line_num=0
  while IFS= read -r line; do
    line_num=$((line_num + 1))
    if [ "$ref_line" -eq 0 ] && [[ "$line" =~ \.ref\.png$ ]]; then
      ref_line=$line_num
    fi
    # Match final <uuid>.json (36-char base + .json) — NOT the .tmp.$$ variant.
    if [ "$json_line" -eq 0 ] && [[ "$line" =~ ^[0-9a-f-]{36}\.json$ ]]; then
      json_line=$line_num
    fi
  done < "$events_log"

  if [ "$ref_line" -eq 0 ]; then
    fail "no .ref.png event observed in inotify log"
    return
  fi
  if [ "$json_line" -eq 0 ]; then
    fail "no <uuid>.json event observed in inotify log"
    return
  fi
  if [ "$ref_line" -ge "$json_line" ]; then
    fail "ref-before-json invariant violated: ref_line=$ref_line json_line=$json_line"
  fi
}

# Test 3: 5-minute timeout via IMAGE_GEN_TIMEOUT_SEC env override.
# Set the timeout to 2 seconds; run the helper synchronously; capture stdout
# + stderr + exit code; assert non-zero exit and expired reason in stderr.
test_3_timeout_via_env_override() {
  IMAGE_GEN_TIMEOUT_SEC=2 HOME="$FIXTURE" bash "$HELPER" "prompt" \
    > "$FIXTURE/stdout" 2> "$FIXTURE/stderr"
  local rc=$?

  if [ "$rc" -eq 0 ]; then
    fail "expected non-zero exit on timeout, got 0"
  fi
  if ! grep -q '"reason":"expired"' "$FIXTURE/stderr"; then
    fail "expected 'expired' reason in stderr, got: $(cat "$FIXTURE/stderr")"
  fi
}

# Test 4: planted success is picked up and PNGs moved to output dir.
# Spawn helper in background with a generous timeout; wait for the request
# json to land; derive the uuid; atomically plant a success.json + success.0.png
# in the request folder; wait for the helper to exit; assert exit 0, stdout
# contains a path to a PNG that exists on disk, wire files are cleaned up.
test_4_planted_success() {
  IMAGE_GEN_TIMEOUT_SEC=10 HOME="$FIXTURE" bash "$HELPER" "prompt" \
    > "$FIXTURE/stdout" 2> "$FIXTURE/stderr" &
  local helper_pid=$!

  # Wait for the request json to appear.
  local i=0
  local req_file=""
  while [ "$i" -lt 30 ]; do
    for f in "$FIXTURE"/fleet/image-gen-requests/*.json; do
      if [ -f "$f" ]; then
        case "$f" in
          *.success.json|*.failure.json) continue;;
          *) req_file="$f"; break 2;;
        esac
      fi
    done
    sleep 0.1
    i=$((i + 1))
  done

  if [ -z "$req_file" ]; then
    fail "no request json appeared"
    kill "$helper_pid" 2>/dev/null || true
    wait "$helper_pid" 2>/dev/null || true
    return
  fi

  local uuid
  uuid=$(basename "$req_file" .json)

  # Plant success PNG first (belt-and-suspenders — worker writes PNGs before
  # JSON, so match that commit order). Atomic tmp+mv per D-10.
  local png_tmp="$FIXTURE/fleet/image-gen-requests/$uuid.success.0.png.tmp.$$"
  local png_final="$FIXTURE/fleet/image-gen-requests/$uuid.success.0.png"
  printf 'fake png bytes' > "$png_tmp"
  mv "$png_tmp" "$png_final"

  # Plant success JSON.
  local json_tmp="$FIXTURE/fleet/image-gen-requests/$uuid.success.json.tmp.$$"
  local json_final="$FIXTURE/fleet/image-gen-requests/$uuid.success.json"
  printf '{"images":["%s.success.0.png"],"size":"1024x1024","model":"gpt-image-1","n":1,"generation_time_ms":123}\n' \
    "$uuid" > "$json_tmp"
  mv "$json_tmp" "$json_final"

  # Wait for helper to exit.
  wait "$helper_pid"
  local rc=$?

  assert_eq 0 "$rc" "expected exit 0 on success"

  # stdout should contain the path of the moved PNG.
  local moved_path
  moved_path=$(head -1 "$FIXTURE/stdout")
  if [ -z "$moved_path" ]; then
    fail "stdout empty — expected moved PNG path"
    return
  fi
  if [ ! -f "$moved_path" ]; then
    fail "moved PNG not at $moved_path"
  fi

  # Wire files should be cleaned up.
  if [ -f "$FIXTURE/fleet/image-gen-requests/$uuid.success.json" ]; then
    fail "wire success.json not cleaned up"
  fi
  if [ -f "$FIXTURE/fleet/image-gen-requests/$uuid.json" ]; then
    fail "wire request.json not cleaned up"
  fi
  if [ -f "$FIXTURE/fleet/image-gen-requests/$uuid.success.0.png" ]; then
    fail "wire success.0.png not cleaned up"
  fi
}

# Test 5: planted failure prints failure JSON on stderr and exits non-zero.
test_5_planted_failure() {
  IMAGE_GEN_TIMEOUT_SEC=10 HOME="$FIXTURE" bash "$HELPER" "prompt" \
    > "$FIXTURE/stdout" 2> "$FIXTURE/stderr" &
  local helper_pid=$!

  # Wait for the request json to appear.
  local i=0
  local req_file=""
  while [ "$i" -lt 30 ]; do
    for f in "$FIXTURE"/fleet/image-gen-requests/*.json; do
      if [ -f "$f" ]; then
        case "$f" in
          *.success.json|*.failure.json) continue;;
          *) req_file="$f"; break 2;;
        esac
      fi
    done
    sleep 0.1
    i=$((i + 1))
  done

  if [ -z "$req_file" ]; then
    fail "no request json appeared"
    kill "$helper_pid" 2>/dev/null || true
    wait "$helper_pid" 2>/dev/null || true
    return
  fi

  local uuid
  uuid=$(basename "$req_file" .json)

  # Plant failure JSON atomically.
  local f_tmp="$FIXTURE/fleet/image-gen-requests/$uuid.failure.json.tmp.$$"
  local f_final="$FIXTURE/fleet/image-gen-requests/$uuid.failure.json"
  printf '{"reason":"content_blocked","message":"provider refused"}\n' > "$f_tmp"
  mv "$f_tmp" "$f_final"

  # Wait for helper to exit.
  wait "$helper_pid"
  local rc=$?

  if [ "$rc" -eq 0 ]; then
    fail "expected non-zero exit on failure, got 0"
  fi
  if ! grep -q 'content_blocked' "$FIXTURE/stderr"; then
    fail "expected 'content_blocked' in stderr, got: $(cat "$FIXTURE/stderr")"
  fi

  # Wire files cleaned up.
  if [ -f "$FIXTURE/fleet/image-gen-requests/$uuid.failure.json" ]; then
    fail "wire failure.json not cleaned up"
  fi
  if [ -f "$FIXTURE/fleet/image-gen-requests/$uuid.json" ]; then
    fail "wire request.json not cleaned up"
  fi
}

# ============================================================================
# MAIN
# ============================================================================
printf '=== image-gen helper test driver ===\n'
printf 'helper:  %s\n' "$HELPER"
printf 'fixture: %s\n' "$FIXTURE"
printf '\n'

run_test test_1_request_drop_happy_path
run_test test_2_ref_before_json_write_order
run_test test_3_timeout_via_env_override
run_test test_4_planted_success
run_test test_5_planted_failure

printf '\n===============================\n'
printf 'PASS: %s  FAIL: %s  SKIP: %s\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for _f in "${FAILURES[@]}"; do
    printf '  - %s\n' "$_f"
  done
  exit 1
fi
exit 0
