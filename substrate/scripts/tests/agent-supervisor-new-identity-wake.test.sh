#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317,SC2034
# Test driver for the new-identity early wake: wait_for_next_tick() ends the between-tick sleep
# early when a new identity folder lands in $IDENTITIES_DIR, and otherwise sleeps out the full
# CHECK_INTERVAL exactly as the plain `sleep` did.
#
# Covers:
#   T-01  — nothing happens → full interval elapses
#   T-02  — identity folder mv'd in mid-wait → returns early
#   T-03  — identity folder landed mid-reconcile (before the watch armed) → returns after min gap
#   T-04  — plain file created at top level → no early wake
#   T-05  — dot-directory created at top level → no early wake
#   T-06  — NEW_IDENTITY_WAKE=off → plain sleep, ignores new folders
#   T-07  — early wake records the newborn's name for the fast path
#   T-08..T-11 — launch_newborns: launches a plain newborn; skips one with a tmux session, a
#           dormant / archive-requested / file-less folder, and everything under DRY_RUN
#
# Exits 0 on all-pass; 1 on any failure. Requires inotifywait (skips if absent).
#
# Usage: bash substrate/scripts/tests/agent-supervisor-new-identity-wake.test.sh
#   Run from the repo root.

export AGENT_SUPERVISOR_LIB_ONLY=1

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SUPERVISOR="${SUPERVISOR:-$REPO_ROOT/substrate/scripts/agent-supervisor.sh}"

if ! command -v inotifywait >/dev/null 2>&1; then
  printf 'SKIP: inotifywait not installed\n'; exit 0
fi

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

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
export AGENT_IDENTITIES_DIR="$SCRATCH/identities"
mkdir -p "$AGENT_IDENTITIES_DIR" "$SCRATCH/staging"

# shellcheck source=/dev/null
source "$SUPERVISOR" >/dev/null 2>&1
log() { :; }

CHECK_INTERVAL=4
NEW_IDENTITY_MIN_GAP=1

now_ms() { date +%s%3N; }

# Runs wait_for_next_tick with the listing snapshot taken now; echoes elapsed ms.
timed_wait() {
  local t0; t0=$(now_ms)
  wait_for_next_tick
  echo $(( $(now_ms) - t0 ))
}

