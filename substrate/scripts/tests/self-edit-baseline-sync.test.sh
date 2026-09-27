#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for self-edit-baseline-sync.sh (PostToolUse hook) AND the
# role-file-watch.py hash-guard that consumes what the hook writes.
#
# Shape rationale: .planning/shapes/shape-stop-self-edit-events.md
#
# Coverage:
#   T-S1 — sync-script drift → atomic baseline overwrite + hash marker
#   T-S2 — sync-script no drift → no writes
#   T-S3 — sync-script missing FLEET_IDENTITY → clean exit 0
#   T-S4 — sync-script missing state dir → clean exit 0
#   T-S5 — watcher + matching marker → silent (self-edit suppression)
#   T-S6 — watcher + mismatched marker → fires event (peer-edit-during-settle
#          case: marker present but current content ≠ recorded hash)
#   T-S7 — watcher without marker → fires event (today's behavior preserved
#          when the sync hook never ran)
#
# Exits 0 on all-pass; 1 on any failure with a diagnostic naming the failing
# test.
#
# Usage: bash substrate/scripts/tests/self-edit-baseline-sync.test.sh
#   Run from the repo root.
#
# Requirements: bash, python3, sha256sum, inotifywait.

set -u

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SYNC_SCRIPT="$REPO_ROOT/substrate/scripts/self-edit-baseline-sync.sh"
WATCHER="$REPO_ROOT/substrate/scripts/role-file-watch.py"

for f in "$SYNC_SCRIPT" "$WATCHER"; do
  if [ ! -f "$f" ]; then
    printf 'FATAL: script missing: %s\n' "$f" >&2
    exit 1
  fi
done

for cmd in python3 sha256sum inotifywait; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf 'FATAL: %s not found\n' "$cmd" >&2
    exit 1
  fi
done

# ---- test state ----
PASS=0
FAIL=0
FAILURES=()

declare -a ALL_TMPDIRS=()
declare -a ALL_PIDS=()

cleanup() {
  for _p in "${ALL_PIDS[@]+"${ALL_PIDS[@]}"}"; do
    [ -n "$_p" ] && kill "$_p" 2>/dev/null
  done
  for _d in "${ALL_TMPDIRS[@]+"${ALL_TMPDIRS[@]}"}"; do
    [ -n "$_d" ] && [ -d "$_d" ] && rm -rf "$_d"
  done
}
trap cleanup EXIT

make_tmpdir() {
  local d
  d=$(mktemp -d)
  ALL_TMPDIRS+=("$d")
  printf '%s' "$d"
}

fail() {
  local msg="${1:-unknown failure}"
  FAILURES+=("${CURRENT_TEST:-unknown}: $msg")
  FAIL=$((FAIL + 1))
}

run_test() {
  local test_fn="$1"
  local before_fail=$FAIL
  CURRENT_TEST="$test_fn"
  "$test_fn"
  if [ "$FAIL" -eq "$before_fail" ]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$test_fn"
  else
    printf 'FAIL  %s\n' "$test_fn"
  fi
}

# ---- fixture helpers ----

# seed_fixture: build a hermetic HOME with role.md + identity.md + role-file-watch
# state dir with baselines already snapshotted.
# Sets globals: HOME_DIR, IDENT_DIR, STATE_DIR, ROLE_MD, IDENT_MD,
#   BASELINE_ROLE, BASELINE_IDENT.
seed_fixture() {
  local role="$1" name="$2"
  HOME_DIR=$(make_tmpdir)
  IDENT_DIR="$HOME_DIR/fleet/identities/$name"
  STATE_DIR="$IDENT_DIR/role-file-watch"
  mkdir -p "$HOME_DIR/fleet/roles/$role" "$IDENT_DIR" "$STATE_DIR"
  ROLE_MD="$HOME_DIR/fleet/roles/$role/$role.md"
  IDENT_MD="$IDENT_DIR/$name.md"
  BASELINE_ROLE="$STATE_DIR/last-snapshot.role"
  BASELINE_IDENT="$STATE_DIR/last-snapshot.identity"
  printf '# %s role\n\nline 1\n' "$role" > "$ROLE_MD"
  printf -- '---\nrole: %s\n---\n\n# %s\n' "$role" "$name" > "$IDENT_MD"
  cp "$ROLE_MD" "$BASELINE_ROLE"
  cp "$IDENT_MD" "$BASELINE_IDENT"
}

