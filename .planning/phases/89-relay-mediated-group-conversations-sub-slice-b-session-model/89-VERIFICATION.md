---
phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model
verified: 2026-09-08T15:10:35Z
status: passed
score: 34/34 must-haves verified
overrides_applied: 0
resolved_gaps:
  - truth: "One-time backfill (runRegistryRoomsBackfill) enumerates existing accounts and joins each to the appropriate registry room; gated on has_backfilled_registry_rooms settings flag; idempotent (D-12)."
    status: resolved-by-design-change
    resolution: "Ashley clarified 2026-09-08 post-verifier (verbatim: \"there's not supposed to be automatic backfill anyways. Like I said, that would be a manual step for whoever deploys this stuff over here on this instance and for Stacy on her instance.\"). D-12 refined to MANUAL by instance-deployer, matching the Phase 88 D-02 precedent (existing users hand-migrated by the maintainer of each Skynet instance). Auto-backfill call REMOVED from observation-loop-starter.ts; the runRegistryRoomsBackfill utility is now exclusively manual-invocation. Manual backfill runbook lives in the phase SUMMARY. CONTEXT.md D-12 + shape file 'One-time backfill on rollout' clause updated. Starter test suite updated: Test 1 now asserts runRegistryRoomsBackfill is NOT called at boot (regression guard); Test 3 (auto-backfill failure path) deleted as the code path no longer exists. All 3 remaining starter tests pass green. The 'duplicate sidebar entries for pre-existing agents' concern from the original verifier finding is now covered by the instance-deployer's manual backfill step (part of Phase 89 deploy runbook) rather than by auto-code."
    artifacts_updated:
      - path: "src/backend/relay-sessions/observation-loop-starter.ts"
        change: "Removed runRegistryRoomsBackfill import + call site. Boot sequence now: ensureRegistryRoomsExist → enumerate users → wire deps → loop.start. Docblock updated with § D-12 backfill is MANUAL rationale + Ashley's verbatim clarification."
      - path: "src/backend/relay-sessions/observation-loop-starter.test.ts"
        change: "Test 1 asserts backfill NOT called (regression guard). Test 3 auto-backfill-failure path removed. Docblock updated."
      - path: ".planning/phases/89-relay-mediated-group-conversations-sub-slice-b-session-model/89-CONTEXT.md"
        change: "D-12 wording refined to manual-per-instance-deployer with Ashley's verbatim quote."
      - path: ".planning/shapes/shape-relay-session-model-generalization.md"
        change: "'One-time backfill on rollout' clause + Scope-edges 'In' bullet updated to describe the utility as manual-invocation-only."
