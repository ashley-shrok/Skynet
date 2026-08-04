# Phase 22: Skynet UI parity with the role/identity paradigm — Context

**Gathered:** 2026-08-04
**Status:** Ready for planning
**Source:** PRD Express Path (`~/.claude/roles/box-maintainer/bounties/skynet-role-identity-crud-ui/design-and-waves.md`)

<domain>
## Phase Boundary

Bring the fleet-level role/identity split into Skynet's UI. Six coordinated pieces:

1. **Repoint** IdentityModal's Bounties + History tabs to the role folder via a backend two-step (identity file → `role:` frontmatter → role folder → artifact). Fixes existing gap where these tabs read the now-empty identity folder post-migration.
2. **Add** required Role dropdown on NewSessionDialog + backend `roles:list-for-host` endpoint + Phase 20 identity-birth code writes `role:` frontmatter into new `<name>.md`.
3. **Clone flow** — context menu addition on conversation rows + clone modal + backend clone endpoint. Same host, same role, same color LOCKED; only name/title/voice/avatar editable.
4. **Create-role modal** + backend endpoint (SSHes to host, creates `~/.claude/roles/<role>/` folder + minimal role file + empty bounties/history) + `+ New role` launcher button.
5. **Chain** create-role → create-identity with role + host pre-filled when checkbox true (checkbox defaults to `true`).
6. **Role tab** as FIRST/default tab in IdentityModal + backend `identity:get-role-file` / `identity:update-role-file` ops doing the two-step to read/write `~/.claude/roles/<role>/<role>.md`.

**NOT in this phase:** DB schema changes, delete role/identity, manage-roles list surface, legacy no-role identity handling (Ashley confirmed no such identities exist post-migration), role display outside IdentityModal.

</domain>

<decisions>
## Implementation Decisions

