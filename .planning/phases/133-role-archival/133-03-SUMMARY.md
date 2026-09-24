---
phase: 133
plan: 03
subsystem: substrate
tags: [retire, refactor, inline-retry, exponential-backoff, cross-tick-state-removal, wave-b]
status: PASS
dependency_graph:
  requires:
    - "substrate/scripts/agent-supervisor.sh retire_identity() 5-step function (Phase 115 D-13 order preserved)"
    - "substrate/scripts/tests/agent-supervisor-archive-scan.sh harness (setup_scratch, fixture_identity, fixture_relay_json, start_stub_homeserver, _source_supervisor)"
  provides:
    - "retire_identity() atomic-from-caller-POV contract: succeed outright (having recovered inline from transient failures) or fail terminally in one call, no cross-tick state"
    - "Sequence-of-codes support in start_stub_homeserver test helper (backwards-compatible with single-code callers)"
  affects:
    - "Wave C (Plan 133-04) role cascade scanner will call retire_identity() directly and consume the clean atomic-retire semantic from birth (D-15)"
    - "run_archive_scan() (180-day daily sweep) and scan_archive_requested_sentinels() (user-initiated per-tick) both inherit the inline-retry semantic uniformly (D-15)"
tech_stack:
  added: []
  patterns:
    - "Inline per-step exponential-backoff retry loop (for _attempt in 1 2 3; do ...; sleep $((2 ** _attempt)); done) — 2s/4s sleeps, worst-case ~6s of sleep + N action attempts"
    - "Fast-fail-vs-transient case discrimination in bash: permanent 4xx / unexpected codes / State 3-collision / State 4-anomaly all return 1 on the FIRST attempt without retry; transient 5xx / empty http_code / State 1 mv-fail fall through to the retry-sleep block"
    - "Sequence-of-codes stub HTTP server in Python for exercising inline-retry recovery in bash unit tests"
key_files:
  created: []
  modified:
    - "substrate/scripts/agent-supervisor.sh (retire_identity STEP 1 + STEP 4b: inline 3-attempt exponential backoff; STEP 2 + STEP 3: preserved single-attempt with explicit D-13a exclusion comments; run_archive_scan + scan_archive_requested_sentinels: counter + retire-stuck + skip-guard machinery removed)"
    - "substrate/scripts/tests/agent-supervisor-archive-scan.sh (3 legacy retire-stuck tests deleted; 6 new inline-retry tests added; stub-homeserver enhanced with sequence-of-codes support; 3 collateral tests updated to invert their counter-file assertions per D-14)"
decisions:
  - "D-13 honored: inline per-step retries with bounded exponential backoff (3 attempts, 2s/4s/skip)"
  - "D-13a honored: retries applied ONLY to steps 1 (matrix deactivate) and 4b (folder move); steps 2 and 3 keep single-attempt behavior"
  - "D-14 honored: cross-tick failure counter files + retire-stuck sentinel drop + retire-stuck-skip guard all removed from both scanners"
  - "D-15 honored: both scanners (daily and user-initiated) uniformly benefit from the clean atomic-retire semantic"
  - "D-21 honored: no cleanup of legacy on-disk state written by the removed mechanism (archaeology stays in place; the new code just doesn't read or write it)"
metrics:
  duration_minutes: 30
  tasks_completed: 2
  tests_added: 6
  tests_deleted: 3
  files_modified: 2
  completed_date: "2026-09-24"
---

# Phase 133 Plan 133-03: Refactor retire_identity() — Inline Retries; Delete Cross-Tick Counter + retire-stuck Sentinel

One-liner: `retire_identity()` becomes atomic from the caller's POV — STEP 1 (matrix deactivate) and STEP 4b (folder move) recover inline via 3-attempt exponential backoff (2s/4s sleeps); STEPs 2 + 3 stay single-attempt; the cross-tick `retire-fail-count-*` counter and `retire-stuck` sentinel drop are excised from both scanners, along with the retire-stuck-skip guard.

