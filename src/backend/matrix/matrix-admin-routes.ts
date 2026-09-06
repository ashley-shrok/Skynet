/**
 * Phase 75 amendment — POST /matrix-admin/creds ingestion endpoint.
 *
 * The Phase 75 plans (75-01..05) shipped setMatrixAdminCreds() as an in-process
 * store function but did not include an HTTP surface for calling it. This
 * endpoint closes that gap: an admin-gated route that accepts the @skynet-admin
 * relay credentials in the request body and writes them into the encrypted
 * matrix_admin_creds table via setMatrixAdminCreds(). Same endpoint handles
 * the one-shot initial bootstrap AND future admin-cred rotation (returns
 * `rotation: true` when overwriting an existing row).
 *
 * Mount point: app.use("/matrix-admin", matrixAdminRoutes)
 */
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../utils/auth-manager.js";
import { authLogger } from "../utils/logger.js";
import type { AuthenticatedRequest } from "../../types/index.js";
import {
  setMatrixAdminCreds,
  getMatrixAdminCreds,
} from "./matrix-admin-creds-store.js";

const MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/;

const router = express.Router();
const authManager = AuthManager.getInstance();
const requireAdmin = authManager.createAdminMiddleware();

router.post(
  "/creds",
  express.json(),
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const adminUserId = (req as AuthenticatedRequest).userId;
    const {
      homeserverBase,
      userId: mxid,
      password,
      accessToken,
    } = (req.body ?? {}) as Record<string, unknown>;

    if (
      typeof homeserverBase !== "string" ||
      !/^https?:\/\/[^\s]+$/.test(homeserverBase)
    ) {
      res.status(400).json({ error: "homeserverBase must be an http(s) URL" });
      return;
    }
    if (typeof mxid !== "string" || !MXID_RE.test(mxid)) {
      res.status(400).json({ error: "userId must match @localpart:server_name" });
      return;
    }
    if (typeof password !== "string" || password.length === 0) {
      res.status(400).json({ error: "password required" });
      return;
    }
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      res.status(400).json({ error: "accessToken required" });
      return;
    }

    try {
      const existing = await getMatrixAdminCreds();
      const isRotation = existing !== null;

      await setMatrixAdminCreds({
        homeserverBase,
        userId: mxid,
        password,
        accessToken,
      });

      try {
        const { saveMemoryDatabaseToFile } = await import(
          "../database/db/index.js"
        );
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error(
          "Failed to persist matrix-admin creds to disk",
          saveError,
          { operation: "matrix_admin_creds_save_failed" },
        );
      }

      authLogger.info("matrix-admin creds ingested", {
        operation: isRotation
          ? "matrix_admin_creds_rotate"
          : "matrix_admin_creds_ingest",
        adminId: adminUserId,
        mxid,
        homeserverBase,
      });

      res.json({ ok: true, mxid, rotation: isRotation });
    } catch (err) {
      authLogger.error("Failed to ingest matrix-admin creds", err);
      res.status(500).json({ error: "Failed to ingest matrix-admin creds" });
    }
  },
);

router.get(
  "/creds",
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const creds = await getMatrixAdminCreds();
      if (!creds) {
        res.json({ present: false });
        return;
      }
      res.json({
        present: true,
        mxid: creds.userId,
        homeserverBase: creds.homeserverBase,
      });
    } catch (err) {
      authLogger.error("Failed to read matrix-admin creds metadata", err);
      res.status(500).json({ error: "Failed to read matrix-admin creds metadata" });
    }
  },
);

export default router;
