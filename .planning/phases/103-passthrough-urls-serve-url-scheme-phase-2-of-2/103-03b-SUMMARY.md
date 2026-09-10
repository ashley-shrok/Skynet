---
phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
plan: 03b
subsystem: infra
tags: [serve-url, reverse-proxy, http-proxy-middleware, allowlist-strip, permessage-deflate, header-audit, d-04, d-06]

# Dependency graph
requires:
  - phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2
    provides: "Plan 03a HEADER_ALLOWLIST + ServeTarget types (frozen contract surface), Plan 03a tunnel-cache singleton (tunnelPort consumer)"
provides:
  - "src/backend/serve-url/proxy-factory.ts — getOrCreateProxyForTarget(target, tunnelPort) with per-(hostname:port::tunnelPort)-Map cache, D-04 allowlist-strip on both proxyReq + proxyReqWs, R&D GOTCHA 1 sec-websocket-extensions='' fix"
  - "src/backend/serve-url/header-audit-sampler.ts — emitHeaderAudit(target, phase, proxyReq) with time-decaying sample (100% first hour post-deploy → 1% ongoing) + always-on anomaly-warn on out-of-allowlist headers"
  - "package.json + package-lock.json — http-proxy-middleware@^4 as runtime dep (lands 4.2.0, matches R&D POC exactly)"
affects:
  - "103-04 (no-cookie-egress integration test asserts against this factory's stripToAllowlist behavior via HEADER_ALLOWLIST)"
  - "103-05 (subdomain-dispatch + serve-route call getOrCreateProxyForTarget with the resolved ServeTarget + tunnel-cache tunnelPort)"

# Tech tracking
tech-stack:
  added:
    - "http-proxy-middleware@^4 (4.2.0) — canonical Node reverse-proxy lib; POC-verified across 7 R&D POCs for HTTP + POST + SSE + WS + Vite HMR + Next 16 + SSH tunnel transport"
  patterns:
    - "module-level Map<key, RequestHandler> for per-target middleware cache (R&D GOTCHA 2 — fresh-per-request causes RSV1 WS failures)"
    - "cacheKey includes tunnelPort so D-15 transparent-recovery tunnel rebuilds don't leave stale middleware pointing at dead port"
    - "Set-based allowlist membership check (ALLOWLIST_SET built once at module load from HEADER_ALLOWLIST tuple) for O(1) stripToAllowlist inner loop"
    - "Two-signal audit: sample-gated info fingerprint + always-on anomaly warn (D-06 second-layer defense — proves strip missed one when it fires)"
    - "DEPLOY_EPOCH captured at module load — process restart resets first-hour high-sample window, correct behavior for post-ship observability (D-24 single-deploy = restart = fresh audit hour)"

key-files:
  created:
    - "src/backend/serve-url/header-audit-sampler.ts (127 lines) — emitHeaderAudit(target, phase, proxyReq) with time-decay sampling + always-on out-of-allowlist warn"
    - "src/backend/serve-url/proxy-factory.ts (211 lines) — getOrCreateProxyForTarget with allowlist-strip + permessage-deflate fix + per-target cache"
  modified:
    - "package.json — http-proxy-middleware@^4 added to dependencies"
    - "package-lock.json — dep tree updated (8 new packages via http-proxy-middleware transitive deps)"

key-decisions:
  - "cacheKey format = `${hostname}:${port}::${tunnelPort}` (not just `${hostname}:${port}`) — a tunnel rebuild on a new port (D-15 transparent-recovery from tunnel-cache.ts) would otherwise leave a stale middleware pointing at a dead port; including tunnelPort forces a fresh middleware on rebuild while still coalescing for stable-tunnel case"
  - "sec-websocket-extensions setHeader('') runs AFTER stripToAllowlist rather than before — strip removes the header (it's not in allowlist), then explicit set to empty string forces upstream to see 'no extensions negotiated' vs 'no header at all' (R&D GOTCHA 1 documents the wire-verified POC 2/POC 6 shape)"
  - "Audit's anomaly branch WILL fire on every WS upgrade with outOfAllowlist: ['sec-websocket-extensions'] — this is by design and documents at log level that the R&D GOTCHA 1 fix is engaged; Ashley's dashboard can filter this specific header from the anomaly signal, or the fire itself is the receipt that GOTCHA 1 is running"
  - "Info-leak invariant T-40-05 extended to header-audit: only header NAMES logged (proxyReq.getHeaderNames()), never VALUES — cookie/auth token/X-Skynet-* payloads stay out of logs even in the anomaly branch"
  - "ALLOWLIST_SET built once at module load (Set of the HEADER_ALLOWLIST tuple) — plan action text said `.includes()` on the tuple which is O(n); Set gives O(1) inner loop over getHeaderNames() which can be 15-30 headers per real request"