reset_dir() { rm -rf "${AGENT_IDENTITIES_DIR:?}"/* "${AGENT_IDENTITIES_DIR:?}"/.[!.]* 2>/dev/null; mkdir -p "$AGENT_IDENTITIES_DIR/existing"; }

CURRENT_TEST="T-01 no activity → full interval"
reset_dir; IDENTITY_LISTING_AT_TICK="$(identity_listing)"
ms=$(timed_wait)
if [ "$ms" -ge 3800 ] && [ "$ms" -le 5500 ]; then pass; else fail "elapsed ${ms}ms, want ~4000"; fi

CURRENT_TEST="T-02 folder mv'd in mid-wait → early return"
reset_dir; IDENTITY_LISTING_AT_TICK="$(identity_listing)"
mkdir -p "$SCRATCH/staging/newborn"
( sleep 1.8; mv "$SCRATCH/staging/newborn" "$AGENT_IDENTITIES_DIR/newborn" ) &
ms=$(timed_wait); wait
if [ "$ms" -ge 1500 ] && [ "$ms" -le 2800 ]; then pass; else fail "elapsed ${ms}ms, want ~1800"; fi

CURRENT_TEST="T-03 folder landed mid-reconcile → returns after min gap"
reset_dir; IDENTITY_LISTING_AT_TICK="$(identity_listing)"
mkdir -p "$AGENT_IDENTITIES_DIR/midtick"
ms=$(timed_wait)
if [ "$ms" -ge 900 ] && [ "$ms" -le 2200 ]; then pass; else fail "elapsed ${ms}ms, want ~1000"; fi

CURRENT_TEST="T-04 plain file at top level → no early wake"
reset_dir; IDENTITY_LISTING_AT_TICK="$(identity_listing)"
( sleep 1.8; touch "$AGENT_IDENTITIES_DIR/stray-file" ) &
ms=$(timed_wait); wait
if [ "$ms" -ge 3800 ] && [ "$ms" -le 5500 ]; then pass; else fail "elapsed ${ms}ms, want ~4000"; fi

CURRENT_TEST="T-05 dot-dir at top level → no early wake"
reset_dir; IDENTITY_LISTING_AT_TICK="$(identity_listing)"
( sleep 1.8; mkdir "$AGENT_IDENTITIES_DIR/.hidden" ) &
ms=$(timed_wait); wait
if [ "$ms" -ge 3800 ] && [ "$ms" -le 5500 ]; then pass; else fail "elapsed ${ms}ms, want ~4000"; fi

CURRENT_TEST="T-06 NEW_IDENTITY_WAKE=off → plain sleep"
reset_dir; IDENTITY_LISTING_AT_TICK="$(identity_listing)"
NEW_IDENTITY_WAKE=off
( sleep 1.8; mkdir "$AGENT_IDENTITIES_DIR/ignored" ) &
ms=$(timed_wait); wait
NEW_IDENTITY_WAKE=on
if [ "$ms" -ge 3800 ] && [ "$ms" -le 5500 ]; then pass; else fail "elapsed ${ms}ms, want ~4000"; fi

CURRENT_TEST="T-07 early wake records the newborn in EARLY_WAKE_NAMES"
reset_dir; IDENTITY_LISTING_AT_TICK="$(identity_listing)"; EARLY_WAKE_NAMES=""
mkdir -p "$SCRATCH/staging/kid"
( sleep 1.5; mv "$SCRATCH/staging/kid" "$AGENT_IDENTITIES_DIR/kid" ) &
wait_for_next_tick; wait
if [ "$EARLY_WAKE_NAMES" = "kid" ]; then pass; else fail "EARLY_WAKE_NAMES='$EARLY_WAKE_NAMES', want 'kid'"; fi

# ---- launch_newborns (fast path) ----
# launch() is stubbed to record calls; tmux is a PATH stub (launch_newborns calls it via timeout)
# whose `ls` prints the session names in $SCRATCH/sessions.
mkdir -p "$SCRATCH/bin"
printf '#!/usr/bin/env bash\n[ "$1" = ls ] && cat "%s/sessions" 2>/dev/null\nexit 0\n' "$SCRATCH" >"$SCRATCH/bin/tmux"
chmod +x "$SCRATCH/bin/tmux"
PATH="$SCRATCH/bin:$PATH"
LAUNCHED=()
launch() { LAUNCHED+=("$1:$2:$3"); }
newborn() { mkdir -p "$AGENT_IDENTITIES_DIR/$1"; touch "$AGENT_IDENTITIES_DIR/$1/$1.md"; }

CURRENT_TEST="T-08 fast path launches a plain newborn fresh, then clears EARLY_WAKE_NAMES"
reset_dir; : >"$SCRATCH/sessions"; LAUNCHED=(); newborn kid; EARLY_WAKE_NAMES="kid"
launch_newborns
if [ "${LAUNCHED[*]}" = "kid:fresh:kid" ] && [ -z "$EARLY_WAKE_NAMES" ]; then pass; else fail "launched='${LAUNCHED[*]}' names='$EARLY_WAKE_NAMES'"; fi

CURRENT_TEST="T-09 fast path skips a newborn that already has a tmux session"
reset_dir; echo kid >"$SCRATCH/sessions"; LAUNCHED=(); newborn kid; EARLY_WAKE_NAMES="kid"
launch_newborns
if [ "${#LAUNCHED[@]}" = 0 ]; then pass; else fail "launched='${LAUNCHED[*]}'"; fi

CURRENT_TEST="T-10 fast path skips dormant / archive-requested / no-identity-file folders"
reset_dir; : >"$SCRATCH/sessions"; LAUNCHED=()
newborn sleepy; touch "$AGENT_IDENTITIES_DIR/sleepy/.dormant"
newborn gone; touch "$AGENT_IDENTITIES_DIR/gone/.archive-requested"
mkdir -p "$AGENT_IDENTITIES_DIR/halfbaked"
EARLY_WAKE_NAMES="sleepy gone halfbaked"
launch_newborns
if [ "${#LAUNCHED[@]}" = 0 ]; then pass; else fail "launched='${LAUNCHED[*]}'"; fi

CURRENT_TEST="T-11 DRY_RUN → fast path launches nothing"
reset_dir; : >"$SCRATCH/sessions"; LAUNCHED=(); newborn kid; EARLY_WAKE_NAMES="kid"
DRY_RUN=1 launch_newborns
if [ "${#LAUNCHED[@]}" = 0 ]; then pass; else fail "launched='${LAUNCHED[*]}'"; fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  for f in "${FAILURES[@]}"; do printf '  %s\n' "$f" >&2; done
  exit 1
fi
exit 0
