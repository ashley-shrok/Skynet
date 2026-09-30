/**
 * GET /identities-archive — Phase 143 Plan 143-03 (D-05/D-06/D-07).
 *
 * Fleet-wide list of archived identity keys across the caller's own hosts.
 *
 * DESIGN (D-06/D-07):
 *   Exposes the existing `listArchivedIdentityKeysOnHost` primitive
 *   (already used internally by conversation-search.ts) as an HTTP surface.
 *   Fleet-wide scoping mirrors conversation-search.ts's fan-out discipline —
 *   the caller's host set is projected from `hosts` scoped by `userId`.
 *
 * REQUEST: GET / (no body, no query params)
 *
 * RESPONSE:
 *   200 { identityKey: string; hostId: number }[]
 *   Sorted by (hostId ASC, identityKey ASC) for deterministic ordering.
 *
 * FAN-OUT PATTERN (mirrors conversation-search.ts:782-841):
 *   Promise.all over caller's hosts → per-host try/catch → silent-drop on
 *   SSH connect failure (one bad host does not poison the aggregate).
 *   try/finally guarantees conn.end() on every REMOTE exit path.
 *
 * SECURITY (T-143-03-01 / T-143-03-02 / T-143-03-03):
 *   - authenticateJWT gates the route; only the caller's own hosts are queried.
 *   - 500 returns generic { error: "failed to list archived identities" } —
 *     underlying details logged server-side via databaseLogger.error.
 *   - SSH connect timeout: SSH_CONNECT_TIMEOUT_MS = 5000ms (T-143-03-03).
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { hosts } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { listArchivedIdentityKeysOnHost } from "../../claude-session/list-archived-identity-keys.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches conversation-search.ts (5s covers healthy handshake). */
const SSH_CONNECT_TIMEOUT_MS = 5_000;

/**
 * GET /identities-archive
 * Returns fleet-wide array of { identityKey, hostId } — one entry per
 * archived identity key per host.
 */
router.get(
  "/",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // --- Host projection (fleet-wide, scoped to caller's userId) ----------
    // Mirrors conversation-search.ts:749-777. All hosts with SSH enabled are
    // candidates; autoTmux filter from conversation-search is NOT applied here
    // because archived identities can exist on non-autoTmux hosts.
    let candidateRows: Array<{ id: number }>;
    try {
      candidateRows = (await db
        .select({ id: hosts.id })
        .from(hosts)
        .where(eq(hosts.userId, userId))) as Array<{ id: number }>;
    } catch (e) {
      databaseLogger.error("identities-archive-list: host projection failed", {
        operation: "identities_archive_list_host_projection_failed",
        userId,
        error: e instanceof Error ? e.message : "unknown",
      });
      return res.status(500).json({ error: "failed to list archived identities" });
    }

    // --- Fleet-wide fan-out (mirrors conversation-search.ts:782-841) ------
    const perHost = await Promise.all(
      candidateRows.map(async (h): Promise<Array<{ identityKey: string; hostId: number }>> => {
        const hostId = h.id;
        try {
          if (isLocalHostId(hostId)) {
            // LOCAL branch — no SSH needed
            const keys = await listArchivedIdentityKeysOnHost(null);
            return keys.map((identityKey) => ({ identityKey, hostId }));
          }

          // REMOTE branch
          const resolved = await resolveHostById(hostId, userId);
          if (!resolved) return [];
          const conn = await connectOneShot(
            resolved as unknown as Parameters<typeof connectOneShot>[0],
            SSH_CONNECT_TIMEOUT_MS,
          );
          try {
            const keys = await listArchivedIdentityKeysOnHost(
              conn as unknown as Parameters<typeof listArchivedIdentityKeysOnHost>[0],
            );
            return keys.map((identityKey) => ({ identityKey, hostId }));
          } finally {
            try {
              (conn as { end?: () => void }).end?.();
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          // Per-host failure is silently swallowed — mirrors conversation-search.ts
          // fan-out discipline (one bad host contributes [] rather than a 500).
          databaseLogger.debug("identities-archive-list: host skipped", {
            operation: "identities_archive_list_host_skip",
            hostId,
            error: e instanceof Error ? e.message : "unknown",
          });
          return [];
        }
      }),
    );

    // --- Aggregate + sort -------------------------------------------------
    const flat = perHost.flat();
    flat.sort((a, b) => {
      if (a.hostId !== b.hostId) return a.hostId - b.hostId;
      return a.identityKey.localeCompare(b.identityKey);
    });

    return res.json(flat);
  },
);

export default router;