# launch_watcher: start role-file-watch.py under a hermetic HOME with a short
# settle window (50ms). Sets WATCHER_PID, OUT_LOG, ERR_LOG.
launch_watcher() {
  local home_dir="$1" ident_dir="$2"
  OUT_LOG=$(make_tmpdir)/out.log
  ERR_LOG=$(make_tmpdir)/err.log
  HOME="$home_dir" \
    AMBIENT_MONITOR_HARNESS_PID="$$" \
    ROLE_WATCH_SELF_EDIT_SETTLE_MS=50 \
    python3 "$WATCHER" "$ident_dir" \
    >"$OUT_LOG" 2>"$ERR_LOG" &
  WATCHER_PID=$!
  ALL_PIDS+=("$WATCHER_PID")
}

wait_for_baseline() {
  local baseline="$1"
  local timeout="${2:-30}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    [ -f "$baseline" ] && return 0
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  return 1
}

wait_for_stdout_match() {
  local pattern="$1"
  local out_log="$2"
  local timeout="${3:-50}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if [ -f "$out_log" ] && grep -qE "$pattern" "$out_log"; then
      return 0
    fi
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  return 1
}

# ============================================================
# T-S1: sync-script drift → atomic baseline overwrite + hash marker.
# ============================================================
test_T_S1_sync_drift() {
  seed_fixture "s1role" "s1name"

  # Divert the identity real file (simulates agent edit that hasn't yet
  # reached the baseline).
  printf -- '---\nrole: s1role\ntask: something new\n---\n\n# s1name\n' > "$IDENT_MD"

  # Sanity: baseline and real now differ.
  if cmp -s "$IDENT_MD" "$BASELINE_IDENT"; then
    fail "T-S1: fixture broken — baseline already equals real"
    return
  fi

  # Run the sync script.
  HOME="$HOME_DIR" FLEET_IDENTITY="s1name" bash "$SYNC_SCRIPT" </dev/null

  # Baseline must now match real.
  if ! cmp -s "$IDENT_MD" "$BASELINE_IDENT"; then
    fail "T-S1: baseline not refreshed after sync"
    return
  fi

  # Marker must exist and hold sha256 of the new content.
  local marker="$BASELINE_IDENT.self-edit-hash"
  if [ ! -f "$marker" ]; then
    fail "T-S1: hash marker not written at $marker"
    return
  fi

  local expected recorded
  expected=$(sha256sum "$IDENT_MD" | awk '{print $1}')
  recorded=$(cat "$marker" | tr -d '\n')
  if [ "$expected" != "$recorded" ]; then
    fail "T-S1: marker hash mismatch (expected=$expected got=$recorded)"
    return
  fi
}

# ============================================================
# T-S2: sync-script no drift → no writes.
# ============================================================
test_T_S2_sync_no_drift() {
  seed_fixture "s2role" "s2name"

  # Ensure baseline matches real (seed_fixture already does this).
  local baseline_mtime_before
  baseline_mtime_before=$(stat -c %Y "$BASELINE_IDENT")

  sleep 1  # ensure mtime granularity distinguishes a rewrite

  HOME="$HOME_DIR" FLEET_IDENTITY="s2name" bash "$SYNC_SCRIPT" </dev/null

  local baseline_mtime_after
  baseline_mtime_after=$(stat -c %Y "$BASELINE_IDENT")

  if [ "$baseline_mtime_before" != "$baseline_mtime_after" ]; then
    fail "T-S2: baseline was rewritten despite no drift (mtime changed)"
    return
  fi

  # No marker should exist.
  if [ -f "$BASELINE_IDENT.self-edit-hash" ]; then
    fail "T-S2: hash marker written despite no drift"
    return
  fi
}

# ============================================================
# T-S3: sync-script missing FLEET_IDENTITY → clean exit 0.
# ============================================================
test_T_S3_no_fleet_identity() {
  local rc
  unset FLEET_IDENTITY
  bash "$SYNC_SCRIPT" </dev/null
  rc=$?
  if [ "$rc" -ne 0 ]; then
    fail "T-S3: exit code $rc (expected 0) when FLEET_IDENTITY absent"
    return
  fi
}

# ============================================================
# T-S4: sync-script missing state dir → clean exit 0.
# ============================================================
test_T_S4_no_state_dir() {
  local rc
  local home_dir
  home_dir=$(make_tmpdir)
  mkdir -p "$home_dir/fleet/identities/s4name"
  HOME="$home_dir" FLEET_IDENTITY="s4name" bash "$SYNC_SCRIPT" </dev/null
  rc=$?
  if [ "$rc" -ne 0 ]; then
    fail "T-S4: exit code $rc (expected 0) when state dir absent"
    return
  fi
}

