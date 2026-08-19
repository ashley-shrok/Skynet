/**
 * Phase 44 (SKILLED-01): /skills-editor Express router — 7 endpoints.
 *
 * Byte-shape mirror of Phase 23's `global-files-read-write.ts` + `global-files.ts`
 * with two structural changes:
 *   1. The JSON whitelist AUTH gate is replaced by a two-layer path-safety gate
 *      (SKILL_NAME_RE + isSafeRelativePath regex gates BEFORE any I/O, plus a
 *      belt-and-suspenders `absPath.startsWith(skillRoot + "/")` post-compose
 *      prefix assertion). See RESEARCH.md § Pattern 3 / § Common Pitfalls #1.
 *   2. POST /read returns an `isText` field driven by a Node-side byte-sniff
 *      heuristic (`detectIsText`). Binary files return `content: ""` to save
 *      bandwidth; the frontend renders a placeholder branch on `!isText`.
 *
 * Endpoints (all gated by authenticateJWT + resolveHostById(hostId, userId)):
 *   GET  /skills-editor/skills?hostId=<n>
 *     → 200 { skills: [{name}] } sorted alphabetically; empty array when the
 *       remote `~/.claude/skills/` directory is missing (not 404 — mirrors
 *       Phase 23 GEFM-03 "missing = empty state").
 *   GET  /skills-editor/files?hostId=<n>&skill=<s>
 *     → 200 { files: [{path}] } with paths relative to the skill root
 *       (e.g. "tests/basic.py") — sorted alphabetically for deterministic
 *       tab order; empty array when skill has no files.
 *   POST /skills-editor/read      { hostId, skill, path }
 *     → 200 { content, mtime, size, isText } — content is "" when !isText.
 *   PUT  /skills-editor/write     { hostId, skill, path, content, expectedMtime? }
 *     → 200 { mtime } | 409 { error:"mtime mismatch", currentMtime, currentContent }
 *       (byte-identical 409 shape to Phase 23's global-files write endpoint).
 *   POST /skills-editor/create    { hostId, skill, path }
 *     → 200 { path, mtime } | 409 { error:"file exists" }
 *   DELETE /skills-editor/file    { hostId, skill, path }
 *     → 200 { ok:true } (idempotent — rm -f swallows missing files)
 *   DELETE /skills-editor/skill   { hostId, skill }
 *     → 200 { ok:true } (rm -rf the skill folder — path-safety gate is
 *       LIFE-CRITICAL; two-layer defense assertion runs before shell exec).
 *
 * Security posture (STRIDE mitigations — see 44-01-PLAN.md <threat_model>):
 *   - SKILL_NAME_RE `/^[a-zA-Z0-9._-]{1,128}$/` rejects `.`, `..`, `/`, and
 *     every shell metacharacter at input validation. isSafeRelativePath
 *     rejects `..` segments, leading `/`, NUL bytes, empty segments, and
 *     paths over 512 chars — ALL before any SSH connection is opened.
 *   - Belt-and-suspenders `absPath.startsWith(skillRoot + "/")` prefix
 *     assertion post-compose (RESEARCH.md § Pattern 3). Regex gates make
 *     it unreachable but the invariant is asserted anyway.
 *   - `shellEscape` single-quote wraps every user-supplied value before
 *     shell interpolation (INJECTION gate; the regex gates are the AUTH
 *     gate — both required per Phase 23 discipline).
 *   - `echo $HOME` two-step BEFORE every path compose (SFTP + single-quote
 *     shell escaping both suppress tilde expansion — quick-260805-70q root
 *     cause; RESEARCH.md § Pitfall 5). Never cached across requests.
 *   - `execWithTimeout` bounds every remote exec to 5s; `connectOneShot`
 *     bounds SSH connect to 5s; nginx `proxy_read_timeout 15s` caps the
 *     whole request (RESEARCH.md § Common Pitfalls #7 — matches Phase 23).
 *   - Response bodies use fixed shapes (`{error:"internal"}`,
 *     `{error:"SSH connect failed"}`, etc.) — never leak stderr, remote
 *     paths, or credential fragments.
 *
 * Mount: app.use("/skills-editor", skillsEditorRoutes) in database.ts
 * alongside the existing /global-files mounts.
 *
 * Nginx: BOTH docker/nginx.conf AND docker/nginx-https.conf need a
 * matching `location ~ ^/skills-editor(/.*)?$` block (patch #446 arc
 * lesson — parity is load-bearing).
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

/** SSH connect timeout — matches Phase 23 (global-files-read-write.ts L61). */
const SSH_CONNECT_TIMEOUT_MS = 5000;

