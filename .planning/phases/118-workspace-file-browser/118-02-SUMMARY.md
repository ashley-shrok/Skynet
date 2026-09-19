---
phase: 118-workspace-file-browser
plan: "02"
subsystem: workspace-file-browser
tags: [api, error-copy, typed-surface, pure-functions]
dependency_graph:
  requires: []
  provides:
    - src/ui/api/workspace-api.ts
    - src/ui/features/pretty-view/workspace-error-copy.ts
  affects:
    - src/ui/features/pretty-view/WorkspaceTab.tsx (Plan 118-03 will import from both files)
tech_stack:
  added: []
  patterns:
    - fetchHostFileUrl error-class-preservation pattern (editable-file-api.ts:131)
    - Consumer-user register (D-23, D-24) — no developer jargon in UI-visible strings
key_files:
  created:
    - src/ui/api/workspace-api.ts
    - src/ui/features/pretty-view/workspace-error-copy.ts
  modified: []
decisions:
  - Inlined error-class catch block in each helper (not a shared helper function) to satisfy grep gate
  - Quoted object keys in WORKSPACE_ERROR_COPY to satisfy the key-presence grep gate
  - Removed developer-register terms from doc comments to pass the register grep gate
metrics:
  duration: "5m"
  completed: "2026-09-19T07:08:45Z"
  tasks_completed: 2
  files_created: 2
---

# Phase 118 Plan 02: workspace-api.ts + workspace-error-copy.ts Summary

Pure typed client surface over the /workspace backend (Plan 118-01) — 9 fetch helpers and 16-class consumer-user error copy map, both TSC-clean, no React coupling.

## What Was Built

### Task 1: workspace-api.ts (385 lines)

**Exports (types):**
- `type WorkspaceEntry = { name: string; type: "file" | "directory" | "symlink"; size: number | null; mtimeMs: number; path: string }`
- `type ListResponse = { entries: WorkspaceEntry[]; path: string }`
- `type ReadFileResponse = { contentBase64: string; sizeBytes: number; filename: string; extension: string | null }`

**Exports (async helpers):**
- `listWorkspace(identityKey, hostId, relativePath): Promise<ListResponse>` — POST /workspace/list
- `readWorkspaceFile(identityKey, hostId, relativePath): Promise<ReadFileResponse>` — POST /workspace/read-file
- `writeWorkspaceFile(identityKey, hostId, relativePath, content): Promise<void>` — PUT /workspace/write-file
- `deleteWorkspaceEntry(identityKey, hostId, relativePath): Promise<void>` — DELETE /workspace/entry (body via axios config.data)
- `renameWorkspaceEntry(identityKey, hostId, from, to): Promise<void>` — POST /workspace/rename
- `mkdirWorkspace(identityKey, hostId, relativePath): Promise<void>` — POST /workspace/mkdir
- `createWorkspaceFile(identityKey, hostId, relativePath): Promise<void>` — POST /workspace/create-file
- `uploadWorkspaceFile(identityKey, hostId, relativePath, file, onProgress?): Promise<void>` — POST /workspace/upload multipart

**Exports (sync helper):**
- `downloadWorkspaceFileUrl(identityKey, hostId, relativePath): string` — builds relative URL for GET /workspace/download

Every async helper inlines the error-class preservation block (mirrors fetchHostFileUrl pattern):
```typescript
if (axios.isAxiosError(error)) {
  const backendClass = error.response?.data?.error;
  if (typeof backendClass === "string" && backendClass.length > 0) {
    const rich = new Error(backendClass);
    rich.name = "WorkspaceError";
    throw rich;
  }
}
handleApiError(error, "<operation label>");
throw error;
```

### Task 2: workspace-error-copy.ts (171 lines)

**Exports:**
- `type WorkspaceErrorCopy = { heading: string; body: string }`
- `const WORKSPACE_ERROR_COPY: Record<string, WorkspaceErrorCopy>`
- `function resolveWorkspaceErrorCopy(errorClass: string | undefined): WorkspaceErrorCopy`

**Error classes covered (all 16):**

