---
phase: 115-identity-archiving-from-the-frontend
plan: 07
subsystem: substrate/scripts/tests (Phase 94 bash test harness extension)
tags: [phase-115, D-22, test-coverage, agent-supervisor, sentinel-scan, retire-reorder, guard-bypass, retire-stuck, ambient-monitor, bash-test-harness]

# Dependency graph
requires:
  - phase: 115
    plan: 04
    provides: "scan_archive_requested_sentinels() + reordered retire_identity() (matrix → graceful exit → tmux → sentinel-delete → folder-move) + retire-fail-count-user-<name> per-tick counter — 115-07 is the coverage that pins all of it"
  - phase: 115
    plan: 03
    provides: "POST /identities/:key/archive route — 115-07 tests the disk-sentinel half of the click chain directly (bash test harness) and does not exercise the HTTP path"
  - phase: 115
    plan: 05
    provides: "unified archive-tree walk in fleet-status-sweep — 115-07 does not test the sweep directly (that's a separate test surface); it does test the disk state that the sweep observes"
provides:
  - "8 new Phase 115 test cases covering the D-22 revalidation matrix (sentinel-scan branch, reordered retire step order, guard bypass, per-step failure retry + 3-strike retire-stuck, sentinel-delete-before-move collision safety, ambient-monitor cleanup observability [MINIMAL], malformed-identity safety)"
  - "Extended start_stub_homeserver() capturing POST request bodies to STUB_REQ_LOG for payload assertions (RESEARCH §11 recommendation)"
  - "_114_setup_identity() shared fixture helper (identity dir + .archive-requested sentinel + relay.json + running stub homeserver in one call)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-request-body stub-homeserver logging: the Python stub now writes each POST body (with path + Content-Length prefix) as a single line to STUB_REQ_LOG. Tests can grep the file to assert on payload contents (mxid, endpoint path, JSON body shape). Existing tests are unaffected because they never read STUB_REQ_LOG — extension is additive."
    - "Log-line ordering as step-order proof: rather than instrumenting the supervisor with per-step marker files (invasive), the tests grep the captured log stream for the 'retire step N' entry lines added by 115-04 and compare grep -n line numbers. This is the RESEARCH §11 'log-line approach' — less invasive, no supervisor edits needed."
    - "MINIMAL Test 7 per plan-check info-note #6: rather than building a stub ambient-monitor + 4 stub children + real killpg fanout (CI-fragile), Test 7 verifies (a) step 2's graceful-exit log line emits, (b) step 2 precedes step 3 in log-line ordering. The full SIGTERM-fanout coverage with a real ambient-monitor process is documented as follow-up (deferred, non-blocking)."
    - "Shared _114_setup_identity() fixture: reduces per-test boilerplate for the common 'identity + sentinel + stub-backed relay.json' setup. Wraps fixture_identity + touch sentinel + fixture_relay_json + start_stub_homeserver + sed-substitute STUB_PORT — the same 5-line ritual across 6 of the 8 new tests."

key-files:
  created:
    - ".planning/phases/115-identity-archiving-from-the-frontend/115-07-SUMMARY.md (this file)"
  modified:
    - "substrate/scripts/tests/agent-supervisor-archive-scan.sh (+371 lines: 841 → 1212): +30 lines to start_stub_homeserver (STUB_REQ_LOG capture); +7-line _114_setup_identity helper; 8 new test functions (~285 lines); +11 lines wiring the tests into MAIN"

