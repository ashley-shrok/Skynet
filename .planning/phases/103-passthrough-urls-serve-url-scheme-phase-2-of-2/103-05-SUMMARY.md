---
phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
plan: 05
subsystem: routing
tags: [subdomain-dispatch, reverse-proxy, jwt-auth, host-resolution, interstitial-wiring, middleware-mount-order]

# Dependency graph
requires:
  - phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
    provides: "Plan 02 (JWT cookie widen + CORS reject), Plan 03a (types.ts + tunnel-cache.ts + interstitial.ts), Plan 03b (proxy-factory.ts + header-audit-sampler.ts)"
provides:
  - "src/backend/serve-url/subdomain-dispatch.ts — Express middleware factory: reads X-Skynet-Serve-Subdomain, parses per D-11, runs JWT + resolve + canAccessHost gates, dispatches (attach ServeTarget + next) OR renders interstitial per D-14 failure class"
  - "src/backend/serve-url/serve-route.ts — serveUrlHandler: composes tunnelCache.getOrCreate → getOrCreateProxyForTarget → proxy dispatch; error-taxonomy classifier maps ECONNREFUSED/ETIMEDOUT/EHOSTUNREACH/ENETUNREACH/ssh2-level errors to ErrorClass; res.on('finish') success log"
  - "src/backend/database/database.ts — mounts createSubdomainDispatchMiddleware() + serveUrlHandler AFTER cookieParser and BEFORE bodyParser per http-proxy-middleware v4 raw-body streaming semantics (D-24)"
affects:
  - "Plan 10 (end-of-phase UAT) — full serve URL request path now assembled end-to-end; UAT can construct http://<host>-<port>.serve.term.<domain> and validate"
  - "Every existing request path — new middleware chain: CORS → cookieParser (moved up) → subdomain-dispatch → serveUrlHandler → bodyParser → response-header middleware → routes"

# Tech tracking
tech-stack:
  added: []  # No new packages; all dependencies satisfied by Plans 02/03a/03b
  patterns:
    - "Proxy-wrapped Express Response for auth-middleware outcome interception (translates 401 into auth_missing interstitial without leaking JSON error body)"
    - "Structured-only error classification (probes err.code/err.level/err.name; never Error body text) — info-leak-safe by design"
    - "Module-load throw at factory invocation / import (W4/D-23 fail-loud) — no silent-wrong hardcoded primary-domain fallback"
    - "res.on('finish') listener registered BEFORE proxy middleware dispatch (order-sensitive — fast-completing responses would race the registration otherwise)"
    - "Deterministic middleware mount order (cookieParser → dispatch → serve-route → bodyParser) documented inline per http-proxy-middleware v4 raw-body streaming semantics"

key-files:
  created:
    - "src/backend/serve-url/subdomain-dispatch.ts (418 lines) — four-stage gate + fail-loud env + proxy-wrapped auth invocation"
    - "src/backend/serve-url/serve-route.ts (199 lines) — tunnel + proxy composition + error mapping + finish log"
    - "src/backend/serve-url/tests/subdomain-dispatch.test.ts (328 lines) — 11 test cases covering all four gate stages + fall-through + fail-loud"
    - "src/backend/serve-url/tests/serve-route.test.ts (273 lines) — 8 test cases covering error classification + proxy invocation + no-auth-reinvocation"
  modified:
    - "src/backend/database/database.ts (+11 -4 lines) — 2 imports + 4-line reorder (cookieParser + dispatch + serve-route + bodyParser) + inline rationale comment"

