# Shape: hide identity rows via disk sentinel

**Slug:** `hidden-identity-rows-via-sentinel`
**Opened:** 2026-09-12 (Ashley + vega, /build)
**Status:** Agreed — /open grill skipped per Ashley's explicit direction ("you already know shape: hide identity rows via sentinel, that's it")
**Reference implementation:** Phase 92 (all plans) — same primitive layer, same fanout shape, same drop-column migration pattern, same both-loaded hydrate gate (added for pinned in quick-260912-5q2 this session)

## Why

Same reason the pinned slice moved to disk in Phase 92: fleet-visible identity state (is this row hidden? is this row pinned?) belongs on disk next to the identity, not in a per-user DB column. Two properties fall out of the disk-sentinel move that the DB model didn't have:

1. The state travels with the identity across DB resets, container rebuilds, and any future multi-tenant reshuffling that touches the DB shape but not `~/fleet/identities/<name>/`.
2. The read path stays cheap — a per-request `stat` fan-out, no DB query, no in-memory cache to keep coherent.

Phase 92 explicitly deferred the hidden slice (`D-02 out-of-scope`) because hide accepts more row types than pin does (see § Scope narrowing below) — this shape resolves that gap by narrowing.

## What

Direct mirror of Phase 92 across the four stacks + a schema migration + one small affordance narrowing:

- **Primitive** — extend `ALLOWED_REL_PATHS` in `src/backend/claude-session/per-identity-file.ts` to include `".hidden"`. Empty presence-only sentinel, same shape as `.pinned` (no body ever read, presence IS the meaning).
- **Backend read path** — add `hidden:boolean` field to `publicIdentity()` return in `src/backend/database/routes/identities.ts`, populated by a parallel `identityFileExists(k, ".hidden", ...)` probe launched alongside the existing `.pinned` probe in the GET /identities per-key fanout. Same fail-closed contract (stat error → false, never over-report hidden).
- **Backend write path** — in `src/backend/database/routes/user-preferences.ts`, mirror the `pinnedConversationIds` fanout block for `hiddenConversationIds`: require `identityHosts` in body, compute disk-truth deltas via `identityFileExists`, fan out `writeIdentityFile("", { conn, hostId })` + `removeIdentityFile(...)` in parallel, re-derive from disk for echo. Retire the DB write path. Same PUT-92-06-style guard on missing identityHosts key.
- **Schema migration** — `runHiddenColumnDrop` in `src/backend/database/db/index.ts`, mirroring the existing `runPinColumnDrop`. Drop `hidden_conversation_ids` column from `user_preferences`. Persist via `DatabaseSaveTrigger.forceSave("phase-XX-hidden-sentinel-migration")` — use the actual phase number this gets slotted at. Wrapped in try/catch with a non-fatal warn same as phase-68 and phase-92 (dropColumnIfExists is idempotent, next boot retries).
- **Frontend API** — in `src/ui/api/user-preferences-api.ts`: `putHiddenIds(ids, identityHosts)` with `toBareIdentityKey` strip at wire boundary, mirroring `putPinnedIds` exactly. Retire `getHiddenIds`.
- **Frontend hydrate** — new `deriveDiskHiddenIds` in `src/ui/state/identities-store.ts`, mirroring `deriveDiskPinnedIds`. In `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`, extend the both-loaded-gated hydrate effect (landed in quick-260912-5q2 this session) so it derives hidden alongside pinned in the same pass — no separate GET /user-preferences fetch, no separate gate. Feed `identityHosts` from `buildIdentityHostsFromFleet(state.fleetSessions)` into `hideConversation` and `unhideConversation` in `src/ui/state/conversation-store.ts`.
- **Affordance narrowing** — Hide button DISAPPEARS from non-identity rows (RDP, dev-created openTab rows, relay rooms). See § Scope narrowing.

## Scope narrowing — Hide button disappears from non-identity rows

The reason Phase 92 deferred hidden: hide accepts any row id (fleet-synthetic, openTab, RDP, relay-room), but only fleet-synthetic rows map to an identity folder that can hold a sentinel. Two options were:

- (a) Narrow: only fleet-synthetic rows stay hideable — non-identity hide affordance goes away
- (b) Hybrid: identity-shaped ids → sentinel; everything else → DB column stays. Two write paths, two hydrate paths, two truth sources

Ashley chose (a) 2026-09-12: *"yeah i'm okay with only hiding identity rows for now."* Sub-decision on the affordance (2026-09-12): *"disappear"* — a button that silently loses its effect on next reload is worse UX than no button. So the Hide button is rendered ONLY on fleet-synthetic rows going forward; RDP / dev-tab / relay-room rows lose the affordance entirely.

## Acknowledged tradeoff — identity-scoped, not user-scoped

Ashley 2026-09-12 verbatim: *"i realize that means that one user hiding them would hide them for everyone else. i'm okay with that right now."*

The `.hidden` sentinel is identity-scoped (`~/fleet/identities/<name>/.hidden`), not user-scoped, so if one user of this Skynet instance hides an identity row, it's hidden for every user. Mirrors the existing `.pinned` sentinel scoping — same tradeoff, same rationale. Ashley aware, greenlit.

An eventual multi-user re-scoping would be a separate phase, and both pinned + hidden would migrate together (likely to per-user sentinel paths like `~/fleet/identities/<name>/.hidden-by-<userid>` or a user-scoped file location). Explicitly NOT this phase's scope.

## Scope OUT