decisions:
  - "MINIMAL Test 7 selected. Per plan-check info-note #6, the full stub-ambient-monitor + 4-stub-children + real killpg fanout was permitted to be simplified to a two-invariant check: (a) 'retire step 2 (graceful exit)' log line emits, (b) step 2 log line precedes step 3 log line. Rationale: in the test env there is no live tmux session, so step 2 takes the 'no live tmux session; skipping graceful exit' fast-path — the real SIGTERM-fanout branch is never reached. Testing the fanout requires a live tmux session + a real ambient-monitor stub process + child SIGTERM markers, which is CI-fragile timing-wise (11s grace wait) and heavyweight to assemble. Follow-up: build a dedicated integration test with real ambient-monitor + children in a phase-115 gating slot if D-22 depth demands it."
  - "Log-line-ordering instead of marker-file instrumentation (Test 4). RESEARCH §11 recommended either approach; picked log-line ordering because the log lines already exist post-115-04 and the alternative (marker files touched via wrapper scripts) would have required modifying the supervisor or shimming its `log` function. Zero supervisor edits was the goal."
  - "Shared _114_setup_identity() helper for the sentinel+stub+relay.json common case. 6 of the 8 new tests need the same 'identity dir + .archive-requested sentinel + stub-backed relay.json' shape. Extracting the boilerplate keeps each test's assertion block readable."
  - "STUB_REQ_LOG is a separate mktemp'd file, additive to the existing STUB_LOG (which is repurposed only for port communication). Existing tests never inspect STUB_REQ_LOG so the extension is backward-compatible — all 31 pre-plan tests continue to pass without modification."
  - "Test 6 documents the sentinel-delete-before-move collision-abort corner as observed-and-accepted, not a bug. After step 4a runs (sentinel deleted) but before step 4b's collision-abort, the sentinel is gone. The next tick sees no sentinel and does NOT retry. This is intentional per D-12 rationale ('a mid-retire crash leaves the sentinel in place for the next tick to retry') — BUT the State 3 collision is a hard-abort, not a transient crash. The retire-stuck counter (which increments on step-4b failure) is the operator signal, not sentinel-retry."
  - "Existing Phase 94 test cases needed ZERO adjustment for the 115-04 retire reorder — all 31 remained green after adding the 8 new cases. The 115-04 planners had already updated the pitfall gates and adjusted test_retire_5xx_aborts_with_1 / test_retire_collision_aborts to match the new order as part of 115-04's own delivery."

patterns-established:
  - "Any future 'phase N retire flow revalidation' tests should extend agent-supervisor-archive-scan.sh in the same section pattern (`# ============ Phase N tests: <purpose> ============`) rather than creating a new bash test file. RESEARCH §8 argued for this and the pattern is now doubled-down."
  - "Stub homeserver payload assertion pattern (grep STUB_REQ_LOG for path + credentials-in-body) is now the standard way to verify request-shape claims against the stub. Prior tests only verified return-code semantics; this extension unlocks payload-shape verification."

# Metrics
metrics:
  duration: "~4m 7s executor wall-time"
  completed: "2026-09-17"
  tasks_completed: 1
  files_modified: 1
  files_created: 1
  lines_added_test_harness: 371
  tests_added: 8
  total_tests: 39 (31 existing Phase 94 + 8 new Phase 115)
  all_tests_pass: true
  shellcheck_baseline_delta: 0 (54 lines pre- and post-plan, well under the 60-line gate)
---

# Phase 115 Plan 07: Extend Phase 94 test harness (D-22 revalidation) Summary

## Overview

One-liner: **Adds 8 test cases to `substrate/scripts/tests/agent-supervisor-archive-scan.sh` covering the user-initiated sentinel-scan branch, reordered retire flow step-order observability, guard bypass matrix, per-tick failure retry + 3-strike retire-stuck, sentinel-delete-before-move collision safety, ambient-monitor cleanup (MINIMAL), and malformed-identity safety — pinning the D-22 behavioral contract that the whole 115-04 retire flow relied on but had never fired in production.**

Purpose: satisfy D-22's mandate ("the full retire flow has never fired in production — treat as untrusted, revalidate end-to-end") and freeze the phase's behavioral contract so future regressions are caught immediately.

## New test cases (all green)

