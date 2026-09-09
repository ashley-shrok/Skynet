---
phase: 90-role-management-modal-split
plan: 02
subsystem: backend-avatar-serve
tags: [backend, express-route, ssh-one-shot, path-traversal-defense, avatar-serve, role-scope]
requires:
  - Phase 85 Plan 85-01 Task 1 (readRoleFileByName exported)
  - Phase 85 Plan 85-01 Task 2 (readAvatarSiblingFileByRole exported)
  - Phase 90 Plan 90-01 (RoleSummary widened + /roles cosmetic fields on disk)
provides:
  - GET /roles/:name/avatar?hostId=<n> endpoint (role-scope avatar serve)
  - roleAvatarUrl(hostId, roleName) frontend helper
affects:
  - Downstream Plan 90-04 (role modal header avatar rendering)
  - Downstream Plan 90-05 (roles-list modal `.pv-row` avatar rendering)
tech-stack:
  added: []
  patterns:
    - Byte-shape mirror of identity-avatar endpoint (identities.ts:767-870)
    - ROLE_NAME_PATTERN pattern cloned locally (independent-router convention)
    - Silent-fallback on role-file read failure → 404 (mirrors identities.ts:846-848)
key-files:
  created:
    - src/backend/database/routes/roles.ts
    - src/backend/database/routes/roles.test.ts
  modified:
    - src/backend/database/database.ts
    - src/ui/api/identities-api.ts
decisions:
  - D-08.2 shape locked: `GET /roles/:name/avatar?hostId=<n>` matches identity-avatar path shape
  - ROLE_NAME_PATTERN cloned locally rather than imported (routers stay independent)
  - No ETag/caching machinery on this endpoint (role avatars change rarely; add if a caching need emerges)
  - Silent-fallback on readRoleFileByName throw → 404 (never surfaces as 5xx)
metrics:
  duration: ~10 minutes
  completed: 2026-09-09
  tasks_completed: 2
  files_created: 2
  files_modified: 2
  commits: 2
  tests_added: 10
---

# Phase 90 Plan 90-02: Role Avatar Serve Endpoint Summary

Adds a new backend route `GET /roles/:name/avatar?hostId=<n>` that streams a role's on-disk sibling avatar bytes (frontmatter-declared, kebab-case-guarded), plus a matching `roleAvatarUrl(hostId, roleName)` frontend helper for `<img src>` consumption. Byte-shape mirror of the identity-avatar-serve endpoint, scoped to role addressing.

## What shipped

- **New Express router** at `src/backend/database/routes/roles.ts`. Handler flow (mirrors `identities.ts:767-870` byte-for-byte, adapted for role scope):
  1. `ROLE_NAME_PATTERN = /^[a-z0-9-]+$/` gate on `req.params.name` — rejects `../` (raw or `%2E%2E%2F`-encoded) BEFORE any host-resolve / SSH work.
  2. `req.query.hostId` positive-integer gate.
  3. `isLocalHostId(hostId)` → LOCAL branch with `conn=null`; else `resolveHostById → connectOneShot`, both surfacing failures as 502 `{error: "host unreachable"}`.
  4. `readRoleFileByName(conn, roleName)` — throws swallow to 404 `{error: "no avatar"}` (silent-fallback matches `identities.ts:846-848`).
  5. `extractCosmeticsFromFrontmatter(markdown)` — absent `avatar` field → 404.
  6. `readAvatarSiblingFileByRole(conn, roleName, avatarFilename)` — null or throw → 404.
  7. `res.setHeader("Content-Type", readResult.mime).send(readResult.bytes)`.
  8. `try/finally { conn?.end() }` guarantees SSH cleanup on every exit.
- **10 vitest cases** covering the full plan behavior contract (A–J):
  - A: happy path (remote) — asserts bytes, Content-Type, and that reader callbacks received the SSH conn.
  - B: happy path (local) — asserts readers received `conn=null`.
  - C: no frontmatter `avatar` → 404 (avatar reader never called).
  - D: sibling file missing → 404.
  - E: `UPPERCASE_INVALID` name → 400 before any SSH work.
  - F/G: missing / non-integer hostId → 400.
  - H: `resolveHostById` returns null → 502.
  - I: `%2E%2E%2F` URL-encoded traversal → decoded to `../` → fails ROLE_NAME_PATTERN → 400. Neither reader called. STRIDE T-22-02-02 parallel proven.
  - J: `readRoleFileByName` throws → caught → 404 (avatar reader never called).
