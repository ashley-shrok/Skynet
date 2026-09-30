/**
 * GET /roles-archive?hostId=<n> — Phase 143 Plan 143-03 (D-05/D-07).
 *
 * Host-scoped list of archived role names on a specific host.
 *
 * DESIGN (D-07):
 *   Host-scoped — mirrors GET /roles?hostId=<n> (roles-list-for-host.ts)
 *   in the auth + resolveHostById + one-shot-SSH + reader-call shape.
 *   Calls listArchivedRolesOnHost (plan 143-02 primitive).
 *
 * REQUEST: GET /?hostId=<n>
 *
 * RESPONSE:
 *   200 { name: string }[]   — array of ArchivedRoleListEntry (plan 143-05)
 *
 * SECURITY (T-143-03-01 / T-143-03-02 / T-143-03-04):
 *   - authenticateJWT gates the route.
 *   - resolveHostById(hostId, userId) → 404 on cross-user / unknown hostId
 *     (T-143-03-01: elevation of privilege blocked).
 *   - Positive-integer parse gate on hostId query param (T-143-03-04).
 *   - 500 returns generic { error: "failed to list archived roles" }
 *     (T-143-03-02: no internal error text leaked to client).
 *   - SSH connect timeout: SSH_CONNECT_TIMEOUT_MS = 5000ms (T-143-03-03).
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { listArchivedRolesOnHost } from "../../claude-session/list-archived-roles.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling archive routes (5s). */
const SSH_CONNECT_TIMEOUT_MS = 5_000;

/**
 * GET /roles-archive?hostId=<n>
 * Returns [{ name }] for every archived role on the target host.
 * Mirrors roles-list-for-host.ts:119-220 byte-for-byte in the auth +
 * resolve + one-shot-SSH shape, substituting listArchivedRolesOnHost.
 */
router.get(
  "/",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId (mirrors roles-list-for-host.ts:125-133)
    const rawHostId = req.query.hostId;
    if (rawHostId === undefined || rawHostId === "") {
      return res.status(400).json({ error: "hostId is required" });
    }
    const hostId = parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }

    // 2. Verify host ownership — returns null for cross-user / unknown hosts.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    // 3. LOCAL branch — no SSH needed.
    if (isLocalHostId(hostId)) {
      try {
        const names = await listArchivedRolesOnHost(null);
        return res.json(names.map((name) => ({ name })));
      } catch (err) {
        databaseLogger.error("roles-archive-list: LOCAL list failed", {
          operation: "roles_archive_list_local_failed",
          hostId,
          error: err instanceof Error ? err.message : "unknown",
        });
        return res.status(500).json({ error: "failed to list archived roles" });
      }
    }

    // 4. REMOTE branch — open SSH one-shot, try/finally guarantees conn.end().
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        databaseLogger.debug("roles-archive-list: SSH connect failed", {
          operation: "roles_archive_list_connect_failed",
          hostId,
          error: err instanceof Error ? err.message : "unknown",
        });
        return res.status(504).json({ error: "SSH connect failed" });
      }

      const names = await listArchivedRolesOnHost(
        conn as unknown as Parameters<typeof listArchivedRolesOnHost>[0],
      );
      return res.json(names.map((name) => ({ name })));
    } catch (err) {
      databaseLogger.error("roles-archive-list: unexpected error", {
        operation: "roles_archive_list_error",
        hostId,
        error: err instanceof Error ? err.message : "unknown",
      });
      return res.status(500).json({ error: "failed to list archived roles" });
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