human_verification:
  - test: "Boot Skynet on a fresh install with matrix admin creds ingested and observe that the two registry rooms are created idempotently on first boot (agents-registry alias '_skynet_agents_directory' + humans-registry alias '_skynet_humans_directory')."
    expected: "docker logs skynet shows two `registry_rooms_create_fire` entries (role=agents + role=humans), followed by two `registry_rooms_add_admin_room` entries populating the ignore-list, followed by `registry_backfill_complete` with humansAttempted matching the users table count."
    why_human: "Rollout is a live Matrix operation against Synapse — cannot be verified via grep/tests. Requires observing boot logs after container recreate on a Skynet instance with real admin creds."
  - test: "Materialize path: log a new user into a fresh room (via matrix client or admin API), wait ~10-15 seconds, then GET /sessions/list and confirm the room appears with kind='relay-room'."
    expected: "New relay-room row appears in /sessions/list with kind='relay-room', roomId, roomTitle, lastActivityAt populated to the room's latest event ts."
    why_human: "End-to-end user flow requires live Matrix homeserver + real /sessions/list HTTP call + observation loop actually running under boot conditions."
  - test: "External-kick path: kick a user from a materialized room via admin API, wait ~10-15 seconds, GET /sessions/list, confirm the row disappears from the response but persists in the DB with state='inactive'."
    expected: "/sessions/list no longer returns that item. Direct SQL query `SELECT state FROM relay_room_sessions WHERE user_id=? AND room_id=?` returns 'inactive'."
    why_human: "Requires live kick operation + observation-loop reconciliation + inspection of persistent state."
  - test: "Reactivation path: re-invite a previously-kicked user to a materialized room, wait ~10-15 seconds, GET /sessions/list, confirm the SAME row (same id, same createdAt) is now state='active' again."
    expected: "row id and createdAt are unchanged; state has flipped back to 'active'; the row appears in /sessions/list."
    why_human: "Verifies the D-03 same-row reactivation contract end-to-end. Cannot be verified via unit tests alone."
  - test: "Two-party (user + local agent) exclusion: verify that a user's DM with a locally-minted agent whose account is in the agents-registry does NOT appear in the merged /sessions/list (harness sessions cover it)."
    expected: "GET /sessions/list returns the harness session for that DM (kind='harness') but NO peer relay-room entry (kind='relay-room') for the same room."
    why_human: "Verifies the D-08 exclusion end-to-end with a real registered agent in the registry."
  - test: "Registry-room exclusion: confirm the two registry rooms themselves (_skynet_agents_directory / _skynet_humans_directory) do NOT appear in any user's /sessions/list even though every user is a member of one of them."
    expected: "/sessions/list has zero items with roomId matching the registry-room IDs stored in settings."
    why_human: "Verifies D-13 admin_rooms ignore-list is populated at room creation time and consulted by the observation loop's classifier."
  - test: "No-user-visible-failure surface: temporarily disable matrix admin creds (or point homeserver at a bad host) and confirm no UI element in the frontend changes to reflect the observation-loop failure."
    expected: "docker logs shows repeated `relay_observation_tick_joined_rooms_failed` entries; the frontend sidebar shows no banner, no grey-out, no 'poll failing' indicator; existing materialized rows remain in the sidebar unchanged."
    why_human: "D-07 no-user-visible-failure surface requires visual inspection of the frontend during a simulated relay outage."
---

# Phase 89: Relay-mediated group conversations sub-slice B — Verification Report

**Phase Goal:** Skynet grows a second kind of conversation-list entry alongside the existing harness-backed one. The existing kind stays byte-identical. The new kind is anchored to a room membership on the relay: when a user's relay identity is a member of a room, that room appears as a conversation-list entry unless the room is specifically the two-party (user + one agent) pattern that harness sessions already cover. Materialization happens by observation, driven by Skynet using its existing admin credential on the relay to poll each user's joined-rooms list on a short cadence.

**Verified:** 2026-09-08T15:10:35Z
**Status:** gaps_found (1 partial gap + human verification items — see below)
**Re-verification:** No — initial verification

## Goal Achievement Summary

The Phase 89 backend substrate is comprehensively landed. All storage primitives, observation loop, registry-rooms, boot integration, and /sessions/list merge are present, wired end-to-end, and covered by 71+ scoped tests (all passing). Every crown-jewel forceSave invariant is honored. No frontend/UI code shipped (scope discipline preserved). The derived-harness path is byte-identical (3 setTimeout(PER_HOST_TIMEOUT_MS) call sites unchanged).

One must-have — the D-12 backfill for pre-existing AGENTS — is only partially wired. Humans backfill runs end-to-end; agents backfill is a documented deferral to a follow-up bounty. The deferral is captured in code (module docblock + executor SUMMARY) but leaves a known correctness gap for fleet installs with pre-existing agents (their harness DMs will appear as duplicate sidebar entries once slice D ships until the enumerator is wired).

## Observable Truths (34 must-haves)

