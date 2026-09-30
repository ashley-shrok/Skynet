/**
 * Phase 143 Plan 143-04 (D-01/D-02/D-03/D-04): POST /apps/:hostId/:slug/unarchive
 *
 * User-initiated app un-archive gesture. Drops the `.unarchive-requested`
 * sentinel inside the archived app's folder (`~/fleet/apps-archive/<slug>/`)
 * so the agent-supervisor's reconcile tick picks it up and moves the folder
 * back to the live apps tree.
 *
 * POST /apps/:hostId/:slug/unarchive  (hostId in PATH per apps-domain convention)
 *   → 200 { ok: true }
 *   → 409 { reason: "archive_not_found" }   — archived folder absent (D-02 §1)
 *   → 409 { reason: "name_collision" }      — live folder exists (D-02 §2)
 *
 * Path shape follows the app-domain convention (hostId in path, not body)
 * established by GET /apps/:hostId/:slug and POST /apps/:hostId/:slug/archive
 * in routes/apps-archive.ts. This diverges from identity/role un-archive
 * (which put hostId in body) because apps are compound-keyed on (hostId, slug).
 *
 * Semantic contract (per Phase 143 CONTEXT D-01/D-02/D-03/D-04):
 *   - D-01: Drops `.unarchive-requested` inside the ARCHIVE folder.
 *   - D-02: Two fast-path preconditions (defense-in-depth; reconciler enforces
 *     the same logic independently per D-04):
 *       1. archive-exists: `~/fleet/apps-archive/<slug>/` must be present.
 *       2. name-collision: `~/fleet/apps/<slug>/` must NOT exist.
 *   - D-03: Failure response shape — structured 409 `{ reason }`. Reason is
 *     exactly one of: "archive_not_found", "name_collision". The missing_roles
 *     reason does NOT apply to app un-archive (D-02 explicit: identity-only).
 *   - D-04: Reconciler is authoritative on-tick; endpoint precheck is fast-path
 *     defense for immediate error surfacing.
 *   - Idempotent: sentinel already present → write succeeds → 200.
 *
 * Route mirrors apps-archive.ts byte-for-byte through step 4 (auth → hostId
 * path parse → slug gate → resolveHostById → LOCAL/REMOTE branch), then inserts
 * two preconditions (5a/5b) BEFORE the sentinel write (5c).
 *
 * Security (Phase 143 Plan 143-04 threat register):
 *   - T-143-04-01 (EoP): authenticateJWT + resolveHostById(hostId, userId) →
 *     404 on cross-user hostId (mirrors apps-archive.ts shape).
 *   - T-143-04-02 (Tampering, path traversal via slug): APP_SLUG_RE gate at
 *     route entry. Archive-tree writer (plan 143-01) re-validates as
 *     defense-in-depth. All `test -d` shell interpolations use only
 *     APP_SLUG_RE-validated values.
 *   - T-143-04-03 (Tampering, relPath): writer whitelist locked to
 *     `.unarchive-requested` only (plan 143-01).
 *   - T-143-04-04 (precondition bypass): writer NOT called on precondition fail.
 *   - T-143-04-06 (500 leak): generic message to client; detail logged server-side.
 *   - T-143-04-07 (Repudiation): audit log on success.
 *
 * Mounted in database.ts immediately AFTER app.use("/apps", appsArchiveRoutes)
 * (Phase 143 D-01). Both routers coexist under "/apps" — POST sub-paths are
 * distinct (:hostId/:slug/archive vs :hostId/:slug/unarchive).
 */

import path from "path";
import fs from "node:fs/promises";
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
  getLocalAppsRoot,
} from "../../claude-session/identity-artifact-reader.js";
import { writeAppArchiveFile, getLocalArchivedAppsRoot } from "../../claude-session/per-app-archive-file.js";
import { execCommand } from "../../ssh/tmux-helper.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling apps-archive.ts. */
const SSH_CONNECT_TIMEOUT_MS = 3000;

