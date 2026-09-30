# Phase 143: Un-archive frontend + backend — Context

**Gathered:** 2026-09-30
**Status:** Ready for planning
**Source:** Shape file — `.planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md` (opened + greenlit 2026-09-30 via /build → /open with 8 grill rounds + 2 tasting iterations)

<domain>
## Phase Boundary

This phase delivers the user-facing half of un-archiving for the three archivable types (identity, role, app). The on-box reconciler side already exists (shape 1 of the un-archiving campaign, closed + pushed at `3c973525..87dea3a8` on `feat/tab-title-from-tmux`). Shape 2 adds: three POST endpoints that drop the `.unarchive-requested` sentinel inside the archive folder with server-side preconditions; three GET list endpoints so the frontend can enumerate archived items of each type; the frontend surfaces where archived things are visible and un-archivable (new archived-apps modal, new archived-roles collapsed section in the drama-masks roles modal, new interaction affordance on archived-identity rows in the conversation search modal); a new always-visible kebab-menu affordance on rows that replaces right-click for archive/un-archive on the affected modal surfaces (right-click retired on those surfaces); native-alert success + failure UX; and id-skill edits per-surface + un-archive sentinel-drop pattern for agents.

Sidebar conversation rows are NOT touched — they preserve their existing right-click menu. Sidebar affordance normalization is a sibling shape (shape 3 declared in the campaign artifact, not this phase).

</domain>

<decisions>
## Implementation Decisions

### Backend — un-archive endpoints (three POST routes)

- **D-01**: Three new POST endpoints — un-archive for identity, role, app respectively. Each parallels the shape of the existing archive routes at `src/backend/database/routes/{identity,role,apps}-archive.ts`. Each takes the name/slug of the archived thing and drops an `.unarchive-requested` sentinel inside its ARCHIVE folder (not the live folder — the live folder doesn't exist yet at un-archive time). Retirement of sentinel + folder move is the reconciler's job (shape 1).
- **D-02**: Endpoint-side fast-path preconditions on each POST:
  - **archive-exists**: refuse if the archived folder does not exist at the expected path
  - **name-collision**: refuse if a live-tree object with the same slug/key/name already exists
  - **all-roles-live** (identities only): parse the archived identity's `role:` frontmatter (handles scalar + flow-list + block-list YAML shapes — same Python inline used by shape 1's supervisor scanner) and refuse if ANY listed role is still archived
- **D-03**: Endpoint failure response shape — structured 409 with a `reason` code. `reason` values: `missing_roles` (with `missingRoles: string[]` field naming the still-archived roles), `name_collision`, `archive_not_found`. Non-precondition failures return non-409 status codes.
- **D-04**: Reconciler remains authoritative on-tick. The endpoint precheck is a fast-path defense so the app can surface a reason immediately for the realistic failure (missing roles) rather than after the reconciler's next ~15s tick. Both layers enforce the same preconditions.

### Backend — archived-list endpoints (three GET routes)

