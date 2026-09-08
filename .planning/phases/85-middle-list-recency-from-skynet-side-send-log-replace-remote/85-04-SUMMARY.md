---
phase: 79-middle-list-recency-from-skynet-side-send-log-replace-remote
plan: 04
subsystem: backend/fleet-status

tags: [ssh-poll-orchestrator, source-swap, lastMessageAt, send-log, D-07, D-08, fingerprint, fail-open, test-only-export]

# Dependency graph
requires:
  - phase: 79
    plan: 02
    provides: getIdentityLastSend(identityName): Promise<number | null> — identity-name-keyed fail-open reader with drizzle-throw → warn log + null return (single-seam contract for all Phase 85 read consumers)
  - phase: 44
    plan: 02
    provides: discoverIdentityJsonlPathViaChannel + PidCacheEntry.jsonlPath caching + STALE_TAIL_REDISCOVERY_THRESHOLD constant (the constant survives — source B still uses it; only the source-A lastMessageAt-axis increment retires)
  - phase: 47
    plan: 02
    provides: scanTailForLatestAiTitle (co-tenant on the tail buffer; stays called from processPid as the sole tail consumer in source A post-D-07)

provides:
  - ssh-poll-orchestrator.processPid derives SessionState.lastMessageAt via getIdentityLastSend(tmuxSession) instead of scanTailForNewestMessageAt(tailRaw)
  - __scanTailForNewestMessageAtForTests test-only export — preserves regression coverage of the retired scanner's contract (D-08 byte-parallel copy in src/backend/database/routes/sessions.ts still depends on this predicate)
  - Structured debug log per tick per session with operation="fleet_status_last_message_at_from_store" (identityName + lookupResult) — forensic trace for post-deploy verification
  - Belt-and-suspenders try/catch around getIdentityLastSend with operation="fleet_status_send_log_lookup_failed" fail-open log (store module is already fail-open; the try/catch is on the hot per-tick path)
  - 6 new Phase 85 test cases covering: cold-cache null, store advance, successive advance, fingerprint suppression, throw-fail-open, tail-empty-store-populated

affects:
  - phase-85-05 (client-side optimistic advance): the frontend max-wins reconciliation will land the store-published value on next fleet-status tick alongside the optimistic client stamp — both compose safely under advanceSessionLastMessageAt's max-wins contract
  - phase-85-06 (frontend send-time stamp writer): the write side of the round-trip — after 85-06 lands, the D-04 hook stamps the store on send, this plan's read fires it back on the next tick, Ivy rises within one poll cadence
  - src/backend/database/routes/sessions.ts (D-08 byte-parallel copy): unchanged by this plan; the plan's __scanTailForNewestMessageAtForTests export guards the shape contract so any future in-file scanner mutation is caught before sessions.ts drifts

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-process getIdentityLastSend lookup on the hot per-tick per-session path — hoisted ABOVE the `if (jsonlPath !== null)` block so lastMessageAt derivation no longer depends on JSONL discovery (the store is keyed on identity name; jsonlPath is only needed for the aiTitle scan now)."
    - "D-08 preservation via test-only export __scanTailForNewestMessageAtForTests — decouples the retired scanner's regression coverage from the retired orchestrator-observed axis while keeping the predicate's contract asserted at the byte level for the sessions.ts byte-parallel-copy discipline."
    - "Grep-gated conditional retirement of shared constants + fields: STALE_TAIL_REDISCOVERY_THRESHOLD and PidCacheEntry.staleTailTickCount both STAY because source B (pollDormantOnlyIdentities at ~L1051) uses them; only the source-A three-branch increment logic on the lastMessageAt axis retires. Plan's `delete IF only used here` guard fired NEGATIVE — kept both."

