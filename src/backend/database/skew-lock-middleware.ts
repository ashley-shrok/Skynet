/**
 * Phase 111 SKEW-05: server-side skew-lock middleware.
 *
 * Stamps every HTTP response with `X-Skynet-Server-Build: <SERVER_BUILD_ID>`
 * and refuses any request whose `X-Skynet-Client-Build` header is present-
 * and-mismatched with the server's build (D-06 mismatch-only refusal —
 * absence passes through, preserving non-browser callers such as the fleet
 * substrate distributor, agent scripting, and curl testing).
 *
 * Dev-mode escape hatch (SKEW-13): when `NODE_ENV !== "production"`, refusal
 * is skipped but response stamping still fires. This prevents `npm run dev`
 * workflows from 409'ing themselves the instant the Vite dev build's tag
 * diverges from the running backend's tag.
 *
 * Placement in the Express chain lives in database.ts between the
 * subdomain-dispatch/serveUrlHandler pair and the bodyParser mounts:
 *   - AFTER serveUrlHandler so Phase 103 *.serve.term.<domain> traffic
 *     bypasses the skew check entirely (Pitfall 7 in RESEARCH.md).
 *   - BEFORE bodyParser.* so the check is header-only and cheap.
 *
 * The middleware is a FACTORY (`createSkewLockMiddleware()`) so
 * `SERVER_BUILD_ID` is captured once at factory-call time — no per-request
 * env read. This aligns with the D-16 read-once contract established in
 * Plan 01's server-build-id.ts.
 *
 * Structured log discipline: on refusal, the middleware logs via `apiLogger`
 * with explicit fields (operation, clientBuild, serverBuild, method, url).
 * The clientBuild field is truncated to <= 32 chars + "..." marker per the
 * V5 hardening in RESEARCH.md's Security Domain (log-flood defense). The
 * response body echoes the raw value untruncated — the response is consumed
 * by exactly one caller and does not flood any log store.
 */

import type { Request, Response, NextFunction } from "express";
import { getServerBuildId } from "../config/server-build-id.js";
import { apiLogger } from "../utils/logger.js";

const CLIENT_BUILD_LOG_CAP = 32;

export function createSkewLockMiddleware() {
  const serverBuild = getServerBuildId();

  return function skewLockMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    // Always stamp the response first — clients rely on the header for
    // out-of-band drift detection (D-01 lane B: response tag mismatch).
    res.setHeader("X-Skynet-Server-Build", serverBuild);

    // Client tag arrives via header (default for axios / stampedFetch / WS
    // clients) OR via a `build` query param (EventSource — the browser's
    // SSE API has no way to attach a custom header, so URL-param is the only
    // in-band channel available for that lane).
    const headerRaw = req.headers["x-skynet-client-build"];
    // Express typing is `string | string[] | undefined`. Array-typed headers
    // are non-browser behavior — treat as absence (fail-open, D-06 spirit).
    const headerVal = typeof headerRaw === "string" ? headerRaw : null;
    const queryRaw = (req.query as Record<string, unknown> | undefined)?.build;
    const queryVal = typeof queryRaw === "string" ? queryRaw : null;
    const clientBuild = headerVal ?? queryVal;

    if (clientBuild === null || clientBuild === serverBuild) {
      // D-06: absence and match both pass through.
      next();
      return;
    }

    // Mismatch — refuse. Truncate the client value in the log payload
    // to defend against log-flood via long crafted headers (V5).
    const clientBuildForLog =
      clientBuild.length > CLIENT_BUILD_LOG_CAP
        ? clientBuild.slice(0, CLIENT_BUILD_LOG_CAP) + "..."
        : clientBuild;

    apiLogger.warn("Rejected stale client request", {
      operation: "skew_lock_stale_client_refused",
      clientBuild: clientBuildForLog,
      serverBuild,
      method: req.method,
      url: req.url,
    });

    res.status(409).json({
      error: "stale_client",
      clientBuild,
      serverBuild,
    });
  };
}
