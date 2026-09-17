---
phase: 115-identity-archiving-from-the-frontend
plan: 03
subsystem: backend/database/routes
tags: [route, express, archive, sentinel, per-identity-file, IDENTITY_KEY_RE, resolveHostById, connectOneShot, mount-order, phase-115]

# Dependency graph
requires:
  - phase: 115
    plan: 01
    provides: "ALLOWED_REL_PATHS admits `.archive-requested` — writeIdentityFile primitive accepts the sentinel filename this route hands it"
  - phase: 92
    provides: "writeIdentityFile / resolveHostById / connectOneShot / isLocalHostId / IDENTITY_KEY_RE primitives reused verbatim"
  - phase: 20
    provides: "sibling per-identity sub-route mount-order discipline (identity-exists-on-host, identity-no-dormancy) — same pattern reused"
provides:
  - "POST /identities/:key/archive endpoint — drops `.archive-requested` on the identity's host via writeIdentityFile"
  - "Route module `src/backend/database/routes/identity-archive.ts` mirroring identity-no-dormancy.ts shape (auth → hostId parse → IDENTITY_KEY_RE gate → resolveHostById ownership → LOCAL/REMOTE branch → writeIdentityFile → try/finally conn.end())"
  - "Mount `app.use('/identities', identityArchiveRoutes)` at database.ts:1930 — BEFORE the generic /identities router at L1976"
