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
 *     - `avatar` (optional): PNG/JPEG/WebP image file (≤ 10 MiB)
 *   → 201 { name, description, cosmetics } on success (echoes persisted
 *     cosmetic frontmatter; empty {} when none supplied)
 *   → 400 on validation failure (name/description/hostId + per-cosmetic-field
 *     gates title/colorHue/voice)
 *   → 401 without JWT
 *   → 404 when hostId does not resolve for the caller
 *   → 409 when ~/fleet/roles/<name>/ already exists on the target host
 *   → 413 on avatar exceeding 10 MiB (multer LIMIT_FILE_SIZE)
 *   → 415 on non-multipart Content-Type OR unsupported avatar mimetype
 *   → 502 on SSH connect / exec / SFTP write failure
 *
 * Sequence:
 *   1. Multer parses multipart body (memoryStorage, 10 MB fileSize limit,
 *      png/jpeg/webp mimetype whitelist).
 *   2. Content-Type gate: reject non-multipart with LOUD 415 (see LOCKED
 *      learned preference above).
 *   3. Parse `data` JSON → {name, description, hostId, cosmetics?}. Malformed
 *      JSON → 400.
 *   4. Validate name/description (role-input-validation.ts) + hostId.
 *   5. Validate cosmetics per-field: colorHue integer 0-359; voice is a
 *      recognized voice ID.
 *   6. If req.file present, normalize it and map its mimetype to an ext.
 *   7. resolveHostById + connectOneShot under the host semaphore.
 *   8. Auto-tag the creator on multi-user hosts (`users:`).
 *   9. createRoleOnHost (roles-create-core.ts, shared with the role-request
 *      file drop): collision-safe mkdir with auto-suffix, stub role file,
 *      avatar sibling `<slug>.<ext>`.
 *   10. Response 201 { name, description, cosmetics }.
 *   11. Finally: conn.end() (try/catch swallow — best-effort).
 *
 * Security posture (STRIDE threat register in Plan 86-02):
 *   T-86-02-01: shell injection via avatarFilename — MITIGATE via
 *     avatarFilename = `<name>.<ext>` where name passes ROLE_NAME_PATTERN
 *     and ext ∈ {webp,png,jpg} via MIME_TO_AVATAR_EXT lookup — client
 *     cannot control either half. Avatar upload goes through SFTP writeFile,
 *     not shell, so path components are never shell-interpolated regardless.
 *   T-86-02-02: DoS via oversized avatar — MITIGATE via multer 10 MB fileSize
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
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { MIME_TO_AVATAR_EXT } from "../../claude-session/identity-artifact-reader.js";
// Pretty-names shape (2026-09-30): backend derives the role slug from the
// typed displayName via the shared helper (role-input-validation.ts).
import {
  validateRoleDisplayName,
  validateRoleDescription,
} from "../../utils/role-input-validation.js";
import { createRoleOnHost } from "./roles-create-core.js";
import { sshLogger } from "../../utils/logger.js";
// Phase 103 D-10: multipart-origin-guard — CORS-simple content types don't preflight
import { multipartOriginGuard } from "../../utils/multipart-origin-guard.js";
import { isRecognizedVoiceId } from "../../voice/tts-provider.js";
import { getHostSemaphore } from "../../ssh/host-semaphore-registry.js";
// Phase 129 Plan 06 D-4: per-user visibility gate write side. isHostMultiUser
// gates whether the auto-tag branch fires at all (single-user hosts stay
// silent per shape §"invisible in the majority case"); getUsernameForUserId
// resolves the JWT userId to a case-preserved Skynet username so the
// frontmatter `users:` list gets the human-readable name, not the opaque
// nanoid subject.
import {
  isHostMultiUser,
  getUsernameForUserId,
} from "../../utils/host-user-counter.js";

import { normalizeUploadedAvatar } from "../../utils/avatar-normalize.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches other one-shot SSH endpoints. */
const SSH_CONNECT_TIMEOUT_MS = 5000;

/** Multer upload config — mirrors identities.ts L36-49 shape (10 MB cap here,
 *  same mimetype whitelist, same in-memory storage). Kept in sync with the
 *  identity endpoint per canonical_refs "same trap" note. */
const ALLOWED_AVATAR_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  // 10 MiB captures modern-phone camera photos unmodified (typical 3-8 MB, up
  // to ~15 MB for max-quality 4K rarely). In-memory buffer of 10 MB per
  // concurrent upload is trivial; role avatars are file-siblings on disk with
  // no scaling concern; frontend scales in CSS regardless of source size.
  // Aligned with the "max any user would realistically choose for an image
  // that wouldn't stress the app" bar. Nginx templates cap upstream at 11M
  // (10 MiB + 1 MiB multipart framing headroom) per docker/nginx.conf
  // + docker/nginx-https.conf /roles block.
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_AVATAR_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error("Avatar must be PNG, JPEG, or WebP"));
  },
});

/**
 * Shape of the parsed `data` JSON multipart field.
 *
 * Pretty-names shape (2026-09-30): the client sends the free-form typed
 * `displayName` as a top-level field; the backend derives the role slug.
 * `title` is removed from `cosmetics` — the pretty name is a first-class
 * field written to the role file's frontmatter as `displayName:`.
 *
 * Avatar filename is derived server-side from mimetype (never accepted
 * from the client per T-86-02-01) so it's absent here — the caller sets
 * it in cosmetics before yaml.dump.
 */
