# Phase 120: First-class apps — apps as a content type in the pane (shape 4) - Pattern Map

**Mapped:** 2026-09-19
**Files analyzed:** 14 create/modify (10 new, 4 refactor/extend)
**Analogs found:** 14 / 14

Every file Phase 120 creates or modifies has a strong existing analog in the codebase — usually a Phase-103 (serve-URL) or Phase-119 (apps sidebar) sibling. The pattern here is "wire, don't invent": compose `proxy-factory.ts` + `tunnel-cache.ts` + `checkHostAccess` behind a new mount, refactor two switches to lookup tables, and wire two gestures on the shipped Phase-119 tile. The one net-new pattern (iframe as pane content) has a nearby analog in `GuacamoleApp` (already lazy-mounted via Suspense inside a tab renderer).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/apps/app-pane-router.ts` (NEW) | route + middleware chain | request-response + WS-upgrade | `src/backend/serve-url/serve-route.ts` + `src/backend/database/routes/apps.ts` | exact |
| `src/backend/apps/app-proxy-csrf-check.ts` (NEW) | middleware | request-response | `src/backend/serve-url/subdomain-dispatch.ts` (auth-gate composition) | role-match |
| `src/backend/apps/app-pane-proxy-factory.ts` (NEW) | factory (cached middleware) | streaming byte-forwarding | `src/backend/serve-url/proxy-factory.ts` | exact |
| `src/backend/apps/base-tag-injector.ts` (NEW) | utility | transform (HTML body) | `src/backend/serve-url/proxy-factory.ts` (proxyReq hooks) | role-match |
| `src/backend/apps/pane-target-resolver.ts` (NEW) | utility | request-response (local vs remote decision) | `src/backend/serve-url/serve-route.ts` §110-146 (tunnelCache-or-direct) | role-match |
| `src/backend/apps/tests/app-pane-router.integration.test.ts` (NEW) | test (integration) | request-response | `src/backend/serve-url/tests/serve-route.test.ts` | exact |
| `src/backend/apps/tests/app-proxy-csrf-check.test.ts` (NEW) | test (unit) | request-response | `src/backend/serve-url/tests/serve-route.test.ts` (fake-req/res) | exact |
| `src/backend/apps/tests/base-tag-injector.test.ts` (NEW) | test (unit) | transform | `src/backend/database/routes/apps.test.ts` (mock-first supertest scaffold) | role-match |
| `src/backend/database/database.ts` (MODIFY §2015-2025) | mount block | wiring | Phase 119 mount at line 2021 (`app.use("/apps", appsRoutes)`) | exact |
| `src/backend/database/db/schema.ts` + `db/index.ts` (MODIFY) | schema | stored data (column add) | Phase 90 `target_tmux_session` column add at `db/index.ts:1071` | exact |
| `src/backend/database/routes/open-tabs.ts` (MODIFY) | route | CRUD | Phase 90 `targetTmuxSession` field addition (existing body of same file) | exact |
| `src/types/ui-types.ts` (MODIFY §157-231) | type | (compile-time union extension) | Phase 90's `sessionKind` addition at `ui-types.ts:228-230` | exact |
| `src/ui/shell/AppPane.tsx` (NEW) | React component | iframe-mount | `GuacamoleApp` invocation in `tabUtils.tsx:394-403` (Suspense-wrapped mount inside a tab renderer) | role-match |
| `src/ui/shell/tabUtils.tsx` (REFACTOR §97-110 + §318-405) | React dispatch | rendering-lookup | current in-file switch bodies (in-place unify) | exact (self-refactor) |
| `src/ui/shell/SplitView.tsx` (MODIFY §187-192, §660-668) | React drop-target | drag-and-drop dispatch | Existing `hasSkynetDragPayload` gate + `application/x-skynet-row` branch | exact |
| `src/ui/features/pretty-conversations/AppTile.tsx` (MODIFY) | React component | drag-source + click | `PrettyConversationRow.tsx:950-1014` `onRowDragStart` | exact |
| `src/ui/AppShell.tsx` (MODIFY §1510-1552, §1905-2046, §2553-2604) | React state root | tab-open + restore | Existing `openTab` callback + `restoredTabs.push` block in same file (Phase 90 `sessionKind` add) | exact (self-analog) |
| `substrate/skills/app-development/templates/app-starter/svelte.config.js` (MODIFY comment L9-12) | template comment | (documentation) | The file itself (comment already exists, only wording changes) | exact |

## Pattern Assignments

### `src/backend/apps/app-pane-router.ts` (NEW — route + middleware chain, request-response + WS-upgrade)

**Analog A:** `src/backend/serve-url/serve-route.ts` (147 lines) — composition of tunnelCache + proxy factory + interstitial
**Analog B:** `src/backend/database/routes/apps.ts` (341 lines) — Phase 119's auth-gate + hostId/slug validators + `resolveHostById` + `checkHostAccess` scaffolding for a route mounted under `/apps/:hostId/:slug/…`

**Imports pattern** (from `apps.ts:64-77`):
```typescript
import express from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { AuthManager } from "../utils/auth-manager.js";
import {
  APP_SLUG_RE,
  isLocalHostId,
} from "../claude-session/identity-artifact-reader.js";
import { resolveHostById, checkHostAccess } from "../ssh/host-resolver.js";
import { sshLogger } from "../utils/logger.js";
import { getRegistry } from "../fleet-status/registry-holder.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
```

**Auth + slug/hostId validation pattern** (verbatim mirror of `apps.ts:83-131`):
```typescript
router.all(
  "/:hostId/:slug/pane/*",
  authenticateJWT,
  async (req: Request, res: Response, next) => {
    const userId = (req as AuthenticatedRequest).userId;

    // Slug validation — APP_SLUG_RE gate BEFORE any DB / SSH work.
    const slug = String(req.params.slug);
    if (!APP_SLUG_RE.test(slug)) {
      return res.status(400).json({ error: "slug must match [a-z0-9-]{1,64}" });
    }

    // hostId as positive integer.
    const hostIdNum = Number(req.params.hostId);
    if (!Number.isFinite(hostIdNum) || !Number.isInteger(hostIdNum) || hostIdNum <= 0) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }
    // …
  }
);
```

**Host resolution + access gate pattern** (verbatim from `apps.ts:114-131` extended with `checkHostAccess`):
```typescript
    const host = await resolveHostById(hostIdNum, userId);
    if (!host) {
      sshLogger.warn("app pane: host unresolvable / no access", {
        operation: "apps_pane_host_unresolvable",
        hostId: hostIdNum,
        slug,
      });
      // Info-leak-safe: same body for "unknown" and "not authorized"
      return res.status(403).json({ error: "app home box unreachable" });
    }
    // Phase 118 D-15 gate: canonical `checkHostAccess` (see host-resolver.ts:497).
    const allowed = await checkHostAccess(hostIdNum, userId, host.userId, "read");
    if (!allowed) {
      return res.status(403).json({ error: "app home box unreachable" });
    }
