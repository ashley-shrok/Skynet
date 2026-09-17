/**
 * Phase 115 Plan 115-03: /identities/:key/archive — user-initiated archive
 * gesture. Drops the `.archive-requested` sentinel on the identity's host so
 * the agent-supervisor's reconcile tick (Plan 115-04) picks it up on its next
 * scan and runs retire_identity().
 *
 * POST /identities/:key/archive  body: { hostId: number }
 *   → 200 { ok: true }
 *
 * Semantic contract (per Phase 115 CONTEXT):
 *   - D-08: sentinel filename is exactly `.archive-requested`.
 *   - D-09: sentinel drops at `~/fleet/identities/<key>/.archive-requested` on
 *     the identity's host — per-host, not fan-out.
 *   - D-07: sentinel is an INTENT signal (one-shot), not a state toggle. There
 *     is no GET/DELETE counterpart — the supervisor consumes and deletes the
 *     sentinel as part of retire.
 *   - D-17: dedicated POST endpoint, NOT reused PUT-array shape.
 *
 * Route mirrors the shape of identity-no-dormancy.ts (RESEARCH §6 precedent):
 *   authenticateJWT → IDENTITY_KEY_RE gate → resolveHostById filter →
 *   LOCAL/REMOTE branch on isLocalHostId → writeIdentityFile with
 *   {hostId, conn} opts → try/finally conn.end().
 *
 * Security (Phase 115 Plan 115-03 threat register):
 *   - T-115-03-01 (EoP, unauth caller): authenticateJWT middleware runs first;
 *     resolveHostById(hostId, userId) filters hosts to the caller's own —
 *     unknown/cross-user hostId returns 404, NOT 403, to avoid probe info leak
 *     (same shape as sibling routes).
 *   - T-115-03-02 (Tampering, path traversal): IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/
 *     gate at top of handler. Any key that fails the regex is rejected with 400
 *     before any disk or SSH activity. Primitive-layer writeIdentityFile also
 *     re-validates (belt-and-suspenders).
 *   - T-115-03-03 (Information Disclosure): 500 responses return a generic
 *     `{ error: "failed to drop archive sentinel" }` — the underlying error
 *     text is logged server-side but never sent to the client.
 *
 * Mounted in database.ts BEFORE the generic /identities router so that
 * /identities/:key/archive resolves here and does not fall through to
 * identitiesRoutes (whose /:identityKey PUT/GET handlers would swallow the key).
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import {
  isLocalHostId,
  IDENTITY_KEY_RE,
} from "../../claude-session/identity-artifact-reader.js";
import { writeIdentityFile } from "../../claude-session/per-identity-file.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling identity-no-dormancy.ts. */
const SSH_CONNECT_TIMEOUT_MS = 3000;

/**
 * POST /:key/archive  body: { hostId: number }
 *
 * Drops `.archive-requested` on the identity's host via the per-identity-file
 * primitive. Returns 200 { ok: true } on success.
 *
 * Errors:
 *   - 400 { error: "hostId is required" }              — missing hostId
 *   - 400 { error: "hostId must be a positive integer" } — malformed hostId
 *   - 400 { error: "identity key must match [a-z0-9_-]{1,64}" } — bad key
 *   - 404 { error: "Host not found" }                  — unknown / cross-user hostId
 *   - 504 { error: "Host unreachable" }                — SSH connect failure (REMOTE)
 *   - 500 { error: "failed to drop archive sentinel" } — disk write failure
 */
router.post(
  "/:key/archive",
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

    // 2. Validate identity key via IDENTITY_KEY_RE (T-115-03-02 gate).
    const key = String(req.params.key ?? "");
    if (!key || !IDENTITY_KEY_RE.test(key)) {
      return res
        .status(400)
        .json({ error: "identity key must match [a-z0-9_-]{1,64}" });
    }

    // 3. Verify host ownership (T-115-03-01 gate). Returns null for cross-user
    // or unknown hostId → 404 (same shape as sibling routes to avoid a
    // 403-vs-404 probe distinguisher).
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    // 4. Branch on LOCAL vs REMOTE. LOCAL branch passes conn=null; REMOTE
    // branch opens a one-shot SSH connection whose lifetime is scoped to the
    // writeIdentityFile call by the try/finally below.
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch {
        // Connect failure → 504 with generic message (T-115-03-03).
        return res.status(504).json({ error: "Host unreachable" });
      }
    }

    // 5. Drop the sentinel via the per-identity-file primitive. The primitive
    // re-validates key + relPath before touching disk (belt-and-suspenders).
    try {
      await writeIdentityFile(key, ".archive-requested", "", {
        hostId,
        conn,
      });
      // Audit log per T-115-03-05 (repudiation): who requested archive on what.
      databaseLogger.info(
        `identity archive requested: userId=${userId}, hostId=${hostId}, key=${key}`,
      );
      return res.json({ ok: true });
    } catch (err) {
      // Log server-side; return generic message to the client (T-115-03-03).
      databaseLogger.error(
        `failed to drop .archive-requested sentinel for key=${key} hostId=${hostId}: ${err instanceof Error ? err.message : String(err)}`,
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

// Generic 500 fallback error handler (mirrors sibling routes).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "identity-archive route error" });
  },
);

export default router;