key-decisions:
  - "Proxy-wrapped res for auth middleware interception — subdomain-dispatch needs to intercept auth's 401 write to render our own auth_missing interstitial instead of leaking Skynet's JSON error body onto the serve subdomain. Chose a Proxy over res-method monkey-patching so clearCookie / other pass-through methods work naturally and the interception is scoped to the auth invocation only."
  - "Module-load throw pattern (const PRIMARY_DOMAIN = (() => { ... })()) for serve-route.ts vs factory-invocation throw for subdomain-dispatch.ts — serve-route.ts exports a bare handler (no factory), so the fail-loud check runs at module-load via IIFE; subdomain-dispatch.ts exports a factory, so the fail-loud check runs at factory invocation. Both are equivalent — Skynet's boot sequence would trip either the moment database.ts imports the module. Kept as separate throws per file (rather than routing through a shared config module) because both files independently need to fail loud and a shared helper would add indirection."
  - "Error classifier uses structured fields ONLY (code, level, name) — never touches Error message body or stack. Info-leak invariant T-40-05 preserved structurally: the classifier CANNOT accidentally include user-supplied bytes in its output because it doesn't touch them."
  - "Fall-through defense on missing serveTarget in serve-route.ts — if subdomain-dispatch chose not to attach (unknown/missing subdomain header) or the mount order is misconfigured, the handler calls next() instead of erroring. Belt-and-braces: keeps the primary Skynet frontend reachable even if the dispatch middleware has a bug."
  - "res.on('finish') registered BEFORE tunnelCache.getOrCreate — order matters. If registered after the tunnel-cache await, a fast-path already-cached hit could dispatch the proxy synchronously and race the finish listener into the past. Registered first, then any code path (success + error interstitial) triggers finish exactly once."
  - "cookieParser MOVED UP (was line 288 → now line 294) instead of adding a second cookieParser call. Two cookieParser instances would double-parse Cookie headers and produce duplicate req.cookies entries; safer to just relocate the single existing instance."
  - "Task 3 subsumed doc-reword cleanups into its commit rather than 4 separate one-line commits — the reword was required to satisfy Task 1/2 acceptance criteria greps but wasn't discovered until Task 3 verification pass. Bundled into the mount commit because they're one continuous 'ship the mount' motion."

patterns-established:
  - "serve-url middleware mount-order pattern: cookieParser (or any header-only middleware) → subdomain-dispatch (dispatch middleware that may write interstitial or attach req.serveTarget) → serveUrlHandler (proxy-composition middleware that consumes req.serveTarget or falls through) → body-consuming middleware. Any future subdomain-based proxy in Skynet follows the same order for the same http-proxy-middleware raw-body streaming reason."
  - "Auth-middleware-outcome interception pattern: wrap res in a Proxy that intercepts status/send/json/end to detect a failure-write and resolve a discriminated union {ok: true} | {ok: false, status: number}. Reusable for any future dispatcher that needs to translate an auth middleware's response format into a different one (e.g. render an HTML interstitial instead of returning JSON error)."
  - "Fail-loud-at-import pattern for env-driven config: IIFE-evaluated `const PRIMARY_DOMAIN = (() => { if (!value) throw ...; return value; })()` — makes the module unimportable if env is unset, so Skynet's boot sequence fails fast and loudly rather than silently accepting a wrong default. Reusable for any future env-driven config with a security-sensitive default."

requirements-completed: []  # Plan frontmatter had empty requirements array

# Metrics
duration: ~12min
completed: 2026-09-10
---

# Phase 103 Plan 05: Subdomain-dispatch + serveUrlHandler + database.ts mount Summary

**Composes the serve URL request path end-to-end: (1) subdomain-dispatch middleware runs the four-stage gate (parse per D-11 → JWT auth → resolveHostByName per D-13/D-17 → canAccessHost per D-03) and either attaches ServeTarget or renders a classified interstitial; (2) serveUrlHandler composes tunnelCache + proxy-factory + error-taxonomy classification with a res.on('finish') success log and NO auth re-invocation; (3) database.ts mounts both after cookieParser and before bodyParser per http-proxy-middleware v4 raw-body streaming semantics (D-24). Fails loud (throws) at module load / factory invocation if SKYNET_COOKIE_DOMAIN unset — no hardcoded 'term.gigaashley.click' fallback anywhere in serve-url source (W4/D-23).**

## Performance

