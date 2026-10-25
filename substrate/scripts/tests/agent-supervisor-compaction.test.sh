#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2317
# Test driver for the supervisor's compaction request handling (Condense):
# handle_compaction / start_compaction / compaction_progress / compaction_landed /
# inbox_drop.
#
# Covers:
#   C-01 — no request, nothing in flight → nothing happens
#   C-02 — dormant identity with a request → /compact delivered to the inbox,
#          .compacting written, request removed
#   C-03 — guidance in the request rides along, flattened to one line
#   C-04 — awake but mid-turn → request left for a later tick
#   C-05 — awake and at rest → /compact delivered
#   C-06 — awake, harness not running → request left
#   C-07 — in flight, compaction not landed yet → nothing delivered, marker kept
#   C-08 — in flight, boundary newer than the request lands → "Compaction done"
#          event delivered in the supervisor envelope, marker removed
#   C-09 — in flight, only an OLDER boundary in the file → not treated as landed
#   C-10 — a second request while one is in flight is dropped as a duplicate
#   C-11 — in flight past the timeout with nothing landed → marker removed, no event
#   C-12 — inbox file names match the inbox-watcher dropper contract
#   C-13 — an old-style reset request (.recycle-requested) is taken as a compaction request
#   C-14 — a request the agent never comes to rest for expires
#   C-15 — control characters are stripped from the guidance
#   C-16 — the dormancy check holds off while a compaction is asked for / under way / queued
#   C-17..C-20 — agent_at_rest on idle, busy, quoted-footer-text and dialog panes
#
# Exits 0 on all-pass; 1 on any failure.
# Usage: bash substrate/scripts/tests/agent-supervisor-compaction.test.sh   (from the repo root)

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
pass() { PASS=$((PASS+1)); printf 'PASS: %s\n' "$CURRENT_TEST"; }
fail() { FAIL=$((FAIL+1)); FAILURES+=("$CURRENT_TEST: $1"); printf 'FAIL: %s — %s\n' "$CURRENT_TEST" "$1" >&2; }

# shellcheck disable=SC1090
source "$SUPERVISOR" 2>/dev/null || true
declare -F handle_compaction >/dev/null 2>&1 || { printf 'FATAL: handle_compaction not defined\n' >&2; exit 1; }

# Stubs — no tmux, no claude, no real session discovery.
STUB_RUNNING=1
STUB_AT_REST=1
STUB_SESSION_FILE=""
claude_running_cached() { [ "$STUB_RUNNING" = 1 ]; }
agent_at_rest() { [ "$STUB_AT_REST" = 1 ]; }
main_session_file() { [ -n "$STUB_SESSION_FILE" ] || return 1; printf '%s' "$STUB_SESSION_FILE"; }
log() { :; }
metric() { :; }

