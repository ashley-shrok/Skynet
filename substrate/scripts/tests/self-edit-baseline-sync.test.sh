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
#   T-S8 — hostile role: value in identity frontmatter does NOT execute inside
#          the sync hook's bash body (shell-injection defense)
#   T-S9 — sync-script id-skill drift → atomic baseline overwrite + hash marker
#          (the id skill is a fourth watched surface added 2026-09-29)
#   T-S10 — sync-script role-baseline drift → atomic baseline overwrite + hash
#           marker. Regression guard for the pre-multi-role-filename bug: hook
#           wrote `last-snapshot.role` while watcher used `last-snapshot.role.<role>`,
#           so the sync silently no-op'd on every role-file self-edit.
#   T-S11 — sync-script runbook-baseline drift → atomic baseline overwrite +
#           hash marker. Regression guard for the same bug class on runbooks:
#           watcher writes `last-snapshot.runbook.<role>.<slug>`, hook was
#           globbing with slug-only extraction and failing kebab-case validation.
#   T-S12 — PreToolUse Edit payload claims the exact target; Post* with the
#           same tool_use_id syncs the baseline then releases the claim
#   T-S13 — PreToolUse Bash payload claims files the command names (basename
#           for identity, full path for the id skill) and nothing else
#   T-S14 — watcher holds a claimed self-edit past the settle window and stays
#           silent once the Post* hook syncs + releases (the "edit early in a
#           long Bash call" leak)
#   T-S15 — watcher ignores a stale claim (older than ROLE_WATCH_CLAIM_MAX_SEC)
#           and emits — interrupted calls can't mute the watcher
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

# ============================================================
# T-S8: hostile role: value in identity frontmatter must NOT execute inside
# the sync hook's bash body. The identity file is agent-writable, so its
# `role:` field is untrusted input. Regression guard for the shell-injection
# fix (export-inherit instead of `'"$X"'` splicing).
# ============================================================
test_T_S8_role_injection_defense() {
  local home_dir
  home_dir=$(make_tmpdir)
  mkdir -p "$home_dir/fleet/roles/normal" \
           "$home_dir/fleet/identities/victim/role-file-watch"

  # Hostile role: no whitespace so the awk truncator doesn't help, contains a
  # single-quote break-out + touch-a-marker payload.
  cat > "$home_dir/fleet/identities/victim/victim.md" <<EOF
---
role: normal';touch $home_dir/PWNED;echo x
displayName: Victim
---
# body
EOF
  # Diverge the identity baseline so the sync path actually runs.
  echo "old" > "$home_dir/fleet/identities/victim/role-file-watch/last-snapshot.identity"

  # Ensure the payload target doesn't exist beforehand.
  rm -f "$home_dir/PWNED"

  HOME="$home_dir" FLEET_IDENTITY="victim" bash "$SYNC_SCRIPT" </dev/null

  if [ -f "$home_dir/PWNED" ]; then
    fail "T-S8: hostile role: value executed inside the sync hook body"
    return
  fi
}

# ============================================================
# T-S9: sync-script id-skill drift → atomic baseline overwrite + hash marker.
# The id skill is user-wide (~/.claude/skills/id/SKILL.md), so this test seeds
# a hermetic HOME with the skill file alongside the usual identity fixture.
# ============================================================
test_T_S9_sync_id_skill() {
  local home_dir="$(make_tmpdir)"
  local ident_dir="$home_dir/fleet/identities/s9name"
  local state_dir="$ident_dir/role-file-watch"
  local skill_dir="$home_dir/.claude/skills/id"
  mkdir -p "$state_dir" "$skill_dir"

  # Identity file (role frontmatter present so the sync script's ROLE parse
  # succeeds; irrelevant to this test but exercises the full path).
  printf -- '---\nrole: s9role\n---\n\n# s9name\n' > "$ident_dir/s9name.md"

  local skill="$skill_dir/SKILL.md"
  local baseline="$state_dir/last-snapshot.id-skill"

  # Seed baseline with old content, then diverge the real skill file.
  printf 'old id skill content\n' > "$baseline"
  printf 'NEW id skill content — 2026-09-29 rename landed\n' > "$skill"

  # Sanity: baseline and real now differ.
  if cmp -s "$skill" "$baseline"; then
    fail "T-S9: fixture broken — baseline already equals real"
    return
  fi

  HOME="$home_dir" FLEET_IDENTITY="s9name" bash "$SYNC_SCRIPT" </dev/null

  # Baseline must now match real.
  if ! cmp -s "$skill" "$baseline"; then
    fail "T-S9: id-skill baseline not refreshed after sync"
    return
  fi

  # Marker must exist and hold sha256 of the new content.
  local marker="$baseline.self-edit-hash"
  if [ ! -f "$marker" ]; then
    fail "T-S9: id-skill hash marker not written at $marker"
    return
  fi

  local expected recorded
  expected=$(sha256sum "$skill" | awk '{print $1}')
  recorded=$(cat "$marker" | tr -d '\n')
  if [ "$expected" != "$recorded" ]; then
    fail "T-S9: id-skill marker hash mismatch (expected=$expected got=$recorded)"
    return
  fi
}

