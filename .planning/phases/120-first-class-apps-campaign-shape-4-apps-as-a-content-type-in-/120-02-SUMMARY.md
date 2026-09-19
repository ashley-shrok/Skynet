---
phase: 120-first-class-apps-campaign-shape-4-apps-as-a-content-type-in-
plan: 02
subsystem: backend/apps
tags: [proxy, http-proxy-middleware, response-interceptor, websocket, rsv1, tdd]
dependency_graph:
  requires:
    - "120-01 (injectBaseTag + PRIMARY_DOMAIN)"
  provides:
    - "getOrCreateAppPaneProxyForTarget(target, tunnelPort, hostId, slug): RequestHandler"
    - "resolvePaneTarget(hostId, host, port): Promise<ResolvedTarget>"
    - "ResolvedTarget { target, tunnelPort, usedTunnel }"
  affects:
    - "Wave 3 Plan 05 (app-pane-router composition) consumes both exports verbatim"
tech_stack:
  added: []
  patterns:
    - "Per-(hostname:port::tunnelPort::hostId:slug) proxy cache (extends serve-url's per-target cache with hostId+slug — Pitfall 2 fix)"
    - "selfHandleResponse + responseInterceptor with Content-Type gate for D-11 base-tag injection"
    - "Verbatim inheritance of HEADER_ALLOWLIST default-deny strip + RSV1 WS fix + shared interstitial (D-17 reuse)"
    - "Unconditional-tunnel resolver (Q1 RESOLVED — no isLocalHostId branch)"
    - "vi.hoisted + module-cache-reset TDD scaffold for factory + resolver unit tests"
key_files:
  created:
    - "src/backend/apps/app-pane-proxy-factory.ts"
    - "src/backend/apps/pane-target-resolver.ts"
    - "src/backend/apps/tests/app-pane-proxy-factory.test.ts"
    - "src/backend/apps/tests/pane-target-resolver.test.ts"
  modified: []
decisions:
  - "Sibling factory (not fork) of serve-url/proxy-factory.ts. HEADER_ALLOWLIST + emitHeaderAudit imported from ../serve-url; stripToAllowlist duplicated inline (six-line loop) rather than exported from the serve-url module — avoids widening serve-url's public surface."
  - "Cache key format `${hostname}:${port}::${tunnelPort}::${hostId}:${slug}` — the trailing `hostId:slug` segment is the load-bearing addition over serve-url's key per RESEARCH.md Pitfall 2. Without it, two apps on the same host would share one middleware with a single baked pathRewrite rule."
  - "responseInterceptor gate lives at the factory (`.startsWith('text/html')`), not inside injectBaseTag. Single-gate-site keeps the audit surface minimal and matches Plan 01 T-120-03 disposition."
  - "resolvePaneTarget is unconditional-tunnel per RESEARCH.md Q1 RESOLVED. The `usedTunnel` field is retained on the interface for observability and future-flexibility even though its value is always `true` under the current design."
  - "log tag `operation: \"apps_pane_proxy\"` chosen over `\"serve_url_proxy\"` so post-hoc filtering can separate the two log streams."
metrics:
  duration_minutes: ~15
  tasks_completed: 2
  test_count: 23
  files_created: 4
  files_modified: 0
  completed: 2026-09-19
requirements_satisfied:
  - D-08 (mount-path handling — pathRewrite strips /apps/:hostId/:slug/pane so apps see themselves at root)
  - D-09 (proxy composition — HEADER_ALLOWLIST + stripToAllowlist + RSV1 fix inherited verbatim from Phase 103 serve-url/proxy-factory.ts)
  - D-10 (SSH tunnel target resolution — AS AMENDED by RESEARCH.md Q1 RESOLVED to be unconditional)
  - D-11 (base-tag injection wired through responseInterceptor on text/html responses)
  - D-17 (shared interstitial + error-classifier on on.error — no custom error UI)
  - D-20 (no signal to the app — no new headers added, only allowlist-strip)
---

# Phase 120 Plan 02: App-pane proxy factory + target resolver Summary

