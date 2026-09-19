# Phase 120: First-class apps campaign shape 4 — apps as a content type in the pane - Research

**Researched:** 2026-09-19
**Domain:** Reverse-proxy path routing + client-side content-type dispatch refactor + drag-source wiring + iframe pane content
**Confidence:** HIGH

## Summary

Phase 120 is the closing shape of a four-shape campaign. Every load-bearing piece it needs already exists in the codebase — `http-proxy-middleware` v4.2.0 with its per-target-cached factory (`src/backend/serve-url/proxy-factory.ts`), the SSH tunnel-cache (`tunnel-cache.ts`), the tab-dispatch switch in `src/ui/shell/tabUtils.tsx`, the drag-source pattern in `PrettyConversationRow.tsx`, the pane's split-drop machinery in `SplitView.tsx` — and the phase composes these into one new route + one new middleware + one new pane component + one small refactor.

The ONE genuinely open design question (D-11: how absolute-URL references in the app's outgoing HTML/JS resolve when the pane strips the path prefix) has a defensible answer: **inject `<base href="/apps/:hostId/:slug/pane/">` into HTML responses via `http-proxy-middleware`'s built-in `responseInterceptor` helper**. It handles `<script src="/x.js">`, `<link href="/x.css">`, `<img src="/x.png">`, and `<a href="/x">` — the four cases that matter for SvelteKit's `adapter-node` output. `fetch("/api")` from JS still resolves against the browser origin, but SvelteKit's own runtime uses `$app/paths` (relative when `paths.relative: true`); user-authored `fetch` bugs are an app-side concern that the shape file's "apps are black boxes" philosophy explicitly does not attempt to fix. Two other options exist (full body rewrite; scope-amendment `paths.base` config) — the `<base>` approach is chosen because it's minimal, uses a first-party feature of http-proxy-middleware v4, and does not require a scope amendment.

**Primary recommendation:** Compose `proxy-factory.ts` + `tunnel-cache.ts` into a new `src/backend/apps/app-pane-router.ts` that mounts at `/apps/:hostId/:slug/pane/*`, wires `pathRewrite` to strip the mount prefix, adds a `responseInterceptor` that injects `<base href="/apps/:hostId/:slug/pane/">` into text/html responses, wraps the whole thing behind a `checkHostAccess` gate at route entry and a new `app-proxy-csrf-check.ts` Origin-check middleware. Client side: refactor `tabUtils.tsx`'s two switches to `Record<TabType, ...>` lookups, extend `TabType`, add `Tab.app`, add `AppPane.tsx` (single-purpose iframe wrapper), wire `AppTile.tsx` with an `onClick` handler and drag-source `dataTransfer.setData("application/x-skynet-app-tile", ...)`, extend `SplitView.tsx`'s payload dispatch to recognise the new MIME.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CSRF Origin check | API / Backend (Express middleware) | — | The trust boundary is at the proxy — the app's own check is disabled by design (D-14). Cannot live in browser (attacker controls the browser). |
| Reverse-proxy byte forwarding | API / Backend (Express + http-proxy-middleware) | — | Same-origin path proxying keeps cookies + auth flowing. Browser can't proxy. |
| SSH tunnel to app's home box | API / Backend | — | Reuses `serve-url/tunnel-cache.ts`; SSH is a backend concern. |
| Host-visibility filter (`checkHostAccess`) | API / Backend | — | Access-control primitives always run server-side. Same function shape 2 uses at wire boundary. |
| App-tab dispatch (five kinds → six) | Browser / Client (React) | — | `tabUtils.tsx` is the client-side pane's routing hub; unchanged behaviour by tier. |
| Drag payload construction (sidebar tile) | Browser / Client (React drag events) | — | HTML5 drag-and-drop is a browser API; MIME + payload live on the client. |
| Drop-target dispatch (SplitView) | Browser / Client (React + native DOM listeners) | — | Existing pattern in `SplitView.tsx` (patch #514 wires native listeners for portal semantics). |
| Iframe render (pane content) | Browser / Client | — | `<iframe>` is a browser primitive; the pane hosts it as leaf content. |
| Response body `<base>` injection | API / Backend (proxy response interceptor) | — | The rewrite happens at the byte-forwarding layer using `http-proxy-middleware`'s `responseInterceptor`. |
| Reload persistence (layout tuple) | Browser / Client (URL fragment + backend `user_open_tabs`) | API / Backend (DB) | Existing pane persistence — the D-02 `Tab.app` field rides through unchanged for the URL scheme; the SQL schema needs a small extension (see Runtime State Inventory). |
| Iconless / broken-tunnel error surface | API / Backend (`interstitial.ts`) | — | Reuses Phase 103's production-hardened error interstitial. Client renders whatever bytes the proxy hands it. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `http-proxy-middleware` | 4.2.0 (installed) | Byte-forwarding for HTTP + WebSocket + response transform | [VERIFIED: package.json + npm registry] Already used verbatim by `proxy-factory.ts`. Latest per npm view 2026-09-19: 4.2.0 (same as installed). |
| `express` | (existing) | Route mount surface | [VERIFIED: package.json] Already the app-wide HTTP framework. |
| `@sveltejs/kit` | 2.8.0+ (starter template) | Framework consumed by the D-14 comment update; drives the CSRF-check-disable semantics | [CITED: svelte.config.js starter template] `csrf.checkOrigin: false` is the current disable line to re-comment. Current stable per npm view 2026-09-19: 2.70.3 (starter uses ^2.8.0 — semver-compatible). |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ssh2` | (existing) | SSH tunnel to app's home box for remote-host case | [VERIFIED: existing use in `serve-url/tunnel-cache.ts`] Reused via `tunnelCache.getOrCreate`. |
| React (existing) | 18.x | Client-side tab-dispatch table + iframe wrapper | [VERIFIED: package.json] Existing UI framework; standard lookup-table refactor. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `responseInterceptor` for HTML body rewriting | External library (e.g. `cheerio`) or hand-rolled regex | responseInterceptor is FIRST-PARTY (`http-proxy-middleware` ships it in `handlers/response-interceptor`), auto-handles gzip/brotli/zstd decompression. No new dependency. [VERIFIED: `dist/handlers/response-interceptor.d.ts` in node_modules] |
| `<base>` tag injection | Full URL rewriting of every href/src in the HTML | `<base>` is one 60-char string prepended once; full rewriting is expensive per-request and adds regex maintenance surface. See D-11 resolution below. |
| Custom SSH tunnel for the pane proxy | Reuse `tunnel-cache.ts` verbatim | Reuse is D-09/D-10's explicit locked decision — do NOT reinvent. |
| Fresh MIME type `application/x-skynet-app-tile` | Extend `application/x-skynet-row` with `kind: "app-tile"` | Fresh MIME chosen — see Q1 recommendation below. |

**Installation:**

No new packages required. All work uses installed dependencies.

**Version verification:** `npm view http-proxy-middleware version` → 4.2.0 (matches installed). `npm view @sveltejs/kit version` → 2.70.3 (starter's `^2.8.0` semver-compatible with any 2.x). Confirmed 2026-09-19.

## Package Legitimacy Audit

Phase 120 installs **no new packages**. The Package Legitimacy Gate is not applicable — every runtime dependency already ships in the project's lockfile and has been in production use since Phase 103 (`http-proxy-middleware`) or earlier (`express`, `ssh2`, React).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| — | — | — | — | — | — | No new installs |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─── Browser (Skynet UI) ─────────────────────────────┐
                    │                                                      │
  sidebar tile      │  AppTile.tsx                                         │
  ────────────►     │    - onClick → onOpenTab({type:"app", app:{...}})   │
  (left-click)      │    - onDragStart → dataTransfer.setData(            │
                    │        "application/x-skynet-app-tile", {…})        │
                    │                                                      │
                    │  SplitView.tsx (drop target)                        │
                    │    hasSkynetDragPayload() ─┬─ x-skynet-badge         │
                    │                            ├─ x-skynet-row           │
                    │                            └─ x-skynet-app-tile ●    │
                    │                                                      │
                    │  tabUtils.tsx (dispatch)                            │
                    │    tabIcon: TAB_ICONS[type] lookup                  │
                    │    renderTabContent: RENDERERS[type](tab, deps)     │
                    │                                                      │
                    │  AppPane.tsx (NEW)                                  │
                    │    <iframe src="/apps/:hostId/:slug/pane/"          │
                    │      referrerpolicy="no-referrer" />                │
                    │                                                      │
                    └──────────────────┬───────────────────────────────────┘
                                       │ HTTPS (same origin)
                                       ▼
                    ┌─── Skynet Backend (Express) ───────────────────────┐
                    │                                                     │
                    │  /apps/:hostId/:slug/pane/*   (NEW MOUNT)          │
                    │    │                                                │
                    │    ▼                                                │
                    │  authenticateJWT ── 401 → login redirect           │
                    │    │                                                │
                    │    ▼                                                │
                    │  APP_SLUG_RE + hostId gate ── 400 on malformed     │
                    │    │                                                │
                    │    ▼                                                │
                    │  checkHostAccess(hostId, userId, hostUserId, 'read')│
                    │    │  false → 403 (info-leak-safe body)             │
                    │    ▼                                                │
                    │  app-proxy-csrf-check.ts (NEW)                     │
                    │    │  state-changing method?                        │
                    │    │  yes: Origin === Skynet primary? → forward     │
                    │    │       else → 403 (Skynet-authored body)        │
                    │    │  GET/HEAD/OPTIONS: pass                        │
                    │    ▼                                                │
                    │  pane-target-resolver.ts (NEW)                     │
                    │    │  isLocalHostId(hostId)?                        │
                    │    │  yes → direct target 127.0.0.1:port            │
                    │    │  no  → tunnelCache.getOrCreate(ServeTarget)   │
                    │    ▼                                                │
                    │  http-proxy-middleware (proxy-factory)             │
                    │    - pathRewrite: strip /apps/:hostId/:slug/pane    │
                    │    - responseInterceptor: inject <base> into HTML   │
                    │    - HEADER_ALLOWLIST strip (D-04 default-deny)    │
                    │    - RSV1 WebSocket fix (R&D Gotcha 1)              │
                    │    - per-target cache (R&D Gotcha 2)                │
                    │                                                     │
                    └──────────────────┬─────────────────────────────────┘
                                       │ SSH forwardOut (remote) OR direct loopback (local)
                                       ▼
                    ┌─── App on home box ────────────────────────────────┐
                    │  SvelteKit app on 127.0.0.1:PORT                   │
                    │  (csrf.checkOrigin: false — proxy enforces)        │
                    └────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── backend/
│   ├── apps/                                (NEW directory for backend-side app plumbing)
│   │   ├── app-pane-router.ts               (NEW — the /apps/:hostId/:slug/pane/* mount)
│   │   ├── app-proxy-csrf-check.ts          (NEW — Origin-check middleware)
│   │   ├── pane-target-resolver.ts          (NEW — local-loopback vs SSH-tunnel decider)
│   │   ├── base-tag-injector.ts             (NEW — responseInterceptor helper for D-11)
│   │   └── tests/
│   │       ├── app-pane-router.integration.test.ts
│   │       ├── app-proxy-csrf-check.test.ts
│   │       ├── pane-target-resolver.test.ts
│   │       └── base-tag-injector.test.ts
│   ├── serve-url/                          (READ-ONLY reuse — no changes)
│   └── database/
│       ├── database.ts                     (extend router mount block)
│       ├── db/schema.ts                    (extend user_open_tabs table w/ slug column)
│       └── routes/open-tabs.ts             (extend POST/PUT body validators + column write)
├── ui/
│   ├── shell/
│   │   ├── tabUtils.tsx                    (refactor two switches to lookup tables)
│   │   ├── AppPane.tsx                     (NEW — iframe wrapper)
│   │   └── SplitView.tsx                   (extend hasSkynetDragPayload + drop dispatch)
│   ├── features/pretty-conversations/
│   │   └── AppTile.tsx                     (add onClick + drag handlers)
│   └── AppShell.tsx                        (extend openTab options + persistTab body)
├── types/
│   └── ui-types.ts                         (extend TabType union + Tab.app field)
└── substrate/
    └── skills/app-development/templates/app-starter/
        └── svelte.config.js                (update D-14 comment)
```

### Pattern 1: Reverse-proxy route composition (mirrors `serve-route.ts`)

**What:** Chain auth → access check → CSRF check → target resolve → tunnel (or direct) → `getOrCreateProxyForTarget` → handler.

**When to use:** Every request under `/apps/:hostId/:slug/pane/*`.

**Example:**
```typescript
// Source: composed from src/backend/serve-url/serve-route.ts + phase 119 apps.ts patterns
router.all("/:hostId/:slug/pane/*", authenticateJWT, async (req, res, next) => {
  const { hostId: rawHostId, slug } = req.params;
  const userId = (req as AuthenticatedRequest).userId;

  // Validate — mirror phase 119 apps.ts:83-109 exactly
  if (!APP_SLUG_RE.test(slug)) return res.status(400).json({ error: "..." });
  const hostIdNum = Number(rawHostId);
  if (!Number.isInteger(hostIdNum) || hostIdNum <= 0) return res.status(400).json(...);

  // Resolve host + access gate
  const host = await resolveHostById(hostIdNum, userId);
  if (!host) return res.status(403).json({ error: "..." }); // info-leak-safe
  const allowed = await checkHostAccess(hostIdNum, userId, host.userId, "read");
  if (!allowed) return res.status(403).json({ error: "..." });

  // CSRF gate — the D-13 middleware. Runs BEFORE tunnel/proxy work.
  if (!appProxyCsrfCheck(req)) {
    return res.status(403).json({ error: "cross-origin state-changing request refused" });
  }

  // Target resolve (local vs remote)
  const port = await lookupAppPortFromRegistry(hostIdNum, slug);
  if (port === null) return res.status(404).json({ error: "app is not currently serving on a port" });

  const target: ServeTarget = { hostname: host.name, port, host };

  // Byte forwarding — reuse serve-url machinery verbatim
  let tunnelPort: number;
  if (isLocalHostId(hostIdNum)) {
    tunnelPort = port; // direct loopback bypass — no SSH tunnel needed
  } else {
    const instance = await tunnelCache.getOrCreate(target);
    tunnelPort = instance.tunnelPort;
  }
  const proxyMiddleware = getOrCreateAppPaneProxyForTarget(target, tunnelPort, hostIdNum, slug);
  proxyMiddleware(req, res, next);
});
```

### Pattern 2: Client-side dispatch table refactor (D-03 + D-04)

**What:** Replace `switch(tab.type)` with a `Record<TabType, Renderer>` lookup.

**When to use:** Both `tabIcon()` and `renderTabContent()` in `src/ui/shell/tabUtils.tsx`.

**Example:**
```typescript
// Source: refactor derived from src/ui/shell/tabUtils.tsx:98-110 + :339-405
const TAB_ICONS: Record<TabType, React.ElementType> = {
  dashboard: LayoutDashboard,
  terminal: Terminal,
  rdp: Monitor,
  vnc: Monitor,
  telnet: Terminal,
  app: AppWindow,
};

export function tabIcon(type: TabType) {
  const Icon = TAB_ICONS[type];
  return <Icon className="size-3.5" />;
}

// Renderer signature threads the same deps the current switch consumes.
type RendererDeps = {
  onOpenTab?: (...args: unknown[]) => void;
  onCloseTab?: (id: string) => void;
  isVisible: boolean;
  shouldAttach: boolean;
  onTmuxSessionChange?: (tabId: string, sessionName: string | null) => void;
  onTmuxSessionMissing?: (instanceId: string, sessionName: string) => void;
};

type Renderer = (tab: Tab, deps: RendererDeps) => React.ReactNode;

const renderGuacamoleTab: Renderer = (tab, { isVisible, onCloseTab }) => {
  const host = tab.host;
  if (!host) return <EmptyState icon={Monitor} messageKey="guacamole.noHostSelected" />;
  return (
    <Suspense fallback={<EmptyState icon={Monitor} messageKey="guacamole.noHostSelected" />}>
      <GuacamoleApp
        hostId={host.id}
        tabId={tab.id}
        protocol={tab.type as "rdp" | "vnc" | "telnet"}
        isVisible={isVisible}
        onClose={() => onCloseTab?.(tab.id)}
      />
    </Suspense>
  );
};

const RENDERERS: Record<TabType, Renderer> = {
  dashboard: () => <PrettyLandingCard />,
  terminal: renderTerminalTab, // extracted from the existing switch body
  rdp: renderGuacamoleTab,     // three entries pointing at the same helper
  vnc: renderGuacamoleTab,     // (replaces the fall-through pattern with
  telnet: renderGuacamoleTab,  // three explicit rows — D-04's cleanup)
  app: renderAppTab,           // NEW — mounts <AppPane hostId={} slug={} tabId={} isVisible={} />
};

export function renderTabContent(tab: Tab, ...args): React.ReactNode {
  const deps: RendererDeps = { /* ... unpack args ... */ };
  return RENDERERS[tab.type](tab, deps);
}
```

**Note on exhaustiveness:** TypeScript's `Record<TabType, Renderer>` gives compile-time exhaustiveness — if a new TabType is added and the map is missing an entry, `tsc` will surface it. Same guarantee the current switch provides via TS's exhaustive-check on discriminated unions.

### Pattern 3: Response body `<base>` injection via `responseInterceptor`

**What:** Use http-proxy-middleware's built-in `responseInterceptor` helper to inject a `<base>` tag into text/html responses.

**When to use:** The response transform hook of the pane proxy. Skips non-html responses (JSON, images, WebSocket upgrades, JS bundles) — those don't have HTML resolution semantics.

**Example:**
```typescript
// Source: adapted from http-proxy-middleware/dist/handlers/response-interceptor.d.ts
import { createProxyMiddleware, responseInterceptor } from "http-proxy-middleware";

const middleware = createProxyMiddleware({
  target: `http://127.0.0.1:${tunnelPort}`,
  changeOrigin: true,
  ws: true,
  selfHandleResponse: true, // REQUIRED for responseInterceptor
  pathRewrite: {
    [`^/apps/${hostIdNum}/${slug}/pane`]: "",  // strip mount prefix
  },
  on: {
    proxyReq: (proxyReq) => stripToAllowlist(proxyReq),
    proxyReqWs: (proxyReq) => {
      stripToAllowlist(proxyReq);
      proxyReq.setHeader("sec-websocket-extensions", ""); // RSV1 fix
    },
    proxyRes: responseInterceptor(async (buffer, proxyRes, req, res) => {
      const ct = String(proxyRes.headers["content-type"] ?? "");
      if (!ct.startsWith("text/html")) {
        return buffer; // pass through untouched — critical for binary/JS/JSON
      }
      const html = buffer.toString("utf8");
      const baseTag = `<base href="/apps/${hostIdNum}/${encodeURIComponent(slug)}/pane/">`;
      // Prefer <head> injection; fall back to prepend if no <head>.
      // Case-insensitive regex; only replace first match.
      const injected = html.match(/<head[^>]*>/i)
        ? html.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`)
        : `${baseTag}${html}`;
      return Buffer.from(injected, "utf8");
    }),
    error: (err, req, res) => { /* same interstitial pattern as proxy-factory.ts */ },
  },
});
```

**Critical caveats:**
1. `selfHandleResponse: true` MUST be set — without it, the interceptor never fires (documented in `response-interceptor.d.ts`).
2. `responseInterceptor` automatically decompresses gzip/br/zstd/deflate — do NOT pre-decompress.
3. Content-Length header will be stale after modification — `responseInterceptor` handles this automatically (it rewrites Content-Length or switches to chunked).
4. WebSocket upgrades bypass `proxyRes` — the response transform is HTTP-only. WS traffic is bytes-in-bytes-out.
5. **Per-slug proxy cache key** — `proxy-factory.ts`'s current `buildCacheKey` uses `${hostname}:${port}::${tunnelPort}`. For app-pane proxies, cache key MUST also include the slug (because `pathRewrite` is per-middleware and different slugs mean different rewrite rules). Do NOT reuse `getOrCreateProxyForTarget` verbatim — factor out a parallel `getOrCreateAppPaneProxyForTarget` that keys on `(hostId, slug, tunnelPort)`.

### Pattern 4: Drag payload MIME extension (SplitView)

**What:** Add `application/x-skynet-app-tile` as a fifth MIME type on the drop target.

**When to use:** `AppTile.tsx` emits it on `onDragStart`; `SplitView.tsx`'s `hasSkynetDragPayload` recognises it; the pane's `onDrop` dispatches on it.

**Example:**
```typescript
// AppTile.tsx (new onDragStart handler)
const onTileDragStart = useCallback(
  (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(
      "application/x-skynet-app-tile",
      JSON.stringify({
        hostId: app.hostId,   // string per wire protocol (fleet-status-types.ts:136)
        slug: app.slug,
        title: app.title,
      }),
    );
    // NOTE: do NOT set text/plain to a payload the row-drop handler might
    // parse as a tabId — Phase 64 explicitly closed the text/plain-only
    // fallback path (SplitView.tsx:596-608). Leaving text/plain unset is
    // fine; SplitView's hasSkynetDragPayload gate accepts the drag as long
    // as ONE skynet MIME is present.
    e.dataTransfer.effectAllowed = "copy";
  },
  [app.hostId, app.slug, app.title],
);

// SplitView.tsx: extend hasSkynetDragPayload
function hasSkynetDragPayload(dt: DataTransfer | null | undefined): boolean {
  return (
    (dt?.types.includes("application/x-skynet-badge") ?? false) ||
    (dt?.types.includes("application/x-skynet-row") ?? false) ||
    (dt?.types.includes("application/x-skynet-app-tile") ?? false)  // NEW
  );
}

// SplitView.tsx onDrop handler: add new branch for app-tile MIME
// after the existing badge / row branches. NO center-drop replace semantics
// on center — an app-tile is a fresh open, always. For edge drops, dispatch
// to a new onDropAppTileInTree callback which AppShell wires to a fresh
// openTab({type: "app", app: {hostId, slug}, ...}) + insertLeafAtEdge.
```

### Anti-Patterns to Avoid

- **Forking `proxy-factory.ts`:** Instead of copying its RSV1 fix + allowlist logic into a new file, reuse the module and either extend its factory to accept per-mount options OR factor out shared helpers (`stripToAllowlist`, cache-key format) and build a sibling factory `app-pane-proxy-factory.ts` that composes them. Copying = drift = the R&D Gotcha 2 bug returns.
- **Setting `application/x-skynet-app-tile` and ALSO `text/plain` with `${hostId}:${slug}` as the payload body:** Phase 64 closed the text/plain fallback deliberately (`SplitView.tsx:596-608`); adding a new source that emits text/plain reopens that gap and creates a hole for stray browser drags.
- **Using `pathRewrite` on the shared `getOrCreateProxyForTarget`:** The factory caches on `(hostname, port, tunnelPort)`. If two apps on the same box (same tunnelPort) are wired to the same cached middleware but different pathRewrite rules, one app's requests will strip the wrong prefix. Build a parallel factory that keys on `(hostname, port, tunnelPort, mountSlug)`.
- **Injecting `<base>` into non-HTML responses:** JSON responses that happen to contain a substring matching `<head>` would get mangled. The Content-Type check is load-bearing.
- **Rendering an `<AppPane>` iframe with a `sandbox` attribute:** Unless there's a specific attack surface to close, sandboxing breaks the app's own JavaScript, forms, and same-origin cookie access. The whole design is same-origin-via-proxy; sandbox would defeat it. Leave `sandbox` unset (default = fully permissive).
- **Skipping the CSRF check for OPTIONS preflight:** OPTIONS is safe (per RFC 9110 §9.2.1 idempotent + safe), and SvelteKit's own default CSRF check ignores OPTIONS. Match that.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP body transformation | Manual `res.write` interception + stream reassembly | `http-proxy-middleware`'s `responseInterceptor` | Auto-decompresses gzip/br/zstd; auto-rewrites Content-Length; battle-tested. |
| WebSocket upgrade tunneling | Custom `net.Socket` piping | http-proxy-middleware's `ws: true` (via factory) | R&D Gotcha 1 (RSV1 fix) is baked in and MUST NOT be circumvented. |
| SSH tunnel to app's home box | New `ssh2.Client` per request | `tunnelCache.getOrCreate` | Per-target cache + connection pool cap (R&D Gotcha 3). |
| CSRF Origin check for state-changing methods | Full CSRF token machinery | Compare `req.headers.origin` to Skynet's own origin string | The shape file's Option B is explicit — Origin check is sufficient because the proxy has full request visibility. No token issuance / rotation / storage needed. |
| Error interstitial for tunnel failures | Custom "app is down" page | `serve-url/interstitial.ts` + `error-classifier.ts` | Production-hardened; D-17 locks this. |
| Host-visibility gate | New per-app permission model | `checkHostAccess(hostId, userId, hostUserId, 'read')` | Single source of truth across shape 2 + shape 4. |
| Tab dispatch exhaustiveness | Manual runtime checks | TypeScript's `Record<TabType, T>` on a union | Compile-time — the tsc pass surfaces missing entries. |
| Icon glyph for the "app" TabType | New SVG | `AppWindow` from `lucide-react` (already imported in Phase 119's `AppTile.tsx`) | Consistency + zero new deps. |

**Key insight:** Every piece of Phase 120's backend is a composition of Phase 103's serve-URL infrastructure with a different auth surface + a different mount path + a new response body transform + a new CSRF check. The shape file's "reuse existing patterns" line is not aspirational — the code literally already exists and Phase 120 is 90% wiring.

## Runtime State Inventory

Phase 120 is greenfield in the runtime-state sense (no rename/refactor of existing identifiers). One category is relevant:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `user_open_tabs` SQL table has columns `id, userId, tabType, hostId, label, tabOrder, backendSessionId, targetTmuxSession` — no place to store the `slug` half of the app-tab tuple (see `src/backend/database/db/schema.ts:820-837`). | **SCHEMA MIGRATION REQUIRED.** Add `appSlug TEXT NULL` column via `addColumnIfNotExists` (pattern already used in `db/index.ts:1071` for prior tab-column additions). Extend POST/PUT bodies + row-write in `routes/open-tabs.ts` to read/write it. Optional field — non-app tabs leave it null. |
| Live service config | None — no external service (Datadog / n8n / Tailscale ACL) references anything Phase 120 changes. | none |
| OS-registered state | None — the pane's serve stays inside the Skynet Docker container; no new systemd unit, no launchd plist, no scheduled task. | none |
| Secrets/env vars | Reuses `process.env.SKYNET_COOKIE_DOMAIN` (already required by `serve-url/serve-route.ts` + `proxy-factory.ts` at module load). No new env var. | none |
| Build artifacts | None — no compiled binaries, no build outputs that carry the phase's identifier. | none |

**Nothing found in category:** stated explicitly above.

**On URL-fragment persistence:** `src/ui/lib/tab-url.ts` `TabSpec` union hard-codes protocols `"tmux" | "terminal" | "rdp" | "vnc" | "telnet" | "relay"`. To carry app tabs in the URL fragment (which is how workspace-share and Chrome-tab-restore work), add a seventh variant `{ protocol: "app"; hostId: string; slug: string }` and extend `parseTabParam` + `specForTab` + `encodeSplitTreeToUrl` accordingly. Miss this and app tabs would silently disappear from restored workspaces.

**Persistence expiration:** `user_open_tabs.updatedAt > cutoff` at 30 minutes (`open-tabs.ts:26` — `TAB_TTL_MS = 30 * 60 * 1000`). App tabs expire on the same TTL as other tabs — no special treatment needed.

## Common Pitfalls

### Pitfall 1: Wire-protocol type-mirror gap (repeat of Phase 117 Pitfall 1)

**What goes wrong:** The `AppState` type in `src/ui/api/fleet-status-types.ts` mirrors `AppStateSchema` in `src/backend/fleet-status/wire-protocol.ts`. Phase 120 doesn't touch either of those — `AppState` is READ-ONLY from Phase 120's perspective. BUT: Phase 120 extends `Tab` with `app?: { hostId: number; slug: string }`, and `Tab` is a client-only type. If Phase 120 also extends the persisted-tab schema (SQL + POST/PUT bodies), the field names + types must match on both sides.

**Why it happens:** Two definitions of "the tuple that identifies an app leaf" (client type + SQL column) drift without a compile-time link.

**How to avoid:** When adding `appSlug TEXT NULL` to `user_open_tabs` + extending POST body → also extend the deserialisation in `AppShell.tsx:1517-1552` (the `restoredTabs.push({...})` block) so `saved.appSlug` maps to `Tab.app = { hostId: saved.hostId, slug: saved.appSlug }`. Same for URL-fragment restore (`tab-url.ts`).

**Warning signs:** Restored workspace shows app tabs with `undefined` slug (iframe URL becomes `/apps/5/undefined/pane/`); backend proxy returns 400 on the slug validator gate.

### Pitfall 2: Per-slug proxy cache collision

**What goes wrong:** `proxy-factory.ts`'s cache keys on `(hostname:port::tunnelPort)`. Two apps on the same box (host t1000, ports 3001 and 3002) get different tunnelPorts, so the cache key differs correctly. BUT — when different slugs on the SAME (hostname, port, tunnelPort) get the SAME cached middleware, the middleware's `pathRewrite` is fixed at creation time. If a middleware was built with `pathRewrite: {"^/apps/5/todo/pane": ""}` and Skynet reuses it for `/apps/5/timer/pane/...`, the strip fails.

**Why it happens:** Two apps on one host that happen to share a listening port (impossible in practice — but the cache key structure doesn't preclude it).

**How to avoid:** For the app-pane proxy specifically, build a sibling factory `getOrCreateAppPaneProxyForTarget(target, tunnelPort, hostId, slug)` that keys on `(hostname:port::tunnelPort::hostId:slug)`. Each (hostId, slug) pair gets its own middleware instance with its own baked-in pathRewrite + base-tag responseInterceptor. Cost: one middleware per unique app the user has ever opened. At realistic fleet scale (~10 apps × ~5 users) this is bounded and acceptable.

**Warning signs:** Test failures where two different app slugs on the same box mysteriously return 404 for their asset requests (because they're being rewritten wrongly).

### Pitfall 3: WebSocket upgrade bypasses `proxyRes` — no `<base>` needed there

**What goes wrong:** Developer notices the base-tag injection isn't firing for WS upgrades and tries to "fix" it.

**Why it happens:** WebSocket upgrades don't have an HTTP response body — the upgrade completes with a `101 Switching Protocols` and then frames flow bidirectionally. `responseInterceptor` (which sits on `proxyRes`) is HTTP-only by design.

**How to avoid:** Confirm in test that the base-tag injector's Content-Type check skips upgrades cleanly. WS traffic does NOT need path rewriting because WS URLs are constructed by the app's own JS from `window.location` — that's already same-origin-Skynet, so `new WebSocket("/api/ws")` resolves against `/apps/:hostId/:slug/pane/api/ws` correctly under the `<base>` regime.

**Warning signs:** WebSocket handshake times out or 400s from upstream; check the WS-upgrade path is hitting `proxyReqWs` (with RSV1 fix) and NOT trying to run responseInterceptor.

### Pitfall 4: SvelteKit `csrf.checkOrigin: false` semantics

**What goes wrong:** The starter template has `csrf: { checkOrigin: false }`. Developer removes this line "because the proxy check is now the enforcement site" — but SvelteKit's `checkOrigin: false` only bypasses the check for cross-origin POST/PUT/PATCH/DELETE where Origin doesn't match the app's own origin. When a browser POSTs from `https://skynet.example.com/apps/5/todo/pane/foo`, the request arrives at the SvelteKit app on `127.0.0.1:PORT` with `Origin: https://skynet.example.com`. SvelteKit's default `checkOrigin: true` refuses this (Origin doesn't match `127.0.0.1:PORT`). Removing the disable line — even though the proxy enforces its own check — breaks the app.

**Why it happens:** Assuming "the proxy check is now the enforcement site" means "no other check need exist."

**How to avoid:** D-14 explicitly says "the actual CSRF-disable-line stays disabled." Only the COMMENT changes. Verify with a test that a starter-template app processed by the proxy accepts a form POST when the pane's iframe submits it.

**Warning signs:** UAT step "verify a form POST inside the app succeeds" fails with a 403 or SvelteKit's "cross-site POST form submissions are forbidden" error.

### Pitfall 5: Iframe CSP + referrer-policy interactions with authentication

**What goes wrong:** Skynet's index HTML sets a Content-Security-Policy header. If CSP contains `frame-src 'self'` or narrower, the iframe loads (same-origin-satisfied). But if the app's HTML output sets its own restrictive CSP that names a specific host, the pane may fail to render assets inside the iframe.

**Why it happens:** The proxy is transparent to the app's outbound headers by default (`HEADER_ALLOWLIST` governs INBOUND to upstream, not OUTBOUND to browser). The app's CSP flows through untouched.

**How to avoid:** Verify Skynet's frontend CSP allows `frame-src 'self'` (or wider). Do NOT filter the app's outbound CSP — the shape file's "pane is transparent to the app" line forbids specialising on the app's headers. If a specific app breaks under this, that's an app-side issue for the shape 1 template to address.

**Warning signs:** Iframe renders blank; browser console shows "Refused to display" or CSP violation messages.

### Pitfall 6: Path-prefix double-rewrite when app itself does mount-aware routing

**What goes wrong:** An app whose framework CAN be configured for a base path (e.g., a hand-written SvelteKit app that set `paths.base = "/apps/5/todo/pane"` explicitly at build time) receives requests where the pane strips its own prefix, then the app tries to strip its own configured `paths.base` and fails.

**Why it happens:** D-11's out-of-scope decision — the starter template doesn't configure `paths.base`. But a future app might.

**How to avoid:** Document in the starter template's README that `paths.base` MUST NOT be set. The pane owns prefix stripping; apps see themselves at root.

**Warning signs:** Requests to `/apps/5/todo/pane/api/list` return 404 from the app because the app's router expects `/apps/5/todo/pane/api/list` at root (but the proxy stripped it).

### Pitfall 7: The `--pv-hue` CSS-inheritance ancestor-vs-sibling trap (Phase 117 HIGH-2 reference)

**Not directly applicable to Phase 120** (no new sidebar CSS) — but a good reminder: **iframes have their own CSS document.** The pane's design tokens (`--pv-*`, `--color-*`) do NOT propagate into the iframe. If the leaf title bar (D-19) needs a specific colour, it must inherit from `.pv-*` tokens on the Skynet side. The iframe content is entirely the app's business per D-05.

## Code Examples

### Extending TabType (D-01, D-02)

```typescript
// src/types/ui-types.ts
export type TabType =
  | "dashboard"
  | "terminal"
  | "rdp"
  | "vnc"
  | "telnet"
  | "app";  // NEW

export type Tab = {
  // ... existing fields ...
  // NEW — required when type === "app"; absent otherwise.
  app?: { hostId: number; slug: string };
};

// Narrowing predicate — colocate here per D-05 discretion. Alternatively
// place in tabUtils.tsx (Claude's discretion per CONTEXT.md).
export function isAppTab(tab: Tab): tab is Tab & { app: { hostId: number; slug: string } } {
  return tab.type === "app" && tab.app !== undefined;
}
```

### CSRF-check middleware (D-13)

```typescript
// src/backend/apps/app-proxy-csrf-check.ts
// Source: adapted from shape file § "Shape" para 4 + Option B pick
import type { Request } from "express";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Returns true if the request should be forwarded to the app; false if it
 * should be refused (403). Callers write the 403 response themselves so
 * they can shape the body — this helper is pure.
 *
 * D-13 semantics:
 *  - GET/HEAD/OPTIONS: pass unconditionally.
 *  - POST/PUT/PATCH/DELETE:
 *      - Origin header exactly matches Skynet's own primary origin → pass.
 *      - Origin missing → refuse (anomalous for a state-changing request).
 *      - Origin present but mismatched → refuse.
 */
export function appProxyCsrfCheck(req: Request, primaryOrigin: string): boolean {
  const method = String(req.method ?? "").toUpperCase();
  if (!STATE_CHANGING_METHODS.has(method)) return true;

  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.length === 0) return false;

  return origin === primaryOrigin;
}

// primaryOrigin is derived at module load from SKYNET_COOKIE_DOMAIN +
// scheme + optional port. Failing-loud if the env is unset matches
// serve-route.ts's discipline.
```

### The D-14 comment update (starter template)

```javascript
// substrate/skills/app-development/templates/app-starter/svelte.config.js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: vitePreprocess(),
    kit: {
        adapter: adapter(),
        // Skynet's reverse-proxy at /apps/:hostId/:slug/pane/* enforces the
        // same-origin CSRF check at its boundary before forwarding requests
        // to this app — see src/backend/apps/app-proxy-csrf-check.ts. The
        // built-in SvelteKit Origin check stays disabled here because a
        // proxied POST arrives at 127.0.0.1:PORT with an Origin header
        // naming Skynet's own domain (not 127.0.0.1:PORT), which the
        // default check would refuse. Apps served directly (bypassing the
        // pane proxy — e.g. via the .serve. per-port URL for a fresh-tab
        // open) rely on the tailnet perimeter + Skynet's edge auth.
        csrf: {
            checkOrigin: false
        }
    }
};

export default config;
```

*Verbatim comment wording is Claude's discretion at plan-time per CONTEXT.md D-14 — the intent above (proxy is enforcement site; disable is not a shortcut) is the load-bearing content.*

### `<AppPane>` iframe wrapper (D-05)

```tsx
// src/ui/shell/AppPane.tsx (NEW)
export interface AppPaneProps {
  hostId: number;
  slug: string;
  tabId: string;
  isVisible: boolean;
}

export function AppPane({ hostId, slug, tabId, isVisible }: AppPaneProps): React.ReactElement {
  // Defensive encodeURIComponent — mirrors AppTile.tsx MEDIUM-1 fix pattern.
  const src = `/apps/${encodeURIComponent(hostId)}/${encodeURIComponent(slug)}/pane/`;

  // sandbox: UNSET (default fully-permissive). The app is same-origin,
  // fully authenticated, trusted at the pane level; sandboxing would break
  // its JavaScript and same-origin cookie access. RESEARCH.md § Anti-Patterns.
  //
  // referrerpolicy: no-referrer — the app doesn't need to know which
  // Skynet page opened it (matches D-20 "no signal to the app" — no
  // Referer bleed). Alternative: strict-origin, which sends only the
  // origin part; even that is more than the app should see.
  //
  // loading: eager — the pane is visible immediately on tab open; lazy
  // would delay first paint on a freshly-opened pane.
  return (
    <iframe
      src={src}
      title={`App ${slug}`}
      referrerPolicy="no-referrer"
      loading="eager"
      className="h-full w-full border-0"
      data-app-hostid={hostId}
      data-app-slug={slug}
      data-tab-id={tabId}
      // isVisible is honoured by React's visibility CSS one layer up
      // (matches how Terminal / GuacamoleApp integrate) — no need for
      // display:none here; the parent Pane already handles that.
    />
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fresh `createProxyMiddleware` per request | Per-target-cached factory (`proxy-factory.ts`) | Phase 103 (R&D Gotcha 2) | MUST be honoured; fresh-per-request causes intermittent WS RSV1 failures. |
| `permessage-deflate` WS compression allowed to negotiate | Forced-empty `sec-websocket-extensions` on WS upgrade | Phase 103 (R&D Gotcha 1) | WS compression is disabled through the proxy — acceptable for the tasting/prototype apps this campaign targets. |
| Header pass-through with denylist | Default-deny allowlist strip via `HEADER_ALLOWLIST` | Phase 103 (D-04) | Any new header (Cookie, Authorization, X-Skynet-*) that leaks upstream is a security regression. |
| `switch(tab.type)` five-arm dispatch | `Record<TabType, Renderer>` lookup table | Phase 120 (this) | Sixth+ addition is a one-line change; exhaustiveness preserved. |
| Client-side iframe as pane content | Same — but under Skynet's own origin via path proxy (not `.serve.` subdomain) | Phase 120 (this) | Sidesteps cookie-scope + cross-origin embedding restrictions. |

**Deprecated/outdated:**
- Text/plain-only drop payloads for row-source drags — closed by Phase 64 (`SplitView.tsx:596-608`). Do NOT reintroduce for app-tile drags.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The starter template will not introduce a `paths.base` config in Phase 120's scope. | D-11 resolution (Pitfall 6) | If a future app sets `paths.base`, requests would double-strip and 404 in the app's own router. Documented in README. |
| A2 | Skynet's frontend CSP allows `frame-src 'self'` (or wider). | Pitfall 5 | If Skynet CSP forbids `frame-src`, the iframe silently renders blank. VERIFY at plan time by grepping for `Content-Security-Policy` in `docker/nginx*.conf` or the Express `helmet` config. |
| A3 | The DB schema `user_open_tabs` MUST be extended with an `appSlug TEXT NULL` column to persist app-tab tuples across reload via the backend path. | Runtime State Inventory | Without this, app tabs restore only from URL fragment (which works), but the multi-tab-restore path via DB silently drops the slug. Verify by tracing the `restoredTabs.push({...})` block in AppShell.tsx:1540-1551 during planning. |
| A4 | The pane-target-resolver's isLocalHostId case doesn't need an SSH tunnel — a direct `http://127.0.0.1:port` target suffices. | D-10 resolution | If local-hostId apps need something the tunnel provides (e.g., namespace isolation inside a container), the direct-loopback path breaks. Verify Skynet's own Docker container can reach the host's 127.0.0.1 (it likely can't — see docker.internal). CANDIDATE OPEN QUESTION at plan time. |
| A5 | `getAppSnapshot()` from the fleet-status registry (used by Phase 119's HIGH-1 fix in `apps.ts:305-307`) is the correct source for port lookup at pane-mount time. | Pattern 1 example | If the sweep hasn't populated the registry yet (fresh boot), the pane's first request 404s. Same failure mode as the Phase 119 redirect route already handles. |
| A6 | Skynet's Docker container reverse-proxy path (Caddy) will forward `/apps/*` to Skynet's Express app rather than intercepting it. | D-08 mount | If Caddy has a `/apps/*` rule that intercepts, the pane request never reaches Express. Grep `docker/Caddyfile*` at plan time to confirm. |

## Open Questions (RESOLVED)

1. **Local-loopback reachability from inside Skynet's container.**
   - What we know: Phase 118's sweep script uses `isLocalHostId` to short-circuit SSH for local ops. Phase 119's icon endpoint uses the same predicate. Both those operations run OS-level probes (file reads, systemctl calls) — they don't need TCP reachability of the local port.
   - What's unclear: When Skynet's Express app runs INSIDE a Docker container and the "local" app runs on the HOST's 127.0.0.1:PORT, direct HTTP GET to `http://127.0.0.1:PORT` from inside the container FAILS (loopback is container-local). This is the classic Docker gotcha.
   - Recommendation: **Verify at plan time.** Options: (a) SSH tunnel is used unconditionally (simpler, one code path); (b) `pane-target-resolver.ts` uses `host.docker.internal` for local; (c) uses the box's tailscale IP. Recommendation: option (a) — always tunnel — is safest; the container-mutation serialization rule + tunnel-cache singleton already handle the load. If someone wants to optimize, that's a follow-up.
   - **RESOLVED:** `pane-target-resolver` uses SSH tunnel unconditionally. Local-loopback bypass is NOT implemented; the local Skynet host reaches its own apps via SSH tunnel just like any other host. One code path, safer. Plan 02's `pane-target-resolver.ts` never branches on `isLocalHostId` — it always resolves through the tunnel cache.

2. **Which specific comment wording lands in the starter template.**
   - What we know: D-14 says intent is "the check is off because the proxy enforces it" — verbatim wording is Claude's discretion.
   - What's unclear: Whether the comment references the specific file path (`src/backend/apps/app-proxy-csrf-check.ts`) or a doc URL or nothing.
   - Recommendation: reference the file path (Skynet-side implementation detail is stable). Include a one-liner about the fresh-tab affordance still working (relies on tailnet perimeter). See Code Examples § "D-14 comment update" for a working draft.
   - **RESOLVED:** Claude's discretion at execute time per D-14 explicit clause; Plan 08 Task 1 carries a working draft.

3. **Whether `<base>` in `<head>` interacts with SvelteKit's `%sveltekit.head%` template variable.**
   - What we know: `app-starter/src/app.html` uses `%sveltekit.head%` to inject SvelteKit's own head content. Injecting a `<base>` before this variable places it FIRST — which is correct per HTML spec (base must precede other resolutions).
   - What's unclear: SvelteKit may itself emit a `<base>` for its own router hydration under some configs. Two `<base>` tags → browser uses the first; check that ours wins.
   - Recommendation: at plan time, add a smoke test that renders the starter template's index HTML through the injector and asserts the `<base>` is present + not-preceded-by-another `<base>`.
   - **RESOLVED:** The `responseInterceptor` injects `<base>` as the FIRST child of `<head>` before any SvelteKit-emitted content; SvelteKit's `%sveltekit.head%` template variable emits AFTER our injection point, so our `<base>` wins. Plan 01 Task 1 test 5 explicitly asserts this ordering.

## Environment Availability

Phase 120 depends only on tooling already required by the rest of the codebase.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Skynet Express backend | ✓ | (existing) | — |
| npm / lockfile | http-proxy-middleware, express, ssh2 (all installed) | ✓ | 4.2.0 for http-proxy-middleware | — |
| SvelteKit (starter template) | Comment update in svelte.config.js | ✓ | ^2.8.0 declared | — |
| SSH access to app home box | tunnelCache (remote-host case) | ✓ | (existing ssh-connection-pool) | — |
| `SKYNET_COOKIE_DOMAIN` env var | app-proxy-csrf-check + serve-route | ✓ | (existing, required by proxy-factory at module load) | — |
| Docker Caddyfile forwards `/apps/*` to Express | D-08 mount reachability | ⚠ VERIFY | — | grep docker/Caddyfile* — assumption A6 |

**Missing dependencies with no fallback:** none (subject to A6 verification).

**Missing dependencies with fallback:** none.

## Validation Architecture

Skipped — `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`.

## Security Domain

`security_enforcement` is `true` in config (`.planning/config.json`); ASVS Level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `authenticateJWT` middleware (existing AuthManager). Runs first per route entry — mirror phase 119 apps.ts:83-86. |
| V3 Session Management | yes (indirectly) | The iframe inherits Skynet's session cookie because it's same-origin. No new session primitives. |
| V4 Access Control | yes | `checkHostAccess(hostId, userId, hostUserId, 'read')` — reused from phase 118 D-15 + phase 119 D-06. Info-leak invariant: 403 body identical for "not found" vs "not authorized" (matches phase 119 apps.ts:120-131). |
| V5 Input Validation | yes | `APP_SLUG_RE` regex + positive-integer hostId gate at route entry. Mirror phase 119 apps.ts:89-109 exactly. |
| V6 Cryptography | no | No new crypto primitives — HTTPS is Caddy's job; session-cookie signing is existing. |
| V7 Error Handling | yes | Interstitial + error-classifier reused from serve-url (T-40-05 info-leak invariant). NEVER include Error messages, stacks, or upstream body bytes in the response body. |
| V8 Data Protection | yes | HEADER_ALLOWLIST (D-04 default-deny) — Cookie / Authorization / X-Skynet-* headers NEVER reach upstream. Reused verbatim from proxy-factory.ts. |
| V13 API and Web Service | yes | New route follows Express/mount discipline; PATH_TRAVERSAL guarded by APP_SLUG_RE (rejects `../`, `..`, `/`). |

### Known Threat Patterns for the stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-site request forgery on state-changing POST from a malicious page | Spoofing / Tampering | Origin-header check at proxy boundary (D-13, this phase) |
| Session cookie exfiltration to app upstream | Information disclosure | `HEADER_ALLOWLIST` strips Cookie header from all outbound requests (proxy-factory.ts stripToAllowlist) |
| Path traversal via slug (`/apps/5/../../../etc/passwd/pane`) | Tampering | `APP_SLUG_RE` regex gate rejects any non-kebab-case slug BEFORE any file / SSH / proxy work. Express router `:slug` already refuses multi-segment matches; the regex is defence-in-depth. |
| Host-visibility bypass (user with no access to host H hits `/apps/H/…` directly) | Elevation of privilege | `checkHostAccess` at route entry — same function shape 2 uses at the wire boundary. Info-leak-safe 403 body. |
| Iframe embedding of Skynet's pane by a third-party page → clickjacking of the app inside | Tampering | Skynet's `X-Frame-Options: SAMEORIGIN` (or CSP `frame-ancestors 'self'`) on the pane route response — verify existing header discipline covers this. If not, add explicit header at the response layer. |
| WebSocket RSV1 permessage-deflate malfunction | Denial of service (WS breaks) | RSV1 fix baked into proxy-factory.ts (R&D Gotcha 1). MUST NOT be circumvented. |
| Response body `<base>` injection into non-HTML content (JSON that happens to contain "<head>") | Tampering (data corruption) | Content-Type prefix check ONLY on `text/html` responses. Buffer stream for JSON / images / JS bundles passes through untouched. |
| App-side XSS lands the attacker in the Skynet origin (session cookie exposed) | Elevation of privilege / Information disclosure | This IS the accepted trade-off of the same-origin design. Mitigated by: (a) apps are only reachable to authenticated users who already have host access to the box; (b) app authoring is agent-driven from within Skynet — malicious app authors would be a Skynet-user-authored attack surface; (c) starter template's SvelteKit auto-escapes text. The shape file's `## Philosophy` explicitly accepts this trade-off ("cookie carries, cross-origin embedding restrictions don't apply"). |
| Slopcheck / package-supply-chain | (n/a) | No new packages installed — the audit is trivially clean. |

## Project Constraints (from ~/fleet/roles/box-maintainer/box-maintainer.md and CONTEXT.md)

- **No worktrees** (the user 2026-07-31) — no `git worktree`. Standard clone + branch.
- **No message streaming** (the user 2026-08-29) — no skeleton tiles, no "connecting…" spinners, no incremental loading UX inside the pane. Iframe renders whatever the proxy hands it, when it hands it.
- **Container-mutation serialization** (the user 2026-09-12) — applies to the deploy motion at campaign close only. Not planning/executor.
- **Executor-scoped tests only** (the user 2026-09-07) — executor's green gate is `npx vitest related --run <touched files>` OR targeted paths under `src/ui/shell/`, `src/ui/features/pretty-conversations/`, `src/backend/apps/`. Full suite + Playwright smoke are the orchestrator's pre-deploy gate.
- **Deploy-boundary-at-push** (the user 2026-08-29) — commits stack locally on branch `feat/tab-title-from-tmux`. No `git push` / `docker build` / `docker compose up --force-recreate` until campaign-close greenlight.
- **DatabaseSaveTrigger discipline** (learned 2026-08-19) — not applicable (Phase 120's routes are stateless proxy; no DB writes beyond the tabs-persistence schema extension which flows through Drizzle's existing write path).
- **the user's Recommended Execution Path preference** — after design/proposal, name the vehicle (this phase is already inside `/gsd-plan-phase`, so this constraint is satisfied by the parent orchestrator).

## Sources

### Primary (HIGH confidence)
- CONTEXT.md at `.planning/phases/120-.../120-CONTEXT.md` — 23 D-locks + shape file references
- Shape file at `.planning/campaigns/first-class-apps/shape-app-pane-content-type.md` — locked ruleset
- Phase 118 CONTEXT.md — D-14 (three app frame types), D-15 (`checkHostAccess`), D-16 (snapshot-on-subscribe)
- Phase 119 CONTEXT.md — D-12 (context-menu "Open in new tab" route stays unchanged), D-13 (left-click no-op reserved), tile drag reservation
- `src/backend/serve-url/proxy-factory.ts` (269 lines with heavy JSDoc) — R&D Gotchas 1 + 2, HEADER_ALLOWLIST discipline, RSV1 fix, per-target cache
- `src/backend/serve-url/tunnel-cache.ts` (219 lines) — tunnel lifecycle, no-eviction invariant, transparent recovery
- `src/backend/serve-url/serve-route.ts` (147 lines) — composition pattern to mirror
- `src/backend/serve-url/subdomain-dispatch.ts` (418 lines) — auth-middleware invocation pattern
- `src/backend/serve-url/types.ts` — HEADER_ALLOWLIST + ServeTarget + ErrorClass
- `src/backend/database/routes/apps.ts` (341 lines) — phase 119 icon endpoint + phase 119 HIGH-1 redirect route (the pattern the pane route mirrors)
- `src/backend/fleet-status/app-frame-filter.ts` — checkHostAccess composition
- `src/backend/fleet-status/wire-protocol.ts` §640-720 — AppStateSchema (hostId + slug strings)
- `src/ui/shell/tabUtils.tsx` (405 lines) — the two switches being refactored + closure of deps
- `src/ui/shell/SplitView.tsx` §180-620 — `hasSkynetDragPayload`, drop dispatch, native-listener-not-React pattern (patch #514)
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` §940-1014 — drag-source template (application/x-skynet-row)
- `src/ui/features/pretty-conversations/AppTile.tsx` (257 lines) — phase 119 shipped tile; left-click no-op ready for wire-up
- `src/ui/AppShell.tsx` §1185-1263, §1505-1631, §1905-2000 — URL fragment sync, restoredTabs path, openTab factory
- `src/ui/lib/tab-url.ts` §45-97 — TabSpec union to extend
- `src/backend/database/db/schema.ts` §820-837 — user_open_tabs table (needs appSlug column)
- `src/backend/database/routes/open-tabs.ts` — persistence write path
- `substrate/skills/app-development/templates/app-starter/svelte.config.js` — 19-line file, D-14 target
- `node_modules/http-proxy-middleware/dist/handlers/response-interceptor.d.ts` — first-party response-body transform helper
- `node_modules/http-proxy-middleware/dist/types.d.ts` — Options / pathRewrite / OnProxyEvent surface
- `package.json` — http-proxy-middleware ^4.2.0

### Secondary (MEDIUM confidence)
- [SvelteKit Configuration Docs](https://svelte.dev/docs/kit/configuration) — `paths.base` and `paths.relative` semantics + `csrf.checkOrigin` behaviour (verified via WebFetch 2026-09-19)
- npm registry: `npm view http-proxy-middleware version` → 4.2.0 (verified 2026-09-19)
- npm registry: `npm view @sveltejs/kit version` → 2.70.3 (verified 2026-09-19)

### Tertiary (LOW confidence)
- Assumption A2 (Skynet CSP allows `frame-src 'self'`) — not verified in this research; plan-time verification recommended.
- Assumption A4 + Open Question 1 (Docker container loopback semantics) — flagged as candidate open question for plan-time verification.
- Assumption A6 (Caddy forwards `/apps/*` to Express) — not verified in this research; grep Caddyfile at plan time.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency already installed and battle-tested; version-verified against npm 2026-09-19.
- Architecture: HIGH — the phase composes existing Phase 103 machinery with clearly-locked D-decisions; the ONE open question (D-11) has a defensible resolution using a first-party feature of the installed library.
- Pitfalls: HIGH — the seven pitfalls are drawn from concrete file references (patch #64 text/plain closure, patch #514 native listener discipline, phase 117 wire-mirror bug, R&D Gotchas 1 + 2, phase 119 code-review MEDIUM-3 fix pass).
- Runtime state inventory: MEDIUM — the DB schema extension is unambiguous, but the URL-fragment TabSpec extension needs plan-time verification of the exact serialisation grammar.
- Security domain: HIGH — reuses Phase 103's V4/V5/V7/V8 controls verbatim; only two novel surfaces (CSRF check + iframe embedding) which the shape file explicitly designs.

**Research date:** 2026-09-19
**Valid until:** 2026-10-19 (30 days — stable underlying stack, no fast-moving deps in play).
