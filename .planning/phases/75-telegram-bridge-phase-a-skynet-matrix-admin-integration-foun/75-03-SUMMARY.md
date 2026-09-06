---
phase: 75-telegram-bridge-phase-a-skynet-matrix-admin-integration-foun
plan: 03
subsystem: backend-routes
tags: [matrix, admin-route, mxid, audit-log, tdd]

# Dependency graph
requires:
  - phase: 75
    plan: 01
    provides: users.mxid column + matrix_admin_creds table (Wave 1)
provides:
  - POST /users/:id/mxid endpoint (admin-gated, MXID_RE-validated, previousMxid audit-logged)
  - MXID_RE module-scoped regex constant reusable if other routes ever need Matrix-id validation
  - Test scaffold for admin-gated user-scoped POST routes (bare Express + Node http.request, vi.hoisted mock refs)
affects: [75-04, 75-05, telegram-bridge-phase-b, provisioning-runbook, Ashley/Zoe/Laura one-shot import]

# Tech tracking
tech-stack:
  added: []  # zero new npm packages
  patterns: [
    "MXID_RE regex-gate BEFORE any DB touch (Phase 69 IDENTITY_KEY_RE post-review precedent)",
    "In-handler .isAdmin defense-in-depth on top of authenticateJWT middleware (sibling POST /make-admin precedent)",
    "previousMxid capture BEFORE UPDATE for grep-recoverable audit (T-75-12 accept-risk mitigation)",
    "Non-fatal saveMemoryDatabaseToFile in try/catch (host-autostart-routes L173-181 precedent)",
    "vi.hoisted for mock refs shared with vi.mock factories (avoids the top-level-variable hoisting error)"
  ]

key-files:
  created:
    - src/backend/database/routes/user-admin-routes.test.ts (561 lines, 10 tests)
  modified:
    - src/backend/database/routes/user-admin-routes.ts (+166 lines — MXID_RE + POST /:id/mxid handler)

key-decisions:
  - "URL shape is POST /users/:id/mxid (verb-noun dedicated route, matches sibling POST /make-admin) — not PATCH /users/:id (no generic user-patch endpoint exists) and not a new base path (existing nginx ^/users(/.*)?$ regex covers it, no nginx changes needed). Locked in plan.md decision D-OQ1."
  - "MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/ — lowercase-only localpart per Matrix spec (agent-relay SKILL.md:148); 512-char total cap naturally enforced by the {1,255} quantifiers. Character sets picked from Matrix spec localpart + conservative hostname."
  - "Defense-in-depth admin gate: authenticateJWT middleware (session verify) + in-handler db.select().where(users.id, userId).isAdmin re-check. Matches sibling POST /make-admin at user-admin-routes.ts:152-158 exactly — deliberately chose in-handler over createAdminMiddleware for consistency with the file's existing pattern."
  - "previousMxid capture semantics: null on first-set (never Boolean-false/undefined — plan.md L118 explicit) so grep-forensics tooling can rely on the audit-log field always being present. Captured BEFORE the UPDATE runs so the log records the full state transition (from → to)."
  - "Test scaffold: bare Express + Node http.request (no supertest dep — matches identities.put-disk.test.ts:33 precedent). vi.hoisted() for the two mock refs (saveMemoryDatabaseToFileMock and authLoggerMock) so they exist before the vi.mock factories run."

patterns-established:
  - "Pattern: for admin-gated user-scoped POST /users/:id/<action> routes, use in-handler .isAdmin re-verify on top of the passed-in authenticateJWT middleware — matches every other handler in user-admin-routes.ts and keeps the router.post() wiring one-arg-shorter (no need to combine middlewares)."
  - "Pattern: for audit logs that record state mutations, capture the previous value BEFORE the UPDATE runs and include it in the log line as `previousMxid` (or equivalent). This is what turns replay-overwrite classes of threats from MITIGATE-required into ACCEPT — the mutation is grep-recoverable from the central log."
  - "Pattern: vi.hoisted() destructuring for mock refs shared with vi.mock() factory closures. Cleaner than the alternative of accessing the module's exported functions via `await import()` inside beforeEach."

requirements-completed: [MXA-04]

# Metrics
duration: 10min
completed: 2026-09-06
---

# Phase 75 Plan 03: POST /users/:id/mxid admin-gated handler Summary

**Landed the admin-gated backend endpoint that registers an externally-created Matrix mxid against a Skynet user row, with a previousMxid-capturing audit log that makes T-75-12 (replay-overwrite) a grep-recoverable accept-risk rather than a MITIGATE-required threat.**

## Performance

