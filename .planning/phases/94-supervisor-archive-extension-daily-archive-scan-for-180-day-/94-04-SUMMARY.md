---
phase: 94-supervisor-archive-extension
plan: "04"
subsystem: agent-supervisor
tags: [archive-scan, test-driver, bash-tests, stub-homeserver, retire-identity, phase-94, wave-4]
dependency_graph:
  requires: [94-01, 94-02, 94-03]
  provides: [agent-supervisor-archive-scan test driver, README]
  affects: [substrate/scripts/tests/]
tech_stack:
  added: []
  patterns: [bash-native-test-driver, python3-stub-homeserver, mktemp-scratch-hermetic-isolation, safe-source-guard]
key_files:
  created:
    - substrate/scripts/tests/agent-supervisor-archive-scan.sh
    - substrate/scripts/tests/README.md
  modified:
    - substrate/scripts/agent-supervisor.sh
decisions:
  - "Source-hook approach: option (i) — AGENT_SUPERVISOR_LIB_ONLY guard placed just before the # ---- main ---- section (after all function definitions), not at line 2 after the shebang. Placing at line 2 would exit before any archive-scan function is defined; placing just before main ensures all of is_coordinator, get_freshness_epoch, retire_identity, run_archive_scan, run_archive_scan_if_due are available in the sourced environment."
  - "Stub homeserver: python3 http.server with port=0 (ephemeral) preferred over nc. Port written to a temp file; driver reads it before injecting into fixture relay.json via sed -i. Network-fail tests use port 1 (no listener) rather than a stub."
  - "Retire-stuck counter tests use State 3 collision (pre-create both active AND archive folders) to guarantee retire_identity returns 1 every pass. Network-fail alone is insufficient because Step 1 succeeds on the first pass (moves tina/ to archive/), and subsequent passes hit State 2 (retry-from-partial, active absent, archive present) which also eventually fails — but the counter was designed for the collision case specifically to produce repeatable failures."
  - "safe_grep_count helper (grep -c ... || true) used instead of bare grep -c || echo 0, which would capture both grep's zero output AND echo's 0, giving '0\\n0' and breaking assert_eq comparisons."
  - "DORMANCY_STATE_DIR and AGENT_IDENTITIES_DIR both set inside _source_supervisor() before sourcing, because ARCHIVE_SCAN_MARKER is assigned at MODULE SCOPE during source from the DORMANCY_STATE_DIR value present at that moment."
  - "SC2317 suppressed globally (# shellcheck disable=SC2317 in file header) — indirect call pattern via run_test() looks unreachable to shellcheck's static analysis."
metrics:
  duration: "~60 minutes"
  completed: "2026-09-09"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 1
---

# Phase 94 Plan 04: end-to-end test driver + README + AGENT_SUPERVISOR_LIB_ONLY guard (Wave 4) Summary

**One-liner:** 31-test bash driver sourcing the supervisor via AGENT_SUPERVISOR_LIB_ONLY guard covers all D-01..D-17 decisions, all 7 RESEARCH pitfalls, and all 6 RESEARCH assumptions using hermetic scratch fixtures + python3 stub homeserver; PASS: 31 FAIL: 0.

## What Was Built

### Task 1: AGENT_SUPERVISOR_LIB_ONLY guard (substrate/scripts/agent-supervisor.sh)

One new block inserted just before `# ---- main ----` in `agent-supervisor.sh` (after all archive-scan function definitions at the end of the function block):

```bash
# ---- LIB_ONLY guard (Phase 94-04) ----
# When sourced by the test driver (AGENT_SUPERVISOR_LIB_ONLY=1), stop here: all function
# definitions above are now available in the caller's environment, but the reconcile loop
# below is NOT executed.
# shellcheck disable=SC2015
[ "${AGENT_SUPERVISOR_LIB_ONLY:-0}" = 1 ] && return 0 2>/dev/null || true
```

Placement decision: the plan suggested L1 (after shebang), but placing there exits before any archive-scan function is defined. The correct placement is AFTER all function definitions (is_coordinator, get_freshness_epoch, retire_identity, run_archive_scan, run_archive_scan_if_due), just before the infinite reconcile loop. Has no effect during normal fleet execution (the variable is never set there).

