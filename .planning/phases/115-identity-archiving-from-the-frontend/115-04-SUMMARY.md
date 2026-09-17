---
phase: 115-identity-archiving-from-the-frontend
plan: 04
subsystem: fleet-substrate (bash agent-supervisor)
tags: [agent-supervisor, retire-flow, sentinel-scan, phase-94-reorder, D-11, D-12, D-13, D-14, D-15, ambient-monitor-timing]

# Dependency graph
requires:
  - phase: 94
    provides: "retire_identity() flow with move → tmux kill → matrix deactivate order; retire-fail-count-<name> counter mechanics; is_coordinator + get_freshness_epoch guard helpers; agent-supervisor-archive-scan.sh test harness (28 tests)"
  - phase: 115
    plan: 01
    provides: "ALLOWED_REL_PATHS gates .archive-requested — the sentinel this plan's scan branch consumes"
provides:
  - "retire_identity() reordered per D-13: matrix → graceful-exit → tmux → sentinel-delete → folder-move (was: move → tmux → matrix). Applied to BOTH trigger paths (user-initiated + 180-day dormancy) since they share the function."
  - "GRACE_WAIT=11 local in retire_identity step 2 — must match ambient-monitor.py:81 GRACE_SECONDS+1 (lockstep invariant, comment attached at declaration site)."
  - "scan_archive_requested_sentinels() function — sibling of run_archive_scan_if_due(), invoked on every reconcile tick, walks $IDENTITIES_DIR/*/ for .archive-requested sentinels, BYPASSES the four guards (D-11), invokes retire_identity() directly."
  - "retire-fail-count-user-<name> per-tick counter file (sibling of Phase 94's retire-fail-count-<name>) — independent from the daily path's counter (RESEARCH §3 option b). Clears on user-initiated success only."
  - "Unified retire-stuck sentinel — both paths write to $IDENTITIES_ARCHIVE_DIR/<name>/retire-stuck. Both paths now mkdir -p archdir first to defend the case where step-1-fail-3x never reaches step 4b (matrix-first order can drop stuck sentinel without archdir existing)."
  - "Step 4a sentinel-delete BEFORE folder move (D-12 option b) — mid-move crash leaves .archive-requested in place for next-tick retry."
  - "Test-harness adjustments preserving 180-day path coverage under the new step order (Pitfall-4 inverted; 5xx test asserts archdir absence; collision test requires stub-homeserver + relay.json fixture)."
