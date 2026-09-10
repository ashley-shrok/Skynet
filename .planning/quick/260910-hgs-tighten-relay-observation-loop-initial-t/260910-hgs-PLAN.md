---
phase: quick-260910-hgs
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/backend/relay-sessions/observation-loop.ts
  - src/backend/relay-sessions/observation-loop.test.ts
autonomous: true
requirements:
  - relay-room-sidebar-rendering-polish-sub-1
must_haves:
  truths:
    - "Boot-time first-tick delay for each relay-observing user is bounded to [0, 500ms) instead of [0, 10s)"
    - "Ashley's cold-load delay for sidebar relay rooms drops from ~20s worst case to <1s"
    - "Post-boot steady-state cadence still fires every OBSERVATION_TICK_INTERVAL_MS (10s) — scheduled cadence is unchanged"
    - "Existing thundering-herd defense still holds: 100 users fan across a 500ms window (mean ~5 users/50ms bucket), not a single scan pass"
    - "jitterEnabled=false path still yields deterministic 0ms initial delay (existing tests keep passing)"
  artifacts:
    - path: "src/backend/relay-sessions/observation-loop.ts"
      provides: "Exported INITIAL_TICK_JITTER_MS = 500 constant; start() uses it for the boot-time initial-delay multiplier"
      contains: "INITIAL_TICK_JITTER_MS"
    - path: "src/backend/relay-sessions/observation-loop.test.ts"
      provides: "Regression test asserting first-tick nextRunAt is bounded by now + INITIAL_TICK_JITTER_MS; existing Test M-2 updated for the tighter window"
      contains: "INITIAL_TICK_JITTER_MS"
  key_links:
    - from: "src/backend/relay-sessions/observation-loop.ts::start()"
      to: "INITIAL_TICK_JITTER_MS"
      via: "Math.floor(rng() * INITIAL_TICK_JITTER_MS)"
      pattern: "rng\\(\\)\\s*\\*\\s*INITIAL_TICK_JITTER_MS"
    - from: "src/backend/relay-sessions/observation-loop.test.ts"
      to: "observation-loop.ts exports"
      via: "named import"
      pattern: "INITIAL_TICK_JITTER_MS"
---

<objective>
Tighten the relay observation-loop boot-time first-tick jitter from [0, OBSERVATION_TICK_INTERVAL_MS) = [0, 10s) to [0, INITIAL_TICK_JITTER_MS) = [0, 500ms). This fixes Ashley's observed ~20s cold-load delay for relay rooms in the sidebar (worst-case first-tick was up to 10s + 10s catch-up on a slow scan pass).

Purpose: Preserve the existing thundering-herd defense (users are still spread, not fired simultaneously) while shrinking the worst-case user-visible cold-load latency by 20x. For a fleet of ~100 concurrent boot users, 500ms yields ~200 users/second peak fan-in — well within a single Synapse admin-API's healthy concurrency budget — but keeps the cold-load feel snappy instead of "did the app hang?".

