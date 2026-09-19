/**
 * Phase 120 Plan 05 Task 1 — App-pane router.
 *
 * Composes the Wave 1 leaves + Wave 2 factory/resolver into the
 * `/apps/:hostId/:slug/pane/*` proxy route (D-08). Mounted at the /apps
 * prefix in `src/backend/database/database.ts` alongside Phase 119's
 * icon endpoint (three routes coexist cleanly under `/apps/:hostId/:slug`:
 * `/icon` (Phase 119), `/` (Phase 119 redirect), `/pane/*` (this phase)).
 *
 * ---
 *
 * D-decisions covered:
 *
 *   - D-08 — the route itself, mounted at `/apps` in database.ts.
 *   - D-09 — the app-pane proxy factory (sibling of serve-url/proxy-factory.ts)
 *            is used verbatim; the shared factory is NOT reused.
 *   - D-10 — target resolution routes through `resolvePaneTarget` which
 *            unconditionally uses the shared SSH tunnel cache.
 *   - D-12 — `checkHostAccess(hostId, userId, host.userId, "read")` is
 *            invoked at the route entrypoint; failure produces an
 *            info-leak-safe 403 identical to the "host unresolvable" body.
 *   - D-13 — `appProxyCsrfCheck(req, PRIMARY_DOMAIN)` gates state-changing
 *            requests before any tunnel work.
 *   - D-17 — tunnel errors flow through `classifyTunnelError` +
 *            `renderInterstitial` + `writeInterstitial` — the same shared
 *            error surface Phase 103's serve-url layer uses.
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
 *   7. getRegistry().getAppSnapshot() — port lookup for this (hostId, slug).
 *   8. resolvePaneTarget — SSH tunnel establish (via shared cache) or
 *      classified interstitial on failure.
 *   9. getOrCreateAppPaneProxyForTarget — byte forwarding + response
 *      transform + WS upgrade handoff.
 *
 * ---
 *
 * Info-leak invariant (T-120-26):
 *
 *   The 403 body for "host unresolvable" (step 4) and for "access denied"
 *   (step 5) is byte-identical (see the two identical json refusals below).
 *   The 403 body for CSRF failure (step 6) is DISTINCT because the CSRF
 *   failure mode is client-observable via Origin-header presence anyway;
 *   the caller learns that CSRF failed but nothing about whether the
 *   host+app exists.
 *
 * ---
 *
 * WebSocket upgrades:
 *
 *   `router.all("/...", ...)` catches HTTP methods only. WebSocket
 *   upgrade events fire on the `http.Server` `"upgrade"` event BEFORE
 *   any Express dispatch. Task 3 wires an `httpServer.on("upgrade", ...)`
 *   handler in database.ts that repeats the SAME auth + validation +
 *   access + CSRF + port + target chain before invoking the proxy
 *   middleware's `.upgrade(req, socket, head)` method. This module owns
 *   the HTTP path only.
 *
 * ---
 *
 * Anti-clickjacking (T-120-30):
 *
 *   Skynet's nginx edge does NOT set X-Frame-Options / CSP frame-ancestors
 *   on `/apps/*` responses (verified 2026-09-19 — no such directive in
 *   docker/nginx.conf or docker/nginx-https.conf). This module sets both
 *   headers explicitly at the response layer BEFORE handing off to the
 *   proxy — the http-proxy-middleware pipeline preserves upstream-set
 *   response headers, so the anti-frame headers survive to the client.
 */

import express from "express";
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
 * `/apps/:hostId/:slug/pane/*` — HTTP request handler. `router.all`
 * catches every HTTP method; WebSocket upgrade routing is wired at the
 * `http.Server` level in `database.ts` (Task 3(f)).
 */