# ============================================================
# T-S10: sync-script role-baseline drift → atomic baseline overwrite + hash
# marker. Regression guard: pre-fix the hook wrote to the pre-multi-role
# `last-snapshot.role` filename while the watcher used `last-snapshot.role.<role>`,
# so sync_one silently early-bailed on the file-not-found check and no marker
# was ever written. Every role-file self-edit then emitted a wake across every
# identity holding that role. Fix: iterate `last-snapshot.role.*`, extract
# <role> from the suffix, route to `~/fleet/roles/<role>/<role>.md`.
# ============================================================
test_T_S10_sync_role_drift() {
  seed_fixture "s10role" "s10name"

  # Watcher's actual per-role baseline name — NOT the pre-multi-role
  # un-suffixed one the fixture's seed also writes. Drop the un-suffixed form
  # so this test proves the hook finds the per-role baseline on its own.
  local baseline="$STATE_DIR/last-snapshot.role.s10role"
  cp "$ROLE_MD" "$baseline"
  rm -f "$BASELINE_ROLE"

  # Diverge the real role file (simulates agent edit).
  printf '# s10role role\n\nline 1\nline 2 — self-edit\n' > "$ROLE_MD"

  if cmp -s "$ROLE_MD" "$baseline"; then
    fail "T-S10: fixture broken — baseline already equals real"
    return
  fi

  HOME="$HOME_DIR" FLEET_IDENTITY="s10name" bash "$SYNC_SCRIPT" </dev/null

  if ! cmp -s "$ROLE_MD" "$baseline"; then
    fail "T-S10: role baseline not refreshed after sync (bug would silently no-op here)"
    return
  fi

  local marker="$baseline.self-edit-hash"
  if [ ! -f "$marker" ]; then
    fail "T-S10: role hash marker not written at $marker"
    return
  fi

  local expected recorded
  expected=$(sha256sum "$ROLE_MD" | awk '{print $1}')
  recorded=$(cat "$marker" | tr -d '\n')
  if [ "$expected" != "$recorded" ]; then
    fail "T-S10: role marker hash mismatch (expected=$expected got=$recorded)"
    return
  fi
}

# ============================================================
# T-S11: sync-script runbook-baseline drift → atomic baseline overwrite + hash
# marker. Regression guard: same bug class as T-S10 but for runbooks. Pre-fix
# the hook globbed `last-snapshot.runbook.*` and treated the full suffix as the
# slug, which failed kebab-case validation on the watcher's per-role names of
# shape `last-snapshot.runbook.<role>.<slug>` (role-file-watch.py:483). Fix:
# split the suffix on first `.` into <role>.<slug> and route to
# `~/fleet/roles/<role>/runbooks/<slug>/runbook.md`.
# ============================================================
test_T_S11_sync_runbook_drift() {
  seed_fixture "s11role" "s11name"

  local runbook_dir="$HOME_DIR/fleet/roles/s11role/runbooks/deploy"
  mkdir -p "$runbook_dir"
  local runbook="$runbook_dir/runbook.md"
  printf '# deploy runbook\n\nstep 1\n' > "$runbook"

  local baseline="$STATE_DIR/last-snapshot.runbook.s11role.deploy"
  cp "$runbook" "$baseline"

  # Diverge the real runbook (simulates agent edit).
  printf '# deploy runbook\n\nstep 1\nstep 2 — self-edit\n' > "$runbook"

  if cmp -s "$runbook" "$baseline"; then
    fail "T-S11: fixture broken — baseline already equals real"
    return
  fi

  HOME="$HOME_DIR" FLEET_IDENTITY="s11name" bash "$SYNC_SCRIPT" </dev/null

  if ! cmp -s "$runbook" "$baseline"; then
    fail "T-S11: runbook baseline not refreshed after sync (bug would silently no-op here)"
    return
  fi

  local marker="$baseline.self-edit-hash"
  if [ ! -f "$marker" ]; then
    fail "T-S11: runbook hash marker not written at $marker"
    return
  fi

  local expected recorded
  expected=$(sha256sum "$runbook" | awk '{print $1}')
  recorded=$(cat "$marker" | tr -d '\n')
  if [ "$expected" != "$recorded" ]; then
    fail "T-S11: runbook marker hash mismatch (expected=$expected got=$recorded)"
    return
  fi
}

