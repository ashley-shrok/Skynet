---
phase: 25-sidebar-role-clustering
plan: 1
subsystem: backend-identities-route + frontend-wire-type
tags:
  - sidebar
  - role-clustering
  - identity-list
  - backend
  - wire-type
dependency_graph:
  requires:
    - "Phase 22 SRIC-01 — resolveRoleForIdentity in identity-artifact-reader.ts"
  provides:
    - "role: string | null per row on GET /identities response"
    - "Identity.role: string | null on frontend wire type"
  affects:
    - "src/backend/database/routes/identities.ts"
    - "src/ui/api/identities-api.ts"
    - "src/backend/ssh/plan-file-fetch.ts (pre-existing TS error fixed)"
tech_stack:
  added: []
  patterns:
    - "Promise.all per-row async enrichment (mirrors sessions.ts pattern)"
    - "swallow-and-null try/catch with databaseLogger.warn for non-fatal role resolution failures"
    - "additive publicIdentity() parameter with default null — existing callers unaffected"
key_files:
  created: []
  modified:
    - src/backend/database/routes/identities.ts
    - src/ui/api/identities-api.ts
    - src/backend/ssh/plan-file-fetch.ts
decisions:
  - "resolveRoleForIdentity(null, identityKey) — null conn triggers LOCAL fs branch; correct for user-scoped identities with no hostId in DB"
  - "databaseLogger.warn (not error) for swallowed role resolution failures — missing/malformed role file is a data-integrity note, not an operational failure"
  - "role field appended LAST in publicIdentity() return object to keep wire change additive-only"
  - "role NOT added to IdentityInput — role is server-derived, never client-supplied"
metrics:
  duration: "~15 minutes"
  completed: "2026-08-05"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 25 Plan 1: Identity Role Enrichment — Backend + Wire Type Summary

**One-liner:** Per-row `role: string | null` plumbed from `resolveRoleForIdentity(null, identityKey)` into `GET /identities` response and `Identity` wire type, using Promise.all + per-row swallow-and-null catch.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add role enrichment to GET /identities list endpoint + expand publicIdentity() | cb86510 | src/backend/database/routes/identities.ts, src/backend/ssh/plan-file-fetch.ts |
| 2 | Extend Identity wire type with role field | a887e54 | src/ui/api/identities-api.ts |

## Implementation Notes

### Where role enrichment is called (identities.ts post-edit)

`resolveRoleForIdentity` is imported at line 12 and called at line 82 inside the
`Promise.all(rows.map(async (row) => { ... }))` block in `router.get("/", ...)`.
The call passes `null` as the `conn` argument to trigger the LOCAL fs branch —
correct for the list endpoint since identities are user-scoped with no hostId in the DB,
and their canonical file lives on the LOCAL host mounting the identities directory.

### How the swallow-and-null path is logged

The catch block calls `databaseLogger.warn(message, context)` — the two-arg form
`(string, LogContext)` matching the Logger class's `warn(message: string, context?: LogContext): void`
signature. No error object is passed (unlike `.error(message, err, context)` which has
error as second positional arg). The context is:

```
{
  operation: "list_identities_resolve_role",
  userId,
  identityKey: row.identityKey,
}
```

`warn` (not `error`) because a missing/malformed role file is a data-integrity note —
the list endpoint recovers with `role: null` and the row still appears in the response.

### publicIdentity() second parameter default

`publicIdentity(row: typeof identities.$inferSelect, role: string | null = null)` —
the `= null` default keeps all existing single-arg callers (POST at line 161, PUT at
line 247) compiling without modification. The `role` field is appended LAST in the
return object (after `updatedAt`) so the wire shape change is strictly additive.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pre-existing TS2339 in src/backend/ssh/plan-file-fetch.ts:297**
- **Found during:** Task 1 verification (`npm run build:backend`)
- **Issue:** `format.error` access on a discriminated union `{ ok: true; slugWithExt: string } | { ok: false; error: string }` — TypeScript did not narrow the type inside the `if (!format.ok)` branch, causing `TS2339: Property 'error' does not exist on type '{ ok: true; slugWithExt: string; } | { ok: false; error: string; }'`
- **Scope:** Pre-existing, in an unrelated file — but directly blocks `npm run build:backend` exit 0 which is a plan success criterion and a fleet rule
- **Fix:** Added explicit cast `(format as { ok: false; error: string }).error` at line 297
- **Files modified:** src/backend/ssh/plan-file-fetch.ts
- **Commit:** cb86510 (bundled with Task 1)

## Verification Results

- `grep -n "resolveRoleForIdentity" src/backend/database/routes/identities.ts` — 2 hits (import line 12 + call site line 82)
- `grep -n "function publicIdentity" src/backend/database/routes/identities.ts` — signature at line 53 with two parameters
- `grep -n "role," src/backend/database/routes/identities.ts` — `role,` inside publicIdentity return at line 66
- `grep -n "Promise.all" src/backend/database/routes/identities.ts` — 1 hit at line 78 inside list handler
- `grep -n "list_identities_resolve_role" src/backend/database/routes/identities.ts` — 1 hit at line 85 in swallow-and-null catch
- `grep -c "databaseLogger.warn" src/backend/database/routes/identities.ts` — 1 hit (new warn call)
- `grep -n "role: string | null" src/ui/api/identities-api.ts` — exactly 1 hit inside Identity interface (line 10)
- `grep -A 8 "export interface IdentityInput"` + `grep -c '^\s*role:'` — 0 (role NOT in IdentityInput)
- `npx tsc --noEmit` — exits 0
- `npm run build:backend` — exits 0
- POST/PUT/DELETE handlers in identities.ts — unchanged

## Known Stubs

None. The role field is real data plumbed from the filesystem via `resolveRoleForIdentity`.
Rows where the identity file lacks `role:` frontmatter return `role: null` by design
(swallow-and-null pattern per 25-CONTEXT.md §Null-role handling).

## Threat Flags

No new security surface introduced. Analysis per plan threat model:
- T-25-01-01 (Tampering): `identityKey` is DB-owned, `resolveRoleForIdentity` re-validates via `IDENTITY_KEY_RE` internally — no path-injection surface.
- T-25-01-02 (DoS): Promise.all fan-out over ~dozen identities; LOCAL fs reads are ms-scale.
- T-25-01-03 (Availability): Per-row try/catch applied — one bad role file cannot 500 the list endpoint.
- T-25-01-04 (Information Disclosure): Role is already visible to the authenticated user in IdentityModal Role tab (Phase 22); no new disclosure.

## Self-Check: PASSED

- src/backend/database/routes/identities.ts: FOUND
- src/ui/api/identities-api.ts: FOUND
- commit cb86510: FOUND (git log)
- commit a887e54: FOUND (git log)
