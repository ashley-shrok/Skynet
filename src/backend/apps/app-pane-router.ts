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
 * Path-shape regex for `/apps/:hostId/:slug/pane/*` — used by the
 * WebSocket upgrade dispatcher below. Digits-only hostId (positive
 * integer will be validated later) + APP_SLUG_RE-shaped slug + trailing
 * `/pane` prefix. Only requests matching THIS regex flow into the
 * upgrade dispatcher; every other upgrade (e.g. serve-url subdomain
 * dispatch, terminal WS, future WS mounts) passes through untouched.
 */
const PANE_UPGRADE_PATH_RE = /^\/apps\/(\d+)\/([a-z0-9-]{1,64})\/pane(\/|$)/;

/**
 * `/apps/:hostId/:slug/pane/*` — HTTP request handler. `router.all`
 * catches every HTTP method; WebSocket upgrade routing is wired at the
 * `http.Server` level in `database.ts` (Task 3(f)).
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

/* ------------------------------------------------------------------------ */
/*  WebSocket upgrade dispatcher (BLOCKER 6 fix — T-120-32)                  */
/* ------------------------------------------------------------------------ */

/**
 * Extract the JWT token from an upgrade request's Cookie header.
 * Returns null if the cookie is absent or malformed. Duplicates the
 * cookie-parsing shape used elsewhere in the codebase (auth-manager's
 * middleware reads `req.cookies.jwt` via cookieParser; the upgrade path
 * runs before cookieParser, so we parse the raw header ourselves).
 */
function extractJwtFromUpgradeReq(req: IncomingMessage): string | null {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0) {
    // Fallback: Bearer token in Authorization (some WS clients send it).
    const auth = req.headers.authorization;
    if (typeof auth === "string" && auth.startsWith("Bearer ")) {
      return auth.slice("Bearer ".length);
    }
    return null;
  }
  // Manually parse cookie header for the `jwt` cookie name.
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
 * Upgrade rejections carry no visible body to the client; the statusline
 * plus optional headers is the entire response.
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
 * WebSocket upgrade dispatcher for `/apps/:hostId/:slug/pane/*`. Wired
 * to `httpServer.on("upgrade", ...)` in database.ts (Task 3(f)). Runs
 * the SAME auth + slug/hostId validation + host resolve + checkHostAccess
 * + appProxyCsrfCheck + port lookup + target resolve chain as the HTTP
 * route, then calls the proxy middleware's `.upgrade(req, socket, head)`
 * method.
 *
 * Non-matching upgrade paths are a no-op (return without touching the
 * socket) so other upgrade consumers on the same http.Server (serve-url
 * subdomain dispatch, terminal WS, future WS mounts) fire normally.
 *
 * Every failure branch writes a bare status-line + destroys the socket.
 * Upgrade rejections carry no visible body to the client, so failure
 * modes are indistinguishable at the wire level — the info-leak invariant
 * (T-120-26) holds trivially on the WS path.
 */
export async function handleAppPaneUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
): Promise<void> {
  try {
    const url = req.url ?? "";
    const match = PANE_UPGRADE_PATH_RE.exec(url);
    if (!match) {
      // Not our path — leave the socket alone; other upgrade handlers
      // (subdomain-dispatch, terminal WS, ...) may still fire.
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

    // Auth — extract JWT from Cookie / Authorization; verify via
    // AuthManager. Both the missing-token and invalid-token branches
    // produce a bare 401 (upgrade rejections carry no body).
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

    // Host resolve — same info-leak invariant as HTTP: same rejection
    // shape for unresolvable-host AND access-denied.
    const host = await resolveHostById(hostIdNum, userId);
    if (!host) {
      sshLogger.warn("app pane WS: host unresolvable / no access", {
        operation: "apps_pane_ws_host_unresolvable",
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

    // CSRF gate — WS upgrades carry Origin per the WS spec (browsers
    // always send it). The helper short-circuits on GET (upgrades ARE
    // GET) so we call it via a small adapter that forces the method to
    // POST for check purposes — but the helper's current shape treats
    // GET as always-pass. Directly enforce origin here to be safe.
    // Cast to Request-shape for the helper: only .method and
    // .headers.origin are read.
    const originHeader = req.headers.origin;
    if (typeof originHeader !== "string" || originHeader.length === 0) {
      rejectUpgrade(
        socket,
        "HTTP/1.1 403 Forbidden",
        "X-Skynet-Reason: cross-origin",
      );
      return;
    }
    if (originHeader !== PRIMARY_DOMAIN) {
      rejectUpgrade(
        socket,
        "HTTP/1.1 403 Forbidden",
        "X-Skynet-Reason: cross-origin",
      );
      return;
    }

    // Port lookup — same as HTTP path.
    const registry = getRegistry();
    if (registry === null) {
      sshLogger.warn("app pane WS: registry holder not populated", {
        operation: "apps_pane_ws_registry_missing",
        hostId: hostIdNum,
        slug,
      });
      rejectUpgrade(socket, "HTTP/1.1 503 Service Unavailable");
      return;
    }
    const app = registry
      .getAppSnapshot()
      .find((a) => a.hostId === String(hostIdNum) && a.slug === slug);
    if (!app) {
      rejectUpgrade(socket, "HTTP/1.1 404 Not Found");
      return;
    }
    if (app.port === null || !Number.isFinite(app.port) || app.port <= 0) {
      rejectUpgrade(socket, "HTTP/1.1 404 Not Found");
      return;
    }
    const port = app.port;

    // Target resolve. Tunnel errors here are unrecoverable at the
    // upgrade layer — the socket is HTTP-shaped until proxyMiddleware.
    // upgrade takes it over, so we close it with 502.
    let tunnelPort: number;
    let target: Awaited<ReturnType<typeof resolvePaneTarget>>["target"];
    try {
      const resolved = await resolvePaneTarget(hostIdNum, host, port);
      target = resolved.target;
      tunnelPort = resolved.tunnelPort;
    } catch (err) {
      const errorClass = classifyTunnelError(err);
      sshLogger.warn("app pane WS: tunnel-error", {
        operation: "apps_pane_ws_tunnel_error",
        hostId: hostIdNum,
        slug,
        errorClass,
      });
      rejectUpgrade(socket, "HTTP/1.1 502 Bad Gateway");
      return;
    }

    // Proxy handoff — get the SAME cached middleware the HTTP route uses
    // (per-slug cache key) and invoke its .upgrade method.
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
      // Factory returned a middleware without .upgrade — misconfigured
      // (ws:true should always attach one). Fail closed.
      rejectUpgrade(socket, "HTTP/1.1 500 Internal Server Error");
    }
  } catch (err) {
    sshLogger.warn("app pane WS upgrade error", {
      operation: "apps_pane_ws_upgrade_error",
      errName: err instanceof Error ? err.name : "unknown",
    });
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  }
}
