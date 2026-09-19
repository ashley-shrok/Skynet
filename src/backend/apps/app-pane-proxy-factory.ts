/**
 * Phase 120 Plan 02 Task 1 — App-pane proxy factory (sibling of
 * `src/backend/serve-url/proxy-factory.ts`).
 *
 * ---
 *
 * Sibling — NOT fork — of `proxy-factory.ts`. Composes the same D-04
 * default-deny allowlist strip, the same R&D GOTCHA 1 permessage-deflate
 * RSV1 fix, and the same shared interstitial (D-17 reuse) on `on.error`,
 * with three additions unique to the in-pane app proxy path:
 *
 *   (a) CACHE KEY includes `${hostId}:${slug}` in addition to
 *       `${hostname}:${port}::${tunnelPort}` (RESEARCH.md § Pitfall 2).
 *       Reusing serve-url's shared factory (keyed on hostname+port+
 *       tunnelPort only) would collide on `pathRewrite`: two apps on the
 *       same host+port+tunnel would share one middleware baked with a
 *       single strip rule, and one app's requests would strip the wrong
 *       prefix. Each (hostId, slug) pair gets its own middleware
 *       instance with its own `pathRewrite` rule (+ its own base-tag
 *       responseInterceptor).
 *
 *   (b) `selfHandleResponse: true` + `pathRewrite` stripping
 *       `^/apps/<hostId>/<slug>/pane` + a `responseInterceptor` proxyRes
 *       hook. The hook is Content-Type-gated: on `text/html` responses
 *       (including `text/html; charset=utf-8`) it delegates to Plan 01's
 *       `injectBaseTag(buffer, hostId, slug)` for the D-11 `<base>`
 *       injection; on anything else it passes the input buffer through
 *       unchanged so JSON / JS / images / binary content are never
 *       mangled (RESEARCH.md § Pitfall 3 / Pattern 3 caveats).
 *
 *   (c) Log tag `operation: "apps_pane_proxy"` (differentiates from
 *       serve-url proxy's `"serve_url_proxy"` for post-hoc log filtering).
 *
 * ---
 *
 * INHERITED VERBATIM from `proxy-factory.ts` — MUST NOT drift:
 *
 *   - `stripToAllowlist(proxyReq)` on BOTH `on.proxyReq` and
 *     `on.proxyReqWs` hooks (D-04). Duplicated (not shared via export)
 *     because the tiny loop is safer to inline than to expose internal
 *     API of the serve-url module.
 *   - The RSV1 permessage-deflate fix on the `on.proxyReqWs` hook
 *     AFTER strip (R&D GOTCHA 1 — forcing the empty-string form over
 *     the missing-header form is the wire-verified working shape).
 *     WebSocket compression is disabled through the pane proxy; the
 *     same trade the shared factory accepts.
 *   - `classifyTunnelError` + `renderInterstitial` + `writeInterstitial`
 *     on `on.error` (D-17 reuse of Phase 103's error surface).
 *   - `writableEnded` guard before writing the interstitial (mirror of
 *     the shared factory's line 253).
 *   - Info-leak invariant on `on.error` logging: ONLY `.code`, `.name`,
 *     `.level` fields extracted from the thrown Error — never `.stack`,
 *     never request headers, never user identifiers.
 *
 * ---
 *
 * MUST-NOT list:
 *
 *   - MUST NOT reuse the shared factory exported by
 *     `serve-url/proxy-factory.ts` (Pitfall 2 — its cache key structure
 *     doesn't disambiguate slugs).
 *   - MUST NOT re-implement the RSV1 fix (reuse the exact
 *     header-set line verbatim from the shared factory).
 *   - MUST NOT alter `serve-url/proxy-factory.ts` or `serve-url/types.ts`
 *     — those are READ-ONLY reuse.
 *   - MUST NOT set a `sandbox` option on the middleware — sandbox is an
 *     iframe attribute, not a proxy option; unrelated to this factory.
 *
 * ---
 *
 * Downstream consumers: Wave 3 Plan 05 (app-pane-router composition)
 * imports `getOrCreateAppPaneProxyForTarget` and mounts it after auth +
 * host-access + CSRF-check + target-resolve stages.
 */

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
import {
  renderInterstitial,
  writeInterstitial,
} from "../serve-url/interstitial.js";
import { classifyTunnelError } from "../serve-url/error-classifier.js";
import { sshLogger } from "../utils/logger.js";
import { injectBaseTag } from "./base-tag-injector.js";
import { PRIMARY_DOMAIN } from "./app-proxy-csrf-check.js";

/* ------------------------------------------------------------------------ */
/*  Per-target proxy cache (Pitfall 2 — key includes hostId + slug)          */
/* ------------------------------------------------------------------------ */

/**
 * Module-level cache. NO eviction (matches serve-url proxy-factory's D-16
 * discipline — one middleware per unique (target, tunnelPort, hostId,
 * slug) tuple, container-lifetime). At realistic fleet scale (~10 apps ×
 * ~5 users) this is bounded and acceptable.
 */
const proxyCache = new Map<string, RequestHandler>();

/**
 * Build the cache key. Trailing `${hostId}:${slug}` segment is the
 * load-bearing addition over `proxy-factory.ts`'s key (Pitfall 2 fix).
 */
