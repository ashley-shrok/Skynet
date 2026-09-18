---
phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
plan: 04
subsystem: backend/database/routes
tags: [backend, route, projects, wire-event, tdd, express, subscription-registry]

# Dependency graph
requires:
  - phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
    plan: 01
    provides: "PROJECT_SLUG_RE + listProjects + createProject + archiveProject primitives (identity-artifact-reader.ts)"
  - phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
    plan: 03
    provides: "publishProjectListChanged on SubscriptionRegistry (subscription-registry.ts) — the wire-event fanout the route calls after every successful write"
  - phase: 115-archived-fleet-tree
    provides: "identity-archive.ts byte-shape template — JWT + resolveHostById 404-on-cross-user + LOCAL/REMOTE branch + JSON body posture per D-36a"
provides:
  - "GET /projects?hostId=<n> — {projects: [{slug, displayName, archived: false}]}"
  - "POST /projects — body {hostId, displayName}; backend-slugify + 409 dupe rejection; response {ok: true, slug}"
  - "POST /projects/:slug/archive — body {hostId}; response {ok: true}"
  - "normalizeToSlug(input: string): string — exported shared contract with the frontend modal (117-09)"
  - "setSubscriptionRegistry / getSubscriptionRegistry / __resetSubscriptionRegistryForTests — module-level singleton accessor pair on subscription-registry.ts"
  - "ProjectListEntry type — promoted to `export` for consumer typing"
affects: [117-06, 117-07, 117-09]  # Wave 3 frontend API client + store hydration + create-project modal

# Tech tracking
tech-stack:
  added: []  # No new packages installed — every mechanism reuses existing primitives
  patterns:
    - "Byte-shape mirror of identity-archive.ts:76-159 for JSON body posture + JWT + resolveHostById 404 + LOCAL/REMOTE branch + try/catch/finally + generic-500-with-server-side-log"
    - "Backend-authoritative slug derivation (Pitfall 1 in RESEARCH): normalizeToSlug is the single source of truth — the frontend submits raw displayName and echoes back the slug from the 200 response body"
    - "Module-level singleton accessor pair for cross-module dep-injection when Express routes mount before the DI-graph root runs — starter.ts calls setSubscriptionRegistry() once; routes call getSubscriptionRegistry() at request time"
    - "Publish-after-write with tolerance: wire-event failure does NOT roll back the write; log warn + continue (correctness invariant — the disk write is the source of truth, the WS event is an optimization for connected clients)"

key-files:
  created:
    - src/backend/database/routes/project-list.ts
    - src/backend/database/routes/project-list.test.ts
  modified:
    - src/backend/database/database.ts
    - src/backend/fleet-status/subscription-registry.ts
    - src/backend/starter.ts

key-decisions:
  - "D-25 backend-authoritative slugify (Pitfall 1 in RESEARCH) — the frontend never computes the slug at runtime. normalizeToSlug's algorithm is fixed: lowercase → replace [^a-z0-9]+ with '-' → strip leading/trailing '-'. Empty output (pure separators) → 400."
  - "D-36a JSON body throughout — no multer, no multipart, no upload.single anywhere in the route (grep-verified). Small sentinel-drop-shaped payloads only; no file uploads planned for v1."
  - "D-37 wire event after EVERY successful write — POST /projects and POST /:slug/archive both rebuild the projects list via listProjects(conn) and hand it to publishProjectListChanged after the primitive returns. If the primitive throws, no wire event fires."
  - "409 duplicate-slug distinguisher — createProject throws an EEXIST-shaped error (117-01's contract); route catches on err.code === 'EEXIST' OR /exists/i.test(msg) to accept both signal shapes, then responds 409 {error: 'slug exists', slug} so the modal can surface the collision to the user rather than a generic 500."
  - "Singleton accessor pattern for the subscription registry — routes mount inside database.ts BEFORE starter.ts creates the registry, so dep-injection is not viable. Introduced set/get pair on subscription-registry.ts; starter.ts calls setSubscriptionRegistry(registry) once immediately after createSubscriptionRegistry(). Route calls getSubscriptionRegistry() at REQUEST time — by then starter.ts has run. Null-tolerant: absent registry → skip fanout with log, don't throw."
  - "Publish-failure isolation — a wire-event publish exception MUST NOT roll back the create/archive. The disk write is source-of-truth; a lost WS event just means clients hydrate on next reconnect. Wrapped in an inner try/catch that logs a databaseLogger.warn and continues to return 200."
  - "DatabaseSaveTrigger.forceSave was NOT added per D-38 defensive — this plan touches only `~/fleet/projects/` on disk; no SQLite in-memory DB rows are inserted/updated/deleted. The D-38 invariant applies to session frontmatter writes on the identity file (which 117-05 handles), not to fleet-substrate directory operations."