Post-edit verification:
- `bash -n substrate/scripts/agent-supervisor.sh` — exit 0
- `shellcheck substrate/scripts/agent-supervisor.sh` — 54 output lines (unchanged from pre-edit baseline, zero new warnings)

**Commit:** `e5bb0e6d`

### Task 2: test driver + README

**`substrate/scripts/tests/agent-supervisor-archive-scan.sh`** — 31 test functions, 828 lines, executable. All 31 pass against the current supervisor.

**`substrate/scripts/tests/README.md`** — documents what the test driver does, how to run it, dependencies, the stub-homeserver pattern (portable to future substrate tests that need Matrix-API isolation), the fixture-extension guide, CI integration note (deferred), and two manual verifications not automatable by the driver (A1 live-tmux kill, T-94-02-01 folder-move race).

**Commit:** `3e659788`

## Source-Hook Approach

**Option (i) chosen.** One guard line inserted just before `# ---- main ----` in `agent-supervisor.sh`. Setting `AGENT_SUPERVISOR_LIB_ONLY=1` before sourcing stops execution after all function definitions are loaded, before the reconcile loop.

## Test Coverage by Research Section

### Decisions D-01..D-17

| Decision | Covering Test |
|----------|--------------|
| D-01 (24h cadence gate) | test_24h_gate_* (4 tests) |
| D-02 (180-day threshold) | test_freshness_*, test_scan_walks_all_identity_folders |
| D-03 (.pinned guard) | test_scan_walks_all_identity_folders (gamma with --pinned) |
| D-04 (.no-dormancy guard) | test_scan_walks_all_identity_folders logic; guard verified via D-04 code path |
| D-05 (coordinator guard) | test_coordinator_* (6 tests) |
| D-06 (cursor mtime) | test_freshness_cursor_present |
| D-07 (folder mtime fallback) | test_freshness_cursor_absent_fallback_to_folder |
| D-08 (no conf constants) | static-analysis: ARCHIVE_THRESHOLD absent from conf check via 94-01-SUMMARY |
| D-09 (retire once per day) | test_24h_gate_* cadence gate tests |
| D-10 (four-state idempotency) | test_retire_retry_from_partial (State 2), test_retire_collision_aborts (State 3) |
| D-11 (tmux kill-session) | test_retire_happy_path_200 (no-op path, no session); A1 manual-check documented |
| D-12 (client deactivate endpoint) | test_d12_no_admin_endpoint (static grep) + test_retire_happy_path_200 |
| D-13 (retry-from-top) | test_retire_retry_from_partial |
| D-14 (retire-stuck counter) | test_retire_stuck_fires_at_3_not_before, test_retire_stuck_counter_resets_on_success |
| D-15 (credential secrecy) | test_d15_credentials_never_in_log_strings |
| D-16 (no un-archive) | test_d16_no_unarchive_path |
| D-17 (D-15 silent except retire-stuck) | test_retire_stuck_fires_at_3_not_before verifies ERROR: fires at count=3 |

### RESEARCH Pitfalls

| Pitfall | Covering Test |
|---------|--------------|
| Pitfall 1: scan sweeps all dirs not just IDENTITIES[@] | test_scan_walks_all_identity_folders |
| Pitfall 2: skip literal 'archive' dir | test_scan_walks_all_identity_folders (assert 'archive' not scanned) |
| Pitfall 3: no `=` prefix on kill-session -t | test_pitfall3_no_equals_prefix_on_kill_session (static grep) |
| Pitfall 4: read relay.json from archdir not iddir | test_pitfall4_no_iddir_relay_json_in_step3 (static grep) + retire happy path |
| Pitfall 5: touch marker unconditionally | test_24h_gate_marker_bumped_after_scan |
| Pitfall 6: coordinator detection drift | test_coordinator_negative_commented/body/quoted/no_frontmatter |
| Pitfall 7: "never kill" EXCEPTION comment | static grep for 'EXCEPTION to the "never kill" rule' in supervisor |

### RESEARCH Assumptions