- **Duration:** ~10 minutes
- **Started:** 2026-09-06T07:06:36Z
- **Completed:** 2026-09-06T07:16:33Z
- **Tasks:** 2 completed (both TDD-style — impl then tests, both green on first pass with one small vi.hoisted fix in test setup)
- **Files created:** 1 (user-admin-routes.test.ts, 561 lines, 10 tests)
- **Files modified:** 1 (user-admin-routes.ts, +166 lines)
- **Test cases added:** 10 (all green)
- **New npm dependencies:** 0

## Accomplishments

- **POST /users/:id/mxid** endpoint lands at the same registerUserAdminRoutes mount point as POST /make-admin — auto-mounts under `/users/:id/mxid` when database.ts:1813 mounts the users router at `/users`.
- **MXID_RE regex** gate runs BEFORE any DB touch, URL construction, or shell interpolation — invalid mxids (wrong type, missing `@`, uppercase localpart, missing `:`, oversize, shell-metacharacter payloads) return 400 with zero side effects (Test 1-4 verify).
- **Defense-in-depth admin gate**: JWT verified by authenticateJWT middleware, isAdmin re-verified by in-handler SELECT — matches sibling POST /make-admin precedent at user-admin-routes.ts:152-158 exactly (T-75-11 mitigation, Test 6 verifies 403 for non-admin).
- **Missing-target 404** without any DB mutation and without an audit-log entry (Test 7).
- **Happy path** persists via Drizzle parameterized `db.update(users).set({ mxid }).where(eq(users.id, targetId))`, calls saveMemoryDatabaseToFile in try/catch (non-fatal per host-autostart precedent), and emits one authLogger.info audit line per successful registration (Test 8).
- **Persist failure is non-fatal** — the RAM SQLite update stands even when saveMemoryDatabaseToFile throws; the next mutation-driven save flushes it to disk. authLogger.error is called with `operation: "mxid_save_failed"` so the failure is grep-recoverable (Test 9).
- **OVERWRITE audit** — the second POST for the same target records `previousMxid: "@old:host"` (the value being overwritten), NOT null and NOT the new value. This is what makes T-75-12 (replay-overwrite) an ACCEPT rather than a MITIGATE — any accidental overwrite is fully reconstructable from the central log (Test 10).

## Task Commits

Each task committed atomically:

1. **Task 1 — POST /users/:id/mxid handler impl:** `0431f3c2` (feat)
2. **Task 2 — 10 test cases for the new handler:** `b06d30e3` (test)

## Files Created/Modified

### Created (Task 2)

- `src/backend/database/routes/user-admin-routes.test.ts` (561 lines) — 10 Vitest cases against a bare Express + Node http.request test app. `vi.hoisted()` for the two mock refs (`saveMemoryDatabaseToFileMock`, `authLoggerMock`) so they exist before the `vi.mock()` factories run. Uses an in-memory `dbState` shim with a chainable Drizzle mock — mirrors the identities.put-disk.test.ts scaffold pattern.

### Modified (Task 1)

- `src/backend/database/routes/user-admin-routes.ts` (+166 lines) — added:
  - Module-scoped `MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/` constant with full-context comment linking to Matrix spec (agent-relay/SKILL.md:148) + Phase 69 IDENTITY_KEY_RE precedent (STATE.md L547) + threat register T-75-10.
  - `router.post("/:id/mxid", authenticateJWT, async (req, res) => { ... })` handler inserted immediately after POST /make-admin (~L212). Body mirrors make-admin exactly: extract userId + targetId + mxid → regex-validate → SELECT admin (403 if !isAdmin) → SELECT target (404 if missing) → capture `previousMxid = targetUser[0].mxid ?? null` → UPDATE → try/catch saveMemoryDatabaseToFile → authLogger.info with `{operation, adminId, targetUserId, previousMxid, mxid}` → `res.json({ok:true})`.
  - OpenAPI JSDoc comment describing the new endpoint for spec-generation tooling.

## Exact URL + request/response shape (per plan.md § Output item 1)

```
POST /users/:id/mxid

Request:
  Headers:  Content-Type: application/json
            (session cookie / Bearer JWT — verified by authenticateJWT)
  Body:     { "mxid": "@localpart:server_name" }

Responses:
  200 { "ok": true }                                       — mxid registered
  400 { "error": "mxid must match @localpart:server_name" } — bad mxid shape
  401 { "error": "Unauthorized" }                          — missing/invalid JWT (from middleware)
  403 { "error": "Not authorized" }                        — caller is not admin
  404 { "error": "User not found" }                        — targetId missing from users
  500 { "error": "Failed to register mxid" }               — unexpected exception
```

## MXID_RE used (per plan.md § Output item 2)

```javascript
const MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/;
```

