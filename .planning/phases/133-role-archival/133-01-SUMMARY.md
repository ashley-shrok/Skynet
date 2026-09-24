---
phase: 133-role-archival
plan: 01
status: complete
subsystem: backend/http-routes+claude-session
tags: [role-archival, http-route, sentinel-write, sftp, per-role-file]
requires:
  - "identity-archive.ts (byte-for-byte structural template)"
  - "per-identity-file.ts (byte-for-byte primitive template)"
  - "ROLE_NAME_PATTERN from utils/role-name-pattern.ts"
  - "getLocalRolesRoot / writeMarkdownFileAtomic / isLocalHostId from identity-artifact-reader.ts"
provides:
  - "POST /roles/:name/archive HTTP endpoint (200 { ok: true } on success)"
  - "writeRoleFile(name, relPath, contents, opts) primitive"
  - "ALLOWED_ROLE_REL_PATHS (bounded whitelist — exactly 1 entry)"
affects:
  - "src/backend/database/database.ts (route mount)"
tech_stack:
  added: []
  patterns:
    - "sentinel-drop-then-supervisor-consume (mirrors identity-archive)"
    - "LOCAL/REMOTE branch on isLocalHostId with try/finally conn.end()"
    - "tmp+rename atomicity (LOCAL fs, REMOTE via writeMarkdownFileAtomic)"
    - "bounded whitelist for per-role writes (currently one entry)"
key_files:
  created:
    - src/backend/claude-session/per-role-file.ts
    - src/backend/claude-session/per-role-file.test.ts
    - src/backend/database/routes/role-archive.ts
    - src/backend/database/routes/role-archive.test.ts
  modified:
    - src/backend/database/database.ts
decisions:
  - "Use existing getLocalRolesRoot() helper (already env-honoring for ROLES_HOST_DIR) rather than hand-rolling process.env.ROLES_HOST_DIR ?? homedir fallback. The plan permits this — Task 1 read_first explicitly says: verify no existing helper getLocalRolesRoot exists before hand-rolling. It does exist (identity-artifact-reader.ts:288). Reusing it preserves the single source of truth for local roles root resolution across the backend."
  - "Kept writeRoleFile as a NEW module (per RESEARCH §5) rather than widening per-identity-file.ts's whitelist. H1 write⇔read parity lock on writeIdentityFile stays identity-scoped."
  - "ALLOWED_ROLE_REL_PATHS bounded to exactly one entry ('.archive-requested'). Future entries via deliberate CONTEXT-locked decision per D-01 bounded-scope discipline."
  - "No chmod support on WriteRoleFileOpts — roles don't hold credentials as a hygiene invariant, and this phase adds no chmod site."
metrics:
  duration_minutes: 15
  tasks_completed: 3
  tests_added: 22
  completed: 2026-09-24
---

# Phase 133 Plan 133-01: Backend `/roles/:name/archive` route + writeRoleFile primitive Summary

**One-liner:** `POST /roles/:name/archive` endpoint on Skynet backend drops `.archive-requested` sentinel on the role folder (D-05) via a NEW `writeRoleFile()` sibling primitive that mirrors `writeIdentityFile`'s shape but with a role-scoped bounded whitelist — no widening of the identity-scoped H1 write⇔read parity lock (per RESEARCH §5).

## What Landed

### 1. `writeRoleFile()` primitive — NEW module `per-role-file.ts`

