---
phase: 120-first-class-apps-campaign-shape-4-apps-as-a-content-type-in-
plan: 05
subsystem: backend/apps
tags: [proxy, express-router, websocket-upgrade, csrf, integration-test, anti-clickjacking]
dependency_graph:
  requires:
    - "120-01 (appProxyCsrfCheck + PRIMARY_DOMAIN + injectBaseTag)"
    - "120-02 (getOrCreateAppPaneProxyForTarget + resolvePaneTarget)"
  provides:
    - "appPaneRouter (Express Router mounted at /apps in database.ts)"
    - "handleAppPaneUpgrade(req, socket, head): async WS upgrade dispatcher"
    - "Wire-level /apps/:hostId/:slug/pane/* HTTP + WS proxy surface"
  affects:
    - "Plan 06 (frontend AppPane) — iframe can now target /apps/:hostId/:slug/pane/"
    - "Plan 08 (D-23 UAT) — full request cycle exercisable end-to-end"
tech_stack:
  added: []
  patterns:
    - "Express 5 named-wildcard route pattern `/:hostId/:slug/pane{/*splat}` — Express 5's path-to-regexp v6+ rejects bare `*`"
    - "http.Server-level `.on(\"upgrade\", ...)` binding for WebSocket routing (NOT `router.all` — WS upgrades bypass Express dispatch entirely)"
    - "Anti-clickjacking headers (X-Frame-Options + CSP frame-ancestors) set at the router BEFORE proxy handoff; http-proxy-middleware preserves upstream response headers"
    - "In-process integration test with real http.createServer(app) + raw TCP client via net.connect (BLOCKER 6: mocked-middleware WS tests are false-positives)"
    - "Bare Express app + Node http.request client scaffold (mirrors database/routes/apps.test.ts) — no supertest dependency added"
    - "Info-leak invariant enforced via byte-identical 403 JSON body across host-unresolvable + access-denied branches; asserted in-test via strict string equality"
key_files:
  created:
    - "src/backend/apps/app-pane-router.ts"
    - "src/backend/apps/tests/app-pane-router.integration.test.ts"
    - ".planning/phases/120-first-class-apps-campaign-shape-4-apps-as-a-content-type-in-/120-05-SUMMARY.md"
  modified:
    - "src/backend/database/database.ts"
decisions:
  - "Anti-clickjacking headers (X-Frame-Options: SAMEORIGIN + CSP frame-ancestors 'self') live in app-pane-router.ts, NOT in a new middleware or nginx location block. Rationale: no existing rule covers /apps/* in docker/nginx.conf* (verified via grep — zero matches). Setting them at the router before the proxy handoff means http-proxy-middleware's response pipeline preserves them to the client. Adding a nginx location block would require dual-edit (both nginx.conf + nginx-https.conf per the CLAUDE.md caveat) plus a container rebuild; the router-side setter is a strictly-narrower change."
  - "handleAppPaneUpgrade LIVES IN app-pane-router.ts (not a separate ws-dispatcher module). Rationale: BLOCKER 6's fix requires the SAME auth/validation/access/CSRF/port/target chain as the HTTP route. Keeping both paths in one file means the router and the dispatcher can share the same const authManager + module-level mocks trivially, and any future addition to the HTTP chain (e.g. new request-validation step) is impossible to skip on the WS path."
  - "Origin check on WS upgrade is INLINE in handleAppPaneUpgrade, NOT via appProxyCsrfCheck. Rationale: appProxyCsrfCheck short-circuits GET/HEAD/OPTIONS as safe methods — but WebSocket upgrades ARE GET requests. Reusing the helper via a fake-method adapter would be misleading. Inlining a direct Origin === PRIMARY_DOMAIN check keeps the WS security model self-documenting: every WS upgrade to /apps/*/pane MUST have Origin === PRIMARY_DOMAIN, missing or mismatched fails 403."
  - "JWT extraction from upgrade request uses raw Cookie header parsing (extractJwtFromUpgradeReq), NOT cookieParser. Rationale: cookieParser is Express middleware and runs during HTTP dispatch — the upgrade event fires BEFORE Express dispatch, so req.cookies is unpopulated. A small 15-line parser matches auth-manager's own cookie shape (.cookies?.jwt) and is safer than routing the upgrade req through cookieParser as a shim."
  - "Rejected upgrade branches write bare status-lines (HTTP/1.1 xxx Yyyy) with no body. Rationale: upgrade rejections have no visible-body wire format anyway (the client is either an HTTP client that stopped reading after headers or a WS client waiting for a 101). Info-leak invariant holds trivially — every failure mode is indistinguishable at the wire level."
  - "Route pattern is `/:hostId/:slug/pane{/*splat}` (Express 5 optional-named-wildcard) — NOT `/:hostId/:slug/pane/*`. Rationale: Express 5 uses path-to-regexp v6+, which rejects bare * as \"Missing parameter name\". Bracketed segment `{/*splat}` makes the wildcard optional, so requests to `/apps/5/todo/pane/` (trailing slash, no suffix) still match — matches Plan 06's iframe src pattern which does exactly that."
