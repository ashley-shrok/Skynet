---
phase: 143-un-archive-frontend-backend-three-post-endpoints-with-precon
plan: "01"
subsystem: backend/claude-session
tags: [archive, un-archive, sentinel, file-primitives, D-08]

dependency_graph:
  requires: []
  provides:
    - writeIdentityArchiveFile (src/backend/claude-session/per-identity-archive-file.ts)
    - writeRoleArchiveFile (src/backend/claude-session/per-role-archive-file.ts)
    - writeAppArchiveFile (src/backend/claude-session/per-app-archive-file.ts)
    - getLocalArchivedRolesRoot (per-role-archive-file.ts — for plan 143-02)
    - getLocalArchivedAppsRoot (per-app-archive-file.ts — for plan 143-02)
    - ALLOWED_IDENTITY_ARCHIVE_REL_PATHS (locked to ".unarchive-requested")
    - ALLOWED_ROLE_ARCHIVE_REL_PATHS (locked to ".unarchive-requested")
    - ALLOWED_APP_ARCHIVE_REL_PATHS (locked to ".unarchive-requested")
  affects:
    - plan 143-04 (POST un-archive endpoints call these three primitives)
    - plan 143-02 (getLocalArchivedRolesRoot + getLocalArchivedAppsRoot reused)

tech_stack:
  added: []
  patterns:
    - archive-tree sibling writer pattern (separate module per domain, not boolean flag on live-tree writers)
    - tmp+rename atomicity for LOCAL branch (node:fs/promises)
    - writeMarkdownFileAtomic for REMOTE branch (ext_openssh_rename via SFTP)
    - IDENTITIES_ARCHIVE_HOST_DIR / ROLES_ARCHIVE_HOST_DIR / APPS_ARCHIVE_HOST_DIR env overrides for test isolation
    - vi.hoisted() env setup before module graph evaluation (vitest pattern)

key_files:
  created:
    - src/backend/claude-session/per-identity-archive-file.ts
    - src/backend/claude-session/per-identity-archive-file.test.ts
    - src/backend/claude-session/per-role-archive-file.ts
    - src/backend/claude-session/per-role-archive-file.test.ts
    - src/backend/claude-session/per-app-archive-file.ts
    - src/backend/claude-session/per-app-archive-file.test.ts
  modified: []

decisions:
  - "Three sibling archive-tree writer modules per D-08 — not boolean flags on existing live-tree writers. Whitelists differ (live tree has 1-3 entries per domain; archive tree has exactly 1 entry: .unarchive-requested)."
  - "getLocalArchivedRolesRoot and getLocalArchivedAppsRoot are exported from the archive-tree writers (not defined in a separate list-archived-*.ts) because those listing modules don't exist yet (plan 143-02 creates them). This is the same pattern used by getLocalArchivedIdentitiesRoot in list-archived-identity-keys.ts."
  - "Tests use real tmpdir (mkdtemp) + env override for LOCAL happy-path test rather than mocking node:fs/promises. This matches the per-role-file.test.ts precedent and gives higher confidence in the tmp+rename sequencing."

metrics:
  duration: "~12 minutes"
  completed: "2026-09-30"
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
  files_modified: 0
---

# Phase 143 Plan 01: Backend archive-tree writer primitives (D-08) Summary

Three archive-tree sibling writer primitives for identity, role, and app domains — each with a whitelist locked to exactly `".unarchive-requested"` per D-08.

## What Was Built

Three new writer modules at `src/backend/claude-session/per-{identity,role,app}-archive-file.ts`, each implementing the same contract:

- **Identity:** `writeIdentityArchiveFile(name, relPath, contents, opts)` — targets `~/fleet/identities-archive/<name>/<relPath>`. Imports `getLocalArchivedIdentitiesRoot` from `list-archived-identity-keys.ts` (not redefined).
- **Role:** `writeRoleArchiveFile(name, relPath, contents, opts)` — targets `~/fleet/roles-archive/<name>/<relPath>`. Exports `getLocalArchivedRolesRoot()` for plan 143-02 reuse.
- **App:** `writeAppArchiveFile(slug, relPath, contents, opts)` — targets `~/fleet/apps-archive/<slug>/<relPath>`. Exports `getLocalArchivedAppsRoot()` for plan 143-02 reuse.

All three:
- Enforce domain-regex gate (IDENTITY_KEY_RE / ROLE_NAME_PATTERN / APP_SLUG_RE) BEFORE any I/O
- Enforce `ALLOWED_*_ARCHIVE_REL_PATHS = Set([".unarchive-requested"])` whitelist BEFORE any I/O
- LOCAL branch: tmp+rename via `node:fs/promises`
- REMOTE branch: delegates to `writeMarkdownFileAtomic` (ext_openssh_rename via SFTP); throws `"conn required for remote host"` on null conn
- No `chmod` field on opts (sentinels carry no credentials)
- No parent-mkdir (archive folder must already exist — reconciler moved it there)

## Tests

Nine tests total (3 per module), all green:

| Module | Test 1 | Test 2 | Test 3 |
|--------|--------|--------|--------|
| per-identity-archive-file | LOCAL happy path via IDENTITIES_ARCHIVE_HOST_DIR | `.pinned` relPath rejected | `../etc/passwd` key rejected |
| per-role-archive-file | LOCAL happy path via ROLES_ARCHIVE_HOST_DIR | `.archive-requested` relPath rejected | `../etc/passwd` name rejected |
| per-app-archive-file | LOCAL happy path via APPS_ARCHIVE_HOST_DIR | `.archive-requested` relPath rejected | `../etc/passwd` slug rejected |

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|-----------|
| T-143-01-01 | `ALLOWED_*_ARCHIVE_REL_PATHS.has(relPath)` fires before I/O in all three primitives |
| T-143-01-02 | `IDENTITY_KEY_RE.test(name)` fires before I/O in per-identity-archive-file.ts |
| T-143-01-03 | `ROLE_NAME_PATTERN.test(name)` fires before I/O in per-role-archive-file.ts |
| T-143-01-04 | `APP_SLUG_RE.test(slug)` fires before I/O in per-app-archive-file.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed `chmod` keyword from per-identity-archive-file.ts header comment**

- **Found during:** Post-Task-1 acceptance criteria check
- **Issue:** Acceptance criterion requires `grep -c 'chmod' per-identity-archive-file.ts == 0`, but the "No chmod:" header section contained the word twice in comments. No functional `chmod` was ever present (opts type has no chmod field).
- **Fix:** Replaced comment section wording to avoid the keyword while preserving the same documentation intent.
- **Files modified:** `src/backend/claude-session/per-identity-archive-file.ts`
- **Commit:** f5fb7c2f

## Commits

| Hash | Message |
|------|---------|
| dc921d26 | feat(143-01): add writeIdentityArchiveFile primitive + test (D-08) |
| 69c4a4ea | feat(143-01): add writeRoleArchiveFile primitive + test (D-08) |
| 3a5c36d3 | feat(143-01): add writeAppArchiveFile primitive + test (D-08) |
| f5fb7c2f | fix(143-01): remove chmod comment from per-identity-archive-file.ts header |

## Known Stubs

None. All three primitives are fully wired: the whitelist is locked, the gate throws on violation, and the LOCAL happy-path tests exercise real disk I/O through a tmpdir fixture.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns outside the declared scope, or schema changes were introduced.

## Self-Check: PASSED

All six files confirmed present on disk. All four commits confirmed in git log. 9/9 tests green. `npm run build:backend` exits 0.
