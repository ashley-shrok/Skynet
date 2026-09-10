/**
 * Phase 103 Plan 03b — Per-target-cached http-proxy-middleware factory.
 *
 * The load-bearing security boundary of the whole serve-URL infrastructure.
 * Every outbound HTTP request AND every WebSocket upgrade from Skynet to
 * an agent's local port passes through the two hooks below:
 *
 *   on.proxyReq(proxyReq, ...)   — outbound HTTP requests
 *   on.proxyReqWs(proxyReq, ...) — outbound WebSocket upgrade requests
 *
 * Both hooks apply D-04's default-deny allowlist-strip FIRST (walking
 * proxyReq.getHeaderNames() and removeHeader'ing anything not in
 * HEADER_ALLOWLIST from types.ts). If this strip is buggy or missing, the
 * whole "no cookies / no Authorization / no X-Skynet-* to upstream"
 * guarantee falls over — Plan 04's integration test enforces the invariant
 * at merge time and Plan 03b's header-audit-sampler catches any runtime
 * slippage.
 *
 * ---
 *
 * R&D GOTCHA 1 (permessage-deflate RSV1 fix — baked in day one, per
 * findings-summary.md L137-154):
 *
 * http-proxy-middleware's WS upgrade tunneling doesn't reliably preserve
 * permessage-deflate negotiation state across the two proxy hops
 * (client↔proxy and proxy↔upstream) when target endpoints vary. Symptom:
 * WS OPEN succeeds, sec-websocket-extensions: permessage-deflate is
 * negotiated, then the very first data frame from upstream triggers
 * "Invalid WebSocket frame: RSV1 must be clear" on the client.
 *
 * Fix: after the allowlist-strip removes sec-websocket-extensions (it's
 * not in the allowlist), the on.proxyReqWs hook FORCE-SETS
 * sec-websocket-extensions to the empty string. Some upstreams treat
 * "missing header" differently from "empty header" — the empty-string
 * form is the wire-verified working shape from POC 2 + POC 6.
 *
 * Trade: WebSocket compression is disabled through serve URLs. Acceptable
 * per R&D — serve URLs are for dev/prototype/tasting content, not
 * high-throughput production traffic.
 *
 * ---
 *
 * R&D GOTCHA 2 (per-target cache — findings-summary.md L156-160):
 *
 * Creating a fresh createProxyMiddleware per request causes intermittent
 * WS failures (same RSV1 class of bug) even without the SSH tunnel.
 * Solution: module-level Map<`${hostname}:${port}`, RequestHandler>,
 * one middleware instance per (hostname, port) target, shared across
 * every request to that target.
 *
 * ---
 *
 * Downstream consumers: Plan 05 subdomain-dispatch mounts this — this
 * file only exports getOrCreateProxyForTarget and does NOT wire itself
 * into Express here.
 */

import type * as http from "node:http";
import type { Request, Response } from "express";
import {
  createProxyMiddleware,
  type RequestHandler,
} from "http-proxy-middleware";
import { emitHeaderAudit } from "./header-audit-sampler.js";
import { HEADER_ALLOWLIST } from "./types.js";
import type { ServeTarget } from "./types.js";
import { renderInterstitial, writeInterstitial } from "./interstitial.js";
import { classifyTunnelError } from "./error-classifier.js";
import { sshLogger } from "../utils/logger.js";

/**
 * D-23 primary domain — matches serve-route.ts's module-load check. Read
 * once at module init; if serve-route.ts loaded successfully so did we,
 * but re-check here to keep proxy-factory self-contained (fail loud if
 * ever loaded standalone in tests without the env).
 */
const PRIMARY_DOMAIN = (() => {
  const value = process.env.SKYNET_COOKIE_DOMAIN;
  if (!value) {
    throw new Error(
      "serve-url proxy-factory: SKYNET_COOKIE_DOMAIN env var is required " +
        "(per D-23; no hardcoded fallback — fail-loud per W4)",
    );
  }
  return value;
})();

