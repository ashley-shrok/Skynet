---
phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
plan: 05
subsystem: backend/database/routes
tags: [backend, route, projects, identity-frontmatter, matrix-account-data, m.tag, express, tdd]

# Dependency graph
requires:
  - phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
    plan: 01
    provides: "writeSessionProjectField + PROJECT_SLUG_RE + IDENTITY_KEY_RE + listProjects (identity-artifact-reader.ts)"
  - phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
    plan: 02
    provides: "setRoomProjectTag — D-05a read-modify-write on m.tag account_data (matrix-room-tag-client.ts)"
  - phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
    plan: 03
    provides: "publishProjectListChanged on SubscriptionRegistry"
  - phase: 117-projects-sidebar-section-with-drag-and-drop-membership-per-p
    plan: 04
    provides: "getSubscriptionRegistry() singleton accessor + ProjectListEntry export"
  - phase: 115-archived-fleet-tree
    provides: "identity-archive.ts byte-shape template (JWT + resolveHostById + LOCAL/REMOTE + generic 500)"
provides:
  - "POST /identities/:key/project — body {hostId: number, project: string | null}; response {ok: true}"
  - "POST /relay-rooms/:roomId/project — body {userMxid: string, project: string | null}; response {ok: true}"
affects: [117-08]  # Wave 4 frontend DnD drop lane (which POSTs to whichever endpoint matches the row kind)

# Tech tracking
tech-stack:
  added: []  # Zero new packages installed
  patterns:
    - "Byte-shape mirror of identity-archive.ts:76-159 for the identity-scoped route (JSON body, JWT, resolveHostById 404-on-cross-user, LOCAL/REMOTE branch, try/catch/finally with conn.end())"
    - "Explicit 'project' key required in body (not just optional/missing → 400); string OR null; strings gated by PROJECT_SLUG_RE; empty string rejected"
    - "Users-table mxid lookup pattern from relay-room-participants.ts:78-99 (drizzle db.select({mxid: users.mxid}).from(users).where(eq(users.id, userId)).limit(1))"
    - "Defense-in-depth userMxid check: body.userMxid MUST match callerMxid from users table; pre-Phase-88 users (null mxid) → 403 (cannot verify → reject)"
    - "Publish-after-write with tolerance (D-37, inherited from 117-04): publish exception logged as warn, does NOT roll back the write — disk/Matrix state is source of truth"
    - "Non-SSH route: relay-room path skips LOCAL/REMOTE branch entirely because Matrix HTTP client owns the connection lifecycle"

key-files:
  created:
    - src/backend/database/routes/session-project-write.ts
    - src/backend/database/routes/session-project-write.test.ts
    - src/backend/database/routes/relay-room-project-tag.ts
    - src/backend/database/routes/relay-room-project-tag.test.ts
  modified:
    - src/backend/database/database.ts

key-decisions:
  - "D-05: identity-scoped write goes to writeSessionProjectField which touches identity file frontmatter; relay-room scoped write goes to setRoomProjectTag which touches Matrix m.tag account_data. Two carriers, two routes, one plan."
  - "D-05a: relay-room route does not implement the read-modify-write itself — it delegates fully to setRoomProjectTag (117-02) which owns the 5-step protocol (GET → preserve non-project → strip u.project.* → optional add u.project.<slug> → PUT)."
  - "D-31 absent-⇒-omit: body project=null CLEARS the field (never emits `project: null` or `project: ''`). The writer's contract (117-01) already enforces this; the route just passes null through."
  - "D-36a JSON body throughout: no multipart, no multer, no file uploads. Every route in this plan uses small sentinel-drop-shaped JSON payloads."
  - "D-37 publish-after-write: BOTH routes fire publishProjectListChanged on success. Session-project route rebuilds the current projects list via listProjects(conn) and publishes it enriched (hostId as string + hostname + archived:false). Relay-room route publishes an EMPTY array because a room-tag write does not have a natural host to enumerate projects on — the registry's idempotent-skip absorbs no-op fanouts; if the cache is non-empty, the empty publish IS a delta that will cause connected clients to re-fetch (acceptable v1 semantics)."
  - "T-117-05-02 defense-in-depth on userMxid: the relay-room route checks that body.userMxid matches the authenticated user's users.mxid row. Matrix homeserver ALSO enforces this because matrix-room-tag-client uses the per-user token minted via ensureUserToken — double defense. Users with null mxid on record (pre-Phase-88 legacy accounts) → 403 (cannot verify → reject)."
  - "Path segment validation runs BEFORE any I/O: IDENTITY_KEY_RE for the session route, MATRIX_ROOM_ID_RE (/^!.+:.+$/ shape) for the relay-room route. Slug (body.project) is gated by PROJECT_SLUG_RE at every entry point (belt-and-suspenders: the primitives also validate)."
  - "Terminal-safety (T-117-05-05, ACCEPTED per plan): backend cannot cheaply distinguish terminal identity files from regular identity files. The frontend gates via rdpHostRow (D-08); if a forged project: lands on a terminal identity, the id-skill amendment gracefully no-ops per D-33 (project directory-existence check). No backend gate added in this plan — documented risk is inert."

