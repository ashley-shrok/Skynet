# Phase 89: Relay-mediated group conversations sub-slice B — session-model generalization + room-join materialization - Context

**Gathered:** 2026-09-08
**Status:** Ready for planning

> **Seeded from shape file** per `/build` convention — the shape file (`.planning/shapes/shape-relay-session-model-generalization.md`) already locked all the decisions below via a walked-one-at-a-time `/open` conversation with Alice (2026-09-08, all greenlit `thumbs up`). This CONTEXT.md is the discuss-phase artifact that translates those decisions into a form downstream agents (researcher, planner) can act on without re-asking. Read the shape file for the fuller narrative; this file is the actionable extract.

<domain>
## Phase Boundary

Skynet grows a second kind of conversation-list entry, sitting alongside the existing harness-backed one. The existing kind — a session backed by a driving harness (a Claude Code process running in a tmux on some host, derived at request time by SSH-polling that host) — stays exactly as it is today. The new kind is anchored to a room membership on the relay: when a user's relay identity is a member of a room, that room appears as an entry in the user's conversation list, unless the room is specifically the two-party (user + one agent) pattern that harness sessions already cover.

Materialization happens by observation, driven by Skynet using its existing admin credential on the relay to poll each user's joined-rooms list on a short cadence. Membership changes flow into a small stored table of relay-room entries which the conversation-list endpoint merges with the derived harness sessions before returning.

**What ships here:** all the backend substrate above — schema, primitives, observation loop, registry rooms, backfill, admin-rooms ignore-list, merge integration. **Nothing user-visible ships in this slice** — pane rendering of a relay-room session arrives in slice D, the create-room modal arrives in slice C.

**Scope anchor:** slice B ONLY adds NEW code alongside the existing harness pathway. It does NOT modify the derived-at-request-time harness path (which stays byte-identical), does NOT reify harness sessions into stored records, does NOT introduce per-user Matrix sync clients, and does NOT touch agent identity provisioning beyond adding a registry-room join hook at Skynet's existing account-creation moment.

</domain>

<decisions>
## Implementation Decisions

All 16 decisions below were walked one-at-a-time with Alice during the `/open` conversation for this shape (2026-09-08). Each was greenlit `thumbs up` before advancing. The shape file's `## Shape` and `## Philosophy` sections are the fuller narrative; below is the actionable extract.

### Storage — two peer paths, not a discriminator

- **D-01: Two peer paths, not a discriminated single record.** Skynet has no stored session-record table for harness sessions today — the conversation list is derived at request time by SSH-polling hosts and enumerating tmux + on-disk session state. That derived pathway stays completely intact. The new relay-room kind gets its own new small stored table (rows anchored to `(user, room)`). The `/sessions/list` endpoint gains a merge step: [derived harness sessions] + [active stored relay-room rows] → one flat list back to the frontend. NO discriminator column added to any existing table.

- **D-02: Row shape.** New table columns: `id` (TEXT PRIMARY KEY, UUID), `user_id` (TEXT NOT NULL, FK to users), `room_id` (TEXT NOT NULL — the Matrix room ID on the relay), `room_title` (TEXT — display name pulled from the room's Matrix state), `state` (TEXT NOT NULL, values `active` | `inactive`), `last_activity_at` (TEXT — ISO timestamp of the room's latest event, refreshed each poll tick), `created_at` (TEXT, default CURRENT_TIMESTAMP), `updated_at` (TEXT, default CURRENT_TIMESTAMP). **UNIQUE constraint on `(user_id, room_id)`** — NOT scoped to active-only, because re-invite reactivation reuses the same row rather than creating a new one.

- **D-03: External-kick handling — state transition, row preserved.** When a user is no longer a member of a room the stored table has an active row for, the row transitions to `inactive` state — it is NOT deleted. Listing endpoints filter on `state = 'active'`. Keeping the row preserves history navigation and lets a re-invite flip the same row back to active rather than needing a new row (which is what preserves the unscoped uniqueness constraint from D-02). Voluntary leave is NOT v1 per the master shape — the only path to inactive is external kick.

### Observation loop

- **D-04: Poll cadence and scheduling.** Skynet uses its existing Matrix admin credential (`matrix-admin-client.ts` primitives + `matrix_admin_creds` singleton) to poll each user's joined-rooms list on a short cadence targeting ~10s per user. Per-user tick scheduling (not one global tick for all users) with per-user backoff state. One user's failing tick does NOT stall observations for other users.