## What Landed

### `substrate/scripts/agent-supervisor.sh` — `retire_identity()` refactor

**STEP 1 (matrix deactivate, ~L633-720):** the `curl` + `case "$http_code"` block is now wrapped in a `for _attempt in 1 2 3; do … sleep $((2 ** _attempt)); done` loop. The pre-`curl` validation (relay.json existence + jq field extraction) stays OUTSIDE the loop — missing files / missing fields are terminal, not transient. Inside the loop:

- `200` / `401` → set `_step1_ok=1`, `break`.
- `4*` (non-401) / `*` unexpected → `return 1` immediately (permanent, no retry).
- `5*` / empty (network error) → log the per-attempt "transient failure" line and fall through to the retry-sleep block.

After the loop, if `_step1_ok != 1`, emit the LOUD ERROR terminal-failure log line and `return 1`. Delay math: `sleep 2^_attempt` after attempts 1 and 2 (2s, then 4s); attempt 3 does not sleep (loop ends). Worst-case wall time: ~6s of sleep + 3× (curl `--max-time 30`) ≈ 96s.

**STEP 2 (graceful harness exit, ~L720-770):** no retry wrap; explicit `# Do NOT add a for _attempt in 1 2 3 loop here.` comment guards against future drift. GRACE_WAIT (11s) already gives ambient-monitor room; wrapping in a 3× retry would just re-fire the same graceful-exit burst against a pane that either already exited (waste) or is genuinely stuck (a 3× retry will not un-stick it).