requirements-completed: []  # Plan has no requirements: field in frontmatter

# Metrics
duration: ~7 min
completed: 2026-09-18
---

# Phase 117 Plan 117-05: Session-project-write + relay-room-project-tag routes Summary

## One-liner

Two new write-side routes for the project-membership carrier — `POST /identities/:key/project` (writes identity-file `project:` frontmatter via writeSessionProjectField) and `POST /relay-rooms/:roomId/project` (D-05a m.tag read-modify-write via setRoomProjectTag) — both JSON body per D-36a, both fire publishProjectListChanged on success, both mounted in database.ts.

## Performance

- **Duration:** ~7 min
- **Started:** 2026-09-18T19:43:50Z
- **Completed:** 2026-09-18T19:50:26Z
- **Tasks:** 2 (each a full TDD RED → GREEN cycle)
- **Files created:** 4 (2 routes + 2 test files)
- **Files modified:** 1 (database.ts — 2 imports + 2 mounts)

## Endpoints (verbatim)

### POST /identities/:key/project

- **Method:** POST
- **Path params:** `key` — must match `IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/`
- **Request body (JSON):** `{ hostId: number, project: string | null }`
  - `hostId` — positive integer; must be one of the caller's own hosts (resolveHostById filter)
  - `project` — MUST be present in body (missing → 400); either `null` (clears the field) OR a string matching `PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/`. Empty string is NOT valid.
- **Response 200:** `{ ok: true }`
- **Error responses:**
  - `400 { error: "hostId is required" }` — missing hostId
  - `400 { error: "hostId must be a positive integer" }` — malformed hostId
  - `400 { error: "identity key must match [a-z0-9_-]{1,64}" }` — bad key path segment
  - `400 { error: "project must be a string matching [a-z0-9-]{1,64} or null" }` — missing/wrong-type project
  - `400 { error: "project must be a valid slug matching [a-z0-9-]{1,64} or null" }` — bad slug value
  - `401 { error: "Unauthorized" }` — no JWT
  - `404 { error: "Host not found" }` — cross-user / unknown hostId (probe defense: NOT 403)
  - `500 { error: "failed to write session project" }` — writer throws (message logged only, T-117-05-06)
  - `504 { error: "Host unreachable" }` — SSH connect fails on REMOTE branch
- **Side effect:** `subscriptionRegistry.publishProjectListChanged(<enriched-projects-list>)` called exactly once after a successful write. The registry's JSON.stringify idempotent-skip absorbs the no-op fanout when the projects[] array is byte-identical to prior state (which is common for session-field writes because the projects entity list doesn't change on a session-field mutation).

### POST /relay-rooms/:roomId/project

- **Method:** POST
- **Path params:** `roomId` — must match `MATRIX_ROOM_ID_RE = /^![a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+$/`
- **Request body (JSON):** `{ userMxid: string, project: string | null }`
  - `userMxid` — full Matrix mxid matching `MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/`; MUST match the caller's `users.mxid` on record (defense-in-depth check).
  - `project` — same shape as session route (MUST be present, string OR null, empty string rejected, PROJECT_SLUG_RE on strings).
