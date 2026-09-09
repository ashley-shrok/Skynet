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
import { promises as fsp } from "node:fs";
import { AuthManager } from "../utils/auth-manager.js";
import { authLogger } from "../utils/logger.js";
import type { AuthenticatedRequest } from "../../types/index.js";
import {
  setMatrixAdminCreds,
  getMatrixAdminCreds,
  setMatrixAdminServerName,
} from "./matrix-admin-creds-store.js";
import { mintAndWriteHumanToken } from "../telegram/human-token-writer.js";
import { TG_BRIDGE_STATE_DIR } from "../telegram/shared-volume.js";

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
        serverName: creds.serverName,
      });
    } catch (err) {
      authLogger.error("Failed to read matrix-admin creds metadata", err);
      res.status(500).json({ error: "Failed to read matrix-admin creds metadata" });
    }
  },
);

// PATCH the server_name override on the singleton matrix_admin_creds row
// without touching the encrypted accessToken/password columns. Exists so
// the operator can decouple the mxid domain from the homeserverBase URL
// host — needed when the URL must stay as a raw IP (container DNS can't
// resolve the tailnet FQDN) but Synapse's real server_name is a hostname.
//
// Body: `{ serverName: string | null }`. A null (or explicit null) clears
// the override; consumers then fall back to URL-host derivation.
// Non-string / non-null / empty-string values return 400. The Matrix mxid
// domain-part alphabet is `[a-z0-9.-]{1,255}` (per MXID_RE above);
// enforced here so a bad value can't sneak through to mint calls.
router.patch(
  "/creds/server-name",
  express.json(),
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const adminUserId = (req as AuthenticatedRequest).userId;
    const { serverName } = (req.body ?? {}) as Record<string, unknown>;

    if (serverName !== null && typeof serverName !== "string") {
      res
        .status(400)
        .json({ error: "serverName must be a string or null" });
      return;
    }
    if (typeof serverName === "string") {
      if (serverName.length === 0 || serverName.length > 255) {
        res
          .status(400)
          .json({ error: "serverName must be 1-255 chars (or null to clear)" });
        return;
      }
      if (!/^[a-z0-9.-]+$/.test(serverName)) {
        res
          .status(400)
          .json({ error: "serverName must match [a-z0-9.-]+" });
        return;
      }
    }

    try {
      const applied = await setMatrixAdminServerName(
        serverName as string | null,
      );
      if (!applied) {
        res.status(409).json({
          error:
            "matrix_admin_creds not yet ingested — POST /matrix-admin/creds first",
        });
        return;
      }

      authLogger.info("matrix-admin server_name patched", {
        operation: "matrix_admin_creds_server_name_patch",
        adminId: adminUserId,
        serverName,
      });

      res.json({ ok: true, serverName });
    } catch (err) {
      authLogger.error("Failed to patch matrix-admin server_name", err);
      res
        .status(500)
        .json({ error: "Failed to patch matrix-admin server_name" });
    }
  },
);

