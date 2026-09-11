# Phase 92: pin-sentinel-migration — move identity pin state from Skynet DB to `.pinned` on-disk sentinel per identity folder - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Move identity pin state OFF the Skynet database and ONTO the identity's host as the presence-or-absence of a small marker file (`.pinned`) inside the identity's folder. Same "presence is meaning" pattern already used by `.no-dormancy` and `.recycle-requested`. Generalize the identity-birth SFTP wire (shipped Phase 77) into a per-identity file-touch primitive with two callers: identity-birth (existing) + pin action (new). Drop the DB column that currently holds pin state in the same schema migration. Existing pinned identities migrated manually per-box by each box's maintainer — no code participates in the migration.

Shape 1 of 4 in the id-skill-revamp multi-shape campaign; Shapes 2/3/4 (agent-supervisor archive extension, on-disk tree consolidation, substrate prose polish) are separate downstream phases.

</domain>

<decisions>
## Implementation Decisions

### Storage location
- **D-01:** Pinned-ness IS the presence of a marker file at `~/.claude/identities/<name>/.pinned` in the identity's folder on its host. File is EMPTY — contents never encoded and never read. Absence = not pinned; presence = pinned. No metadata (no timestamp, no admin identifier, no priority). Matches `.no-dormancy` / `.recycle-requested` convention verbatim.
- **D-02:** Current storage (`user_preferences.pinned_conversation_ids` — a comma-separated identity-key text column on the per-user preferences row) is dropped in the same schema migration this phase ships. No dormant table left behind. Sibling `hidden_conversation_ids` on the same row is OUT of scope and untouched.

### Read path (from disk, at request time)
- **D-03:** The chat app's per-identity metadata read grows a `pinned: boolean` field populated by disk-read at request time — same pattern the `task` field (Phase 80) and cosmetic fields (Phase 86) already use. NO in-memory pin cache. NO DB mirror. NO periodic scan-populated store.
- **D-04:** The conversation-store `pinnedIds: Set<string>` on the frontend continues to exist as UI convenience state, but is now derived by reading each identity's `pinned` field from the identity metadata payload (post-migration `getPinnedIds` API becomes a projection over identity metadata rather than a read of the dedicated preferences column).

### Write path (synchronous, over the identity-birth wire generalized)
- **D-05:** Pin toggle writes the sentinel over the SAME host file-touch mechanism the identity-birth orchestrator (Phase 77) uses to place `relay.json` on hosts at creation time. Generalize that mechanism into a per-identity file-touch primitive with two callers: identity-birth (existing) + pin action (new). Unpin removes the file over the same wire.
- **D-06:** Writes are SYNCHRONOUS. Pin toggle succeeds or fails right now. No queue, no optimistic-then-reconcile UI, no shadow "desired state" store. On failure the pin state stays unpinned (the truth on disk); the failure reuses whatever generic wire-error treatment the app already surfaces for other failable ops. UI feel is UNCHANGED from current pin toggle behavior — whatever pattern the toggle currently uses (optimistic-flip / spinner / whatever) stays exactly as-is.

### Migration (manual, no code)
- **D-07:** For existing pinned identities, the DB→disk sentinel migration is a MANUAL per-box step by each box's maintainer, sequenced immediately before the container recreate that ships this phase. On t1000, tanya runs `touch ~/.claude/identities/<name>/.pinned` for each identity currently in Alice's `pinnedConversationIds` list. On T800, Stacy does the equivalent on her box. Any other box with an active `pinnedConversationIds` entry, its maintainer. NO code path in Skynet participates in migration.
- **D-08:** Migration order per box: (1) query current `pinnedConversationIds` before deploy; (2) `touch` each `.pinned` sentinel on the host; (3) deploy new code (which reads sentinels, drops the DB column). Sequencing keeps the pin-visible window closed — the moment the new code runs, sentinels are already in place.

### Authorship invariant
- **D-09:** The UI is the SOLE author of pin state. No auto-pinning heuristics, no background sync jobs, no batch pin ops dispatched from scripts. If the human didn't tap the pin toggle in the UI, the sentinel doesn't get written.

### Deferred hazards named in the shape file (locked out of scope)
- Sentinel file contents encoding anything (no timestamps, no admin IDs) — locked by D-01.
- DB pin column left dormant "just in case" — locked out by D-02.
- Optimistic UI without reconciliation — locked out by D-06.
- Auto-pinning / background sync — locked out by D-09.