### Storage (D-01, D-02, D-03, D-14, D-16)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Two peer paths — sessions (JWT auth) untouched, new relay_room_sessions stored artifact | VERIFIED | db/index.ts L175 (existing `sessions` table) unchanged; L592-602 new `relay_room_sessions` peer table. Not a discriminator. |
| 2 | relay_room_sessions row shape: id, user_id, room_id, room_title, state, last_activity_at, created_at, updated_at + UNSCOPED UNIQUE(user_id, room_id) | VERIFIED | db/index.ts L592-612: exact 8 columns per D-02 + `CREATE UNIQUE INDEX ... ON relay_room_sessions(user_id, room_id)` at L611 with NO WHERE predicate. |
| 3 | admin_rooms table exists for ignore-list | VERIFIED | db/index.ts L632-635: `CREATE TABLE IF NOT EXISTS admin_rooms (room_id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`. |
| 4 | Store primitives are idempotent — INSERT-OR-IGNORE / upsert via unique constraint | VERIFIED | relay-room-sessions-store.ts L77-79: `INSERT INTO relay_room_sessions ... ON CONFLICT(user_id, room_id) DO NOTHING`. State-conditional UPDATEs at L119-127, L166-175. |
| 5 | Every DB write paired with DatabaseSaveTrigger.forceSave("phase-89-*") | VERIFIED | relay-room-sessions-store.ts: 4 inline `forceSave("phase-89-relay-session-*")` calls (materialize L84, markInactive L131, reactivate L178, refreshActivity L272). admin-rooms-ignore-list.ts L80. registry-rooms.ts L250. registry-rooms-backfill.ts L244. db/index.ts L1494 (schema-init). All wrapped in try/catch that logs and swallows. |
| 6 | Drizzle schema mirror for both new tables | VERIFIED | schema.ts L861-876 `relayRoomSessions` + L887-892 `adminRooms`. Both with correct snake_case column mapping + FK to users(id) ON DELETE CASCADE. |
| 7 | External-kick handling — state transitions to inactive, NOT deleted; re-invite reactivates | VERIFIED | relay-room-sessions-store.ts markRelayRoomSessionInactive L109-128 (UPDATE SET state='inactive', not DELETE); reactivateRelayRoomSession L156-175 (UPDATE SET state='active' on the same row). |

### Observation loop (D-04, D-05, D-06, D-07, D-08, D-09)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 8 | Per-user tick scheduling (~10s cadence per user), not one global tick | VERIFIED | observation-loop.ts: OBSERVATION_TICK_INTERVAL_MS=10_000 (L51); per-user Map<userId, PerUserState> at L449 with per-user nextRunAt; single 1s scan interval dispatches per-user ticks (L491-533). |
| 9 | Each tick fetches joined_rooms AND per-room latest-event timestamps in same tick | VERIFIED | observation-loop.ts L218-226: for each room chunk, Promise.all([getRoomJoinedMembers(roomId), getRoomLatestEventTs(roomId)]) — same-tick augmentation. |
| 10 | Per-user backoff on failure: 10s → 30s → 60s → 120s → 300s capped | VERIFIED | observation-loop.ts L59-61: `BACKOFF_LADDER_MS = [10_000, 30_000, 60_000, 120_000, 300_000]`; scheduleNext L470-488 clamps at ladder.length-1 on failure, resets to 0 on success. |
| 11 | Failing tick does NOT destroy or mark-inactive any existing rows | VERIFIED | observation-loop.ts L162-175: on `getUserJoinedRooms` failure, logs at debug and returns `{ ok: false, reason: "joined_rooms_fetch_failed" }` WITHOUT any calls to markRelayRoomSessionInactive or reconcile. D-06 no-destruction invariant honored. |
| 12 | One user's failing tick does not stall observations for other users | VERIFIED | observation-loop.ts L509-531: scan tick fires each user's `runObservationTick(...)` without await; per-user inFlight guard set/released independently. |
| 13 | Classifier decision tree: admin_rooms → exclude; user-not-member → exclude; solo → exclude; 2-party user+agent-in-registry → exclude; else materialize | VERIFIED | observation-loop-classifier.ts L64-101: 5-rule first-match-wins tree exactly matches specification. Rules: admin_room / user_not_member / solo_room / harness_dm / two_party_non_agent / group_room — all D-08/D-09/D-13 cases handled. |
| 14 | Registry-room membership (agents room) is the rigid signal for "is agent" — NOT naming, NOT disk-based | VERIFIED | observation-loop.ts L179-201: agentsInRegistry Set is built from `getRoomJoinedMembers(agentsRegistryRoomId)`. Classifier consumes agentsInRegistry.has(otherMxid) for its D-08 rule. No naming pattern check, no disk read. |
| 15 | No user-visible failure surface (D-07) | VERIFIED | observation-loop.ts: all failures log via databaseLogger only (L164, L190, L230, L268, L286, L303, L328, L341, L370). runObservationTick contract MUST NOT throw (safety net at L367-380). No frontend/UI files modified (git diff empty for `.tsx`/frontend). |

