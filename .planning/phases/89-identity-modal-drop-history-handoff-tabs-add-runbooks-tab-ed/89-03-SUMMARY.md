---
phase: 89-identity-modal-drop-history-handoff-tabs-add-runbooks-tab-ed
plan: "03"
subsystem: frontend-runbooks-api
tags: [frontend, api-client, runbooks, role-scoped, typed-errors]
dependency_graph:
  requires: [89-02]
  provides: [runbooks-api-client]
  affects: []
tech_stack:
  added: []
  patterns:
    - authApi + handleApiError pattern (mirroring skills-api.ts byte-shape)
    - Typed 409 error classes (runtime-decoupled duplicate from skills-api)
    - DELETE-with-body axios pattern (data field for DELETE /file and /runbook)
key_files:
  created:
    - src/ui/api/runbooks-api.ts
  modified: []
decisions:
  - RunbookFileMtimeConflictError and RunbookFileAlreadyExistsError are intentionally duplicated from skills-api.ts rather than imported — runtime-decoupled per D-01 clone-first posture (fifth intentional instance in the codebase)
  - roleName parameter name in function signatures; wire field is `role` — matches Wave-2 backend expectation
  - No companion test file — matches skills-api.ts precedent; coverage at backend (89-02) and modal (Wave 4) levels
  - Route paths match Wave-2 /runbooks-editor/* exactly: /runbooks, /files, /read, /write, /create, /file, /runbook
metrics:
  duration: ~10 minutes
  completed: "2026-09-08"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
---

# Phase 89 Plan 03: Frontend API client for Wave-2 runbook-editor routes

Seven typed helpers plus two 409-error classes mirroring `skills-api.ts` byte-shape with `roleName` dimension added, hitting the seven `/runbooks-editor/*` endpoints landed in Wave 2.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create src/ui/api/runbooks-api.ts — 7 typed helpers + 2 error classes | 7b685b91 | src/ui/api/runbooks-api.ts |

## What Was Built

### src/ui/api/runbooks-api.ts (251 lines)

Frontend API client mirroring `skills-api.ts` byte-shape with the `roleName` dimension threaded through every helper. Seven exported async functions:

- `listRunbooks(hostId, roleName)` — GET `/runbooks-editor/runbooks?hostId&role`
- `enumerateRunbookFiles(hostId, roleName, runbookName)` — GET `/runbooks-editor/files?hostId&role&runbook`
- `readRunbookFile(hostId, roleName, runbookName, path)` — POST `/runbooks-editor/read`
- `writeRunbookFile(input: RunbookFileWriteInput)` — PUT `/runbooks-editor/write` with typed 409 mtime-conflict narrow
- `createRunbookFile(hostId, roleName, runbookName, path)` — POST `/runbooks-editor/create` with typed 409 file-exists narrow
- `deleteRunbookFile(hostId, roleName, runbookName, path)` — DELETE `/runbooks-editor/file` (DELETE-with-body)
- `deleteRunbook(hostId, roleName, runbookName)` — DELETE `/runbooks-editor/runbook` (DELETE-with-body)

Two exported typed error classes:
- `RunbookFileMtimeConflictError` — thrown by writeRunbookFile on 409 `{error:"mtime mismatch"}` — carries `currentMtime` + `currentContent` for the Wave-4 modal's reload-and-retry UX
- `RunbookFileAlreadyExistsError` — thrown by createRunbookFile on 409 `{error:"file exists"}` — triggers prompt-error UX at Wave-4 modal

Five exported types: `RunbookEntry`, `RunbookFileEntry`, `RunbookFileReadResult`, `RunbookFileWriteInput`, `RunbookFileWriteResult`.

All 409 narrow checks are exact-shape matches (checking both `.status === 409` AND the specific `.data.error` string) so future backend 409 semantics do not misfire as the wrong modal UX.

## Deviations from Plan

None. Plan executed exactly as written.

The acceptance criteria verify script noted expected counts of `= "1"` for `/runbooks-editor/file` and `/runbooks-editor/runbook` grep patterns, but because `/runbooks-editor/files` is a superset of `/runbooks-editor/file` (substring match), the actual counts are 2. The plan's stated intent for these checks was to confirm the delete endpoints use `/file` and `/runbook` singular (not `/files`/`/runbooks`) — this is confirmed. The full verify script passes because these two checks use `>= 1` semantics in the actual shell assertions block. All other grep checks are exact as specified.

## Known Stubs

None. This is a pure API client module with no UI state or rendering.

## Threat Flags

None. No new network endpoints introduced — this module calls existing Wave-2 routes. The 409-narrow shape checks (T-89-03-01, T-89-03-02 mitigations) are in place.

## Self-Check: PASSED

- `src/ui/api/runbooks-api.ts` exists: FOUND
- Commit `7b685b91` exists: FOUND
- All 17 grep acceptance criteria: PASSED
- `npx tsc --noEmit`: clean (no new errors)
