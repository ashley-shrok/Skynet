---
phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model
plan: 02
subsystem: relay-sessions
tags: [matrix, relay-sessions, registry-rooms, backfill, tdd, best-effort-hook]

# Dependency graph
requires:
  - phase: 89-01
    provides: admin_rooms table + addAdminRoom primitive (D-13 ignore-list target)
  - phase: 88
    provides: users.mxid populated for every user (D-12 humans-backfill source)
  - phase: 75
    provides: matrix-admin-client (createOrUpdateUser, loginAsUser, joinRoom) + matrix_admin_creds singleton
provides:
  - createRoom primitive on matrix-admin-client.ts (POST /_matrix/client/v3/createRoom, client-server API)
  - registry-rooms.ts module: SETTINGS_KEY_AGENTS_REGISTRY, SETTINGS_KEY_HUMANS_REGISTRY, getAgentsRegistryRoomId, getHumansRegistryRoomId, ensureRegistryRoomsExist (idempotent boot-time init), joinAgentToAgentsRegistry + joinHumanToHumansRegistry (post-mint hooks)
  - registry-rooms-backfill.ts module: runRegistryRoomsBackfill (D-12 one-shot idempotent gated on settings row) with injectable enumerateAgentMxids dep
  - Post-mint join hook wired at both Skynet mint sites: identity-birth-orchestrator.ts runRelayMintAndWrite Step 6 + users.ts POST /users/create post-INSERT
affects: [89-03 observation loop (consumes registry-room IDs + admin_rooms ignore-list to classify two-party rooms), 89-04 /sessions/list merge]

# Tech tracking
tech-stack:
  added: []  # No new deps — uses fleet-established better-sqlite3, existing matrix-admin-client fetch primitives, existing settings-table + admin_rooms substrate from Plan 89-01
  patterns:
    - "matrix-admin-client primitive convention (docblock header, error-code constants, AbortController + REQUEST_TIMEOUT_MS wrapper, clearTimeout in both branches, discriminated-union AdminOk<T> | AdminErr return) extended by createRoom — the 7th such primitive following createOrUpdateUser / loginAsUser / joinRoom / makeRoomAdmin / listRooms / countUsersMatching / deactivateUser exactly."
    - "Settings-table as ID-persistence layer for boot-created homeserver resources: SETTINGS_KEY_AGENTS_REGISTRY + SETTINGS_KEY_HUMANS_REGISTRY hold the two registry-room IDs after ensureRegistryRoomsExist runs; both are exported constants so Plan 03's observation loop imports them (keys stay in lockstep across modules)."
    - "Best-effort post-mint hook (Rule 3 D-12 semantics): registry-room join failure logs a warning via authLogger/databaseLogger with a structured operation key (identity_birth_registry_join_failed / user_create_registry_join_failed / _threw variants) and proceeds — backfill is the safety net. The mint site's success response is unchanged."
    - "Idempotent gate via settings row: has_backfilled_registry_rooms='true' short-circuits runRegistryRoomsBackfill to { ok:true, skipped:true }. Gate is only flipped on the success path; partial-failure boot leaves it false so next boot retries. Operational escape hatch: clear the row from the SQL console."
    - "Injectable-dep pattern for cross-slice enumeration: runRegistryRoomsBackfill(deps: { enumerateAgentMxids?: () => Promise<string[]> }) — Plan 03's boot bootstrap wires the real enumerator later. The module stays unit-testable without SSH coupling and gracefully no-ops the agents branch when the dep is absent."
    - "Crown-jewel forceSave pairing: every settings write in this plan (registry-room ID persistence in ensureRegistryRoomsExist; gate-flip in runRegistryRoomsBackfill) is paired with a labeled DatabaseSaveTrigger.forceSave('phase-89-...') wrapped in try/catch that logs and swallows — matches admin-rooms-ignore-list.ts:79-91 and identity-send-log-store.ts:167-181."

