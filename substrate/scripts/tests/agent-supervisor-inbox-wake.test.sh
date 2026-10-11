#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317
# Test driver for the fourth dormant-wake kind added by
# shape-agent-supervisor-inbox: inbox_has_files() returns 0 iff the identity
# has at least one valid-shape message file waiting in its inbox folder.
#
# Covers:
#   T-01  — no inbox folder at all → no wake (return 1)
#   T-02  — empty inbox folder → no wake (return 1)
#   T-03  — one valid-shape .msg file → wake (return 0)
#   T-04  — multiple valid-shape files → wake (return 0)
#   T-05  — inbox contains only mid-write temp files (.msg.tmp) → no wake
#   T-06  — inbox contains only wrong-shape .msg files (uppercase hex,
#           non-20-prefix year, missing timestamp component) → no wake
#   T-07  — inbox contains stray non-msg files (README.md, notes.txt) → no wake
#   T-08  — mix: one valid file + several invalid → wake (return 0)
#
# Not covered here: the full reconcile() dispatch (do_wake call). The
# dispatch is one `elif` in the dormant-branch if-chain and is covered by
# code inspection; adding a full reconcile-level test would require stubbing
# tmux + claude + the entire launch machinery, which is out of proportion
# for a one-line dispatch addition. The dwell-window manual-drive exercise
# verifies end-to-end dormant-wake behavior.
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/agent-supervisor-inbox-wake.test.sh
#   Run from the repo root.
#
# Hermetic contract: AGENT_IDENTITIES_DIR redirects to a scratch dir;
# AGENT_SUPERVISOR_LIB_ONLY=1 stops before the reconcile loop so function
# definitions are available for direct invocation.

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

pass() { PASS=$((PASS+1)); printf 'PASS: %s\n' "$CURRENT_TEST"; }
fail() {
  FAIL=$((FAIL+1))
  FAILURES+=("$CURRENT_TEST: $1")
  printf 'FAIL: %s — %s\n' "$CURRENT_TEST" "$1" >&2
}

SCRATCH=""
setup_scratch() {
  SCRATCH=$(mktemp -d)
  export AGENT_IDENTITIES_DIR="$SCRATCH"
  export AGENT_IDENTITIES_ARCHIVE_DIR="${SCRATCH}-archive"
  export DORMANCY_STATE_DIR="$SCRATCH/.state"
  mkdir -p "$SCRATCH/.state" "${SCRATCH}-archive"
  # Supervisor was sourced once at the top; its top-level `IDENTITIES_DIR=...`
  # read AGENT_IDENTITIES_DIR at source time (empty then, so fell back to the
  # real $HOME path). Override IDENTITIES_DIR directly so the function body —
  # which references $IDENTITIES_DIR — sees the scratch tree.
  IDENTITIES_DIR="$SCRATCH"
}

teardown_scratch() {
  [ -n "$SCRATCH" ] && [ -d "$SCRATCH" ] && rm -rf "$SCRATCH"
  [ -n "$SCRATCH" ] && [ -d "${SCRATCH}-archive" ] && rm -rf "${SCRATCH}-archive"
  SCRATCH=""
}

# ---- source supervisor hermetically ----
# shellcheck disable=SC1090
source "$SUPERVISOR" 2>/dev/null || true

if ! declare -F inbox_has_files >/dev/null 2>&1; then
  printf 'FATAL: inbox_has_files not defined after sourcing supervisor\n' >&2
  exit 1
fi

# ---- fixture helper ----
make_identity() {
  local name="$1"
  mkdir -p "$SCRATCH/$name"
  printf -- '---\nroles: test\n---\nbody\n' > "$SCRATCH/$name/$name.md"
}

# ---- run_case: setup scratch, run user function, teardown ----
run_case() {
  local name="$1"; shift
  CURRENT_TEST="$name"
  setup_scratch
  "$@"
  teardown_scratch
}

# ---- T-01: no inbox folder ----
t01() {
  make_identity alice
  if inbox_has_files alice; then
    fail "expected return 1 when no inbox folder, got 0"
  else
    pass
  fi
}

