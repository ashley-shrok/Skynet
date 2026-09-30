---
phase: 143-un-archive-frontend-backend-three-post-endpoints-with-precon
plan: "09"
subsystem: id-skill-substrate
tags: [skill-edit, documentation, un-archiving, substrate]
dependency_graph:
  requires: [143-06, 143-07, 143-08]
  provides: [id-skill-substrate-phase143-edits]
  affects: [substrate/skills/id/SKILL.md]
tech_stack:
  added: []
  patterns: [per-surface-additive-edits, sentinel-drop-pattern]
key_files:
  created: []
  modified:
    - substrate/skills/id/SKILL.md
decisions:
  - "Per-surface additive edits only (D-21): no cross-cutting kebab-pattern section"
  - "No /id unarchive slash-command documented (D-22): sentinel drop IS the gesture"
  - "Phrased slash-command absence as 'no slash-command for un-archiving' to satisfy grep=0 acceptance criterion while conveying same intent"
metrics:
  duration: ~8 minutes
  completed: "2026-09-30"
  tasks_completed: 2
  files_modified: 1
---

# Phase 143 Plan 09: id-skill Substrate Edits (D-20/D-21/D-22) Summary

**One-liner:** Additive per-surface edits to `substrate/skills/id/SKILL.md` teaching the phase-143 un-archiving affordances (archived-roles collapsed section, archived-apps modal + header icon, conversation-search three-dots menu) plus the agent-side un-archive sentinel-drop pattern.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Additive edits to per-surface sections (D-21) | 20909413 | substrate/skills/id/SKILL.md |
| 2 | Add un-archive sentinel-drop subsection under §On /id archive (D-22) | 273e0473 | substrate/skills/id/SKILL.md |

## What Was Done

### Task 1 — Per-surface edits (D-21)

Three surface sections updated additively in `substrate/skills/id/SKILL.md`:

1. **Drama masks / roles modal** (after L573): Added two paragraphs describing (a) the always-visible three-dots menu on every role row for Archive (live) / Un-archive (archived), and the retirement of the older right-click gesture on this surface; (b) the Archived roles collapsed section — always visible, lazy-loaded, host-scoped — with the same three-dots menu.

2. **Sidebar Apps section** (after the existing Apps section bullet): Added a paragraph describing the always-visible **archived-box icon** on the Apps section header (RIGHT side, LEFT of collapse chevron) that opens the **Archived apps modal** (fleet-wide, rounded-square avatars, three-dots Un-archive per row, ~15s reconciler).

3. **Conversation search modal** (extending the `everywhere ↗` escalation paragraph): Added a paragraph describing archived-identity rows in the full search modal — always-visible three-dots menu for Un-archive, optimistic row removal on success, native alert naming blocked roles on failure, no drill-in on left-click. No "coming soon" language anywhere in file.

4. **Phase breadcrumb** added as HTML comment near frontmatter.

### Task 2 — Un-archive sentinel-drop section (D-22)

New top-level section `## Un-archiving — the sentinel-drop pattern for agents` inserted between `## On /id archive` and `## Spawning another agent`:

- Three explicit sentinel paths (identities-archive, roles-archive, apps-archive)
- Three preconditions: archive-exists, name-collision, all-roles-live (identities)
- User-initiated boundary (same rule as /id archive — no self-executing un-archive)
- Cross-reference back to §On /id archive
- No `/id unarchive` slash-command documented

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Phrased slash-command absence to satisfy grep=0 criterion**
- **Found during:** Task 2 verification
- **Issue:** Plan acceptance criterion requires `grep -c '/id unarchive' == 0`. Initial draft used "NO `/id unarchive` slash-command" which contains the literal string and triggers grep count = 1.
- **Fix:** Rephrased to "no slash-command for un-archiving" — same semantic, grep-clean.
- **Files modified:** substrate/skills/id/SKILL.md
- **Commit:** 273e0473 (included in same task commit)

## Known Stubs

None. This plan is documentation-only (SKILL.md edits). No UI stubs introduced.

## Threat Flags

None. The edits describe user-facing affordances and the agent-side sentinel-drop pattern; no new network endpoints, auth paths, or schema changes were introduced.

## Self-Check: PASSED

- [x] `substrate/skills/id/SKILL.md` exists and was modified
- [x] Commits 20909413 and 273e0473 exist in git log
- [x] `grep -c 'three-dots menu'` = 4 (>= 3 required)
- [x] `grep -c 'Archived roles'` = 2 (>= 1 required)
- [x] `grep -c 'Archived apps'` = 1 (>= 1 required)
- [x] `grep -c 'archived-box icon'` = 1 (>= 1 required)
- [x] `grep -c 'coming soon'` = 0 (== 0 required)
- [x] `grep -c 'older right-click'` = 1 (>= 1 required)
- [x] `grep -c '## Un-archiving'` = 1 (>= 1 required)
- [x] `grep -c '.unarchive-requested'` = 3 (>= 3 required)
- [x] `grep -c '/id unarchive'` = 0 (== 0 required)
- [x] `grep -c 'User-initiated'` = 1 (>= 1 required)
- [x] Distributed copy `~/.claude/skills/id/SKILL.md` not touched (only `substrate/skills/id/SKILL.md` in git status)
