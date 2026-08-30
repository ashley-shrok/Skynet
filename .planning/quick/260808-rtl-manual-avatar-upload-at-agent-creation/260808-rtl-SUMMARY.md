---
phase: quick-260808-rtl
plan: 01
subsystem: identity-avatar
tags: [avatar, upload, birth, clone, multipart, multer, object-url]
dependency_graph:
  requires: []
  provides: [manual-avatar-candidate-endpoint, manual-avatar-ui-newdialog, manual-avatar-ui-clonedialog]
  affects: [identity-birth-flow, identity-clone-flow]
tech_stack:
  added: [multer-memory-upload-manual-route]
  patterns: [authenticateJWT-before-multer, object-url-via-ref-cleanup, mutual-exclusion-state]
key_files:
  created: []
  modified:
    - src/backend/database/routes/identity-avatar-batch.ts
    - src/backend/database/routes/identity-avatar-batch.test.ts
    - src/ui/api/identities-api.ts
    - src/ui/sidebar/NewSessionDialog.tsx
    - src/ui/sidebar/NewSessionDialog.test.tsx
    - src/ui/sidebar/CloneAgentDialog.tsx
    - src/ui/sidebar/CloneAgentDialog.test.tsx
decisions:
  - "Reuse existing candidateCache + evictIfNeeded in identity-avatar-batch.ts (no parallel store)"
  - "authenticateJWT wired BEFORE multer so 401 fires before body parse (T-16-04 pattern)"
  - "5 MB size cap per locked spec (neither /batch nor /identities has a manual equivalent)"
  - "LIMIT_UNEXPECTED_FILE mapped to 400 'missing avatar field' so wrong field name and absent field both return 400"
  - "manualUrlRef (useRef) used for unmount cleanup to avoid stale-closure issues"
  - "avatarReady predicate in canOpen covers both generated-pick and manual-pick paths"
metrics:
  duration: "~15 minutes"
  completed: "2026-08-08"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 7
---

# Quick 260808-RTL: Manual Avatar Upload at Agent Creation — Summary

**One-liner:** POST /identities/avatar/candidate/manual endpoint backed by the existing candidateCache, with Upload… button + mutual-exclusion state in both NewSessionDialog and CloneAgentDialog.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Backend: POST /candidate/manual + tests | 0a60a17 | identity-avatar-batch.ts, identity-avatar-batch.test.ts |
| 2 | Frontend: Upload… button + api client + tests | efb2ab2 | identities-api.ts, NewSessionDialog.tsx, NewSessionDialog.test.tsx, CloneAgentDialog.tsx, CloneAgentDialog.test.tsx |
| 3 | Full-suite verification | — | 133 files, 1664 tests passed, 0 failures |

## What Was Built

### Backend (Task 1)
- `POST /identities/avatar/candidate/manual` added to `identity-avatar-batch.ts`
- Uses multer memory-storage with `limits.fileSize: 5 * 1024 * 1024`
- `fileFilter` accepts only `image/png`, `image/jpeg`, `image/webp`
- Middleware order: `authenticateJWT` → `manualUpload.single("avatar")` → handler (T-QUICK-04)
- Handler writes to the existing `candidateCache` via `evictIfNeeded` + `candidateCache.set` (same shape as /batch)
- Returns `{ id: string }` (not the full `{id, url}` batch shape — callers only need the id)
- Express error handler on the route converts: `LIMIT_FILE_SIZE` → 413, `LIMIT_UNEXPECTED_FILE` → 400, mime rejection → 400, else → 500
- 5 new backend tests: happy, auth, mime, oversize, missing-field — all pass

