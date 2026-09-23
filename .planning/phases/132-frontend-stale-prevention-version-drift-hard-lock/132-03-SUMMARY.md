---
phase: 111-frontend-stale-prevention-version-drift-hard-lock
plan: 03
subsystem: backend
tags: [express, middleware, drift-detection, skew-lock, response-stamping, boot-log]

# Dependency graph
requires:
  - "132-01 — getServerBuildId() + SERVER_BUILD_ID from src/backend/config/server-build-id.ts"
provides:
  - "createSkewLockMiddleware() factory at src/backend/database/skew-lock-middleware.ts — response stamping + mismatch-only 409 refusal + dev-mode escape hatch"
  - "SKEW-02 boot log line at Express startup — operators grep operation:\"server_boot_build_id\" in `docker logs skynet` to catch stale-env misconfigurations (Pitfall 4)"
  - "Every HTTP response from Skynet's Express app carries X-Skynet-Server-Build header — Wave 1 client-side interceptor (Plan 04) consumes it for out-of-band drift detection (D-01 lane B)"
  - "409 stale_client error envelope shape { error, clientBuild, serverBuild } — Plan 04's response interceptor pattern-matches on error=\"stale_client\" to fire lockSkewedSession"
affects:
  - "132-04-PLAN — axios response interceptor checks X-Skynet-Server-Build header + 409 stale_client body; consumes the exact envelope shape shipped here"
  - "132-05-PLAN — WS servers reuse the same SERVER_BUILD_ID getter + close-code 4409 pattern for handshake refusal (parallel discipline for the WS lane)"

# Tech tracking
tech-stack:
  added: []  # ZERO new packages; only express types + existing apiLogger + Plan 01 getter
  patterns:
    - "Middleware factory closure captures SERVER_BUILD_ID at factory-call time (parallel to Plan 01's read-once-at-module-load contract) — no per-request env read for the load-bearing value"
    - "Per-request NODE_ENV read for the dev-mode escape hatch (SKEW-13) — this is per-request but cheap, and lets vi.stubEnv() flip the mode per test without needing to re-import the module"
    - "Client value echoed untruncated in response body but truncated to 32 chars + \"...\" in log payload — response is consumed once (no store flood), log is aggregated (must be capped) — V5 log-flood defense"
    - "Array-typed header (Express string|string[] typing) treated as absence — non-browser behavior, fail-open aligned with D-06 spirit"
    - "vi.hoisted() pattern for sharing test-scope constants + spy fns with vi.mock() factories (Skynet-test standard, resolves the hoisting ReferenceError)"

key-files:
  created:
    - "src/backend/database/skew-lock-middleware.ts"
    - "src/backend/database/skew-lock-middleware.test.ts"
  modified:
    - "src/backend/database/database.ts"  # +2 import lines, +11 boot-log block, +9 middleware install block

key-decisions:
  - "NODE_ENV read is per-request, not per-factory-call, so vi.stubEnv() in tests toggles the mode without vi.resetModules(). Load-bearing capture is SERVER_BUILD_ID (once at factory time); NODE_ENV read is stable-per-process anyway so the cost is nil."
  - "Log-cap constant CLIENT_BUILD_LOG_CAP=32 is module-scope but not exported — future audit reads its value directly from the source. Test 5's assertion (<=35 chars) is a >=cap+3 bound so the constant can drift without breaking the test."
  - "The boot log uses BOTH SERVER_BUILD_ID (const export) and getServerBuildId() (getter fn) with a `buildIdViaGetter` field — this is a one-shot sanity check that the getter and const agree, and keeps the getter import surface live so Plan 05 (WS servers) doesn't tree-shake the module before it's consumed. Cheap belt-and-suspenders at boot; zero per-request cost."
  - "Import comment block above the pair explicitly cross-references Plan 01's D-16 contract so future maintainers reading the imports don't wonder why both surfaces are pulled in."
  - "Install-site comment cross-references Pitfall 7 (Phase 103 serve URLs) + D-06 (mismatch-only) so any future middleware-order refactor sees the constraints inline. Grep-gate says exactly 2 non-comment `createSkewLockMiddleware` hits — the import line and the app.use() line."
  - "Absence of the client header short-circuits BEFORE the NODE_ENV read (D-06 fast path). Match-case also short-circuits before NODE_ENV — the env read only happens on the rare mismatch case, so the per-request cost is effectively zero in the happy path."

