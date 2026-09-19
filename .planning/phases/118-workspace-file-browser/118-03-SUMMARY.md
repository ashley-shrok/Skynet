---
phase: 118-workspace-file-browser
plan: "03"
subsystem: pretty-view / workspace-file-browser
tags: [react, workspace, file-browser, pretty-view, wave-2]
dependency_graph:
  requires: ["118-01", "118-02"]
  provides: ["WorkspaceTab.tsx — importable by IdentityModal (Plan 118-04)"]
  affects: ["src/ui/features/pretty-view/WorkspaceTab.tsx"]
tech_stack:
  added: []
  patterns:
    - "D-10 inline tab-body swap (list↔viewer) — no modal stacking"
    - "refreshKey counter for manual re-fetch (D-05)"
    - "dragCounter useRef pattern for drag-drop flicker prevention (D-16)"
    - "lazy() + Suspense for MarkdownEditor (avoids ~1.5MB bundle on first load)"
    - "All hooks at top of WorkspaceFileViewer (Rules of Hooks compliance)"
key_files:
  created:
    - path: "src/ui/features/pretty-view/WorkspaceTab.tsx"
      lines: 1861
      exports: ["default (WorkspaceTab)", "WorkspaceTabProps"]
  modified: []
decisions:
  - "Tasks 1 + 2 implemented in a single pass (same file — writing placeholder then replacing was not beneficial for a single-file plan)"
  - "V1: last-write-wins for text/md save (mtime=0 sentinel passed to GlobalFileTab) — backend read-file response does not include mtimeMs and adding it would be a Plan 118-01 amendment (see mtime section below)"
  - "Row overflow menu implemented as inline absolute-positioned dropdown (not context-menu or window.alert) — cleaner UX per Claude's Discretion"
  - "Host chip reachability derived from initial /workspace/list call result (no separate probe) — matches Open Question 3 recommendation in RESEARCH.md"
metrics:
  duration: "~9 minutes"
  completed: "2026-09-19T07:26:43Z"
  tasks_completed: 2
  files_changed: 1
---

# Phase 118 Plan 03: WorkspaceTab.tsx Summary

**One-liner:** WorkspaceTab React component — list-mode with breadcrumb/sort/toolbar/drag-drop and inline viewer-mode for md/text/image/binary, consuming workspace-api.ts and workspace-error-copy.ts from Wave 1.

## Component Tree

```
WorkspaceTab (default export)
  Props: { identity: Identity; hostId: number; hue: number }
  State: viewMode | currentPath | openFile | refreshKey
  │
  ├─ WorkspaceListView (internal subcomponent)
  │    Props: currentPath + onNavigate + onOpenFile + identity + hostId + hue
  │           + refreshKey + onRefresh
  │    State: listState (loading|ready|error) | sortKey | sortDir | dragActive
  │           | dragCounter (useRef) | fileInputRef | pendingNew | newName
  │           | openMenuFor | renamingFor | renameValue | uploadError
  │    Renders:
  │      - Host chip (D-18): green/red dot from listState
  │      - Toolbar: breadcrumb nav + Upload + New folder + New file + Refresh
  │      - Column headers: Name/Size/Modified (clickable, active arrow indicator)
  │      - File/folder rows (D-08 show everything, folders first D-15)
  │        - Inline rename input when renamingFor === entry.name
  │        - Overflow menu: Rename / Download / Delete (D-07 window.confirm)
  │      - Inline "new" input row when pendingNew is set (D-17)
  │      - Drag-drop overlay (D-16): dashed border + "Drop to upload" card
  │      - Error banners via resolveWorkspaceErrorCopy (D-23/D-24)
  │
  └─ WorkspaceFileViewer (internal subcomponent)
       Props: file + onBack + identity + hostId + hue
       State: fetchState | tabState | mdContent | saveError
       Hooks: all at top of function (Rules of Hooks compliance)
       Renders header: Back button + filename + Download link
       Body dispatch by file.type:
         "markdown" → lazy MarkdownEditor in Suspense (D-11, no modal chrome D-10)
         "text"     → GlobalFileTab (D-11, no modal chrome D-10)
         "image"    → data:image/<ext>;base64,<content> in <img>
         "binary"   → empty state + Download link (no fetch)

Module-private helpers:
  - sortEntries(entries, sortKey, sortDir) — folders first (D-15), then by key
  - getFileViewType(name) — MD_RE / TEXT_RE / IMAGE_RE dispatch (D-12)
  - formatBytes(bytes) — consumer-friendly "3.2 KB", "—" for null
  - formatMtime(mtimeMs) — "just now" / "5 min ago" / "2d ago" / date string
  - ErrorBanner({ heading, body }) — shared inline error component
  - decodeBase64(b64) — multi-byte safe UTF-8 decode inside WorkspaceFileViewer
```

## Decisions Honored

