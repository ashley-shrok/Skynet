/**
 * Phase 137 Plan 03 Task 1 — Interactive-message pane router.
 *
 * This module is a near-verbatim sibling of app-pane-router.ts.
 * All auth / access / CSRF / resolve / interstitial machinery is REUSED
 * VERBATIM. The three semantic differences from apps:
 *   (a) URL prefix is /interactive/ not /apps/;
 *   (b) registry lookup is getWidgetSnapshot() not getAppSnapshot();
 *   (c) Cache-key disambiguation is via target.port range separation
 *       (9501-9599 apps vs 9601-9699 widgets) — NOT via slug prefix.
 *       The factory's cache key already includes target.port, which
 *       differs between apps and widgets, so passing bare slug is safe
 *       (see RESEARCH Pitfall 1 resolution + Option A(ii)).
 *
 * ---
 *
 * D-decisions covered (same as app-pane-router.ts):
 *
 *   - D-08 parallel — mounted at `/interactive` in database.ts (D-08.2).
 *   - D-09 — getOrCreateAppPaneProxyForTarget reused verbatim.
 *   - D-10 — target resolution via shared SSH tunnel cache (resolvePaneTarget).
 *   - D-12 — checkHostAccess RBAC gate; failure produces info-leak-safe 403.
 *   - D-13 — appProxyCsrfCheck gates state-changing requests.
 *   - D-17 — tunnel errors → classifyTunnelError + renderInterstitial.
 *
 * ---
 *
 * Ordering (LOAD-BEARING — DO NOT REORDER):
 *
 *   1. authenticateJWT — know who's asking before any DB / SSH work.
 *   2. APP_SLUG_RE regex — reject malformed slugs before any DB call.
 *   3. hostId positive-integer check — reject malformed IDs.
 *   4. resolveHostById(hostId, userId) — resolve or refuse.
 *   5. checkHostAccess — RBAC gate. Info-leak-safe: same 403 body as (4).
 *   6. appProxyCsrfCheck — cross-origin state-changing refusal.
 *   7. getRegistry().getWidgetSnapshot() — port lookup for (hostId, slug).
 *   8. resolvePaneTarget — SSH tunnel establish (via shared cache) or
 *      classified interstitial on failure.
 *   9. getOrCreateAppPaneProxyForTarget — byte forwarding + response
 *      transform + WS upgrade handoff.
 *
 * ---
 *
 * Info-leak invariant (T-137-03-IL, mirrors T-120-26):
 *
 *   The 403 body for "host unresolvable" (step 4) and for "access denied"
 *   (step 5) is byte-identical ("widget home box unreachable").
 *   The 403 body for CSRF failure (step 6) is DISTINCT because the CSRF
 *   failure mode is client-observable via Origin-header presence anyway.
 *
 * ---
 *
 * Cache-key disambiguation (T-137-03-CC, RESEARCH Pitfall 1, Option A(ii)):
 *
 *   The factory's buildCacheKey is: `${hostname}:${port}::${tunnelPort}::${hostId}:${slug}`.
 *   Apps use port range 9501-9599; widgets use 9601-9699 (Plan 06).
 *   Since target.port is already part of the cache key, an app and a widget
 *   with the same bare slug on the same host NEVER share a cache entry
 *   because their target.port values differ. Bare slug is passed verbatim —
 *   no "im-" prefix needed.
 *
 * ---
 *
 * Non-matching upgrade paths (T-137-03-WS, RESEARCH Pitfall 6):
 *
 *   handleImPaneUpgrade returns SILENTLY on non-matching URLs (does NOT
 *   destroy the socket). The combined dispatcher in database.ts owns the
 *   destroy-on-no-match branch once BOTH handlers are wired.
 *
 * ---
 *
 * Anti-clickjacking (T-137-03-CJ, mirrors T-120-30):
 *
 *   X-Frame-Options: SAMEORIGIN + CSP frame-ancestors 'self' are set
 *   BEFORE proxy handoff — http-proxy-middleware preserves upstream-set
 *   response headers, so these survive to the client.
 */