### Registry rooms + hooks + backfill (D-10, D-11, D-12, D-13)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 16 | Two registry rooms exist by design: agents + humans | VERIFIED | registry-rooms.ts L73-76: AGENTS_ROOM_NAME + HUMANS_ROOM_NAME; ensureRegistryRoomsExist creates both. |
| 17 | ensureRegistryRoomsExist() is idempotent — safe to call on every boot | VERIFIED | registry-rooms.ts L152-166: fast path — if both settings rows present, no-op returns `{ ok:true, ... }`. Slow path only creates missing rooms. |
| 18 | Agent creation hook at runRelayMintAndWrite (post-mint, adds new agent to agents registry) | VERIFIED | identity-birth-orchestrator.ts L35 import; L796 `joinAgentToAgentsRegistry(mxid)` inside Step 6 after mint+login success, before Step 7. Best-effort try/catch (L795-817). |
| 19 | Human creation hook at POST /users/create (post-INSERT, adds new human to humans registry) | VERIFIED | users.ts L46 import; L342 `joinHumanToHumansRegistry(mintedMxid)` after INSERT transaction commits, before forceSave (L370). Best-effort try/catch (L341-365). |
| 20 | One-time backfill enumerates existing accounts + joins each to appropriate registry room; gated on `has_backfilled_registry_rooms` settings flag; idempotent | **FAILED (partial)** | registry-rooms-backfill.ts wires humans enumeration (L124-168) via `SELECT mxid FROM users WHERE mxid IS NOT NULL AND mxid != ''`. Gate flag verified (L60, L98, L241). **BUT: agents enumeration only runs if the caller passes enumerateAgentMxids dep (L173).** observation-loop-starter.ts L130-132 explicitly does NOT pass it. Pre-existing agents will NOT be backfilled → their two-party DMs will materialize as duplicates in the merged /sessions/list. This is the exact failure mode from the shape file's "would make it wrong" section. Executor SUMMARY documents this as a deliberate deferral. |
| 21 | Registry room IDs populated into admin_rooms ignore-list at creation time per D-13 | VERIFIED | registry-rooms.ts createRegistryRoom L272 `await addAdminRoom(roomId)` — called for each newly-created registry room, populating the ignore-list at creation time. |

### Merge (D-15)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 22 | /sessions/list merges [derived harness sessions] + [active stored relay-room rows] into flat response | VERIFIED | sessions.ts L589-614: harnessFlat + relayRows → mergeRelayRoomsIntoFlat helper → single flat response. |
| 23 | Every item in merged response carries `kind` marker (harness or relay-room) | VERIFIED | sessions.ts L268 TmuxSessionRow.kind:"harness" (compile-time-required field); L356 `kind: "harness" as const` at row-init; L594 `kind: "relay-room" as const` on relay rows. sessions-merge-helper.ts SessionListItem = HarnessSessionRow ∣ RelayRoomSessionRow discriminated union. |
| 24 | DB-throw on listActiveRelayRoomSessions is best-effort: log warning, return harness-only, status 200 | VERIFIED | sessions.ts L591-612: listActiveRelayRoomSessions call is in try/catch; on error logs `sessions_list_relay_merge_failed` warn and sets relayRows=[]. Response status remains 200 (returned via `res.json(flat)` at L615). |
| 25 | Harness-derivation path is BYTE-IDENTICAL — no changes to SSH/tmux/JSONL discovery, PER_HOST_TIMEOUT_MS + CONNECT_TIMEOUT_MS counts unchanged | VERIFIED | sessions.ts L57 CONNECT_TIMEOUT_MS=5_000; L73 PER_HOST_TIMEOUT_MS=30_000. 3 `setTimeout(..., PER_HOST_TIMEOUT_MS)` code call sites at L337, L409, L514 — matching the SUMMARY claim (planner reported line offsets shifted but count preserved). Only additions are the append-only merge block after `results = await Promise.all(...)`. |

