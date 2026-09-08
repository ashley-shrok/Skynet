# Phase 89: Identity modal — drop History+Handoff tabs, add Runbooks tab + editor modal - Context

**Gathered:** 2026-09-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Restructure the identity modal's tab set (remove History + Handoff, add Runbooks), add a new Runbooks tab whose body is a bare launcher list, and add a new runbook-editor modal built as a clone of the existing skills-editor modal — reading role-scoped runbooks from `~/.claude/roles/<role>/runbooks/` on the identity's host via SSH, same lifecycle skills use. Additionally: update the id-skill body (substrate-shipped) to codify `runbook.md` as the going-forward naming convention.

**In scope (repo changes only):**
- Identity modal tab set change (remove 2 tabs, add 1)
- Runbooks tab body (bare list of runbook slugs, click-to-open, empty state)
- New runbook editor modal (skills-editor clone, adapted for role-scoped runbooks with `roleName` dimension)
- Backend routes for runbook enumeration + file read/write/create/delete keyed on `(hostId, roleName, runbookName)`
- API client surface for runbook routes
- id-skill body update — § Runbooks storage subsection: `<slug>.md` → `runbook.md` (going-forward convention only)
- Test coverage for the above (in-process user-flow test walking the identity modal → Runbooks tab → open runbook → edit → save → close swap flow)