SCRATCH=""
N=who
D=""
setup() {
  SCRATCH=$(mktemp -d)
  IDENTITIES_DIR="$SCRATCH"
  D="$SCRATCH/$N"
  mkdir -p "$D"
  STUB_RUNNING=1; STUB_AT_REST=1; STUB_SESSION_FILE=""
}
teardown() { [ -n "$SCRATCH" ] && rm -rf "$SCRATCH"; SCRATCH=""; }
inbox_count() { find "$D/inbox" -maxdepth 1 -name '*.msg' 2>/dev/null | wc -l; }
inbox_only() { cat "$D"/inbox/*.msg 2>/dev/null; }

CURRENT_TEST="C-01 nothing requested"
setup
handle_compaction "$N" "sess"
if [ "$(inbox_count)" = 0 ] && [ ! -e "$D/.compacting" ]; then pass; else fail "something was delivered"; fi
teardown

CURRENT_TEST="C-02 dormant request delivered"
setup
: > "$D/.dormant"; : > "$D/.compact-requested"
STUB_RUNNING=0
handle_compaction "$N" ""
if [ "$(inbox_count)" = 1 ] && [ "$(inbox_only)" = "/compact" ] && [ -s "$D/.compacting" ] && [ ! -e "$D/.compact-requested" ]; then pass
else fail "inbox=$(inbox_count) body='$(inbox_only)' marker=$(cat "$D/.compacting" 2>/dev/null) req=$([ -e "$D/.compact-requested" ] && echo yes)"; fi
teardown

CURRENT_TEST="C-03 guidance flattened"
setup
printf 'keep the\nfailing   test details\n' > "$D/.compact-requested"
handle_compaction "$N" "sess"
if [ "$(inbox_only)" = "/compact keep the failing test details" ]; then pass; else fail "body='$(inbox_only)'"; fi
teardown

CURRENT_TEST="C-04 awake mid-turn waits"
setup
: > "$D/.compact-requested"; STUB_AT_REST=0
handle_compaction "$N" "sess"
if [ "$(inbox_count)" = 0 ] && [ -e "$D/.compact-requested" ] && [ ! -e "$D/.compacting" ]; then pass; else fail "delivered while busy"; fi
teardown

CURRENT_TEST="C-05 awake at rest delivered"
setup
: > "$D/.compact-requested"
handle_compaction "$N" "sess"
if [ "$(inbox_only)" = "/compact" ] && [ -e "$D/.compacting" ]; then pass; else fail "body='$(inbox_only)'"; fi
teardown

CURRENT_TEST="C-06 awake, harness down waits"
setup
: > "$D/.compact-requested"; STUB_RUNNING=0
handle_compaction "$N" "sess"
handle_compaction "$N" ""
if [ "$(inbox_count)" = 0 ] && [ -e "$D/.compact-requested" ]; then pass; else fail "delivered without a harness"; fi
teardown

CURRENT_TEST="C-07 in flight, not landed"
setup
printf '2026-10-25T15:00:00.000Z\n' > "$D/.compacting"
STUB_SESSION_FILE="$SCRATCH/s.jsonl"
printf '{"type":"user","timestamp":"2026-10-25T15:00:01.000Z"}\n' > "$STUB_SESSION_FILE"
handle_compaction "$N" "sess"
if [ "$(inbox_count)" = 0 ] && [ -e "$D/.compacting" ]; then pass; else fail "event sent before landing"; fi
teardown

CURRENT_TEST="C-08 landed → event"
setup
printf '2026-10-25T15:00:00.000Z\n' > "$D/.compacting"
STUB_SESSION_FILE="$SCRATCH/s.jsonl"
printf '%s\n' '{"type":"user","timestamp":"2026-10-25T15:00:01.000Z"}' \
  '{"type":"system","subtype":"compact_boundary","timestamp":"2026-10-25T15:01:10.123Z"}' > "$STUB_SESSION_FILE"
handle_compaction "$N" "sess"
body="$(inbox_only)"
if [ "$(inbox_count)" = 1 ] && [ ! -e "$D/.compacting" ] \
   && [[ "$body" == "<task-notification>"* ]] \
   && [[ "$body" == *"<summary>Compaction done ($N) — delivered by agent-supervisor</summary>"* ]] \
   && [[ "$body" == *"not a message from the user"* ]] \
   && [[ "$body" == *"keep waiting"* ]]; then pass
else fail "count=$(inbox_count) marker=$([ -e "$D/.compacting" ] && echo kept) body='$body'"; fi
teardown

CURRENT_TEST="C-09 older boundary ignored"
setup
printf '2026-10-25T15:00:00.000Z\n' > "$D/.compacting"
STUB_SESSION_FILE="$SCRATCH/s.jsonl"
printf '%s\n' '{"type":"system","subtype":"compact_boundary","timestamp":"2026-10-24T09:00:00.000Z"}' > "$STUB_SESSION_FILE"
handle_compaction "$N" "sess"
if [ "$(inbox_count)" = 0 ] && [ -e "$D/.compacting" ]; then pass; else fail "old boundary counted"; fi
teardown

CURRENT_TEST="C-10 duplicate request dropped"
setup
printf '2026-10-25T15:00:00.000Z\n' > "$D/.compacting"
: > "$D/.compact-requested"
handle_compaction "$N" "sess"
if [ ! -e "$D/.compact-requested" ] && [ -e "$D/.compacting" ] && [ "$(inbox_count)" = 0 ]; then pass; else fail "duplicate not dropped"; fi
teardown

CURRENT_TEST="C-11 timeout"
setup
printf '2026-10-25T15:00:00.000Z\n' > "$D/.compacting"
touch -d '30 minutes ago' "$D/.compacting"
handle_compaction "$N" "sess"
if [ ! -e "$D/.compacting" ] && [ "$(inbox_count)" = 0 ]; then pass; else fail "marker kept or event sent"; fi
teardown

CURRENT_TEST="C-12 dropper contract names"
setup
inbox_drop "$N" "a"; inbox_drop "$N" "b"
bad=0
for f in "$D"/inbox/*; do
  [[ "$(basename "$f")" =~ ^20[0-9]{6}T[0-9]{9}-[0-9a-f]{8}\.msg$ ]] || bad=1
done
if [ "$bad" = 0 ] && [ "$(inbox_count)" = 2 ] && inbox_has_files "$N"; then pass; else fail "bad inbox names: $(ls "$D/inbox")"; fi
teardown

CURRENT_TEST="C-13 old-style reset request becomes a compaction request"
setup
: > "$D/.recycle-requested"
handle_compaction "$N" "sess"
if [ ! -e "$D/.recycle-requested" ] && [ "$(inbox_only)" = "/compact" ] && [ -e "$D/.compacting" ]; then pass
else fail "recycle=$([ -e "$D/.recycle-requested" ] && echo kept) body='$(inbox_only)'"; fi
teardown

CURRENT_TEST="C-14 stale request expires"
setup
: > "$D/.compact-requested"; touch -d '2 hours ago' "$D/.compact-requested"; STUB_AT_REST=0
handle_compaction "$N" "sess"
if [ ! -e "$D/.compact-requested" ] && [ "$(inbox_count)" = 0 ]; then pass; else fail "stale request kept or delivered"; fi
teardown

CURRENT_TEST="C-15 control characters stripped from guidance"
setup
printf 'keep\033[201~ this\001' > "$D/.compact-requested"
handle_compaction "$N" "sess"
if [ "$(inbox_only)" = "/compact keep[201~ this" ]; then pass; else fail "body='$(inbox_only | od -c | head -3)'"; fi
teardown

CURRENT_TEST="C-16 no dormancy while a compaction is asked for, under way, or queued in the inbox"
setup
schedule_peek() { return 1; }
ok=1
pending_check "$N" || ok=0
: > "$D/.compact-requested"; pending_check "$N" && ok=0; rm -f "$D/.compact-requested"
: > "$D/.compacting"; pending_check "$N" && ok=0; rm -f "$D/.compacting"
inbox_drop "$N" "x"; pending_check "$N" && ok=0
if [ "$ok" = 1 ]; then pass; else fail "pending_check let the agent sleep"; fi
unset -f schedule_peek
teardown

# agent_at_rest against real 2.1.310 pane shapes (tmux stubbed).
unset -f agent_at_rest
# shellcheck disable=SC1090
eval "$(sed -n '/^agent_at_rest() {/,/^}/p' "$SUPERVISOR")"
PANE=""
tmux() { printf '%s\n' "$PANE"; }
timeout() { shift 3; "$@"; }   # the supervisor wraps tmux in timeout -k 5 10
SEP="────────────────────────────────────────"
at_rest_case() {
  CURRENT_TEST="$1"; PANE="$2"
  if agent_at_rest sess; then got=rest; else got=busy; fi
  if [ "$got" = "$3" ]; then pass; else fail "expected $3, got $got"; fi
}
at_rest_case "C-17 idle prompt is at rest" "● Done.
✻ Baked for 15s
$SEP
❯ 
$SEP
  ⏵⏵ bypass permissions on (shift+tab to cycle)" rest
at_rest_case "C-18 mid-turn is busy" "✶ Kneading… (10s · ↓ 188 tokens)
$SEP
❯ 
$SEP
  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt" busy
at_rest_case "C-19 'esc to interrupt' in the agent's own output doesn't count" "● The footer says esc to interrupt while it works.
● More text
● More text
● More text
● More text
● More text
$SEP
❯ 
$SEP
  ⏵⏵ bypass permissions on (shift+tab to cycle)" rest
at_rest_case "C-20 a selection dialog is not at rest" "Do you want to proceed?
❯ 1. Yes
  2. No
Enter to select · Esc to cancel" busy
unset -f tmux timeout

printf '\n===============================\nPASS: %d  FAIL: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf 'Failures:\n'; for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
  exit 1
fi
exit 0