Output: One exported constant (`INITIAL_TICK_JITTER_MS = 500`) with a comment explaining why it is separate from `OBSERVATION_TICK_INTERVAL_MS` and the ~100-user thundering-herd math, a one-line `start()` change, and a regression test that pins the new upper bound.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/backend/relay-sessions/observation-loop.ts
@src/backend/relay-sessions/observation-loop.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Introduce INITIAL_TICK_JITTER_MS constant and use it in start()</name>
  <files>src/backend/relay-sessions/observation-loop.ts</files>
  <behavior>
    - With `jitterEnabled=true` and `rng()` returning 0.99, first-tick `nextRunAt` for each user must be `< now + 500` (strict upper bound comes from Math.floor of a value in [0, 500)).
    - With `jitterEnabled=false`, first-tick `nextRunAt === now` (unchanged from today).
    - Scheduled cadence is unchanged: `OBSERVATION_TICK_INTERVAL_MS` still equals `10_000` and drives the per-tick success-jitter multiplier used elsewhere in the file.
  </behavior>
  <action>
    In `src/backend/relay-sessions/observation-loop.ts` add a new exported constant `INITIAL_TICK_JITTER_MS = 500` immediately below the existing `OBSERVATION_TICK_INTERVAL_MS` declaration (around line 52-62). Attach a docblock explaining: (a) this bounds ONLY the boot-time first-tick spread, not the steady-state 10s cadence; (b) why it is separate from `OBSERVATION_TICK_INTERVAL_MS` — the two knobs answer different questions ("how snappy does cold-load feel?" vs "how often do we re-check a user?"); (c) thundering-herd math anchored to Ashley's fleet size: at ~100 concurrent boot users the 500ms window yields a peak of ~200 users/sec of admin-API fan-in, which is well within one Synapse's healthy concurrency budget while keeping cold-load latency imperceptible; (d) Ashley's ~20s cold-load bug reference so the next reader understands why we did not just reuse the 10s constant. Then update the `start()` body at lines 717-719: replace `Math.floor(rng() * OBSERVATION_TICK_INTERVAL_MS)` with `Math.floor(rng() * INITIAL_TICK_JITTER_MS)`. Preserve the surrounding `const initialDelayMs = jitterEnabled ? ... : 0;` ternary structure exactly so the `jitter: false` test path stays deterministic. Also refresh the inline Fixup M-2 comment above line 717 so it says the spread window is now `[now, now + INITIAL_TICK_JITTER_MS)` (not `TICK_INTERVAL_MS`), with a one-line pointer to the new constant's docblock for the rationale. Do NOT change `OBSERVATION_TICK_INTERVAL_MS`, `MAX_PARALLEL_ROOMS_PER_TICK`, `SCHEDULER_SCAN_INTERVAL_MS`, or the per-tick success-jitter multiplier logic. This delivers the sub-1s cold-load fix in the bounty item verbatim.
  </action>
  <verify>
    <automated>grep -n "INITIAL_TICK_JITTER_MS" src/backend/relay-sessions/observation-loop.ts | grep -v '^#' | wc -l | awk '{ if ($1 < 3) { print "FAIL: expected >=3 references (export decl, docblock, start() use); got " $1; exit 1 } else { print "OK: " $1 " references" } }' &amp;&amp; grep -n "INITIAL_TICK_JITTER_MS = 500" src/backend/relay-sessions/observation-loop.ts &amp;&amp; grep -n "OBSERVATION_TICK_INTERVAL_MS = 10_000" src/backend/relay-sessions/observation-loop.ts</automated>
  </verify>
  <done>
    - `INITIAL_TICK_JITTER_MS = 500` is exported from `observation-loop.ts` with a docblock covering the four rationale points above.
    - `start()` line 717-719 multiplies `rng()` by `INITIAL_TICK_JITTER_MS` instead of `OBSERVATION_TICK_INTERVAL_MS`; the `jitterEnabled ? ... : 0` structure is preserved.
    - `OBSERVATION_TICK_INTERVAL_MS`, `MAX_PARALLEL_ROOMS_PER_TICK`, and `SCHEDULER_SCAN_INTERVAL_MS` are unchanged.
    - `npx tsc --noEmit` passes for the file.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add regression test pinning [0, INITIAL_TICK_JITTER_MS) upper bound and update existing Test M-2</name>
  <files>src/backend/relay-sessions/observation-loop.test.ts</files>
  <behavior>
    - New test: with `jitter: true` and an rng that returns `0.99`, all users' first `getUserJoinedRooms` calls fire before fake time advances past `INITIAL_TICK_JITTER_MS` (500ms) — proves the fix.
    - Existing Test M-2 (`boot-time jitter spreads users across [0, TICK_INTERVAL_MS)`) must be updated so its rng values and its timing assertions match the new 500ms window instead of the old 10s window — otherwise the test regresses on the tightened bound.
    - The `jitter: false` deterministic paths (Test 8 and the "always fails" backoff tests) must continue to pass unchanged.
  </behavior>
  <action>
    In `src/backend/relay-sessions/observation-loop.test.ts`: (1) Add `INITIAL_TICK_JITTER_MS` to the named import from `./observation-loop.js` around line 35-43. (2) Add ONE new test after the existing Test M-2 block (near line 715): `it("Test M-2c [fixup]: boot-time jitter upper bound is INITIAL_TICK_JITTER_MS — with rng=0.99 all users fire before 500ms", async () =&gt; { ... })`. Use `vi.useFakeTimers()`, a `const rng = () =&gt; 0.99`, three users, and `getUserJoinedRooms` that records calls per mxid. `loop.start([...])`, then `await vi.advanceTimersByTimeAsync(INITIAL_TICK_JITTER_MS + SCHEDULER_SCAN_INTERVAL_MS)` (roughly — you can inline the numeric 1500ms so the test does not depend on importing the private scan constant; comment why). Assert all three users have `>= 1` call. Then add a stricter assertion using a second variant: with `rng = () =&gt; 0.99`, first user's initial delay is `Math.floor(0.99 * 500) = 495`, so at `vi.advanceTimersByTimeAsync(400)` the user has NOT fired yet (upper-bound proof — 400 &lt; 495, and the 1s scan cadence would not yet have picked it up either — use `expect(perUserCalls["@u1:s"] ?? 0).toBe(0)` after advancing 400ms). Also add a companion assertion inside `expect(INITIAL_TICK_JITTER_MS).toBe(500)` in the existing "invariants" test near line 630. (3) UPDATE the existing Test M-2 at line 669-715: change the rngValues array from `[0.0, 0.5, 0.9]` (which was 0/5000/9000ms in the old 10s window) to values proportional to the new 500ms window — `[0.0, 0.5, 0.9]` now maps to `[0, 250, 450]` ms initial delays, so ALL three users fall within the first `SCHEDULER_SCAN_INTERVAL_MS = 1000ms` scan tick. This means the old test's staggered `advanceTimersByTimeAsync(1500)` / `(5000)` / `(4000)` sequence and the interleaved `toBe(0)` assertions on later users are now false — they will ALL have fired by 1500ms. Restructure the test so it still proves user-level spread but at the tighter scale: assert distinct users have DIFFERENT `nextRunAt` values immediately after `loop.start()` (i.e., before advancing any timers, inspect via the same per-user-calls mechanism after `vi.advanceTimersByTimeAsync(1500)` — all three fire, but you can additionally assert that a fresh rng returning three distinct values produces three distinct scheduled first-tick timestamps). Simplest restructure: keep the three users, use rngValues `[0.0, 0.5, 0.99]`, `advanceTimersByTimeAsync(1500)`, assert all three have `>= 1` call (proves boot jitter still runs but is now snappy), and update the test name/comment to `"Test M-2 [fixup, tightened]: boot-time jitter spreads users across [0, INITIAL_TICK_JITTER_MS) — all users complete first tick within a single scan tick"`. Keep everything else in the file identical. Do NOT touch Test 8, the backoff-ladder tests, or Test M-2b (per-tick success jitter — that one still uses `OBSERVATION_TICK_INTERVAL_MS` intentionally).
  </action>
  <verify>
    <automated>npx vitest run src/backend/relay-sessions/observation-loop.test.ts 2>&amp;1 | tail -30</automated>
  </verify>
  <done>
    - Full `observation-loop.test.ts` suite passes (all pre-existing tests + the new Test M-2c upper-bound test + the invariant assertion `INITIAL_TICK_JITTER_MS === 500`).
    - The updated Test M-2 name references `INITIAL_TICK_JITTER_MS` and its rng values / advance sequence match the new 500ms window.
    - No changes to Test 8 or the backoff-ladder tests.
    - No changes to files outside `observation-loop.ts` and `observation-loop.test.ts`.
  </done>
