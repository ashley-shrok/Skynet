/**
 * Phase 90 Plan 90-02 (D-08.2 — planner picks
 * `GET /roles/:name/avatar?hostId=<n>` matching the identity-avatar path shape):
 *
 * Role-avatar serve endpoint. Byte-shape mirror of the identity-avatar-serve
 * handler at `identities.ts:767-870`, adapted for role scope:
 *   - Addressed by role name (not identity key).
 *   - Reads `~/.claude/roles/<name>/<name>.md` frontmatter for the avatar
 *     filename via `readRoleFileByName` + `extractCosmeticsFromFrontmatter`.
 *   - Streams the sibling avatar bytes via `readAvatarSiblingFileByRole`.
 *   - No identity two-step — the URL param IS the role name.
 *
 * Enables Phase 90-05 (`.pv-row` roles-list rows carry role avatars in a
 * 40px round `.pv-avatar`) and 90-04 (role modal header carries role avatar).
 *
 * Security:
 *   - authenticateJWT gates the route.
 *   - ROLE_NAME_PATTERN (kebab-case-lowercase `/^[a-z0-9-]+$/`) rejects the
 *     `:name` param BEFORE any host-resolve / SSH work — STRIDE T-22-02-02
 *     parallel. Path-traversal (`../`, `%2E%2E%2F` decoded) fails the gate.
 *     Definition is CLONED here rather than imported from
 *     `roles-list-for-host.ts` per CONTEXT § "deferred anti-patterns" —
 *     the two routers stay independent so tests for one don't cascade into
 *     the other.
 *   - hostId query pre-validated as a positive integer.
 *   - resolveHostById provides per-user host isolation; a null return
 *     surfaces as 502 (matches identity-avatar endpoint's cross-user
 *     isolation shape) — never leaks the fact that the host exists for
 *     someone else.
 *   - Silent-fallback on `readRoleFileByName` throw → 404 (matches
 *     `identities.ts:846-848` — a broken role file or transient SSH
 *     failure surfaces as "no avatar" rather than as a 5xx).
 *   - try/finally guarantees `conn.end()` on every exit path.
 *
 * Mount ordering (see database.ts):
 *   Mounted at `/roles` immediately AFTER `rolesListForHostRoutes`. The two
 *   routers do not collide because their routes bind at different depths:
 *   the list router owns `router.get("/")` (enumeration), this router owns
 *   `router.get("/:name/avatar")`. Express chains multi-router mounts at
 *   the same base; the depth difference disambiguates.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { sshLogger } from "../../utils/logger.js";
import {
  readRoleFileByName,
  readAvatarSiblingFileByRole,
  extractCosmeticsFromFrontmatter,
  isLocalHostId,
} from "../../claude-session/identity-artifact-reader.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * Role name validator — kebab-case-lowercase per D-CONTEXT §Frontend surfaces.
 * Cloned from `roles-list-for-host.ts:62` per plan Task 1 §(2) — the two
 * routers keep their gates local so a future divergence in one doesn't
 * silently loosen the other.
 */
const ROLE_NAME_PATTERN = /^[a-z0-9-]+$/;

/** SSH connect timeout — matches other one-shot SSH endpoints. */
const SSH_CONNECT_TIMEOUT_MS = 5000;

/**
 * GET /:name/avatar?hostId=<n>
 * Streams the role's sibling avatar bytes with the correct Content-Type
 * when the role file's frontmatter names an avatar AND that file exists.
 * 404 on any "no avatar" outcome; 400 on validation; 502 on host reachability.
 */
router.get(
  "/:name/avatar",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const roleName = String(req.params.name);

    // 1. Role-name gate — fail-fast BEFORE any host resolver or SSH work.
    //    URL-decoded `../` / `%2E%2E%2F` traversal attempts fail this gate.
    if (!ROLE_NAME_PATTERN.test(roleName)) {
      return res
        .status(400)
        .json({ error: "name must match [a-z0-9-]+" });
    }

    // 2. hostId query — must be a positive integer.
    const rawHost = req.query.hostId;
    const hostIdNum =
      typeof rawHost === "string" ? Number(rawHost) : Number.NaN;
    if (
      !Number.isFinite(hostIdNum) ||
      !Number.isInteger(hostIdNum) ||
      hostIdNum <= 0
    ) {
      return res
        .status(400)
        .json({ error: "hostId query required (positive integer)" });
    }

    // 3. LOCAL vs REMOTE branch — `isLocalHostId` signals the local disk
    //    read path (conn=null); otherwise resolve the host and open SSH.
    const local = isLocalHostId(hostIdNum);
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!local) {
      try {
        const host = await resolveHostById(hostIdNum, userId);
        if (!host) {
          return res
            .status(502)
            .json({ error: "host unreachable" });
        }
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("roles-avatar: SSH connect failed", {
          operation: "roles_avatar_connect",
          hostId: hostIdNum,
          roleName,
          error: err instanceof Error ? err.message : "Unknown",
        });
        return res
          .status(502)
          .json({ error: "host unreachable" });
      }
    }

    try {
      // 4. Read the role file frontmatter. Any throw here surfaces as
      //    "no avatar" (silent-fallback matching identities.ts:846-848).
      //    A broken role file OR a transient SSH exec failure should not
      //    surface as 5xx here — the caller renders a neutral placeholder.
      let markdown: string;
      try {
        const readRes = await readRoleFileByName(conn, roleName);
        markdown = readRes.markdown;
      } catch {
        return res.status(404).json({ error: "no avatar" });
      }

      // 5. Parse cosmetics; absence of `avatar:` field → 404 (never null).
      const cosmetics = extractCosmeticsFromFrontmatter(markdown);
      if (!cosmetics.avatar || typeof cosmetics.avatar !== "string") {
        return res.status(404).json({ error: "no avatar" });
      }

      // 6. Read the sibling avatar bytes. Throw OR null → 404.
      let readResult: Awaited<ReturnType<typeof readAvatarSiblingFileByRole>>;
      try {
        readResult = await readAvatarSiblingFileByRole(
          conn,
          roleName,
          cosmetics.avatar,
        );
      } catch {
        return res.status(404).json({ error: "no avatar" });
      }

      if (readResult === null) {
        return res.status(404).json({ error: "no avatar" });
      }

      // 7. Stream the bytes with the correct Content-Type. No ETag/caching
      //    machinery here — role avatars change rarely; keeping this
      //    endpoint minimal until a caching need emerges.
      res.setHeader("Content-Type", readResult.mime);
      res.setHeader("Content-Length", String(readResult.bytes.byteLength));
      res.setHeader("Cache-Control", "no-store");
      return res.send(readResult.bytes);
    } catch {
      // Any unexpected path here (post-read failure, response write error)
      // → 502 rather than 5xx. Never leaks raw SSH exceptions.
      return res.status(502).json({ error: "host unreachable" });
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

// Generic 500 fallback error handler (mirrors roles-list-for-host.ts).
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    sshLogger.error("roles-avatar: unhandled error", {
      operation: "roles_avatar_error",
      error: err?.message,
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
