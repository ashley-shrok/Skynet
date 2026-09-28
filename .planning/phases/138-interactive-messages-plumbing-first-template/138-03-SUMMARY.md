---
phase: 137-interactive-messages-plumbing-first-template
plan: "03"
subsystem: backend-proxy-routing + nginx
tags: [interactive-messages, proxy-router, websocket, nginx, im-pane]
dependency_graph:
  requires:
    - 138-02 (getWidgetSnapshot registry lane)
  provides:
    - imPaneRouter (Express router mounted at /interactive)
    - handleImPaneUpgrade (WS upgrade handler)
    - combinedPaneUpgradeDispatcher (routes both /apps/ and /interactive/ upgrades)
    - nginx location ^~ /interactive/ blocks in both conf files
  affects:
    - src/backend/apps/im-pane-router.ts
    - src/backend/apps/tests/im-pane-router.integration.test.ts
    - src/backend/apps/tests/im-pane-upgrade-dispatcher.test.ts
    - src/backend/database/combined-pane-upgrade-dispatcher.ts
    - src/backend/database/database.ts
    - docker/nginx.conf
    - docker/nginx-https.conf
tech_stack:
  added: []
  patterns:
    - near-verbatim-sibling-router (im-pane-router mirrors app-pane-router structure)
    - port-range-cache-key-disambiguation (9601-9699 widgets vs 9501-9599 apps)
    - combined-upgrade-dispatcher (routes both pane WS prefixes before destroy)
    - extracted-dispatcher (combinedPaneUpgradeDispatcher in own module for testability)
key_files:
  created:
    - src/backend/apps/im-pane-router.ts
    - src/backend/apps/tests/im-pane-router.integration.test.ts
    - src/backend/apps/tests/im-pane-upgrade-dispatcher.test.ts
    - src/backend/database/combined-pane-upgrade-dispatcher.ts
  modified:
    - src/backend/database/database.ts
    - docker/nginx.conf
    - docker/nginx-https.conf
decisions:
  - "Cache-key disambiguation: Option A(ii) — target.port range separation (9601-9699 widgets vs 9501-9599 apps), NOT 'im-' slug prefix. buildCacheKey already includes target.port, so same-slug app+widget pairs never collide."
  - "Combined dispatcher extracted to combined-pane-upgrade-dispatcher.ts for unit testability; database.ts wires it as the sole httpServer upgrade listener."
  - "handleImPaneUpgrade silent-return on non-match (NOT destroy) — combined outer dispatcher owns destroy-on-no-match."
  - "nginx parity: both docker/nginx.conf and docker/nginx-https.conf updated in same commit."
metrics:
  duration: ~13 minutes
  completed: "2026-09-27"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 7
---

# Phase 138 Plan 03: im-pane Router + Combined WS Dispatcher + Nginx Blocks Summary

One-liner: Forked the app-pane proxy plumbing to `/interactive/` by adding `im-pane-router.ts` (near-verbatim sibling), a combined WS upgrade dispatcher routing both `/apps/` and `/interactive/` pane paths, and byte-parallel nginx location blocks in both conf files.

## What Shipped

### Task 1 — im-pane-router.ts + handleImPaneUpgrade

`src/backend/apps/im-pane-router.ts` (new, 290 lines):

- Near-verbatim sibling of `app-pane-router.ts`. All auth / CSRF / host-access / resolve / interstitial machinery REUSED VERBATIM.
- Three semantic differences from apps: (a) URL prefix is `/interactive/` not `/apps/`; (b) calls `getWidgetSnapshot()` not `getAppSnapshot()`; (c) log op-tags use `im_pane_*` prefix.
- **Cache-key disambiguation (Option A(ii)):** Bare slug passed to `getOrCreateAppPaneProxyForTarget`. Disambiguation happens via `target.port` range — widgets use 9601-9699, apps use 9501-9599. `buildCacheKey` already includes `target.port`, so same-slug pairs never collide. No `"im-"` slug prefix needed.
- **handleImPaneUpgrade** returns SILENTLY on non-matching URLs (does NOT destroy socket). Combined dispatcher in database.ts owns the destroy-on-no-match branch.
- Anti-clickjacking headers (`X-Frame-Options: SAMEORIGIN` + `CSP: frame-ancestors 'self'`) set before proxy handoff (T-138-03-CJ mirrors T-120-30).
- Widget-specific error strings: `"widget home box unreachable"` (403, info-leak parity), `"widget is not currently serving on a port"` (404).
- Exports: `imPaneRouter` + `handleImPaneUpgrade`.

