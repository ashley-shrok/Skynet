# Phase 117: projects — sidebar section with drag-and-drop membership, per-project context file, and id-skill amendment - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-18
**Phase:** 117 — projects — sidebar section with drag-and-drop membership, per-project context file, and id-skill amendment
**Areas discussed:** on-disk shape, three-axis substrate framing, project file eagerness, empty projects + create-project flow, project file format, project lifecycle (archive), frontmatter field shape, display-name-vs-slug ordering, project header row shape, ordering, pinning-with-project-scope, DnD drop-target gestures, DnD visual language, create-project mechanics, vertical sidebar order, id-skill amendment shape, on-disk filename (fixed vs slug-matched)

---

**Format note:** This phase's discussion happened during `/open` (invoked from `/build`), not in-line during a `/gsd:discuss-phase` session. The shape file at `.planning/shapes/shape-projects.md` is the pitch-through-grill transcript. This log reconstructs the option-space for each grill question for the audit trail; the pitch-and-discuss beats produced convergent answers rather than option-selection turns.

---

## Three-axis substrate framing (opening discussion beat)

| Angle | Description | Selected |
|--------|-------------|----------|
| Project = new axis alongside role + identity | Third orthogonal context axis; multiple identities of any role can share a project; one identity may span multiple projects rare-but-possible | ✓ |
| Project = decoration on the sidebar only | UI grouping with no substrate concept — no id-skill involvement | |

**User's choice:** Three-axis framing accepted. **Notes:** Identities are mostly "tissues" (one-shot); cross-project moves rare; design should not preclude but does not need to optimize for them.

---

## Project file eagerness on `/id` load

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Read project file, enumerate directory silently (runbook pattern) | Only project.md loads eagerly; other files enumerated by name, contents load on demand | ✓ |
| (b) Read project file + full read of top-level directory contents | Eager reads of everything at the top level | |
| (c) Read everything in the directory tree | Full recursive read | |

**User's choice:** (a). **Notes:** Matches user's earlier runbook-pattern reference; keeps instruction budget bounded regardless of how a project directory grows.

---

## Bounties ↔ projects coupling

| Option | Description | Selected |
|--------|-------------|----------|
| Bounties live under projects | Project-owned bounty pools | |
| No coupling in v1 | Orthogonal; add `related:`-style link later if useful | ✓ |
| Both directions can link via `related:` | Symmetric relation on either side | (deferred) |

**User's choice:** No coupling in v1. **Notes:** User has a separate bounty mental-model rework pending; wait for that. `related:` linking direction not decided.

---

## Empty projects visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Empty projects show as header-only sections | Sidebar renders the header even with zero conversations | ✓ |
| Empty projects hidden until first assignment | Project ghosts until at least one conversation lands in it | |

**User's choice:** Show even when empty. **Notes:** Otherwise the user can never drop the first conversation into a fresh project.

---

## Create-project button placement

| Option | Description | Selected |
|--------|-------------|----------|
| Header of the conversation list | Sits alongside existing header buttons | ✓ |
| Elsewhere (bottom of sidebar, dedicated projects zone) | | |

**User's choice:** Conversation-list header. **Notes:** "just alongside the other buttons that are already there."

---

## Project file format

| Option | Description | Selected |
|--------|-------------|----------|
| No different from role file — optional frontmatter, freeform markdown body, no seed | | ✓ |
| Templated seed with sections (goals, scope, notes) | | |

**User's choice:** Same shape as role file. **Notes:** "no seed."

---

## Project lifecycle (archive)

| Option | Description | Selected |
|--------|-------------|----------|
| Archive button on the project header, warns user, cascades archive to all conversations inside, uses same identity-archive mechanism | | ✓ |
| Delete distinct from archive | | (deferred) |
| Archive without cascade (conversations orphan) | | |

**User's choice:** Archive with cascade + warning + drag-out escape hatch. **Notes:** "warn the user beforehand and they have the option to remove conversations from the project because that's [an importance they always have being able to drag and drop]."

---

## Independent conversation archive vs project field

| Option | Description | Selected |
|--------|-------------|----------|
| Archiving a conversation individually clears its `project:` field | | |
| Archive is orthogonal — `project:` field preserved, sidebar just doesn't render | | ✓ |

**User's choice:** Orthogonal. **Notes:** Same tolerance the identity-file loader already applies for missing role files.

---

## Q1: frontmatter field name + value shape

| Option | Description | Selected |
|--------|-------------|----------|
| `project: <slug>` (kebab-case, matches directory name) | Stable identifier | ✓ |
| `project: <display-name>` (human-friendly) | Would require rewriting session files on rename | |

**User's choice:** `project: <slug>`. **Notes:** Confirmed.

---

## Q2: rename mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| (a) `displayName:` in project file frontmatter, sidebar reads it, rename freely | | (initially) ✓ |
| (b) Slug IS the name shown, no rename support | | |

**User's choice:** (a) — but with a later revision (see Ordering Revision below).

---

## Q3: project header click behavior

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Collapse/expand with persisted state; edit + archive behind right-click | | ✓ |
| (b) Open project file for editing | | |
| (c) Open a project overview screen | | |
| (d) Purely decorative | | |

**User's choice:** (a). **Notes:** Matches existing conversation-row interaction shape.

---

## Q4: ordering of projects zone

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Alphabetical by display name — stable, never surprising | | ✓ (after Ordering Revision) |
| (b) Recency (most recently touched conversation bubbles the project) | | (initially considered) |
| (c) Manual drag-reorder with persisted order | | |

