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
 * Phase 90 Plan 90-08: POST /:name/avatar upload endpoint (below GET). Mirrors
 * the identity-side PUT /:identityKey (identities.ts:410+) multer/multipart
 * config exactly (same MIME allowlist, same 2 MB fileSize cap). Two-step
 * atomicity: writes avatar bytes via `writeRoleAvatarByName` FIRST, then
 * splices the role markdown's `avatar:` frontmatter field and writes it back
 * via `writeRoleFileByName`. Worst-case mid-flight failure is an orphaned
 * avatar sibling with stale frontmatter — self-healing via re-upload.
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
 *   - POST path: client-supplied multipart filename is DISCARDED (T-90-08-01).
 *     The on-disk filename is derived server-side as `<roleName>.<ext>`,
 *     where ext comes from MIME_TO_AVATAR_EXT[req.file.mimetype]. Both the
 *     roleName and ext are gate-validated before any I/O.
 *
 * Mount ordering (see database.ts):
 *   Mounted at `/roles` immediately AFTER `rolesListForHostRoutes`. The two
 *   routers do not collide because their routes bind at different depths:
 *   the list router owns `router.get("/")` (enumeration), this router owns
 *   `router.get("/:name/avatar")` and `router.post("/:name/avatar")`. Express
 *   chains multi-router mounts at the same base; the depth difference
 *   disambiguates.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import multer from "multer";
import yaml from "js-yaml";
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
  writeRoleAvatarByName,
  writeRoleFileByName,
  MIME_TO_AVATAR_EXT,
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

// ---------------------------------------------------------------------------
// Phase 90 Plan 90-08: multer + upload constants for POST /:name/avatar
// ---------------------------------------------------------------------------

/** MIME allowlist for role avatar uploads. Mirrors identities.ts L36-40
 *  (identity-avatar allowlist) PLUS `image/gif` because role avatars in the
 *  Phase 86 shape file are allowed to be animated (agent identities are not).
 *  Kept in sync with MIME_TO_AVATAR_EXT (identity-artifact-reader.ts L1873)
 *  MINUS `image/svg+xml` (SVG carries script-injection risk that the raster
 *  formats don't — the reader tolerates svg on-disk for legacy files but the
 *  write path refuses it). */
const ALLOWED_ROLE_AVATAR_MIMES = new Set([
  "image/webp",
  "image/png",
  "image/jpeg",
  "image/gif",
]);

/** Max upload size for role avatars — 5 MB, matching IDMEDIT_MAX_AVATAR_BYTES
 *  from identity-artifact-reader.ts L1854. Larger than the identity upload
 *  cap of 2 MB (identities.ts L44) because roles can be shared across many
 *  identities and are more likely to be manually-picked art rather than
 *  Skynet's own 512x512 birth avatars. The writeRoleAvatarByName helper
 *  re-checks the cap defensively (defense-in-depth), so a future bump here
 *  doesn't accidentally exceed the on-disk write gate. */
const ROLE_AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** Multer config for POST /:name/avatar — mirrors identities.ts L42-49 with
 *  the role-scoped MIME allowlist + size cap above. Memory storage so bytes
 *  land in req.file.buffer for direct handoff to writeRoleAvatarByName
 *  (no tmp files on the Skynet host — the target box is the write target). */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ROLE_AVATAR_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_ROLE_AVATAR_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error("unsupported avatar format"));
  },
});

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