**STEP 3 (tmux kill-session, ~L775-795):** no retry wrap; same explicit "do not add" comment. `tmux kill-session` is idempotent — if the session is already gone (which it will be after step 2's graceful exit in the happy path), kill-session returns non-zero and we treat that as success.

**STEP 4b (folder move, ~L837-890):** wrapped in the same `for _attempt in 1 2 3; do … done` shape. State discrimination inside the loop:

- State 1 (active present, archive absent): `mv` succeeds → `_step4b_ok=1`, break. `mv` fails → log the per-attempt "transient failure" line and fall through to the retry-sleep block.
- State 2 (active absent, archive present): idempotent success → break immediately.
- State 3 (both dirs exist): collision — NOT transient, `return 1` on the first attempt.
- State 4 (both absent): anomaly — NOT transient, `return 1` on the first attempt.

### `run_archive_scan()` (~L894-955) — cross-tick counter + retire-stuck removed

- Deleted: success-path `rm -f "$DORMANCY_STATE_DIR/retire-fail-count-$name"`.
- Deleted: failure-branch block (counter read/increment/write, `retire-stuck` sentinel drop after 3 failures, LOUD STUCK log line).
- Replaced with a single `log "ERROR: archive-scan: '$name' retire FAILED — will retry next daily pass"` line.
- Docstring updated: references Phase 133 D-14 instead of the removed mechanism.

### `scan_archive_requested_sentinels()` (~L982-1030) — retire-stuck-skip guard + counter + retire-stuck drop removed

- Deleted: the retire-stuck-skip guard at the top of the loop iteration (`if [ -f "$IDENTITIES_ARCHIVE_DIR/$name/retire-stuck" ]; then continue; fi`). Rationale: legacy sentinels on pre-Phase-133 boxes are archaeology (D-21); the operator's fresh `.archive-requested` click supersedes any stale stuck state.
- Deleted: success-path `rm -f "$DORMANCY_STATE_DIR/retire-fail-count-user-$name"`.
- Deleted: failure-branch block (counter read/increment/write, `retire-stuck` sentinel drop after 3 failures, LOUD STUCK log line).
- Replaced with `log "ERROR: '$name' user-initiated archive: retire_identity FAILED — sentinel retained; next tick will retry"`.
- Docstring updated to describe the Phase 133 D-14 mechanism removal; the D-11 guard-bypass semantic is unchanged.

### `substrate/scripts/tests/agent-supervisor-archive-scan.sh` — test contract updates

**Deleted (3 legacy tests + `# RETIRE-STUCK COUNTER TESTS — D-14` section header):**

| Test                                                    | What it pinned                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `test_retire_stuck_fires_at_3_not_before`               | Counter increment 1→2→3 across `run_archive_scan` retries + sentinel drop on pass 3 |
| `test_retire_stuck_counter_resets_on_success`           | Counter file removed after a successful `run_archive_scan` pass       |
| `test_user_path_retire_stuck_after_3_failures`          | Counter increment 1→2→3 across `scan_archive_requested_sentinels` retries + sentinel drop on pass 3 |

**Added (6 new tests — all green):**

| Test                                                        | Purpose                                                                 | Result |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| `test_retire_step1_recovers_after_transient_5xx`            | D-13a inline recovery: stub returns 500,500,200; retire completes in ~6s wall-time; no counter / no retire-stuck sentinel written | PASS |
| `test_retire_step1_terminal_after_3_5xx`                    | D-13a bounded retry: 500 forever; retire returns 1 after ~6s wall-time; sentinel + live folder retained | PASS |
| `test_retire_step1_permanent_400_no_retry`                  | Permanent 4xx aborts on first attempt; elapsed < 5s; no `attempt 2/3` log line | PASS |
| `test_retire_step4b_state3_collision_no_retry`              | State 3 collision hard-aborts on first attempt; no step-4b `attempt 2/3` log line | PASS |
| `test_scanner_no_longer_writes_counter_or_retire_stuck`     | D-14 end-to-end via `scan_archive_requested_sentinels`: no counter file, no retire-stuck sentinel | PASS |
| `test_scanner_bypasses_legacy_retire_stuck_sentinel`        | D-14 removal of the retire-stuck-skip guard: legacy archaeology sentinel does NOT block a fresh retry | PASS |

**Stub-homeserver enhancement:** `start_stub_homeserver` now accepts a comma-separated code sequence (e.g. `"500,500,200"`) for exercising the inline-retry recovery path. Backward-compatible: a single code (no comma) behaves exactly as before. The last code in the sequence is repeated for any requests beyond the sequence length. Enhancement chosen per the plan's Option 1: extend the stub with sequence support since the change is small (~4 lines added in the Python inline stub).

**Collateral test updates** (three existing tests that asserted removed counter state — Rule 2 auto-fix, since D-14 removes the writes those tests were pinning):

| Test                                                        | What changed                                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `test_sentinel_scan_triggers_retire`                        | Reworded the counter-absent assertion from "must be absent on success" to "MUST NOT be written (Phase 133 D-14)"                        |
| `test_sentinel_delete_before_move_collision`                | Replaced "counter increments to 1" assertion with two D-14 assertions: no counter file, no retire-stuck sentinel written on collision-abort |
| `test_sentinel_scan_on_malformed_identity_does_not_crash`   | Replaced "counter incremented to 1" assertion with a D-14 "counter file MUST NOT be written" assertion                                  |

**Manifest updates:** the three legacy `run_test` invocations were removed; the six new `run_test` invocations were added under a new `# --- Phase 133 D-13/D-13a/D-14 inline-retry refactor ---` section header.

## Wall-Time Measurements (D-13a Balloon-Time Sanity)

Isolated retire timings against the stub homeserver, measuring only the `retire_identity` call (no scan surround):

| Scenario                                    | Wall time | Notes                                                                            |
| ------------------------------------------- | --------: | -------------------------------------------------------------------------------- |
| Test A: 500,500,200 recovery                | 6s        | 2s + 4s inline backoff between attempts, then attempt 3 succeeds                 |
| Test B: 500 forever, terminal after 3       | 6s        | 2s + 4s inline backoff between attempts, then attempt 3 fails → return 1         |

Both cases test with no live tmux session, so STEP 2's GRACE_WAIT (11s) does not fire. In production with a live pane, add ~14-15s for STEP 2 (0.5s + 3s + 11s GRACE_WAIT). Worst-case retire wall-time in production:

- **Best case (all steps happy):** ~15s (STEP 2 GRACE_WAIT dominates).
- **STEP 1 transient recovery:** ~21s (6s STEP 1 retry + ~15s STEP 2).
- **STEP 1 terminal (aborts at STEP 1):** ~6s (STEP 2 never reached).
- **STEP 4b transient recovery:** ~21s (~15s STEPs 1-3 + 6s STEP 4b retry).

D-13a's balloon-time concern (uniform 3× on all steps = ~90s) is avoided; worst-case terminal-recovery latency stays under ~30s per identity, which stays acceptable for the cascade path in Wave C.

## Verification

Run at the end of implementation:

```
$ bash substrate/scripts/tests/agent-supervisor-archive-scan.sh
…
PASS: 73  FAIL: 0
```

- `grep -cE 'retire-fail-count|retire-stuck' substrate/scripts/agent-supervisor.sh` → `0` (script body — no live references to the removed mechanism; no comment references either after cleanup).
- `grep -c 'for _attempt in 1 2 3' substrate/scripts/agent-supervisor.sh` → `4` (2 real retry loops in STEP 1 + STEP 4b, plus 2 explicit "Do NOT add a for _attempt in 1 2 3 loop here" comments in STEPs 2 + 3 to forbid future drift).
- `bash -n substrate/scripts/agent-supervisor.sh` → exit 0.
- `bash -n substrate/scripts/tests/agent-supervisor-archive-scan.sh` → exit 0.
- `shellcheck substrate/scripts/agent-supervisor.sh 2>&1 | wc -l` → 54 (baseline unchanged; no new warnings introduced).
- `shellcheck substrate/scripts/tests/agent-supervisor-archive-scan.sh 2>&1 | wc -l` → 13 (baseline unchanged; two pre-existing warnings: SC2034 `SESSIONS_SNAPSHOT appears unused` and SC2015 `A && B || C` in workspace-repo test helpers; neither introduced or worsened by this change).
- `grep -c '<3-legacy-test-names>' substrate/scripts/tests/agent-supervisor-archive-scan.sh` → `0`.
- `grep -c '<6-new-test-names>' substrate/scripts/tests/agent-supervisor-archive-scan.sh` → `12` (each of the 6 appears twice — once as function definition, once as `run_test` invocation).

## Done-Criteria Verification

**Task 1 done criteria:**

- [x] `grep -cE 'retire-fail-count|retire-stuck' substrate/scripts/agent-supervisor.sh` returns exactly `0`.
- [x] `shellcheck substrate/scripts/agent-supervisor.sh` produces no new warnings (baseline 54 lines preserved).
- [x] `grep -c 'for _attempt in 1 2 3' substrate/scripts/agent-supervisor.sh` returns 4 (>= 2 required — 2 real loops + 2 anti-drift comments).
- [x] STEP 2 block has NO `for _attempt in 1 2 3` above/inside it (single-attempt preserved).
- [x] STEP 3 block has NO `for _attempt in 1 2 3` above/inside it (single-attempt preserved).
- [x] The retire-stuck-skip guard `if [ -f "$IDENTITIES_ARCHIVE_DIR/$name/retire-stuck" ]` no longer exists in the script.

**Task 2 done criteria:**

- [x] `bash substrate/scripts/tests/agent-supervisor-archive-scan.sh` exits 0.
- [x] Final line: `PASS: 73  FAIL: 0`.
- [x] Legacy test grep returns 0 (three legacy tests + manifest invocations GONE).
- [x] New test grep returns 12 (each of six new tests appears twice — def + invocation).
- [x] `shellcheck substrate/scripts/tests/agent-supervisor-archive-scan.sh` produces no new warnings (baseline 13 lines preserved; pre-existing SC2034 + SC2015 warnings unchanged). **Note:** the plan's done criterion says "exits 0" but the file's shellcheck baseline was already exit=1 due to the two pre-existing warnings in unrelated test helpers. Scope-boundary rule applied: no fix attempted for pre-existing warnings; documented here as expected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] Two collateral tests broke after Task 1**

