---
phase: 143-un-archive-frontend-backend-three-post-endpoints-with-precon
plan: "03"
subsystem: backend-routes
tags: [archive, list, fleet-wide, host-scoped, GET, ssh-fan-out]
dependency_graph:
  requires:
    - 143-02  # listArchivedRolesOnHost + listArchivedAppsOnHost primitives
  provides:
    - GET /identities-archive (fleet-wide archived identity key list)
    - GET /roles-archive?hostId=<n> (host-scoped archived role name list)
    - GET /apps-archive (fleet-wide archived app slug list)
  affects:
    - src/backend/database/database.ts (three new route mounts)
tech_stack:
  added: []
  patterns:
    - fleet-wide fan-out with per-host silent-degrade (mirrors conversation-search.ts)
    - host-scoped one-shot SSH with resolveHostById ownership gate (mirrors roles-list-for-host.ts)
key_files:
  created:
    - src/backend/database/routes/identities-archive-list.ts
    - src/backend/database/routes/identities-archive-list.test.ts
    - src/backend/database/routes/roles-archive-list.ts
    - src/backend/database/routes/roles-archive-list.test.ts
    - src/backend/database/routes/apps-archive-list.ts
    - src/backend/database/routes/apps-archive-list.test.ts
  modified:
    - src/backend/database/database.ts
decisions:
  - "Fleet-wide routes (identities, apps) enumerate ALL of the caller's hosts using a direct db.select({id}).from(hosts).where(eq(hosts.userId, userId)) — no autoTmux filter unlike conversation-search, because archived items can exist on non-autoTmux hosts."
  - "Response shape for apps: {hostId, slug} — the minimum needed for the archived-apps modal (plan 143-06); title/iconUrl deferred per plan spec."
  - "Test 2 for fleet-wide routes uses mock.calls.length to differentiate per-host calls since both remote conns share the same stubConn object."
metrics:
  duration: "~15 minutes"
  completed: "2026-09-30"
  tasks_completed: 3
  files_changed: 7
---

# Phase 143 Plan 03: Three GET List Routes (D-05/D-06/D-07) Summary

Three GET endpoints exposing archived item lists for identity, role, and app types, with fleet-wide fan-out for identities+apps and host-scoped host isolation for roles.

## What Was Built

### GET /identities-archive (fleet-wide, D-06/D-07)

`src/backend/database/routes/identities-archive-list.ts` — Exposes the existing `listArchivedIdentityKeysOnHost` primitive (already used by conversation-search.ts) as an HTTP surface. Fan-out enumerates all of the caller's hosts, opens one-shot SSH per remote host, aggregates `{identityKey, hostId}` entries sorted by `(hostId, identityKey)`. Per-host silent degrade matches conversation-search.ts discipline.

### GET /roles-archive?hostId=n (host-scoped, D-07)

`src/backend/database/routes/roles-archive-list.ts` — Host-scoped endpoint mirroring `roles-list-for-host.ts` auth+resolve+one-shot-SSH shape, substituting `listArchivedRolesOnHost` (plan 143-02). Returns `{name: string}[]` matching `ArchivedRoleListEntry`. `resolveHostById(hostId, userId)` → 404 on cross-user/unknown hostId (T-143-03-01). 504 on SSH connect failure.

### GET /apps-archive (fleet-wide, D-07)

`src/backend/database/routes/apps-archive-list.ts` — Fleet-wide fan-out mirroring the identities route shape, substituting `listArchivedAppsOnHost` (plan 143-02). Returns `{hostId, slug}[]` sorted by `(hostId, slug)`.

### database.ts mounts

Three new standalone mounts added before any generic catch-all, with phase-143 comment markers:
- `app.use("/identities-archive", identitiesArchiveListRoutes)` — near the `/conversation-search` mount
- `app.use("/roles-archive", rolesArchiveListRoutes)` — near the `/roles` chain
- `app.use("/apps-archive", appsArchiveListRoutes)` — near the `/apps` chain

## Tests

10 tests across 3 files, all pass:
- `identities-archive-list.test.ts`: 3 tests (401, happy fleet-wide sorted, partial fleet failure)
- `roles-archive-list.test.ts`: 4 tests (401, happy `[{name}]`, 400 missing hostId, 404 cross-user)
- `apps-archive-list.test.ts`: 3 tests (401, happy fleet-wide sorted, partial fleet failure)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — routes wire real primitives directly.

## Threat Flags

None — all STRIDE mitigations in the threat register (T-143-03-01 through T-143-03-04) are present in the implementation:
- T-143-03-01: Fleet enumeration userId-scoped; host-scoped route uses resolveHostById 404
- T-143-03-02: Generic 500 error messages; details logged server-side only
- T-143-03-03: SSH_CONNECT_TIMEOUT_MS=5000 + per-host try/catch silent-drop
- T-143-03-04: Positive-integer parse gate on roles route hostId param

## Self-Check: PASSED

Files exist:
- src/backend/database/routes/identities-archive-list.ts — FOUND
- src/backend/database/routes/roles-archive-list.ts — FOUND
- src/backend/database/routes/apps-archive-list.ts — FOUND

Commits:
- 39afaa9b: feat(143-03): GET /identities-archive fleet-wide list route + test + mount
- e68bdd9e: feat(143-03): GET /roles-archive host-scoped list route + test + mount
- 48a7de32: feat(143-03): GET /apps-archive fleet-wide list route + test + mount

Build: `npm run build:backend` exits 0 after all three tasks.