- Multi-user re-scoping of either sentinel (pinned or hidden) — separate future phase
- Hiding non-identity rows (RDP, openTab, relay-room) persistently — feature deletion is the choice
- Any change to pin behavior — quick-260912-5q2 landed the both-loaded hydrate gate; this phase leans on that but does not touch it
- Retention/cleanup of `.hidden` sentinels when identities are deleted — future concern; identity deletion doesn't currently exist as a clean flow

## Success criteria for /close

When `/close` runs against this shape after execute, it verifies:

1. **Sentinel model in place** — `.hidden` in `ALLOWED_REL_PATHS`; primitive tests pass; sentinels write/remove correctly per-identity.
2. **Backend GET /identities** — response includes `hidden:boolean` per row; parallel `.hidden` probe alongside `.pinned` in the fanout.
3. **Backend PUT /user-preferences** — `hiddenConversationIds` fanout writes/removes sentinels via `writeIdentityFile`/`removeIdentityFile`; requires `identityHosts`; echoes disk-authoritative state.
4. **DB column dropped** — `hidden_conversation_ids` no longer exists in `user_preferences`; migration idempotent.
5. **Frontend API** — `putHiddenIds` signature widened with `identityHosts`; `toBareIdentityKey` strip; `getHiddenIds` retired.
6. **Frontend hydrate** — hidden derived from identities-store `hidden:boolean` field; no separate `/user-preferences` fetch for hidden; both-loaded gate covers hidden too.
7. **Affordance narrowed** — Hide button not rendered on non-identity rows (RDP / openTab / relay-room); rendered on fleet-synthetic rows.
8. **Regression tests** — mirror Phase 92 test coverage: primitive allowlist test, backend fanout add/remove/probe tests, frontend hydrate ordering test, schema migration drop test, affordance-narrowing render test.

Nothing NOT in this shape should ship as part of this phase — additions get called out by /close.

## Not doing (would be additions, flag if they show up)

- Adding new fields to `publicIdentity()` beyond `hidden:boolean`
- Changing pin behavior or pin sentinel path
- Adding non-identity persistent-hide mechanism
- Adding `.hidden-by-<userid>` per-user sentinels
- Touching the ROLES_HOST_DIR or IDENTITIES_HOST_DIR env vars
- Adding a UI toast / banner / migration notice

---

## Close-Out

**Closed:** 2026-09-12
**Vehicle used:** Phase 107 (four plans: 107-01 primitive, 107-02 backend fanout, 107-03 schema drop, 107-04 frontend + affordance narrowing) on branch `feat/tab-title-from-tmux`, commits `1c608ec7..ff030b65`
**Overall verdict:** closed-hit

### Shape features (conformance)

- **SC-1 Sentinel model in place** — present · `.hidden` in ALLOWED_REL_PATHS; H-01..H-10 primitive tests cover whitelist admission, boundedness, local/remote write/remove/exists, chmod semantics, and identityKey gate.
- **SC-2 Backend GET /identities hidden probe** — present · publicIdentity extended with hidden:boolean 7th arg (default false); .hidden probe in same Promise.all wave as .pinned + readIdentityFile; fail-closed .catch(() => false).
- **SC-3 Backend PUT fanout** — present · hiddenConversationIds fanout writes/removes via writeIdentityFile/removeIdentityFile; requires identityHosts (400 otherwise); disk-authoritative post-echo; connByHost shared with pin fanout.
- **SC-4 DB column dropped** — present · runHiddenColumnDrop exported and wired in migrateSchema; schema.ts no longer defines hidden_conversation_ids; forceSave label 'phase-107-hidden-sentinel-migration'; idempotent + non-fatal warn on failure.
- **SC-5 Frontend API** — present · putHiddenIds(ids, identityHosts) uses shared toBareIdentityKey; getHiddenIds retired (not exported); server-echo divergence warn preserved.
- **SC-6 Frontend hydrate** — present · deriveDiskHiddenIds mirrors deriveDiskPinnedIds; both-loaded-gated hydrate effect derives hidden alongside pinned in one pass with one buildIdentityHostsFromFleet call; identityHosts threaded into hide/unhideConversation via same helper.
- **SC-7 Affordance narrowed** — present · isFleetIdentityRow gate (row.id starts with 'fleet::' && kind !== 'relay-room' && rdpHostRow !== true) applied at all four render sites; RDP/relay-room/non-fleet rows get onToggleHide=undefined so the row's context-menu Hide/Show item is auto-suppressed.
- **SC-8 Regression tests** — present · Primitive H-01..H-10; backend PUB-107-signature-1..3 + HID-107-01..06 + HID-107-PUT-01..10 + HID-107-GET-01 + HID-107-DB-01/01b; frontend API-107-01..04 + SEL-107-01..05 + PANEL-107-01..04 + AFF-107-01..06; migration P107-01/02.
- **Scope narrowing — non-identity Hide affordance disappears** — present · Verified at render sites via isFleetIdentityRow gate; AFF-107-01..05 test the RDP, dev-tab, and relay-room negative paths and the fleet-synthetic positive path.
- **Scope OUT — no multi-user re-scoping / non-identity persistent hide / pin changes / .hidden-by-<userid> / env var changes / UI toast** — present · No new user-scoped sentinel path; no non-identity persistent-hide mechanism; no changes to pinnedConversationIds behavior beyond sharing connByHost; no ROLES_HOST_DIR / IDENTITIES_HOST_DIR touch; no toast/banner.

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Every shape commitment is present in the material and I found no unagreed additions. The only extension to publicIdentity is the shape-agreed hidden:boolean 7th arg. The shape-required forceSave label is exactly 'phase-107-hidden-sentinel-migration', matching the shape's 'use the actual phase number' guidance. Test coverage mirrors Phase 92's coverage across all four layers. Working tree is clean at ff030b65.