Landed the two backend leaves Wave 3's app-pane-router composes: a sibling
proxy factory keyed on `(hostname, port, tunnelPort, hostId, slug)` that
adds a Content-Type-gated `<base>`-tag response interceptor over Phase
103's byte-forwarding + WS-tunneling + interstitial machinery; and a
target resolver that unconditionally routes through the shared SSH
tunnel cache (Q1 RESOLVED — no local-loopback bypass). Both files live
under `src/backend/apps/` with full unit-test coverage; no
`src/backend/serve-url/*` file is modified.

## Exported Symbols

### `src/backend/apps/app-pane-proxy-factory.ts`

```typescript
export function getOrCreateAppPaneProxyForTarget(
  target: ServeTarget,   // { hostname, port, host } — the app's home box
  tunnelPort: number,    // local port the SSH tunnel listens on
  hostId: number,        // load-bearing: half of the cache key
  slug: string,          // load-bearing: other half of the cache key
): RequestHandler;       // http-proxy-middleware RequestHandler
```

Caches per `(hostname:port::tunnelPort::hostId:slug)`. Configuration:

- `target: http://127.0.0.1:${tunnelPort}` — loopback to the SSH tunnel.
- `changeOrigin: true` — outgoing Host header rewritten to loopback.
- `ws: true` — WebSocket upgrade tunneling.
- `selfHandleResponse: true` — REQUIRED so responseInterceptor fires.
- `pathRewrite: { "^/apps/${hostId}/${slug}/pane": "" }` — strips mount
  prefix so the app sees itself at root.
- `on.proxyReq` — HEADER_ALLOWLIST default-deny strip (D-04) + audit.
- `on.proxyReqWs` — strip + RSV1 fix (`sec-websocket-extensions` forced
  to empty string) + audit.
- `on.proxyRes` — `responseInterceptor` callback gates on Content-Type;
  delegates to `injectBaseTag(buffer, hostId, slug)` on `text/html` and
  `text/html; charset=utf-8`; returns the input buffer unchanged for
  JSON / JS / images / binaries.
- `on.error` — `classifyTunnelError` → `sshLogger.warn(operation:
  "apps_pane_proxy", ...)` with safe fields only (`.code / .name /
  .level` — never `.stack`, headers, or user identifiers) →
  `writableEnded` guard → `writeInterstitial(renderInterstitial(...))`.

### `src/backend/apps/pane-target-resolver.ts`

```typescript
export interface ResolvedTarget {
  target: ServeTarget;
  tunnelPort: number;
  usedTunnel: boolean;   // always `true` under Q1 RESOLVED
}

export async function resolvePaneTarget(
  hostId: number,        // retained for caller-side log symmetry; not
                         // branched on
  host: Host,            // fully-resolved DB row
  port: number,          // upstream app port on the target box
): Promise<ResolvedTarget>;
```

Unconditional-tunnel semantics — `hostId` is passed but never branched
on. Errors from `tunnelCache.getOrCreate` propagate unchanged (no
try/wrap). The `usedTunnel` field is retained on the interface so a
future revisit of Q1 can toggle it without a breaking interface change.

## R&D Gotcha Inheritance (confirmed)

Both R&D gotchas from `src/backend/serve-url/proxy-factory.ts` are
inherited verbatim in `app-pane-proxy-factory.ts`:

| Gotcha | Serve-URL source | App-pane factory | Verified |
|--------|------------------|------------------|----------|
| Gotcha 1: permessage-deflate RSV1 fix (`sec-websocket-extensions=""` after strip) | `proxy-factory.ts:224` | `app-pane-proxy-factory.ts:199` | Grep: exactly 1 occurrence of `sec-websocket-extensions` (the RSV1 fix line) in factory. Test asserts exact `setHeader` call. |
| Gotcha 2: per-target cache (fresh-per-request causes intermittent WS failures) | `proxy-factory.ts:127` cache key `${hostname}:${port}::${tunnelPort}` | `app-pane-proxy-factory.ts:81` cache key `${hostname}:${port}::${tunnelPort}::${hostId}:${slug}` | Grep: `${hostId}:${slug}` appears 3× in factory (inside the JSDoc + buildCacheKey). Cache-key tests verify same-args → same middleware; per-slug + per-hostId + per-tunnelPort → distinct middleware. |

