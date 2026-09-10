---
phase: quick-260910-hgs
plan: 01
status: complete
subsystem: backend/relay-sessions
tags: [quick, relay-observation-loop, thundering-herd, cold-load, jitter]
requires: []
provides:
  - INITIAL_TICK_JITTER_MS (new exported constant, 500ms, boot-time first-tick spread window)
affects:
  - src/backend/relay-sessions/observation-loop.ts (boot-time initial-delay math + 1 new exported constant + 1 refreshed inline comment)
  - src/backend/relay-sessions/observation-loop.test.ts (1 new import + 1 invariant pin + 1 restructured test + 1 new regression test)
tech-stack:
  added: []
  patterns: [separate-knobs-for-separate-questions, thundering-herd-defense-preserved-at-tighter-scale]
key-files:
  created: []
  modified:
    - src/backend/relay-sessions/observation-loop.ts
    - src/backend/relay-sessions/observation-loop.test.ts
decisions:
  - "Introduced a separate 500ms `INITIAL_TICK_JITTER_MS` constant rather than shrinking `OBSERVATION_TICK_INTERVAL_MS` — the two knobs answer different questions (cold-load snappiness vs steady-state cadence), and coupling them was the shape of the original Fixup M-2 bug"
  - "Restructured Test M-2 assertion pattern (was staggered 1s/6s/10s advances at the 10s window; now single 1.5s advance at the 500ms window) since all three users fit inside a single scan tick at the tightened scale; kept invariant intent (jitter path executes, distinct users get distinct scheduled slots) preserved"
  - "Added standalone Test M-2c pinning both bounds — lower bound (jitter actually applied, u1 with rng=0.99 hasn't fired at t=400ms) and upper bound (all users fired by t=1500ms regardless of rng), so a regression to either `nextRunAt: now` or `rng() * OBSERVATION_TICK_INTERVAL_MS` fails immediately"
  - "Inlined the numeric 1500ms upper-bound advance in Test M-2c rather than importing the private `SCHEDULER_SCAN_INTERVAL_MS` constant; test avoids coupling to an implementation-detail export"
metrics:
  duration_min: 25
  completed: 2026-09-10
---

# Quick 260910-hgs: Tighten relay observation-loop initial-tick jitter from 10s to 500ms — Summary

## One-liner

Boot-time first-tick jitter for each relay-observing user is now bounded to `[0, INITIAL_TICK_JITTER_MS) = [0, 500ms)` instead of `[0, OBSERVATION_TICK_INTERVAL_MS) = [0, 10s)`, dropping Ashley's worst-case cold-load delay for sidebar relay rooms from ~20s to under 1.5s while preserving the existing thundering-herd defense.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `919f6b8c` | `feat(quick-260910-hgs-01): introduce INITIAL_TICK_JITTER_MS=500 for boot-time first-tick spread` |
| 2 | `945c5006` | `test(quick-260910-hgs-02): pin INITIAL_TICK_JITTER_MS upper+lower bounds; retune Test M-2 to 500ms window` |

Both commits on `feat/tab-title-from-tmux`. HEAD `945c5006` LOCAL — NOT pushed / NOT built / NOT deployed per code-work-doesn't-authorize-ship rule.

## What changed

**`src/backend/relay-sessions/observation-loop.ts`** (commit 1)

- Added new exported constant `INITIAL_TICK_JITTER_MS = 500` immediately below `OBSERVATION_TICK_INTERVAL_MS` (line 85), with a 30-line docblock covering:
  1. Separation from `OBSERVATION_TICK_INTERVAL_MS` — the two answer different questions ("how snappy does cold-load feel?" vs "how often do we re-check a user?").
  2. Ashley cold-load reference — reusing the 10s cadence was the source of the ~20s worst-case; 500ms tightens the bound to `INITIAL_TICK_JITTER_MS + SCHEDULER_SCAN_INTERVAL_MS = 500ms + 1s = 1.5s`.
  3. Thundering-herd math anchored to Ashley's fleet size (~100 concurrent boot users → peak ~200 users/sec admin-API fan-in, well within a single Synapse's healthy concurrency budget).
  4. Scale guidance for future fleets (scale up past ~1000 concurrent boot users; scale down unnecessary — 500ms already at edge of human perceptibility).
