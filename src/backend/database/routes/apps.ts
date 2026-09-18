/**
 * Phase 119 Plan 05 (D-06): GET /apps/:hostId/:slug/icon.
 *
 * Serves the raw bytes of ~/fleet/apps/<slug>/icon.webp from the target host,
 * mirroring GET /identities/:identityKey/avatar?hostId=<n> at
 * src/backend/database/routes/identities.ts:849-966. The two deliberate
 * differences from the identity-avatar route are:
 *   1. hostId lives in the URL path (`/apps/:hostId/:slug/icon`), not a query
 *      param — D-06 explicit.
 *   2. The slug validator is APP_SLUG_RE (kebab-case only — no underscores),
 *      not IDENTITY_KEY_RE — shape 1 lock (`create-app.sh` requires kebab-case).
 *
 * Discipline (identity-avatar mirror):
 *   - `authenticateJWT` middleware gates every request → 401 without token.
 *   - APP_SLUG_RE regex-gates slug BEFORE any host resolution or SSH work
 *     (shell-safety guard; T-119-05-01 path-traversal + T-119-05-02 command
 *     injection mitigation). Enforced BOTH here AND inside readAppIconFile
 *     for defence-in-depth.
 *   - hostId parsed as a positive integer → 400 on any other shape.
 *   - `resolveHostById(hostId, userId)` returns null when the user has no
 *     access OR the host is unknown; both branches produce a canned 502 with
 *     the SAME body ("app home box unreachable") — RESEARCH.md §Security V4
 *     "does NOT distinguish not-found from not-authorized" invariant matches
 *     the identity-avatar discipline.
 *   - `connectOneShot(host, 5_000)` — 5s hard timeout, one-shot semantics.
 *     Failures → same canned 502.
 *   - `readAppIconFile(conn, slug)` — LOCAL: fs.readFile; REMOTE: SFTP with an
 *     ls-probe front-check. Returns null on absent (→ 404), bytes+mime on
 *     present, throws on error.
 *   - Response: 200 + Content-Type image/webp + Content-Length + ETag +
 *     Cache-Control: no-store. If-None-Match matching → 304 empty.
 *   - `finally { conn.end() }` — SSH connection is always released on EVERY
 *     exit path (200/304/404/502). Enforced by tests T12/T12b/T12c.
 */

import express from "express";
import { createHash } from "crypto";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import {
  APP_SLUG_RE,
  isLocalHostId,
  readAppIconFile,
} from "../../claude-session/identity-artifact-reader.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { sshLogger } from "../../utils/logger.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

router.get(
  "/:hostId/:slug/icon",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // Slug validation — APP_SLUG_RE gate (defence-in-depth; readAppIconFile
    // re-validates but a clean 400 here beats a downstream throw-as-500).
    const slug = String(req.params.slug);
    if (!APP_SLUG_RE.test(slug)) {
      return res
        .status(400)
        .json({ error: "slug must match [a-z0-9-]{1,64}" });
    }

    // hostId validation — D-06 puts hostId in the URL path (not query).
    const rawHost = req.params.hostId;
    const hostIdNum = Number(rawHost);
    if (
      !Number.isFinite(hostIdNum) ||
      !Number.isInteger(hostIdNum) ||
      hostIdNum <= 0
    ) {
      return res
        .status(400)
        .json({ error: "hostId must be a positive integer" });
    }

    const local = isLocalHostId(hostIdNum);
    let conn: import("ssh2").Client | null = null;
    if (!local) {
      try {
        const host = await resolveHostById(hostIdNum, userId);
        if (!host) {
          // Code-review MEDIUM-3 (fix pass 2026-09-18): resolveHostById
          // returns null for BOTH "hostId doesn't exist" AND "user has no
          // access". Log so recurring 502s on a specific hostId leave a
          // fingerprint in the logs beyond the entry-level access log.
          // Payload deliberately minimal (no user IDs, no stack traces —
          // matches identity-avatar discipline).
          sshLogger.warn("app icon: host unresolvable / no access", {
            operation: "apps_icon_host_unresolvable",
            hostId: hostIdNum,
            slug,
          });
          return res
            .status(502)
            .json({ error: "app home box unreachable" });
        }
        conn = await connectOneShot(host, 5_000);
      } catch (e) {
        // Code-review MEDIUM-3 (fix pass 2026-09-18): log the underlying
        // SSH failure reason so operators can distinguish DNS-vs-timeout-vs-
        // auth-fail without instrumenting the SSH layer. errMessage only —
        // never the full stack.
        sshLogger.warn("app icon: SSH connect failed", {
          operation: "apps_icon_ssh_connect_error",
          hostId: hostIdNum,
          slug,
          errMessage: e instanceof Error ? e.message : String(e),
        });
        return res
          .status(502)
          .json({ error: "app home box unreachable" });
      }
    }

    try {
      const result = await readAppIconFile(conn, slug);
      if (result === null) {
        return res
          .status(404)
          .json({ error: "no icon on disk for this app" });
      }
      // ETag identifies the current bytes; combined with `no-store` below,
      // the browser can still honour a matching If-None-Match (304) but does
      // not cache the payload — matches the identity-avatar discipline at
      // identities.ts:939-953.
      const etag = `"disk-${createHash("md5").update(result.bytes).digest("hex")}"`;
      const ifNoneMatch = req.headers["if-none-match"];
      if (ifNoneMatch && ifNoneMatch === etag) {
        return res.status(304).end();
      }
      res.setHeader("Content-Type", result.mime);
      res.setHeader("Content-Length", String(result.bytes.byteLength));
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "no-store");
      return res.send(result.bytes);
    } catch (e) {
      // SSH / SFTP / readAppIconFile-level error → 502 with canned body.
      // Never leak raw exception messages into the response.
      //
      // Code-review MEDIUM-3 (fix pass 2026-09-18): emit a structured warn
      // with hostId + slug + errMessage so recurring 502s on a specific
      // (hostId, slug) leave a fingerprint. Prior code returned silently.
      sshLogger.warn("app icon: SFTP / read error", {
        operation: "apps_icon_ssh_error",
        hostId: hostIdNum,
        slug,
        errMessage: e instanceof Error ? e.message : String(e),
      });
      return res
        .status(502)
        .json({ error: "app home box unreachable" });
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* ignore */
        }
      }
    }
  },
);

export default router;
