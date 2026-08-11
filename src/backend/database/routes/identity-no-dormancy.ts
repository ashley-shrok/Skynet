/**
 * Quick 260811-ax1: /identities/:key/no-dormancy — per-identity "stays awake"
 * sentinel toggle.
 *
 * GET /identities/:key/no-dormancy?hostId=<n>
 *   → { present: boolean }
 *
 * PUT /identities/:key/no-dormancy?hostId=<n>  body: { present: boolean }
 *   → { present: boolean }
 *
 * Checks / sets / clears `~/.claude/identities/<key>/.no-dormancy` on the
 * target host:
 *   - LOCAL branch: when hostId is in IDENTITIES_LOCAL_HOST_IDS, probe is a
 *     local fs operation against getLocalIdentitiesRoot()/<key>/.no-dormancy.
 *   - SSH branch: otherwise, opens a connectOneShot SSH connection and runs
 *     idempotent shell commands via execCommand.
 *
 * Security:
 *   - IDENTITY_KEY_RE gates all keys BEFORE any SSH/fs work (shell injection
 *     prevention, T-ax1-01). Imported from identity-artifact-reader.ts — do
 *     NOT copy; single-sourced per plan requirement.
 *   - The key is validated by IDENTITY_KEY_RE before any shell command is
 *     constructed; interpolated raw inside double-quoted paths (validate-then-
 *     interpolate pattern matching identity-exists-on-host.ts).
 *   - SSH errors return 504 with generic "Host unreachable" — no detail leak
 *     (T-ax1-04).
 *   - cross-user / unknown hostId → 404 via resolveHostById (T-ax1-03).
 *
 * Timeouts (3-tier):
 *   - SSH connect: 3000ms (connectOneShot second arg)
 *   - SSH exec race: 3000ms (Promise.race inside SSH branch)
 *   - Nginx outer: 10s (proxy_read_timeout; existing /identities block covers
 *     this path — no nginx changes needed)
 *
 * Mounted in database.ts BEFORE the generic /identities router so that
 * /identities/:key/no-dormancy resolves here and does not fall through to
 * identitiesRoutes (which has /:id routes that would swallow the key).
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import {
  isLocalHostId,
  IDENTITY_KEY_RE,
  getLocalIdentitiesRoot,
} from "../../claude-session/identity-artifact-reader.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH exec timeout — matches identity-exists-on-host.ts. */
const SSH_EXEC_TIMEOUT_MS = 3000;

/**
 * GET /:key/no-dormancy?hostId=<n>
 * Returns { present: boolean } — present=true when .no-dormancy file exists.
 */
router.get(
  "/:key/no-dormancy",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId
    const rawHostId = req.query.hostId;
    if (rawHostId === undefined || rawHostId === "") {
      return res.status(400).json({ error: "hostId is required" });
    }
    const hostId = parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }

    // 2. Validate identity key via IDENTITY_KEY_RE (shell-injection gate)
    const key = String(req.params.key ?? "");
    if (!key || !IDENTITY_KEY_RE.test(key)) {
      return res
        .status(400)
        .json({ error: "identity key must match [a-z0-9_-]{1,64}" });
    }

    // 3. Verify host ownership
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    // 4. Branch on local vs SSH
    if (isLocalHostId(hostId)) {
      // LOCAL BRANCH: fs.stat the sentinel file
      const filePath = path.join(getLocalIdentitiesRoot(), key, ".no-dormancy");
      try {
        await fs.stat(filePath);
        return res.json({ present: true });
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return res.json({ present: false });
        }
        // Other fs errors (EACCES, etc.) → 500 with generic message (T-ax1-04)
        return res.status(500).json({ error: "Failed to check sentinel" });
      }
    } else {
      // SSH BRANCH: one-shot connection, run test -e check
      let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_EXEC_TIMEOUT_MS,
        );

        const output = await Promise.race([
          execCommand(
            conn,
            `test -e "$HOME/.claude/identities/${key}/.no-dormancy" && echo Y || echo N`,
          ),
          new Promise<string>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(`SSH exec timeout after ${SSH_EXEC_TIMEOUT_MS}ms`),
                ),
              SSH_EXEC_TIMEOUT_MS,
            ),
          ),
        ]);

        const present = output.trim() === "Y";
        return res.json({ present });
      } catch {
        // Connect failure OR exec timeout → 504, no detail leak (T-ax1-04, T-ax1-05)
        return res.status(504).json({ error: "Host unreachable" });
      } finally {
        if (conn) {
          try {
            conn.end();
          } catch {
            /* ignore */
          }
        }
      }
    }
  },
);

/**
 * PUT /:key/no-dormancy?hostId=<n>  body: { present: boolean }
 * Creates or removes the .no-dormancy sentinel file. Idempotent.
 * Returns { present: boolean } confirming the requested state.
 */
router.put(
  "/:key/no-dormancy",
  express.json(),
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId
    const rawHostId = req.query.hostId;
    if (rawHostId === undefined || rawHostId === "") {
      return res.status(400).json({ error: "hostId is required" });
    }
    const hostId = parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }

    // 2. Validate identity key via IDENTITY_KEY_RE (shell-injection gate, T-ax1-01)
    const key = String(req.params.key ?? "");
    if (!key || !IDENTITY_KEY_RE.test(key)) {
      return res
        .status(400)
        .json({ error: "identity key must match [a-z0-9_-]{1,64}" });
    }

    // 3. Validate body (T-ax1-07)
    const { present } = (req.body ?? {}) as { present?: unknown };
    if (typeof present !== "boolean") {
      return res.status(400).json({ error: "present must be a boolean" });
    }

    // 4. Verify host ownership
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    // 5. Branch on local vs SSH
    if (isLocalHostId(hostId)) {
      // LOCAL BRANCH: write or remove the sentinel file
      const filePath = path.join(getLocalIdentitiesRoot(), key, ".no-dormancy");
      try {
        if (present) {
          // Create or overwrite (idempotent)
          await fs.writeFile(filePath, "", { flag: "w" });
        } else {
          // Remove (missing-ok — swallow ENOENT, T-ax1-08 idempotency)
          try {
            await fs.unlink(filePath);
          } catch (err: unknown) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== "ENOENT") throw err;
          }
        }
        return res.json({ present });
      } catch {
        return res.status(500).json({ error: "Failed to update sentinel" });
      }
    } else {
      // SSH BRANCH: touch or rm -f the sentinel file
      let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_EXEC_TIMEOUT_MS,
        );

        const cmd = present
          ? `mkdir -p "$HOME/.claude/identities/${key}" && touch "$HOME/.claude/identities/${key}/.no-dormancy"`
          : `rm -f "$HOME/.claude/identities/${key}/.no-dormancy"`;

        await Promise.race([
          execCommand(conn, cmd),
          new Promise<string>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(`SSH exec timeout after ${SSH_EXEC_TIMEOUT_MS}ms`),
                ),
              SSH_EXEC_TIMEOUT_MS,
            ),
          ),
        ]);

        return res.json({ present });
      } catch {
        // Connect failure OR exec timeout → 504, no detail leak
        return res.status(504).json({ error: "Host unreachable" });
      } finally {
        if (conn) {
          try {
            conn.end();
          } catch {
            /* ignore */
          }
        }
      }
    }
  },
);

// Generic 500 fallback error handler
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "identity-no-dormancy route error" });
  },
);

export default router;