```

**Tunnel-cache + proxy composition** (verbatim from `serve-route.ts:111-146`):
```typescript
    let tunnelPort: number;
    try {
      const instance = await tunnelCache.getOrCreate(target);
      tunnelPort = instance.tunnelPort;
    } catch (err) {
      const errorClass = classifyTunnelError(err);
      sshLogger.warn("apps pane: tunnel-error", {
        operation: "apps_pane_proxy",
        target: `${target.hostname}:${target.port}`,
        errorClass,
      });
      const hostHeader = req.headers.host ?? "";
      const originalUrl = hostHeader
        ? `https://${hostHeader}${req.originalUrl}`
        : req.originalUrl;
      writeInterstitial(res, renderInterstitial(errorClass, target, originalUrl, PRIMARY_DOMAIN));
      return;
    }
    const proxyMiddleware = getOrCreateAppPaneProxyForTarget(target, tunnelPort, hostIdNum, slug);
    proxyMiddleware(req, res, next);
```

**Local-loopback bypass note** (per D-10 + Open Question 1): if `isLocalHostId(hostIdNum)` returns true, `pane-target-resolver.ts` may skip `tunnelCache` and target `http://127.0.0.1:${port}` directly. Verify plan-time whether Docker container loopback reaches the host (Assumption A4). Safest default: always tunnel.

---

### `src/backend/apps/app-proxy-csrf-check.ts` (NEW — middleware, request-response)

**Analog:** `src/backend/serve-url/serve-route.ts:50-61` — module-load env-check + pure-helper pattern. No existing CSRF-middleware analog; this is the shape file's Option B novel surface.

**Imports pattern**:
```typescript
import type { Request } from "express";
```

**Env-derived constant pattern** (verbatim from `serve-route.ts:52-61`):
```typescript
const PRIMARY_DOMAIN = (() => {
  const value = process.env.SKYNET_COOKIE_DOMAIN;
  if (!value) {
    throw new Error(
      "app-proxy-csrf-check: SKYNET_COOKIE_DOMAIN env var is required " +
        "(fail-loud per W4)",
    );
  }
  return value;
})();
```

**Core pattern** (from RESEARCH.md §Code Examples, adapted):
```typescript
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Returns true if the request should be forwarded; false if it should be
 * refused (403). Caller writes the 403 body so it can shape the payload.
 *
 * Semantics (D-13):
 *   - GET/HEAD/OPTIONS: pass unconditionally.
 *   - POST/PUT/PATCH/DELETE:
 *       - Origin exactly matches Skynet's primary origin → pass.
 *       - Origin missing → refuse.
 *       - Origin mismatch → refuse.
 */
export function appProxyCsrfCheck(req: Request, primaryOrigin: string): boolean {
  const method = String(req.method ?? "").toUpperCase();
  if (!STATE_CHANGING_METHODS.has(method)) return true;
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.length === 0) return false;
  return origin === primaryOrigin;
}
```

**Info-leak invariant** (same as `apps.ts:120-131`): 403 body identical across the "cross-origin" and "missing origin" failure modes. Never echo the received Origin back to the caller.

---

### `src/backend/apps/app-pane-proxy-factory.ts` (NEW — factory returning per-target-cached middleware, streaming byte-forwarding)

**Analog:** `src/backend/serve-url/proxy-factory.ts` (269 lines) — **VERBATIM REUSE PLUS** two additions per Pitfall 2 + Pattern 3. The extension is a SIBLING factory (not a fork) that keys on `(hostname, port, tunnelPort, hostId, slug)` and adds `selfHandleResponse: true` + a `responseInterceptor` for base-tag injection + a `pathRewrite` to strip the mount prefix.

**Imports pattern** (verbatim from `proxy-factory.ts:57-69`):
```typescript
import type * as http from "node:http";
import type { Request, Response } from "express";
import {
  createProxyMiddleware,
  responseInterceptor,
  type RequestHandler,
} from "http-proxy-middleware";
import { emitHeaderAudit } from "../serve-url/header-audit-sampler.js";
import { HEADER_ALLOWLIST } from "../serve-url/types.js";
import type { ServeTarget } from "../serve-url/types.js";
import { renderInterstitial, writeInterstitial } from "../serve-url/interstitial.js";
import { classifyTunnelError } from "../serve-url/error-classifier.js";
import { sshLogger } from "../utils/logger.js";
import { injectBaseTag } from "./base-tag-injector.js";
```

**Cache key + `stripToAllowlist` pattern** (verbatim from `proxy-factory.ts:127-160`, key extended with `hostId + slug` per Pitfall 2):
```typescript
const proxyCache = new Map<string, RequestHandler>();

function buildCacheKey(target: ServeTarget, tunnelPort: number, hostId: number, slug: string): string {
  return `${target.hostname}:${target.port}::${tunnelPort}::${hostId}:${slug}`;
}

const ALLOWLIST_SET = new Set<string>(HEADER_ALLOWLIST);

function stripToAllowlist(proxyReq: http.ClientRequest): void {
  for (const headerName of proxyReq.getHeaderNames()) {
    if (!ALLOWLIST_SET.has(headerName.toLowerCase())) {
      proxyReq.removeHeader(headerName);
    }
  }
}
```

