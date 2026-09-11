# Phase 89: Identity modal — drop History+Handoff tabs, add Runbooks tab + editor modal - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-08
**Phase:** 89-identity-modal-drop-history-handoff-tabs-add-runbooks-tab-ed
**Areas discussed:** Rename ordering, API surface shape, Role-file & bounty sweep approval, Runbook editor modal header, Repo-vs-on-disk scope split

---

Most of the shape was locked upstream via `/build` → `/open` (see `shape-identity-modal-tab-restructure.md`, greenlit `thumbs up` same session). Discuss-phase focused on remaining implementation choices the shape didn't fully resolve.

## Rename ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Rename-first-as-its-own-wave | Ship on-disk rename + id-skill body update as Wave 1; modal work in later waves. Contract-consistency safety across intermediate commits. | ✓ (partial — see below) |
| All-atomic in one execute | Simpler wave graph; risk of interim commits with id-skill/disk mismatch. Low blast radius since campaign doesn't ship until end. | |

**User's choice:** Rename ordering IS as its own wave, BUT the phase's scope narrowed to only the id-skill body update (see § Repo-vs-on-disk scope split below). On-disk rename moved to manual post-close.
**Notes:** Alice's rule: repo changes happen in the phase; on-disk operator state migrates manually after close. So Wave 1 = id-skill body update (repo); Wave 2+ = modal + backend work. On-disk rename of the 4 existing runbooks + role file pointer list + bounty sweep = Alice's manual pass post-close.

---

## API surface shape

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit `roleName` param | Requests carry `(hostId, roleName, [runbookName], [relativePath])`. Identity modal passes roleName from loaded identity. No coupling to identity name. | ✓ |
| Identity-name resolution | Backend takes identity name, resolves role from its frontmatter. Extra read hop; couples runbook API to identity concept. | |

**User's choice:** Explicit `roleName` param.
**Notes:** Simpler backend, and the identity modal already knows the role from the loaded identity.

---

## Role-file & bounty sweep approval handling

| Option | Description | Selected |
|--------|-------------|----------|
| Implicit approval from shape thumbs-up | Treat shape approval as implicit for mechanical path updates (role file pointer list + bounty stale-path refs matching the rename). | |
| Ask separately during execute | Surface exact diff of role file update during execute and wait for fresh greenlight. | |
| **Not in this phase at all — Alice's manual post-close** | Role file + bounty updates are on-disk operator state, not repo. Alice does them manually after close. | ✓ |

**User's choice:** Not in this phase — moved to manual post-close pass.
**Notes:** Alice verbatim: *"you're not doing any existing runbook migration during this. That would come after the build has been closed entirely and it's all manual."* And on the repo-vs-not distinction: *"ID skill is part of the repo so it gets changed, but the migration stuff is not in the repo so we don't do that as a part of the build."*

---

## Runbook editor modal header shape

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal (title + delete + close) | Runbook name (slug) + delete-runbook button + close button. No pickers (host/role/runbook all known from launcher click). | ✓ |
| Runbook-picker in header | Add a runbook-picker so user can jump between runbooks without going back to identity modal. | |

**User's choice:** Minimal.
**Notes:** Runbook-picker is a nice-to-have that pulls away from the swap-not-stack simplicity. V2 if round-trip proves annoying.

---

## Repo-vs-on-disk scope split (emerged during discussion)

| Option | Description | Selected |
|--------|-------------|----------|
| Ship convention change (id-skill body) in this phase; defer on-disk rename to manual post-close | id-skill body update codifies `runbook.md` going-forward. Existing runbook data (4 folders) stays as-is until Alice's manual pass. Modal itself doesn't care what the main file is called (enumerates all files as tabs). | ✓ |
| Defer id-skill body update to manual pass too | Everything (convention + data + role file + bounties) migrates atomically post-close. Phase ships modal + backend only, against the old convention statement. | |

**User's choice:** Ship id-skill body change in this phase; defer only the on-disk data + operator-state migration.
**Notes:** Alice's clean rule — repo changes in-phase, on-disk migration manual post-close. Interim implication is small: the modal enumerates every file and tabs them; no code reads "the main file" specifically.

---

## Claude's Discretion

- Concrete backend route paths (`/roles/:hostId/runbooks` shape sketched; planner picks final).
- File names for new backend/frontend/API files (`runbooks-editor.ts`, `RunbookEditorModal.tsx`, `runbooks-api.ts`; planner may adjust for existing byte-shape convention).
- Wave graph internal to modal work (once Wave 1 id-skill ship lands).
- Whether to consume `SkillFileTab.tsx` directly or fork as `RunbookFileTab.tsx` (both acceptable in v1).
- Precise test file names + test-case titles.

## Deferred Ideas

- Modal-on-modal upgrade (stack-on-top) — v2 if swap-not-stack proves annoying.
- Per-row peek info in Runbooks tab list (mtime, file count, first-line preview) — v2 if bare-list feels too thin.
- Nested-folder grouping in bottom tab strip — v2 if avatar-flow's ~15 prompt archives make the strip too long.
- Runbook creation via the modal — v1 edit-only; creation is manual folder-write for now.
- Runbook-picker in editor header — v2 if round-trip proves annoying.
- "Prefer `runbook.md` if present, else first alphabetical" auto-tab-select rule — post-UAT refinement.
- Shared editor-modal primitive extraction — clone first, extract when both proven.
- Restore-identity-modal-on-close — v2 add if wanted.
- Cross-role runbook browsing — separate feature if wanted.
- **Manual post-close pass (Alice owns, not part of this phase):** on-disk rename of the 4 existing box-maintainer runbooks; box-maintainer role file `## Runbooks` pointer list path updates; stale-reference sweep in active bounties for `runbooks/<slug>/<slug>.md` refs.
