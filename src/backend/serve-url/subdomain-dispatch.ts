/**
 * Phase 103 Plan 05 Task 1 — Subdomain-dispatch middleware for serve URL.
 *
 * Runs at TOP-OF-STACK in database.ts's middleware chain (AFTER cookieParser,
 * BEFORE bodyParser — per http-proxy-middleware v4 raw-body streaming
 * semantics, and BEFORE any body-consuming middleware so http-proxy-middleware
 * can stream POST bodies through untouched).
 *
 * For every request:
 *  1. Read `X-Skynet-Serve-Subdomain` header (set by Caddy via
 *     `header_up X-Skynet-Serve-Subdomain {host}` per Phase 103 Plan 01
 *     Caddyfile snippet). If absent → next() (fall-through to Skynet's
 *     existing frontend serving; the "no route" experience).
 *  2. Parse `<hostname>-<port>` per D-11: split on LAST dash of leftmost
 *     DNS label; right side must be all-digits (port); everything left is
 *     hostname. Parse failure → interstitial + return.
 *  3. Run JWT auth via AuthManager.createAuthMiddleware(). If it writes
 *     a 401, translate into an auth_missing interstitial (302 redirect to
 *     primary /login?return=<original>). If it calls next(), req.userId
 *     is populated.
 *  4. Resolve host via resolveHostByName(hostname.toLowerCase(), userId)
 *     per D-13 (pre-lowercase at dispatch — preserves display case in DB).
 *     Null → host_unreachable interstitial (info-leak-safe per T-103-23 —
 *     unknown vs offline are indistinguishable).
 *  5. Run permissionManager.canAccessHost(userId, host.id, 'read') per
 *     D-03 + D-17. !hasAccess → permission_denied interstitial (403).
 *  6. Attach `req.serveTarget = { hostname: host.name, port, host }`
 *     (canonical DB-case hostname per D-13) and next(). Plan 05 Task 2's
 *     serveUrlHandler consumes it.
 *
 * ---
 *
 * FAIL-LOUD env enforcement (W4 + D-23):
 *
 * `createSubdomainDispatchMiddleware()` reads `process.env.SKYNET_COOKIE_DOMAIN`
 * at the top of the factory body. If unset, THROWS. NO hardcoded
 * hardcoded-primary-domain fallback — t1000 sets its own value, T800 sets
 * its own value, and any future customer VM sets its own value. If the env is
 * missing at boot, Skynet MUST refuse to boot cleanly (better than silently
 * accepting all traffic under a wrong domain and misrouting cookies /
 * misdirecting auth_missing redirects).
 *
 * ---
 *
 * Info-leak invariant (T-40-05 / T-103-17 / T-103-27):
 *
 *  - Response bodies contain ONLY the classified sentence + hostname + port.
 *  - Logs emit `{ operation, hostname, port, userId }` only — never Error
 *    text bodies, stack fragments, or the raw subdomain string (which is
 *    user-supplied via Host header).
 *  - Parse-failure log emits `{ subdomainLen }` instead of the full string
 *    per T-103-27.
 */

import type { Request, Response, NextFunction } from "express";
import { AuthManager } from "../utils/auth-manager.js";
import { PermissionManager } from "../utils/permission-manager.js";
import { resolveHostByName } from "../ssh/host-resolver.js";
import { renderInterstitial, writeInterstitial } from "./interstitial.js";
import { sshLogger } from "../utils/logger.js";
import type { ServeTarget, ErrorClass } from "./types.js";
import type { Host } from "../../types/index.js";

/* ------------------------------------------------------------------------ */
/*  Types                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Express Request augmented with `userId` (populated by
 * AuthManager.createAuthMiddleware() when auth succeeds) and `serveTarget`
 * (populated by this middleware on the success path so Plan 05 Task 2's
 * serveUrlHandler downstream can consume it).
 */
type ServeDispatchRequest = Request & {
  userId?: string;
  serveTarget?: ServeTarget;
};

/* ------------------------------------------------------------------------ */
/*  Stub target helper for parse/auth/unknown-host interstitials             */
/* ------------------------------------------------------------------------ */

/**
 * Build a minimal ServeTarget stub for interstitials that fire BEFORE
 * host resolution (parse failure, auth_missing, host_unreachable when
 * resolve returns null). The `host` field is a placeholder — the
 * interstitial renderer only reads target.hostname and target.port,
 * NEVER target.host on failure branches.
 */
