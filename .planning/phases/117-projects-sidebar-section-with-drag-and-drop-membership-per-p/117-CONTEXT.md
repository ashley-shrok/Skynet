# Phase 117: projects — sidebar section with drag-and-drop membership, per-project context file, and id-skill amendment — Context

**Gathered:** 2026-09-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Add "projects" as a third first-class axis of agent context on disk, sibling to roles and identities. Sessions can be grouped into projects; each project has a directory at `~/fleet/projects/<slug>/` holding a `project.md` context file plus room for anything else the project accumulates. Membership is stored in the session file's own frontmatter (`project: <slug>`) — the frontmatter IS the source of truth, no separate index. The sidebar grows a projects zone between the pinned zone and the flat middle: one collapsible header row per project with a new-conversation button, drag-and-drop for assigning/reassigning/clearing project membership, right-click for edit and archive. The id-skill grows a clause that reads a session's project file (if `project:` frontmatter present) and enumerates the project directory silently on `/id` load. The id-skill amendment ships to every managed host via the existing fleet-substrate distributor. Backward compatible — identities without `project:` frontmatter load unchanged.

Discussion was already conducted during `/open` (via `/build`) — see `.planning/shapes/shape-projects.md` for the full agreement. This CONTEXT.md captures the decisions in the workflow's structured shape; the shape file remains the pitch-through-grill record for `/close projects` to walk at the end of the pipeline.

</domain>

<decisions>
## Implementation Decisions

### On-disk shape
- **D-01:** Projects live at `~/fleet/projects/<slug>/` — a new sibling to `~/fleet/roles/` and `~/fleet/identities/` under the fleet substrate.
- **D-02:** Main context file inside is a FIXED filename: `project.md` (not slug-matched). Mirrors runbooks/skills convention where the folder names the thing and a fixed sentinel makes path expressions predictable (`~/fleet/projects/*/project.md`). Explicitly rejected slug-matched naming (`<slug>/<slug>.md`) — role/identity precedent doesn't fit because a project file is one artifact within a broader project directory, not the entire entity.
- **D-03:** Project file has optional YAML frontmatter (system-read: `displayName:`; everything else is user-space) and freeform markdown body. No seed content — create-project mints a bare file with just the `displayName:` frontmatter.
- **D-04:** Slug format is kebab-case, lowercased. Slug is stable — never renamed. Display-name renames edit only the project file's frontmatter.

### Membership
- **D-05:** Membership lives in each session file's frontmatter as `project: <slug>`. No parallel index, no lookup table anywhere else. Moving a conversation between projects is a one-file frontmatter edit.
- **D-06:** One project per conversation (single-valued field). Multi-project membership is explicitly out of scope for v1.
- **D-07:** Missing / dangling / archived project references degrade gracefully — the conversation just falls into the flat middle. No crash, no error banner.
- **D-08:** Terminal sessions are excluded from projects entirely in v1. DnD drop targets refuse them; they don't get a `project:` field on any file that would hold one.

### Sidebar rendering
- **D-09:** Vertical order in the sidebar becomes: Pinned zone (top, unchanged) → individual project headers each with their conversations underneath (new) → flat middle (unassigned, recency-sorted, unchanged) → RDP group (bottom, unchanged). RDP's placement does not move.
- **D-10:** No wrapping super-section labeled "Projects" around the individual project headers — each project header stands on its own, one after another.
- **D-11:** Empty projects (zero conversations assigned) still show up as a header-only section — otherwise you couldn't drop the first conversation into them.
- **D-12:** Project header row shape: single row, same visual as the existing archive and RDP headers. Contents: standardized project icon (chosen from the existing icon set — planning-phase detail) + "Project:" text prefix + display name + small new-conversation button on the right.
- **D-13:** Click behavior on the header itself: collapse/expand that project's conversation list. Collapsed state persists across reloads (a small local UI-state store — planning-phase decides exact location, e.g., localStorage vs the existing session-working store).
- **D-14:** Right-click / long-press on the header: context menu with `Edit project file` (opens the project file for editing — reuses the pattern already used for role-file editing modals) and `Archive project`.

### Ordering
- **D-15:** Everywhere: alphabetical by DISPLAY NAME, not by slug. Applies to projects relative to each other, and to conversations within a project. Rationale (from grill exchange): renames are rare enough that when they happen, the user is usually nudging order on purpose — so let the display name drive the sort.
- **D-16:** For conversations within a project, "display name" resolves per conversation kind: identity's displayName for identity-associated conversations, relay room's display name for relay-room conversations. Terminals excluded per D-08.
- **D-17:** No manual reorder (no drag-to-reorder). If the user wants to nudge ordering, they rename.

