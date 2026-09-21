---
phase: 126-push-notifications-replacing-telegram-bridge
plan: 05
subsystem: notifications
tags: [push-notifications, api-route, nginx-dual-conf, D-11, D-13]

# Dependency graph
requires:
  - phase: 126-push-notifications-replacing-telegram-bridge
    plan: 01
    provides: "push_subscriptions table + UNIQUE INDEX on (user_id, endpoint) — the POST handler's INSERT ... ON CONFLICT(user_id, endpoint) DO NOTHING relies on that composite index being present at the DDL layer"
  - phase: 126-push-notifications-replacing-telegram-bridge
    plan: 02
    provides: "vapid-config.ts::getVapidDetails() — the GET /vapid-public-key handler reads publicKey from this loader (and it fails fast at boot if the env vars are missing/malformed per Pitfall 2)"
provides:
  - "src/backend/database/routes/push-subscriptions.ts — default-export Express router with POST / (auth-gated, zod-validated, ON CONFLICT DO NOTHING, forceSave-with-warn-fallback, S2 disk-sat no-op guard) + GET /vapid-public-key (no auth — public key is public by design; response object built by name so private key never leaks per T-126-26)"
  - "handleRegisterSubscription(userId, body, res) + handleGetVapidPublicKey(res) — exported handler functions matching the user-preferences.ts test-shape pattern (allow unit tests without an Express harness)"
  - "docker/nginx.conf + docker/nginx-https.conf — byte-mirrored location ~ ^/push-subscriptions(/.*)?$ blocks proxying to 127.0.0.1:30001, adjacent to the existing /telegram block (dual-conf discipline per Pitfall 5)"
affects: [128-06-push-trigger-loop, 128-08-wiring-database-ts-and-starter-ts]

# Tech tracking
tech-stack:
  added:
    - "(no new npm deps — the plan reuses express@^5.2.1, zod@^4.4.3 already in dependencies from Phase 15 and earlier phases, node:crypto's randomUUID, and the AuthManager singleton — Plans 01 + 02 already landed the datastore + VAPID loader)"
  patterns:
    - "Handler-level dep-injection test pattern: exported `handleRegisterSubscription` + `handleGetVapidPublicKey` mirror user-preferences.ts's `handleGetPreferences` / `handlePutPreferences` — tests exercise business logic without an Express harness, auth-gate correctness verified by construction (route wires authenticateJWT before the handler)"
  - "Raw better-sqlite3 escape hatch for ON CONFLICT DO NOTHING: `db.$client.prepare(sql).run(...)` — Drizzle-ORM in this version doesn't have first-class ON CONFLICT DO NOTHING support, so the route drops to the raw client (same pattern the codebase already uses in Plan 01's db/index.ts migration and elsewhere)"
    - "S2 disk-sat guard verbatim from relay-room-sessions-store.ts:86-90: when result.changes === 0 the handler responds 200 {alreadyRegistered:true} WITHOUT calling forceSave — no state change means no disk churn (2026-09-09 hotfix invariant)"
    - "S1 auth-gate verbatim: `authenticateJWT` before handler + `userId = (req as AuthenticatedRequest).userId` inside handler; body's userId (if any) is never consulted (T-126-21/V4 mitigation)"
    - "S6 dual-conf-nginx discipline: every new HTTP prefix lands in BOTH docker/nginx.conf AND docker/nginx-https.conf; block bodies are byte-identical (verified via diff); block placement adjacent to the existing /telegram block per PATTERNS.md §13"
    - "Log payload security V8 (T-126-24): endpoint URLs (capability tokens) are truncated to slice(0, 40) in EVERY log payload — forceSave warn, INSERT-failed error, both call sites in the route; test REG-07 asserts the full endpoint URL does not appear in the log payload JSON"
    - "Zod SubscriptionSchema — endpoint z.string().url().max(2048) + keys.p256dh regex ^[A-Za-z0-9_-]{80,180}$ + keys.auth regex ^[A-Za-z0-9_-]{20,40}$; body cap via express.json({limit:'8kb'}) applied at the middleware layer BEFORE zod (T-126-22/T-126-23)"