- **D-05**: Three new GET endpoints — list archived identities, list archived roles, list archived apps. Parallels the archive-side listing paths. Response is a simple array of archived items (name/slug + minimal metadata needed for row rendering).
- **D-06**: Identity list endpoint exposes the existing internal primitive at `src/backend/claude-session/list-archived-identity-keys.ts` (already used by the conversation search modal). No new listing logic needed — just the HTTP surface. Roles + apps list endpoints are NEW — companion internal primitives are added.
- **D-07**: Host-scoping mirrors each surface's live counterpart:
  - Archived-apps GET → fleet-wide (matches how sidebar apps are keyed `${hostId}:${slug}` and shown mixed)
  - Archived-roles GET → host-scoped (matches roles modal's D-02 host-scoped design)
  - Archived-identities GET → fleet-wide (matches conversation search's fleet-wide scope)

### Backend — per-*-file archive-tree primitives

- **D-08**: Sibling functions per type, NOT a boolean flag on the existing writers. The existing per-*-file writers at `src/backend/claude-session/{per-identity,per-role,per-app}-file.ts` target the LIVE tree with a small whitelist of allowed relative paths. Archive-tree companion functions replicate the writer shape with a NARROWER whitelist — allowed relative path is `.unarchive-requested` only. Rationale: whitelists differ cleanly (live tree allows several files today; archive tree allows exactly one), and adding a "which tree?" parameter to a call site that only ever writes one file obscures intent at the call site.

### Frontend — three archive surfaces

- **D-09**: Archived-apps modal — brand-new modal. Reached from a new small archived-box icon on the RIGHT side of the sidebar's Apps section header (positioned LEFT of the collapse chevron, matching the visual weight of the per-project new-conversation button pattern at `src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` L360-378). Uses the existing shared Dialog primitive at `src/ui/components/dialog.tsx`. Fleet-wide list; rows show app name + rounded-square avatar/icon (mirrors how live apps present in the sidebar; NOT circles); no host label per row.
- **D-10**: Archived-roles collapsed section — new section appended to the bottom of the drama-masks roles modal at `src/ui/features/pretty-view/RolesListModal.tsx`. Section header ALWAYS VISIBLE (even when zero archived roles — mirrors the D-05 lock on the Apps section header per the existing pattern at `PrettyConversationsPanel.tsx` line ~2996). Expand is lazy — archived roles are loaded from the GET endpoint only when the user expands the section. Row visual matches existing `.pv-row` treatment (hue-tinted gradient, 40px round avatar, chevron on the right).
- **D-11**: Conversation search modal archived-identity rows — the "coming soon" left-click alert at `src/ui/features/pretty-conversations/ConversationSearchModal.tsx:174` is retired. Archived-identity rows gain the always-visible kebab-menu affordance (see D-13). Left-click on an archived row either does nothing or shows a lightweight hint pointing at the kebab; NO drill-in (the identity's conversation surface doesn't exist while archived).

### Frontend — always-visible kebab-menu affordance on rows

- **D-12**: Always-visible three-dots (⋮) icon on every row of every affected surface. Rows affected: live rows in the drama-masks roles modal, plus all archived rows in the three archive surfaces above. Uses the existing shared DropdownMenu primitive at `src/ui/components/dropdown-menu.tsx`. Visual pattern matches the per-project new-conversation button: `inline-flex items-center justify-center size-5 rounded hover:bg-white/5 text-[#5c6070]/85 shrink-0` (approximate — planner adjusts to match live-app design tokens).
- **D-13**: Menu contents:
  - For a LIVE role row → single item "Archive"
  - For an ARCHIVED row (any type) → single item "Un-archive"
  - Menu is a proper popover (DropdownMenu) even when single-item — establishes an extensibility point for future actions.
- **D-14**: Click behavior — clicking the three-dots icon STOPS PROPAGATION on the mouse-down and click events so the row's default click handler (e.g. opening the RoleModal on live-role rows) does NOT fire. Menu item click fires the un-archive/archive request via the corresponding endpoint.
- **D-15**: Right-click retired for archive/un-archive on the affected modal surfaces (roles modal live rows, archived-apps modal rows, conversation search modal archived rows). Existing right-click implementations (e.g. PrettyConversationContextMenu wired into the roles modal) get the Archive item REMOVED or the whole invocation retired on these surfaces. Sidebar conversation rows preserve their existing right-click menu unchanged — that is out of scope for this phase.

### Frontend — success and failure UX

- **D-16**: Success feedback — on endpoint 200 for archive OR un-archive, the row is OPTIMISTICALLY REMOVED from the list and a native `alert()` fires with copy shaped like: "Un-archiving [role/conversation/app] — it may take a moment to reflect elsewhere in the app." (Or "Archiving …" symmetrically for archive.) The alert reflects the ~15s reconciler tick without forcing the user to sit and watch a spinner.
- **D-17**: Failure feedback — on any failure, the row STAYS (no optimistic removal) and a native `alert()` fires with the reason. Distinct wording for `missing_roles`: "Un-archive role X first — this [identity/conversation] depends on it." Generic fallback for everything else (`name_collision`, `archive_not_found`, non-409 errors): "Couldn't un-archive [X] — try again in a moment." Alerts are native `alert()`, NOT sonner toasts (sonner is available in the codebase but deliberately not used for this feature — Ashley's decision: native alerts are blocking + impossible to miss for a small-volume high-importance UX signal).

### Frontend — empty states + modal behavior

- **D-18**: Empty state — the archived surfaces (archived-apps modal, archived-roles collapsed section) are ALWAYS VISIBLE even when zero archived items exist. Body shows a quiet muted-text line: "No archived apps." or "No archived roles." Reason: discoverability — user needs to know the archived surface exists even before they've archived anything.
- **D-19**: Modal stays open after un-archive — the user may want to un-archive multiple items in one session; auto-closing forces re-open cycles. Same rule for the archived-roles collapsed section (expand + un-archive + section stays expanded, row gone).

### id-skill edits

- **D-20**: Edit substrate source at `substrate/skills/id/SKILL.md`, NOT the distributed copy at `~/.claude/skills/id/SKILL.md`. Distribution follows the next distributor sweep.
- **D-21**: Per-surface additive edits (no cross-cutting "kebab pattern" section — pattern is described where it appears on each surface):
  - Update the drama-masks / roles-modal section to describe (a) the collapsed archived-roles section, (b) the always-visible three-dots menu on rows for both Archive and Un-archive, (c) retirement of right-click on this surface.
  - Update the sidebar Apps section header description to describe the archived-box-icon affordance and the archived-apps modal it opens.
  - Update the conversation search modal description to describe the kebab on archived-identity rows for Un-archive; retire the "coming soon" alert note.
- **D-22**: Add the un-archive sentinel-drop pattern to the archive-related section (paralleling how the archive sentinel-drops are already documented for agents). NO new `/id unarchive` slash-command is added — agents un-archive by dropping `.unarchive-requested` inside the archived folder, same as they already do for archive in the reverse direction.

### Test migration

- **D-23**: Update or rewrite tests that currently lock the retired right-click → Archive on the affected modal surfaces. Include the conversation search T-08 test that pins the "coming soon" alert (at `src/ui/features/pretty-conversations/ConversationSearchModal.test.tsx`).
- **D-24**: Add new tests for the three POST endpoints (success paths + each failure precondition — missing_roles, name_collision, archive_not_found, network/500).
- **D-25**: Add new tests for the two new GET list endpoints (roles + apps).
- **D-26**: Add new frontend tests — archived-apps modal rendering + row list + kebab-menu Un-archive click + optimistic remove + alert-on-failure paths. Archived-roles collapsed section rendering + expand + lazy-load + kebab-menu Un-archive. Kebab menu on live-role rows for Archive.
- **D-27**: Any design-lock tests that pin the retired right-click-archive invariants are REMOVED with breadcrumb comments naming the shape file `.planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md` (mirrors how shape 1 retired D-12 "no _synapse/admin refs" and D-16 "no unarchive keywords" from `agent-supervisor-archive-scan.sh`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (the source of truth for design decisions)

- `.planning/campaigns/un-archiving/shape-unarchive-frontend-backend.md` — the /open shape agreement this phase implements. Read first.

### Campaign context

- `.planning/campaigns/un-archiving/campaign-un-archiving.md` — the un-archiving campaign artifact (concept-open, success criteria, cross-object dependencies, all three shape declarations).
- `.planning/campaigns/un-archiving/shape-unarchive-host-side.closed.md` — the on-box (shape 1) shape file + close-out. Explains what the reconciler already does; this phase drops requests INTO that reconciler.

### Backend — archive-side prior art to parallel

- `src/backend/database/routes/identity-archive.ts` — archive-side identity route (POST /identity/archive endpoint pattern).
- `src/backend/database/routes/role-archive.ts` — archive-side role route.
- `src/backend/database/routes/apps-archive.ts` — archive-side app route.
- `src/backend/claude-session/per-identity-file.ts` — per-identity file writer, LIVE tree, with the allowed-rel-paths whitelist to companion.
- `src/backend/claude-session/per-role-file.ts` — per-role file writer, same shape.
- `src/backend/claude-session/per-app-file.ts` — per-app file writer, same shape.
- `src/backend/claude-session/list-archived-identity-keys.ts` — existing archived-identity listing primitive to expose via new GET endpoint (D-06).

### Frontend — surfaces to modify

- `src/ui/features/pretty-view/RolesListModal.tsx` — drama-masks roles modal. Gains the archived-roles collapsed section (D-10) + always-visible three-dots menu on live rows (D-12) + retirement of right-click Archive on this surface (D-15).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — main sidebar panel. Gains the archived-box-icon affordance on the Apps section header (D-09; look for `data-testid="pretty-conversations-apps-header"` around line ~2996). NO change to sidebar conversation rows (out of scope).
- `src/ui/features/pretty-conversations/ConversationSearchModal.tsx` — conversation search modal. Gains three-dots menu on archived-identity rows (D-11); the "coming soon" alert at line ~174 is retired.
- `src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` — reference for the per-header inline-button visual pattern (line ~360-378) matched by D-09.

### Frontend — shared component primitives to reuse

- `src/ui/components/dialog.tsx` — the shared Dialog primitive backing every modal. Used verbatim for the new archived-apps modal.
- `src/ui/components/dropdown-menu.tsx` — the shared DropdownMenu primitive backing the kebab menus (D-12).

### id-skill substrate source

- `substrate/skills/id/SKILL.md` — the file this phase edits (D-20). NEVER edit the distributed copy at `~/.claude/skills/id/SKILL.md`.

</canonical_refs>

<specifics>
## Specific Ideas

- **Shape 1 test breadcrumbs precedent** — Shape 1 removed the D-12 "no _synapse/admin refs" and D-16 "no unarchive keywords" design-lock tests from `substrate/scripts/tests/agent-supervisor-archive-scan.sh` with breadcrumb comments in-place. D-27 follows the same precedent for the retired right-click-archive invariants.
- **Convenience hook (deferred but named)** — the current "coming soon" left-click alert in the conversation search modal at `ConversationSearchModal.tsx:174` could naturally open the new archived-apps modal or point at un-archive. Not load-bearing for this phase; documented as a possible follow-on.
- **Endpoint idempotency** — the sentinel drop should be idempotent. If the sentinel already exists (double-click, retry), the endpoint returns success as if it just dropped it. Reconciler is designed to be sentinel-driven so this is safe.

</specifics>

<deferred>
## Deferred Ideas

- Sidebar conversation rows (right-click menu with Pin / Open in new window / Move to project / Archive) — normalization deferred to sibling shape 3 (`sidebar-header-affordances`, declared in the campaign artifact during this shape's /open discussion).
- The archive-side script split for apps (the standalone `archive-app.sh` script that today handles part of app archive — not touched by this campaign; only the un-archive side is consolidated into the supervisor via shape 1).
- A `/id unarchive` slash-command for agents (explicitly not added — agents un-archive by dropping the sentinel, same pattern as archive).
- Room-rejoin fidelity for Matrix un-archive (documented drift from shape 1's Matrix reactivation spike — separate follow-up shape only if peer stale-cache trouble becomes user-visible).
- Any change to live-app tiles in the sidebar itself (they keep archiving via their existing right-click).
- Convenience path "un-archive that role first, then this identity" as a one-click flow (refuse-with-reason is the whole path in this phase; user does the two-step manually).

</deferred>

<scope_fence>
## Scope Fence

**IN this phase:**
- Three POST un-archive endpoints + their preconditions + structured 409 responses
- Three GET list endpoints for archived items
- Archive-tree sibling functions for the three per-*-file writers
- New archived-apps modal + its sidebar-header trigger
- New archived-roles collapsed section in the roles modal
- Always-visible three-dots menu on live-role rows + all archived rows across three surfaces
- Retirement of right-click → Archive on the affected modal surfaces (WITH test migration)
- Optimistic-remove + native-alert success/failure UX (distinct wording for missing_roles)
- Always-visible empty-state text on archived surfaces
- id-skill per-surface edits + un-archive sentinel-drop pattern

**OUT of this phase (see Deferred):**
- Sidebar row affordance normalization (shape 3)
- Archive-side script split (not this campaign)
- New agent slash-command
- Room-rejoin fidelity path
- Live-app-tile changes
- One-click convenience "un-archive role first, then this identity"

</scope_fence>

## Success Criteria

- A user can un-archive an identity, a role, or an app via the affected modal surfaces without knowing the sentinel-drop mechanics.
- A user can archive a role via the drama-masks modal's kebab-menu-on-row (retiring the invisible-only right-click gesture on this surface).
- An identity un-archive that depends on a still-archived role is refused with a clear alert naming which role(s) need un-archiving first.
- Zero-archived-items case shows an empty-state line, and the archived affordances still render (discoverability).
- Right-click on affected modal surfaces no longer opens an Archive menu; the three-dots-menu path is the sole visible + expert path (sidebar rows unchanged).
- id-skill is updated in the substrate source so every fleet-distributed session teaches the new pattern accurately.
- All new + updated tests pass; retired-invariant tests are removed with breadcrumb comments naming the shape file.

## Risk Summary

- **Optimistic-remove without endpoint success** — the row must not be removed until the endpoint returns 200. Test coverage on the failure path must confirm the row stays when the endpoint returns 409 or 500. (See D-16 / D-17.)
- **Scanner-tick failure after endpoint success** — if the reconciler tick fails permanently (mv fails, Matrix reactivation blows up), the user's alert said "will take a moment" but the item never appears elsewhere. Accepted risk: the archived-list is authoritative on next fetch; item re-appears in the modal on next reopen. Not surfacing an active "un-archive failed later" indicator; fetch-on-reopen is the recovery path.
- **Click-conflict on row** — the three-dots-menu click MUST stop propagation so the row's default action (opening the RoleModal on live-role rows in the roles modal) does not fire. Test coverage must confirm this.
- **Race with peer un-archive** — two Skynet tabs open, both un-archive same thing. Endpoint should be idempotent on sentinel-drop (D-08 whitelist allows the sentinel; existing file gets re-touched or leaves it). Reconciler design already handles this on the on-disk side. No user-visible harm.
- **Test debt underestimated** — retiring right-click Archive on the affected surfaces may touch more test surface than expected; the planner must budget for reasonable test-migration work (D-23, D-27).

---

*Phase: 143-un-archive-frontend-backend-three-post-endpoints-with-precon*
*Context seeded 2026-09-30 from shape file (skipping /gsd:discuss-phase per /build's shape-file-seeds-CONTEXT rule)*
