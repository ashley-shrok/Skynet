---
phase: 94-supervisor-archive-extension
verified: 2026-09-09T22:40:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
---

# Phase 94: supervisor archive extension — daily archive-scan for 180-day dormant identities

**Phase Goal:** Teach the per-host agent-supervisor a daily archive-scan sub-loop that walks every identity, applies four guards (pinned / no-dormancy / coordinator / freshness), retires 180-day dormant identities via three ordered steps (mv → tmux kill → matrix deactivate), retries on failure, drops a retire-stuck sentinel after 3 consecutive failures, and emits no announcement for routine retirements.

**Verified:** 2026-09-09T22:40:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `is_coordinator` strictly detects `coordinator: true` in YAML frontmatter per SKILL.md spec | VERIFIED | L237-241: awk pattern `f==1 && /^coordinator: true$/` counts `---` delimiters and only matches between first two |
| 2 | `get_freshness_epoch` reads cursor mtime with folder mtime fallback | VERIFIED | L252-262: reads `relay-state/since`, falls back to `$iddir`, prints 0 on both-absent |
| 3 | `retire_identity` executes steps in D-10→D-11→D-12 order, reads relay.json from archived path | VERIFIED | L281-392: Step 1 mv, Step 2 tmux kill-session via `match_session`, Step 3 reads `$archdir/relay.json`; four-state idempotency |
| 4 | `run_archive_scan` walks `$IDENTITIES_DIR/*/` MODE-agnostically, skips `archive/` dir, applies all four guards | VERIFIED | L412-468: for-loop on `$IDENTITIES_DIR/*/`, `[ "$name" = archive ] && continue`, pin/no-dormancy/coord/freshness guards in correct order |
| 5 | `run_archive_scan_if_due` gates on 24h elapsed, touches marker unconditionally after scan | VERIFIED | L483-492: stat on `$ARCHIVE_SCAN_MARKER`, `touch "$ARCHIVE_SCAN_MARKER"` after `run_archive_scan` regardless of retire outcomes (Pitfall 5 lock) |
| 6 | `run_archive_scan_if_due` is called in `reconcile()` between `sample_memory` and `resolve_identities` | VERIFIED | L1562-1564: `sample_memory` → `run_archive_scan_if_due` → `resolve_identities` in exact order |
| 7 | `AGENT_SUPERVISOR_LIB_ONLY=1` guard exists after all function definitions, before the reconcile loop | VERIFIED | L1728: `[ "${AGENT_SUPERVISOR_LIB_ONLY:-0}" = 1 ] && return 0 2>/dev/null \|\| true` — after all Phase 94 helpers, before `ensure_agent_teams_env` / `reconcile` call |

**Score: 7/7 truths verified**

---

## Static Check Results

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Bash syntax | `bash -n substrate/scripts/agent-supervisor.sh` | exit 0 | PASS |
| No admin endpoint | `grep -c '_synapse/admin' agent-supervisor.sh` | 0 | PASS |
| No `=` prefix in kill-session | `grep -c 'tmux kill-session -t =' agent-supervisor.sh` | 0 | PASS |
| EXCEPTION comment present | `grep -c 'EXCEPTION to the "never kill" rule' agent-supervisor.sh` | 1 | PASS |
| LIB_ONLY guard count | `grep -c 'AGENT_SUPERVISOR_LIB_ONLY' agent-supervisor.sh` | 2 | PASS (comment + guard line) |
| shellcheck | `shellcheck agent-supervisor.sh` | 0 errors, 13 warnings/info (all pre-existing, identical count to pre-Phase-94 HEAD~4) | PASS |

---

## Test Suite Results

```
=== agent-supervisor-archive-scan test driver ===
supervisor: substrate/scripts/agent-supervisor.sh
stub homeserver: available

PASS  test_bash_syntax
PASS  test_shellcheck_clean
PASS  test_pitfall3_no_equals_prefix_on_kill_session
PASS  test_pitfall4_no_iddir_relay_json_in_step3
PASS  test_d12_no_admin_endpoint
PASS  test_d15_credentials_never_in_log_strings
PASS  test_d16_no_unarchive_path
PASS  test_pitfall7_exception_comment_present
PASS  test_coordinator_positive
PASS  test_coordinator_negative_commented
PASS  test_coordinator_negative_body
PASS  test_coordinator_negative_quoted
PASS  test_coordinator_negative_no_frontmatter
PASS  test_coordinator_negative_missing_file
PASS  test_freshness_cursor_present
PASS  test_freshness_cursor_absent_fallback_to_folder
PASS  test_freshness_both_absent_zero
PASS  test_retire_happy_path_200
PASS  test_retire_401_treated_as_success
PASS  test_retire_5xx_aborts_with_1
PASS  test_retire_network_fail_aborts_with_1
PASS  test_retire_retry_from_partial
PASS  test_retire_collision_aborts
PASS  test_retire_password_with_quotes
PASS  test_retire_stuck_fires_at_3_not_before
PASS  test_retire_stuck_counter_resets_on_success
PASS  test_scan_walks_all_identity_folders
PASS  test_24h_gate_no_marker_runs_immediately
PASS  test_24h_gate_recent_marker_skips
PASS  test_24h_gate_expired_marker_runs
PASS  test_24h_gate_marker_bumped_after_scan

===============================
PASS: 31  FAIL: 0
```