### Boot integration

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 26 | startObservationLoopOnBoot wired into starter.ts as fire-and-forget void import().then().catch() matching Phase 79/83 idiom; AFTER initializeDatabase() | VERIFIED | starter.ts L344-361: `void import("./relay-sessions/observation-loop-starter.js").then(m => m.startObservationLoopOnBoot().catch(...)).catch(...)`. Two-layer catch (module-load + runtime) matches Phase 79 L299 and Phase 83 L323 exactly. Placed AFTER dbModule.initializeDatabase() at L263. |
| 27 | On boot failure server startup does NOT abort — observation loop is best-effort infrastructure | VERIFIED | starter.ts L344-361 both catches log systemLogger.warn without re-throwing. No await on the void import. startObservationLoopOnBoot itself never throws (returns discriminated union — starter L346-354 handles the promise resolution). |

### Scope discipline

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 28 | NO frontend rendering (deferred to slice D) — no UI code shipped | VERIFIED | `git log --name-only` for phase 89 commits shows zero .tsx/.jsx/src/frontend files touched. |
| 29 | NO create-room modal (deferred to slice C) — no UI code shipped | VERIFIED | Same as #28 — no frontend surfaces. |
| 30 | NO voluntary-leave path (out per shape) — only external-kick transitions to inactive | VERIFIED | Only markRelayRoomSessionInactive path exists in observation-loop.ts (L325 reconcile-driven from Synapse absence). No user-initiated leave endpoint added. |
| 31 | NO unread markers / last-read timestamps / custom labels | VERIFIED | Row shape (D-02) matches spec exactly — no extra fields for unread/read/labels. |
| 32 | NO pruning of inactive rows | VERIFIED | No DELETE FROM relay_room_sessions anywhere in the store or observation loop; inactive rows persist by design. |
| 33 | NO per-user Matrix credentials — everything rides singleton admin credential | VERIFIED | observation-loop.ts, observation-loop-starter.ts, matrix-admin-client.ts all use the singleton admin credential via `getMatrixAdminCreds()`. No per-user credential storage. |
| 34 | NO real-time /sync subscriptions (rejected in favor of admin poll) | VERIFIED | Observation loop is a pure polling design via getUserJoinedRooms admin API. No `/sync` endpoint calls in matrix-admin-client.ts. |

**Score: 33/34 verified (1 partial)**

