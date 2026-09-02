---
phase: 260902-3ll-self-limit-fleet-status-ssh-exec-concurr
plan: 01
subsystem: fleet-status / ssh-transport
bounty: b31a5c8e-7f2d-4c91-a4b6-8e9f1c3b7d24
parent_bounty: 9c8d4a72-1e5f-4b8a-9d3c-6f2b8e4a7c19
tags:
  - fleet-status
  - ssh-transport
  - self-limit
  - concurrency
  - maxsessions
  - channel-adapter
requires: []
provides:
  - "SELF-LIMIT-01: per-connection SSH exec concurrency capped at 8 in flight"
  - "SELF-LIMIT-02: per-channel semaphore isolation across SshChannel instances"
  - "SELF-LIMIT-03: exec return-type + null-on-error semantics preserved"
affects:
  - src/backend/starter.ts (channel-adapter sites — health-check + new-connection + intermediate health probe)
tech-stack:
  added: []
  patterns:
    - "Hand-rolled counting semaphore with FIFO wait queue (~20 lines at module scope)"
    - "try/finally slot release so throwing fn() still drains the queue"
    - "Per-channel semaphore instance (NOT module-scope) for per-connection isolation"
key-files:
  created:
    - .planning/quick/260902-3ll-self-limit-fleet-status-ssh-exec-concurr/260902-3ll-SUMMARY.md
  modified:
    - src/backend/starter.ts
    - src/backend/starter.test.ts
decisions:
  - "Hand-roll the counting semaphore at module scope — do NOT add p-limit or any similar package (per plan constraint + bounty preference for minimal supply-chain change)."
  - "Instantiate the semaphore per-channel (per acquireSshChannel invocation), NOT module-scope — different hosts have INDEPENDENT sshd MaxSessions buckets on their respective SSH connections."
  - "Route the intermediate `echo ok` health probe through the SAME per-channel semaphore — otherwise it could bypass the cap on a saturated connection."
  - "Semaphore does NOT catch errors from fn() — the channel adapter's outer try/catch → null remains the SOLE null-conversion point in the exec pipeline, preserving semantics for every existing consumer."
metrics:
  duration: "~10 minutes"
  completed: "2026-09-02"
  tasks_completed: 2
  files_modified: 2
  commits: 2
  tests_added: 5
  tests_total_scoped: 10
---

# 260902-3ll Plan 01: Self-limit Fleet-status SSH Exec Concurrency Summary

**Bounty:** `b31a5c8e-7f2d-4c91-a4b6-8e9f1c3b7d24` (self-limit SSH exec concurrency via per-connection semaphore)
**Parent bounty:** `9c8d4a72-1e5f-4b8a-9d3c-6f2b8e4a7c19` (wip-indicator SSH-transport family — architectural close-out)

**One-liner:** Wraps both channel-adapter `.exec` sites + intermediate `echo ok` health probe in `src/backend/starter.ts` with a per-channel counting semaphore (hand-rolled, ~20 lines) capped at 8 — cannot exceed OpenSSH default `MaxSessions=10` on any target host's untouched sshd config.

---

## What Shipped

### Task 1 — Semaphore helper + channel-adapter wiring
**Commit:** `b42716e7` — `feat(260902-3ll): self-limit SSH exec concurrency via per-channel semaphore`
**File:** `src/backend/starter.ts` (+58 / -4)

Line ranges edited:
- **Helper location:** `src/backend/starter.ts:80-124` — new `export function makeSemaphore(limit)` at module scope near `maybeInstallStopHook`. Counting semaphore + FIFO wait queue, slot decrement + queue drain in `try/finally`, no timeouts, no error catching (throws from `fn()` propagate unchanged).
- **Adapter site A (health-check path):** `src/backend/starter.ts:406-421` — instantiates `const sem = makeSemaphore(8)` above the `channel` object literal; wraps inner `execCommand(existing, command)` in `sem.run(...)`.
- **Health-probe wrap:** `src/backend/starter.ts:420` — `await sem.run(async () => execCommand(existing, "echo ok"))` on the SAME semaphore so the probe cannot bypass the cap.
- **Adapter site B (new-connection path):** `src/backend/starter.ts:454-462` — instantiates `const sem = makeSemaphore(8)` above the `channelAdapter` object literal; wraps inner `execCommand(client, command)` in `sem.run(...)`.