import express from "express";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { AuthManager } from "../utils/auth-manager.js";
import { APP_SLUG_RE } from "../claude-session/identity-artifact-reader.js";
import { resolveHostById, checkHostAccess } from "../ssh/host-resolver.js";
import { logger as sshLogger } from "../utils/logger.js";
import { getRegistry } from "../fleet-status/registry-holder.js";
import {
  appProxyCsrfCheck,
  PRIMARY_DOMAIN,
} from "./app-proxy-csrf-check.js";
import { getOrCreateAppPaneProxyForTarget } from "./app-pane-proxy-factory.js";
import { resolvePaneTarget } from "./pane-target-resolver.js";
import { classifyTunnelError } from "../serve-url/error-classifier.js";
import {
  renderInterstitial,
  writeInterstitial,
} from "../serve-url/interstitial.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * Phase 143: when a widget's port lookup misses (torn down, GC'd, or never
 * came up), the pane endpoint used to return a 404 with a JSON error body.
 * Iframes rendered the raw JSON to the user — no error event fires on 404
 * with a response body, so WidgetBubble's retry+expired path never ran.
 *
 * Send small HTML the iframe can render inline instead. Transparent body
 * lets the parent's carded frame supply the surface; reports height so
 * the parent auto-sizes to fit.
 */
function sendExpiredHtml(res: Response, slug: string): Response {
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const safeSlug = JSON.stringify(slug);
  return res.status(404).send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Expired interactive message</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    padding: 12px 14px;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    line-height: 1.4;
    color: rgba(255,255,255,0.7);
  }
  .row { display: flex; align-items: flex-start; gap: 8px; }
  .icon { opacity: 0.7; }
  .title { font-weight: 500; color: rgba(255,255,255,0.85); margin-bottom: 2px; }
  .sub { color: rgba(255,255,255,0.6); font-size: 13px; }
</style>
<script>
  document.addEventListener("DOMContentLoaded", function () {
    try {
      window.parent.postMessage(
        { type: "widget-resize", widgetId: ${safeSlug}, height: Math.ceil(document.documentElement.scrollHeight) },
        window.location.origin
      );
    } catch (e) {}
  });
</script>
</head><body>
<div class="row" role="status" aria-label="Expired interactive message">
  <span class="icon" aria-hidden="true">⏱</span>
  <div>
    <div class="title">This interactive message expired.</div>
    <div class="sub">Ask the agent to send it again if you still need it.</div>
  </div>
</div>
</body></html>`);
}

/**
 * Path-shape regex for `/interactive/:hostId/:slug/pane/*` — used by the
 * WebSocket upgrade dispatcher below. Mirrors PANE_UPGRADE_PATH_RE in
 * app-pane-router.ts with the /interactive/ prefix.
 */
const IM_PANE_UPGRADE_PATH_RE =
  /^\/interactive\/(\d+)\/([a-z0-9-]{1,64})\/pane(\/|$)/;

/**
 * `/interactive/:hostId/:slug/pane/*` — HTTP request handler. `router.all`
 * catches every HTTP method; WebSocket upgrade routing is wired at the
 * `http.Server` level in `database.ts`.
 */