function stubTarget(hostname: string, port: number): ServeTarget {
  return {
    hostname,
    port,
    host: {
      // Placeholder — never dereferenced on failure branches.
      id: 0,
      name: hostname,
      ip: "",
      port: 0,
      username: "",
      folder: "",
      tags: [],
      pin: false,
      authType: "none",
      enableTerminal: false,
      enableTunnel: false,
      enableFileManager: false,
      enableDocker: false,
      showTerminalInSidebar: false,
      showFileManagerInSidebar: false,
      showTunnelInSidebar: false,
      showDockerInSidebar: false,
      showServerStatsInSidebar: false,
      defaultPath: "",
      tunnelConnections: [],
      createdAt: "",
      updatedAt: "",
    } as Host,
  };
}

/* ------------------------------------------------------------------------ */
/*  Auth-middleware invocation wrapper                                       */
/* ------------------------------------------------------------------------ */

/**
 * Run the AuthManager's JWT middleware and translate its outcome into a
 * discriminated result. If auth succeeds, resolves to {ok: true}. If auth
 * writes a non-2xx response (401 / 403 / etc.), resolves to {ok: false}
 * WITHOUT the response body having been sent to the client — we intercept
 * the res mutation via a proxy so we can render our own interstitial
 * instead of leaking Skynet's JSON auth-error shape onto a serve subdomain.
 */
async function runAuthMiddleware(
  req: ServeDispatchRequest,
  res: Response,
  authMiddleware: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void | Promise<void>,
): Promise<{ ok: true } | { ok: false; status: number }> {
  return new Promise<{ ok: true } | { ok: false; status: number }>((resolve) => {
    let interceptedStatus: number | undefined;
    let settled = false;

    // Proxy res so we intercept the auth middleware's failure-write instead
    // of letting it flush to the network. We ONLY need to observe .status()
    // and .json() to know a failure was written; the actual body never gets
    // sent to the client because we short-circuit before calling res.end.
    const resProxy = new Proxy(res, {
      get(target, prop, receiver) {
        if (prop === "status") {
          return (code: number) => {
            interceptedStatus = code;
            return resProxy;
          };
        }
        if (prop === "clearCookie") {
          // Auth middleware may clear the jwt cookie on invalid token. Let
          // this pass through to the real response (safe — clearing is
          // idempotent, doesn't send a body).
          const orig = Reflect.get(target, prop, receiver) as (
            ...args: unknown[]
          ) => unknown;
          return (...args: unknown[]) => {
            orig.call(target, ...args);
            return resProxy;
          };
        }
        if (prop === "json") {
          return (_body: unknown) => {
            if (!settled) {
              settled = true;
              resolve({
                ok: false,
                status: interceptedStatus ?? 401,
              });
            }
            return resProxy;
          };
        }
        if (prop === "send") {
          return (_body: unknown) => {
            if (!settled) {
              settled = true;
              resolve({
                ok: false,
                status: interceptedStatus ?? 401,
              });
            }
            return resProxy;
          };
        }
        if (prop === "end") {
          return (..._args: unknown[]) => {
            if (!settled) {
              settled = true;
              resolve({
                ok: false,
                status: interceptedStatus ?? 401,
              });
            }
            return resProxy;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        return Reflect.set(target, prop, value, receiver);
      },
    });

    const next: NextFunction = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) {
        resolve({ ok: false, status: 500 });
        return;
      }
      resolve({ ok: true });
    };

    try {
      const maybePromise = authMiddleware(req, resProxy, next);
      if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
        (maybePromise as Promise<unknown>).catch(() => {
          if (!settled) {
            settled = true;
            resolve({ ok: false, status: 500 });
          }
        });
      }
    } catch {
      if (!settled) {
        settled = true;
        resolve({ ok: false, status: 500 });
      }
    }
  });
}

/* ------------------------------------------------------------------------ */
/*  Factory                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Build the subdomain-dispatch Express middleware. THROWS at factory
 * invocation if SKYNET_COOKIE_DOMAIN is unset (fail-loud per W4/D-23 —
 * no silent-wrong hardcoded primary-domain fallback).
 */