/**
 * Phase 90 Plan 90-08: POST /:name/avatar?hostId=<n>
 *
 * Accepts multipart/form-data with an `avatar` file field. Writes:
 *   1. avatar bytes to `~/.claude/roles/<name>/<name>.<ext>` on target host
 *      via writeRoleAvatarByName (SFTP tmp+rename atomic write on REMOTE,
 *      tmp+rename via Node fs on LOCAL).
 *   2. role frontmatter's `avatar:` key updated to the new filename via
 *      readRoleFileByName → yaml overlay → writeRoleFileByName (mirrors
 *      identities.ts:522-632 PUT overlay pattern minus the identity-specific
 *      fields).
 *
 * Two-step atomicity: bytes-first, frontmatter-second (matches the roles-
 * create.ts:565-587 inline pattern for role creation). A mid-flight failure
 * leaves orphaned avatar bytes with stale frontmatter — self-healing via
 * re-upload; readAvatarSiblingFileByRole's ROLE_NAME_PATTERN + filename gates
 * mean nothing hazardous surfaces to readers in the interim.
 *
 * Validation order (fail-fast — no wasted work):
 *   400: roleName fails ROLE_NAME_PATTERN
 *   400: hostId missing / non-integer / non-positive
 *   400: multipart lacks `avatar` file field
 *   415: file mimetype not in ALLOWED_ROLE_AVATAR_MIMES
 *   413: file exceeds ROLE_AVATAR_MAX_BYTES (multer emits before our handler,
 *        surfaces via the multer-error middleware below)
 *   502: resolveHostById returns null OR SSH connect fails OR frontmatter/
 *        write step throws (upstream detail suppressed per T-22-02-02)
 *
 * Response 201: `{filename, avatarUrl}` where avatarUrl reuses Plan 90-02's
 * GET path — the frontend can invalidate any existing avatar image cache by
 * appending a cache-buster (?v=<timestamp>) or by relying on Cache-Control:
 * no-store on the GET side (roles.ts L176).
 */
