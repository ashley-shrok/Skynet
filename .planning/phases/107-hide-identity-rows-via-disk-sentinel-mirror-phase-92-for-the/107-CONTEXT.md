# Phase 107: Hide identity rows via disk sentinel — mirror Phase 92 for the hidden slice — Context

**Gathered:** 2026-09-12
**Status:** Ready for planning
**Source:** Shape file at `.planning/shapes/shape-hidden-identity-rows-via-sentinel.md` (written directly by vega — /open grill skipped per Alice's explicit greenlight upfront: *"you already know shape: hide identity rows via sentinel, that's it"*). This CONTEXT.md is seeded from that shape file; do NOT re-elicit decisions already captured there. Discuss-phase should surface only NEW gray areas that emerged post-shape or that the shape didn't lock.

<domain>
## Phase Boundary

Migrate the hidden-conversation-ids slice of `user_preferences` from a DB column to per-identity disk sentinels at `~/fleet/identities/<name>/.hidden`, EXACTLY mirroring the Phase 92 migration that did the same for the pinned slice. Also narrow the Hide affordance in the sidebar to fleet-synthetic (identity-shaped) rows only — non-identity rows (RDP, dev-created openTab, relay-room) lose the Hide button entirely.

**Reference implementation: Phase 92 (all plans).** Read Phase 92 SUMMARY files first. Same primitive layer (per-identity-file.ts ALLOWED_REL_PATHS), same backend fanout shape, same drop-column migration pattern, same both-loaded hydrate gate (which just landed for pinned in quick-260912-5q2 this session — this phase extends it to cover hidden too, not touches it structurally).

Trigger: 2026-09-12, Alice reported "my pins don't work in the sidebar ever since we moved to them being sentinels in the identities folder" — vega diagnosed as a hydration-timing race in the panel effect (fixed via quick-260912-5q2). Follow-up conversation surfaced that hidden was left DB-backed in Phase 92 (`D-02 out-of-scope`), and Alice asked to migrate it too, accepting the "hide affordance narrows to identity rows only" tradeoff that Phase 92 had deferred.

</domain>

<decisions>
## Implementation Decisions

### Sentinel model
- **Per-identity `.hidden` sentinel at `~/fleet/identities/<name>/.hidden`.** Empty presence-only file, mirroring `.pinned` exactly. Body never read; presence IS the meaning. (Directly mirrors Phase 92-01 primitive contract.)
- **Extend `ALLOWED_REL_PATHS` in `src/backend/claude-session/per-identity-file.ts`** to include `".hidden"`. No new primitive functions — existing `writeIdentityFile` / `removeIdentityFile` / `identityFileExists` handle any relPath in the allowlist.

### Backend read path
- **Add `hidden:boolean` field to `publicIdentity()` return** in `src/backend/database/routes/identities.ts`, sibling to the existing `pinned:boolean` field.
- **Launch parallel `identityFileExists(k, ".hidden", ...)` probe** in the same `Promise.all` wave as the existing `.pinned` probe in the GET /identities per-key fanout. Same fail-closed contract (stat error → false, never over-report hidden). Do NOT introduce a serial round-trip per identity.

### Backend write path
- **Mirror the `pinnedConversationIds` fanout block for `hiddenConversationIds`** in `src/backend/database/routes/user-preferences.ts`. Same shape: require `identityHosts` in body when `hiddenConversationIds` present (PUT-92-06 mirror), compute disk-truth deltas via `identityFileExists`, fan out `writeIdentityFile(k, ".hidden", "", ...)` + `removeIdentityFile(k, ".hidden", ...)` in parallel, re-derive from disk for echo (server-authoritative). Retire the DB write path.
- **Reuse the existing conn-per-host + shared connByHost map** the pinned fanout already opens per request — don't open a second round of connections just for hidden. If both `pinnedConversationIds` AND `hiddenConversationIds` arrive in the same PUT (already legal today), the two fanouts share the same SSH conns. Sequence: pin fanout, then hidden fanout, in the same try/finally block.

### Schema migration
- **`runHiddenColumnDrop`** in `src/backend/database/db/index.ts`, structurally mirroring the existing `runPinColumnDrop`. Drop `hidden_conversation_ids` column from `user_preferences`.
- **Persist via `DatabaseSaveTrigger.forceSave("phase-107-hidden-sentinel-migration")`** — reason tag uses the actual phase number.
- **Wrapped in try/catch with non-fatal warn** — same as phase-68 / phase-92 precedent (dropColumnIfExists is idempotent, next boot retries; first-boot uninitialized-trigger race is tolerated).
- **Preflight throw is fatal** — mirrors L903-913 precedent (T-66-04-04 "boot aborts before schema corruption").
- **Ordering** — runs BEFORE the `addColumnIfNotExists` sweep, matching the phase-92 ordering exactly. A single forceSave batches this drop with all the sweep adds.
- **NO data migration** — Phase 92 dropped the pinned column without migrating existing DB pins to sentinels; same call here for hidden. Users' existing hidden lists in the DB are lost on migration. Alice aware (implicit — this mirrors the phase-92 precedent and she didn't call for a data-migration on that either).