affects: [115-05, 115-06, 115-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Guard-bypass at caller (not param): the user-initiated scan branch simply doesn't call the four guards; retire_identity() itself remains guard-agnostic. Alternative (force-flag param on retire_identity) was rejected per RESEARCH §3 to keep retire_identity's signature stable."
    - "Recycle-pattern verbatim reuse for graceful exit (D-14): step 2 copies recycle()'s /exit paste + Enter + sleep + SIGTERM-survivors sequence byte-for-byte. Do NOT fork a second graceful-exit pattern in the codebase."
    - "Ambient-monitor lockstep invariant: GRACE_WAIT (bash) must equal GRACE_SECONDS+1 (python). Enforced via a code comment at the declaration site pointing to ambient-monitor.py:81. Future changes to either MUST bump both."
    - "Sentinel-delete-before-move for retry safety (D-12 option b): step 4a rm -f runs BEFORE step 4b mv. A mid-move crash naturally leaves the sentinel in place so next tick retries the whole retire from step 1."
    - "Sibling-counter pattern for independent retry cadences: user-initiated 15s cadence counter (retire-fail-count-user-<name>) is a SIBLING of the daily 24h counter (retire-fail-count-<name>), not shared. Success on one path does NOT reset the other."

key-files:
  created: []
  modified:
    - "substrate/scripts/agent-supervisor.sh (retire_identity() rewritten L389-573; scan_archive_requested_sentinels() added L699+; reconcile() wiring at L1942; run_archive_scan retire-stuck mkdir -p defense at L629-635)"
    - "substrate/scripts/tests/agent-supervisor-archive-scan.sh (test_pitfall4 inverted to require iddir/relay.json presence; test_retire_5xx_aborts_with_1 flipped to assert archdir absence; test_retire_collision_aborts extended with stub-homeserver + relay.json fixture)"

key-decisions:
  - "Reused recycle()'s graceful-exit pattern VERBATIM in retire step 2 (D-14). Did not tune the timing for retire despite the RESEARCH §4 note that a mid-turn long response may exceed the 3.5s bounded wait — v1 reuse-verbatim per plan; v2 knob deferred (CONTEXT deferred idea)."
  - "GRACE_WAIT set to a fixed sleep (11s = GRACE_SECONDS+1) rather than polling ambient-monitor's pid. Simpler, correct enough — polling is a nicer implementation but was called out as v2 in RESEARCH §4 Open Question 2."
  - "Guard bypass lives at the CALLER (in scan_archive_requested_sentinels), NOT as a `force`-flag param on retire_identity(). retire_identity stays guard-agnostic; adding a param would create two code paths inside the function to review."
  - "Sibling counter file (retire-fail-count-user-<name>) chosen over shared counter with the daily path. Independent counters keep the per-tick 15s cadence's stuck detection cleanly separated from the daily 24h cadence's — a passing daily sweep does NOT reset a user-initiated in-flight stuck counter."
  - "run_archive_scan()'s retire-stuck touch upgraded with mkdir -p BEFORE the touch. In Phase 94's old step order this was safe because step-1-fail-3x meant folder-move failed (archive dir already existed from a prior partial run); in the new order step-1-fail-3x means matrix failed with archdir never created, so the touch would silently no-op without mkdir."
  - "Test-harness Pitfall-4 assertion inverted (was: '$iddir/relay.json' MUST NOT appear; now: MUST appear). Inversion preserves the intent of the original check (ensure step reads from the correct tree) while flipping which tree is correct under the new order."

patterns-established:
  - "Multi-step retire flow with logged step entry+exit at each boundary — grep-able 'retire step N' anchors let a future reader/log-viewer reconstruct exactly where a partial retire aborted."
  - "Cross-language invariant lockstep enforced by adjacent-file comment (GRACE_WAIT ↔ GRACE_SECONDS): the comment lives at the DECLARATION site of the sensitive constant, references the exact file+line of its counterpart, and states the update rule."

requirements-completed: []  # Plan frontmatter had `requirements: []`

# Metrics
duration: 25min
completed: 2026-09-17
---

# Phase 115 Plan 115-04: Reorder retire_identity() + scan_archive_requested_sentinels() Summary

**agent-supervisor.sh grown with reordered retire (matrix → graceful-exit → tmux → sentinel-delete → folder-move) and a user-initiated sentinel-scan branch that bypasses guards at the caller; ambient-monitor grace window (11s) inlined between steps 2 and 3 so children flush before tmux kill lands.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-17T19:57:00Z (approx — plan spawn)
- **Completed:** 2026-09-17T20:23:30Z
- **Tasks:** 2
- **Files modified:** 2 (agent-supervisor.sh + agent-supervisor-archive-scan.sh)

## Accomplishments

- `retire_identity()` executes in the new D-13 order: (1) matrix deactivate → (2) graceful harness exit → (3) tmux kill-session → (4a) sentinel delete → (4b) folder move. Applied uniformly to both trigger paths (180-day dormancy + user-initiated).
- Step 2 reuses `recycle()`'s `/exit` paste + Enter + SIGTERM-survivors pattern verbatim (D-14) and waits `GRACE_WAIT=11s` for ambient-monitor's own SIGTERM-fanout window to complete before step 3's tmux kill lands.
- `scan_archive_requested_sentinels()` walks `~/fleet/identities/*/` on every reconcile tick (~15s cadence), calls `retire_identity()` on any `.archive-requested` hit, BYPASSING the pinned/no-dormancy/coordinator/freshness guards (D-11 caller-side bypass — no `force`-flag param).
- Per-tick user-initiated fail counter `retire-fail-count-user-<name>` implemented as a sibling of Phase 94's daily counter; 3 consecutive failures drop `retire-stuck` sentinel (unified with daily-path semantics).
- All 31 existing tests in `agent-supervisor-archive-scan.sh` pass under the new order, with 3 tests updated to reflect the reordered failure surfaces (Pitfall-4 inverted, 5xx test flipped, collision test extended with stub-homeserver fixture).

## Task Commits

Each task was committed atomically:

1. **Task 1: Reorder retire_identity() steps + delete sentinel before folder move** — `087247bb` (feat)
2. **Task 2: Add scan_archive_requested_sentinels() + wire into reconcile()** — `6b1039c3` (feat)

**Plan metadata:** pending final commit

## Files Created/Modified

- `substrate/scripts/agent-supervisor.sh` — retire_identity() rewritten (L389-573, was L368-479 pre-plan); scan_archive_requested_sentinels() added (L699+); reconcile() tick loop grew one call at L1942 for the user-initiated branch; run_archive_scan()'s retire-stuck touch grew a `mkdir -p` defense at L629-635.
- `substrate/scripts/tests/agent-supervisor-archive-scan.sh` — three test bodies adjusted for the new step order: `test_pitfall4_no_iddir_relay_json_in_step3` inverted (iddir/relay.json is now REQUIRED, not forbidden); `test_retire_5xx_aborts_with_1` asserts archdir absence (was asserting presence); `test_retire_collision_aborts` extended with `fixture_relay_json` + stub-homeserver-200 since collision detection now lives in step 4b (reached only after step 1 succeeds).

## Static Analysis

- `bash -n substrate/scripts/agent-supervisor.sh` — exits 0.
- `shellcheck substrate/scripts/agent-supervisor.sh` — 10 findings, IDENTICAL count to pre-plan baseline (no new warnings introduced). One shellcheck disable directive added at the SIGTERM-survivor loop copied verbatim from `recycle()` per D-14: `# shellcheck disable=SC2009  # D-14: pattern copied verbatim from recycle() — pgrep does not support -t (tty filter) the same way.`
- `grep -c "retire step 1 (matrix deactivate)" substrate/scripts/agent-supervisor.sh` = 8 (≥2 required).
- `grep -c "retire step 2 (graceful exit)" substrate/scripts/agent-supervisor.sh` = 6 (≥2 required).
- `grep -c "retire step 4a" substrate/scripts/agent-supervisor.sh` = 1 (≥1 required).
- `grep -c "retire step" substrate/scripts/agent-supervisor.sh` = 24 (verification wants ≥8).
- `grep -c "scan_archive_requested_sentinels" substrate/scripts/agent-supervisor.sh` = 4 (definition + reconcile call + retire_identity docstring reference + section header comment; ≥2 required).
- `grep -c "retire-fail-count-user-" substrate/scripts/agent-supervisor.sh` = 4 (≥3 required: get + reset + increment).
- `grep -cF "force:bool" substrate/scripts/agent-supervisor.sh` = 0 (guard bypass is caller-side).
- Daily-path guards preserved: `.pinned`, `.no-dormancy`, `is_coordinator` all still present in `run_archive_scan()`.
- Credentials never in log lines: `grep -v '^[[:space:]]*#' substrate/scripts/agent-supervisor.sh | grep -E 'log .*\$password|log .*\$access_token'` returns empty (T-115-04-03 mitigation).

## Test Harness

`bash substrate/scripts/tests/agent-supervisor-archive-scan.sh` — **31 pass, 0 fail** (up from 28 pre-plan; three test bodies rewritten in-place to reflect the reordered failure surfaces, no test count change to the harness itself — the +3 is because the driver's PASS+=1 hit run three extra times).

Test coverage adjustments (in-place, no tests deleted):

- `test_pitfall4_no_iddir_relay_json_in_step3` — assertion inverted. Was: `$iddir/relay.json` must NOT appear in non-comment code (old Pitfall 4: step 3 reads from archdir). Now: `$iddir/relay.json` MUST appear (new step 1 reads from live tree) AND `$archdir/relay.json` MUST appear (State 2 retry-from-partial fallback). Both `assert_gte "1"` — preserves the ORIGINAL intent (make sure the step reads from the right tree) while flipping which tree is right.
- `test_retire_5xx_aborts_with_1` — asserts archdir MUST NOT exist AND live folder MUST still be present (was: archdir MUST exist). Rationale: step 1 (matrix, was step 3) aborts BEFORE step 4b (folder move, was step 1). Sentinel-in-place → next-tick retry per D-15.
- `test_retire_collision_aborts` — extended with `fixture_relay_json` + `start_stub_homeserver 200` so matrix step 1 succeeds and step 4b actually runs (only then can it detect the collision State 3). Assertion unchanged.

User-initiated tests (sentinel-scan branch + user counter + user-initiated retire-stuck) are OUT OF SCOPE for this plan — 115-07 owns them.

## Decisions Made

See `key-decisions` in frontmatter for the six load-bearing choices. Highlights:

- **D-14 verbatim reuse over tuned wait for retire's graceful-exit step**: kept recycle()'s 3.5s bounded wait even though RESEARCH §4 flagged it may be short for mid-turn long responses. Deferred as a v2 knob per CONTEXT.md deferred ideas.
- **GRACE_WAIT as fixed sleep, not pid-poll**: RESEARCH §4 Open Question 2 explicitly called ambient-monitor pid polling a nicer implementation but chose "reuse recycle's window in v1"; kept that.
- **Caller-side guard bypass over `force` param**: retire_identity's signature stays 1-argument. The 4 guards were already caller-side in the daily path; the new sentinel-scan branch is a sibling caller that simply doesn't invoke them.
- **Sibling counter over shared**: retire-fail-count-user-<name> is independent of retire-fail-count-<name>. A passing daily sweep does NOT reset a user-initiated stuck counter (RESEARCH §3 option b).

## Deviations from Plan

None - plan executed exactly as written, with two minor addenda both anticipated by the plan's own guidance:

1. **Test-harness updates in same commit as retire_identity()**. The plan's guidance said: "After reordering the steps, run the existing test harness [...] If any existing test breaks, adjust the tests to reflect the new step order — do NOT revert the reorder". Three tests broke as predicted (Pitfall-4, 5xx, collision) and were fixed in-place in Task 1's commit. Not a deviation — the plan explicitly authorized this path.
2. **shellcheck-disable directive added to the recycle-copy site** (line 496) to keep the pre-plan shellcheck baseline at 10 findings. The directive references D-14 and explains why pgrep is not a substitute (pgrep does not accept `-t` tty filter the same way). Not a deviation — clean baseline is a done-criterion.

**Total deviations:** 0
**Impact on plan:** None.

## Issues Encountered

- Pre-existing "tina: unbound variable" bash-nounset error in `match_session()` when `SESSIONS_SNAPSHOT` is empty (test-harness context). Verified this exists at HEAD pre-plan baseline via `git stash` — not introduced by this plan. Out of scope for 115-04; flagged for future attention.

## User Setup Required

None - fleet-substrate distributor propagates this change to every managed host on its next sweep after the commits hit origin. **⚠️ Reminder to the operator: do NOT hand-edit installed copies at `~/.local/bin/agent-supervisor` on any host — that masks distribution bugs (fleet rule 2026-09-10). Wait for the distributor sweep after push.**

## Next Phase Readiness

- **115-07 (test coverage)** can now write end-to-end tests for the user-initiated sentinel-scan path: fixture that drops `.archive-requested`, one reconcile tick, verify retire_identity() ran and sentinel is gone. The bypass-guards case (pinned + user-initiated) can also be tested by placing `.pinned` + `.archive-requested` on the same identity and asserting retire fires.
- **115-05 (fleet-status sweep — archive tree enumeration)** and **115-06 (frontend surface — rename Hide→Archive)** are independent of this plan's changes and can proceed in parallel.

## Threat Flags

No new surface introduced beyond what the plan's `<threat_model>` already covered. All 7 threats (T-115-04-01 through -SC) were considered:

- **T-115-04-03 (Info Disclosure — password in log)**: verified — no `$password` or `$access_token` interpolation in any log line (grep-checked in Static Analysis section above).
- **T-115-04-04 (DoS — retry loop hammering broken homeserver)**: mitigation in place — 3-fail retire-stuck sentinel breaks the loop after ~45s wall time.
- **T-115-04-05 (EoP — wrong SIGTERM)**: mitigation in place — step 2's SIGTERM-survivor loop uses the same `match_session` case-insensitive lookup as recycle().
- **T-115-04-06 (DoS — concurrent daily + user-initiated retire)**: idempotent by construction — matrix 401 handled, tmux kill no-op, folder-move State 2 handled.
- **T-115-04-SC (Fleet distribution)**: reminder to the operator in User Setup Required.

## Self-Check: PASSED

**Created files:** None (SUMMARY.md itself will be verified below after write).
**Modified files:**
- `substrate/scripts/agent-supervisor.sh` — FOUND (verified via `wc -l` = 2128 lines; retire_identity at L389-573; scan_archive_requested_sentinels at L699).
- `substrate/scripts/tests/agent-supervisor-archive-scan.sh` — FOUND (verified via `bash substrate/scripts/tests/agent-supervisor-archive-scan.sh` all pass).

**Commits:**
- `087247bb` — FOUND (Task 1: feat(115-04): reorder retire_identity() steps ...)
- `6b1039c3` — FOUND (Task 2: feat(115-04): add scan_archive_requested_sentinels() ...)

---
*Phase: 115-identity-archiving-from-the-frontend*
*Completed: 2026-09-17*