### Data model
- **Roles are pure filesystem — NO Skynet DB column for role.** Adding a role column to `identities` would create a two-source drift problem (Skynet DB vs fleet `<name>.md` frontmatter). Any plan that adds a `role` column is a plan-checker BLOCK.
- **The identity's role lives ONLY in the fleet-side `<name>.md` frontmatter** (`role: <name>`). Backend does the identity-file → frontmatter → role-scoped-artifact two-step for all role-scoped ops. Frontend API stays `(identityKey, hostId)` — never `(role, hostId)`.
- **No `host_id` column added to `identities`.** Source's host for clone comes from the clicked session's host context (Skynet already knows the session's host). Any plan that adds a target-host picker to the clone modal is a plan-checker BLOCK.

### Backend endpoints (new)
- `roles:list-for-host` — SSHes to host, `ls ~/.claude/roles/`, returns `[{name, description}]`. Description = `## Role` section content per id skill template (planner confirms exact source).
- `roles:create` — takes `(name, description, hostId)`. Validates name (kebab-case-lowercase, doesn't already exist on host). SSHes to host: `mkdir ~/.claude/roles/<name>/` + `mkdir ~/.claude/roles/<name>/bounties/` + `touch ~/.claude/roles/<name>/history.md` + writes stub `<name>.md`.
- `identity:clone` — takes `(sourceIdentityKey, hostId, newName, editedTitle, editedVoice, avatarCandidates)`. `hostId` comes from the clicked session's host context. Reads source's fleet `<name>.md` for role, creates new fleet folder on same host with same `role:` frontmatter + fresh relay account (reuse Phase 20 birth logic), copies Skynet DB row with new name + user-edited fields.
- `identity:get-role-file` / `identity:update-role-file` — do the two-step: identity file → `role:` frontmatter → open `~/.claude/roles/<role>/<role>.md` for read/write. Same shape as existing `identity:get-identity-file` / `identity:update-identity-file`.

### Backend endpoints (repointed)
- `identity:get-bounties` and `identity:get-history` (or equivalent — exact naming per planner) — extended to do the two-step so they read from `~/.claude/roles/<role>/bounties/` and `~/.claude/roles/<role>/history.md` respectively instead of the identity folder.

### Backend code changes (existing)
- Phase 20 identity-birth code (`identity-birth-orchestrator.ts` and callers) — when writing the new slim `<name>.md` pointer file, include `role: <picked-role>` in the frontmatter. Birth submit payload adds `role` field passed through from NewSessionDialog.

### Frontend surfaces
- **NewSessionDialog** — new REQUIRED `Role` dropdown, positioned near host picker. Populates via `roles:list-for-host`; re-populates when host changes. Blocks submit if empty. Submit payload adds `role` field.
- **Clone modal** — new component (probably `CloneAgentDialog.tsx`, or NewSessionDialog with a `mode="clone"` prop — planner's call). Fields: Name (required, blank, default `<source>-2`), Title (editable, pre-filled from source), Voice (editable, pre-filled from source), Avatar (pre-filled with source's; option to regen 3 new candidates via Phase 20 avatar batch flow). Host + Role + Color are LOCKED — NOT shown or editable.
- **Context menu** — add `Clone` item to `PrettyConversationContextMenu`'s items array via `PrettyConversationsPanel`. `onClick` reads clicked row's host from existing session context and opens clone modal.
- **CreateRoleDialog** — new component. Fields: Name (required, kebab-case-lowercase, validated), Description (required), Host picker (same set NewSessionDialog uses), checkbox `Then create an identity with this role` DEFAULT `true`.
- **`+ New role` launcher** — button placement MVP is sidebar next to `+ New agent` (planner may adjust).
- **IdentityModal** — new Role tab as FIRST tab (position 0), `activeTab = "role"` as default. Add lucide icon (probably `Users` — planner picks). New `RoleFileTab.tsx` mirrors `IdentityFileTab.tsx` pattern.

### UX rules
- **Clone is true-to-the-word.** Host/Role/Color are auto-copied and LOCKED. Only Name/Title/Voice/Avatar editable. Any plan that exposes host/role/color as editable on clone is a plan-checker BLOCK.
- **Required-role dropdown is CREATE-only.** No affordance to edit an identity's role assignment anywhere in the UI.
- **`Then create an identity with this role` defaults to TRUE.** Ashley: "obviously going to want an identity to take on the new role otherwise you'll have a role without any identities."
- **Role tab is FIRST and DEFAULT** in IdentityModal — not slotted after Identity, not toggleable in position.
- **Chain from create-role modal to create-identity modal** happens on submit only when checkbox is TRUE. Skips chain when unchecked.

### Failure modes / edge cases
- **Zero roles on selected host** in the NewSessionDialog dropdown — MVP shows a "no roles on this host — create one first" link that opens CreateRoleDialog (planner may pick simpler "just empty dropdown"; either is acceptable).
- **Clone name collision** with existing fleet folder on target host — clone endpoint validates before writing and returns an error the modal surfaces inline.
- **No no-role fallback branches anywhere.** Ashley confirmed 2026-08-04 no fleet identity lacks `role:` frontmatter post-migration. Any plan that adds "graceful (no role)" fallback branches or empty-state handling is a plan-checker BLOCK (dead code).

### Claude's Discretion (planner picks during planning)
- **Description source** in `roles:list-for-host`: first non-heading paragraph vs `## Role` section content. Default `## Role` (matches id skill template).
- **Placement of `+ New role` button**: sidebar next to `+ New agent`, gear menu, or another obvious spot.
- **Clone modal architecture**: new dedicated `CloneAgentDialog.tsx` vs NewSessionDialog with a `mode="clone"` prop.
- **Description placement in stub `<role>.md`**: under `## Role` (matches id skill template), plain-text before any heading, or its own `## Description` heading. Default `## Role`.
- **Clone name uniqueness validation**: almost certainly a pre-write check against existing fleet folders on target host.
- **`role:` frontmatter parser**: reuse existing YAML frontmatter parser if it exists, else add a minimal one.
- **Icon for the Role tab**: probably `Users` from lucide, planner picks.
- **When chained into NewSessionDialog with role + host pre-filled, are those fields editable or locked?** Default: pre-filled but editable.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design source-of-truth (locked)
- `~/.claude/roles/box-maintainer/bounties/skynet-role-identity-crud-ui/design-and-waves.md` — Locked design + wave breakdown. Reviewed by Ashley 2026-08-04.
- `~/.claude/roles/box-maintainer/bounties/skynet-role-identity-crud-ui/bounty.json` — Bounty metadata + premise.

### Fleet-level role/identity paradigm (source of truth for the shape being mirrored)
- `~/.claude/skills/id/SKILL.md` — The id skill defining role/identity split, role file template, standard sections, `role:` frontmatter format, bounty/history/handoff artifacts. Read to understand what a "role" is on disk.

### Prior Skynet phase this extends
- `.planning/phases/20-identity-creation-ui/20-CONTEXT.md` — Phase 20 identity-birth flow context — describes the birth orchestrator we extend to write `role:` frontmatter and to reuse for clone.
- `.planning/phases/20-identity-creation-ui/20-04-PLAN.md` — Phase 20 identity-birth-orchestrator plan.
- `.planning/phases/20-identity-creation-ui/20-05-PLAN.md` — Phase 20 extended NewSessionDialog plan (the modal we add the Role dropdown to).
- `.planning/phases/20-identity-creation-ui/20-06-PLAN.md` — Phase 20 SSE birth-stream consumer plan.

### Prior Skynet phase whose modal pattern we mirror
- `.planning/phases/18-identity-modal-full-editability-across-all-tabs/` — Phase 18 established the IdentityModal tab pattern (fetch state + markdown preview + inline edit) that our new Role tab mirrors. The `identity:get-identity-file` / `identity:update-identity-file` ops that our new role-file ops parallel.

### Existing frontend surfaces to touch
- `src/ui/features/pretty-view/IdentityModal.tsx` (1360 lines) — Add Role tab as first tab. Location for tab array is around L203, `activeTab` default around L167.
- `src/ui/features/pretty-view/IdentityFileTab.tsx` — Pattern for new `RoleFileTab.tsx`.
- `src/ui/features/pretty-view/HistoryTab.tsx`, `HandoffTab.tsx`, `WakeupsTab.tsx` — Existing sibling tab renderers for reference.
- `src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx` — Generic context menu component; add `Clone` item to items array via caller `PrettyConversationsPanel.tsx`.
- `src/ui/sidebar/NewSessionDialog.tsx` — Add Role dropdown, wire host-change re-populate, add role to submit payload.

### Existing backend surfaces to touch
- `src/backend/claude-session/claude-session-server.ts` (~2270+ lines) — Currently handles `identity_get_identity_file` / `identity_update_identity_file` operations. Add analogous `identity_get_role_file` / `identity_update_role_file` (with two-step frontmatter parse). Repoint bounties + history reads to role folder.
- `src/backend/database/routes/identity-birth-orchestrator.ts` — Phase 20 identity-birth code. Modify to accept and write `role:` frontmatter on new identity file creation.
- `src/backend/database/db/index.ts` — Skynet `identities` table schema. **DO NOT MODIFY** — no schema changes in this phase (roles are filesystem, not DB).
- `docker/nginx.conf` + `docker/nginx-https.conf` — Every new backend route needs matching `location` blocks in BOTH files (per project CLAUDE.md rule).

</canonical_refs>

<specifics>
## Specific Ideas

**Backend two-step pattern** (used by SRIC-01 and SRIC-06):
```
Given (identityKey, hostId):
  1. SSH to hostId, read ~/.claude/identities/<identityKey>/<identityKey>.md
  2. Parse YAML frontmatter (the block between `---` at the top)
  3. Extract `role:` value
  4. SSH to same host, open the role-scoped artifact at ~/.claude/roles/<role>/...
  5. Return artifact content to frontend
```

**Clone submit sequence** (SRIC-03):
```
Given (sourceIdentityKey, hostId, newName, editedTitle, editedVoice, avatarCandidates):
  1. Read source's fleet <sourceIdentityKey>.md for role
  2. Validate newName doesn't collide on target host (fleet folder check)
  3. Create ~/.claude/identities/<newName>/ + <newName>.md with same role: frontmatter
  4. Register fresh relay account (reuse Phase 20 birth logic — no bootstrap dance needed for clone since we're not spawning an agent, just prepping the identity)
  5. Insert Skynet DB row (identity_key = newName, display_name = newName, color_hue = source's, avatar_* = user's pick or source's, voice = editedVoice, title = editedTitle)
  6. Return new identity to frontend
```

**Create role submit sequence** (SRIC-04):
```
Given (name, description, hostId):
  1. Validate name is kebab-case-lowercase
  2. SSH to hostId, check ~/.claude/roles/<name>/ doesn't exist
  3. mkdir ~/.claude/roles/<name>/
  4. mkdir ~/.claude/roles/<name>/bounties/
  5. touch ~/.claude/roles/<name>/history.md
  6. Write ~/.claude/roles/<name>/<name>.md with stub:
     # <Name>
     ## Role
     <description>
  7. Return success to frontend
```

**Chain sequence** (SRIC-05):
```
On CreateRoleDialog submit with checkbox=true:
  1. Fire roles:create endpoint (SRIC-04)
  2. On success: close CreateRoleDialog
  3. Open NewSessionDialog with { role: newRoleName, host: selectedHost } pre-filled
  4. User completes the identity fields + submits normally
```

**Skynet fork Nginx rule (CLAUDE.md, load-bearing):** Every new backend route needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`, else it 200s with `index.html` and crashes the frontend on `.map`. This applies to every new endpoint in this phase.

</specifics>

<deferred>
## Deferred Ideas

Explicitly out of scope for this phase (from design-and-waves.md):

- **Delete role / delete identity affordances.** Future bounty if needed.
- **A dedicated "Manage roles" list surface.** MVP is just the `+ New role` launcher button; a list surface can come later.
- **Display of role outside IdentityModal.** No badge on avatar in conversation list, no filter-by-role, no role in the sidebar. IdentityModal is the only surface where role is visible in this phase.
- **Backfill legacy Skynet DB rows with role information.** Moot — no DB column exists (roles are filesystem-only).
- **No-role fallback / graceful empty branches.** Ashley confirmed no such identities exist post-migration; adding dead code branches is a plan-checker BLOCK.
- **Editing an identity's role assignment.** Not supported in this phase. Users edit role frontmatter directly via the identity file (visible in the existing Identity tab) if they need to change it.

</deferred>

---

*Phase: 22-skynet-ui-parity-with-the-role-identity-paradigm*
*Context gathered: 2026-08-04 via PRD Express Path from `~/.claude/roles/box-maintainer/bounties/skynet-role-identity-crud-ui/design-and-waves.md`*
