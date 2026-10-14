#!/usr/bin/env bash
# shellcheck shell=bash
# Test driver for role-file-watch.py fan-out spread.
#
# A shared watched file (id skill, user-wide CLAUDE.md, role file, runbook,
# project file) wakes every running identity that watches it. When more than one
# running identity on the box shares the target, the event line is held for a
# random delay in [0, min(per-agent × sharers, cap)) and emitted from a pending
# queue; a single sharer — and the identity file always — emits immediately.
#
# Covers:
#   T-F1 — role file shared with a running peer: held (stderr names 2 sharers),
#          then emitted once within the cap.
#   T-F2 — the only other holder is dormant: emitted immediately, nothing held.
#   T-F3 — identity-file edit is never held, even with running role peers.
#   T-F4 — id skill counts every running identity, whatever its role.
#   T-F5 — a held line survives a watcher restart and is emitted exactly once
#          by the next process.
#   T-F6 — two held edits to one file arrive in edit order.
#   T-F7 — a line claimed by a process that died mid-delivery is re-queued and
#          emitted once at startup.
#   T-F8 — leaving a role drops that role's held lines.
#
# Exits 0 on all-pass; 1 on any failure.
#
# Usage: bash substrate/scripts/tests/role-file-watch-fanout.test.sh
#   Run from the repo root.
#
# Requirements: bash, python3, inotifywait.

set -u

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PY_SCRIPT="$REPO_ROOT/substrate/scripts/role-file-watch.py"

for bin in python3 inotifywait; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    printf 'FATAL: %s not found\n' "$bin" >&2
    exit 1
  fi
done

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
  FAILURES+=("${CURRENT_TEST:-unknown}: ${1:-unknown failure}")
  FAIL=$((FAIL + 1))
}

run_test() {
  local test_fn="$1"
  local before_fail=$FAIL
  CURRENT_TEST="$test_fn"
  "$test_fn"
  [ -n "${WATCHER_PID:-}" ] && kill "$WATCHER_PID" 2>/dev/null
  WATCHER_PID=""
  if [ "$FAIL" -eq "$before_fail" ]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$test_fn"
  else
    printf 'FAIL  %s\n' "$test_fn"
  fi
}

NAME="fanme"

# seed_fixture — hermetic HOME with role `rolex`, role `roley`, an id skill,
# and the watched identity holding rolex.
seed_fixture() {
  HOME_DIR=$(make_tmpdir)
  IDS="$HOME_DIR/fleet/identities"
  IDENT_DIR="$IDS/$NAME"
  IDENT_MD="$IDENT_DIR/$NAME.md"
  STATE="$IDENT_DIR/role-file-watch"
  PENDING="$STATE/.state/pending"
  ROLE_MD="$HOME_DIR/fleet/roles/rolex/rolex.md"
  SKILL_MD="$HOME_DIR/.claude/skills/id/SKILL.md"
  mkdir -p "$(dirname "$ROLE_MD")" "$HOME_DIR/fleet/roles/roley" "$(dirname "$SKILL_MD")"
  printf '# rolex\n\nline 1\n' > "$ROLE_MD"
  printf '# roley\n' > "$HOME_DIR/fleet/roles/roley/roley.md"
  printf '# id skill\n' > "$SKILL_MD"
  add_identity "$NAME" rolex
}

# add_identity <name> <role> [dormant]
add_identity() {
  mkdir -p "$IDS/$1"
  printf -- '---\nroles: [%s]\ntask: t\n---\n\n# %s\n' "$2" "$1" > "$IDS/$1/$1.md"
  [ "${3:-}" = dormant ] && touch "$IDS/$1/.dormant"
  return 0
}