### Claude's Discretion (implementation-level, planner decides)
- The exact refactor shape for extending the identity-birth SFTP mechanism into a per-identity file-touch primitive (helper function, class method, standalone module — planner decides based on the existing codebase pattern the orchestrator uses).
- Whether `hiddenConversationIds` on the same user_preferences row also gets moved to a `.hidden` sentinel in a bonus scope pass, OR stays as-is for now. Default: STAY AS-IS — out of scope per D-02. Only reconsider if the planner finds it structurally impossible to drop only `pinned_conversation_ids` while keeping `hidden_conversation_ids`.
- Test surface: presence-based sentinel checks, write-then-read cycle, unpin-then-read cycle, wire-failure handling — planner picks the seams.
- Whether the frontend `putPinnedIds([...])` API stays as a single call that writes/removes N sentinels transactionally, OR splits into per-identity `putPinned(identityKey, pinned: boolean)` — planner picks based on how the UI currently batches. Whichever preserves the current UI feel per D-06.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (authoritative for this phase)
- `.planning/shapes/shape-pin-sentinel-migration.md` — Alice's locked shape from /open pass 2026-09-09. All D-01..D-09 above are derived from it. Read this first.

### Campaign context
- `~/.claude/roles/box-maintainer/bounties/id-skill-revamp/shape-id-skill-revamp.md` — original whole-campaign shape (multi-phase). This phase is Shape 1 of 4. Understanding the campaign frame explains why Shape 2 (agent-supervisor archive) benefits from the sentinel existing after this phase ships.
- `~/.claude/roles/box-maintainer/bounties/id-skill-revamp/bounty.json` — campaign hub bounty with cross-shape todos + related links.

### Upstream dependency (proven, in production)
- `.planning/phases/77-*/77-SUMMARY.md` — identity-birth SFTP wire that this phase generalizes. Phase 77 mechanics (matrixCreateOrUpdateUser + matrixLoginAsUser + SFTP-write to `~/.claude/identities/<name>/relay.json`) are the pattern to extend, not re-invent.
- `src/backend/database/routes/identity-birth.ts` — the SFTP write callsite for `relay.json`.

### Sibling sentinels (pattern to match verbatim)
- `substrate/scripts/agent-supervisor.sh` — reads `.no-dormancy` and `.recycle-requested` today. Verbatim precedent for how per-identity sentinel files work in the fleet (`.pinned` follows identical rules).
- `substrate/skills/id/SKILL.md` § "Making yourself always-on — the `.no-dormancy` sentinel" — user-facing documentation of the sentinel precedent.

### Current storage (what's being replaced)
- `src/backend/database/db/schema.ts:838` — `pinnedConversationIds: text("pinned_conversation_ids")` column on `user_preferences` table. Column is dropped.
- `src/backend/database/routes/user-preferences.ts` — read/write handlers for `pinnedConversationIds`.
- `src/ui/api/user-preferences-api.ts` — frontend `putPinnedIds` / `getPinnedIds` API surface. Signature is preserved conceptually; the implementation redirects to per-identity metadata reads/writes.
- `src/ui/state/conversation-store.ts` — consumes `pinnedIds: Set<string>` for the pinned-zone conversation-list ordering. Downstream consumer unchanged in signature.

### Peer disk-read fields (precedent for the per-identity metadata field)
- `.planning/phases/80-*/80-SUMMARY.md` — Phase 80 task-scoped identity paradigm. Task field read on-demand from identity file frontmatter is the read-path pattern this phase mirrors for `pinned`. NOTE: `.pinned` is a SIDECAR FILE next to the identity file, not a frontmatter field — same folder, different reader.
- `.planning/phases/86-*/86-SUMMARY.md` — Phase 86 cosmetics-migrate-to-role. Cosmetic fields read on-demand from role file frontmatter — same disk-read-at-request pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Identity-birth SFTP wire** (`identity-birth.ts` + related orchestrator steps): proven per-identity file-touch mechanism at production identity-birth cadence. Auth path, error handling, connection lifecycle already solved. Generalize INTO a shared primitive with two callers rather than adding a second parallel wire.
- **Sibling sentinel readers** (`agent-supervisor.sh`, `id` skill body): the `.no-dormancy` / `.recycle-requested` reader pattern is literally `[ -f "$dir/.sentinel" ]` — one-line disk check. `.pinned` reader on the backend side is the same shape.
- **Per-identity metadata endpoint**: whatever endpoint the frontend hits to fetch identity fields (task, cosmetic fields) is where `pinned` bolts on. Existing disk-read plumbing does the heavy lifting.

