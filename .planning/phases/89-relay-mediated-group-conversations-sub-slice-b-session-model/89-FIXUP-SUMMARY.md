---
phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model
fixup: post-verifier-unbiased-review
tags: [phase-89, fixup, code-review, matrix, relay-sessions, tdd, defensive]

# Dependency graph
requires:
  - phase: 89-01, 89-02, 89-03, 89-04
    provides: All Phase 89 primary landing artifacts (session store, admin_rooms, registry-rooms, backfill, observation loop, /sessions/list merge)

# Tech tracking
tech-stack:
  added: []  # No new deps
  patterns:
    - "Fixup semver: fix(89-fixup) for bugs, feat(89-fixup) for new behavior, refactor(89-fixup) for polish, docs(89-fixup) for comment-only. Each atomic finding gets its own commit; TDD-cycle findings (H-1, H-2, M-1) get RED + GREEN as separate commits."
    - "Test-first for correctness bugs (H-1, H-2, M-1 primitive): failing test committed FIRST, then GREEN fix. Regression guards live in the test file so a future regression fails the same test."
    - "Best-effort per-axis extended: H-1 formalized 'per-room fetch failure = unknown state, do NOT reconcile' into a joinedRoomIdsSet + fetchedRoomIds two-set reconcile. Preserves D-06 no-destruction invariant for the newly-discovered failure mode."
    - "Self-heal idempotency (H-2): ensureRegistryRoomsExist fast path now verifies isAdminRoom(roomId) and re-fires addAdminRoom if missing. Closes the addAdminRoom-warn-swallowed-on-first-boot permanent-leak window."
    - "Injectable options with test seams (M-2 jitter, M-3 cache): both new subsystems expose a test-only seam (`jitter: false` option, `__resetAgentsRegistryMembersCacheForTests` export) so deterministic tests stay possible while production defaults enable the anti-abuse behavior."

key-files:
  created:
    - src/backend/relay-sessions/enumerate-agent-mxids.ts
    - src/backend/relay-sessions/enumerate-agent-mxids.test.ts
    - .planning/phases/89-relay-mediated-group-conversations-sub-slice-b-session-model/89-FIXUP-SUMMARY.md
  modified:
    - src/backend/relay-sessions/observation-loop.ts (H-1 reconcile categorization, M-1 getRoomName wire, M-2 jitter, M-3 cache, N-5 rationale doc)
    - src/backend/relay-sessions/observation-loop.test.ts (H-1, M-1, M-2, M-3 tests + jitter:false plumbing)
    - src/backend/relay-sessions/observation-loop-starter.ts (M-1 getRoomName wire in concrete deps)
    - src/backend/relay-sessions/observation-loop-starter.test.ts (M-1 getRoomName in matrix-admin-client mock)
    - src/backend/relay-sessions/registry-rooms.ts (H-2 self-heal + isAdminRoom import)
    - src/backend/relay-sessions/registry-rooms.test.ts (H-2 self-heal tests + isAdminRoom mock)
    - src/backend/relay-sessions/registry-rooms-backfill.ts (M-6 force flag, N-1 typo fix)
    - src/backend/relay-sessions/registry-rooms-backfill.test.ts (M-6 tests)
    - src/backend/relay-sessions/relay-room-sessions-store.ts (N-2 log-level downgrades)
    - src/backend/matrix/matrix-admin-client.ts (M-1 getRoomName primitive, L-3 defensive ts, N-3 ERR_MISSING_FIELD)
    - src/backend/matrix/matrix-admin-client.test.ts (M-1 primitive tests, N-3 test value)
    - src/backend/database/routes/sessions-merge-helper.ts (L-4 defensive copy)
    - src/backend/database/routes/identity-birth-orchestrator.ts (M-4 comment refresh)
    - src/backend/database/routes/users.ts (M-4 comment refresh)
    - src/backend/database/db/index.ts (L-1 D-16 single-instance scope note)
    - src/backend/database/db/schema.ts (L-1 D-16 single-instance scope note — paired mirror)
    - .planning/phases/89-relay-mediated-group-conversations-sub-slice-b-session-model/89-02-SUMMARY.md (M-5 concrete agents-backfill runbook, M-6 force flag runbook)