router.all(
  "/:hostId/:slug/pane{/*splat}",
  authenticateJWT,
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as AuthenticatedRequest).userId;

    // (ii) Slug validation — APP_SLUG_RE gate BEFORE any DB / SSH work.
    const slug = String(req.params.slug);
    if (!APP_SLUG_RE.test(slug)) {
      return res
        .status(400)
        .json({ error: "slug must match [a-z0-9-]{1,64}" });
    }

    // (iii) hostId as positive integer.
    const hostIdNum = Number(req.params.hostId);
    if (
      !Number.isFinite(hostIdNum) ||
      !Number.isInteger(hostIdNum) ||
      hostIdNum <= 0
    ) {
      return res
        .status(400)
        .json({ error: "hostId must be a positive integer" });
    }

    // (iv) Host resolution. Info-leak-safe 403 body (T-137-03-IL).
    const host = await resolveHostById(hostIdNum, userId);
    if (!host) {
      sshLogger.warn("im pane: host unresolvable / no access", {
        operation: "im_pane_host_unresolvable",
        hostId: hostIdNum,
        slug,
      });
      return res
        .status(403)
        .json({ error: "widget home box unreachable" });
    }

    // (v) RBAC gate — same 403 body as (iv) to preserve info-leak invariant.
    const allowed = await checkHostAccess(
      hostIdNum,
      userId,
      host.userId,
      "read",
    );
    if (!allowed) {
      return res
        .status(403)
        .json({ error: "widget home box unreachable" });
    }

    // (vi) CSRF gate. Distinct 403 body from (iv)/(v).
    if (!appProxyCsrfCheck(req, PRIMARY_DOMAIN)) {
      return res
        .status(403)
        .json({ error: "cross-origin state-changing request refused" });
    }

    // (vii) Port lookup via getWidgetSnapshot() — NOT getAppSnapshot().
    const registry = getRegistry();
    if (registry === null) {
      sshLogger.warn("im pane: registry holder not populated", {
        operation: "im_pane_registry_missing",
        hostId: hostIdNum,
        slug,
      });
      return res
        .status(503)
        .json({ error: "widget registry not yet available" });
    }
    const hostIdStr = String(hostIdNum);
    const widget = registry
      .getWidgetSnapshot()
      .find((w) => w.hostId === hostIdStr && w.slug === slug);
    if (!widget) {
      return sendExpiredHtml(res, slug);
    }
    if (
      widget.port === null ||
      !Number.isFinite(widget.port) ||
      widget.port <= 0
    ) {
      return sendExpiredHtml(res, slug);
    }
    const port = widget.port;

    // Anti-clickjacking headers (T-137-03-CJ, mirrors T-120-30). Set BEFORE
    // the proxy handoff so they survive to the client.
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");

    // (viii) Target resolution via the shared SSH tunnel cache.
    let tunnelPort: number;
    let target: Awaited<ReturnType<typeof resolvePaneTarget>>["target"];
    try {
      const resolved = await resolvePaneTarget(hostIdNum, host, port);
      target = resolved.target;
      tunnelPort = resolved.tunnelPort;
    } catch (err) {
      const errorClass = classifyTunnelError(err);
      const e = (err ?? {}) as {
        code?: string;
        name?: string;
        level?: string;
      };
      sshLogger.warn("im pane: tunnel-error", {
        operation: "im_pane_proxy_tunnel_error",
        hostId: hostIdNum,
        slug,
        errorClass,
        errCode: typeof e.code === "string" ? e.code : "",
        errName: typeof e.name === "string" ? e.name : "",
        errLevel: typeof e.level === "string" ? e.level : "",
      });
      const hostHeader = req.headers.host ?? "";
      const originalUrl = hostHeader
        ? `https://${hostHeader}${req.originalUrl}`
        : req.originalUrl;
      const stubTarget = {
        hostname: host.name,
        port,
        host,
      };
      writeInterstitial(
        res,
        renderInterstitial(errorClass, stubTarget, originalUrl, PRIMARY_DOMAIN),
      );
      return;
    }

    // (ix) Proxy handoff.
    // Phase 137: the factory's cache key includes target.port, which differs
    // between apps (9501-9599) and widgets (9601-9699) — see
    // substrate/skills/interactive-messages/create-widget.sh port range (Plan 06).
    // Passing bare `slug` here is safe because no app+widget on the same host
    // can share the same tunnelPort+target.port pair.
    const proxyMiddleware = getOrCreateAppPaneProxyForTarget(
      target,
      tunnelPort,
      hostIdNum,
      slug,
    );
    proxyMiddleware(req, res, next);
  },
);

export const imPaneRouter = router;

/* ------------------------------------------------------------------------ */
/*  WebSocket upgrade dispatcher for /interactive/:hostId/:slug/pane/*       */
/* ------------------------------------------------------------------------ */

