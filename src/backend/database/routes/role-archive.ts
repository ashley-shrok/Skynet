/**
 * Phase 133 Plan 133-01: /roles/:name/archive — user-initiated role archive
 * gesture. Drops the `.archive-requested` sentinel on the role folder so the
 * agent-supervisor's reconcile tick (Wave C) picks it up on its next scan and
 * runs the role cascade (retire every identity holding the role, then move
 * the role folder to ~/fleet/roles-archive/<name>/ per D-16).
 *
 * POST /roles/:name/archive  body: { hostId: number }
 *   → 200 { ok: true }
 *
 * Semantic contract (per Phase 133 CONTEXT):
 *   - D-01: single sentinel drop from the frontend; cascade complexity lives
 *     entirely inside the supervisor.
 *   - D-05: sentinel filename is exactly `.archive-requested` (parallel to
 *     the identity archive sentinel, disambiguated by root directory —
 *     ~/fleet/roles/<name>/ vs ~/fleet/identities/<key>/).
 *   - D-16: archive location `~/fleet/roles-archive/<name>/` is handled by
 *     the supervisor, NOT this endpoint. This endpoint only drops the
 *     sentinel at `~/fleet/roles/<name>/.archive-requested`.
 *   - D-19: one-way — no un-archive gesture. Route is POST-only; no
 *     GET/DELETE counterpart.
 *
 * Route mirrors identity-archive.ts byte-for-byte in shape (that being the
 * direct prior art the CONTEXT canonical-refs section names as "the model
 * this shape clones"):
 *   authenticateJWT → ROLE_NAME_PATTERN gate → resolveHostById filter →
 *   LOCAL/REMOTE branch on isLocalHostId → writeRoleFile with
 *   {hostId, conn} opts → try/finally conn.end().
 *
 * Security (Phase 133 Plan 133-01 threat register — full STRIDE table in
 * the plan's <threat_model> block):
 *   - T-133-01-01 (EoP, unauth caller drops sentinel on another user's role):
 *     authenticateJWT middleware runs first; resolveHostById(hostId, userId)
 *     filters hosts to the caller's own — unknown/cross-user hostId returns
 *     404, NOT 403, to avoid probe info leak (mirrors T-115-03-01).
 *   - T-133-01-02 (Tampering, path traversal via role name):
 *     ROLE_NAME_PATTERN = /^[a-z0-9-]+$/ gate at top of handler. Any name
 *     that fails the regex is rejected with 400 before any disk or SSH
 *     activity. Primitive-layer writeRoleFile also re-validates
 *     (belt-and-suspenders).
 *   - T-133-01-03 (Information Disclosure, 500 error text leak):
 *     500 responses return a generic `{ error: "failed to drop archive
 *     sentinel" }` — the underlying error text is logged server-side via
 *     databaseLogger.error but never sent to the client.
 *   - T-133-01-04 (DoS, archive-request flood): accepted per plan — each
 *     archive gesture is idempotent (same empty file at same path); the
 *     supervisor consumes the sentinel within one reconcile tick.
 *   - T-133-01-05 (Repudiation): JWT auth + audit log
 *     `databaseLogger.info("role archive requested: userId=X, hostId=Y,
 *     name=Z")` on success (mirrors T-115-03-05 shape).
 *   - T-133-01-06 (Concurrent archives race writeRoleFile): accepted per plan
 *     — both writes produce the same empty file at the same path; tmp+rename
 *     is atomic on both branches.
 *
 * Mounted in database.ts BEFORE the three existing /roles routers (mirrors
 * Phase 115 Plan 115-03 precedent at database.ts:2033) so /roles/:name/archive
 * resolves here and does not fall through to any future generic /:roleName
 * handler in rolesRoutes.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { ROLE_NAME_PATTERN } from "../../utils/role-name-pattern.js";
import { writeRoleFile } from "../../claude-session/per-role-file.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling identity-archive.ts. */
const SSH_CONNECT_TIMEOUT_MS = 3000;

/**
 * POST /:name/archive  body: { hostId: number }
 *
 * Drops `.archive-requested` on the role folder via the per-role-file
 * primitive. Returns 200 { ok: true } on success.
 *
 * Errors:
 *   - 400 { error: "hostId is required" }              — missing hostId
 *   - 400 { error: "hostId must be a positive integer" } — malformed hostId
 *   - 400 { error: "role name must match [a-z0-9-]" }  — bad name
 *   - 404 { error: "Host not found" }                  — unknown / cross-user hostId
 *   - 504 { error: "Host unreachable" }                — SSH connect failure (REMOTE)
 *   - 500 { error: "failed to drop archive sentinel" } — disk write failure
 */
router.post(
  "/:name/archive",
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

    // 2. Validate role name via ROLE_NAME_PATTERN (T-133-01-02 gate).
    const name = String(req.params.name ?? "");
    if (!name || !ROLE_NAME_PATTERN.test(name)) {
      return res
        .status(400)
        .json({ error: "role name must match [a-z0-9-]" });
    }

    // 3. Verify host ownership (T-133-01-01 gate). Returns null for cross-user
    // or unknown hostId → 404 (same shape as sibling identity-archive route
    // to avoid a 403-vs-404 probe distinguisher).
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    // 4. Branch on LOCAL vs REMOTE. LOCAL branch passes conn=null; REMOTE
    // branch opens a one-shot SSH connection whose lifetime is scoped to the
    // writeRoleFile call by the try/finally below.
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch {
        // Connect failure → 504 with generic message (T-133-01-03).
        return res.status(504).json({ error: "Host unreachable" });
      }
    }

    // 5. Drop the sentinel via the per-role-file primitive. The primitive
    // re-validates name + relPath before touching disk (belt-and-suspenders).
    try {
      await writeRoleFile(name, ".archive-requested", "", {
        hostId,
        conn,
      });
      // Audit log per T-133-01-05 (repudiation): who requested archive on what.
      databaseLogger.info(
        `role archive requested: userId=${userId}, hostId=${hostId}, name=${name}`,
      );
      return res.json({ ok: true });
    } catch (err) {
      // Log server-side; return generic message to the client (T-133-01-03).
      databaseLogger.error(
        `failed to drop .archive-requested sentinel for role name=${name} hostId=${hostId}: ${err instanceof Error ? err.message : String(err)}`,
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

// Generic 500 fallback error handler (mirrors sibling identity-archive.ts).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "role-archive route error" });
  },
);

export default router;