function buildCacheKey(
  target: ServeTarget,
  tunnelPort: number,
  hostId: number,
  slug: string,
): string {
  return `${target.hostname}:${target.port}::${tunnelPort}::${hostId}:${slug}`;
}

/* ------------------------------------------------------------------------ */
/*  Allowlist strip (D-04) — duplicated from serve-url/proxy-factory.ts      */
/* ------------------------------------------------------------------------ */

const ALLOWLIST_SET = new Set<string>(HEADER_ALLOWLIST);

/**
 * Iterate every header on the outbound proxyReq and remove any not in
 * HEADER_ALLOWLIST. Verbatim mirror of `proxy-factory.ts` lines 154-160.
 * Duplicated (not shared) so this module doesn't expose internal API of
 * the serve-url module — the tiny loop is safer to inline than to link.
 */
function stripToAllowlist(proxyReq: http.ClientRequest): void {
  for (const headerName of proxyReq.getHeaderNames()) {
    if (!ALLOWLIST_SET.has(headerName.toLowerCase())) {
      proxyReq.removeHeader(headerName);
    }
  }
}

/* ------------------------------------------------------------------------ */
/*  Public API                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Return an http-proxy-middleware RequestHandler configured for the
 * `/apps/<hostId>/<slug>/pane/*` mount on the given (target, tunnelPort)
 * pair. Cached per (hostname, port, tunnelPort, hostId, slug) — repeat
 * calls for the same tuple reuse the same middleware.
 *
 * Configuration:
 *  - target: `http://127.0.0.1:${tunnelPort}` (loopback — tunnel forwards
 *    to the app's home box via SSH).
 *  - changeOrigin: true (rewrites outgoing Host header — the app sees a
 *    clean loopback Host, not Skynet's own primary domain).
 *  - ws: true (WebSocket upgrade tunneling).
 *  - selfHandleResponse: true (REQUIRED for responseInterceptor to fire).
 *  - pathRewrite: strips `^/apps/<hostId>/<slug>/pane` — the app sees
 *    itself at root (per D-11: "apps don't know they're in-pane").
 *  - on.proxyReq: strip → emitHeaderAudit(target, 'req', proxyReq).
 *  - on.proxyReqWs: strip → RSV1 fix (setHeader → '') → emitHeaderAudit.
 *  - on.proxyRes: responseInterceptor wrapper that gates on Content-Type
 *    and delegates to injectBaseTag on text/html.
 *  - on.error: classify → warn-log with safe fields → writableEnded
 *    guard → write shared interstitial.
 */
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
    selfHandleResponse: true, // REQUIRED for responseInterceptor to fire
    pathRewrite: {
      [`^/apps/${hostId}/${slug}/pane`]: "",
    },
    on: {
      // Outbound HTTP request — strip first, then audit. Same shape as
      // serve-url/proxy-factory.ts:204-207.
      proxyReq: (proxyReq) => {
        stripToAllowlist(proxyReq);
        emitHeaderAudit(target, "req", proxyReq);
      },

      // Outbound WebSocket upgrade — strip → RSV1 fix (force the
      // extensions header to empty string) → audit. See R&D GOTCHA 1
      // in serve-url/proxy-factory.ts:21-40 — the empty-string form
      // is the wire-verified working shape; some upstreams treat
      // missing vs empty differently.
      proxyReqWs: (proxyReq) => {
        stripToAllowlist(proxyReq);
        proxyReq.setHeader("sec-websocket-extensions", "");
        emitHeaderAudit(target, "ws", proxyReq);
      },

      // Response transform — Content-Type gate delegates to injectBaseTag
      // on text/html. All non-HTML responses (JSON, JS, images, WS
      // upgrades — which bypass this hook anyway) pass through unchanged.
      // The .startsWith("text/html") check matches "text/html" and
      // "text/html; charset=utf-8" alike.
      proxyRes: responseInterceptor(async (buffer, proxyRes, _req, _res) => {
        const contentType = String(proxyRes.headers["content-type"] ?? "");
        if (!contentType.startsWith("text/html")) {
          return buffer;
        }
        return injectBaseTag(buffer, hostId, slug);
      }),

      // Proxy-time errors (ECONNREFUSED / ETIMEDOUT / ECONNRESET / ssh2
      // ClientError). Mirror of serve-url/proxy-factory.ts:236-263 —
      // classify with the shared D-14 taxonomy, warn-log with safe
      // fields only (never stack), and render the shared interstitial
      // if the response hasn't already been ended.
      error: (err, req, res) => {
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
        if (
          !expressRes ||
          (expressRes as unknown as { writableEnded?: boolean }).writableEnded
        ) {
          return;
        }
        const expressReq = req as Request;
        const hostHeader = expressReq.headers.host ?? "";
        const originalUrl = hostHeader
          ? `https://${hostHeader}${expressReq.originalUrl ?? ""}`
          : (expressReq.originalUrl ?? "");
        const result = renderInterstitial(
          errorClass,
          target,
          originalUrl,
          PRIMARY_DOMAIN,
        );
        writeInterstitial(expressRes, result);
      },
    },
  });

  proxyCache.set(cacheKey, middleware);
  return middleware;
}
