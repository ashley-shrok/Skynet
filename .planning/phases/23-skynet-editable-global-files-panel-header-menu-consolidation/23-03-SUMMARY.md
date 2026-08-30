---
phase: 23-skynet-editable-global-files-panel-header-menu-consolidation
plan: 03
subsystem: frontend
tags: [frontend, modal, api-helpers, gefm, react, typescript]
dependency_graph:
  requires: [23-01-SUMMARY, 23-02-SUMMARY]
  provides: [GEFM-05-frontend, global-files-api-ts, GlobalFileTab, GlobalFilesModal]
  affects:
    - src/ui/api/global-files-api.ts
    - src/ui/features/pretty-view/GlobalFileTab.tsx
    - src/ui/features/pretty-view/GlobalFilesModal.tsx
tech_stack:
  added: []
  patterns:
    - authApi-handleApiError-frontend-api
    - typed-409-error-class
    - TabState-discriminated-union
    - lazy-per-tab-fetch
    - optimistic-concurrency-409-confirm-reload
    - collectAllHosts-third-copy-inline
    - DialogPrimitive-glass-chrome
decisions:
  - global-files-api.ts created as new file (not grown onto identities-api.ts) — orthogonal endpoints, cleaner
  - GlobalFileTabData = { content, mtime } local type, not widening shared TabState<string>
  - collectAllHosts copied inline as third instance (RESEARCH F1 extraction deferred, diff kept scoped)
  - 409 UX: window.confirm + reload or keep-draft; no 3-way diff (MVP per CONTEXT §deferred)
  - compact <select> host picker (not grid) — modal header tight, single host in mind
key_files:
  created:
    - src/ui/api/global-files-api.ts
    - src/ui/features/pretty-view/GlobalFileTab.tsx
    - src/ui/features/pretty-view/GlobalFilesModal.tsx
  modified: []
metrics:
  duration: "~20 minutes"
  completed: 2026-08-05
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 0
---

# Phase 23 Plan 03: GlobalFilesModal + GlobalFileTab + global-files-api.ts Summary

**One-liner:** Three new frontend files (API helpers + tab body + modal shell) that turn the wave 1-2 backend endpoints into an editable-textarea UI — host picker, per-file tabs, lazy SSH reads, optimistic-concurrency 409 reload, and empty-state card (GEFM-05).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create global-files-api.ts (3 endpoints + typed 409 error) | `a6e4be8` | `global-files-api.ts` (created) |
| 2 | Create GlobalFileTab.tsx (monospace textarea + Save, no markdown preview) | `12d676b` | `GlobalFileTab.tsx` (created) |
| 3 | Create GlobalFilesModal.tsx (modal shell + host picker + Tabs + empty-state) | `5e6c2f2` | `GlobalFilesModal.tsx` (created) |

## What Was Built

### Task 1 — `src/ui/api/global-files-api.ts` (99 lines)

Thin wrapper over the three GEFM backend endpoints, mirroring `identities-api.ts` shape:
- `GlobalFileEntry`, `GlobalFileReadResult`, `GlobalFileWriteInput`, `GlobalFileWriteResult` — exported types.
- `GlobalFileMtimeConflictError` — typed 409 error class matching `RoleAlreadyExistsError` shape; holds `currentMtime` and `currentContent` for reload-and-retry UX.
- `listGlobalFiles(hostId)` — GET /global-files?hostId=<n>, returns empty array on unconfigured host.
- `readGlobalFile(hostId, path)` — POST /global-files/read, returns `{ content, mtime, size }`.
- `writeGlobalFile(input)` — PUT /global-files/write; throws `GlobalFileMtimeConflictError` on 409, `handleApiError` for other failures.

### Task 2 — `src/ui/features/pretty-view/GlobalFileTab.tsx` (112 lines)