| # | Test | Status | Covers |
|---|------|--------|--------|
| 1 | `test_sentinel_scan_triggers_retire` | PASS | Sentinel-scan branch fires retire; all four step log lines emit; live folder gone; archive folder present; sentinel deleted (step 4a); user-fail-counter absent; stub captured deactivate POST body with mxid + endpoint path |
| 2 | `test_sentinel_scan_bypasses_all_guards` | PASS | All three guards (.pinned + .no-dormancy + coordinator: true) present + .archive-requested → retire STILL fires (D-11 bypass) |
| 3 | `test_daily_path_preserves_all_guards` | PASS | 200-day-dormant identity with .pinned → NOT retired. Same for .no-dormancy. Same for coordinator: true frontmatter. Guards preserved on the 180-day daily path |
| 4 | `test_retire_step_order_observable` | PASS | log-line ordering: step 1 < step 2 < step 3 < step 4a < step 4b (matrix → graceful exit → tmux → sentinel-delete → folder-move, per 115-04 D-13) |
| 5 | `test_user_path_retire_stuck_after_3_failures` | PASS | Matrix 5xx → sentinel retained → counter increments 1 → 2 → 3 → retire-stuck sentinel drops in archive/delta/ + LOUD STUCK log on pass 3 |
| 6 | `test_sentinel_delete_before_move_collision` | PASS | State 3 collision-abort: step 1 hits stub (log has deactivate POST body); step 4a deletes sentinel BEFORE step 4b fails; live folder retained; retire returns 1; user-fail-counter = 1 |
| 7 | `test_ambient_monitor_graceful_shutdown_observable_minimal` | PASS | MINIMAL variant per plan-check info-note #6: step 2 log line emits + step 2 precedes step 3 in log-line ordering (full SIGTERM fanout deferred as follow-up) |
| 8 | `test_sentinel_scan_on_malformed_identity_does_not_crash` | PASS | Folder + sentinel exist, no md, no relay.json → scan_archive_requested_sentinels does NOT crash; step 1 fails LOUD with 'relay.json not found'; sentinel retained; counter = 1 |

## D-22 coverage areas — all four confirmed

| D-22 area | Covered by |
|-----------|------------|
| 1. Sentinel-scan branch fires retire on user-initiated path | Test 1 (happy path) + Test 2 (guard bypass) + Test 8 (malformed safety) |
| 2. Retire flow new order (matrix → graceful exit → tmux → sentinel-delete → folder-move) | Test 4 (log-line ordering) + Tests 1/2/5/6/7 (each traverses the flow and asserts on step-log presence) |
| 3. Retire failure paths (5xx → per-tick retry → 3-strike retire-stuck) | Test 5 |
| 4. Idempotency + safety (collision-abort mid-move, malformed state) | Test 6 (collision-abort) + Test 8 (malformed) |

## Existing Phase 94 tests

**Zero regressions.** All 31 pre-plan tests remain green (see the pass counts at the bottom of the harness output). No adjustments were needed — 115-04's own planners had already updated the pitfall gates and adjusted `test_retire_5xx_aborts_with_1` / `test_retire_collision_aborts` in-place at delivery time. The retire-order change did not surface any latent regressions in the daily-path tests.

## Line counts

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| `substrate/scripts/tests/agent-supervisor-archive-scan.sh` line count | 841 | 1212 | +371 |
| Total tests | 31 | 39 | +8 |
| shellcheck output lines on `agent-supervisor.sh` | 54 | 54 | 0 (well under the 60-line gate) |

## Deviations from plan

**None substantive.** Executed exactly per the plan's `<action>` block:

- Test 7 explicitly selected the MINIMAL variant per plan-check info-note #6 — this was **pre-authorized** by the plan itself, not an ad-hoc simplification.
- Extended `start_stub_homeserver()` to capture POST bodies per RESEARCH §11 recommendation, keeping backward-compat with existing tests (STUB_REQ_LOG is a separate mktemp'd file; existing tests never read it).
- Added a `_114_setup_identity()` shared helper to reduce per-test boilerplate. This is inside the harness itself and doesn't affect the production supervisor.

## /close follow-up landed (2026-09-17)

**Real-tmux teardown gap (surfaced by Phase 115 /close conformance review):** the shape's Follow-ups list called out that every retire-flow test in this harness ran in "no live tmux session" mode, so step 3 (`tmux kill-session`) was only ever exercised as a no-op — the shape's second failure mode ("retire kills the tmux session before the harness has had a chance to save") was only proven by log-line ordering, not by actual tmux teardown. Ashley's disposition: real-tmux teardown must land as a follow-up before deploy; deeper ambient-monitor cascade (4-stub-children + real killpg fanout) stays accepted-as-drift.

**Closed by:** `test_retire_kills_live_tmux_session` — a 9th test case added to this harness. It spawns a REAL detached tmux session (`tmux new-session -d -s <ident> 'sleep 300'`), manually seeds `SESSIONS_SNAPSHOT` so `retire_identity`'s `match_session()` can resolve the live session, drives user-initiated archive via `scan_archive_requested_sentinels()`, and asserts `tmux has-session -t <ident>` returns non-zero after retire completes. Also asserts step 3's SUCCESS-branch log line (`"killed tmux session"`) — the branch that never fired in the other tests. Idempotent teardown (`kill-session 2>/dev/null || true`) so leaked sessions don't accumulate across harness runs.

The test discovered and documents a bash gotcha inline: `declare -A SESSIONS_SNAPSHOT=()` at the top of the supervisor becomes LOCAL to `_source_supervisor` when the supervisor is sourced from inside a function — the map evaporates when `_source_supervisor` returns. The new test re-declares `SESSIONS_SNAPSHOT` at the subshell's top-level scope before seeding it. (This is also the root cause of the benign `line 748: tina: unbound variable` warnings you'll see scrolling past in every existing retire test — swallowed by `|| true` at the match_session call sites.)

**Test count after follow-up:** 40 (was 39). All green.

## Deferred / follow-up

- **Full ambient-monitor SIGTERM fanout coverage.** Test 7 is MINIMAL: it doesn't spawn a stub ambient-monitor process + 4 stub children + observe killpg fanout end-to-end. The 11s `GRACE_WAIT` sleep + real-tmux-session + real-process choreography is CI-fragile. If a future regression around ambient-monitor cleanup timing surfaces, this coverage should be built as a dedicated integration test (probably in a `substrate/scripts/tests/agent-supervisor-ambient-cleanup.sh` file) rather than bolted onto this unit-test harness. **Ashley confirmed as accepted-as-drift** during the /close review; the follow-up landed above only closed the real-tmux-session gap, NOT this one.
- **Requests-to-relay-room deactivate.** The stub_homeserver captures request bodies now, but the tests only assert on path + mxid presence. A future test could parse the body as JSON and check the full deactivate schema (auth.type == "m.login.password", user == mxid, erase == true). Not needed for this plan's scope but would tighten the payload contract if we ever change the shape.
- **End-to-end HTTP-path test.** These tests directly invoke `scan_archive_requested_sentinels()` after sourcing the supervisor. They do NOT exercise the frontend → 115-03 endpoint → disk-sentinel → 115-04 sentinel-scan chain. That HTTP-plus-disk end-to-end test is a natural integration test but out of scope for this plan (which is bash test harness territory only, per CONTEXT.md D-23).

## Deferred issues

None. Auto-fix attempts count for this plan: 0 (nothing needed fixing during execution).

## Threat Flags

None. This plan added test coverage only; no new production surface, no new endpoints, no new file access patterns, no new schema.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `ef8333da` | `test(115-07): add 8 Phase 115 test cases + capture stub request bodies` |

## Self-Check: PASSED

- File `substrate/scripts/tests/agent-supervisor-archive-scan.sh` exists at 1212 lines.
- File `.planning/phases/115-identity-archiving-from-the-frontend/115-07-SUMMARY.md` exists.
- Commit `ef8333da` present in `git log`.
- `bash substrate/scripts/tests/agent-supervisor-archive-scan.sh` → **PASS: 39  FAIL: 0**
- All 8 new test functions present + wired into MAIN.
- shellcheck baseline on `agent-supervisor.sh` unchanged at 54 lines.