type MultipartRolePayload = {
  displayName?: unknown;
  description?: unknown;
  hostId?: unknown;
  cosmetics?: {
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
 * POST /
 * Content-Type: multipart/form-data
 * Fields: data (JSON blob), avatar (optional PNG/JPEG/WebP ≤ 10 MiB)
 *
 * Provisions ~/fleet/roles/<name>/ + <name>.md (with cosmetic frontmatter
 * when supplied) + optional <name>.<ext> avatar sibling file.
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

    const rawDisplayName = payload.displayName;
    const rawDescription = payload.description;
    const rawHostId = payload.hostId;
    const rawCosmetics = payload.cosmetics ?? {};

    // -----------------------------------------------------------------------
    // 2. Body validation — 400 on any failure with distinct error messages.
    //    Pretty-names shape: displayName is the typed pretty name; backend
    //    derives the slug via the shared helper. derivePrettyNameSlug
    //    rejects empty / too-long / unslugifiable input in one place.
    // -----------------------------------------------------------------------
    const nameCheck = validateRoleDisplayName(rawDisplayName);
    if (nameCheck.ok === false) {
      res.status(400).json({ error: nameCheck.error });
      return;
    }
    const baseSlug = nameCheck.slug;
    const displayName = nameCheck.displayName;
    const descriptionCheck = validateRoleDescription(rawDescription);
    if (descriptionCheck.ok === false) {
      res.status(400).json({ error: descriptionCheck.error });
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

    const description = descriptionCheck.description;
    const hostId = rawHostId;

    // -----------------------------------------------------------------------
    // 3. Cosmetic validation — per-field gates BEFORE any provisioning.
    //    Distinct 400 messages so the frontend can highlight the field.
    //    Mirrors the identity PUT gates at identities.ts L444-461.
    //
    //    Pretty-names shape (2026-09-30): `displayName` is a first-class
    //    frontmatter field (not a cosmetic) and lives at top level of the
    //    cosmetics-dict that yaml.dump sees, written alongside colorHue /
    //    voice / avatar. The old `title` cosmetic is gone.
    // -----------------------------------------------------------------------
    const cosmetics: {
      displayName?: string;
      colorHue?: number;
      voice?: string;
      avatar?: string;
    } = { displayName };

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
        !isRecognizedVoiceId(rawCosmetics.voice)
      ) {
        res
          .status(400)
          .json({
            error:
              "voice must be a supported voice ID",
          });
        return;
      }
      cosmetics.voice = rawCosmetics.voice;
    }

    // -----------------------------------------------------------------------
    // 4. Avatar mimetype gate — early rejection on unsupported type. The
    //    actual avatar filename is computed AFTER the mkdir auto-suffix loop
    //    below, since the filename depends on the final slug (which may be
    //    base, base-2, base-3, ... depending on collisions).
    // -----------------------------------------------------------------------
    let avatarExt: string | null = null;
    if (req.file) {
      await normalizeUploadedAvatar(req.file);
      const ext = MIME_TO_AVATAR_EXT[req.file.mimetype];
      if (!ext) {
        // Belt: multer's fileFilter should have rejected this already, but
        // defense-in-depth in case the mimetype whitelist and MIME_TO_AVATAR_EXT
        // ever drift apart.
        res.status(415).json({ error: "Avatar must be PNG, JPEG, or WebP" });
        return;
      }
      avatarExt = ext;
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
      // 7. Phase 129 Plan 06 D-4: auto-tag creator on multi-user hosts.
      //
      // On multi-user hosts (>1 distinct Skynet user with access), write the
      // creator's Skynet username to the new role file's `users:` frontmatter
      // list. Single-user hosts stay silent — the file is byte-identical to
      // a pre-129 role file per shape §"What would make it wrong" bullet 1.
      //
      // Fail-open on username-lookup failure: a wrong-user auto-tag would be
      // a shape violation, so we leave the file untagged and log loudly.
      // Case preservation (Pitfall 7): the username is used as stored.
      // ---------------------------------------------------------------------
      let users: string[] | undefined;
      if (await isHostMultiUser(hostId)) {
        const creatorUsername = await getUsernameForUserId(userId);
        if (creatorUsername) {
          users = [creatorUsername];
          sshLogger.info("roles-create: auto-tagged creator on multi-user host", {
            operation: "roles_create_auto_tagged",
            role: baseSlug,
            hostId,
            creatorUsername,
          });
        } else {
          sshLogger.warn(
            "roles-create: username lookup failed — auto-tag skipped",
            {
              operation: "roles_create_username_lookup_failed",
              userId,
              hostId,
            },
          );
        }
      }

      // ---------------------------------------------------------------------
      // 8. Provision folder + stub role file + avatar (roles-create-core.ts,
      //    shared with the role-request file drop).
      // ---------------------------------------------------------------------
      const result = await createRoleOnHost(
        conn,
        {
          baseSlug,
          displayName,
          description,
          colorHue: cosmetics.colorHue,
          voice: cosmetics.voice,
          users,
          avatar:
            req.file && avatarExt
              ? { ext: avatarExt, bytes: req.file.buffer }
              : undefined,
        },
        { hostId, source: "dialog" },
      );
      if (result.ok === false) {
        if (result.error === "collision_cap_exhausted") {
          res.status(500).json({ error: "failed to create role" });
        } else {
          res.status(502).json({ error: "SSH exec failed" });
        }
        return;
      }

      // ---------------------------------------------------------------------
      // 9. Response 201 { name, description, cosmetics }. Cosmetics echoes
      //    the persisted frontmatter.
      // ---------------------------------------------------------------------
      res.status(201).json({ name: result.name, description, cosmetics: result.cosmetics });
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
      return res.status(413).json({ error: "Avatar exceeds 10 MB limit" });
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
