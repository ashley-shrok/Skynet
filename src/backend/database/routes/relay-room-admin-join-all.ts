/**
 * relay-room-admin-join-all.ts — one-shot admin endpoint to join
 * @skynet-admin into every user-owned relay room in relay_room_sessions.
 *
 * POST /relay-room/admin-join-all (admin-only)
 *
 * Solves the gap discovered at UAT 2026-09-09: relay-room-stream reads
 * (getRoomMessages, getRoomJoinedMembers) use the admin token per
 * T-90-BE-03 (only sends use per-user tokens). Synapse 403s when admin
 * is not a member of the room. Rooms created before the create-endpoint
 * fix (which auto-joins admin on creation) don't have admin as a
 * member — the WS server therefore emits an inactive-frame close on
 * every connect attempt for those rooms → pane flickers between the
 * error state and the loading state.
 *
 * This endpoint retroactively joins admin to every roomId present in
 * relay_room_sessions. Idempotent (Synapse joinRoom on an already-joined
 * user is a no-op). Runs against the LIVE backend (matches the
 * /relay-room/backfill precedent — the utility needs the in-process
 * matrix admin creds).
 *
 * ## Semantics
 *
 * - Enumerates DISTINCT roomIds across all rows in relay_room_sessions.
 * - Best-effort per-room: join failures log but don't abort the sweep.
 * - Returns aggregate counts { attempted, succeeded, failed }.
 * - Idempotent — safe to re-run.
 *
 * ## Auth
 *
 * authenticateJWT middleware + users.isAdmin check inside the handler
 * (same pattern as relay-registry-backfill.ts).
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { joinRoom } from "../../matrix/matrix-admin-client.js";
import { assertNotOk } from "../../matrix/matrix-admin-narrow.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

router.post(
  "/admin-join-all",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    try {
      const adminRow = await db.select().from(users).where(eq(users.id, userId));
      if (!adminRow || adminRow.length === 0 || !adminRow[0].isAdmin) {
        return res.status(403).json({ ok: false, error: "not_authorized" });
      }

      // Enumerate DISTINCT room_ids from relay_room_sessions. Use raw sqlite
      // for the DISTINCT — drizzle's select+distinct on a single column is
      // more verbose than the direct prepare+all here.
      const rows = db.$client
        .prepare(
          `SELECT DISTINCT room_id AS roomId FROM relay_room_sessions`,
        )
        .all() as { roomId: string }[];

      const roomIds = rows
        .map((r) => r.roomId)
        .filter((rid): rid is string => typeof rid === "string" && rid.length > 0);

      databaseLogger.info("relay-room-admin-join-all: sweep start", {
        operation: "relay_room_admin_join_all_start",
        userId,
        roomCount: roomIds.length,
      });

      let attempted = 0;
      let succeeded = 0;
      let failed = 0;
      for (const roomId of roomIds) {
        attempted++;
        const result = await joinRoom(roomId);
        if (result.ok) {
          succeeded++;
        } else {
          assertNotOk(result);
          failed++;
          databaseLogger.warn(
            "relay-room-admin-join-all: per-room join failed (best-effort per sweep)",
            {
              operation: "relay_room_admin_join_all_room_failed",
              userId,
              roomId,
              downstreamStatus: result.status,
              downstreamError: result.error,
            },
          );
        }
      }

      databaseLogger.info("relay-room-admin-join-all: sweep complete", {
        operation: "relay_room_admin_join_all_complete",
        userId,
        attempted,
        succeeded,
        failed,
      });

      return res.status(200).json({
        ok: true,
        attempted,
        succeeded,
        failed,
      });
    } catch (err) {
      databaseLogger.error("relay-room-admin-join-all: threw", {
        operation: "relay_room_admin_join_all_threw",
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  },
);

export default router;