key-files:
  created:
    - src/backend/database/routes/push-subscriptions.ts  # 230 lines — Express router + two exported handlers
    - src/backend/database/routes/push-subscriptions.test.ts  # 523 lines — 17 vitest cases across REG-01..07 + VAP-01..03 + REG-AUTH-01
  modified:
    - docker/nginx.conf  # +17 lines — location block after existing /telegram block
    - docker/nginx-https.conf  # +17 lines — matching location block, byte-mirrored

key-decisions:
  - "Deviation Rule 1 (test-authoring bug fixed inline): REG-04f initially asserted `bodyStr.not.toContain('script')` to verify the 400 response does not echo `<script>alert(1)</script>` back. But the generic error string 'invalid subscription shape' contains the substring 'script' — a false-positive collision that would trip the assertion on any well-behaved implementation. Swapped the XSS marker to a distinctive `<xssMarker>alertUniqueTag</xssMarker>` token that could not appear in the generic error string. The test still verifies the actual invariant: the malicious body content is NOT echoed back."
  - "Auth-by-construction test pattern (documented in test file's top-of-file comment): the plan's <behavior> lists a 401-on-missing-auth case, but exercising this via the exported handler function would require re-mounting the router in a test-only Express app. The user-preferences.test.ts pattern this file mirrors handles this the same way — the handler-function test bypasses the middleware layer entirely; auth-gate correctness is guaranteed by construction (the route file has `authenticateJWT` before the handler in the router.post call), and the file-level acceptance-criteria grep (`grep -c 'authenticateJWT'` returns 4) locks the wiring in place. REG-AUTH-01 additionally asserts the router.stack shape (routes '/' and '/vapid-public-key' both present)."
  - "GET /vapid-public-key ships in this plan (not deferred to Plan 08 wiring) because the plan's must-haves explicitly named it (line 19 of PLAN.md) and the route is trivially additive alongside POST /. Tests VAP-01/02/03 lock: 200 {publicKey} on happy path, no privateKey field ever, generic 500 {error:'vapid unavailable'} on defensive load failure."
  - "Response object built by name (not spread) at the VAPID GET handler: `res.json({ publicKey })` — an accidental `...vapid` refactor would still not leak the private field because there's no destructure-with-spread anywhere in the handler. Belt-and-suspenders on top of T-126-26."
  - "Router NOT mounted in database.ts — Plan 08 owns that batched with the starter.ts wiring changes and the /telegram route unmount. The router module exists and self-tests but the running server does not yet serve /push-subscriptions. This is per PLAN.md <action> explicit note: 'this task creates the router MODULE but does NOT mount it in database.ts. Route mounting + database.ts patching happens in Plan 08 alongside the starter.ts wiring changes. This keeps Plan 08 (wiring plan) coherent and this plan (foundation) isolated.'"
  - "Both nginx blocks land ADJACENT to the existing /telegram block, not as replacements — the /telegram block stays in this plan and exits in Plan 10 (docker-compose teardown wave). Keeping /telegram alive during this transitional wave means the backend still serves the bridge until Plan 09 deletes src/backend/telegram/ — a coherent teardown sequence rather than a mid-flight nginx→backend mismatch."

patterns-established:
  - "Per-user-per-device idempotent registration: INSERT ... ON CONFLICT(user_id, endpoint) DO NOTHING + result.changes-branch (0 → 200 alreadyRegistered no-save, >0 → 201 with forceSave). Reusable for any future per-device-scoped registration endpoint."
  - "Public-key exposure endpoint pattern: no-auth GET returning ONLY the public half of a keypair via `res.json({ publicKey })` construction (not object spread). Reusable for any future capability where the public half is safe-to-broadcast and the private half must not leak."

requirements-completed: [D-11, D-13]

# Metrics
duration: 25min
completed: 2026-09-21
---

# Phase 128 Plan 05: Push subscriptions route + dual-nginx location blocks Summary