- **Localpart character set:** `[a-z0-9._=/+-]` per Matrix spec (lowercase-only, agent-relay/SKILL.md:148).
- **Server_name character set:** `[a-z0-9.-]` (conservative — hostnames and dotted-numeric IP forms; no colons/brackets because Skynet's relay lives at a plain tailnet hostname, IPv6-literal ports are out of scope).
- **Length cap:** 255 localpart + 1 `@` + 255 server_name + 1 `:` = 512 chars total, naturally enforced by the `{1,255}` quantifiers. Rejects empty localpart, empty server_name.
- **Rejects:** wrong type (Test 2), missing `@` (Test 4), uppercase in localpart (Test 3), any shell-metacharacter payload not in the whitelist, any string exceeding 512 chars.

## Test count + green status (per plan.md § Output item 3)

- **Tests:** 10 / 10 green (single `describe("POST /users/:id/mxid — Phase 75 Plan 03 (MXA-04)")` block)
- **Verification command:** `npx vitest run src/backend/database/routes/user-admin-routes.test.ts` → all 10 pass
- **Typecheck:** `npx tsc --noEmit` → exit 0 (no errors added by Plan 75-03; the whole repo tsc-clean was preserved)

Test coverage:
- Tests 1-4: MXID_RE regex-gate (bad shape, wrong type, uppercase localpart, missing `@`) — all 400 with no DB touch, no audit log
- Test 5: missing JWT → 401 (mocked authenticateJWT middleware)
- Test 6: caller not admin → 403, no update, no audit
- Test 7: target user id missing → 404, no update, no audit
- Test 8: happy FIRST-SET → 200, DB updated, saveMemoryDatabaseToFile called once, authLogger.info with `previousMxid: null`
- Test 9: saveMemoryDatabaseToFile throws → still 200 (non-fatal), authLogger.error with `operation: "mxid_save_failed"`, authLogger.info still fires
- Test 10: OVERWRITE — two POSTs for same target, second call's `previousMxid` equals first call's `mxid` (T-75-12 grep-recoverability proof)

## Audit-log line format (per plan.md § Output item 4)

```
authLogger.info("mxid registered for user", {
  operation: "mxid_register",
  adminId:       "<Skynet user id of the calling admin>",
  targetUserId:  "<Skynet user id whose mxid was set>",
  previousMxid:  null | "@<old_localpart>:<old_server>",
  mxid:          "@<new_localpart>:<new_server>",
})
```

**previousMxid field shape (grep-forward reference):**
- **null** — first set (the target user had no mxid before this call). Serializes to JSON `null`.
- **quoted mxid string** — overwrite (the target user already had a mxid; the log records the value being overwritten).

**Never omitted, never `undefined`:** the handler explicitly coerces `targetUser[0].mxid ?? null` before logging, so `grep 'previousMxid'` in the central log ALWAYS matches every registration event. Grep-forensics tooling can rely on this shape.

**Adjacent log line on persist failure:**

```
authLogger.error("Failed to persist mxid registration to disk", <saveError>, {
  operation: "mxid_save_failed",
  targetId:   "<Skynet user id>",
})
```

## Runbook implications (per plan.md § Output item 5)

**One-shot import for Ashley, Zoe, Laura at Phase-75 deploy time:**

Each of the three hand-made human accounts (Ashley `@ashley:thenasty.taild9b663.ts.net`, Zoe `@zoe:thenasty.taild9b663.ts.net`, Laura `@laura:thenasty.taild9b663.ts.net`) gets ONE POST at deploy time:

```bash
curl -si -X POST \
  -H "Cookie: <admin-jwt-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"mxid":"@ashley:thenasty.taild9b663.ts.net"}' \
  http://localhost:30001/users/<ashley-skynet-user-id>/mxid
```

Expected result: `200 {"ok":true}`, and the central log records ONE line with `previousMxid: null` per user (because these three accounts have never had a mxid mapped before). Three POSTs total.

**New-user provisioning runbook (going forward):**

Every future human onboarding calls this endpoint as its final provisioning step, once per new user, always with `previousMxid: null` in the audit line (since a fresh Skynet user starts with `users.mxid = NULL`).

**Recovery path if a mxid gets accidentally overwritten:**

`grep 'mxid_register' <central-log-destination> | grep '<targetUserId>'` reconstructs the full sequence of mxid mappings for that user, with each line showing the previousMxid (what the value was BEFORE that write) and mxid (what it was set to). The MOST RECENT `previousMxid` is the correct value that got overwritten — re-POST that value to restore it. This is the T-75-12 accept-risk mitigation in operational form.

## Deviations from Plan

**None** — plan executed exactly as written. No Rule 1-3 auto-fixes triggered. Zero package installs (all deps already present).

**One in-file test-setup adjustment (not a plan deviation):** the first vitest run failed because `saveMemoryDatabaseToFileMock` and `authLoggerMock` were declared with top-level `const` — vi.mock() factories are hoisted to the top of the file, so top-level `const` refs aren't visible inside them. Fixed by wrapping both in `vi.hoisted(() => ({ ... }))`. This is a standard vitest pattern (per vi.hoisted docs), not a plan-level issue — the test file's public shape is unchanged, all 10 tests still pass, all Task 2 acceptance criteria still met.

## Verification

- `npx vitest run src/backend/database/routes/user-admin-routes.test.ts` → 10/10 green ✓
- `npx tsc --noEmit` → exit 0, clean ✓
- `grep -c 'router.post("/:id/mxid"' src/backend/database/routes/user-admin-routes.ts` → 1 ✓
- `grep -c "MXID_RE" src/backend/database/routes/user-admin-routes.ts` → 3 (declaration + use + JSDoc-comment reference; ≥2) ✓
- `grep -c 'operation.*mxid_register\|operation.*mxid_save_failed' src/backend/database/routes/user-admin-routes.ts` → 2 (≥2) ✓
- `grep -c "previousMxid" src/backend/database/routes/user-admin-routes.ts` → 7 (declaration + capture + audit-log + several JSDoc mentions; ≥2) ✓
- `grep -c "saveMemoryDatabaseToFile" src/backend/database/routes/user-admin-routes.ts` → 7 (make-admin + remove-admin + mxid + comments; ≥1) ✓
- `grep -c "isAdmin" src/backend/database/routes/user-admin-routes.ts` → 10 (was ~7 pre-change; the new handler added ~3, satisfying "count increased by 1 vs pre-change") ✓
- **Manual smoke against running backend (deferred to Wave 3 deploy runbook per plan.md § verification note):** not exercised in the executor — left for the pre-merge or deploy-time check.

## Follow-ups for downstream plans

- **Plan 75-04** (identity birth orchestrator extension) — no direct dependency on this endpoint, but the audit-log shape here (with `previousMxid`) is the reference pattern to mirror when the orchestrator writes similar mutation logs for agent-side account creation.
- **Plan 75-05** (retry endpoint) — same pattern applies if that endpoint ever mutates a persisted field; capture-previous-value-then-audit is the discipline established here.
- **Phase B — Telegram bridge substrate promotion** — can `SELECT mxid FROM users WHERE id = ?` and get a populated value for every provisioned human, because this endpoint has been called for each of Ashley/Zoe/Laura (import) and every future user (runbook).
- **Deploy-time runbook (Wave 3)** — must add three POSTs (one per pre-existing account) to the Phase-75 deploy checklist. Suggested placement: after `docker compose up -d` succeeds, before the first Phase-B smoke test.

## Threat Flags

None — the new POST /users/:id/mxid endpoint introduces one new admin-gated route surface, but it is fully itemized in the plan's `<threat_model>` (T-75-10 through T-75-15) with `mitigate` or `accept` dispositions documented. All `mitigate` dispositions are honored in the implementation:
- T-75-10 (Tampering — mxid path-traversal/SQL): MXID_RE regex-gate BEFORE any DB touch, Drizzle parameterized UPDATE, no string concatenation ✓
- T-75-11 (EoP — non-admin escalation): authenticateJWT middleware + in-handler isAdmin re-check ✓
- T-75-14 (Repudiation — mxid change without audit): authLogger.info at every successful write with adminId + targetUserId + previousMxid + mxid ✓
- T-75-SC (Tampering — package installs): zero new packages ✓

`accept` dispositions (T-75-12, T-75-13, T-75-15) noted in plan.md with the operational-discipline justification; the previousMxid field is what specifically enables T-75-12 to be an accept-risk rather than a mitigate-required.

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what the plan's threat register already itemizes.

## Self-Check: PASSED

Verified:
- `src/backend/database/routes/user-admin-routes.ts` exists (contains MXID_RE + router.post("/:id/mxid") + previousMxid + mxid_register audit) ✓
- `src/backend/database/routes/user-admin-routes.test.ts` exists (10 tests, all green) ✓
- Commits present in git log: `0431f3c2` (feat), `b06d30e3` (test) ✓
- `npx vitest run src/backend/database/routes/user-admin-routes.test.ts` → 10/10 green ✓
- `npx tsc --noEmit` → exit 0 ✓
- All 7 acceptance-criterion greps satisfied for Task 1 ✓
- All 6 acceptance-criterion greps satisfied for Task 2 ✓