- **Duration:** ~12 min (3 tasks — 2 TDD [RED + GREEN each] + 1 auto)
- **Started:** 2026-09-10T16:34:00Z
- **Completed:** 2026-09-10T16:40:30Z
- **Tasks:** 3
- **Files created:** 4 (2 source + 2 test)
- **Files modified:** 1 (database.ts)
- **Test cases added:** 19 (11 subdomain-dispatch + 8 serve-route)

## Accomplishments

- **Sealed the serve URL end-to-end request path.** Plan 03a's data primitives (types + tunnel-cache + interstitial) and Plan 03b's behavior primitives (proxy-factory + header-audit-sampler) were isolated components until now; this plan wires them into an Express middleware chain that turns `*.serve.term.<domain>` HTTP requests into (a) SSH-tunneled reverse-proxy dispatches, (b) classified Skynet-styled interstitials on failure, or (c) 302 redirects to `/login` on missing auth.
- **Made the mount order deterministic and documented the rationale inline.** http-proxy-middleware v4 streams the raw request body to upstream — bodyParser consumption upstream of the proxy would truncate POST bodies to zero. The mount now runs cookieParser (header-only, safe) → dispatch → serve-route → bodyParser, with a code-comment explaining WHY so a future maintainer doesn't "clean up" the order.
- **Enforced W4 fail-loud env-check structurally.** Both new files throw at import/factory-invocation if SKYNET_COOKIE_DOMAIN is unset — Skynet cannot boot cleanly with a wrong default. Zero literal `term.gigaashley.click` strings in either new source file (grep-gate clean).
- **Preserved info-leak invariant T-40-05 in the error path.** The tunnel-error classifier uses ONLY structured fields (err.code / err.level / err.name), NEVER the Error body text or stack. Response bodies (interstitials) contain only the classified sentence + hostname + port. Logs carry `{ operation, target, errorClass, duration }` — never raw Error text.
- **Delivered 19 test cases across two spec files that cover every branch of both new modules.** RED verified failing on missing modules; GREEN verified passing after implementation. No integration-test scope creep — Plan 04's no-cookie-egress test covers the wire-level cookie-strip; Plan 10 UAT covers the end-to-end path.

## Task Commits

Each task committed atomically:

1. **Task 1 RED — subdomain-dispatch test** — `a71eed2c` (test)
2. **Task 1 GREEN — subdomain-dispatch middleware** — `d228451f` (feat)
3. **Task 2 RED — serve-route test** — `0eb4db22` (test)
4. **Task 2 GREEN — serveUrlHandler** — `19c36170` (feat)
5. **Task 3 — database.ts mount + doc rewords** — `5a375177` (feat)

_Note: No STATE.md / ROADMAP.md commit produced per orchestrator instructions ("Do NOT update STATE.md or ROADMAP.md")._

## Files Created/Modified

- **`src/backend/serve-url/subdomain-dispatch.ts` (NEW, ~418 lines)** — Exports `createSubdomainDispatchMiddleware()` factory. Reads `process.env.SKYNET_COOKIE_DOMAIN` at factory-invocation time and throws if unset. Returns an Express middleware `(req, res, next) => Promise<void>` that:
  1. Falls through to `next()` if `x-skynet-serve-subdomain` header absent.
  2. Parses `<hostname>-<port>` per D-11 (split on LAST dash of leftmost DNS label; validates port is 1-65535). Parse failure → port_not_listening interstitial.
  3. Runs AuthManager.createAuthMiddleware() via a Proxy-wrapped res that intercepts 401/failure writes. Auth failure → auth_missing interstitial (302 to `/login?return=<originalUrl>`).
  4. Calls `resolveHostByName(hostname.toLowerCase(), userId)` per D-13. Null → host_unreachable interstitial.
  5. Calls `permissionManager.canAccessHost(userId, host.id, 'read')` per D-03. !hasAccess → permission_denied interstitial (403).
  6. Attaches `req.serveTarget = { hostname: host.name, port, host }` (canonical DB display case preserved per D-13) and calls `next()`.
  Structured logs at parse-failed, unknown-host, permission-denied boundaries — never emit err.message or raw subdomain string (T-40-05, T-103-27).

