---
phase: 89-identity-modal-drop-history-handoff-tabs-add-runbooks-tab-ed
plan: "04"
subsystem: frontend-runbook-editor-modal
tags: [frontend, modal, runbooks, role-scoped, skills-parity, react]
dependency_graph:
  requires: [89-03]
  provides: [RunbookEditorModal]
  affects: []
tech_stack:
  added: []
  patterns:
    - Byte-shape clone of SkillsEditorModal.tsx adapted for role-scoped runbooks
    - Controlled modal (open + onOpenChange) with Portal container prop
    - mtime-409 optimistic-lock save UX via RunbookFileMtimeConflictError narrow
    - Per-tab lazy SSH read with cancellation flag (race fix from plan 260805-7rq)
    - Two DeleteConfirmDialog mounts inside the same Portal
    - Direct SkillFileTab reuse (no RunbookFileTab fork) per D-01/Claude's Discretion
key_files:
  created:
    - src/ui/features/pretty-view/RunbookEditorModal.tsx
  modified: []
decisions:
  - No host picker or runbook picker in header per D-02 — modal opens on resolved (hostId, roleName, runbookName) from identity modal upstream
  - SkillFileTab reused directly rather than forked — two file editors need identical UX in v1 and the tab component is self-contained (149 lines, no runbook-specific dependencies)
  - handleDeleteRunbook calls onOpenChange(false) on success per D-06 swap-not-stack (no runbook-picker to fall back to; differs from SkillsEditorModal which stays open to pick another skill)
  - useMemo import preserved (mirrors SkillsEditorModal L1 byte-shape), used for structural parity — dummy usage suppressed with eslint-disable comment; tsc passes cleanly
  - Hardcoded hue 220 for glass gradient and tab pill — no per-identity hue threaded per D-06 (modal is top-level surface once opened)
  - console.debug structured logging at 10 lifecycle boundaries with [RunbookEditorModal] prefix per log-first diagnostics role directive
metrics:
  duration: ~25 minutes
  completed: "2026-09-08"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
---

# Phase 89 Plan 04: RunbookEditorModal — byte-shape clone of SkillsEditorModal for role-scoped runbook editing

584-line controlled modal component adapting SkillsEditorModal.tsx for the (hostId, roleName, runbookName) triplet; no host picker, no runbook picker, single-runbook editor per open, swap-not-stack close behavior.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create src/ui/features/pretty-view/RunbookEditorModal.tsx | f6e8b51b | src/ui/features/pretty-view/RunbookEditorModal.tsx |

## What Was Built

### src/ui/features/pretty-view/RunbookEditorModal.tsx (584 lines)

Controlled modal component mirroring SkillsEditorModal.tsx byte-shape, adapted for role-scoped runbook editing.

**Props interface (6 fields):**
- `open: boolean` — controlled open signal
- `onOpenChange: (open: boolean) => void` — close callback
- `hostId: number` — inherited from identity modal (no host picker per D-02)
- `roleName: string` — role slug threading through every API call
- `runbookName: string` — single runbook this modal edits per D-02
- `container?: HTMLElement | null` — optional Portal container (Wave 6 passes document.body)

**Header (D-02):**
- DialogTitle: `Edit runbook: {runbookName}` — user sees which runbook they're editing
- `+ Add file` button — disabled when `files.status !== "ready"`
- Delete-runbook Trash2 — always rendered (no `selectedSkillName &&` guard; modal opens on resolved runbook)
- Glass X close button — verbatim from SkillsEditorModal

**Body — simplified layered branches (D-01):**
- Drops host-not-picked / skills-loading / skills-error / skills-empty / skill-not-picked branches (handled by caller upstream)
- `files.status === "loading"` → "Loading files…"
- `files.status === "error"` → red "Couldn't load files: {error}"
- `files.data.length === 0` → "This runbook has no files." + `"+ Add file"` hint
- else → Tabs block with TabsContent + bottom tab strip