- **D-05: Same-tick augmentation.** Each observation-loop tick, alongside asking "what rooms is user X in," ALSO asks the homeserver "what's the latest event timestamp for each of those rooms." Row's `last_activity_at` refreshes each tick so the sidebar sort by real recency stays accurate, not just tracking membership transitions. Cost is bounded — small number of rooms per user, all queries local to the co-located Synapse.

- **D-06: Failure semantics — no destruction on failure, backoff + reconcile.** A failing poll tick DOES NOT destroy or mark-inactive any existing session records. Absence of observation is not evidence the user left the rooms. The tick backs off (10s → 30s → 60s, capped at ~5 min), retries. When a tick eventually succeeds, that tick reconciles — new memberships materialize, missing memberships transition to inactive. Sidebar shows what it last saw during the outage.

- **D-07: No user-visible failure banners.** Poll failures land in Skynet's logs, not in the UI. No "poll failing" banners, no grey-outs on relay-room rows, no failure-state affordances. If the user asks why a new room isn't appearing, the diagnostic is in `console-forward.log` + `docker logs skynet`, not in the sidebar.

### Exclusion rule + agent identification

- **D-08: Exclusion is the exact two-party (user + one agent) case ONLY.** Every other room shape materializes: `(user + one human)`, `(user + one foreign-agent that isn't in this Skynet's local roster)`, `(user + 2+ anyone)` — all get session records. The (user + one local-agent) two-party case is excluded because harness sessions already cover it, and materializing a peer relay-room entry would produce a visible duplicate in the sidebar.

- **D-09: Rigid tie via REGISTRY-ROOM MEMBERSHIP, not naming convention or disk-based check.** The observation loop's exclusion check on a two-party room asks: is the non-user member's Matrix account a member of the agents registry room? Yes → exclude. Registry-room membership is homeserver-persistent — an agent's host can be offline for a week and the exclusion still works. NOT a name-pattern check on the account handle (account name format is subject to change and unreliable). NOT a disk-based check reading each host's `relay.json` (fragile against host downtime — a host outage would cause its agents to look like "unknown accounts" and their DMs would materialize as spurious sidebar entries).

### Registry rooms

- **D-10: Two registry rooms — agents room and humans room.** Both created by Skynet on the homeserver at rollout / first-boot. Named / room-aliased however the planner chooses; concrete choices are researcher/planner territory. The two-room design gives positive signals for both sides: other-member in agents room → exclude, other-member in humans room → materialize as real human DM, other-member in neither → materialize conservatively (foreign / unknown-origin account).

- **D-11: Skynet is the account-creator for BOTH agents and humans (Phase 75 landed this).** Verified live during `/open`: `POST /identities/birth` mints agent Matrix accounts via `matrix-admin-client.ts::createOrUpdateUser` since Phase 75 Plan 04; `POST /users/create` was extended in Phase 88 to mint human Matrix accounts the same way. Both hooks live on Skynet's side already. The registry-room join is a NEW step added at each of those two moments — after mint succeeds, use the admin `joinRoom` primitive (already exists at `matrix-admin-client.ts:186`) to add the new account to the appropriate registry room. The id-skill's own self-register block on the agent's box is now a LEGACY/FALLBACK pathway — do NOT wire the registry-room join through it.

- **D-12: One-time backfill is MANUAL per instance-deployer — NOT automatic.** Refined 2026-09-08 post-verifier (Alice verbatim: *"there's not supposed to be automatic backfill anyways. Like I said, that would be a manual step for whoever deploys this stuff over here on this instance and for Stacy on her instance."*). Matches the Phase 88 D-02 precedent (existing users hand-migrated by the maintainer of each Skynet instance — Taylor on t1000, Stacy on T800). The `runRegistryRoomsBackfill()` function exists as a **manual-invocation utility**, exported from `src/backend/relay-sessions/registry-rooms-backfill.ts` — the instance-deployer runs it once after deploying Phase 89 code, per the runbook in `89-SUMMARY.md § Manual backfill runbook`. The observation-loop-starter DOES NOT auto-fire it at boot. Between deploy and manual-backfill-run, pre-existing agents/humans are NOT in the registry rooms and the classifier's D-09 fallthrough conservatively materializes their two-party DMs (noisier sidebars for existing accounts until backfilled) — same trust model as Phase 88's "existing users get hand-migrated." The D-11 mint hooks (Phase 89-02) cover ALL new accounts from now on automatically; only pre-existing accounts need the manual backfill.

- **D-13: Registry rooms themselves excluded via a Skynet-instance-owned "admin rooms" ignore-list.** Registry rooms have many members and would otherwise trip the D-08 multi-member materialize rule for every user. Skynet holds a small internal ignore-list of admin room IDs; the observation loop's materialization step skips any room whose ID is in this list. Ignore-list is populated at the moment Skynet creates each registry room (per D-10) — Skynet knows the room IDs at creation time.