**Core factory pattern** (structural mirror of `proxy-factory.ts:190-269`, with `selfHandleResponse` + `pathRewrite` + `responseInterceptor` additions):
```typescript
export function getOrCreateAppPaneProxyForTarget(
  target: ServeTarget,
  tunnelPort: number,
  hostId: number,
  slug: string,
): RequestHandler {
  const cacheKey = buildCacheKey(target, tunnelPort, hostId, slug);
  const cached = proxyCache.get(cacheKey);
  if (cached) return cached;

  const middleware = createProxyMiddleware({
    target: `http://127.0.0.1:${tunnelPort}`,
    changeOrigin: true,
    ws: true,
    selfHandleResponse: true, // REQUIRED for responseInterceptor (RESEARCH.md Pitfall 3)
    pathRewrite: {
      [`^/apps/${hostId}/${slug}/pane`]: "",  // strip mount prefix — apps see themselves at root
    },
    on: {
      proxyReq: (proxyReq) => {
        stripToAllowlist(proxyReq);
        emitHeaderAudit(target, "req", proxyReq);
      },
      proxyReqWs: (proxyReq) => {
        stripToAllowlist(proxyReq);
        // R&D GOTCHA 1: force-set — MUST NOT circumvent.
        proxyReq.setHeader("sec-websocket-extensions", "");
        emitHeaderAudit(target, "ws", proxyReq);
      },
      proxyRes: responseInterceptor(async (buffer, proxyRes, _req, _res) => {
        const ct = String(proxyRes.headers["content-type"] ?? "");
        if (!ct.startsWith("text/html")) return buffer; // pass-through for JSON/JS/images/binaries
        return injectBaseTag(buffer, hostId, slug);
      }),
      error: (err, req, res) => {
        // Verbatim from proxy-factory.ts:236-263.
        const errorClass = classifyTunnelError(err);
        const e = (err ?? {}) as { code?: string; name?: string; level?: string };
        sshLogger.warn("apps pane proxy: proxy-time-error", {
          operation: "apps_pane_proxy",
          target: `${target.hostname}:${target.port}`,
          errorClass,
          errCode: typeof e.code === "string" ? e.code : "",
          errName: typeof e.name === "string" ? e.name : "",
          errLevel: typeof e.level === "string" ? e.level : "",
        });
        const expressRes = res as Response;
        if (!expressRes || (expressRes as unknown as { writableEnded?: boolean }).writableEnded) return;
        const expressReq = req as Request;
        const hostHeader = expressReq.headers.host ?? "";
        const originalUrl = hostHeader
          ? `https://${hostHeader}${expressReq.originalUrl ?? ""}`
          : (expressReq.originalUrl ?? "");
        writeInterstitial(expressRes, renderInterstitial(errorClass, target, originalUrl, PRIMARY_DOMAIN));
      },
    },
  });

  proxyCache.set(cacheKey, middleware);
  return middleware;
}
```

**Critical MUST NOT** (verbatim from `proxy-factory.ts:37-40, L43-51` — inheritable to the sibling factory):
- MUST NOT re-implement RSV1 fix — reuse the exact `proxyReq.setHeader("sec-websocket-extensions", "")` line.
- MUST NOT bypass `stripToAllowlist` on either hook — the D-04 default-deny cutoff is load-bearing.
- MUST NOT reuse `getOrCreateProxyForTarget` verbatim (Pitfall 2 — pathRewrite fixed at construction, cache key wouldn't disambiguate slugs).

---

### `src/backend/apps/base-tag-injector.ts` (NEW — utility, transform)

**Analog:** No existing pure-utility analog in the codebase. Pattern derived from `http-proxy-middleware`'s `responseInterceptor` docs (RESEARCH.md Pattern 3).

**Core pattern** (from RESEARCH.md §Pattern 3, extracted to a testable helper):
```typescript
export async function injectBaseTag(buffer: Buffer, hostId: number, slug: string): Promise<Buffer> {
  const html = buffer.toString("utf8");
  const baseTag = `<base href="/apps/${hostId}/${encodeURIComponent(slug)}/pane/">`;
  // Case-insensitive; replace FIRST <head> only. Fallback: prepend if no <head>.
  const injected = html.match(/<head[^>]*>/i)
    ? html.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`)
    : `${baseTag}${html}`;
  return Buffer.from(injected, "utf8");
}
```

**Load-bearing caveats** (RESEARCH.md Pitfall 3 + Pattern 3 caveats):
- Content-Type prefix check is done at the CALLER (`app-pane-proxy-factory.ts`'s `responseInterceptor`), not here — this helper is unconditional-transform.
- `responseInterceptor` automatically decompresses gzip/br/zstd/deflate — this helper receives ALREADY-decompressed bytes.
- Content-Length rewrite is handled by `responseInterceptor` itself — no manual header edits needed here.

---

### `src/backend/apps/pane-target-resolver.ts` (NEW — utility, resolves target)

**Analog:** `src/backend/serve-url/serve-route.ts` (composition sketch — deciding local-loopback vs SSH-tunnel) + Phase 119's `apps.ts:111` `isLocalHostId` gate.

**Signature + composition** (composed):
```typescript
import type { Host } from "../../types/index.js";
import { isLocalHostId } from "../claude-session/identity-artifact-reader.js";
import { tunnelCache } from "../serve-url/tunnel-cache.js";
import type { ServeTarget } from "../serve-url/types.js";

export interface ResolvedTarget {
  target: ServeTarget;
  tunnelPort: number;  // The port the proxy factory targets — either the SSH tunnel port OR the direct upstream port.
  usedTunnel: boolean;
}

export async function resolvePaneTarget(hostId: number, host: Host, port: number): Promise<ResolvedTarget> {
  const target: ServeTarget = { hostname: host.name, port, host };
  if (isLocalHostId(hostId)) {
    // Direct-loopback bypass — no SSH tunnel needed (Open Question 1: verify Docker reachability).
    return { target, tunnelPort: port, usedTunnel: false };
  }
  const instance = await tunnelCache.getOrCreate(target);
  return { target, tunnelPort: instance.tunnelPort, usedTunnel: true };
}
```

**Planner discretion** (CONTEXT.md D-10): may inline into `app-pane-router.ts` if lightweight enough. Keeping it separate wins test isolation (per RESEARCH.md project structure).

---

### `src/backend/database/database.ts` (MODIFY — router mount)

**Analog:** Line 2021, existing Phase 119 mount.

**Pattern** (add after line 2021):
```typescript
// Line 2021 (existing):
app.use("/apps", appsRoutes);
// Phase 120: mount the pane proxy under the same prefix. Ordering: pane router
// must NOT overshadow apps.ts's /:hostId/:slug/icon or /:hostId/:slug — the
// pane's `/:hostId/:slug/pane/*` suffix is distinct so any express mount order
// works, but consistent ordering (append) matches Phase 119's convention.
app.use("/apps", appPaneRouter);
```

**Mount discipline** (RESEARCH.md Assumption A6): verify `docker/Caddyfile*` forwards `/apps/*` to Express (not intercepted by Caddy). Grep at plan time.

---

### `src/backend/database/db/schema.ts` + `db/index.ts` (MODIFY — SQL schema extension)

**Analog:** Phase 90 `target_tmux_session` column addition, still visible at both files.
- Drizzle mirror: `schema.ts:820-837` `userOpenTabs` table.
- Migration: `db/index.ts:1071` `addColumnIfNotExists("user_open_tabs", "target_tmux_session", "TEXT");`

**Pattern for `schema.ts`** (mirror the `targetTmuxSession` addition at line 830):
```typescript
// schema.ts ~line 830-831 (add after targetTmuxSession):
  targetTmuxSession: text("target_tmux_session"),
  // Phase 120 D-16 — the second half of the (hostId, slug) tuple that
  // identifies an app leaf. Null for non-app tab types. Nullable maintains
  // backward-compat with pre-Phase-120 persisted rows.
  appSlug: text("app_slug"),
```

**Pattern for `db/index.ts`** (mirror line 1071):
```typescript
// db/index.ts ~line 1071-1072:
  addColumnIfNotExists("user_open_tabs", "target_tmux_session", "TEXT");
  // Phase 120 — app-tab tuple's slug half. Idempotent per addColumnIfNotExists's
  // SELECT-probe-then-ALTER shape.
  addColumnIfNotExists("user_open_tabs", "app_slug", "TEXT");
```

---

### `src/backend/database/routes/open-tabs.ts` (MODIFY — CRUD body validators)

**Analog:** The same file's existing `targetTmuxSession` field (Phase 90 addition) at lines 89-165 and 187-230.

**POST body pattern** (extend the type at line 96-104 + write at line 132/149):
```typescript
  const {
    id,
    tabType,
    hostId,
    label,
    tabOrder,
    backendSessionId,
    targetTmuxSession,
    appSlug, // NEW — Phase 120 D-16
  } = req.body as {
    id: string;
    tabType: string;
    hostId?: number | null;
    label: string;
    tabOrder: number;
    backendSessionId?: string | null;
    targetTmuxSession?: string | null;
    appSlug?: string | null;
  };
  // …
  db.insert(userOpenTabs).values({
    // … existing fields …
    targetTmuxSession: targetTmuxSession ?? null,
    appSlug: appSlug ?? null, // NEW
    updatedAt: now,
  }).run();
```

Extend PUT similarly at lines 189-220 (bulk-replace).

**Backward-compat rule** (matches `targetTmuxSession` shape — nullable, optional in the body, `null` on legacy rows).

---

### `src/types/ui-types.ts` (MODIFY §157-231 — union + Tab shape extension)

**Analog:** Phase 90's `sessionKind` addition at lines 228-230 (the exact pattern of "optional field on Tab with rich JSDoc explaining backward-compat rule").

**TabType extension pattern** (line 157-162):
```typescript
export type TabType =
  | "dashboard"
  | "terminal"
  | "rdp"
  | "vnc"
  | "telnet"
  | "app";  // NEW — Phase 120 D-01
```

**Tab shape extension pattern** (mirror Phase 90's shape at line 209-230):
```typescript
  // ─── Phase 120 D-02 — app-leaf tuple ─────────────────────────────────────
  //
  // Present ONLY when `type === "app"`. The (hostId, slug) tuple identifies
  // WHICH app the leaf holds — required because the same short slug can name
  // different apps on different boxes.
  //
  // Optional at the type level (matches sessionKind's backward-compat rule)
  // so pre-Phase-120 persisted tab records without the field continue to
  // parse. Consumers narrow via the `isAppTab` predicate (below or in
  // tabUtils.tsx — Claude discretion per CONTEXT.md).
  app?: { hostId: number; slug: string };
```

**Narrowing predicate** (RESEARCH.md § Code Examples — Claude discretion for placement):
```typescript
export function isAppTab(tab: Tab): tab is Tab & { app: { hostId: number; slug: string } } {
  return tab.type === "app" && tab.app !== undefined;
}
```

---

### `src/ui/shell/AppPane.tsx` (NEW — React component, iframe-mount)

**Analog:** `tabUtils.tsx:394-403` — the Suspense-wrapped `GuacamoleApp` mount inside `renderTabContent`. It's the closest existing pattern for "leaf-scoped mount that receives `hostId`/`tabId`/`isVisible`."

**Existing GuacamoleApp mount** (from `tabUtils.tsx:394-403`):
```typescript
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
```

**AppPane pattern** (from RESEARCH.md § Code Examples, D-05):
```tsx
export interface AppPaneProps {
  hostId: number;
  slug: string;
  tabId: string;
  isVisible: boolean;
}

export function AppPane({ hostId, slug, tabId, isVisible }: AppPaneProps): React.ReactElement {
  // Defensive encodeURIComponent — mirrors AppTile.tsx MEDIUM-1 fix.
  const src = `/apps/${encodeURIComponent(hostId)}/${encodeURIComponent(slug)}/pane/`;
  return (
    <iframe
      src={src}
      title={`App ${slug}`}
      referrerPolicy="no-referrer"    // D-20 — pane doesn't leak "which Skynet page opened this"
      loading="eager"                  // pane is visible immediately on tab open
      className="h-full w-full border-0"
      data-app-hostid={hostId}
      data-app-slug={slug}
      data-tab-id={tabId}
    />
  );
}
```

**Iframe attribute discipline** (RESEARCH.md § Anti-Patterns):
- `sandbox`: UNSET. The app is same-origin + fully authenticated — sandboxing would break its own JavaScript, forms, and same-origin cookie access.
- `referrerPolicy`: `no-referrer` (matches D-20 "no signal to the app").
- `loading`: `eager` (pane is visible immediately; lazy would delay first paint).
- No CSS token propagation into the iframe — the iframe is a separate document; app-side styling is app's concern (RESEARCH.md Pitfall 7 note).

---

### `src/ui/shell/tabUtils.tsx` (REFACTOR §97-110 + §318-405 — dispatch table)

**Analog:** The file's own existing switch bodies (self-refactor). Behavior is byte-equivalent for existing kinds; snapshot tests are the green gate.

**`tabIcon` refactor pattern** (D-03; replace lines 97-110):
```typescript
import { AppWindow } from "lucide-react"; // NEW — already imported by AppTile.tsx L?
// ↑ Add to the existing lucide-react import block at line 3-8.

const TAB_ICONS: Record<TabType, React.ElementType> = {
  dashboard: LayoutDashboard,
  terminal: Terminal,
  rdp: Monitor,
  vnc: Monitor,
  telnet: Terminal,
  app: AppWindow,           // NEW — Phase 120 D-03
};

export function tabIcon(type: TabType) {
  const Icon = TAB_ICONS[type];
  return <Icon className="size-3.5" />;
}
```

**`renderTabContent` refactor pattern** (D-04; replace lines 318-405):
Extract each case body to a `Renderer` function, then dispatch via `Record<TabType, Renderer>`:
```typescript
type RendererDeps = {
  onOpenSingletonTab?: (type: TabType) => void;
  onOpenTab?: /* existing signature */;
  onCloseTab?: (id: string) => void;
  isVisible: boolean;
  shouldAttach: boolean;
  onTmuxSessionChange?: (tabId: string, sessionName: string | null) => void;
  onTmuxSessionMissing?: (instanceId: string, sessionName: string) => void;
};
type Renderer = (tab: Tab, deps: RendererDeps) => React.ReactNode;

const renderDashboard: Renderer = () => <PrettyLandingCard />;

const renderTerminalTab: Renderer = (tab, deps) => {
  const host = tab.host;
  if (!host && tab.sessionKind !== "relay-room") {
    return <EmptyState icon={TerminalSquare} messageKey="terminal.noHostSelected" />;
  }
  return (
    <TerminalOrIdentitySessionPane
      tab={tab}
      host={host ?? null}
      label={tab.label}
      isVisible={deps.isVisible}
      attach={deps.shouldAttach}
      onCloseTab={deps.onCloseTab}
      onTmuxSessionChange={deps.onTmuxSessionChange ? (name) => deps.onTmuxSessionChange!(tab.id, name) : undefined}
      onTmuxSessionMissing={deps.onTmuxSessionMissing}
    />
  );
};

const renderGuacamoleTab: Renderer = (tab, deps) => {
  const host = tab.host;
  if (!host) return <EmptyState icon={Monitor} messageKey="guacamole.noHostSelected" />;
  return (
    <Suspense fallback={<EmptyState icon={Monitor} messageKey="guacamole.noHostSelected" />}>
      <GuacamoleApp
        hostId={host.id}
        tabId={tab.id}
        protocol={tab.type as "rdp" | "vnc" | "telnet"}
        isVisible={deps.isVisible}
        onClose={() => deps.onCloseTab?.(tab.id)}
      />
    </Suspense>
  );
};

// NEW — Phase 120 D-05.
const renderAppTab: Renderer = (tab, deps) => {
  if (!isAppTab(tab)) return null; // defensive; upstream type-narrowing should prevent this
  return <AppPane hostId={tab.app.hostId} slug={tab.app.slug} tabId={tab.id} isVisible={deps.isVisible} />;
};

const RENDERERS: Record<TabType, Renderer> = {
  dashboard: renderDashboard,
  terminal: renderTerminalTab,
  rdp: renderGuacamoleTab,     // three explicit rows pointing at the same helper —
  vnc: renderGuacamoleTab,     // replaces the fall-through pattern per D-04.
  telnet: renderGuacamoleTab,
  app: renderAppTab,           // NEW
};

export function renderTabContent(
  tab: Tab,
  onOpenSingletonTab?: (type: TabType) => void,
  onOpenTab?: /* existing signature */,
  onCloseTab?: (id: string) => void,
  isVisible = true,
  shouldAttach = false,
  onTmuxSessionChange?: (tabId: string, sessionName: string | null) => void,
  onTmuxSessionMissing?: (instanceId: string, sessionName: string) => void,
) {
  return RENDERERS[tab.type](tab, {
    onOpenSingletonTab, onOpenTab, onCloseTab, isVisible, shouldAttach,
    onTmuxSessionChange, onTmuxSessionMissing,
  });
}
```

**Exhaustiveness guarantee** (RESEARCH.md Pattern 2 note): `Record<TabType, Renderer>` gives compile-time exhaustiveness — if TabType grows, tsc surfaces the missing entry.

**Test discipline** (D-21 + CONTEXT.md § Test Considerations): the refactor is byte-equivalent for existing kinds — snapshot test each existing kind before/after and assert equivalence. Add one new test for `app`.

---

### `src/ui/shell/SplitView.tsx` (MODIFY §187-192 + drop dispatch §660-668)

**Analog:** the same file's existing `hasSkynetDragPayload` gate + the `application/x-skynet-row` branch pattern.

**Existing `hasSkynetDragPayload`** (lines 187-192):
```typescript
function hasSkynetDragPayload(dt: DataTransfer | null | undefined): boolean {
  return (
    (dt?.types.includes("application/x-skynet-badge") ?? false) ||
    (dt?.types.includes("application/x-skynet-row") ?? false)
  );
}
```

**Extension pattern** (add a third MIME):
```typescript
function hasSkynetDragPayload(dt: DataTransfer | null | undefined): boolean {
  return (
    (dt?.types.includes("application/x-skynet-badge") ?? false) ||
    (dt?.types.includes("application/x-skynet-row") ?? false) ||
    (dt?.types.includes("application/x-skynet-app-tile") ?? false)   // NEW Phase 120
  );
}
```

**Drop-dispatch extension pattern** (mirror the row branch at lines 619-634; add an app-tile branch after it):
```typescript
      // Existing (lines 619-634):
      if (richJson && onDropRowInTree) {
        try {
          const parsed = JSON.parse(richJson);
          onDropRowInTree(parsed, path, edge);
          return;
        } catch (err) { /* ... */ }
      }

      // NEW — Phase 120 D-07: app-tile drop branch. Mirrors the row branch
      // structurally; distinct callback so AppShell can openTab({type:"app", ...})
      // rather than resolving a row payload.
      const appTileJson = e.dataTransfer?.getData("application/x-skynet-app-tile") ?? "";
      if (appTileJson && onDropAppTileInTree) {
        try {
          const parsed = JSON.parse(appTileJson) as { hostId: number; slug: string; title: string };
          onDropAppTileInTree(parsed, path, edge);
          return;
        } catch (err) {
          console.warn(`[pv-split-drop] app-tile parse failed: ${(err as Error).message}`);
        }
      }
```

**Center-drop discipline** (RESEARCH.md Pattern 4): app-tile center-drops are always a FRESH open — no replace-in-place semantics. Mirror the row center-drop pattern (`onCenterDropAppTile?` callback) if the researcher recommends symmetric coverage; otherwise let center-drops fall through to the edge-drop path (or explicitly no-op).

**CRITICAL — Phase 64 text/plain closure** (RESEARCH.md § Anti-Patterns + SplitView.tsx:596-608): the app-tile drag source MUST NOT emit a `text/plain` payload the row-drop handler could mis-parse as a tabId. Setting ONLY `application/x-skynet-app-tile` is correct.

---

### `src/ui/features/pretty-conversations/AppTile.tsx` (MODIFY — add onClick + drag handlers)

**Analog:** `PrettyConversationRow.tsx:950-1014` — `onRowDragStart` pattern.

**Existing PrettyConversationRow drag pattern** (lines 969-1002, distilled):
```typescript
const onRowDragStart = useCallback(
  (e: DragEvent<HTMLDivElement>) => {
    const dragId = mintDragId();
    armOutboundDrag(dragId, row.id);
    e.dataTransfer.setData("text/plain", row.id);
    e.dataTransfer.setData(
      "application/x-skynet-row",
      JSON.stringify({
        id: row.id,
        dragId,
        host: row.host ?? null,
        // …
      }),
    );
    e.dataTransfer.effectAllowed = "move";
  },
  [row.id, /* ...deps... */],
);
// Used at line 1205: onDragStart={onRowDragStart}
// With line 1179: draggable={true}
```

**AppTile onClick pattern** (D-06 — wire the reserved no-op to `onOpenTab`):
```typescript
// Add to component props:
export interface AppTileProps {
  app: AppState;
  onOpenApp?: (hostId: number, slug: string, title: string) => void;   // NEW
}

// Inside AppTile, add:
const onTileClick = useCallback(
  (_e: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return; // long-press just fired — suppress the synthesized click
    }
    // hostId is a string on the wire (fleet-status-types.ts:136).
    onOpenApp?.(Number(app.hostId), app.slug, app.title);
  },
  [app.hostId, app.slug, app.title, onOpenApp],
);
```

**AppTile drag pattern** (D-07 — new `application/x-skynet-app-tile` MIME):
```typescript
const onTileDragStart = useCallback(
  (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(
      "application/x-skynet-app-tile",
      JSON.stringify({
        hostId: Number(app.hostId), // fleet-status-types.ts stores hostId as string; unify to number at wire crossing
        slug: app.slug,
        title: app.title,
      }),
    );
    // Do NOT set text/plain — Phase 64 closure (SplitView.tsx:596-608).
    e.dataTransfer.effectAllowed = "copy";
  },
  [app.hostId, app.slug, app.title],
);
```

**JSX wiring** (mirror `PrettyConversationRow.tsx:1179, 1205`):
```tsx
    <div
      className="pv-app-tile"
      role="button"
      draggable={true}                    // NEW — D-07
      onDragStart={onTileDragStart}        // NEW — D-07
      onClick={onTileClick}                // NEW — D-06
      onContextMenu={onRowContextMenu}
      // ... existing touch handlers
    >
