---
phase: 143-un-archive-frontend-backend-three-post-endpoints-with-precon
plan: "04"
subsystem: backend/database/routes
tags: [un-archive, express, rest-api, identity, role, app, preconditions]
dependency_graph:
  requires: [143-01, 143-03]
  provides: [POST /identities/:key/unarchive, POST /roles/:name/unarchive, POST /apps/:hostId/:slug/unarchive]
  affects: [database.ts, frontend API clients (143-05)]
tech_stack:
  added: []
  patterns:
    - express.Router per-route isolation with LOCAL/REMOTE SSH branch
    - archive-tree writers from plan 143-01 (writeIdentityArchiveFile, writeRoleArchiveFile, writeAppArchiveFile)
    - Python inline role frontmatter parser (stdlib only, no PyYAML) via execFileAsync wrapper
    - structured 409 { reason, missingRoles? } precondition failure shape
key_files:
  created:
    - src/backend/database/routes/identity-unarchive.ts
    - src/backend/database/routes/identity-unarchive.test.ts
    - src/backend/database/routes/role-unarchive.ts
    - src/backend/database/routes/role-unarchive.test.ts
    - src/backend/database/routes/apps-unarchive.ts
    - src/backend/database/routes/apps-unarchive.test.ts
  modified:
    - src/backend/database/database.ts
decisions:
  - Python inline stored as string-array `.join("\n")` (not template literal) to avoid backtick conflict with TypeScript template literal syntax
  - Explicit Promise wrapper for execFile (not util.promisify) to guarantee { stdout, stderr } destructuring
  - vi.hoisted() for all mock variables used in vi.mock() factories (required by Vitest hoisting)
  - Non-overlapping fake paths (/tmp/test-*-archive vs /tmp/test-*-live) for startsWith() mock dispatch
metrics:
  duration: "~2 hours (across context window boundary)"
  completed: "2026-09-30"
  tasks: 3
  files: 7
---

# Phase 143 Plan 04: Three POST Un-archive Routes with Preconditions Summary

Three POST un-archive endpoints using `writeIdentityArchiveFile`/`writeRoleArchiveFile`/`writeAppArchiveFile` (plan 143-01 primitives), each with archive-exists + name-collision preconditions (identity adds all-roles-live), structured 409 failure shape, and LOCAL/REMOTE SSH branch.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | POST /identities/:key/unarchive | `5e8dbffb` | identity-unarchive.ts, identity-unarchive.test.ts, database.ts |
| 2 | POST /roles/:name/unarchive | `ce2add6e` | role-unarchive.ts, role-unarchive.test.ts, database.ts |
| 3 | POST /apps/:hostId/:slug/unarchive | `be19b638` | apps-unarchive.ts, apps-unarchive.test.ts, database.ts |

## What Was Built

**Task 1 — POST /identities/:key/unarchive**

Three preconditions before sentinel drop:
1. archive-exists: `fs.access(getLocalArchivedIdentitiesRoot() / key)` LOCAL, `test -d $HOME/fleet/identities-archive/<key>` REMOTE.
2. name-collision: `fs.access(getLocalIdentitiesRoot() / key)` LOCAL, `test -d $HOME/fleet/identities/<key>` REMOTE.
3. all-roles-live: parse `role:` YAML frontmatter from archived identity's `identity.md` using the same Python inline as the agent-supervisor scanner (scalar, flow-list, block-list shapes); for each listed role, check `~/fleet/roles-archive/<role>/` exists; collect missing → 409 `{ reason: "missing_roles", missingRoles: string[] }`.

The Python inline is stored as a string array joined with `\n` to avoid the backtick conflict that would terminate a TypeScript template literal. `execFile` is wrapped in an explicit Promise (not `util.promisify`) to guarantee `{ stdout, stderr }` destructuring.

Route: `POST /:key/unarchive`, body `{ hostId: number }`, IDENTITY_KEY_RE gate, resolveHostById ownership check, `writeIdentityArchiveFile(key, ".unarchive-requested", "", { hostId, conn })`.

**Task 2 — POST /roles/:name/unarchive**

Two preconditions (no all-roles-live check). Route: `POST /:name/unarchive`, body `{ hostId: number }`, ROLE_NAME_PATTERN gate, `writeRoleArchiveFile(name, ".unarchive-requested", "", { hostId, conn })`. The string `"missing_roles"` is intentionally absent from this file (per grep acceptance criterion for role-unarchive).

**Task 3 — POST /apps/:hostId/:slug/unarchive**

Two preconditions. hostId is in PATH (apps-domain convention, not body) per compound key `(hostId, slug)`. Route: `POST /:hostId/:slug/unarchive`, APP_SLUG_RE gate, `writeAppArchiveFile(slug, ".unarchive-requested", "", { hostId, conn })`.