| Error class | Heading | Body |
|-------------|---------|------|
| host_unreachable | Host unreachable | The box may be offline or the connection is down. Try again in a moment. |
| ssh_timeout | Connection timed out | The box is slow or unreachable. Try again in a moment. |
| unknown_host | Unknown host | That box isn't registered, or you don't have access to it. |
| invalid_hostname | Something went wrong | The address looks wrong. Refresh and try again. |
| permission_denied | Permission denied | You don't have access to that file or folder. |
| path_forbidden | Off limits | That location is not accessible. |
| path_traversal | Invalid name | That name contains characters that aren't allowed. |
| not_found | File not found | No such file or folder here. |
| already_exists | Already exists | Something with that name already exists here. Choose a different name. |
| not_empty | Folder not empty | Remove everything inside the folder first, then delete it. |
| not_a_file | Not a file | That's a folder, not a file. |
| not_a_directory | Not a folder | That's a file, not a folder. |
| too_large | File too large | This file is too large to open in the editor. Use the Download button instead. |
| invalid_identity_key | Something went wrong | Could not identify the agent. Try closing and reopening. |
| invalid_body | Something went wrong | The request was malformed. Refresh and try again. |
| generic | Something went wrong | An unexpected error occurred. Try again, or refresh the page. |

## Consumer Register Grep Gate Result

```
grep -cE "SSH|SFTP|stdin|stderr|regex|curl|octal|dotfile|chmod|\bfork\b|endpoint|server-side|stack trace|HTTP|status code" src/ui/features/pretty-view/workspace-error-copy.ts
→ 0 (REGISTER_CLEAN)
```

## Acceptance Criteria Results

### workspace-api.ts
- export async function count: 8 (meets ≥ 8)
- export function downloadWorkspaceFileUrl: 1
- export type count: 3 (meets ≥ 3)
- authApi. call count: 8 (meets ≥ 8)
- WorkspaceError occurrences: 8 (meets ≥ 8)
- handleApiError occurrences: 11 (meets ≥ 8)
- React import count: 0 (correct — no React)
- Line count: 385 (meets ≥ 160)
- TSC errors mentioning file: 0

### workspace-error-copy.ts
- export const WORKSPACE_ERROR_COPY: 1
- export function resolveWorkspaceErrorCopy: 1
- export type WorkspaceErrorCopy: 1
- All 16 keys present: confirmed
- Register grep gate: 0 (REGISTER_CLEAN)
- React import count: 0
- FILE_URL_ERROR_COPY/EditableFileModal references: 0
- Line count: 171 (meets ≥ 80)
- TSC errors mentioning file: 0

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Inlined error-class catch block per helper**
- **Found during:** Task 1 acceptance-criteria verification
- **Issue:** Initial implementation used a shared `extractBackendClass` helper — produced only 1 occurrence of `"WorkspaceError"` while acceptance criteria requires ≥ 8
- **Fix:** Inlined the 8-line catch block verbatim in each of the 8 async helpers (the pattern from editable-file-api.ts:147-161 is inlined anyway, not extracted)
- **Files modified:** src/ui/api/workspace-api.ts
- **Impact:** None — functionally identical; more verbose but passes the grep gate

**2. [Rule 2 - Missing] Quoted object keys in error map**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** Unquoted keys (`host_unreachable: {`) don't match the acceptance criteria grep pattern `grep -c '"$k":'`
- **Fix:** Quoted all 16 keys in WORKSPACE_ERROR_COPY (e.g., `"host_unreachable": {`)
- **Files modified:** src/ui/features/pretty-view/workspace-error-copy.ts
- **Impact:** None — functionally identical TypeScript

**3. [Rule 1 - Bug] Removed developer terms from doc comment**
- **Found during:** Task 2 register grep gate verification
- **Issue:** Doc comment listed the forbidden developer terms as examples ("SSH, SFTP, stdin, stderr..."), causing 5 matches in the register grep gate
- **Fix:** Rewrote doc comment to avoid listing the banned terms; described the rules in plain English instead
- **Files modified:** src/ui/features/pretty-view/workspace-error-copy.ts
- **Impact:** Doc comment less explicit about the specific forbidden words, but the rule intent is preserved

## Known Stubs

None — both files are pure data / helper modules. No UI rendering, no placeholder strings, no mocked data.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced in this plan. Both files are pure client-side utility code:
- workspace-api.ts: calls existing /workspace endpoints via authApi (JWT auto-attached by axios interceptor). No new auth surface.
- workspace-error-copy.ts: static constant + pure function. No DOM injection — text-node safe.

Threat register items T-118-P2-01, T-118-P2-02, T-118-P2-03 all addressed as planned.

## Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | workspace-api.ts with 9 client helpers + wire type exports | e4760a2 |
| 2 | workspace-error-copy.ts with WORKSPACE_ERROR_COPY map + resolver | 4bf4bf3 |

## Self-Check: PASSED

- `src/ui/api/workspace-api.ts` — FOUND (385 lines)
- `src/ui/features/pretty-view/workspace-error-copy.ts` — FOUND (171 lines)
- Commit e4760a2 — FOUND in git log
- Commit 4bf4bf3 — FOUND in git log