```

**Cursor style update** (D-06): remove the `cursor: default` override in `pretty-conversations.css`'s `.pv-app-tile` rule; the default `.pv-row` `cursor: pointer` will inherit and make the tile look primary-clickable.

---

### `src/ui/AppShell.tsx` (MODIFY — openTab + restoredTabs)

**Analog:** the same file's Phase 90 `sessionKind`-add pattern at lines 1905-2046 and 1510-1552.

**openTab extension pattern** (mirror the Phase 90 additions at lines 1914-1927 + 1985-1989):
```typescript
const openTab = useCallback(function openTab(
  host: Host | null,
  type: TabType,
  restore?: { instanceId: string; restoredSessionId: string | null },
  options?: {
    targetTmuxSession?: string | null;
    label?: string;
    allowCreateTmux?: boolean;
    sessionKind?: "harness" | "relay-room";
    relayRoomId?: string;
    relayRoomTitle?: string | null;
    // NEW — Phase 120 D-02:
    app?: { hostId: number; slug: string };
  },
): string {
  // ...existing body...
  const appTuple = options?.app;
  // Inside setTabs:
  return [
    ...prev,
    {
      id: tabId,
      // ...existing fields...
      ...(sessionKind !== undefined ? { sessionKind } : {}),
      ...(relayRoomId !== undefined ? { relayRoomId } : {}),
      ...(appTuple !== undefined ? { app: appTuple } : {}), // NEW
    },
  ];
}, []);

