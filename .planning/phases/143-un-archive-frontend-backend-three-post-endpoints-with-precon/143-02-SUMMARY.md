---
phase: 143-un-archive-frontend-backend-three-post-endpoints-with-precon
plan: "02"
subsystem: backend/claude-session
tags: [archived-listing, roles, apps, d-06, phase-143]
dependency_graph:
  requires:
    - 143-01 (getLocalArchivedRolesRoot + getLocalArchivedAppsRoot from per-role-archive-file.ts + per-app-archive-file.ts)
  provides:
    - listArchivedRolesOnHost (for 143-03 GET /archived-roles route)
    - listArchivedAppsOnHost (for 143-03 GET /archived-apps route)
  affects: []
tech_stack:
  added: []
  patterns:
    - "LOCAL/REMOTE branch split mirroring listArchivedIdentityKeysOnHost"
    - "Promise.race with 15s REMOTE_LIST_TIMEOUT_MS cap"
    - "ENOENT graceful degrade returning []"
    - "Canonical regex filter before returning (T-143-02-02 info-disclosure mitigate)"
key_files:
  created:
    - src/backend/claude-session/list-archived-roles.ts
    - src/backend/claude-session/list-archived-roles.test.ts
    - src/backend/claude-session/list-archived-apps.ts
    - src/backend/claude-session/list-archived-apps.test.ts
  modified: []
decisions:
  - "Import getLocalArchivedRolesRoot/getLocalArchivedAppsRoot from plan 143-01 (not redefined) to guarantee archive paths are consistent between writer and lister"
  - "APP_SLUG_RE sourced from identity-artifact-reader.js (the canonical app-slug validator used by all app-scoped surfaces)"
  - "ROLE_NAME_PATTERN sourced from ../utils/role-name-pattern.js (Phase 90 Plan 90-10 single-source-of-truth consolidation)"
metrics:
  duration: "~5 minutes"
  completed: "2026-09-30"
  tasks_completed: 2
  files_created: 4
---

# Phase 143 Plan 02: list-archived-roles + list-archived-apps Primitives Summary

Added two new listing primitives (`listArchivedRolesOnHost` and `listArchivedAppsOnHost`) as structural byte-for-byte siblings of `listArchivedIdentityKeysOnHost`, each importing its archive-root helper from plan 143-01 rather than redefining it.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | list-archived-roles.ts + test | 2366767d | list-archived-roles.ts, list-archived-roles.test.ts |
| 2 | list-archived-apps.ts + test | 19f02d81 | list-archived-apps.ts, list-archived-apps.test.ts |

## What Was Built

### `src/backend/claude-session/list-archived-roles.ts`

Exports `listArchivedRolesOnHost(conn: SSHClientType | null): Promise<string[]>`.

- LOCAL branch: reads `getLocalArchivedRolesRoot()` (imported from `per-role-archive-file.ts`) via `fs.readdir({ withFileTypes: true })`, filters `isDirectory() && ROLE_NAME_PATTERN.test(name)`, ENOENT → `[]`
- REMOTE branch: `find "$HOME/fleet/roles-archive" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null || true` via `Promise.race` with 15s timeout, same pipeline

### `src/backend/claude-session/list-archived-apps.ts`

Exports `listArchivedAppsOnHost(conn: SSHClientType | null): Promise<string[]>`.

- LOCAL branch: reads `getLocalArchivedAppsRoot()` (imported from `per-app-archive-file.ts`) via `fs.readdir({ withFileTypes: true })`, filters `isDirectory() && APP_SLUG_RE.test(name)`, ENOENT → `[]`
- REMOTE branch: `find "$HOME/fleet/apps-archive" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null || true` via `Promise.race` with 15s timeout

### Tests (6 total, 3 per primitive)

Each test file covers:
1. LOCAL happy path — sorted, regex-filtered directory names (rogue non-conforming name dropped)
2. LOCAL missing dir — ENOENT graceful degrade returns `[]`
3. LOCAL non-directory filter — isDirectory gate drops files

All 6 tests green. `npm run build:backend` exits 0.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, or trust-boundary schema changes introduced. Both files are pure filesystem enumeration primitives with static find commands (no user input interpolation). Threat mitigations T-143-02-01, T-143-02-02, T-143-02-03 are all present:

- T-143-02-01: REMOTE find command is a static literal — `$HOME` expanded by remote shell, no runtime interpolation
- T-143-02-02: `ROLE_NAME_PATTERN` / `APP_SLUG_RE` filter applied before returning — non-conforming directory names (dots, unicode, uppercase, underscores) dropped
- T-143-02-03: `Promise.race` with 15s `REMOTE_LIST_TIMEOUT_MS` cap in both modules

## Self-Check: PASSED

- [x] `src/backend/claude-session/list-archived-roles.ts` exists
- [x] `src/backend/claude-session/list-archived-roles.test.ts` exists
- [x] `src/backend/claude-session/list-archived-apps.ts` exists
- [x] `src/backend/claude-session/list-archived-apps.test.ts` exists
- [x] Commit 2366767d exists (Task 1)
- [x] Commit 19f02d81 exists (Task 2)
- [x] `npm run build:backend` exits 0
- [x] All 6 tests green
