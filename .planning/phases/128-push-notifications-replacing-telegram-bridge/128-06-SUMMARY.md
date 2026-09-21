---
phase: 128-push-notifications-replacing-telegram-bridge
plan: 06
subsystem: notifications
tags: [push-notifications, live-event-pump, per-user-scheduler, matrix-polling, novel-infrastructure]

# Dependency graph
requires:
  - phase: 128-01
    provides: push_subscriptions schema + drop of telegram_bot_tokens
  - phase: 128-02
    provides: vapid-config env loader + push-sender web-push wrapper with 410/404 pruning
  - phase: 128-03
    provides: derivePreviewText + resolveAgentDisplayName (title + body derivation)
  - phase: 89-03
    provides: observation-loop createObservationLoop scheduler shape + BACKOFF_LADDER_MS + INITIAL_TICK_JITTER_MS + PerUserState per-user isolation pattern
  - phase: 90-04
    provides: fetchRoomHistory dir=f primitive (matrix-message-fetch.ts) + relay-room-stream-server's fetchLive closure shape + LIVE_EVENT_POLL_INTERVAL_MS cadence
  - phase: 89-03
    provides: classifyRoom + ClassifyRoomInput / ClassifyResult types (harness_dm reason is the exact D-02 invariant the trigger fires on)

provides:
  - createPushTriggerLoop + runPushTriggerTick + PerUserState + PushTriggerLoopDeps (novel per-user always-on live-event pump)
  - startPushTriggerLoopOnBoot boot bootstrap that enumerates users, gates on VAPID, wires deps, starts scheduler
  - Cold-start suppression policy for the trigger loop (first tick per room discards events, only sets cursor)
  - Deps-injection contract for a per-user scheduler that shares scheduler DNA with observation-loop but a distinct cadence (2s vs 10s) and a distinct dispatch surface (push vs materialize)

affects:
  - 128-08 (starter.ts wire-up will invoke startPushTriggerLoopOnBoot alongside startObservationLoopOnBoot; add + wire-up = single-file change per PATTERNS.md § 14)
  - future v2 cross-device-smart-routing (would consume PerUserState.cursorByRoom for per-device deduplication)
  - future hot-reload (would consume _activePushTriggerLoop module ref)

# Tech tracking
tech-stack:
  added: []  # no new deps — reuses everything from Waves 1 + existing observation-loop + matrix-message-fetch
  patterns:
    - "Second per-user always-on loop in the codebase (mirrors createObservationLoop scheduler DNA with distinct cadence + dispatch surface)"
    - "Cold-start suppression on first tick per room to prevent boot-time push storm (T-128-29 mitigation)"
    - "Never-throws dispatch: cursor advances even after sendPushToUser failure (dropping preferable to re-firing from same cursor)"
    - "Deps-injection via PushTriggerLoopDeps interface (no vi.mock at loop level, mirrors observation-loop.test.ts style)"
    - "Test-only escape hatch __getPerUserStateForTests exposed on scheduler for scoped scheduling-shape assertions"

key-files:
  created:
    - src/backend/notifications/push-trigger-loop.ts
    - src/backend/notifications/push-trigger-loop.test.ts
    - src/backend/notifications/push-trigger-starter.ts
    - src/backend/notifications/push-trigger-starter.test.ts
  modified: []

key-decisions:
  - "Cold-start suppression semantics: on the FIRST tick for a room (empty cursor), fetchLive is CALLED but events are DISCARDED and only the cursor is set. Prevents boot-time push storm where every historical DM would fire as a fresh notification."
  - "Backoff ladder tightened from observation-loop's 10s-cap-300s to 2s-cap-60s because the base cadence itself is 2s (5x tighter than observation-loop's 10s). Ratio preserved but absolute times shrink to match responsiveness expectation."
  - "getRegistryMembers is called ONCE per tick (per user) — the loop caller reuses the Set across every room in that tick. Deliberately no cross-tick cache (unlike observation-loop's AGENTS_REGISTRY_MEMBERS_CACHE_TTL_MS) — at 2s per user the load is bounded and fewer moving parts."
  - "Cursor advances even after sendPushToUser failure (dropping the push is preferable to re-firing from unchanged cursor on next tick, which would spam the same event)."
  - "getUserJoinedRooms is called per tick (no memoization) — captures room joins/leaves at 2s worst-case lag, matching the trigger's own cadence."
  - "empty-string sentinel used for cold-start cursor when Matrix returns null nextSinceToken — marks the room as seen-but-empty so second tick isn't re-treated as cold-start."