**database.ts mounts:**
- `app.use("/apps", appsUnarchiveRoutes)` immediately after `app.use("/apps", appsArchiveRoutes)` (L2204)
- `app.use("/roles", roleUnarchiveRoutes)` immediately after `app.use("/roles", roleArchiveRoutes)`
- `app.use("/identities", identityUnarchiveRoutes)` immediately after `app.use("/identities", identityArchiveRoutes)`

## Test Results

- `identity-unarchive.test.ts` — 10/10 pass
- `role-unarchive.test.ts` — 8/8 pass
- `apps-unarchive.test.ts` — 8/8 pass
- Combined: 26/26 pass

Coverage: happy LOCAL path, archive_not_found, name_collision, missing_roles (identity: one role + both roles sorted), idempotent sentinel, 401 auth, 400 hostId validation, 400 name/slug validation, 504 REMOTE connect failure.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Python inline stored as string array to avoid backtick conflict**
- **Found during:** Task 1 implementation
- **Issue:** TypeScript template literal (backticks) terminated prematurely when Python inline comments contained backtick characters from the agent-supervisor.sh source.
- **Fix:** Stored the Python script as an array of string literals joined with `\n` — semantically identical but avoids the conflict entirely.
- **Files modified:** src/backend/database/routes/identity-unarchive.ts

**2. [Rule 1 - Bug] Explicit Promise wrapper for execFile instead of util.promisify**
- **Found during:** Task 1 implementation
- **Issue:** `util.promisify(execFile)` without `util.promisify.custom` resolves with the first callback argument (stdout string), not `{ stdout, stderr }`, making destructuring return `undefined`.
- **Fix:** Replaced `promisify(execFile)` with an explicit `execFileAsync` function wrapping `execFile` in a Promise and destructuring `(err, stdout, stderr)`.
- **Files modified:** src/backend/database/routes/identity-unarchive.ts

**3. [Rule 3 - Blocking] vi.hoisted() required for mock variables in vi.mock() factories**
- **Found during:** Task 1 testing
- **Issue:** `const mockFsAccess = vi.fn()` before `vi.mock()` threw `ReferenceError: Cannot access 'mockFsAccess' before initialization` because Vitest hoists `vi.mock()` calls above module-scope variable declarations.
- **Fix:** Wrapped all mock `vi.fn()` instances in `vi.hoisted(() => ({ ... }))` so they are initialized before the mock factories execute.
- **Files modified:** identity-unarchive.test.ts, role-unarchive.test.ts, apps-unarchive.test.ts

**4. [Rule 1 - Bug] Non-overlapping fake paths for startsWith() mock dispatch**
- **Found during:** Task 1 testing
- **Issue:** `FAKE_LIVE_ROOT = "/fake/identities"` is a prefix of `FAKE_ARCHIVE_ROOT = "/fake/identities-archive"`. The `startsWith(FAKE_LIVE_ROOT)` check matched archive paths, causing mock to reject archive access, returning `archive_not_found` on the happy path.
- **Fix:** Changed to `/tmp/test-identities-archive`, `/tmp/test-identities-live`, `/tmp/test-roles-archive` (strictly non-overlapping prefixes).
- **Files modified:** identity-unarchive.test.ts

**5. [Rule 1 - Bug] vi.restoreAllMocks() in global afterEach clears mock implementations**
- **Found during:** Task 1 testing
- **Issue:** Global `vitest.setup.ts` runs `vi.restoreAllMocks()` in `afterEach`, which resets all tracked `vi.fn()` instances. Mock implementations set in `beforeEach` were cleared after the first test.
- **Fix:** Added `mockFsAccess.mockReset()` / `mockExecFile.mockReset()` at the start of each `beforeEach` followed by `mockImplementation(...)` calls to re-establish defaults on every test.
- **Files modified:** identity-unarchive.test.ts, role-unarchive.test.ts, apps-unarchive.test.ts

## Known Stubs

None — all three routes are fully wired with real archive-tree writers, real precondition checks, and real SSH execution paths.

## Threat Flags

No new network endpoints or auth paths beyond the three POST routes specified in the plan's threat register (T-143-04-01 through T-143-04-07). All mitigations applied.

## Self-Check: PASSED

- src/backend/database/routes/identity-unarchive.ts — exists
- src/backend/database/routes/identity-unarchive.test.ts — exists
- src/backend/database/routes/role-unarchive.ts — exists
- src/backend/database/routes/role-unarchive.test.ts — exists
- src/backend/database/routes/apps-unarchive.ts — exists
- src/backend/database/routes/apps-unarchive.test.ts — exists
- Commit 5e8dbffb — Task 1 (identity-unarchive)
- Commit ce2add6e — Task 2 (role-unarchive)
- Commit be19b638 — Task 3 (apps-unarchive)
- npm run build:backend — exits 0
- 26/26 tests pass