Cache-key EXTENSION (Pitfall 2 fix): `hostId:slug` suffix ensures two
apps on the same `(hostname, port, tunnelPort)` triple receive distinct
middleware instances with distinct `pathRewrite` rules. Without this,
one app's requests would strip the wrong prefix.

## Test Coverage

### `src/backend/apps/tests/app-pane-proxy-factory.test.ts` — 17 cases

| Sub-suite | Cases | Behavior covered |
|-----------|-------|------------------|
| `cache-key` | 4 | same-args hit; per-slug miss; per-hostId miss; per-tunnelPort miss. |
| `middleware options` | 5 | `selfHandleResponse: true`; `ws: true` + `changeOrigin: true`; `target` is `http://127.0.0.1:${tunnelPort}`; `pathRewrite` object with the correct regex-string key; `responseInterceptor` invoked once with the async callback. |
| `proxyReq hook` | 1 | HEADER_ALLOWLIST strip removes Cookie / Authorization / X-Skynet-* while preserving allowlisted headers. |
| `proxyReqWs hook` | 1 | strip AND `setHeader("sec-websocket-extensions", "")` — RSV1 fix. |
| `proxyRes content-type gating` | 4 | `text/html` triggers `injectBaseTag(buffer, hostId, slug)`; `text/html; charset=utf-8` also triggers it (`.startsWith` gate); `application/json` returns input buffer unchanged (identity check); absent Content-Type header returns input buffer unchanged. |
| `error hook` | 2 | classifies via `classifyTunnelError`; logs with `operation: "apps_pane_proxy"` + safe fields only (no stack, headers, or user data); renders + writes interstitial; `writableEnded=true` guard skips the write. |

### `src/backend/apps/tests/pane-target-resolver.test.ts` — 6 cases

| # | Case | Behavior covered |
|---|------|------------------|
| 1 | local-looking hostId | invokes `tunnelCache.getOrCreate` exactly once; returns `{ target: {hostname, port, host}, tunnelPort: 12345, usedTunnel: true }`. |
| 2 | remote hostId | invokes `tunnelCache.getOrCreate` exactly once; returns the same shape with `usedTunnel: true`. |
| 3 | structural equivalence | both local-looking and remote hostIds return `usedTunnel: true` — no branching. Cache called twice (once per call). |
| 4 | error propagation | `tunnelCache.getOrCreate` rejection propagates unchanged (`await expect(...).rejects.toThrow(...)`). |
| 5 | ServeTarget shape | deep-equality on the argument passed to `tunnelCache.getOrCreate` — `{ hostname: host.name, port, host }`, no extras. |
| 6 | tunnelPort provenance | resolver returns `instance.tunnelPort`, not the upstream `port` — guards against a plausible off-by-one bug. |

## Test Run

```bash
cd /home/ubuntu/skynet-vision && \
  SKYNET_COOKIE_DOMAIN=https://skynet.test npx vitest related --run \
    src/backend/apps/app-pane-proxy-factory.ts \
    src/backend/apps/tests/app-pane-proxy-factory.test.ts \
    src/backend/apps/pane-target-resolver.ts \
    src/backend/apps/tests/pane-target-resolver.test.ts

# Test Files  2 passed (2)
# Tests       23 passed (23)
```

`tsc --noEmit -p tsconfig.node.json` also passes clean (exit 0).

## Q1 RESOLVED Enforcement

Grep-enforced structural invariants on `pane-target-resolver.ts`:

| Gate | Requirement | Actual |
|------|-------------|--------|
| `grep -c 'isLocalHostId' src/backend/apps/pane-target-resolver.ts` | == 0 | 0 |
| `grep -c 'tunnelCache.getOrCreate' src/backend/apps/pane-target-resolver.ts` | == 1 | 1 |
| `grep -c 'usedTunnel: true' src/backend/apps/pane-target-resolver.ts` | == 1 | 1 |
| `grep -c 'usedTunnel: false' src/backend/apps/pane-target-resolver.ts` | == 0 | 0 |
| non-comment `catch` | == 0 | 0 |

Test-file cross-check: both a "local-looking" (hostId=1, host name t1000)
and a "remote" (hostId=42, host name remote-box) call path assert
`usedTunnel: true` — 6 total occurrences of `usedTunnel: true` in the
test file (the plan required ≥ 2).

## Commits

- `f6de9991` — `test(120-02): add failing tests for app-pane-proxy-factory sibling factory` (RED, Task 1)
- `6f02d265` — `feat(120-02): implement app-pane-proxy-factory sibling factory` (GREEN, Task 1)
- `04fdd588` — `test(120-02): add failing tests for pane-target-resolver unconditional-tunnel helper` (RED, Task 2)
- `f924a8e7` — `feat(120-02): implement pane-target-resolver unconditional-tunnel helper` (GREEN, Task 2)
- `315cdf16` — `refactor(120-02): tighten JSDoc to satisfy strict grep gates` (REFACTOR, Task 1)

TDD gate compliance: each task landed as a `test(...)` RED commit
followed by a `feat(...)` GREEN commit; Task 1 additionally received a
`refactor(...)` commit to reword JSDoc phrasing so the strict grep
gate (`sec-websocket-extensions` exactly once) passes. Substantive
meaning of the JSDoc unchanged.

## Deviations from Plan

None material. Three JSDoc adjustments were made in-flight to satisfy
strict grep-based acceptance gates. In each case the substantive
meaning is preserved; only the exact tokens the acceptance gate greps
for were reworded.

1. **`app-pane-proxy-factory.ts` — anti-pattern references to the shared
   factory.** The plan requires `grep -c 'getOrCreateProxyForTarget'
   src/backend/apps/app-pane-proxy-factory.ts` == 0. Two JSDoc mentions
   of that function name (in the "MUST NOT reuse" list and the
   Pitfall 2 rationale) were reworded to reference "the shared factory
   exported by serve-url/proxy-factory.ts" without using the identifier
   verbatim. Not a functional change.

2. **`app-pane-proxy-factory.ts` — RSV1 fix JSDoc references.** The plan
   requires `grep -c 'sec-websocket-extensions'` exactly 1 (the runtime
   line). Three JSDoc / inline-comment mentions of the header name (in
   the "inherited invariants" list, the "MUST NOT re-implement" note,
   and the code-comment above the setHeader call) were reworded to
   reference the RSV1 permessage-deflate fix abstractly. The runtime
   setHeader line is unchanged.

