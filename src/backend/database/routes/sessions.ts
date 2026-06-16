import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { hosts } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { sshLogger, databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const PER_HOST_TIMEOUT_MS = 3000;

interface TmuxSessionRow {
  hostId: number;
  hostName: string;
  sessionName: string;
  created: number;
}

/**
 * @openapi
 * /sessions/list:
 *   get:
 *     summary: List tmux sessions across all SSH+autoTmux hosts
 *     tags:
 *       - Sessions
 *     responses:
 *       200:
 *         description: Flat list of sessions. Hosts that error or time out are silently dropped.
 */
router.get("/list", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    // SimpleDBOps decrypts the encrypted columns (terminalConfig, etc.)
    const rows = (await SimpleDBOps.select(
      db.select().from(hosts).where(eq(hosts.userId, userId)),
      "ssh_data",
      userId,
    )) as Array<Record<string, unknown>>;

    const candidates = rows.filter((h) => {
      if (!h.enableSsh) return false;
      let cfg: Record<string, unknown> = {};
      if (typeof h.terminalConfig === "string" && h.terminalConfig) {
        try {
          cfg = JSON.parse(h.terminalConfig as string);
        } catch {
          /* ignore */
        }
      } else if (h.terminalConfig && typeof h.terminalConfig === "object") {
        cfg = h.terminalConfig as Record<string, unknown>;
      }
      return cfg.autoTmux === true;
    });

    const results = await Promise.all(
      candidates.map(async (h): Promise<TmuxSessionRow[]> => {
        const hostId = h.id as number;
        const hostName = ((h.name as string) || (h.ip as string) || "") as string;
        try {
          const resolved = await resolveHostById(hostId, userId);
          if (!resolved) return [];
          const conn = await connectOneShot(
            resolved as unknown as Parameters<typeof connectOneShot>[0],
            PER_HOST_TIMEOUT_MS,
          );
          try {
            const output = await Promise.race([
              execCommand(
                conn,
                "tmux list-sessions -F '#{session_name}|#{session_created}' 2>/dev/null",
              ),
              new Promise<string>((_, reject) =>
                setTimeout(
                  () => reject(new Error("list-sessions timeout")),
                  PER_HOST_TIMEOUT_MS,
                ),
              ),
            ]);
            if (!output) return [];
            return output
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => {
                const [name, created] = line.split("|");
                return {
                  hostId,
                  hostName,
                  sessionName: name,
                  created: parseInt(created, 10) || 0,
                };
              });
          } finally {
            try {
              conn.end();
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          sshLogger.debug("sessions/list: host skipped", {
            operation: "sessions_list_host_skip",
            hostId,
            hostName,
            error: e instanceof Error ? e.message : "unknown",
          });
          return [];
        }
      }),
    );

    const flat = results.flat().sort((a, b) => b.created - a.created);
    return res.json(flat);
  } catch (e) {
    databaseLogger.error("Failed to list tmux sessions", e, {
      operation: "sessions_list",
      userId,
    });
    return res.status(500).json({ error: "Failed to list sessions" });
  }
});

export default router;
