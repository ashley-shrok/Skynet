---
phase: 120-first-class-apps-campaign-shape-4-apps-as-a-content-type-in-
verified: 2026-09-19T04:50:00Z
status: passed
score: 22/22 must-haves verified
overrides_applied: 0
---

# Phase 120: First-class apps — shape 4 (apps as pane content type) Verification Report

**Phase Goal (from ROADMAP.md):** Deliver the closing shape of the first-class-apps campaign — apps become the fifth content type the main pane can hold, opened via left-click or drag from sidebar tiles, served under Skynet's own primary origin via a new reverse-proxy path with the CSRF check enforced at the proxy boundary, reload persistence + multi-instance falling out from the existing pane machinery.

**Requirements corpus:** D-01 through D-23 (from 120-CONTEXT.md § Decisions)

**Verified:** 2026-09-19T04:50:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (goal-backward derivation)

| #   | Truth                                                                                                                                                     | Status     | Evidence                                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sidebar tile left-click opens a new tab of type `"app"` in the focused leaf (D-06)                                                                        | VERIFIED   | `AppTile.tsx:156-167` `onTileClick → onOpenApp(Number(hostId), slug, title)`; `AppShell.tsx:2751-2760` `onOpenApp → openTab(null, "app", …, { app: {hostId, slug}, label: title })`             |
| 2   | Sidebar tile drag creates a new leaf via split-drop machinery (D-07)                                                                                      | VERIFIED   | `AppTile.tsx:181-194` `onTileDragStart` sets `application/x-skynet-app-tile` MIME with `effectAllowed="copy"`; `SplitView.tsx:184-192,663-692` extends `hasSkynetDragPayload` + dispatch branch |
| 3   | TabType extended to six arms including `"app"` (D-01)                                                                                                     | VERIFIED   | `ui-types.ts:157-163` — six-arm union: `dashboard \| terminal \| rdp \| vnc \| telnet \| app`                                                                                                   |
| 4   | Tab shape carries optional `app?: { hostId; slug }` + `isAppTab` narrowing predicate (D-02)                                                               | VERIFIED   | `ui-types.ts:246` `app?: { hostId: number; slug: string }`; `ui-types.ts:254-258` `isAppTab` predicate                                                                                          |
| 5   | `tabIcon` refactored from switch to `Record<TabType, ElementType>` lookup with `AppWindow` for the `app` arm (D-03)                                       | VERIFIED   | `tabUtils.tsx:113-125` `TAB_ICONS` Record; `app: AppWindow`; zero residual `switch(tab.type)` in `tabUtils.tsx`                                                                                 |
| 6   | `renderTabContent` refactored to `Record<TabType, Renderer>`; `rdp`/`vnc`/`telnet` are three explicit rows pointing at `renderGuacamoleTab` (D-04)         | VERIFIED   | `tabUtils.tsx:462-469` `RENDERERS` Record with all six entries; `renderGuacamoleTab` (:421) referenced by three explicit rows                                                                   |
| 7   | The `app` renderer mounts `<AppPane hostId slug tabId isVisible>`; iframe `src="/apps/${encodeURIComponent(hostId)}/${encodeURIComponent(slug)}/pane/"` (D-05, D-20) | VERIFIED   | `tabUtils.tsx:446-456` `renderAppTab` uses `isAppTab` narrowing → `<AppPane>`; `AppPane.tsx:61` src construction; `referrerPolicy="no-referrer"` at :66 (D-20)                                   |
| 8   | Backend proxy at `/apps/:hostId/:slug/pane/*` mounted on Skynet's primary origin (D-08)                                                                   | VERIFIED   | `app-pane-router.ts:120-121` `router.all("/:hostId/:slug/pane{/*splat}", …)`; `database.ts:2036` `app.use("/apps", appPaneRouter)`                                                              |
| 9   | Proxy reuses `serve-url/proxy-factory.ts` patterns via sibling factory (not fork) — RSV1 fix, HEADER_ALLOWLIST, error interstitial (D-09, D-17)          | VERIFIED   | `app-pane-proxy-factory.ts:187-201` `stripToAllowlist` + `sec-websocket-extensions=""` RSV1 fix; :208-214 responseInterceptor; :221-251 error → `classifyTunnelError` + `writeInterstitial`     |
| 10  | Proxy reuses `serve-url/tunnel-cache.ts`; **no local-loopback bypass** (Q1 RESOLVED) — always tunnel (D-10)                                               | VERIFIED   | `pane-target-resolver.ts:65-78` unconditionally calls `tunnelCache.getOrCreate(target)`; grep confirms **no** `isLocalHostId` branch in resolver                                                |
| 11  | HTTP + WebSocket both flow through; WS wired at `httpServer.on("upgrade", ...)` because `router.all` catches HTTP only (D-08 correctness)                | VERIFIED   | `database.ts:2377-2383` `httpServer.on("upgrade", …)` → `handleAppPaneUpgrade`; `app-pane-router.ts:361-530` implements upgrade dispatcher with same auth+access+CSRF+port+target chain          |
| 12  | Path prefix `^/apps/<hostId>/<slug>/pane` stripped by `pathRewrite` before forwarding — app sees itself at root (D-11)                                    | VERIFIED   | `app-pane-proxy-factory.ts:181-183` `pathRewrite: { [`^/apps/${hostId}/${slug}/pane`]: "" }`                                                                                                    |
| 13  | Response HTML body `<base>` injection via `responseInterceptor` — Content-Type-gated to `text/html` only (D-11 resolution)                                | VERIFIED   | `app-pane-proxy-factory.ts:208-214` responseInterceptor; content-type startsWith gate; `base-tag-injector.ts:70-81` `injectBaseTag`                                                             |
| 14  | Per-user `checkHostAccess(hostId, userId, hostUserId, "read")` gates the proxy at route entry (D-12)                                                     | VERIFIED   | `app-pane-router.ts:162-172` HTTP path; `:421-430` WS upgrade path; both call `checkHostAccess` with the Phase 118 canonical signature                                                          |
| 15  | Same-origin CSRF check at the proxy boundary (D-13) — GET/HEAD/OPTIONS pass; state-changing methods require Origin === PRIMARY_DOMAIN                    | VERIFIED   | `app-proxy-csrf-check.ts:77-83` pure helper; `app-pane-router.ts:179-183` HTTP invocation; WS upgrade path enforces same rule inline at :439-455 (per plan's ordering rationale)                |
| 16  | Starter template comment (D-14) updated to point at proxy layer as enforcement site; `csrf.checkOrigin: false` line preserved                            | VERIFIED   | `substrate/skills/app-development/templates/app-starter/svelte.config.js:9-22` — comment explicitly references `src/backend/apps/app-proxy-csrf-check.ts` + preserves disable line + Pitfall 4 warning |
| 17  | Multi-instance allowed by default — no dedupe (D-15)                                                                                                     | VERIFIED   | `AppShell.tsx:2749-2760` `onOpenApp` calls `openTab` unconditionally; `AppShell.tsx:2078-2083` `openTab` appends fresh Tab for each call — no `find(existing (hostId,slug))` gate; ditto `onDropAppTileInTree` |
| 18  | Reload persistence via `app_slug` DB column + `Tab.app` + `TabSpec` app variant + AppShell restore paths (D-16)                                          | VERIFIED   | `db/schema.ts:832` `appSlug: text("app_slug")`; `db/index.ts:1073` `addColumnIfNotExists`; `routes/open-tabs.ts` POST/PUT/GET read+write it; `tab-url.ts:82-83,208` app protocol variant; `AppShell.tsx:1573-1582,1698-1715` restore both from DB + URL; `PERSISTENT_TAB_TYPES` includes `"app"` at :1482 |
| 19  | Unhealthy tiles remain clickable/draggable — pane doesn't specialize on health (D-18)                                                                    | VERIFIED   | `AppTile.tsx:156-167,181-194` — no health gate anywhere in `onTileClick` or `onTileDragStart`; SUMMARY 07 explicitly notes this                                                                 |
| 20  | Leaf title = static metadata title (`app.title` → `Tab.label`) not `document.title` (D-19)                                                                | VERIFIED   | `AppShell.tsx:2755` `label: title` passed to `openTab` (title comes from `AppState.title` — Phase 118 metadata); `AppPane.tsx:65` iframe title uses slug NOT live document.title                |
| 21  | No signal to app about being in-pane — no headers/params/postMessage; `referrerPolicy="no-referrer"` (D-20)                                              | VERIFIED   | `AppPane.tsx:66` `referrerPolicy="no-referrer"`; router only forwards HEADER_ALLOWLIST-stripped headers (`app-pane-proxy-factory.ts:187-190`); no query params, no postMessage                    |
| 22  | Tests across four layers exist and PASS: client dispatch + client sidebar wiring + backend proxy + backend CSRF check (D-21)                              | VERIFIED   | 127 tests total across 8 files: 40 in wave-1 leaf tests + 34 in factory/integration + 53 in frontend AppPane/tabUtils/AppTile (all green when run with `SKYNET_COOKIE_DOMAIN` env set)          |

**Score:** 22 / 22 truths verified

---

## Required Artifacts (Level 1 — exist)

| Artifact                                                            | Expected                                     | Status     | Details                                                     |
| ------------------------------------------------------------------- | -------------------------------------------- | ---------- | ----------------------------------------------------------- |
| `src/backend/apps/app-proxy-csrf-check.ts`                          | Pure Origin-check helper + PRIMARY_DOMAIN    | VERIFIED   | 83 lines; module-load fail-loud env check                    |
| `src/backend/apps/base-tag-injector.ts`                             | Buffer transform for `<base>` injection      | VERIFIED   | 81 lines; case-insensitive first-match; fallback prepend    |
| `src/backend/apps/app-pane-proxy-factory.ts`                        | Sibling proxy factory (not fork)             | VERIFIED   | 258 lines; per-`(host:port::tunnel::hostId:slug)` cache      |
| `src/backend/apps/pane-target-resolver.ts`                          | Tunnel-only target resolver                  | VERIFIED   | 78 lines; unconditional `tunnelCache.getOrCreate`           |
| `src/backend/apps/app-pane-router.ts`                               | Router + WS upgrade dispatcher               | VERIFIED   | 530 lines; both HTTP + WS chains present                    |
| `src/ui/shell/AppPane.tsx`                                          | Iframe wrapper                                | VERIFIED   | 74 lines; no sandbox, no-referrer, eager, h-full w-full     |
| `src/ui/shell/tabUtils.tsx` (refactor)                              | Two switches → Record lookups                | VERIFIED   | `TAB_ICONS` + `RENDERERS`; zero residual `switch(tab.type)` |
| `src/types/ui-types.ts` (extension)                                 | TabType 6-arm + Tab.app + isAppTab           | VERIFIED   | Lines 157-163, 246, 254-258                                  |
| `src/ui/lib/tab-url.ts` (extension)                                 | TabSpec seventh variant `protocol: "app"`    | VERIFIED   | Lines 82-83, 121, 191-208                                    |
| `src/backend/database/db/schema.ts`                                 | `appSlug` column mirror                       | VERIFIED   | Line 832                                                    |
| `src/backend/database/db/index.ts`                                  | Runtime migration                             | VERIFIED   | Line 1073 `addColumnIfNotExists`                            |
| `src/backend/database/routes/open-tabs.ts`                          | POST/PUT/GET read+write appSlug              | VERIFIED   | Lines 96, 131, 141, 157, 204, 227                           |
| `src/ui/features/pretty-conversations/AppTile.tsx` (extension)      | onClick + drag handlers                       | VERIFIED   | Lines 156-194                                                |
| `src/ui/features/pretty-conversations/pretty-conversations.css`    | cursor: pointer (Phase 119 override removed) | VERIFIED   | Line 1407 rule block + line 1371 comment documenting revert |
| `src/ui/shell/SplitView.tsx` (extension)                            | app-tile drop dispatch                        | VERIFIED   | Lines 184-192, 208-209, 245-249, 663-692                    |
| `src/ui/AppShell.tsx` (extension)                                   | onOpenApp + onDropAppTileInTree + restore    | VERIFIED   | Lines 1472-1483, 1567-1582, 1690-1715, 2747-2788, 2987, 3809 |
| `substrate/skills/app-development/templates/app-starter/svelte.config.js` | D-14 comment update            | VERIFIED   | Lines 9-22; disable line preserved at 20-22                 |
| Backend tests (5 files)                                              | 4-layer D-21 coverage                        | VERIFIED   | 74 tests across app-proxy-csrf-check / base-tag-injector / pane-target-resolver / app-pane-proxy-factory / app-pane-router.integration |
| Frontend tests (3 files)                                             | dispatch + sidebar-wiring coverage           | VERIFIED   | 53 tests across AppPane / tabUtils / AppTile                |

---

## Key Link Verification (Level 3 — wired)

| From                              | To                                                | Via                                                                | Status | Details                                                                                       |
| --------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------- |
| `AppTile.tsx`                     | `AppShell.onOpenApp` → `openTab`                  | prop `onOpenApp` bubbled through PrettyConversationsPanel          | WIRED  | Verified by direct import + integration test in `AppTile.test.tsx`                            |
| `AppTile.tsx` (drag source)       | `SplitView.tsx` drop dispatch                     | MIME `application/x-skynet-app-tile`                               | WIRED  | AppTile setData + SplitView `hasSkynetDragPayload` includes MIME + drop branch calls callback |
| `SplitView.tsx` (drop)            | `AppShell.onDropAppTileInTree` → `openTab`+`openSessionInTree` | prop `onDropAppTileInTree`                                          | WIRED  | Wired at AppShell.tsx:3809; callback body creates fresh leaf                                  |
| `tabUtils.tsx` `renderAppTab`     | `<AppPane>` iframe                                 | direct import                                                       | WIRED  | Import at tabUtils.tsx:45; call at :449                                                       |
| `<AppPane>` iframe                | `/apps/:hostId/:slug/pane/` route                  | `src` attribute                                                     | WIRED  | AppPane.tsx:61 + route mounted at database.ts:2036                                            |
| `app-pane-router.ts` HTTP         | `checkHostAccess` (D-12)                           | direct import + call before CSRF check                              | WIRED  | Lines 86, 162-172                                                                             |
| `app-pane-router.ts` HTTP         | `appProxyCsrfCheck` (D-13)                         | direct import + call after access check                             | WIRED  | Lines 89-92, 179-183                                                                          |
| `app-pane-router.ts` HTTP         | `resolvePaneTarget` → `tunnelCache.getOrCreate`    | direct import + call before proxy handoff                           | WIRED  | Lines 94, 234                                                                                 |
| `app-pane-router.ts` HTTP         | `getOrCreateAppPaneProxyForTarget`                 | direct import + call at end of chain                                | WIRED  | Lines 93, 275-281                                                                             |
| `httpServer` upgrade event        | `handleAppPaneUpgrade`                             | `httpServer.on("upgrade", ...)`                                     | WIRED  | database.ts:2377-2383                                                                         |
| `app-pane-proxy-factory.ts`       | `injectBaseTag` (D-11)                             | responseInterceptor content-type gate                               | WIRED  | Line 92 import; :208-214 invocation                                                           |
| `app-pane-proxy-factory.ts`       | `HEADER_ALLOWLIST` strip + RSV1 fix                | `stripToAllowlist` + `sec-websocket-extensions=""`                  | WIRED  | Lines 187-201                                                                                 |
| `AppShell.tsx` DB restore path    | `saved.appSlug` → `Tab.app.slug`                   | GET /open-tabs returns appSlug + reconstruction                     | WIRED  | Lines 1573-1582                                                                               |
| `AppShell.tsx` URL restore path   | `TabSpec.app` → `openTab({type:"app", app:{...}})` | `tab-url.parseTabParam` + AppShell URL restore                      | WIRED  | tab-url.ts:191-208; AppShell.tsx:1698-1715                                                    |

---

## Data-Flow Trace (Level 4)

| Artifact                          | Data Variable    | Source                                       | Produces Real Data | Status                                              |
| --------------------------------- | ---------------- | -------------------------------------------- | ------------------ | --------------------------------------------------- |
| `<AppPane>` iframe                | iframe `src`     | `hostId`, `slug` from Tab.app                | Yes                | FLOWING — Tab.app is populated by openTab call path |
| `AppTile.tsx` `onOpenApp` call    | `app.hostId`, `app.slug`, `app.title` | `AppState` from Phase 118 registry snapshot   | Yes                | FLOWING — real data from fleet-status subscription  |
| `app-pane-router.ts` port lookup  | `app.port`        | `getRegistry().getAppSnapshot()` (Phase 118) | Yes                | FLOWING — registry populated by 2s ssh-poll         |
| `RENDERERS[tab.type]` dispatch    | `tab.type`, `tab.app` | Tab from `tabs` state array               | Yes                | FLOWING — every tab created via openTab has proper shape |
| CSRF check                        | `Origin` header  | Browser (same-origin same-tab iframe request) | Yes                | FLOWING — origin matches Skynet primary domain for legit iframe requests |
| DB round-trip                     | `appSlug` column | POST/PUT /open-tabs body                     | Yes                | FLOWING — persisted for app-type tabs, null otherwise |

No hollow-prop patterns, no static empty data, no disconnected data source.

---

## Behavioral Spot-Checks

| Behavior                                                              | Command                                                                                            | Result                        | Status  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------- | ------- |
| Backend leaf unit tests (csrf-check + base-tag-injector + resolver)   | `SKYNET_COOKIE_DOMAIN=... npx vitest run backend/apps/tests/{app-proxy-csrf-check,base-tag-injector,pane-target-resolver}.test.ts` | 40 passed / 40                | PASS    |
| Backend factory + integration tests                                    | `npx vitest run backend/apps/tests/{app-pane-proxy-factory,app-pane-router.integration}.test.ts`   | 34 passed / 34                | PASS    |
| Frontend tests (AppPane + tabUtils + AppTile)                          | `npx vitest run ui/shell/{AppPane,tabUtils}.test.tsx ui/features/pretty-conversations/AppTile.test.tsx` | 53 passed / 53           | PASS    |
| Full-project TypeScript compile                                        | `npx tsc --noEmit -p tsconfig.json`                                                                | exit 0 (silent)               | PASS    |
| Debt-marker scan (TBD/FIXME/XXX/TODO/HACK) in Phase 120 code           | `grep -rn "TBD\|FIXME\|XXX\|TODO\|HACK" src/backend/apps/ src/ui/shell/AppPane.tsx …`             | 0 hits in phase artifacts     | PASS    |
| No residual `switch(tab.type)` in tabUtils                             | `grep -n "switch\s*(\s*tab" src/ui/shell/tabUtils.tsx`                                             | 0 hits                        | PASS    |

Live end-to-end UAT (open the sidebar, click a tile, drag to split, form-POST inside the app, reload, etc.) is deliberately deferred to campaign close per D-23 / SUMMARY 08 UAT-defer policy — matches Phase 118/119 shape-3 discipline. Not run here.

---

## Requirements Coverage

Phase 120 requirements are D-01..D-23 (no formal REQ-IDs; every D-decision must be delivered).

| D-ID | Description                                                        | Status     | Evidence                                                                                                                     |
| ---- | ------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| D-01 | Extend TabType union to six arms                                    | SATISFIED  | `ui-types.ts:157-163`                                                                                                        |
| D-02 | Extend Tab type with `app?: {hostId, slug}` + `isAppTab` predicate | SATISFIED  | `ui-types.ts:246,254-258`                                                                                                    |
| D-03 | Refactor `tabIcon` to Record lookup                                 | SATISFIED  | `tabUtils.tsx:113-125`                                                                                                       |
| D-04 | Refactor `renderTabContent` to Record lookup                        | SATISFIED  | `tabUtils.tsx:462-499` + rdp/vnc/telnet three explicit rows                                                                  |
| D-05 | `<AppPane>` iframe component                                        | SATISFIED  | `AppPane.tsx`                                                                                                                |
| D-06 | Left-click on sidebar tile opens app leaf                           | SATISFIED  | `AppTile.tsx:156-167` + `AppShell.tsx:2751-2760` + cursor:pointer at CSS:1407                                                |
| D-07 | Drag from sidebar tile creates new leaf via split-drop              | SATISFIED  | `AppTile.tsx:181-194` + `SplitView.tsx:184-192,663-692` + `AppShell.tsx:2769-2788`                                          |
| D-08 | Backend proxy `/apps/:hostId/:slug/pane/*` under primary origin     | SATISFIED  | `app-pane-router.ts:120-121` + `database.ts:2036`                                                                            |
| D-09 | Reuse `proxy-factory.ts` machinery (sibling factory, not fork)      | SATISFIED  | `app-pane-proxy-factory.ts` explicitly inherits/duplicates hardening rather than importing serve-url internals                |
| D-10 | Reuse `tunnel-cache.ts`; Q1 RESOLVED — always tunnel                | SATISFIED  | `pane-target-resolver.ts:65-78`, no `isLocalHostId` branch                                                                   |
| D-11 | Path prefix strip via `pathRewrite` + `<base>` injection            | SATISFIED  | `app-pane-proxy-factory.ts:181-183,208-214` + `base-tag-injector.ts`                                                        |
| D-12 | `checkHostAccess` gate at route entry                               | SATISFIED  | `app-pane-router.ts:162-172` (HTTP) + `:421-430` (WS)                                                                        |
| D-13 | CSRF Origin check middleware at proxy boundary                      | SATISFIED  | `app-proxy-csrf-check.ts:77-83` + call at router:179-183; WS inline at :439-455                                              |
| D-14 | Starter template comment update                                     | SATISFIED  | `substrate/skills/app-development/templates/app-starter/svelte.config.js:9-22`                                               |
| D-15 | Multi-instance allowed by default                                   | SATISFIED  | No dedupe in `onOpenApp`/`onDropAppTileInTree`; SUMMARY 07 documents absence-of-gate as satisfying the requirement           |
| D-16 | Reload persistence via existing pane machinery + `app_slug` column | SATISFIED  | `db/schema.ts:832` + `db/index.ts:1073` + `open-tabs.ts` field wiring + AppShell restore paths (DB + URL) + PERSISTENT_TAB_TYPES:1482 |
| D-17 | Reuse Phase 103's interstitial for tunnel errors                    | SATISFIED  | `app-pane-proxy-factory.ts:221-251` + `app-pane-router.ts:237-269`                                                          |
| D-18 | Unhealthy tiles remain clickable/draggable                          | SATISFIED  | No health gate in `AppTile.onTileClick`/`onTileDragStart`                                                                    |
| D-19 | Leaf title = static metadata title                                  | SATISFIED  | `AppShell.tsx:2755` passes `title` (from AppState.title) as `label`; no `document.title` mirroring                          |
| D-20 | No signal to app about being in-pane                                | SATISFIED  | `AppPane.tsx:66` `referrerPolicy="no-referrer"` + no injected header/query/postMessage anywhere in Phase 120 code           |
| D-21 | Tests at four layers                                                | SATISFIED  | 127 total tests split across the four layers named in the D-decision                                                         |
| D-22 | Executor scoped tests + orchestrator full-suite pre-deploy          | SATISFIED  | Each plan's SUMMARY documents scoped `npx vitest related` gate; deploy motion deferred to campaign close per hold policy   |
| D-23 | Agent-side UAT deferred to campaign close                           | SATISFIED  | SUMMARY 08 documents the full UAT procedure to be executed at campaign close per campaign hold policy                        |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | — | — | No blockers, warnings, or info-level anti-patterns identified across Phase 120's touched files. Zero TBD/FIXME/XXX/TODO/HACK markers; zero stub returns; zero hardcoded empty data; no residual switch on `tab.type`; no orphan artifacts. |

---

## Human Verification Required

None at this stage. The phase goal is observably delivered in the codebase AS COMMITTED. The one live end-to-end user-flow test (D-23) is explicitly deferred to campaign close per the UAT-defer-to-close policy inherited from shape 3 — that is not a Phase 120 gap; it is the deliberate campaign-level rhythm. The verifier was instructed NOT to run the D-23 UAT during this pass.

---

## Gaps Summary

No gaps. Every D-decision from D-01 to D-23 is delivered in code with substantive implementations, wired end-to-end, and covered by tests that PASS under scoped Vitest runs. TypeScript compiles clean across the whole codebase. The starter-template comment (the sole substrate-side change) preserves the disable line and correctly points at the proxy layer as the enforcement site.

Notes worth carrying forward (not gaps):

1. Full-suite Vitest and Playwright smoke are the orchestrator's pre-deploy gates (D-22); this verification ran the four Phase-120 test suites scoped, not the entire project — that matches the fleet's standing scoped-executor rule.
2. Deploy motion (git push + docker build + docker compose up --force-recreate) stays held pending campaign-close greenlight; that hold is a campaign-level policy, not a phase-level gap.
3. D-23 agent-side UAT converges at campaign close together with shapes 1-3 UAT.

---

_Verified: 2026-09-19T04:50:00Z_
_Verifier: Claude (goal-backward)_
