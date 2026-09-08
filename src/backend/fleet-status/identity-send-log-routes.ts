// Phase 85 (D-01, D-05, D-10): identity-send-log HTTP surface. POST /stamp is
// called by the frontend compose-send funnel on every send-attempt. Auth-gated.
// Fire-and-forget from the client's perspective — the client does not await
// the response. Backend authority for multi-device consistency (both phone and
// desktop read from the same store on their next fleet-status frame).
//
// This module is a thin HTTP wrapper over `stampIdentityLastSend` from the
// identity-send-log-store single-seam (Plan 85-02). The store owns the
// monotonic guard, the drizzle upsert, and the DatabaseSaveTrigger persistence
// flush; this route only owns auth-gating, input parsing/validation, and
// dispatch. Two validation layers give defense-in-depth against
// identityName-injection (T-85-03-02): reject at the route boundary AND at
// the store's own re-validation.
//
// No GET endpoint — reads happen in-process from ssh-poll-orchestrator via
// the store module directly (Plan 85-04). No HTTP read path is needed.

import express from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../../types/index.js";
import { AuthManager } from "../utils/auth-manager.js";
import { systemLogger } from "../utils/logger.js";
import { stampIdentityLastSend } from "./identity-send-log-store.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// T-85-03-02 mitigation ceiling: matches the store's MAX_IDENTITY_NAME_LEN
// (identity-send-log-store.ts). Legitimate tmux session / identity names are
// short; 256 is a generous ceiling that still bounds the primary-key column.
const MAX_IDENTITY_NAME_LEN = 256;

router.post(
  "/stamp",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const body = (req.body ?? {}) as {
      identityName?: unknown;
      ts?: unknown;
    };

    // ---- identityName validation (T-85-03-02) ---------------------------
    const identityName = body.identityName;
    if (
      typeof identityName !== "string" ||
      identityName.length === 0 ||
      identityName.length > MAX_IDENTITY_NAME_LEN
    ) {
      systemLogger.info("identity-send-log stamp route rejected: invalid identityName", {
        operation: "identity_send_log_stamp_route",
        userId,
        identityName: typeof identityName === "string" ? identityName : null,
        resultStatus: 400,
      });
      return res.status(400).json({ error: "invalid identityName" });
    }

    // ---- ts validation (default to Date.now() when absent) --------------
    let ts: number;
    if (body.ts === undefined) {
      ts = Date.now();
    } else if (
      typeof body.ts === "number" &&
      Number.isFinite(body.ts) &&
      body.ts > 0
    ) {
      ts = body.ts;
    } else {
      systemLogger.info("identity-send-log stamp route rejected: invalid ts", {
        operation: "identity_send_log_stamp_route",
        userId,
        identityName,
        ts: body.ts,
        resultStatus: 400,
      });
      return res.status(400).json({ error: "invalid ts" });
    }

    // ---- Dispatch to the store ------------------------------------------
    try {
      await stampIdentityLastSend(identityName, ts);
      systemLogger.info("identity-send-log stamp route ok", {
        operation: "identity_send_log_stamp_route",
        userId,
        identityName,
        ts,
        resultStatus: 204,
      });
      return res.status(204).end();
    } catch (err) {
      systemLogger.error(
        "identity-send-log stamp route failed",
        err,
        {
          operation: "identity_send_log_stamp_route",
          userId,
          identityName,
          ts,
          resultStatus: 500,
        },
      );
      return res.status(500).json({ error: "failed to stamp send log" });
    }
  },
);

export default router;
