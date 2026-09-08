/**
 * Phase 89 (Plan 89-02): /runbooks-editor Express router — 7 endpoints.
 *
 * Byte-shape mirror of Phase 44's `skills-editor.ts` with three structural
 * adaptations:
 *   1. **Role dimension** replaces `hostId` alone: requests carry
 *      `(hostId, roleName, [runbookName], [relativePath])`. Runbooks live at
 *      `~/.claude/roles/<roleName>/runbooks/<runbookName>/...` on the remote host.
 *   2. **Role validation 404**: before any runbook I/O, the backend checks that
 *      `~/.claude/roles/<roleName>/` exists on the host and returns 404
 *      `{error:"role not found"}` if not (D-15). Missing runbooks folder within
 *      a valid role is empty-list-not-404 (mirrors skills' "missing = empty state"
 *      posture — same as skills-editor.ts L294-302).
 *   3. **Path-safety gate widens**: adds `ROLE_NAME_RE` regex gate (identical
 *      shape to `SKILL_NAME_RE`) alongside the existing `RUNBOOK_NAME_RE` +
 *      `isSafeRelativePath`. Per D-16 no path traversal via `roleName` or
 *      `runbookName` — both regex-gated BEFORE any SSH connection opens.
 *
 * Endpoints (all gated by authenticateJWT + resolveHostById(hostId, userId)):
 *   GET  /runbooks-editor/runbooks?hostId=<n>&role=<r>
 *     → 200 { runbooks: [{name}] } sorted alphabetically; empty array when
 *       `~/.claude/roles/<r>/runbooks/` is missing OR empty (matches skills'
 *       "missing = empty state" posture per skills-editor.ts L294-302); 404
 *       `{error:"role not found"}` when `~/.claude/roles/<r>/` itself is absent
 *       (per D-15).
 *   GET  /runbooks-editor/files?hostId=<n>&role=<r>&runbook=<b>
 *     → 200 { files: [{path}] } — recursive `find <runbookRoot> -type f
 *       -printf '%P\n' | sort`; empty when the runbook folder has no files.
 *   POST /runbooks-editor/read      { hostId, role, runbook, path }
 *     → 200 { content, mtime, size, isText } — content is "" when !isText.
 *   PUT  /runbooks-editor/write     { hostId, role, runbook, path, content, expectedMtime? }
 *     → 200 { mtime } | 409 { error:"mtime mismatch", currentMtime, currentContent }
 *       (byte-identical 409 shape to skills-editor).
 *   POST /runbooks-editor/create    { hostId, role, runbook, path }
 *     → 200 { path, mtime } | 409 { error:"file exists" }.
 *   DELETE /runbooks-editor/file    { hostId, role, runbook, path }
 *     → 200 { ok:true } (idempotent — `rm -f` swallows missing files).
 *   DELETE /runbooks-editor/runbook { hostId, role, runbook }
 *     → 200 { ok:true } (removes the runbook folder recursively — path-safety
 *       gate is LIFE-CRITICAL; two-layer defense assertion runs before shell exec).
 *
 * Security posture (STRIDE mitigations — see 89-02-PLAN.md <threat_model>):
 *   - `ROLE_NAME_RE` `/^[a-zA-Z0-9._-]{1,128}$/` rejects `.`, `..`, `/`, and
 *     every shell metacharacter at input validation — BEFORE resolveHostById +
 *     SSH connect. `RUNBOOK_NAME_RE` (identical shape) gates the runbook name
 *     dimension. `isSafeRelativePath` rejects `..` segments, leading `/`, NUL
 *     bytes, empty segments, and paths over 512 chars — ALL three gates fire
 *     BEFORE any SSH connection is opened.
 *   - Belt-and-suspenders `absPath.startsWith(runbookRoot + "/")` prefix
 *     assertion post-compose. Regex gates make it unreachable but the invariant
 *     is asserted anyway (defense in depth).
 *   - `shellEscape` single-quote wraps every user-supplied value before shell
 *     interpolation (INJECTION gate; the regex gates are the AUTH gate — both
 *     required per Phase 23 discipline).
 *   - `echo $HOME` two-step BEFORE every path compose (SFTP + single-quote
 *     shell escaping both suppress tilde expansion). Never cached across requests.
 *   - `execWithTimeout` bounds every remote exec to 5s; `connectOneShot` bounds
 *     SSH connect to 5s; nginx `proxy_read_timeout 15s` caps the whole request.
 *   - Response bodies use fixed shapes (`{error:"internal"}`,
 *     `{error:"SSH connect failed"}`, `{error:"role not found"}` etc.) — never
 *     leak stderr, remote paths, or credential fragments.
 *
 * Mount: app.use("/runbooks-editor", runbooksEditorRoutes) in database.ts
 * alongside /skills-editor. Nginx: BOTH docker/nginx.conf AND
 * docker/nginx-https.conf need `location ~ ^/runbooks-editor(/.*)?$` blocks
 * (parity load-bearing per patch #446 arc).
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

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches Phase 23 / Phase 44 (skills-editor.ts L80). */
const SSH_CONNECT_TIMEOUT_MS = 5000;