# ---- run ----

# hook_payload <event> <tool_use_id> <tool_name> <json tool_input>
hook_payload() {
  printf '{"hook_event_name":"%s","tool_use_id":"%s","tool_name":"%s","tool_input":%s}' \
    "$1" "$2" "$3" "$4"
}

# ============================================================
# T-S12: PreToolUse Edit claims exact target; Post* syncs then releases.
# ============================================================
test_T_S12_claim_edit_then_release() {
  seed_fixture "s12role" "s12name"
  local claim="$STATE_DIR/claims/last-snapshot.identity.toolu_12"

  hook_payload PreToolUse toolu_12 Edit "{\"file_path\":\"$IDENT_MD\"}" \
    | HOME="$HOME_DIR" FLEET_IDENTITY="s12name" bash "$SYNC_SCRIPT"
  if [ ! -f "$claim" ]; then
    fail "T-S12: PreToolUse did not claim the identity file at $claim"
    return
  fi
  if [ -n "$(find "$STATE_DIR/claims" -type f ! -name 'last-snapshot.identity.*')" ]; then
    fail "T-S12: PreToolUse claimed files the Edit does not target"
    return
  fi

  printf -- '---\nrole: s12role\ntask: edited\n---\n\n# s12name\n' > "$IDENT_MD"
  hook_payload PostToolUse toolu_12 Edit "{\"file_path\":\"$IDENT_MD\"}" \
    | HOME="$HOME_DIR" FLEET_IDENTITY="s12name" bash "$SYNC_SCRIPT"
  if [ -f "$claim" ]; then
    fail "T-S12: PostToolUse did not release the claim"
    return
  fi
  if ! cmp -s "$IDENT_MD" "$BASELINE_IDENT"; then
    fail "T-S12: PostToolUse did not sync the baseline"
    return
  fi
}

# ============================================================
# T-S13: PreToolUse Bash claims only what the command names.
# ============================================================
test_T_S13_claim_bash_by_name() {
  seed_fixture "s13role" "s13name"
  mkdir -p "$HOME_DIR/.claude/skills/id"
  local skill="$HOME_DIR/.claude/skills/id/SKILL.md"
  printf '# id\n' > "$skill"
  cp "$skill" "$STATE_DIR/last-snapshot.id-skill"

  hook_payload PreToolUse toolu_13a Bash '{"command":"cd ~/fleet/identities/s13name && sed -i s/a/b/ s13name.md && sleep 5"}' \
    | HOME="$HOME_DIR" FLEET_IDENTITY="s13name" bash "$SYNC_SCRIPT"
  if [ ! -f "$STATE_DIR/claims/last-snapshot.identity.toolu_13a" ]; then
    fail "T-S13: Bash naming the identity basename did not claim it"
    return
  fi
  if [ -f "$STATE_DIR/claims/last-snapshot.id-skill.toolu_13a" ]; then
    fail "T-S13: Bash claimed the id skill without naming it"
    return
  fi

  hook_payload PreToolUse toolu_13b Bash "{\"command\":\"cat $skill >/dev/null\"}" \
    | HOME="$HOME_DIR" FLEET_IDENTITY="s13name" bash "$SYNC_SCRIPT"
  if [ ! -f "$STATE_DIR/claims/last-snapshot.id-skill.toolu_13b" ]; then
    fail "T-S13: Bash naming the id skill path did not claim it"
    return
  fi

  hook_payload PreToolUse toolu_13c Bash '{"command":"git status"}' \
    | HOME="$HOME_DIR" FLEET_IDENTITY="s13name" bash "$SYNC_SCRIPT"
  if [ -n "$(find "$STATE_DIR/claims" -type f -name '*.toolu_13c')" ]; then
    fail "T-S13: Bash naming no watched file still claimed something"
    return
  fi
}

