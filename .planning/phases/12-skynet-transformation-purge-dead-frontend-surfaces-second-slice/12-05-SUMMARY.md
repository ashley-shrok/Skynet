---
phase: 12-skynet-transformation-purge-dead-frontend-surfaces-second-slice
plan: 05
subsystem: shell
tags: [purge, delete-only, shell, tab-chrome, phase-12, PURGE-08]
requires:
  - "12-01 (STRIP-LIST § Section F Tab.tsx orphan enumeration)"
provides:
  - "Termix visible tab-strip chrome fully deleted from disk"
affects:
  - "src/ui/shell/ directory (one file removed; four files preserved)"
tech_stack:
  added: []
  patterns: []
key_files:
  created:
    - ".planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/12-05-SUMMARY.md"
  modified: []
  deleted:
    - "src/ui/shell/Tab.tsx (442 lines — Termix visible tab-strip renderer with per-tab-type icons, X-close button, split icon, click routing)"
decisions:
  - "Confirmed via fresh grep gate that Tab.tsx has zero non-comment import consumers across src/ (matches 12-01-STRIP-LIST § Section F evidence). No blocker required — proceeded as delete-only single-task plan."
  - "Retained TabContext.tsx, tabUtils.tsx, CommandPalette.tsx, SplitView.tsx untouched — these provide the invisible tab plumbing (state provider, dispatcher, keyboard command palette, split-view chrome) that AppShell still consumes."
metrics:
  duration_min: 1
  tasks_completed: 1
  files_deleted: 1
  completed_date: 2026-07-23
---

# Phase 12 Plan 05: Delete Tab.tsx (Termix Tab Bar Chrome) Summary

Deleted the 442-line `src/ui/shell/Tab.tsx` — the Termix visible tab-strip renderer — from disk. Zero-import orphan confirmed by fresh grep gate; tsc + targeted vitest both green.

## What Was Built (Deletion Edition)

Single atomic deletion of the file Phase 11's landing swap implicitly retired:

- **Removed:** `src/ui/shell/Tab.tsx` (442 lines) — contained `interface TabProps` at line 26 and `export function Tab({...})` at line 47. This was the top-of-window Termix tab bar chrome: per-tab-type icon rendering (SSH/RDP/VNC/etc.), click-to-focus routing, X-close button, split icon. Ashley does not see any of it in Skynet post-Phase-11.

- **Preserved (verified by post-deletion `test -f` gates):**
  - `src/ui/shell/TabContext.tsx` — retained tab state provider (`TabProvider`, `useTabs`, `TabType`, `TabSpec`). Note: named similarly to the deleted file but a wholly different concern (state machinery, not chrome).
  - `src/ui/shell/tabUtils.tsx` — tab render dispatcher, does not import Tab.tsx.
  - `src/ui/shell/CommandPalette.tsx` — retained AppShell keyboard command palette.
  - `src/ui/shell/SplitView.tsx` — retained AppShell split-view chrome.
  - `src/ui/sidebar/NewSessionDialog.tsx` — retained sidebar (T-12-05-04 mitigation gate).

## Tasks Completed

| Task | Name                                       | Commit  | Files                        |
| ---- | ------------------------------------------ | ------- | ---------------------------- |
| 1    | Delete src/ui/shell/Tab.tsx                | 5357279 | src/ui/shell/Tab.tsx (removed) |

## Verification Gates

All gates from PLAN.md `<verify>` block passed:

| Gate                                                              | Result       |
| ----------------------------------------------------------------- | ------------ |
| `test ! -f src/ui/shell/Tab.tsx`                                  | PASS         |
| `test -f src/ui/shell/TabContext.tsx`                             | PASS         |
| `test -f src/ui/shell/CommandPalette.tsx`                         | PASS         |
| `test -f src/ui/shell/SplitView.tsx`                              | PASS         |
| `test -f src/ui/shell/tabUtils.tsx`                               | PASS         |
| `test -f src/ui/sidebar/NewSessionDialog.tsx`                     | PASS         |
| Grep gate (execution_context form): `grep -rn "from.*shell/Tab\"" src/ ... \| wc -l` | 0            |
| Grep gate (PLAN.md form): `grep -rn 'from "@/shell/Tab.tsx"\|from "@/shell/Tab"\|from "./Tab.tsx"' ... \| wc -l` | 0            |
| `npx tsc --noEmit`                                                | exit 0       |
| `npx vitest run PrettyConversationsPanel.test.tsx`                | 14/14 pass, exit 0 |

## Deviations from Plan

None — plan executed exactly as written. Zero deviations, zero auto-fixes, zero checkpoints.

## Threat Model Coverage

All STRIDE threats in the plan's threat register were correctness gates rather than runtime mitigations, and each was verified:

| Threat ID  | Mitigation                                                           | Verification |
| ---------- | -------------------------------------------------------------------- | ------------ |
| T-12-05-01 | Only `src/ui/shell/Tab.tsx` named in `<files>` block                 | PASS — TabContext.tsx `test -f` gate green |
| T-12-05-02 | Zero cross-tree imports of Tab.tsx (STRIP-LIST § F)                  | PASS — grep gates return 0; tsc clean |
| T-12-05-03 | Task does not touch features/keyboard/                               | PASS — git diff scope = src/ui/shell/Tab.tsx only |
| T-12-05-04 | Task does not touch sidebar/                                         | PASS — `test -f src/ui/sidebar/NewSessionDialog.tsx` green |
| T-12-05-SC | Zero npm/pip/cargo installs                                          | PASS — no install commands run |

## Threat Flags

None — this plan removes surface rather than adds it. No new endpoints, auth paths, file access patterns, or trust boundaries introduced.

## Known Stubs

None — this is a delete-only plan. No placeholder data, hardcoded empties, or "coming soon" text introduced.

## Requirements Delivered

- **PURGE-08:** Termix tab bar chrome (`src/ui/shell/Tab.tsx`) deleted from disk. Ashley's Skynet AppShell no longer carries the retired Termix top-strip file.

## Self-Check: PASSED

- Deleted file verified: `src/ui/shell/Tab.tsx` — MISSING (as intended, `test ! -f` PASS)
- Retained files verified: TabContext.tsx, CommandPalette.tsx, SplitView.tsx, tabUtils.tsx, sidebar/NewSessionDialog.tsx — all FOUND
- Commit verified: `git log --oneline` shows `5357279` on tip of `feat/tab-title-from-tmux`
- SUMMARY.md file present at `.planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/12-05-SUMMARY.md`
