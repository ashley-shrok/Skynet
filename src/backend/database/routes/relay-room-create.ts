/**
 * relay-room-create.ts — Phase 91 Plan 03.
 *
 * POST /relay-room/create — Express router module.
 *
 * Orchestrates the new-conversation modal's create flow:
 *   auth → validation → Matrix room creation → invite fan-out →
 *   session materialization → response.
 *
 * ## STRIDE mitigations implemented here
 *
 * T-91-BE-01 (Spoofing): authenticateJWT middleware enforces JWT on every
 *   request. The same authManager.createAuthMiddleware() used by the sibling
 *   relay-room-participants.ts route.
 *
 * T-91-BE-02 (EoP): viewerMxid is derived server-side from userId (JWT) →
 *   users.mxid lookup. The request body never carries viewerMxid — a client
 *   cannot spoof identity. Refusing with 400 viewer_no_mxid when not found.
 *
 * T-91-BE-03 (DoS): MAX_PARTICIPANTS = 32 cap enforced BEFORE any Matrix
 *   call. Count is post-filter — a client submitting 100 invalid mxids only
 *   counts the valid fleet members.
 *
 * T-91-BE-04 (Tampering): Two-layer mxid defense:
 *   Layer 1 — MXID_RE grammar filter (drops malformed strings before DB).
 *   Layer 2 — fleet-registry filter (humans must be in users.mxid; agents
 *   accepted without DB gate since the identities table was dropped in Phase
 *   68 and agents live on-disk in relay.json; log every dropped mxid).
 *
 * T-91-BE-05 (Info Disclosure): response body is ONLY Skynet-owned
 *   identifiers { ok, roomId, sessionId, roomTitle }. Zero Matrix tokens.
 *
 * ## Room creation path (planner-locked)
 *
 * Uses createRoomAsUser(viewerMxid, ...) so the viewer is PL100 creator —
 * matches shape §Shape "A room is created on the relay via the user's own
 * relay identity". Alternate path (admin-owned createRoom) was rejected
 * because it attributes the room to @skynet-admin, which confuses per-user
 * notifications in Matrix clients.
 *
 * ## Invite policy (planner-locked)
 *
 * Best-effort per-invite. A single failed invite does NOT roll back the room
 * — per shape §Philosophy "v1 has no post-creation membership changes, so a
 * partial-invited room is the worst outcome, not an undefined one". Rolling
 * back the room would force the user to re-do the flow end-to-end (worse
 * UX). Slice B's observation loop (Phase 89-03) is the safety net that
 * catches missed invites on its next tick.
 *
 * ## forceSave note (MUST NOT add here)
 *
 * materializeRelayRoomSession handles its own forceSave internally at
 * relay-room-sessions-store.ts:87. Do NOT add a redundant forceSave at this
 * route level — it would cause a double-flush with no benefit (the session
 * is already durable after materialize returns).
 *
 * ## Identities table (Phase 68 note)
 *
 * The identities table was dropped in Phase 68 per
 * shape-kill-identities-table.md. Agent mxids live on-disk in
 * ~/.claude/identities/<name>/relay.json. There is no database registry for
 * agents that this route can query. The fleet-registry helper therefore
 * only gates humanMxids against users.mxid; agentMxids pass registry
 * validation as long as they satisfy the MXID_RE grammar (Layer 1). Every
 * dropped human mxid is logged for triage.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import {
  createRoomAsUser,
  inviteToRoom,
} from "../../matrix/matrix-admin-client.js";
import { materializeRelayRoomSession } from "../../relay-sessions/relay-room-sessions-store.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * T-91-BE-03: Maximum participant count enforced BEFORE any Matrix call.
 * Post-filter count — only fleet-valid mxids count toward the cap.
 * Shape §What would make it wrong: "Two rapid clicks / spray".
 */
const MAX_PARTICIPANTS = 32;

/**
 * MXID grammar filter — T-91-BE-04 Layer 1.
 *
 * Matches Matrix client-server API §2.1.2 user-id format.
 * Inlined from matrix-admin-routes.ts L27 byte-for-byte (that constant is
 * not exported; inlining is option (b) from the plan — acceptable given the
 * export cascade would require touching matrix-admin-routes.ts, which is
 * outside this plan's file_modified list).
 */
const MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/;

