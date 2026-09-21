#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for role-file-watch.py atomic-rename overwrite handling.
#
# Regression coverage for the bug where the backend's identity-file writes
# (fs.writeFile(<path>.tmp) + fs.rename → <path>) unlink the OLD watched
# inode, killing the inotify watch silently. Pre-fix: DELETE_SELF was not in
# the -e mask and the DELETE_SELF handler was fatal, so the watcher went
# deaf after the first atomic-rename write and every subsequent edit was
# invisible. Post-fix: DELETE_SELF is in the -e mask, and its handler
# emits any pending diff then respawns inotifywait on the new inode at
# the same path.
#
# Covers:
#   T-A1 — atomic tmp+rename over identity.md → diff event + baseline update
#          + watcher survives a SECOND atomic-rename (confirms respawn armed)
#   T-A2 — same but for role.md
#   T-A3 — genuine delete (no replacement) → watcher exits fatally
#          (regression guard: don't turn a real delete into a silent loop)
#
# Exits 0 on all-pass; 1 on any failure with a diagnostic naming the failing
# test.
#
# Usage: bash substrate/scripts/tests/role-file-watch-atomic-rename.test.sh
#   Run from the repo root.
#
# Hermetic contract: each test creates a fresh HOME_DIR via mktemp, seeds
# a synthetic ~/fleet/roles/<role>/<role>.md and ~/fleet/identities/<name>/
# <name>.md, and launches the watcher with HOME="$HOME_DIR". No test reads
# from or writes to the real ~/fleet/ tree.
#
# Requirements: bash, python3, inotifywait (required — this test targets
# the inotify code path specifically; polling fallback is orthogonal).

set -u

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PY_SCRIPT="$REPO_ROOT/substrate/scripts/role-file-watch.py"

if [ ! -f "$PY_SCRIPT" ]; then
  printf 'FATAL: role-file-watch.py not found at %s\n' "$PY_SCRIPT" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  printf 'FATAL: python3 not found\n' >&2
  exit 1
fi

if ! command -v inotifywait >/dev/null 2>&1; then
  printf 'FATAL: inotifywait not found — this test targets the inotify path\n' >&2
  exit 1
fi

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

# seed_fixture: build a hermetic HOME with role.md + identity.md.
# Sets globals: HOME_DIR, IDENT_DIR, ROLE_MD, IDENT_MD.
# NOT called via command substitution — subshells don't propagate globals
# back to the caller under `set -u`.
seed_fixture() {
  local role="$1" name="$2"
  HOME_DIR=$(make_tmpdir)
  IDENT_DIR="$HOME_DIR/fleet/identities/$name"
  mkdir -p "$HOME_DIR/fleet/roles/$role"
  mkdir -p "$IDENT_DIR"
  ROLE_MD="$HOME_DIR/fleet/roles/$role/$role.md"
  IDENT_MD="$IDENT_DIR/$name.md"
  printf '# %s role\n\nline 1\n' "$role" > "$ROLE_MD"
  printf -- '---\nrole: %s\n---\n\n# %s\n' "$role" "$name" > "$IDENT_MD"
}

# atomic_write: mimic backend's fs.writeFile(<path>.tmp) + fs.rename(<path>.tmp, <path>)
atomic_write() {
  local target="$1" contents="$2"
  local tmp="$target.tmp"
  printf '%s' "$contents" > "$tmp"
  mv "$tmp" "$target"
}

# launch_watcher: start role-file-watch.py under a hermetic HOME.
# Sets globals: WATCHER_PID, OUT_LOG, ERR_LOG.
# Registers the pid so cleanup will kill it if the test aborts.
launch_watcher() {
  local home_dir="$1" ident_dir="$2"
  OUT_LOG=$(make_tmpdir)/out.log
  ERR_LOG=$(make_tmpdir)/err.log
  HOME="$home_dir" AMBIENT_MONITOR_HARNESS_PID="$$" \
    python3 "$PY_SCRIPT" "$ident_dir" \
    >"$OUT_LOG" 2>"$ERR_LOG" &
  WATCHER_PID=$!
  ALL_PIDS+=("$WATCHER_PID")
}

# All wait helpers poll on 0.1s ticks; timeout is expressed in TICKS (i.e.
# tenths of a second). timeout=30 → up to 3 seconds real time.

# wait_for_baseline: block until the watcher's per-target baseline file
# exists (cold-start silent snapshot). Returns 0 on success, 1 on timeout.
wait_for_baseline() {
  local baseline="$1"
  local timeout="${2:-30}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if [ -f "$baseline" ]; then
      return 0
    fi
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  return 1
}

# wait_for_stdout_match: block until $OUT_LOG contains a line matching a
# grep pattern. Returns 0 on match, 1 on timeout.
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

# wait_for_process_exit: block until pid is gone. Returns 0 if exited, 1 on timeout.
wait_for_process_exit() {
  local pid="$1"
  local timeout="${2:-30}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  return 1
}