// Then when persisting via addOpenTab (line 2030-2044):
if (PERSISTENT_TAB_TYPES.includes(type)) {
  addOpenTab({
    id: instanceId,
    tabType: type,
    hostId: host ? parseInt(host.id) : (appTuple ? appTuple.hostId : null),  // app tabs carry hostId via the tuple
    label: finalLabel,
    tabOrder: 0,
    targetTmuxSession,
    appSlug: appTuple?.slug ?? null,   // NEW
  }).catch(() => {});
}
```

**restoredTabs extension pattern** (mirror lines 1540-1551 — the block that creates a Tab from a saved DB row):
```typescript
restoredTabs.push({
  id: tabId,
  instanceId: saved.id,
  type: saved.tabType as TabType,
  label: saved.label,
  host,
  openedAt: new Date(saved.createdAt).getTime(),
  restoredSessionId,
  targetTmuxSession: saved.targetTmuxSession ?? null,
  terminalRef: saved.tabType === "terminal" ? createRef() : undefined,
  // NEW — Phase 120: restore the app tuple when appSlug is populated.
  ...(saved.tabType === "app" && saved.hostId != null && saved.appSlug != null
    ? { app: { hostId: saved.hostId, slug: saved.appSlug } }
    : {}),
});
```

**Sidebar wiring** (the PrettyConversationsPanel invocation site around line 2847+): wire `onOpenApp` prop through to the AppTile component; the callback calls `openTab(null, "app", undefined, { label: title, app: { hostId, slug } })`.

**Drop-target dispatch** (mirror the row-drop patterns at lines 2553-2604 + 2876+): AppShell wires a new `onDropAppTileInTree` callback that calls `openTab(null, "app", ...)` then `insertLeafAtEdge` (same shape as `onDropRowInTree`).

**URL fragment persistence** (RESEARCH.md Runtime State Inventory + Pitfall 1): extend `src/ui/lib/tab-url.ts`'s `TabSpec` union with a seventh variant `{ protocol: "app"; hostId: string; slug: string }` and extend `parseTabParam` + `specForTab` + `PROTOCOLS`. Miss this and app tabs would silently disappear from restored workspaces.

---

### `substrate/skills/app-development/templates/app-starter/svelte.config.js` (MODIFY — comment L9-12)

**Analog:** The file itself (only the JSDoc-comment content changes; the `csrf.checkOrigin: false` line is UNCHANGED per D-14 + Pitfall 4).

**Current comment (lines 9-12):**
```javascript
        // The security boundary is the front-end client's edge, not this
        // app's form endpoints. Disable SvelteKit's Origin-check CSRF so a
        // proxied POST from the client isn't blocked when the browser's
        // Origin header names the client's domain, not 127.0.0.1:PORT.