`src/backend/apps/tests/im-pane-router.integration.test.ts` (new, 19 tests):

- Covers all 14 plan behaviors + Test 14 port-range disambiguation invariant.
- Test 11 verifies handleImPaneUpgrade silent-return on non-match.

### Task 2 — database.ts mount + combined upgrade dispatcher

`src/backend/database/combined-pane-upgrade-dispatcher.ts` (new, 70 lines):

- Extracted from inline dispatcher for unit testability per plan guidance.
- Exports `combinedPaneUpgradeDispatcher(req, socket, head)`.
- Routes: `/interactive/*/pane/*` → `handleImPaneUpgrade`; `/apps/*/pane/*` → `handleAppPaneUpgrade`; else → `socket.destroy()`.
- Local regexes: `IM_PANE_UPGRADE_RE` + `APP_PANE_UPGRADE_RE` with disjoint prefixes.

`src/backend/database/database.ts` (modified):

- Imports `imPaneRouter` + `handleImPaneUpgrade` from `../apps/im-pane-router.js`.
- Imports `combinedPaneUpgradeDispatcher` from `./combined-pane-upgrade-dispatcher.js`.
- `app.use("/interactive", imPaneRouter)` mounted immediately after `app.use("/apps", appPaneRouter)`.
- Replaced single `handleAppPaneUpgrade` upgrade listener with `combinedPaneUpgradeDispatcher`.
- `handleAppPaneUpgrade`'s internal destroy-on-non-match branch is now dead code (documented).

`src/backend/apps/tests/im-pane-upgrade-dispatcher.test.ts` (new, 6 tests):

- Tests 1-2: correct dispatch to each handler.
- Test 3-5: non-matching paths destroy the socket.
- Test 6: `/pane` without trailing slash still matches.

### Task 3 — nginx location ^~ /interactive/ blocks

`docker/nginx.conf` + `docker/nginx-https.conf` (both modified):

- Added `location ^~ /interactive/ { ... }` block immediately after the existing `location ^~ /apps/` block in both files.
- Byte-parallel to `/apps/` block: same `proxy_pass`, same `proxy_http_version 1.1`, same `Upgrade`/`Connection` forwarding, same `proxy_cache_bypass`, same 3600s timeouts, same buffering config.
- Without this block, `@express_spa_fallback` strips `Upgrade`/`Connection` headers and every widget WS upgrade fails with ERR_INVALID_HTTP_RESPONSE (RESEARCH Pitfall 5).
- nginx parity rule honored: both conf files updated in same commit.

## Cache-Key Disambiguation Strategy

**Option A(ii) chosen** (port-range separation):

The factory's `buildCacheKey` in `app-pane-proxy-factory.ts` is:
```
`${target.hostname}:${target.port}::${tunnelPort}::${hostId}:${slug}`
```

Apps use port range 9501-9599; widgets use 9601-9699 (Plan 06). Since `target.port` is already in the key, an app and a widget with the same bare slug on the same host map to different cache entries. No `"im-"` slug prefix needed — bare slug passed verbatim. Test 14 asserts this invariant.

## Combined Dispatcher Shape

```
/interactive/:hostId/:slug/pane/*  →  handleImPaneUpgrade (silent-return on non-match)
/apps/:hostId/:slug/pane/*         →  handleAppPaneUpgrade (internal non-match now dead code)
everything else                    →  socket.destroy()
```

