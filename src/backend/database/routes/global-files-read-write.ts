/**
 * Phase 23 (GEFM-04): POST /global-files/read + PUT /global-files/write
 *
 * Two endpoints that give Ashley the ability to read and write the operator-
 * configured "global files" on managed hosts (e.g. ~/.claude/CLAUDE.md).
 *
 * POST /global-files/read
 *   Body: { hostId: number, path: string }
 *   → 200 { content, mtime, size } on success
 *   → 400 on invalid body
 *   → 403 when path is not in the whitelist for this host
 *   → 404 when hostId doesn't resolve for the caller
 *   → 502 on SSH connect failure
 *
 * PUT /global-files/write
 *   Body: { hostId: number, path: string, content: string, expectedMtime?: number }
 *   → 200 { mtime } on success (server-authoritative new mtime)
 *   → 400 on invalid body
 *   → 403 when path is not in the whitelist for this host
 *   → 404 when hostId doesn't resolve for the caller
 *   → 409 { error: "mtime mismatch", currentMtime, currentContent } on optimistic-concurrency conflict
 *   → 502 on SSH connect/exec failure
 *
 * Security posture:
 *   - Whitelist enforcement (per GEFM-04): path must appear in global-files.json
 *     for this host BEFORE any SSH connection is opened. This is the AUTH gate.
 *   - Shell-escape (PATTERNS trap #3): operator-authored paths in global-files.json
 *     can contain shell metacharacters ($, backticks, quotes, spaces). Single-quote
 *     escaping is applied via shellEscape() before path interpolation into commands.
 *     The whitelist is an AUTH gate; escaping is an INJECTION gate. Both required.
 *   - GNU stat `stat -c '%Y'` for mtime (Linux-only — all fleet hosts are Debian/Ubuntu;
 *     Windows hosts omitted from bootstrap per GEFM-06).
 *   - Tilde expansion via `echo $HOME` before SFTP write (SFTP does not tilde-expand).
 *   - writeMarkdownFileAtomic reused from identity-artifact-reader.ts (SFTP tmp+rename
 *     via ext_openssh_rename — do NOT re-implement).
 *
 * Mount: second app.use("/global-files", ...) in database.ts alongside wave-1's list
 * router. Express chains routers; GET falls through to the list router; POST/PUT match
 * this router's /read and /write sub-paths.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { writeMarkdownFileAtomic } from "../../claude-session/identity-artifact-reader.js";
import { sshLogger } from "../../utils/logger.js";
import {
  loadGlobalFilesConfig,
  getFilesForHost,
} from "./global-files-config-loader.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches other one-shot SSH endpoints. */
const SSH_CONNECT_TIMEOUT_MS = 5000;

/** SSH exec race timeout — bounded so a hung remote can't stall the route. */
const SSH_EXEC_TIMEOUT_MS = 5000;

/**
 * Maximum path length accepted in the body.
 * Paths longer than this are almost certainly malformed.
 */
const MAX_PATH_LENGTH = 512;

/**
 * Maximum content size for PUT /write body content field (bytes, UTF-8).
 * Mirrors IDMEDIT_MAX_MARKDOWN_BYTES in identity-artifact-reader.ts L1014.
 */
const MAX_CONTENT_BYTES = 2_000_000;

/**
 * Race an exec against a timeout so a hung remote can't stall the route.
 * Copied verbatim from roles-create.ts L127-141 + roles-list-for-host.ts L86-100.
 */