// Phase 79 Plan 08 — one-shot admin-gated migration endpoint.
// For each Skynet user with a non-null mxid, mints a fresh Matrix token
// via loginAsUser (Phase 77 admin primitive) and writes it to
// /state/<humanName>.token (mode 0600, atomic .tmp+rename). Then scans
// TG_BRIDGE_STATE_DIR for legacy `<humanName>.cred` files (plaintext
// passwords from Nina's bridge) and deletes each one.
//
// Idempotent by design — safe to re-run. Second call re-mints (Synapse
// loginAsUser is cheap + stateless per RESEARCH § Q9) and reports the
// same shape. Zero artificial "already-migrated" gate: the endpoint's
// job is to GUARANTEE tokens exist and .cred files do not.
//
// Users with mxid === null (Laura, per RESEARCH § A6) are reported as
// `status: "skipped-no-mxid"` — Laura's mxid provisioning is deferred.
router.post(
  "/migrate-cred-files",
  express.json(),
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const adminUserId = (req as AuthenticatedRequest).userId;
    try {
      // Dynamic import to avoid a circular-module problem at boot —
      // matrix-admin-routes is imported from server.ts very early, and
      // pulling db + schema at top-level tangles the initialization
      // graph. This mirrors the same pattern used above for
      // saveMemoryDatabaseToFile in the /creds handler.
      const { db } = await import("../database/db/index.js");
      const { users } = await import("../database/db/schema.js");
      const rows = (await db
        .select({ name: users.username, mxid: users.mxid })
        .from(users)) as Array<{
        name: string | null;
        mxid: string | null;
      }>;

      const results: Array<{
        humanName: string;
        mxid: string | null;
        status: "minted" | "failed" | "skipped-no-mxid";
        error?: string;
      }> = [];

      for (const row of rows) {
        // Blocker B-4 (verified): users.username is already lowercase in
        // prod. .toLowerCase() below is defensive — no-op today, safety
        // net if the column ever drifts.
        const humanName = String(row.name ?? "").toLowerCase();
        if (!humanName) continue;
        if (!row.mxid) {
          results.push({ humanName, mxid: null, status: "skipped-no-mxid" });
          continue;
        }
        try {
          const mintResult = await mintAndWriteHumanToken(row.mxid, humanName);
          // Note: use `=== false` narrowing (not `!mintResult.ok`) — strict tsc
          // (tsconfig.node.json used by docker build) does not narrow
          // discriminated unions on the truthy-`.ok` branch here, whereas
          // `=== false` works. See commit 967ab598 (Phase 77 rescue) for the
          // same fix pattern in identity-birth-orchestrator.ts.
          if (mintResult.ok === false) {
            results.push({
              humanName,
              mxid: row.mxid,
              status: "failed",
              error: mintResult.error,
            });
          } else {
            results.push({ humanName, mxid: row.mxid, status: "minted" });
          }
        } catch (mintThrew) {
          // Defensive — mintAndWriteHumanToken shouldn't throw except on
          // guard-rejected humanName. Report per-row so the batch continues.
          results.push({
            humanName,
            mxid: row.mxid,
            status: "failed",
            error: mintThrew instanceof Error ? mintThrew.message : "unknown",
          });
        }
      }

      // Delete legacy .cred files under the shared volume. Scoped by
      // suffix inside TG_BRIDGE_STATE_DIR only — readdir returns bare
      // filenames, no attacker-controlled absolute paths.
      const entries = await fsp
        .readdir(TG_BRIDGE_STATE_DIR)
        .catch(() => [] as string[]);
      const credFiles = entries.filter((e) => e.endsWith(".cred"));
      const deletedCredFiles: string[] = [];
      for (const f of credFiles) {
        try {
          await fsp.unlink(`${TG_BRIDGE_STATE_DIR}/${f}`);
          deletedCredFiles.push(f);
        } catch (unlinkErr) {
          authLogger.warn("migrate-cred-files: failed to unlink cred file", {
            operation: "matrix_admin_migrate_cred_files_unlink_failed",
            filename: f,
            error: unlinkErr instanceof Error ? unlinkErr.message : "unknown",
          });
        }
      }

      authLogger.info("matrix-admin migrate-cred-files completed", {
        operation: "matrix_admin_migrate_cred_files",
        adminId: adminUserId,
        mintedCount: results.filter((r) => r.status === "minted").length,
        failedCount: results.filter((r) => r.status === "failed").length,
        skippedCount: results.filter((r) => r.status === "skipped-no-mxid").length,
        deletedCredFilesCount: deletedCredFiles.length,
      });

      res.json({ ok: true, results, deletedCredFiles });
    } catch (err) {
      authLogger.error("Failed to migrate cred files", err);
      res.status(500).json({ error: "Failed to migrate cred files" });
    }
  },
);

export default router;
