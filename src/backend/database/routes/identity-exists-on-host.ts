/**
 * Phase 20 (IDUI-05): /identities/exists-on-host — target-host-side identity
 * name-collision probe endpoint.
 *
 * GET /identities/exists-on-host?hostId=<n>&name=<slug>
 *   → { exists: boolean }
 *
 * Checks whether `~/.claude/identities/<name>/` exists on the target host:
 *   - LOCAL branch: when hostId is in IDENTITIES_LOCAL_HOST_IDS, probe is a
 *     local fs.stat call against os.homedir()/.claude/identities/<name>/.
 *   - SSH branch: otherwise, opens a connectOneShot SSH connection and runs
 *     an idempotent `if [ -d ... ]` check via execCommand.
 *
 * Security:
 *   - IDENTITY_KEY_RE gates all names BEFORE any SSH/fs work (shell injection
 *     prevention, T-IDUI-05-01).
 *   - The name is validated by IDENTITY_KEY_RE before the SSH command is
 *     constructed; no inner shell quoting is applied because single quotes do
 *     NOT nest inside double quotes in POSIX shell — applying them would match
 *     a directory literally named `'name'` rather than `name`. This matches
 *     the validate-then-interpolate pattern used by identity-artifact-reader.ts.
 *   - SSH errors (connect timeout, etc.) return 504 with a generic "Host
 *     unreachable" message — no upstream SSH error detail is leaked.
 *
 * Timeouts (3-tier):
 *   - SSH connect: 3000ms (connectOneShot second arg)
 *   - SSH exec race: 3000ms (Promise.race inside SSH branch)
 *   - Nginx outer: 10s (proxy_read_timeout in both nginx configs)
 *
 * Mounted in database.ts BEFORE the generic /identities router so that
 * /identities/exists-on-host resolves here and does not fall through to
 * identitiesRoutes.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { stat as fspStat } from "fs/promises";
import os from "os";
import path from "path";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * Identity key validator — matches identities.ts:22 exactly.
 * Copy (not import) to avoid coupling on export shape changes.
 */
const IDENTITY_KEY_RE = /^[a-z0-9._=/+-]+$/;

/** SSH probe exec timeout. Matches identity-artifact-reader.ts REMOTE_EXEC_TIMEOUT_MS. */
const SSH_EXEC_TIMEOUT_MS = 3000;

/**
 * GET /exists-on-host?hostId=<n>&name=<slug>
 * Returns { exists: boolean } after probing the target host.
 */
router.get(
  "/exists-on-host",
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

    // 2. Parse + validate name via IDENTITY_KEY_RE
    const rawName = req.query.name;
    if (rawName === undefined || rawName === "") {
      return res.status(400).json({ error: "name must match [a-z0-9._=/+-]+" });
    }
    const name = String(rawName);
    if (!IDENTITY_KEY_RE.test(name)) {
      return res.status(400).json({ error: "name must match [a-z0-9._=/+-]+" });
    }

    // 3. Verify host ownership: resolveHostById returns null for cross-user / unknown hosts
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    // 4. Branch on isLocalHostId
    if (isLocalHostId(hostId)) {
      // LOCAL BRANCH: probe via fs.stat against the bind-mount / os.homedir()
      const candidate = path.join(
        os.homedir(),
        ".claude",
        "identities",
        name,
      );
      try {
        await fspStat(candidate);
        return res.json({ exists: true });
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return res.json({ exists: false });
        }
        // Other fs errors (EACCES, etc.) → 500 with generic message
        return res.status(500).json({ error: "Failed to check identity directory" });
      }
    } else {
      // SSH BRANCH: open one-shot connection, run existence check
      // SHELL SAFETY: name is already validated by IDENTITY_KEY_RE above.
      // The name is interpolated raw inside the double-quoted path — no inner
      // single quotes are applied because single quotes do NOT nest inside
      // double quotes in POSIX shell. Validate-then-interpolate pattern
      // (matches identity-artifact-reader.ts). CR-03 regression guard.
      let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_EXEC_TIMEOUT_MS,
        );

        const output = await Promise.race([
          execCommand(
            conn,
            `if [ -d "$HOME/.claude/identities/${name}" ]; then echo exists; else echo missing; fi`,
          ),
          new Promise<string>((_, reject) =>
            setTimeout(
              () => reject(new Error(`SSH exec timeout after ${SSH_EXEC_TIMEOUT_MS}ms`)),
              SSH_EXEC_TIMEOUT_MS,
            ),
          ),
        ]);

        const exists = output.trim() === "exists";
        return res.json({ exists });
      } catch {
        // Connect failure OR exec timeout → 504, generic message (no detail leak)
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

// Generic 500 fallback error handler (mirrors identities.ts L316-333)
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    return res
      .status(500)
      .json({ error: err?.message ?? "identity-exists-on-host route error" });
  },
);

export default router;
