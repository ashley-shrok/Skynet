/**
 * /instance-file router — read and replace the instance file (the CLAUDE.md
 * every root-SSH host gets at /etc/claude-code/CLAUDE.md). Admin-only. Works
 * with the session cookie or a `Bearer tmx_…` API key, so agents can edit it.
 *
 *   GET /instance-file   → { content, updatedAt }
 *   PUT /instance-file   { content } → { content, updatedAt }; "" clears it
 *
 * A save re-sweeps every host so the change lands right away (new sessions
 * pick it up; running sessions don't reload).
 */
import express from "express";
import type { Request, Response } from "express";
import { promises as fs } from "fs";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { systemLogger } from "../../utils/logger.js";
import { callerIsAdmin } from "../../instance-wide/admin.js";
import {
  InstanceFileTooLargeError,
  instanceFilePath,
  readInstanceFile,
  writeInstanceFile,
} from "../../instance-file/store.js";
import { getSubstrateOrchestrator } from "../../distributor/substrate-orchestrator-singleton.js";

const router = express.Router();
const authenticateJWT = AuthManager.getInstance().createAuthMiddleware();

async function updatedAt(): Promise<number | null> {
  try {
    return (await fs.stat(instanceFilePath())).mtimeMs;
  } catch {
    return null;
  }
}

async function requireAdmin(req: Request, res: Response): Promise<string | null> {
  const userId = (req as AuthenticatedRequest).userId;
  if (!(await callerIsAdmin(userId))) {
    res.status(403).json({ error: "only admins can view or edit the instance file" });
    return null;
  }
  return userId;
}

router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    res.json({ content: await readInstanceFile(), updatedAt: await updatedAt() });
  } catch (err) {
    systemLogger.error("instance-file GET failed", {
      operation: "instance_file_get_error",
      error: err instanceof Error ? err.message : "unknown",
    });
    res.status(500).json({ error: "couldn't read the instance file" });
  }
});

router.put("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = await requireAdmin(req, res);
  if (!userId) return;
  const content = (req.body as { content?: unknown } | undefined)?.content;
  if (typeof content !== "string") {
    res.status(400).json({ error: "body must be { content: string }" });
    return;
  }
  try {
    await writeInstanceFile(content);
  } catch (err) {
    if (err instanceof InstanceFileTooLargeError) {
      res.status(413).json({ error: err.message });
      return;
    }
    systemLogger.error("instance-file PUT failed", {
      operation: "instance_file_put_error",
      userId,
      error: err instanceof Error ? err.message : "unknown",
    });
    res.status(500).json({ error: "couldn't save the instance file" });
    return;
  }
  systemLogger.info("Instance file saved", {
    operation: "instance_file_saved",
    userId,
    bytes: Buffer.byteLength(content, "utf-8"),
    cleared: content.trim() === "",
  });
  const orch = getSubstrateOrchestrator();
  if (orch) {
    void orch.resweepAll("instance-file-saved");
  } else {
    systemLogger.warn("Instance file saved but substrate orchestrator is not running", {
      operation: "instance_file_no_orchestrator",
    });
  }
  res.json({ content: content.trim() === "" ? "" : content, updatedAt: await updatedAt() });
});

export default router;