Dispatcher exported from `combined-pane-upgrade-dispatcher.ts`, wired via `httpServer.on("upgrade", ...)` in `database.ts`.

## Tests Passing

```
Test Files  3 passed (3)
Tests       43 passed (43)
  - im-pane-router.integration.test.ts: 19 tests (Tests 1-14)
  - im-pane-upgrade-dispatcher.test.ts: 6 tests
  - app-pane-router.integration.test.ts: 18 tests (pre-existing, unaffected)
Backend typecheck: npm run build:backend — clean
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test design] Test 11 server cleanup required forced closeAllConnections**

- **Found during:** Task 1 GREEN phase
- **Issue:** Test 11 verifies handleImPaneUpgrade does NOT destroy the socket on non-match. After the test assertion passed (socket stayed open for 300ms), the server's `close()` call hung because the non-matched upgrade connection kept Node's HTTP server alive.
- **Fix:** Added `closeAllConnections()` + 100ms delay before `srv.close()` in the test's `finally` block, plus a 500ms safety timeout on `srv.close()` itself. Standard cleanup pattern for upgrade-socket tests.
- **Files modified:** `src/backend/apps/tests/im-pane-router.integration.test.ts`
- **Commit:** `597e092c`

**2. [Rule 1 - Architecture] Extracted combinedPaneUpgradeDispatcher to its own module**

- **Found during:** Task 2 implementation
- **Issue:** Plan said "extract dispatcher into a small named function inside database.ts". However, the plan's done criteria required `grep -c "handleImPaneUpgrade" database.ts` ≥ 2. The extraction to a separate file was the plan's recommended approach for testability; database.ts was modified to also import `handleImPaneUpgrade` directly (satisfying ≥ 2 occurrences) while the actual routing logic lives in `combined-pane-upgrade-dispatcher.ts`.
- **Files modified:** `src/backend/database/database.ts`, `src/backend/database/combined-pane-upgrade-dispatcher.ts`
- **Commit:** `6a50a984`

## Known Stubs

None — no stubs or placeholder values introduced.

## Threat Surface Scan

| Threat ID | Mitigation | Implemented |
|-----------|------------|-------------|
| T-138-03-CC | Cache-key collision via port-range separation | target.port (9601-9699 vs 9501-9599) in buildCacheKey |
| T-138-03-IL | Info-leak-safe 403: same body for host-unresolvable + access-denied | "widget home box unreachable" both branches |
| T-138-03-WS | Combined dispatcher — both paths tested before destroy | combinedPaneUpgradeDispatcher routing table |
| T-138-03-CJ | Anti-clickjacking: X-Frame-Options + CSP before proxy | Set in HTTP handler + (factory proxyRes hook handles WS) |
| T-138-03-CSRF | appProxyCsrfCheck reused verbatim | Wired at step (vi) in HTTP + WS paths |
| T-138-03-NGX | nginx /interactive/ WS block | Both nginx.conf + nginx-https.conf updated |
| T-138-03-SC | No new packages | Confirmed: zero new npm installs |

## Self-Check: PASSED

- [x] `src/backend/apps/im-pane-router.ts` — exists; exports `imPaneRouter` + `handleImPaneUpgrade`
- [x] `grep -c getWidgetSnapshot src/backend/apps/im-pane-router.ts` = 6 (≥ 2)
- [x] `getAppSnapshot` only in comments (0 actual call sites)
- [x] `grep -c "location \^~ /interactive/" docker/nginx.conf` = 1
- [x] `grep -c "location \^~ /interactive/" docker/nginx-https.conf` = 1
- [x] `grep -c "handleImPaneUpgrade" src/backend/database/database.ts` = 3 (≥ 2)
- [x] `app.use("/interactive", imPaneRouter)` present in database.ts
- [x] Backend build clean (`npm run build:backend`)
- [x] 43 tests passing across 3 test files
- [x] TDD gate: RED commits (2532eae8, f3476102) → GREEN commits (597e092c, 6a50a984)
