/**
 * /role-skills-editor Express router — role skills (`~/fleet/roles/<role>/skills/<name>/`).
 * Started in Phase 89.
 *
 * Byte-shape mirror of Phase 44's `skills-editor.ts` with three structural
 * adaptations:
 *   1. **Role dimension** replaces `hostId` alone: requests carry
 *      `(hostId, roleName, [skillName], [relativePath])`. Role skills live at
 *      `~/fleet/roles/<roleName>/skills/<skillName>/...` on the remote host.
 *   2. **Role validation 404**: before any skill I/O, the backend checks that
 *      `~/fleet/roles/<roleName>/` exists on the host and returns 404
 *      `{error:"role not found"}` if not (D-15). Missing role skills folder within
 *      a valid role is empty-list-not-404 (mirrors skills' "missing = empty state"
 *      posture — same as skills-editor.ts L294-302).
 *   3. **Path-safety gate widens**: adds `ROLE_NAME_RE` regex gate (identical
 *      shape to `SKILL_NAME_RE`) alongside `SKILL_NAME_RE` +
 *      `isSafeRelativePath`. Per D-16 no path traversal via `roleName` or
 *      `skillName` — both regex-gated BEFORE any SSH connection opens.
 *
 * Endpoints (all gated by authenticateJWT + resolveHostById(hostId, userId)):
 *   GET  /role-skills-editor/skills?hostId=<n>&role=<r>
 *     → 200 { skills: [{name}] } sorted alphabetically; empty array when
 *       `~/fleet/roles/<r>/skills/` is missing OR empty (matches skills'
 *       "missing = empty state" posture per skills-editor.ts L294-302); 404
 *       `{error:"role not found"}` when `~/fleet/roles/<r>/` itself is absent
 *       (per D-15).
 *   GET  /role-skills-editor/files?hostId=<n>&role=<r>&skill=<b>
 *     → 200 { files: [{path}] } — recursive `find <skillRoot> -type f
 *       -printf '%P\n' | sort`; empty when the skill folder has no files.
 *   POST /role-skills-editor/read      { hostId, role, skill, path }
 *     → 200 { content, mtime, size, isText } — content is "" when !isText.
 *   PUT  /role-skills-editor/write     { hostId, role, skill, path, content, expectedMtime? }
 *     → 200 { mtime } | 409 { error:"mtime mismatch", currentMtime, currentContent }
 *       (byte-identical 409 shape to skills-editor).
 *   POST /role-skills-editor/create    { hostId, role, skill, path }
 *     → 200 { path, mtime } | 409 { error:"file exists" }.
 *   DELETE /role-skills-editor/file    { hostId, role, skill, path }
 *     → 200 { ok:true } (idempotent — `rm -f` swallows missing files).
 *   POST /role-skills-editor/skill   { hostId, role, skill, description }
 *     → 200 { slug, mtime } — creates the role skill with a standard SKILL.md
 *       seed | 409 { error:"skill exists" }.
 *   POST /role-skills-editor/rename  { hostId, role, skill, newName, … }
 *     → 200 { name } (see the route for the draft-save fields).
 *   DELETE /role-skills-editor/skill { hostId, role, skill }
 *     → 200 { ok:true } (removes the skill folder recursively — path-safety
 *       gate is LIFE-CRITICAL; two-layer defense assertion runs before shell exec).
 *
 * Security posture (STRIDE mitigations — see 89-02-PLAN.md <threat_model>):
 *   - `ROLE_NAME_RE` `/^[a-zA-Z0-9._-]{1,128}$/` rejects `.`, `..`, `/`, and
 *     every shell metacharacter at input validation — BEFORE resolveHostById +
 *     SSH connect. `SKILL_NAME_RE` (identical shape) gates the skill name
 *     dimension. `isSafeRelativePath` rejects `..` segments, leading `/`, NUL
 *     bytes, empty segments, and paths over 512 chars — ALL three gates fire
 *     BEFORE any SSH connection is opened.
 *   - Belt-and-suspenders `absPath.startsWith(skillRoot + "/")` prefix
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
 * Mount: app.use("/role-skills-editor", roleSkillsEditorRoutes) in database.ts
 * alongside /skills-editor. Nginx: BOTH docker/nginx.conf AND
 * docker/nginx-https.conf need `location ~ ^/role-skills-editor(/.*)?$` blocks
 * (parity load-bearing per patch #446 arc).
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import { guardInstanceWideRoleWrite } from "../../instance-wide/role-guard.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { writeMarkdownFileAtomic } from "../../claude-session/identity-artifact-reader.js";
import { parseSkillListOutput } from "./skills-editor.js";
import { sshLogger } from "../../utils/logger.js";
import { sendRemoteFileUnderRoot, writeRemoteFileUnderRoot } from "../../utils/sftp-root-files.js";
import {
  frontmatterName,
  nameMismatchBody,
  nameMismatchesFolder,
  refuseIfNameMismatch,
  withFrontmatterName,
  composeSkillMdSeed,
} from "../../utils/folder-item-name.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches Phase 23 / Phase 44 (skills-editor.ts L80). */
const SSH_CONNECT_TIMEOUT_MS = 5000;

/** PUT /write-binary body cap (annotated PDFs etc.); nginx allows 50m here. */
const MAX_BINARY_WRITE_BYTES = "50mb";

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
 * Role skill-name gate: alphanumeric, hyphen, underscore, dot; 1-128 chars.
 * Rejects `.`, `..`, empty, anything with a `/`, backslash, shell metachars,
 * spaces. Runs BEFORE resolveHostById + SSH connect on every endpoint.
 * Identical shape to SKILL_NAME_RE in skills-editor.ts:103.
 */