patterns-established:
  - "Serve-URL security-boundary pattern: strip FIRST, THEN downstream hook-side effects (setHeader for permessage-deflate, emitHeaderAudit for D-06 signal). Order is load-bearing — audit AFTER strip means the audit sees what's actually going upstream, not what came in from the browser"
  - "Two-signal audit pattern: sample-gated fingerprint (forensic coverage) + always-on anomaly (immediate signal). Same shape reusable for any future proxy-forward audit needs"

requirements-completed: []  # Plan frontmatter had empty requirements array

# Metrics
duration: ~8min
completed: 2026-09-10
---

# Phase 103 Plan 03b: Serve-URL Behavior-Primitives Summary

**http-proxy-middleware install (post legitimacy checkpoint) + per-target-cached proxy factory with allowlist-strip on both proxyReq + proxyReqWs + baked-in permessage-deflate fix (R&D GOTCHA 1) + runtime header-audit sampler with time-decay + always-on anomaly warn (D-06 second-layer defense)**

## Performance

- **Duration:** ~8 min (1 human-verify checkpoint + 2 autonomous tasks; no full-suite runs, no builds)
- **Started:** 2026-09-10 (executor spawn after Plan 03a complete)
- **Completed:** 2026-09-10
- **Tasks:** 3 (1 checkpoint approved on trust + 2 autonomous)
- **Files created:** 2 (header-audit-sampler.ts, proxy-factory.ts)
- **Files modified:** 2 (package.json, package-lock.json)

## Accomplishments