- **Router mounted in `database.ts`** at `/roles` alongside `rolesListForHostRoutes` + `rolesCreateRoutes`. Chained-router mounts coexist because their handlers bind at different route depths (`/`, `POST /`, `/:name/avatar`) — no shadowing.
- **`roleAvatarUrl(hostId, roleName): string`** exported from `src/ui/api/identities-api.ts`, adjacent to `listRolesForHost`. Returns `/roles/${encodeURIComponent(roleName)}/avatar?hostId=${hostId}`. `encodeURIComponent` is defense-in-depth — the backend already gates via `ROLE_NAME_PATTERN` (kebab-case has no URL-special chars), but the frontend helper doesn't need to know that.

## Key decisions

- **D-08.2 shape locked** as `GET /roles/:name/avatar?hostId=<n>` — parallels the identity-avatar endpoint path shape verbatim.
- **`ROLE_NAME_PATTERN` cloned locally** in `roles.ts` rather than imported from `roles-list-for-host.ts` — the two routers stay independent per CONTEXT § "deferred anti-patterns", so a future divergence in one gate doesn't silently loosen the other.
- **No ETag/caching machinery** on this endpoint. The identity-avatar endpoint carries ETag + Cache-Control:no-store; the role-avatar variant keeps it minimal (Cache-Control:no-store only). Role avatars change rarely — add caching if a need emerges.
- **Silent-fallback on `readRoleFileByName` throw → 404.** A broken role file or transient SSH exec failure should not surface as 5xx here — the frontend caller (a `<img>` tag) renders a neutral placeholder on 404, which is the intended D-05 fallback behavior. Matches `identities.ts:846-848` semantics.

## Test coverage

```
npx vitest run src/backend/database/routes/roles.test.ts src/backend/database/routes/roles-list-for-host.test.ts

 Test Files  2 passed (2)
      Tests  27 passed (27)
```

10 new tests for `roles.ts`; 17 existing tests for `roles-list-for-host.ts` all still green — confirms the mount-order change did not shadow the enumeration route.

## Build verification

```
npm run build:backend  # clean
npm run build          # clean (only pre-existing INEFFECTIVE_DYNAMIC_IMPORT warning on telegram-api.ts — unrelated)
```

## Deviations from Plan

None — plan executed exactly as written. Two minor cosmetic adjustments below (both within-plan discretion):

1. **`encodeURIComponent` in `roleAvatarUrl`.** The plan spec says "returns `/roles/<name>/avatar?hostId=<n>`" — adding `encodeURIComponent(roleName)` is a defense-in-depth that produces identical output for valid kebab-case names (kebab-case has no URL-special chars). Non-cosmetic if a caller ever passes a role name that hasn't been backend-validated.

2. **Fallback 502 in the outer try/catch of the router.** The plan spec covers per-branch 502s (resolveHostById null, connectOneShot throw). The outer catch-all also emits 502 to avoid any raw-exception leak on unexpected paths (e.g., a Buffer send failure). Belt-and-suspenders; matches `identities.ts:872-877` shape.

## Commits

- `5bede0e2`: `feat(90-02): add GET /roles/:name/avatar serve endpoint + tests` — new router + 10-case test suite.
- `92d73755`: `feat(90-02): mount /roles/:name/avatar router + add roleAvatarUrl helper` — mount + frontend helper.

## Known Stubs

None. Both endpoints wire real reader/host-resolver machinery; no placeholder returns.

## Threat Flags

None. The new endpoint introduces a `GET` surface but it's identical in shape to the existing identity-avatar endpoint (same auth gate, same host-scoping, same kebab-case-only regex on the path parameter). No new trust boundary crossed.

## Self-Check: PASSED

**Files exist:**
- `src/backend/database/routes/roles.ts` — FOUND
- `src/backend/database/routes/roles.test.ts` — FOUND
- `src/backend/database/database.ts` — FOUND (modified — mount added)
- `src/ui/api/identities-api.ts` — FOUND (modified — helper added)

**Commits exist:**
- `5bede0e2` — FOUND
- `92d73755` — FOUND

**Acceptance criteria met:**
- Task 1: 10/10 tests pass; ROLE_NAME_PATTERN grep count = 3 (>=2 required); build:backend clean; path-traversal test I confirms `../` never reaches SSH.
- Task 2: `app.use("/roles", rolesRoutes)` grep count = 1 (>=1 required); `roleAvatarUrl` grep count = 2 (>=1 required); build:backend + build clean; both scoped test suites (roles + roles-list-for-host) green at 27 tests total.