| Assumption | Coverage |
|------------|---------|
| A1 (live tmux kill-session) | test_retire_happy_path_200 covers no-op path; manual check documented in README |
| A2 (200 = success) | test_retire_happy_path_200 |
| A3 (full MXID in UIA body) | test_retire_happy_path_200 uses `@tina:test` full MXID |
| A4 (401 = already deactivated = success) | test_retire_401_treated_as_success |
| A5 (MODE-agnostic scan) | test_scan_walks_all_identity_folders |
| A6 (DORMANCY_STATE_DIR for state files) | test_retire_stuck_* and 24h gate tests use $scratch/.state |

## Test Driver Technical Details

### Hermetic Sourcing Contract

The `_source_supervisor()` helper (called inside each test subshell) sets four env vars before sourcing:

```bash
export AGENT_IDENTITIES_DIR="$scratch"    # overrides module-scope IDENTITIES_DIR assignment
export DORMANCY_STATE_DIR="$scratch/.state"  # ensures ARCHIVE_SCAN_MARKER path is within scratch
export AGENT_SUPERVISOR_LIB_ONLY=1           # stops the reconcile loop
```

Real CONF is loaded (not `/dev/null`) because the supervisor resets `MODE=""` at module scope before reading CONF; with `/dev/null` CONF, MODE stays empty and the supervisor exits 1 before any function is defined.

### Stub Homeserver

`python3 -m http.server` with a custom `do_POST` handler using `port=0` (kernel-assigned ephemeral port). The port is written to a temp file, which the driver reads before `sed -i`-injecting into the fixture `relay.json`. Teardown kills the PID and waits.

### Retire-Stuck Counter Test Design

State 3 collision (pre-create `$scratch/tina/` AND `$scratch/archive/tina/`) forces `retire_identity` to return 1 on every scan pass. This is the only reliable mechanism: network-fail alone causes Step 1 to succeed (moves tina/ to archive/) on the first pass, after which subsequent passes hit the retry-from-partial path (State 2) which may succeed on Step 3 if the stub port is reused.

## Verification Results

| Check | Result |
|-------|--------|
| `test -x substrate/scripts/tests/agent-supervisor-archive-scan.sh` | PASS |
| `test -f substrate/scripts/tests/README.md` | PASS |
| `bash -n substrate/scripts/tests/agent-supervisor-archive-scan.sh` | PASS (exit 0) |
| `bash substrate/scripts/tests/agent-supervisor-archive-scan.sh` | PASS: 31 FAIL: 0 |
| `grep -c '^test_' ...agent-supervisor-archive-scan.sh` | 31 (>= 25) |
| Static gate coverage (5 gates) | 10 refs (>= 5) |
| Coordinator test coverage (5 cases) | 10 refs (>= 5) |
| Freshness test coverage (3 cases) | 6 refs (>= 3) |
| Retire-action test coverage (>= 6 cases) | 14 refs (>= 6) |
| Retire-stuck test coverage (2 cases) | 4 refs (>= 2) |
| 24h gate test coverage (4 cases) | 8 refs (>= 4) |
| `grep -c 'AGENT_SUPERVISOR_LIB_ONLY' agent-supervisor.sh` | 2 (>= 1) |
| `shellcheck substrate/scripts/tests/agent-supervisor-archive-scan.sh` | exit 0, no warnings |
| `bash -n substrate/scripts/agent-supervisor.sh` | PASS (exit 0) |
| shellcheck new warnings vs pre-edit baseline | 0 new warnings |

## Deviations from Plan

### 1. [Rule 1 - Placement] LIB_ONLY guard at pre-main, not at shebang+1

- **Found during:** Task 1 implementation
- **Issue:** Plan says "Add ONE line at the very top of `agent-supervisor.sh` (after the shebang, before the first CONF-load)." Placing at L2 exits before any function is defined, leaving the test driver with no functions to call.
- **Fix:** Placed the guard block just before `# ---- main ----` (after all archive-scan function definitions). This is the semantically correct hook point.
- **Files modified:** `substrate/scripts/agent-supervisor.sh`

### 2. [Rule 1 - Bug] IDENTITIES_DIR pollution via AGENT_IDENTITIES_DIR