**Out of scope (Ashley's manual post-close pass — NOT part of this build):**
- On-disk rename of the 4 existing box-maintainer runbooks (`avatar-flow/avatar-flow.md` → `avatar-flow/runbook.md`, etc.)
- box-maintainer role file `## Runbooks` pointer list path updates
- Stale-reference sweep in active bounties for `runbooks/<slug>/<slug>.md` references
- Rule: repo changes happen in the phase; on-disk operator state migrates manually after close.

</domain>

<decisions>
## Implementation Decisions

### Runbook editor modal shape (D-01 through D-07)
- **D-01:** Clone `SkillsEditorModal.tsx` (696 lines) + `SkillFileTab.tsx` (149 lines) verbatim as the base; adapt for role-scoped runbooks (add `roleName` dimension). Do NOT extract a shared editor-modal primitive — clone first, extract if/when the pattern proves for both.
- **D-02:** Header carries minimal chrome: runbook name (`<slug>`) + delete-runbook button + close button. No host-picker (inherited from identity modal), no runbook-picker (single-runbook editor per open; user goes back to identity modal to pick another). Runbook-picker in header is v2 if the round-trip proves annoying.
- **D-03:** Bottom tab strip enumerates every file in the runbook folder recursively via `find <runbookRoot> -type f -printf '%P\n'` (identical shape to skills backend); each tab labeled with the FULL relative path (nested `avatar-prompts/amelia.md` becomes literal tab label — nested folder support free). Horizontally scrollable when long.
- **D-04:** Save UX mirrors skills modal — mtime-409 conflict returns current-content + prompt to reload-and-lose-local-edits. Add-file uses window.prompt for filename (per skills modal L282). Delete-file uses DeleteConfirmDialog modal-in-modal (mirrors skills modal L639).
- **D-05:** Delete-runbook affordance in header uses DeleteConfirmDialog modal-in-modal (mirrors skills modal L667). Copy: "This removes the runbook folder and every file inside it. This can't be undone." Runbooks are role-scoped and shared across identities — same blast-radius framing as skills.
- **D-06:** Modal open uses swap-not-stack semantic — identity modal closes when runbook editor opens. Close on the runbook editor dismisses without restoring the identity modal. No modal-on-modal introduced. Upgrade to stack-on-top is a v2 follow-up if the round-trip proves annoying.
- **D-07:** Auto-select tab on runbook open: first file in enumerator sort order (matches skills modal L171). This means for existing runbooks (grandfathered `<slug>.md` main files), first-alphabetical tab wins; for new runbooks (`runbook.md` main file), same rule — `runbook.md` may or may not sort first depending on other files present. If this feels wrong at UAT, add a "prefer `runbook.md` if present, else first alphabetical" rule as a follow-up; not shape-load-bearing.

### Runbooks tab body (D-08 through D-11)
- **D-08:** Body is a bare list of runbook slugs — one row per subfolder directly under `~/.claude/roles/<role>/runbooks/`. No per-row peek info in v1 (no mtime, no file count, no first-line preview). Row is click-to-open; that is the ONLY interaction.
- **D-09:** Rows sort alphabetically by slug. No pinning, no recency, no manual ordering in v1.
- **D-10:** Empty state renders when `~/.claude/roles/<role>/runbooks/` is absent OR the folder is empty. Copy: "This role has no runbooks yet." No affordance to create one (out of scope — creation is folder-writes-by-hand or by id/role skills).
- **D-11:** Tab is always rendered on the identity modal (even for roles with no runbooks). Tab presence carries the "runbooks are a role-scoped affordance you can use here" signal; empty state carries the "there aren't any for this role" signal.

### Identity modal tab set (D-12, D-13)
- **D-12:** History and Handoff tabs are removed entirely — tab buttons, tab body components, any lazy-load `useEffect` blocks that fetch their data on tab-switch, any header badge/count logic tied to them. Files that only served History/Handoff get deleted, not just the button. Dead code has no place; a search after the removal for `history-tab`/`handoff-tab` refs should come up empty (or only in git history).
- **D-13:** Post-restructure tab order: role file, runbooks (new), identity file, bounties, wake-ups. Runbooks sits between role file and identity file as the second role-scope tab.

### Backend API shape (D-14 through D-18)
- **D-14:** New routes at (approximately) `/roles/:hostId/runbooks` shape. Concrete route paths + response shapes are planner's call — the shape constraint is that requests carry `(hostId, roleName, [runbookName], [relativePath])` explicitly; no coupling to any specific identity's name.
- **D-15:** Backend validates role folder exists at `~/.claude/roles/<roleName>/` on the target host before touching runbooks — returns a clean 404 if not, not an SSH-error-passthrough.
- **D-16:** Backend enforces the runbook folder is directly under `~/.claude/roles/<roleName>/runbooks/` — no path traversal via `roleName` or `runbookName` inputs (escape/validate against `/`, `..`, absolute paths).
- **D-17:** Same SSH lifecycle as skills-editor.ts (SSH connect → echo $HOME → find). Reuse the same SSH connection pool; do NOT open a parallel pool.
- **D-18:** Test coverage mirrors `skills-editor.test.ts` shape — list, enumerate, read, write, create, delete, plus role-validation-404 and path-traversal-guard cases.

### id-skill body update (D-19, D-20)
- **D-19:** Update lives at `substrate/skills/id/SKILL.md` in the Skynet repo (distributor pushes to every managed box). § Runbooks Storage subsection changes phrase "MUST be named `<slug>.md`" → "MUST be named `runbook.md`". Any adjacent phrasing that references `<slug>.md` in the § Runbooks section shifts to `runbook.md` similarly (Awareness on wake, When to invoke). Enumeration key still folder names — unchanged.
- **D-20:** Convention is going-forward only. Existing runbooks on Ashley's manual post-close pass. Do NOT add a "for existing runbooks, main file is `<slug>.md`" migration-note in the id skill — the manual pass renames them all to `runbook.md`, so no grandfather rule needs to be codified.

### Ship discipline (D-21, D-22)
- **D-21:** Campaign constraint holds — commits + push + scoped tests only. No `docker build`, no `docker cp` fast-path, no `docker compose up --force-recreate`, no full-suite test run until entire UX-pass campaign lands AND Ashley greenlights ship gate.
- **D-22:** Push discipline: `git pull --rebase origin feat/tab-title-from-tmux` before every push. No coord-room post (push-only per 2026-09-05 rule). Peer identities of box-maintainer role (currently tina, tiffany, tanya, taylor) may push concurrently; rebase handles it.

### Rename ordering (D-23)
- **D-23:** Wave ordering — id-skill body update (D-19) ships as its own wave BEFORE the backend/frontend work, so intermediate commits never have the substrate saying `runbook.md` while backend code hasn't shipped yet, OR vice versa. Rationale: cheap contract-consistency safety. Blast radius is low either way (no runbook consumer reads modal + id-skill body concurrently), but this ordering is free.

### Claude's Discretion
- Concrete route paths for backend routes (D-14 explicitly left to planner).
- File names for new backend/frontend files (naming conventions — `runbooks-editor.ts` backend, `RunbookEditorModal.tsx` frontend, `runbooks-api.ts` API client; planner may adjust to match existing byte-shape convention).
- Wave graph internal to the modal work (Wave 2+, once id-skill ships in Wave 1).
- Whether to inline `RunbookFileTab.tsx` or clone `SkillFileTab.tsx` — depends on whether the two file editors need to diverge in v1 (probably not; direct clone or shared component both acceptable).
- Precise test file names + test-case titles.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (the phase's design contract)
- `.planning/shapes/shape-identity-modal-tab-restructure.md` — Full shape for Phase 89: what this is, philosophy, prior context, failure modes, scope edges, vehicle notes. Opened + locked 2026-09-08 via `/build` → `/open`, greenlit `thumbs up` same session.

### Existing skills editor (pattern being cloned)
- `src/ui/features/pretty-view/SkillsEditorModal.tsx` (696 lines) — Full modal component. Header host-picker + skill-picker + Add file + delete-skill + close. Body layered branches (host-not-picked / loading / error / no-skills / skill-not-picked / loading / error / no-files / files+tabs). Bottom horizontal-scroll tab strip. Delete-file + delete-skill DeleteConfirmDialog modal-in-modal. Save handler with 409 mtime conflict UX (line 227). Auto-select-first-file on skill open (line 171). Tab labels use FULL relative path per line-626 comment (`NOT split('/').pop()`).
- `src/ui/features/pretty-view/SkillFileTab.tsx` (149 lines) — Per-file editor component: dirty tracking, save button, delete button. Consumed by SkillsEditorModal.
- `src/ui/api/skills-api.ts` — Frontend API client for skills. Pattern to mirror for runbooks-api.ts: `listSkills(hostId)`, `enumerateSkillFiles(hostId, skillName)`, `readSkillFile(hostId, skillName, path)`, `writeSkillFile(...)`, `createSkillFile(...)`, `deleteSkillFile(...)`, `deleteSkill(...)`, error classes (`SkillFileMtimeConflictError`, `SkillFileAlreadyExistsError`), type exports (`SkillEntry`, `SkillFileEntry`).
- `src/backend/database/routes/skills-editor.ts` — Backend implementation. Uses SSH-per-request lifecycle. `find <root> -mindepth 1 -maxdepth 1 -type d -printf '%f\n'` for listing skills (line 310). `find <root> -type f -printf '%P\n'` for enumerating files recursively (line 418).
- `src/backend/database/routes/skills-editor.test.ts` — Test shape to mirror for runbooks-editor.test.ts.

### id-skill body (edit target)
- `substrate/skills/id/SKILL.md` — The distributed id-skill body. § Runbooks section landed last session (Phase 89 informal — historical labels on inline substrate work, no ROADMAP entry). § Runbooks Storage subsection currently says main markdown MUST be named `<slug>.md`; this phase updates it to `runbook.md`. Enumeration step in load-flow §3 is unaffected (keys off folder names).

### Prior related work
- `.planning/phases/86-cosmetics-migrate-to-role-move-title-hue-voice-avatar-from-i/` — Phase 86 (predecessor in the UX-pass campaign) shipped role-level cosmetic frontmatter + per-identity override affordances. Establishes the identity modal's per-field inherit/override pattern that this phase's Runbooks tab lives adjacent to.
- `.planning/phases/88-create-agent-modal-ux-pass-paired-header-blurbs-path-admin-g/` — Phase 88 (immediate predecessor) shipped create-agent modal ux-pass. This phase depends on 88's shipped state as the current UI baseline.
- Bounty: `~/.claude/roles/box-maintainer/bounties/identity-modal-tab-restructure/bounty.json` — the bounty this phase implements.

### Standing fleet rules
- box-maintainer role file `## Standing directives` — key rules for this phase: no worktrees, `git pull --rebase` before push, no coord-room posts on push-only sessions, subagents don't do deploys (this phase ships push-only, no deploy), test discipline (scoped during dev, full suite only at deploy gate after ship greenlight).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **SkillsEditorModal.tsx (696 lines)**: byte-shape clone target for RunbookEditorModal.tsx. Header pattern (radix Dialog + host picker + item picker + action buttons + close) transfers directly with roleName replacing hostId+skillName combined. Body's layered branch pattern (host-not-picked / loading / error / no-items / etc.) transfers directly. Bottom tab strip transfers directly.
- **SkillFileTab.tsx (149 lines)**: per-file editor component consumable as-is or with minimal fork (RunbookFileTab.tsx). If the two need identical UX (they should in v1), consider consuming SkillFileTab directly rather than duplicating.
- **DeleteConfirmDialog** (`src/ui/features/pretty-view/DeleteConfirmDialog.tsx`): shared modal-in-modal confirm affordance. Runbook editor uses this for both delete-file and delete-runbook.
- **radix-ui Dialog primitives**: shared modal shell. Same z-index ladder as skills modal (patch #111): overlay z-[110], content z-[120].
- **SSH connection pool** (used by skills-editor.ts): reused for runbooks-editor.ts — do NOT open a parallel pool.
- **`find <root> -type f -printf '%P\n'`**: enumerator shape reused as-is.
- **`find <root> -mindepth 1 -maxdepth 1 -type d -printf '%f\n'`**: reused for listing runbook subfolders (mirrors skill-listing pattern).
- **`escapedSkillsRoot` / `escapedSkillRoot`**: shell-escape helper pattern reused for role/runbook path construction.
- **Identity modal's existing tab-set machinery**: unknown to me by symbol-name (haven't grepped) but its tab-switch pattern is what gets extended to add Runbooks tab and shrunk to drop History + Handoff.

### Established Patterns
- **SSH-per-request modal reads**: skills modal opens SSH connection on tab-switch, `enumerateSkillFiles` → `readSkillFile(activeTab)` sequence. Runbooks modal follows identical pattern (`enumerateRunbookFiles` → `readRunbookFile(activeTab)`).
- **mtime-409 optimistic-lock save**: skills modal L227-277. Runbooks modal inherits verbatim.
- **File tab label as FULL relative path**: skills modal L626 comment explicit. Runbooks modal inherits verbatim — nested folder support falls out.
- **Horizontally-scrollable bottom tab strip**: skills modal L587. Runbooks modal inherits verbatim.
- **Auto-select first file on parent-item open**: skills modal L171. Runbooks modal inherits verbatim; may refine post-UAT if `runbook.md` doesn't sort first alphabetically among grandfathered runbooks.
- **DeleteConfirmDialog for consequential ops**: skills modal L639 (delete-file) + L667 (delete-skill). Runbooks modal inherits both patterns.
- **Modal Portal with per-modal container**: skills modal L372. Runbooks modal inherits, so its overlay renders inside the same container as the identity modal that spawned it (relevant for swap-not-stack — see D-06).

### Integration Points
- **Identity modal tab set**: existing component that currently has History + Handoff tabs (locations TBD by planner) gets those tabs removed. Add Runbooks tab in their place (order per D-13). Tab body for Runbooks is the new bare-list launcher; row click triggers "close identity modal + open runbook editor modal" per D-06.
- **Runbook editor modal**: new component, mounted at the same site as the skills editor modal (likely alongside it in PrettyView or an ancestor). Its `open` state is controlled by the launcher click. Its `onOpenChange(false)` (close) does NOT reopen the identity modal.
- **id-skill body**: `substrate/skills/id/SKILL.md` — small text edit. Distributor sweep picks it up on next fleet-substrate propagation; no restart needed on managed boxes.
- **SSH connection pool**: existing shared surface. Runbook enumerator + reader + writer use it. Do NOT open a parallel pool.

</code_context>

<specifics>
## Specific Ideas

- **Skills-parity is the design bar.** Any UX detail in the runbook editor that has a corresponding detail in the skills editor should match unless there's a specific reason to diverge. Ashley explicitly asked to "steal from skills modal" during /open.
- **`runbook.md` mirrors `SKILL.md`.** Folder-names-the-thing + fixed-sentinel-file-inside. She named this convention during /open citing skills.
- **Swap-not-stack.** She verbatim: *"I don't think we actually have that interaction anywhere currently in the app so to keep it simple I'm thinking what we could do for for version one at least is that when you click on a runbook it closes the identity modal and opens the modal for editing that runbook. And when you close that one, it just closes."*
- **Bare list, no peek info.** She verbatim: *"Yeah, it could just be a bare list."*
- **Repo-in, on-disk-out.** She verbatim: *"ID skill is part of the repo so it gets changed, but the migration stuff is not in the repo so we don't do that as a part of the build."*

</specifics>

<deferred>
## Deferred Ideas

- **Modal-on-modal upgrade (stack-on-top).** If swap-not-stack proves annoying in practice (frequent round-trip back to identity modal), v2 upgrades runbook editor to stack on top. No design work needed now; the modal is already portal-mounted.
- **Per-row peek info in Runbooks tab list** — mtime, file count, first-line preview. Only if the bare-list feels too thin after UAT.
- **Nested-folder grouping in the bottom tab strip.** For avatar-flow runbook's ~15 prompt archives, the horizontal strip gets long. An expando for `avatar-prompts/` (or similar folder-grouping) could reduce visual noise. Punt to v2 if it proves annoying.
- **Runbook creation via the modal.** V1 is edit-only. Creation happens via folder writes by hand or by /role and id skills. If runbook creation via UI becomes wanted, spawn a new bounty.
- **Runbook-picker in editor header.** For quick round-tripping between runbooks without going back to identity modal. V2 if the round-trip is annoying.
- **"Prefer `runbook.md` if present, else first alphabetical" auto-tab-select rule.** May be needed if UAT shows first-alphabetical doesn't feel right for grandfathered runbooks. Post-UAT refinement.
- **Shared editor-modal primitive.** Extract a common shape from SkillsEditorModal + RunbookEditorModal once both are shipped and stable. Right instinct, wrong time — clone first, extract when the pattern is proven.
- **Restore-identity-modal-on-close.** Runbook editor close currently just dismisses. If she wants "back to Runbooks tab in identity modal" behavior, that's a v2 add.
- **Cross-role runbook browsing** — viewing another role's runbooks from within a loaded identity's modal. Runbooks are strictly scoped to the loaded identity's role for v1. Cross-role browsing would be a separate feature.

</deferred>

---

*Phase: 89-Identity-Modal-Tab-Restructure*
*Context gathered: 2026-09-08*