### Established Patterns
- **Presence-is-meaning sentinels** (existing precedent): the fleet already treats `.no-dormancy` / `.recycle-requested` this way. `.pinned` MUST NOT invent a different convention (no JSON body, no content in the file).
- **On-demand disk reads for identity fields** (Phase 80, Phase 86 both established): identity API reads disk when serving the response. No cache invalidation to worry about; disk IS the source of truth.
- **In-memory SQLite + explicit forceSave** (fleet load-bearing invariant): the schema migration that drops the column must be paired with a proper `DatabaseSaveTrigger.forceSave` at the migration step. Standard pattern — planner should confirm the migration slot matches how other schema drops have shipped (Phase 69 identities-table kill is the closest recent precedent).
- **Docker nginx per-path duplication** (fleet trap): if a new served path is introduced (unlikely for this phase — mostly modifies existing endpoints), it needs matching entries in both `docker/nginx.conf` AND `docker/nginx-https.conf` or the frontend hits app-shell 200 instead of the endpoint.

### Integration Points
- **Frontend pin toggle**: today in `PrettyConversationContextMenu` items list with label "Pin"/"Unpin". Callsite calls `putPinnedIds` from `user-preferences-api`. New behavior: same UI, same API-surface signature, backend rewires to sentinel-writes instead of DB writes.
- **Conversation store `pinnedIds` derivation**: today derived from `getPinnedIds` fetch. New behavior: derived from each identity's `pinned` boolean field on identity metadata (planner picks the exact projection).
- **Row-render pin indicator**: `PrettyConversationRow` reads pin-visibility for the top-left pin indicator (existing Phase-48+ affordance). Data source shifts from user-preferences to identity-metadata field; visual treatment unchanged.
- **Zone ordering**: the "pinned zone" in `conversation-store.ts` sorts pinned rows by (host, role, label) — unchanged in behavior; input source shifts.

</code_context>

<specifics>
## Specific Ideas

- **Sentinel filename: `.pinned`** — Alice used this term throughout the /open pass; matches `.no-dormancy` / `.recycle-requested` naming convention verbatim.
- **Manual migration cadence**: Alice 2026-09-09 verbatim: *"we're not doing anything fancy for migration if that's what your second thing that you were talking about is in reference to, you know, Skynet is not doing any migrating. That's such an easy step for you to just do manually that we're not going to get into extra pieces for that."*
- **UI feel invariant**: Alice 2026-09-09 verbatim: *"This isn't changing, so however it feels now is how it's going to feel after this."*
- **Failure UX invariant**: Alice 2026-09-09 verbatim: *"We are not complicating this, so however it would have failed already is how it will fail today, even if it's more likely now than before."*
- **DB pin table disposition**: Alice 2026-09-09 verbatim on the "drop vs. leave dormant" grill: *"Drop it"*.
- **Discovery in scout**: the current implementation is NOT a per-identity `pin: boolean` column — it's a comma-separated text column `pinned_conversation_ids` on the `user_preferences` table (per-user list of identity keys). This shifts the pin ownership model slightly (user-scoped list → identity-global sentinel), which is a coherent move under Skynet's single-tenant reality and the shape's philosophy but worth flagging to the planner.

</specifics>

<deferred>
## Deferred Ideas

- **`.hidden` sentinel** — sibling `hidden_conversation_ids` column on `user_preferences` is structurally the same pattern and could benefit from an identical move. Out of scope for this phase; if the planner finds the DB migration cleaner as a paired drop, it can revisit. Default: stay as-is.
- **Pin metadata** (pinned-at timestamp, pinned-by user, priority order) — deliberately excluded per shape's "what would make it wrong" section. If pin ordering ever becomes desired, it lives in a future phase.
- **Auto-pinning** (based on activity, recency, etc.) — excluded by D-09 (UI is sole author).
- **Per-role or per-workspace pinning** — out of scope; pin stays per-identity.
- **A "pin all" / "unpin all" bulk action** — out of scope.
- **Reactivation of the DB pin column as a shadow mirror if disk-read latency becomes a problem** — actively rejected in the shape; if this problem ever materializes, it's a different-shaped solution (backend memoization, not a DB shadow).

</deferred>

---

*Phase: 92-pin-sentinel-migration*
*Context gathered: 2026-09-09*