// ---------------------------------------------------------------------------
// lookupViewingUserMxid — verbatim from relay-room-participants.ts L78-99.
// Returns null if the user row is absent or mxid is NULL / empty string.
// ---------------------------------------------------------------------------

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
      "relay-room-create: lookupViewingUserMxid failed",
      {
        operation: "relay_room_create_lookup_viewer_mxid_failed",
        userId,
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// loadFleetMxidRegistry — T-91-BE-04 Layer 2.
//
// Reads users.mxid (WHERE mxid IS NOT NULL) into the humans Set.
// Agents are NOT in a database table (Phase 68 dropped identities; agents
// live on-disk in relay.json). The agents key is therefore not used for
// filtering — only humanMxids are gated against the humans Set.
//
// Fail-closed: on DB error returns { humans: new Set() } which causes ALL
// humanMxids to be filtered out — better than "allow all" which would open
// the relay to arbitrary human mxid injection.
// ---------------------------------------------------------------------------

async function loadFleetMxidRegistry(): Promise<{ humans: Set<string> }> {
  try {
    const rows = db.$client
      .prepare(`SELECT mxid FROM users WHERE mxid IS NOT NULL AND mxid != ''`)
      .all() as Array<{ mxid: string }>;
    const humans = new Set(rows.map((r) => r.mxid));
    return { humans };
  } catch (err) {
    databaseLogger.warn(
      "relay-room-create: loadFleetMxidRegistry failed",
      {
        operation: "relay_room_create_registry_load_failed",
        error: err instanceof Error ? err.message : "unknown",
      },
    );
    // Fail-closed: empty set causes all humanMxids to be rejected.
    return { humans: new Set() };
  }
}

// ---------------------------------------------------------------------------
// POST /create
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /relay-room/create:
 *   post:
 *     summary: Create a new relay room, invite participants, and materialize the session row
 *     tags:
 *       - RelayRoom
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roomName, humanMxids, agentMxids]
 *             properties:
 *               roomName:
 *                 type: string
 *                 description: Human-readable name (non-empty after trim)
 *               humanMxids:
 *                 type: array
 *                 items: { type: string }
 *               agentMxids:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       201:
 *         description: Room created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean, enum: [true] }
 *                 roomId: { type: string }
 *                 sessionId: { type: string }
 *                 roomTitle: { type: string }
 *       400:
 *         description: Validation error (see error field)
 *       401:
 *         description: Unauthenticated
 *       502:
 *         description: Downstream Matrix proxy failure
 */