/**
 * Extract the JWT token from an upgrade request's Cookie header.
 * Verbatim copy from app-pane-router.ts.
 */
function extractJwtFromUpgradeReq(req: IncomingMessage): string | null {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0) {
    const auth = req.headers.authorization;
    if (typeof auth === "string" && auth.startsWith("Bearer ")) {
      return auth.slice("Bearer ".length);
    }
    return null;
  }
  const parts = cookieHeader.split(";");
  for (const raw of parts) {
    const trimmed = raw.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (name === "jwt") return value;
  }
  return null;
}

/**
 * Write a bare HTTP response on a raw upgrade socket and destroy it.
 * Verbatim copy from app-pane-router.ts.
 */
function rejectUpgrade(
  socket: Socket,
  statusLine: string,
  extraHeaders?: string,
): void {
  try {
    const suffix = extraHeaders ? `${extraHeaders}\r\n` : "";
    socket.write(`${statusLine}\r\n${suffix}\r\n`);
  } catch {
    /* socket may already be broken */
  }
  try {
    socket.destroy();
  } catch {
    /* ignore */
  }
}

/**
 * WebSocket upgrade dispatcher for `/interactive/:hostId/:slug/pane/*`.
 * Wired to `httpServer.on("upgrade", ...)` in database.ts alongside
 * `handleAppPaneUpgrade`.
 *
 * Runs the SAME auth + slug/hostId validation + host resolve + checkHostAccess
 * + appProxyCsrfCheck + port lookup + target resolve chain as the HTTP route,
 * then calls the proxy middleware's `.upgrade(req, socket, head)` method.
 *
 * Non-matching upgrade paths return SILENTLY — the combined dispatcher in
 * database.ts owns the destroy-on-no-match branch when this handler coexists
 * with handleAppPaneUpgrade (RESEARCH Pitfall 6). This is the KEY difference
 * from handleAppPaneUpgrade's non-match branch, which destroyed the socket
 * when it was the only registered handler.
 *
 * Every failure branch writes a bare status-line + destroys the socket.
 * Info-leak invariant (T-137-03-IL) holds trivially on the WS path since
 * upgrade rejections carry no visible body.
 */