# ---- T-02: empty inbox folder ----
t02() {
  make_identity alice
  mkdir -p "$SCRATCH/alice/inbox"
  if inbox_has_files alice; then
    fail "expected return 1 on empty inbox, got 0"
  else
    pass
  fi
}

# ---- T-03: one valid-shape .msg file ----
t03() {
  make_identity alice
  mkdir -p "$SCRATCH/alice/inbox"
  printf 'ping' > "$SCRATCH/alice/inbox/20261002T143022123-abcdef12.msg"
  if inbox_has_files alice; then
    pass
  else
    fail "expected return 0 on valid file, got 1"
  fi
}

# ---- T-04: multiple valid-shape files ----
t04() {
  make_identity alice
  mkdir -p "$SCRATCH/alice/inbox"
  printf 'one' > "$SCRATCH/alice/inbox/20261002T143022100-11111111.msg"
  printf 'two' > "$SCRATCH/alice/inbox/20261002T143022200-22222222.msg"
  printf 'three' > "$SCRATCH/alice/inbox/20261002T143022300-33333333.msg"
  if inbox_has_files alice; then
    pass
  else
    fail "expected return 0 on multiple valid files, got 1"
  fi
}

# ---- T-05: mid-write temp files only ----
t05() {
  make_identity alice
  mkdir -p "$SCRATCH/alice/inbox"
  printf 'half1' > "$SCRATCH/alice/inbox/20261002T143022100-aaaaaaaa.msg.tmp"
  printf 'half2' > "$SCRATCH/alice/inbox/20261002T143022200-bbbbbbbb.msg.tmp"
  if inbox_has_files alice; then
    fail "expected return 1 when only .tmp files present, got 0"
  else
    pass
  fi
}

# ---- T-06: wrong-shape .msg files ----
t06() {
  make_identity alice
  mkdir -p "$SCRATCH/alice/inbox"
  # Uppercase hex (should be lowercase per openssl rand -hex output)
  printf 'x' > "$SCRATCH/alice/inbox/20261002T143022123-ABCDEF12.msg"
  # Year starts with 19 instead of 20
  printf 'x' > "$SCRATCH/alice/inbox/19991231T235959999-aaaaaaaa.msg"
  # Missing hex suffix
  printf 'x' > "$SCRATCH/alice/inbox/20261002T143022123.msg"
  # Missing timestamp
  printf 'x' > "$SCRATCH/alice/inbox/abcdef12.msg"
  if inbox_has_files alice; then
    fail "expected return 1 when only wrong-shape files present, got 0"
  else
    pass
  fi
}

# ---- T-07: stray non-.msg files ----
t07() {
  make_identity alice
  mkdir -p "$SCRATCH/alice/inbox"
  printf 'x' > "$SCRATCH/alice/inbox/README.md"
  printf 'x' > "$SCRATCH/alice/inbox/notes.txt"
  printf 'x' > "$SCRATCH/alice/inbox/.hidden"
  if inbox_has_files alice; then
    fail "expected return 1 when only non-.msg files present, got 0"
  else
    pass
  fi
}

# ---- T-08: mix of invalid + one valid ----
t08() {
  make_identity alice
  mkdir -p "$SCRATCH/alice/inbox"
  printf 'junk' > "$SCRATCH/alice/inbox/README.md"
  printf 'junk' > "$SCRATCH/alice/inbox/20261002T143022123-XYZXYZXY.msg"
  printf 'ok'   > "$SCRATCH/alice/inbox/20261002T143022500-deadbeef.msg"
  printf 'junk' > "$SCRATCH/alice/inbox/20261002T143022600-ffffffff.msg.tmp"
  if inbox_has_files alice; then
    pass
  else
    fail "expected return 0 with one valid file in the mix, got 1"
  fi
}

run_case T-01 t01
run_case T-02 t02
run_case T-03 t03
run_case T-04 t04
run_case T-05 t05
run_case T-06 t06
run_case T-07 t07
run_case T-08 t08

printf '\n--- summary: %d pass, %d fail ---\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '\nfailures:\n'
  for f in "${FAILURES[@]}"; do printf '  %s\n' "$f"; done
  exit 1
fi
exit 0
