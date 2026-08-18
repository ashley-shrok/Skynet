# Phase 44: Frontend skill editing — editor surface for skill folders on a host, sibling to the existing global-files editor - Context

**Gathered:** 2026-08-18
**Status:** Ready for planning
**Source:** /open shape file (`.planning/shapes/shape-frontend-skill-editing.md`) treated as PRD

<domain>
## Phase Boundary

What this phase delivers: an editor surface for skill folders on a host, reached through the same menu as the existing global-files editor. Users pick a host, then pick a skill from that host, then work on the files inside that skill in the same modal chrome they already know. The feature covers editing text files, viewing non-text files with a placeholder, adding new files to a skill, deleting individual files inside a skill, and deleting an entire skill.

Out-of-scope for this phase: creating a brand-new skill from scratch (no scaffolding UI), renaming skills or files, moving files between skills, any behavior tied to skill distribution or self-update, a tree/drill-down navigation UI (flat tabs only), and per-file protection guards.

</domain>

<decisions>
## Implementation Decisions

### Entry point
- Skill editing is reached from the same menu as the global-files editor — it's a sibling entry, NOT a new top-level surface. (D-01)

### Modal chrome
- Reuses the existing global-files editor modal: same chrome, same host dropdown, same tab bar pattern, same editor pane. (D-02)
- One new selector sits next to the host dropdown: a skill dropdown. It populates from whichever host is currently picked. (D-03)

### File navigation
- Once a skill is picked, the modal's tab bar shows the files inside that skill. (D-04)
- Files inside a skill's subfolders are listed flat as tabs whose label is the path relative to the skill root (e.g. `tests/basic.py`). No tree, no drill-down. (D-05)
- If a skill has more tabs than the tab bar can show, the tab bar becomes horizontally scrollable. Fallback for the rare crazy-file-count case. (D-06)

### Editability
- Text files: open in the same editor pane global-files uses; fully editable; same save mechanics as global-files. (D-07)
- Non-text files: appear as tabs (not hidden) but the editor pane is replaced with a placeholder that says the file isn't text and cannot be edited. (D-08)

### Mutations
- Add a new file to the currently-open skill (creates a new empty file at the skill's root). (D-09)
- Delete a file inside the currently-open skill. Must show a confirmation prompt. (D-10)
- Delete the currently-open skill entirely (removes the folder + everything under it). (D-11)
- No other guards: any visible file is deletable, any visible skill is deletable. The user is trusted. (D-12)
- Creating a brand-new skill from scratch is explicitly out-of-scope for this phase. (D-13)

### Philosophy — plain-editor rule
- The editor is deliberately unaware of how skills are distributed, self-updated, or synced between hosts. Some skills fetch a fresh copy from a central server on every invocation; the editor does not know or care. If a local edit is later overwritten by a self-update, that is not this feature's problem. (D-14)
- The editor does NOT function as a general file manager. It does not browse the host's entire filesystem, it does not move files between skills, it does not rename anything. Scope is strictly "pick a skill, work on its files." (D-15)

### Backend surface
- Backend endpoints are needed to: enumerate skills on a host, enumerate files inside a skill (recursively so subfolder files can appear as flat path-relative tabs), read a file's contents, write a file's contents, create a new empty file, delete a file, delete an entire skill. All scoped per-host (SSH into that host to read/write on its disk). (D-16)

### Claude's Discretion
- Exact loading / error / empty states (spinner shape, error copy) — UI-phase will resolve.
- Confirm-dialog visual shape (inline confirmation, modal-in-modal, undo bar, etc.) — UI-phase will resolve.
- Keyboard shortcuts and focus behavior across the two dropdowns and the tab bar — UI-phase will resolve.
- How "new file" is expressed in the UI (button next to tab bar, plus-tab, menu action) — UI-phase will resolve.
- Save mechanics beyond "inherit from global-files editor" — implementation detail.
- Backend endpoint naming / paths — implementation detail.
- Where skill root lives on the target host (e.g. `~/.claude/skills/` for a user; may need to be a config or the same convention global-files uses) — implementation detail; align with how global-files editor targets user files.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape / product contract
- `.planning/shapes/shape-frontend-skill-editing.md` — the /open design contract that produced this phase; source of truth for scope, philosophy, and out-of-scope.

### Prior related work (per role file)
- Global-files editor is the direct pattern to mirror. Planner should read the existing global-files editor code path (modal, host dropdown, tab bar, editor pane, save mechanics, backend endpoints) as the closest analog. pattern-mapper will identify exact files.

</canonical_refs>

<specifics>
## Specific Ideas

- **Files listed flat with path-relative labels** — a skill file at `tests/basic.py` shows as tab label `tests/basic.py`. All tabs sit in one horizontal row.
- **Non-text file placeholder** — where the editor pane would be, render a short message that the file isn't text and cannot be edited. Ashley did not specify exact copy; UI-phase decides.
- **Delete-file confirm** — the ONE confirmation Ashley explicitly asked for. All other actions (open, edit, save, add file, delete skill) do NOT need extra confirmation beyond whatever global-files already does.
- **Fast-path priority** — the trigger for this feature is "quick adjustment to a skill." The user path from opening the menu → editing a file should be three selections max (menu → host → skill) then a tab click.

</specifics>

<deferred>
## Deferred Ideas

- Creating a brand-new skill from scratch (scaffolding UI, template selection, etc.).
- Renaming skills or files.
- Moving files between skills.
- Any tree view, drill-down, or richer intra-skill navigation beyond flat tabs + horizontal scroll.
- Pushing edits back to a source-of-truth host for distributed skills (any distribution/self-update awareness).
- Better nav UI for skills with many nested files, beyond horizontal scroll.

</deferred>

---

*Phase: 44-frontend-skill-editing-editor-surface-for-skill-folders-on-a*
*Context gathered: 2026-08-18 from /open shape file (equivalent to PRD express path)*
