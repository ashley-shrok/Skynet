/**
 * Phase 22 (SRIC-04): POST /roles — target-host-side role folder creation.
 *
 * Phase 86 Plan 86-02 (2026-09-07): widened from JSON-only to multipart/form-
 * data with a `data` JSON field carrying {name, description, hostId, cosmetics}
 * plus an optional `avatar` file part. Mirrors the identity-endpoint pattern
 * (LOCKED per canonical_refs learned preference: "Skynet `/identities/:id`
 * PUT is multipart/form-data with field name `data` — a JSON body silently
 * no-ops with a 200") — a raw-JSON request now returns 415 LOUDLY instead of
 * silently no-op'ing. Cosmetics land in the role file's YAML frontmatter;
 * the avatar file lands as a sibling at ~/fleet/roles/<name>/<avatar-file>.
 *
 * POST /roles
 *   Content-Type: multipart/form-data
 *   Fields:
 *     - `data` (required): JSON blob {name, description, hostId,
 *        cosmetics?: {title?, colorHue?, voice?}}
 *     - `avatar` (optional): PNG/JPEG/WebP image file (≤ 2 MiB)
 *   → 201 { name, description, cosmetics } on success (echoes persisted
 *     cosmetic frontmatter; empty {} when none supplied)
 *   → 400 on validation failure (name/description/hostId + per-cosmetic-field
 *     gates title/colorHue/voice)
 *   → 401 without JWT
 *   → 404 when hostId does not resolve for the caller
 *   → 409 when ~/fleet/roles/<name>/ already exists on the target host
 *   → 413 on avatar exceeding 2 MiB (multer LIMIT_FILE_SIZE)
 *   → 415 on non-multipart Content-Type OR unsupported avatar mimetype
 *   → 502 on SSH connect / exec / SFTP write failure
 *
 * Sequence:
 *   1. Multer parses multipart body (memoryStorage, 2 MB fileSize limit,
 *      png/jpeg/webp mimetype whitelist).
 *   2. Content-Type gate: reject non-multipart with LOUD 415 (see LOCKED
 *      learned preference above).
 *   3. Parse `data` JSON → {name, description, hostId, cosmetics?}. Malformed
 *      JSON → 400.
 *   4. Validate name/description/hostId (existing Phase 22 gates, unchanged).
 *   5. Validate cosmetics per-field: title non-empty string ≤128 chars;
 *      colorHue integer 0-359; voice matches [A-Z][A-Za-z]+\.wav.
 *   6. If req.file present, derive avatarFilename = `<name>.<ext>` where ext
 *      comes from MIME_TO_AVATAR_EXT[req.file.mimetype]. Set
 *      cosmetics.avatar = avatarFilename.
 *   7. resolveHostById + connectOneShot + collision probe (Phase 22, unchanged).
 *   8. Provision: mkdir -p bounties/, touch history.md (Phase 22, unchanged).
 *   9. Resolve remote $HOME.
 *   10. Build stub markdown — WITH frontmatter block when cosmetics has any
 *       keys (yaml.dump), WITHOUT frontmatter when empty (regression guard).
 *   11. writeMarkdownFileAtomic(conn, targetMd, stubMarkdown).
 *   12. If req.file present, inline SFTP writeFile(avatarSiblingPath, bytes)
 *       — see step 7 note below.
 *   13. Response 201 { name, description, cosmetics }.
 *   14. Finally: conn.end() (try/catch swallow — best-effort).
 *
 * Inlined role-folder avatar write per Plan 86-02 (wave-1 file-ownership
 * constraint keeps identity-artifact-reader.ts out of this plan). Follow-up
 * refactor may extract writeAvatarSiblingFileForRole(conn, roleName, ext,
 * bytes) if a third caller emerges — per the same 'extract later if a third
 * caller emerges' precedent CONTEXT.md applies to the avatar generator (see
 * D-CTX-86-surface-3).
 *
 * Security posture (STRIDE threat register in Plan 86-02):
 *   T-86-02-01: shell injection via avatarFilename — MITIGATE via
 *     avatarFilename = `<name>.<ext>` where name passes ROLE_NAME_PATTERN
 *     and ext ∈ {webp,png,jpg} via MIME_TO_AVATAR_EXT lookup — client
 *     cannot control either half. Avatar upload goes through SFTP writeFile,
 *     not shell, so path components are never shell-interpolated regardless.
 *   T-86-02-02: DoS via oversized avatar — MITIGATE via multer 2 MB fileSize
 *     limit (mirrors identities.ts).
 *   T-86-02-03: silent no-op on JSON-with-cosmetics — MITIGATE via LOUD 415
 *     Content-Type gate (learned preference from canonical_refs).
 *   T-86-02-04: frontmatter YAML injection via cosmetic values — MITIGATE via
 *     js-yaml.dump (sanitizes values); reject non-string/non-number values
 *     before dump via per-field validators.
 *
 * Phase 22 threats (still valid):
 *   T-22-04-01/02: shell injection / path traversal via role name — MITIGATE
 *     via ROLE_NAME_PATTERN /^[a-z0-9-]+$/ gate at HTTP handler entry.
 *   T-22-04-03: cross-user role provisioning — MITIGATE via
 *     resolveHostById(hostId, userId) returning null for cross-user hosts.
 *   T-22-04-04: DoS via unbounded description — MITIGATE via 4 KB cap.
 *   T-22-04-05: SFTP EEXIST trap — MITIGATE via writeMarkdownFileAtomic
 *     (ext_openssh_rename).
 *   T-22-04-07: info disclosure via SSH stderr — MITIGATE via generic 5xx
 *     response bodies; upstream detail only in sshLogger.
 *
 * Mount point: app.use("/roles", rolesCreateRoutes) alongside the sibling
 * rolesListForHostRoutes. Both /roles mounts appear BEFORE /identities in
 * database.ts to preserve match precedence.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import multer from "multer";
import yaml from "js-yaml";
import type { Request, Response } from "express";
import type { SFTPWrapper } from "ssh2";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import {
  writeMarkdownFileAtomic,
  MIME_TO_AVATAR_EXT,
} from "../../claude-session/identity-artifact-reader.js";
import { ROLE_NAME_PATTERN } from "./identity-birth-orchestrator.js";
import { sshLogger } from "../../utils/logger.js";
// Phase 103 D-10: multipart-origin-guard — CORS-simple content types don't preflight
import { multipartOriginGuard } from "../../utils/multipart-origin-guard.js";
import { isValidPollyVoice } from "../../voice/polly-voice-catalog.js";
import { getHostSemaphore } from "../../ssh/host-semaphore-registry.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches other one-shot SSH endpoints. */
const SSH_CONNECT_TIMEOUT_MS = 5000;