### Race guard + merge

- **D-14: DB uniqueness on `(user_id, room_id)` is the coordinator between observation loop and slice C's create-room flow.** Both paths call the same "materialize this room for this user" primitive. The uniqueness constraint from D-02 makes the second write a no-op regardless of order (SQLite `INSERT ... ON CONFLICT DO NOTHING` or upsert-on-conflict semantics). No cross-path coordination logic — the schema IS the coordinator. Slice C's create-room flow gets a tiny latency win by inserting directly rather than waiting up to 10s for the observation poll; the observation loop is the safety net if the create-flow's insert fails mid-way.

- **D-15: `/sessions/list` merge shape + kind marker.** The existing `/sessions/list` handler at `src/backend/database/routes/sessions.ts` derives harness sessions from SSH + tmux + JSONL as it does today. A new post-derivation merge step queries the new relay-room table for `state = 'active'` rows for the authenticated user, converts them to session-list-item shape, and appends them to the derived-harness-sessions list. **Each item in the merged output carries a kind marker** so the frontend knows how to render/open it. Concrete field name (e.g. `sessionKind`, `type`) is planner's call; the marker itself is required. Sort ordering across the merged list is a follow-up frontend concern (slice D) — this slice returns the merged data; the frontend can re-sort by `last_activity_at` if desired.

### Ignore-list surface