export async function handleImPaneUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): Promise<void> {
  try {
    const url = req.url ?? "";
    const match = IM_PANE_UPGRADE_PATH_RE.exec(url);
    if (!match) {
      // Phase 137 RESEARCH Pitfall 6: NON-MATCHING upgrade paths MUST return
      // silently without touching the socket. The combined dispatcher in
      // database.ts owns the destroy-on-no-match branch. Unlike
      // handleAppPaneUpgrade's legacy internal destroy-on-non-match branch
      // (HIGH-3 fix, 2026-09-19), this handler coexists with another upgrade
      // handler (handleAppPaneUpgrade), so it must not claim ownership of
      // unrecognized paths.
      return;
    }
    const hostIdStr = match[1];
    const slug = match[2];
    const hostIdNum = Number(hostIdStr);
    if (
      !Number.isFinite(hostIdNum) ||
      !Number.isInteger(hostIdNum) ||
      hostIdNum <= 0
    ) {
      rejectUpgrade(socket, "HTTP/1.1 400 Bad Request");
      return;
    }
    if (!APP_SLUG_RE.test(slug)) {
      rejectUpgrade(socket, "HTTP/1.1 400 Bad Request");
      return;
    }

    // Auth — same as handleAppPaneUpgrade.
    const token = extractJwtFromUpgradeReq(req);
    if (!token) {
      rejectUpgrade(socket, "HTTP/1.1 401 Unauthorized");
      return;
    }
    const payload = await authManager.verifyJWTToken(token);
    if (!payload) {
      rejectUpgrade(socket, "HTTP/1.1 401 Unauthorized");
      return;
    }
    const userId = payload.userId;
    if (typeof userId !== "string" || userId.length === 0) {
      rejectUpgrade(socket, "HTTP/1.1 401 Unauthorized");
      return;
    }

    // Host resolve — same info-leak invariant as HTTP path.
    const host = await resolveHostById(hostIdNum, userId);
    if (!host) {
      sshLogger.warn("im pane WS: host unresolvable / no access", {
        operation: "im_pane_ws_host_unresolvable",
        hostId: hostIdNum,
        slug,
      });
      rejectUpgrade(socket, "HTTP/1.1 403 Forbidden");
      return;
    }
    const allowed = await checkHostAccess(
      hostIdNum,
      userId,
      host.userId,
      "read",
    );
    if (!allowed) {
      rejectUpgrade(socket, "HTTP/1.1 403 Forbidden");
      return;
    }

    // CSRF gate — same shape as handleAppPaneUpgrade.
    // Origin: "null" accepted per referrerPolicy=no-referrer (same carve-out
    // as app-pane-router.ts WS path).
    const originHeader = req.headers.origin;
    if (typeof originHeader !== "string" || originHeader.length === 0) {
      rejectUpgrade(
        socket,
        "HTTP/1.1 403 Forbidden",
        "X-Skynet-Reason: cross-origin",
      );
      return;
    }
    if (originHeader !== "null") {
      let originHostname: string;
      try {
        originHostname = new URL(originHeader).hostname;
      } catch {
        rejectUpgrade(
          socket,
          "HTTP/1.1 403 Forbidden",
          "X-Skynet-Reason: cross-origin",
        );
        return;
      }
      if (originHostname.length === 0 || originHostname !== PRIMARY_DOMAIN) {
        rejectUpgrade(
          socket,
          "HTTP/1.1 403 Forbidden",
          "X-Skynet-Reason: cross-origin",
        );
        return;
      }
    }

    // Port lookup via getWidgetSnapshot().
    const registry = getRegistry();
    if (registry === null) {
      sshLogger.warn("im pane WS: registry holder not populated", {
        operation: "im_pane_ws_registry_missing",
        hostId: hostIdNum,
        slug,
      });
      rejectUpgrade(socket, "HTTP/1.1 503 Service Unavailable");
      return;
    }
    const widget = registry
      .getWidgetSnapshot()
      .find((w) => w.hostId === String(hostIdNum) && w.slug === slug);
    if (!widget) {
      rejectUpgrade(socket, "HTTP/1.1 404 Not Found");
      return;
    }
    if (
      widget.port === null ||
      !Number.isFinite(widget.port) ||
      widget.port <= 0
    ) {
      rejectUpgrade(socket, "HTTP/1.1 404 Not Found");
      return;
    }
    const port = widget.port;

    // Target resolve.
    let tunnelPort: number;
    let target: Awaited<ReturnType<typeof resolvePaneTarget>>["target"];
    try {
      const resolved = await resolvePaneTarget(hostIdNum, host, port);
      target = resolved.target;
      tunnelPort = resolved.tunnelPort;
    } catch (err) {
      const errorClass = classifyTunnelError(err);
      sshLogger.warn("im pane WS: tunnel-error", {
        operation: "im_pane_ws_tunnel_error",
        hostId: hostIdNum,
        slug,
        errorClass,
      });
      rejectUpgrade(socket, "HTTP/1.1 502 Bad Gateway");
      return;
    }

    // Proxy handoff — same cache key disambiguation as HTTP path.
    // Phase 137: target.port (9601-9699 widget range) ensures cache separation
    // from apps (9501-9599). Bare slug passed verbatim.
    const proxyMiddleware = getOrCreateAppPaneProxyForTarget(
      target,
      tunnelPort,
      hostIdNum,
      slug,
    ) as unknown as {
      upgrade?: (req: IncomingMessage, socket: Socket, head: Buffer) => void;
    };
    if (typeof proxyMiddleware.upgrade === "function") {
      proxyMiddleware.upgrade(req, socket, head);
    } else {
      rejectUpgrade(socket, "HTTP/1.1 500 Internal Server Error");
    }
  } catch (err) {
    sshLogger.warn("im pane WS upgrade error", {
      operation: "im_pane_ws_upgrade_error",
      errName: err instanceof Error ? err.name : "unknown",
    });
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  }
}