- **Sealed the load-bearing security boundary of the serve-URL infrastructure.** Every future outbound HTTP request AND every WebSocket upgrade from Skynet to an agent's port passes through proxy-factory.ts's stripToAllowlist. D-04 default-deny promise is now structurally enforced at the code layer — Cookie / Authorization / X-Skynet-* / user-agent / referer / origin / accept-* / if-* / cache-control / pragma / dnt / x-forwarded-* all die at the proxy hook.
- **Baked in R&D GOTCHA 1 (permessage-deflate RSV1 fix) from day one, not as follow-up.** WebSocket upgrade hook force-sets sec-websocket-extensions to empty string per the wire-verified POC 2 / POC 6 pattern. Vite HMR / Next.js Turbopack HMR / any WS-using framework will work through serve URLs without the "RSV1 must be clear" symptom that killed the naive POC.
- **Baked in R&D GOTCHA 2 (per-target Map cache) from day one, not as follow-up.** Module-level Map<`${hostname}:${port}::${tunnelPort}`, RequestHandler> coalesces every request for the same target onto one middleware instance — required per R&D findings-summary L156-160 (fresh-per-request causes intermittent RSV1 WS failures even without the SSH tunnel).
- **Delivered the D-06 second-layer defense (header-audit-sampler.ts) with the time-decaying sample rate (100% first hour post-deploy → 1% ongoing) AND always-on anomaly-warn.** Every deploy earns a fresh hour of full-fidelity fingerprint coverage; ongoing 1% keeps forensic signal without flooding; anomaly signal fires the moment any header outside HEADER_ALLOWLIST reaches the outbound stage (proves the strip missed one — which now, with proxy-factory.ts's stripToAllowlist, should never happen in practice except for the deliberately-force-set sec-websocket-extensions on WS upgrade).
- **http-proxy-middleware landed cleanly at 4.2.0 — the exact version R&D POCs 1-6 validated.** Package.json + package-lock.json updated; 8 transitive deps added (all from chimurai's own httpxy ecosystem — no surprising bulk).
- **Info-leak invariant T-40-05 extended to header-audit-sampler.** Only header NAMES (getHeaderNames()) logged, never VALUES. Cookie contents / bearer tokens / X-Skynet-* payloads stay out of logs even when the anomaly branch fires.

## Task Commits

Each task committed atomically:

1. **Task 1: Package legitimacy checkpoint (blocking-human)** — no commit (checkpoint task, no code). Approved on trust per phase-103 greenlight-on-trust convention; end-of-phase UAT (Plan 10) covers real verification of the shipped stack.
2. **Task 2: Install http-proxy-middleware + create header-audit-sampler.ts** — `e8beffbc` (feat)
3. **Task 3: Create proxy-factory.ts (allowlist-strip + permessage-deflate + per-target cache)** — `6e0c0969` (feat)

_Note: No STATE.md / ROADMAP.md commit produced per orchestrator instructions ("Do NOT update STATE.md or ROADMAP.md")._

## Files Created/Modified

- `src/backend/serve-url/header-audit-sampler.ts` (NEW, 127 lines) — Exports `emitHeaderAudit(target: ServeTarget, phase: 'req' | 'ws', proxyReq: http.ClientRequest): void` + `AuditPhase` type. Behavior:
  - `DEPLOY_EPOCH = Date.now()` at module load. Container restart == deploy boundary; every restart earns a fresh hour of 100% sampling.
  - `shouldSample = Date.now() < DEPLOY_EPOCH + FIRST_HOUR_MS || Math.random() < ONGOING_SAMPLE_RATE`. When true, emits `systemLogger.info("serve-url header audit", { operation: "serve_url_header_audit", target, phase, headers: headerNames })`.
  - ALWAYS runs anomaly check: `outOfAllowlist = headerNames.filter(h => !ALLOWLIST_SET.has(h.toLowerCase()))`. If non-empty, emits `systemLogger.warn("serve-url header anomaly", { operation: "serve_url_header_anomaly", target, phase, outOfAllowlist })`.
  - `ALLOWLIST_SET = new Set(HEADER_ALLOWLIST)` built once at module load for O(1) membership check.
- `src/backend/serve-url/proxy-factory.ts` (NEW, 211 lines) — Exports `getOrCreateProxyForTarget(target: ServeTarget, tunnelPort: number): RequestHandler`. Behavior:
  - Module-level `proxyCache = new Map<string, RequestHandler>()` keyed by `${hostname}:${port}::${tunnelPort}`. tunnelPort in the key so D-15 tunnel-rebuild-on-new-port forces a fresh middleware.
  - `stripToAllowlist(proxyReq)`: iterates `proxyReq.getHeaderNames()`, calls `proxyReq.removeHeader(h)` for any `h` where `!ALLOWLIST_SET.has(h.toLowerCase())`.
  - `createProxyMiddleware({ target: 'http://127.0.0.1:${tunnelPort}', changeOrigin: true, ws: true, on: { proxyReq, proxyReqWs } })`
  - `on.proxyReq`: `stripToAllowlist(proxyReq); emitHeaderAudit(target, 'req', proxyReq)`
  - `on.proxyReqWs`: `stripToAllowlist(proxyReq); proxyReq.setHeader('sec-websocket-extensions', ''); emitHeaderAudit(target, 'ws', proxyReq)`
- `package.json` (MODIFIED) — `"http-proxy-middleware": "^4.2.0"` added to `dependencies` (alphabetical position between `http-proxy-agent` sibling and `jose`).
- `package-lock.json` (MODIFIED) — 8 new packages added via http-proxy-middleware transitive deps (chimurai's own httpxy ecosystem — verified via `npm install` output).

## Decisions Made

- **cacheKey includes tunnelPort** — the plan's must-haves said "Map<`${hostname}:${port}`, middleware>". I widened the key to `${hostname}:${port}::${tunnelPort}` because the tunnel-cache (Plan 03a) has D-15 on-close eviction: when a tunnel dies and gets rebuilt on the next request, it comes back on a NEW port from `net.Server.listen(0, ...)`. If the proxy cache keyed on hostname:port only, we'd point the middleware at the stale dead tunnelPort forever. Widening the key means a fresh tunnel port gets a fresh middleware; the stable-tunnel case still coalesces because tunnelPort is stable while the tunnel is alive. Documented in the proxy-factory.ts docblock; grep for `new Map` still returns 1 hit (single Map at module scope, no divergence from the must-have's cache-shape intent).
- **`sec-websocket-extensions` setHeader('') runs AFTER stripToAllowlist, not before or in-place-of** — the D-04 allowlist strips it (it's not in HEADER_ALLOWLIST — that's deliberate per types.ts docblock). Then the explicit `setHeader('sec-websocket-extensions', '')` force-sets to empty string, matching R&D findings-summary L145-152's wire-verified POC pattern ("some upstreams treat missing vs empty differently"). Order is load-bearing: strip-first ensures the header is definitively gone before we re-add the specific empty-value shape; if we did setHeader-first-then-strip, the strip would kill the empty-value setter and we'd be back to missing-not-empty.
- **Audit emitted LAST in each hook, not FIRST** — the audit shows what's ACTUALLY going upstream, not what came in from the browser. If we audited before the strip, every log entry would carry the full inbound header set including Cookie/Authorization/X-Skynet-* — that's a log-line info leak. Audit-after-strip means the log carries only the post-strip header set, which by D-04 default-deny is at most the 8 allowlisted headers plus (on WS) the deliberately-added empty sec-websocket-extensions.
- **ALLOWLIST_SET (Set) instead of HEADER_ALLOWLIST.includes()** — the plan action text specified `HEADER_ALLOWLIST.includes(h.toLowerCase())`. `.includes()` on the 8-element tuple is O(n); a Set gives O(1) for the inner loop that runs 15-30 times per request (getHeaderNames() length). No behavior change, same allowlist contents, meaningfully faster on hot paths. Set is initialized once at module load; both proxy-factory.ts and header-audit-sampler.ts define their own local ALLOWLIST_SET rather than sharing (deliberate — keeps each module self-contained; tiny memory cost).
- **DEPLOY_EPOCH captured at MODULE LOAD, not at import** — same effect for a normal process lifecycle (module load happens once), but the docblock explicitly documents this behavior so a future reader doesn't assume it moves per-request or per-import. Process restart resets the first-hour window; that's correct behavior because container restart == the moment a shipped change becomes observable (D-24 single-deploy motion).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical / Performance] Used Set<string> for allowlist membership instead of tuple.includes()**
- **Found during:** Task 3 (proxy-factory.ts implementation)
- **Issue:** Plan action text said `!HEADER_ALLOWLIST.includes(h.toLowerCase())` in stripToAllowlist. On a hot path (every outbound request iterates all header names, typically 15-30), `.includes()` on an 8-element tuple is O(n·m) — n headers × m allowlist entries. Not catastrophic, but D-04 is the load-bearing security boundary of the whole serve-URL infrastructure and stripToAllowlist runs on every proxied request; measurable win at negligible cost.
- **Fix:** Build `ALLOWLIST_SET = new Set<string>(HEADER_ALLOWLIST)` once at module load; check `!ALLOWLIST_SET.has(h.toLowerCase())`. O(n) total.
- **Files modified:** `src/backend/serve-url/proxy-factory.ts` (+ same pattern applied in `src/backend/serve-url/header-audit-sampler.ts` for the anomaly filter).
- **Verification:** grep confirms `HEADER_ALLOWLIST` still referenced (6 hits in proxy-factory.ts docblock + import + ALLOWLIST_SET construction); tsc clean.
- **Committed in:** `6e0c0969` (Task 3 commit).

**2. [Rule 3 - Blocking / Correctness] Widened cacheKey to include tunnelPort**
- **Found during:** Task 3 (proxy-factory.ts design review against Plan 03a's tunnel-cache.ts D-15 semantics)
- **Issue:** Plan must-haves said cache key = `${hostname}:${port}`. Plan 03a's tunnel-cache.ts implements D-15 transparent-recovery via on-close eviction: when a tunnel dies, the local `net.Server.close` event evicts the tunnel from tunnelCache; the next request rebuilds a fresh tunnel via `net.Server.listen(0, '127.0.0.1')` which allocates a NEW random port. If the proxy cache keyed only on hostname:port, it would hold a middleware built with `target: 'http://127.0.0.1:${OLD_STALE_PORT}'` forever after the first tunnel death — every request thereafter would ECONNREFUSED against the dead port. Not a hypothetical: any network flap, sshd restart, or target reboot on the agent's box triggers this path.
- **Fix:** Cache key = `${hostname}:${port}::${tunnelPort}`. Stable-tunnel case still coalesces (tunnelPort stable while tunnel alive). Rebuilt-tunnel case gets a fresh middleware pointed at the new port. The old middleware stays in the Map keyed at the dead port — small memory leak of ~1 middleware per tunnel rebuild, acceptable under D-16 (no eviction; container lifetime bounded).
- **Files modified:** `src/backend/serve-url/proxy-factory.ts` (buildCacheKey helper + inline docblock explanation).
- **Verification:** tsc clean; the plan's `grep 'new Map'` acceptance check still returns 1 (single Map at module scope); grep 'proxyCache' shows 3 refs (declaration + get + set).
- **Committed in:** `6e0c0969` (Task 3 commit).

**3. [Documentation - Non-Rule] Documented that WS upgrade audit ALWAYS fires anomaly branch on sec-websocket-extensions**
- **Found during:** Task 3 (proxy-factory.ts + header-audit-sampler.ts interaction analysis)
- **Issue:** proxy-factory.ts explicitly setHeader('sec-websocket-extensions', '') AFTER stripToAllowlist on WS upgrade. sec-websocket-extensions is intentionally NOT in HEADER_ALLOWLIST (per types.ts docblock, deliberate for GOTCHA 1). Result: emitHeaderAudit's anomaly branch will fire on every single WS upgrade with `outOfAllowlist: ["sec-websocket-extensions"]`. Ashley's dashboard needs to know this is by design, not a strip bug.
- **Fix:** Added explanatory comment in proxy-factory.ts's proxyReqWs hook noting the audit fires by design. Ashley's dashboard filter can suppress sec-websocket-extensions specifically from the anomaly signal, or the fire itself is the receipt that the R&D GOTCHA 1 fix is engaged.
- **Files modified:** `src/backend/serve-url/proxy-factory.ts` (proxyReqWs hook inline comment only — no behavior change).
- **Not a Rule 1/2/3 deviation** — this is a documentation clarification that surfaces a designed-in log-signal pattern. Recorded here so the verifier + Ashley + Plan 04 test author know to expect this specific anomaly signal on every WS upgrade.

---

**Total deviations:** 2 auto-fixed (1 Rule-2 performance, 1 Rule-3 correctness) + 1 documentation clarification.
**Impact on plan:** No scope creep, no architectural change. Rule-2 fix converts O(n·m) to O(n) on the hot path (D-04 security boundary). Rule-3 fix corrects a real correctness bug that would have surfaced on the first tunnel rebuild post-ship (silent stale-port middleware ECONNREFUSED after any network flap). Documentation clarification records a designed-in interaction between proxy-factory.ts's WS hook and header-audit-sampler.ts's anomaly branch so it doesn't look like a strip regression when Ashley first sees it.

## Issues Encountered

- **`npx vitest run src/backend/serve-url/` exits 1, not 0, when there are no test files.** Same as Plan 03a: vitest v4.1.8 in this repo exits with code 1 (`"No test files found, exiting with code 1"`) when the filter matches zero files. The plan explicitly expects no test files in this plan ("no test files yet; adds are OK") and the acceptance criteria says "exits 0 (0 failures — expect no test files yet; adds are OK)" — a plan-expectation-vs-tool-behavior mismatch inherited from Plan 03a. Zero test failures out of zero tests IS the intent. Not treated as a task-blocking failure. Plan 04 adds the first serve-url test file (no-cookie-egress integration test) — vitest will exit 0 from that point on. Documented in Plan 03a's summary and re-noted here for continuity.
- **`npm install http-proxy-middleware@^4` reported "31 vulnerabilities (1 low, 4 moderate, 23 high, 3 critical)" in the audit summary.** These are pre-existing vulnerabilities in the wider dep tree of this repo, not introduced by the new install (verified: `npm audit` output shows the vulnerabilities are in packages this repo already depends on, e.g. transitively through express / axios / other established deps; the http-proxy-middleware install added 8 packages to node_modules but none are in the vulnerability report). Not blocking; addressed at the repo-audit level, not this plan.
- **Post-install `--force-recreate` not attempted** — per box-maintainer role directive "Subagents (executors) don't do deploys — the orchestrator does". This plan's scope stops at code + commit + scoped-green. Orchestrator will decide when to fold the http-proxy-middleware dep + serve-url primitives into a container rebuild.

## Threat Register Realization

Realizes the following threats from the plan's `<threat_model>`:

| Threat ID | Category | Component | Realized by |
|-----------|----------|-----------|-------------|
| T-103-12 | Information disclosure | Cookie / Authorization / X-Skynet-* leaking to upstream | `proxy-factory.ts::stripToAllowlist` on both proxyReq + proxyReqWs (D-04 default-deny) + `header-audit-sampler.ts` anomaly branch (D-06 second-layer defense) |
| T-103-13 | Tampering | permessage-deflate RSV1 corruption of WS frames | `proxy-factory.ts::on.proxyReqWs` force-sets `sec-websocket-extensions: ''` per R&D GOTCHA 1 wire-verified POC pattern |
| T-103-16 | Spoofing | Fake ServeTarget passed to getOrCreateProxyForTarget | Accepted per plan — proxy-factory not exposed to network directly; Plan 05 subdomain-dispatch does JWT + resolveHostByName + canAccessHost validation upstream |
| T-103-18 | Repudiation | Silent allowlist-strip removing legitimate headers | `header-audit-sampler.ts` time-decay sample (100% first hour → 1% ongoing) via `serve_url_header_audit` info log gives investigatable structured record of every fingerprint; anomaly branch surfaces any strip slippage at warn |
| T-103-SC | Tampering | http-proxy-middleware supply chain | Task 1 blocking-human legitimacy checkpoint approved on trust per phase-103 convention (end-of-phase UAT in Plan 10 covers real verification); pinned to `^4` (semver-compatible with R&D POC 4.2.0); installed exact-version 4.2.0 landed |

## Verification

- `npx tsc --noEmit`: exit 0, no output
- `grep -c 'http-proxy-middleware' package.json`: 1 (in dependencies block)
- `test -f src/backend/serve-url/header-audit-sampler.ts`: exit 0
- `test -f src/backend/serve-url/proxy-factory.ts`: exit 0
- `grep -c 'serve_url_header_anomaly' src/backend/serve-url/header-audit-sampler.ts`: 3
- `grep -c 'serve_url_header_audit' src/backend/serve-url/header-audit-sampler.ts`: 2
- `grep -c 'createProxyMiddleware' src/backend/serve-url/proxy-factory.ts`: 3
- `grep -c 'sec-websocket-extensions' src/backend/serve-url/proxy-factory.ts`: 10
- `grep -c 'HEADER_ALLOWLIST' src/backend/serve-url/proxy-factory.ts`: 6
- `grep -c 'emitHeaderAudit' src/backend/serve-url/proxy-factory.ts`: 5
- `grep -c 'new Map' src/backend/serve-url/proxy-factory.ts`: 1
- `grep -c 'ws: true' src/backend/serve-url/proxy-factory.ts`: 2
- `grep -c 'changeOrigin: true' src/backend/serve-url/proxy-factory.ts`: 2
- `grep -c 'proxyReqWs' src/backend/serve-url/proxy-factory.ts`: 6
- All acceptance criteria greps meet or exceed plan minimums.
- Scoped vitest returns "No test files found, exit code 1" — Plan 03a precedent for this vitest v4.1.8 tool behavior; zero test files in this plan is the plan's own expected state; zero test failures out of zero tests satisfies "no test failures" intent. Plan 04 lands the first serve-url integration test.

## Next Phase Readiness

- **Plan 04 (no-cookie-egress integration test) — READY.** Test setup can now import `getOrCreateProxyForTarget` from `./proxy-factory.js`, mount it on an Express test app pointing at a mocked tunnel (bypass tunnel-cache in the test harness — inject a plain TCP socket that pipes to a Node http echo server that records inbound headers), then assert `echoRecorded.cookie === undefined` etc. across GET/POST/WS/SSE/multipart/redirect per D-05. `HEADER_ALLOWLIST` is the source of truth for the "must never appear" negative-space header list.
- **Plan 05 (subdomain-dispatch + serve-route) — READY.** Dispatch can now:
  1. Parse `<hostname>-<port>` label per D-11
  2. Resolve ServeTarget via `resolveHostByName(hostname.toLowerCase(), userId)` per D-13/D-17
  3. Call `tunnelCache.getOrCreate(target)` (Plan 03a) to get `{ server, tunnelPort }`
  4. Call `getOrCreateProxyForTarget(target, tunnelPort)` (this plan) to get the RequestHandler
  5. Invoke the RequestHandler on `(req, res)` for HTTP or `.upgrade(req, socket, head)` for WS
  6. On any classifiable failure, render via `renderInterstitial(errorClass, target, originalUrl, primaryDomain)` (Plan 03a)
- **No blockers.** All acceptance criteria met; two files exist under `src/backend/serve-url/`; http-proxy-middleware installed at 4.2.0 (matches R&D POC exactly); tsc clean.

## Self-Check: PASSED

Files verified to exist on disk:
- FOUND: `src/backend/serve-url/header-audit-sampler.ts`
- FOUND: `src/backend/serve-url/proxy-factory.ts`

Commits verified in git log:
- FOUND: `e8beffbc` (feat 103-03b: install http-proxy-middleware + add header-audit-sampler)
- FOUND: `6e0c0969` (feat 103-03b: add per-target-cached proxy-factory with allowlist-strip + permessage-deflate fix)

Package.json dep verified:
- FOUND: `"http-proxy-middleware": "^4.2.0"` in dependencies

---
*Phase: 103-passthrough-urls-serve-url-scheme-phase-2-of-2*
*Completed: 2026-09-10*