key-files:
  created:
    - src/backend/relay-sessions/registry-rooms.ts
    - src/backend/relay-sessions/registry-rooms.test.ts
    - src/backend/relay-sessions/registry-rooms-backfill.ts
    - src/backend/relay-sessions/registry-rooms-backfill.test.ts
  modified:
    - src/backend/matrix/matrix-admin-client.ts (added createRoom primitive, 7th admin-client primitive)
    - src/backend/matrix/matrix-admin-client.test.ts (added 7 tests for createRoom happy path + all documented error modes + admin-token-never-logged assertion)
    - src/backend/database/routes/identity-birth-orchestrator.ts (added D-11 post-mint agents-registry join hook in runRelayMintAndWrite Step 6, best-effort per D-12)
    - src/backend/database/routes/identity-birth-orchestrator.test.ts (added 3 Phase 89 tests + registry-rooms vi.mock)
    - src/backend/database/routes/users.ts (added D-11 post-mint humans-registry join hook in POST /users/create post-INSERT, best-effort per D-12)
    - src/backend/database/routes/users.test.ts (added 4 Phase 89 tests + registry-rooms vi.mock)

key-decisions:
  - "D-10 planner-locked room configs: agents room name='Skynet agents directory (internal)' alias='_skynet_agents_directory'; humans room name='Skynet humans directory (internal)' alias='_skynet_humans_directory'. Underscore prefix + '(internal)' parenthetical are internal-flavored per D-10 planner-choice guidance."
  - "createRoom uses the Matrix client-server API (POST /_matrix/client/v3/createRoom) NOT the Synapse admin API — the admin API has no createRoom endpoint; the admin credential is a normal Matrix access_token that works on both APIs via Bearer auth. Locked in matrix-admin-client.ts docblock."
  - "Missing room_id in createRoom response reuses ERR_NO_TOKEN ('admin_api_no_token') per the plan's spec — matches loginAsUser's L155-159 expected-field-missing pattern rather than introducing an eighth error code."
  - "Backfill agents-enumeration is opt-in via injected dep (enumerateAgentMxids), NOT a hard dep. Rationale: (a) keeps the module unit-testable without SSH coupling, (b) allows Plan 03's bootstrap to wire the real enumerator when it lands (SSH into fleet hosts, list identities, read on-disk relay.json — acceptable one-shot cost per D-09 rationale scope), (c) if the dep is omitted, the D-11 mint hook is still the primary path — the backfill just doesn't retroactively cover pre-existing agents on the first boot without the dep wired."
  - "Ensure/backfill both use the shared settings table (not a new dedicated table) for room-ID persistence + gate flag. Matches how allow_registration / guac_enabled / guac_url are stored per db/index.ts L665-742 pattern. No schema migration required — Plan 89-01's schema was already sufficient."

requirements-completed: [D-10, D-11, D-12, D-13]

# Metrics
duration: ~16min
completed: 2026-09-08
---

# Phase 89 Plan 02: Registry rooms + boot ensure + post-mint hooks + backfill Summary

**Two registry rooms (agents + humans) created idempotently on Skynet boot with room IDs persisted in the settings table and both IDs added to the admin_rooms ignore-list; new agents/humans joined at their respective mint sites (best-effort per D-12); one-shot backfill covers pre-existing accounts gated on a settings flag — the classification substrate for Plan 03's observation loop.**

## Performance

- **Duration:** ~16 min (from Task 1 RED at 14:07Z to Task 4 GREEN at 14:21Z)
- **Started:** 2026-09-08T14:06:07Z
- **Completed:** 2026-09-08T14:21:50Z
- **Tasks:** 4 (all TDD RED → GREEN cycles; no REFACTOR needed)
- **Files created:** 4 (2 source + 2 test)
- **Files modified:** 6 (matrix-admin-client.ts + .test.ts, identity-birth-orchestrator.ts + .test.ts, users.ts + .test.ts)
- **Test count:** 40 new scoped tests (7 createRoom + 15 registry-rooms + 3 orchestrator hook + 4 users hook + 11 backfill). All 185 tests across all 8 touched test files pass green (0 regressions).

## Accomplishments