# ============================================================
# T-S14: watcher holds a claimed self-edit until release → silent.
# Reproduces the field leak: edit lands, the tool call keeps running well past
# the settle window, PostToolUse fires only afterwards.
# ============================================================
test_T_S14_watcher_holds_claimed_self_edit() {
  seed_fixture "s14role" "s14name"
  launch_watcher "$HOME_DIR" "$IDENT_DIR"
  if ! wait_for_baseline "$BASELINE_IDENT"; then
    fail "T-S14: identity baseline never landed"
    return
  fi
  sleep 0.3

  local cmd='{"command":"sed -i s/x/y/ s14name.md && sleep 2"}'
  hook_payload PreToolUse toolu_14 Bash "$cmd" \
    | HOME="$HOME_DIR" FLEET_IDENTITY="s14name" bash "$SYNC_SCRIPT"
  printf -- '---\nrole: s14role\ntask: long call\n---\n\n# s14name\n' > "$IDENT_MD"

  # The "rest of the Bash call" — far past the 50ms test settle window.
  sleep 1.5
  if grep -qE '📝 \[identity-file:' "$OUT_LOG" 2>/dev/null; then
    fail "T-S14: watcher emitted while the claiming tool call was in flight; out=$(cat "$OUT_LOG")"
    return
  fi

  hook_payload PostToolUse toolu_14 Bash "$cmd" \
    | HOME="$HOME_DIR" FLEET_IDENTITY="s14name" bash "$SYNC_SCRIPT"
  sleep 1
  if grep -qE '📝 \[identity-file:' "$OUT_LOG" 2>/dev/null; then
    fail "T-S14: watcher emitted the agent's own edit after release; out=$(cat "$OUT_LOG")"
    return
  fi
  if ! grep -q 'held last-snapshot.identity' "$ERR_LOG" 2>/dev/null; then
    fail "T-S14: watcher never logged holding for the claim; err=$(cat "$ERR_LOG")"
    return
  fi
}

# ============================================================
# T-S15: stale claim (interrupted call) does not mute the watcher.
# ============================================================
test_T_S15_stale_claim_ignored() {
  seed_fixture "s15role" "s15name"
  launch_watcher "$HOME_DIR" "$IDENT_DIR"
  if ! wait_for_baseline "$BASELINE_IDENT"; then
    fail "T-S15: identity baseline never landed"
    return
  fi
  sleep 0.3

  mkdir -p "$STATE_DIR/claims"
  : > "$STATE_DIR/claims/last-snapshot.identity.toolu_15"
  touch -d '20 minutes ago' "$STATE_DIR/claims/last-snapshot.identity.toolu_15"

  printf -- '---\nrole: s15role\ntask: peer after interrupt\n---\n\n# s15name\n' > "$IDENT_MD"
  if ! wait_for_stdout_match '📝 \[identity-file: s15name\]' "$OUT_LOG"; then
    fail "T-S15: watcher did not emit despite only a stale claim; out=$(cat "$OUT_LOG") err=$(cat "$ERR_LOG")"
    return
  fi
}

run_test test_T_S1_sync_drift
run_test test_T_S2_sync_no_drift
run_test test_T_S3_no_fleet_identity
run_test test_T_S4_no_state_dir
run_test test_T_S5_watcher_matching_marker_silent
run_test test_T_S6_watcher_mismatched_marker_fires
run_test test_T_S7_watcher_no_marker_fires
run_test test_T_S8_role_injection_defense
run_test test_T_S9_sync_id_skill
run_test test_T_S10_sync_role_drift
run_test test_T_S11_sync_runbook_drift
run_test test_T_S12_claim_edit_then_release
run_test test_T_S13_claim_bash_by_name
run_test test_T_S14_watcher_holds_claimed_self_edit
run_test test_T_S15_stale_claim_ignored

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