/**
 * POST /:hostId/:slug/unarchive
 *
 * Drops `.unarchive-requested` inside the archived app folder after
 * checking two preconditions (D-02).
 *
 * Errors:
 *   - 400 { error: "hostId must be a positive integer" } — malformed hostId
 *   - 400 { error: "slug must match [a-z0-9-]{1,64}" }   — bad slug
 *   - 404 { error: "Host not found" }                    — unknown / cross-user hostId
 *   - 409 { reason: "archive_not_found" }                — archived folder missing
 *   - 409 { reason: "name_collision" }                   — live folder exists
 *   - 504 { error: "Host unreachable" }                  — SSH connect failure
 *   - 500 { error: "failed to drop unarchive sentinel" } — write failure
 */
router.post(
  "/:hostId/:slug/unarchive",
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

    // 2. Validate slug via APP_SLUG_RE (T-143-04-02 gate).
    const slug = String(req.params.slug);
    if (!slug || !APP_SLUG_RE.test(slug)) {
      return res
        .status(400)
        .json({ error: "slug must match [a-z0-9-]{1,64}" });
    }

    // 3. Verify host ownership (T-143-04-01 gate). Returns null for cross-user
    // or unknown hostId → 404 (same shape as sibling routes).
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    // 4. Branch on LOCAL vs REMOTE. LOCAL passes conn=null; REMOTE opens a
    // one-shot SSH connection scoped to the preconditions + write.
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch {
        // Connect failure → 504 (T-143-04-06).
        return res.status(504).json({ error: "Host unreachable" });
      }
    }

    try {
      // 5a. archive-exists precondition (D-02 §1):
      // Refuse if the archived app folder does not exist.
      if (conn === null) {
        // LOCAL branch
        try {
          await fs.access(path.join(getLocalArchivedAppsRoot(), slug));
        } catch {
          return res.status(409).json({ reason: "archive_not_found" });
        }
      } else {
        // REMOTE branch — APP_SLUG_RE-validated slug, no shell-metachar risk.
        const out = await execCommand(
          conn,
          `test -d "$HOME/fleet/apps-archive/${slug}" && echo yes || echo no`,
        );
        if (out.trim() !== "yes") {
          return res.status(409).json({ reason: "archive_not_found" });
        }
      }

      // 5b. name-collision precondition (D-02 §2):
      // Refuse if a live-tree app with the same slug already exists.
      if (conn === null) {
        // LOCAL branch — access succeeds means live folder exists → collision
        try {
          await fs.access(path.join(getLocalAppsRoot(), slug));
          // fs.access succeeded → live folder exists
          return res.status(409).json({ reason: "name_collision" });
        } catch {
          // ENOENT — no collision, continue
        }
      } else {
        // REMOTE branch
        const out = await execCommand(
          conn,
          `test -d "$HOME/fleet/apps/${slug}" && echo yes || echo no`,
        );
        if (out.trim() === "yes") {
          return res.status(409).json({ reason: "name_collision" });
        }
      }

      // 5c. Drop the sentinel via the archive-tree writer (plan 143-01).
      // Idempotent by construction: existing sentinel overwritten via tmp+rename.
      await writeAppArchiveFile(slug, ".unarchive-requested", "", {
        hostId,
        conn,
      });

      // Audit log per T-143-04-07 (repudiation).
      databaseLogger.info(
        `app unarchive requested: userId=${userId}, hostId=${hostId}, slug=${slug}`,
      );

      return res.json({ ok: true });
    } catch (err) {
      // Log server-side; return generic message to client (T-143-04-06).
      databaseLogger.error(
        `failed to drop .unarchive-requested sentinel for app slug=${slug} hostId=${hostId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return res
        .status(500)
        .json({ error: "failed to drop unarchive sentinel" });
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

// Generic 500 fallback error handler (mirrors sibling apps-archive.ts).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "app-unarchive route error" });
  },
);

export default router;