Per-file tab body, structural mirror of `RoleFileTab.tsx` with preview mode stripped:
- `GlobalFileTabData = { content: string; mtime: number }` — local data type; doesn't widen shared `TabState<string>`.
- `TabState<GlobalFileTabData>` imported from `IdentityFileTab` (not duplicated).
- Default export `GlobalFileTab({ state, onSave })` where `onSave: (content, expectedMtime) => Promise<void>`.
- Textarea is always editable (no view/edit toggle, no Cancel button — modal-close is cancel).
- `useEffect` seeds draft from `state.data.content` when `mtime` changes (post-save server echo reseeds correctly).
- Textarea styling copied verbatim from `RoleFileTab.tsx` L134 (CONTEXT §specifics "do NOT reinvent, it's tuned").
- Loading/error/empty-content branches mirror `RoleFileTab` patterns.
- No `ReactMarkdown` import, no `editing` state variable.

### Task 3 — `src/ui/features/pretty-view/GlobalFilesModal.tsx` (351 lines)

Modal shell with `DialogPrimitive` chrome, dynamic tab set, and lazy SSH reads:
- Props: `open`, `onOpenChange`, `hostTree: HostFolder | null`, `defaultHostId: number | null`, `container?: HTMLElement | null`.
- `collectAllHosts` inlined (third copy, RESEARCH F1 pending — header comment notes the duplication).
- Auto-selects `defaultHostId` if present in fleet; falls back to sole-host auto-select.
- Files-list fetch on host change (`listGlobalFiles`) with loading/error/empty branches.
- Lazy per-tab SSH read (`readGlobalFile`) fires on `activeTab` change if not yet in `tabData` Map.
- `handleSave(path, content, expectedMtime)` — calls `writeGlobalFile`, updates `tabData` with server-authoritative mtime on success; on `GlobalFileMtimeConflictError` (409) shows `window.confirm` with reload-or-keep-draft choice.
- Empty-state card: "No global files configured for this host." with hint to edit `global-files.json` (per GEFM-02 never-fabricate rule).
- Bottom icon-bar tab switcher with `FileText` icons and file labels/basenames (patch #191 pattern from `IdentityModal` L1400-1426).
- Glass chrome style (literal hex + `hsla(220, ...)`) — zero Skynet `bg-background`/`text-foreground`/`bg-popover` tokens.
- `onInteractOutside` → `e.preventDefault()` (patch #111f pattern — preserves chat region clickability).

## Verification Results

- `npx tsc --noEmit`: exits 0 (no new type errors)
- `npm run build`: exits 0 (built in ~7.0s)
- `npx vitest run`: 1404 tests passed | 12 skipped | 0 failures (no regressions — same counts as waves 1-2)
- All acceptance criteria grep assertions: PASS (see individual task criteria in plan)

## Deviations from Plan

None — plan executed exactly as written.

**Notes on implementation fidelity:**
- The `useEffect` dependency array for the mtime-seed effect uses `state.status === "ready" ? state.data.mtime : null` as the key per the plan — an intentional "conditional key in dep array" pattern to avoid running on every render. The eslint-disable comment was added to suppress the lint warning this pattern triggers.
- The `GlobalFileMtimeConflictError` `throw err` rethrow in `handleSave` only fires when the user declines the reload prompt; if they accept, the function returns early (no rethrow), which means the tab resets silently without an inline error message — this is the desired UX per CONTEXT §deferred "MVP is reload + retry".

## Known Stubs

None — all three files wire to real backend endpoints. No placeholder data, no TODO stubs in any render path. The empty-state and loading/error branches are intentional states, not stubs.

## Threat Flags

None — no new network endpoints or auth paths introduced. The three frontend API helpers call the backend routes already secured in waves 1-2 (authenticateJWT + resolveHostById + whitelist enforcement). The modal chrome uses `onInteractOutside` only to prevent accidental close (no auth bypass).

## Self-Check: PASSED

- `src/ui/api/global-files-api.ts` — FOUND
- `src/ui/features/pretty-view/GlobalFileTab.tsx` — FOUND
- `src/ui/features/pretty-view/GlobalFilesModal.tsx` — FOUND
- Commit `a6e4be8` — FOUND in git log
- Commit `12d676b` — FOUND in git log
- Commit `5e6c2f2` — FOUND in git log
- tsc --noEmit: exits 0
- npm run build: exits 0
- vitest run: 1404/0 (pass/fail)
