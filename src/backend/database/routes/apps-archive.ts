/**
 * app-archive shape: POST /apps/:hostId/:slug/archive
 *
 * User-initiated app archive gesture. Drops the `.archive-requested`
 * sentinel on the app folder so the agent-supervisor's reconcile tick on
 * the owning host picks it up on its next scan and runs the archive
 * procedure (`archive-app.sh <slug>` from the app-development skill).
 *
 * POST /apps/:hostId/:slug/archive
 *   → 200 { ok: true }
 *
 * Path shape follows the app-domain convention (hostId in path, not body)
 * established by GET /apps/:hostId/:slug and GET /apps/:hostId/:slug/icon
 * in routes/apps.ts. This diverges from POST /identities/:key/archive and
 * POST /roles/:name/archive (which put hostId in body) because apps are
 * compound-keyed on (hostId, slug) and every other app route already
 * carries hostId in the path.
 *
 * Semantic contract:
 *   - Single sentinel drop from the frontend; the archive procedure lives
 *     entirely inside the supervisor + the existing archive-app.sh script.
 *   - Sentinel filename is exactly `.archive-requested` (parallel to the
 *     identity + role archive sentinels, disambiguated by root directory
 *     — ~/fleet/apps/<slug>/ vs ~/fleet/identities/<key>/ vs ~/fleet/roles/<name>/).
 *   - Archive location (`~/fleet/apps-archive/<slug>/`) is handled by
 *     archive-app.sh, NOT this endpoint. This endpoint only drops the
 *     sentinel at `~/fleet/apps/<slug>/.archive-requested`.
 *   - One-way from this shape — no user-facing un-archive gesture (agent
 *     path via `restore-app.sh` remains available for now).
 *
 * Route mirrors identity-archive.ts / role-archive.ts in shape:
 *   authenticateJWT → APP_SLUG_RE gate → hostId gate → resolveHostById
 *   filter → LOCAL/REMOTE branch on isLocalHostId → writeAppFile with
 *   {hostId, conn} opts → try/finally conn.end().
 *
 * Security (STRIDE mirror of role-archive.ts's threat register):
 *   - Unauth caller (EoP): authenticateJWT gate runs first; resolveHostById
 *     filters to the caller's own hosts — unknown/cross-user hostId returns
 *     404, NOT 403, to avoid probe info leak (mirrors identity/role archive).
 *   - Path traversal via slug (Tampering): APP_SLUG_RE = /^[a-z0-9-]{1,64}$/
 *     gate at top of handler. Any slug that fails the regex is rejected with
 *     400 before any disk or SSH activity. Primitive-layer writeAppFile also
 *     re-validates (belt-and-suspenders).
 *   - 500 error text leak (Information Disclosure): 500 responses return a
 *     generic `{ error: "failed to drop archive sentinel" }` — the underlying
 *     error is logged server-side but never sent to the client.
 *   - Archive-request flood (DoS): accepted — each archive gesture is
 *     idempotent (same empty file at same path); the supervisor consumes
 *     the sentinel within one reconcile tick.
 *   - Repudiation: JWT auth + audit log on success.
 *   - Concurrent archives race writeAppFile: accepted — both writes produce
 *     the same empty file at the same path; tmp+rename is atomic on both
 *     branches.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import {
  APP_SLUG_RE,
  isLocalHostId,
} from "../../claude-session/identity-artifact-reader.js";
import { writeAppFile } from "../../claude-session/per-app-file.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling identity-archive.ts / role-archive.ts. */
const SSH_CONNECT_TIMEOUT_MS = 3000;

/**
 * POST /:hostId/:slug/archive
 *
 * Drops `.archive-requested` on the app folder via the per-app-file
 * primitive. Returns 200 { ok: true } on success.
 *
 * Errors:
 *   - 400 { error: "hostId must be a positive integer" } — malformed hostId
 *   - 400 { error: "slug must match [a-z0-9-]{1,64}" }   — bad slug
 *   - 404 { error: "Host not found" }                    — unknown / cross-user hostId
 *   - 504 { error: "Host unreachable" }                  — SSH connect failure (REMOTE)
 *   - 500 { error: "failed to drop archive sentinel" }   — disk write failure
 */
router.post(
  "/:hostId/:slug/archive",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId (path).
    const rawHost = req.params.hostId;
    const hostId = Number(rawHost);
    if (
      !Number.isFinite(hostId) ||
      !Number.isInteger(hostId) ||
      hostId <= 0
    ) {
      return res
        .status(400)
        .json({ error: "hostId must be a positive integer" });
    }

    // 2. Validate slug via APP_SLUG_RE. Empty-slug guard (`!slug ||`) is
    // belt-and-suspenders — APP_SLUG_RE's {1,64} rejects empty already,
    // but the explicit truthiness check mirrors role-archive.ts's gate
    // shape for cross-primitive consistency.
    const slug = String(req.params.slug);
    if (!slug || !APP_SLUG_RE.test(slug)) {
      return res
        .status(400)
        .json({ error: "slug must match [a-z0-9-]{1,64}" });
    }

    // 3. Verify host ownership. Returns null for cross-user or unknown
    // hostId → 404 (same shape as sibling identity/role archive routes to
    // avoid a 403-vs-404 probe distinguisher).
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    // 4. Branch on LOCAL vs REMOTE. LOCAL passes conn=null; REMOTE opens a
    // one-shot SSH connection whose lifetime is scoped to writeAppFile.
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch {
        return res.status(504).json({ error: "Host unreachable" });
      }
    }

    // 5. Drop the sentinel. Primitive re-validates slug + relPath before
    // touching disk (belt-and-suspenders).
    try {
      await writeAppFile(slug, ".archive-requested", "", {
        hostId,
        conn,
      });
      databaseLogger.info(
        `app archive requested: userId=${userId}, hostId=${hostId}, slug=${slug}`,
      );
      return res.json({ ok: true });
    } catch (err) {
      databaseLogger.error(
        `failed to drop .archive-requested sentinel for app slug=${slug} hostId=${hostId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return res
        .status(500)
        .json({ error: "failed to drop archive sentinel" });
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

// Generic 500 fallback error handler (mirrors sibling identity/role archive routes).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "app-archive route error" });
  },
);

export default router;
