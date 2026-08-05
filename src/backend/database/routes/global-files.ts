/**
 * Phase 23 (GEFM-03): GET /global-files?hostId=<n> — per-host configured file list.
 *
 * Reads the operator-authored `/app/data/global-files.json` config (via the
 * loadGlobalFilesConfig helper) and returns the file list for the requested host.
 *
 * This is a LOCAL-only route — no SSH. The config file lives on the Skynet server
 * itself (mounted from the `skynet-data` docker volume), not on the managed hosts.
 *
 * Response shape: { files: [{ path, label? }] }
 *   - Empty array when the config is missing or the host has no entries (not 404).
 *   - Per GEFM-03: "missing config = empty state, not error".
 *
 * Security:
 *   - authenticateJWT gates the route (admin cookie required).
 *   - resolveHostById(hostId, userId) provides per-user host isolation (404 for
 *     cross-user / unknown hosts) — same guard used by roles-list-for-host.ts.
 *   - 400 on missing/invalid hostId (mirrors roles-list-for-host.ts L114-120).
 *   - Config read errors return 200 with empty files (fail-safe; no error info leaked).
 *
 * Mount: app.use("/global-files", globalFilesListRoutes) in database.ts.
 * Wave-2 plan (GEFM-04) adds a second router on the same base path for POST /read
 * and PUT /write — Express chaining handles the split transparently.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { sshLogger } from "../../utils/logger.js";
import {
  loadGlobalFilesConfig,
  getFilesForHost,
} from "./global-files-config-loader.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * GET /global-files?hostId=<n>
 * Returns { files: [{path, label?}] } for the host's configured global files.
 * Empty array if the host has no config or the config file is missing.
 */
router.get(
  "/",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId (mirrors roles-list-for-host.ts L112-120).
    const rawHostId = req.query.hostId;
    if (rawHostId === undefined || rawHostId === "") {
      return res.status(400).json({ error: "hostId is required" });
    }
    const hostId = parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }

    // 2. Per-user host isolation — returns null for cross-user / unknown hosts
    //    (mirrors roles-list-for-host.ts L122-126).
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    // 3. Read the local config file and return the file list.
    //    Any read/parse error inside loadGlobalFilesConfig returns { hosts: {} }
    //    (never throws), so the outer try/catch is a safety net for unexpected
    //    failures only.
    try {
      const config = await loadGlobalFilesConfig();
      const files = getFilesForHost(config, { id: host.id, name: host.name });
      return res.json({ files });
    } catch (err) {
      sshLogger.error("global-files: unexpected error reading config", {
        operation: "global_files_list_error",
        hostId,
        error: err instanceof Error ? err.message : String(err),
      });
      return res.status(500).json({ error: "internal" });
    }
  },
);

// Generic 500 fallback error handler (mirrors roles-list-for-host.ts L236-251).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    sshLogger.error("global-files: unhandled error", {
      operation: "global_files_error",
      error: err?.message,
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