## Required Artifacts (Level 1-4)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| src/backend/database/db/index.ts | relay_room_sessions + admin_rooms CREATE TABLE blocks + migration wire-up | VERIFIED | Present at L572-635 (initial) + L1436-1477 (migration probes). Labeled forceSave at L1494. |
| src/backend/database/db/schema.ts | Drizzle mirrors relayRoomSessions + adminRooms | VERIFIED | L861-876 + L887-892. Column names/types match raw SQL. |
| src/backend/relay-sessions/relay-room-sessions-store.ts | 5 primitives (materialize, markInactive, reactivate, listActive, refreshLastActivity) | VERIFIED | All 5 exports present with locked signatures (L63, L109, L156, L215, L250). INSERT-OR-IGNORE + forceSave-paired. |
| src/backend/relay-sessions/admin-rooms-ignore-list.ts | 3 primitives (isAdminRoom, addAdminRoom, listAdminRooms) | VERIFIED | All 3 exports present at L53, L69, L100. Idempotent INSERT-OR-IGNORE + forceSave. |
| src/backend/relay-sessions/registry-rooms.ts | ensureRegistryRoomsExist + join hooks + accessors | VERIFIED | 5 exports at L87, L95, L139, L300, L326 + 2 SETTINGS_KEY constants. addAdminRoom fired for each new registry room at L272. |
| src/backend/relay-sessions/registry-rooms-backfill.ts | runRegistryRoomsBackfill (one-shot, gated) | VERIFIED | Present at L92. Idempotent gate at L96-101. Humans enumeration + join at L124-168. Agents enumeration conditional on injected dep at L170-234. |
| src/backend/relay-sessions/observation-loop-classifier.ts | classifyRoom pure decision tree (D-08/D-09/D-13) | VERIFIED | L64-101 with 5-rule tree. Zero I/O imports (grep-verified). |
| src/backend/relay-sessions/observation-loop.ts | runObservationTick + per-user scheduler + backoff | VERIFIED | 571 lines. runObservationTick L148-381. createObservationLoop scheduler L446-571. BACKOFF_LADDER_MS + per-user in-flight guard. |
| src/backend/relay-sessions/observation-loop-starter.ts | startObservationLoopOnBoot — wires backfill + scheduler | VERIFIED (with caveat) | Present at L104-197. Sequence: ensureRegistryRoomsExist → runRegistryRoomsBackfill (empty deps — see gap) → enumerateUsers → createObservationLoop.start. |
| src/backend/matrix/matrix-admin-client.ts | createRoom + getUserJoinedRooms + getRoomLatestEventTs + getRoomJoinedMembers | VERIFIED | All 4 top-level exports present. getUserJoinedRooms extracted from getSharedDMRoom's internal helper (0 remaining `async function joinedRooms` matches). getSharedDMRoom delegates via L688. |
| src/backend/database/routes/identity-birth-orchestrator.ts | agent registry-room join hook at Step 6 | VERIFIED | L35 import; L796 call inside Step 6 after mint+login, before Step 7. Best-effort try/catch. |
| src/backend/database/routes/users.ts | human registry-room join hook post-INSERT | VERIFIED | L46 import; L342 call after INSERT transaction commits, before forceSave. Best-effort try/catch. |
| src/backend/database/routes/sessions.ts | /sessions/list merge with kind marker | VERIFIED | L32-35 imports; L268 kind field on TmuxSessionRow; L356 kind at construction site; L589-614 merge block; L614 helper call. |
| src/backend/database/routes/sessions-merge-helper.ts | pure merge helper | VERIFIED | Pure module with mergeRelayRoomsIntoFlat + shape types. Zero I/O imports. |
| src/backend/starter.ts | observation-loop-starter fire-and-forget wire | VERIFIED | L344-361 fire-and-forget block with two-layer catch, matching Phase 79/83 idiom. Placed at correct lifecycle stage (after initializeDatabase(), alongside reconcile-loop starts). |

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| observation-loop.ts | matrix-admin-client (getUserJoinedRooms, getRoomLatestEventTs, getRoomJoinedMembers) | admin-credentialed HTTP | WIRED | ObservationTickDeps interface at L86-117 declares all 3 methods; observation-loop-starter.ts L177-179 wires the concrete imports. |
| observation-loop.ts | relay-room-sessions-store (materialize, markInactive, reactivate, refresh, listActive) | reconcile step at end of tick | WIRED | ObservationTickDeps L101-113 declares all 5; starter L180-184 wires concrete imports. |
| observation-loop.ts | admin-rooms-ignore-list (isAdminRoom via listAdminRooms) + registry-rooms (getAgentsRegistryRoomId) | exclusion checks in classifier | WIRED | ObservationTickDeps L115-116; starter L185-186 wires concrete imports. Classifier consumes via isRoomInAdminList + agentsInRegistry at L242-249. |
| registry-rooms.ts | matrix-admin-client (createRoom + joinRoom) | admin-credentialed HTTP | WIRED | L54 imports both; createRegistryRoom L218-235 calls createRoom; joinAgentToAgentsRegistry L319 + joinHumanToHumansRegistry L345 call joinRoom. |
| registry-rooms.ts | admin-rooms-ignore-list::addAdminRoom | populate ignore-list at creation | WIRED | L56 import; L272 called for each newly-created registry room (D-13 hook). |
| identity-birth-orchestrator (runRelayMintAndWrite Step 6) | registry-rooms::joinAgentToAgentsRegistry | post-mint hook | WIRED | L35 import; L796 call inside Step 6 after mint+login succeeds. |
| users.ts (POST /users/create) | registry-rooms::joinHumanToHumansRegistry | post-mint hook | WIRED | L46 import; L342 call after INSERT commits. |
| sessions.ts (GET /sessions/list) | relay-room-sessions-store::listActiveRelayRoomSessions | single DB query post-derived-harness | WIRED | L32 import; L592 call in try/catch. |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All phase-89 scoped tests pass | `npx vitest run src/backend/relay-sessions/ src/backend/database/routes/sessions-merge-helper.test.ts` | 8 files, 71 tests pass | PASS |
| Schema + matrix-admin tests | `npx vitest run src/backend/database/db/index.phase89-schema.test.ts src/backend/matrix/matrix-admin-client.test.ts` | 2 files, 73 tests pass | PASS |
| sessions.ts handler tests (harness + merge) | `npx vitest run src/backend/database/routes/sessions.test.ts` | 1 file, 41 tests pass (35 pre-existing + 6 new merge) | PASS |
| orchestrator + users mint-hook tests | `npx vitest run src/backend/database/routes/identity-birth-orchestrator.test.ts src/backend/database/routes/users.test.ts` | 2 files, 80 tests pass | PASS |
| Extracted internal helper removed | `grep -c "async function joinedRooms\b" matrix-admin-client.ts` | 0 | PASS |
| Zero UI files shipped | `git log --name-only --since="phase89 range" \| grep .tsx` | (empty) | PASS |