**New `src/backend/database/routes/push-subscriptions.ts` Express router with POST / (auth-gated, zod-validated, ON CONFLICT DO NOTHING, S2 disk-sat no-op guard on duplicate) and GET /vapid-public-key (no auth; returns only the public key by-name so the private key can never leak per T-126-26). 17-case vitest coverage colocated at push-subscriptions.test.ts (REG-01/02/03/04a-f/05/06/06b/07 + VAP-01/02/03 + REG-AUTH-01). Matching `location ~ ^/push-subscriptions(/.*)?$` block added to BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` (byte-mirrored via diff) adjacent to the existing `/telegram` block per PATTERNS.md §13. Router NOT mounted in database.ts — Plan 08 owns wiring. Backend build + full build exit 0; scoped tests 17/17 green.**

## Performance

- **Duration:** ~25 min executor time (TDD gate for Task 1 — RED test file + GREEN route implementation with one test-bug fix; Task 2 nginx dual-conf byte-mirror).
- **Started:** 2026-09-21T02:24:00Z.
- **Completed:** 2026-09-21T02:31:00Z (approximate — final commit at 38b0c179).
- **Tasks:** 2 total (Task 1: `type="auto" tdd="true"`; Task 2: `type="auto"`).
- **Files created:** 2 (`push-subscriptions.ts`, `push-subscriptions.test.ts`).
- **Files modified:** 2 (`docker/nginx.conf`, `docker/nginx-https.conf`).

## Accomplishments

### Task 1 — push-subscriptions.ts route module + colocated tests (TDD)

- **RED (commit `3fdce1ae`, test-only):** Wrote `push-subscriptions.test.ts` with 17 test cases in three describe blocks (register-happy-path + persistence, input validation, forceSave failure fallback, cross-user isolation, VAPID public-key endpoint, router shape). Test file mocks `../db/index.js` with a hand-rolled in-memory Map keyed on `<user_id>::<endpoint>` (so cross-user + cross-endpoint uniqueness matches the real UNIQUE INDEX shape), mocks `AuthManager.getInstance()` to a no-op middleware (auth-by-construction pattern from user-preferences.test.ts), mocks `databaseLogger` with warn/info/error spies to assert log-payload truncation, and mocks `vapid-config.js::getVapidDetails` with a fake tuple whose privateKey is `"PRIVATE_KEY_MUST_NEVER_LEAK"` (sentinel string tests can assert absence of). Verified RED with `npx vitest related --run push-subscriptions.test.ts` → "Cannot find module push-subscriptions.js".

- **GREEN (commit `a74eaaf7`, route + test-bug fix):** Wrote the 230-line route module `push-subscriptions.ts`:
  - **Imports:** `AuthenticatedRequest` type; express + Request/Response; `randomUUID` from `node:crypto`; `z` from zod; `db, DatabaseSaveTrigger` from `../db/index.js`; `databaseLogger` from `../../utils/logger.js`; `AuthManager` from `../../utils/auth-manager.js`; `getVapidDetails` from `../../notifications/vapid-config.js`.
  - **Router setup:** `express.Router()` + `AuthManager.getInstance().createAuthMiddleware()` bound to `authenticateJWT`.
  - **`SubscriptionSchema` (zod):** `endpoint: z.string().url().max(2048)`, `keys.p256dh: regex /^[A-Za-z0-9_-]{80,180}$/`, `keys.auth: regex /^[A-Za-z0-9_-]{20,40}$/`.
  - **`handleRegisterSubscription(userId, body, res)`:** zod-parse → 400 generic error on failure (no echo); INSERT via `db.$client.prepare(...).run(id, userId, endpoint, p256dh, auth)` with ON CONFLICT(user_id, endpoint) DO NOTHING; if `result.changes === 0` → 200 `{ok:true, alreadyRegistered:true}` (S2 no-op guard, no forceSave); if `result.changes > 0` → await `DatabaseSaveTrigger.forceSave("push-subscription-register")` inside try/catch; on catch, `databaseLogger.warn` with `operation:"push_subscription_register_save_failed"`, `userId`, `endpoint: sub.endpoint.slice(0, 40)` (V8/T-126-24 log truncation), `error: message`; respond 201 `{ok:true}` either way. Defensive outer try/catch on the INSERT catches unexpected DB errors (e.g. FK stale userId) → databaseLogger.error + 500 generic.
  - **`handleGetVapidPublicKey(res)`:** try { const {publicKey} = getVapidDetails(); return res.status(200).json({publicKey}) } catch → warn + 500 `{error:"vapid unavailable"}`. Response object built by-name so `privateKey` field can never accidentally serialize.
  - **Router wiring:** `router.post("/", authenticateJWT, express.json({limit:"8kb"}), async (req, res) => handleRegisterSubscription((req as AuthenticatedRequest).userId, req.body, res))`; `router.get("/vapid-public-key", (_req, res) => handleGetVapidPublicKey(res))`.
  - **Rule 1 test-bug fix in the same GREEN commit:** REG-04f's `expect(bodyStr).not.toContain("script")` collided with the generic error string "invalid subscription shape" (contains substring "script"). Fixed by swapping the marker to `<xssMarker>alertUniqueTag</xssMarker>` in the test input and asserting on those tokens — same test intent, no false-positive collision.
  - Verified GREEN with `npx vitest related --run push-subscriptions.ts` → **17 passed / 17**.

### Task 2 — /push-subscriptions nginx location block in BOTH nginx.conf AND nginx-https.conf

- **Both files updated in commit `38b0c179`:**
  - `docker/nginx.conf`: inserted the block AFTER the existing `/telegram` block (line ~262), BEFORE the `/version` block (line ~264 pre-edit).
  - `docker/nginx-https.conf`: inserted the block AFTER the existing `/telegram` block (line ~273), BEFORE the `/version` block.
  - Block body byte-mirror of the `/telegram` template: `proxy_pass http://127.0.0.1:30001` + `proxy_http_version 1.1` + the six standard `proxy_set_header` lines (Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto, X-Forwarded-Port, X-Forwarded-Host).