/* ------------------------------------------------------------------------ */
/*  Allowlist set for O(1) membership check                                 */
/* ------------------------------------------------------------------------ */

/**
 * Prebuilt Set of the HEADER_ALLOWLIST tuple for O(1) membership lookup
 * inside stripToAllowlist. Built once at module load; never mutated.
 * Same lowercase invariant as types.ts / header-audit-sampler.ts.
 */
const ALLOWLIST_SET = new Set<string>(HEADER_ALLOWLIST);

/* ------------------------------------------------------------------------ */
/*  Per-target proxy cache (R&D GOTCHA 2)                                   */
/* ------------------------------------------------------------------------ */

/**
 * Module-level Map keyed by `${hostname}:${port}` (same shape as
 * tunnel-cache.ts's cacheKey — one proxy instance per one tunnel). One
 * middleware per target for container lifetime; NO eviction (D-16). If a
 * target's tunnel dies and gets rebuilt on the next request, we simply
 * reuse the same middleware pointing at the new tunnelPort — the
 * middleware doesn't remember tunnelPort by identity, only by the target
 * URL string set at construction time.
 *
 * Wait — the middleware IS constructed with `target: 'http://127.0.0.1:${tunnelPort}'`,
 * so if the tunnelPort changes across tunnel rebuilds we'd point at a
 * stale port. Handled by NOT caching the middleware if the tunnelPort
 * changes: cacheKey includes both hostname:port AND tunnelPort. In
 * practice the tunnel-cache singleton keeps the tunnelPort stable for
 * the lifetime of the tunnel entry, so this key is stable.
 */
const proxyCache = new Map<string, RequestHandler>();

/**
 * Build the cache key. Includes tunnelPort so that if the underlying
 * tunnel gets rebuilt on a new port (D-15 transparent-recovery path in
 * tunnel-cache), a fresh middleware is built pointing at the new port
 * instead of silently keeping a stale middleware.
 */
function buildCacheKey(target: ServeTarget, tunnelPort: number): string {
  return `${target.hostname}:${target.port}::${tunnelPort}`;
}

/* ------------------------------------------------------------------------ */
/*  Allowlist-strip (D-04 default-deny)                                     */
/* ------------------------------------------------------------------------ */

/**
 * Iterate every header on the outbound proxyReq and remove any not in
 * HEADER_ALLOWLIST. Called at the top of BOTH on.proxyReq and
 * on.proxyReqWs hooks. This is the D-04 default-deny cutoff:
 *
 * - NO cookies (Cookie header stripped — D-05 test-enforced)
 * - NO Authorization
 * - NO X-Skynet-* internal headers
 * - NO user-agent / referer / origin / accept-* / if-* / cache-control /
 *   pragma / dnt / x-forwarded-* / any other browser or Skynet-internal
 *   header not explicitly listed
 *
 * getHeaderNames() returns lowercase per Node's http spec; we
 * lower-case-again on the check for defensive parity with anything that
 * ever slips through mixed-case.
 *
 * removeHeader is safe to call on names that were already stripped or
 * were never set — Node's http.ClientRequest just no-ops.
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
 * Return an http-proxy-middleware RequestHandler pointed at the given
 * (target, tunnelPort) pair. Cached per (hostname, port, tunnelPort) so
 * repeat calls for the same target reuse the same middleware — required
 * per R&D GOTCHA 2 (fresh-per-request causes RSV1 WS failures).
 *
 * The proxy is configured with:
 * - target: `http://127.0.0.1:${tunnelPort}` (loopback — the tunnel
 *   forwards to the agent's port via SSH)
 * - changeOrigin: true (rewrites the outgoing Host header to the target's
 *   host — upstream sees a clean Host, not the browser's
 *   *.serve.term.<domain>)
 * - ws: true (enables WebSocket upgrade tunneling)
 * - on.proxyReq: strip → emitHeaderAudit(target, 'req', proxyReq)
 * - on.proxyReqWs: strip → force-set sec-websocket-extensions to '' →
 *   emitHeaderAudit(target, 'ws', proxyReq)
 *
 * Order-of-operations note for proxyReqWs: the strip removes
 * sec-websocket-extensions (it's not in the allowlist), THEN we
 * explicitly setHeader('sec-websocket-extensions', '') to force upstream
 * to see "no extensions negotiated" (some upstreams treat missing vs
 * empty differently — R&D findings-summary L145-152 documents the
 * working POC pattern).
 */