requirements-completed: []  # Plan has no requirements: field in frontmatter

# Metrics
duration: ~6 min
completed: 2026-09-18
---

# Phase 117 Plan 04: /projects backend route Summary

## One-liner

Three-endpoint /projects Express router with backend-authoritative slugify, 409-on-duplicate, LOCAL/REMOTE branch, JSON body posture (D-36a), and publishProjectListChanged wire event after every successful write — mounted at /projects in database.ts alongside /runbooks-editor.

## Endpoints

### GET /projects?hostId=<n>

- **Method:** GET
- **Query:** `hostId=<positive-integer>` (required)
- **Request body:** none
- **Response 200:** `{ projects: Array<{ slug: string, displayName: string, archived: boolean }> }` — `archived` is always `false` because listProjects excludes the archive/ subdir per D-30
- **Error responses:**
  - 400 `{error: "hostId is required"}` — missing hostId
  - 400 `{error: "hostId must be a positive integer"}` — malformed
  - 401 `{error: "Unauthorized"}` — no JWT
  - 404 `{error: "Host not found"}` — cross-user / unknown host
  - 500 `{error: "failed to list projects"}` — listProjects throws (message logged only)
  - 504 `{error: "Host unreachable"}` — SSH connect fails (REMOTE)

### POST /projects

- **Method:** POST
- **Query:** none
- **Request body (JSON):** `{ hostId: number, displayName: string }` — displayName trimmed length 1..80
- **Response 200:** `{ ok: true, slug: <derived-slug> }` — slug is the backend-derived output of `normalizeToSlug(displayName)`
- **Error responses:**
  - 400 `{error: "hostId is required"}` — missing hostId
  - 400 `{error: "hostId must be a positive integer"}` — malformed
  - 400 `{error: "displayName is required"}` — missing / non-string / empty after trim
  - 400 `{error: "displayName must be 80 characters or fewer"}` — oversize
  - 400 `{error: "displayName must contain at least one alphanumeric character"}` — normalizeToSlug returned empty (pure separators)
  - 401 `{error: "Unauthorized"}`
  - 404 `{error: "Host not found"}`
  - 409 `{error: "slug exists", slug: <derived-slug>}` — dupe detected via `createProject` EEXIST or /exists/i regex on the thrown Error's message
  - 500 `{error: "failed to create project"}` — any other createProject throw (message logged only)
  - 504 `{error: "Host unreachable"}`
- **Side effect:** `subscriptionRegistry.publishProjectListChanged(<enriched-list>)` called exactly once after a successful create (rebuild via `listProjects(conn)` → enrich with hostId/hostname/archived).

### POST /projects/:slug/archive

