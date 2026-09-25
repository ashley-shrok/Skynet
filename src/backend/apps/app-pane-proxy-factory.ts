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
import * as zlib from "node:zlib";
import type { Request, Response } from "express";
import {
  createProxyMiddleware,
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
/*  pathRewrite (HIGH-2 code-review fix, 2026-09-19)                         */
/* ------------------------------------------------------------------------ */

/**
 * Build the pathRewrite function passed to `createProxyMiddleware`.
 * Exported for unit-test coverage — the router mounts this factory under
 * `/apps`, so `req.url` arriving at the proxy middleware is already
 * mount-stripped (`/<hostId>/<slug>/pane/<rest>`); the rewrite therefore
 * matches on the mount-relative shape.
 *
 * The regex is per-(hostId, slug) because that's the tuple the caller
 * bakes into the middleware cache-entry (buildCacheKey above); any URL
 * that reaches this middleware necessarily carries that exact (hostId,
 * slug) tuple in the first two segments (upstream routing dispatch has
 * already validated it). Guarding against mismatches here is
 * defence-in-depth: on a mismatch we return the input path unchanged
 * rather than accidentally stripping the wrong prefix.
 *
 * Rewrite semantics:
 *   `/<hostId>/<slug>/pane`         → `/`
 *   `/<hostId>/<slug>/pane/`        → `/`
 *   `/<hostId>/<slug>/pane/api/x`   → `/api/x`
 *   anything else                    → passthrough (input unchanged)
 */
export function buildPaneMountPathRewrite(
  hostId: number,
  slug: string,
): (path: string) => string {
  // Anchor to mount-relative shape. Escape the slug's `-` inside a
  // character class defensively (slugs are `[a-z0-9-]{1,64}` per
  // APP_SLUG_RE) — we build the regex from the literal segments so no
  // metacharacter injection is possible; escaping is belt-and-braces.
  const pattern = new RegExp(
    `^/${hostId}/${slug.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}/pane(/.*)?$`,
  );
  return (path: string) => {
    const m = pattern.exec(path);
    if (!m) return path;
    return m[1] ?? "/";
  };
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
 *  - selfHandleResponse: true (required for the on.proxyRes hook to own
 *    response forwarding — see the hook doc for the streaming-vs-buffered
 *    dispatch that lives there).
 *  - pathRewrite: strips the mount-relative `^/<hostId>/<slug>/pane`
 *    prefix — the app sees itself at root (per D-11: "apps don't know
 *    they're in-pane"). NOTE (HIGH-2 code-review fix, 2026-09-19): the
 *    regex is MOUNT-RELATIVE (no leading `/apps`) because the router is
 *    mounted via `app.use("/apps", appPaneRouter)`, and Express strips
 *    the `/apps` prefix from `req.url` before it reaches the proxy
 *    middleware. `http-proxy-middleware` v4 rewrites against `req.url`,
 *    not `req.originalUrl`. The prior anchored `^/apps/...` regex never
 *    matched at runtime.
 *  - on.proxyReq: strip → emitHeaderAudit(target, 'req', proxyReq).
 *  - on.proxyReqWs: strip → RSV1 fix (setHeader → '') → emitHeaderAudit.
 *  - on.proxyRes: dispatches on Content-Type — text/html and
 *    application/xhtml+xml are buffered, decompressed, and passed to
 *    injectBaseTag; every other response streams through via
 *    proxyRes.pipe(res) with status + headers copied verbatim. HEAD
 *    responses and bodyless statuses (1xx / 204 / 304) end after headers.
 *    The streaming path preserves 206 Partial Content + Content-Range +
 *    Accept-Ranges verbatim so `<video>` seeking works; upstream 4xx/5xx
 *    also pass through unchanged (not classified as tunnel errors).
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
    // HIGH-2 code-review fix (2026-09-19): mount-relative pathRewrite via
    // a function rather than a regex-object literal. The router mounts
    // at `/apps`, so `req.url` here is already stripped of `/apps` by
    // Express. See `buildPaneMountPathRewrite` above.
    pathRewrite: buildPaneMountPathRewrite(hostId, slug),
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

      // Response dispatch — text/html + application/xhtml+xml are buffered,
      // decompressed, and passed to injectBaseTag for the D-11 <base> tag.
      // Everything else STREAMS through via proxyRes.pipe(res): status +
      // headers copied verbatim (including 206 Partial Content +
      // Content-Range + Accept-Ranges so <video> seek works), no buffering
      // in Node memory. Rationale: the prior `responseInterceptor` wrapper
      // unconditionally buffered the entire response body — including
      // multi-GB video streams — before this callback fired, breaking
      // Range requests and blowing HTTP/2 timeouts on large binaries.
      // Upstream 4xx/5xx pass through as-is (they're app responses, not
      // tunnel errors — the on.error hook handles the tunnel-side
      // failures).
      //
      // MEDIUM-1 code-review fix (2026-09-19) preserved: X-Frame-Options
      // + CSP frame-ancestors 'self' are set on `res` BEFORE any header
      // copy from `proxyRes`, and are NOT overwritten by upstream's own
      // versions of those headers — Skynet's anti-clickjacking wins.
      //
      // MEDIUM-2 code-review fix (2026-09-19) preserved: upstream
      // `Set-Cookie` is dropped on both paths. Pane responses share
      // Skynet's primary origin, so an app-set cookie would collide with
      // Skynet's own session; apps use in-memory / their own auth surface
      // instead.
      proxyRes: (proxyRes, req, res) => {
        const contentType = String(
          proxyRes.headers["content-type"] ?? "",
        ).toLowerCase();
        const isInjectableHtml =
          contentType.startsWith("text/html") ||
          contentType.startsWith("application/xhtml+xml");

        // Bodyless per RFC 9110: HEAD, 1xx, 204, 304. No body flows,
        // regardless of Content-Type.
        const status = proxyRes.statusCode ?? 502;
        const isBodyless =
          req.method === "HEAD" ||
          (status >= 100 && status < 200) ||
          status === 204 ||
          status === 304;

        // Header-copy helper — writes upstream headers to `res` but never
        // overwrites headers we've already set (X-Frame-Options / CSP /
        // recomputed Content-Length on the buffered path). Also skips
        // `set-cookie` per MEDIUM-2 above.
        const copyHeaders = (skip: Set<string>) => {
          for (const [key, value] of Object.entries(proxyRes.headers)) {
            const lower = key.toLowerCase();
            if (lower === "set-cookie") continue;
            if (skip.has(lower)) continue;
            if (value === undefined) continue;
            if (res.hasHeader(key)) continue;
            try {
              res.setHeader(
                key,
                value as string | string[] | number,
              );
            } catch {
              // Headers already sent — non-fatal.
            }
          }
        };

        // ── Streaming path (non-HTML, or HTML we can't inject into) ──
        if (!isInjectableHtml) {
          try {
            res.setHeader("X-Frame-Options", "SAMEORIGIN");
            res.setHeader(
              "Content-Security-Policy",
              "frame-ancestors 'self'",
            );
          } catch {
            /* headers past writable window — non-fatal */
          }
          copyHeaders(new Set());
          res.statusCode = status;
          if (isBodyless) {
            res.end();
            // Drain any body bytes to avoid stalling the upstream socket.
            proxyRes.resume();
            return;
          }
          proxyRes.pipe(res);
          proxyRes.on("error", () => {
            // Upstream tore down mid-stream. Best-effort end; if the
            // response is already writing chunks, Express/Node will close
            // the connection when we return.
            if (!res.writableEnded) {
              try {
                res.end();
              } catch {
                /* non-fatal */
              }
            }
          });
          return;
        }

        // ── Buffered path (text/html + application/xhtml+xml) ──
        // Decompress if upstream sent gzip/deflate/br, then inject.
        const contentEncoding = String(
          proxyRes.headers["content-encoding"] ?? "",
        ).toLowerCase();
        let source: NodeJS.ReadableStream = proxyRes;
        if (contentEncoding === "gzip" || contentEncoding === "x-gzip") {
          source = proxyRes.pipe(zlib.createGunzip());
        } else if (contentEncoding === "deflate") {
          source = proxyRes.pipe(zlib.createInflate());
        } else if (contentEncoding === "br") {
          source = proxyRes.pipe(zlib.createBrotliDecompress());
        }

        const chunks: Buffer[] = [];
        let bufferLength = 0;
        source.on("data", (chunk) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          chunks.push(buf);
          bufferLength += buf.length;
        });
        source.on("end", async () => {
          try {
            res.setHeader("X-Frame-Options", "SAMEORIGIN");
            res.setHeader(
              "Content-Security-Policy",
              "frame-ancestors 'self'",
            );
          } catch {
            /* headers past writable window — non-fatal */
          }
          const injected = isBodyless
            ? Buffer.alloc(0)
            : await injectBaseTag(
                Buffer.concat(chunks, bufferLength),
                hostId,
                slug,
              );
          // Skip content-encoding (we decompressed) and content-length
          // (recomputed below post-injection). Everything else copies.
          copyHeaders(new Set(["content-encoding", "content-length"]));
          if (!isBodyless) {
            try {
              res.setHeader("Content-Length", String(injected.length));
            } catch {
              /* non-fatal */
            }
          }
          res.statusCode = status;
          res.end(isBodyless ? undefined : injected);
        });
        source.on("error", () => {
          if (!res.headersSent) {
            try {
              res.statusCode = 502;
            } catch {
              /* non-fatal */
            }
          }
          if (!res.writableEnded) {
            try {
              res.end();
            } catch {
              /* non-fatal */
            }
          }
        });
      },

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