metrics:
  duration_minutes: ~30
  tasks_completed: 3
  test_count: 17
  files_created: 2
  files_modified: 1
  completed: 2026-09-19
requirements_satisfied:
  - "D-08 — the /apps/:hostId/:slug/pane/* proxy path is live under Skynet's primary origin, mounted at /apps in database.ts"
  - "D-09 — proxy handoff uses the sibling factory (Plan 02) verbatim; the serve-url shared factory is not touched"
  - "D-10 — target resolution routes through resolvePaneTarget (Plan 02, unconditional-tunnel per Q1 RESOLVED)"
  - "D-12 — checkHostAccess(hostId, userId, host.userId, \"read\") gates every request at the route entrypoint; the same gate runs on the WS upgrade path"
  - "D-13 — appProxyCsrfCheck(req, PRIMARY_DOMAIN) refuses state-changing cross-origin requests before any tunnel work"
  - "D-17 — tunnel-establishment errors flow through classifyTunnelError + renderInterstitial + writeInterstitial (Phase 103's shared error surface)"
  - "D-21 — 12+ backend-proxy-layer test cases pass (17 actual: HTTP GET, HTTP POST matched/mismatched/missing Origin, WS upgrade matched/mismatched Origin, checkHostAccess denial, path-prefix strip, info-leak invariant byte-equal 403, slug validation, hostId validation, tunnel error interstitial, port lookup miss + null port)"
---

# Phase 120 Plan 05: App-pane router composition + WS upgrade wiring Summary

Landed the composed backend surface for the in-pane app proxy — a new
Express router `appPaneRouter` and an `http.Server`-level WebSocket
upgrade dispatcher `handleAppPaneUpgrade`, both mounted in
`src/backend/database/database.ts` alongside Phase 119's icon route.
Every request under `/apps/:hostId/:slug/pane/*` (HTTP OR WS) now
flows through the full seven-stage chain (auth → validate → access
gate → CSRF gate → port lookup → target resolve → proxy handoff),
with byte-identical 403 bodies preserving the info-leak invariant
between "host unresolvable" and "access denied" branches. A 17-case
integration test suite exercises the full request/response cycle
against mocked upstream + factory + resolver, including a REAL
`http.createServer(app)` + raw TCP client for the WS upgrade path
(per BLOCKER 6 — a mocked-middleware unit test cannot distinguish
HTTP from WS upgrade).

## Route Composition (LOAD-BEARING order — DO NOT REORDER)

```
authenticateJWT
  ↓
APP_SLUG_RE.test(slug)                                → 400 on failure
  ↓
Number.isInteger(hostId) && hostId > 0                → 400 on failure
  ↓
resolveHostById(hostId, userId)                       → 403 "app home box unreachable" on null
  ↓
checkHostAccess(hostId, userId, host.userId, "read")  → 403 "app home box unreachable" on false
  ↓
appProxyCsrfCheck(req, PRIMARY_DOMAIN)                → 403 "cross-origin state-changing request refused" on false
  ↓
getRegistry().getAppSnapshot() .find((hostId,slug))    → 404 "app is not currently serving on a port"
  ↓
res.setHeader("X-Frame-Options", "SAMEORIGIN")        → anti-clickjacking (T-120-30)
res.setHeader("Content-Security-Policy", "frame-ancestors 'self'")
  ↓
resolvePaneTarget(hostId, host, port)                 → tunnel-error interstitial via classifyTunnelError + renderInterstitial + writeInterstitial
  ↓
getOrCreateAppPaneProxyForTarget(target, tunnelPort, hostId, slug)
proxyMiddleware(req, res, next)                       → byte-forwarding + response transform + WS upgrade handoff
```