/** SSH exec race timeout — bounded so a hung remote can't stall the route. */
const SSH_EXEC_TIMEOUT_MS = 5000;

/**
 * Maximum relative path length accepted in the body / query.
 * Paths longer than this are almost certainly malformed. Matches Phase 23.
 */
const MAX_PATH_LENGTH = 512;

/**
 * Maximum content size for PUT /write body content field (bytes, UTF-8).
 * Mirrors IDMEDIT_MAX_MARKDOWN_BYTES in identity-artifact-reader.ts L1014
 * and MAX_CONTENT_BYTES in global-files-read-write.ts L76.
 */
const MAX_CONTENT_BYTES = 2_000_000;

/**
 * Skill-name gate: alphanumeric, hyphen, underscore, dot; 1-128 chars.
 * Rejects `.`, `..`, empty, anything with a `/`, backslash, shell metachars,
 * spaces. Runs BEFORE resolveHostById + SSH connect on every endpoint.
 */
const SKILL_NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/;

/**
 * Relative path from a skill root to a file inside it.
 * Segments are joined by `/`; used to compose `~/.claude/skills/<skill>/<path>`.
 */
const SKILL_ROOT_REL = ".claude/skills";

/**
 * Race an exec against a timeout so a hung remote can't stall the route.
 * Duplicated verbatim from global-files-read-write.ts L82-96 (which was
 * itself duplicated from roles-create.ts L127-141 + roles-list-for-host.ts
 * L86-100). Fourth intentional instance per Phase 23 comment "keeps plan
 * diff scoped to net-new files" — extracting to a shared module is a
 * Post-Planning-Gaps item, not a Phase 44 task.
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
 * bash commands. The regex gates (isValidSkillName + isSafeRelativePath)
 * are the AUTH gate; shellEscape is the INJECTION gate — both required
 * per Phase 23's PATTERNS trap #3.
 * Pattern: `abc'def` → `'abc'"'"'def'`
 */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Skill-name AUTH gate. Rejects any value that could escape the skill
 * root (via `..`) or inject shell metachars. Returns true only for a
 * SKILL_NAME_RE match that is not `.` or `..`. Runs BEFORE any I/O.
 */
function isValidSkillName(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (s === "." || s === "..") return false;
  return SKILL_NAME_RE.test(s);
}

/**
 * Relative-path AUTH gate. Rejects:
 *   - non-strings
 *   - empty strings
 *   - > MAX_PATH_LENGTH chars
 *   - leading `/` (absolute paths)
 *   - NUL byte
 *   - any `..`, `.`, or empty segment when split by `/`
 * Runs BEFORE any I/O. Complements the SKILL_NAME_RE gate on the skill
 * dimension. Together they make the belt-and-suspenders prefix assertion
 * unreachable in normal flow — but the assertion runs anyway (defense in
 * depth per RESEARCH.md § Pattern 3).
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
 *      decoded output contains U+FFFD replacement char (some decoders
 *      normalize invalid bytes without throwing).
 *   5. Otherwise text.
 *
 * Rationale (RESEARCH.md § Text Detection): extension-based detection is
 * brittle (a .md binary blob false-positives); remote `file -b --mime`
 * adds an SSH round-trip and a shell dependency; Node-side byte-sniff is
 * cheap, deterministic, and matches the industry-standard `git`-style
 * detection heuristic.
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
    if (decoded.includes("�")) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Compose the absolute path to a file inside a skill on the remote host
 * and assert it stays inside the skill root. Regex gates upstream should
 * make the assertion unreachable — belt-and-suspenders.
 * Returns null when the prefix assertion fails (caller should respond 400).
 */