/** SSH exec race timeout — bounded so a hung remote can't stall the route. */
const SSH_EXEC_TIMEOUT_MS = 5000;

/** Description length cap (bytes). 4KB matches Phase 22's threat model
 *  (T-22-04-04 DoS via unbounded payload) and the nginx client_max_body_size
 *  32k belt (which also covers JSON envelope + name + hostId). */
const MAX_DESCRIPTION_BYTES = 4096;

/** Maximum role-name length matching frontend UI expectations. */
const MAX_NAME_LENGTH = 64;

/** Maximum cosmetic title length. Mirrors identities.ts's implicit display
 *  cap discipline — we don't want unbounded strings landing in frontmatter.
 *  128 chars is generous for a subtitle line (D-CTX-86-surface-1). */
const MAX_TITLE_LENGTH = 128;

/** Voice validation: mirrors identities.ts's Polly-whitelist swap from Phase
 *  98 Plan 07. Accepts only the 7 Polly generative en-US voice IDs; the
 *  Elena.wav-style Chatterbox names are gone. Isolated call-site below. */

/** Multer upload config — mirrors identities.ts L36-49 exactly (same 2 MB cap,
 *  same mimetype whitelist, same in-memory storage). Kept in sync with the
 *  identity endpoint per canonical_refs "same trap" note. */
const ALLOWED_AVATAR_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_AVATAR_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error("Avatar must be PNG, JPEG, or WebP"));
  },
});

/**
 * REVISION 2026-08-04 (Ashley at 22-02 checkpoint, applies HERE per same-
 * pattern extension). Seed comment embedded below the description so the
 * first agent to hold this role knows to flesh out the file on wake.
 *
 * Style constraints (verbatim from Ashley — enforced by test 6 assertions):
 *   - Do NOT say "Skynet" (agents don't know what that is)
 *   - Do NOT reference §2 / §3 / "id skill" / SKILL.md (fragile skill refs)
 *   - Plain-terms instructions to the wake-up agent
 *   - Ends with "remove this comment" so the agent knows to clear it
 */
const ROLE_STUB_SEED_COMMENT =
  "<!-- This role file was auto-generated with only a basic description. On first wake of an agent holding this role, please flesh out the role with standing directives, learned preferences, and a 10,000-foot view of the domain the role covers, then remove this comment. -->";

