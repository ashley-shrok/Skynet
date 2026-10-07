/**
 * app-rename shape: PATCH /apps/:hostId/:slug
 *
 * User-initiated app title rename. Rewrites the `title` field of
 * `~/fleet/apps/<slug>/app.json` on the owning host (every other field is
 * preserved — see updateAppTitle in per-app-file.ts). The fleet-status sweep
 * picks the new title up on its next tick; the sidebar applies it
 * optimistically in the meantime (app-tiles-store setPendingAppTitle).
 *
 * Title only — the slug is the app's identity (folder, systemd unit, URLs,
 * tab keys) and is NOT renameable here.
 *
 * PATCH /apps/:hostId/:slug   body: { title: string }
 *   → 200 { ok: true, title }   (title is the trimmed, stored value)
 *
 * Route mirrors apps-archive.ts in shape:
 *   authenticateJWT → hostId gate → APP_SLUG_RE gate → title gate →
 *   resolveHostById filter → getHostSemaphore(hostId).run →
 *   LOCAL/REMOTE branch on isLocalHostId →
 *   updateAppTitle with {hostId, conn} opts → try/finally conn.end().
 *
 * Errors:
 *   - 400 hostId / slug / title validation failures
 *   - 404 { error: "Host not found" } — unknown / cross-user hostId
 *   - 404 { error: "app not found" }  — no app.json for this slug
 *   - 409 { error: "app.json is malformed" } — refuses to overwrite a card
 *     it can't parse (a blind write could drop fields the app relies on)
 *   - 504 { error: "Host unreachable" } — SSH connect failure (REMOTE)
 *   - 500 { error: "failed to rename app" } — generic; detail logged only
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { getHostSemaphore } from "../../ssh/host-semaphore-registry.js";
import {
  APP_SLUG_RE,
  isLocalHostId,
} from "../../claude-session/identity-artifact-reader.js";
import {
  AppManifestError,
  updateAppTitle,
  validateAppTitle,
} from "../../claude-session/per-app-file.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling apps-archive.ts. */
const SSH_CONNECT_TIMEOUT_MS = 3000;

router.patch(
  "/:hostId/:slug",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    const hostId = Number(req.params.hostId);
    if (!Number.isFinite(hostId) || !Number.isInteger(hostId) || hostId <= 0) {
      return res
        .status(400)
        .json({ error: "hostId must be a positive integer" });
    }

    const slug = String(req.params.slug);
    if (!slug || !APP_SLUG_RE.test(slug)) {
      return res
        .status(400)
        .json({ error: "slug must match [a-z0-9-]{1,64}" });
    }

    const v = validateAppTitle((req.body as { title?: unknown } | undefined)?.title);
    if (!v.ok) {
      return res.status(400).json({ error: v.error });
    }

    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    // SSH work runs under the per-host semaphore (verify:ssh-cap).
    return getHostSemaphore(hostId).run(async () => {
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

      try {
        const { title } = await updateAppTitle(slug, v.title, { hostId, conn });
        databaseLogger.info(
          `app renamed: userId=${userId}, hostId=${hostId}, slug=${slug}`,
        );
        return res.json({ ok: true, title });
      } catch (err) {
        if (err instanceof AppManifestError) {
          return err.kind === "not_found"
            ? res.status(404).json({ error: "app not found" })
            : res.status(409).json({ error: "app.json is malformed" });
        }
        databaseLogger.error(
          `failed to rename app slug=${slug} hostId=${hostId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return res.status(500).json({ error: "failed to rename app" });
      } finally {
        if (conn) {
          try {
            conn.end();
          } catch {
            /* ignore */
          }
        }
      }
    });
  },
);

// Generic 500 fallback error handler (mirrors apps-archive.ts).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "app-rename route error" });
  },
);

export default router;