const SKILL_NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/;

/**
 * Relative path root for roles on the remote host.
 * Role skill root is composed as `${remoteHome}/${ROLE_ROOT_REL}/${role}/skills/${skill}`.
 * Mirrors SKILL_ROOT_REL = ".claude/skills" in skills-editor.ts:109.
 * Updated Phase 96 (D-01/D-02): roles now live under ~/fleet/roles/ on the managed host.
 */
const ROLE_ROOT_REL = "fleet/roles";

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
 * bash commands. The regex gates (isValidRoleName + isValidSkillName +
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
 * Role skill-name AUTH gate. Rejects any value that could escape the skill root
 * (via `..`) or inject shell metachars. Returns true only for a SKILL_NAME_RE
 * match that is not `.` or `..`. Runs BEFORE any I/O.
 */
function isValidSkillName(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v === "." || v === "..") return false;
  return SKILL_NAME_RE.test(v);
}

/**
 * A remote file's text ("" when missing). base64 round-trip: execCommand trims
 * stdout, which would eat a trailing newline.
 */
async function readRemoteText(
  conn: Awaited<ReturnType<typeof connectOneShot>>,
  absPath: string,
): Promise<string> {
  return Buffer.from(
    await execWithTimeout(conn, `base64 -w0 ${shellEscape(absPath)} 2>/dev/null || true`),
    "base64",
  ).toString("utf-8");
}

/** True for a role skill's main file. */
function isMainSkillFile(relPath: unknown): boolean {
  return relPath === "SKILL.md";
}

/**
 * Relative-path AUTH gate. Rejects:
 *   - non-strings
 *   - empty strings
 *   - > MAX_PATH_LENGTH chars
 *   - leading `/` (absolute paths)
 *   - NUL byte
 *   - any `..`, `.`, or empty segment when split by `/`
 * Runs BEFORE any I/O. Complements ROLE_NAME_RE + SKILL_NAME_RE gates on the
 * role/skill dimensions. Together they make the belt-and-suspenders prefix
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
    if (decoded.includes("�")) return false;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// GET /role-skills-editor/skills?hostId=<n>&role=<r>
// ---------------------------------------------------------------------------

/**
 * List role skills for a role on the host — `find ~/fleet/roles/<r>/role skills
 * -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort`. Returns empty array
 * when the role skills directory is missing (not 404 — mirrors skills' "missing =
 * empty state"). Returns 404 `{error:"role not found"}` when the role folder
 * itself is absent (D-15 — separate exec to avoid masking role-missing as empty).
 */