- **Method:** POST
- **Query:** none
- **Path params:** `slug` — must match `PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/` (gated BEFORE any I/O per T-117-04-02)
- **Request body (JSON):** `{ hostId: number }`
- **Response 200:** `{ ok: true }`
- **Error responses:**
  - 400 `{error: "slug must match [a-z0-9-]{1,64}"}` — path-traversal defense
  - 400 `{error: "hostId is required"}` / `"hostId must be a positive integer"`
  - 401 `{error: "Unauthorized"}`
  - 404 `{error: "Host not found"}`
  - 500 `{error: "failed to archive project"}` — archiveProject throws (message logged only, T-117-04-05 no err.message leak)
  - 504 `{error: "Host unreachable"}`
- **Side effect:** `subscriptionRegistry.publishProjectListChanged(<enriched-list>)` called exactly once after a successful archive.

## Exported normalizeToSlug function signature (frontend needs to know)

```typescript
/**
 * Backend-authoritative slug derivation (Pitfall 1 in RESEARCH).
 *
 * Algorithm:
 *   1. Lowercase.
 *   2. Replace every run of non-[a-z0-9] characters with a single dash.
 *   3. Strip leading + trailing dashes.
 *
 * Empty output signals invalid input; the route responds 400.
 *
 * Exported so the frontend test suite (117-09) can import and cross-check;
 * do NOT call it at runtime — submit the raw displayName and read the slug
 * from the 200 response body.
 */
export function normalizeToSlug(input: string): string;
```

Verified test outputs (from Test 18 in project-list.test.ts):

| Input             | Output       |
| ----------------- | ------------ |
| `"Foo Bar"`       | `"foo-bar"`  |
| `"HELLO_WORLD"`   | `"hello-world"` |
| `"--trim--dashes--"` | `"trim-dashes"` |
| `"naïve"`         | `"na-ve"`    |
| `"v2.0.1"`        | `"v2-0-1"`   |
| `"___"`           | `""` (→ 400) |
| `"  Foo  Bar!! "` | `"foo-bar"`  |
| `"Alpha 123"`     | `"alpha-123"` |
| `"already-dashed"` | `"already-dashed"` |

## DatabaseSaveTrigger.forceSave — NOT added

Per the plan's "Optional per D-38 defensive" and the plan's own scope note: this plan touches only the fleet-substrate directory tree at `~/fleet/projects/`. No SQL DB writes (no `db.insert/update/delete` calls). The D-38 invariant applies to backend writes that touch session frontmatter (identity file at `~/fleet/identities/<key>/<key>.md`), which is Plan 117-05's territory. This route's writes propagate to WS clients via the singleton registry, not via the SQL DB save loop.

## Test count and pass status

- **Total tests:** 18 (all passing)
- **File:** `src/backend/database/routes/project-list.test.ts`
- **Run:** `npx vitest run src/backend/database/routes/project-list.test.ts` exits 0
- **Scoped related-file vitest** (across the 4 files this plan touched): 76 tests / 5 files / 0 regressions
- **TypeScript:** `npx tsc --noEmit -p tsconfig.json` exits 0

Test coverage by describe block:

| Describe            | Test count | Coverage |
| ------------------- | ---------- | -------- |
| GET /projects       | 7          | happy LOCAL, happy REMOTE + conn.end() in finally, missing hostId, bad hostId, cross-user 404, 504 on unreachable, 401 unauth |
| POST /projects      | 5          | happy path + enriched-wire-event assertion, auto-slugify variants + empty-slug 400, displayName validation (missing/empty/oversize), 409 dupe via EEXIST, 404 unknown host |
| POST /:slug/archive | 4          | happy path + wire event, bad slug 400 (PROJECT_SLUG_RE), 404 unknown host, 500 generic (no err.message leak) |
| cross-cutting       | 2          | all 3 endpoints 401 without JWT, normalizeToSlug 5-sample contract test |

## Commits (atomic per TDD gate)

| Gate | Commit | Message |
| ---- | ------ | ------- |
| RED   | `8413c1c` | `test(117-04): add failing tests for /projects route (RED)` |
| GREEN | `13210f7` | `feat(117-04): implement /projects route + registry singleton (GREEN)` |