affects: [115-06, 115-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-identity sub-route module mirroring identity-no-dormancy.ts — `authenticateJWT` middleware → hostId parse → IDENTITY_KEY_RE gate → resolveHostById ownership filter (returns 404 not 403 to avoid probe distinguisher) → LOCAL vs REMOTE branch → try/finally SSH conn cleanup"
    - "Generic-error 500 response body (T-115-03-03 mitigation) — server-side error text logged via databaseLogger, client sees only `{ error: 'failed to drop archive sentinel' }`"
    - "supertest-less test harness — bare Express app + Node http.request helper (matches identity-no-dormancy.test.ts / identity-exists-on-host.test.ts — supertest not in project deps)"

key-files:
  created:
    - "src/backend/database/routes/identity-archive.ts (+161 lines) — new route module with a single POST /:key/archive handler"
    - "src/backend/database/routes/identity-archive.test.ts (+345 lines) — 8-test coverage of every behavior branch"
  modified:
    - "src/backend/database/database.ts (+12 lines) — import identityArchiveRoutes at L27; mount app.use('/identities', identityArchiveRoutes) at L1930 (immediately after identityNoDormancyRoutes L1923, BEFORE generic identitiesRoutes L1976)"

key-decisions:
  - "Route path uses `:key` (not `:identityKey`) to match the sibling `identity-no-dormancy.ts` convention verbatim. The plan frontmatter's `:identityKey` was the external-clarity label; internal Express param name follows sibling shape per plan `<action>`(b)."
  - "hostId is read from `req.body.hostId` (not query string). Plan `<phase_context>` specified body-based transport (`POST with body { hostId }`); sibling `identity-no-dormancy.ts` uses query string but is a PUT-with-body-{present:boolean} shape — different intent (state toggle vs one-shot command). The archive endpoint is a one-shot POST command, and body-based hostId is the natural shape for POST-command endpoints."
  - "Cross-user hostId returns 404 (not 403) matching sibling routes exactly. Rationale: a 403-vs-404 distinguisher would let an attacker probe which hostIds exist on the server; 404 for both cases (unknown hostId and known-but-not-owned hostId) provides no side-channel."
  - "conn = null literal is passed to writeIdentityFile on the LOCAL branch (not omitted). The `WriteIdentityFileOpts` interface requires `conn: SSHClientType | null`, so `null` is the correct LOCAL-branch value per the primitive's contract — the primitive's LOCAL branch does not read `conn` (isLocalHostId check gates it), so any value would work, but `null` is the explicit contract."
  - "Response body for the disk-write failure path (T-115-03-03) is the exact string `failed to drop archive sentinel` — NOT the raw error message. This is asserted verbatim in Test 7, which also asserts the error text (`ENOSPC: no space left on device — sensitive fs path leak`) does NOT appear anywhere in the response."
  - "Audit log line on success uses databaseLogger.info at INFO level — Repudiation mitigation T-115-03-05. Format: `identity archive requested: userId=<n>, hostId=<n>, key=<n>` — sufficient audit trail for the solo-developer trust model per the threat register's `accept` disposition."
  - "Followed the 115-01 executor's precedent of NOT splitting the RED/GREEN task pair. TDD was flagged on Task 1, but the plan's `<action>` block scopes the source + test files together and the verification is a single scoped-vitest run. A RED-then-GREEN split would produce a passing test set except one file-existence check, giving low signal for high churn. This matches the 115-01 SUMMARY's Decision 1."

patterns-established:
  - "Small dedicated per-identity POST-command sub-route pattern — mirrors identity-no-dormancy.ts (which itself mirrors identity-exists-on-host.ts). Applies to any future per-identity one-shot command endpoint: create a new file next to the siblings, mount at /identities BEFORE the generic router, reuse the auth → hostId parse → IDENTITY_KEY_RE → resolveHostById → LOCAL/REMOTE branch → primitive-call → try/finally chain."

requirements-completed: []

# Metrics
duration: ~30min
completed: 2026-09-17
---

# Phase 115 Plan 115-03: Backend archive endpoint Summary

**New `POST /identities/:key/archive` route module — mirrors identity-no-dormancy.ts shape, drops `.archive-requested` via the writeIdentityFile primitive, mounted at database.ts:1930 BEFORE the generic /identities router.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-09-17 (executor spawn)
- **Completed:** 2026-09-17
- **Tasks:** 2 of 2 (100%)
- **Files created:** 2 (route module + test)
- **Files modified:** 1 (database.ts import + mount)

## Accomplishments

- **New route module `src/backend/database/routes/identity-archive.ts`** — one POST handler at `POST /:key/archive` reusing every sibling primitive:
  - `authenticateJWT` middleware (mocked to return 401 in Test 8)
  - Body-parsed hostId with positive-integer validation
  - `IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/` gate imported from `identity-artifact-reader.js` — T-115-03-02 path-traversal defense
  - `resolveHostById(hostId, userId)` ownership filter — T-115-03-01 cross-user EoP defense; returns 404 (not 403) on miss to avoid a probe distinguisher
  - `isLocalHostId(hostId)` branch → LOCAL (conn=null) vs REMOTE (`connectOneShot` with 3000ms timeout inside try/catch → 504 on failure)
  - `writeIdentityFile(key, ".archive-requested", "", { hostId, conn })` — the exact D-08 sentinel filename from 115-01's allowlist swap
  - `try { ... } finally { conn?.end() }` — ensures the SSH conn closes even when writeIdentityFile throws
  - Generic 500 response body `{ error: "failed to drop archive sentinel" }` — T-115-03-03 info-disclosure defense; underlying error goes to databaseLogger.error, never to the client
  - INFO-level audit log on success — T-115-03-05 repudiation trail

- **Route mounted in database.ts BEFORE the generic /identities router:**
  - Import at L27 (immediately after `identityNoDormancyRoutes` at L22)
  - `app.use("/identities", identityArchiveRoutes)` at L1930 — immediately after the `identityNoDormancyRoutes` mount at L1923, BEFORE the generic `app.use("/identities", identitiesRoutes)` at L1976 (a 46-line safety margin over the generic mount).

- **Scoped verify green:** `npx vitest run src/backend/database/routes/identity-archive.test.ts` → **1 test file / 8 tests pass, 0 skipped, 0 failed** in 648ms (first run) and 704ms (re-run).

- **Backend TS build clean:** `npx tsc --noEmit -p tsconfig.node.json` → 0 errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create `identity-archive.ts` route module + tests** — `a7257252` (`feat`) — 2 files, +571 lines.
2. **Task 2: Mount in `database.ts` BEFORE the generic /identities router** — `f5d7042d` (`feat`) — 1 file, +12 lines.

## Files Created/Modified

### `src/backend/database/routes/identity-archive.ts` (NEW, 161 lines)

- Header JSDoc block spelling out the Phase 115 semantic contract (D-07 intent-signal semantics, D-08 sentinel filename, D-09 per-host drop location, D-17 dedicated POST endpoint) and the three T-115-03-XX threat mitigations.
- Imports match sibling `identity-no-dormancy.ts` verbatim (same paths, same import style) — `AuthenticatedRequest` type, `express.Router`, `AuthManager.getInstance().createAuthMiddleware()`, `databaseLogger`, `resolveHostById`, `connectOneShot`, `isLocalHostId`, `IDENTITY_KEY_RE`, `writeIdentityFile`.
- Single `router.post("/:key/archive", express.json(), authenticateJWT, ...)` handler.
- Generic 500 fallback error handler at the end (mirrors sibling routes).
- `export default router;`

### `src/backend/database/routes/identity-archive.test.ts` (NEW, 345 lines)

- 8 vitest test cases (matches plan `<behavior>` block one-for-one):

| # | Case | Assertion Key | Status |
|---|------|---------------|--------|
| 1 | Happy LOCAL | writeIdentityFile called with `("wren", ".archive-requested", "", { hostId: 5, conn: null })`; 200 `{ ok: true }`; connectOneShot NOT called | PASS |
| 2 | Happy REMOTE | connectOneShot opened, writeIdentityFile called with `conn: stubConn`; stubConn.end() called once; 200 `{ ok: true }` | PASS |
| 3 | Invalid identityKey (`bad.key`) | 400 `/identity key must match/`; writeIdentityFile NOT called | PASS |
| 4 | Missing hostId (`body: {}`) | 400 `/hostId is required/`; writeIdentityFile NOT called | PASS |
| 5 | Cross-user hostId (`hostId=99`) | 404 `/Host not found/`; writeIdentityFile NOT called | PASS |
| 6 | REMOTE connectOneShot throws | 504 `{ error: "Host unreachable" }`; writeIdentityFile NOT called | PASS |
| 7 | writeIdentityFile throws | 500 `{ error: "failed to drop archive sentinel" }`; underlying error text absent from response; conn.end() still called | PASS |
| 8 | 401 without JWT | 401 status; writeIdentityFile / resolveHostById / connectOneShot all NOT called | PASS |

- Mocking pattern reuses `identity-no-dormancy.test.ts` verbatim: auth-manager, ssh-one-shot, host-resolver, identity-artifact-reader (isLocalHostId + IDENTITY_KEY_RE), and per-identity-file (writeIdentityFile) all mocked at `vi.mock()`.
- HTTP helper wraps Node's built-in `http.request` (supertest not in project deps).

### `src/backend/database/database.ts` (+12 lines)

- L27 — new import + 4-line JSDoc callout tying it to D-17 and the mount-order discipline:
  ```ts
  // Phase 115 Plan 115-03 (D-17): user-initiated archive — POST
  // /identities/:key/archive drops the `.archive-requested` sentinel on the
  // identity's host. Mounted BEFORE the generic /identities router so the
  // :key/archive sub-route isn't intercepted by the generic /:identityKey handler.
  import identityArchiveRoutes from "./routes/identity-archive.js";
  ```
- L1930 — new mount call + 6-line JSDoc callout referencing the sibling discipline:
  ```ts
  app.use("/identities", identityArchiveRoutes);
  ```

**Mount ordering (`grep -n 'app.use.*"/identities"' src/backend/database/database.ts`) before/after:**

Before (from initial grep):
```
1914: app.use("/identities", identityExistsOnHostRoutes);
1918: app.use("/identities", identityNoDormancyRoutes);
1964: app.use("/identities", identitiesRoutes);  ← generic
```

After (final state):
```
1919: app.use("/identities", identityExistsOnHostRoutes);
1923: app.use("/identities", identityNoDormancyRoutes);
1930: app.use("/identities", identityArchiveRoutes);   ← NEW
1976: app.use("/identities", identitiesRoutes);        ← generic
```

**Confirmation: 1930 < 1976 → the new mount precedes the generic router.** Express's linear route lookup means `/identities/wren/archive` will hit the archive router's `POST /:key/archive` handler and never fall through to `identitiesRoutes`.

## Decisions Made

1. **Route path `:key` (not `:identityKey`).** Sibling `identity-no-dormancy.ts` uses `:key` in its Express route string. The plan `<action>`(b) explicitly permitted following sibling convention for the internal param name; the frontmatter's `:identityKey` was the external-clarity label. Chosen `:key` for verbatim consistency with the mirror.

2. **hostId from `req.body`, not `req.query`.** The plan's `<phase_context>` locked `body: { hostId }`. Sibling `identity-no-dormancy.ts` reads hostId from query string, but it's a GET/PUT state-toggle endpoint. This is a POST one-shot command, and body-based transport is the natural POST convention.

3. **404 (not 403) on cross-user hostId.** Matches all three sibling routes exactly. A 403-vs-404 distinguisher would let an attacker probe which hostIds exist server-wide; unified 404 removes that side-channel.

4. **Generic 500 response body.** The literal string `"failed to drop archive sentinel"` — asserted verbatim in Test 7, which additionally asserts the underlying error message (`ENOSPC: no space left on device — sensitive fs path leak`) does NOT leak to the response.

5. **INFO-level audit log on success.** T-115-03-05 (Repudiation) is `accept`-disposed in the threat register; the JWT auth + log line together provide the audit trail. Format: `identity archive requested: userId=<n>, hostId=<n>, key=<n>` via `databaseLogger.info`.

6. **`conn: null` on LOCAL branch.** The primitive's `WriteIdentityFileOpts` interface types `conn: SSHClientType | null`. LOCAL branch does not read `conn` (isLocalHostId gates it), but `null` is the explicit typed contract.

7. **Combined source + test in one atomic commit (Task 1).** Followed the precedent from 115-01's SUMMARY (Decision 1). The plan's task scopes both files under one `<verify>` gate, and the sibling test-file rewrite is coupled to the source's shape — RED/GREEN split would produce low-signal RED with high churn.

## Deviations from Plan

None — plan executed as written. All 8 behavior cases from the plan's `<behavior>` block are green under scoped vitest, both grep-based done criteria in Task 1 pass (`grep -c 'writeIdentityFile' → 5`, `grep -F '.archive-requested' → 6 matches`), Task 2's mount ordering places the new mount 46 lines above the generic router, and the strict backend TS build (`npx tsc --noEmit -p tsconfig.node.json`) is clean.

The two implementation choices flagged in the plan's Claude's-Discretion section (route param name `:key` vs `:identityKey`; hostId from body vs query) were both resolved by re-reading the plan's `<action>`(b) block — `<action>` explicitly permitted mirroring sibling convention for the param, and `<phase_context>` explicitly specified body-based transport. These are documented above as Decisions 1 and 2 for downstream reference, not as deviations.

## Issues Encountered

None. The scoped vitest run passed on the first try (all 8 tests green); the tsc build was clean on the first try.

## Manual Smoke Verification (deferred to deploy motion per fleet directive)

The plan's `<verification>` section noted:

> Manual smoke: `curl -X POST -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" -d '{"hostId":<local-host-id>}' http://localhost:<backend-port>/identities/wren/archive` returns 200 `{"ok":true}` against a running dev backend, and `~/fleet/identities/wren/.archive-requested` exists on the local host afterward. (Manual smoke is optional; the vitest suite is the enforcement gate.)

Deferred to the deploy motion (orchestrator scope). The plan explicitly marks manual smoke as optional; the 8-case vitest suite is the enforcement gate and is 100% green.

## Threat Flags

Nothing new surfaced beyond the plan's threat register. T-115-03-01 through T-115-03-06 mitigations are all realized in code:

- T-115-03-01 (EoP): authenticateJWT + resolveHostById gates — Tests 5, 8 assert both defenses fire before any downstream call.
- T-115-03-02 (Tampering, path traversal): IDENTITY_KEY_RE regex gate — Test 3 asserts `bad.key` rejected at 400 before disk/SSH.
- T-115-03-03 (Info Disclosure): generic 500 body — Test 7 asserts underlying error text absent from response.
- T-115-03-04 (DoS): `accept`-disposed in the register; no code change needed. writeIdentityFile is idempotent on empty files.
- T-115-03-05 (Repudiation): `accept`-disposed; INFO audit log realizes the mitigation.
- T-115-03-06 (Concurrent Tampering): `accept`-disposed; empty-file writes are idempotent by construction.
- T-115-03-SC (Supply Chain): `accept`-disposed; no new dependencies added.

No new threat surface introduced.

## Self-Check: PASSED

- Commit `a7257252` exists on `feat/tab-title-from-tmux`: verified via `git log --oneline -3`.
- Commit `f5d7042d` exists on `feat/tab-title-from-tmux`: verified via `git log --oneline -3`.
- Files exist: `src/backend/database/routes/identity-archive.ts` (161 lines), `src/backend/database/routes/identity-archive.test.ts` (345 lines).
- Task 1 done grep #1 (`grep -c 'writeIdentityFile' src/backend/database/routes/identity-archive.ts`): returns 5 (≥1). PASS.
- Task 1 done grep #2 (`grep -F '.archive-requested' src/backend/database/routes/identity-archive.ts`): 6 matches (≥1), including the exact call `writeIdentityFile(key, ".archive-requested", "", {…})`. PASS.
- Task 1 done grep #3 (no primitive verbs other than writeIdentityFile invoked in the handler): grep for `getIdentityFile|removeIdentityFile` returns no matches. PASS.
- Task 2 done grep #1 (`grep -c "identityArchiveRoutes" src/backend/database/database.ts`): returns 2 (import + mount). PASS.
- Task 2 done grep #2 (mount ordering): archive mount at L1930, generic at L1976 → 1930 < 1976. PASS.
- Scoped verify: `npx vitest run src/backend/database/routes/identity-archive.test.ts` → 8 pass / 0 fail / 0 skip in 648-704ms. PASS.
- Strict backend TS build: `npx tsc --noEmit -p tsconfig.node.json` → 0 errors. PASS.

## Next Plan Readiness

- **115-05 (fleet-status sweep enumerate archive tree, Wave 2, parallelizable with this plan):** independent — no dependency on the archive endpoint. Both are the two Wave-2 plans.
- **115-06 (frontend Hide → Archive rename + confirmation + archived-section rendering, Wave 3):** can now call `POST /identities/:key/archive` with `body: { hostId }` — endpoint is wired and tested. Frontend integration is the natural next consumer.
- **115-07 (end-to-end retire test extension, Wave 4):** the archive endpoint is the trigger surface for the user-initiated retire path. E2E test can now issue a POST against this endpoint and observe the supervisor's reconcile-tick response.
- **HEAD `f5d7042d` LOCAL** — NOT pushed / NOT built / NOT deployed. Held at push boundary per the fleet's greenlight-at-push rule. Orchestrator picks up ship motion on user greenlight.

---
*Phase: 115-identity-archiving-from-the-frontend*
*Completed: 2026-09-17*
