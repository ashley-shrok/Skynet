# Phase 83 CONTEXT — Telegram bridge Fix B: chat_id capture handshake + Matrix DM room discovery

**Vehicle:** Follow-up to Phase 79 (Docker Compose bridge substrate promotion, shipped 2026-09-07 as HEAD `4b53d3be`). Phase 79 delivered the substrate + config-from-Skynet + FieldCrypto bot_token storage + activation UI, but two writeback paths were deferred and are needed to complete end-to-end "no shell" wrist activation. Sits directly on top of Phase 79.

**Urgency:** Ashley currently has ZERO wrist reachability. Nina's bridge was taken down 2026-09-07 in preparation for cutover; the new tg-bridge container is up but cannot route MX↔TG without chat_id capture + room discovery. Pre-authorized by Ashley — she said verbatim: *"pick up with progressing to the real finish line in all of this when next session starts."*

**Depends on:** Phase 79 (all 9 plans + Fix A shipped in `feat/tab-title-from-tmux`).

---

## Domain

Phase 79 shipped the Telegram bridge as a first-class Skynet substrate piece — a Docker Compose service (`tg-bridge`) that reads config from Skynet-written files in a shared volume. Activation flow: user pastes bot token in identity modal Telegram tab → Skynet writes `/state/<agent>.bottoken` and rewrites `/state/registry.json` → bridge inotify re-execs → poller for the new bot spawns. The GAP: when the user then sends `/start` to their bot from Telegram, the bridge poller sees the message but has no way to (a) persist the observed `chat_id` back into `telegram_bot_tokens.telegramChatId`, and (b) know which Matrix DM room to route Telegram messages into. Result: `registry.json` shows `chat_id:null` and `room:null` forever, bridge silently drops every inbound message, wrist reachability is broken.

Fix B closes both gaps with a **sentinel handshake pattern** — the bridge writes an on-disk marker when it sees something new; Skynet's reconcile loop reads the marker, updates the DB + registry, unlinks the marker. Same shape as Phase 79 Plan 08's `token-dead` sentinel already deployed and working (see `src/backend/telegram/reconcile-dead-tokens.ts`).

---

## Locked decisions

### 1. chat_id capture — sentinel handshake, no bridge→Skynet API call