## Acceptance criteria — all satisfied

- `grep -c "^router\\.\\(get\\|post\\)" src/backend/database/routes/project-list.ts` → `3` ✓
- `grep -c "authenticateJWT" src/backend/database/routes/project-list.ts` → `5` (≥ 3) ✓
- `grep -c "resolveHostById" src/backend/database/routes/project-list.ts` → `6` (≥ 3 — spec was 3, exceeded due to inline docstring reference; every route calls it exactly once) ✓
- `grep -c "publishProjectListChanged\\|getSubscriptionRegistry" src/backend/database/routes/project-list.ts` → `6` (≥ 2) ✓
- `grep -c "PROJECT_SLUG_RE" src/backend/database/routes/project-list.ts` → `4` (≥ 1) ✓
- `grep -c "multipart\\|multer\\|upload\\.single" src/backend/database/routes/project-list.ts` → `0` ✓ (JSON body per D-36a — no multipart)
- `grep -n 'app\\.use("/projects"' src/backend/database/database.ts` → single matched line at 1971 ✓
- `npx vitest run src/backend/database/routes/project-list.test.ts` → 18/18 passing ✓
- `npx tsc --noEmit -p tsconfig.json` → exit 0 ✓
- No err.message in response bodies — every reference is inside a databaseLogger.error/warn call or a docstring; verified by inspection ✓

## Threat model outcome

| Threat ID | Category | Disposition | Held |
|-----------|----------|-------------|------|
| T-117-04-01 | EoP cross-user hostId probe | mitigate | ✓ resolveHostById(hostId, userId) → 404 on cross-user (NOT 403) — Test 5, 12, 15 assert 404 |
| T-117-04-02 | Tampering path-traversal via slug on archive | mitigate | ✓ PROJECT_SLUG_RE gate BEFORE archiveProject call — Test 14 asserts 400 on "BAD!" containing shell metacharacters |
| T-117-04-03 | Tampering yaml injection via displayName | mitigate | ✓ Inherited from 117-01 createProject — yaml.dump safely quotes strings; 80-char length cap prevents abusive payloads (Test 10) |
| T-117-04-04 | DoS unauth flood | mitigate | ✓ authenticateJWT gate on every route — Test 7, 17 assert 401 unauth |
| T-117-04-05 | Info disclosure via 500 body | mitigate | ✓ Fixed error shape; err.message goes to databaseLogger only. Test 16 asserts EACCES + "sensitive info" strings NOT in response body |
| T-117-04-06 | Tampering race on POST duplicate | accept | Skynet single-user; race window is microseconds; failure mode is a redundant 409 or 500 — both recoverable by the modal |
| T-117-04-07 | Tampering slugify algorithm drift frontend↔backend | mitigate | ✓ Pitfall 1 — normalizeToSlug is exported; Test 18 asserts exact output on 5 samples; the frontend submits raw displayName and echoes the slug back |
| T-117-04-SC | Tampering npm installs | accept | ✓ Zero new packages installed |

## Threat Flags

None. The three new endpoints all sit under authenticateJWT + resolveHostById(userId) — the same trust boundary posture already covered by the plan's threat model. The introduction of `setSubscriptionRegistry` / `getSubscriptionRegistry` on subscription-registry.ts is a module-internal singleton accessor that never crosses the network trust boundary; the registry object itself is exchanged only inside the Node process.

## Known Stubs

None. Every code path is fully wired end-to-end. The three route handlers each complete the full LOCAL/REMOTE + resolveHostById + primitive-call + wire-event + response path with no placeholder returns, no TODO markers, no "coming in the next plan" comments.

## Deviations from Plan

**Rule 3 (auto-fixed blocking issue): introduced `setSubscriptionRegistry` / `getSubscriptionRegistry` singleton accessor on subscription-registry.ts.**