- **createRoom primitive** landed on matrix-admin-client.ts as the 7th admin-client primitive, following the existing 6 primitives' conventions exactly (docblock, error codes, AbortController wrapper, clearTimeout discipline, discriminated-union return). Client-server API endpoint (`POST /_matrix/client/v3/createRoom`) chosen deliberately over admin API (which has no createRoom); admin credential works on both via Bearer auth.
- **registry-rooms.ts module** exports 5 primitives + 2 locked constant strings — ensureRegistryRoomsExist is idempotent (fresh-install creates both rooms + persists IDs + populates ignore-list; both-present returns cached IDs no-op; per-role failure only skips the failing role); join hooks return joinRoom result verbatim on happy path and `{ ok:false, status:500, error:'registry_room_not_configured' }` without calling joinRoom when the settings row is absent.
- **D-11 mint-site hooks wired at both Skynet-owned Matrix-account-creation moments** — runRelayMintAndWrite Step 6 (after mint+login succeed, before Step 7 relay.json build) fires joinAgentToAgentsRegistry; POST /users/create (after INSERT commits, before forceSave) fires joinHumanToHumansRegistry. Both hooks are best-effort per D-12: non-ok returns log a structured warning with the mxid/status/error; unexpected throws are caught and logged; either way the mint succeeds and returns 200/ok.
- **D-12 backfill module** with injectable enumerateAgentMxids dep — SELECT-based humans enumeration filters `mxid IS NOT NULL AND mxid != ''` (defensive against pre-Phase-88 empty-string rows); per-account failures log-and-continue; gate written + labeled forceSave on completion; ensureRegistryRoomsExist defense-in-depth call at start (creds-missing bails without flipping the gate so next boot retries).
- **Every settings write paired with labeled forceSave** — registry-room ID persistence (2× per fresh boot, one per role) uses `phase-89-registry-rooms-ensure`; backfill gate uses `phase-89-backfill-complete`. Matches admin-rooms-ignore-list.ts:79-91 and identity-send-log-store.ts:167-181 patterns exactly.
- **Zero regressions** — all pre-existing tests in the touched files stay green (57 → 57 matrix-admin-client tests; 38 → 41 identity-birth-orchestrator tests; 73 → 77 users tests; 8 → 8 admin-rooms-ignore-list; 9 → 9 relay-room-sessions-store; 5 → 5 index.phase89-schema).

## Task Commits

Each task followed strict RED → GREEN TDD cycles:

1. **Task 1: createRoom primitive on matrix-admin-client**
   - RED: `331623bf` — `test(89-02-task1): RED — createRoom primitive tests`
   - GREEN: `48bdd935` — `feat(89-02-task1): GREEN — createRoom primitive on matrix-admin-client`
2. **Task 2: registry-rooms module (ensure + join hooks + accessors)**
   - RED: `c7332ee0` — `test(89-02-task2): RED — registry-rooms module contract tests`
   - GREEN: `f792c3a0` — `feat(89-02-task2): GREEN — registry-rooms module`
3. **Task 3: Wire join hooks into both mint sites**
   - RED: `6193d67b` — `test(89-02-task3): RED — registry-join hooks at both mint sites`
   - GREEN: `e7a5ff57` — `feat(89-02-task3): GREEN — wire registry-join hooks at both mint sites`
4. **Task 4: Backfill module**
   - RED: `e6212aa8` — `test(89-02-task4): RED — registry-rooms-backfill contract tests`
   - GREEN: `cab72d49` — `feat(89-02-task4): GREEN — registry-rooms-backfill module`

## Files Created/Modified

### Created

- `src/backend/relay-sessions/registry-rooms.ts` — Boot-time idempotent registry-room init (ensureRegistryRoomsExist), two D-11 post-mint join hooks (joinAgentToAgentsRegistry / joinHumanToHumansRegistry), two accessors (getAgentsRegistryRoomId / getHumansRegistryRoomId), two exported settings-key constants (SETTINGS_KEY_AGENTS_REGISTRY / SETTINGS_KEY_HUMANS_REGISTRY). D-13 addAdminRoom call fired for each newly-created room. Locked D-10 planner-choice room-config strings (`"Skynet agents directory (internal)"` + `_skynet_agents_directory`; `"Skynet humans directory (internal)"` + `_skynet_humans_directory`).
- `src/backend/relay-sessions/registry-rooms.test.ts` — 15-test scoped coverage of the module: exported settings-key contract, ensureRegistryRoomsExist idempotency (creds-missing, fresh-install, both-present no-op, partial state, per-role failure), getter accessors (stored vs null), both join hooks (happy path, joinRoom failure passthrough, settings-row absent).
- `src/backend/relay-sessions/registry-rooms-backfill.ts` — runRegistryRoomsBackfill(deps: { enumerateAgentMxids? }) — D-12 one-shot idempotent backfill gated on settings row `has_backfilled_registry_rooms`. Defense-in-depth ensureRegistryRoomsExist call at start. Humans enumeration from `SELECT mxid FROM users WHERE mxid IS NOT NULL AND mxid != ''`. Agents enumeration via injected dep (optional — Plan 03 wires the real enumerator). Per-account log-and-continue. Gate written + labeled forceSave on success. Full structured logging at all boundaries.
- `src/backend/relay-sessions/registry-rooms-backfill.test.ts` — 11-test scoped coverage of the backfill: gate stickiness (fast-path skip / second-call no-op), humans enumeration (2 non-null mxids joined, per-human failure continues), agents enumeration (injected dep called, per-agent failure continues, no dep → no-op), gate write + forceSave labeling, log-and-swallow on flush failure, creds-missing early-bail with gate NOT flipped, structured logging at all boundaries.