- Bridge writes `/state/<agentName>.pending-chat-id` containing ONLY the raw `chat_id` string (integer as bytes, no JSON, no newline) when its Telegram poller sees a message from a chat_id that doesn't match any `humans[]` entry in registry.json for that agent.
- Written from within `tg_poller()` at the current "no human owns chat_id — dropped" branch (`bridge.sh:266-272`). Instead of just logging + skipping, write the sentinel first, THEN log + skip.
- **Filename discipline:** `<agentName>.pending-chat-id` — agent name is already the poller loop variable `name`, already `assertSafeHumanName`-shaped (same identity-key regex applies), so no new validation needed on write.
- **Idempotent overwrite:** if the sentinel already exists (Skynet hasn't reconciled yet), we simply rewrite with the same or newer chat_id. Skynet reconcile removes it once processed.
- **Non-mutation of routing behavior:** the sentinel write is BEFORE the existing "continue" branch. Message is still dropped for this iteration (nothing to route to). Reconciliation happens out-of-band.

### 2. Skynet reconcile pass — mirror scanAndReconcileDeadTokens shape

- New file: `src/backend/telegram/reconcile-pending-chat-ids.ts`. Structural mirror of `reconcile-dead-tokens.ts`:
  - `scanAndReconcilePendingChatIds(): Promise<ReconcileResult>` — single-pass scan
  - `startReconcilePendingChatIdsLoop(intervalMs: number): NodeJS.Timeout` — fire-and-forget interval, `.unref()`'d
- Wired in `starter.ts` alongside `startReconcileLoop(30_000)` — same 30s cadence.
- Per-sentinel flow:
  1. Read `/state/*.pending-chat-id` entries
  2. For each: derive `agentName = filename.slice(0, -".pending-chat-id".length)`, guard via existing `assertSafeIdentityKey` (or equivalent name-guard used for `.bottoken` writes)
  3. Read raw chat_id from file contents (strip whitespace, validate looks like a signed integer string — Telegram chat_ids can be negative for groups but for our v1 flow only DMs so positive integers only)
  4. Look up `telegram_bot_tokens` row WHERE identityKey = agentName
  5. Update `telegramChatId = <parsed chat_id>` via drizzle, then `await DatabaseSaveTrigger.forceSave("reconcile-pending-chat-id")` per the in-memory DB invariant (role file lines 170-181)
  6. Call `rewriteRegistryFromCurrentState()` (the Phase 79 Plan 04 export from `bridge-config-writer.ts`) to regenerate `/state/registry.json` with the now-populated chat_id
  7. Unlink the sentinel
- **Failure semantics** (mirror reconcile-dead-tokens):
  - No matching identityKey row → warn + skip + LEAVE sentinel (Skynet may not have the row yet if the user just pasted, race window; next tick retries)
  - DB update throws → warn + leave sentinel for retry
  - forceSave fails → log warning + continue (data is in-memory; still write registry + unlink; not a total failure)
  - Registry rewrite throws → warn + leave sentinel (chat_id in DB but not exposed yet — retry next tick will re-detect via… hmm see § open question below)

### 3. Matrix DM room discovery — `getSharedDMRoom` in matrix-admin-client

- Add to `src/backend/matrix/matrix-admin-client.ts`:
  ```
  getSharedDMRoom(agentMxid: string, humanMxid: string): Promise<string | null>
  ```
- Implementation:
  1. GET `/_synapse/admin/v1/users/{agentMxid}/joined_rooms` via admin token → array of room_ids
  2. GET `/_synapse/admin/v1/users/{humanMxid}/joined_rooms` → array
  3. Intersect the two sets
  4. For each shared room_id, GET `/_synapse/admin/v1/rooms/{room_id}` (which returns joined_members count) OR `/_synapse/admin/v1/rooms/{room_id}/members` — pick whichever is cheapest
  5. Filter to rooms with exactly 2 joined members (the two mxids we already have)
  6. Return the first match, or `null` if no 2-member shared room exists
- **No Skynet-driven room creation** — if no shared DM room exists, return null. For Phase 83 this depends on pre-existing rooms from the Nina era (Ashley confirmed Nina's tina↔ashley DM room is `!ugXtUphVwaxdjoXkIq:thenasty.taild9b663.ts.net` — that's the seed truth). Skynet-driven room creation is deferred to a later phase.
- **Verified admin API:** the `/_synapse/admin/v1/users/{user_id}/joined_rooms` endpoint is documented Synapse-only (not Continuwuity) — Phase 77's admin foundation already targets this API on the thenasty homeserver, so it's ready.

### 4. Registry-writer populates humans[].room via getSharedDMRoom

- Current `registry-writer.ts:95` hardcodes `room: null` and comment on line 27 explicitly says "Phase B always null — room-mgmt out of scope."
- **Design choice:** keep `buildRegistryFromRows` pure. Add an optional `roomByAgentHumanMxidPair` map parameter — a `Map<string, string | null>` keyed by `"${agentMxid}\t${humanMxid}"`. If provided, populate `room` from the lookup; otherwise fall back to `null` (backward compat for tests + callers who don't provide it).
- Room lookup happens in the CALLER (`bridge-config-writer.ts`, or wherever `buildRegistryFromRows` is invoked). The caller:
  1. Computes the list of (agentMxid, humanMxid) pairs from the rows
  2. Calls `getSharedDMRoom` per pair (parallel via `Promise.all`)
  3. Builds the map
  4. Passes to `buildRegistryFromRows`
- **Failure handling on getSharedDMRoom:** if it throws or times out for a pair, insert `null` for that pair. Registry falls back to null room, bridge won't route MX→TG for that (agent, human) pair until room is discovered on a later reconcile. Acceptable.
- **Caching:** none in v1. Every `rewriteRegistryFromCurrentState` call re-queries the admin API. Cheap — happens on activation/reconcile events, not per-message.

### 5. TelegramTab frontend — poll for status advance

- Modify `src/ui/features/pretty-view/TelegramTab.tsx`.
- After bot token is pasted + accepted (backend confirms bot valid), UI shows "waiting for /start" state.
- Frontend polls `GET /telegram/status?identityKey=<key>` every 3-5 seconds while in that state.
- Backend endpoint returns `{ chat_id: string | null }` — reads from `telegram_bot_tokens.telegramChatId`.
- When `chat_id !== null`, UI advances to "Connected. Bot: @X. Human: @Y." per Phase 79 CONTEXT § 3A.
- **Polling stops** when chat_id becomes non-null OR user navigates away from tab.
- **No timeout that flips to error** — per Phase 79 CONTEXT § 3B, human gets to it when they get to it.
- **Cancel button** already exists (per Phase 79 § 3B) — wires to existing disconnect flow.

---

## Files to create/modify

### Modified
- `substrate/services/tg-bridge/bridge.sh` — add sentinel-write in `tg_poller` unknown-chat_id branch (~5 lines)
- `src/backend/telegram/registry-writer.ts` — optional `roomByAgentHumanMxidPair` map arg to `buildRegistryFromRows`
- `src/backend/telegram/bridge-config-writer.ts` — compute agent-human pairs, call `getSharedDMRoom` per pair, pass map to `buildRegistryFromRows`
- `src/backend/matrix/matrix-admin-client.ts` — add `getSharedDMRoom` free function
- `src/backend/starter.ts` — wire `startReconcilePendingChatIdsLoop(30_000)` alongside existing `startReconcileLoop`
- `src/backend/telegram/routes.ts` — add `GET /telegram/status?identityKey=<key>` returning `{ chat_id }`
- `src/ui/api/telegram-api.ts` — add `getStatus(identityKey)` client method
- `src/ui/features/pretty-view/TelegramTab.tsx` — poll status while awaiting /start, advance state machine

### Created
- `src/backend/telegram/reconcile-pending-chat-ids.ts` — new reconcile loop (mirror shape of reconcile-dead-tokens.ts)
- `src/backend/telegram/reconcile-pending-chat-ids.test.ts` — unit tests
- Tests extend for the above modified files

### Test coverage
- `registry-writer.test.ts` — add cases for `roomByAgentHumanMxidPair` map (present + partial + absent)
- `bridge-config-writer.test.ts` — verify `getSharedDMRoom` is called per pair + result flows to `buildRegistryFromRows`
- `matrix-admin-client.test.ts` — happy path (2-member shared room), no-shared-room case, 3-member-shared-room-filtered-out case, one-user-has-no-rooms case
- `routes.test.ts` — new GET /telegram/status endpoint
- `TelegramTab.test.tsx` — mock poll returning chat_id null → chat_id populated, state advances

---

## Open questions / risks

- **Reconcile retry on registry-rewrite failure:** if the DB update succeeds but registry-rewrite throws, the sentinel is left in place. Next tick will process the sentinel again, but the DB row already has chat_id populated. Skynet reconcile should be idempotent — either detect "chat_id already matches this pending value → registry-only rewrite" or unlink-anyway-if-DB-is-current. Simpler path: unlink after DB update succeeds, and let a separate "registry drift" reconcile handle rewrite failures. Or: accept that next tick re-attempts DB update (idempotent — same value) + rewrite. Prefer the second for v1 simplicity.
- **chat_id data type:** stored as `TEXT` in SQLite (Phase 77 shape), but represented as JSON number by Telegram API. Bridge preserves as string in the sentinel file. Skynet parses as `String(chat_id)` — no numeric conversion. Registry.json's `chat_id` value comes from `telegramChatId` column which is already text. Bridge already string-coerces via `--arg c "$fc"` at bridge.sh:268 (learned 2026-07-30, verbatim comment in the source).
- **Race between activation UI and first /start message:** if user pastes token and immediately sends /start (within one poller cycle), the bridge hasn't started the poller yet (needs registry.json write + inotify re-exec cycle). But offset seeding at `tg_poller:248` skips backlog by design — the FIRST /start after poller start is what's captured. Acceptable v1 behavior; UI's "waiting for /start" state accommodates this.

---

## Not in scope

- Skynet-driven Matrix DM room creation (deferred; depends on pre-existing rooms from Nina era)
- Multi-human-per-identity (deferred per Phase 79 CONTEXT § 4A)
- Group chat routing (chat_id can be negative for groups; Phase 83 only handles DM/positive chat_ids)
- Deploy-time nits from bounty (Dockerfile `chown /state` at ENTRYPOINT, bridge.sh cold-boot re-exec storm) — separate bounties, not blocking wrist reachability

---

## Requirements

- **FIXB-01:** Bridge writes `/state/<agent>.pending-chat-id` sentinel with raw chat_id when tg_poller encounters unknown chat_id
- **FIXB-02:** Skynet reconcile-pending-chat-ids loop reads sentinel, updates `telegram_bot_tokens.telegramChatId` for matching identityKey, triggers registry rewrite, unlinks sentinel
- **FIXB-03:** `matrix-admin-client.getSharedDMRoom(agentMxid, humanMxid)` returns first shared 2-member Matrix room or null
- **FIXB-04:** `buildRegistryFromRows` accepts optional room-lookup map; caller computes it via `getSharedDMRoom` per pair; `humans[].room` populated when discoverable
- **FIXB-05:** TelegramTab polls `GET /telegram/status` while awaiting /start; state advances to "Connected" when chat_id populated
- **FIXB-06:** Unit tests for each of FIXB-01 through FIXB-05
- **FIXB-07:** Integration test (optional but preferred) — full activate → /start → chat_id captured → room populated → outbound MX→TG round-trip

---

*Phase: 83-telegram-bridge-fix-b*
*Context gathered: 2026-09-07 from bounty `phase-79-telegram-bridge-fix-b-chat-id-capture` + shipped Phase 79 code inspection*
*Source-of-truth bounty: `~/.claude/roles/box-maintainer/bounties/phase-79-telegram-bridge-fix-b-chat-id-capture/bounty.json`*