### Pinning
- **D-18:** Existing pinned sentinel (`.pinned`) stays as-is — one flag per conversation, hydrated from server, orthogonal to project assignment.
- **D-19:** "Pinned" becomes contextual scope, not visual location: pinned + unassigned floats to the sidebar's top pinned zone (as today); pinned + in-project floats to the top of THAT project's section.
- **D-20:** DnD moving a pinned conversation into a project preserves the pin sentinel — the pin follows, only its visual scope changes.

### Drag-and-drop
- **D-21:** DnD covers the project-membership axis only. Pinning stays a separate action via the existing pin button on the row. Dropping into the pinned zone is NOT a DnD gesture for projects — that zone is not a drop target for this axis at all.
- **D-22:** Three drop gestures: (1) drop onto a project section → writes that project's slug into the dragged conversation's frontmatter; (2) drop into the flat middle → clears the frontmatter field; (3) drop between projects → rewrites the field. The whole project section (header + all rows underneath) is one lit drop zone during a drag — dropping anywhere in it assigns.
- **D-23:** Drop-target visual reuses the existing coral overlay pattern from `PrettyConversationsPanel.tsx:1625` / `SplitView.tsx:446-447` — palette values `rgba(255, 184, 150, 0.22)` background, `rgba(255, 184, 150, 0.60)` border, 2px, zIndex 30. Same visual language, same z-order.

### Create-project flow
- **D-24:** New "create project" button lives in the conversation-list header alongside the existing buttons there (pencil, filter, usage meter chrome per `PrettyConversationsPanel.tsx` header).
- **D-25:** Click opens a small modal asking for a project name. On submit: auto-slugify (kebab-case, lowercased); reject if the resulting slug already exists on disk; on accept, mint `~/fleet/projects/<slug>/project.md` with frontmatter `displayName: <what the user typed>` and empty body.
- **D-26:** No preview of the eventual slug during typing in v1 — the auto-slugify happens at submit. If the user pushes back later we can add a live preview; not now.

### New-conversation-inside-project
- **D-27:** The header's new-conversation button opens the usual new-conversation flow (existing NewConversationModal / NewSessionDialog pattern) with the project already selected. The freshly-minted session file carries `project: <slug>` in its frontmatter from the moment it exists — so it appears inside the project's section on first render, no lag / no post-hoc reassignment.