export function getOrCreateProxyForTarget(
  target: ServeTarget,
  tunnelPort: number,
): RequestHandler {
  const cacheKey = buildCacheKey(target, tunnelPort);
  const cached = proxyCache.get(cacheKey);
  if (cached) return cached;

  const middleware = createProxyMiddleware({
    target: `http://127.0.0.1:${tunnelPort}`,
    changeOrigin: true,
    ws: true,
    on: {
      // Outbound HTTP requests — strip first, then audit.
      proxyReq: (proxyReq) => {
        stripToAllowlist(proxyReq);
        emitHeaderAudit(target, "req", proxyReq);
      },
      // Outbound WebSocket upgrade requests — strip first, then force
      // sec-websocket-extensions to '' (R&D GOTCHA 1 permessage-deflate
      // fix), then audit. The audit runs AFTER the extensions setHeader
      // so the audit sees the final outbound header set; sec-websocket-
      // extensions is intentionally EXCLUDED from HEADER_ALLOWLIST, so
      // the audit anomaly branch WILL fire with `outOfAllowlist:
      // ["sec-websocket-extensions"]` on every WS upgrade — this is
      // expected and documents at the log level that the fix is
      // engaged. Ashley's dashboard filter can suppress
      // sec-websocket-extensions specifically (or the anomaly signal
      // proves the fix is running).
      proxyReqWs: (proxyReq) => {
        stripToAllowlist(proxyReq);
        // R&D GOTCHA 1: force-set to empty string. Do NOT skip if the
        // upstream doesn't negotiate compression — the fix works by
        // making our outbound offer explicit rather than absent.
        proxyReq.setHeader("sec-websocket-extensions", "");
        emitHeaderAudit(target, "ws", proxyReq);
      },
      // Proxy-time errors (ECONNREFUSED when the target port stops
      // listening between tunnel-open and request; ETIMEDOUT on network
      // flap mid-request; ssh2 ClientError if the tunnel itself dies).
      // Without this handler, http-proxy-middleware sends its default
      // plain-text "Error occurred while trying to proxy: <url>" body —
      // which is what a UAT surfaced 2026-09-10 when the target http.server
      // was killed. Classify with the shared D-14 taxonomy and render
      // the Skynet-styled interstitial (Try Again anchor, no auto-refresh
      // per D-06).
      error: (err, req, res) => {
        const errorClass = classifyTunnelError(err);
        sshLogger.warn("serve-url proxy: proxy-time-error", {
          operation: "serve_url_proxy",
          target: `${target.hostname}:${target.port}`,
          errorClass,
        });
        // http-proxy-middleware's error handler receives a Node-level
        // res that isn't guaranteed to be an Express Response. In our
        // mount configuration it IS the same object Express handed to
        // us, so writeInterstitial works. Guard anyway: if res was
        // already destroyed (client disconnected mid-error), bail.
        const expressRes = res as Response;
        if (!expressRes || (expressRes as unknown as { writableEnded?: boolean }).writableEnded) {
          return;
        }
        const expressReq = req as Request;
        const hostHeader = expressReq.headers.host ?? "";
        const originalUrl = hostHeader
          ? `https://${hostHeader}${expressReq.originalUrl ?? ""}`
          : (expressReq.originalUrl ?? "");
        const result = renderInterstitial(errorClass, target, originalUrl, PRIMARY_DOMAIN);
        writeInterstitial(expressRes, result);
      },
    },
  });

  proxyCache.set(cacheKey, middleware);
  return middleware;
}
