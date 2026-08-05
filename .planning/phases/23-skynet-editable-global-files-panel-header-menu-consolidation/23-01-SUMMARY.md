---
phase: 23-skynet-editable-global-files-panel-header-menu-consolidation
plan: 01
subsystem: backend
tags: [backend, config-loader, http-route, nginx, gefm]
dependency_graph:
  requires: []
  provides: [GEFM-02-schema, GEFM-03-endpoint, global-files-nginx-location]
  affects: [database.ts, docker/nginx.conf, docker/nginx-https.conf]
tech_stack:
  added: []
  patterns: [express-router-local-only, config-file-loader-enoent-safe, dual-nginx-mirror]
key_files:
  created:
    - src/backend/database/routes/global-files-config-loader.ts
    - src/backend/database/routes/global-files.ts
  modified:
    - src/backend/database/database.ts
    - docker/nginx.conf
    - docker/nginx-https.conf
decisions:
  - Host key format locked: operator JSON uses human-readable host NAMES; numeric-string id accepted as fallback; name wins if both present
  - loadGlobalFilesConfig never throws: ENOENT + parse errors + shape errors + size violations all return empty { hosts: {} }
  - 256KB file size cap added as defense against oversized/malicious config
  - sshLogger.error called with (string, object) signature to match existing route conventions
metrics:
  duration: "~25 minutes"
  completed: 2026-08-05
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 3
---

# Phase 23 Plan 01: Global-files config-loader + GET /global-files route Summary

**One-liner:** ENOENT-safe JSON config-loader (GEFM-02) + LOCAL-only Express GET route (GEFM-03) with dual nginx mirrors for `/global-files`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add the config-loader helper (GEFM-02 schema) | `958e8fc` | `global-files-config-loader.ts` (created) |
| 2 | Add GET /global-files route + wire + dual nginx blocks | `9e1022c` | `global-files.ts` (created), `database.ts`, `nginx.conf`, `nginx-https.conf` |

## What Was Built

### Task 1 — Config-loader helper (`global-files-config-loader.ts`)

Pure I/O module (zero Express, zero SSH imports) exporting:
- `GlobalFileEntry` type: `{ path: string; label?: string }`
- `GlobalFilesConfig` type: `{ hosts: Record<string, GlobalFileEntry[]> }`
- `GLOBAL_FILES_CONFIG_FILENAME` constant: `"global-files.json"`
- `getGlobalFilesConfigPath(dataDir?)` — mirrors `process.env.DATA_DIR || "./db/data"` from `database.ts` L84
- `loadGlobalFilesConfig(dataDir?)` — reads config, returns `{ hosts: {} }` on ENOENT/parse error/unexpected shape/size violation (never throws)
- `getFilesForHost(config, { id, name })` — name-first lookup, numeric-string id fallback, name wins if both present; drops entries missing `path` with log line

### Task 2 — GET /global-files route + wiring + nginx

- `global-files.ts`: Express router mirroring `roles-list-for-host.ts` shape but LOCAL-only (no SSH). `authenticateJWT` gates all requests. `resolveHostById(hostId, userId)` enforces per-user host isolation (returns 404 for unknown/cross-user hosts). Returns `{ files: [] }` for missing config or unconfigured host.
- `database.ts` L26 + L1830: added import and `app.use("/global-files", globalFilesListRoutes)` adjacent to `/roles` mounts, before `/identities`.
- `docker/nginx.conf` L297: `location ~ ^/global-files(/.*)?$` block with `proxy_pass http://127.0.0.1:30001`, `proxy_read_timeout 15s`, `client_max_body_size 4M` — method-agnostic to cover wave-2 POST/PUT too.
- `docker/nginx-https.conf` L314: identical block (CLAUDE.md fleet caveat satisfied — both files updated).

## Verification Results

- `tsc --noEmit`: exits 0 (no new type errors)
- `npm run build`: exits 0 (✓ built in ~4.5s, no error TS lines)
- `npx vitest run`: 1404 tests passed | 12 skipped | 0 failures (no regressions)
- All acceptance criteria grep assertions: PASS

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] sshLogger.error() signature mismatch**
- **Found during:** Task 2, `npm run build` (backend tsconfig catches this; `npx tsc --noEmit` uses frontend tsconfig and missed it)
- **Issue:** `sshLogger.error({ ... })` was called with an object as the first argument, but the logger's first parameter type requires a `string`. The existing codebase pattern is `sshLogger.error("message string", { ... })`.
- **Fix:** Changed all `sshLogger.error({ ... })` calls in both new files to `sshLogger.error("descriptive message", { ... })` matching the existing convention from `roles-list-for-host.ts`.
- **Files modified:** `global-files-config-loader.ts`, `global-files.ts`
- **Lesson:** Always run `npm run build` (not just `tsc --noEmit`) for backend files — the backend tsconfig (`tsconfig.backend.json`) applies stricter or different lib types than the frontend tsconfig.

## Known Stubs

None — this plan is a pure backend foundation with no UI and no stub data. The endpoint correctly returns `{ files: [] }` when `global-files.json` doesn't exist, which is the designed empty-state for the MVP until GEFM-06 seeds the config file.

## Threat Flags

None — no new auth surface introduced. The `/global-files` route uses the existing `authenticateJWT` + `resolveHostById` pattern identical to `/roles`. The nginx location blocks are additive proxies on an already-secured port.

## Self-Check: PASSED

- `src/backend/database/routes/global-files-config-loader.ts` — FOUND
- `src/backend/database/routes/global-files.ts` — FOUND
- Commit `958e8fc` — FOUND in `git log`
- Commit `9e1022c` — FOUND in `git log`
- Dual nginx blocks: FOUND in both `docker/nginx.conf:297` and `docker/nginx-https.conf:314`
- `database.ts` mount: FOUND at L26 (import) + L1830 (`app.use`)