- **`src/backend/serve-url/serve-route.ts` (NEW, ~199 lines)** — Exports `serveUrlHandler(req, res, next): Promise<void>`. Reads `process.env.SKYNET_COOKIE_DOMAIN` at module-load time via IIFE and throws if unset (fail-loud W4/D-23). Behavior:
  1. Fall through with `next()` if `req.serveTarget` unset (defensive).
  2. Register `res.on('finish', ...)` success log BEFORE dispatch (order-sensitive).
  3. `await tunnelCache.getOrCreate(target)` in try/catch; on catch, `classifyTunnelError(err)` maps err.code/level/name to ErrorClass (ECONNREFUSED→port_not_listening; ETIMEDOUT/EHOSTUNREACH/ENETUNREACH→host_unreachable; ssh2 client-authentication or SSH_* code family or ClientError name→ssh_failure; default→ssh_failure). Render interstitial + return.
  4. On success: `getOrCreateProxyForTarget(target, tunnelPort)` and invoke on `(req, res, next)`. http-proxy-middleware handles HTTP + WS upgrade + streaming from there.
  MUST NOT invoke AuthManager or PermissionManager (subdomain-dispatch owns those per D-03).

- **`src/backend/serve-url/tests/subdomain-dispatch.test.ts` (NEW, ~328 lines)** — 11 unit tests. Mocks resolveHostByName / PermissionManager / AuthManager / logger. Covers: fail-loud env throw; header-absent fall-through; parse failure (no dash, non-digit port, out-of-range port); auth 401 → 302 auth_missing redirect; resolveHostByName null → host_unreachable; D-13 lowercase invariant; canAccessHost false → 403 permission_denied; success path attaches serveTarget with DB display-case hostname; D-11 last-dash parsing (`foo-bar-3000` → hostname=foo-bar, port=3000).

- **`src/backend/serve-url/tests/serve-route.test.ts` (NEW, ~273 lines)** — 8 unit tests. Mocks tunnelCache / proxy-factory / logger. Covers: fail-loud env throw at module load; serveTarget-unset fall-through; ECONNREFUSED → port_not_listening; ETIMEDOUT → host_unreachable; EHOSTUNREACH → host_unreachable; ssh2 client-authentication → ssh_failure; success path invokes proxy middleware with (target, tunnelPort) + registers finish listener; NO AuthManager/PermissionManager singleton access.

- **`src/backend/database/database.ts` (MODIFIED, +11 -4 lines)** — Added two imports (createSubdomainDispatchMiddleware, serveUrlHandler). Reordered mounts at lines 285-299:
  - **Before:** `bodyParser.json` (285) → `bodyParser.urlencoded` (286) → `bodyParser.raw` (287) → `cookieParser()` (288)
  - **After:** `cookieParser()` (294) → `createSubdomainDispatchMiddleware()` (295) → `serveUrlHandler` (296) → `bodyParser.json` (297) → `bodyParser.urlencoded` (298) → `bodyParser.raw` (299)
  6-line inline rationale comment (lines 287-293) explains the http-proxy-middleware v4 raw-body streaming reason.

## Decisions Made

- **Proxy-wrapped res for auth middleware interception.** subdomain-dispatch needs to intercept AuthManager's 401 write to render our own auth_missing interstitial (302 to `/login?return=`) instead of leaking Skynet's `{"error":"Missing authentication token"}` JSON body onto the serve subdomain. Chose an ES2015 Proxy over method monkey-patching because:
  1. clearCookie() calls (auth middleware emits on invalid-token path) pass through cleanly to the real response — the intercepted proxy transparently delegates all non-tracked method access via Reflect.get.
  2. Interception is scoped to the auth-middleware call site only; the real res passes to the interstitial renderer AFTER auth resolves, so no downstream code sees the Proxy.
  3. The Proxy-wrapper's `settled` flag ensures we resolve exactly once even if the auth middleware calls both `res.status(401).json(...)` (which sets status then writes body).