function execWithTimeout(
  conn: Awaited<ReturnType<typeof connectOneShot>>,
  command: string,
  timeoutMs: number = SSH_EXEC_TIMEOUT_MS,
): Promise<string> {
  return Promise.race([
    execCommand(conn, command),
    new Promise<string>((_, reject) =>
      setTimeout(
        () => reject(new Error(`SSH exec timeout after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}

/**
 * Single-quote-escape helper for interpolating operator-authored paths into
 * bash commands. Whitelist enforcement (below) ensures only configured paths
 * reach here, but operator-authored config can contain shell metacharacters
 * ($, backticks, quotes, spaces) — the whitelist is an AUTH gate, escaping
 * is an INJECTION gate. Both are required (per PATTERNS trap #3).
 * Pattern: `abc'def` → `'abc'"'"'def'`
 */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

// ---------------------------------------------------------------------------
// POST /global-files/read
// ---------------------------------------------------------------------------

/**
 * POST /read
 * Body: { hostId: number, path: string }
 * SSHes to the host, cats the whitelisted file, returns { content, mtime, size }.
 */
router.post(
  "/read",
  express.json({ limit: "32kb" }), // read body is tiny (hostId + path only)
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // -----------------------------------------------------------------------
    // 1. Body validation — 400 on any failure
    // -----------------------------------------------------------------------
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawPath = body.path;

    if (
      typeof rawHostId !== "number" ||
      !Number.isInteger(rawHostId) ||
      rawHostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    if (typeof rawPath !== "string" || rawPath.length === 0) {
      res.status(400).json({ error: "path is required" });
      return;
    }
    if (rawPath.length > MAX_PATH_LENGTH) {
      res.status(400).json({ error: `path must be ≤${MAX_PATH_LENGTH} chars` });
      return;
    }

    const hostId = rawHostId;
    const path = rawPath;

    // -----------------------------------------------------------------------
    // 2. Host resolution — 404 for cross-user / unknown hosts
    // -----------------------------------------------------------------------
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // -----------------------------------------------------------------------
    // 3. Whitelist enforcement — 403 if path not in config for this host.
    //    This check runs BEFORE any SSH connection is opened (GEFM-04 requirement).
    // -----------------------------------------------------------------------
    const config = await loadGlobalFilesConfig();
    const whitelist = getFilesForHost(config, { id: host.id, name: host.name });
    const isWhitelisted = whitelist.some((entry) => entry.path === path);
    if (!isWhitelisted) {
      res.status(403).json({ error: "path not in whitelist" });
      return;
    }

    // -----------------------------------------------------------------------
    // 4. SSH connect — 502 on failure (conn not yet assigned → no cleanup)
    // -----------------------------------------------------------------------
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("global-files-read: SSH connect failed", {
          operation: "global_files_read_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 5. Tilde expansion — single-quote escaping (step 6) suppresses shell
      //    tilde expansion, so `~/.claude/CLAUDE.md` would be passed literally
      //    to cat/stat and fail. Mirror the WRITE handler (L400-417): resolve
      //    $HOME via echo first, then splice into an absolute path.
      // ---------------------------------------------------------------------
      let absPath = path;
      if (path.startsWith("~/")) {
        const remoteHome = (
          await execWithTimeout(conn, "echo $HOME")
        ).trim();
        if (!remoteHome || remoteHome.startsWith("~")) {
          // echo $HOME failed to resolve — bail rather than read from a bogus path.
          sshLogger.warn("global-files-read: could not resolve remote HOME", {
            operation: "global_files_read_home",
            hostId,
            remoteHome,
          });
          res.status(502).json({ error: "could not resolve remote HOME" });
          return;
        }
        absPath = `${remoteHome}/${path.slice(2)}`;
      }

      // ---------------------------------------------------------------------
      // 6. Read the file via exec channel.
      //    escapedPath uses single-quote escaping (PATTERNS trap #3):
      //    the whitelist is an AUTH gate; escaping is the INJECTION gate.
      //    `cat ... || true` returns empty string for missing files (empty
      //    and missing files are both valid per GEFM-02).
      //    `stat -c '%Y'` is GNU stat (Linux mtime in epoch seconds — safe
      //    for the Debian/Ubuntu fleet; Windows omitted per GEFM-06).
      // ---------------------------------------------------------------------
      const escapedPath = shellEscape(absPath);
      const contentCmd = `cat ${escapedPath} 2>/dev/null || true`;
      const mtimeCmd = `stat -c '%Y' ${escapedPath} 2>/dev/null || echo 0`;
      const sizeCmd = `stat -c '%s' ${escapedPath} 2>/dev/null || echo 0`;

      const content = await execWithTimeout(conn, contentCmd);
      const mtime = parseInt(
        (await execWithTimeout(conn, mtimeCmd)).trim(),
        10,
      );
      const size = parseInt(
        (await execWithTimeout(conn, sizeCmd)).trim(),
        10,
      );

      res.json({
        content,
        mtime: Number.isFinite(mtime) ? mtime : 0,
        size: Number.isFinite(size) ? size : 0,
      });
    } catch (err) {
      sshLogger.error("global-files-read: unexpected error", {
        operation: "global_files_read_error",
        hostId,
        error: err instanceof Error ? err.message : "Unknown",
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "internal" });
      }
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /global-files/write
// ---------------------------------------------------------------------------

/**
 * PUT /write
 * Body: { hostId: number, path: string, content: string, expectedMtime?: number }
 * Whitelist-checks the path, optionally checks optimistic concurrency via mtime,
 * tilde-expands if needed, then writes via SFTP atomic tmp+rename.
 * Returns { mtime } (server-authoritative new mtime for next write's expectedMtime).
 */
router.put(
  "/write",
  express.json({ limit: "4mb" }), // 4mb matches nginx client_max_body_size for /global-files
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // -----------------------------------------------------------------------
    // 1. Body validation — 400 on any failure
    // -----------------------------------------------------------------------
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawPath = body.path;
    const rawContent = body.content;
    const rawExpectedMtime = body.expectedMtime;

    if (
      typeof rawHostId !== "number" ||
      !Number.isInteger(rawHostId) ||
      rawHostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    if (typeof rawPath !== "string" || rawPath.length === 0) {
      res.status(400).json({ error: "path is required" });
      return;
    }
    if (rawPath.length > MAX_PATH_LENGTH) {
      res.status(400).json({ error: `path must be ≤${MAX_PATH_LENGTH} chars` });
      return;
    }
    if (typeof rawContent !== "string") {
      res.status(400).json({ error: "content must be a string" });
      return;
    }
    if (Buffer.byteLength(rawContent, "utf-8") > MAX_CONTENT_BYTES) {
      res.status(400).json({
        error: `content must be ≤${MAX_CONTENT_BYTES} bytes`,
      });
      return;
    }
    // expectedMtime is OPTIONAL — must be a non-negative finite integer if present
    if (rawExpectedMtime !== undefined) {
      if (
        typeof rawExpectedMtime !== "number" ||
        !Number.isFinite(rawExpectedMtime) ||
        !Number.isInteger(rawExpectedMtime) ||
        rawExpectedMtime < 0
      ) {
        res.status(400).json({
          error: "expectedMtime must be a non-negative integer when provided",
        });
        return;
      }
    }

    const hostId = rawHostId;
    const filePath = rawPath;
    const content = rawContent;
    const expectedMtime =
      rawExpectedMtime !== undefined
        ? (rawExpectedMtime as number)
        : undefined;

    // -----------------------------------------------------------------------
    // 2. Host resolution — 404 for cross-user / unknown hosts
    // -----------------------------------------------------------------------
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // -----------------------------------------------------------------------
    // 3. Whitelist enforcement — 403 if path not in config for this host.
    //    Runs BEFORE SSH connection is opened (GEFM-04 requirement).
    // -----------------------------------------------------------------------
    const config = await loadGlobalFilesConfig();
    const whitelist = getFilesForHost(config, { id: host.id, name: host.name });
    const isWhitelisted = whitelist.some((entry) => entry.path === filePath);
    if (!isWhitelisted) {
      res.status(403).json({ error: "path not in whitelist" });
      return;
    }

    // -----------------------------------------------------------------------
    // 4. SSH connect — 502 on failure
    // -----------------------------------------------------------------------
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("global-files-write: SSH connect failed", {
          operation: "global_files_write_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 5. Tilde expansion — SFTP does NOT tilde-expand paths, AND single-quote
      //    escaping (used for all shell interpolation below) suppresses shell
      //    tilde expansion too. Resolve $HOME first so every downstream
      //    command (mtime check, currentContent cat, SFTP write, re-stat) sees
      //    the actual file, not a literal `~/...` that stat/cat can't find.
      //    Runs BEFORE the optimistic-concurrency check on purpose: a raw
      //    `~/...` in the mtime check would silently return 0, false-triggering
      //    a 409 on every save (caught 2026-08-05 during quick-260805-70q UAT).
      // ---------------------------------------------------------------------
      let absPath = filePath;
      if (filePath.startsWith("~/")) {
        const remoteHome = (
          await execWithTimeout(conn, "echo $HOME")
        ).trim();
        if (!remoteHome || remoteHome.startsWith("~")) {
          // echo $HOME failed to resolve — bail rather than write to a bogus path.
          sshLogger.warn("global-files-write: could not resolve remote HOME", {
            operation: "global_files_write_home",
            hostId,
            remoteHome,
          });
          res.status(502).json({ error: "could not resolve remote HOME" });
          return;
        }
        absPath = `${remoteHome}/${filePath.slice(2)}`;
      }

      // escapedPath wraps the resolved absPath (not raw filePath) — see step 5.
      const escapedPath = shellEscape(absPath);

      // ---------------------------------------------------------------------
      // 6. Optimistic concurrency check (only when expectedMtime is provided).
      //    If the file has changed since the client read it, return 409 with
      //    the current mtime + content so the client can offer reload+retry.
      //    409 shape locked per CONTEXT §specifics:
      //    { error: "mtime mismatch", currentMtime, currentContent }
      // ---------------------------------------------------------------------
      if (typeof expectedMtime === "number") {
        const currentMtimeStr = (
          await execWithTimeout(
            conn,
            `stat -c '%Y' ${escapedPath} 2>/dev/null || echo 0`,
          )
        ).trim();
        const currentMtime = parseInt(currentMtimeStr, 10) || 0;

        if (currentMtime !== expectedMtime) {
          // Fetch current content so the modal can offer reload+retry UX.
          const currentContent = await execWithTimeout(
            conn,
            `cat ${escapedPath} 2>/dev/null || true`,
          );
          res.status(409).json({
            error: "mtime mismatch",
            currentMtime,
            currentContent,
          });
          return;
        }
      }

      // ---------------------------------------------------------------------
      // 7. SFTP atomic write — reuse writeMarkdownFileAtomic (do NOT re-impl).
      //    Uses ext_openssh_rename for atomic overwrite (avoids the EEXIST
      //    SSH2_FX_FAILURE trap of plain sftp.rename — see writeMarkdownFileAtomic
      //    prologue in identity-artifact-reader.ts).
      // ---------------------------------------------------------------------
      try {
        await writeMarkdownFileAtomic(conn, absPath, content);
      } catch (err) {
        sshLogger.error("global-files-write: SFTP write failed", {
          operation: "global_files_write_sftp",
          hostId,
          absPath,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 8. Re-stat for server-authoritative new mtime.
      //    Client uses the returned mtime as expectedMtime on the NEXT write
      //    (mirrors the server-echo-authoritative pattern from identity updates).
      //    escapedPath wraps absPath (see step 5), the same path SFTP just
      //    wrote — so stat sees the file we just created/updated.
      // ---------------------------------------------------------------------
      const newMtimeStr = (
        await execWithTimeout(
          conn,
          `stat -c '%Y' ${escapedPath} 2>/dev/null || echo 0`,
        )
      ).trim();
      const newMtime = parseInt(newMtimeStr, 10) || 0;

      res.json({ mtime: newMtime });
    } catch (err) {
      sshLogger.error("global-files-write: unexpected error", {
        operation: "global_files_write_error",
        hostId,
        error: err instanceof Error ? err.message : "Unknown",
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "internal" });
      }
    } finally {
      if (conn) {
        try {
          conn.end();
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  },
);

// Generic 500 fallback error handler (mirrors roles-create.ts L352-367).
// Sanitizes upstream detail — never leak stderr/tailnet paths in response body.
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    sshLogger.error("global-files-read-write: unhandled error", {
      operation: "global_files_read_write_error",
      error: err?.message,
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
