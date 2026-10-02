#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for inbox-watcher.py — the fifth ambient-watcher child added by
# shape-agent-supervisor-inbox (composebox-via-agent-supervisor campaign).
#
# Covers:
#   T-1  — inotify pickup of a dropped file (write-and-rename lands as a
#          RAW-PASTE-FILE:<abs path> line on child stdout)
#   T-2  — order preservation under multiple files (lexical sort of the
#          timestamp-hex filename equals arrival order)
#   T-3  — catch-up-on-startup: files already in the inbox when the child
#          launches are surfaced in lexical order BEFORE the inotify watch
#          arms (covers the dormant-wake catch-up case)
#   T-4b — name-shape filter: files whose names do NOT match the final
#          shape (operator notes, mid-write .tmp files, stray artifacts)
#          are ignored
#
# Zero-byte refusal and bare-paste discipline (T-4a + T-6 from the shape's
# test list) live in the ambient-monitor PARENT, not the child — covered
# by manual-drive exercise during the Shape 1 dwell window rather than a
# dedicated unit test (parent is hard to unit-test in isolation because its
# top-level code assembles child specs + launches the paste pipeline).
#
# Exits 0 on all-pass; 1 on any failure with a diagnostic naming the failing
# test.
#
# Usage: bash substrate/scripts/tests/inbox-watcher.test.sh
#   Run from the repo root.
#
# Hermetic contract: each test creates a fresh IDENTITY_DIR under mktemp,
# launches the watcher pointed at that dir, and manipulates its inbox. No
# test touches the real ~/fleet/ tree.
#
# Requirements: bash, python3, inotifywait (polling fallback is orthogonal).

set -u

# ---- path resolution ----
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PY_SCRIPT="$REPO_ROOT/substrate/scripts/inbox-watcher.py"

if [ ! -f "$PY_SCRIPT" ]; then
  printf 'FATAL: inbox-watcher.py not found at %s\n' "$PY_SCRIPT" >&2
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

# Launch the watcher in the background. $1 = identity dir, $2 = stdout log file.
# Appends its PID to ALL_PIDS. Returns the PID on stdout.
launch_watcher() {
  local idir="$1"
  local stdout_log="$2"
  local stderr_log="$3"
  python3 "$PY_SCRIPT" "$idir" >"$stdout_log" 2>"$stderr_log" &
  local pid=$!
  ALL_PIDS+=("$pid")
  printf '%s' "$pid"
}

# Drop a message atomically — mirrors the dropper contract.
# $1 = inbox dir, $2 = payload bytes, $3 = filename (final shape).
drop() {
  local inbox="$1"
  local payload="$2"
  local name="$3"
  mkdir -p "$inbox"
  printf '%s' "$payload" > "$inbox/${name}.tmp"
  mv "$inbox/${name}.tmp" "$inbox/${name}"
}

# Wait up to $1 seconds for $2 lines to appear in $3. Returns 0 on success.
wait_for_lines() {
  local timeout_s="$1"
  local want="$2"
  local file="$3"
  local deadline=$((SECONDS + timeout_s))
  while [ "$SECONDS" -lt "$deadline" ]; do
    local n
    n=$(wc -l < "$file" 2>/dev/null || echo 0)
    if [ "$n" -ge "$want" ]; then return 0; fi
    sleep 0.1
  done
  return 1
}

pass() { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); FAILURES+=("$1: $2"); printf 'FAIL: %s — %s\n' "$1" "$2" >&2; }

# ---- T-1: inotify pickup of a dropped file ----
run_t1() {
  local tmp inbox pid out err
  tmp=$(make_tmpdir)
  mkdir -p "$tmp/identity"
  inbox="$tmp/identity/inbox"
  out="$tmp/stdout.log"
  err="$tmp/stderr.log"
  pid=$(launch_watcher "$tmp/identity" "$out" "$err")
  sleep 0.5  # give the watcher time to arm inotify
  local ts="20261002T143022123" hex="deadbeef" name
  name="${ts}-${hex}.msg"
  drop "$inbox" "ping" "$name"
  if ! wait_for_lines 5 1 "$out"; then
    fail "T-1" "no RAW-PASTE-FILE line emitted within 5s. stdout=$(cat "$out"), stderr=$(cat "$err")"
    kill "$pid" 2>/dev/null; return
  fi
  local line expected
  line=$(head -n1 "$out")
  expected="RAW-PASTE-FILE:$inbox/$name"
  if [ "$line" != "$expected" ]; then
    fail "T-1" "expected '$expected', got '$line'"
    kill "$pid" 2>/dev/null; return
  fi
  pass "T-1 inotify pickup"
  kill "$pid" 2>/dev/null
}