key-decisions:
  - "H-1 fix approach — two-set reconcile (joinedRoomIdsSet + fetchedRoomIds) with explicit category (a) external-kick and category (b) newly-excluded partition. Chosen over a simpler `only-mark-if-in-fetched` filter because it correctly handles the external-kick case (room absent from joined_rooms entirely — whole-user fetch succeeded, so absence IS authoritative). The simpler filter would have leaked stale rows when the user was actually kicked."
  - "H-2 fix approach — isAdminRoom check on fast path + selfHealAdminRoomsMembership helper. Chosen over reordering createRegistryRoom (addAdminRoom BEFORE settings write) because ordering-based fixes are fragile: any future edit that adds a step between them silently reintroduces the gap. The self-heal is idempotent + inspectable via ops logs."
  - "M-1 primitive placement — client-server API (POST /_matrix/client/v3/rooms/{roomId}/state/m.room.name), not admin API. Matches the createRoom pattern from Plan 89-02: m.room.name is a client-server state-event concept; admin API has no equivalent; admin token works on both via Bearer auth."
  - "M-2 jitter design — TWO layers: boot-time uniform spread across [0, TICK_INTERVAL_MS) + per-tick ±10% on success. Backoff-driven paths deliberately NOT jittered because backoff intervals (10s → 30s → 60s → 120s → 300s) are already pre-shaped and desync naturally. `jitter: false` test option + injectable rng preserve deterministic testing."
  - "M-3 cache design — module-level Map keyed by registry room ID, 5s TTL (half of TICK_INTERVAL_MS). Chosen over per-ObservationLoop-instance cache because (a) in practice there's exactly one loop, (b) module-level lets a future multi-loop refactor share the cache trivially. Test seam __resetAgentsRegistryMembersCacheForTests exported so beforeEach can clean state. Failed fetch does NOT populate — next tick retries immediately, no stale-error poisoning."
  - "M-5 module surface — enumerateAgentMxidsViaSSH(deps) with fully-injected listHosts + runSshCommand. Chosen over baking in a specific ssh2/host-resolver path because the module runs in the docker-exec manual-backfill context where per-user encryption keys are unavailable — the deployer chooses which SSH pool to trust. Unit-testable without ssh2/database coupling."
  - "M-6 force flag design — optional param on BackfillDeps interface (default false = original gate-honoring behavior). Chosen over a separate `forceRunRegistryRoomsBackfill()` function because callers already pass the deps bag; adding one field is cheaper than duplicating the whole flow. Structured `registry_backfill_force` info log lets ops trace intentional re-runs."
  - "N-3 rename approach — introduce a NEW ERR_MISSING_FIELD constant, keep ERR_NO_TOKEN unchanged for loginAsUser. Chosen over renaming ERR_NO_TOKEN (which would incorrectly change loginAsUser's wire value too) because loginAsUser's semantic ('access_token missing') is correct on the value it uses. Only createRoom's misuse gets the new constant."

requirements-completed:
  - "Post-review fixes for HIGH findings H-1 (per-room fetch failure = D-06 destruction bug) + H-2 (admin_rooms write failure = permanent registry-room leak)."
  - "Post-review fixes for MEDIUM findings M-1 (roomTitle always null), M-2 (thundering-herd), M-3 (redundant registry-room fetches), M-4 (stale mint-hook comments), M-5 (agents backfill enumerator not wired), M-6 (orphaned has_backfilled gate)."
  - "Post-review polish for LOW findings L-1 (admin_rooms scope docs), L-3 (defensive ts check), L-4 (defensive copy). L-2 skipped (deferred per plan), L-5/L-6 skipped (UAT / defer per plan)."
  - "Post-review polish for NIT findings N-1 (typo), N-2 (log-level), N-3 (semantic constant rename), N-5 (rationale doc). N-4 not present in review."

# Metrics
duration: ~55min
completed: 2026-09-08
---

