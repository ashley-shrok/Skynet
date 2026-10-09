/**
 * PUT /identities/:key/pinned  body: { hostId: number, pinned: boolean }
 *   → { pinned: boolean }
 *
 * Single-identity pin toggle — writes or removes `~/fleet/identities/<key>/.pinned`
 * on the identity's host via the per-identity-file primitive. Idempotent.
 *
 * Replaces the whole-set `PUT /user-preferences { pinnedConversationIds,
 * identityHosts }` path for pin/unpin clicks. That path reconciled disk to
 * whatever full set the client sent, which (a) let a stale second tab silently
 * unpin what another tab just pinned, (b) let two fast clicks race each other,
 * and (c) 400'd the entire write whenever one id in the set had no host
 * mapping (a pinned relay room, an orphaned pin) — after which no identity pin
 * persisted at all. A per-key delta has none of those failure modes, and
 * touches one host instead of probing every identity on every host.
 *
 * Other tabs / users learn the change through the fleet-status sweep: the
 * identity-appearance fingerprint carries `pinned`, so the next tick emits an
 * update frame.
 *
 * Mounted in database.ts BEFORE the generic /identities router (same
 * discipline as no-dormancy / archive).
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
import {
  writeIdentityFile,
  removeIdentityFile,
} from "../../claude-session/per-identity-file.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const SSH_CONNECT_TIMEOUT_MS = 3000;

router.put(
  "/:key/pinned",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const body = (req.body ?? {}) as { hostId?: unknown; pinned?: unknown };

    const rawHostId = body.hostId;
    if (rawHostId === undefined || rawHostId === null || rawHostId === "") {
      return res.status(400).json({ error: "hostId is required" });
    }
    const hostId =
      typeof rawHostId === "number" ? rawHostId : parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }

    if (typeof body.pinned !== "boolean") {
      return res.status(400).json({ error: "pinned must be a boolean" });
    }
    const pinned = body.pinned;

    const key = String(req.params.key ?? "");
    if (!key || !IDENTITY_KEY_RE.test(key)) {
      return res
        .status(400)
        .json({ error: "identity key must match [a-z0-9_-]{1,64}" });
    }

    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch {
        return res.status(504).json({ error: "Host unreachable" });
      }
    }

    try {
      if (pinned) {
        await writeIdentityFile(key, ".pinned", "", { hostId, conn });
      } else {
        await removeIdentityFile(key, ".pinned", { hostId, conn });
      }
      databaseLogger.info("identity pin set", {
        operation: "identity_pin_set",
        userId,
        hostId,
        identityKey: key,
        pinned,
      });
      return res.json({ pinned });
    } catch (err) {
      databaseLogger.error("identity pin write failed", err, {
        operation: "identity_pin_set_failed",
        userId,
        hostId,
        identityKey: key,
        pinned,
      });
      return res.status(500).json({ error: "failed to update pin" });
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

router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "identity-pin route error" });
  },
);

export default router;
