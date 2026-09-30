/**
 * Phase 143 Plan 143-04 (D-01/D-02/D-03/D-04): POST /roles/:name/unarchive
 *
 * User-initiated role un-archive gesture. Drops the `.unarchive-requested`
 * sentinel inside the archived role's folder (`~/fleet/roles-archive/<name>/`)
 * so the agent-supervisor's reconcile tick picks it up and moves the folder
 * back to the live roles tree.
 *
 * POST /roles/:name/unarchive  body: { hostId: number }
 *   → 200 { ok: true }
 *   → 409 { reason: "archive_not_found" }   — archived folder absent (D-02 §1)
 *   → 409 { reason: "name_collision" }      — live folder exists (D-02 §2)
 *
 * Semantic contract (per Phase 143 CONTEXT D-01/D-02/D-03/D-04):
 *   - D-01: Drops `.unarchive-requested` inside the ARCHIVE folder.
 *   - D-02: Two fast-path preconditions (defense-in-depth; reconciler enforces
 *     the same logic independently per D-04):
 *       1. archive-exists: `~/fleet/roles-archive/<name>/` must be present.
 *       2. name-collision: `~/fleet/roles/<name>/` must NOT exist.
 *   - D-03: Failure response shape — structured 409 `{ reason }`. Reason is
 *     exactly one of: archive_not_found, name_collision. The missing_roles
 *     reason does NOT apply to role un-archive (D-02 explicit: identity-only).
 *   - D-04: Reconciler is authoritative on-tick; endpoint precheck is fast-path
 *     defense for immediate error surfacing.
 *   - Idempotent: sentinel already present → write succeeds → 200.
 *
 * Route mirrors role-archive.ts byte-for-byte through step 4 (auth → hostId
 * parse → name gate → resolveHostById → LOCAL/REMOTE branch), then inserts
 * two preconditions (5a/5b) BEFORE the sentinel write (5c).
 *
 * Security (Phase 143 Plan 143-04 threat register):
 *   - T-143-04-01 (EoP): authenticateJWT + resolveHostById(hostId, userId) →
 *     404 on cross-user hostId (mirrors role-archive.ts T-133-01-01).
 *   - T-143-04-02 (Tampering, path traversal via name): ROLE_NAME_PATTERN gate.
 *     Archive-tree writer (plan 143-01) re-validates as defense-in-depth.
 *   - T-143-04-03 (Tampering, relPath): writer whitelist locks to
 *     `.unarchive-requested` only (plan 143-01).
 *   - T-143-04-04 (precondition bypass): writer NOT called on precondition fail.
 *   - T-143-04-06 (500 leak): generic message to client; detail logged server-side.
 *   - T-143-04-07 (Repudiation): audit log on success.
 *
 * Mounted in database.ts immediately AFTER app.use("/roles", roleArchiveRoutes)
 * (Phase 143 D-01). Both routers coexist under "/roles" — POST sub-paths are
 * distinct (:name/archive vs :name/unarchive) so no handler shadowing occurs.
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
import { isLocalHostId, getLocalRolesRoot } from "../../claude-session/identity-artifact-reader.js";
import { ROLE_NAME_PATTERN } from "../../utils/role-name-pattern.js";
import { writeRoleArchiveFile, getLocalArchivedRolesRoot } from "../../claude-session/per-role-archive-file.js";
import { execCommand } from "../../ssh/tmux-helper.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling role-archive.ts. */
const SSH_CONNECT_TIMEOUT_MS = 3000;

/**
 * POST /:name/unarchive  body: { hostId: number }
 *
 * Drops `.unarchive-requested` inside the archived role folder after
 * checking two preconditions (D-02).
 *
 * Errors:
 *   - 400 { error: "hostId is required" }              — missing hostId
 *   - 400 { error: "hostId must be a positive integer" } — malformed hostId
 *   - 400 { error: "role name must match [a-z0-9-]" }  — bad name
 *   - 404 { error: "Host not found" }                  — unknown / cross-user hostId
 *   - 409 { reason: "archive_not_found" }              — archived folder missing
 *   - 409 { reason: "name_collision" }                 — live folder exists
 *   - 504 { error: "Host unreachable" }                — SSH connect failure
 *   - 500 { error: "failed to drop unarchive sentinel" } — write failure
 */
router.post(
  "/:name/unarchive",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId (body).
    const rawHostId = (req.body as { hostId?: unknown } | undefined)?.hostId;
    if (rawHostId === undefined || rawHostId === null || rawHostId === "") {
      return res.status(400).json({ error: "hostId is required" });
    }
    const hostId =
      typeof rawHostId === "number"
        ? rawHostId
        : parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      return res
        .status(400)
        .json({ error: "hostId must be a positive integer" });
    }

    // 2. Validate role name via ROLE_NAME_PATTERN (T-143-04-02 gate).
    const name = String(req.params.name ?? "");
    if (!name || !ROLE_NAME_PATTERN.test(name)) {
      return res
        .status(400)
        .json({ error: "role name must match [a-z0-9-]" });
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
      // Refuse if the archived role folder does not exist.
      if (conn === null) {
        // LOCAL branch
        try {
          await fs.access(path.join(getLocalArchivedRolesRoot(), name));
        } catch {
          return res.status(409).json({ reason: "archive_not_found" });
        }
      } else {
        // REMOTE branch — ROLE_NAME_PATTERN-validated name, no shell-metachar risk.
        const out = await execCommand(
          conn,
          `test -d "$HOME/fleet/roles-archive/${name}" && echo yes || echo no`,
        );
        if (out.trim() !== "yes") {
          return res.status(409).json({ reason: "archive_not_found" });
        }
      }

      // 5b. name-collision precondition (D-02 §2):
      // Refuse if a live-tree role with the same name already exists.
      if (conn === null) {
        // LOCAL branch — access succeeds means live folder exists → collision
        try {
          await fs.access(path.join(getLocalRolesRoot(), name));
          // fs.access succeeded → live folder exists
          return res.status(409).json({ reason: "name_collision" });
        } catch {
          // ENOENT — no collision, continue
        }
      } else {
        // REMOTE branch
        const out = await execCommand(
          conn,
          `test -d "$HOME/fleet/roles/${name}" && echo yes || echo no`,
        );
        if (out.trim() === "yes") {
          return res.status(409).json({ reason: "name_collision" });
        }
      }

      // 5c. Drop the sentinel via the archive-tree writer (plan 143-01).
      // Idempotent by construction: existing sentinel overwritten via tmp+rename.
      await writeRoleArchiveFile(name, ".unarchive-requested", "", {
        hostId,
        conn,
      });

      // Audit log per T-143-04-07 (repudiation).
      databaseLogger.info(
        `role unarchive requested: userId=${userId}, hostId=${hostId}, name=${name}`,
      );

      return res.json({ ok: true });
    } catch (err) {
      // Log server-side; return generic message to client (T-143-04-06).
      databaseLogger.error(
        `failed to drop .unarchive-requested sentinel for role name=${name} hostId=${hostId}: ${err instanceof Error ? err.message : String(err)}`,
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

// Generic 500 fallback error handler (mirrors sibling role-archive.ts).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "role-unarchive route error" });
  },
);

export default router;