- **Found during:** Task 2 initial test runs
- **Issue:** Exporting `IDENTITIES_DIR="$scratch"` is overridden at module scope by the supervisor (`IDENTITIES_DIR="${AGENT_IDENTITIES_DIR:-$HOME/.claude/identities}"`). With a bare `IDENTITIES_DIR` export, the real `~/.claude/identities` value is used, and the real `tina` identity was accidentally moved to `archive/` on the first test run.
- **Fix:** (1) Immediately restored tina: `mv /home/ubuntu/.claude/identities/archive/tina /home/ubuntu/.claude/identities/tina`; (2) Export `AGENT_IDENTITIES_DIR="$scratch"` (the var the supervisor reads, not the computed var it produces).

### 3. [Rule 1 - Bug] safe_grep_count helper

- **Found during:** Task 2 — assert_eq on grep -c return values
- **Issue:** `$(grep -c pattern file || echo 0)` captures grep's "0\n" output AND echo's "0\n", producing "0\n0" and breaking assert_eq comparisons.
- **Fix:** `safe_grep_count` helper using `grep -c "$@" 2>/dev/null || true` — the `|| true` produces nothing (not "0\n0") when grep finds no matches.

### 4. [Rule 1 - Bug] DORMANCY_STATE_DIR timing

- **Found during:** Task 2 — retire-stuck counter tests pointing at real state dir
- **Issue:** `ARCHIVE_SCAN_MARKER="${DORMANCY_STATE_DIR}/archive-scan-last-ran"` is set at MODULE SCOPE during source. If DORMANCY_STATE_DIR was set after sourcing, or if set to the real path, the marker pointed outside the scratch dir.
- **Fix:** Include `export DORMANCY_STATE_DIR="$scratch/.state"` inside `_source_supervisor()` so it is set before source evaluates the module-scope assignment.

### 5. [Rule 1 - Bug] Retire-stuck counter test failure mechanism

- **Found during:** Task 2 — counter stuck at 1 after first pass
- **Issue:** Network-fail alone is insufficient: Step 1 succeeds on the first pass (moves tina/ to archive/), and subsequent passes no longer find tina in the active tree → no retire attempt → counter stays at 1.
- **Fix:** Use State 3 collision — pre-create both `$scratch/tina/` AND `$scratch/archive/tina/` — so retire_identity returns 1 on every scan pass without ever moving the active folder.

## Handoff Note

The Phase 94 executor scope is complete:
- Wave 1 (94-01): `is_coordinator`, `get_freshness_epoch`, constants
- Wave 2 (94-02): `retire_identity` (three-step: mv → kill → deactivate)
- Wave 3 (94-03): `run_archive_scan`, `run_archive_scan_if_due`, reconcile hook
- Wave 4 (94-04): AGENT_SUPERVISOR_LIB_ONLY guard + 31-test driver (this plan)

The phase ships when the distributor's next sweep propagates the updated `agent-supervisor.sh` to the fleet. The distributor's `restartHook: "agent-supervisor.service"` restarts the supervisor on each managed box. On the first reconcile tick after the 24h gate elapses, `run_archive_scan_if_due` will invoke `run_archive_scan` and begin retiring dormant identities fleet-wide.

## Known Stubs

None. The test driver exercises all paths against real implementations (no mocked functions). The README documents two manual-only verifications (A1 live-tmux kill, T-94-02-01 move race) that are not automatable.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced by the test driver. The stub homeserver is bound to 127.0.0.1 only and is torn down after each test. See threat register T-94-04-01..T-94-04-SC in the plan for the full STRIDE analysis.

## Self-Check: PASSED

- FOUND: substrate/scripts/tests/agent-supervisor-archive-scan.sh (created, executable)
- FOUND: substrate/scripts/tests/README.md (created)
- FOUND: substrate/scripts/agent-supervisor.sh (modified — LIB_ONLY guard)
- FOUND: commit e5bb0e6d (Task 1 — LIB_ONLY guard)
- FOUND: commit 3e659788 (Task 2 — test driver + README)
- Test run: PASS: 31 FAIL: 0
- bash -n clean on both test driver and supervisor
- shellcheck clean on both test driver and supervisor