patterns-established:
  - "Filter pipeline pattern for per-event dispatch: (type check) → (self-check) → (edit-check) → (classifyRoom delegation). Each step logs its rejection at debug so a silent failure is diagnosable per fleet-rules § standing directives."
  - "Best-effort classifier prerequisite helpers (safeListAdminRooms + safeGetAgentsRegistryRoomId) — never-throws wrappers around dep calls so a helper failure degrades to empty-set (classifier sees no admin rooms / no registry) instead of crashing the tick."
  - "Cold-start-first-tick policy: any per-user, per-room-cursor loop that fetches historical events should discard on the first tick and only set the cursor. Prevents deploy-time notification storms in any future analog."

requirements-completed: [D-01, D-02, D-03, D-04, D-05, D-14]

# Metrics
duration: 22min
completed: 2026-09-21
---

# Phase 128 Plan 06: Push notifications replacing Telegram bridge Summary

**Per-user always-on live-event pump — the LOAD-BEARING trigger for every push notification the phase delivers. Polls Matrix per user every ~2s, filters new events through the existing classifyRoom's harness_dm rule (D-02), and dispatches to sendPushToUser for qualifying agent-originated DM messages.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-09-21T02:43:27Z
- **Completed:** 2026-09-21T03:00:00Z
- **Tasks:** 2 (both TDD — RED test + GREEN impl per task)
- **Files created:** 4 (2 source + 2 tests)

## Accomplishments

- **Per-user always-on live-event pump** — the novel infrastructure this phase depends on. Without this loop, Wave 1's vapid-config, push-sender, service worker handlers, and subscription route would have no way to fire.
- **Four-step filter pipeline** delivering D-04's "only new agent-originated messages" invariant: (1) event.type === m.room.message, (2) sender !== userMxid, (3) not an edit (m.replace), (4) classifyRoom → exclude + harness_dm.
- **Cold-start suppression** (T-128-29 mitigation) — first tick per room discards events and only sets cursor. No boot-time push storm.
- **Per-user isolation, in-flight guard, backoff ladder, thundering-herd jitter** — full scheduler discipline mirroring the observation-loop's proven pattern.
- **Boot bootstrap** with VAPID gate + user enumeration + full dep wiring, ready for Plan 08 to invoke from starter.ts.
- **22 test cases green** (17 loop + 5 starter). Zero telegram imports in either file (grep confirms).
- **Backend + full builds clean** with no new dependencies.

## Task Commits

Each task followed TDD (RED → GREEN) with two commits per task:

1. **Task 1 RED: failing tests for push-trigger-loop** - `8a03e90a` (test)
2. **Task 1 GREEN: push-trigger-loop implementation** - `3051ba31` (feat)
3. **Task 2 RED: failing tests for push-trigger-starter** - `f4f581f6` (test)
4. **Task 2 GREEN: push-trigger-starter implementation** - `04a39391` (feat)

_TDD gate compliance: RED (`test(...)`) before GREEN (`feat(...)`) for both tasks._

## Files Created/Modified

- `src/backend/notifications/push-trigger-loop.ts` — Per-user always-on Matrix live-event pump. createPushTriggerLoop scheduler + runPushTriggerTick worker + PerUserState + PushTriggerLoopDeps interface + cold-start policy + never-throws contract.
- `src/backend/notifications/push-trigger-loop.test.ts` — 17 test cases covering the twelve behavior invariants from the plan (four filter steps, happy path, cursor advancement, cold-start, per-user isolation, in-flight guard, backoff, thundering-herd jitter) plus edge-case coverage (multi-event batch, cursor-stays-on-fetch-failure, never-throw on dispatch failure, classifier is called not re-derived, stop() clears state).
- `src/backend/notifications/push-trigger-starter.ts` — Boot bootstrap that enumerates users WHERE mxid IS NOT NULL, gates on VAPID (fail-safe warn-and-return, not fail-fast), wires PushTriggerLoopDeps with concrete implementations, and starts the loop. Byte-mirror of observation-loop-starter.ts's shape.
- `src/backend/notifications/push-trigger-starter.test.ts` — 5 test cases covering the four behavior cases from the plan (zero users, VAPID missing, happy path, DB exception) + a wiring-completeness check that createPushTriggerLoop receives all 12 required deps.

## Decisions Made

### Cold-start policy (novel invariant — flagged for /close arc)

**On the FIRST tick for a room (state.cursorByRoom has no entry for that roomId), fetchLive is CALLED but the returned events are DISCARDED. Only the cursor is set (from `nextSinceToken`, or empty-string sentinel if nextSinceToken is null). Second tick onward → normal filter+dispatch flow.**