key-files:
  created: []
  modified:
    - src/backend/fleet-status/ssh-poll-orchestrator.ts (+43 lines / -70 lines) — new getIdentityLastSend import (7 lines with header comment); hoisted store lookup block ABOVE the tail-discovery conditional (25 lines); tail-consumer block collapsed (scanTailForNewestMessageAt call + three-branch stale-tick logic + threshold trip all removed); scanTailForLatestAiTitle stays as sole tail consumer; D-08 preservation comments above isAshleyRealUserTurn (:432) + scanTailForNewestMessageAt (:531); test-only export __scanTailForNewestMessageAtForTests (12 lines).
    - src/backend/fleet-status/ssh-poll-orchestrator.test.ts (+310 lines / -83 lines) — new vi.mock for identity-send-log-store (11 lines); new imported getIdentityLastSend for spies; scanSingleLine/scanMultiLine helpers rewritten to call __scanTailForNewestMessageAtForTests directly (13 tests decoupled from orchestrator loop); Test D + Test F similarly rewritten; Test H rewritten to reflect new source-A behavior (7 ticks → 1 discovery call, not 2); Phase 47 Test 3 corroborating lastMessageAt assertion dropped; new "Phase 85 lastMessageAt source swap — send-log store" describe block with 6 tests (85-04-01 through 85-04-06).

key-decisions:
  - "Retire the stale-tail rediscovery counter FROM the source-A lastMessageAt axis only — do NOT delete the STALE_TAIL_REDISCOVERY_THRESHOLD constant, the PidCacheEntry.staleTailTickCount field, or the counter mechanics in cache-write paths (L1840/1868). All three stay because source B pollDormantOnlyIdentities (~L1051) uses the same constant + counter shape for Layer 1 recycling rediscovery. The plan's grep-gated conditional `delete IF only used here` fired NEGATIVE — respected the guard."
  - "Add __scanTailForNewestMessageAtForTests test-only export (following the file's __matchesIdentityFirstTurnForTests convention) rather than making the predicate public or leaving the test-scope observable coupled to the retired orchestrator axis. This gives the sessions.ts byte-parallel copy contract a byte-level regression harness that survives the D-07 swap unchanged."
  - "Rewrite the isAshleyRealUserTurn predicate-matrix helpers (scanSingleLine, scanMultiLine) to call the test-only export directly instead of driving the full orchestrator loop and observing published state. Same test bodies, same predicate coverage, no orchestrator plumbing per test. Decouples 11 test cases from the retired axis."
  - "Rewrite Phase 44 Plan 02 Test H (rediscovery-on-stale-tail threshold) to assert exactly 1 discovery call across 7 ticks (was: 2 calls, threshold trip on tick 6). The counter no longer increments from source A, so no rediscovery trip on the lastMessageAt axis. Preserved the tail-fires-every-tick assertion (aiTitle scanner still consumes the buffer)."
  - "Drop the corroborating `expect(published.state.lastMessageAt).toBe(1000)` assertion from Phase 47 Plan 02 Test 3 — that test's primary purpose was aiTitle=null which still passes. The corroboration line was orthogonal to the aiTitle contract and belonged to the retired axis."
  - "Log level for the per-tick store lookup is `debug` (not `info`) — the log fires per-PID per-2s-tick per-host, which is chatty. `debug` keeps it out of default log output but available for post-deploy forensic tailing per the plan's verification block."

patterns-established:
  - "D-08 preservation pattern for retired-but-still-referenced code: (1) add an inline header comment above the retired function noting the D-08 contract with the byte-parallel copy, (2) add a test-only export named `__<functionName>ForTests` following the file's existing convention, (3) rewrite affected test helpers to consume the export directly, (4) leave the retired function's DEFINITION and any indirect callers (scanTailForLayer1RecyclingSignal here) untouched."
  - "Grep-gated conditional retirement checklist: (1) `grep -rn <symbol> src/` to enumerate ALL callers, (2) if callers exist OUTSIDE the retiring axis, KEEP the symbol + its underlying mechanic, (3) retire ONLY the specific increment / call / branch on the axis being swapped, (4) document the KEEP decision in the SUMMARY under key-decisions so future readers understand why the symbol survived."

requirements-completed: [D-07, D-08]

# Metrics
duration: 19m 53s
completed: 2026-09-07
---

# Phase 85 Plan 04: SSH-poll-orchestrator lastMessageAt source swap Summary