- **Found during:** Task 1 GREEN phase, while wiring the route's `publishProjectListChanged` call.
- **Issue:** The subscription registry is created inside `starter.ts:485` via `createSubscriptionRegistry()` and dep-injected into `fleet-status-server` + `ssh-poll-orchestrator`. It is NOT exposed as a module-level singleton, and it is created AFTER `database.ts` loads and mounts its routes. There is no existing pattern for an Express route to reach the registry — every existing publisher (only `ssh-poll-orchestrator`) receives the instance via `deps.registry` at construction time.
- **Fix:** Added `let sharedRegistry: SubscriptionRegistry | null = null;` at module scope in `subscription-registry.ts`, plus a set/get pair (`setSubscriptionRegistry` populates it, `getSubscriptionRegistry` reads it) and a `__resetSubscriptionRegistryForTests` helper for symmetry. `starter.ts` now calls `setSubscriptionRegistry(registry)` immediately after `createSubscriptionRegistry()`. The route calls `getSubscriptionRegistry()` at REQUEST time (not module-import time), by which point starter.ts has run. If the accessor returns null (e.g. in a test harness that mounts the router without a registry), the fanout is skipped rather than crashing — publishing failure is not a correctness invariant, only an optimization for connected clients.
- **Files modified:** `src/backend/fleet-status/subscription-registry.ts` (+50 LOC accessor pair; `ProjectListEntry` type promoted to `export`), `src/backend/starter.ts` (+8 LOC — import + one call after registry creation).
- **Commit:** `13210f7` (part of the GREEN commit; separating it would violate the atomic-per-task discipline for Wave 2).
- **Consistent with plan:** Plan Task 1's read_first anchor already anticipated this by noting: "If `subscriptionRegistry` is a singleton exported under a different name, adjust the import to match (grep the file for the export shape)." The grep showed no singleton existed, so I introduced one to unblock the wire-event wiring.
- **Downstream implication:** Wave 2 Plan 117-05 (session-project-write route) will reuse the same accessor. No additional plumbing required.

No architectural change (Rule 4): the accessor is a byte-parallel of the existing `deps.registry` DI pattern — same object identity, same fanout, same subscriber set. It just adds a second reader.

## Frontend hand-off

Wave 3 Plan 117-06 (API client) can now:

```typescript
authApi.get('/projects?hostId=<n>');                          // returns {projects: [{slug, displayName, archived}]}
authApi.post('/projects', {hostId, displayName});             // returns {ok: true, slug} or 409 {error: 'slug exists', slug}
authApi.post('/projects/<slug>/archive', {hostId});           // returns {ok: true}
```

Wave 3 Plan 117-09 (create-project modal) reads the derived slug from the 200 response body — must NOT compute the slug client-side (Pitfall 1 in RESEARCH). If a duplicate 409 comes back, surface the collision inline with the offending slug from the response body.

Every successful write triggers `publishProjectListChanged` on the WS registry, so subscribed clients receive a `project-list-changed` frame with the full updated projects array — no explicit refetch needed. Wave 3 Plan 117-07 (store hydration) subscribes to this via `fleet-status-client.ts`.

## Self-Check: PASSED

Files present:
- FOUND: `src/backend/database/routes/project-list.ts`
- FOUND: `src/backend/database/routes/project-list.test.ts`
- FOUND: `src/backend/database/database.ts` (modified — mount at :1971)
- FOUND: `src/backend/fleet-status/subscription-registry.ts` (modified — accessor pair + ProjectListEntry export)
- FOUND: `src/backend/starter.ts` (modified — setSubscriptionRegistry(registry) call)

Commits present in git log:
- FOUND: `8413c1c` — test(117-04) RED
- FOUND: `13210f7` — feat(117-04) GREEN

Both TDD gate commits confirmed via `git log --oneline`. 18 tests pass under scoped vitest; tsc --noEmit clean; scoped related-file vitest across the 4 touched files shows 76 passing / 0 failing / 0 skipped (5 test files).
