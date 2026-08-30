# Phase 25: Sidebar role-clustering — group identities by role within host — Context

**Gathered:** 2026-08-05
**Status:** Ready for planning
**Source:** In-conversation design lock with Ashley 2026-08-05

<domain>
## Phase Boundary

Add a silent secondary sort key to the sidebar row list so identities of the same role cluster together within each host. The whole point is clone-adjacency: when a role has multiple identities (clones share a role by construction), their rows appear together in the list, tightening the visual coherence colorHue-inheritance already provides.

**In scope**: sort logic only — 3 sort-call sites in `src/ui/state/conversation-store.ts`, plus the plumbing needed to make `role` available on the identity payload the frontend consumes.

**Out of scope**: any visible chrome (role subheadings, dividers, per-role color bands, list-item labels), any role-editing UI, any DB schema change, any special "roles that span multiple hosts" handling.

</domain>

<decisions>
## Implementation Decisions

### Sort semantics (LOCKED)

- **Sort tuple everywhere: `(host, role, label)`**. Applied to all three tiers of `PrettyConversationsPanel`: ActiveSet, Pinned, and Tier-3 host-grouped-per-bucket.
- **Host is always outer.** Ashley verbatim: *"host is above role always."* In Tier 3, host is already the visible bucket structure — role becomes the primary inner sort. In ActiveSet + Pinned tiers, host becomes an invisible outer sort key (no subheading, no chrome — just re-orders rows).
- **Within each role, sort by label.** Falls back to today's ordering when a role has one member.
- **Case-insensitive alphabetical throughout.** Consistency for muscle memory — Ashley verbatim: *"as long as the stuff is showing up in the same place always, then that helps you find it, and that's what I care about."*
- **Applies to all three tiers, not just Tier 3.** Ashley: *"most of the reason that we care about grouping is so that you can have them visually grouped while you're working with them."* Active-set is where you're working; clustering must hold there too.

### Null-role handling (LOCKED)

- Identities whose file lacks `role:` frontmatter → sort to the **bottom** of their host bucket (treat null-role as sort-later-than-any-real-role).
- Rows without an identity at all (RDP panes, other synthesized rows) → same treatment: bottom of bucket.
- Rationale: roles are the primary organizing key you'd scan for; less jarring for anomalies to accumulate at the tail than lead each bucket.

### No visible affordance (LOCKED)

- NO role subheading in any tier.
- NO indent, connecting line, color band, or per-cluster visual affordance.
- NO extra info added to row list items. Ashley verbatim: *"the title that they get will a lot of times be the role, but look prettier. And I'm not interested in adding extra info to those list items."*
- Rationale: colorHue inheritance on clones already gives an implicit "same-hue adjacent" visual cue; clone-clustering by position is the whole payoff. Adding chrome would fight the aesthetic Ashley has locked (§ Skynet direction in role file).

### Mechanism (LOCKED)

- **NO DB schema change.** Ashley verbatim: *"I believe it should stay out of the database, and it could just be read when all of the sessions in the list are enumerated, because that only happens once when you load the page anyway, so I feel like that'd be pretty easy."*
- Role is resolved fs-side at list-enumeration time using the existing `resolveRoleForIdentity` helper in `src/backend/claude-session/identity-artifact-reader.ts:227`. That helper reads `role:` frontmatter from `~/.claude/identities/<key>/<key>.md` — LOCAL fs read on skynet-ec2, or SSH exec on the host where the identity file lives. It already knows LOCAL-vs-REMOTE branching.
- Role plumbs through the identity list payload: `GET /identities` (`src/backend/database/routes/identities.ts:68`) resolves role per row, `publicIdentity()` (`identities.ts:52`) adds it to the wire type, `Identity` frontend type (`src/ui/api/identities-api.ts`) adds `role: string | null`, `useIdentities()` (`src/ui/state/identities-store.ts`) surfaces it via `byKey`.
- Reads happen once per page load — same cadence as identity list refresh today.
- **Host selection for the resolve**: identities are user-scoped (not host-scoped) in Skynet's DB — one identity can exist on multiple fleet hosts, but its `role:` frontmatter is the same across every host that has it (birth and clone both write the same role). Simplest: resolve from whichever host has the identity file; if multiple, LOCAL-first, else pick any one (they agree by construction).

### Sort sites (LOCKED)

Three `compareByLabel` call sites in `src/ui/state/conversation-store.ts`:
- **:365** — ActiveSet sort (`activeSetRows.sort(compareByLabel)`)
- **:403** — Pinned sort (`pinned.sort(compareByLabel)`)
- **:431** — Tier 3 grouped per-host sort (`rows.sort(compareByLabel)` inside each host bucket loop; also :458 for the fallback orphan-host branch — same treatment)

Replace `compareByLabel` with a new comparator (`compareByHostRoleLabel` or similar) that implements the `(host, role, label)` tuple. Tier 3 already has an outer host bucket structure; the comparator still includes host for defense-in-depth and consistency, though in that call it'll be a no-op (all rows in a bucket share a host).

### Claude's Discretion