# ============================================================
# T-S5: watcher + matching marker → silent (self-edit suppression).
# ============================================================
test_T_S5_watcher_matching_marker_silent() {
  seed_fixture "s5role" "s5name"
  launch_watcher "$HOME_DIR" "$IDENT_DIR"

  # Wait for cold-start baselines to settle (watcher writes them silently).
  if ! wait_for_baseline "$BASELINE_IDENT"; then
    fail "T-S5: identity baseline never landed"
    return
  fi
  # Cold start emits nothing.
  sleep 0.3

  # Simulate an agent self-edit: change the file AND drop a matching marker
  # that would have been written by the sync hook.
  local new_content='---
role: s5role
task: quiet
---

# s5name
'
  printf '%s' "$new_content" > "$IDENT_MD"
  local expected_hash
  expected_hash=$(sha256sum "$IDENT_MD" | awk '{print $1}')
  # The sync hook would also refresh the baseline atomically:
  cp "$IDENT_MD" "$BASELINE_IDENT"
  # And drop the marker:
  printf '%s\n' "$expected_hash" > "$BASELINE_IDENT.self-edit-hash"

  # Wait 1.5s. If the watcher was going to emit, it would have by now
  # (200ms settle + inotify tick + emit).
  sleep 1.5

  if grep -qE '📝 \[identity-file:' "$OUT_LOG" 2>/dev/null; then
    fail "T-S5: watcher emitted event despite matching self-edit marker; out=$(cat "$OUT_LOG")"
    return
  fi

  # Marker must have been consumed.
  if [ -f "$BASELINE_IDENT.self-edit-hash" ]; then
    fail "T-S5: hash marker not consumed by watcher"
    return
  fi
}

# ============================================================
# T-S6: watcher + mismatched marker → fires event.
# Simulates "peer edit landed during our settle window" — the sync hook
# recorded content A, but by the time the watcher looks the file is content
# B. The hash-guard must detect the mismatch and fire.
# ============================================================
test_T_S6_watcher_mismatched_marker_fires() {
  seed_fixture "s6role" "s6name"
  launch_watcher "$HOME_DIR" "$IDENT_DIR"

  if ! wait_for_baseline "$BASELINE_IDENT"; then
    fail "T-S6: identity baseline never landed"
    return
  fi
  sleep 0.3

  # Drop a marker with a bogus hash (would-have-been the agent's edit).
  printf '%s\n' "0000000000000000000000000000000000000000000000000000000000000000" \
    > "$BASELINE_IDENT.self-edit-hash"

  # Now write different content (would be a peer edit that landed after
  # the sync hook, before the watcher's settle finished).
  printf -- '---\nrole: s6role\ntask: peer wrote this\n---\n\n# s6name\n' > "$IDENT_MD"

  if ! wait_for_stdout_match '📝 \[identity-file: s6name\]' "$OUT_LOG"; then
    fail "T-S6: watcher did NOT emit event despite mismatched marker; out=$(cat "$OUT_LOG") err=$(cat "$ERR_LOG")"
    return
  fi

  # Stale marker must be consumed even in the mismatch path.
  if [ -f "$BASELINE_IDENT.self-edit-hash" ]; then
    fail "T-S6: stale marker not consumed after mismatch"
    return
  fi
}

# ============================================================
# T-S7: watcher without marker → fires event (today's behavior preserved).
# ============================================================
test_T_S7_watcher_no_marker_fires() {
  seed_fixture "s7role" "s7name"
  launch_watcher "$HOME_DIR" "$IDENT_DIR"

  if ! wait_for_baseline "$BASELINE_IDENT"; then
    fail "T-S7: identity baseline never landed"
    return
  fi
  sleep 0.3

  printf -- '---\nrole: s7role\ntask: no-marker edit\n---\n\n# s7name\n' > "$IDENT_MD"

  if ! wait_for_stdout_match '📝 \[identity-file: s7name\]' "$OUT_LOG"; then
    fail "T-S7: watcher did NOT emit event on marker-less change; out=$(cat "$OUT_LOG") err=$(cat "$ERR_LOG")"
    return
  fi
}

# ---- run ----

run_test test_T_S1_sync_drift
run_test test_T_S2_sync_no_drift
run_test test_T_S3_no_fleet_identity
run_test test_T_S4_no_state_dir
run_test test_T_S5_watcher_matching_marker_silent
run_test test_T_S6_watcher_mismatched_marker_fires
run_test test_T_S7_watcher_no_marker_fires

# ---- summary ----

printf '\n===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"

if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILURES[@]}"; do
    printf '  - %s\n' "$f"
  done
  exit 1
fi

exit 0