```

**Updated comment pattern** (D-14 + RESEARCH.md § Code Examples):
```javascript
        // Skynet's reverse-proxy at /apps/:hostId/:slug/pane/* enforces the
        // same-origin CSRF check at its boundary before forwarding requests
        // to this app — see src/backend/apps/app-proxy-csrf-check.ts in the
        // Skynet repo. The built-in SvelteKit Origin check stays disabled
        // here because a proxied POST arrives at 127.0.0.1:PORT with an
        // Origin header naming Skynet's own domain (not 127.0.0.1:PORT), and
        // the default check would refuse it. Apps served directly (bypassing
        // the pane proxy — e.g. the .serve. per-port URL for a fresh-tab
        // open) rely on the tailnet perimeter plus Skynet's edge auth.
```

**Discretion** (CONTEXT.md D-14): verbatim wording is Claude's discretion — the load-bearing content is "the check is off BECAUSE the proxy enforces it, not as a shortcut."

**CRITICAL** (RESEARCH.md Pitfall 4): the `csrf.checkOrigin: false` LINE ITSELF STAYS. Removing it breaks proxied POSTs (SvelteKit's default check refuses the Skynet-origin Origin header when the app itself is bound to 127.0.0.1:PORT).

---

### Tests

**Test analog A:** `src/backend/serve-url/tests/serve-route.test.ts` — the vi-hoisted-mocks + fake-req/fake-res pattern is the template for both `app-proxy-csrf-check.test.ts` and `app-pane-router.integration.test.ts`.

**vi.hoisted + fake-req/res scaffolding pattern** (from `serve-route.test.ts:16-90`):
```typescript
const mocks = vi.hoisted(() => ({
  getOrCreate: vi.fn(),
  getOrCreateProxyForTarget: vi.fn(),
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  authManagerGetInstance: vi.fn(),
}));
vi.mock("../tunnel-cache.js", () => ({ tunnelCache: { getOrCreate: mocks.getOrCreate } }));
vi.mock("../proxy-factory.js", () => ({ getOrCreateProxyForTarget: mocks.getOrCreateProxyForTarget }));

