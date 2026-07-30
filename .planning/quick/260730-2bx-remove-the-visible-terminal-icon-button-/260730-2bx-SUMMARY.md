---
phase: 260730-2bx
plan: 01
subsystem: pretty-view / compose-box
tags: [ui-cleanup, prop-removal, lucide-react]
dependency_graph:
  requires: []
  provides: [ComposeBox-no-terminal-button, PrettyView-no-togglePrettyMode-prop]
  affects: [ComposeBox.tsx, PrettyView.tsx, Terminal.tsx]
tech_stack:
  added: []
  patterns: [surgical-prop-removal]
key_files:
  created: []
  modified:
    - src/ui/features/pretty-view/ComposeBox.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/terminal/Terminal.tsx
decisions:
  - "Removed onTogglePrettyMode prop chain entirely (ComposeBox declaration, destructure, PrettyView declaration, destructure, forwarding, Terminal caller); keyboard shortcut path at Terminal.tsx line 869 left untouched as the sole escape hatch"
  - "Dropped Terminal from lucide-react named import in ComposeBox.tsx — no remaining usages after JSX removal"
metrics:
  duration: 8m
  completed: "2026-07-30"
---

# Phase 260730-2bx Plan 01: Remove Terminal-icon toggle button from ComposeBox aux row

**One-liner:** Removed visible Terminal-icon button and orphan `onTogglePrettyMode` prop chain across ComposeBox -> PrettyView -> Terminal.tsx; Ctrl+Shift+O keyboard escape hatch preserved verbatim.

## What Was Built

The Terminal-icon button in the ComposeBox aux row was already `max-md:hidden` (invisible on mobile) and purely duplicated the Ctrl+Shift+O keyboard shortcut. This plan surgically removed:

1. **ComposeBox.tsx** — JSX block (toggle button + its comment), prop declaration (`onTogglePrettyMode?: () => void` + 5-line comment), destructure entry, and `Terminal` from the lucide-react named import.
2. **PrettyView.tsx** — prop declaration (6-line comment + `onTogglePrettyMode?: () => void`), destructure entry, and the forwarding line `onTogglePrettyMode={onTogglePrettyMode}` in the ComposeBox JSX.
3. **Terminal.tsx** — caller line `onTogglePrettyMode={() => setIsPrettyMode((v) => !v)}` in the PrettyView JSX.

The Ctrl+Shift+O path (`togglePrettyMode: () => { setIsPrettyMode((v) => !v); }` at Terminal.tsx line 869) is byte-identical to its pre-task state.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Delete ComposeBox Terminal-button JSX + prop, drop Terminal from lucide import | fa3e17b |
| 2 | Remove onTogglePrettyMode plumbing from PrettyView + Terminal.tsx caller | fa3e17b |
| 3 | Run focused vitest suites and commit | fa3e17b |

All three tasks landed in one atomic commit as specified: `fa3e17b`.

## Verification Results

- `grep -rn "onTogglePrettyMode" src/` → 0 matches
- `grep -n "Terminal\b" src/ui/features/pretty-view/ComposeBox.tsx` → 0 matches
- `grep -n "setIsPrettyMode((v) => !v)" src/ui/features/terminal/Terminal.tsx` → line 869 (preserved)
- `npx tsc --noEmit` → exit 0
- `npx vitest run` (7 focused test files) → 69 passed, 6 skipped, 0 failed

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — this is a pure UI removal with no new network endpoints, auth paths, file access patterns, or schema changes.

## Self-Check: PASSED

- `fa3e17b` commit exists: confirmed via `git log -1`
- ComposeBox.tsx, PrettyView.tsx, Terminal.tsx all modified in the commit (3 files changed, 1 insertion, 45 deletions)
- Working tree clean after commit
- Keyboard shortcut preserved at Terminal.tsx line 869