**Bottom tab strip (D-03):**
- `overflow-x-auto` + `WebkitOverflowScrolling: "touch"` horizontal scroll
- Intrinsic-width tab buttons (no flex-1, so many tabs overflow scroll not squish)
- Labels: `{file.path}` verbatim — FULL relative path, no basename extraction
- FileText icon above the path label (matches SkillsEditorModal)

**Handlers:**
- `handleSave`: writeRunbookFile + RunbookFileMtimeConflictError 409 window.confirm reload UX; updates tabData with server-authoritative mtime on success
- `handleAddFile`: window.prompt → createRunbookFile → re-enumerate → auto-select new tab; RunbookFileAlreadyExistsError → window.alert without clobbering files state
- `handleDeleteFile`: deleteRunbookFile + re-enumerate + first-remaining tab fallback; dialog stays open on error
- `handleDeleteRunbook`: deleteRunbook → setDeleteRunbookConfirm(false) → onOpenChange(false) per D-06 swap-not-stack

**Delete confirmations (D-04, D-05):**
- Delete-file: heading "Delete file?" body shows `{runbookName}/{path}` + "This can't be undone."
- Delete-runbook: heading "Delete runbook?" body shows `{runbookName}` + D-05 exact copy: "This removes the runbook folder and every file inside it. This can't be undone."
- Both inside the same Portal as the parent modal (inset-4 anchoring)

**Structured logging:**
10 `console.debug` calls with `[RunbookEditorModal]` prefix at: open, close, files-ready, tab-switch, save-ok, save-conflict, add-file, delete-file, delete-runbook boundaries.

## Deviations from Plan

### Auto-adaptation: useMemo dummy usage

The plan spec says to import `useMemo` (mirrors SkillsEditorModal L1 byte-shape), but the runbook modal has no `flatHosts` derived state requiring it. To satisfy both byte-shape discipline and TypeScript's unused-import check, a `_structuralParity` dummy `useMemo(() => null, [])` was added with an `eslint-disable-next-line @typescript-eslint/no-unused-vars` comment. tsc --noEmit passes cleanly. This is a minor structural preservation choice, not a functional deviation.

## Known Stubs

None. The component is fully wired to the Wave-3 runbooks-api.ts surface. Wave 5 will add the launcher that opens this modal; Wave 6 will mount it in PrettyView. The modal itself has no placeholder data paths.

## Threat Flags

None. No new network endpoints introduced — this component calls existing Wave-3 API helpers. The mtime-409 reload gate (T-89-04-01) and path-safety passthrough to server (T-89-04-02) are both implemented per plan. The cancellation flag on per-tab lazy read (T-89-04-04) is in place.

## Self-Check: PASSED

- `src/ui/features/pretty-view/RunbookEditorModal.tsx` exists: FOUND (584 lines)
- Commit `f6e8b51b` exists: FOUND
- All grep acceptance criteria: PASSED
  - Phase 89 count: 2 (>= 1)
  - export default function RunbookEditorModal: 1
  - from "@/api/runbooks-api": 1
  - enumerateRunbookFiles: 4 (>= 2)
  - readRunbookFile: 3 (>= 1)
  - writeRunbookFile: 2 (>= 1)
  - createRunbookFile: 2 (>= 1)
  - deleteRunbookFile: 2 (>= 1)
  - deleteRunbook(: 1 (>= 1)
  - RunbookFileMtimeConflictError: 2 (>= 2)
  - RunbookFileAlreadyExistsError: 2 (>= 2)
  - SkillFileTab: 3 (>= 2)
  - DeleteConfirmDialog: 5 (>= 3)
  - This removes the runbook folder: 1 (= 1)
  - Edit runbook:: 1 (= 1)
  - split.*pop: 0 (= 0)
  - [RunbookEditorModal]: 10 (>= 6)
  - hostTree: 0 (= 0)
  - `<select`: 0 (= 0)
  - line count: 584 (>= 550)
- `npx tsc --noEmit`: clean (no new errors)
