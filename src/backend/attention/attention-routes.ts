/**
 * attention-routes.ts — HTTP surface for per-user read state.
 *
 *   GET  /attention/read-state → { baselineAt, seen: [{hostId, identityName, seenFinishAt}] }
 *        Creates the user's baseline on first call (launch day = all read).
 *   POST /attention/seen { hostId, identityName, seenFinishAt } → 204
 *        Advances the user's seen mark (monotonic) and, when it moved, pushes
 *        a read-state-changed frame to every one of that user's open tabs.
 *
 * Read state is the caller's own, so the only gate is authentication.
 */
import express, { type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { AuthManager } from "../utils/auth-manager.js";
import { systemLogger } from "../utils/logger.js";
import { getRegistry } from "../fleet-status/registry-holder.js";
import { FRAME_SCHEMA_VERSION } from "../fleet-status/wire-protocol.js";
import { getReadStateStore, isValidIdentityName } from "./read-state-store.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const MAX_HOST_ID_LEN = 64;

router.get("/read-state", authenticateJWT, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const state = getReadStateStore().getForUser(userId);
    systemLogger.info("attention read-state served", {
      operation: "attention_read_state_get",
      userId,
      baselineAt: state.baselineAt,
      seenCount: state.seen.length,
    });
    return res.json(state);
  } catch (err) {
    systemLogger.error("attention read-state read failed", err, {
      operation: "attention_read_state_get",
      userId,
      resultStatus: 500,
    });
    return res.status(500).json({ error: "failed to read read state" });
  }
});

router.post("/seen", authenticateJWT, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const body = (req.body ?? {}) as {
    hostId?: unknown;
    identityName?: unknown;
    seenFinishAt?: unknown;
  };
  const { hostId, identityName, seenFinishAt } = body;
  if (typeof hostId !== "string" || hostId.length === 0 || hostId.length > MAX_HOST_ID_LEN) {
    return res.status(400).json({ error: "invalid hostId" });
  }
  if (!isValidIdentityName(identityName)) {
    return res.status(400).json({ error: "invalid identityName" });
  }
  if (typeof seenFinishAt !== "number" || !Number.isFinite(seenFinishAt) || seenFinishAt <= 0) {
    return res.status(400).json({ error: "invalid seenFinishAt" });
  }

  let advanced: boolean;
  try {
    advanced = getReadStateStore().markSeen(userId, hostId, identityName, seenFinishAt);
  } catch (err) {
    systemLogger.error("attention mark-seen failed", err, {
      operation: "attention_mark_seen",
      userId,
      fleetHostId: hostId,
      identityName,
      seenFinishAt,
      resultStatus: 500,
    });
    return res.status(500).json({ error: "failed to mark seen" });
  }

  systemLogger.info("attention mark-seen", {
    operation: "attention_mark_seen",
    userId,
    fleetHostId: hostId,
    identityName,
    seenFinishAt,
    advanced,
  });

  if (advanced) {
    const registry = getRegistry();
    if (registry) {
      registry.publishToUser(userId, {
        schemaVersion: FRAME_SCHEMA_VERSION,
        type: "read-state-changed",
        hostId,
        identityName,
        seenFinishAt,
      });
    } else {
      systemLogger.warn("attention mark-seen: registry not ready, other tabs not notified", {
        operation: "attention_mark_seen_no_registry",
        userId,
      });
    }
  }
  return res.status(204).end();
});

export default router;