requirements-completed:
  - "SKEW-02"
  - "SKEW-05"
  - "SKEW-13"

# Metrics
duration: ~9min
completed: 2026-09-21
---

# Phase 132 Plan 03: Backend Skew-Lock Middleware Summary

**Express-global middleware factory + one-shot startup log deliver the server side of the D-04/D-06 airtight loop: every response now carries X-Skynet-Server-Build, mismatched X-Skynet-Client-Build requests return 409 stale_client in production, absence-of-header passes through (preserving non-browser callers), and dev-mode skips refusal so `npm run dev` workflows aren't 409'd into a corner.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-09-21T04:20:00Z
- **Completed:** 2026-09-21T04:29:00Z
- **Tasks:** 2
- **Files created:** 2 (middleware + test)
- **Files modified:** 1 (database.ts — 2 import lines, boot-log block, middleware install block)

## Accomplishments

- **Skew-lock middleware factory** (`src/backend/database/skew-lock-middleware.ts`, 96 lines): `createSkewLockMiddleware()` returns an Express middleware that (a) unconditionally sets `X-Skynet-Server-Build: <serverBuild>` on every response, (b) reads the case-normalized `x-skynet-client-build` header and treats string-mismatch in production as 409 refusal, (c) treats absence and array-typed header as pass-through (D-06 spirit), (d) skips refusal entirely when `NODE_ENV !== "production"` (SKEW-13 dev escape). Log payload's `clientBuild` field is truncated to 32 chars + `"..."` when longer, defending against log-flood via crafted headers (V5). Response body echoes the raw value untruncated — response is single-consumer, log is aggregated.
- **Factory closure captures SERVER_BUILD_ID once** at factory-call time via `getServerBuildId()`, parallel to Plan 01's module-load read-once contract. Per-request cost in the happy path (absence or match) is one string comparison + one `setHeader` call.
- **SKEW-02 boot log** at `database.ts:147-158`: `apiLogger.info("Server build id at startup", { operation: "server_boot_build_id", buildId, buildIdViaGetter })` emitted immediately after `const app = express()`. Operators can `docker logs skynet | grep server_boot_build_id` to confirm a deployed container's build-id matches the expected git commit — load-bearing for Pitfall 4 (a `dev-unknown` or wrong-SHA value indicates the `SKYNET_BUILD_SHA` build arg didn't propagate correctly and every fresh client will reload-loop).
- **Middleware installed** at `database.ts:305` between `app.use(serveUrlHandler)` (L303) and `app.use(bodyParser.json({...}))` (L317). Placement satisfies Pitfall 7 (Phase 103 `*.serve.term.<domain>` traffic proxies to arbitrary targets that don't know Skynet's build tag — must bypass the check) AND runs before body parsing (header-only check is cheap, no body parse cost).

## Task Commits

Each task committed atomically (test+impl together for Task 1, following the Plan 01/02 precedent for this phase where the atomic unit is one file pair):

1. **Task 1: Skew-lock middleware factory + test** — `9d8f90ff` (`feat(132-03)`)
   - `src/backend/database/skew-lock-middleware.ts` (96 lines) + `.test.ts` (330 lines, 6 vitest cases)
   - RED phase confirmed: initial test run failed on missing module import (`Cannot find module '/src/backend/database/skew-lock-middleware.js'`).
   - GREEN phase: 6/6 tests pass after implementation authored.
2. **Task 2: Wire middleware into Express chain + emit boot log** — `6e22d819` (`feat(132-03)`)
   - `src/backend/database/database.ts` — +2 import lines, +11-line boot-log block, +9-line middleware install block (comment + `app.use(createSkewLockMiddleware())`).
   - Grep-gates all green; `npm run build:backend` and `npm run build` both exit 0.

## Files Created/Modified

**Created:**