function makeReq(serveTarget?: unknown): Request {
  return { headers: {}, originalUrl: "/path", serveTarget } as unknown as Request;
}
function makeRes() {
  const state = { finishListeners: [] as Array<() => void>, statusCode: 200 };
  const res = { on(event, cb) { if (event === "finish") state.finishListeners.push(cb); return this; }, /* … */ };
  return { res, ...state };
}
```

**Test analog B:** `src/backend/database/routes/apps.test.ts` — the supertest-style scaffold with a bare Express app + Node http.request client is the template for router-level integration tests.

**Test analog C:** `src/ui/features/pretty-conversations/AppTile.test.tsx` + `src/ui/shell/tabUtils.test.tsx` — the vi.mock + `render` + `fireEvent` + `screen` pattern with data-testid doubles is the template for the client-side dispatch + drag tests.

---

## Shared Patterns

### Authentication (V2)

**Source:** `src/backend/database/routes/apps.ts:80-86`
**Apply to:** `src/backend/apps/app-pane-router.ts` (and future backend apps routes)
```typescript
const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
// then: router.all("/...", authenticateJWT, async (req, res) => { ... })
```

### Slug + hostId validation (V5)

**Source:** `src/backend/database/routes/apps.ts:89-109`
**Apply to:** every route under `/apps/:hostId/:slug/…`
```typescript
const slug = String(req.params.slug);
if (!APP_SLUG_RE.test(slug)) {
  return res.status(400).json({ error: "slug must match [a-z0-9-]{1,64}" });
}
const hostIdNum = Number(req.params.hostId);
if (!Number.isFinite(hostIdNum) || !Number.isInteger(hostIdNum) || hostIdNum <= 0) {
  return res.status(400).json({ error: "hostId must be a positive integer" });
}
```

### Host-access gate (V4) — info-leak-safe 403

**Source:** `src/backend/database/routes/apps.ts:114-131` + `src/backend/ssh/host-resolver.ts:497-518`
**Apply to:** `app-pane-router.ts` route entry
```typescript
const host = await resolveHostById(hostIdNum, userId);
if (!host) {
  sshLogger.warn("app pane: host unresolvable / no access", { operation: "...", hostId: hostIdNum, slug });
  return res.status(403).json({ error: "app home box unreachable" });
}
const allowed = await checkHostAccess(hostIdNum, userId, host.userId, "read");
if (!allowed) {
  return res.status(403).json({ error: "app home box unreachable" });
}
```

**Invariant** (RESEARCH.md § Security V4 + `apps.ts:120-131` MEDIUM-3 fix): the 403 body MUST be identical for "unknown host" and "not authorized." Never distinguish.

### Env-fail-loud module-load check (V7)

**Source:** `src/backend/serve-url/serve-route.ts:52-61`
**Apply to:** any new backend module that reads `SKYNET_COOKIE_DOMAIN`
```typescript
const PRIMARY_DOMAIN = (() => {
  const value = process.env.SKYNET_COOKIE_DOMAIN;
  if (!value) {
    throw new Error("<module>: SKYNET_COOKIE_DOMAIN env var is required (fail-loud per W4)");
  }
  return value;
})();
```

### Structured warn logging with info-leak invariant

**Source:** `src/backend/database/routes/apps.ts:123-127` + `src/backend/serve-url/tunnel-cache.ts:31-35`
**Apply to:** every warn/error path in `app-pane-router.ts` + `app-pane-proxy-factory.ts`
```typescript
sshLogger.warn("apps pane: <what>", {
  operation: "apps_pane_<action>",
  hostId,
  slug,
  errMessage: e instanceof Error ? e.message : String(e),   // ONLY .message — never stack
});
// NEVER include: raw Error stacks, user IDs, cookie contents, session tokens.
```

### Iframe embedding + X-Frame-Options

**Source:** RESEARCH.md § Security V13 + Pitfall 5.
**Apply to:** `AppPane.tsx` iframe attribute set.
- `sandbox`: UNSET
- `referrerPolicy`: `"no-referrer"`
- Skynet's own `X-Frame-Options: SAMEORIGIN` (or CSP `frame-ancestors 'self'`) — verify at plan time via grep of `docker/Caddyfile*` + `helmet` config.

### Backward-compat field addition

**Source:** Phase 90 `sessionKind` add pattern (`src/types/ui-types.ts:228-230`, `AppShell.tsx:1985-1989`, `src/backend/database/db/index.ts:1071`)
**Apply to:** `Tab.app` + `user_open_tabs.app_slug` + `open-tabs.ts` body validators.
Optional field; `null` on legacy rows; conditional spread `...(present ? { field } : {})`; never a schema-validation gate that would reject unknown fields.

### Drag-source MIME + `hasSkynetDragPayload` gate

**Source:** `PrettyConversationRow.tsx:985-1002` (drag emit) + `SplitView.tsx:187-192` (drop gate).
**Apply to:** `AppTile.tsx` drag-source + `SplitView.tsx` drop gate.
Emit a distinct `application/x-skynet-<source-kind>` MIME with a JSON payload. Do NOT set `text/plain` (Phase 64 closure). Extend `hasSkynetDragPayload` to `.types.includes(...)` the new MIME.

## No Analog Found

All Phase 120 files have a close existing analog. The two "novel" surfaces (CSRF-check middleware + iframe pane content) have partial analogs:
- CSRF check: the middleware SHAPE (module-load env check + pure predicate) matches `serve-route.ts`; the semantics are new but derived from the shape file + SvelteKit's own `checkOrigin` behavior.
- Iframe pane content: no full analog — the pane has never held an iframe as a full leaf mount. GuacamoleApp is the closest React sibling. RESEARCH.md § Established Patterns confirms this is the pattern Phase 120 establishes; no existing convention forbids it.

## Metadata

**Analog search scope:**
- `src/backend/serve-url/*` (proxy machinery)
- `src/backend/database/routes/apps.ts` + `apps.test.ts` (Phase 119 icon endpoint + redirect route)
- `src/backend/database/routes/open-tabs.ts` + `src/backend/database/db/{schema,index}.ts` (tab persistence)
- `src/backend/ssh/host-resolver.ts` (`checkHostAccess`)
- `src/ui/shell/{tabUtils,SplitView,AppPane}.tsx` (client dispatch + drop-target)
- `src/ui/features/pretty-conversations/{AppTile,PrettyConversationRow}.tsx` (tile + drag-source template)
- `src/ui/AppShell.tsx` (openTab + restoredTabs)
- `src/ui/lib/tab-url.ts` (URL-fragment TabSpec)
- `src/types/ui-types.ts` (TabType + Tab)
- `substrate/skills/app-development/templates/app-starter/svelte.config.js`
- `src/backend/serve-url/tests/*` + `src/backend/database/routes/apps.test.ts` + `src/ui/features/pretty-conversations/AppTile.test.tsx` (test scaffolds)

**Files scanned:** ~30 (targeted reads via Grep + Read; no re-reads of overlapping ranges).

**Pattern extraction date:** 2026-09-19