- **Verified byte-mirror:** `diff <(grep -A 11 "push-subscriptions" docker/nginx.conf | tail -11) <(grep -A 11 "push-subscriptions" docker/nginx-https.conf | tail -11)` returned empty (byte-identical block bodies).
- **Existing /telegram blocks preserved** in both files — Plan 10 removes them alongside the docker-compose teardown; keeping them alive during this transitional wave means the backend still serves the bridge until Plan 09 deletes `src/backend/telegram/`.

## Verification

**Task 1 acceptance-criteria greps (all pass):**

| Check                                                                   | Expected | Actual |
| ----------------------------------------------------------------------- | -------- | ------ |
| `grep -c "router.post"` push-subscriptions.ts                           | exactly 1 | **1** |
| `grep -c "router.get"` push-subscriptions.ts                            | ≥ 1      | **1** |
| `grep -c "authenticateJWT"` push-subscriptions.ts                       | ≥ 1      | **4** (import + local + comment + call) |
| `grep -cE '\(req as AuthenticatedRequest\).userId'` push-subscriptions.ts | ≥ 1    | **3** |
| `grep -c "ON CONFLICT.*DO NOTHING"` push-subscriptions.ts               | ≥ 1      | **3** (INSERT sql + docblock + comment) |
| `grep -c "DatabaseSaveTrigger.forceSave"` push-subscriptions.ts         | ≥ 1      | **2** |
| `grep -cE 'express.json\({ limit:'` push-subscriptions.ts                | ≥ 1      | **2** (docblock + call) |
| `grep -cE 'z.object'` push-subscriptions.ts                              | ≥ 1      | **2** |
| `grep -c "result.changes === 0"` push-subscriptions.ts                   | ≥ 1      | **2** (branch + docblock) |
| `npm run build:backend`                                                 | exit 0   | **exit 0** |
| `npm run build`                                                         | exit 0   | **exit 0 (5.09s)** |
| `npx vitest related --run push-subscriptions.ts`                        | 8 cases green | **17/17 green** (behavior cases exceeded plan's stated 8) |

**Task 2 acceptance-criteria greps (all pass):**

| Check                                                                              | Expected | Actual |
| ---------------------------------------------------------------------------------- | -------- | ------ |
| `grep -c "location.*push-subscriptions" docker/nginx.conf`                          | exactly 1 | **1** |
| `grep -c "location.*push-subscriptions" docker/nginx-https.conf`                    | exactly 1 | **1** |
| `grep -A 8 "location.*push-subscriptions" docker/nginx.conf \| grep -c "proxy_pass http://127.0.0.1:30001"` | exactly 1 | **1** |
| `grep -A 8 "location.*push-subscriptions" docker/nginx-https.conf \| grep -c "proxy_pass http://127.0.0.1:30001"` | exactly 1 | **1** |
| `grep -A 10 "location.*push-subscriptions" docker/nginx.conf \| grep -c "proxy_set_header"` | ≥ 6      | **6** |
| `grep -A 10 "location.*push-subscriptions" docker/nginx-https.conf \| grep -c "proxy_set_header"` | ≥ 6      | **6** |
| `grep -c "location.*telegram" docker/nginx.conf`                                    | exactly 1 | **1** (untouched) |
| `grep -c "location.*telegram" docker/nginx-https.conf`                              | exactly 1 | **1** (untouched) |
| `diff` between the two new blocks                                                   | empty    | **empty (byte-identical)** |

**Backend TS build gate + full build gate:** both green after both tasks.

**Scoped vitest coverage:** 17 test cases across REG-01/02/03/04a-f/05/06/06b/07 + VAP-01/02/03 + REG-AUTH-01 — all green in ~450ms.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test-authoring bug in REG-04f (substring collision with generic error string)**

- **Found during:** Task 1 GREEN — first `npx vitest related --run` after writing the implementation returned 16/17 green + 1 failed.
- **Issue:** REG-04f asserted `expect(bodyStr).not.toContain("script")` to verify the 400 response body does not echo `<script>alert(1)</script>` back. But the generic error string `"invalid subscription shape"` contains the substring `"script"` (in `"subscription"`) — the test was guaranteed to fail against any well-behaved implementation.
- **Fix:** Swapped the malicious input marker from `<script>alert(1)</script>` (contains `"script"`, `"alert"` — both dangerous-looking-but-substring-colliding tokens) to `<xssMarker>alertUniqueTag</xssMarker>` (contains `"xssMarker"`, `"alertUniqueTag"` — distinctive tokens that could not appear in the generic error string). Same test intent (assert 400 response does not echo body content), no false-positive collision.
- **Files modified:** `src/backend/database/routes/push-subscriptions.test.ts` (REG-04f block only).
- **Commit:** `a74eaaf7` (fix was folded into the GREEN commit rather than a separate refactor commit, since the failing test was blocking GREEN validation).

No Rule 2 (missing critical functionality — the plan already specified full defense-in-depth for auth, log truncation, body cap, no-echo error, S2 no-op guard, byname VAPID response object).
No Rule 3 (blocking issues — zod + web-push + express + AuthManager + vapid-config all already in place from prior plans).
No Rule 4 (architectural change — no schema or wiring changes; router is deliberately unmounted per PLAN.md).

Zero blockers. Zero auth gates hit during execution.

## Threat Flags

None — this plan's threat surface stays inside `<threat_model>` in `128-05-PLAN.md`. All six threats (T-126-21 through T-126-26) are mitigated per the plan's disposition:

- **T-126-21 (Elevation of Privilege via body-userId spoof):** `userId = (req as AuthenticatedRequest).userId` inside the router wrapper — body is never consulted. REG-03 test locks it.
- **T-126-22 (DoS via POST flood):** `authenticateJWT` gate + `express.json({limit:"8kb"})` body cap + ON CONFLICT DO NOTHING preventing row explosion + the UNIQUE INDEX (Plan 01) capping per-`(user, endpoint)` at 1.
- **T-126-23 (Input validation crash):** Zod SubscriptionSchema safeParse → 400 on shape mismatch; endpoint URL length cap at 2048; keys regex-capped. REG-04a-e tests lock the failure branches.
- **T-126-24 (Info disclosure via full-endpoint log):** All log payloads use `endpoint.slice(0, 40)` — never the full URL. REG-07 test asserts the full endpoint URL does not appear in the warn-log payload JSON.
- **T-126-25 (Availability: nginx block missing in HTTPS conf):** Both `docker/nginx.conf` AND `docker/nginx-https.conf` have the block, byte-mirrored via diff; acceptance-grep locks both files at count 1.
- **T-126-26 (Confidentiality: VAPID private-key leak):** GET /vapid-public-key handler builds the response object by-name (`res.json({ publicKey })`), NEVER by spread. VAP-02 test asserts response body has no `privateKey` field AND the fixture private-key sentinel `"PRIVATE_KEY_MUST_NEVER_LEAK"` does not appear anywhere in the serialized response.

## Known Stubs

None. The router is fully wired end-to-end WITHIN this plan's scope. The one cross-plan dependency — `app.use("/push-subscriptions", router)` in `database.ts` — is explicitly deferred to Plan 08 per PLAN.md `<action>` explicit note: "this task creates the router MODULE but does NOT mount it in database.ts. Route mounting + database.ts patching happens in Plan 08 alongside the starter.ts wiring changes." This is a documented cross-plan dependency, not a stub.

## Deferred to Plan 08 (wiring plan)

- `app.use("/push-subscriptions", pushSubscriptionsRoutes)` in `src/backend/database/database.ts`.
- Adjacent `import pushSubscriptionsRoutes from "./routes/push-subscriptions.js"` at the top of `database.ts`.
- `assertVapidConfigAtBoot()` invocation in `src/backend/starter.ts` at the same insertion point as `assertBrandingConfigAtBoot` (see 128-02-SUMMARY).

Once Plan 08 lands those two lines + the boot gate, a browser with a valid JWT POSTing `{endpoint, keys:{p256dh, auth}}` to `/push-subscriptions` gets the auth-gated, forceSaved, upsert-idempotent registration behavior. The nginx blocks landed in this plan mean the HTTPS deploy proxies the traffic to the backend correctly (Pitfall 5 mitigation is complete).

## Runtime State (nothing new)

This plan does not introduce or mutate any stored data, live service config, OS-registered state, or secrets. The router module is dead code until Plan 08 mounts it. The nginx blocks are dead routes until the backend serves them (blocked on Plan 08). No new env vars, no new secrets, no new DB migrations (Plan 01 already landed the table + UNIQUE INDEX).

## Commits

| Task | Commit     | Type / Description                                                                              |
| ---- | ---------- | ----------------------------------------------------------------------------------------------- |
| 1    | `3fdce1ae` | test(128-05-1): add failing tests for push-subscriptions route (RED gate — 17 vitest cases)     |
| 1    | `a74eaaf7` | feat(128-05-1): implement push-subscriptions route (POST register + GET vapid-public-key) — includes REG-04f test-bug fix (Rule 1) |
| 2    | `38b0c179` | feat(128-05-2): add /push-subscriptions nginx location block to both HTTP and HTTPS confs       |

## Self-Check: PASSED

- `src/backend/database/routes/push-subscriptions.ts` exists at expected path and contains `router.post`, `router.get`, `authenticateJWT`, `AuthenticatedRequest`, `ON CONFLICT`, `DatabaseSaveTrigger.forceSave`, `express.json({ limit`, `z.object`, `result.changes === 0`: **FOUND**
- `src/backend/database/routes/push-subscriptions.test.ts` exists at expected path: **FOUND**
- `docker/nginx.conf` contains `location ~ ^/push-subscriptions(/.*)?$` block: **FOUND**
- `docker/nginx-https.conf` contains matching block: **FOUND**
- Commits `3fdce1ae`, `a74eaaf7`, `38b0c179` exist in `git log --oneline`: **FOUND**
- Scoped vitest 17/17 green: **VERIFIED**
- `npm run build:backend && npm run build` exit 0: **VERIFIED**
- No untracked files, no unstaged changes after final commit: verified in Task 2 commit