### Frontend (Task 2)
- `postManualAvatarCandidate({file}: {file: File}): Promise<{id: string}>` exported from `identities-api.ts`
- Builds `FormData` with `avatar` field, POSTs via `authApi.post` (no manual Content-Type header)
- **NewSessionDialog**: Upload… button adjacent to Generate/Regenerate; hidden `<input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only">`; manual preview tile with `aria-selected="true" data-manual-avatar="true"` shown when `candidates.length === 0 && manualPreviewUrl`
- **CloneAgentDialog**: same Upload… button; manual preview WINS over source avatar preview when set
- **Mutual exclusion**: Generate clears `manualPreviewUrl` + revokes object URL; Upload clears `candidates`
- **Object URL cleanup**: `manualUrlRef` (useRef) synced via `useEffect([manualPreviewUrl])`; revoked in on-close effect, on-unmount effect, and in `handleGenerate`
- **`canOpen`/`canSubmit`**: `avatarReady` predicate covers both generated + manual pick paths
- `identity-birth.ts` and `identity-clone.ts` are UNCHANGED — manual id flows through as `avatarCandidateId` verbatim
- 5 new frontend tests (RTL-01/02/03 in NewSessionDialog, RTL-C1/C2 in CloneAgentDialog)

## Verification

- `npx vitest run src/backend/database/routes/identity-avatar-batch.test.ts` → 18 tests passed
- `npx vitest run src/ui/sidebar/NewSessionDialog.test.tsx src/ui/sidebar/CloneAgentDialog.test.tsx` → 59 tests passed
- `npx vitest run` → 133 test files, 1664 tests passed, 6 skipped (pre-existing), 0 failures
- `npm run build:backend` → clean, no TS errors
- `npx tsc --noEmit` → clean, no frontend TS errors
- `git diff HEAD~2 -- docker/nginx.conf docker/nginx-https.conf src/backend/database/routes/identity-birth.ts src/backend/database/routes/identity-clone.ts` → empty (no changes to those files)

## Deviations from Plan

**1. [Rule 1 - Bug] LIMIT_UNEXPECTED_FILE mapped to 400**
- **Found during:** Task 1 test execution (missing-field test returned 500 instead of 400)
- **Issue:** When multer receives a field named `wrong_field` instead of `avatar`, it throws `LIMIT_UNEXPECTED_FILE` (not a req.file-absent case). The error handler didn't handle this code.
- **Fix:** Added `err?.code === "LIMIT_UNEXPECTED_FILE"` branch in the error handler, returning 400 `{error: "missing avatar field"}`
- **Files modified:** `src/backend/database/routes/identity-avatar-batch.ts`
- **Commit:** 0a60a17

**2. [Rule 1 - Bug] RTL-02 test needed name/title/brief filled**
- **Found during:** Task 2 test execution (test clicked Generate but button was disabled)
- **Issue:** The Generate button requires `!name || !title.trim() || !brief.trim()` to be false. The test clicked it without filling those fields first.
- **Fix:** Added `fireEvent.change` for name/title/brief before clicking Generate in RTL-02.
- **Files modified:** `src/ui/sidebar/NewSessionDialog.test.tsx`
- **Commit:** efb2ab2

## Known Stubs

None. All data flows are live (manual upload → POST → id → pickedCandidateId → birth/clone).

## Threat Flags

All threat mitigations verified as implemented:
- T-QUICK-01: `limits.fileSize: 5 * 1024 * 1024` — tested (413 on 6 MB)
- T-QUICK-02: `fileFilter` restricts to PNG/JPEG/WebP — tested (400 on text/plain)
- T-QUICK-03: userId scope guard in existing GET /candidate/:id — unchanged
- T-QUICK-04: `authenticateJWT` before `multer` — tested (401 before parse, no cache entry)
- T-QUICK-05: `evictIfNeeded` called before every `candidateCache.set` — verified in implementation

## Self-Check: PASSED

Files exist:
- src/backend/database/routes/identity-avatar-batch.ts: FOUND
- src/ui/api/identities-api.ts: FOUND
- src/ui/sidebar/NewSessionDialog.tsx: FOUND
- src/ui/sidebar/CloneAgentDialog.tsx: FOUND

Commits exist:
- 0a60a17: FOUND
- efb2ab2: FOUND