- File: `src/backend/claude-session/per-role-file.ts` (198 lines)
- Exports: `writeRoleFile(name, relPath, contents, opts)`, `ALLOWED_ROLE_REL_PATHS`
- Structure mirrors `per-identity-file.ts` byte-for-byte at the LOCAL/REMOTE branch shape.
- Uses **existing** `getLocalRolesRoot()` helper (identity-artifact-reader.ts:288) which already honors the `ROLES_HOST_DIR` env override for the containerized-Skynet bind-mount case (Phase 117 M-K).
- REMOTE branch delegates to `writeMarkdownFileAtomic` at exactly one call site (line 197) — the one-audit-surface discipline established in per-identity-file.ts is preserved.
- `ALLOWED_ROLE_REL_PATHS` = `new Set([".archive-requested"])` — exactly one entry per D-01 bounded-scope discipline.
- No chmod support (roles don't hold credentials as a hygiene invariant per shape philosophy).
- Both gate helpers (`assertValidRoleName`, `assertValidRoleRelPath`) fire BEFORE any I/O.

### 2. `POST /roles/:name/archive` route — NEW module `role-archive.ts`

- File: `src/backend/database/routes/role-archive.ts` (192 lines)
- Exports: default Express router
- Registers exactly one route: `POST /:name/archive`
- Structure mirrors `identity-archive.ts` byte-for-byte with the substitutions:
  - `IDENTITY_KEY_RE` → `ROLE_NAME_PATTERN`
  - `writeIdentityFile` → `writeRoleFile`
  - `/:key/archive` → `/:name/archive`
  - "identity key" error strings → "role name" error strings
- Handler flow: `authenticateJWT` → hostId parse+validate → `ROLE_NAME_PATTERN.test(name)` → `resolveHostById(hostId, userId)` → LOCAL/REMOTE branch on `isLocalHostId` → `writeRoleFile` in try/finally with `conn.end()`.
- Threat model T-133-01-01..06 all mitigated at the code sites named in the plan's `<threat_model>` block.

### 3. Mount site in `database.ts`

- Import added at line 78 (adjacent to `rolesRoutes` import on line 76).
- Mount added at line 2061 (`app.use("/roles", roleArchiveRoutes)`) — BEFORE the three existing `/roles` mounts at lines 2065, 2070, 2075.
- Mount ordering verified: `roleArchiveRoutes` is the first `/roles` mount in the file. Any future generic `/:roleName` handler in `rolesRoutes` cannot shadow `/:name/archive`.

## Test Coverage — All 22 Tests Green

### `per-role-file.test.ts` — 9 tests (7 primary behaviors + 2 nested variants)

| # | Test | Result |
|---|------|--------|
| 1 | LOCAL happy path — writes empty `.archive-requested` at `<ROLES_HOST_DIR>/<name>/` via tmp+rename; tmp gone after | PASS |
| 2 | REMOTE happy path — delegates to `writeMarkdownFileAtomic` with RELATIVE `fleet/roles/<name>/<relPath>` path shape (no `$HOME/` literal); `sftp.rename` never called (ext_openssh_rename discipline) | PASS |
| 3a | Bad role name (`BadName!`) rejected before I/O; error mentions `ROLE_NAME_PATTERN.source` (`[a-z0-9-]`) | PASS |
| 3b | LOCAL bad name (`../etc/passwd`) rejected before any fs.writeFile spy call | PASS |
| 4a | Bad relPath (`malicious-file`) rejected before I/O; error mentions `.archive-requested` (allowed list) | PASS |
| 4b | Path traversal in relPath (`../etc/passwd`) rejected before any I/O | PASS |
| 5 | REMOTE with null conn throws verbatim `"conn required for remote host"` | PASS |
| 6 | `ALLOWED_ROLE_REL_PATHS` contains exactly ONE entry (`.archive-requested`); `.pinned` and `relay.json` NOT in role whitelist | PASS |
| 7 | LOCAL honors `ROLES_HOST_DIR` env override (bind-mount case) — writes at scratch dir, NOT at homedir fallback | PASS |

### `role-archive.test.ts` — 13 tests (9 primary behaviors + 4 nested variants)

| # | Test | Result |
|---|------|--------|
| 1 | Happy LOCAL → 200 `{ ok: true }`; `writeRoleFile` called with `("box-maintainer", ".archive-requested", "", { hostId: 5, conn: null })`; audit log fired with `userId=`, `hostId=`, `name=box-maintainer` | PASS |
| 2 | Happy REMOTE → 200; `connectOneShot` opened, conn passed to `writeRoleFile`, `conn.end()` called in finally | PASS |
| 3a | Bad role name (underscore `bad_name`) → 400; `writeRoleFile` NOT called | PASS |
| 3b | Bad role name (uppercase `BadName`) → 400 | PASS |
| 3c | Bad role name (`..etcpasswd`) → 400 | PASS |
| 4 | Missing hostId (body `{}`) → 400 `hostId is required`; `writeRoleFile` NOT called | PASS |
| 5a | Malformed hostId (`"not-a-number"`) → 400 `positive integer` | PASS |
| 5b | Malformed hostId (`-1`) → 400 `positive integer` | PASS |
| 5c | Malformed hostId (`3.14`) → 400 `positive integer` | PASS |
| 6 | Cross-user hostId (99) → 404 `Host not found` (NOT 403 — T-133-01-01 no-probe-info-leak) | PASS |
| 7 | REMOTE `connectOneShot` throws → 504 `Host unreachable`; `writeRoleFile` NOT called | PASS |
| 8 | `writeRoleFile` throws → 500 `{ error: "failed to drop archive sentinel" }` (T-133-01-03 no leak of `ENOSPC` / `sensitive fs path leak`); `conn.end()` still fires in finally; underlying error text captured server-side in `databaseLogger.error` | PASS |
| 9 | Unauthenticated (no JWT) → 401; no downstream calls (`resolveHostById`, `connectOneShot`, `writeRoleFile` all zero-called) | PASS |

## Verification Passes

- `./node_modules/.bin/vitest run src/backend/claude-session/per-role-file.test.ts src/backend/database/routes/role-archive.test.ts` — 22/22 tests pass.
- `./node_modules/.bin/vitest related --run src/backend/claude-session/per-role-file.ts src/backend/database/routes/role-archive.ts src/backend/database/database.ts` — 40/40 tests pass (nothing indirectly broken).
- `npm run build:backend` — exits 0 (backend TS clean).
- `npm run build` — exits 0 (frontend + backend clean; fleet rule requires both since frontend `tsc --noEmit` doesn't catch backend TS errors).
- `grep -c 'roleArchiveRoutes' src/backend/database/database.ts` returns exactly 2 (import + one mount).
- `grep -n 'app.use("/roles"' src/backend/database/database.ts` — first line in output IS the `roleArchiveRoutes` mount (2061), before all three existing `/roles` mounts (2065, 2070, 2075).
- `grep -c 'writeRoleFile' src/backend/database/routes/role-archive.ts` returns 6 (≥ 2 required).
- `grep -F '.archive-requested' src/backend/database/routes/role-archive.ts` returns 6 hits (≥ 1 required).
- `grep -c 'ROLE_NAME_PATTERN' src/backend/database/routes/role-archive.ts` returns 5 hits (≥ 2 required).
- `grep -cE '(router\.(get|delete|put|patch))' src/backend/database/routes/role-archive.ts` returns 0 — POST-only, no un-archive verb.
- `ALLOWED_ROLE_REL_PATHS` Set literal contains exactly one string entry (`.archive-requested`).

## Deviations from Plan

### [Rule 3 — Blocking-issue fix] Use existing `getLocalRolesRoot()` helper instead of hand-rolled env-var check

- **Found during:** Task 1 (per-role-file.ts implementation)
- **Discovered:** The plan's Task 1 `<read_first>` block explicitly says: "verify no existing helper `getLocalRolesRoot` exists via grep before hand-rolling." Grep found it does exist at `identity-artifact-reader.ts:288` (added Phase 117 M-K, 2026-09-19).
- **Decision:** Import and use `getLocalRolesRoot()` from `identity-artifact-reader.js` rather than writing a `localRoleTargetPath` function that inlines `process.env.ROLES_HOST_DIR ?? path.join(os.homedir(), "fleet", "roles")`.
- **Why it's a Rule 3 fix (not architectural, not scope-widening):** The plan's action step (d) said "match the env-honoring pattern from per-identity-file.ts:108-118." per-identity-file.ts:117 itself calls `getLocalIdentitiesRoot()` (the identity-scoped sibling of `getLocalRolesRoot()`) rather than hand-rolling. Following the same discipline for roles is a straight structural mirror — the plan's intent was "honor the env override"; the exact mechanism is unchanged from the sibling.
- **Files affected:** `src/backend/claude-session/per-role-file.ts` (import line + `localRoleTargetPath` body).
- **Test impact:** Test 7 (env-honoring) still passes verbatim — `getLocalRolesRoot()` reads `process.env.ROLES_HOST_DIR` at call time, so the test's `beforeEach` env mutation is honored the same way it would be in a hand-rolled version.
- **Commit:** `12f776a4`

No other deviations. All three tasks executed exactly as the plan specified. No architectural changes, no scope creep, no un-archive route, no `removeRoleFile` primitive (deferred to a future phase per Task 1 step (h)).

## Threat Register — All Mitigations in Place

Full STRIDE table lives in the plan's `<threat_model>` block. Mitigation sites in code:

| Threat ID | Mitigation site | Test coverage |
|-----------|-----------------|---------------|
| T-133-01-01 (EoP, unauth caller / cross-user hostId) | `role-archive.ts` steps 1 (authenticateJWT) + 3 (resolveHostById filter, 404 not 403) | Test 6 (cross-user 404), Test 9 (401 unauth) |
| T-133-01-02 (Tampering, path traversal via role name) | `role-archive.ts` step 2 (`ROLE_NAME_PATTERN.test`) + `per-role-file.ts` `assertValidRoleName` (belt-and-suspenders) | Route Tests 3a/3b/3c; primitive Tests 3/3b |
| T-133-01-03 (Info Disclosure, 500 error text leak) | `role-archive.ts` step 5 catch block (generic client message, server-side `databaseLogger.error`) | Route Test 8 (asserts client body has no `ENOSPC`, server log does) |
| T-133-01-04 (DoS, request flood) | accepted per plan (idempotent — same empty file at same path) | n/a |
| T-133-01-05 (Repudiation) | `role-archive.ts` step 5 audit log `databaseLogger.info("role archive requested: userId=X, hostId=Y, name=Z")` | Route Test 1 (asserts audit-log call + shape) |
| T-133-01-06 (Concurrent-archive race) | accepted per plan (atomic tmp+rename on both branches) | n/a |
| T-133-01-SC (Package legitimacy) | No new packages added — all imports are existing modules | `git diff package.json` (empty) |

## Optional Manual Smoke — Not Performed

Per fleet-rule 2026-08-29, executor scope excludes `docker build`, `docker compose up`, HTTPS smoke, and `docker logs`. The manual `curl` smoke described in Task 3's `<done>` block is orchestrator-only and was not run in this session.

## Git Commits

| Commit | Type | Task | Description |
|--------|------|------|-------------|
| 0f6bf562 | test | 133-01-1 | RED: failing tests for writeRoleFile primitive |
| 12f776a4 | feat | 133-01-1 | GREEN: implement writeRoleFile primitive |
| 4f3b6c16 | test | 133-01-2 | RED: failing tests for role-archive route |
| 27a769f3 | feat | 133-01-2 | GREEN: implement POST /roles/:name/archive route |
| 2278dc6f | feat | 133-01-3 | Mount role-archive router in database.ts |

Duration: ~15 min executor time.

## Self-Check: PASSED

- Files created exist:
  - `src/backend/claude-session/per-role-file.ts` — FOUND
  - `src/backend/claude-session/per-role-file.test.ts` — FOUND
  - `src/backend/database/routes/role-archive.ts` — FOUND
  - `src/backend/database/routes/role-archive.test.ts` — FOUND
- Files modified exist:
  - `src/backend/database/database.ts` — FOUND (2 hits of `roleArchiveRoutes`)
- All 5 commits present in `git log --oneline -5`: FOUND
- All 22 tests pass: PASS
- Backend + frontend builds: PASS
