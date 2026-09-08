/**
 * relay-room-participants.ts — Phase 90 Plan 04 Task 3.
 *
 * GET /relay-room/:roomId/participants — Express router module.
 *
 * Returns the humans + agents partition for a room, classified SERVER-SIDE
 * via the shared participants-classifier module (also imported by Task 2's
 * WS server). Fallback path for the transient window between pane mount
 * and first WS `participants` frame (W#9 chose emit-on-connect for the
 * primary path; this endpoint stays available so a pane can render badges
 * even before the WS opens).
 *
 * ## Trust boundaries + T-90-BE-01/T-90-BE-02 mitigations
 *
 * - JWT auth: `authenticateJWT` middleware populates `req.userId`.
 * - Access-control gate: SELECT id FROM relay_room_sessions WHERE user_id
 *   = ? AND room_id = ? — missing row → 404. SAME status for both
 *   'row not found' AND 'user not a member' (no existence oracle per
 *   Security V8).
 * - roomId grammar validation: `/^![a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+$/` —
 *   T-90-04-T1 tampering defense; reject malformed early.
 * - Response body: NEVER includes Matrix access tokens, admin creds, or
 *   raw Matrix response bodies (T-90-BE-01). getRoomJoinedMembers's
 *   response is filtered to just the mxid list before classification.
 *
 * ## W#9 shared classifier invariant (T-90-04-C1)
 *
 * Calls `classifyParticipants(memberMxids, {lookupHumans})` from
 * src/backend/relay-room-stream/participants-classifier.ts — the SAME
 * helper Task 2's WS server uses. If this endpoint re-implemented the
 * classifier, the WS live-update frames and this REST fallback could
 * partition the same room differently, causing a visible re-shuffle at
 * the moment the WS connects. Test 4 grep-verifies the import.
 *
 * ## D-07 viewing-user self-exclusion
 *
 * The response's humans list has the viewing user filtered out (the pane
 * uses the "right-side-is-you" convention; no self-badge). The viewing
 * user's mxid is looked up from users.mxid — never from the request.
 *
 * ## NOT applicable
 *
 * NO user-row DB writes → DatabaseSaveTrigger.forceSave invariant does
 * NOT apply. NO new secrets introduced.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { getRoomJoinedMembers } from "../../matrix/matrix-admin-client.js";
import {
  classifyParticipants,
  lookupHumansFromUsersTable,
} from "../../relay-room-stream/participants-classifier.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * Matrix room-id grammar. Matches Matrix client-server API §2.1.3
 * (opaque room-id form) with a permissive localpart+server split. The
 * leading `!` distinguishes room-ids from user-ids/aliases.
 */
const MATRIX_ROOM_ID_RE = /^![a-zA-Z0-9._=-]+:[a-zA-Z0-9.-]+$/;

/**
 * Look up the viewing user's own mxid from users.mxid — the D-07
 * self-exclusion filter needs this. Returns null if the user has no
 * mxid (pre-Phase-88 accounts) — in that case the filter runs but
 * matches nothing.
 */
async function lookupViewingUserMxid(userId: string): Promise<string | null> {
  try {
    const rows = (await db
      .select({ mxid: users.mxid })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)) as Array<{ mxid: string | null }>;
    const row = rows[0];
    if (row === undefined) return null;
    return typeof row.mxid === "string" && row.mxid.length > 0 ? row.mxid : null;
  } catch (err) {
    databaseLogger.warn(
      "relay-room-participants: lookupViewingUserMxid failed",
      {
        operation: "relay_room_participants_lookup_viewer_mxid_failed",
        userId,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return null;
  }
}

/**
 * Access-control gate — same SQL as Task 2's WS server for parity. Missing
 * row → 404 (no oracle; Security V8).
 */
function ownsRelayRoomSession(userId: string, roomId: string): boolean {
  const row = db.$client
    .prepare(
      `SELECT id FROM relay_room_sessions WHERE user_id = ? AND room_id = ?`,
    )
    .get(userId, roomId) as { id?: string } | undefined;
  return row !== undefined && typeof row.id === "string";
}

/**
 * @openapi
 * /relay-room/{roomId}/participants:
 *   get:
 *     summary: Return humans + agents partition for a relay room
 *     tags:
 *       - RelayRoom
 *     parameters:
 *       - name: roomId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Partitioned participants
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 humans:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       mxid: { type: string }
 *                       displayName: { type: string }
 *                       userId: { type: string }
 *                 agents:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       mxid: { type: string }
 *                       identityKey: { type: string }
 *       400:
 *         description: Invalid roomId (fails Matrix grammar)
 *       401:
 *         description: Unauthenticated
 *       404:
 *         description: Row not found OR user not member (same status — no oracle)
 *       502:
 *         description: Downstream proxy failure (no Matrix body leak)
 */
router.get(
  "/:roomId/participants",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // ─── Validate roomId ────────────────────────────────────────────────
    const rawRoomId = req.params.roomId;
    if (typeof rawRoomId !== "string" || !MATRIX_ROOM_ID_RE.test(rawRoomId)) {
      return res.status(400).json({ ok: false, error: "invalid_room_id" });
    }
    const roomId = rawRoomId;

    // ─── Access-control gate (T-90-BE-02) ───────────────────────────────
    // Same SQL literal + same 404-for-both behavior as Task 2's WS server.
    if (!ownsRelayRoomSession(userId, roomId)) {
      databaseLogger.info("relay_room_participants access denied", {
        operation: "relay_room_participants_denied",
        userId,
        roomId,
      });
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    // ─── Fetch joined members via admin creds (T-90-BE-01: token stays
    // ─── inside matrix-admin-client; only the mxid list crosses back).
    const members = await getRoomJoinedMembers(roomId);
    if (members.ok === false) {
      // Canonicalize 403/404 to 404 to the browser (Pitfall 8 same-status
      // discipline). Other failures → 502 with a generic "proxy" error
      // that doesn't leak the raw Matrix response body.
      if (members.status === 403 || members.status === 404) {
        databaseLogger.info("relay_room_participants downstream not found", {
          operation: "relay_room_participants_downstream_not_found",
          userId,
          roomId,
          downstreamStatus: members.status,
        });
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      databaseLogger.warn("relay_room_participants downstream proxy failed", {
        operation: "relay_room_participants_downstream_proxy_failed",
        userId,
        roomId,
        downstreamStatus: members.status,
        downstreamError: members.error,
      });
      return res.status(502).json({ ok: false, error: "proxy" });
    }

    // ─── Classify via SHARED helper (W#9 / T-90-04-C1) ──────────────────
    const classified = await classifyParticipants(members.memberMxids, {
      lookupHumans: lookupHumansFromUsersTable,
    });

    // ─── D-07 viewing-user self-exclusion ───────────────────────────────
    const viewerMxid = await lookupViewingUserMxid(userId);
    const humansOther =
      viewerMxid === null
        ? classified.humans
        : classified.humans.filter((h) => h.mxid !== viewerMxid);

    databaseLogger.info("relay_room_participants ok", {
      operation: "relay_room_participants_ok",
      userId,
      roomId,
      humansCount: humansOther.length,
      agentsCount: classified.agents.length,
    });

    return res.status(200).json({
      humans: humansOther,
      agents: classified.agents,
    });
  },
);

export default router;