### Frontend API
- **`putHiddenIds(ids, identityHosts)` signature widened** in `src/ui/api/user-preferences-api.ts` — second `identityHosts` arg mirroring `putPinnedIds`. Reuse the existing `toBareIdentityKey(id)` helper for the wire-boundary composite-id-strip; do NOT duplicate the helper.
- **Retire `getHiddenIds`.** Hidden derivation moves to the panel's already-existing hydrate effect (see below).

### Frontend hydrate
- **New `deriveDiskHiddenIds(identityHosts): string[]`** in `src/ui/state/identities-store.ts`, sibling to the existing `deriveDiskPinnedIds`. Same shape: walk `state.identities`, filter to `hidden === true`, project into `fleet::<hostId>::<lookupKey>` row-id space via `identityHosts` map.
- **Extend the both-loaded-gated hydrate effect** in `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (landed as quick-260912-5q2 this session) to derive hidden alongside pinned in the SAME pass. Both `hydratePinnedIdsFromServer(pinnedIds)` and `hydrateHiddenIdsFromServer(hiddenIds)` fire after the single derivation pass, gated on BOTH `fleetSessionsLoaded` AND `identitiesLoaded`. No separate `/user-preferences` fetch for hidden. `hydratedRef.current` one-shot guard preserved (both hydrations share the guard — fires once).
- **Feed `identityHosts` from `buildIdentityHostsFromFleet(state.fleetSessions)`** into `hideConversation` and `unhideConversation` in `src/ui/state/conversation-store.ts`. Same H2-lock helper used by pin — do NOT introduce a second identityHosts derivation site.

### Affordance narrowing
- **Hide button DISAPPEARS from non-identity rows** — RDP synthetic rows, dev-created openTab rows (`<hostname>-terminal-<Date.now()>-<counter>`), relay-room rows. Alice 2026-09-12 verbatim: *"disappear."*
- **Implementation touch site** — `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` (or wherever the row's Hide button lives — planner confirms). Add a row-shape gate: render Hide only if `row.id` starts with `fleet::`. If a cleaner discriminator exists (e.g. row.type === "terminal" && row.fleetOnly), planner chooses.
- **Panel handler `handleToggleHide` at `PrettyConversationsPanel.tsx:1355`** — defensive check preserved (no-op on non-identity row.id if it ever reaches it), but the primary gate is at the render site so the button doesn't render at all.

### Acknowledged tradeoff — identity-scoped, not user-scoped
- Alice 2026-09-12 verbatim: *"i realize that means that one user hiding them would hide them for everyone else. i'm okay with that right now."*
- `.hidden` sentinel is identity-scoped — mirrors `.pinned` scoping.
- Multi-user re-scoping is EXPLICITLY NOT this phase's scope. Future separate phase would migrate both pinned + hidden together to per-user sentinels (e.g. `.hidden-by-<userid>`).

### Testing
- **Primitive test** — `.hidden` in `ALLOWED_REL_PATHS`; write/remove/exists sentinel per-identity (LOCAL + REMOTE branches).
- **Backend GET /identities test** — `hidden:boolean` in response, parallel-probe with pinned, fail-closed on stat error.
- **Backend PUT /user-preferences test** — `hiddenConversationIds` fanout writes/removes sentinels, requires identityHosts, echoes disk-authoritative state; combined pinned+hidden request in same body works and shares SSH conns.
- **Schema migration test** — `hidden_conversation_ids` column dropped, idempotent across boots, forceSave labeled correctly.
- **Frontend hydrate test** — hidden derived alongside pinned in the both-loaded-gated effect; single hydration fires with correct row-id shape; race against identities-store loading = no premature `[]` hydrate.
- **Frontend affordance test** — Hide button rendered on fleet-synthetic rows; NOT rendered on RDP / openTab / relay-room rows.
- All test motions use SCOPED vitest runs per fleet directive — no full-suite runs at executor scope.

### Claude's Discretion
- Exact plan slicing — planner may collapse the 6 shape success-criteria into fewer plans if the dependency graph allows (e.g. primitive + backend read + backend write in one plan; migration in another; frontend + affordance in another). Reference Phase 92's 5-plan structure; deviate if this phase's smaller scope reads better as 3-4 plans.
- Whether the affordance narrowing lives in `PrettyConversationRow.tsx` or a parent's `renderRow` decision — planner picks the cleaner discriminator site.
- Whether to add a diagnostic log line on the fail-closed `.hidden` probe error (like Phase 92 has for `.pinned`) — planner's call; mirror phase-92's log discipline.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- **Shape file:** `.planning/shapes/shape-hidden-identity-rows-via-sentinel.md` — the LOCKED agreement; all decisions above trace back here.
- **Phase 92 pin-sentinel-migration SUMMARY files (reference implementation).** ⚠️ **On-disk folder is `.planning/phases/105-pin-sentinel-migration-move-identity-pin-state-from-skynet-d/` — the phase was originally numbered 92 (which is what the source code comments + design docs use throughout) and rescue-rebase-renumbered to slot 105 without back-porting the number rename to comments/docs. Use folder 105, but "Phase 92" is the correct name to grep for in code and design docs.**
  - `.planning/phases/105-pin-sentinel-migration-move-identity-pin-state-from-skynet-d/105-CONTEXT.md` (still titled "Phase 92" in the doc header — expected)
  - `.planning/phases/105-.../105-01-SUMMARY.md` (primitive layer — the pattern to mirror for `.hidden`)
  - `.planning/phases/105-.../105-02-SUMMARY.md` (backend fanout write path — the template for the hidden fanout block)
  - `.planning/phases/105-.../105-03-SUMMARY.md` (schema drop-column migration)
  - `.planning/phases/105-.../105-04-SUMMARY.md` (frontend rewire — deriveDiskPinnedIds + hydrate)
- **Related just-shipped fix:** `.planning/quick/260912-5q2-fix-sidebar-pin-hydration-race-in-pretty/260912-5q2-SUMMARY.md` — the both-loaded hydrate gate this phase leans on.
- **Code sites:**
  - `src/backend/claude-session/per-identity-file.ts` — primitive, ALLOWED_REL_PATHS
  - `src/backend/database/routes/identities.ts` — publicIdentity(), GET /identities fanout
  - `src/backend/database/routes/user-preferences.ts` — PUT fanout block (pinned is the template to mirror)
  - `src/backend/database/db/index.ts` — runPinColumnDrop is the template for runHiddenColumnDrop
  - `src/ui/api/user-preferences-api.ts` — putPinnedIds is the template for widened putHiddenIds
  - `src/ui/state/identities-store.ts` — deriveDiskPinnedIds is the template for deriveDiskHiddenIds
  - `src/ui/state/conversation-store.ts` — hideConversation/unhideConversation need identityHosts arg wiring
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — both-loaded hydrate effect (from quick-260912-5q2) extends to hidden
  - `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — affordance-narrowing render gate