- Comparator naming and internal structure.
- Whether to keep `compareByLabel` around for other call sites or delete if unused.
- Test file placement (new test file vs. extend existing `conversation-store.test.ts` if one exists).
- Backend `resolveRoleForIdentity` invocation shape at list-endpoint time — parallelize across identities vs. serial, error handling if a role-file read fails (recommended: swallow-and-null so a single bad identity file doesn't 500 the list endpoint; log at warn level).
- Wire-type field name: `role: string | null` on `publicIdentity()` and `Identity`.
- Frontend row-payload plumb path: which layer joins identity.role onto the row for the sort comparator.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing role resolution (LOCAL/REMOTE fs read helper — already built and tested)
- `src/backend/claude-session/identity-artifact-reader.ts:207-260` — `resolveRoleForIdentity(conn, identityKey)` — extracts `role:` from identity markdown frontmatter, LOCAL vs REMOTE branch handling. Throws on missing frontmatter (Phase 22 SRIC contract, LOCKED 2026-08-04: no fallback branches). Downstream planner should decide whether the list-endpoint invocation catches this throw (recommended) or lets it propagate.

### Existing identity list endpoint (add `role` to payload here)
- `src/backend/database/routes/identities.ts:52-84` — `publicIdentity()` shape + `router.get("/")` handler. Add `role` field to shape; resolve per identity at list time.

### Existing wire type + frontend store (thread `role` through here)
- `src/ui/api/identities-api.ts` — `Identity` type; add `role: string | null`.
- `src/ui/state/identities-store.ts` — `useIdentities()` hook returning `byKey: Map<string, Identity>`.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:241` — where `byKey` is consumed; comparator will need identity lookup by row's identityKey.

### Sort sites (change these)
- `src/ui/state/conversation-store.ts:365` — ActiveSet.
- `src/ui/state/conversation-store.ts:403` — Pinned.
- `src/ui/state/conversation-store.ts:431` — Tier 3 host bucket.
- `src/ui/state/conversation-store.ts:458` — Tier 3 orphan-host bucket (same treatment).
- `compareByLabel` definition — locate and change/replace.

### Related Phase 22 SRIC (background — role/identity paradigm foundation)
- `.planning/phases/22-skynet-ui-parity-with-the-role-identity-paradigm/` — the phase that landed `resolveRoleForIdentity` and the role/identity split. Phase 25 is a small consumer of that foundation.

</canonical_refs>

<specifics>
## Specific Ideas

- The `compareByLabel` comparator today only takes two `ConversationRow`s. The new comparator needs identity lookup to derive role. Two shapes: (a) inject identity map at sort-site (pass byKey into computeSnapshot), or (b) enrich `ConversationRow` with `role` at row-construction time (rowFromTab and fleetSyntheticRows both build ConversationRow — add role there via byKey lookup). (b) keeps the comparator pure and matches how `identityKey` is already on the row.

- For null-role sort-to-bottom: use a tuple where null-role rows sort AFTER all real-role rows. Idiomatic pattern: `(role ?? "￿", label)` OR explicit branch — planner picks.

- Case-insensitive: `String.prototype.localeCompare(other, undefined, { sensitivity: "base" })` handles case + diacritics; use for both role and label comparisons.

- Testing: `conversation-store` has tests today (frontend suite is `npx vitest run`). New sort behavior needs coverage for: (a) role-clustering happens within a host bucket, (b) host outer works across hosts in ActiveSet/Pinned, (c) null-role rows sort last, (d) case-insensitivity across role AND label, (e) same-role different-label sorts by label, (f) same-everything remains stable.

- Backend endpoint: `router.get("/")` today doesn't call any per-row helpers. Adding N `resolveRoleForIdentity` calls (N = number of identities for user, small ~dozen) adds latency. Parallelize via `Promise.all(rows.map(...))`. Total is ms in the LOCAL case; REMOTE (SSH exec) is 100s of ms per identity — batch or accept the round-trip cost. Ashley's mental model is "once per page load," which is fine.

</specifics>

<deferred>
## Deferred Ideas

- **Role-editing UI.** Not part of this phase; would require its own flow to update `role:` frontmatter, and if we later add it, that UI is where "role changed" invalidation lives (frontend just calls `refreshIdentities()`).
- **Cross-host role clustering.** Ashley: *"we don't care [that role X exists on both hosts A and B]. We just care, like, you know, if you follow the hierarchy, host is above role always."* Not a future feature — a deliberate design choice.
- **DB denormalization of role.** Considered and rejected by Ashley in favor of fs-read-at-list-time.
- **Visible chrome (subheadings, badges, cluster dividers, per-role color bands).** Considered and rejected. If Ashley ever asks for it later, it'd be a new phase, not a follow-up.
- **Role-order preference beyond alphabetical** (e.g. "role of currently-selected row floats first"). Discussed, rejected — Ashley's core value here is CONSISTENCY.

</deferred>

<scope_fence>
## Scope Fence

**In**:
- Backend: `GET /identities` list endpoint invokes `resolveRoleForIdentity` per row, adds `role` to `publicIdentity()`.
- Wire: `Identity` type gains `role: string | null`.
- Frontend: `role` threaded onto `ConversationRow` at construction time (via `useIdentities().byKey` lookup keyed by `identityKey`).
- Frontend: new sort comparator (`(host, role, label)` case-insensitive alphabetical, null-role-last) replaces `compareByLabel` at ActiveSet / Pinned / Tier-3-bucket / orphan-host-bucket sites.
- Tests: coverage for the new comparator + integration coverage that identity list payload carries `role`.

**Out**:
- Any DB schema change.
- Any visible chrome addition to list items.
- Any role-editing surface.
- Any change to Tier 3's outer host-bucket structure or per-host-bucket subheadings.
- Any handling of role membership changes at runtime (page-load semantics carry — Ashley explicitly).
- Any change to `resolveRoleForIdentity`'s throw-on-missing behavior (Phase 22 LOCKED). List endpoint catches and treats as null-role.
- Any RDP-row-specific treatment beyond "sorts to bottom via null-role handling."

</scope_fence>

---

*Phase: 25-sidebar-role-clustering-group-identities-by-role-within-host*
*Context gathered: 2026-08-05 via in-conversation design lock with Ashley*