This prevents the boot-time push storm where every historical message in every DM room would fire as a fresh notification — a real risk on deploy day or after a container restart. T-128-29 mitigation. The test case "Test 12: Cold-start" enforces this invariant: a qualifying event on a fresh room MUST NOT fire a push, cursor MUST be set.

### Backoff ladder tightened for 2s cadence

Observation-loop's BACKOFF_LADDER_MS is [10s, 30s, 60s, 120s, 300s] anchored on 10s tick cadence. Push-trigger's is [2s, 8s, 15s, 30s, 60s] anchored on 2s tick cadence — same 5x-cap-of-base shape, tightened to match the responsiveness expectation. Longer backoffs would defeat the "you just got pinged" latency promise even during transient Matrix outages.

### getRegistryMembers per-tick, no cross-tick cache

Observation-loop caches agents-registry members for `AGENTS_REGISTRY_MEMBERS_CACHE_TTL_MS = 5s` across users. Push-trigger deliberately does NOT cache across ticks — at 2s per user the load is bounded (~1 admin call per user per 2s) and fewer moving parts. If the fleet ever grows past ~1000 concurrent users, this decision would deserve revisit; at current scale it's a clean simpler-shape wins tradeoff.

### Cursor advances even after sendPushToUser failure

If sendPushToUser throws (contract violation — it's supposed to be never-throws per T-128-09), the loop absorbs the exception to .warn AND still advances the cursor for that room. Rationale: re-firing the same event on the next tick from the unchanged cursor would spam the user with duplicate pushes. Dropping one push is a better degradation mode than the double-firing alternative.

### Deps-injection over vi.mock at loop level

Every I/O primitive the loop uses is a field on `PushTriggerLoopDeps`. Loop-level tests inject vi.fn() stubs directly (mirror of observation-loop.test.ts's style). No `vi.mock("./push-trigger-loop.js")` needed anywhere. This is the canonical pattern established by observation-loop and now repeated here — future analogs should follow.

## Deviations from Plan

None — plan executed exactly as written. All twelve behavior cases from the plan's Task 1 <behavior> block landed as test cases; all four from Task 2's landed. Cold-start policy is called out explicitly in the plan's <behavior> block AND documented in this SUMMARY per the plan's <output> instruction.

Deliberate additions beyond the minimum acceptance criteria (not deviations — all in-scope):
- `resolveUserId` dep added to `PushTriggerLoopDeps` so the loop can convert userMxid → internal userId at dispatch time without a per-event DB round-trip. Wired via a boot-time reverse map (mxidToUserId) in the starter.
- `__getPerUserStateForTests` test-only escape hatch on the scheduler — needed to assert on jitter distribution + backoff advancement in the loop-level tests. Named with the double-underscore convention matching `__resetAgentsRegistryMembersCacheForTests` in observation-loop.ts.
- Empty-string sentinel for cold-start when Matrix returns null nextSinceToken — needed so the second tick doesn't re-detect the room as cold-start (Map.has check would return false without any entry).
- `assertNotOk` narrowing helper added to two call sites where TS 6.0.3 lost discriminated-union narrowing across the surrounding try/catch (same shape as observation-loop.ts uses `assertAdminErr` for the identical TS quirk).

**Total deviations:** 0 auto-fixed (plan-as-written was correct at every step).
**Impact on plan:** None — the additions above are all in-scope refinements the plan explicitly permitted at implementer discretion (dep-injection shape, test hatches, TS narrowing helpers).

## Issues Encountered

- **TS discriminated-union narrowing lost across `if (!result.ok)` branches** — TS 6.0.3 known quirk. Resolved with the same `assertNotOk` helper the rest of the codebase uses (matrix-admin-narrow.ts:21-25). No functional impact.
- **vi.hoisted references before initialization** — the test file's shared warn/info spies had to move INTO the `vi.hoisted(() => {...})` block instead of standalone `const warnSpy = vi.fn()` declarations, because vi.mock factories hoist above top-level consts. Standard vitest gotcha; fixed inline.

## Verification

- **Twelve loop-level behavior cases green** (mapped from plan Task 1 <behavior>):
  - ✓ Filter Step 1 rejects non-m.room.message
  - ✓ Filter Step 2 rejects self-sent
  - ✓ Filter Step 3 rejects edits
  - ✓ Filter Step 4 rejects non-harness_dm (materialize decision)
  - ✓ Filter Step 4 rejects wrong-decision harness_dm (exclude with different reason)
  - ✓ Happy path: sendPushToUser called with `{title:'Fanny:', body:'hey', roomId, agentMxid}` shape + classifyRoom CALLED (D-02)
  - ✓ Per-user isolation
  - ✓ Cursor advancement on success
  - ✓ In-flight guard
  - ✓ Backoff on tick failure + reset on success
  - ✓ Thundering-herd jitter (three distinct nextRunAt values within [now, now+INITIAL_JITTER])
  - ✓ Cold-start suppression on first tick per room
- **Four starter-level behavior cases green** (mapped from plan Task 2 <behavior>):
  - ✓ Zero users → {ok:false, reason:'no_users'}
  - ✓ VAPID missing → {ok:false, reason:'vapid_missing'} + warn logged
  - ✓ Happy path → {ok:true, users:N} + loop.start called with users
  - ✓ DB exception → {ok:false, reason:'exception'} + warn logged + no rethrow
- **Backend build clean:** `npm run build:backend` exit 0
- **Full build clean:** `npm run build` exit 0
- **Zero telegram imports:** `grep 'telegram' src/backend/notifications/push-trigger-*.ts` returns nothing
- **Every acceptance-criteria grep from the plan passes** (see run in the Task 1 + Task 2 verify sections above).

## Threat Model Compliance

Mitigations from `<threat_model>` implemented as coded:
- **T-128-27** (thundering herd on Matrix outage recovery): PUSH_TRIGGER_BACKOFF_LADDER_MS + ±20% success jitter + initial-tick jitter — all three present.
- **T-128-28** (group room misclassified as harness_dm → cross-user leak): loop delegates entirely to `classifyRoom` per D-02, zero re-derivation of shape logic. Test "classifyRoom is CALLED (not re-derived)" locks this.
- **T-128-29** (cold-start push storm): cold-start suppression enforced by "Test 12" — a qualifying event on a fresh cursor MUST NOT fire a push.
- **T-128-30** (edit re-triggers push): Filter Step 3 rejects `m.relates_to.rel_type === "m.replace"`, enforced by "Test 3".
- **T-128-31** (self-sent message pushes to Ashley): Filter Step 2 rejects `event.sender === userMxid`, enforced by "Test 2".
- **T-128-32** (fetch failure advances cursor + skips events): cursor advancement gated on `result.ok === true`; enforced by "Cursor does NOT advance when fetchLive fails" test.
- **T-128-33** (per-user isolation broken): scanTick dispatches per-user runTick WITHOUT await; test "Per-user isolation" holds user A's failure separate from user B's tick.
- **T-128-34** (VAPID missing → starter still tries): starter's VAPID gate returns {ok:false, reason:'vapid_missing'} + never calls createPushTriggerLoop when getVapidDetails throws. Test 2 confirms.

## Next Phase Readiness

- **Plan 07 (frontend opt-in surface + push-subscription API)** — no dependency on this plan's outputs.
- **Plan 08 (starter.ts wire-up)** — READY. Adds a `void import("./notifications/push-trigger-starter.js").then(m => m.startPushTriggerLoopOnBoot().catch(...))` block after the existing observation-loop-starter dispatch at starter.ts:455-472. Copy-paste template lives at PATTERNS.md § 14. Load-bearing invariants Plan 08 MUST preserve: the block goes AFTER observation-loop starter (both consume users WHERE mxid IS NOT NULL; symmetry helps future readers), and it goes AFTER `assertVapidConfigAtBoot()` (Plan 08's separate wire-up — the fail-fast gate must fire before this bootstrap's fail-safe gate).
- **Zero blockers.** Everything downstream in the phase (frontend, teardown, deploy) can proceed independently.

## Cold-Start Policy Note (for /close arc verification)

The trigger loop's cold-start policy is the novel invariant this phase introduces. When the loop starts for a user, its `cursorByRoom` map is empty. On the first tick for any room, the loop:
1. Calls `fetchLive(roomId, "", 20)` to obtain the current head token.
2. **Discards the returned events entirely** — no filter pipeline, no dispatch.
3. Sets `state.cursorByRoom[roomId]` to the returned `nextSinceToken` (or empty-string sentinel if Matrix returned null).

Second tick onward → normal filter+dispatch flow (four-step pipeline → sendPushToUser).

This policy is what prevents the boot-time push storm where every historical message in every DM room would fire as a fresh notification. Any future refactor of the trigger loop MUST preserve this behavior. The test case "Test 12: Cold-start" is the regression pin.

## Self-Check: PASSED

All files created exist on disk (5/5) and every task-commit hash resolves in `git log` (4/4).

---
*Phase: 128-push-notifications-replacing-telegram-bridge*
*Plan: 06*
*Completed: 2026-09-21*