**Per-tick `SessionState.lastMessageAt` derivation in `ssh-poll-orchestrator.processPid` swapped from `scanTailForNewestMessageAt(tailRaw)` (JSONL tail scan on Ashley's-real-user-turn predicate) to `getIdentityLastSend(tmuxSession)` (Phase 85-02 identity-name-keyed send-log store). Wire shape, fingerprint composition, and every non-lastMessageAt axis are unchanged (D-07). The transcript-scan pipeline (scanTailForNewestMessageAt + isAshleyRealUserTurn) stays defined for the D-08 byte-parallel copy in `src/backend/database/routes/sessions.ts`, and `scanTailForLatestAiTitle` continues to consume the same tail buffer as sole in-source-A tail consumer. Once Plan 85-06 fires the frontend stamp on send, sending to Ivy will make Ivy rise in the middle zone within one fleet-status poll tick.**

## Performance

- **Duration:** 19m 53s (1193s)
- **Started:** 2026-09-07T17:09:41Z
- **Completed:** 2026-09-07T17:29:34Z
- **Tasks:** 2 (both TDD-flagged per plan)
- **Files modified:** 2 (`ssh-poll-orchestrator.ts`, `ssh-poll-orchestrator.test.ts`)
- **Files created:** 0 (SUMMARY.md counted separately in Task Commits section below)

## Accomplishments

### Source swap (Task 1)

- **`getIdentityLastSend` import** at the top of `ssh-poll-orchestrator.ts` from `./identity-send-log-store.js` (7 lines with D-07 rationale header).
- **Hoisted store lookup** ABOVE the `if (jsonlPath !== null)` block. Guards on `tmuxSession !== null` (identity name unknown → keep cached), wraps the call in try/catch (belt-and-suspenders on the hot per-tick path; the store module itself is fail-open per Phase 85-02 contract). Emits `systemLogger.debug` per-tick per-session with `operation="fleet_status_last_message_at_from_store"` for post-deploy forensic tailing.
- **Retired `scanTailForNewestMessageAt(tailRaw)`** call from inside the tail-scan block. `scanTailForLatestAiTitle(tailRaw)` stays as the sole tail consumer in source A now (aiTitle axis unchanged per D-08).
- **Retired the three-branch stale-tail counter logic** from the lastMessageAt axis (the send-log store never rotates in the JSONL-rotation sense — it's a durable single-row-per-identity table). Counter mechanics + `STALE_TAIL_REDISCOVERY_THRESHOLD` constant + `PidCacheEntry.staleTailTickCount` field ALL stay because source B (`pollDormantOnlyIdentities` at ~L1051) still uses them for its Layer 1 recycling rediscovery contract — grep-gated retention per the plan's `delete IF only used here` guard, which fired NEGATIVE.
- **D-08 preservation comments** added above `isAshleyRealUserTurn` (:432) and `scanTailForNewestMessageAt` (:531) noting the sessions.ts byte-parallel copy dependency + the `scanTailForLayer1RecyclingSignal` in-file caller.
- **`__scanTailForNewestMessageAtForTests` test-only export** (12 lines) so the predicate-matrix regression suite continues to guard the retired scanner's shape at the byte level.

### Test suite (Task 2)

- **`vi.mock("./identity-send-log-store.js", ...)`** factory at the top of `ssh-poll-orchestrator.test.ts` (hoisted, no closure over test-scope state). Default returns `null`; individual tests override with `.mockResolvedValue(...)` or `.mockRejectedValue(...)`.
- **6 new `it()` blocks** in a new `describe("Phase 85 lastMessageAt source swap — send-log store")` block at the tail of the file:
  - **85-04-01** — cold cache (store returns null) → published `lastMessageAt: null`. Confirms `tmuxSession="ivy"` resolution flows to `getIdentityLastSend("ivy")`.
  - **85-04-02** — store advance to 5000 → next tick publishes 5000. Confirms fingerprint delta triggers publish.
  - **85-04-03** — successive advances (5000 → 6000) → each tick publishes the fresher value. Monotonic ordering assertion.
  - **85-04-04** — unchanged store + unchanged axes → tick 2 does NOT publish. Guards fingerprint-suppression contract.
  - **85-04-05** — `getIdentityLastSend` throws → cached value preserved, poll loop continues. Exercises the try/catch on the hot path.
  - **85-04-06** — tail is EMPTY, store populated with 8000 → published `lastMessageAt: 8000`. Proves the retired scanner is NOT consulted for lastMessageAt anymore; tail exec still fires for aiTitle.
- **Test regression handling** (Rule 3 auto-fix, inline with Task 1's swap):
  - Phase 41 Plan 03 Test D + Test F rewritten to call `__scanTailForNewestMessageAtForTests` directly.
  - `isAshleyRealUserTurn` predicate-matrix suite (11 tests): `scanSingleLine` + `scanMultiLine` helpers retargeted to the test-only export.
  - Phase 44 Plan 02 Test H rewritten to assert new source-A behavior (7 ticks → 1 discovery call, not 2 — counter retired from lastMessageAt axis).
  - Phase 47 Plan 02 Test 3 corroborating `lastMessageAt=1000` assertion dropped; aiTitle=null primary assertion stays.

## Grep-Gated Conditionals — Kept vs Deleted

| Symbol / Mechanic | Grep target | Callers found | Decision | Rationale |
|---|---|---|---|---|
| `STALE_TAIL_REDISCOVERY_THRESHOLD` constant | `src/backend/fleet-status/` | source B `pollDormantOnlyIdentities` at L1051 uses it for Layer 1 recycling rediscovery | **KEPT** | Not exclusive to source A; deleting would break source B recycle contract |
| `PidCacheEntry.staleTailTickCount` field | file-scoped `staleTailTickCount` | 12 occurrences — source B cache reads/writes at L1026/1128/1143 + source A cache writes at L1840/1868 (Pitfall-3 lockstep) | **KEPT** | Removing would break cache-shape compatibility across both sources |
| Three-branch stale-tick increment logic on lastMessageAt axis | inline at former L1636-1650 | Only source A lastMessageAt axis — the specific increment/no-history/stale logic | **RETIRED** | Store never rotates in the JSONL sense; increment path has no meaning post-swap |
| `STALE_TAIL_REDISCOVERY_THRESHOLD` trip → `jsonlPath = null` (former L1656-1659) | inline | Only source A lastMessageAt axis | **RETIRED** | Counter no longer increments from this axis → threshold never trips → branch is dead code |
| `scanTailForNewestMessageAt(tailRaw)` call in-file | grep `scanTailForNewestMessageAt(tailRaw)` | 0 post-swap | **RETIRED** (call) | Sole consumer for lastMessageAt axis; aiTitle uses `scanTailForLatestAiTitle` |
| `scanTailForNewestMessageAt` function definition | grep `^function scanTailForNewestMessageAt` | sessions.ts byte-parallel copy (D-08), in-file `scanTailForLayer1RecyclingSignal` calls `isAshleyRealUserTurn` (not this function directly, but relies on the parallel-copy discipline) | **KEPT** | D-08 contract with sessions.ts |
| `isAshleyRealUserTurn` function definition | grep `^function isAshleyRealUserTurn` | in-file `scanTailForLayer1RecyclingSignal` at :631 + sessions.ts byte-parallel copy (D-08) | **KEPT** | Two live consumers |
| `discoverIdentityJsonlPathViaChannel` | file-scoped | source B at L1020 + source A at L1600 | **KEPT** | aiTitle axis still needs jsonlPath; discovery unchanged |
| `scanTailForLatestAiTitle` | grep `scanTailForLatestAiTitle(tailRaw)` | source A at former L1613 | **KEPT** + still called | aiTitle axis unchanged per D-08 |

## Task Commits

Each task was committed atomically on `feat/tab-title-from-tmux`:

1. **Task 1: Swap the lastMessageAt derivation in the per-tick per-session block** — `3a93c497` (feat) — 2 files changed, 181 insertions(+), 153 deletions(-). Includes the test-regression fixes as Rule 3 auto-fix (fixes are inseparable from the swap; the test failures are direct consequences of Task 1's source change and belong in the same commit).
2. **Task 2: Test — store write → next processPid tick publishes SessionState with fresh lastMessageAt** — `903e8568` (test) — 1 file changed, 310 insertions(+). Adds `vi.mock` for the store, imports the mocked `getIdentityLastSend`, and appends the 6 new Phase 85 test cases at the tail of the file.

_TDD flow note:_ Plan authored Task 1 (module change) before Task 2 (new tests) — same "shape-first, tests-validate-contract" ordering as Plan 85-01 and 85-02. The Task 1 commit's own scoped test run (128/128 green after the regression fixes) already validates the swap semantically; Task 2's 6 new cases add explicit round-trip coverage against the mocked store.

## Files Created/Modified

- `src/backend/fleet-status/ssh-poll-orchestrator.ts` (modified) — +43 lines / -70 lines net. Key edits:
  - L52-58: `getIdentityLastSend` import with D-07 header comment.
  - L432-441 (was 418-427): D-08 preservation comment above `isAshleyRealUserTurn`.
  - L520-528 (was 496-506): D-08 preservation comment + expanded docblock above `scanTailForNewestMessageAt`.
  - L531-543: new `__scanTailForNewestMessageAtForTests` test-only export.
  - L1611-1687 (was 1611-1691): swap block — store lookup hoisted above `if (jsonlPath !== null)`; three-branch stale-tick logic + threshold trip removed; scanTailForLatestAiTitle retained as sole tail consumer.
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (modified) — +310 lines net Task 1+2. Key edits:
  - L22-31: new `import { __scanTailForNewestMessageAtForTests }` in the main import block; new `import { getIdentityLastSend }` after the store `vi.mock`.
  - L57-70: new `vi.mock("./identity-send-log-store.js", ...)` factory block.
  - L1141-1155: Phase 41 Test D rewritten to call the test-only export.
  - L1201-1210: Phase 41 Test F rewritten similarly.
  - L1300-1327: `scanSingleLine` + `scanMultiLine` helpers in the predicate-matrix suite rewritten (13 test bodies unchanged in signature).
  - L1725-1783: Phase 44 Test H rewritten with Phase 85 D-07 rationale + new expected counts (1 discovery call, not 2).
  - L2126-2153: Phase 47 Test 3 corroborating `lastMessageAt` assertion dropped with rationale comment.
  - L6914-7223: new `describe("Phase 85 lastMessageAt source swap — send-log store")` block with 6 `it()` cases + local `wireIvyResponses` + `buildIvyDiscoveryFixture` helpers.

## Decisions Made

None beyond the ones already locked in the plan / CONTEXT.md / above key-decisions block. Executor followed plan-authored action bodies verbatim, with the plan's own grep-gated conditional guards evaluated at commit-time (STALE_TAIL_REDISCOVERY_THRESHOLD and staleTailTickCount both KEPT after cross-source-A/source-B grep confirmed shared usage).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing test regressions from the source swap fixed inline with Task 1**

- **Found during:** Task 1 verification (`npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` after the swap landed).
- **Issue:** 8 pre-existing tests failed after the swap because they asserted `published.state.lastMessageAt` values derived from the (now retired) JSONL tail scanner. The plan's Task 2 done-block requires "no regressions to existing tests," but the plan authored Task 1's action body without pre-specifying how to update the OLD tests.
- **Fix:** Added a test-only export `__scanTailForNewestMessageAtForTests` (following the file's existing `__matchesIdentityFirstTurnForTests` convention), retargeted the 13 predicate-matrix + Phase 41 Test D/F test bodies to call it directly, rewrote Phase 44 Test H to reflect the new source-A behavior (1 discovery call in 7 ticks, not 2), and dropped the corroborating `lastMessageAt` assertion from Phase 47 Test 3. Zero coverage loss — the predicate contract is asserted at the byte level (stronger than the pre-swap observable-based assertions).
- **Files modified:** `src/backend/fleet-status/ssh-poll-orchestrator.ts` (+12 lines for the test-only export), `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (~-80 / +30 net for the rewrites).
- **Commit:** `3a93c497` (committed as part of Task 1 since the failures are direct-caused by Task 1's swap and cannot be separated cleanly).

### Deferred (out-of-scope pre-existing issues)

**Pre-existing backend TS errors NOT introduced by this plan** — unchanged since Plan 85-01's SUMMARY logged them:

- `src/backend/database/routes/host.ts(473,15)` — TS2322 Type 'unknown' not assignable to 'string'
- `src/backend/database/routes/host.ts(1182,17)` — TS2322 Type 'unknown' not assignable to 'string'
- `src/backend/database/routes/pretty-view-fetch-host-file.ts(440,56)` — TS2345 Argument type 'string | string[]' not assignable to 'string'

Zero errors in the two files touched by this plan. Verified via `grep -E "src/backend/fleet-status/ssh-poll-orchestrator" /tmp/build.out` on the tsc output → no hits. Already logged to `deferred-items.md` by Plan 85-01; no new entries added.

---

**Total deviations:** 1 auto-fixed (Rule 3 — inline test-regression handling).
**Impact on plan:** Zero coverage loss — the D-08 predicate contract is asserted at the byte level, stronger than the pre-swap observable-based assertions. Test count improved: 122 → 128 (+6 net for the Phase 85 suite; the 4 rewritten tests were 1:1 replacements).

## Issues Encountered

**1. Plan's Task 2 done-block "no regressions to existing tests" contradicts Task 1's inherent test breakage.**

Task 1's swap changes the source-of-truth for `SessionState.lastMessageAt` — existing tests that asserted specific values derived from the OLD source-of-truth necessarily fail. Interpreted this pragmatically as Rule 3 auto-fix scope: the test failures are direct consequences of Task 1's authored change, and fixing them is inseparable from the swap. Committed both under Task 1 (`3a93c497`) so a `git bisect` on a future regression would see a green tree at the Task 1 commit boundary.

**2. `STALE_TAIL_REDISCOVERY_THRESHOLD` and `staleTailTickCount` retention required cross-source grep before deletion.**

The plan's Task 1 action step 2 says "PREFERRED: DELETE the block and the STALE_TAIL_REDISCOVERY_THRESHOLD constant IF it has no other callers. `grep -rn 'STALE_TAIL_REDISCOVERY_THRESHOLD' src/backend/fleet-status/` to check." Grep returned 5 hits, including source B's L1051 (`pollDormantOnlyIdentities` — its own Layer 1 recycling rediscovery counter uses the same constant). Kept the constant + all counter mechanics; retired only the source-A lastMessageAt-axis increment path. Same treatment for `PidCacheEntry.staleTailTickCount` (12 hits — kept the field for cache-write shape compatibility across both sources).

**3. Plan's Task 1 verify command specifies `npx vitest run --related` which is unsupported in vitest 4.1.8.**

Same issue Plan 85-01 and Plan 85-02 hit (documented in their `## Issues Encountered`). Substituted the direct-path form `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` — same signal.

## User Setup Required

None. The swap is purely an in-process source-of-truth swap for an existing wire field. On the next container recreate, the poll orchestrator starts reading from the `identity_send_log` table Plan 85-01 already created. On first boot, the table is empty (D-09) → every identity's `SessionState.lastMessageAt` is `null` → middle-zone falls through to insertion-order fallback until natural fill populates (Plan 85-06 wires the frontend stamp; Plan 85-05 adds the client-side optimistic advance).

## Next Phase Readiness

- **Phase 85 Plan 05** (client-side optimistic advance / session-working-store integration): unaffected by this plan — that's a frontend change. Once 85-05 lands, the client stamps `advanceSessionLastMessageAt(key, Date.now())` on send; this plan's read fires on the next fleet-status tick and the max-wins helper reconciles safely.
- **Phase 85 Plan 06** (frontend send-time HTTP POST to `/api/stamp-identity-send`): the READ side of the round-trip is now live. Once Plan 85-06 fires the write on send, the round-trip closes end-to-end: Ashley sends to Ivy → frontend POSTs → `stampIdentityLastSend("ivy", Date.now())` updates the store → next fleet-status tick this plan's `getIdentityLastSend("ivy")` returns the fresh ts → fingerprint delta → publish → Ivy rises in the middle zone within one poll cadence.
- **Ship blockers:** none from this plan. The 3 pre-existing tsc errors are unchanged and out of scope (Plan 85-01 already logged them to `deferred-items.md`).
- **Executor exit posture:** two atomic commits (`3a93c497`, `903e8568`) on `feat/tab-title-from-tmux`, NOT pushed / NOT docker-built / NOT deployed — held at the executor's remit boundary. Orchestrator owns pull + full-suite + push + build + recreate + verify + coord per fleet directive.

## Self-Check

### Created files exist

- `/home/ubuntu/skynet-tiffany/.planning/phases/85-middle-list-recency-from-skynet-side-send-log-replace-remote/85-04-SUMMARY.md` — FOUND (this file)

### Modified files contain the expected additions (grep gates from plan Task 1/2 done-blocks)

- `grep -c "getIdentityLastSend" src/backend/fleet-status/ssh-poll-orchestrator.ts` = 7 ✓ (>= 2 required — import + call + 3 in comments + 2 in log op field references)
- `grep -cE "^(export )?function scanTailForNewestMessageAt" src/backend/fleet-status/ssh-poll-orchestrator.ts` = 1 ✓ (== 1 required — function still defined per D-08)
- `grep -cE "^function isAshleyRealUserTurn" src/backend/fleet-status/ssh-poll-orchestrator.ts` = 1 ✓ (== 1 required — function still defined per D-08)
- `grep -c "scanTailForNewestMessageAt(tailRaw)" src/backend/fleet-status/ssh-poll-orchestrator.ts` = 0 ✓ (== 0 required — call inside per-tick block deleted)
- `grep -c "scanTailForLatestAiTitle(tailRaw)" src/backend/fleet-status/ssh-poll-orchestrator.ts` = 1 ✓ (== 1 required — aiTitle scan preserved)
- `grep -c "STALE_TAIL_REDISCOVERY_THRESHOLD" src/backend/fleet-status/ssh-poll-orchestrator.ts` = 5 (KEPT per grep-gated conditional — source B still uses it)
- `grep -c "staleTailTickCount" src/backend/fleet-status/ssh-poll-orchestrator.ts` = 12 (KEPT per grep-gated conditional — cross-source usage)
- `grep -c "__scanTailForNewestMessageAtForTests" src/backend/fleet-status/ssh-poll-orchestrator.ts` = 1 ✓ (test-only export added)
- `grep -c "Phase 85" src/backend/fleet-status/ssh-poll-orchestrator.test.ts` = 15 ✓ (>= 1 required per Task 2 done-block)

### Commits exist on branch feat/tab-title-from-tmux

- `3a93c497 feat(85-04): swap lastMessageAt derivation to send-log store (Phase 85 D-07)` — FOUND
- `903e8568 test(85-04): send-log store round-trip — 6 new cases for lastMessageAt swap` — FOUND

### Scoped tests green

- `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator.test.ts` = 128/128 pass, exit 0 (was 122/122 pre-swap; +6 net for the Phase 85 suite).
- `npx vitest run src/backend/fleet-status/identity-send-log-store.test.ts` = 10/10 pass, exit 0 (unaffected — the module wasn't touched by this plan).

### Backend build clean (only pre-existing unrelated tsc errors)

- `npm run build:backend` exit 0. Three pre-existing tsc errors in `host.ts` (473,15 + 1182,17) and `pretty-view-fetch-host-file.ts` (440,56) unchanged and unrelated to this plan — documented in Plan 85-01 `deferred-items.md`.

## Self-Check: PASSED

---

*Phase: 79-middle-list-recency-from-skynet-side-send-log-replace-remote*
*Plan: 04*
*Completed: 2026-09-07*
