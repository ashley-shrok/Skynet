/**
 * Phase 103 Plan 05 Task 2 — serveUrlHandler.
 *
 * Runs AFTER subdomain-dispatch has attached `req.serveTarget`. Composes:
 *   tunnelCache.getOrCreate(target)  → tunnelPort (SSH tunnel setup)
 *   getOrCreateProxyForTarget(target, tunnelPort) → RequestHandler
 *   handler(req, res, next)          → http-proxy-middleware does the rest
 *                                       (HTTP + WS + streaming body)
 *
 * On tunnel errors, classifies via the D-14 error taxonomy and renders a
 * Skynet-styled interstitial (does NOT propagate a raw 502 to the browser).
 *
 * MUST NOT re-invoke the auth manager or permission manager here —
 * subdomain-dispatch already validated JWT + canAccessHost per D-03.
 *
 * ---
 *
 * FAIL-LOUD env enforcement (W4 + D-23):
 *
 * Module-load reads `process.env.SKYNET_COOKIE_DOMAIN`. If unset, THROWS.
 * NO hardcoded 'term.gigaashley.click' fallback — t1000 sets its own,
 * T800 sets its own. Same source-of-truth as subdomain-dispatch.ts —
 * kept as a duplicate module-load throw here (rather than routing through
 * a shared config module) because both files independently need to fail
 * loud, and a shared helper would just add indirection.
 *
 * ---
 *
 * Info-leak invariant (T-40-05):
 *
 * - `classifyTunnelError` uses ONLY err.code / err.level / err.name for
 *   discrimination — NEVER the raw Error text body or stack.
 * - Log context carries { errorClass, target, duration } — never the
 *   underlying Error text body.
 * - Interstitial bodies carry only the classified sentence + hostname + port
 *   (per interstitial.ts's renderInterstitial signature which structurally
 *   forbids passing an Error).
 */

import type { Request, Response, NextFunction } from "express";
import { tunnelCache } from "./tunnel-cache.js";
import { getOrCreateProxyForTarget } from "./proxy-factory.js";
import { renderInterstitial, writeInterstitial } from "./interstitial.js";
import { sshLogger } from "../utils/logger.js";
import type { ServeTarget, ErrorClass } from "./types.js";

/* ------------------------------------------------------------------------ */
/*  Module-load fail-loud env check (W4 / D-23)                              */
/* ------------------------------------------------------------------------ */

const PRIMARY_DOMAIN = (() => {
  const value = process.env.SKYNET_COOKIE_DOMAIN;
  if (!value) {
    throw new Error(
      "serve-url serve-route: SKYNET_COOKIE_DOMAIN env var is required " +
        "(per D-23; no hardcoded fallback — fail-loud per W4)",
    );
  }
  return value;
})();

/* ------------------------------------------------------------------------ */
/*  Types                                                                   */
/* ------------------------------------------------------------------------ */

type ServeRouteRequest = Request & {
  serveTarget?: ServeTarget;
};

/**
 * Structural shape used for error classification. Node's net + ssh2 errors
 * carry `code` (strings like ECONNREFUSED) and/or `level` (ssh2's
 * client-authentication / protocol / etc.). We probe these without
 * requiring an Error subtype hierarchy.
 */
type ClassifiableError = {
  code?: string;
  level?: string;
  name?: string;
};

/* ------------------------------------------------------------------------ */
/*  Error classification                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Classify a tunnel-open error into one of the four non-auth D-14 failure
 * classes. Discriminates via structured fields ONLY (code / level / name);
 * never touches the Error body text or stack traces so classification
 * cannot become an info-leak channel.
 *
 * Categories:
 *  - ECONNREFUSED               → port_not_listening (agent's port isn't
 *                                 accepting connections; SSH tunnel opened
 *                                 but forwardOut got refused at target).
 *  - ETIMEDOUT / EHOSTUNREACH / → host_unreachable (network flap, target
 *    ENETUNREACH                  reboot, DNS, or the SSH connect never
 *                                 completed).
 *  - ssh2 client-authentication → ssh_failure (auth mismatch — bad key,
 *    or SSH_* code family or        wrong username, sshd rejected).
 *    ssh2 ClientError name
 *  - Anything else              → ssh_failure (default catchall — the
 *                                 tunnel machinery itself hiccuped; safer
 *                                 to surface as an SSH-level failure than
 *                                 pretend the target is offline).
 */
function classifyTunnelError(err: unknown): ErrorClass {
  const e = (err ?? {}) as ClassifiableError;
  const code = typeof e.code === "string" ? e.code : "";
  const level = typeof e.level === "string" ? e.level : "";
  const name = typeof e.name === "string" ? e.name : "";

  if (code === "ECONNREFUSED") return "port_not_listening";
  if (code === "ETIMEDOUT" || code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return "host_unreachable";
  }
  if (level === "client-authentication") return "ssh_failure";
  if (code.startsWith("SSH_")) return "ssh_failure";
  if (name === "ClientError") return "ssh_failure";
  return "ssh_failure";
}

/* ------------------------------------------------------------------------ */
/*  Handler                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * serveUrlHandler — consumed by database.ts's middleware chain immediately
 * after createSubdomainDispatchMiddleware(). If dispatch attached a
 * ServeTarget, we open (or reuse) a tunnel and proxy. Otherwise we
 * fall-through to the next middleware.
 */
export async function serveUrlHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const routeReq = req as ServeRouteRequest;
  const target = routeReq.serveTarget;
  if (!target) {
    // Defensive fall-through: dispatch chose not to attach a target
    // (unknown/missing subdomain — request is for the primary Skynet
    // frontend), or the mount order is wrong. Either way, hand off.
    return next();
  }

  const startEpoch = Date.now();
  const cacheKey = `${target.hostname}:${target.port}`;

  // Wire the success log BEFORE invoking the proxy middleware — the
  // http-proxy-middleware handler will pipe request → upstream → response
  // asynchronously, so the listener must be attached before dispatch or a
  // fast-completing response could fire finish before we register.
  res.on("finish", () => {
    sshLogger.info("serve-url proxy: ok", {
      operation: "serve_url_proxy",
      target: cacheKey,
      status: res.statusCode,
      duration: Date.now() - startEpoch,
    });
  });

  let tunnelPort: number;
  try {
    const instance = await tunnelCache.getOrCreate(target);
    tunnelPort = instance.tunnelPort;
  } catch (err) {
    const errorClass = classifyTunnelError(err);
    sshLogger.warn("serve-url proxy: tunnel-error", {
      operation: "serve_url_proxy",
      target: cacheKey,
      errorClass,
      duration: Date.now() - startEpoch,
    });
    // Compute originalUrl for the "Try again" anchor. The Host header
    // reflects Caddy's forwarded {host}, matching what the browser
    // requested. Fall back to a domain-less URL if Host is absent (test
    // environments).
    const hostHeader = req.headers.host ?? "";
    const originalUrl = hostHeader
      ? `https://${hostHeader}${req.originalUrl}`
      : req.originalUrl;
    const result = renderInterstitial(
      errorClass,
      target,
      originalUrl,
      PRIMARY_DOMAIN,
    );
    writeInterstitial(res, result);
    return;
  }

  // Tunnel is up. Hand the request to http-proxy-middleware. The
  // middleware is cached per (target, tunnelPort) in proxy-factory so
  // repeated requests to the same target reuse the same instance (required
  // per R&D GOTCHA 2). It handles HTTP + WS upgrade + streaming from here.
  const proxyMiddleware = getOrCreateProxyForTarget(target, tunnelPort);
  proxyMiddleware(req, res, next);
}