router.post("/create", authenticateJWT, async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // ─── Step 1: Validate body shape ─────────────────────────────────────
    const body = req.body as {
      roomName?: unknown;
      humanMxids?: unknown;
      agentMxids?: unknown;
    };

    if (
      typeof body.roomName !== "string" ||
      !Array.isArray(body.humanMxids) ||
      !Array.isArray(body.agentMxids)
    ) {
      return res.status(400).json({ ok: false, error: "invalid_body" });
    }

    // ─── Step 2: Trim + blank-name check ─────────────────────────────────
    const trimmed = body.roomName.trim();
    if (trimmed === "") {
      return res.status(400).json({ ok: false, error: "room_name_required" });
    }

    // ─── Step 3: MXID grammar filter — T-91-BE-04 Layer 1 ───────────────
    // H2: log every drop so operators can triage malformed client submissions.
    // Distinct op codes from the Layer-2 registry drops for easier log triage.
    const rawHumanMxids = (body.humanMxids as unknown[]).filter(
      (s): s is string => typeof s === "string",
    );
    const rawAgentMxids = (body.agentMxids as unknown[]).filter(
      (s): s is string => typeof s === "string",
    );

    let humanMxids = rawHumanMxids.filter((s) => MXID_RE.test(s));
    let agentMxids = rawAgentMxids.filter((s) => MXID_RE.test(s));

    for (const droppedMxid of rawHumanMxids.filter((s) => !MXID_RE.test(s))) {
      databaseLogger.warn(
        "relay-room-create: dropped invalid-grammar human mxid (Layer 1)",
        {
          operation: "relay_room_create_dropped_invalid_grammar_human_mxid",
          userId,
          droppedMxid,
          droppedCount: 1,
        },
      );
    }
    for (const droppedMxid of rawAgentMxids.filter((s) => !MXID_RE.test(s))) {
      databaseLogger.warn(
        "relay-room-create: dropped invalid-grammar agent mxid (Layer 1)",
        {
          operation: "relay_room_create_dropped_invalid_grammar_agent_mxid",
          userId,
          droppedMxid,
          droppedCount: 1,
        },
      );
    }

    // ─── Step 4: Fleet-registry filter — T-91-BE-04 Layer 2 ─────────────
    // Only human mxids are gated against users.mxid. Agent mxids pass
    // (identities table dropped Phase 68 — no DB registry for agents).
    const registry = await loadFleetMxidRegistry();

    const droppedHumans = humanMxids.filter((m) => !registry.humans.has(m));
    humanMxids = humanMxids.filter((m) => registry.humans.has(m));

    for (const droppedMxid of droppedHumans) {
      databaseLogger.warn(
        "relay-room-create: dropped non-fleet human mxid",
        {
          operation: "relay_room_create_dropped_non_fleet_mxid",
          userId,
          droppedMxid,
          reason: "not_in_fleet",
        },
      );
    }

    // ─── Step 5: Participant count cap — T-91-BE-03 ───────────────────────
    if (humanMxids.length + agentMxids.length > MAX_PARTICIPANTS) {
      return res
        .status(400)
        .json({ ok: false, error: "too_many_participants" });
    }

    // ─── Step 6: Zero-participant check ──────────────────────────────────
    if (humanMxids.length === 0 && agentMxids.length === 0) {
      return res.status(400).json({ ok: false, error: "no_participants" });
    }

    // ─── Step 7: Single-agent-only check (UX coherence — shape §Philosophy)
    if (humanMxids.length === 0 && agentMxids.length === 1) {
      return res
        .status(400)
        .json({ ok: false, error: "single_agent_disallowed" });
    }

    // ─── Step 8: Viewer mxid lookup — T-91-BE-02 ─────────────────────────
    // Derived server-side from JWT userId → users.mxid. Request body never
    // carries viewerMxid — impossible to spoof the room creator identity.
    const viewerMxid = await lookupViewingUserMxid(userId);
    if (viewerMxid === null) {
      return res.status(400).json({ ok: false, error: "viewer_no_mxid" });
    }

    // ─── Step 9: Create room as the viewer (planner-locked: createRoomAsUser)
    // createRoomAsUser mints a per-user token via loginAsUser(viewerMxid) so
    // the viewer is PL100 creator — matches shape §Shape "via the user's own
    // relay identity". See file docblock for path-choice rationale.
    const roomResult = await createRoomAsUser(viewerMxid, {
      name: trimmed,
      preset: "private_chat",
      visibility: "private",
    });

    if (!roomResult.ok) {
      databaseLogger.warn(
        "relay-room-create: createRoomAsUser failed",
        {
          operation: "relay_room_create_room_failed",
          userId,
          downstreamStatus: roomResult.status,
          downstreamError: roomResult.error,
        },
      );
      return res.status(502).json({ ok: false, error: "proxy" });
    }

    const roomId = roomResult.roomId;

    // ─── Step 10: Invite loop — best-effort (planner-locked policy) ──────
    // On any per-invite failure: log relay_room_create_invite_failed and
    // CONTINUE the loop. Do NOT roll back the room. Shape §Philosophy:
    // "v1 has no post-creation membership changes — a rollback would force
    // the user to redo the flow end-to-end, which is worse UX than a
    // partial room." Slice B's observation loop (Phase 89-03) is the safety
    // net that catches missed invites on its next ~10s tick.
    const allInvitees = [...humanMxids, ...agentMxids];
    for (const mxid of allInvitees) {
      const inviteResult = await inviteToRoom(roomId, mxid, viewerMxid);
      if (!inviteResult.ok) {
        databaseLogger.warn(
          "relay-room-create: invite failed (best-effort — not rolling back)",
          {
            operation: "relay_room_create_invite_failed",
            userId,
            roomId,
            inviteeMxid: mxid,
            downstreamStatus: inviteResult.status,
          },
        );
        // Continue loop — do not roll back the room (policy locked above).
      }
    }

    // ─── Step 11: Materialize session row — D-14 schema-as-coordinator ───
    // Fast-path: inserts the relay_room_sessions row NOW so the sidebar entry
    // appears immediately without waiting for the observation loop's ~10s tick.
    // INSERT ... ON CONFLICT(user_id, room_id) DO NOTHING — idempotent with
    // the observation loop. forceSave is handled internally by
    // materializeRelayRoomSession at relay-room-sessions-store.ts:87.
    // Do NOT add a redundant forceSave here (see file docblock).
    try {
      await materializeRelayRoomSession(userId, roomId, trimmed);
    } catch (err) {
      databaseLogger.warn(
        "relay-room-create: materialize failed (observation-loop safety net will catch up)",
        {
          operation: "relay_room_create_materialize_failed",
          userId,
          roomId,
          error: err instanceof Error ? err.message : "unknown",
        },
      );
      // Swallow — observation-loop safety net (Phase 89-03) will materialize
      // on its next tick. A 500 here would discard the created room from the
      // user's perspective even though Matrix creation + invites succeeded.
    }

    // ─── Step 12: Look up sessionId for the response ──────────────────────
    // If materialize failed AND the observation loop hasn't caught up yet,
    // the row may be absent — sessionId is '' in that case (client can
    // poll or rely on the sidebar refresh from /sessions/list).
    const sessionRow = db.$client
      .prepare(
        `SELECT id FROM relay_room_sessions WHERE user_id = ? AND room_id = ?`,
      )
      .get(userId, roomId) as { id?: string } | undefined;
    const sessionId = sessionRow?.id ?? "";

    // ─── Step 13: Structured success log — T-91-BE-06 audit trail ────────
    databaseLogger.info(
      "relay_room_create ok",
      {
        operation: "relay_room_create_ok",
        userId,
        roomId,
        humansCount: humanMxids.length,
        agentsCount: agentMxids.length,
      },
    );

    // ─── Step 14: Response — T-91-BE-05 info-disclosure mitigation ───────
    // ONLY Skynet-owned identifiers. No Matrix response bodies, no tokens,
    // no admin creds. Shape §Shape "Response fields: ok, roomId, sessionId,
    // roomTitle".
    return res.status(201).json({
      ok: true,
      roomId,
      sessionId,
      roomTitle: trimmed,
    });
  },
);

export default router;