The WebSocket upgrade path (`handleAppPaneUpgrade`) runs an equivalent
chain — same auth (via `AuthManager.verifyJWTToken` on the raw JWT
cookie), same slug/hostId/host-access checks, INLINE Origin check
(because `appProxyCsrfCheck` short-circuits GET/upgrade as a safe
method), same port lookup + target resolve, then invokes
`proxyMiddleware.upgrade(req, socket, head)` on the SAME cached
middleware the HTTP path uses (per-slug cache key ensures both share
one instance).

## Anti-Clickjacking Coverage (Task 3(g))

**Verdict: existing edge did NOT cover /apps/*; anti-clickjacking headers ADDED at the router.**

Grep verification:

```bash
$ grep -rn 'X-Frame-Options\|frame-ancestors\|helmet' \
    docker/nginx.conf docker/nginx-https.conf \
    src/backend/database/database.ts 2>/dev/null
(zero output)

$ grep -in '/apps' docker/nginx.conf docker/nginx-https.conf
(zero output — /apps/* falls through the SPA fallback rule
 `try_files $uri @express_spa_fallback` which proxies to Express)
```

No existing nginx location block covers `/apps/*`. Skynet's nginx
does not set X-Frame-Options / CSP frame-ancestors at the edge, and
there is no `helmet` middleware in the Express stack. The pane router
therefore sets both headers explicitly BEFORE the proxy handoff:

```typescript
res.setHeader("X-Frame-Options", "SAMEORIGIN");
res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
```

http-proxy-middleware preserves upstream response headers, so the
anti-frame headers survive to the client browser. Test "sets
X-Frame-Options + CSP frame-ancestors on the response" asserts both
on the actual wire response.

## Caddyfile / Assumption A6 Verification (Task 1)

**Verdict: N/A — this project uses nginx, not Caddy.**

The plan's Task 1(a) directs verifying `docker/Caddyfile*` forwards
`/apps/*` to Express. Grep on the repo:

```bash
$ find docker/ -name 'Caddyfile*' -print
(zero output)

$ ls docker/
Caddy.Dockerfile Dockerfile branding-defaults compose-dev.yml
docker-compose.host-systemd.override.yml docker-compose.yml
entrypoint.sh nginx-https.conf nginx.conf pool-defaults
```

`docker/` contains a `Caddy.Dockerfile` but no `Caddyfile`. The
active edge is nginx (both `nginx.conf` and `nginx-https.conf`).

Nginx forwarding verification:

```bash
$ grep -in '/apps' docker/nginx.conf docker/nginx-https.conf
(zero output — no explicit /apps location block)

$ grep -n 'try_files' docker/nginx.conf
139:            try_files $uri @express_spa_fallback;
```

`/apps/*` requests are caught by the general `location /` block and
handed to Express via `try_files $uri @express_spa_fallback`. Phase
119's `/apps/:hostId/:slug/icon` and `/apps/:hostId/:slug` redirect
routes are already reachable via this same fallback path (Phase 119
did not add an explicit nginx location for /apps, and its tile UAT
worked). Phase 120's `/apps/:hostId/:slug/pane/*` inherits the same
reachability.

The one open point: nginx's default `try_files` proxy_pass does NOT
handle WebSocket upgrade headers unless the location block explicitly
sets `proxy_set_header Upgrade $http_upgrade` and `proxy_set_header
Connection "upgrade"`. Checking `@express_spa_fallback`:

```bash
$ sed -n '142,150p' docker/nginx.conf
        location @express_spa_fallback {
            proxy_pass http://127.0.0.1:30001;
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $proxy_x_forwarded_proto;
        }
```

**No `Upgrade`/`Connection` header forwarding.** This is a nginx-side
gap — WebSocket upgrades to `/apps/*/pane/ws` will NOT reach Express
through the SPA fallback location as currently configured. This is a
deployment-invariant blocker for the WS path only (HTTP path works
today). Options for the deploy-close orchestrator:

1. **Add a dedicated `/apps` location block to both nginx.conf + nginx-https.conf** with `proxy_set_header Upgrade` + `proxy_set_header Connection` directives, per the same pattern Phase 91's `/relay-room/websocket/` block uses. This is the correct long-term fix and unblocks WS on the pane path.
2. **Ship Plan 120-05 as HTTP-only** and defer WS wiring to a follow-up plan. The frontend's iframe consumes only HTTP for the initial render; WS is an app-owned capability inside the iframe. If an app served through the pane needs WS (some do — chat/live-update apps), point 1 becomes gating.

Recommended: option 1, coupled with a nginx block landing in this same
campaign's deploy commit (the pane router IS its own runtime; the
edge just needs to know about the WS upgrade path). This is a nginx
config edit, no container rebuild required beyond restart.

Filed as blocker; documented here per Task 1's requirement to record
the finding.

## Test Coverage

### `src/backend/apps/tests/app-pane-router.integration.test.ts` — 17 cases

| Sub-suite | Cases | D-21 case | Behavior covered |
|-----------|-------|-----------|------------------|
| `HTTP GET` | 2 | a | forwards through proxy; X-Frame-Options + CSP frame-ancestors set |
| `HTTP POST with Origin` | 2 | b, c | matching Origin forwards; mismatched Origin → 403 "cross-origin state-changing request refused"; proxy NOT invoked |
| `WebSocket upgrade` | 2 | d | matching Origin: proxy.upgrade(req, socket, head) called with (target, 12345, 5, "todo"); mismatched Origin: 403 statusline, .upgrade NOT invoked |
| `access control` | 1 | e | checkHostAccess false → 403 "app home box unreachable"; proxy NOT invoked |
| `path-prefix strip` | 1 | f | factory called with (target, tunnelPort, hostId=5, slug="todo") so its pathRewrite strips `^/apps/5/todo/pane` |
| `info-leak invariant` | 1 | 7 | resolveHostById null body byte-identical to checkHostAccess false body — asserted `JSON.parse(bodyA)` deep-equal `{error: "app home box unreachable"}` AND `bodyA === bodyB` |
| `slug validation` | 2 | 8 | uppercase slug → 400 (APP_SLUG_RE reject); dot-containing slug → 400 |
| `hostId validation` | 2 | 9 | hostId=0 → 400; hostId="abc" → 400 |
| `tunnel error interstitial` | 1 | 10 | resolvePaneTarget rejection → renderInterstitial called with `(errorClass, target, originalUrl, PRIMARY_DOMAIN)` + writeInterstitial writes 502 |
| `missing origin on state-changing POST` | 1 | 11 | POST without Origin header → 403 CSRF failure body |
| `port lookup` | 2 | 12 | empty snapshot → 404; matching app with null port → 404 |

### Test Run

```bash
cd /home/ubuntu/skynet-vision && \
  SKYNET_COOKIE_DOMAIN=https://skynet.test npx vitest related --run \
    src/backend/apps/app-pane-router.ts \
    src/backend/apps/tests/app-pane-router.integration.test.ts