# launch_watcher [per-agent-sec] [cap-sec]
launch_watcher() {
  OUT_LOG=${OUT_LOG:-$(make_tmpdir)/out.log}
  ERR_LOG=$(make_tmpdir)/err.log
  HOME="$HOME_DIR" AMBIENT_MONITOR_HARNESS_PID="$$" \
    ROLE_WATCH_FANOUT_SEC_PER_AGENT="${1:-1000}" ROLE_WATCH_FANOUT_CAP_SEC="${2:-3}" \
    python3 "$PY_SCRIPT" "$IDENT_DIR" >>"$OUT_LOG" 2>"$ERR_LOG" &
  WATCHER_PID=$!
  ALL_PIDS+=("$WATCHER_PID")
}

wait_for() {
  # wait_for <timeout-ticks> <test-command...> — 0.1s ticks
  local timeout="$1" elapsed=0
  shift
  while [ "$elapsed" -lt "$timeout" ]; do
    "$@" && return 0
    sleep 0.1
    elapsed=$((elapsed + 1))
  done
  return 1
}

out_has() { [ -f "$OUT_LOG" ] && grep -qE "$1" "$OUT_LOG"; }
out_count() { grep -cE "$1" "$OUT_LOG" 2>/dev/null; }
err_has() { [ -f "$ERR_LOG" ] && grep -qE "$1" "$ERR_LOG"; }
pending_count() { find "$PENDING" -name '*.line' 2>/dev/null | wc -l; }
has_pending() { [ "$(pending_count)" -gt 0 ]; }
pending_at_least() { [ "$(pending_count)" -ge "$1" ]; }
pending_empty() { [ "$(pending_count)" -eq 0 ]; }
logs() { printf 'out=%s err=%s' "$(cat "$OUT_LOG" 2>/dev/null)" "$(cat "$ERR_LOG" 2>/dev/null)"; }
wait_armed() { wait_for 50 test -f "$STATE/last-snapshot.identity"; sleep 1; }

test_T_F1_shared_role_held() {
  OUT_LOG=""; seed_fixture
  add_identity peer rolex
  launch_watcher
  wait_armed
  printf 'shared edit\n' >> "$ROLE_MD"
  if ! wait_for 30 err_has 'role-file: rolex event shared by 2 running identities — holding'; then
    fail "role-file event not held; $(logs)"; return
  fi
  if ! wait_for 60 out_has '📝 \[role-file: rolex\].*shared edit'; then
    fail "held event never emitted within cap; $(logs)"; return
  fi
  wait_for 20 pending_empty || { fail "pending file left behind"; return; }
  [ "$(out_count 'shared edit')" -eq 1 ] || fail "emitted more than once; $(logs)"
}

test_T_F2_dormant_peer_not_counted() {
  OUT_LOG=""; seed_fixture
  add_identity peer rolex dormant
  launch_watcher 1000 300
  wait_armed
  printf 'solo edit\n' >> "$ROLE_MD"
  if ! wait_for 30 out_has '📝 \[role-file: rolex\].*solo edit'; then
    fail "single-sharer event not emitted immediately; $(logs)"; return
  fi
  err_has 'holding' && fail "event was held with a dormant peer; $(logs)"
}

test_T_F3_identity_file_never_held() {
  OUT_LOG=""; seed_fixture
  add_identity peer1 rolex
  add_identity peer2 rolex
  launch_watcher 1000 300
  wait_armed
  printf 'identity note\n' >> "$IDENT_MD"
  if ! wait_for 30 out_has '📝 \[identity-file: fanme\].*identity note'; then
    fail "identity-file event not emitted immediately; $(logs)"; return
  fi
  has_pending && fail "identity-file event queued; $(logs)"
}

test_T_F4_id_skill_counts_all_running() {
  OUT_LOG=""; seed_fixture
  add_identity other1 roley
  add_identity other2 roley
  add_identity sleeper roley dormant
  launch_watcher
  wait_armed
  printf 'skill change\n' >> "$SKILL_MD"
  if ! wait_for 30 err_has 'id-skill: id event shared by 3 running identities — holding'; then
    fail "id-skill event not held for 3 running identities; $(logs)"; return
  fi
  wait_for 60 out_has '📝 \[id-skill: id\].*skill change' || fail "held id-skill event never emitted; $(logs)"
}