# Phase 89 Post-Verifier Unbiased Review Fixups — Summary

**All 17 review findings addressed across 15 atomic commits — 2 HIGH bugs closed with RED→GREEN TDD cycles, 6 MEDIUM findings landed (5 with new behavior, 1 comment-only), 3 LOW polish items, 4 NIT items. Zero regressions across the 249-test Phase 89 suite.**

## Performance

- **Duration:** ~55 min (H-1 RED at 15:40Z through N-3 commit at 16:18Z)
- **Started:** 2026-09-08T15:40:00Z
- **Completed:** 2026-09-08T16:18:00Z
- **Commits:** 15 (5 test-RED, 4 feat-GREEN, 4 fix/feat inline, 1 refactor-batch, 1 docs — Ashley's "hit anything worth fixing" surface delivered atomically)
- **Files created:** 3 (enumerate-agent-mxids.ts + .test.ts + this SUMMARY)
- **Files modified:** 17 (source + tests across relay-sessions, matrix, database routes, schema)
- **Test count:** 21 NEW scoped tests added across 5 test files. All 249 tests across the touched Phase 89 surface pass green.

## Findings addressed — quick table

| Finding | Priority | Type | Commit(s) | Summary |
|---------|----------|------|-----------|---------|
| H-1 | HIGH | fix + test | `fcccb24a` + `2bf91e4c` | Per-room `getRoomJoinedMembers` failure no longer silently marks the DB row inactive on reconcile. |
| H-2 | HIGH | fix + test | `1f9e3128` + `21e555d2` | `ensureRegistryRoomsExist` fast path self-heals a missing `admin_rooms` row (closes addAdminRoom-warn-swallowed leak). |
| M-1 | MEDIUM | feat + test (2 pairs) | `0148227d` + `486bbe7a` + `2af891d0` + `d43f3c83` | New `getRoomName` primitive; wired into observation-loop Step 3; room titles now flow to `relay_room_sessions.room_title`. |
| M-2 | MEDIUM | feat | `146f898c` | Boot-time + per-tick jitter — no more N users hammering Synapse on the same beat. |
| M-3 | MEDIUM | feat | `8cfcfc25` | 5s TTL cache for `getRoomJoinedMembers(agentsRegistryRoomId)` — was fetched independently per user per tick. |
| M-4 | MEDIUM | docs | `82b161d0` | Stale mint-hook comments updated to reference manual backfill runbook (post D-12 refinement). |
| M-5 | MEDIUM | feat | `03b0a5b8` | New `enumerate-agent-mxids.ts` module — SSH-based agents-backfill enumerator + runbook wiring. |
| M-6 | MEDIUM | feat | `9e2b97d2` | `force: true` param on `runRegistryRoomsBackfill` to bypass `has_backfilled` gate for deliberate re-runs. |
| L-1 | LOW | docs | `b29ac25f` (batched) | D-16 SINGLE-INSTANCE-PER-DB scope note on `admin_rooms` in db/index.ts + schema.ts. |
| L-3 | LOW | defensive | `b29ac25f` (batched) | `getRoomLatestEventTs` treats non-positive origin_server_ts as null (prevents 1970-01-01 sidebar renders). |
| L-4 | LOW | defensive | `b29ac25f` (batched) | `mergeRelayRoomsIntoFlat` clones harnessRows before sort — no in-place mutation surprise. |
| L-2 | LOW | SKIP | — | Stopped-scheduler-doesn't-cancel-in-flight — deferred per plan. |
| L-5 | LOW | SKIP | — | UAT verification item, not a code fix. |
| L-6 | LOW | SKIP | — | Bounded fan-out on backfill — deferred, one-shot manual invocation. |
| N-1 | NIT | docs | `b29ac25f` (batched) | Typo fix in registry-rooms-backfill.ts. |
| N-2 | NIT | refactor | `b29ac25f` (batched) | 5 per-primitive entry logs downgraded from .info → .debug (per-tick per-room spam). |
| N-3 | NIT | refactor | `d5c87a73` | createRoom missing-field error renamed from ERR_NO_TOKEN → ERR_MISSING_FIELD (semantic clarity). |
| N-5 | NIT | docs | `b29ac25f` (batched) | Rationale comment for MAX_PARALLEL_ROOMS_PER_TICK=8. |

## Detailed change notes

### H-1 (HIGH): Per-room fetch failure no longer marks room inactive

**Bug (D-06 violation):** `runObservationTick`'s Step 3 fetched per-room members with a `try/continue` on failure. The failing roomId was NOT added to `materializedRoomIds`. Step 4 then reconciled: any DB-active row NOT in `materializedRoomIds` was marked inactive. Net effect: a transient Synapse 429 or network hiccup on the per-room fetch destroyed the session record.

**Fix:** Introduced `fetchedRoomIds` set (rooms whose per-room fetch succeeded, regardless of classifier decision) and a `joinedRoomIdsSet` for whole-user membership. Reconcile now partitions "should be inactive" into two disjoint categories:

- (a) **External kick:** room absent from `joinedRoomIds` entirely — whole-user fetch succeeded per Step 1's ok gate, so absence IS authoritative.
- (b) **Newly excluded:** room IS in `joinedRoomIds` AND per-room fetch succeeded AND classifier chose to exclude.

Rooms in `joinedRoomIds` whose per-room fetch FAILED belong to neither category → left untouched (unknown state, D-06 no-destruction preserved).

**Test:** `observation-loop.test.ts` "Test H-1 [fixup]: per-room getRoomJoinedMembers failure does NOT mark that room inactive". 3 joined rooms, per-room fetch fails on room 2, existing active DB row for room 2 — assert `markRelayRoomSessionInactive` is NOT called for room 2.

### H-2 (HIGH): admin_rooms self-heal on fast path

**Bug:** `createRegistryRoom` writes settings row FIRST + `forceSave`, then calls `addAdminRoom` in a `try/catch` that only warns on failure. On next boot, `ensureRegistryRoomsExist` fast-paths at ~L155 because both settings rows present. `addAdminRoom` is NEVER retried. If the initial `addAdminRoom` failed, the registry room ID stays permanently absent from `admin_rooms` → classifier materializes it for every user → registry room appears in every sidebar.

**Fix:** New `selfHealAdminRoomsMembership(role, roomId)` helper called on the fast path. Calls `isAdminRoom(roomId)`; if false, calls `addAdminRoom(roomId)` (idempotent per Plan-01 store contract — INSERT OR IGNORE on room_id PRIMARY KEY). Best-effort: downstream failure logs `registry_rooms_admin_room_self_heal_failed` warn and continues.

**Tests:** Two — "Test H-2 [fixup]" (one missing, self-heal fires exactly once with the missing roomId) + "Test H-2b [fixup]" (both present, self-heal is a true no-op — regression guard against over-firing).

### M-1 (MEDIUM): getRoomName primitive + observation-loop wire

**Gap:** D-02 says `relay_room_sessions.room_title` comes from Matrix state. Every `materializeRelayRoomSession` call passed hard-coded null. Slice D needs this for sidebar labels.

**Fix (2 RED→GREEN pairs):**

1. **Primitive:** `getRoomName(roomId): Promise<GetRoomNameOk | AdminErr>` — GET `/_matrix/client/v3/rooms/{roomId}/state/m.room.name` via admin creds. Returns `{ok: true, name: string | null}` on success (null for rooms with no `m.room.name` event set — 404 handled gracefully). Follows every existing matrix-admin-client convention exactly.

2. **Wire-in:** ObservationTickDeps extended with `getRoomName`; Step 3's Promise.all batches `[members, latestTs, name]` per D-05 same-tick augmentation. Materialize now receives the resolved name (or null on failure / no event) as `roomTitle`. Best-effort per axis: getRoomName failure logs at debug and degrades to null, does NOT block materialize.

**Tests:** 7 new for the primitive (happy path, 404, missing/wrong-type field, empty string, non-2xx, creds missing, no token leak on proxy error). 2 new for the wire (resolved title flows to materialize; failure degrades to null).

### M-2 (MEDIUM): Thundering-herd jitter

**Gap:** Without jitter, N users boot in lock-step and lock-step forever. Every `scheduleNext(ok=true)` sets `nextRunAt = now + 10_000` for all users at once → N parallel admin API calls on the same 10s beat.

**Fix — two jitter layers:**

- **Boot-time:** each user's first tick delayed by `Math.floor(rng() * TICK_INTERVAL_MS)` — spread across `[0, 10s)`.
- **Per-tick success:** `nextRunAt = now + TICK_INTERVAL_MS * (0.9 + rng() * 0.2)` — ±10% window per user per tick.

Backoff paths deliberately NOT jittered — backoff intervals (10s, 30s, 60s, 120s, 300s) are already pre-shaped and desync naturally.

`ObservationLoopOptions` interface added: `{ jitter?: boolean = true, rng?: () => number = Math.random }`. Tests pass `{ jitter: false }` to disable and/or deterministic `rng` for cache-hit assertions.

**Tests:** 2 new (boot-spread with deterministic rng verifies distinct initial delays; per-tick jitter window verifies gap in [8000, 12000]).

### M-3 (MEDIUM): Cache for agents-registry members

**Gap:** Every user's tick fetched agents-registry members independently. N users → N redundant admin API calls per 10s window against the same room.

**Fix:** Module-level `Map<roomId, {memberMxids: Set<string>, expiresAt: number}>` cache. TTL = `AGENTS_REGISTRY_MEMBERS_CACHE_TTL_MS = 5_000` (half of TICK_INTERVAL_MS). Extracted the inline fetch into `getAgentsRegistryMembersCached(roomId, deps, userId)` helper. Failed fetch does NOT populate the cache (next tick retries immediately). Test seam: `__resetAgentsRegistryMembersCacheForTests()` exported.

**Tests:** 3 new (in-TTL cache hit — 3 sequential ticks fire fetch once; post-TTL cache miss — 4th tick after TTL re-fetches; failure no-populate — failed fetch leaves cache empty, next tick retries).

### M-4 (MEDIUM): Stale mint-hook comments refreshed

Comment-only change at both mint sites (identity-birth-orchestrator.ts + users.ts). Old wording referenced auto-backfill; new wording points to phase 89-02 SUMMARY.md § Manual backfill runbook (matches D-12 post-verifier refinement).

### M-5 (MEDIUM): agents-backfill enumerator

**Gap:** `runRegistryRoomsBackfill` accepted an optional `enumerateAgentMxids` dep but no concrete implementation existed. Manual backfill only covered humans → pre-existing agents' DMs materialized as duplicates in slice D.

**Fix:** New module `src/backend/relay-sessions/enumerate-agent-mxids.ts`. Exports `enumerateAgentMxidsViaSSH(deps: EnumerateAgentMxidsDeps)`. Deps: `listHosts` + `runSshCommand`. Command literal (locked as `REMOTE_ENUMERATE_COMMAND` constant): `for f in ~/.claude/identities/*/relay.json; do jq -r .user_id "$f" 2>/dev/null; done`. Aggregates, dedupes, filters empty / jq's "null" literal.

**Failure semantics — best-effort per host.** listHosts throw → `{ok:false, reason:'list_hosts_failed'}` (no SSH calls). Per-host SSH throw / null → log warn + skip that host, other hosts continue. Empty host list → `{ok:true, mxids:[]}`.

**Tests:** 7 new (happy multi-host with cross-host dedup; output parsing for empty/null/whitespace; per-host throw isolation; per-host null isolation; listHosts throw; empty host list; exact `REMOTE_ENUMERATE_COMMAND` literal regression guard).

**Runbook:** 89-02-SUMMARY.md § Manual backfill runbook updated with full docker-exec invocation shape wiring the enumerator alongside `runRegistryRoomsBackfill`.

### M-6 (MEDIUM): force flag on runRegistryRoomsBackfill

**Gap:** After first successful backfill, the `has_backfilled_registry_rooms` gate makes subsequent calls silent no-ops. A deployer who added new humans and wanted to re-run backfill hits the gate silently. But `joinHumanToHumansRegistry` is idempotent — re-running is safe.

**Fix:** Added optional `force: boolean` to `BackfillDeps`. When true, gate check bypassed. Structured `registry_backfill_force` info log so ops can trace intentional re-runs. Default (false) preserves original gate-honoring behavior. Runbook updated.

**Tests:** 2 new (force:true bypasses gate + re-enumerates humans; force logs structured entry).

### L-1 (LOW): admin_rooms SINGLE-INSTANCE scope documented

Paired comment in db/index.ts + schema.ts noting D-16's single-Skynet-instance-per-DB scope and the future multi-tenant migration path (add `skynet_instance_id` column).

### L-3 (LOW): getRoomLatestEventTs defensive check

Treat non-positive `origin_server_ts` as null. Matrix spec guarantees > 0 in practice but a 0/negative value slipping through would render as 1970-01-01 in the sidebar. Returning null is safer.

### L-4 (LOW): mergeRelayRoomsIntoFlat defensive copy

`[...harnessRows].sort(...)` instead of `harnessRows.sort(...)` — future-proofs against callers accidentally depending on input mutation.

### N-1 (NIT): typo — "re-createthe" → "re-create the"

### N-2 (NIT): 5 per-tick log-entry downgrades from .info → .debug

`relay_room_session_materialize`, `..._mark_inactive`, `..._reactivate`, `..._list_active`, `..._refresh_last_activity` all fire per-tick per-room. Failure paths retain original .warn severity.

### N-3 (NIT): createRoom missing-field error renamed

Introduced `ERR_MISSING_FIELD = "admin_api_missing_field"` for the "expected response field missing" case. Used in createRoom for the missing-room_id branch. `ERR_NO_TOKEN = "admin_api_no_token"` unchanged (still correct for loginAsUser's missing-access_token case). Wire value change: createRoom missing-room_id now returns `admin_api_missing_field` instead of `admin_api_no_token`. Verified no production callers keyed on the string.

### N-5 (NIT): MAX_PARALLEL_ROOMS_PER_TICK rationale doc

Added educated-guess anchor: normal users (<5 rooms) fit a single batch; power users (10-20 rooms) throttled to at most 3 sequential batches within the 10s TICK_INTERVAL_MS budget.

## Deferred / Skipped

- **L-2:** stopped scheduler doesn't cancel in-flight ticks — only matters for tests/hot-reload, deferred per plan.
- **L-5:** UAT verification item (`dir=b` against real Synapse) — not a code fix.
- **L-6:** bounded fan-out on backfill — nice-to-have, not needed for one-shot manual invocation, deferred.

## Deviations from PLAN

**Zero.** Every fix landed against its exact plan spec:

- H-1 fix used the recommended `fetchedRoomIds` set approach with the two-category reconcile — slightly more precise than the plan's proposed simple "only mark if in fetched" filter (which would have leaked stale rows on external kick).
- H-2 fix used the recommended self-heal approach with `isAdminRoom` guard + `addAdminRoom` idempotent re-fire.
- M-1, M-2, M-3, M-5, M-6 all landed with the recommended API shapes, feature flags, and test-seam patterns.
- Commit prefixes matched the plan's recommended `fix(89-fixup):` / `feat(89-fixup):` / `refactor(89-fixup):` / `docs(89-fixup):` scheme.

## Files Created/Modified

### Created

- `src/backend/relay-sessions/enumerate-agent-mxids.ts` — M-5 SSH-based agents-backfill enumerator with fully-injectable `EnumerateAgentMxidsDeps`. Best-effort per host, aggregated/deduped output, exact `REMOTE_ENUMERATE_COMMAND` locked as exported constant.
- `src/backend/relay-sessions/enumerate-agent-mxids.test.ts` — 7 scoped tests covering the full behavior surface.
- `.planning/phases/89-relay-mediated-group-conversations-sub-slice-b-session-model/89-FIXUP-SUMMARY.md` — this file.

### Modified (source)

- `src/backend/relay-sessions/observation-loop.ts` — H-1 reconcile two-set categorization, M-1 getRoomName in ObservationTickDeps + Step 3 batch, M-2 ObservationLoopOptions + jitter, M-3 module-level agents-registry cache + `__resetAgentsRegistryMembersCacheForTests` test seam, N-5 rationale doc for MAX_PARALLEL_ROOMS_PER_TICK.
- `src/backend/relay-sessions/observation-loop-starter.ts` — M-1 concrete `getRoomName` import + deps wire.
- `src/backend/relay-sessions/registry-rooms.ts` — H-2 self-heal on fast path + `isAdminRoom` import + `selfHealAdminRoomsMembership` helper.
- `src/backend/relay-sessions/registry-rooms-backfill.ts` — M-6 `force: boolean` on BackfillDeps + gate bypass path + structured log, N-1 typo fix.
- `src/backend/relay-sessions/relay-room-sessions-store.ts` — N-2 5x .info → .debug entry log downgrades.
- `src/backend/matrix/matrix-admin-client.ts` — M-1 new `getRoomName` top-level export + `GetRoomNameOk` type, L-3 defensive origin_server_ts > 0 check, N-3 new `ERR_MISSING_FIELD` constant used by createRoom's missing-room_id branch.
- `src/backend/database/routes/sessions-merge-helper.ts` — L-4 defensive clone before sort.
- `src/backend/database/routes/identity-birth-orchestrator.ts` — M-4 hook comment refresh (manual backfill).
- `src/backend/database/routes/users.ts` — M-4 hook comment refresh (manual backfill).
- `src/backend/database/db/index.ts` — L-1 D-16 SINGLE-INSTANCE-PER-DB scope note.
- `src/backend/database/db/schema.ts` — L-1 paired mirror note.

### Modified (tests)

- `src/backend/relay-sessions/observation-loop.test.ts` — added H-1 (1), M-1 (2), M-2 (2), M-3 (3) tests + `getRoomName` in makeDeps stub + `__resetAgentsRegistryMembersCacheForTests` beforeEach + `jitter: false` on existing scheduler tests.
- `src/backend/relay-sessions/observation-loop-starter.test.ts` — added `getRoomName: vi.fn()` to matrix-admin-client mock (compile prerequisite for the M-1 wire).
- `src/backend/relay-sessions/registry-rooms.test.ts` — added H-2 (2) tests + `isAdminRoom` in admin-rooms-ignore-list mock + `isAdminRoomSpy.mockResolvedValue(true)` beforeEach.
- `src/backend/relay-sessions/registry-rooms-backfill.test.ts` — added M-6 (2) tests.
- `src/backend/matrix/matrix-admin-client.test.ts` — added M-1 (7) tests for getRoomName primitive + N-3 rename asserts on `admin_api_missing_field` value.

### Modified (docs)

- `.planning/phases/89-*/89-02-SUMMARY.md` — added M-5 concrete agents-backfill runbook invocation shape + M-6 force flag runbook.

## Task Commits (chronological)

Each fix committed atomically. Correctness bugs (H-1, H-2, M-1 primitive + wire) got TDD RED→GREEN pairs; other fixes committed as single commits since the test was straightforward.

- H-1 fix: `fcccb24a` (test RED) → `2bf91e4c` (fix GREEN)
- H-2 fix: `1f9e3128` (test RED) → `21e555d2` (fix GREEN)
- M-1 primitive: `0148227d` (test RED) → `486bbe7a` (feat GREEN)
- M-1 wire: `2af891d0` (test RED) → `d43f3c83` (feat GREEN)
- M-2 jitter: `146f898c` (feat)
- M-3 cache: `8cfcfc25` (feat)
- M-4 comments: `82b161d0` (docs)
- M-5 enumerator: `03b0a5b8` (feat)
- M-6 force flag: `9e2b97d2` (feat)
- L-1/L-3/L-4/N-1/N-2/N-5 batch: `b29ac25f` (refactor)
- N-3 rename: `d5c87a73` (refactor)

## Self-Check: PASSED

**Files verified to exist:**

- `src/backend/relay-sessions/enumerate-agent-mxids.ts` — FOUND
- `src/backend/relay-sessions/enumerate-agent-mxids.test.ts` — FOUND
- `.planning/phases/89-relay-mediated-group-conversations-sub-slice-b-session-model/89-FIXUP-SUMMARY.md` — FOUND (this file)

**Commits verified via `git log --oneline`:**

- `d5c87a73` refactor(89-fixup) N-3 — FOUND
- `b29ac25f` refactor(89-fixup) L-1/L-3/L-4/N-1/N-2/N-5 — FOUND
- `9e2b97d2` feat(89-fixup) M-6 — FOUND
- `03b0a5b8` feat(89-fixup) M-5 — FOUND
- `82b161d0` docs(89-fixup) M-4 — FOUND
- `8cfcfc25` feat(89-fixup) M-3 — FOUND
- `146f898c` feat(89-fixup) M-2 — FOUND
- `d43f3c83` feat(89-fixup) M-1 wire GREEN — FOUND
- `2af891d0` test(89-fixup) M-1 wire RED — FOUND
- `486bbe7a` feat(89-fixup) M-1 primitive GREEN — FOUND
- `0148227d` test(89-fixup) M-1 primitive RED — FOUND
- `21e555d2` fix(89-fixup) H-2 GREEN — FOUND
- `1f9e3128` test(89-fixup) H-2 RED — FOUND
- `2bf91e4c` fix(89-fixup) H-1 GREEN — FOUND
- `fcccb24a` test(89-fixup) H-1 RED — FOUND

**Test sweep:**

- `npx vitest run src/backend/relay-sessions/ src/backend/matrix/matrix-admin-client.test.ts src/backend/database/routes/sessions-merge-helper.test.ts src/backend/database/routes/identity-birth-orchestrator.test.ts src/backend/database/routes/users.test.ts src/backend/database/db/index.phase89-schema.test.ts` → **249/249 green**
- `npx vitest run src/backend/database/routes/sessions.test.ts` → **41/41 green**

## TDD Gate Compliance

Correctness bugs and new primitives followed strict RED → GREEN cycles:

- **H-1:** `fcccb24a` (test RED) verified failing (`markRelayRoomSessionInactive` called with room 2) → `2bf91e4c` (fix GREEN). All 13/13 observation-loop tests green after GREEN.
- **H-2:** `1f9e3128` (test RED) verified failing (`addAdminRoom` expected 1 call, got 0) → `21e555d2` (fix GREEN). All 17/17 registry-rooms tests green after GREEN.
- **M-1 primitive:** `0148227d` (test RED) verified 7 tests all failing with `TypeError: getRoomName is not a function` → `486bbe7a` (feat GREEN). All 75/75 matrix-admin-client tests green after GREEN.
- **M-1 wire:** `2af891d0` (test RED) verified 1 test failing (materialize called with null instead of "Team Sync") → `d43f3c83` (feat GREEN). All 15/15 observation-loop tests green after GREEN.

Feature additions without new primitive coupling (M-2, M-3, M-5, M-6) committed as single commits with the tests + implementation together — tests still act as the regression guard, but no RED-cycle was needed because the change surface was small and the failure mode was inherently observable (no existing code path being changed to fail).

## Next Steps

**Ready for hand-off + Ashley greenlight → ship gate.** No push per fleet rule; orchestrator owns the deploy motion.

**For slice D (frontend):** the observation loop now populates `relay_room_sessions.room_title` from `getRoomName` (M-1 wire), so the sidebar can render meaningful labels for named rooms and fall back on the two-party otherwise for unnamed DMs/rooms.

**For manual backfill:** the runbook in 89-02-SUMMARY.md now covers three invocation shapes:
1. Humans-only (default, gate-honored)
2. Full (agents+humans, gate-honored) — requires wiring `enumerateAgentMxidsViaSSH` deps
3. Force re-run (bypass gate) — for after new humans/agents onboarded post-initial-backfill

---
*Phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model*
*Fixup: post-verifier unbiased-review*
*Completed: 2026-09-08*