# Test Files  1 passed (1)
# Tests       17 passed (17)
```

Combined run (all Plan 01 + Plan 02 + Plan 05 files):

```bash
cd /home/ubuntu/skynet-vision && \
  SKYNET_COOKIE_DOMAIN=https://skynet.test npx vitest related --run \
    src/backend/apps/app-pane-router.ts \
    src/backend/apps/tests/app-pane-router.integration.test.ts \
    src/backend/apps/app-pane-proxy-factory.ts \
    src/backend/apps/pane-target-resolver.ts \
    src/backend/apps/app-proxy-csrf-check.ts \
    src/backend/apps/base-tag-injector.ts

# Test Files  6 passed (6)
# Tests       92 passed (92)
```

`SKYNET_COOKIE_DOMAIN=https://skynet.test npx tsc --noEmit -p tsconfig.json`
passes clean (exit 0).

## WebSocket Upgrade Test (BLOCKER 6 Compliance)

Test 4 (`WebSocket upgrade > dispatches WS upgrade through the same chain
and invokes proxy.upgrade`) satisfies the plan's requirement that WS
tests run against a REAL `http.createServer(app)` instance:

```typescript
// From the test scaffold's makeServer helper:
const server = http.createServer(app);
if (withUpgrade) {
  server.on("upgrade", (req, socket, head) => {
    void handleAppPaneUpgrade(req, socket as net.Socket, head as Buffer);
  });
}

// Test uses net.connect() for a raw TCP upgrade request:
const clientSock = net.connect(port, "127.0.0.1");
clientSock.write([
  "GET /apps/5/todo/pane/ws HTTP/1.1",
  `Host: 127.0.0.1:${port}`,
  "Upgrade: websocket",
  "Connection: Upgrade",
  "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
  "Sec-WebSocket-Version: 13",
  `Origin: ${PRIMARY_ORIGIN}`,
  "Cookie: jwt=fake.jwt.token",
  "",
  "",
].join("\r\n"));

// Then poll for proxyMw.upgrade being called by the dispatcher.
while (upgradeSpy.mock.calls.length === 0 && Date.now() - start < 2000) {
  await new Promise((r) => setTimeout(r, 25));
}
expect(upgradeSpy).toHaveBeenCalledTimes(1);
expect(mocks.getOrCreateAppPaneProxyForTarget).toHaveBeenCalledWith(
  expect.objectContaining({ hostname: "t1000" }), 12345, 5, "todo",
);
```