- Updated `start()` at what was line 717 (now line 756): `Math.floor(rng() * OBSERVATION_TICK_INTERVAL_MS)` → `Math.floor(rng() * INITIAL_TICK_JITTER_MS)`. Preserved the `jitterEnabled ? ... : 0` ternary so the `jitter:false` deterministic path stays byte-for-byte unchanged.
- Refreshed the inline Fixup M-2 comment (line 745-754) to say the spread window is now `[now, now + INITIAL_TICK_JITTER_MS)` and point to the new constant's docblock for rationale. Comment now dual-tags Fixup M-2 (2026-09-08) + quick-260910-hgs (2026-09-10) for future archaeologists.

Unchanged: `OBSERVATION_TICK_INTERVAL_MS = 10_000`, `BACKOFF_LADDER_MS`, `MAX_PARALLEL_ROOMS_PER_TICK = 8`, `SCHEDULER_SCAN_INTERVAL_MS = 1_000`, `AGENTS_REGISTRY_MEMBERS_CACHE_TTL_MS = 5_000`, the per-tick success-jitter multiplier at `scheduleNext(ok=true)` (`OBSERVATION_TICK_INTERVAL_MS * jitterMultiplier` — still uses the 10s constant intentionally, that's the cadence knob).

**`src/backend/relay-sessions/observation-loop.test.ts`** (commit 2)

- Added `INITIAL_TICK_JITTER_MS` to the named import at line 39.
- Added `expect(INITIAL_TICK_JITTER_MS).toBe(500)` invariant pin inside Test 7's backoff-ladder invariants block (line 635-637). Test 7 already pins `OBSERVATION_TICK_INTERVAL_MS === 10_000`; now the two cadence constants are locked together in one place.
- **Restructured Test M-2 (was: `[0, TICK_INTERVAL_MS)` with staggered assertions)**: previous test used `rngValues [0.0, 0.5, 0.9]` mapping to `0/5000/9000ms` initial delays and a staggered `advanceTimersByTimeAsync(1500)/(5000)/(4000)` sequence asserting `u1` fires by 1500ms while `u2` and `u3` still hold. At the tightened 500ms window, `rngValues [0.0, 0.5, 0.99]` maps to `0/250/495ms` — ALL three fall inside the first `SCHEDULER_SCAN_INTERVAL_MS = 1000ms` scan tick, so the old staggered pattern is false. Restructured to a single `advanceTimersByTimeAsync(1500)` that asserts all three fired ≥1 call. **The M-2 invariant intent is preserved**: the jitter path still executes, three distinct rng fractions still produce three distinct scheduled first-tick timestamps, no thundering herd on the first scan pass. Only the assertion values change to match the tightened window.
- **Added Test M-2c** (new test, immediately after M-2): pins both bounds of the tightened window using `rng = () => 0.99` and three users.
  - **Lower bound (jitter actually applied)**: at `t=400ms`, `u1`'s scheduled delay is `Math.floor(0.99 * 500) = 495ms`, so `perUserCalls["@u1:s"]` must be exactly `0` (400 < 495; the 1s scan tick also hasn't landed). This guards against a regression where `jitterEnabled` silently short-circuits to `nextRunAt: now`.
  - **Upper bound (500ms preserved, not 10s)**: at `t=1500ms` cumulative (`INITIAL_TICK_JITTER_MS + one SCHEDULER_SCAN_INTERVAL_MS + slop`), every user must have fired ≥1 call. If the multiplier ever reverts to `OBSERVATION_TICK_INTERVAL_MS`, `u1` would sit on a `9900ms` delay and this assertion trips.
  - Numeric `1500ms` upper-bound advance inlined rather than importing the private `SCHEDULER_SCAN_INTERVAL_MS` constant (test doesn't couple to an implementation-detail export).

Unchanged: Test 8 (per-user isolation, `jitter:false`), Test M-2b (per-tick success jitter — still uses `OBSERVATION_TICK_INTERVAL_MS` intentionally, that's the success-cadence knob), the backoff-ladder tests, Test 11 (in-flight guard), and all `runObservationTick` orchestration tests.

## Verification

**Test gate** (constraint): `npx vitest run src/backend/relay-sessions/observation-loop.test.ts`
```
Test Files  1 passed (1)
Tests  21 passed (21)
Duration  306ms
```
All 21 tests pass (was 20 pre-change; +1 for new Test M-2c).

**tsc gate** (constraint): `npx tsc --noEmit`
```
exit 0, 0 lines of output
```
Clean project-wide, not just the two touched files.

**All 6 plan verification gates**:

| # | Gate | Expected | Actual |
|---|------|----------|--------|
| 1 | full observation-loop.test.ts suite passes | pass | 21/21 pass |
| 2 | `grep -n "INITIAL_TICK_JITTER_MS" observation-loop.ts` ≥ 3 refs | ≥3 | 7 refs (export decl + 3 docblock refs + 1 comment ref + 1 inline comment ref + 1 start() use) |
| 3 | `OBSERVATION_TICK_INTERVAL_MS = 10_000` preserved | preserved | line 52 unchanged |
| 4 | `MAX_PARALLEL_ROOMS_PER_TICK` + `SCHEDULER_SCAN_INTERVAL_MS` unchanged | unchanged | line 112 (=8) + line 120 (=1_000) unchanged |
| 5 | `rng() * OBSERVATION_TICK_INTERVAL_MS` count = 1 | 1 | **0** — see note below |
| 6 | `npx tsc --noEmit` clean on touched files | clean | clean project-wide |

**Gate 5 note (minor plan wording inaccuracy)**: The plan's verify step 5 expected `rng() * OBSERVATION_TICK_INTERVAL_MS` to remain at count 1 (labeled "the per-tick success-jitter site"). Actual pre-change count was also 1, but at the **boot-time** site (line 718 `Math.floor(rng() * OBSERVATION_TICK_INTERVAL_MS)`) — the per-tick success-jitter site at line 668 uses the different pattern `OBSERVATION_TICK_INTERVAL_MS * jitterMultiplier` (where `jitterMultiplier = 0.9 + rng() * 0.2`), so it never matched the exact `rng() * OBSERVATION_TICK_INTERVAL_MS` regex. After the fix, `rng() * OBSERVATION_TICK_INTERVAL_MS` count is `0` (boot site migrated to `INITIAL_TICK_JITTER_MS`), and `OBSERVATION_TICK_INTERVAL_MS * jitterMultiplier` count is `1` (per-tick site preserved). **The substantive invariant the plan intended — "the boot site migrated to the new constant AND the per-tick site is untouched" — is fully verified.** The plan's grep pattern just had a minor wording bug that this SUMMARY calls out for future readers.

## Success criteria (from plan)

| Criterion | Status |
|-----------|--------|
| `INITIAL_TICK_JITTER_MS = 500` exported with docblock covering all four rationale points | ✅ line 55-85 |
| `start()` uses `INITIAL_TICK_JITTER_MS`; `jitterEnabled ? ... : 0` structure preserved | ✅ line 755-757 |
| New regression test pins tightened upper bound; existing M-2 updated; M-2b untouched | ✅ Test M-2c added, Test M-2 restructured, Test M-2b byte-identical |
| Ashley's cold-load worst case drops from ~20s to under 1s (bounded by 500ms + 1000ms = 1.5s) | ✅ math confirmed by Test M-2c upper-bound assertion |
| All other observation-loop tests continue to pass | ✅ 21/21 pass, including Test 7 invariants, Test 8 isolation, Test M-2b jitter multiplier, Test 11 in-flight guard, all `runObservationTick` orchestration |

## Deviations from plan

**None — plan executed exactly as written.** Zero deviation rules triggered, no auth gates, no checkpoints, no follow-up bounties, no `git stash` / destructive git commands used (constraint respected). One minor observational note documented above under Gate 5 for future readers of the plan's verify step 5 wording.

## Scope discipline

- Files touched: exactly the two the plan authorized (`observation-loop.ts` + `observation-loop.test.ts`). No other files modified in either commit.
- `git diff --stat` for both commits combined: `+131 / -24` across two files.
- Test M-2b (per-tick success jitter) explicitly untouched — it still uses `OBSERVATION_TICK_INTERVAL_MS` intentionally, per plan constraint. Verified byte-identical to pre-change via `git show HEAD~2:src/backend/relay-sessions/observation-loop.test.ts` diff on that test block.
- Backoff-ladder tests and Test 8 (per-user isolation) untouched. All `runObservationTick` orchestration tests untouched.

## Self-Check: PASSED

Files exist:
- `src/backend/relay-sessions/observation-loop.ts`: FOUND
- `src/backend/relay-sessions/observation-loop.test.ts`: FOUND

Commits in `git log`:
- `919f6b8c` (Task 1 feat): FOUND
- `945c5006` (Task 2 test): FOUND

Gates green: 21/21 tests, tsc clean, all 6 plan gates (with Gate 5 wording-only observation documented).