router.all(
  "/:hostId/:slug/pane/*",
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

    // (iv) Host resolution. resolveHostById returns null for BOTH "hostId
    // doesn't exist" AND "user has no access" — info-leak-safe 403 body.
    const host = await resolveHostById(hostIdNum, userId);
    if (!host) {
      sshLogger.warn("app pane: host unresolvable / no access", {
        operation: "apps_pane_host_unresolvable",
        hostId: hostIdNum,
        slug,
      });
      return res
        .status(403)
        .json({ error: "app home box unreachable" });
    }

    // (v) RBAC gate (D-12) — Phase 118 canonical `checkHostAccess`.
    // Same 403 body as (iv) to preserve info-leak invariant (T-120-26).
    const allowed = await checkHostAccess(
      hostIdNum,
      userId,
      host.userId,
      "read",
    );
    if (!allowed) {
      return res
        .status(403)
        .json({ error: "app home box unreachable" });
    }

    // (vi) CSRF gate (D-13). Distinct 403 body from (iv)/(v) — the CSRF
    // failure mode is client-observable via Origin-header presence
    // anyway; the caller learns that CSRF failed but nothing about
    // whether the host+app exists. The helper itself short-circuits on
    // safe HTTP methods (GET/HEAD/OPTIONS) so the call is unconditional.
    if (!appProxyCsrfCheck(req, PRIMARY_DOMAIN)) {
      return res
        .status(403)
        .json({ error: "cross-origin state-changing request refused" });
    }

    // (vii) Port lookup. The fleet-status registry is populated by the
    // 2s ssh-poll-orchestrator sweep. AppState.hostId is a STRING on the
    // wire (see wire-protocol.ts + ui/api/fleet-status-types.ts:136).
    const registry = getRegistry();
    if (registry === null) {
      // Boot-order guard: the registry-holder is set during starter.ts's
      // boot sequence BEFORE Express begins accepting HTTP traffic. If
      // this branch fires at steady state, boot ordering has regressed.
      sshLogger.warn("app pane: registry holder not populated", {
        operation: "apps_pane_registry_missing",
        hostId: hostIdNum,
        slug,
      });
      return res
        .status(503)
        .json({ error: "app registry not yet available" });
    }
    const hostIdStr = String(hostIdNum);
    const app = registry
      .getAppSnapshot()
      .find((a) => a.hostId === hostIdStr && a.slug === slug);
    if (!app) {
      return res
        .status(404)
        .json({ error: "app is not currently serving on a port" });
    }
    if (app.port === null || !Number.isFinite(app.port) || app.port <= 0) {
      return res
        .status(404)
        .json({ error: "app is not currently serving on a port" });
    }
    const port = app.port;

    // Anti-clickjacking headers (T-120-30, Task 3(g)). Set BEFORE the
    // proxy handoff — http-proxy-middleware preserves upstream-set
    // outgoing response headers, so these survive to the client. No
    // existing rule in docker/nginx.conf* covers /apps/*.
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");

    // (viii) Target resolution via the shared SSH tunnel cache
    // (D-10 as amended by Q1 RESOLVED — always tunnel). Tunnel-time
    // errors are caught here and rendered via the shared interstitial
    // (D-17). Proxy-time errors (upstream port stops mid-request) fire
    // via the factory's on.error hook — the two error surfaces do not
    // overlap.
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
      sshLogger.warn("app pane: tunnel-error", {
        operation: "apps_pane_proxy_tunnel_error",
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
      // Build a stub ServeTarget for the interstitial renderer — it only
      // reads .hostname + .port, never .host, on failure branches.
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

    // (ix) Proxy handoff. Factory returns a cached RequestHandler keyed
    // on (hostname, port, tunnelPort, hostId, slug); the middleware
    // handles byte-forwarding, response transform (base-tag injection
    // on text/html), and proxy-time errors from here on.
    const proxyMiddleware = getOrCreateAppPaneProxyForTarget(
      target,
      tunnelPort,
      hostIdNum,
      slug,
    );
    proxyMiddleware(req, res, next);
  },
);

export const appPaneRouter = router;