The mocked `AuthManager.verifyJWTToken` returns `{userId: "u1"}` so
auth passes; `mocks.resolveHostById` returns the happy host; the
Origin header matches `PRIMARY_ORIGIN`; the registry has the app;
`resolvePaneTarget` resolves. All chain stages execute, and only then
does `proxyMw.upgrade` fire. Grep verification of the acceptance
criteria:

| Gate | Requirement | Actual |
|------|-------------|--------|
| `grep -c "^\s*it(" test-file` | ≥ 12 | 17 |
| `grep -c 'http.createServer\|createServer(app)' test-file` | ≥ 1 | 2 |
| `grep -c '\.upgrade(' test-file` | ≥ 1 | 1 (test 4 asserts on the spy invocation) |
| `grep -c 'vi.mock' test-file` | ≥ 6 | 8 |
| `grep -c 'app home box unreachable' test-file` | ≥ 3 | 3 |
| `grep -c 'cross-origin state-changing request refused' test-file` | ≥ 2 | 2 |
| `grep -c 'getOrCreateAppPaneProxyForTarget' test-file` | ≥ 2 | 19 |

## Commits

- `5e141abd` — `feat(120-05): compose app-pane-router.ts with full request chain` (Task 1 body)
- `f2310863` — `feat(120-05): add handleAppPaneUpgrade WebSocket dispatcher` (Task 1 addendum for WS path — extracted so Task 2 test 4 can bind it to a real http.Server)
- `b3839e59` — `fix(120-05): use Express 5 wildcard syntax for pane route path` (Task 2 discovery — Express 5's path-to-regexp v6+ rejects bare `*`; changed pattern to `/pane{/*splat}`)
- `8a65d1f9` — `test(120-05): add app-pane-router integration test suite` (Task 2 body — 17 cases)
- `6ee213df` — `feat(120-05): mount appPaneRouter + wire WS upgrade dispatcher` (Task 3 — router mount + WS upgrade binding in database.ts)

## Deviations from Plan

### Rule 1 — Auto-fixed bug: Express 5 wildcard syntax

**Found during:** Task 2 (integration test run).
**Issue:** `router.all("/:hostId/:slug/pane/*", ...)` threw
`TypeError: Missing parameter name at index 21` at server startup.
Express 5 uses path-to-regexp v6+, which rejects bare `*` as a
wildcard — requires named wildcards.
**Fix:** Changed pattern to `/:hostId/:slug/pane{/*splat}` (optional
named-splat segment, matches both `/pane/` and `/pane/api/list`).
Cross-checked against `src/backend/branding/branding-routes.ts:127`
which uses the same Express-5-compatible named wildcard.
**Files modified:** `src/backend/apps/app-pane-router.ts`
**Commit:** `b3839e59`

### Rule 2 — Auto-added missing critical functionality: WS upgrade dispatcher helper

**Found during:** Task 2 (test 4 planning).
**Issue:** The plan's Task 3(f) requires the WS upgrade handler body
to live in `database.ts`. But Task 2 test 4 needs to invoke the SAME
handler code from an integration test. Duplicating the ~200-line
chain in both files would be a slop-invitation (any HTTP-chain edit
would need to be mirrored to a second file).
**Fix:** Extracted the WS upgrade dispatcher to a `handleAppPaneUpgrade`
exported function inside `app-pane-router.ts` (task-1 file). Task 3's
`database.ts` binding becomes a one-liner: `httpServer.on("upgrade",
(req, socket, head) => void handleAppPaneUpgrade(req, socket, head))`.
The helper carries the SAME auth+validate+access+CSRF+port+target
chain as the HTTP route, in the same file, so any future HTTP-chain
edit is impossible to skip on the WS path.
**Files modified:** `src/backend/apps/app-pane-router.ts` (extraction),
`src/backend/database/database.ts` (uses the exported helper).
**Commit:** `f2310863`

### Rule 2 — Auto-added missing critical functionality: anti-clickjacking headers

**Found during:** Task 3(g) verification.
**Issue:** No existing rule in `docker/nginx.conf`, `docker/nginx-https.conf`,
or the Express stack (no `helmet` middleware) sets X-Frame-Options
or CSP frame-ancestors on `/apps/*` responses. Skynet's pane iframe
depends on Same-Origin embedding; a third-party site could embed
Skynet's pane in its own iframe and clickjack the app's UI without
this defence (T-120-30).
**Fix:** Added `res.setHeader("X-Frame-Options", "SAMEORIGIN")` and
`res.setHeader("Content-Security-Policy", "frame-ancestors 'self'")`
in the pane router BEFORE the proxy handoff. http-proxy-middleware
preserves upstream response headers, so the anti-frame headers reach
the client. Verified in-test: "sets X-Frame-Options + CSP
frame-ancestors on the response" asserts both on the wire response.
**Files modified:** `src/backend/apps/app-pane-router.ts` (included
in the initial Task 1 commit).
**Commit:** `5e141abd`

### Note — Assumption A6: Caddyfile / edge forwarding

The plan directs verifying `docker/Caddyfile*` forwards `/apps/*` to
Express. **This project uses nginx, not Caddy** — `docker/` has no
Caddyfile at all. The active edge is nginx (both `nginx.conf` and
`nginx-https.conf`). No explicit `/apps` location block exists, but
the general `try_files $uri @express_spa_fallback` rule proxies to
Express at 30001 — Phase 119's `/apps/:hostId/:slug/icon` + redirect
routes are reachable via this same fallback, so the pane HTTP path
inherits the reachability.

**Nginx-side WS gap flagged for deploy:** the `@express_spa_fallback`
location does NOT set `proxy_set_header Upgrade $http_upgrade` /
`Connection "upgrade"`, so WebSocket upgrades to `/apps/*/pane/ws`
will not survive the nginx hop as currently configured. Recommended
fix at deploy time: add a dedicated `/apps/` location block in both
nginx.conf + nginx-https.conf (matching the pattern
Phase 91's `/relay-room/websocket/` block uses). This is a nginx
config edit only — no container rebuild required — and is best
landed in the campaign's deploy commit.

## Threat Model Enforcement

Every mitigation in the plan's `<threat_model>` is either implemented
here or inherited from Wave 1/2:

| Threat ID | Category | Implementation |
|-----------|----------|----------------|
| T-120-22 | CSRF | `appProxyCsrfCheck(req, PRIMARY_DOMAIN)` before tunnel work; test 3 + test 11 assert 403 CSRF body |
| T-120-23 | Elevation of privilege | `checkHostAccess(hostIdNum, userId, host.userId, "read")` at route entry; test "access control" asserts 403 |
| T-120-24 | Tampering (slug traversal) | `APP_SLUG_RE.test(slug)` rejects any non-kebab-case slug; tests cover uppercase + dot-containing |
| T-120-25 | Tampering (malformed hostId) | `Number.isFinite + Number.isInteger + > 0` gate; tests cover hostId=0 + hostId="abc" |
| T-120-26 | Info disclosure (403 body) | Same-body invariant asserted in test "resolveHostById null → 403 body byte-identical to checkHostAccess false" via `bodyA === bodyB` string equality |
| T-120-27 | Info disclosure (logs) | `sshLogger.warn` payloads carry only `operation` + `hostId` + `slug` + (in tunnel-error branch) `errorClass` + `errCode` + `errName` + `errLevel`; NEVER `.stack`, NEVER headers, NEVER userId on non-error paths |
| T-120-28 | DoS (non-existent hostId flood) | 400 (or 403) BEFORE any SSH tunnel or DB work — validation gates are first |
| T-120-29 | DoS (non-running app) | 404 with "app is not currently serving on a port"; no tunnel work triggered |
| T-120-30 | Clickjacking | `X-Frame-Options: SAMEORIGIN` + `CSP frame-ancestors 'self'` set at the router before proxy handoff; test "sets X-Frame-Options + CSP frame-ancestors" asserts on wire response |
| T-120-31 | Deployment (edge forwarding) | Verified nginx SPA fallback covers HTTP; nginx WS gap flagged for deploy (see § Caddyfile / Assumption A6) |
| T-120-32 | Elevation (WS bypass) | `httpServer.on("upgrade", handleAppPaneUpgrade)` in database.ts; helper repeats the SAME auth+validation+access+CSRF+port+target chain; test 4 asserts on real http.Server + raw TCP upgrade + proxyMw.upgrade invocation |
| T-120-SC | Package installs | Zero new packages installed |

## Handoff Notes

Downstream consumers:

- **Plan 06 (frontend AppPane):** iframe can now point `src` at
  `/apps/:hostId/:slug/pane/` — the backend surface is reachable
  end-to-end. Anti-clickjacking headers already set at the response
  layer, so `<iframe>` embedding of the pane in a third-party site
  is blocked at the browser level.
- **Plan 08 (D-23 UAT):** the full stack is exercisable end-to-end.
  the user's UAT recipe from CONTEXT.md § D-23 can now run.

WS-path deploy invariant (see § Caddyfile / Assumption A6):
- nginx.conf + nginx-https.conf need a dedicated `/apps/` location
  block with `proxy_set_header Upgrade` / `Connection "upgrade"`
  directives BEFORE WS features inside pane-served apps become
  usable in production. HTTP path works today with the SPA fallback.

## Self-Check: PASSED

Verified via bash:

```
[ -f src/backend/apps/app-pane-router.ts ] → FOUND
[ -f src/backend/apps/tests/app-pane-router.integration.test.ts ] → FOUND

grep -c 'appPaneRouter' src/backend/database/database.ts → 2 (import + mount)
grep -c 'app-pane-router' src/backend/database/database.ts → 1 (import path)
grep -c 'app.use("/apps", appsRoutes)' src/backend/database/database.ts → 1 (Phase 119 mount unchanged)
grep -c 'httpServer.on("upgrade"' src/backend/database/database.ts → 2 (comment + binding)
grep -A5 'httpServer.on("upgrade"' src/backend/database/database.ts | grep -c '/apps/.*/pane\|/pane/\|APP_SLUG_RE' → 3

git log --oneline | grep 5e141abd → FOUND
git log --oneline | grep f2310863 → FOUND
git log --oneline | grep b3839e59 → FOUND
git log --oneline | grep 8a65d1f9 → FOUND
git log --oneline | grep 6ee213df → FOUND

SKYNET_COOKIE_DOMAIN=https://skynet.test npx tsc --noEmit -p tsconfig.json → exit 0
SKYNET_COOKIE_DOMAIN=https://skynet.test npx vitest related --run <6 files> → 92/92 tests passed
```

All acceptance criteria for Task 1, Task 2, and Task 3 verified.