export function createSubdomainDispatchMiddleware() {
  const primaryDomain = process.env.SKYNET_COOKIE_DOMAIN;
  if (!primaryDomain) {
    throw new Error(
      "serve-url subdomain-dispatch: SKYNET_COOKIE_DOMAIN env var is required " +
        "(per D-23; each Skynet host sets its own value; no hardcoded fallback)",
    );
  }

  const authManager = AuthManager.getInstance();
  const authMiddleware = authManager.createAuthMiddleware();
  const permissionManager = PermissionManager.getInstance();

  return async function subdomainDispatch(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const dispatchReq = req as ServeDispatchRequest;
    const rawHeader = dispatchReq.headers["x-skynet-serve-subdomain"];

    // 1. Fall-through if header absent or malformed shape.
    if (rawHeader === undefined || Array.isArray(rawHeader)) {
      return next();
    }
    const subdomainHeader = String(rawHeader);

    // Compute originalUrl for interstitial "Try again" anchor + redirect
    // return-param. Uses the raw subdomain header for the Host portion.
    const originalUrl = `https://${subdomainHeader}${dispatchReq.originalUrl}`;

    // 2. Parse per D-11: split on LAST dash of leftmost DNS label.
    const label = subdomainHeader.split(".")[0];
    const lastDash = label.lastIndexOf("-");
    if (lastDash <= 0 || lastDash === label.length - 1) {
      sshLogger.warn("serve-url dispatch: parse-failed", {
        operation: "serve_url_dispatch_parse_failed",
        subdomainLen: subdomainHeader.length,
      });
      const result = renderInterstitial(
        "port_not_listening",
        stubTarget(label, 0),
        originalUrl,
        primaryDomain,
      );
      writeInterstitial(res, result);
      return;
    }
    const portStr = label.slice(lastDash + 1);
    if (!/^\d+$/.test(portStr)) {
      sshLogger.warn("serve-url dispatch: parse-failed", {
        operation: "serve_url_dispatch_parse_failed",
        subdomainLen: subdomainHeader.length,
      });
      const result = renderInterstitial(
        "port_not_listening",
        stubTarget(label.slice(0, lastDash), 0),
        originalUrl,
        primaryDomain,
      );
      writeInterstitial(res, result);
      return;
    }
    const port = Number(portStr);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      sshLogger.warn("serve-url dispatch: parse-failed", {
        operation: "serve_url_dispatch_parse_failed",
        subdomainLen: subdomainHeader.length,
      });
      const result = renderInterstitial(
        "port_not_listening",
        stubTarget(label.slice(0, lastDash), 0),
        originalUrl,
        primaryDomain,
      );
      writeInterstitial(res, result);
      return;
    }
    const hostnameRaw = label.slice(0, lastDash);

    // 3. Run JWT auth. If it writes a 401, translate into auth_missing
    // interstitial (302 redirect to primary /login?return=).
    const authResult = await runAuthMiddleware(dispatchReq, res, authMiddleware);
    if (!authResult.ok) {
      const errorClass: ErrorClass = "auth_missing";
      const result = renderInterstitial(
        errorClass,
        stubTarget(hostnameRaw, port),
        originalUrl,
        primaryDomain,
      );
      writeInterstitial(res, result);
      return;
    }

    const userId = dispatchReq.userId;
    if (!userId) {
      // Auth middleware called next() but did not populate userId — treat as
      // auth_missing (defensive; should not happen with the real
      // AuthManager, but a mock or future refactor might leave this hole).
      const result = renderInterstitial(
        "auth_missing",
        stubTarget(hostnameRaw, port),
        originalUrl,
        primaryDomain,
      );
      writeInterstitial(res, result);
      return;
    }

    // 4. Resolve host per D-13 (pre-lowercase at dispatch; display case
    // preserved on the returned host row for use in Task 6 attach).
    const hostnameLower = hostnameRaw.toLowerCase();
    const host = await resolveHostByName(hostnameLower, userId);
    if (!host) {
      sshLogger.info("serve-url dispatch: unknown-host", {
        operation: "serve_url_dispatch_unknown_host",
        hostname: hostnameLower,
        port,
      });
      const result = renderInterstitial(
        "host_unreachable",
        stubTarget(hostnameRaw, port),
        originalUrl,
        primaryDomain,
      );
      writeInterstitial(res, result);
      return;
    }

    // 5. Per-user-per-host RBAC per D-03 + D-17.
    const accessInfo = await permissionManager.canAccessHost(
      userId,
      host.id,
      "read",
    );
    if (!accessInfo.hasAccess) {
      sshLogger.info("serve-url dispatch: permission-denied", {
        operation: "serve_url_dispatch_permission_denied",
        hostname: hostnameLower,
        port,
        userId,
      });
      const result = renderInterstitial(
        "permission_denied",
        {
          hostname: host.name,
          port,
          host: host as Host,
        },
        originalUrl,
        primaryDomain,
      );
      writeInterstitial(res, result);
      return;
    }

    // 6. Attach ServeTarget + fall through. Task 2's serveUrlHandler picks
    // it up. Use canonical DB display-case hostname per D-13.
    dispatchReq.serveTarget = {
      hostname: host.name,
      port,
      host: host as Host,
    };
    next();
  };
}
