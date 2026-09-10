/**
 * Phase 103 D-10: multipart/form-data POSTs are CORS-simple (don't preflight).
 * Widening the JWT cookie to term.<domain> (Plan 02 D-02) means a page at
 * *.serve.term.<domain> can drive a multipart POST to term.<domain> with the
 * user's cookie. This module rejects such requests explicitly by Origin header.
 *
 * Reuses SERVE_SUBDOMAIN_ORIGIN_RE via isServeSubdomainOrigin from
 * ws-origin-guard.ts (single source of truth for the serve-subdomain pattern).
 *
 * Two shapes are exported:
 *   (1) multipartOriginGuard — Express middleware. Preferred for
 *       router.post(path, multipartOriginGuard, multerOrOtherParsers, handler)
 *       chains. Runs BEFORE multer so a rejected request never buffers bytes.
 *   (2) assertNotServeSubdomainOrigin — imperative helper for handlers not
 *       using middleware composition. Throws a 403-tagged Error the caller
 *       maps to res.status(403).json(...).
 *
 * Threat model refs: T-103-36 (multipart CSRF from serve subdomain),
 * T-103-37 (form-urlencoded CSRF — same guard applies), T-103-39
 * (repudiation — every reject logs at warn level with { operation, origin,
 * path }).
 *
 * Info-leak invariant T-40-05: the response body carries only the classified
 * sentence, never err.message or user-supplied bytes.
 */

import type { Request, Response, NextFunction } from "express";
import { isServeSubdomainOrigin } from "./ws-origin-guard.js";
import { sshLogger } from "./logger.js";

const REJECT_STATUS = 403;
const REJECT_ERROR_MESSAGE = "Origin not permitted for this endpoint";

/**
 * Express middleware: reject the request with 403 when its Origin header
 * matches *.serve.term.<domain>. Otherwise pass to next().
 *
 * Non-browser callers (curl, backend-to-backend) send no Origin header — they
 * fall through to next() unchanged. Only browser cross-origin requests carry
 * an Origin header, and only serve-subdomain-issued ones match.
 */
export function multipartOriginGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const origin = req.headers.origin;
  const originStr = typeof origin === "string" ? origin : undefined;
  if (isServeSubdomainOrigin(originStr)) {
    sshLogger.warn("multipart-origin-guard: reject", {
      operation: "multipart_origin_guard_reject",
      origin: originStr,
      path: req.path,
      method: req.method,
    });
    res.status(REJECT_STATUS).json({ error: REJECT_ERROR_MESSAGE });
    return;
  }
  next();
}

/**
 * Imperative form for handlers that can't insert middleware in the chain
 * (e.g. wrapped multer calls that gate on request state before parsing).
 * Throws a 403-tagged Error whose .status = 403 and .message is the classified
 * sentence — caller pattern:
 *
 *   try { assertNotServeSubdomainOrigin(req); }
 *   catch (e) { return res.status(e.status).json({ error: e.message }); }
 *
 * Logs the same structured warn as the middleware so audit-trail parity holds.
 */
export function assertNotServeSubdomainOrigin(req: Request): void {
  const origin = req.headers.origin;
  const originStr = typeof origin === "string" ? origin : undefined;
  if (isServeSubdomainOrigin(originStr)) {
    sshLogger.warn("multipart-origin-guard: reject (assert)", {
      operation: "multipart_origin_guard_reject",
      origin: originStr,
      path: req.path,
      method: req.method,
    });
    const err = new Error(REJECT_ERROR_MESSAGE) as Error & { status: number };
    err.status = REJECT_STATUS;
    throw err;
  }
}