function buildAbsSkillFilePath(
  remoteHome: string,
  skill: string,
  relPath: string,
): { skillRoot: string; absPath: string } | null {
  const skillRoot = `${remoteHome}/${SKILL_ROOT_REL}/${skill}`;
  const absPath = `${skillRoot}/${relPath}`;
  if (!absPath.startsWith(skillRoot + "/")) {
    return null;
  }
  return { skillRoot, absPath };
}

// ---------------------------------------------------------------------------
// GET /skills-editor/skills?hostId=<n>
// ---------------------------------------------------------------------------

/**
 * List skills on the host — `find ~/.claude/skills -mindepth 1 -maxdepth 1
 * -type d -printf '%f\n' | sort`. Returns empty array when the directory
 * is missing (not 404 — mirrors Phase 23 "missing = empty state").
 */
router.get(
  "/skills",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId (mirrors global-files.ts L52-60).
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

    // 2. Per-user host isolation — 404 for cross-user / unknown hosts.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // 3. SSH connect → echo $HOME → find. Same lifecycle as read/write.
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("skills-editor skills: SSH connect failed", {
          operation: "skills_editor_skills_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn("skills-editor skills: could not resolve remote HOME", {
          operation: "skills_editor_skills_home",
          hostId,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      const skillsRoot = `${remoteHome}/${SKILL_ROOT_REL}`;
      const escapedSkillsRoot = shellEscape(skillsRoot);
      // -mindepth/-maxdepth 1 restrict to direct-child directories;
      // `-printf '%f\n'` prints just the basename; 2>/dev/null swallows
      // permission / missing errors (empty output → empty skills list).
      const listCmd =
        `find ${escapedSkillsRoot} -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null | sort`;
      const output = await execWithTimeout(conn, listCmd);
      const skills = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((name) => ({ name }));

      res.json({ skills });
    } catch (err) {
      sshLogger.error("skills-editor skills: unexpected error", {
        operation: "skills_editor_skills_error",
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
// GET /skills-editor/files?hostId=<n>&skill=<s>
// ---------------------------------------------------------------------------

/**
 * List files inside a skill (recursively, path-relative to the skill root).
 * `find <skillRoot> -type f -printf '%P\n' | sort`. Returns empty array
 * when the skill has no files (or does not exist on the host — mirrors
 * Phase 23's "missing = empty state" posture).
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

    // 2. Skill-name AUTH gate — BEFORE any I/O (RESEARCH.md § Pattern 3).
    const rawSkill = req.query.skill;
    if (!isValidSkillName(rawSkill)) {
      res.status(400).json({ error: "invalid skill name" });
      return;
    }
    const skill = rawSkill;

    // 3. Per-user host isolation.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("skills-editor files: SSH connect failed", {
          operation: "skills_editor_files_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn("skills-editor files: could not resolve remote HOME", {
          operation: "skills_editor_files_home",
          hostId,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      const skillRoot = `${remoteHome}/${SKILL_ROOT_REL}/${skill}`;
      const escapedSkillRoot = shellEscape(skillRoot);
      // %P prints the path relative to the starting point (D-05 requirement
      // — a file at `<skill>/tests/basic.py` becomes `tests/basic.py`).
      const listCmd =
        `find ${escapedSkillRoot} -type f -printf '%P\\n' 2>/dev/null | sort`;
      const output = await execWithTimeout(conn, listCmd);
      const files = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((path) => ({ path }));

      res.json({ files });
    } catch (err) {
      sshLogger.error("skills-editor files: unexpected error", {
        operation: "skills_editor_files_error",
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
// POST /skills-editor/read
// ---------------------------------------------------------------------------

/**
 * Read a file inside a skill. Returns { content, mtime, size, isText };
 * content is "" when !isText (frontend renders the "Not a text file"
 * placeholder branch — bandwidth-saving decision, RESEARCH.md § Text
 * Detection). Missing file → { content:"", mtime:0, size:0, isText:true }
 * (cat + stat swallow errors — same posture as Phase 23).
 */
router.post(
  "/read",
  // Auth BEFORE the body parser — unauthenticated attackers shouldn't get to
  // parse an arbitrary-shaped JSON body before we reject them (cheap DoS
  // amplification vector). authenticateJWT reads only from cookie/header,
  // so it works fine with an unread body; Express drains the socket after
  // sending the 401.
  authenticateJWT,
  express.json({ limit: "32kb" }), // hostId + skill + path only
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Body validation — 400 BEFORE any I/O.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawSkill = body.skill;
    const rawPath = body.path;

    if (
      typeof rawHostId !== "number" ||
      !Number.isInteger(rawHostId) ||
      rawHostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    if (!isValidSkillName(rawSkill)) {
      res.status(400).json({ error: "invalid skill name" });
      return;
    }
    if (!isSafeRelativePath(rawPath)) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    const hostId = rawHostId;
    const skill = rawSkill;
    const relPath = rawPath;

    // 2. Per-user host isolation.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("skills-editor read: SSH connect failed", {
          operation: "skills_editor_read_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // 3. Resolve $HOME because SFTP + single-quoted shell interpolation both
      //    suppress tilde expansion (quick-260805-70q root cause).
      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn("skills-editor read: could not resolve remote HOME", {
          operation: "skills_editor_read_home",
          hostId,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 4. Compose absolute path + belt-and-suspenders prefix assertion.
      const paths = buildAbsSkillFilePath(remoteHome, skill, relPath);
      if (!paths) {
        res.status(400).json({ error: "path escape detected" });
        return;
      }
      const { absPath } = paths;

      // 5. Read content + mtime + size via exec channel (same shape as Phase 23).
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
      sshLogger.error("skills-editor read: unexpected error", {
        operation: "skills_editor_read_error",
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
// PUT /skills-editor/write
// ---------------------------------------------------------------------------

/**
 * Save a file inside a skill with optimistic-concurrency mtime check.
 * On mtime drift returns 409 with byte-identical shape to Phase 23:
 *   { error: "mtime mismatch", currentMtime, currentContent }
 * Atomic write goes through writeMarkdownFileAtomic (posix-rename via
 * ext_openssh_rename — do NOT use the plain SFTP rename call directly; see the prologue
 * at identity-artifact-reader.ts L1039-1063 for the EEXIST trap).
 */
router.put(
  "/write",
  authenticateJWT, // BEFORE body parser — see /read for rationale (unauth attackers shouldn't get to send 4MB bodies before we reject them)
  express.json({ limit: "4mb" }), // matches nginx client_max_body_size
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Body validation — 400 BEFORE any I/O.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawSkill = body.skill;
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
    if (!isValidSkillName(rawSkill)) {
      res.status(400).json({ error: "invalid skill name" });
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
      res.status(400).json({
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
    const skill = rawSkill;
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
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("skills-editor write: SSH connect failed", {
          operation: "skills_editor_write_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn("skills-editor write: could not resolve remote HOME", {
          operation: "skills_editor_write_home",
          hostId,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      const paths = buildAbsSkillFilePath(remoteHome, skill, relPath);
      if (!paths) {
        res.status(400).json({ error: "path escape detected" });
        return;
      }
      const { absPath } = paths;
      const escapedPath = shellEscape(absPath);

      // 3. Optimistic-concurrency check (only when expectedMtime provided).
      //    409 shape locked byte-identical to Phase 23 so frontend can share
      //    the error class (or duplicate — same behavior).
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

      // 4. SFTP atomic write — reuse writeMarkdownFileAtomic (do NOT re-impl).
      try {
        await writeMarkdownFileAtomic(conn, absPath, content);
      } catch (err) {
        sshLogger.error("skills-editor write: SFTP write failed", {
          operation: "skills_editor_write_sftp",
          hostId,
          absPath,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // 5. Re-stat for server-authoritative new mtime.
      const newMtimeStr = (
        await execWithTimeout(
          conn,
          `stat -c '%Y' ${escapedPath} 2>/dev/null || echo 0`,
        )
      ).trim();
      const newMtime = parseInt(newMtimeStr, 10) || 0;

      res.json({ mtime: newMtime });
    } catch (err) {
      sshLogger.error("skills-editor write: unexpected error", {
        operation: "skills_editor_write_error",
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
// POST /skills-editor/create
// ---------------------------------------------------------------------------

/**
 * Create a new empty file inside a skill. Rejects duplicates with 409.
 * Subpaths honored per RESEARCH.md § Open Question 2 — mkdir -p on the
 * parent dir before touch, so `tests/basic.py` creates the `tests/` dir
 * if needed. D-09 "at the skill's root" is read as "relative to the
 * skill root", not "flat in the skill root."
 */
router.post(
  "/create",
  authenticateJWT, // BEFORE body parser — see /read for rationale
  express.json({ limit: "32kb" }),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Body validation.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawSkill = body.skill;
    const rawPath = body.path;

    if (
      typeof rawHostId !== "number" ||
      !Number.isInteger(rawHostId) ||
      rawHostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    if (!isValidSkillName(rawSkill)) {
      res.status(400).json({ error: "invalid skill name" });
      return;
    }
    if (!isSafeRelativePath(rawPath)) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    const hostId = rawHostId;
    const skill = rawSkill;
    const relPath = rawPath;

    // 2. Per-user host isolation.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("skills-editor create: SSH connect failed", {
          operation: "skills_editor_create_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn("skills-editor create: could not resolve remote HOME", {
          operation: "skills_editor_create_home",
          hostId,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      const paths = buildAbsSkillFilePath(remoteHome, skill, relPath);
      if (!paths) {
        res.status(400).json({ error: "path escape detected" });
        return;
      }
      const { skillRoot, absPath } = paths;
      const escapedPath = shellEscape(absPath);
      const escapedSkillRoot = shellEscape(skillRoot);

      // 3. Skill-existence gate — the shape says "Creating a brand-new skill
      //    from scratch is out of scope for this cut." Without this guard,
      //    the mkdir -p below silently creates the skill folder for any
      //    novel skill name a caller supplies via the API, violating the
      //    scope contract. Bail 404 if the skill doesn't exist yet.
      const skillDirCheck = (
        await execWithTimeout(
          conn,
          `test -d ${escapedSkillRoot} && echo exists || echo missing`,
        )
      ).trim();
      if (skillDirCheck !== "exists") {
        res.status(404).json({ error: "skill not found" });
        return;
      }

      // 4. Existence check — 409 if target already exists (idempotent-create
      //    is a bug; user would be confused if their "new file" was actually
      //    an unexpected overwrite of an existing one).
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

      // 5. Ensure parent dir exists inside the skill (mkdir -p is idempotent,
      //    and the skill-existence gate above guarantees we never create the
      //    skill folder itself here — this only handles subpath dirs).
      const parentDir = absPath.slice(0, absPath.lastIndexOf("/"));
      await execWithTimeout(conn, `mkdir -p ${shellEscape(parentDir)}`);

      // 6. Touch the file.
      await execWithTimeout(conn, `touch ${escapedPath}`);

      // 7. Stat for authoritative mtime.
      const mtimeStr = (
        await execWithTimeout(
          conn,
          `stat -c '%Y' ${escapedPath} 2>/dev/null || echo 0`,
        )
      ).trim();
      const mtime = parseInt(mtimeStr, 10) || 0;

      // Echo the request's relPath (not absPath — frontend passed it in).
      res.json({ path: relPath, mtime });
    } catch (err) {
      sshLogger.error("skills-editor create: unexpected error", {
        operation: "skills_editor_create_error",
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
// DELETE /skills-editor/file
// ---------------------------------------------------------------------------

/**
 * Delete a single file inside a skill. Idempotent — rm -f swallows the
 * missing-file case, so double-deletes and races both return 200.
 */
router.delete(
  "/file",
  authenticateJWT, // BEFORE body parser — see /read for rationale
  express.json({ limit: "32kb" }),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Body validation.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawSkill = body.skill;
    const rawPath = body.path;

    if (
      typeof rawHostId !== "number" ||
      !Number.isInteger(rawHostId) ||
      rawHostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    if (!isValidSkillName(rawSkill)) {
      res.status(400).json({ error: "invalid skill name" });
      return;
    }
    if (!isSafeRelativePath(rawPath)) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    const hostId = rawHostId;
    const skill = rawSkill;
    const relPath = rawPath;

    // 2. Per-user host isolation.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("skills-editor delete-file: SSH connect failed", {
          operation: "skills_editor_delete_file_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn(
          "skills-editor delete-file: could not resolve remote HOME",
          {
            operation: "skills_editor_delete_file_home",
            hostId,
            remoteHome,
          },
        );
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      const paths = buildAbsSkillFilePath(remoteHome, skill, relPath);
      if (!paths) {
        res.status(400).json({ error: "path escape detected" });
        return;
      }
      const { absPath } = paths;
      const escapedPath = shellEscape(absPath);

      // rm -f is idempotent — missing target is not an error.
      await execWithTimeout(conn, `rm -f ${escapedPath}`);

      res.json({ ok: true });
    } catch (err) {
      sshLogger.error("skills-editor delete-file: unexpected error", {
        operation: "skills_editor_delete_file_error",
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
// DELETE /skills-editor/skill
// ---------------------------------------------------------------------------

/**
 * Delete an entire skill (folder + all contents).
 *
 * LIFE-CRITICAL: `rm -rf` on the composed skillRoot. The path-safety gate
 * MUST fire before the shell command runs. Two-layer defense:
 *   1. SKILL_NAME_RE regex rejects any name containing `/`, `..`, or shell
 *      metachars — so no user-supplied value can escape the composed root.
 *   2. Post-compose prefix assertion that skillRoot starts with
 *      `${remoteHome}/${SKILL_ROOT_REL}/`. Regex should make this
 *      unreachable, but assert anyway (defense in depth).
 *   3. shellEscape single-quote wraps the value one more time before
 *      interpolation into `rm -rf`.
 */
router.delete(
  "/skill",
  authenticateJWT, // BEFORE body parser — see /read for rationale (extra important on the rm -rf endpoint)
  express.json({ limit: "32kb" }),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Body validation — skill only.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawSkill = body.skill;

    if (
      typeof rawHostId !== "number" ||
      !Number.isInteger(rawHostId) ||
      rawHostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    if (!isValidSkillName(rawSkill)) {
      res.status(400).json({ error: "invalid skill name" });
      return;
    }
    const hostId = rawHostId;
    const skill = rawSkill;

    // 2. Per-user host isolation.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("skills-editor delete-skill: SSH connect failed", {
          operation: "skills_editor_delete_skill_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      const remoteHome = (
        await execWithTimeout(conn, "echo $HOME")
      ).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn(
          "skills-editor delete-skill: could not resolve remote HOME",
          {
            operation: "skills_editor_delete_skill_home",
            hostId,
            remoteHome,
          },
        );
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 3. Compose skillRoot + belt-and-suspenders prefix assertion.
      //    SKILL_NAME_RE should have made this unreachable, but the rm -rf
      //    is life-critical — assert the invariant regardless.
      const skillsPrefix = `${remoteHome}/${SKILL_ROOT_REL}/`;
      const skillRoot = `${skillsPrefix}${skill}`;
      if (!skillRoot.startsWith(skillsPrefix)) {
        res.status(400).json({ error: "path escape detected" });
        return;
      }

      const escapedSkillRoot = shellEscape(skillRoot);
      await execWithTimeout(conn, `rm -rf ${escapedSkillRoot}`);

      res.json({ ok: true });
    } catch (err) {
      sshLogger.error("skills-editor delete-skill: unexpected error", {
        operation: "skills_editor_delete_skill_error",
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

// Generic 500 fallback error handler — sanitizes upstream detail so we
// never leak stderr / remote paths / credential fragments in the response.
// Mirrors global-files-read-write.ts L503-518.
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    sshLogger.error("skills-editor: unhandled error", {
      operation: "skills_editor_error",
      error: err?.message,
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