router.get(
  "/skills",
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
        sshLogger.warn("role-skills-editor skills: SSH connect failed", {
          operation: "role_skills_editor_skills_connect",
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
        sshLogger.warn("role-skills-editor skills: could not resolve remote HOME", {
          operation: "role_skills_editor_skills_home",
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
      //    masked as "no role skills" by the find command's 2>/dev/null stderr swallow.
      sshLogger.info("role-skills-editor skills: checking role existence", {
        operation: "role_skills_editor_skills_role_check",
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
        sshLogger.warn("role-skills-editor skills: role not found", {
          operation: "role_skills_editor_skills_role_missing",
          hostId,
          role,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 8. Compose skillsRoot.
      const skillsRoot = `${roleRoot}/skills`;
      const escapedSkillsRoot = shellEscape(skillsRoot);

      // 9. List skill subfolders. 2>/dev/null swallows the missing-skills-folder
      //    case → empty output → empty list (matches skills' "missing = empty state").
      sshLogger.info("role-skills-editor skills: listing role skills", {
        operation: "role_skills_editor_skills_find",
        hostId,
        role,
      });
      // Same record shape as the regular skills list (\x1e + name, then the
      // SKILL.md frontmatter) so each role skill comes back with its
      // one-line description, read the same way.
      const listCmd =
        `find ${escapedSkillsRoot} -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | ` +
        `while read -r dir; do ` +
        `  fm=$(awk '{sub(/\\r$/, "")} /^---$/{n++; if(n==2) exit} n==1' "$dir/SKILL.md" 2>/dev/null); ` +
        `  printf '\\036%s\\n%s\\n' "$(basename "$dir")" "$fm"; ` +
        `done`;
      const output = await execWithTimeout(conn, listCmd);

      // 10. Parse: name + description (no invocation flags — role skills
      //     aren't run by name).
      const skills = parseSkillListOutput(output).map((s) => ({
        name: s.name,
        ...(s.description === undefined ? {} : { description: s.description }),
      }));
      sshLogger.info("role-skills-editor skills: listed", {
        operation: "role_skills_editor_skills_listed",
        hostId,
        role,
        count: skills.length,
        withDescription: skills.filter((x) => "description" in x).length,
      });

      res.json({ skills });
    } catch (err) {
      sshLogger.error("role-skills-editor skills: unexpected error", {
        operation: "role_skills_editor_skills_error",
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
// GET /role-skills-editor/files?hostId=<n>&role=<r>&skill=<b>
// ---------------------------------------------------------------------------

/**
 * List files inside a skill (recursively, path-relative to the skill root).
 * `find <skillRoot> -type f -printf '%P\n' | sort`. Returns empty array when
 * the skill has no files (or does not exist — "missing = empty state" posture,
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

    // 3. Role skill AUTH gate — BEFORE any I/O.
    const rawSkill = req.query.skill;
    if (!isValidSkillName(rawSkill)) {
      res.status(400).json({ error: "invalid skill name" });
      return;
    }
    const skill = rawSkill;

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
        sshLogger.warn("role-skills-editor files: SSH connect failed", {
          operation: "role_skills_editor_files_connect",
          hostId,
          role,
          skill,
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
        sshLogger.warn("role-skills-editor files: could not resolve remote HOME", {
          operation: "role_skills_editor_files_home",
          hostId,
          role,
          skill,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 7. D-15 role-existence check.
      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const escapedRoleRoot = shellEscape(roleRoot);
      sshLogger.info("role-skills-editor files: checking role existence", {
        operation: "role_skills_editor_files_role_check",
        hostId,
        role,
        skill,
      });
      const roleCheckOutput = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRoleRoot} && echo ok || echo missing`,
        )
      ).trim();
      if (roleCheckOutput !== "ok") {
        sshLogger.warn("role-skills-editor files: role not found", {
          operation: "role_skills_editor_files_role_missing",
          hostId,
          role,
          skill,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 8. Compose skillRoot.
      const skillRoot = `${roleRoot}/skills/${skill}`;
      const escapedSkillRoot = shellEscape(skillRoot);

      // 9. List files recursively. 2>/dev/null swallows missing skill folder.
      sshLogger.info("role-skills-editor files: listing files", {
        operation: "role_skills_editor_files_find",
        hostId,
        role,
        skill,
      });
      const listCmd = `find ${escapedSkillRoot} -type f -printf '%P\\n' 2>/dev/null | sort`;
      const output = await execWithTimeout(conn, listCmd);

      // 10. Parse, filter, map.
      const files = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((path) => ({ path }));

      res.json({ files });
    } catch (err) {
      sshLogger.error("role-skills-editor files: unexpected error", {
        operation: "role_skills_editor_files_error",
        hostId,
        role,
        skill,
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
// POST /role-skills-editor/read
// ---------------------------------------------------------------------------

/**
 * Read a file inside a skill. Returns { content, mtime, size, isText };
 * content is "" when !isText (frontend renders the "Not a text file"
 * placeholder branch — bandwidth-saving decision). Missing file →
 * { content:"", mtime:0, size:0, isText:true } (cat + stat swallow errors).
 * Returns 404 `{error:"role not found"}` when the role folder is absent (D-15).
 */
router.post(
  "/read",
  authenticateJWT,
  express.json({ limit: "32kb" }), // hostId + role + skill + path only
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Body validation — 400 BEFORE any I/O.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawRole = body.role;
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
    if (!isValidRoleName(rawRole)) {
      res.status(400).json({ error: "invalid role name" });
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
    const role = rawRole;
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
      // 3. SSH connect.
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("role-skills-editor read: SSH connect failed", {
          operation: "role_skills_editor_read_connect",
          hostId,
          role,
          skill,
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
        sshLogger.warn("role-skills-editor read: could not resolve remote HOME", {
          operation: "role_skills_editor_read_home",
          hostId,
          role,
          skill,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 5. D-15 role-existence check.
      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const escapedRoleRoot = shellEscape(roleRoot);
      sshLogger.info("role-skills-editor read: checking role existence", {
        operation: "role_skills_editor_read_role_check",
        hostId,
        role,
        skill,
      });
      const roleCheckOutput = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRoleRoot} && echo ok || echo missing`,
        )
      ).trim();
      if (roleCheckOutput !== "ok") {
        sshLogger.warn("role-skills-editor read: role not found", {
          operation: "role_skills_editor_read_role_missing",
          hostId,
          role,
          skill,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 6. Compose skillRoot + absolute file path.
      const skillRoot = `${roleRoot}/skills/${skill}`;
      const absPath = `${skillRoot}/${relPath}`;

      // 7. Belt-and-suspenders prefix assertion — regex gates make this
      //    unreachable but assert anyway (defense in depth).
      if (!absPath.startsWith(skillRoot + "/")) {
        sshLogger.error("role-skills-editor read: path escapes skill root (impossible-per-regex-gate case)", {
          operation: "role_skills_editor_read_escape_detected",
          hostId,
          role,
          skill,
        });
        res.status(400).json({ error: "path escapes skill root" });
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
      sshLogger.error("role-skills-editor read: unexpected error", {
        operation: "role_skills_editor_read_error",
        hostId,
        role,
        skill,
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
// PUT /role-skills-editor/write
// ---------------------------------------------------------------------------

/**
 * Save a file inside a skill with optimistic-concurrency mtime check.
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
    if (!isValidRoleName(rawRole)) {
      res.status(400).json({ error: "invalid role name" });
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
    if (!(await guardInstanceWideRoleWrite(res, userId, hostId, role))) return;
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
      // 3. SSH connect.
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("role-skills-editor write: SSH connect failed", {
          operation: "role_skills_editor_write_connect",
          hostId,
          role,
          skill,
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
        sshLogger.warn("role-skills-editor write: could not resolve remote HOME", {
          operation: "role_skills_editor_write_home",
          hostId,
          role,
          skill,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 5. D-15 role-existence check.
      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const escapedRoleRoot = shellEscape(roleRoot);
      sshLogger.info("role-skills-editor write: checking role existence", {
        operation: "role_skills_editor_write_role_check",
        hostId,
        role,
        skill,
      });
      const roleCheckOutput = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRoleRoot} && echo ok || echo missing`,
        )
      ).trim();
      if (roleCheckOutput !== "ok") {
        sshLogger.warn("role-skills-editor write: role not found", {
          operation: "role_skills_editor_write_role_missing",
          hostId,
          role,
          skill,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 6. Compose skillRoot + absolute file path + belt-and-suspenders assertion.
      const skillRoot = `${roleRoot}/skills/${skill}`;
      const absPath = `${skillRoot}/${relPath}`;
      if (!absPath.startsWith(skillRoot + "/")) {
        sshLogger.error("role-skills-editor write: path escapes skill root (impossible-per-regex-gate case)", {
          operation: "role_skills_editor_write_escape_detected",
          hostId,
          role,
          skill,
        });
        res.status(400).json({ error: "path escapes skill root" });
        return;
      }
      const escapedPath = shellEscape(absPath);

      // A role skill's SKILL.md can't newly name a different role skill in its
      // frontmatter — renaming
      // goes through POST /rename.
      if (isMainSkillFile(relPath)) {
        const c = conn;
        if (await refuseIfNameMismatch(res, "skill", skill, content, () => readRemoteText(c, absPath))) {
          return;
        }
      }

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
        sshLogger.error("role-skills-editor write: SFTP write failed", {
          operation: "role_skills_editor_write_sftp",
          hostId,
          role,
          skill,
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
      sshLogger.error("role-skills-editor write: unexpected error", {
        operation: "role_skills_editor_write_error",
        hostId,
        role,
        skill,
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
// POST /role-skills-editor/create
// ---------------------------------------------------------------------------

/**
 * Create a new empty file inside a skill. Rejects duplicates with 409.
 * Subpaths honored — mkdir -p on the parent dir before touch, so
 * `prompts/main.md` creates the `prompts/` dir if needed.
 * Returns 404 `{error:"role not found"}` when the role folder is absent (D-15).
 * Returns 404 `{error:"skill not found"}` when the skill folder is absent.
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
    if (!isValidRoleName(rawRole)) {
      res.status(400).json({ error: "invalid role name" });
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
    const role = rawRole;
    if (!(await guardInstanceWideRoleWrite(res, userId, hostId, role))) return;
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
      // 3. SSH connect.
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("role-skills-editor create: SSH connect failed", {
          operation: "role_skills_editor_create_connect",
          hostId,
          role,
          skill,
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
        sshLogger.warn("role-skills-editor create: could not resolve remote HOME", {
          operation: "role_skills_editor_create_home",
          hostId,
          role,
          skill,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 5. D-15 role-existence check.
      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const escapedRoleRoot = shellEscape(roleRoot);
      sshLogger.info("role-skills-editor create: checking role existence", {
        operation: "role_skills_editor_create_role_check",
        hostId,
        role,
        skill,
      });
      const roleCheckOutput = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRoleRoot} && echo ok || echo missing`,
        )
      ).trim();
      if (roleCheckOutput !== "ok") {
        sshLogger.warn("role-skills-editor create: role not found", {
          operation: "role_skills_editor_create_role_missing",
          hostId,
          role,
          skill,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 6. Compose skillRoot + absolute file path.
      const skillRoot = `${roleRoot}/skills/${skill}`;
      const escapedSkillRoot = shellEscape(skillRoot);
      const absPath = `${skillRoot}/${relPath}`;
      const escapedPath = shellEscape(absPath);

      // 7. Role skill-existence gate — Creating a brand-new skill from scratch is
      //    out of scope. Without this guard, mkdir -p would silently create the
      //    skill folder, violating the scope contract.
      sshLogger.info("role-skills-editor create: checking skill existence", {
        operation: "role_skills_editor_create_skill_check",
        hostId,
        role,
        skill,
      });
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

      // 9. Ensure parent dir exists inside the skill (mkdir -p is idempotent).
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
      sshLogger.error("role-skills-editor create: unexpected error", {
        operation: "role_skills_editor_create_error",
        hostId,
        role,
        skill,
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
// POST /role-skills-editor/skill
// ---------------------------------------------------------------------------

/**
 * Create a role skill: `{ hostId, role, skill, description }` → 200
 * `{ slug, mtime }`. Writes `~/fleet/roles/<role>/skills/<skill>/SKILL.md`
 * seeded in the standard shape (name + description frontmatter, a heading) —
 * the same seed and the same description rules as POST /skills-editor/skill.
 * 404 when the role is missing, 409 `{error:"skill exists"}` when the name is
 * taken.
 */
router.post(
  "/skill",
  authenticateJWT, // BEFORE body parser
  express.json({ limit: "32kb" }),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawRole = body.role;
    const rawSkill = body.skill;
    const rawDescription = body.description;

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
    if (!isValidSkillName(rawSkill)) {
      res.status(400).json({ error: "invalid skill name" });
      return;
    }
    if (typeof rawDescription !== "string") {
      res.status(400).json({ error: "description must be a string" });
      return;
    }
    const description = rawDescription.trim();
    if (description.length === 0) {
      res.status(400).json({ error: "description is required" });
      return;
    }
    if (Buffer.byteLength(description, "utf-8") > 4096) {
      res.status(400).json({ error: "description must be ≤4096 bytes" });
      return;
    }
    if (description.includes("\n") || description.includes("\r")) {
      res.status(400).json({ error: "description must be single-line" });
      return;
    }
    const hostId = rawHostId;
    const role = rawRole;
    const skill = rawSkill;
    if (!(await guardInstanceWideRoleWrite(res, userId, hostId, role))) return;

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
        sshLogger.warn("role-skills-editor create-skill: SSH connect failed", {
          operation: "role_skills_editor_create_skill_connect",
          hostId,
          role,
          skill,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn("role-skills-editor create-skill: could not resolve remote HOME", {
          operation: "role_skills_editor_create_skill_home",
          hostId,
          role,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const roleCheck = (
        await execWithTimeout(conn, `test -d ${shellEscape(roleRoot)} && echo ok || echo missing`)
      ).trim();
      if (roleCheck !== "ok") {
        res.status(404).json({ error: "role not found" });
        return;
      }

      const skillsPrefix = `${roleRoot}/skills/`;
      const skillRoot = `${skillsPrefix}${skill}`;
      if (!skillRoot.startsWith(skillsPrefix) || skillRoot.includes("..")) {
        res.status(400).json({ error: "path escape detected" });
        return;
      }
      const escapedSkillRoot = shellEscape(skillRoot);

      // Taken name — a folder, or anything else already sitting there.
      const made = (
        await execWithTimeout(
          conn,
          `if [ -e ${escapedSkillRoot} ] || [ -L ${escapedSkillRoot} ]; then echo exists; ` +
            `else mkdir -p ${shellEscape(`${roleRoot}/skills`)} && mkdir ${escapedSkillRoot} && echo ok; fi`,
        )
      ).trim();
      if (made === "exists") {
        res.status(409).json({ error: "skill exists" });
        return;
      }
      if (made !== "ok") {
        sshLogger.error("role-skills-editor create-skill: mkdir failed", {
          operation: "role_skills_editor_create_skill_mkdir",
          hostId,
          role,
          skill,
          output: made.slice(0, 200),
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      const skillMdPath = `${skillRoot}/SKILL.md`;
      try {
        await writeMarkdownFileAtomic(conn, skillMdPath, composeSkillMdSeed(skill, description));
      } catch (err) {
        try {
          await execWithTimeout(conn, `rm -rf ${escapedSkillRoot}`);
        } catch {
          /* best-effort cleanup */
        }
        sshLogger.error("role-skills-editor create-skill: SFTP write failed", {
          operation: "role_skills_editor_create_skill_sftp",
          hostId,
          role,
          skill,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      const mtime =
        parseInt(
          (await execWithTimeout(conn, `stat -c '%Y' ${shellEscape(skillMdPath)} 2>/dev/null || echo 0`)).trim(),
          10,
        ) || 0;

      sshLogger.info("role-skills-editor create-skill: created", {
        operation: "role_skills_editor_skill_created",
        hostId,
        role,
        skill,
      });
      res.json({ slug: skill, mtime });
    } catch (err) {
      sshLogger.error("role-skills-editor create-skill: unexpected error", {
        operation: "role_skills_editor_create_skill_error",
        hostId,
        role,
        skill,
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
// POST /role-skills-editor/rename
// ---------------------------------------------------------------------------

/**
 * Rename a role skill: `{ hostId, role, skill, newName }` → 200 `{ name }`.
 * Moves the role skill folder, retargets any forwarding links its skill
 * conversion left behind, and rewrites the `name:` in SKILL.md to match.
 *
 * Optional `path` + `content` + `expectedMtime`: the editor's draft of a
 * main file, saved into the renamed skill in the same request (its `name:`
 * forced to the new name). `expectedMtime` is checked BEFORE anything moves —
 * 409 `mtime mismatch` like PUT /write. The response's `path` is where that
 * file now lives. Folder moved but draft not written: 502 `{ renamed: true }`.
 *
 * 404 when the role or skill is missing, 409 `{error:"skill exists"}`
 * when the new name is taken.
 */
router.post(
  "/rename",
  authenticateJWT, // BEFORE body parser
  express.json({ limit: "32kb" }),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawRole = body.role;
    const rawSkill = body.skill;
    const rawNewName = body.newName;
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
    if (!isValidSkillName(rawSkill)) {
      res.status(400).json({ error: "invalid skill name" });
      return;
    }
    if (!isValidSkillName(rawNewName)) {
      res.status(400).json({ error: "invalid new skill name" });
      return;
    }
    if (rawContent !== undefined || rawPath !== undefined || rawExpectedMtime !== undefined) {
      if (typeof rawPath !== "string" || !isMainSkillFile(rawPath)) {
        res.status(400).json({ error: "path must name the role skill's main file" });
        return;
      }
      if (typeof rawContent !== "string" || Buffer.byteLength(rawContent, "utf-8") > MAX_CONTENT_BYTES) {
        res.status(400).json({ error: `content must be a string ≤${MAX_CONTENT_BYTES} bytes` });
        return;
      }
      if (
        rawExpectedMtime !== undefined &&
        (typeof rawExpectedMtime !== "number" || !Number.isInteger(rawExpectedMtime) || rawExpectedMtime < 0)
      ) {
        res.status(400).json({ error: "expectedMtime must be a non-negative integer when provided" });
        return;
      }
    }
    const draft =
      typeof rawContent === "string" && typeof rawPath === "string"
        ? { path: rawPath, content: rawContent, expectedMtime: rawExpectedMtime as number | undefined }
        : null;
    const hostId = rawHostId;
    const role = rawRole;
    const skill = rawSkill;
    const newName = rawNewName;
    if (newName === skill) {
      res.status(400).json({ error: "new name is the same as the current name" });
      return;
    }
    if (!(await guardInstanceWideRoleWrite(res, userId, hostId, role))) return;

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
        sshLogger.warn("role-skills-editor rename: SSH connect failed", {
          operation: "role_skills_editor_rename_connect",
          hostId,
          role,
          skill,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn("role-skills-editor rename: could not resolve remote HOME", {
          operation: "role_skills_editor_rename_home",
          hostId,
          role,
          skill,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const roleCheck = (
        await execWithTimeout(conn, `test -d ${shellEscape(roleRoot)} && echo ok || echo missing`)
      ).trim();
      if (roleCheck !== "ok") {
        res.status(404).json({ error: "role not found" });
        return;
      }

      const skillsPrefix = `${roleRoot}/skills/`;
      const fromRoot = `${skillsPrefix}${skill}`;
      const toRoot = `${skillsPrefix}${newName}`;
      if (fromRoot.includes("..") || toRoot.includes("..")) {
        res.status(400).json({ error: "path escape detected" });
        return;
      }

      // Stale-draft check before anything moves (same 409 as PUT /write).
      if (draft && draft.expectedMtime !== undefined) {
        const draftAbs = `${fromRoot}/${draft.path}`;
        const currentMtime =
          parseInt(
            (await execWithTimeout(conn, `stat -c '%Y' ${shellEscape(draftAbs)} 2>/dev/null || echo 0`)).trim(),
            10,
          ) || 0;
        if (currentMtime !== draft.expectedMtime) {
          res.status(409).json({
            error: "mtime mismatch",
            currentMtime,
            currentContent: await readRemoteText(conn, draftAbs),
          });
          return;
        }
      }

      // One remote step: refuse a missing source or a taken target, else move.
      // `mv -T` keeps a same-named target directory from swallowing the source.
      const moved = (
        await execWithTimeout(
          conn,
          `if [ ! -d ${shellEscape(fromRoot)} ]; then echo missing; ` +
            `elif [ -e ${shellEscape(toRoot)} ]; then echo exists; ` +
            `else mv -T ${shellEscape(fromRoot)} ${shellEscape(toRoot)} && echo ok; fi`,
        )
      ).trim();
      if (moved === "missing") {
        res.status(404).json({ error: "skill not found" });
        return;
      }
      if (moved === "exists") {
        res.status(409).json({ error: "skill exists" });
        return;
      }
      if (moved !== "ok") {
        sshLogger.error("role-skills-editor rename: mv failed", {
          operation: "role_skills_editor_rename_mv",
          hostId,
          role,
          skill,
          newName,
          output: moved.slice(0, 200),
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // A role skill converted from a runbook left forwarding links in the
      // role's runbooks/ folder (runbooks/<old> → ../skills/<name>, and a
      // loose runbooks/<old>.md → ../skills/<name>/SKILL.md) — possibly from
      // an earlier name. Point every link aimed at this role skill at its new
      // name so old paths keep resolving. Links aimed elsewhere are left.
      const runbooksDir = `${roleRoot}/runbooks`;
      const forwardersMoved = (
        await execWithTimeout(
          conn,
          `n=0; for l in ${shellEscape(runbooksDir)}/* ${shellEscape(runbooksDir)}/.[!.]*; do ` +
            `[ -L "$l" ] || continue; t=$(readlink "$l"); ` +
            `if [ "$t" = ${shellEscape(`../skills/${skill}`)} ]; then ln -sfn ${shellEscape(`../skills/${newName}`)} "$l" && n=$((n+1)); ` +
            `elif [ "$t" = ${shellEscape(`../skills/${skill}/SKILL.md`)} ]; then ln -sfn ${shellEscape(`../skills/${newName}/SKILL.md`)} "$l" && n=$((n+1)); fi; ` +
            `done; echo $n`,
        )
      ).trim();

      // Keep `name:` in step in the main file — from the draft when one came
      // along, else from disk.
      let nameRewritten = 0;
      for (const rel of ["SKILL.md"]) {
        const abs = `${toRoot}/${rel}`;
        const isDraft = draft !== null && draft.path === rel;
        try {
          const current = isDraft ? draft!.content : await readRemoteText(conn, abs);
          const rewritten = withFrontmatterName(current, newName);
          if (isDraft || rewritten !== current) {
            await writeMarkdownFileAtomic(conn, abs, rewritten);
            nameRewritten++;
          }
        } catch (err) {
          // The folder already moved; a stale `name:` is recoverable by hand.
          sshLogger.error("role-skills-editor rename: main-file write failed", {
            operation: "role_skills_editor_rename_name_write",
            hostId,
            role,
            skill,
            newName,
            file: rel,
            withDraft: isDraft,
            error: err instanceof Error ? err.message : "Unknown",
          });
          if (isDraft) {
            res.status(502).json({ error: "renamed, but the edits couldn't be saved", renamed: true, name: newName });
            return;
          }
        }
      }

      sshLogger.info("role-skills-editor rename: renamed", {
        operation: "role_skills_editor_renamed",
        hostId,
        role,
        skill,
        newName,
        forwardersMoved: parseInt(forwardersMoved, 10) || 0,
        nameRewritten,
        withDraft: draft !== null,
      });
      res.json(draft ? { name: newName, path: draft.path } : { name: newName });
    } catch (err) {
      sshLogger.error("role-skills-editor rename: unexpected error", {
        operation: "role_skills_editor_rename_error",
        hostId,
        role,
        skill,
        newName,
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
// DELETE /role-skills-editor/file
// ---------------------------------------------------------------------------

/**
 * Delete a single file inside a skill. Idempotent — rm -f swallows the
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
    if (!isValidRoleName(rawRole)) {
      res.status(400).json({ error: "invalid role name" });
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
    const role = rawRole;
    if (!(await guardInstanceWideRoleWrite(res, userId, hostId, role))) return;
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
      // 3. SSH connect.
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("role-skills-editor delete-file: SSH connect failed", {
          operation: "role_skills_editor_delete_file_connect",
          hostId,
          role,
          skill,
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
          "role-skills-editor delete-file: could not resolve remote HOME",
          {
            operation: "role_skills_editor_delete_file_home",
            hostId,
            role,
            skill,
            remoteHome,
          },
        );
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 5. D-15 role-existence check.
      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const escapedRoleRoot = shellEscape(roleRoot);
      sshLogger.info("role-skills-editor delete-file: checking role existence", {
        operation: "role_skills_editor_delete_file_role_check",
        hostId,
        role,
        skill,
      });
      const roleCheckOutput = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRoleRoot} && echo ok || echo missing`,
        )
      ).trim();
      if (roleCheckOutput !== "ok") {
        sshLogger.warn("role-skills-editor delete-file: role not found", {
          operation: "role_skills_editor_delete_file_role_missing",
          hostId,
          role,
          skill,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 6. Compose skillRoot + absolute file path + belt-and-suspenders assertion.
      const skillRoot = `${roleRoot}/skills/${skill}`;
      const absPath = `${skillRoot}/${relPath}`;
      if (!absPath.startsWith(skillRoot + "/")) {
        sshLogger.error("role-skills-editor delete-file: path escapes skill root (impossible-per-regex-gate case)", {
          operation: "role_skills_editor_delete_file_escape_detected",
          hostId,
          role,
          skill,
        });
        res.status(400).json({ error: "path escapes skill root" });
        return;
      }
      const escapedPath = shellEscape(absPath);

      // 7. rm -f is idempotent — missing target is not an error.
      await execWithTimeout(conn, `rm -f ${escapedPath}`);

      res.json({ ok: true });
    } catch (err) {
      sshLogger.error("role-skills-editor delete-file: unexpected error", {
        operation: "role_skills_editor_delete_file_error",
        hostId,
        role,
        skill,
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
// DELETE /role-skills-editor/skill
// ---------------------------------------------------------------------------

/**
 * Delete an entire skill (folder + all contents).
 *
 * LIFE-CRITICAL: recursive folder deletion on the composed skillRoot. The
 * path-safety gate MUST fire before the shell command runs. Three-layer defense:
 *   1. ROLE_NAME_RE + SKILL_NAME_RE regex gates reject any name containing
 *      `/`, `..`, or shell metachars — so no user-supplied value can escape
 *      the composed root.
 *   2. Post-compose belt-and-suspenders assertions:
 *      - skillRoot MUST contain `/skills/`
 *      - skillRoot MUST end with `/${skill}`
 *      - skillRoot MUST NOT contain `..`
 *   3. shellEscape single-quote wraps the value one more time before
 *      interpolation into the shell delete command.
 * Returns 404 `{error:"role not found"}` when the role folder is absent (D-15).
 */
router.delete(
  "/skill",
  authenticateJWT, // BEFORE body parser — extra important on the recursive-delete endpoint
  express.json({ limit: "32kb" }),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Body validation — role + skill only; no path field.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawRole = body.role;
    const rawSkill = body.skill;

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
    if (!isValidSkillName(rawSkill)) {
      res.status(400).json({ error: "invalid skill name" });
      return;
    }
    const hostId = rawHostId;
    const role = rawRole;
    if (!(await guardInstanceWideRoleWrite(res, userId, hostId, role))) return;
    const skill = rawSkill;

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
        sshLogger.warn("role-skills-editor delete-skill: SSH connect failed", {
          operation: "role_skills_editor_delete_skill_connect",
          hostId,
          role,
          skill,
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
          "role-skills-editor delete-skill: could not resolve remote HOME",
          {
            operation: "role_skills_editor_delete_skill_home",
            hostId,
            role,
            skill,
            remoteHome,
          },
        );
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 5. D-15 role-existence check.
      const roleRoot = `${remoteHome}/${ROLE_ROOT_REL}/${role}`;
      const escapedRoleRoot = shellEscape(roleRoot);
      sshLogger.info("role-skills-editor delete-skill: checking role existence", {
        operation: "role_skills_editor_delete_skill_role_check",
        hostId,
        role,
        skill,
      });
      const roleCheckOutput = (
        await execWithTimeout(
          conn,
          `test -d ${escapedRoleRoot} && echo ok || echo missing`,
        )
      ).trim();
      if (roleCheckOutput !== "ok") {
        sshLogger.warn("role-skills-editor delete-skill: role not found", {
          operation: "role_skills_editor_delete_skill_role_missing",
          hostId,
          role,
          skill,
        });
        res.status(404).json({ error: "role not found" });
        return;
      }

      // 6. Compose skillRoot + LIFE-CRITICAL belt-and-suspenders assertions.
      //    ROLE_NAME_RE + SKILL_NAME_RE should have made these unreachable,
      //    but the recursive folder delete is life-critical — assert the invariants regardless.
      const skillRoot = `${roleRoot}/skills/${skill}`;
      if (!skillRoot.includes("/skills/")) {
        sshLogger.error(
          "role-skills-editor delete-skill: skillRoot missing /skills/ segment (impossible-per-regex-gate case)",
          { operation: "role_skills_editor_delete_skill_assertion_failed", hostId, role, skill },
        );
        res.status(500).json({ error: "internal" });
        return;
      }
      if (!skillRoot.endsWith(`/${skill}`)) {
        sshLogger.error(
          "role-skills-editor delete-skill: skillRoot does not end with skill name (impossible-per-regex-gate case)",
          { operation: "role_skills_editor_delete_skill_assertion_failed", hostId, role, skill },
        );
        res.status(500).json({ error: "internal" });
        return;
      }
      if (skillRoot.includes("..")) {
        sshLogger.error(
          "role-skills-editor delete-skill: skillRoot contains '..' (impossible-per-regex-gate case)",
          { operation: "role_skills_editor_delete_skill_assertion_failed", hostId, role, skill },
        );
        res.status(500).json({ error: "internal" });
        return;
      }

      const escapedSkillRoot = shellEscape(skillRoot);
      await execWithTimeout(conn, `rm -rf ${escapedSkillRoot}`);

      res.json({ ok: true });
    } catch (err) {
      sshLogger.error("role-skills-editor delete-skill: unexpected error", {
        operation: "role_skills_editor_delete_skill_error",
        hostId,
        role,
        skill,
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
// GET /role-skills-editor/download?hostId=&role=&skill=&path=[&inline=1]
// ---------------------------------------------------------------------------

/**
 * Stream a file inside a skill: a download, or with `inline=1` an
 * in-page source for viewers (media, PDF, text; html / js / svg stay
 * downloads). Range requests are honoured. The resolved file must stay
 * inside the resolved skill directory (sendRemoteFileUnderRoot).
 */
router.get(
  "/download",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;
    const q = req.query as Record<string, unknown>;
    const hostId = typeof q.hostId === "string" ? Number(q.hostId) : NaN;
    if (!Number.isInteger(hostId) || hostId <= 0) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    if (!isValidRoleName(q.role)) {
      res.status(400).json({ error: "invalid role name" });
      return;
    }
    if (!isValidSkillName(q.skill)) {
      res.status(400).json({ error: "invalid skill name" });
      return;
    }
    if (!isSafeRelativePath(q.path)) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    const role = q.role;
    const skill = q.skill;
    const relPath = q.path;
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }
    const result = await sendRemoteFileUnderRoot({
      req,
      res,
      host: host as unknown as Parameters<typeof connectOneShot>[0],
      buildPaths: (home) => {
        const root = `${home}/${ROLE_ROOT_REL}/${role}/skills/${skill}`;
        const absPath = `${root}/${relPath}`;
        return absPath.startsWith(root + "/") ? { root, absPath } : null;
      },
      inline: q.inline === "1",
    });
    if (!result.ok) {
      sshLogger.warn("role-skills-editor download failed", {
        operation: "role_skills_editor_download",
        hostId,
        error: result.error,
      });
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /role-skills-editor/write-binary?hostId=&role=&skill=&path=   (body: raw bytes)
// ---------------------------------------------------------------------------

/**
 * Replace (or create) a file inside a skill with raw bytes — for binary
 * edits such as an annotated PDF. Atomic temp-file + posix-rename; the
 * target must stay inside the resolved skill directory. Last-write-wins
 * (no mtime check), like the workspace upload.
 */
router.put(
  "/write-binary",
  authenticateJWT, // BEFORE the body parser (see /read)
  express.raw({ type: "application/octet-stream", limit: MAX_BINARY_WRITE_BYTES }),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;
    const q = req.query as Record<string, unknown>;
    const hostId = typeof q.hostId === "string" ? Number(q.hostId) : NaN;
    if (!Number.isInteger(hostId) || hostId <= 0) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    if (!isValidRoleName(q.role)) {
      res.status(400).json({ error: "invalid role name" });
      return;
    }
    if (!isValidSkillName(q.skill)) {
      res.status(400).json({ error: "invalid skill name" });
      return;
    }
    if (!isSafeRelativePath(q.path)) {
      res.status(400).json({ error: "invalid path" });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "body must be non-empty application/octet-stream" });
      return;
    }
    // Binary writes of a main file get the strict name check (no on-disk
    // comparison — the text editor's save is the path for real edits).
    if (isMainSkillFile(q.path) && nameMismatchesFolder(req.body.toString("utf-8"), q.skill)) {
      res.status(400).json(nameMismatchBody("skill", q.skill, frontmatterName(req.body.toString("utf-8"))));
      return;
    }
    const role = q.role;
    if (!(await guardInstanceWideRoleWrite(res, userId, hostId, role))) return;
    const skill = q.skill;
    const relPath = q.path;
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }
    const result = await writeRemoteFileUnderRoot({
      host: host as unknown as Parameters<typeof connectOneShot>[0],
      buildPaths: (home) => {
        const root = `${home}/${ROLE_ROOT_REL}/${role}/skills/${skill}`;
        const absPath = `${root}/${relPath}`;
        return absPath.startsWith(root + "/") ? { root, absPath } : null;
      },
      bytes: req.body,
    });
    if ("error" in result) {
      sshLogger.warn("role-skills-editor write-binary failed", {
        operation: "role_skills_editor_write_binary",
        hostId,
        error: result.error,
      });
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
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
    sshLogger.error("role-skills-editor: unhandled error", {
      operation: "role_skills_editor_error",
      error: err?.message,
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