router.post(
  "/:name/avatar",
  authenticateJWT,
  // multer must run BEFORE we validate roleName/hostId? NO — the plan requires
  // roleName + hostId gates to fire BEFORE any body-parse. We wrap multer in
  // a pre-gate middleware chain: (a) roleName + hostId gates → 400 without
  // touching multer, (b) multer runs on the surviving requests.
  (req: Request, res: Response, next: express.NextFunction) => {
    const roleName = String(req.params.name);
    if (!ROLE_NAME_PATTERN.test(roleName)) {
      return res.status(400).json({ error: "name must match [a-z0-9-]+" });
    }
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
    next();
  },
  // multer's file-parse gate. On limit-exceeded → LIMIT_FILE_SIZE surfaces as
  // an Error thrown before the handler runs; the express default error path
  // hits our error middleware below and converts to 413.
  (req: Request, res: Response, next: express.NextFunction) => {
    upload.single("avatar")(req, res, (err) => {
      if (err) {
        // multer errors: LIMIT_FILE_SIZE → 413; fileFilter mimetype → 415.
        if ((err as { code?: string }).code === "LIMIT_FILE_SIZE") {
          return res
            .status(413)
            .json({ error: "avatar too large", maxBytes: ROLE_AVATAR_MAX_BYTES });
        }
        if ((err as Error).message === "unsupported avatar format") {
          return res.status(415).json({
            error: "unsupported avatar format",
            allowed: Array.from(ALLOWED_ROLE_AVATAR_MIMES),
          });
        }
        // Any other multer/parse error → 400 (malformed multipart).
        return res.status(400).json({ error: "malformed multipart body" });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const roleName = String(req.params.name);
    // hostId re-parsed here — already validated by the pre-gate above.
    const hostIdNum = Number(req.query.hostId);

    // Post-multer file gate — no file part received. Distinct from the
    // 415/413 paths above which fire during multer parsing.
    if (!req.file) {
      return res.status(400).json({ error: "no avatar file" });
    }

    // Defensive re-check of the mimetype allowlist after multer (belt +
    // suspenders — multer's fileFilter should have caught this).
    const mimetype = req.file.mimetype;
    if (!ALLOWED_ROLE_AVATAR_MIMES.has(mimetype)) {
      return res.status(415).json({
        error: "unsupported avatar format",
        allowed: Array.from(ALLOWED_ROLE_AVATAR_MIMES),
      });
    }

    // Derive on-disk extension from MIME (identity-artifact-reader.ts L1873).
    // Client-supplied filename is intentionally IGNORED (T-90-08-01: prevents
    // path-traversal through the filename field of the multipart part).
    const ext = MIME_TO_AVATAR_EXT[mimetype];
    if (!ext) {
      // Cannot happen given the allowlist above (which is a subset of
      // MIME_TO_AVATAR_EXT's keys), but defense-in-depth.
      return res.status(415).json({
        error: "unsupported avatar format",
        allowed: Array.from(ALLOWED_ROLE_AVATAR_MIMES),
      });
    }
    const filename = `${roleName}.${ext}`;

    // LOCAL vs REMOTE branch — mirrors GET handler L109-134.
    const local = isLocalHostId(hostIdNum);
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!local) {
      try {
        const host = await resolveHostById(hostIdNum, userId);
        if (!host) {
          return res.status(502).json({ error: "host unreachable" });
        }
        conn = await connectOneShot(
          host as unknown as Parameters<typeof connectOneShot>[0],
          SSH_CONNECT_TIMEOUT_MS,
        );
      } catch (err) {
        sshLogger.warn("roles-avatar-write: SSH connect failed", {
          operation: "roles_avatar_write_connect",
          hostId: hostIdNum,
          roleName,
          error: err instanceof Error ? err.message : "Unknown",
        });
        return res.status(502).json({ error: "host unreachable" });
      }
    }

    try {
      // Step 1: write avatar bytes to the sibling file (bytes-first per
      // two-step atomicity — matches roles-create.ts:565-587).
      await writeRoleAvatarByName(conn, roleName, filename, req.file.buffer);

      // Step 2: read + splice + write the role markdown's frontmatter to
      // point `avatar:` at the new filename. Mirrors the identities.ts PUT
      // handler L520-632 overlay pattern (yaml.load → mutate → yaml.dump).
      const { markdown: existing } = await readRoleFileByName(conn, roleName);
      let overlaid: Record<string, unknown> = {};
      let bodyAfterFm = existing;
      if (existing && existing.length > 0) {
        const fmMatch = existing.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
          try {
            const parsed = yaml.load(fmMatch[1]) as
              | Record<string, unknown>
              | null;
            if (parsed && typeof parsed === "object") {
              overlaid = { ...parsed };
            }
          } catch (yamlErr) {
            // Malformed frontmatter — refuse to overwrite (matches
            // identities.ts:543-563 loud-fail; do NOT silently reset the
            // frontmatter to {} because that would drop other cosmetic keys
            // and break downstream readers).
            sshLogger.warn(
              "roles-avatar-write: existing frontmatter YAML malformed",
              {
                operation: "roles_avatar_write_frontmatter_parse",
                userId,
                roleName,
                error:
                  yamlErr instanceof Error ? yamlErr.message : "Unknown",
              },
            );
            return res.status(500).json({
              error:
                "existing role frontmatter is malformed — repair on disk before editing",
            });
          }
          bodyAfterFm = existing.slice(fmMatch[0].length);
          if (bodyAfterFm.startsWith("\n")) {
            bodyAfterFm = bodyAfterFm.slice(1);
          } else if (bodyAfterFm.startsWith("\r\n")) {
            bodyAfterFm = bodyAfterFm.slice(2);
          }
        }
        // No frontmatter block at all — treat body as the file's contents and
        // seed a fresh frontmatter block below.
      } else {
        // Role file missing entirely (LOCAL ENOENT / REMOTE empty stdout).
        // Rare — but not fatal for the write path: the avatar bytes already
        // landed, and we synthesize a minimal frontmatter block so future
        // reads find the avatar key. bodyAfterFm stays "".
      }

      // Overlay the avatar key to the new filename (overwrites any prior
      // value, adds it if absent — mirrors identities.ts L619).
      overlaid.avatar = filename;

      // Emit new markdown body — same yaml.dump options as identities.ts L623-628.
      const yamlBody = yaml.dump(overlaid, {
        sortKeys: false,
        lineWidth: -1,
        noRefs: true,
        forceQuotes: false,
      });
      const newBody = `---\n${yamlBody}---\n${bodyAfterFm}`;

      // Write the markdown back. writeRoleFileByName runs its own
      // ROLE_NAME_PATTERN + byte-cap gates (identity-artifact-reader.ts L2685).
      await writeRoleFileByName(conn, roleName, newBody);

      // 201 Created — filename + avatarUrl (relative to /roles mount).
      return res.status(201).json({
        filename,
        avatarUrl: `/roles/${roleName}/avatar?hostId=${hostIdNum}`,
      });
    } catch (err) {
      // Upstream detail suppressed — matches T-22-02-02 pattern.
      sshLogger.warn("roles-avatar-write: write failed", {
        operation: "roles_avatar_write_failure",
        hostId: hostIdNum,
        roleName,
        error: err instanceof Error ? err.message : "Unknown",
      });
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