Verify output (Task 1):
```
$ npx tsc --noEmit -p tsconfig.json → zero errors
$ grep -n "makeSemaphore\|sem\.run\|sem = makeSemaphore" src/backend/starter.ts
102:export function makeSemaphore(limit: number): {
406:              const sem = makeSemaphore(8);
410:                    return await sem.run(async () =>
420:              await sem.run(async () => execCommand(existing, "echo ok"));
454:          const sem = makeSemaphore(8);
458:                return await sem.run(async () => execCommand(client, command));
```

- 3 `sem.run(` sites present (health-check adapter exec + health probe + new-connection adapter exec) ✓
- 2 `makeSemaphore(8)` instantiations (one per adapter site — per-channel isolation preserved) ✓

### Task 2 — Regression tests
**Commit:** `6c8812af` — `test(260902-3ll): regression suite for makeSemaphore SSH exec throttle`
**File:** `src/backend/starter.test.ts` (+114 / -1)

Test count added: **5 new tests** (existing 5 Phase 39-04 tests unchanged).

New tests in describe block `"Bounty b31a5c8e — makeSemaphore per-connection SSH exec throttle"`:
- **Test A** (LOAD-BEARING): 20-parallel load → `maxInFlight ≤ 8` cap-at-8 proof.
- **Test B**: throws from `fn()` propagate unchanged — pins semantics contract (semaphore does NOT catch, null-conversion stays in adapter's outer try/catch).
- **Test C**: happy-path string round-trip preserved (baseline).
- **Test D** (LOAD-BEARING): two independent semaphores each running up to cap concurrently → `maxCombined ≥ 9` per-channel isolation proof.
- **Test E**: FIFO queue drains fully under tight cap (cap=2, 10 tasks) — proves the `finally`-drain fires and no queued task hangs.

Scoped test output tail:
```
$ npx vitest run src/backend/starter.test.ts

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Duration  35.45s (transform 8.11s, setup 1.17s, import 29.93s, tests 351ms, environment 0ms)

 ✓ Phase 39-04 — maybeInstallStopHook helper > Test 1: fires installStopHook exactly once per host per lifecycle 142ms
 ✓ Phase 39-04 — maybeInstallStopHook helper > Test 2: fires again after lifecycle reset (set.clear()) 16ms
 ✓ Phase 39-04 — maybeInstallStopHook helper > Test 3: install failure does not block helper return + failure logged with err.message 69ms
 ✓ Phase 39-04 — maybeInstallStopHook helper > Test 4: passes the SshChannel adapter (interface has exec method) 2ms
 ✓ Phase 39-04 — maybeInstallStopHook helper > Test 5: install-attempted Set is the only tracking state — reset re-arms across multiple lifecycles 55ms
 ✓ Bounty b31a5c8e — makeSemaphore per-connection SSH exec throttle > Test A: caps concurrent in-flight at ≤ limit under 20-parallel load (cap-at-8 proof) 508ms
 ✓ Bounty b31a5c8e — makeSemaphore per-connection SSH exec throttle > Test B: throws from fn() propagate unchanged (semaphore does NOT catch) 119ms
 ✓ Bounty b31a5c8e — makeSemaphore per-connection SSH exec throttle > Test C: successful string round-trips unchanged (happy-path pass-through) 68ms
 ✓ Bounty b31a5c8e — makeSemaphore per-connection SSH exec throttle > Test D: two independent semaphores can each run up to their cap concurrently (per-channel isolation proof) 218ms
 ✓ Bounty b31a5c8e — makeSemaphore per-connection SSH exec throttle > Test E: FIFO queue drains fully — all queued tasks eventually run under a tight cap 73ms
```

Test A (cap-at-8) and Test D (per-channel isolation) — the two load-bearing assertions — both green.

---

## Scope Guards Verified

`git diff --stat src/backend/fleet-status/ssh-poll-orchestrator.ts src/backend/ssh/tmux-helper.ts` → **empty** (no lines shown, both files byte-identical).

`git diff package.json package-lock.json` → **empty** (no new npm dependency; hand-rolled semaphore only, per plan constraint).

Only two files modified across both commits:
- `src/backend/starter.ts`
- `src/backend/starter.test.ts`

---

## Deviations from Plan

**None.** Plan executed exactly as written. Both tasks completed with the specified line ranges, all `<done>` criteria met, all `<success_criteria>` satisfied.

---

## Decisions Made

1. **Semaphore location:** Placed `makeSemaphore` at module scope directly after `maybeInstallStopHook` (starter.ts:80-124) — matches the plan's "near the existing `maybeInstallStopHook` export" instruction and lets `starter.test.ts` import + drive it directly without booting the IIFE (the `VITEST=true` guard is already in place).

2. **Per-channel not module-scope:** Each `acquireSshChannel` invocation that reaches a returning branch creates its OWN `sem = makeSemaphore(8)`. This preserves per-connection isolation — different hosts have INDEPENDENT sshd MaxSessions buckets, so their semaphores must not share state. Test D (`maxCombined ≥ 9`) is the load-bearing proof.

3. **Health probe on same semaphore:** The `echo ok` health probe at ~L420 goes through the SAME per-channel semaphore as the adapter exec calls — otherwise on a saturated connection the probe could bypass the cap and cause the exact CHANNEL_OPEN_FAILURE this bounty prevents.

4. **Semaphore does NOT catch errors:** `try/finally` around `await fn()` — slot released on both success and throw, but errors propagate unchanged. The channel adapter's outer `try/catch → null` remains the SOLE null-conversion point in the exec pipeline. Test B pins this contract.

5. **No new npm dep:** Hand-rolled ~20 lines instead of adding `p-limit` / `p-queue` / `async-sema`. Package.json + package-lock.json byte-identical.

---

## What This Closes Architecturally

Follow-up to bounty `wip-indicator-ssh-transport-error-conflated-with-pid-dead` (shipped 2026-09-02 as /gsd:quick 260902-1tu, HEAD `f35da913`). That fix made the ONE catastrophic null-return path (stat-read → false session_gone reap) safe. This bounty PREVENTS the saturation entirely so no null-return paths from the adapter fire under normal fleet-status polling load.

The throttle is INVISIBLE to `ssh-poll-orchestrator.ts` — its `Promise.all([...])` fan-outs at :1205 (sessionJson/stat/hookPayload), :966 (dormant/recycled-at/recycle-requested), sweepOneHost, source-B enumeration, JSONL tail, etc. queue implicitly with zero call-site changes. Poll interval is 2s; parallel bursts now serialize into batches of 8 (~500-1000ms worst case), well under the interval.

Confirmed with Ashley 2026-09-02: OpenSSH `MaxSessions` is per-CONNECTION not per-host-global (sshd_config man page verbatim: "the maximum number of open shell, login or subsystem sessions permitted per network connection"). An 8-cap on Skynet's own connection uses 8 of Skynet's-own-10 slots, leaves 2 headroom on Skynet's bucket, and touches nothing on any other SSH client's bucket on the same target host.

---

## Self-Check: PASSED

- FOUND: `src/backend/starter.ts` (modified — makeSemaphore export + 2 adapter-site wraps + 1 health-probe wrap) ✓
- FOUND: `src/backend/starter.test.ts` (modified — new describe block with 5 tests) ✓
- FOUND commit `b42716e7`: `feat(260902-3ll): self-limit SSH exec concurrency via per-channel semaphore` ✓
- FOUND commit `6c8812af`: `test(260902-3ll): regression suite for makeSemaphore SSH exec throttle` ✓
- CONFIRMED `sem.run(` appears 3 times outside comments in starter.ts (health-check adapter exec + health probe + new-connection adapter exec) ✓
- CONFIRMED `makeSemaphore(8)` appears 2 times in starter.ts (per-channel instantiation, not module-scope) ✓
- CONFIRMED `src/backend/fleet-status/ssh-poll-orchestrator.ts` byte-identical (empty git-diff-stat) ✓
- CONFIRMED `src/backend/ssh/tmux-helper.ts` byte-identical (empty git-diff-stat) ✓
- CONFIRMED `package.json` byte-identical (no new dep) ✓
- CONFIRMED `package-lock.json` byte-identical (no new dep) ✓
- CONFIRMED `npx vitest run src/backend/starter.test.ts` → 10/10 tests passed (5 Phase 39-04 + 5 Bounty b31a5c8e) ✓
- CONFIRMED `npx tsc --noEmit` → zero errors project-wide ✓

## TDD Gate Compliance

Both tasks tagged `tdd="true"`. Sequence:
- Task 1: `feat(260902-3ll): ...` — implementation gate (GREEN via `npx tsc --noEmit` + grep confirming wiring).
- Task 2: `test(260902-3ll): ...` — regression suite pins the primitive's contract (5 tests, all passing on first run — Task 1's implementation is correct-by-construction of the ~15-line semaphore primitive).

Note: For this specific bounty, the plan's `<verify>` blocks explicitly assigned tsc+grep to Task 1 and vitest to Task 2, and separated the two files across the two tasks (starter.ts in Task 1, starter.test.ts in Task 2). The primitive is small enough (~20 lines) that Test A/D would have been the natural RED anyway — running the suite after both tasks shows 10/10 green, validating both the implementation and the wiring assertions.