/** SSH exec race timeout — bounded so a hung remote can't stall the route. */
const SSH_EXEC_TIMEOUT_MS = 5000;

/**
 * Maximum relative path length accepted in the body / query.
 * Paths longer than this are almost certainly malformed. Matches Phase 44.
 */
const MAX_PATH_LENGTH = 512;

/**
 * Maximum content size for PUT /write body content field (bytes, UTF-8).
 * Mirrors MAX_CONTENT_BYTES in skills-editor.ts L96.
 */
const MAX_CONTENT_BYTES = 2_000_000;

/**
 * Role-name gate: alphanumeric, hyphen, underscore, dot; 1-128 chars.
 * Rejects `.`, `..`, empty, anything with a `/`, backslash, shell metachars,
 * spaces. Runs BEFORE resolveHostById + SSH connect on every endpoint.
 * Identical shape to SKILL_NAME_RE in skills-editor.ts:103.
 */
const ROLE_NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/;

/**
 * Runbook-name gate: alphanumeric, hyphen, underscore, dot; 1-128 chars.
 * Rejects `.`, `..`, empty, anything with a `/`, backslash, shell metachars,
 * spaces. Runs BEFORE resolveHostById + SSH connect on every endpoint.
 * Identical shape to SKILL_NAME_RE in skills-editor.ts:103.
 */
const RUNBOOK_NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/;

/**
 * Relative path root for roles on the remote host.
 * Runbook root is composed as `${remoteHome}/${ROLE_ROOT_REL}/${role}/runbooks/${runbook}`.
 * Mirrors SKILL_ROOT_REL = ".claude/skills" in skills-editor.ts:109.
 */
const ROLE_ROOT_REL = ".claude/roles";

/**
 * Race an exec against a timeout so a hung remote can't stall the route.
 * Duplicated verbatim from skills-editor.ts L119-133 (which was itself
 * duplicated from global-files-read-write.ts L82-96 → roles-create.ts L127-141
 * → roles-list-for-host.ts L86-100). Fifth intentional instance per Phase 44
 * rationale; extracting to a shared module is Post-Planning-Gaps material.
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
 * Single-quote-escape helper for interpolating user-supplied values into
 * bash commands. The regex gates (isValidRoleName + isValidRunbookName +
 * isSafeRelativePath) are the AUTH gate; shellEscape is the INJECTION gate —
 * both required per Phase 23's PATTERNS trap #3.
 * Pattern: `abc'def` → `'abc'"'"'def'`
 * Duplicated from skills-editor.ts L142-144 (fifth instance in the chain).
 */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Role-name AUTH gate. Rejects any value that could escape the role root
 * (via `..`) or inject shell metachars. Returns true only for a ROLE_NAME_RE
 * match that is not `.` or `..`. Runs BEFORE any I/O.
 */
function isValidRoleName(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v === "." || v === "..") return false;
  return ROLE_NAME_RE.test(v);
}

/**
 * Runbook-name AUTH gate. Rejects any value that could escape the runbook root
 * (via `..`) or inject shell metachars. Returns true only for a RUNBOOK_NAME_RE
 * match that is not `.` or `..`. Runs BEFORE any I/O.
 */
function isValidRunbookName(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v === "." || v === "..") return false;
  return RUNBOOK_NAME_RE.test(v);
}

/**
 * Relative-path AUTH gate. Rejects:
 *   - non-strings
 *   - empty strings
 *   - > MAX_PATH_LENGTH chars
 *   - leading `/` (absolute paths)
 *   - NUL byte
 *   - any `..`, `.`, or empty segment when split by `/`
 * Runs BEFORE any I/O. Complements ROLE_NAME_RE + RUNBOOK_NAME_RE gates on the
 * role/runbook dimensions. Together they make the belt-and-suspenders prefix
 * assertion unreachable in normal flow — but the assertion runs anyway.
 * Duplicated from skills-editor.ts L170-179 (fifth instance in the chain).
 */
function isSafeRelativePath(p: unknown): p is string {
  if (typeof p !== "string") return false;
  if (p.length === 0 || p.length > MAX_PATH_LENGTH) return false;
  if (p.startsWith("/")) return false;
  if (p.includes("\0")) return false;
  for (const part of p.split("/")) {
    if (part === "" || part === "." || part === "..") return false;
  }
  return true;
}

