---
phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model
plan: 03
subsystem: relay-sessions
tags: [matrix, relay-sessions, observation-loop, backoff, tdd, boot-starter]

# Dependency graph
requires:
  - phase: 89-01
    provides: relay-room-sessions-store primitives (materialize / markInactive / reactivate / refreshLastActivity / listActive) + admin-rooms-ignore-list primitives (isAdminRoom / listAdminRooms) that the observation loop reconciles into and consults for D-13.
  - phase: 89-02
    provides: getAgentsRegistryRoomId accessor (D-09 classification substrate) + ensureRegistryRoomsExist + runRegistryRoomsBackfill (called in sequence by the boot-time starter).
  - phase: 75-matrix-admin
    provides: matrix-admin-client primitive convention (docblock, error codes, AbortController + REQUEST_TIMEOUT_MS, discriminated-union return) extended by three new primitives here.
provides:
  - getUserJoinedRooms (top-level primitive extracted from getSharedDMRoom's internal helper) + getRoomLatestEventTs + getRoomJoinedMembers on matrix-admin-client.ts
  - observation-loop-classifier.ts: pure D-08/D-09/D-13 decision tree module (zero I/O)
  - observation-loop.ts: runObservationTick + createObservationLoop with per-user scheduler + backoff ladder + per-user in-flight guard
  - observation-loop-starter.ts: startObservationLoopOnBoot bootstrap wired into starter.ts as fire-and-forget after dbModule.initializeDatabase
affects: [89-04 /sessions/list merge (consumes active rows written by this observation loop), slice-c-create-room-flow, slice-d-frontend-pane-render]

# Tech tracking
tech-stack:
  added: []  # No new deps — reuses Node built-in fetch/setInterval/setTimeout, vitest fake-timers for scheduler tests
  patterns:
    - "matrix-admin-client primitive convention (docblock, error codes, AbortController + REQUEST_TIMEOUT_MS wrapper, clearTimeout in both branches, discriminated-union AdminOk<T> | AdminErr return) extended by getUserJoinedRooms / getRoomLatestEventTs / getRoomJoinedMembers — the 8th/9th/10th such primitives after the createRoom (Phase 89-02) precedent."
    - "Extract-and-delegate refactor: getSharedDMRoom's internal `joinedRooms` helper (at old L473) was extracted to a top-level exported getUserJoinedRooms with the standard discriminated-union return, and getSharedDMRoom now delegates to it + collapses errors to null internally. External behavior byte-identical (bridge-config-writer.ts + G-01..G-07 regression suite still pass)."
    - "Pure classifier module — zero I/O imports (grep-verified via `import.*db|import.*fetch|import.*matrix-admin` returns 0). The observation loop pre-computes the fact-set (member list, admin-list membership, agents-registry members) and hands it to the classifier per-room. Trivially unit-testable without mocks."
    - "Dep-injection via ObservationTickDeps interface for the observation loop — every Matrix primitive AND every DB primitive is a field on the interface. Tests inject vi.fn() stubs with no vi.mock() calls needed. Boot-time starter wires the concrete implementations."
    - "Per-user scheduling + backoff ladder + in-flight guard — mirrors ssh-poll-orchestrator.ts:822-844 (quick-260820-tm0) per-host pattern. A single 1s scan interval dispatches ticks whose nextRunAt has passed; per-user state (Map<userId, {nextRunAt, backoffIndex, inFlight}>) is checked+updated in-scan; a slow tick never accumulates a duplicate tick for the same user; a slow user never blocks other users."
    - "Fire-and-forget with two-layer catch — outer catch for module-load failures + inner catch for runtime failures inside startObservationLoopOnBoot — matches the exact idiom used by the Phase 79/83 reconcile-loop starts in starter.ts (~L299/~L323). Server startup MUST NOT abort because the observation-loop bootstrap failed (D-07 no-user-visible surface applies to boot too)."
    - "Best-effort per-axis semantics — inside runObservationTick, each store-primitive call is wrapped in its own try/catch. A DB failure materializing room A doesn't block reactivate/refresh for room B in the same tick. A per-room getRoomJoinedMembers failure skips only that room; other rooms in the same tick still classify + materialize."

key-files:
  created:
    - src/backend/relay-sessions/observation-loop-classifier.ts
    - src/backend/relay-sessions/observation-loop-classifier.test.ts
    - src/backend/relay-sessions/observation-loop.ts
    - src/backend/relay-sessions/observation-loop.test.ts
    - src/backend/relay-sessions/observation-loop-starter.ts
    - src/backend/relay-sessions/observation-loop-starter.test.ts
  modified:
    - src/backend/matrix/matrix-admin-client.ts (extracted getUserJoinedRooms as top-level primitive; refactored getSharedDMRoom to delegate; added getRoomLatestEventTs + getRoomJoinedMembers)
    - src/backend/matrix/matrix-admin-client.test.ts (10 new tests + 1 regression assertion for getSharedDMRoom's happy path after the extraction)
    - src/backend/starter.ts (added fire-and-forget import block for observation-loop-starter at ~L335-361, matching Phase 79/83 reconcile-loop idiom)

key-decisions:
  - "getUserJoinedRooms extraction returns the discriminated-union shape (NOT the internal-nullable that was cleaner for getSharedDMRoom's Promise.all-across-pairs pattern) — the observation loop needs the failure REASON to drive per-user backoff decisions (D-06 vs. simply 'null happened'). getSharedDMRoom now delegates + collapses errors to null internally to preserve its existing null-tolerant callers (bridge-config-writer + G-01..G-07 tests). Refactor is byte-parallel behaviorally."
  - "Classifier reason strings are stable structured-logging fields: admin_room, user_not_member, solo_room, harness_dm, two_party_non_agent, group_room. Each corresponds 1:1 to a D-* decision so the observation loop's per-room debug log names the exact D-* rule that fired."
  - "Scheduler design: single global 1s scan interval + per-user state map (NOT per-user setInterval). Rationale: (a) simpler cleanup (one clearInterval instead of N), (b) more efficient at scale (one wake-up per second regardless of user count), (c) per-user nextRunAt gives the same effective cadence, (d) mirrors the ssh-poll-orchestrator design that solved the wilma-2026-08-20 accumulation incident. Trade-off: sub-1s cadence would require a finer scan interval — currently OBSERVATION_TICK_INTERVAL_MS=10s so 1s scan gives 10% max jitter."
  - "Best-effort per-axis inside runObservationTick — every store-primitive call is wrapped in try/catch and logs on failure, so a DB failure on one room does NOT poison the other rooms' materialize/reactivate/refresh in the same tick. Trade-off: complex nested try/catch is uglier than a single outer catch, but the alternative (single outer catch that aborts the whole tick on any DB failure) violates D-06 no-destruction-on-failure at a per-primitive granularity."
  - "MAX_PARALLEL_ROOMS_PER_TICK = 8 — D-05 cost bound. Users typically have <8 rooms; larger counts fan out in chunks of 8 rather than all-at-once. Not a soft rate-limit (Synapse is co-located; no external network cost); purely a defensive cap."
  - "Deferred: enumerateAgentMxids dep for runRegistryRoomsBackfill is intentionally NOT wired in observation-loop-starter.ts. The D-11 mint hook covers all NEW agents from now on; pre-existing agents that predate the registry rooms will conservatively materialize their two-party DMs (D-09 fallthrough) rather than being excluded. Slightly noisier sidebars for existing users but no correctness violation. See Deviations section for the deferral rationale."

patterns-established:
  - "Pattern: observation loops for admin-credentialed subsystems use dep-injection interfaces (ObservationTickDeps) so tests don't need vi.mock the store or the HTTP client — just wire vi.fn() stubs to the interface fields. Contrast: registry-rooms-backfill.ts (Plan 02) used vi.mock module-level for the register hooks. Both patterns are acceptable; dep-injection is preferred when the module has 8+ collaborators."
  - "Pattern: hoisted mocks via vi.hoisted() for shared handles across multiple vi.mock() factory callbacks. Vitest hoists vi.mock() but NOT top-level const declarations that the factories reference, so vi.hoisted is required when mock handles need to be visible to multiple mocks + assertions. First use of vi.hoisted in this phase."
  - "Pattern: per-user scheduling with per-user backoff + per-user in-flight guard — the ssh-poll-orchestrator quick-260820-tm0 pattern is now the established Skynet-fleet convention for admin-credentialed per-target polling loops. Any future observation loop (Slice D pane subscriptions, telemetry ingest, etc.) should follow the same shape."

requirements-completed: [D-04, D-05, D-06, D-07, D-08, D-09]

# Metrics
duration: ~12min
completed: 2026-09-08
---

# Phase 89 Plan 03: Observation loop — per-user room-membership polling + reconcile Summary

**The observation loop that turns "a user's relay identity is a member of a room" into a stored active row: three new matrix-admin-client primitives (getUserJoinedRooms extracted + getRoomLatestEventTs + getRoomJoinedMembers), a pure D-08/D-09/D-13 classifier, per-user scheduler with 10s → 300s backoff ladder and in-flight guard mirroring the ssh-poll-orchestrator quick-260820-tm0 pattern, and a fire-and-forget boot-time starter wired into starter.ts alongside the Phase 79/83 reconcile-loops.**

## Performance

- **Duration:** ~12 min (from Task 1 RED at 14:27:02Z to Task 4 GREEN at 14:37Z)
- **Started:** 2026-09-08T14:25:51Z
- **Completed:** 2026-09-08T14:37:41Z
- **Tasks:** 4 (all TDD RED → GREEN cycles; no REFACTOR needed)
- **Files created:** 6 (3 source + 3 test)
- **Files modified:** 3 (matrix-admin-client.ts + .test.ts, starter.ts)
- **Test count:** 33 new scoped tests (10 matrix-admin-client + 7 classifier + 12 observation-loop + 4 observation-loop-starter). All 134 tests across all 8 phase-89 test files pass green (0 regressions). Wider `vitest related` sweep on matrix-admin-client.ts + starter.ts: 959 tests passed across 60 test files (2 pre-existing EADDRINUSE errors in claude-session-server tests unrelated to phase-89).

## Accomplishments

- **Three new matrix-admin-client primitives** land following the existing 7-primitive convention (docblock, error codes, AbortController + REQUEST_TIMEOUT_MS wrapper, clearTimeout in both branches, encodeURIComponent on path args for T-75-05 defense, admin token never logged, discriminated-union return). `getUserJoinedRooms` was refactored OUT of `getSharedDMRoom`'s internal `joinedRooms` helper into a top-level export; `getSharedDMRoom` now delegates to it + collapses errors to null internally so its existing callers (bridge-config-writer.ts + G-01..G-07 regression suite) see byte-identical behavior.
- **Pure classifier module** (`observation-loop-classifier.ts`) encodes the D-08 (exact two-party exclusion) / D-09 (registry-room-membership authority) / D-13 (admin-rooms ignore-list) decision tree as a first-match-wins rule set with stable `reason` strings suitable for structured logging. Zero I/O imports (grep-verified). Trivially unit-testable — 7 tests, no mocks.
- **Observation loop core** (`observation-loop.ts`) exports OBSERVATION_TICK_INTERVAL_MS, BACKOFF_LADDER_MS, MAX_PARALLEL_ROOMS_PER_TICK constants + `runObservationTick(userId, userMxid, deps)` orchestration + `createObservationLoop(deps)` per-user scheduler. Per-user backoff state (nextRunAt + backoffIndex + inFlight) reproduces the ssh-poll-orchestrator quick-260820-tm0 in-flight-guard pattern. Best-effort per-axis: a DB failure on one room does NOT poison other rooms in the same tick. D-06 no-destruction: getUserJoinedRooms failure returns early WITHOUT touching any existing row.
- **Boot-time starter** (`observation-loop-starter.ts`) sequences ensure → backfill → enumerate users (from `SELECT id AS userId, mxid AS userMxid FROM users WHERE mxid IS NOT NULL AND mxid != ''`) → createObservationLoop.start. Wired into starter.ts as a fire-and-forget `void import().then().catch()` block at line 344, matching the exact two-layer catch idiom used by the Phase 79/83 reconcile-loop starts (~L299 reconcile-dead-tokens, ~L323 reconcile-pending-chat-ids). Server startup does not abort on bootstrap failure.
- **Zero regressions** — 134 phase-89 tests pass; 959 tests pass in the wider related sweep.

## Task Commits

Each task followed strict RED → GREEN TDD cycles:

1. **Task 1: Extract getUserJoinedRooms + add getRoomLatestEventTs + getRoomJoinedMembers**
   - RED: `c0f370b3` — `test(89-03-task1): RED — tests for getUserJoinedRooms + getRoomLatestEventTs + getRoomJoinedMembers`
   - GREEN: `82236829` — `feat(89-03-task1): GREEN — extract getUserJoinedRooms + add getRoomLatestEventTs + getRoomJoinedMembers`
2. **Task 2: Pure classifier module**
   - RED: `de70dfd5` — `test(89-03-task2): RED — classifier decision tree tests`
   - GREEN: `46817da7` — `feat(89-03-task2): GREEN — pure classifier module`
3. **Task 3: Observation loop core**
   - RED: `308e52da` — `test(89-03-task3): RED — observation-loop core tests`
   - GREEN: `be188fb5` — `feat(89-03-task3): GREEN — observation-loop core with per-user scheduler + backoff`
4. **Task 4: Boot-time starter wired into starter.ts**
   - RED: `2b178ca4` — `test(89-03-task4): RED — observation-loop-starter tests`
   - GREEN: `9c94a406` — `feat(89-03-task4): GREEN — observation-loop-starter wired into starter.ts`

## Files Created/Modified

### Created

- `src/backend/relay-sessions/observation-loop-classifier.ts` — Pure module exporting `classifyRoom(input) → { decision, reason }`. Zero I/O imports. 5-rule first-match-wins decision tree encoding D-08/D-09/D-13.
- `src/backend/relay-sessions/observation-loop-classifier.test.ts` — 7 tests covering all 5 rules + edge cases (harness_dm exclude, two_party_non_agent materialize, group_room materialize, admin_room exclude, user_not_member defensive, solo_room edge). No mocks.
- `src/backend/relay-sessions/observation-loop.ts` — 571 lines. Exports OBSERVATION_TICK_INTERVAL_MS + BACKOFF_LADDER_MS + MAX_PARALLEL_ROOMS_PER_TICK + ObservationTickDeps interface + runObservationTick + createObservationLoop. Per-user scheduler with 1s scan interval + per-user state map + per-user in-flight guard (quick-260820-tm0 pattern). Best-effort per-axis inside the tick.
- `src/backend/relay-sessions/observation-loop.test.ts` — 12 tests (11 named per plan spec; Test 9 is split into Test 9 + Test 9b for the per-room-ts-failure sub-case). All deps injected via ObservationTickDeps — no vi.mock. Test 7 locks the BACKOFF_LADDER_MS public contract. Tests 8 + 11 use vi.useFakeTimers.
- `src/backend/relay-sessions/observation-loop-starter.ts` — Exports startObservationLoopOnBoot. Sequence: ensureRegistryRoomsExist → runRegistryRoomsBackfill (with enumerateAgentMxids intentionally omitted — see Deferred) → SELECT users with mxid → createObservationLoop(deps).start. Module-level loopScheduler reference kept for future hot-reload.
- `src/backend/relay-sessions/observation-loop-starter.test.ts` — 4 tests covering the boot sequence, creds-missing bail, backfill-fail-but-proceed, zero-users. Uses vi.hoisted for shared mock handles across multiple vi.mock factories.

### Modified

- `src/backend/matrix/matrix-admin-client.ts` — Three additions + one refactor:
  - **Added `getUserJoinedRooms` top-level primitive** (~90 lines) between buildRelayJsonBody and getSharedDMRoom. Discriminated-union return `AdminOk<{roomIds: string[]}> | AdminErr`. Filters non-string entries defensively.
  - **Added `getRoomLatestEventTs` primitive** — GET /_synapse/admin/v1/rooms/{roomId}/messages?dir=b&limit=1. Empty chunk → `{ok:true, ts:null}` (D-05 tolerance for brand-new rooms with no events yet).
  - **Added `getRoomJoinedMembers` primitive** — GET /_synapse/admin/v1/rooms/{roomId}/members. Defensive fallback: missing/wrong-type members → empty array, total falls back to memberMxids.length.
  - **Refactored `getSharedDMRoom`** — replaced the internal 22-line `joinedRooms` helper with a delegation to the new top-level getUserJoinedRooms. Errors collapse to null internally to preserve the existing null-tolerant signature (bridge-config-writer.ts sees byte-identical behavior; G-01..G-07 regression tests still pass).
- `src/backend/matrix/matrix-admin-client.test.ts` — Added 10 tests + updated the import list to include the 3 new primitive names. New tests: 4 for getUserJoinedRooms (happy, 404, creds-missing, AbortError) + 1 regression for getSharedDMRoom + 3 for getRoomLatestEventTs (happy, empty chunk, token-never-logged) + 3 for getRoomJoinedMembers (happy, defensive fallback, token-never-logged). Total file: 68 tests, all passing.
- `src/backend/starter.ts` — Added a new fire-and-forget block (~L335-361) AFTER the Phase 83 reconcile-pending-chat-ids block. Matches the exact two-layer catch idiom used by Phase 79/83 (outer catch for module-load failures + inner catch for runtime failures inside startObservationLoopOnBoot). Docblock explains ordering requirement (must come after `initializeDatabase()`). systemLogger.warn on either failure path with operation keys `relay_observation_bootstrap_error` + `relay_observation_bootstrap_module_load_failed`.

### starter.ts call-site line numbers (Test 5 manual note)

Per Plan 03 Task 4 Test 5's manual-note requirement:

- Docblock: L334-343 (comment explaining Phase 89 ordering)
- `void import("./relay-sessions/observation-loop-starter.js")`: L344
- Inner `startObservationLoopOnBoot().catch(...)` block: L346-355
- Outer module-load catch: L356-361

Ordering: AFTER `dbModule.initializeDatabase()` (L263), AFTER the Phase 83 `reconcile-pending-chat-ids` block (~L323-332), BEFORE the Phase 74 `assertBrandingConfigAtBoot` block (~L365). Same lifecycle stage as the Phase 79/83 reconcile-loop starts.

## Decisions Made

All decisions followed plan spec verbatim (no architectural deviations). Planner-discretion choices lifted from `<action>` blocks:

- **Task 1 refactor scope**: getSharedDMRoom's refactor kept minimal — only the internal helper moves to top-level; getSharedDMRoom's own signature, behavior, and error semantics are unchanged. Bridge-config-writer + G-01..G-07 regression tests still pass.
- **Task 1 endpoint constants inline**: kept the `_synapse/admin/v1/...` URL literals inline (matching the existing 7 primitives). Grep for the messages endpoint returns 3 matches (section header + docblock + URL construction) rather than the plan's spec of exactly 1 — but this matches every other primitive's shape (loginAsUser also has 3 mentions of its endpoint). The spirit of the grep-check ("endpoint exists in the file") is satisfied.
- **Task 3 scheduler shape**: single global 1s scan interval + per-user state map (NOT per-user setInterval) — see key-decisions above for rationale. Mirrors ssh-poll-orchestrator.ts design.
- **Task 3 MAX_PARALLEL_ROOMS_PER_TICK = 8**: chosen as a defensive cap for D-05 fanout. Users typically have <8 rooms; larger fan out in chunks.
- **Task 4 enumerateAgentMxids DEFERRED**: see Deviations section for full rationale + follow-up plan pointer.

## Deviations from Plan

**Total:** 1 deferred item (documented below); 0 auto-fixes; 0 test-setup adjustments outside the RED/GREEN cycle.

### Deferred (not a code deviation — documented plan-flex)

**1. [Documented deferral] enumerateAgentMxids dep NOT wired in observation-loop-starter.ts**

- **Plan spec context:** Plan 02 SUMMARY noted: "Plan 89-03's observation-loop bootstrap needs to wire the concrete SSH-based enumerator when it lands." Plan 03's execution_protocol explicitly allowed either implementing it now or deferring with a note: "decide during Task 4 whether to implement it now (via SSH exec against fleet-status hosts to read `~/.claude/identities/<name>/relay.json` per D-12 backfill-only allowance in Plan 02 read_first) OR defer to a follow-up bounty. Either is acceptable; document your choice in SUMMARY under Deviations if you defer."
- **Choice:** Deferred to a follow-up bounty/plan.
- **Rationale:**
  1. The D-11 mint hook (Phase 89-02 Task 3) covers ALL new agents from now on — every future agent minted via `POST /identities/birth` auto-joins the agents registry room. The backfill only matters for agents that predate the Phase 89-02 landing.
  2. Pre-existing agents that predate the registry rooms will simply be missing from `agentsInRegistry`. The classifier's Rule 4 for two-party rooms with a non-registry other member returns `two_party_non_agent` → **materialize**, so their DMs would appear in the user's sidebar as a foreign/unknown-origin conversation. Correctness is preserved; the user just sees a slightly noisier sidebar until the deferred backfill runs.
  3. Implementing the SSH-based enumerator requires: reading fleet-status roster (in-memory cache), per-host SSH exec via the existing SSH primitive to list `~/.claude/identities/` directories, per-identity SSH exec to read `relay.json`, robust error handling per host (offline hosts must not block the whole backfill), and unit tests against the fleet-status subsystem contracts. That surface deserves its own plan — likely a Phase 89-04-followup or a slice-B-hardening plan.
- **Impact on plan letter:** none — Plan 03's `<verification>` block doesn't require the enumerator to be wired. Plan spec allowed the deferral explicitly.
- **Follow-up plan reference:** SSH-based agent enumeration to complete D-12 backfill for pre-existing agents. Recommended trigger: after Slice D lands and any operator notices a noisy sidebar for a fleet host that predates Phase 89-02.

### Test-setup adjustment (inside GREEN commit, not a plan deviation)

Task 4's RED test file used top-level `const mockX = vi.fn(); vi.mock(...(mockX))` patterns which vitest cannot resolve because `vi.mock()` factories run BEFORE any top-level `const` declarations. The GREEN commit for Task 4 updated the test file to use `vi.hoisted()` for shared mock handles across multiple `vi.mock()` factories. This is a test-scaffolding fix, not a change to test intent — the 4 test assertions and their expected outcomes are unchanged. Documented here for transparency; established a new pattern (vi.hoisted for shared handles across multiple factories) that Plan 04 or later plans in this arc may reuse.

## Issues Encountered

- **vitest fake-timer isolation:** Tests 8 + 11 in observation-loop.test.ts use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` to exercise the scheduler's 1s scan interval + backoff transitions. Followed the existing fleet convention (fleet-status subscription-registry tests) — `vi.useFakeTimers()` inside the test body + `vi.useRealTimers()` in `beforeEach` — no new discovery.
- **Pre-existing EADDRINUSE:** During the wider `vitest related` sweep (60 test files), the pre-existing `claude-session-server.dormant-tail.test.ts` port-30011 collision surfaced (same environmental issue noted in Plans 89-01 and 89-02 SUMMARYs). Out of scope per executor Rule (Scope Boundary); 959 other tests passed cleanly.
- **`.husky/pre-commit` and `.husky/commit-msg` hooks not executable:** git printed the same warning on every commit as in Plans 89-01 and 89-02. Pre-existing environment condition — hooks are simply skipped, no commit failed.
- **Committer identity warning:** git warned about auto-configured committer (Ubuntu <ubuntu@ip-172-31-243-143.ec2.internal>) — pre-existing environment condition, matches Plans 89-01/89-02 pattern. No commit failed.

## User Setup Required

None — pure backend infrastructure. Nothing user-visible ships in this plan (per plan's `<objective>`: "This is the substrate that turns 'a user's relay identity is a member of a room' into a stored active row that /sessions/list can merge (Plan 04)"). The observation loop starts silently at server boot; failures land in logs only (D-07). No new endpoints, no admin UI, no user-facing surface.

## Next Phase Readiness

**Ready for Plan 89-04 (Wave 4 — /sessions/list merge):**
- `listActiveRelayRoomSessions(userId)` returns exactly the shape `{ id, roomId, roomTitle, lastActivityAt, createdAt, updatedAt }` that Plan 04's merge integration will append to the derived harness sessions list. The observation loop populates active rows for every joined-and-classifier-approved room per user per ~10s tick.
- Row shape guarantee: `state='active'` for every row Plan 04 sees is validated against the current Synapse membership (last successful tick). External kicks transition to `inactive` within one tick of Synapse-side membership change. Same-tick `last_activity_at` refresh means the sidebar sort by real recency will be accurate to within one tick of the newest event.

**Ready for slice C (parallel arc, sub-slice C — create-room flow):**
- Slice C's create-room flow calls the SAME `materializeRelayRoomSession` primitive (Plan 01, D-14 schema-as-coordinator). Whichever path runs first wins; the other is a no-op via the ON-CONFLICT-DO-NOTHING clause. The observation loop is the safety net if slice C's insert fails mid-way.

**Ready for slice D (parallel arc, sub-slice D — frontend pane render):**
- Once Plan 04 lands, slice D consumes the merged /sessions/list response with kind markers per D-15 and renders relay-room panes.

**Deferred (documented above):**
- SSH-based agent enumeration to complete D-12 backfill for pre-existing agents (recommend follow-up plan when noticed operationally).

No blockers, no concerns. All four tasks landed clean with strict TDD gate compliance.

## Self-Check: PASSED

**Files verified to exist:**
- `src/backend/relay-sessions/observation-loop-classifier.ts` — FOUND
- `src/backend/relay-sessions/observation-loop-classifier.test.ts` — FOUND
- `src/backend/relay-sessions/observation-loop.ts` — FOUND
- `src/backend/relay-sessions/observation-loop.test.ts` — FOUND
- `src/backend/relay-sessions/observation-loop-starter.ts` — FOUND
- `src/backend/relay-sessions/observation-loop-starter.test.ts` — FOUND
- `src/backend/matrix/matrix-admin-client.ts` — MODIFIED (verified via git log — three primitives added, getSharedDMRoom refactored)
- `src/backend/matrix/matrix-admin-client.test.ts` — MODIFIED (verified via git log — 10 new tests added)
- `src/backend/starter.ts` — MODIFIED (verified via git log — Phase 89 fire-and-forget block added)

**Commits verified via `git log --oneline`:**
- `c0f370b3` test(89-03-task1) RED — FOUND
- `82236829` feat(89-03-task1) GREEN — FOUND
- `de70dfd5` test(89-03-task2) RED — FOUND
- `46817da7` feat(89-03-task2) GREEN — FOUND
- `308e52da` test(89-03-task3) RED — FOUND
- `be188fb5` feat(89-03-task3) GREEN — FOUND
- `2b178ca4` test(89-03-task4) RED — FOUND
- `9c94a406` feat(89-03-task4) GREEN — FOUND

**Plan `<verify>` blocks:**
- Task 1 automated: `npx vitest run src/backend/matrix/matrix-admin-client.test.ts` — 68 tests passed
- Task 1 human-check greps: getUserJoinedRooms=1 ✓, getRoomLatestEventTs=1 ✓, getRoomJoinedMembers=1 ✓, admin messages endpoint=3 (spec said "1" but this matches the 3-mention pattern of every other primitive — section header + docblock + URL construction; the spirit "endpoint exists" is satisfied), internal joinedRooms=0 ✓ (helper extracted).
- Task 2 automated: `npx vitest run src/backend/relay-sessions/observation-loop-classifier.test.ts` — 7 tests passed
- Task 2 human-check greps: `export function classifyRoom`=1 ✓, `import.*db|import.*fetch|import.*matrix-admin`=0 ✓ (zero I/O imports)
- Task 3 automated: `npx vitest run src/backend/relay-sessions/observation-loop.test.ts` — 12 tests passed (11 named per plan + Test 9b split)
- Task 3 human-check greps: BACKOFF_LADDER_MS=3 (≥2 required) ✓, markRelayRoomSessionInactive=3 (≥1 required) ✓, classifyRoom=2 (≥1 required) ✓, inFlight=7 (≥2 required) ✓
- Task 4 automated: `npx vitest run src/backend/relay-sessions/observation-loop-starter.test.ts` — 4 tests passed
- Task 4 human-check greps: `export async function startObservationLoopOnBoot`=1 ✓, `startObservationLoopOnBoot in starter.ts`=3 (≥1 required) ✓, `relay_observation_bootstrap_error in starter.ts`=1 (≥1 required) ✓, `ensureRegistryRoomsExist|runRegistryRoomsBackfill|createObservationLoop in observation-loop-starter.ts`=12 (≥3 required) ✓
- Full sweep: 134 tests across all 8 phase-89 test files pass green. Wider `vitest related` sweep on matrix-admin-client.ts + starter.ts: 959 tests passed across 60 test files (2 pre-existing EADDRINUSE errors in claude-session-server tests unrelated to phase-89).

## TDD Gate Compliance

Each task followed strict RED → GREEN cycles:

- **Task 1**: `test(89-03-task1): RED` (c0f370b3) → `feat(89-03-task1): GREEN` (82236829). RED verified failing (getUserJoinedRooms/getRoomLatestEventTs/getRoomJoinedMembers not defined, 10 tests failed) before GREEN. No REFACTOR needed.
- **Task 2**: `test(89-03-task2): RED` (de70dfd5) → `feat(89-03-task2): GREEN` (46817da7). RED verified failing (module not found) before GREEN. No REFACTOR needed.
- **Task 3**: `test(89-03-task3): RED` (308e52da) → `feat(89-03-task3): GREEN` (be188fb5). RED verified failing (module not found) before GREEN. No REFACTOR needed.
- **Task 4**: `test(89-03-task4): RED` (2b178ca4) → `feat(89-03-task4): GREEN` (9c94a406). RED verified failing (module not found) before GREEN. Test-scaffolding fix (vi.hoisted) landed inside the GREEN commit — this was infrastructure only, test intent unchanged. No REFACTOR needed.

All four RED commits are strictly before their GREEN counterparts in git log. Gate sequence compliant.

---
*Phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model*
*Plan: 03*
*Completed: 2026-09-08*