# ---- T-2: order preservation under multiple files ----
run_t2() {
  local tmp inbox pid out err
  tmp=$(make_tmpdir)
  mkdir -p "$tmp/identity"
  inbox="$tmp/identity/inbox"
  out="$tmp/stdout.log"
  err="$tmp/stderr.log"
  pid=$(launch_watcher "$tmp/identity" "$out" "$err")
  sleep 0.5
  # Three files, timestamps strictly increasing (so lexical sort = arrival order).
  local names=(
    "20261002T143022100-aaaaaaaa.msg"
    "20261002T143022200-bbbbbbbb.msg"
    "20261002T143022300-cccccccc.msg"
  )
  for n in "${names[@]}"; do
    drop "$inbox" "message-$n" "$n"
    sleep 0.05  # ensure distinguishable inotify event ordering
  done
  if ! wait_for_lines 5 3 "$out"; then
    fail "T-2" "expected 3 lines, got $(wc -l < "$out"). stdout=$(cat "$out"), stderr=$(cat "$err")"
    kill "$pid" 2>/dev/null; return
  fi
  local i=0
  while IFS= read -r line; do
    local want="RAW-PASTE-FILE:$inbox/${names[$i]}"
    if [ "$line" != "$want" ]; then
      fail "T-2" "line $i expected '$want', got '$line'"
      kill "$pid" 2>/dev/null; return
    fi
    i=$((i+1))
  done < "$out"
  if [ "$i" -ne 3 ]; then
    fail "T-2" "expected 3 lines, saw $i"
    kill "$pid" 2>/dev/null; return
  fi
  pass "T-2 order preservation"
  kill "$pid" 2>/dev/null
}

# ---- T-3: catch-up-on-startup ----
run_t3() {
  local tmp inbox pid out err
  tmp=$(make_tmpdir)
  mkdir -p "$tmp/identity"
  inbox="$tmp/identity/inbox"
  mkdir -p "$inbox"
  # Drop files BEFORE launching the watcher.
  local names=(
    "20261002T100000111-11111111.msg"
    "20261002T100000222-22222222.msg"
    "20261002T100000333-33333333.msg"
  )
  for n in "${names[@]}"; do
    printf 'catch-up-%s' "$n" > "$inbox/${n}.tmp"
    mv "$inbox/${n}.tmp" "$inbox/${n}"
  done
  out="$tmp/stdout.log"
  err="$tmp/stderr.log"
  pid=$(launch_watcher "$tmp/identity" "$out" "$err")
  if ! wait_for_lines 5 3 "$out"; then
    fail "T-3" "expected 3 catch-up lines, got $(wc -l < "$out"). stderr=$(cat "$err")"
    kill "$pid" 2>/dev/null; return
  fi
  local i=0
  while IFS= read -r line; do
    local want="RAW-PASTE-FILE:$inbox/${names[$i]}"
    if [ "$line" != "$want" ]; then
      fail "T-3" "line $i expected '$want', got '$line'"
      kill "$pid" 2>/dev/null; return
    fi
    i=$((i+1))
  done < "$out"
  if [ "$i" -ne 3 ]; then
    fail "T-3" "expected 3 catch-up lines, saw $i"
    kill "$pid" 2>/dev/null; return
  fi
  pass "T-3 catch-up-on-startup"
  kill "$pid" 2>/dev/null
}

# ---- T-4b: name-shape filter ignores non-matching filenames ----
run_t4b() {
  local tmp inbox pid out err
  tmp=$(make_tmpdir)
  mkdir -p "$tmp/identity"
  inbox="$tmp/identity/inbox"
  out="$tmp/stdout.log"
  err="$tmp/stderr.log"
  pid=$(launch_watcher "$tmp/identity" "$out" "$err")
  sleep 0.5
  # Drop a batch of files, all of which should be ignored. The valid-shape
  # file at the end is the probe that confirms the watcher is actually
  # running — if THAT doesn't come through, the test is inconclusive, not a
  # genuine fail of the filter rule.
  mkdir -p "$inbox"
  printf 'junk' > "$inbox/README.md"             # wrong extension
  printf 'junk' > "$inbox/notes.txt"             # wrong extension
  printf 'junk' > "$inbox/garbage.msg"           # wrong name shape (no timestamp+hex)
  printf 'junk' > "$inbox/20261002T143022123-XYZXYZXY.msg"  # uppercase hex (not matching [0-9a-f])
  printf 'junk' > "$inbox/19991231T235959999-aaaaaaaa.msg"  # year starts with "19", not "20"
  printf 'half' > "$inbox/20261002T143022123-ffffffff.msg.tmp"  # mid-write temp
  sleep 1
  if [ -s "$out" ]; then
    fail "T-4b" "expected zero lines after invalid drops, got $(cat "$out")"
    kill "$pid" 2>/dev/null; return
  fi
  # Probe: a valid drop should pass through.
  drop "$inbox" "probe" "20261002T143022123-ffffffff.msg"
  if ! wait_for_lines 3 1 "$out"; then
    fail "T-4b" "probe drop did not surface — watcher may be wedged. stderr=$(cat "$err")"
    kill "$pid" 2>/dev/null; return
  fi
  local line want
  line=$(head -n1 "$out")
  want="RAW-PASTE-FILE:$inbox/20261002T143022123-ffffffff.msg"
  if [ "$line" != "$want" ]; then
    fail "T-4b" "probe expected '$want', got '$line'"
    kill "$pid" 2>/dev/null; return
  fi
  pass "T-4b name-shape filter"
  kill "$pid" 2>/dev/null
}

run_t1
run_t2
run_t3
run_t4b

printf '\n--- summary: %d pass, %d fail ---\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '\nfailures:\n'
  for f in "${FAILURES[@]}"; do printf '  %s\n' "$f"; done
  exit 1
fi
exit 0