- **Found during:** running the test suite after Task 1's supervisor edits landed, before starting Task 2.
- **Issue:** `test_sentinel_delete_before_move_collision` (L1043) and `test_sentinel_scan_on_malformed_identity_does_not_crash` (L1113) each contained an assertion that the removed `retire-fail-count-user-*` file "increments to 1" on retire failure — but D-14 removes the writes, so those assertions now fail.
- **Fix:** replaced the "counter increments" assertions with D-14 "counter file MUST NOT be written" + "retire-stuck sentinel MUST NOT be dropped" assertions. This inverts the pinning from the old mechanism to the new — pins that D-14 was correctly applied.
- **Files modified:** `substrate/scripts/tests/agent-supervisor-archive-scan.sh` (folded into Task 2's commit `96ee2e81`).
- **Also touched:** `test_sentinel_scan_triggers_retire` (L1032) had a "counter file must be absent on success" assertion that is now vacuously true — reworded to "MUST NOT be written (Phase 133 D-14)" for accuracy.

### Shellcheck exit-code note (informational)

The plan's done criterion for Task 2 says `shellcheck substrate/scripts/tests/agent-supervisor-archive-scan.sh` exits 0, but the file's shellcheck baseline pre-edit already exits 1 (two warnings in unrelated workspace-repo test helpers: SC2034 `SESSIONS_SNAPSHOT appears unused` at what is now L1345, and SC2015 `A && B || C` at what is now L1802). No new warnings introduced by this refactor; the baseline is preserved. Per the scope-boundary rule (only fix issues DIRECTLY caused by current-task changes), no attempt was made to fix the pre-existing warnings.

### No architectural changes

- No third caller of `retire_identity()` was discovered beyond `run_archive_scan` and `scan_archive_requested_sentinels` (grep confirmed only 2 call sites at L872 pre-edit / L946 post-edit and L971 pre-edit / L1029 post-edit). Wave C's role cascade scanner (Plan 133-04) will be the third caller once it lands.
- The per-step retry mapping matches D-13a exactly (retry only on steps 1 + 4b; no retry on steps 2 + 3). Anti-drift comments landed in steps 2 + 3 to guard against a future planner accidentally adding a `for _attempt in 1 2 3` loop there.

## Downstream Impact

Wave C (Plan 133-04) — the new role cascade scanner `scan_role_archive_requested_sentinels()` — can now import `retire_identity()` and get the clean atomic-retire contract from birth. No cross-tick state to reason about, no counter files to plumb, no retire-stuck-skip guard to duplicate. Per D-15, both the daily 180-day sweep and the user-initiated per-tick scanner (and now the role cascade in Wave C) share the same inline-retry semantic uniformly.

## Self-Check: PASSED

- `substrate/scripts/agent-supervisor.sh` — modified in-place, verified.
- `substrate/scripts/tests/agent-supervisor-archive-scan.sh` — modified in-place, verified.
- Commit `6842a4bb` (Task 1) — present in git log.
- Commit `96ee2e81` (Task 2) — present in git log.
- Test suite green: `PASS: 73  FAIL: 0`.
- No live references to `retire-fail-count` or `retire-stuck` in `agent-supervisor.sh` (`grep -cE` returns 0).
- Legacy tests removed from test file (`grep -c` for 3 legacy names returns 0).
- Six new tests present (`grep -c` for 6 new names returns 12: def + invocation each).