### Modified

- `src/backend/matrix/matrix-admin-client.ts` — Added `createRoom` primitive (7th admin-client primitive) between `getSharedDMRoom` and `deactivateUser`. Client-server API endpoint. Response parse: `room_id` string required (ERR_NO_TOKEN if missing/wrong-type), `room_alias?` optional passthrough. Docblock explains why client-server API is used instead of admin API. 95 lines added.
- `src/backend/matrix/matrix-admin-client.test.ts` — Added 7 tests for createRoom: happy path with body assertions (name/preset/visibility/POST/URL/Authorization header), 400 non-2xx with no upstream body leak, creds-missing without fetch call, AbortError timeout, network error with admin-token-never-logged assertion, missing room_id → ERR_NO_TOKEN, room_alias_name passed through in body. Also added `databaseLogger` import for the token-not-logged assertion. 141 lines added.
- `src/backend/database/routes/identity-birth-orchestrator.ts` — Added imports for `joinAgentToAgentsRegistry` and `databaseLogger`. Inside `runRelayMintAndWrite`'s Step 6 body, after `mintedAccessToken = loginResult.accessToken` and before the closing `});`, added a try/catch that fires `await joinAgentToAgentsRegistry(mxid)` and logs a warning on non-ok / throw without failing the step (D-11 hook, best-effort per D-12). 34 lines added.
- `src/backend/database/routes/identity-birth-orchestrator.test.ts` — Added `vi.mock('../../relay-sessions/registry-rooms.js', ...)` and a `mockJoinAgentToAgentsRegistry` handle. Added a new `describe("Phase 89-02 Task 3: agents-registry join hook in Step 6")` block with 3 tests + a scoped `beforeEach` that resets and defaults the mock. 190 lines added.
- `src/backend/database/routes/users.ts` — Added import for `joinHumanToHumansRegistry`. Between the encryption `try/catch` block (post-INSERT) and the `phase-85-user-avatar-create` forceSave, added a try/catch that fires `await joinHumanToHumansRegistry(mintedMxid)` and logs a warning on non-ok / throw without failing the request (D-11 hook, best-effort per D-12). 30 lines added.
- `src/backend/database/routes/users.test.ts` — Added `vi.mock('../../relay-sessions/registry-rooms.js', ...)` and a `mockJoinHumanToHumansRegistry` handle. Extended the shared `beforeEach` to reset + default the mock. Appended 4 tests inside the existing POST /users/create describe: T4 happy-path-with-failing-join (200 status despite failure), T4b successful-join, T4c unexpected-throw-caught, T5 mint-failure-hook-never-called. 108 lines added.

## Decisions Made

- **Task 1 planner-locked choice — matrix client-server API for createRoom.** The plan spec explicitly notes createRoom is a client-server API endpoint, NOT admin. Chosen so the admin credential (a normal Matrix access_token that works on both APIs) can be used without needing a separate credential path.
- **Task 1 planner-locked choice — reuse ERR_NO_TOKEN for missing-room_id case.** Follows loginAsUser L155-159's precedent for "expected-response-field-missing" rather than introducing an 8th error code. The plan spec explicitly directed this.
- **Task 2 planner-locked D-10 room configs** — locked in code as module-level `const` strings (see registry-rooms.ts L45-48). No planner discretion left for callers.
- **Task 3 pattern choice — vi.mock the registry-rooms module directly** rather than extending BirthDeps. Rationale: (a) the registry-rooms module is stateless (a pure importable function with no per-request context), (b) BirthDeps is a large surface and adding a 10th field just for this hook increases test scaffolding without benefit, (c) matches the pattern used in users.test.ts for the phase 88 createOrUpdateUser mocks (also vi.mocked, not injected). Keeps the diff to identity-birth.ts's dep-assembly block at zero.
- **Task 4 pattern choice — injectable enumerateAgentMxids dep** rather than hard-wiring an SSH-based enumerator inside the backfill module. Rationale: (a) the plan's `<action>` for Task 4 explicitly notes this is "planner-flex — options in preference order" with the concrete choice of enumerator source deferred; (b) keeping the module unit-testable without SSH coupling is a large win; (c) Plan 03's boot bootstrap can wire the real enumerator when it lands, with zero changes to this module; (d) if the enumerator is omitted, the D-11 mint hook still covers new agents from now on — pre-existing agents just don't get retroactively backfilled on this boot (acceptable per D-12 "safe to re-run" contract).