/**
 * Race an exec against a timeout so a hung remote can't stall the route.
 * Matches roles-list-for-host.execWithTimeout / identity-artifact-reader.
 * execWithTimeout shape.
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
 * Shape of the parsed `data` JSON multipart field. Cosmetics are optional;
 * avatar filename is derived server-side from mimetype (never accepted from
 * the client per T-86-02-01) so it's absent here — the caller sets it in
 * cosmetics before yaml.dump.
 */
type MultipartRolePayload = {
  name?: unknown;
  description?: unknown;
  hostId?: unknown;
  cosmetics?: {
    title?: unknown;
    colorHue?: unknown;
    voice?: unknown;
  };
};

/**
 * Parse the multipart `data` JSON field. Returns null on malformed JSON so
 * the caller can 400. Empty/missing data field → returns {} (caller runs
 * the standard name/description/hostId validators, which will 400 with
 * "name is required" per Phase 22).
 */
function parseMultipartRolePayload(req: Request): MultipartRolePayload | null {
  const raw = (req.body as { data?: unknown } | undefined)?.data;
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    return parsed as MultipartRolePayload;
  } catch {
    return null;
  }
}

/**
 * Inline SFTP writeFile — Plan 86-02 Task 1 step 7. Mirrors the private
 * sftpReadFile helper pattern at identity-artifact-reader.ts:2473-2490:
 * promise-wraps conn.sftp → sftp.writeFile(path, bytes) → sftp.end() in
 * finally. Kept inline (not exported from identity-artifact-reader) per
 * wave-1 file-ownership constraint between Plan 86-01 (owns identity-
 * artifact-reader.ts) and this plan.
 *
 * Follow-up refactor may extract writeAvatarSiblingFileForRole(conn,
 * roleName, ext, bytes) if a third caller emerges — per the same "extract
 * later if a third caller emerges" precedent CONTEXT.md applies to the
 * avatar generator (see D-CTX-86-surface-3).
 */