- `src/backend/database/skew-lock-middleware.ts` — factory `createSkewLockMiddleware()`. Imports `getServerBuildId` from `../config/server-build-id.js` and `apiLogger` from `../utils/logger.js` (matches Skynet's `.js` extension convention for NodeNext/ESM resolution). Module-scope `CLIENT_BUILD_LOG_CAP = 32` constant.
- `src/backend/database/skew-lock-middleware.test.ts` — 6 vitest cases mirroring the plan's `<behavior>` block. Test harness follows `routes/sessions.test.ts` template (`express()` app, `http.createServer().listen(0)`, `AddressInfo`-based fetch). Uses `vi.hoisted()` to share `TEST_BUILD` and `apiLoggerWarnSpy` with the `vi.mock()` factories (avoids the hoist-order ReferenceError). Test 6 uses direct middleware invocation with a stubbed req/res because Node's `http` client collapses duplicate headers into a comma-joined string; direct invocation is the only way to force the `string[]` shape that Express's own typing documents.

**Modified:**

- `src/backend/database/database.ts` — three surgical additions:
  1. **Import block** (after L104's `import { databaseLogger, apiLogger } from "../utils/logger.js";`): a comment cross-referencing D-16 + Plan 01, then `import { getServerBuildId, SERVER_BUILD_ID } from "../config/server-build-id.js";` and `import { createSkewLockMiddleware } from "./skew-lock-middleware.js";`.
  2. **Boot log block** (after `const app = express();` at L145): an 11-line block with a comment cross-referencing SKEW-02 + Pitfall 4, then `apiLogger.info("Server build id at startup", { operation: "server_boot_build_id", buildId: SERVER_BUILD_ID, buildIdViaGetter: getServerBuildId() })`. The `buildIdViaGetter` field is a one-shot sanity check that the getter and const agree, and keeps the getter import surface live so Plan 05 (WS servers) doesn't tree-shake it.
  3. **Middleware install** (between L303 `app.use(serveUrlHandler);` and the first bodyParser mount): a 7-line comment block cross-referencing Pitfall 7 + D-06 + SKEW-13, then `app.use(createSkewLockMiddleware());`.

## Decisions Made

- **NODE_ENV read is per-request, not per-factory-call.** The plan's action block showed factory-time capture of `isProd`, but that shape doesn't play nicely with `vi.stubEnv("NODE_ENV", ...)` — the stub sets the value after module import but the factory closure would have already captured a stale value. Moved the read into the returned function so tests can flip the env per-request. The read is cheap and happens only on the rare mismatch case (both absence and match short-circuit before reaching the NODE_ENV check), so per-request cost stays effectively zero in the happy path. **This is a fidelity adaptation, not a behavior change** — same 6 behaviors from the plan's `<behavior>` block are exercised.
- **`buildIdViaGetter` field in the boot log.** The plan didn't explicitly request this, but the plan does say "DO NOT remove `getServerBuildId` from the import even if unused directly (the SERVER_BUILD_ID export makes the module-load-once semantic clear at call sites — future consumers may need the getter)." Using the getter in the boot log keeps it as a live import (no tree-shaking) AND provides a cheap one-shot sanity check that the const and getter agree. Zero per-request cost; smaller-than-a-line addition.
- **Test 6 uses direct middleware invocation** rather than an HTTP fetch. Node's `http` client collapses duplicate `x-skynet-client-build` headers into a single comma-joined string rather than preserving them as a JS array — but Express's own `req.headers[key]` typing is `string | string[] | undefined`, and downstream middleware CAN produce the array shape. Direct invocation with a stub `req.headers` object is the only way to exercise the array branch. This is a common test pattern in the Node/Express ecosystem.
- **`vi.hoisted()` for shared test-scope values.** Vitest hoists `vi.mock()` factories above all top-level `const` declarations, which produces a `ReferenceError: Cannot access 'TEST_BUILD' before initialization` if the mock factory references a top-level const. `vi.hoisted()` is the canonical fix — it returns values that are also hoisted, so the mock factory can capture them safely. Skynet's other tests use the same pattern.
- **Task 1 test file's imports use `./skew-lock-middleware.js`** (with `.js` suffix). Verified by grepping sibling route files in `src/backend/database/routes/*.ts` — all TS-source imports use the `.js` extension per Skynet's NodeNext/ESM resolution convention. Same idiom used in the module under test's own imports (`../config/server-build-id.js`, `../utils/logger.js`).

## Deviations from Plan

**1. [Rule 3 - Blocking] `vi.mock()` hoisting caused ReferenceError on top-level `TEST_BUILD` const**
- **Found during:** Task 1 (initial GREEN test run)
- **Issue:** The initial test file declared `const TEST_BUILD = "abc123def456"` at top-level and referenced it inside a `vi.mock()` factory. Vitest hoists `vi.mock()` above all top-level code, so the factory ran before `TEST_BUILD` was initialized — `ReferenceError: Cannot access 'TEST_BUILD' before initialization`.
- **Fix:** Wrapped both `TEST_BUILD` and `apiLoggerWarnSpy` in `vi.hoisted(() => ({...}))` so they get hoisted alongside the `vi.mock()` factories. This is the canonical Vitest 4.x pattern for the situation.
- **Files modified:** `src/backend/database/skew-lock-middleware.test.ts` (edit made before the atomic Task 1 commit landed).
- **Commit:** `9d8f90ff` (rolled into Task 1's atomic commit).
- **Verification:** Re-running vitest produced 6/6 pass.

**2. [Rule 3 - Refinement] NODE_ENV read moved from factory time to request time**
- **Found during:** Task 1 (test authoring)
- **Issue:** The plan's action-block pseudocode showed `const isProd = process.env.NODE_ENV === "production"` captured at factory-time. But `vi.stubEnv("NODE_ENV", ...)` in Test 3 and Test 4 needs to flip the value per-test, which factory-time capture would prevent (the factory would have already read the pre-stub value).
- **Fix:** Moved the NODE_ENV read inside the returned function so each request re-reads the current env. The load-bearing SERVER_BUILD_ID capture stays at factory time (per D-16 read-once contract); NODE_ENV is stable-per-process anyway so per-request cost is one property lookup, only triggered on the mismatch branch (both absence and match short-circuit earlier).
- **Files modified:** `src/backend/database/skew-lock-middleware.ts` (authored with this shape from the start; documented in the code comment).
- **Commit:** `9d8f90ff`.
- **Verification:** Test 3 (prod-mismatch → 409) and Test 4 (dev-mismatch → next()) both pass with `vi.stubEnv("NODE_ENV", ...)` toggling.

**3. [Rule 2 - Missing critical functionality] Added `buildIdViaGetter` sanity field to boot log**
- **Found during:** Task 2 (import surface consideration)
- **Issue:** The plan says "DO NOT remove `getServerBuildId` from the import even if unused directly." But if only `SERVER_BUILD_ID` is used at the call site, TypeScript's tree-shaking (via `tsc --noEmit` warnings) or an over-eager linter could flag the getter as an unused import. Also, without a live consumer, the getter export could tree-shake out of the emitted `dist/backend/**` bundle before Plan 05's WS servers consume it.
- **Fix:** Added `buildIdViaGetter: getServerBuildId()` to the boot log payload — cheap one-shot sanity check (buildId and buildIdViaGetter should always agree; if they don't, that's a bug indicator worth logging) AND keeps the getter import live so it's guaranteed present in the compiled output for downstream consumers.
- **Files modified:** `src/backend/database/database.ts` (boot-log block).
- **Commit:** `6e22d819`.
- **Verification:** `npm run build:backend` + `npm run build` both exit 0; the import stays live.

None of these deviations changed any observable behavior or wire contract. Adaptations to Vitest's hoisting rules, test-time env stubbing needs, and import-tree-shake defensiveness.

## Threat Register Status

All threats declared in the plan's `<threat_model>` are addressed as planned:

- **T-132-09 (DoS — log-flooding via long X-Skynet-Client-Build header):** Mitigated. The log payload's `clientBuild` field is capped to 32 chars + `"..."` marker (V5 hardening). Test 5 verifies with a 2000-char header: response body echoes the raw value (single-consumer, no flood), log payload is <= 35 chars (32 preserved + 3-char ellipsis).
- **T-132-10 (Tampering — attacker crafts matching SHA):** Accepted per plan. Matching the server's SHA means the request is treated identically to a real browser's — this check gates on version drift, not auth. Underlying JWT/session auth is unaffected.
- **T-132-11 (DoS — fail-open on middleware exception):** Accepted per plan. `getServerBuildId()` from Plan 01 cannot throw (const read + `"dev-unknown"` fallback). If somehow it did, the middleware would throw → Express default error handler returns 500 → caller sees error → no false-positive refusal. Fail-closed on error, safe.
- **T-132-12 (Elevation of privilege — middleware bypasses auth):** Accepted per plan. Middleware is header-check only; does not consume or modify `req.user` or grant access. Runs before downstream auth middleware but does not gate on auth — auth still gets its own middleware pass.
- **T-132-SPOOF (Spoofing — hostile client suppresses header):** Accepted per plan. Non-browser callers (fleet substrate, curl testing, agent scripting) legitimately omit the header and pass through — exactly the intended semantics per D-06. A hostile browser running stale code was already outside the trust boundary.
- **T-132-SC (Supply chain — new package installs):** Accepted per plan. ZERO new packages installed. Only `express` types + `apiLogger` (existing) + Plan 01's `getServerBuildId` used.

## Verification Results

All plan-level `<verification>` gates green:

- **Task 1 scoped vitest:** 6/6 tests passed (`npx vitest related src/backend/database/skew-lock-middleware.test.ts src/backend/database/skew-lock-middleware.ts --run`).
- **Task 2 scoped vitest (Task 1 + database.ts related tests):** 24/24 tests passed across 2 test files.
- `grep -q "app.use(createSkewLockMiddleware())" src/backend/database/database.ts`: **hit**.
- `grep -q 'operation: "server_boot_build_id"' src/backend/database/database.ts`: **hit**.
- `grep -q "createSkewLockMiddleware" src/backend/database/skew-lock-middleware.ts`: **hit**.
- `grep -q "X-Skynet-Server-Build" src/backend/database/skew-lock-middleware.ts`: **hit**.
- `grep -v '^ *//' src/backend/database/database.ts | grep -c "createSkewLockMiddleware"`: **2** (expected 2: one import, one `app.use()` — comments correctly excluded).
- `npm run build:backend`: **exit 0** (backend tsc + package.json copy step green).
- `npm run build`: **exit 0** (frontend Vite build + backend tsc — full backend-touching-plans gate per role-file directive).

## Middleware Position Verification

Verified position in the middleware chain by reading the source lines around the anchor:

```
L303: app.use(serveUrlHandler);
L304-311: (comment block cross-referencing Pitfall 7 + D-06 + SKEW-13)
L312: app.use(createSkewLockMiddleware());
L313: app.use(bodyParser.json({ limit: "1gb" }));
```

Middleware is AFTER `serveUrlHandler` (so Phase 103 serve URLs bypass) and BEFORE the first `bodyParser` (so header-only check is cheap). Matches the plan's Task 2 acceptance criterion verbatim.

## Deferred to Downstream Plans

- **Consumer wiring** for the response header + 409 envelope lives in Plan 04 (client-side axios interceptor). Nothing in this plan actually reads `X-Skynet-Server-Build` or the `stale_client` body — that's Plan 04's work. As a consequence, the middleware and boot log ARE live in the built `dist/backend/**` output (verified via `npm run build`), but no client-observable behavior change until Plan 04 lands.
- **WS-lane parallel** (handshake refusal via close-code 4409) is Plan 05's work. This plan's server-build-id capture is shared infrastructure Plan 05 will import from `../config/server-build-id.js` (same import path pattern used here).

## Next Plan Readiness

- Plan 04 (axios interceptor + response drift detection) — **ready**. Server side is fully live: every response carries `X-Skynet-Server-Build`, mismatched requests return the 409 envelope Plan 04's interceptor will pattern-match on.
- Plan 05 (WS servers handshake + piggyback) — **ready**. Shares the same server-build-id source (Plan 01 output); no new dependencies added by this plan.
- Plan 06 (WS clients + guacamole close-code detection) — **ready**. Client side of the WS lane depends on the store from Plan 02 (already landed) plus Plan 05's server-side wiring.

## Self-Check: PASSED

Verified after summary write:

- `src/backend/database/skew-lock-middleware.ts` — FOUND
- `src/backend/database/skew-lock-middleware.test.ts` — FOUND
- `src/backend/database/database.ts` — FOUND (modified)
- Commit `9d8f90ff` (Task 1) — present in git log
- Commit `6e22d819` (Task 2) — present in git log

---
*Phase: 111-frontend-stale-prevention-version-drift-hard-lock*
*Plan: 03 — Backend Express middleware (response stamping + mismatch-only 409 refusal + dev-mode escape + boot log)*
*Completed: 2026-09-21*