Exit code: 0. All 31 tests pass. Count matches SUMMARY claims.

---

## D-ID Trace

| D-ID | Decision | Code Location | Status |
|------|----------|---------------|--------|
| D-01 | Daily cadence sub-loop, not a separate script | `run_archive_scan_if_due` at L483; called in `reconcile()` at L1563 | VERIFIED |
| D-02 | "Last scan ran at" state = mtime of marker file in `DORMANCY_STATE_DIR` | `ARCHIVE_SCAN_MARKER="${DORMANCY_STATE_DIR}/archive-scan-last-ran"` at L74; stat + touch at L486/491 | VERIFIED |
| D-03 | Skip if `.pinned` sentinel present | L424: `[ -f "$d/.pinned" ] && continue` | VERIFIED |
| D-04 | Skip if `.no-dormancy` sentinel present | L426: `[ -f "$d/.no-dormancy" ] && continue` | VERIFIED |
| D-05 | Skip if coordinator — strict frontmatter detection matching SKILL.md § "Coordinator mode" | L237-241: `awk '/^---$/{f++} f==1 && /^coordinator: true$/{found=1; exit} END{exit !found}'`; all 6 coordinator edge cases tested in test_coordinator_* suite | VERIFIED |
| D-06 | Freshness = mtime of `relay-state/since` cursor file | L255-258: `[ -f "$cursor_file" ] && mtime=$(stat -c %Y "$cursor_file")` | VERIFIED |
| D-07 | Fallback to folder mtime if no cursor | L259-260: `else mtime=$(stat -c %Y "$iddir")` | VERIFIED |
| D-08 | Threshold 180 days, no knob | L70-72: `ARCHIVE_THRESHOLD_DAYS=180`, `ARCHIVE_THRESHOLD_SECONDS=$((ARCHIVE_THRESHOLD_DAYS * 24 * 60 * 60))`; comment: "NOT a conf variable (locked no-knob per shape)" | VERIFIED |
| D-09 | No defensive guards against mtime-reset operations | No mtime-reset guard code anywhere in archive scan | VERIFIED |
| D-10 | Step 1: mv folder to `archive/<name>/` first | L286-311: mkdir archive parent, four-state case analysis (normal/retry/collision/anomaly) | VERIFIED |
| D-11 | Step 2: kill tmux session via `match_session`, no `=` prefix | L313-330: `actual="$(match_session "$slugname")"` then `tmux kill-session -t "$actual"` (not `-t ="$actual"`) | VERIFIED |
| D-12 | Step 3: self-deactivate using identity's own token; reads from archived path; no admin endpoint | L332-391: reads `$archdir/relay.json`; `POST /_matrix/client/v3/account/deactivate`; `Authorization: Bearer $access_token`; `jq -nc --arg` for safe body construction | VERIFIED |
| D-13 | Retry-from-top idempotency | L292-311: State 2 path "folder already in archive/ (resuming from step 2)"; 401 treated as idempotent success at L367-372 | VERIFIED |
| D-14 | Retire-stuck sentinel after 3 consecutive failures + LOUD log | L446-463: per-identity counter file `retire-fail-count-$name` in `DORMANCY_STATE_DIR`; `touch "$IDENTITIES_DIR/archive/$name/retire-stuck"` at count>=3; counter reset on success at L442-443 | VERIFIED |
| D-15 | No announcement; silent by design; only ERROR: prefix for retire-stuck | L409-411: doc comment explicitly states D-15 discipline; no `history.md`, DM, or ping anywhere in retire path | VERIFIED |
| D-16 | No un-archive path | No `unarchive` or reverse-mv code. State 3 comment at L302 notes collision is "impossible per D-16 since un-archive is out of scope" | VERIFIED |
| D-17 | No Skynet coupling; no push wire added | No new Skynet API calls in retire path; existing Skynet mentions (DormancyOverlay, recycled-at marker) are unrelated to retire | VERIFIED |

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `substrate/scripts/agent-supervisor.sh` | Modified with all 4 waves | VERIFIED | 1745 lines; all Phase 94 functions present |
| `substrate/scripts/tests/agent-supervisor-archive-scan.sh` | New 31-test driver | VERIFIED | 31309 bytes, executable, passes all 31 tests |
| `substrate/scripts/tests/README.md` | New README for test dir | VERIFIED | 7123 bytes, present |
| `94-01-SUMMARY.md` through `94-04-SUMMARY.md` | 4 summary files | VERIFIED | All 4 present in phase dir |
| ROADMAP.md Phase 94 entry | Updated with 4 plans | VERIFIED | L2173-2184: all 4 plans listed as `[x]` complete |