- **Response 200:** `{ ok: true }`
- **Error responses:**
  - `400 { error: "invalid_room_id" }` — roomId fails Matrix grammar
  - `400 { error: "userMxid is required" }` — missing / bad mxid shape
  - `400 { error: "project must be a string matching [a-z0-9-]{1,64} or null" }` — missing/wrong-type project
  - `400 { error: "project must be a valid slug matching [a-z0-9-]{1,64} or null" }` — bad slug value
  - `401 { error: "Unauthorized" }` — no JWT
  - `403 { error: "userMxid does not match authenticated user" }` — body.userMxid ≠ users.mxid, or users.mxid is null (pre-Phase-88 legacy)
  - `500 { error: "failed to set room project tag" }` — setter throws (message logged only, T-117-05-06)
  - `502 { error: "matrix write failed", code: <error> }` — Matrix returns non-2xx; forwards the error code (e.g., `matrix_room_tag_non_2xx`)
- **Side effect:** `subscriptionRegistry.publishProjectListChanged([])` called after a successful write. Empty array signals "consult /projects for the current list" — a room-tag write does not have a natural host to enumerate on because relay rooms are shared across the fleet.

## userId → mxid resolver

**No new module added.** The relay-room route uses the SAME pattern already in production at `src/backend/database/routes/relay-room-participants.ts:78-99` (lookupViewingUserMxid): a drizzle query on `users.mxid WHERE users.id = ?`. Copied inline as `lookupCallerMxid` in `relay-room-project-tag.ts:87-108` — the two functions are byte-parallel except for the error-log operation name.

Rationale for not factoring into a shared helper: the pattern is 5 lines including the try/catch; extracting it would require a new module path decision and increase coupling for zero deduplication benefit at N=2 call sites. If a third site adopts it, a `resolveCallerMxid(userId)` helper module becomes justified.

## Database.ts mount insertion points

Two imports added; two `app.use(...)` mount lines added.

### Imports (both added in the identity-related import block near :27)

```typescript
// Phase 117 Plan 117-05 (D-05, D-31, D-36a, D-37): user-initiated project
// membership write — POST /identities/:key/project ...
import sessionProjectWriteRoutes from "./routes/session-project-write.js";
```
(inserted immediately after `import identityArchiveRoutes from "./routes/identity-archive.js"`)

```typescript
// Phase 117 Plan 117-05 (D-05, D-05a, D-06, D-36a, D-37): /relay-rooms
// router — POST /:roomId/project performs the read-modify-write ...
import relayRoomProjectTagRoutes from "./routes/relay-room-project-tag.js";
```
(inserted immediately after `import projectListRoutes from "./routes/project-list.js"`)

### Mounts

```typescript
// database.ts:1949 (immediately after `app.use("/identities", identityArchiveRoutes);`)
app.use("/identities", sessionProjectWriteRoutes);
```

```typescript
// database.ts:2036 (immediately after `app.use("/relay-room", relayRoomParticipantsRoutes);`)
app.use("/relay-rooms", relayRoomProjectTagRoutes);
```

Both mounts land BEFORE the generic `/identities` (identitiesRoutes) mount at ~:1998, preserving Express's match-precedence discipline: the specific `/:key/project` and `/:roomId/project` sub-routes resolve here without falling through to the generic identityKey/routing handlers.

**Base path decision — /relay-rooms plural vs /relay-room singular:** The existing `/relay-room` base is already occupied by `/relay-room/create` and `/relay-room/:roomId/participants`. Mounting `/relay-rooms/:roomId/project` on the plural avoids any risk of colliding with a future `/relay-room/:roomId/...` route. The plan gave planner discretion here; plural chosen for isolation clarity.

## Test count and pass status

| Task | Test file | Tests |
| ---- | --------- | ----- |
| Task 1 (session-project-write) | src/backend/database/routes/session-project-write.test.ts | 15 |
| Task 2 (relay-room-project-tag) | src/backend/database/routes/relay-room-project-tag.test.ts | 10 |
| **Total** | | **25** |

All 25 pass; `npx tsc --noEmit -p tsconfig.json` exits 0.

`npx vitest related --run <the-3-touched-files>` shows **43 tests / 3 files / 0 regressions** across the touched files.

Test 1's "11 tests per plan" was expanded to 15 because Test 7 (body variants) was structurally 5 sub-cases (missing project / empty string / number / null / valid slug) — each expressed as an individual `it()` for signal clarity. Semantically equivalent to a single test with 5 assertions; the plan's "11+ tests passing" acceptance criterion is met.

## Commits (atomic per TDD gate)