- **D-16: Admin-rooms ignore-list is Skynet-instance-owned, internal, general-purpose.** Each Skynet instance owns its own ignore-list (t1000's ignore-list has t1000's registry room IDs; T800's has T800's; nothing hard-coded, nothing cross-instance). Internal only — no user-visible surface, no admin console, no debug endpoint in this slice. General-purpose bucket — the ignore-list starts with just the two registry rooms, but the primitive extends cleanly to any future admin-purposes-only room (box-maintainer coord room, etc.). Storage: small new table (`admin_rooms` or similar — planner's call) OR a settings row containing a JSON array of room IDs; either fits.

### Claude's Discretion

- Concrete table name (`relay_room_sessions` vs `sessions_relay_room` vs other) — planner's call, follow existing naming conventions in `src/backend/database/db/schema.ts`.
- Concrete module structure for the observation loop (single file vs split across modules) — planner's call based on where it fits alongside existing fleet-status / matrix subsystems.
- Concrete `sessionKind` / `type` marker field name on the merge output — planner's call, follow existing wire-protocol conventions.
- Poll cadence exact value within the ~10s target (8s vs 10s vs 12s) — planner's judgment, but must be short enough for "join a room, see it appear promptly" UX.
- Backfill script trigger mechanism (boot-time vs manual admin trigger vs one-shot on first observation-loop start) — planner's call, must be idempotent.
- Registry-room naming (`agents-registry` vs `_skynet_agents_directory` vs alias-based) — planner's call, must be internal-flavored so it never confuses a human who somehow stumbles into it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This slice's own artifacts
- `.planning/shapes/shape-relay-session-model-generalization.md` — This slice's shape (source of D-01..D-16 above; fuller narrative + What-would-make-it-wrong + Scope edges).
- `.planning/phases/89-relay-mediated-group-conversations-sub-slice-b-session-model/89-CONTEXT.md` — this file.

### Parent arc
- `.planning/shapes/shape-relay-mediated-group-conversations.md` — Master shape of the multi-slice arc. Anchors philosophy (agent receivers already exist, this slice generalizes the SKYNET side); orthogonality invariant between session kinds.
- Bounty: `~/.claude/roles/box-maintainer/bounties/relay-mediated-group-conversations-humans-agents-in-rooms/` (pinned by Alice).

### Direct dependency — slice A (Phase 88, complete)
- `.planning/phases/88-relay-mediated-group-conversations-sub-slice-a-human-relay-i/88-CONTEXT.md` — Slice A decisions (D-01..D-14). Established: every user has `users.mxid` populated, Skynet mints human Matrix accounts at `POST /users/create` (mint-first, refuse-create-on-Synapse-unreachable), sanitizer `_human` suffix convention for humans, deactivate-on-delete best-effort.
- `.planning/phases/88-*/88-SUMMARY.md` (all 4 plans) — What actually landed for slice A, including the 3 unbiased-review fixups (sanitizer hex fallback, DatabaseSaveTrigger.forceSave in deleteUserAndRelatedData, outer-catch comment tighten).

### Matrix substrate (already in Skynet)
- `src/backend/matrix/matrix-admin-client.ts` — Existing primitives to build on: `createOrUpdateUser` (Phase 75), `loginAsUser`, `joinRoom` (POST /_synapse/admin/v1/join/{roomIdOrAlias}), `makeRoomAdmin`, `listRooms`, `deactivateUser` (Phase 88), `getSharedDMRoom` (uses /_synapse/admin/v1/users/{mxid}/joined_rooms — this is the endpoint the observation loop needs generalized). Section around L465-511 is the closest existing pattern for the joined-rooms query the observation loop will drive.
- `src/backend/matrix/matrix-admin-creds-store.ts` — Admin credential resolution (`getMatrixAdminCreds()`); the observation loop rides this same credential.

### Skynet session substrate
- `src/backend/database/routes/sessions.ts` — Current `/sessions/list` handler (~L60 onwards). This is where the merge integration lands (D-15). Note: `PER_HOST_TIMEOUT_MS` + `CONNECT_TIMEOUT_MS` timeout discipline in this file is load-bearing per prior incident history — the merge must not blow past those budgets.
- `src/backend/database/db/index.ts:175-197` — Existing `sessions` table (WEB AUTH sessions — JWT-based). Confirms Skynet has NO stored table for harness/chat sessions today; the /sessions/list endpoint DERIVES them. Do NOT accidentally extend this table.
- `src/backend/database/db/index.ts:1290+` — SQLite migration block; see how existing tables were added incrementally. New relay-room-sessions table follows the same `CREATE TABLE IF NOT EXISTS` + `addColumnIfNotExists` pattern.
- `src/backend/database/db/schema.ts` — Drizzle mirror; new table gets a mirror here too, same pattern as other tables.

### Fleet-status subsystem (informative — patterns to consider)
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` — Existing per-host poll orchestrator; useful reference for per-target scheduling + backoff patterns.
- `src/backend/fleet-status/session-file-cache.ts` + `subscription-registry.ts` — Existing subsystems for cached observation + subscribers; may inform observation-loop structure (though this slice does NOT need subscriptions — it's admin-poll only).
- Fleet-status roster (in-memory cache of identities per host) — the source for D-12 agent enumeration during backfill.

### Skynet architectural invariants (project-level)
- `.planning/PROJECT.md` — Skynet's core value ("Alice never loses access to her fleet"); every change preserves reliable browser SSH+RDP.
- Crown-jewel in-memory-SQLite invariant: `DatabaseSaveTrigger.forceSave("<reason>")` MUST be called after every backend `db.insert/update/delete().run()`. Pattern reference: `host-autostart-routes.ts:173-181`. Applies to every write in this phase — new table inserts (materialize), state transitions (external kick), registry-room ignore-list writes.
- nginx/Caddy routing: any NEW URL prefix needs matching entries in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` (Phase 87 D-19/20/21 pattern). Slice B is backend-only and does NOT add new user-facing endpoints — `/sessions/list` extension reuses the existing prefix — but if the planner surfaces admin-only endpoints (e.g. a health-check for the observation loop) that need external reach, both nginx configs must be touched.

### Multi-identity discipline
- Container mutations serialize across identities per box-maintainer role directive — this slice ships from taylor's tree at `~/skynet-taylor` on `feat/tab-title-from-tmux`; peer identities (tina, tabitha, tiffany, tanya on the same branch) coordinate via the box-maintainer coord room. Push not authorized as part of phase execution — deploy motion is orchestrator-owned per fleet rule.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`matrix-admin-client.ts` primitives** — All the Matrix-side building blocks except a generalized "get user's joined rooms" (currently only wrapped inside `getSharedDMRoom`'s internal helper at ~L473) and possibly "create a room" (used at admin console but check if it's exported). Do not re-implement admin credentialing, HTTP client shape, or timeout discipline; extend the existing module.
- **`getSharedDMRoom(agentMxid, humanMxid)`** at `matrix-admin-client.ts:465` — Already implements "list a user's joined rooms" as an internal helper; the observation loop needs that same helper exported as a top-level primitive (e.g. `getUserJoinedRooms(mxid): Promise<string[] | null>`). Refactor the helper out; keep `getSharedDMRoom` calling it internally.
- **`matrix_admin_creds` singleton** — Already provides the admin credential the observation loop rides. Do NOT introduce a second credential store or per-user creds — one admin credential covers all observation.
- **Fleet-status roster** — Live in-memory map of "which identity names exist on which hosts" maintained by `ssh-poll-orchestrator.ts`. Read-only consumer for the D-12 backfill agent enumeration.
- **`users` table** (post-Phase 88) — `mxid` column populated for every user. Read-only consumer for D-12 backfill human enumeration.
- **`DatabaseSaveTrigger.forceSave` pattern** — Standard for post-write persistence; wrap in try/catch that logs a warning on failure (do NOT propagate — an in-memory-only row is worse UX than a slightly delayed response, but a 500 is worse still). Every new write in this phase must follow the pattern.

### Established Patterns

- **CREATE TABLE IF NOT EXISTS + addColumnIfNotExists** — Skynet's incremental schema migration pattern. New tables land in the main init block; incremental column additions use `addColumnIfNotExists` for backward compat. Both must be paired with `labeled forceSave` immediately after (Phase 87 D-18 pattern).
- **Drizzle schema mirror** — `src/backend/database/db/schema.ts` mirrors the raw SQL; both must stay in sync. Do NOT drift.
- **`/sessions/list` derivation** — request-time SSH + tmux + JSONL enumeration, not stored-table-driven. Existing pattern must not be broken by the merge integration (D-15).
- **Byte-parallel copies of predicates** — Phase 43/85 established the discipline of keeping predicate logic byte-parallel across sites when it must exist in two places. Not expected to apply here (single observation loop, single merge point), but noted for planner in case a similar situation emerges.
- **Structured logging at boundaries** — Fleet rule (2026-08-11): logs at interaction/lifecycle/effect boundaries with actionable context (extract event fields explicitly, never JSON.stringify DOM Events). The observation loop is a lifecycle-heavy subsystem — instrument each tick's entry, per-user poll fire/success/failure, materialize / state-transition decisions, ignore-list skips.

### Integration Points

- **`/sessions/list` merge step** — the single point where relay-room rows enter the frontend's view. All existing consumers of `/sessions/list` see the merged list with kind markers; slice D (frontend rendering) will branch on the marker.
- **`POST /identities/birth` (identity-birth-orchestrator.ts) — post-mint hook** — add registry-room join for agents at the moment agent Matrix account is minted.
- **`POST /users/create` (users.ts, from Phase 88) — post-mint hook** — add registry-room join for humans at the moment human Matrix account is minted.
- **Observation loop startup** — must start when Skynet boots (once matrix-admin-creds are available); backfill runs before the first observation tick, or as a discrete step gated on a `has_backfilled` flag in settings/state.
- **DELETE /users/delete-account + deleteUserAndRelatedData** — Phase 88 already wired deactivateUser here. Slice B does NOT need to add anything to the delete path in v1 (registry-room rows for a deactivated account become dangling; that's fine — deactivated Matrix accounts can't join anything, and the row will transition to inactive on the next observation tick that sees empty joined-rooms for that mxid).

</code_context>

<specifics>
## Specific Ideas

- **Row shape is deliberate and locked** — see D-02. Any deviation from the exact column set (adding fields, changing types, scoping the uniqueness constraint) needs explicit re-greenlight, not planner discretion.
- **Poll cadence targets ~10s** — see D-04. Not sub-second (unnecessary sync-client substrate), not minute-scale (bad UX for "join and see"). ~10s is the design center.
- **Registry rooms + ignore-list are the load-bearing primitives** — see D-09..D-13. Two big departures from earlier design instincts landed here:
  1. NOT naming-convention-based (Alice: account format is changing).
  2. NOT disk-based (host downtime = fragile).
  Both departures were driven by the "what would make it wrong" section of the shape; do not backslide.
- **Skynet is the account creator for both types** — see D-11. This IS the current state as of Phase 75 (agents) + Phase 88 (humans). Verified live during /open. Do NOT plan around the assumption that agents self-register — the id-skill's self-register block is legacy/fallback only.

</specifics>

<deferred>
## Deferred Ideas

- Pruning inactive relay-room rows (they accumulate forever in v1; cleanup pass is a later concern) — future maintenance phase.
- Voluntary user leave from a room (not v1 per master shape) — future slice.
- Per-session UI state beyond the minimum: unread markers, last-read timestamps, custom labels — future slice.
- User-visible admin surface for the ignore-list (view / edit) — future admin console phase, if ever needed.
- Real-time membership subscriptions from the homeserver (`/sync` long-poll per user) — rejected here in favor of admin-poll simplicity; revisit only if ~10s cadence proves visibly slow.
- Caching room member lists / recent messages in the stored row — rejected here in favor of live queries against the relay.
- Additional session-kind concepts (RDP-session as a stored kind, etc.) — one concern per slice; RDP is out of scope for this arc entirely.
- Per-user Matrix credentials for the observation loop — rejected here in favor of the existing single admin credential.

</deferred>

---

*Phase: 89-relay-mediated-group-conversations-sub-slice-b-session-model*
*Context gathered: 2026-09-08*