/**
 * Returns true when the content buffer appears to be UTF-8 text.
 *
 * Heuristic (order matters):
 *   1. Empty file → text (harmless, editable).
 *   2. Any NUL byte in the first 8KB → binary. Text files never contain
 *      NUL; binaries almost always do near the header.
 *   3. Any byte in [0x01..0x08, 0x0E..0x1F] → binary. Non-printable
 *      control chars that legitimately never appear in text (tab 0x09,
 *      LF 0x0A, CR 0x0D are excluded from the reject set).
 *   4. UTF-8 decode of first 8KB with fatal:true; also reject if the
 *      decoded output contains U+FFFD replacement char.
 *   5. Otherwise text.
 *
 * Duplicated from skills-editor.ts L202-218 (fifth instance in the chain).
 */
function detectIsText(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  const window = buf.subarray(0, Math.min(8192, buf.length));
  for (let i = 0; i < window.length; i++) {
    const b = window[i];
    if (b === 0) return false;
    if (b <= 0x08) return false;
    if (b >= 0x0e && b <= 0x1f) return false;
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(window);
    if (decoded.includes("")) return false;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// GET /runbooks-editor/runbooks?hostId=<n>&role=<r>
// ---------------------------------------------------------------------------

/**
 * List runbooks for a role on the host — `find ~/.claude/roles/<r>/runbooks
 * -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort`. Returns empty array
 * when the runbooks directory is missing (not 404 — mirrors skills' "missing =
 * empty state"). Returns 404 `{error:"role not found"}` when the role folder
 * itself is absent (D-15 — separate exec to avoid masking role-missing as empty).
 */
router.get(
  "/runbooks",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId.
    const rawHostId = req.query.hostId;
    if (rawHostId === undefined || rawHostId === "") {
      res.status(400).json({ error: "hostId is required" });
      return;
    }
    const hostId = parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }

    // 2. Role-name AUTH gate — BEFORE resolveHostById + SSH connect (D-16).
    const rawRole = req.query.role;
    if (!isValidRoleName(rawRole)) {
      res.status(400).json({ error: "invalid role name" });
      return;
    }
    const role = rawRole;

    // 3. Per-user host isolation — 404 for cross-user / unknown hosts.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      // 4. SSH connect.
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("runbooks-editor runbooks: SSH connect failed", {
          operation: "runbooks_editor_runbooks_connect",
          hostId,
          role,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // 5. Resolve $HOME.
      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn("runbooks-editor runbooks: could not resolve remote HOME", {
          operation: "runbooks_editor_runbooks_home",
          hostId,
          role,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 6. Compose roleRoot.
      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const escapedRoleRoot = shellEscape(roleRoot);

      // 7. D-15 role-existence check — separate exec so "role missing" is NOT
      //    masked as "no runbooks" by the find command's 2>/dev/null stderr swallow.
      sshLogger.info("runbooks-editor runbooks: checking role existence", {
        operation: "runbooks_editor_runbooks_role_check",
        hostId,
        role,
      });
      const roleCheckOutput = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRoleRoot} && echo ok || echo missing`,
        )
      ).trim();
      if (roleCheckOutput !== "ok") {
        sshLogger.warn("runbooks-editor runbooks: role not found", {
          operation: "runbooks_editor_runbooks_role_missing",
          hostId,
          role,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 8. Compose runbooksRoot.
      const runbooksRoot = `${roleRoot}/runbooks`;
      const escapedRunbooksRoot = shellEscape(runbooksRoot);

      // 9. List runbook subfolders. 2>/dev/null swallows the missing-runbooks-folder
      //    case → empty output → empty list (matches skills' "missing = empty state").
      sshLogger.info("runbooks-editor runbooks: listing runbooks", {
        operation: "runbooks_editor_runbooks_find",
        hostId,
        role,
      });
      const listCmd = `find ${escapedRunbooksRoot} -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null | sort`;
      const output = await execWithTimeout(conn, listCmd);

      // 10. Parse, filter, map.
      const runbooks = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((name) => ({ name }));

      res.json({ runbooks });
    } catch (err) {
      sshLogger.error("runbooks-editor runbooks: unexpected error", {
        operation: "runbooks_editor_runbooks_error",
        hostId,
        role,
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
// GET /runbooks-editor/files?hostId=<n>&role=<r>&runbook=<b>
// ---------------------------------------------------------------------------

/**
 * List files inside a runbook (recursively, path-relative to the runbook root).
 * `find <runbookRoot> -type f -printf '%P\n' | sort`. Returns empty array when
 * the runbook has no files (or does not exist — "missing = empty state" posture,
 * mirroring skills-editor.ts L404-412). Returns 404 `{error:"role not found"}`
 * when the role folder itself is absent (D-15).
 */
router.get(
  "/files",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId.
    const rawHostId = req.query.hostId;
    if (rawHostId === undefined || rawHostId === "") {
      res.status(400).json({ error: "hostId is required" });
      return;
    }
    const hostId = parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }

    // 2. Role AUTH gate — BEFORE any I/O.
    const rawRole = req.query.role;
    if (!isValidRoleName(rawRole)) {
      res.status(400).json({ error: "invalid role name" });
      return;
    }
    const role = rawRole;

    // 3. Runbook AUTH gate — BEFORE any I/O.
    const rawRunbook = req.query.runbook;
    if (!isValidRunbookName(rawRunbook)) {
      res.status(400).json({ error: "invalid runbook name" });
      return;
    }
    const runbook = rawRunbook;

    // 4. Per-user host isolation.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      // 5. SSH connect.
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("runbooks-editor files: SSH connect failed", {
          operation: "runbooks_editor_files_connect",
          hostId,
          role,
          runbook,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // 6. Resolve $HOME.
      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn("runbooks-editor files: could not resolve remote HOME", {
          operation: "runbooks_editor_files_home",
          hostId,
          role,
          runbook,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 7. D-15 role-existence check.
      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const escapedRoleRoot = shellEscape(roleRoot);
      sshLogger.info("runbooks-editor files: checking role existence", {
        operation: "runbooks_editor_files_role_check",
        hostId,
        role,
        runbook,
      });
      const roleCheckOutput = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRoleRoot} && echo ok || echo missing`,
        )
      ).trim();
      if (roleCheckOutput !== "ok") {
        sshLogger.warn("runbooks-editor files: role not found", {
          operation: "runbooks_editor_files_role_missing",
          hostId,
          role,
          runbook,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 8. Compose runbookRoot.
      const runbookRoot = `${roleRoot}/runbooks/${runbook}`;
      const escapedRunbookRoot = shellEscape(runbookRoot);

      // 9. List files recursively. 2>/dev/null swallows missing runbook folder.
      sshLogger.info("runbooks-editor files: listing files", {
        operation: "runbooks_editor_files_find",
        hostId,
        role,
        runbook,
      });
      const listCmd = `find ${escapedRunbookRoot} -type f -printf '%P\\n' 2>/dev/null | sort`;
      const output = await execWithTimeout(conn, listCmd);

      // 10. Parse, filter, map.
      const files = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((path) => ({ path }));

      res.json({ files });
    } catch (err) {
      sshLogger.error("runbooks-editor files: unexpected error", {
        operation: "runbooks_editor_files_error",
        hostId,
        role,
        runbook,
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
// POST /runbooks-editor/read
// ---------------------------------------------------------------------------

/**
 * Read a file inside a runbook. Returns { content, mtime, size, isText };
 * content is "" when !isText (frontend renders the "Not a text file"
 * placeholder branch — bandwidth-saving decision). Missing file →
 * { content:"", mtime:0, size:0, isText:true } (cat + stat swallow errors).
 * Returns 404 `{error:"role not found"}` when the role folder is absent (D-15).
 */
router.post(
  "/read",
  authenticateJWT,
  express.json({ limit: "32kb" }), // hostId + role + runbook + path only
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Body validation — 400 BEFORE any I/O.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawRole = body.role;
    const rawRunbook = body.runbook;
    const rawPath = body.path;

    if (
      typeof rawHostId !== "number" ||
      !Number.isInteger(rawHostId) ||
      rawHostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    if (!isValidRoleName(rawRole)) {
      res.status(400).json({ error: "invalid role name" });
      return;
    }
    if (!isValidRunbookName(rawRunbook)) {
      res.status(400).json({ error: "invalid runbook name" });
      return;
    }
    if (!isSafeRelativePath(rawPath)) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    const hostId = rawHostId;
    const role = rawRole;
    const runbook = rawRunbook;
    const relPath = rawPath;

    // 2. Per-user host isolation.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      // 3. SSH connect.
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("runbooks-editor read: SSH connect failed", {
          operation: "runbooks_editor_read_connect",
          hostId,
          role,
          runbook,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // 4. Resolve $HOME.
      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn("runbooks-editor read: could not resolve remote HOME", {
          operation: "runbooks_editor_read_home",
          hostId,
          role,
          runbook,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 5. D-15 role-existence check.
      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const escapedRoleRoot = shellEscape(roleRoot);
      sshLogger.info("runbooks-editor read: checking role existence", {
        operation: "runbooks_editor_read_role_check",
        hostId,
        role,
        runbook,
      });
      const roleCheckOutput = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRoleRoot} && echo ok || echo missing`,
        )
      ).trim();
      if (roleCheckOutput !== "ok") {
        sshLogger.warn("runbooks-editor read: role not found", {
          operation: "runbooks_editor_read_role_missing",
          hostId,
          role,
          runbook,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 6. Compose runbookRoot + absolute file path.
      const runbookRoot = `${roleRoot}/runbooks/${runbook}`;
      const absPath = `${runbookRoot}/${relPath}`;

      // 7. Belt-and-suspenders prefix assertion — regex gates make this
      //    unreachable but assert anyway (defense in depth).
      if (!absPath.startsWith(runbookRoot + "/")) {
        sshLogger.error("runbooks-editor read: path escapes runbook root (impossible-per-regex-gate case)", {
          operation: "runbooks_editor_read_escape_detected",
          hostId,
          role,
          runbook,
        });
        res.status(400).json({ error: "path escapes runbook root" });
        return;
      }

      // 8. Read content + mtime + size via exec channel.
      const escapedPath = shellEscape(absPath);
      const content = await execWithTimeout(
        conn,
        `cat ${escapedPath} 2>/dev/null || true`,
      );
      const mtime = parseInt(
        (
          await execWithTimeout(
            conn,
            `stat -c '%Y' ${escapedPath} 2>/dev/null || echo 0`,
          )
        ).trim(),
        10,
      );
      const size = parseInt(
        (
          await execWithTimeout(
            conn,
            `stat -c '%s' ${escapedPath} 2>/dev/null || echo 0`,
          )
        ).trim(),
        10,
      );

      const isText = detectIsText(Buffer.from(content, "utf-8"));

      res.json({
        content: isText ? content : "",
        mtime: Number.isFinite(mtime) ? mtime : 0,
        size: Number.isFinite(size) ? size : 0,
        isText,
      });
    } catch (err) {
      sshLogger.error("runbooks-editor read: unexpected error", {
        operation: "runbooks_editor_read_error",
        hostId,
        role,
        runbook,
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
// PUT /runbooks-editor/write
// ---------------------------------------------------------------------------

/**
 * Save a file inside a runbook with optimistic-concurrency mtime check.
 * On mtime drift returns 409 with byte-identical shape to Phase 23 / skills-editor:
 *   { error: "mtime mismatch", currentMtime, currentContent }
 * Atomic write goes through writeMarkdownFileAtomic.
 * Returns 404 `{error:"role not found"}` when the role folder is absent (D-15).
 */
router.put(
  "/write",
  authenticateJWT, // BEFORE body parser — unauthenticated attackers shouldn't send 4MB bodies
  express.json({ limit: "4mb" }), // matches nginx client_max_body_size
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Body validation — 400 BEFORE any I/O.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawRole = body.role;
    const rawRunbook = body.runbook;
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
    if (!isValidRoleName(rawRole)) {
      res.status(400).json({ error: "invalid role name" });
      return;
    }
    if (!isValidRunbookName(rawRunbook)) {
      res.status(400).json({ error: "invalid runbook name" });
      return;
    }
    if (!isSafeRelativePath(rawPath)) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    if (typeof rawContent !== "string") {
      res.status(400).json({ error: "content must be a string" });
      return;
    }
    if (Buffer.byteLength(rawContent, "utf-8") > MAX_CONTENT_BYTES) {
      res.status(413).json({
        error: `content must be ≤${MAX_CONTENT_BYTES} bytes`,
      });
      return;
    }
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
    const role = rawRole;
    const runbook = rawRunbook;
    const relPath = rawPath;
    const content = rawContent;
    const expectedMtime =
      rawExpectedMtime !== undefined
        ? (rawExpectedMtime as number)
        : undefined;

    // 2. Per-user host isolation.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      // 3. SSH connect.
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("runbooks-editor write: SSH connect failed", {
          operation: "runbooks_editor_write_connect",
          hostId,
          role,
          runbook,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // 4. Resolve $HOME.
      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn("runbooks-editor write: could not resolve remote HOME", {
          operation: "runbooks_editor_write_home",
          hostId,
          role,
          runbook,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 5. D-15 role-existence check.
      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const escapedRoleRoot = shellEscape(roleRoot);
      sshLogger.info("runbooks-editor write: checking role existence", {
        operation: "runbooks_editor_write_role_check",
        hostId,
        role,
        runbook,
      });
      const roleCheckOutput = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRoleRoot} && echo ok || echo missing`,
        )
      ).trim();
      if (roleCheckOutput !== "ok") {
        sshLogger.warn("runbooks-editor write: role not found", {
          operation: "runbooks_editor_write_role_missing",
          hostId,
          role,
          runbook,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 6. Compose runbookRoot + absolute file path + belt-and-suspenders assertion.
      const runbookRoot = `${roleRoot}/runbooks/${runbook}`;
      const absPath = `${runbookRoot}/${relPath}`;
      if (!absPath.startsWith(runbookRoot + "/")) {
        sshLogger.error("runbooks-editor write: path escapes runbook root (impossible-per-regex-gate case)", {
          operation: "runbooks_editor_write_escape_detected",
          hostId,
          role,
          runbook,
        });
        res.status(400).json({ error: "path escapes runbook root" });
        return;
      }
      const escapedPath = shellEscape(absPath);

      // 7. Optimistic-concurrency check (only when expectedMtime provided).
      if (typeof expectedMtime === "number") {
        const currentMtimeStr = (
          await execWithTimeout(
            conn,
            `stat -c '%Y' ${escapedPath} 2>/dev/null || echo 0`,
          )
        ).trim();
        const currentMtime = parseInt(currentMtimeStr, 10) || 0;

        if (currentMtime !== expectedMtime) {
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

      // 8. SFTP atomic write — reuse writeMarkdownFileAtomic.
      try {
        await writeMarkdownFileAtomic(conn, absPath, content);
      } catch (err) {
        sshLogger.error("runbooks-editor write: SFTP write failed", {
          operation: "runbooks_editor_write_sftp",
          hostId,
          role,
          runbook,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // 9. Re-stat for server-authoritative new mtime.
      const newMtimeStr = (
        await execWithTimeout(
          conn,
          `stat -c '%Y' ${escapedPath} 2>/dev/null || echo 0`,
        )
      ).trim();
      const newMtime = parseInt(newMtimeStr, 10) || 0;

      res.json({ mtime: newMtime });
    } catch (err) {
      sshLogger.error("runbooks-editor write: unexpected error", {
        operation: "runbooks_editor_write_error",
        hostId,
        role,
        runbook,
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
// POST /runbooks-editor/create
// ---------------------------------------------------------------------------

/**
 * Create a new empty file inside a runbook. Rejects duplicates with 409.
 * Subpaths honored — mkdir -p on the parent dir before touch, so
 * `prompts/main.md` creates the `prompts/` dir if needed.
 * Returns 404 `{error:"role not found"}` when the role folder is absent (D-15).
 * Returns 404 `{error:"runbook not found"}` when the runbook folder is absent.
 */
router.post(
  "/create",
  authenticateJWT,
  express.json({ limit: "32kb" }),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Body validation.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawRole = body.role;
    const rawRunbook = body.runbook;
    const rawPath = body.path;

    if (
      typeof rawHostId !== "number" ||
      !Number.isInteger(rawHostId) ||
      rawHostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    if (!isValidRoleName(rawRole)) {
      res.status(400).json({ error: "invalid role name" });
      return;
    }
    if (!isValidRunbookName(rawRunbook)) {
      res.status(400).json({ error: "invalid runbook name" });
      return;
    }
    if (!isSafeRelativePath(rawPath)) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    const hostId = rawHostId;
    const role = rawRole;
    const runbook = rawRunbook;
    const relPath = rawPath;

    // 2. Per-user host isolation.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      // 3. SSH connect.
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("runbooks-editor create: SSH connect failed", {
          operation: "runbooks_editor_create_connect",
          hostId,
          role,
          runbook,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // 4. Resolve $HOME.
      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn("runbooks-editor create: could not resolve remote HOME", {
          operation: "runbooks_editor_create_home",
          hostId,
          role,
          runbook,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 5. D-15 role-existence check.
      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const escapedRoleRoot = shellEscape(roleRoot);
      sshLogger.info("runbooks-editor create: checking role existence", {
        operation: "runbooks_editor_create_role_check",
        hostId,
        role,
        runbook,
      });
      const roleCheckOutput = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRoleRoot} && echo ok || echo missing`,
        )
      ).trim();
      if (roleCheckOutput !== "ok") {
        sshLogger.warn("runbooks-editor create: role not found", {
          operation: "runbooks_editor_create_role_missing",
          hostId,
          role,
          runbook,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 6. Compose runbookRoot + absolute file path.
      const runbookRoot = `${roleRoot}/runbooks/${runbook}`;
      const escapedRunbookRoot = shellEscape(runbookRoot);
      const absPath = `${runbookRoot}/${relPath}`;
      const escapedPath = shellEscape(absPath);

      // 7. Runbook-existence gate — Creating a brand-new runbook from scratch is
      //    out of scope. Without this guard, mkdir -p would silently create the
      //    runbook folder, violating the scope contract.
      sshLogger.info("runbooks-editor create: checking runbook existence", {
        operation: "runbooks_editor_create_runbook_check",
        hostId,
        role,
        runbook,
      });
      const runbookDirCheck = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRunbookRoot} && echo exists || echo missing`,
        )
      ).trim();
      if (runbookDirCheck !== "exists") {
        res.status(404).json({ error: "runbook not found" });
        return;
      }

      // 8. Existence check — 409 if target already exists.
      const existsCheck = (
        await execWithTimeout(
          conn,
          `test -e ${escapedPath} && echo exists || echo ok`,
        )
      ).trim();
      if (existsCheck === "exists") {
        res.status(409).json({ error: "file exists" });
        return;
      }

      // 9. Ensure parent dir exists inside the runbook (mkdir -p is idempotent).
      const parentDir = absPath.slice(0, absPath.lastIndexOf("/"));
      await execWithTimeout(conn, `mkdir -p ${shellEscape(parentDir)}`);

      // 10. Touch the file.
      await execWithTimeout(conn, `touch ${escapedPath}`);

      // 11. Stat for authoritative mtime.
      const mtimeStr = (
        await execWithTimeout(
          conn,
          `stat -c '%Y' ${escapedPath} 2>/dev/null || echo 0`,
        )
      ).trim();
      const mtime = parseInt(mtimeStr, 10) || 0;

      res.json({ path: relPath, mtime });
    } catch (err) {
      sshLogger.error("runbooks-editor create: unexpected error", {
        operation: "runbooks_editor_create_error",
        hostId,
        role,
        runbook,
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
// DELETE /runbooks-editor/file
// ---------------------------------------------------------------------------

/**
 * Delete a single file inside a runbook. Idempotent — rm -f swallows the
 * missing-file case, so double-deletes and races both return 200.
 * Returns 404 `{error:"role not found"}` when the role folder is absent (D-15).
 */
router.delete(
  "/file",
  authenticateJWT,
  express.json({ limit: "32kb" }),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Body validation.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawRole = body.role;
    const rawRunbook = body.runbook;
    const rawPath = body.path;

    if (
      typeof rawHostId !== "number" ||
      !Number.isInteger(rawHostId) ||
      rawHostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    if (!isValidRoleName(rawRole)) {
      res.status(400).json({ error: "invalid role name" });
      return;
    }
    if (!isValidRunbookName(rawRunbook)) {
      res.status(400).json({ error: "invalid runbook name" });
      return;
    }
    if (!isSafeRelativePath(rawPath)) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    const hostId = rawHostId;
    const role = rawRole;
    const runbook = rawRunbook;
    const relPath = rawPath;

    // 2. Per-user host isolation.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      // 3. SSH connect.
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("runbooks-editor delete-file: SSH connect failed", {
          operation: "runbooks_editor_delete_file_connect",
          hostId,
          role,
          runbook,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // 4. Resolve $HOME.
      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn(
          "runbooks-editor delete-file: could not resolve remote HOME",
          {
            operation: "runbooks_editor_delete_file_home",
            hostId,
            role,
            runbook,
            remoteHome,
          },
        );
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 5. D-15 role-existence check.
      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const escapedRoleRoot = shellEscape(roleRoot);
      sshLogger.info("runbooks-editor delete-file: checking role existence", {
        operation: "runbooks_editor_delete_file_role_check",
        hostId,
        role,
        runbook,
      });
      const roleCheckOutput = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRoleRoot} && echo ok || echo missing`,
        )
      ).trim();
      if (roleCheckOutput !== "ok") {
        sshLogger.warn("runbooks-editor delete-file: role not found", {
          operation: "runbooks_editor_delete_file_role_missing",
          hostId,
          role,
          runbook,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 6. Compose runbookRoot + absolute file path + belt-and-suspenders assertion.
      const runbookRoot = `${roleRoot}/runbooks/${runbook}`;
      const absPath = `${runbookRoot}/${relPath}`;
      if (!absPath.startsWith(runbookRoot + "/")) {
        sshLogger.error("runbooks-editor delete-file: path escapes runbook root (impossible-per-regex-gate case)", {
          operation: "runbooks_editor_delete_file_escape_detected",
          hostId,
          role,
          runbook,
        });
        res.status(400).json({ error: "path escapes runbook root" });
        return;
      }
      const escapedPath = shellEscape(absPath);

      // 7. rm -f is idempotent — missing target is not an error.
      await execWithTimeout(conn, `rm -f ${escapedPath}`);

      res.json({ ok: true });
    } catch (err) {
      sshLogger.error("runbooks-editor delete-file: unexpected error", {
        operation: "runbooks_editor_delete_file_error",
        hostId,
        role,
        runbook,
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
// DELETE /runbooks-editor/runbook
// ---------------------------------------------------------------------------

/**
 * Delete an entire runbook (folder + all contents).
 *
 * LIFE-CRITICAL: recursive folder deletion on the composed runbookRoot. The
 * path-safety gate MUST fire before the shell command runs. Three-layer defense:
 *   1. ROLE_NAME_RE + RUNBOOK_NAME_RE regex gates reject any name containing
 *      `/`, `..`, or shell metachars — so no user-supplied value can escape
 *      the composed root.
 *   2. Post-compose belt-and-suspenders assertions:
 *      - runbookRoot MUST contain `/runbooks/`
 *      - runbookRoot MUST end with `/${runbook}`
 *      - runbookRoot MUST NOT contain `..`
 *   3. shellEscape single-quote wraps the value one more time before
 *      interpolation into the shell delete command.
 * Returns 404 `{error:"role not found"}` when the role folder is absent (D-15).
 */
router.delete(
  "/runbook",
  authenticateJWT, // BEFORE body parser — extra important on the recursive-delete endpoint
  express.json({ limit: "32kb" }),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Body validation — role + runbook only; no path field.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawRole = body.role;
    const rawRunbook = body.runbook;

    if (
      typeof rawHostId !== "number" ||
      !Number.isInteger(rawHostId) ||
      rawHostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    if (!isValidRoleName(rawRole)) {
      res.status(400).json({ error: "invalid role name" });
      return;
    }
    if (!isValidRunbookName(rawRunbook)) {
      res.status(400).json({ error: "invalid runbook name" });
      return;
    }
    const hostId = rawHostId;
    const role = rawRole;
    const runbook = rawRunbook;

    // 2. Per-user host isolation.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      // 3. SSH connect.
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("runbooks-editor delete-runbook: SSH connect failed", {
          operation: "runbooks_editor_delete_runbook_connect",
          hostId,
          role,
          runbook,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // 4. Resolve $HOME.
      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn(
          "runbooks-editor delete-runbook: could not resolve remote HOME",
          {
            operation: "runbooks_editor_delete_runbook_home",
            hostId,
            role,
            runbook,
            remoteHome,
          },
        );
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 5. D-15 role-existence check.
      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const escapedRoleRoot = shellEscape(roleRoot);
      sshLogger.info("runbooks-editor delete-runbook: checking role existence", {
        operation: "runbooks_editor_delete_runbook_role_check",
        hostId,
        role,
        runbook,
      });
      const roleCheckOutput = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRoleRoot} && echo ok || echo missing`,
        )
      ).trim();
      if (roleCheckOutput !== "ok") {
        sshLogger.warn("runbooks-editor delete-runbook: role not found", {
          operation: "runbooks_editor_delete_runbook_role_missing",
          hostId,
          role,
          runbook,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 6. Compose runbookRoot + LIFE-CRITICAL belt-and-suspenders assertions.
      //    ROLE_NAME_RE + RUNBOOK_NAME_RE should have made these unreachable,
      //    but the recursive folder delete is life-critical — assert the invariants regardless.
      const runbookRoot = `${roleRoot}/runbooks/${runbook}`;
      if (!runbookRoot.includes("/runbooks/")) {
        sshLogger.error(
          "runbooks-editor delete-runbook: runbookRoot missing /runbooks/ segment (impossible-per-regex-gate case)",
          { operation: "runbooks_editor_delete_runbook_assertion_failed", hostId, role, runbook },
        );
        res.status(500).json({ error: "internal" });
        return;
      }
      if (!runbookRoot.endsWith(`/${runbook}`)) {
        sshLogger.error(
          "runbooks-editor delete-runbook: runbookRoot does not end with runbook name (impossible-per-regex-gate case)",
          { operation: "runbooks_editor_delete_runbook_assertion_failed", hostId, role, runbook },
        );
        res.status(500).json({ error: "internal" });
        return;
      }
      if (runbookRoot.includes("..")) {
        sshLogger.error(
          "runbooks-editor delete-runbook: runbookRoot contains '..' (impossible-per-regex-gate case)",
          { operation: "runbooks_editor_delete_runbook_assertion_failed", hostId, role, runbook },
        );
        res.status(500).json({ error: "internal" });
        return;
      }

      const escapedRunbookRoot = shellEscape(runbookRoot);
      await execWithTimeout(conn, `rm -rf ${escapedRunbookRoot}`);

      res.json({ ok: true });
    } catch (err) {
      sshLogger.error("runbooks-editor delete-runbook: unexpected error", {
        operation: "runbooks_editor_delete_runbook_error",
        hostId,
        role,
        runbook,
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

// Generic 500 fallback error handler — sanitizes upstream detail so we
// never leak stderr / remote paths / credential fragments in the response.
// Mirrors skills-editor.ts L1187-1200.
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    sshLogger.error("runbooks-editor: unhandled error", {
      operation: "runbooks_editor_error",
      error: err?.message,
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