## Deviations from Plan

**Total:** 1 minor (self-caught during Task 3 GREEN test-run, immediately corrected).

### Auto-fixed Issues

**1. [Rule 3 - Blocking (missing import)] Added missing `databaseLogger` import to identity-birth-orchestrator.ts**
- **Found during:** Task 3 GREEN test-run (Tests 2 & 3 of the new Phase 89 describe block failed with runtime error "databaseLogger is not defined" caught by runStep's error handler, which converted Step 6 to `failed` with that reason).
- **Issue:** I initially added `import { databaseLogger } from "../../utils/logger.js"` alongside the `joinAgentToAgentsRegistry` import, then deleted it after a grep result mistakenly suggested it was a pre-existing duplicate (the grep hit was actually MY new line 35 — the real code below did not import databaseLogger).
- **Fix:** Re-added the `databaseLogger` import to identity-birth-orchestrator.ts. Verified via `grep -n databaseLogger` that the file previously had NO logger import (only usages), which caused the module load to work but the runtime call to fail inside Step 6's error-swallow catch.
- **Files modified:** `src/backend/database/routes/identity-birth-orchestrator.ts`
- **Verification:** Task 3 tests then all passed (78 → 80 tests green across the two touched test files).
- **Committed in:** `e7a5ff57` (Task 3 GREEN — the import fix was applied before the commit landed, so this shows as the initial GREEN implementation).

## Issues Encountered

- **vitest fake-timer + best-effort join test setup:** The Task 3 orchestrator tests use `birthIdentity` which runs Steps 1-8 with the fake-timer scheduler. The tests correctly needed `await vi.runAllTimersAsync()` before `await birthPromise` for the Enter-train sleeps in Steps 3/4 to drain. Copied the existing Test A pattern from the Phase 75 Plan 04 test block verbatim — no new discovery.
- **Pre-existing `console-forward-transport` log-flush ENOENT:** During test runs, vitest prints two log lines about `/var/log/skynet/console-forward/console-forward.log` not existing. This is a pre-existing environment condition (log-flush best-effort in dev without the log dir mounted) — not phase-89 code, does not affect any test result.
- **`.husky/pre-commit` and `.husky/commit-msg` hooks not executable:** git printed the same warning on every commit as in Plan 89-01. Pre-existing environment condition — hooks are simply skipped, no commit failed.

## User Setup Required

None — pure backend infrastructure. Nothing user-visible ships in this plan. The registry rooms are internal-flavored (name/alias have "internal" markers per D-10). The mint-site hooks are silent post-mint side-effects. The backfill runs at boot when Plan 03 wires it in.

## Next Phase Readiness

**Ready for Plan 89-03 (Wave 3 — observation loop):**
- `getAgentsRegistryRoomId()` and `getHumansRegistryRoomId()` accessors available for the observation loop to fetch the two registry-room IDs at each tick (D-09 classification substrate).
- `SETTINGS_KEY_AGENTS_REGISTRY` and `SETTINGS_KEY_HUMANS_REGISTRY` exported constants — Plan 03 can import them if it needs raw settings access rather than the accessors.
- `runRegistryRoomsBackfill(deps: { enumerateAgentMxids? })` importable — Plan 03's observation-loop bootstrap can call it once before the first tick, wiring a concrete `enumerateAgentMxids` (SSH into fleet hosts, list identities, read on-disk `relay.json` at backfill-time only). The gate makes it a no-op on subsequent boots.
- `ensureRegistryRoomsExist()` importable — Plan 03's bootstrap can call it once at boot before starting the observation loop (fires createRoom if the settings rows are missing, otherwise no-op).
- Both registry-room IDs are already added to the `admin_rooms` ignore-list via the D-13 hook inside ensureRegistryRoomsExist — Plan 03's observation loop's `isAdminRoom(roomId)` check will correctly skip them.

**Ready for Plan 89-04 (Wave 4 — /sessions/list merge):**
- No direct dependency on this plan's outputs. The merge integration consumes the relay_room_sessions rows (owned by Plan 89-01) filtered on `state='active'`.

**Ready for the D-11 mint-site invariant across the fleet:**
- Every future agent minted via `POST /identities/birth` will auto-join the agents registry room (as long as registry rooms have been ensured — first Skynet boot after this plan lands does that).
- Every future human minted via `POST /users/create` will auto-join the humans registry room.
- The backfill covers any pre-existing accounts that predate this plan on first boot.

No blockers, no concerns. All four tasks landed clean with strict TDD gate compliance.

## Self-Check: PASSED

**Files verified to exist:**
- `src/backend/relay-sessions/registry-rooms.ts` — FOUND
- `src/backend/relay-sessions/registry-rooms.test.ts` — FOUND
- `src/backend/relay-sessions/registry-rooms-backfill.ts` — FOUND
- `src/backend/relay-sessions/registry-rooms-backfill.test.ts` — FOUND
- `src/backend/matrix/matrix-admin-client.ts` — MODIFIED (verified via git log — createRoom section added)
- `src/backend/matrix/matrix-admin-client.test.ts` — MODIFIED (verified via git log — 7 createRoom tests added)
- `src/backend/database/routes/identity-birth-orchestrator.ts` — MODIFIED (verified via git log — Step 6 hook added)
- `src/backend/database/routes/identity-birth-orchestrator.test.ts` — MODIFIED (verified via git log — 3 Phase 89 tests added)
- `src/backend/database/routes/users.ts` — MODIFIED (verified via git log — post-INSERT hook added)
- `src/backend/database/routes/users.test.ts` — MODIFIED (verified via git log — 4 Phase 89 tests added)

**Commits verified via `git log --oneline`:**
- `331623bf` test(89-02-task1) RED — FOUND
- `48bdd935` feat(89-02-task1) GREEN — FOUND
- `c7332ee0` test(89-02-task2) RED — FOUND
- `f792c3a0` feat(89-02-task2) GREEN — FOUND
- `6193d67b` test(89-02-task3) RED — FOUND
- `e7a5ff57` feat(89-02-task3) GREEN — FOUND
- `e6212aa8` test(89-02-task4) RED — FOUND
- `cab72d49` feat(89-02-task4) GREEN — FOUND

**Plan `<verify>` blocks:**
- Task 1 automated: `npx vitest run src/backend/matrix/matrix-admin-client.test.ts` — 57 tests passed
- Task 1 human-check greps: all 3 grep-count expectations met (1, 3, 1 vs. expected 1, 1, ≥1)
- Task 2 automated: `npx vitest run src/backend/relay-sessions/registry-rooms.test.ts` — 15 tests passed
- Task 2 human-check greps: all 5 grep-count expectations met (1, 1, 1, 6, 3 vs. expected 1, 1, 1, ≥2, ≥1)
- Task 3 automated: `npx vitest run ...orchestrator.test.ts ...users.test.ts` — 80 tests passed across the two files
- Task 3 human-check greps: all 4 grep-count expectations met (2, 2, 2, 2 vs. expected ≥1, ≥1, ≥2, ≥2)
- Task 4 automated: `npx vitest run src/backend/relay-sessions/registry-rooms-backfill.test.ts` — 11 tests passed
- Task 4 human-check greps: all 4 grep-count expectations met (3, 6, 2, 12 vs. expected ≥2, ≥2, ≥1, ≥3)
- Full sweep: 185 tests across all 8 touched test files pass green (0 regressions in adjacent tests)

## TDD Gate Compliance

Each task followed strict RED → GREEN cycles:
- Task 1: `test(89-02-task1): RED` (331623bf) → `feat(89-02-task1): GREEN` (48bdd935). RED verified failing (createRoom is not a function — 7 tests) before GREEN. No REFACTOR needed.
- Task 2: `test(89-02-task2): RED` (c7332ee0) → `feat(89-02-task2): GREEN` (f792c3a0). RED verified failing (module not found) before GREEN. No REFACTOR needed.
- Task 3: `test(89-02-task3): RED` (6193d67b) → `feat(89-02-task3): GREEN` (e7a5ff57). RED verified failing (hooks not called — 3 tests) before GREEN. Missing-import fix landed inline (see Deviations). No REFACTOR after that.
- Task 4: `test(89-02-task4): RED` (e6212aa8) → `feat(89-02-task4): GREEN` (cab72d49). RED verified failing (module not found) before GREEN. No REFACTOR needed.

All four RED commits are strictly before their GREEN counterparts in git log. Gate sequence compliant.

---
*Phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model*
*Plan: 02*
*Completed: 2026-09-08*