| Task | Gate | Commit | Message |
| ---- | ---- | ------ | ------- |
| Task 1 | RED | `08154ab` | `test(117-05): add failing tests for session-project-write route (RED)` |
| Task 1 | GREEN | `0127735` | `feat(117-05): implement session-project-write route + database.ts mount (GREEN)` |
| Task 2 | RED | `e123278` | `test(117-05): add failing tests for relay-room-project-tag route (RED)` |
| Task 2 | GREEN | `cdd23b9` | `feat(117-05): implement relay-room-project-tag route + database.ts mount (GREEN)` |

## Acceptance criteria — all satisfied

### Task 1
- `router.post("/:key/project", ...)` present in session-project-write.ts (multi-line invocation; semantic equivalent to the single-line grep) ✓
- writeSessionProjectField + PROJECT_SLUG_RE + IDENTITY_KEY_RE combined grep count = 13 (≥ 3) ✓
- publishProjectListChanged grep count = 3 (≥ 1) ✓
- multipart/multer/upload.single grep count in code = 0 (only appears in doc comment negating it) ✓
- `app.use("/identities", sessionProjectWriteRoutes);` present exactly once at database.ts:1949 ✓
- `npx vitest run session-project-write.test.ts` exits 0 with 15 tests passing (plan said ≥ 11) ✓
- `npx tsc --noEmit -p tsconfig.json` exits 0 ✓

### Task 2
- `router.post("/:roomId/project", ...)` present in relay-room-project-tag.ts ✓
- setRoomProjectTag grep count = 9 (≥ 2 for import + call — exceeded due to docstring references) ✓
- PROJECT_SLUG_RE grep count = 4 (≥ 1) ✓
- multipart/multer grep count in code = 0 (only doc negation) ✓
- `app.use("/relay-rooms", relayRoomProjectTagRoutes);` present exactly once at database.ts:2036 ✓
- `npx vitest run relay-room-project-tag.test.ts` exits 0 with 10 tests passing (plan said ≥ 9) ✓
- `npx tsc --noEmit -p tsconfig.json` exits 0 ✓

### Overall verification
- `npx vitest run <both test files>` — 25/25 passing ✓
- 2 mount lines + 2 imports in database.ts (grep `sessionProjectWriteRoutes\|relayRoomProjectTagRoutes` = 4) ✓
- No push / build / deploy ✓
- No STATE.md / ROADMAP.md edits ✓

## Deviations from Plan

**None. Plan executed exactly as written.**

Notable planner-discretion decisions made during execution (all pre-authorized by the plan):

1. **Test 4 auth-surface implementation choice (relay-room route Test 4):** The plan gave discretion between "add a userId→mxid resolver" and "defer to Matrix's own auth". Chose to add the check inline using the byte-parallel pattern already at relay-room-participants.ts:78-99 — no new module, no cross-module coupling, defense-in-depth held. Test 4 asserts 403 on mismatch; Test 10 additionally asserts 403 when the user has no mxid on record (pre-Phase-88 legacy). Documented under "userId → mxid resolver" section above.

2. **Mount base path — /relay-rooms plural:** The plan noted "planner picks; recommend /relay-rooms plural to avoid path collision". Chose plural. Documented under "Database.ts mount insertion points".

3. **Test 7 for setRoomProjectTag AdminErr — 502 forwarding:** The plan gave discretion between "forward the Matrix status" and "return 502 with the error code". Chose 502 uniformly with the Matrix error code in the response body (`code: matrix_room_tag_non_2xx`). Distinguishes Skynet-side errors (500) from Matrix-side errors (502) cleanly.

4. **publishProjectListChanged payload shape on relay-room route:** The plan noted the projects[] array itself does not change on a room-tag write, so the payload is either the current list or an empty array. Chose empty array because a relay-room write does not have a natural host to enumerate projects on (relay rooms are shared across the fleet). The registry's idempotent-skip absorbs no-op fanouts; if the client's cached array is non-empty, the empty publish causes a re-fetch on the next tick (acceptable v1 semantics). Documented under D-37 in key-decisions.

5. **"Explicit project key required in body" invariant:** The plan's Test 7 asserted "body without project → 400" — I made this a strict "'project' must be present in body" check (using `"project" in body`), not just "project is not undefined". This forces the caller to make an explicit assign/clear/set choice; ambiguous "no field" is not a valid gesture. Distinct from session-file semantics (absent field ⇒ no `project:` key emitted) — the request body vocabulary is stricter than the storage vocabulary.

## Threat model outcome