</task>

</tasks>

<verification>
Overall phase checks:

1. `npx vitest run src/backend/relay-sessions/observation-loop.test.ts` — all tests pass (existing + new Test M-2c + updated Test M-2 + invariant assertion).
2. `grep -n "INITIAL_TICK_JITTER_MS" src/backend/relay-sessions/observation-loop.ts` returns at least three lines (export declaration, docblock reference, and the `start()` multiplication site).
3. `grep -n "OBSERVATION_TICK_INTERVAL_MS = 10_000" src/backend/relay-sessions/observation-loop.ts` still returns the original line — steady-state 10s cadence is untouched.
4. `grep -n "MAX_PARALLEL_ROOMS_PER_TICK\|SCHEDULER_SCAN_INTERVAL_MS" src/backend/relay-sessions/observation-loop.ts` — both constants unchanged.
5. `grep -c "rng() \* OBSERVATION_TICK_INTERVAL_MS" src/backend/relay-sessions/observation-loop.ts` — should return `1` (the per-tick success-jitter site, NOT the boot-time initial-delay site; the boot-time site now uses `INITIAL_TICK_JITTER_MS`).
6. `npx tsc --noEmit` clean for the two edited files.
</verification>

<success_criteria>
- `INITIAL_TICK_JITTER_MS = 500` is exported from `observation-loop.ts` with a docblock covering: separation from `OBSERVATION_TICK_INTERVAL_MS`, ~100-user thundering-herd math, and the Ashley cold-load fix reference.
- `start()` uses `INITIAL_TICK_JITTER_MS` for the boot-time initial delay; the `jitterEnabled ? ... : 0` structure is preserved.
- One new regression test (`Test M-2c`) pins the tightened upper bound; the existing `Test M-2` is updated to reflect the 500ms window and still passes; `Test M-2b` (per-tick success jitter) is untouched.
- Ashley's cold-load worst case for relay rooms in the sidebar drops from ~20s to under 1s (bounded by `INITIAL_TICK_JITTER_MS + SCHEDULER_SCAN_INTERVAL_MS` = 500ms + 1000ms).
- All other observation-loop tests continue to pass.
</success_criteria>

<output>
Create `.planning/quick/260910-hgs-tighten-relay-observation-loop-initial-t/260910-hgs-SUMMARY.md` when done.
</output>