# ============================================================
# T-A1: atomic tmp+rename over identity.md fires diff event + baseline
#       updates + watcher survives a SECOND atomic-rename (respawn armed).
# ============================================================
test_T_A1_identity_atomic_rename() {
  local role="testrole" name="testname"
  seed_fixture "$role" "$name"

  local baseline_id="$IDENT_DIR/role-file-watch/last-snapshot.identity"

  launch_watcher "$HOME_DIR" "$IDENT_DIR"

  # Cold-start baselines must land before we induce the change.
  if ! wait_for_baseline "$baseline_id"; then
    fail "T-A1: identity baseline never landed (cold-start hung)"
    return
  fi

  # First atomic rename overwrite — pre-fix, this would silently kill the
  # inotify watch on the OLD inode and no event would ever fire.
  atomic_write "$IDENT_MD" "---
role: $role
task: freshly assigned
---

# $name
"

  if ! wait_for_stdout_match '📝 \[identity-file: testname\]' "$OUT_LOG"; then
    fail "T-A1: no identity-file event emitted after atomic-rename overwrite; out_log=$(cat "$OUT_LOG" 2>&1); err_log=$(cat "$ERR_LOG" 2>&1)"
    return
  fi

  # Baseline must have advanced to the new content.
  if ! grep -q "task: freshly assigned" "$baseline_id" 2>/dev/null; then
    fail "T-A1: baseline not updated after first atomic-rename"
    return
  fi

  # Second atomic rename — this is the critical regression test. Pre-fix,
  # even IF the first write somehow produced an event, the watch would
  # be dead for all subsequent writes. Post-fix, DELETE_SELF respawns
  # inotifywait so the watch re-arms on each new inode.
  #
  # Drain stdout counter: we assert the count of emitted events increased.
  local before_count after_count
  before_count=$(grep -c '📝 \[identity-file:' "$OUT_LOG" 2>/dev/null || printf '0')

  atomic_write "$IDENT_MD" "---
role: $role
task: second write
---

# $name
"

  # Poll for the count to increase past before_count.
  local elapsed=0
  after_count="$before_count"
  while [ "$elapsed" -lt 50 ]; do
    after_count=$(grep -c '📝 \[identity-file:' "$OUT_LOG" 2>/dev/null || printf '0')
    if [ "$after_count" -gt "$before_count" ]; then
      break
    fi
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  if [ "$after_count" -le "$before_count" ]; then
    fail "T-A1: no second identity-file event emitted (watch not respawned); before=$before_count after=$after_count out_log=$(cat "$OUT_LOG" 2>&1)"
    return
  fi

  if ! grep -q "task: second write" "$baseline_id" 2>/dev/null; then
    fail "T-A1: baseline not updated after second atomic-rename"
    return
  fi
}

# ============================================================
# T-A2: atomic tmp+rename over role.md fires diff event + baseline updates.
# ============================================================
test_T_A2_role_atomic_rename() {
  local role="rolealpha" name="alphaname"
  seed_fixture "$role" "$name"

  local baseline_role="$IDENT_DIR/role-file-watch/last-snapshot.role"

  launch_watcher "$HOME_DIR" "$IDENT_DIR"

  if ! wait_for_baseline "$baseline_role"; then
    fail "T-A2: role baseline never landed"
    return
  fi

  atomic_write "$ROLE_MD" "# $role role (updated)

new content
"

  if ! wait_for_stdout_match "📝 \[role-file: $role\]" "$OUT_LOG"; then
    fail "T-A2: no role-file event emitted after atomic-rename; out_log=$(cat "$OUT_LOG" 2>&1); err_log=$(cat "$ERR_LOG" 2>&1)"
    return
  fi

  if ! grep -q "new content" "$baseline_role" 2>/dev/null; then
    fail "T-A2: role baseline not updated"
    return
  fi
}

# ============================================================
# T-A3: genuine delete (no replacement) → watcher exits fatally.
# Regression guard: the DELETE_SELF respawn path must not turn a real
# delete into an infinite retry loop.
# ============================================================
test_T_A3_genuine_delete_exits_fatal() {
  local role="delrole" name="delname"
  seed_fixture "$role" "$name"

  local baseline_id="$IDENT_DIR/role-file-watch/last-snapshot.identity"

  launch_watcher "$HOME_DIR" "$IDENT_DIR"

  if ! wait_for_baseline "$baseline_id"; then
    fail "T-A3: identity baseline never landed"
    return
  fi

  # Unlink the identity file with no replacement.
  rm "$IDENT_MD"

  if ! wait_for_process_exit "$WATCHER_PID"; then
    fail "T-A3: watcher did not exit after genuine delete of identity file"
    return
  fi

  # Confirm nonzero exit — watcher signals fatal via exit(1).
  wait "$WATCHER_PID" 2>/dev/null
  local rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "T-A3: watcher exited with rc=0 after genuine delete (should be fatal)"
    return
  fi
}

# ---- run ----

run_test test_T_A1_identity_atomic_rename
run_test test_T_A2_role_atomic_rename
run_test test_T_A3_genuine_delete_exits_fatal

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