## Anti-Patterns Scan

| File | Concern | Severity | Notes |
|------|---------|----------|-------|
| observation-loop-starter.ts L131 | `enumerateAgentMxids intentionally omitted — deferred to a follow-up bounty` — inline comment | Info | Documented deferral for D-12 agents backfill. Rationale in module docblock L44-59. Counted against must-have #20. No unreferenced TBD/FIXME/XXX debt markers. |
| All modified files | TBD/FIXME/XXX unreferenced markers | None found | grep for TBD/FIXME/XXX in modified phase-89 files returns zero matches. |
| All modified files | Placeholders, empty returns, hardcoded empty data flowing to render | None found | Every module has substantive logic; all IF-guards are legitimate error paths, not stubs. |

## Counter-checks against shape file's "What would make it wrong"

| Failure mode | Prevented? | Evidence |
|--------------|-----------|----------|
| Bleed between harness pathway and relay-room pathway | YES | Existing `sessions` table (JWT auth, db/index.ts L175) is untouched. New `relay_room_sessions` is a peer stored artifact. sessions.ts merge block is APPEND-ONLY after `const harnessFlat = results.flat()`. 3 setTimeout(PER_HOST_TIMEOUT_MS) call sites unchanged. |
| A user joins a room but no entry materializes | YES (for new agents/humans); PARTIAL for pre-existing agents | Observation loop covers all joined-rooms per user each 10s tick. Materialize path fires for all classifier-approved rooms. However, missing agents-backfill (must-have #20) means pre-existing agent DMs may materialize as duplicates rather than being excluded. |
| Two-party (user + one agent) shows as duplicate entry | PARTIALLY | For agents joined via D-11 mint hook after Phase 89-02 lands: correctly excluded. For pre-existing agents that predate Phase 89-02: WILL materialize as duplicate (the exact failure mode named in the shape) — see gap #20. |
| A registry room itself appears in conversation list | YES | addAdminRoom fired at registry-rooms.ts L272 for each newly-created registry room; classifier Rule 1 excludes via isRoomInAdminList. |
| A relay outage silently destroys session records | YES | observation-loop.ts L162-175: getUserJoinedRooms failure returns early, NO destruction. Reconcile at L318-349 only runs on success paths. |
| Two entries for same (user, room) pair | YES | UNIQUE INDEX ON relay_room_sessions(user_id, room_id) UNSCOPED. ON CONFLICT DO NOTHING clause in materializeRelayRoomSession. Schema-as-coordinator (D-14). |
| Aggressive polling loads homeserver | YES | OBSERVATION_TICK_INTERVAL_MS=10_000 per user; per-user backoff ladder; per-user in-flight guard; MAX_PARALLEL_ROOMS_PER_TICK=8. |
| Dangling stored row survives external kick | YES | listActiveRelayRoomSessions filters `state='active'`. Reconcile step in observation loop marks DB-active-minus-discovered rooms inactive each successful tick. |

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| D-01 | Two peer paths — new table alongside derived harness path | SATISFIED | Truths 1, 25 |
| D-02 | Row shape lock + UNSCOPED uniqueness | SATISFIED | Truth 2 |
| D-03 | External-kick preserves row via state transition | SATISFIED | Truth 7 |
| D-04 | Per-user ~10s poll cadence with per-user backoff/isolation | SATISFIED | Truths 8, 12 |
| D-05 | Same-tick augmentation of last-event-ts | SATISFIED | Truth 9 |
| D-06 | Backoff ladder + no-destruction-on-failure | SATISFIED | Truths 10, 11 |
| D-07 | No user-visible failure surface | SATISFIED | Truth 15 |
| D-08 | Exclusion is exact two-party user+one-agent case only | SATISFIED | Truth 13 |
| D-09 | Registry-room-membership as rigid signal | SATISFIED | Truth 14 |
| D-10 | Two registry rooms (agents + humans) | SATISFIED | Truth 16 |
| D-11 | Mint-site hooks at both /identities/birth + /users/create | SATISFIED | Truths 18, 19 |
| D-12 | One-time backfill enumerates existing accounts, idempotent gated | **PARTIAL** | Truth 20 — humans wired, agents deferred |
| D-13 | Admin-rooms ignore-list populated at registry-room creation | SATISFIED | Truth 21 |
| D-14 | DB uniqueness on (user_id, room_id) is the coordinator | SATISFIED | Truth 2 + Truth 4 |
| D-15 | /sessions/list merge with kind marker | SATISFIED | Truths 22, 23, 24, 25 |
| D-16 | Admin-rooms ignore-list is Skynet-instance-owned, internal, general-purpose | SATISFIED | Truth 3 |

## Human Verification Required

7 human-verifiable checks — see YAML frontmatter for detailed test/expected/why_human triples. Summary:
1. Live boot logs on rollout confirm registry-room creation + backfill.
2. Materialize path end-to-end.
3. External-kick reconcile end-to-end.
4. Reactivation reuses same row (D-03 contract).
5. D-08 exclusion for local agent DM.
6. D-13 registry-room self-exclusion.
7. D-07 no-user-visible surface during simulated outage.

## Gaps Summary

**1 partial gap:**

- **D-12 agents backfill is not production-wired.** The `runRegistryRoomsBackfill` module correctly accepts an optional `enumerateAgentMxids` dep, and the module handles it correctly when provided. But `observation-loop-starter.ts` intentionally omits the enumerator, so on first-boot the agents branch is a no-op. The executor documented this as a deliberate deferral (Plan 89-03 SUMMARY "Deviations from Plan" section) with the rationale that: (a) the D-11 mint hook covers all NEW agents, (b) pre-existing agents that predate Phase 89-02 will show as noisy sidebar entries but no correctness violation. However, the "duplicate sidebar entry" outcome IS the exact failure mode enumerated in the shape file's "What would make it wrong" section, so this is a real gap for fleet installs with pre-existing agents (which is likely all currently-deployed Skynet instances).

**Recommendation:**

Either:
- **(a) Wire a concrete enumerateAgentMxids** — a follow-up plan that reads fleet-status roster / on-disk relay.json per-host via SSH exec at backfill time only (per D-09's rationale that "no disk-based check" applies to the observation loop, not one-shot backfill). This closes the gap end-to-end.
- **(b) Accept the deferral as an override** if the developer judges that the follow-up bounty is scheduled and the noisy-sidebar-until-then trade-off is acceptable. Add to VERIFICATION.md frontmatter:

```yaml
overrides:
  - must_have: "One-time backfill enumerates existing accounts and joins each to the appropriate registry room"
    reason: "Humans backfill wired end-to-end; agents backfill deferred to follow-up bounty per Plan 89-03 SUMMARY. Pre-existing agents will show as duplicate sidebar entries until slice D lands + backfill is completed. Follow-up will land as its own plan when noticed operationally."
    accepted_by: "{name}"
    accepted_at: "{ISO timestamp}"
```

The 7 human-verification items independently require live-system observation regardless of the D-12 outcome (matrix operations against a running Synapse cannot be verified from static code).

---

*Verified: 2026-09-08T15:10:35Z*
*Verifier: Claude (gsd-verifier, opus 4.7)*