**User's choice:** (a) after revision. **Notes:** Initially user oscillated toward slug-based sort for stability, then revised to display-name-based (see Ordering Revision).

---

## Ordering Revision (mid-grill user pivot)

| Original | Revised |
|--------|-------------|
| Sort by slug (immutable identifier); accept that display-name renames don't shift order | Sort by display name; renames become the user's affordance for nudging order intentionally |

**User's revised choice:** Display-name sort everywhere. **Notes:** "people would barely ever rename projects or conversations and so in the cases where they do it might be somebody trying to control the order of things and so maybe we just let that happen."

Applies to: projects relative to each other; identity-associated conversations within a project (by identity display name — chorus, tina, tiffany...); relay rooms within a project (by room display name).

---

## Terminals in projects

| Option | Description | Selected |
|--------|-------------|----------|
| Excluded from projects in v1 | DnD drops refuse terminals; no `project:` field on any file that would hold one | ✓ |
| Included with a fallback identifier (tab title / tmux name / hostname) | | |

**User's choice:** Excluded. **Notes:** "I'm not really too worried about using those kind of sessions as part of projects anyway."

---

## Q5: pinning versus project membership

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Pinning wins — floats to sidebar top even inside a project | | |
| (b) Project wins — pinning is no-op inside a project | | |
| (c) Both show — row appears in both pinned zone and project section | | |
| (Revised) Sentinel with contextual scope — pinned + unassigned → sidebar top; pinned + in-project → top of that project's section | | ✓ |

**User's choice:** Contextual scope. **Notes:** "we could just look at the fact of whether the .pinned sentinel is present for a conversation ... and then you know if it's outside of a project like if it's not part of a project then it shows up at the top of the list like now and if it's inside a project it's just pinned to the top of the order of how the conversations inside the project display."

---

## Q6: DnD drop targets

| Option | Description | Selected |
|--------|-------------|----------|
| DnD covers project-membership axis only; pinning stays a separate button | | ✓ |
| DnD dual-purpose (project + pin) — drop on pinned zone assigns AND pins | | |

**User's choice:** Project-only. **Notes:** "we're not doing drag and drop in relation to pinning."

---

## DnD visual language

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse coral drop-area preview from split view | | ✓ |
| New visual pattern for project drop targets | | |

**User's choice:** Reuse coral overlay. **Notes:** "let's try to show the coral colored drop area previews like we do with the split view if we can because that's already the visual language in the app."

---

## Q7: create-project flow

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Modal with name field, auto-slugify, reject dup slug | | ✓ |
| (b) Inline input at top of projects zone | | |
| (c) One-click creates "Untitled Project N", rename after | | |

**User's choice:** (a). **Notes:** Confirmed.

---

## Q8: project file frontmatter fields the system reads

| Option | Description | Selected |
|--------|-------------|----------|
| Just `displayName:`; visually plain in v1 (no color, no avatar) | | ✓ |
| Add `colorHue:` for section tinting | | |
| Add `avatar:` for project icon | | |

**User's choice:** Just `displayName:` — headers are single-row like archive/RDP, no room for color/avatar chrome. **Notes:** "there isn't really any room for anything but a name and possibly an icon. but we would probably just standardize the icon and also put like a project prefix in each header."

---

## Q10: vertical sidebar order

| Option | Description | Selected |
|--------|-------------|----------|
| Pinned → Projects → Flat middle → RDP (bottom) | | ✓ |
| Projects at very bottom (below RDP) | | |
| Projects above pinned | | |

**User's choice:** Between pinned and flat middle; RDP stays at bottom.

---

## Q11: on-disk filename (fixed vs slug-matched)

| Option | Description | Selected |
|--------|-------------|----------|
| `project.md` (fixed sentinel filename inside slug-named directory) | Mirrors runbooks + skills convention; predictable path expressions; slug lives in one place; different conceptual relationship than role/identity files | ✓ |
| `<slug>.md` (slug-matched filename) | Mirrors role/identity file naming; filename tells you what project even from just the file | |

**User's choice:** `project.md`. **Notes:** Claude recommended fixed filename with 4 reasons (predictable path expressions, runbook precedent, slug lives once, project ≠ role/identity conceptually). User thumbs-up'd.

---

## Claude's Discretion

Areas where the user explicitly deferred to Claude's call:
- Terminals-in-projects treatment — Claude proposed exclusion, user agreed. (Q above)
- Exact placement of the create-project button among existing header buttons.
- Icon choice for the project header's standardized icon.
- Whether collapse-state is stored in localStorage vs session-working store vs a new store.
- Exact positioning of project sections relative to the "Pinned" divider chip (project headers stand alone with no chip per D-10).
- The `.hidden` sentinel / archive-cascade implementation details (reuses Phase 115 mechanism).

---

## Deferred Ideas

Ideas raised during grill but explicitly out of v1 scope:

- Bounty ↔ project linking via `related:` field (direction undecided). Wait for user's bounty mental-model rework.
- Manual drag-to-reorder of projects.
- Per-project `colorHue:` or `avatar:` chrome (header shape doesn't allow).
- Multi-project membership (one project per conversation in v1).
- Terminals in projects.
- Delete-project distinct from archive.
- Lazy-loaded archived-projects section in the sidebar.
- Count badges on project headers.
- Presence indicators for shared projects.
- Cross-project search.
- Per-project preferences / settings.
- Live slug preview in create-project modal as user types.
- Collapse-state syncing across devices.

Each is a plausible v2 addition; none belong in the first cut.