### Archive
- **D-28:** Archive-project is a right-click / long-press action on the project header. Uses the existing identity-archiving mechanism (Phase 115, `identity-archive-api.ts`) — CASCADED across every conversation currently in the project via that same mechanism, one per conversation.
- **D-29:** Confirmation dialog before the cascade fires. Warning names both consequences explicitly: "About to archive this project AND all conversations inside it. Drag conversations out first if you want to keep any active." Provides both an OK and a Cancel; escape hatch is DnD-out before pressing OK.
- **D-30:** Archived project directory moves to `~/fleet/projects/archive/<slug>/` — mirrors the identity-archive pattern (`~/fleet/identities-archive/<name>/` per Phase 115). Sidebar treats archived projects as invisible; they do not appear anywhere in v1 (no lazy-loaded archived section for projects — that's a v2 nice-to-have).
- **D-31:** A conversation independently archived (outside of a project-archive cascade) does NOT lose its `project:` frontmatter field. Archiving is orthogonal — an archived conversation still knows what project it was in; the sidebar just doesn't render it anymore.

### id-skill amendment
- **D-32:** On `/id <name>` load, after reading the role file and any handoff, the id-skill checks the identity file's frontmatter for a `project:` field. If present, it reads `~/fleet/projects/<slug>/project.md` into context AND enumerates the project directory's top-level contents silently (mirrors current runbooks enumeration — knows the names, contents load on demand via a normal Read tool call).
- **D-33:** If the field is missing OR the slug points to a directory that doesn't exist on disk OR points to an archived project, the amendment is a graceful no-op. The id-skill continues as if the field weren't there.
- **D-34:** Amendment ships via the fleet-substrate distributor. Source of truth for the SKILL.md body is `substrate/skills/id/SKILL.md` in this repo (already an existing 4-row catalog entry per `src/backend/distributor/catalog.ts:216`). Distributor's next sweep pushes it to every managed host. Do not hand-edit installed copies on any host.
- **D-35:** Backward-compatible — identities without `project:` in their frontmatter continue to load exactly as they do today.

### Backend surface
- **D-36:** Identity artifact reader (`src/backend/claude-session/identity-artifact-reader.ts`) grows methods for: reading a session file's `project:` frontmatter field, writing/clearing that field (multipart contract per role rule for write endpoints — must be `multipart/form-data` with field `data`, per `box-map.md § Operating`; JSON body silently 200-no-ops), listing all projects (enumerate `~/fleet/projects/` directory), reading a project's `project.md` file, creating a project (mint directory + bare file with duplicate-slug rejection), archiving a project (move to `~/fleet/projects/archive/` + cascade archive to member conversations via the identity-archive mechanism).
- **D-37:** New wire-protocol event for `project-list-changed` (a project was created, archived, renamed, or a session's project assignment changed) — pushed to connected clients so the sidebar re-renders without a full reload. Follows the existing fleet-status sweep push pattern.
- **D-38:** All backend writes that touch project state or session frontmatter must call `DatabaseSaveTrigger.forceSave` after the write per the load-bearing invariant in the role file — even though projects live on disk under `~/fleet/`, session-frontmatter edits touch the identity file which may propagate into the in-memory database if that file is a Skynet-tracked host. Safer to save-trigger unconditionally after writes.

### Frontend store surface
- **D-39:** Conversation store (`src/state/conversation-store.ts` — via `useConversations`) grows a projects-derived selector: given the current conversation rows + a projects list, produce the buckets the sidebar renders (pinned-unassigned, per-project sections with pinned-in-project promoted, flat-middle, RDP). Store consumes both the existing `usePinnedIds` and a new `useProjects` hook hydrated from the server on load.
- **D-40:** A new hook `useCollapsedProjectSlugs` (or similar) tracks per-project collapse state locally (localStorage-backed). Not server-synced in v1 — collapse state is a personal UI preference, not shared state.

### Claude's Discretion
- Exact placement of the new "create project" button among the existing header buttons — planning-phase picks a spot based on visual balance.
- Icon choice for the project header's standardized icon — pick from the existing `lucide-react` set already used elsewhere in the sidebar (candidates: `FolderOpen`, `Folder`, `Layers`, etc.).
- Whether the collapse-state store is localStorage vs the existing session-working store vs a new small store — planning-phase decides based on where the least new plumbing lives.
- Exact positioning of the project sections relative to the "Pinned" divider chip — do we introduce a new "Projects" divider chip below the pinned block (unlikely given D-10), or do the project headers stand alone with no chip? Planning-phase resolves this against the existing visual language.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape agreement (the pitch-through-grill record)
- `.planning/shapes/shape-projects.md` — Full shape agreement from `/open`, opened + greenlit 2026-09-18. The document `/close projects` will walk at end-of-pipeline. Read this FIRST.

### Fleet substrate — id-skill + distributor
- `substrate/skills/id/SKILL.md` — Current id-skill body. The amendment adds a project-awareness clause.
- `substrate/skills/id/actor-status-prompt.md`, `substrate/skills/id/clone-picker-prompt.md`, `substrate/skills/id/coordinator-instructions.md` — companion prompts distributed alongside SKILL.md.
- `src/backend/distributor/catalog.ts:216-238` — 4-row catalog entry for the id-skill (SKILL.md + 3 companions). If any new companion is added (unlikely for this phase), register it here.
- `src/backend/distributor/run-sweep.ts` — the sweep entrypoint that pushes catalog entries to hosts.
- `src/backend/distributor/ssh-push.ts` — the SSH push machinery.

### Existing sidebar (rendering surface)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — the panel component. Read its top comment block (lines 1-60) for the current three-zone layout invariants. `handlePanelDrop`, `handlePanelDragOver`, `handlePanelDragLeave` at lines 1466-1623 hold the current DnD contract.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:1625-1650` — existing coral drop-target-affordance tint overlay, palette values `rgba(255, 184, 150, 0.22)` / `rgba(255, 184, 150, 0.60)`, zIndex 30. Reuse verbatim.
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — a row (identity row, relay-room row, RDP row). Line 947 documents its DnD source wire contract with `SplitView.tsx`.
- `src/ui/features/pretty-conversations/PinAction.tsx` — the pin button and its guard rules. Read the top comment block for the pin-hide-on-unpinned-non-hover invariant so the projects change doesn't regress it.
- `src/ui/features/pretty-conversations/PrettyArchivedRow.tsx` — added by Phase 115 for identity-archiving. Study its shape for the archive-cascade pattern.

### DnD wire contract
- `src/ui/AppShell.tsx:310-431` — top-level DnD orchestration for the badge-drag flow, including the "coral tint's Escape-cancel path."
- `src/ui/shell/CollapsedPanelCloseLane.tsx` — canonical example of a coral-hover-only drop lane (matches D-23's "no baseline coral" rule).

### Backend — session-file + frontmatter
- `src/backend/claude-session/identity-artifact-reader.ts` — the artifact reader. Grows methods per D-36.
- `src/backend/claude-session/per-identity-file.ts` — per-identity file operations (frontmatter-aware read/write).
- `src/backend/claude-session/session-file-parser.ts` — parses session files; the `project:` field slots into the existing frontmatter parse.
- `src/backend/claude-session/session-file-discovery.ts` — session file discovery.

### Backend — identity archiving (pattern to mirror)
- `src/ui/api/identity-archive-api.ts` — Phase 115 identity-archive API surface. The project-archive-cascade calls this per member conversation.
- (Locate the backend side of Phase 115 identity-archive in planning: `.planning/phases/115-identity-archiving-from-the-frontend/` — read that phase's SUMMARY files to understand the archive mechanism end-to-end.)

### Role rules (invariants to obey in planning)
- `~/fleet/roles/box-maintainer/box-maintainer.md` § Load-bearing invariants — DatabaseSaveTrigger.forceSave rule after backend writes.
- `~/fleet/roles/box-maintainer/box-maintainer.md` § Standing directives — deploy-boundary rules, git-pull-rebase-before-push, container-mutation serialization, executor-vs-orchestrator remit, scoped-vs-full-suite test discipline.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`PrettyConversationsPanel.tsx`** — current three-zone layout (Pinned / flat middle / RDP). Adding a projects zone slots in between Pinned and the flat middle; existing `snapshot.middle` array structure can extend to expose projects buckets alongside the middle.
- **Coral drop-target overlay pattern** — verbatim reuse from `PrettyConversationsPanel.tsx:1625` for the project section drop-target visual. Same palette, same zIndex, same border thickness.
- **DnD wire contract** — `text/plain` payload carrying the row's tab id or session id, read by `Pane onDrop` at `SplitView.tsx:340`. Projects DnD hooks into the same wire contract for consistency.
- **Pin sentinel + `usePinnedIds` hook** — per D-18/D-19, the sentinel stays unchanged; only the derived-buckets selector interprets "top" contextually. No changes to the sentinel storage or hydration path.
- **Identity artifact reader (`identity-artifact-reader.ts`)** — the multipart-form-data write-endpoint pattern per role rule `box-map.md § Operating` extends naturally to project-metadata writes.
- **Fleet-substrate distributor catalog (`distributor/catalog.ts`)** — the id-skill already lives here as a 4-row entry. The amendment is a body-edit to `substrate/skills/id/SKILL.md`; no catalog change needed.
- **Identity-archive api + row (Phase 115)** — the archive-cascade for project archive reuses this end-to-end.

### Established Patterns

- **Frontmatter-driven identity model** — `role:`, `task:`, `displayName:` already read from identity file frontmatter today; adding `project:` slots into the existing parse.
- **`.recycle-requested` / `.archive-requested` sentinel pattern** — user actions drop a sentinel; agent-supervisor's reconcile tick picks it up. Project archive follows the same pattern for the cascade step across member conversations.
- **Fixed-sentinel-filename directory convention** — runbooks (`~/fleet/roles/<role>/runbooks/<slug>/runbook.md`) and skills (`~/.claude/skills/<slug>/SKILL.md`) use it. Projects adopt it exactly (`~/fleet/projects/<slug>/project.md`).
- **Silent runbook enumeration on `/id` load** — the id-skill already enumerates runbook directory names silently; the project-directory-enumeration clause reuses this pattern verbatim.
- **NewConversationModal / NewSessionDialog** — existing new-conversation entry point. The per-project new-conversation button opens the same modal with a `project:` pre-selection.
- **Header buttons in `PrettyConversationsPanel.tsx`** — pencil, filter, usage-meter, three-dots-menu — the create-project button joins this cluster.

### Integration Points

- **id-skill body** at `substrate/skills/id/SKILL.md` — add the project-awareness clause after the role-file-load section, before the handoff-read section. Body-edit only, no new companion files.
- **Distributor sweep** at `src/backend/distributor/run-sweep.ts` — no code change; the edited SKILL.md picks up automatically on next sweep since it's in the catalog already.
- **Identity artifact reader** at `src/backend/claude-session/identity-artifact-reader.ts` — add project CRUD methods (list, read, create, archive-cascade) + session `project:` frontmatter read/write.
- **Conversation store** at `src/state/conversation-store.ts` — add `useProjects` hook, add a projects-derived selector that transforms `useConversations` output into per-project buckets.
- **Sidebar panel** at `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — render project header rows + collapse/expand state + coral overlay drop targets per project section + create-project button in the header.
- **Row rendering** at `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — no change to the row itself; project membership affects WHICH bucket the row lands in, not how it renders.
- **Route registration** at `src/backend/database/routes/` — new endpoints for project CRUD, project-list-changed wire event.
- **id-skill amendment** at `substrate/skills/id/SKILL.md` — body-edit distributes automatically via the substrate sweep post-deploy.

</code_context>

<specifics>
## Specific Ideas

- **Coral overlay palette values are verbatim**: `background: rgba(255, 184, 150, 0.22)`, `border: 2px solid rgba(255, 184, 150, 0.60)`, `zIndex: 30`. No variation, no per-section tuning. Same visual language everywhere DnD lands.
- **"Project:" prefix is literal text**, not decorative. Header reads like `[icon] Project: <displayName>`. Distinguishes from other header rows (archive, RDP).
- **Slug format is kebab-case, lowercased.** Auto-slugification: lowercase, replace non-`[a-z0-9]` runs with a single `-`, trim leading/trailing `-`. Reject empty slugs and pre-existing slugs.
- **The `displayName:` YAML value quoting** should be single-quoted for values containing colons or leading-numeric characters (per `role-file.md` quoting invariants); other values can be bare. Wire the frontmatter writer to handle this — the MDXEditor frontmatter writer standardized on quoted-string shape (per commit `3aef703 fix(frontmatter): standardize colorHue writers on MDXEditor's quoted-string shape`) — follow that pattern.
- **No error banner for dangling project references** (D-07). Graceful degradation only. If a conversation's `project:` points nowhere, it just renders in the flat middle.

</specifics>

<deferred>
## Deferred Ideas

Ideas that came up during `/open` grill but explicitly belong in a later phase or version:

- **Bounty ↔ project linking** — a `related:` field on either the bounty or the project pointing at the other. Direction not decided; Ashley signaled her bounty mental-model rework is coming. Wait for that. No hooks in v1.
- **Manual drag-to-reorder of projects** — user explicitly excluded from v1 (grill exchange). Renames are the current knob if they want to nudge order.
- **Per-project `colorHue:` or `avatar:` chrome** — header shape doesn't have room for them (grill exchange). Icon is standardized across all projects.
- **Multi-project membership** (a conversation belonging to more than one project simultaneously) — v1 is single-valued. If we ever want multi later, the frontmatter shape changes.
- **Terminals in projects** — explicitly excluded from v1. If terminals ever need projects (unlikely — Ashley's grill answer), separate phase.
- **Delete-project distinct from archive** — v1 has only archive. If a hard-delete is ever needed, separate phase.
- **Lazy-loaded archived-projects section in the sidebar** — mirrors the Phase 115 archived-identities section but for projects. v1 omits it; archived projects are invisible.
- **Count badges on project headers** ("15 conversations") — nice-to-have UI, not v1.
- **Presence indicators** ("Chorus is here, Tina is here") in a shared project — v2 concept, not v1.
- **Cross-project search** — search-across-project scoped queries — v2.
- **Per-project preferences / settings** — v2. In v1 the project.md file is the only per-project artifact besides membership.
- **Rename preview in the create-project modal** (live slug preview as user types) — not v1. Auto-slugify at submit time only.
- **Header collapse-state syncing across devices** — collapse is local (localStorage-backed) in v1.

### Reviewed Todos (not folded)
None — no pending todos matched this phase's scope at cross_reference_todos time.

</deferred>

---

*Phase: 117 — projects — sidebar section with drag-and-drop membership, per-project context file, and id-skill amendment*
*Context gathered: 2026-09-18*