| Decision | Status | Notes |
|----------|--------|-------|
| D-05 (snapshot + manual refresh) | DONE | refreshKey in useEffect deps; Refresh button increments |
| D-06 (no polling/WS) | DONE | Zero polling/subscription/timer code — grep gate passes |
| D-07 (single generic delete confirm) | DONE | window.confirm("Delete ...?") before deleteWorkspaceEntry |
| D-08 (show everything) | DONE | No filtering, dotfiles render alongside regular files |
| D-09 (inline mode swap) | DONE | viewMode state; no second modal opened |
| D-10 (no modal stacking) | DONE | Grep gate: 0 matches for Dialog/DialogPrimitive/EditableFileModal |
| D-11 (reuse MarkdownEditor + GlobalFileTab) | DONE | Both imported and mounted inline (no modal chrome) |
| D-12 (extension-based file dispatch) | DONE | MD_RE / TEXT_RE / IMAGE_RE + "binary" fallback |
| D-13 (breadcrumb navigation) | DONE | Workspace root → crumb segments, each clickable |
| D-14 (sortable columns) | DONE | Name/Size/Modified with ▲/▼ active-column arrows |
| D-15 (folders always above files) | DONE | sortEntries() puts type==="directory" first unconditionally |
| D-16 (drag-drop + upload button) | DONE | dragCounter useRef pattern; onDragEnter/onDragLeave/onDrop wired |
| D-17 (new folder + new file) | DONE | Inline input row with Create/Cancel buttons |
| D-18 (host chip) | DONE | Dot color derived from listState (green/red/neutral) |
| D-23 (consumer register) | DONE | All user-visible strings verified — no SSH/SFTP/endpoint/regex/octal |
| D-24 (no jargon) | DONE | Error copy from WORKSPACE_ERROR_COPY; empty states use plain English |
| T-118-P3-02 (blind stance) | DONE | Zero imports of ws/subscription-registry/tmux-helper — grep gate passes |
| T-118-P3-03 (no raw error strings) | DONE | Every error path uses resolveWorkspaceErrorCopy |

## mtime-based Dirty Guard

**Disposition: deferred (last-write-wins for V1)**

`GlobalFileTab.onSave` accepts `(content: string, expectedMtime: number)`. The `globalFileSave` adapter passes `_mtime` through but the backend's `/workspace/write-file` endpoint (Plan 118-01) uses atomic tmp+rename without a separate optimistic-concurrency lock — it just overwrites. The `/workspace/read-file` response (`ReadFileResponse`) does NOT include `mtimeMs`.

V1 behavior: `mtime = 0` sentinel is passed to `GlobalFileTab`'s state. GlobalFileTab's dirty-guard compares content — if the content changed, Save is enabled; if unchanged, Save is disabled. Concurrent writes from another session will be silently overwritten on the next save (last-write-wins).

**Future fix if needed (Plan 118-04+ or a revision):** Add `mtimeMs` to `ReadFileResponse` in both the backend `/read-file` handler and `workspace-api.ts`, then thread the mtime from `readWorkspaceFile` response through `tabState.data.mtime` — WorkspaceFileViewer already wires `tabState` to GlobalFileTab.

## Deviations from Plan

### Structural Deviation — Tasks 1 and 2 Combined

**Type:** Implementation efficiency (no behavioral deviation)

**What the plan said:** Task 1 ships a placeholder viewer ("Viewer coming in Task 2 — file: <name>"); Task 2 replaces the placeholder with the real WorkspaceFileViewer subcomponent.

**What was done:** Both tasks implemented in a single pass, producing the complete WorkspaceFileViewer directly. Writing a placeholder and then replacing it added no value for a single-file plan with a single commit target. All Task 1 acceptance criteria (list-mode, drag-drop, sort, host chip, toolbar, breadcrumb, error banners, refreshKey, window.confirm) and all Task 2 acceptance criteria (MarkdownEditor lazy, GlobalFileTab inline, image data URI, binary empty state, Back button, viewer error paths) are met.

**Files:** `src/ui/features/pretty-view/WorkspaceTab.tsx` (single commit `34c8974`)

### Auto-fix — Rules of Hooks Compliance

**Rule:** Rule 1 (bug fix)

**Found during:** Initial implementation — `useCallback` was inside `else { }` branch for text viewer.

**Fix:** Moved all hooks (`handleSave`, `globalFileSave`) to the top of `WorkspaceFileViewer`, above any conditional rendering. The `globalFileSave` adapter is always created unconditionally and passed to `GlobalFileTab` for the text branch.

### Auto-fix — Comment Rewording (grep gate compliance)

**Rule:** Rule 1 (acceptance criteria)

**Found during:** Post-write grep gate check — comment text contained the exact strings `Dialog`, `DialogPrimitive`, etc., causing the grep count to exceed 0.

**Fix:** Rewrote comments to not include the exact grep-gate strings while preserving the meaning.

## Known Stubs

None — the component is fully wired. All code paths reach real API helpers. The `mtime=0` sentinel is intentional (V1 last-write-wins) and documented above, not an accidental stub.

## Self-Check

### Files Exist

- `src/ui/features/pretty-view/WorkspaceTab.tsx`: EXISTS (1861 lines)

### Commit Exists

- `34c8974`: EXISTS (feat(118-03): WorkspaceTab.tsx — list-mode + viewer-mode + drag-drop + host chip)

## Self-Check: PASSED