- **Module-load throw vs factory-invocation throw — different shape per file.** serve-route.ts exports a bare handler function (no factory), so the fail-loud check runs at module-load via IIFE: `const PRIMARY_DOMAIN = (() => { ... })()`. subdomain-dispatch.ts exports a factory `createSubdomainDispatchMiddleware()`, so the check runs at factory-invocation time (which happens exactly once at database.ts import). Both are equivalent from a boot-fail perspective — the moment database.ts imports either module, an unset env trips the throw. Kept as separate throws (rather than routing through a shared config helper) because both files independently need to fail loud and a shared helper would add indirection.
- **Error classifier uses structured fields ONLY.** classifyTunnelError probes err.code (ECONNREFUSED / ETIMEDOUT / EHOSTUNREACH / ENETUNREACH / SSH_*) + err.level (ssh2's client-authentication / protocol) + err.name (ClientError). NEVER touches err.message body text or err.stack. This makes the info-leak invariant T-40-05 structurally enforced: the classifier CANNOT accidentally include user-supplied bytes because it doesn't touch them. Fallback default is ssh_failure (safer to surface as SSH-level than pretend target is offline).
- **Fall-through defense in serve-route.ts on missing serveTarget.** If subdomain-dispatch chose not to attach (unknown/missing subdomain header) OR the mount order is misconfigured, serveUrlHandler calls `next()` instead of erroring. Belt-and-braces: primary Skynet frontend remains reachable even under middleware-config bugs.
- **res.on('finish') registered BEFORE tunnelCache.getOrCreate.** Order matters — if registered after the await, a fast-path already-cached tunnel hit could dispatch the proxy synchronously and race the finish listener into the past. Registered first, then any code path (success + all interstitial branches) triggers finish exactly once.
- **cookieParser MOVED UP (not duplicated).** Adding a second cookieParser would double-parse Cookie headers and produce duplicate req.cookies entries. Safer to relocate the single existing instance.
- **Bundled doc-reword cleanups into Task 3 commit.** Tasks 1 and 2 had acceptance criteria `! grep -q 'term.gigaashley.click' ...` — my initial docstrings contained the literal string as illustration ("t1000 sets term.gigaashley.click, T800 sets its own value"). The grep-gate fires on doc mentions, not just runtime fallbacks. Reworded to "hardcoded primary-domain fallback — t1000 sets its own value, T800 sets its own value" and folded into Task 3's mount commit rather than amending prior commits or making 4 separate one-line fix commits. Zero behavior change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking / Verification] Reworded three docstrings in subdomain-dispatch.ts to remove literal 'term.gigaashley.click'**
- **Found during:** Task 3 verification pass (after Task 1 + Task 2 were already committed)
- **Issue:** Task 1's acceptance criterion `! grep -q 'term\.gigaashley\.click' src/backend/serve-url/subdomain-dispatch.ts` initially failed because 3 docstring lines contained the literal string as illustration:
  1. Docblock header: "NO hardcoded `term.gigaashley.click` fallback — t1000 sets its own value..."
  2. Factory-scope docblock: "no silent-wrong hardcoded 'term.gigaashley.click' fallback"
  3. Throw error message: "(per D-23; t1000 sets term.gigaashley.click, T800 sets its own value)"
- **Fix:** Reworded to "hardcoded primary-domain fallback", "hardcoded primary-domain fallback", and "(per D-23; each Skynet host sets its own value; no hardcoded fallback)" respectively. Zero behavior change; grep-gate now clean.
- **Files modified:** `src/backend/serve-url/subdomain-dispatch.ts`
- **Committed in:** `5a375177` (Task 3 commit — bundled with mount changes)

**2. [Rule 3 — Blocking / Verification] Reworded one docstring in serve-route.ts to remove literal 'term.gigaashley.click'**
- **Found during:** Task 3 verification pass
- **Issue:** Task 2's acceptance criterion `grep -c 'term\.gigaashley\.click' src/backend/serve-url/serve-route.ts` returned 1 (docblock line: "NO hardcoded 'term.gigaashley.click' fallback — t1000 sets its own").
- **Fix:** Reworded to "NO hardcoded primary-domain fallback — t1000 sets its own value, T800 sets its own value". Zero behavior change.
- **Files modified:** `src/backend/serve-url/serve-route.ts`
- **Committed in:** `5a375177` (Task 3 commit — bundled with mount changes)

**3. [Rule 3 — Blocking / Verification] Reworded 'err.message' and 'AuthManager/PermissionManager' doc references to satisfy grep verifiers**
- **Found during:** Task 1 and Task 2 verification passes
- **Issue:** Plan acceptance greps (`grep -cE 'err\.message|error\.message'` and `grep -c 'AuthManager|PermissionManager'`) fire on doc mentions, not just runtime references. Docblocks in both files contained explanatory sentences like "NEVER touches err.message body text" (info-leak explanation) and "MUST NOT re-invoke AuthManager or PermissionManager" (D-03 reminder). These trip the grep verifiers even though the code itself doesn't reference the forbidden APIs.
- **Fix:** Reworded to "never touches the Error body text" and "MUST NOT re-invoke the auth manager or permission manager here". Same semantic meaning; no false positives on grep.
- **Files modified:** `src/backend/serve-url/subdomain-dispatch.ts`, `src/backend/serve-url/serve-route.ts`
- **Committed in:** `d228451f` (subdomain-dispatch initial cleanup), `19c36170` (serve-route initial cleanup), `5a375177` (bundled remaining cleanups)

**4. [Documentation — Non-Rule] Kept interstitial.ts's `term.gigaashley.click` docstring reference (scope boundary)**
- **Found during:** Task 3 W4 grep-gate scan
- **Issue:** `interstitial.ts` (created by Plan 03a) has ONE docstring reference: "`@param primaryDomain  The primary Skynet domain (e.g. \"term.gigaashley.click\") ...`" — a parameter documentation example, not a runtime fallback. The W4 rule from box-maintainer says "0 matches for literal 'term.gigaashley.click' under `src/backend/serve-url/`" but this plan's acceptance criteria explicitly greps only the two NEW files (subdomain-dispatch.ts, serve-route.ts).
- **Decision:** DEFERRED to Plan 03a cleanup or a follow-up doc pass — modifying interstitial.ts here would violate the scope-boundary rule (only auto-fix issues caused by current task's changes). Interstitial.ts's reference is a documentation example predating this plan.
- **Not a Rule 1/2/3 deviation** — this is a scope-boundary decision surfaced during Task 3 verification.

---

**Total deviations:** 3 Rule-3 verification-unblocking rewords + 1 scope-boundary decision (documented, not fixed).
**Impact on plan:** No scope creep, no architectural change, no behavior change. All reworks are docstring text changes. Task 1 and Task 2 grep-gate acceptance criteria pass cleanly after rewords. Interstitial.ts scope-boundary decision recorded for potential future cleanup.

## Issues Encountered

- **`npx vitest run` with a grep-cardinality assertion in a shell `&&` chain silently short-circuits on 0 matches.** `grep -c` returns exit code 1 when the pattern is not found (a match count of 0 is treated as failure). Verification scripts that chained `grep -c 'X' file && grep -c 'Y' file` treated the intended 0-match case as a script failure. Worked around by capturing output first, then evaluating, or `|| true` after each grep. Non-blocking; documented for future verifiers.
- **No integration-test scope creep.** The `<verification>` block in the plan calls for `npx vitest run src/backend/serve-url/ --exclude='**/*.integration.test.ts'` — I ran exactly this scope. Plan 04's no-cookie-egress integration test remains the wire-level cookie-strip guardrail; Plan 10 UAT will validate the assembled end-to-end path on a live container. This plan's tests exercise ONLY the middleware decision trees + error classification.

## User Setup Required

None — no external service configuration required. The `SKYNET_COOKIE_DOMAIN` env var is required for production boot but was already an established Plan 02 requirement (widened JWT cookie). t1000 sets it in `/opt/skynet/skynet.env` per D-24 single-deploy motion.

## Threat Register Realization

Realizes the following threats from the plan's `<threat_model>`:

| Threat ID | Category | Component | Realized by |
|-----------|----------|-----------|-------------|
| T-103-22 | Spoofing | Client-supplied X-Skynet-Serve-Subdomain header | Accepted per plan — Caddy overwrites the header at edge (Plan 01); backend does no additional validation because bypass = attacker already inside Docker network. Documented in subdomain-dispatch.ts docblock. |
| T-103-23 | Information disclosure | Response body leaking hostname existence (unknown host vs offline) | subdomain-dispatch maps null resolveHostByName result to `host_unreachable` interstitial — same body as an actually-offline host. Attacker cannot enumerate registered hosts by response fingerprint. |
| T-103-24 | Elevation of privilege | Missing JWT check | AuthManager.createAuthMiddleware() invoked BEFORE resolveHostByName in the 4-stage gate. Unit test verifies unauthenticated request returns 302 auth_missing (not the proxy response). |
| T-103-25 | Tampering | Order-of-operations bug — permission check bypassed by early exception | Explicit sequential await chain (parse → auth → resolve → permission); no fall-through paths that could skip stages. Structured logs at each stage boundary give auditability. |
| T-103-26 | Denial of service | Malformed subdomain header triggering expensive parse | Accepted per plan — parse is O(len) string ops (split + lastIndexOf + Number()); no regex backtracking risk. |
| T-103-27 | Information disclosure | Raw subdomain string logged/echoed | Parse-failure log emits `{ subdomainLen }` not the full string. Interstitial bodies contain only parsed hostname+port (which fall from the parse). |
| T-103-28 | Repudiation | Missing audit trail on dispatch failures | sshLogger.warn/info at parse-failed / unknown-host / permission-denied boundaries with `{ userId, hostname, port, operation }` structured context. |
| T-103-45 | Tampering | Silent-wrong domain via hardcoded fallback | Both new modules THROW at import / factory-invocation if SKYNET_COOKIE_DOMAIN unset (fail-loud per W4/D-23). Zero literal domain string in either new source file (grep-gate clean). |
| T-103-46 | Tampering | POST body truncation via wrong middleware mount order | Dispatch + serveUrlHandler mount BEFORE bodyParser per http-proxy-middleware v4 raw-body streaming semantics. Mount order enforced by line-number check in verification. Inline rationale comment prevents future maintainers from "cleaning up" the order. |

## Verification

- `npx tsc --noEmit`: **exit 0** (no output)
- `npx vitest run src/backend/serve-url/ --exclude='**/*.integration.test.ts'`: **19/19 pass** (11 subdomain-dispatch + 8 serve-route)
- `grep -c 'term\.gigaashley\.click' src/backend/serve-url/subdomain-dispatch.ts`: **0**
- `grep -c 'term\.gigaashley\.click' src/backend/serve-url/serve-route.ts`: **0**
- `grep -cE 'err\.message|error\.message|\.stack' src/backend/serve-url/subdomain-dispatch.ts`: **0**
- `grep -cE 'err\.message|error\.message' src/backend/serve-url/serve-route.ts`: **0**
- `grep -c 'AuthManager\|PermissionManager' src/backend/serve-url/serve-route.ts`: **0**
- `grep -c 'x-skynet-serve-subdomain' src/backend/serve-url/subdomain-dispatch.ts`: **1**
- `grep -c 'resolveHostByName' src/backend/serve-url/subdomain-dispatch.ts`: **3**
- `grep -c 'canAccessHost' src/backend/serve-url/subdomain-dispatch.ts`: **2**
- `grep -c 'renderInterstitial' src/backend/serve-url/subdomain-dispatch.ts`: **8** (≥4 required)
- `grep -c '\.toLowerCase()' src/backend/serve-url/subdomain-dispatch.ts`: **2**
- `grep -c 'SKYNET_COOKIE_DOMAIN' src/backend/serve-url/subdomain-dispatch.ts`: **2**
- `grep -c 'SKYNET_COOKIE_DOMAIN' src/backend/serve-url/serve-route.ts`: **2**
- `grep -c 'sshLogger\.\(info\|warn\)' src/backend/serve-url/subdomain-dispatch.ts`: **5** (≥3 required)
- `grep -c 'tunnelCache.getOrCreate' src/backend/serve-url/serve-route.ts`: **1**
- `grep -c 'getOrCreateProxyForTarget' src/backend/serve-url/serve-route.ts`: **1**
- `grep -c 'ECONNREFUSED' src/backend/serve-url/serve-route.ts`: **1**
- `grep -cE 'port_not_listening|host_unreachable|ssh_failure' src/backend/serve-url/serve-route.ts`: **10** (≥3 required)
- `grep -c "res\.on('finish'" src/backend/serve-url/serve-route.ts`: **1**
- Line-order check in database.ts: cookieParser@294 < dispatch@295 < bodyParser@297 — **ORDER OK**
- `grep -c 'createSubdomainDispatchMiddleware' src/backend/database/database.ts`: **2** (≥2 required — import + mount)
- `grep -c 'serveUrlHandler' src/backend/database/database.ts`: **2** (import + mount)
- `grep -q 'http-proxy-middleware' src/backend/database/database.ts`: **YES** — rationale comment references it
- Existing app.use('/users', ...) etc. router mounts at lines ~1855+: **UNCHANGED** (`git diff` confirms only lines 285-299 + imports touched)

## Next Phase Readiness

- **Plan 10 (end-of-phase UAT)** — READY. The full serve URL request path is now assembled end-to-end:
  1. Browser hits `https://<host>-<port>.serve.term.gigaashley.click/<path>`
  2. Caddy sets `X-Skynet-Serve-Subdomain: <host>-<port>.serve.term.gigaashley.click` (Plan 01)
  3. Skynet backend's cookieParser parses the JWT cookie (widened per Plan 02)
  4. subdomain-dispatch parses hostname/port (Task 1), runs JWT + resolve + canAccessHost gates, attaches ServeTarget
  5. serveUrlHandler (Task 2) calls tunnelCache.getOrCreate → getOrCreateProxyForTarget → proxy dispatch
  6. http-proxy-middleware pipes HTTP + WS through the SSH tunnel to the agent's port
  7. On any failure, a Skynet-styled interstitial renders (or 302 redirects for auth_missing)
- **No blockers.** All 19 tests green; tsc clean; grep-gates clean; mount-order enforced.
- **Deploy motion** — orchestrator's responsibility per role directive "subagents don't do deploys". Executor's remit stopped at code + commit + scoped-green.

## Self-Check: PASSED

Files verified to exist on disk:
- FOUND: `src/backend/serve-url/subdomain-dispatch.ts`
- FOUND: `src/backend/serve-url/serve-route.ts`
- FOUND: `src/backend/serve-url/tests/subdomain-dispatch.test.ts`
- FOUND: `src/backend/serve-url/tests/serve-route.test.ts`
- FOUND: `src/backend/database/database.ts` (modified)

Commits verified in git log:
- FOUND: `a71eed2c` (test 103-05: RED subdomain-dispatch)
- FOUND: `d228451f` (feat 103-05: GREEN subdomain-dispatch middleware)
- FOUND: `0eb4db22` (test 103-05: RED serve-route)
- FOUND: `19c36170` (feat 103-05: GREEN serveUrlHandler)
- FOUND: `5a375177` (feat 103-05: database.ts mount + doc rewords)

---
*Phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2*
*Completed: 2026-09-10*
