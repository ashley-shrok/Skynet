/**
 * Phase 117 Plan 117-07 Task 1 (Fix 1 gate): GET /relay-rooms/project-tags —
 * boot-time enumerator that walks the acting user's Matrix rooms and returns
 * every room whose account_data carries a `u.project.<slug>` tag.
 *
 * D-05 relay-room carrier: the relay-room's project-membership is stored as
 * `m.tag` account_data on the Matrix room (`u.project.<slug>` per the
 * Matrix user-defined-tag convention). The wire event from 117-03 carries
 * only the project LIST (not per-room memberships), so this endpoint fills
 * the hydration gap — the frontend calls it once per managed host at boot
 * and populates `state.roomProjectAssignments` before the first render.
 *
 * Response: `{ assignments: Array<{ roomId: string, slug: string }> }`
 *
 * Failure discipline:
 *   - resolveHostById returns null (unknown host / cross-user) → 404.
 *   - getUserJoinedRooms fails → 502 (upstream Matrix error).
 *   - Per-room getRoomTags AdminErr → skipped (logged as warn); partial
 *     hydration is better than none.
 *   - users.mxid missing on the calling user row → 403 (T-117-05-02 defense).
 *
 * Trust boundaries (mirrors relay-room-project-tag.ts § threat model):
 *   - JWT gate on every call (authenticateJWT middleware).
 *   - callerMxid resolved from users.mxid, not accepted from the wire —
 *     Matrix per-user-token minted downstream is scoped to the caller.
 *   - `u.project.<slug>` slug is emitted verbatim from Matrix; no re-validation
 *     against PROJECT_SLUG_RE here (permissive-read discipline, per
 *     extractCosmeticsFromFrontmatter's identity-side pattern in 5a). Malformed
 *     slugs surface to the frontend's projects-derived selector where D-07
 *     graceful degradation absorbs them.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { getRoomTags } from "../../matrix/matrix-room-tag-client.js";
import { getUserJoinedRooms } from "../../matrix/matrix-admin-client.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const PROJECT_TAG_PREFIX = "u.project.";

/**
 * Look up the authenticated user's own mxid from users.mxid. Returns null
 * if the user row has no mxid (pre-Phase-88 accounts) — caller MUST treat
 * null as "cannot verify — 403" per the same defense-in-depth pattern
 * relay-room-project-tag.ts uses.
 */
async function lookupCallerMxid(userId: string): Promise<string | null> {
  try {
    const rows = (await db
      .select({ mxid: users.mxid })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)) as Array<{ mxid: string | null }>;
    const row = rows[0];
    if (row === undefined) return null;
    return typeof row.mxid === "string" && row.mxid.length > 0
      ? row.mxid
      : null;
  } catch (err) {
    databaseLogger.warn(
      `relay-room-project-tags-list: lookupCallerMxid failed userId=${userId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/**
 * GET /relay-rooms/project-tags?hostId=<n>
 * → 200 { assignments: Array<{roomId: string, slug: string}> }
 *
 * Errors:
 *   - 400 { error: "hostId is required" | "hostId must be a positive integer" }
 *   - 401 unauth
 *   - 403 { error: "user has no mxid on record" }
 *   - 404 { error: "Host not found" }
 *   - 502 { error: "matrix joined-rooms fetch failed", code }
 */
router.get(
  "/project-tags",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. hostId gate (mirrors project-list.ts + identity-archive.ts shape).
    const rawHostId = req.query.hostId;
    if (rawHostId === undefined || rawHostId === "") {
      res.status(400).json({ error: "hostId is required" });
      return;
    }
    const hostId = parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }

    // 2. Host isolation — 404 (not 403) on unknown/cross-user host, per
    // the same probe-defense discipline as identity-archive.ts.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // 3. Resolve caller's mxid (defense-in-depth — a user with no mxid on
    // record cannot enumerate account_data tags because the per-user-token
    // mint downstream would target a nonexistent user).
    const callerMxid = await lookupCallerMxid(userId);
    if (callerMxid === null) {
      res.status(403).json({ error: "user has no mxid on record" });
      return;
    }

    // 4. Fetch the acting user's joined rooms via admin API.
    const joinedResult = await getUserJoinedRooms(callerMxid);
    if (joinedResult.ok === false) {
      databaseLogger.warn(
        `relay-room-project-tags-list: getUserJoinedRooms failed userId=${userId} mxid=${callerMxid} status=${joinedResult.status} error=${joinedResult.error}`,
      );
      res.status(502).json({
        error: "matrix joined-rooms fetch failed",
        code: joinedResult.error,
      });
      return;
    }

    // 5. Enumerate per-room account_data tags. Partial-hydration discipline:
    // a per-room AdminErr is logged and skipped (does NOT abort the whole
    // scan). Better to return the rooms that succeeded than to fail-closed
    // on any single Matrix hiccup.
    const assignments: Array<{ roomId: string; slug: string }> = [];
    for (const roomId of joinedResult.roomIds) {
      const tagsResult = await getRoomTags(callerMxid, roomId);
      if (tagsResult.ok === false) {
        databaseLogger.warn(
          `relay-room-project-tags-list: getRoomTags skipped roomId=${roomId} status=${tagsResult.status} error=${tagsResult.error}`,
        );
        continue;
      }
      // 6. Filter for u.project.<slug> tags. Matrix's tag namespace guarantees
      // one project-tag per room via D-05a read-modify-write, but we
      // defensively take the first one if a room somehow has multiple.
      for (const key of Object.keys(tagsResult.tags)) {
        if (key.startsWith(PROJECT_TAG_PREFIX)) {
          const slug = key.slice(PROJECT_TAG_PREFIX.length);
          if (slug.length > 0) {
            assignments.push({ roomId, slug });
            break; // D-06 single-project invariant
          }
        }
      }
    }

    databaseLogger.info(
      `relay-room-project-tags-list: userId=${userId} mxid=${callerMxid} hostId=${hostId} roomsScanned=${joinedResult.roomIds.length} assignments=${assignments.length}`,
    );

    res.json({ assignments });
    return;
  },
);

// Generic 500 fallback error handler.
router.use(
  (err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    return res.status(500).json({
      error: err?.message ?? "relay-room-project-tags-list route error",
    });
  },
);

export default router;