test_T_F5_pending_survives_restart() {
  OUT_LOG=""; seed_fixture
  add_identity peer rolex
  launch_watcher 1000 300   # long hold so it can't fire before the kill
  wait_armed
  printf 'carry me\n' >> "$ROLE_MD"
  if ! wait_for 30 has_pending; then fail "no pending line queued; $(logs)"; return; fi
  kill "$WATCHER_PID"; wait "$WATCHER_PID" 2>/dev/null
  out_has 'carry me' && { fail "emitted before restart"; return; }
  # Pull the held line's due time to now, as if the hold had elapsed while down.
  local f; f=$(find "$PENDING" -name '*.line' | head -1)
  mv "$f" "$PENDING/1000-$(basename "$f" | cut -d- -f2)"
  launch_watcher
  if ! wait_for 50 out_has '📝 \[role-file: rolex\].*carry me'; then
    fail "held line not emitted after restart; $(logs)"; return
  fi
  sleep 1
  [ "$(out_count 'carry me')" -eq 1 ] || fail "held line emitted more than once; $(logs)"
}

test_T_F6_same_target_in_order() {
  OUT_LOG=""; seed_fixture
  add_identity peer rolex
  launch_watcher 1000 12
  wait_armed
  printf 'first edit\n' >> "$ROLE_MD"
  wait_for 30 has_pending || { fail "first edit not held; $(logs)"; return; }
  printf 'second edit\n' >> "$ROLE_MD"
  wait_for 30 pending_at_least 2 || { fail "second edit not held; $(logs)"; return; }
  if ! wait_for 200 out_has 'second edit'; then fail "second edit never emitted; $(logs)"; return; fi
  local a b
  a=$(grep -n 'first edit' "$OUT_LOG" | head -1 | cut -d: -f1)
  b=$(grep -n 'second edit' "$OUT_LOG" | head -1 | cut -d: -f1)
  [ -n "$a" ] && [ "$a" -lt "$b" ] || fail "edits out of order (first@${a:-none} second@$b); $(logs)"
}

test_T_F7_claimed_line_requeued() {
  OUT_LOG=""; seed_fixture
  mkdir -p "$PENDING"
  printf '📝 [role-file: rolex] your role file changed — orphaned claim' \
    > "$PENDING/1000-abcdef12.line.claimed"
  launch_watcher
  if ! wait_for 50 out_has 'orphaned claim'; then fail "claimed line not re-emitted; $(logs)"; return; fi
  sleep 1
  [ "$(out_count 'orphaned claim')" -eq 1 ] || fail "claimed line emitted more than once"
  [ -z "$(ls -A "$PENDING")" ] || fail "pending dir not empty: $(ls -A "$PENDING")"
}

test_T_F8_role_removal_drops_held() {
  OUT_LOG=""; seed_fixture
  add_identity peer rolex
  launch_watcher 1000 300
  wait_armed
  printf 'stale role edit\n' >> "$ROLE_MD"
  wait_for 30 has_pending || { fail "role edit not held; $(logs)"; return; }
  printf -- '---\nroles: [roley]\ntask: t\n---\n\n# %s\n' "$NAME" > "$IDENT_MD.tmp"
  mv "$IDENT_MD.tmp" "$IDENT_MD"
  if ! wait_for 50 out_has 'you no longer hold role rolex'; then fail "no role-removal line; $(logs)"; return; fi
  wait_for 30 pending_empty || fail "held rolex line not dropped; $(ls "$PENDING")"
}

run_test test_T_F1_shared_role_held
run_test test_T_F2_dormant_peer_not_counted
run_test test_T_F3_identity_file_never_held
run_test test_T_F4_id_skill_counts_all_running
run_test test_T_F5_pending_survives_restart
run_test test_T_F6_same_target_in_order
run_test test_T_F7_claimed_line_requeued
run_test test_T_F8_role_removal_drops_held

printf '\n===============================\n'
printf 'PASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'
  for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