3. **`pane-target-resolver.ts` — Q1 RESOLVED JSDoc phrasing.** The plan
   requires `grep -c 'usedTunnel: true'` == 1, `grep -c
   'tunnelCache.getOrCreate'` == 1, `grep -c 'isLocalHostId'` == 0, and
   non-comment `catch` == 0. The JSDoc was reworded to reference the
   "tunnel cache" and "shared error classifier" without repeating the
   exact API names in comments (which the strict grep would otherwise
   double-count) and without the word "catch" (which appeared in a
   sentence describing Wave 3's router-side error handling).
   Substantive meaning identical: unconditional-tunnel via the shared
   tunnel cache; no local-loopback branch; rejections propagate to the
   caller unchanged.

## Threat Flags

None — the factory + resolver were on the threat register (T-120-06
through T-120-12); no new surface introduced beyond what the plan
anticipated. Specifically:

- T-120-06 (header allowlist) — HEADER_ALLOWLIST strip on both proxyReq
  and proxyReqWs; test asserts Cookie / Authorization / X-Skynet-*
  removed.
- T-120-07 (WS RSV1) — `sec-websocket-extensions=""` on proxyReqWs;
  test asserts exact setHeader call.
- T-120-08 (non-HTML content) — `.startsWith("text/html")` gate;
  application/json + absent Content-Type return input buffer unchanged
  (identity check).
- T-120-09 (per-slug cache collision) — cache key extended with
  `${hostId}:${slug}`; three cache-key miss/hit tests exercise the
  invariant.
- T-120-10 (error log info-leak) — sshLogger.warn payload contains only
  `.code / .name / .level`; test asserts forbidden fields
  (`stack / cookie / authorization / userId / req`) are absent.
- T-120-11 (Docker loopback failure Q1) — resolvePaneTarget uses the
  tunnel unconditionally; grep-enforced.
- T-120-12 (accidental serve-url factory reuse) — grep gate
  `getOrCreateProxyForTarget == 0` passes.

## Wave 3 Handoff Notes

Wave 3 Plan 05 (app-pane-router composition) imports both exports
exactly as specified:

```typescript
import { getOrCreateAppPaneProxyForTarget } from "../apps/app-pane-proxy-factory.js";
import { resolvePaneTarget } from "../apps/pane-target-resolver.js";
```

Composition sketch:

```typescript
// Inside the /apps/:hostId/:slug/pane/* route handler, after auth +
// slug/hostId validation + checkHostAccess + appProxyCsrfCheck + port
// lookup:
try {
  const { target, tunnelPort } = await resolvePaneTarget(hostIdNum, host, port);
  const middleware = getOrCreateAppPaneProxyForTarget(target, tunnelPort, hostIdNum, slug);
  middleware(req, res, next);
} catch (err) {
  // Tunnel failed — classify + render the shared interstitial per D-17.
  const errorClass = classifyTunnelError(err);
  writeInterstitial(res, renderInterstitial(errorClass, target, originalUrl, PRIMARY_DOMAIN));
}
```

- The factory's `on.error` hook handles proxy-time errors AFTER the
  tunnel is established (e.g. upstream port stops listening mid-request).
  Wave 3's outer try/catch handles tunnel-establishment errors from
  `resolvePaneTarget` — the two error surfaces do not overlap.
- `PRIMARY_DOMAIN` is imported into the factory transitively via
  `app-proxy-csrf-check.ts`; Wave 3's router can import it directly from
  there for the tunnel-establishment error path.

## Self-Check: PASSED

Verified via bash:

```
[ -f src/backend/apps/app-pane-proxy-factory.ts ] → FOUND
[ -f src/backend/apps/pane-target-resolver.ts ] → FOUND
[ -f src/backend/apps/tests/app-pane-proxy-factory.test.ts ] → FOUND
[ -f src/backend/apps/tests/pane-target-resolver.test.ts ] → FOUND

git log --oneline | grep f6de9991 → FOUND (test RED, Task 1)
git log --oneline | grep 6f02d265 → FOUND (feat GREEN, Task 1)
git log --oneline | grep 04fdd588 → FOUND (test RED, Task 2)
git log --oneline | grep f924a8e7 → FOUND (feat GREEN, Task 2)
git log --oneline | grep 315cdf16 → FOUND (refactor JSDoc, Task 1)

npx tsc --noEmit -p tsconfig.node.json → exit 0
npx vitest related --run [4 files] → 23/23 tests passed

Grep gates:
- Task 1 factory: hostId:slug=3, selfHandleResponse: true=3, ws: true=2,
  pathRewrite=5, sec-websocket-extensions=1 (exactly), apps_pane_proxy=2,
  text/html=7, base-tag-injector import=1, getOrCreateProxyForTarget=0.
- Task 1 test file: 17 it() cases (≥12 required), 4 cache-key
  scenario mentions (≥3 required).
- Task 2 resolver: isLocalHostId=0, tunnelCache.getOrCreate=1 (exactly),
  usedTunnel: true=1 (exactly), usedTunnel: false=0, non-comment catch=0.
- Task 2 test file: 6 it() cases (≥5 required), 6 usedTunnel: true
  mentions (≥2 required).
```

All acceptance criteria for both Task 1 and Task 2 verified.