| Threat ID | Category | Disposition | Held |
|-----------|----------|-------------|------|
| T-117-05-01 | EoP (cross-user hostId) | mitigate | ✓ session-project route: resolveHostById(hostId, userId) → 404 (Test 8) |
| T-117-05-02 | EoP (writing m.tag as another user) | mitigate | ✓ relay-room route: users.mxid lookup + strict equality; pre-Phase-88 null-mxid users → 403 (Tests 4, 10) |
| T-117-05-03 | Tampering (malicious roomId) | mitigate | ✓ MATRIX_ROOM_ID_RE gate + encodeURIComponent inside setRoomProjectTag (117-02) (Test 5) |
| T-117-05-04 | Tampering (malicious slug in tag key) | mitigate | ✓ PROJECT_SLUG_RE gate at route AND setRoomProjectTag (Test 6) |
| T-117-05-05 | Tampering (forged project: on terminal) | accept | id-skill amendment gracefully no-ops per D-33 (project dir missing → skip); backend cannot cheaply distinguish terminal from non-terminal identity files without an extra frontmatter read on every write — accepted risk |
| T-117-05-06 | Info disclosure (500 body leak) | mitigate | ✓ Fixed error shape; err.message → databaseLogger.error only; Tests 10 (session) + 8 (relay-room) assert no leak strings in response body |
| T-117-05-07 | Tampering (wire-event array reflects all state) | accept | By design per D-37 — full array. Registry idempotent-skip absorbs no-op fanouts. Empty array on relay-room route causes benign re-fetch (documented). |
| T-117-05-SC | Tampering (npm slopsquat) | accept | ✓ Zero new packages installed |

## Threat Flags

None. Both new endpoints sit under authenticateJWT + one of {resolveHostById(hostId,userId), users.mxid strict-equality check} — the same trust boundary posture already covered by the plan's threat model. No new network surface introduced.

## Known Stubs

None. Every code path is fully wired end-to-end. Both route handlers complete the full validate → auth → I/O → publish → response path with no placeholder returns, no TODO markers, no "coming in the next plan" comments.

## Frontend hand-off (Wave 3 → Wave 4 DnD)

The DnD drop-lane in Wave 4 (117-08) can now POST:

```typescript
// Identity conversation (drops with rdpHostRow === false only per D-08)
authApi.post(`/identities/${identityKey}/project`, { hostId, project: slugOrNull });

// Relay-room conversation
authApi.post(`/relay-rooms/${roomId}/project`, { userMxid, project: slugOrNull });
```

Both endpoints return `200 { ok: true }` on success. The client SHOULD wait for the subsequent `project-list-changed` wire frame OR the natural `/projects` refetch cycle to re-render the sidebar buckets — the response body deliberately omits the derived project structure because the sidebar re-derives it from `useConversations() × useProjects()` at snapshot time per D-39.

**409 not applicable** on these routes (unlike 117-04's create route): the writes always succeed or fail with a specific error code — there is no "duplicate" state to signal.

**Terminal-safety gate lives on the frontend:** the drop lane MUST refuse `rdpHostRow === true` payloads per D-08 (Wave 4 responsibility). This plan documents T-117-05-05 as accepted risk; if a forged terminal-project write ever lands, the id-skill amendment gracefully no-ops per D-33.

## Self-Check: PASSED

Files present:
- FOUND: `src/backend/database/routes/session-project-write.ts` (260 lines)
- FOUND: `src/backend/database/routes/session-project-write.test.ts` (500 lines)
- FOUND: `src/backend/database/routes/relay-room-project-tag.ts` (292 lines)
- FOUND: `src/backend/database/routes/relay-room-project-tag.test.ts` (426 lines)
- FOUND: `src/backend/database/database.ts` (modified — 2 imports + 2 mounts, +18 lines net)

Commits present in git log (`git log --oneline -6`):
- FOUND: `08154ab` — test(117-05) Task 1 RED
- FOUND: `0127735` — feat(117-05) Task 1 GREEN
- FOUND: `e123278` — test(117-05) Task 2 RED
- FOUND: `cdd23b9` — feat(117-05) Task 2 GREEN

All 4 TDD-gate commits confirmed via `git log --oneline`; 25 tests pass under scoped vitest; tsc --noEmit clean; scoped related-test regression scan across the 3 touched files shows 43 passing / 0 failing / 0 skipped.