</canonical_refs>

<specifics>
## Specific Ideas

None beyond the shape file — this phase is a direct pattern mirror, not new territory. Every design call is either "copy Phase 92 verbatim" or "apply the affordance-narrowing decision Alice already made." The interesting judgment calls are Claude's-discretion planner-picks (plan slicing, affordance render site) — none is a load-bearing decision that would change the shape.

</specifics>

<deferred>
## Explicitly Deferred / Out of Scope

- **Multi-user re-scoping** of either sentinel (pinned or hidden) — separate future phase; would migrate both together.
- **Hiding non-identity rows persistently** (RDP, openTab, relay-room) — the affordance narrowing is the choice; feature deletion is deliberate.
- **Any change to pinned behavior** — quick-260912-5q2 landed the both-loaded hydrate gate; this phase extends it to cover hidden but does not touch the pin structure.
- **Retention/cleanup of `.hidden` sentinels when identities are deleted** — future concern; identity deletion doesn't currently exist as a clean flow.
- **Data migration of existing DB `hidden_conversation_ids` to sentinels** — mirrors phase-92's precedent (existing pins were lost on migration too); no user-facing migration path.
- **Diagnostic UI toast / banner** informing users about the affordance change — cost/benefit doesn't warrant, non-identity hidden state was rare enough to defer entirely.
</deferred>