async function sftpWriteFileInline(
  conn: Awaited<ReturnType<typeof connectOneShot>>,
  remotePath: string,
  bytes: Buffer,
): Promise<void> {
  const sftp: SFTPWrapper = await new Promise<SFTPWrapper>((resolve, reject) => {
    conn.sftp((err: Error | undefined, s: SFTPWrapper) => {
      if (err) return reject(err);
      resolve(s);
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(remotePath, bytes, (writeErr) => {
        if (writeErr) return reject(writeErr);
        resolve();
      });
    });
  } finally {
    try {
      sftp.end();
    } catch {
      /* best-effort — SFTP cleanup mustn't mask the underlying write result */
    }
  }
}

/**
 * POST /
 * Content-Type: multipart/form-data
 * Fields: data (JSON blob), avatar (optional PNG/JPEG/WebP ≤ 2 MiB)
 *
 * Provisions ~/fleet/roles/<name>/ + bounties/ + history.md + <name>.md
 * (with cosmetic frontmatter when supplied) + optional <name>.<ext> avatar
 * sibling file.
 */
router.post(
  "/",
  // Phase 103 D-10: multipart-origin-guard — CORS-simple content types don't preflight
  multipartOriginGuard,
  authenticateJWT,
  // Content-Type gate — LOUD 415 on non-multipart (per T-86-02-03). Runs
  // BEFORE multer so a JSON caller doesn't get a confusing multer-boundary
  // error; the response tells them exactly what to send instead. This gate
  // is the plan's LOCKED behavior test 5.
  (req: Request, res: Response, next: express.NextFunction) => {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      res.status(415).json({
        error:
          "roles create requires multipart/form-data with `data` field",
      });
      return;
    }
    next();
  },
  upload.single("avatar"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // -----------------------------------------------------------------------
    // 1. Parse the multipart `data` JSON field.
    // -----------------------------------------------------------------------
    const payload = parseMultipartRolePayload(req);
    if (payload === null) {
      res.status(400).json({ error: "Invalid JSON in data field" });
      return;
    }

    const rawName = payload.name;
    const rawDescription = payload.description;
    const rawHostId = payload.hostId;
    const rawCosmetics = payload.cosmetics ?? {};

    // -----------------------------------------------------------------------
    // 2. Body validation — 400 on any failure with distinct error messages
    //    (Phase 22 gates, unchanged).
    // -----------------------------------------------------------------------
    if (typeof rawName !== "string" || rawName.length === 0) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (rawName.length > MAX_NAME_LENGTH) {
      res.status(400).json({ error: `name must be ≤${MAX_NAME_LENGTH} chars` });
      return;
    }
    if (!ROLE_NAME_PATTERN.test(rawName)) {
      res.status(400).json({
        error: "name must be kebab-case-lowercase (a-z, 0-9, hyphen only)",
      });
      return;
    }
    if (typeof rawDescription !== "string" || rawDescription.length === 0) {
      res.status(400).json({ error: "description is required" });
      return;
    }
    if (Buffer.byteLength(rawDescription, "utf-8") > MAX_DESCRIPTION_BYTES) {
      res.status(400).json({
        error: `description must be ≤${MAX_DESCRIPTION_BYTES} bytes`,
      });
      return;
    }
    if (
      typeof rawHostId !== "number" ||
      !Number.isInteger(rawHostId) ||
      rawHostId <= 0
    ) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }

    const name = rawName;
    const description = rawDescription;
    const hostId = rawHostId;

    // -----------------------------------------------------------------------
    // 3. Cosmetic validation — per-field gates BEFORE any provisioning.
    //    Distinct 400 messages so the frontend can highlight the field.
    //    Mirrors the identity PUT gates at identities.ts L444-461.
    // -----------------------------------------------------------------------
    const cosmetics: {
      title?: string;
      colorHue?: number;
      voice?: string;
      avatar?: string;
    } = {};

    if (rawCosmetics.title !== undefined) {
      if (
        typeof rawCosmetics.title !== "string" ||
        rawCosmetics.title.length === 0
      ) {
        res.status(400).json({ error: "title must be a non-empty string" });
        return;
      }
      if (rawCosmetics.title.length > MAX_TITLE_LENGTH) {
        res.status(400).json({
          error: `title must be ≤${MAX_TITLE_LENGTH} chars`,
        });
        return;
      }
      cosmetics.title = rawCosmetics.title;
    }

    if (rawCosmetics.colorHue !== undefined) {
      if (
        typeof rawCosmetics.colorHue !== "number" ||
        !Number.isInteger(rawCosmetics.colorHue) ||
        rawCosmetics.colorHue < 0 ||
        rawCosmetics.colorHue > 359
      ) {
        res.status(400).json({ error: "colorHue must be an integer 0-359" });
        return;
      }
      cosmetics.colorHue = rawCosmetics.colorHue;
    }

    if (rawCosmetics.voice !== undefined) {
      if (
        typeof rawCosmetics.voice !== "string" ||
        !isValidPollyVoice(rawCosmetics.voice)
      ) {
        res
          .status(400)
          .json({
            error:
              "voice must be one of the 7 supported Amazon Polly generative en-US voice IDs",
          });
        return;
      }
      cosmetics.voice = rawCosmetics.voice;
    }

    // -----------------------------------------------------------------------
    // 4. Avatar handling — derive server-side filename from mimetype so the
    //    client can NEVER pick a mismatched extension (T-86-02-01 mitigation).
    // -----------------------------------------------------------------------
    let avatarFilename: string | null = null;
    if (req.file) {
      const ext = MIME_TO_AVATAR_EXT[req.file.mimetype];
      if (!ext) {
        // Belt: multer's fileFilter should have rejected this already, but
        // defense-in-depth in case the mimetype whitelist and MIME_TO_AVATAR_EXT
        // ever drift apart.
        res.status(415).json({ error: "Avatar must be PNG, JPEG, or WebP" });
        return;
      }
      avatarFilename = `${name}.${ext}`;
      cosmetics.avatar = avatarFilename;
    }

    // -----------------------------------------------------------------------
    // 5. Host resolution — 404 for cross-user / unknown hosts (Phase 22).
    // -----------------------------------------------------------------------
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // -----------------------------------------------------------------------
    // 6. SSH connect — 502 on failure (conn not yet assigned → no cleanup).
    // -----------------------------------------------------------------------
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      await getHostSemaphore(hostId).run(async () => {
      try {
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("roles-create: SSH connect failed", {
          operation: "roles_create_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 7. Collision probe: 409 if the role folder already exists.
      //    name is pre-validated by ROLE_NAME_PATTERN so the interpolation
      //    into the double-quoted path is shell-safe.
      // ---------------------------------------------------------------------
      let existsStdout: string;
      try {
        existsStdout = await execWithTimeout(
          conn,
          `if [ -d "$HOME/fleet/roles/${name}" ]; then echo exists; else echo missing; fi`,
        );
      } catch (err) {
        sshLogger.warn("roles-create: existence probe exec failed", {
          operation: "roles_create_exists_probe",
          hostId,
          name,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      if (existsStdout.trim() === "exists") {
        res.status(409).json({ error: "role exists on host" });
        return;
      }

      // ---------------------------------------------------------------------
      // 8. Provision: mkdir -p (idempotent, race-tolerant) + touch history.md.
      // ---------------------------------------------------------------------
      try {
        await execWithTimeout(
          conn,
          `mkdir -p "$HOME/fleet/roles/${name}/bounties"`,
        );
        await execWithTimeout(
          conn,
          `touch "$HOME/fleet/roles/${name}/history.md"`,
        );
      } catch (err) {
        sshLogger.warn("roles-create: provision exec failed", {
          operation: "roles_create_provision",
          hostId,
          name,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 9. Resolve remote $HOME so we can pass an absolute path to SFTP
      //    (writeMarkdownFileAtomic + sftpWriteFileInline both work over
      //    SFTP which does NOT tilde-expand — target paths must be absolute).
      // ---------------------------------------------------------------------
      let remoteHome: string;
      try {
        remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
        if (!remoteHome) {
          throw new Error("could not resolve remote $HOME");
        }
      } catch (err) {
        sshLogger.warn("roles-create: $HOME resolution failed", {
          operation: "roles_create_home",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 10. Build stub markdown.
      //     WITH cosmetics → prepend `---\n<yaml.dump>---\n\n` frontmatter,
      //     then the standard `# <name>\n\n## Role\n\n<description>\n\n
      //     <SEED>\n` body.
      //     WITHOUT cosmetics → emit the existing frontmatter-less body
      //     verbatim (regression guard for Plan 86-02 Test 1 — the empty-
      //     cosmetics path MUST be byte-identical to Phase 22's output).
      // ---------------------------------------------------------------------
      const hasCosmetics = Object.keys(cosmetics).length > 0;
      const bodyLines =
        `# ${name}\n\n## Role\n\n${description}\n\n${ROLE_STUB_SEED_COMMENT}\n`;
      const stubMarkdown = hasCosmetics
        ? `---\n${yaml.dump(cosmetics, {
            sortKeys: false,
            lineWidth: -1,
            noRefs: true,
            forceQuotes: false,
          })}---\n\n${bodyLines}`
        : bodyLines;

      const targetPath = `${remoteHome}/fleet/roles/${name}/${name}.md`;

      try {
        await writeMarkdownFileAtomic(conn, targetPath, stubMarkdown);
      } catch (err) {
        sshLogger.error(
          "roles-create: SFTP write failed",
          err instanceof Error ? err : new Error(String(err)),
          {
            operation: "roles_create_sftp_write",
            hostId,
            name,
            targetPath,
          },
        );
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // ---------------------------------------------------------------------
      // 11. Inline SFTP avatar write (Plan 86-02 Task 1 step 7).
      //     Only fires when req.file was uploaded. Target path is derived
      //     from server-controlled name + ext, so no shell-injection surface
      //     (T-86-02-01). Write failure → 502 with roles_create_sftp_avatar_write
      //     operation tag.
      // ---------------------------------------------------------------------
      if (req.file && avatarFilename) {
        const avatarTargetPath =
          `${remoteHome}/fleet/roles/${name}/${avatarFilename}`;
        try {
          await sftpWriteFileInline(conn, avatarTargetPath, req.file.buffer);
        } catch (err) {
          sshLogger.error(
            "roles-create: SFTP avatar write failed",
            err instanceof Error ? err : new Error(String(err)),
            {
              operation: "roles_create_sftp_avatar_write",
              hostId,
              name,
              targetPath: avatarTargetPath,
            },
          );
          res.status(502).json({ error: "SSH exec failed" });
          return;
        }
      }

      // ---------------------------------------------------------------------
      // 12. Response 201 { name, description, cosmetics }. Cosmetics echoes
      //     the persisted frontmatter (empty {} when none supplied).
      // ---------------------------------------------------------------------
      res.status(201).json({ name, description, cosmetics });
      }); // end getHostSemaphore(hostId).run(...)
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

// Multer error middleware — mirrors identities.ts L819-836. Handles
// LIMIT_FILE_SIZE (413) + fileFilter rejection (415). Falls through to a
// generic 500 for anything unrecognized. Sanitizes upstream detail per
// RESEARCH V7 (never leak stderr / tailnet paths in response body).
router.use(
  (
    err: Error & { code?: string },
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "Avatar exceeds 2 MB limit" });
    }
    if (err?.message?.startsWith("Avatar must be")) {
      return res.status(415).json({ error: err.message });
    }
    sshLogger.error("roles-create: unhandled error", {
      operation: "roles_create_error",
      error: err?.message,
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
