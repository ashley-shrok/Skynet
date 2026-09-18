# Shape: Projects — grouping conversations in the sidebar with shared context

**Opened:** 2026-09-18
**Vehicle:** GSD phase (single phase, multiple plans)

## What this is

A way of grouping conversations together in the sidebar, with each group carrying its own directory on disk holding a context file (and room for anything else the group accumulates over time). Membership lives in each conversation's own session-file frontmatter — the frontmatter IS the source of truth, no separate index anywhere else. An agent that loads an identity whose frontmatter names a project reads that project's context file and becomes aware of what else is in the directory, the same way it already reads its role file and knows about the runbooks the role holds. So "assigning a conversation to a project" means "every session in that conversation, from now on, inherits the project's context." Projects sit as a new first-class kind of thing on disk alongside roles and identities, and add a third axis to how an agent understands what it's doing: role (who you are), identity (this specific worker's state), project (what you're working on).

## Shape

**On disk.** A project lives at `~/fleet/projects/<slug>/`, sibling to `~/fleet/roles/` and `~/fleet/identities/`. Inside sits `project.md` — the project's context file, mirrors the fixed-sentinel convention that runbooks and skills already use (folder names the thing, fixed filename inside makes every path expression predictable). The file has optional YAML frontmatter (system-read: `displayName:`; everything else user-space) and freeform markdown below. No seed content — nothing about the create flow assumes any particular structure inside. The directory can accumulate anything else the project needs (design docs, screenshots, decision logs, sub-notes) — those files are enumerated silently on load, contents load on demand.

**Membership.** A conversation belongs to a project when its session file's frontmatter carries `project: <slug>`. Slug is stable (never changes across a rename); display name is what the sidebar shows and can be renamed freely by editing the project file's frontmatter. Slug format is kebab-case.

**Sidebar vertical order.** Pinned zone (top, unchanged) → individual project headers each with their conversations underneath → flat middle (unassigned, recency-sorted, unchanged) → RDP group (bottom, unchanged). No wrapping super-section around the projects — each project's header stands on its own, one after another.

**Project header row.** Single row, same visual shape as the existing archive and RDP headers. Contents: a standardized project icon, a "Project:" prefix, the display name, and a small new-conversation button on the right. Click the header itself → collapse or expand that project's conversation list (collapsed state persisted so it survives reloads). Right-click / long-press → context menu with edit (opens the project file for editing) and archive.

**Ordering.** Alphabetical by display name — both projects relative to each other, and conversations within a project. For conversations, the display name comes from what the conversation's kind exposes: an identity's display name for identity-associated conversations, a relay room's display name for relay conversations. Terminals are excluded from projects entirely in this version (drop targets refuse them; no `project:` field on any file that would hold it). No manual reorder — if a user really wants to nudge ordering, they can rename the display name.

**Pinning.** The existing pinned sentinel stays as-is, one flag per conversation. The scope of "pinned" becomes contextual: outside a project → floats to the sidebar's top pinned zone as today; inside a project → floats to the top of that project's section. Same mechanism, different visual scope. Pinning and project membership are orthogonal axes; a conversation dragged into a project keeps its pin sentinel (it just now pins within the project), and unassigning it out floats it back to the top zone.

**Drag-and-drop.** DnD is the project-membership axis only — pinning stays its own separate button on the row. Three gestures: drop onto a project section (header or any row inside the section — the whole section is one lit drop zone) writes that project's slug into the dragged conversation's frontmatter; drop into the flat middle clears the frontmatter field; a drag between two projects rewrites it. Drop-target visual reuses the coral overlay pattern already established in the split-view feature. Dropping into the pinned zone is not a project-DnD gesture — that zone is not a drop target for this axis at all.

**Create-project.** A new button lives in the conversation-list header alongside the buttons already there. Clicking it opens a small modal asking for a project name; on submit the name is auto-slugified (kebab-case, lowercased), the modal rejects if the resulting slug already exists on disk, and on accept the project directory is minted along with a bare `project.md` file (frontmatter carrying `displayName:` set to whatever the user typed, empty body).

**New-conversation-inside-project.** The header's new-conversation button opens the usual new-conversation flow with the project already selected — the new conversation is born with `project: <slug>` already in its frontmatter, so it appears inside that project's section from the moment it exists.

**Archive.** Right-click / long-press on a project header → archive. This uses the same mechanism identity-archiving already uses, cascaded across every conversation in the project. A confirmation warning names both consequences explicitly ("about to archive this project and all conversations within it — drag conversations out first if you want to keep any active") so the user has the escape hatch of dragging out before pressing.

**The id-skill amendment.** On `/id <name>`, after reading the role file and any handoff, the id-skill checks the identity file's frontmatter for a `project:` field. If present, it reads `~/fleet/projects/<slug>/project.md` into context and enumerates the directory's top-level contents silently — same shape as the existing runbooks enumeration (knows the names, contents load on demand). If the field is missing or points to a slug that doesn't exist on disk, the amendment is a graceful no-op — the id-skill continues without it. The amendment ships via the fleet-substrate distributor and applies to every identity on every host on the next distributor sweep.

## Philosophy

Projects are a third axis of agent context, orthogonal to role and identity. Role is who you are (permanent, shared across identities of that role). Identity is this specific worker's state (per-instance, ephemeral in most cases). Project is what you're working on (shared across every identity working on that thing, regardless of role). All three can compose in a single agent load.

Membership belongs to the conversation itself. The frontmatter IS the source of truth — there is no parallel index, no lookup table, no membership list held elsewhere. The sidebar just reads each conversation's frontmatter and buckets accordingly. This is the same shape that makes `role:` in an identity file work today, and it means "moving a conversation between projects" is exactly a one-file frontmatter edit — nothing else has to be kept in sync.

Stable identifiers everywhere they matter. Slugs never change; display names can. Frontmatter uses slugs so it stays valid across renames. Sort keys use display names because renames are rare enough that when they happen, the user is usually trying to nudge ordering on purpose. Best of both worlds — stability where it matters for correctness, human-friendly ordering where it matters for use.

Reuse established patterns wherever they fit. On-disk shape borrows the slug-directory + fixed-sentinel-filename convention from runbooks and skills. DnD affordances reuse the coral overlay visual from split view. Header shape mirrors the archive and RDP headers. Archive mechanics reuse the existing identity-archiving cascade. Pinning stays the same sentinel it always was — only its scope of effect changes. Building a new concept on top of familiar structural pieces means the concept lands fast and predictably.

Small surface for v1. Explicitly deferred: manual reorder via drag, drag-to-create, per-project color or avatar chrome, delete distinct from archive, bounty ↔ project coupling, multi-project membership, terminals in projects, cross-project search, per-project settings, presence indicators, count badges on headers. Each of these is a plausible addition later; none belong in the first cut.

## Prior context

**Skynet sidebar today.** Pinned zone at top with a "Pinned" divider chip, flat recency-sorted middle, RDP group at the bottom. Renders from a store that consumes derived conversation rows plus pin/hide/active-set flags hydrated from the server. Full drag-and-drop support already exists (used in the split-view feature); coral drop-area overlays are the established visual language.

**Sessions.** A conversation is a session held by an identity. Session files are markdown with YAML frontmatter (`role:`, `task:`, `displayName:`, etc.). The frontmatter is machine-parsed and drives UI behavior — the task field surfaces on the conversation row today, for instance. Adding a `project:` field slots naturally into this existing pattern.

**Fleet substrate today.** Two first-class kinds of things live on disk under `~/fleet/`: roles at `~/fleet/roles/<role>/` and identities at `~/fleet/identities/<name>/`. Each has a canonical file inside (`<role>.md` and `<name>.md`) plus subfolders (bounties, wakeups, runbooks, etc.). Runbooks and skills already use the slug-directory + fixed-sentinel-filename shape that projects are borrowing.

**id-skill today.** On `/id <name>` load, it reads the identity file, resolves the role via the identity's frontmatter, reads the role file, reads any handoff, enumerates runbook names silently. Adding a project step slots into this sequence — same shape, same on-demand semantics for the enumerated directory.

**Pinning today.** Sentinel-based, one flag per conversation, hydrated from the server into a store, floats the row into the dedicated pinned zone at the top of the sidebar. This shape is preserved exactly — the only change is what "top" means when the conversation is inside a project.

**Identity archiving today.** Already implemented (needs a rebase to see it on the current tree). Projects reuse this mechanism, cascaded across every conversation in the project directory.

**Chorus's role — box-maintainer — owns both halves.** Fleet-substrate ownership (id-skill and the distributor) plus Skynet ownership sit under the same role, so the cross-substrate + UI nature of this work stays in one lane.

## What would make it wrong

- Requiring the user (or an agent) to maintain a project-membership index somewhere separate from the conversation itself. Membership belongs to the conversation; nothing else.
- Any place where renaming the display name of a project cascades into rewriting other files. Rename is a one-file operation on the project file's frontmatter — full stop.
- The id-skill loading arbitrary large blobs into every session's opening context because a project directory has grown. Only `project.md` is read eagerly; everything else is enumerated by name and read on demand.
- DnD conflating pinning with project assignment. The two axes stay separate, with separate affordances.
- The sidebar showing broken state when data is inconsistent (a session's frontmatter names a project slug that doesn't exist on disk, or was archived). Graceful degradation — the conversation just falls into the flat middle, no error banner, no crash.
- Archive being a permanent, silent, or reversible-only-through-terminal operation without a warning. The cascade to all conversations in the project must be named explicitly in the confirmation, and the drag-out escape hatch must be pointed at.
- Creating a project without a proper name, or duplicate slugs silently overwriting an existing project. The modal validates before minting anything on disk.
- Terminals being second-class with a broken project affordance. They're explicitly excluded from projects in v1 — DnD refuses them, they don't get a project field.
- Multiple projects per conversation. One field, one value. If we ever want multi-project later, the frontmatter can change shape; for now it doesn't.
- Peer identities of the role picking up the substrate change and getting broken loads because the amendment isn't backward-compatible. Identities without a `project:` field continue to load exactly as they do today.

## Scope edges

**In.**
- On-disk projects directory as a new first-class fleet-substrate location.
- Project file with optional frontmatter (`displayName:` read by the system) and freeform body.
- id-skill amendment reading the project file and enumerating the directory.
- Sidebar rendering: project headers with icon + "Project:" prefix + display name + new-conversation button, collapse/expand on click, right-click for edit + archive.
- Drag-and-drop for project assignment / reassignment / clear, using coral overlays.
- Pinning-as-sentinel-with-contextual-scope semantics.
- Create-project modal in the conversation-list header, name field, auto-slugify, duplicate-slug rejection.
- Archive-cascade using the existing identity-archiving mechanism, with an explicit warning.
- New-conversation-inside-project pre-populates the frontmatter field.
- Graceful degradation for missing / archived / dangling project references.

**Out.**
- Delete distinct from archive.
- Drag-and-drop reordering of projects or within-project ordering.
- Per-project `colorHue:` or `avatar:` chrome.
- Multi-project membership (one project per conversation).
- Terminals in projects.
- A super-section header / divider chip labeled "Projects" wrapping the individual project headers.
- Any coupling between projects and bounties (either direction).
- Presence indicators showing "who else is here" in a project.
- Count badges on project headers.
- Cross-project search or per-project preferences.

**Deferred.**
- Bounty ↔ project linking via a `related:`-style field on either side. Direction not decided. Not implemented in this version; may be added later once the bounty mental-model rework Ashley has in mind lands.

**Tempting but no.**
- Making the projects zone visually distinguished from the flat middle beyond just having headers (color band, indentation, dividers). Keep it minimal — same look as archive/RDP.
- Pre-seeding the project file with a template (goals / scope / notes sections). Freeform is the philosophy.
- Adding an "overview" screen for a project (some kind of dashboard aggregating its conversations + context + related bounties). The header + directory on disk is the whole surface for now.

## Vehicle notes

**Vehicle: one GSD phase.** Multiple plans inside covering the fleet-substrate half and the Skynet half separately, but a single phase with a single verification-and-ship end-state — because the halves define one feature and don't independently ship.

**Where this file lives.** `.planning/shapes/shape-projects.md` in Chorus's working tree at `~/fleet/identities/chorus/workspace/skynet-chorus/`. The phase (when created) will consume this file directly as its CONTEXT.md, or generate CONTEXT.md from it — either way, `discuss-phase` shouldn't re-elicit the discovery this shape already captured.

**Constraints inherited from Chorus's role.**
- Chorus is a box-maintainer identity; multiple identities of this role are running in parallel with their own working trees, all on the same branch, all pushing to origin. Rebase before every push.
- Container mutations serialize — deploy is orchestrator-only, not executor-scoped. Ship gate = full vitest suite + playwright smoke, run at the START of the deploy motion (not before push, not inside the executor).
- Push and deploy are separate greenlights: "push it" authorizes `git push` only; a separate "ship it" is required to build + force-recreate + verify. Executor's remit stops at code + commit + scoped tests green.
- The id-skill amendment is a fleet-substrate change that ships via the distributor — the substrate source at `substrate/skills/id/SKILL.md` in the Skynet repo is the canonical copy, and the distributor pushes it to every host on its next sweep. Do not hand-edit installed copies on any peer box.
- Peer identities need to know when the id-skill amendment lands (relay DM, one turn after successful deploy) — projects becomes a live substrate concept they can start using immediately after the sweep. This is the stakeholder notification at the end of the `/build` pipeline.

**Immediate next step for this vehicle.** Run `/gsd:phase` to slot a new phase into `ROADMAP.md`, then `/gsd:discuss-phase` (which seeds from this shape file rather than re-eliciting), then `/gsd:plan-phase`, then `/gsd:execute-phase`. Deploy motion is orchestrator-only after Ashley's ship greenlight. `/close projects` closes this shape at the end of the pipeline against the built result.

---

## Close-Out

**Closed:** 2026-09-18
**Vehicle used:** GSD phase 117 (single phase, 10 plans across 6 waves), TDD RED→GREEN cadence, sub-agent execution, orchestrator-only deploy
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is — projects as sidebar grouping with per-project directory + context file** — present · ~/fleet/projects/<slug>/project.md as first-class fleet-substrate location; sidebar buckets by reading each conversation's own membership field.
- **Shape — on disk: ~/fleet/projects/<slug>/ + fixed project.md sentinel, YAML frontmatter (displayName), freeform body, no seed content** — present · createProject mints the dir + bare project.md with `displayName:` frontmatter and empty body; no seed sections.
- **Shape — membership via `project: <slug>` in conversation's frontmatter (identity), slug stable and kebab-case** — present · PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/; writeSessionProjectField does a full yaml round-trip preserving every other key; relay-room path uses m.tag (endorsed drift, see notes).
- **Shape — sidebar vertical order: pinned zone → per-project headers → flat middle → RDP** — present · Panel renders pinnedUnassigned, then displayedProjectSections, then flat middle, then RDP, then archived — matches the shape's order verbatim.
- **Shape — project header row: FolderOpen icon + `Project:` prefix + display name + new-conversation SquarePen button; click to collapse/expand, persisted** — present · PrettyProjectSectionHeader mirrors the archive header shape; useCollapsedProjectSlugs persists to localStorage under `pv-collapsed-project-slugs`.
- **Shape — right-click / long-press context menu with edit + archive** — partial · Menu appears with both items; Archive is fully wired; Edit is a v1 no-op placeholder (endorsed-as-drift by Ashley).
- **Shape — alphabetical ordering: projects by displayName, conversations within a project by displayName; no manual reorder** — present · Store selector sorts sections and intra-section rows via localeCompare with sensitivity: base; no manual reorder affordance.
- **Shape — pinning stays as sentinel; scope becomes contextual (top zone outside a project, top of section inside)** — present · Store emits pinnedUnassigned separately from projectSections rows; pinned-in-project floats to top of its section.
- **Shape — drag-and-drop for project assignment / reassignment / clear, coral overlay reused** — present · Three gestures wired: section-drop assigns, flat-middle-drop clears, cross-section-drop rewrites; coral palette rgba(255,184,150,0.22) + border 0.60 reused verbatim; type-gated on application/x-skynet-row.
- **Shape — create-project modal in conversation-list header; auto-slugify; duplicate-slug rejection** — present · Modal submits raw displayName; backend normalizeToSlug authoritative; 409 on collision shown inline; 400 on empty-after-normalization.
- **Shape — new-conversation-inside-project pre-populates the project field** — present · Section SquarePen opens NewConversationModal with preSelectedProject; after createRelayRoom resolves, fire-and-forget setRelayRoomProject writes the tag.
- **Shape — archive with cascade via the existing identity-archive mechanism + verbatim warning + drag-out escape hatch** — present · handleArchiveProject uses window.confirm with the exact D-29 wording; Promise.allSettled batch of archiveIdentity + setRelayRoomProject(null); archiveProject folder-move at end.
- **Shape — id-skill amendment reads project.md + enumerates directory silently on `/id` load** — present · substrate/skills/id/SKILL.md step 4 reads project.md into context and enumerates directory contents on-demand; graceful no-op on missing / archived / no field.
- **Philosophy — projects as third axis (role / identity / project), all three compose** — present · id-skill loads role file, identity file, then project file — three axes composed in the load sequence.
- **Philosophy — membership belongs to the conversation itself, no parallel index** — drifted · Identity membership is on the identity file; relay-room membership is on the room's Matrix m.tag account_data (per-user, per-room) — no parallel index/lookup table, but two carriers rather than one. Endorsed-as-drift by Ashley (agreed at plan-phase, documented in CONTEXT D-05).
- **Philosophy — stable slugs, human-friendly display names, rename is one-file** — present · Slug lives in every frontmatter/tag as the stable ID; displayName lives only in project.md's frontmatter; renaming is a one-file edit to project.md.
- **Philosophy — reuse established patterns (slug-dir + sentinel-file, coral overlay, archive header shape, identity-archive cascade)** — present · Every pattern named in the shape is reused verbatim.
- **Philosophy — small v1 surface; explicitly deferred items stay deferred** — present · No manual reorder, no color/avatar chrome, no delete distinct from archive, no bounty coupling, no multi-project membership, no cross-project search, no count badges.
- **Scope IN — every listed inclusion** — present · All ten IN items landed.
- **Scope OUT — every listed exclusion actually excluded** — present · No delete-distinct, no DnD reorder, no colorHue/avatar, no multi-project field, no terminals-in-projects, no super-section wrapper, no project↔bounty coupling, no presence indicators, no count badges, no cross-project search, no per-project settings.
- **Scope — tempting-but-no items avoided** — present · Projects zone visually identical to archive/RDP treatment; project.md is bare with no template sections; no overview/dashboard screen.
- **What would make it wrong: requiring a separate project-membership index** — present · No index — sidebar reads each conversation's own frontmatter/tag and buckets accordingly.
- **What would make it wrong: rename of display name cascading rewrites elsewhere** — present · Rename is a single-file edit to project.md's displayName frontmatter; slug is stable everywhere else.
- **What would make it wrong: id-skill loading arbitrary large blobs on every load** — present · Only project.md read eagerly; directory contents enumerated by name and loaded on demand — same shape as runbooks enumeration.
- **What would make it wrong: DnD conflating pinning with project assignment** — present · DnD is project-membership only; pinning stays as its own row-level button/sentinel; pinning drop zone explicitly not a project drop target.
- **What would make it wrong: broken state on data inconsistency (missing / archived / dangling slug)** — present · Store's projectForRow returns null when projectsBySlug.has(raw) is false; conversation falls back to flat middle; no error banner, no crash.
- **What would make it wrong: archive being silent or without a warning** — present · Verbatim D-29 window.confirm warning names both consequences and points at the drag-out escape hatch.
- **What would make it wrong: creating a project without a proper name or duplicate slugs overwriting** — present · Backend probes before write; EEXIST → 409 → inline error in the modal; 400 for name that normalizes to empty.
- **What would make it wrong: terminals as second-class with broken project affordance** — present · rdpHostRow refused at section-drop, flat-middle-drop, and store-level projectForRow; writeSessionProjectField would throw on missing identity file (defense-in-depth); no project field on terminal rows.
- **What would make it wrong: multiple projects per conversation** — present · Identity path: single scalar frontmatter key; relay-room path: setRoomProjectTag strips ALL u.project.* before writing at most one.
- **What would make it wrong: substrate change breaking peer identities without a project field** — present · id-skill step 4 is a graceful no-op when the frontmatter has no `project:` field — pre-existing identities continue to load exactly as before.

### Additions (in the result, not in the shape)

None.

### Follow-ups

- Wire the edit-project-file context-menu item to actually open the project.md file for editing (mirroring the role-file editor pattern) — v1 ships as a console-log placeholder. — accepted-as-drift

### Notes

Two philosophical alignments worth carrying forward: (1) 'Membership lives with the thing' held even where the carrier had to differ — identity conversations carry membership in their own frontmatter, relay-room conversations carry it in the room's own Matrix m.tag account_data (per-user, per-room). Two carriers, one intent — no parallel index anywhere. This wasn't in the shape because the shape was written before it emerged that relay rooms have no identity file; the tag decision was made explicitly between /open and /gsd:plan-phase and lives in CONTEXT.md D-05. Future 'membership' features on new conversation kinds should look for the same 'closest to the thing' carrier rather than reflexively adding to session frontmatter. (2) The v1 no-op edit-project-file item is a legitimate ship-a-slice pattern — a menu affordance in place with structured logging, ready for a follow-on refinement to wire it to a file editor mirroring RoleModal.tsx. Worth capturing as an explicit follow-up rather than a bug.