---

## Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `reconcile()` L1561 | `run_archive_scan_if_due` | Direct call at L1563 | WIRED |
| `run_archive_scan_if_due` | `run_archive_scan` | Direct call at L490 | WIRED |
| `run_archive_scan` | `is_coordinator` | Called at L429 for each identity | WIRED |
| `run_archive_scan` | `get_freshness_epoch` | Called at L432 for each identity | WIRED |
| `run_archive_scan` | `retire_identity` | Called at L441 for dormant candidates | WIRED |
| `retire_identity` Step 2 | `match_session` | Called at L320 for case-insensitive tmux lookup | WIRED |
| `retire_identity` Step 3 | `$archdir/relay.json` | `local relay_json="$archdir/relay.json"` at L336 — reads from archived path NOT active path | WIRED |

---

## Retire Flow End-to-End Trace

Simulated scenario: identity "tina", cursor mtime 200 days old, no guards set.

1. `reconcile()` calls `run_archive_scan_if_due` → 24h has elapsed → calls `run_archive_scan()`
2. `run_archive_scan` iterates `$IDENTITIES_DIR/*/`; finds `tina/`
3. `[ "$name" = archive ]` — false; `[ -f "$d/tina.md" ]` — true (identity has `.md` file)
4. `[ -f "$d/.pinned" ]` — false; `[ -f "$d/.no-dormancy" ]` — false
5. `is_coordinator "$d/tina.md"` — awk finds no `coordinator: true` in frontmatter → returns 1 → not skipped
6. `get_freshness_epoch "tina" "$d"` — cursor exists → reads mtime → returns epoch 200 days ago
7. `age = now - fresh_epoch` = ~17,280,000s; `ARCHIVE_THRESHOLD_SECONDS` = 15,552,000s → age > threshold → proceed
8. Log: "archive-scan: 'tina' dormant for 200d — retiring"
9. `retire_identity "tina"`:
   - Step 1: `iddir` exists, `archdir` absent → State 1 → `mv "$iddir" "$archdir"` → logs "moved to archive/"
   - Step 2: `match_session "tina"` → finds session → `tmux kill-session -t "tina"` → logs "killed tmux session 'tina'"
   - Step 3: reads `$archdir/relay.json` (now-archived path) → extracts base/mxid/password/access_token → `POST /_matrix/client/v3/account/deactivate` → 200 → logs "matrix account deactivated (200)"
   - Returns 0
10. Success path: `rm -f "$DORMANCY_STATE_DIR/retire-fail-count-tina"` (counter reset)
11. Log: "archive-scan: 'tina' retire succeeded"

Verified against test output: `test_retire_happy_path_200` produces exactly this sequence and passes.

---

## Executor Scope Compliance

All Phase 94 commit messages verified:

```
369dfce0 docs(94-04): complete archive-scan test driver plan
3e659788 test(94-04-task2): 31-test archive-scan driver + README
e5bb0e6d feat(94-04-task1): add AGENT_SUPERVISOR_LIB_ONLY guard
ccc09a7c docs(94-03): complete run_archive_scan + ... plan
baaf9a42 feat(94-03-task1): run_archive_scan + run_archive_scan_if_due + retire-stuck + reconcile hook
602c7f51 docs(94-02): complete retire_identity plan
e7543104 feat(94-02-task1): add retire_identity() — three-step retire action
88811a10 docs(94-01): complete guard-building-blocks plan
d061b369 feat(94-01-task1): land ARCHIVE_THRESHOLD constants + is_coordinator + get_freshness_epoch
```

No `git push`, `docker build`, or `docker compose up` in any commit. Scope compliance: CLEAN.

---

## Anti-Patterns Found

None. No TBD/FIXME/XXX markers in Phase 94 code. No placeholder implementations. No empty stub handlers. No hardcoded empty return values in the archive-scan path.

---

## Human Verification Required

None. All behavioral assertions are verifiable programmatically. The test suite exercises the full retire flow against a live stub homeserver. D-17 (Skynet natural drop from conversation list) is explicitly excluded per verification instructions.

---

_Verified: 2026-09-09T22:40:00Z_
_Verifier: Claude (gsd-verifier)_
