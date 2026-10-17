/**
 * Phase 90 Plan 90-02 (D-08.2 — planner picks
 * `GET /roles/:name/avatar?hostId=<n>` matching the identity-avatar path shape):
 *
 * Role-avatar serve endpoint. Byte-shape mirror of the identity-avatar-serve
 * handler at `identities.ts:767-870`, adapted for role scope:
 *   - Addressed by role name (not identity key).
 *   - Reads `~/fleet/roles/<name>/<name>.md` frontmatter for the avatar
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
import { guardInstanceWideRoleWrite } from "../../instance-wide/role-guard.js";
import express from "express";
import multer from "multer";
import yaml from "js-yaml";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { getHostSemaphore } from "../../ssh/host-semaphore-registry.js";
import { sshLogger } from "../../utils/logger.js";
// Phase 103 D-10: multipart-origin-guard — CORS-simple content types don't preflight
import { multipartOriginGuard } from "../../utils/multipart-origin-guard.js";
import {
  readRoleFileByName,
  readAvatarSiblingFileByRole,
  extractCosmeticsFromFrontmatter,
  isLocalHostId,
  writeRoleAvatarByName,
  writeRoleFileByName,
  MIME_TO_AVATAR_EXT,
  stringifyColorHueForYaml,
} from "../../claude-session/identity-artifact-reader.js";
// Phase 90 Plan 90-10 (LOW-severity cleanup): ROLE_NAME_PATTERN promoted to
// `src/backend/utils/role-name-pattern.ts` — was previously cloned locally.
// Consolidating avoids the divergence risk called out in the unbiased code review.
import { ROLE_NAME_PATTERN } from "../../utils/role-name-pattern.js";

import { normalizeUploadedAvatar } from "../../utils/avatar-normalize.js";
import {
  getCachedAvatar,
  invalidateCachedAvatar,
  invalidateCachedAvatarsForHost,
  type CachedAvatar,
} from "./identity-avatar-cache.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

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

    // 3. Host access check runs BEFORE the cache so a cache hit never
    //    serves a remote host's role avatar to a caller without access.
    //    Phase 90 Plan 90-10 (LOW cleanup 2): differentiate resolveHostById
    //    "no such host / not owned by user" (→ "host not resolvable") from
    //    the SSH-connect-throw path (→ "host unreachable"). Same HTTP code,
    //    distinct bodies so debugging picks the right rabbit hole.
    const local = isLocalHostId(hostIdNum);
    let host: Awaited<ReturnType<typeof resolveHostById>> = null;
    if (!local) {
      try {
        host = await resolveHostById(hostIdNum, userId);
      } catch (err) {
        sshLogger.warn("roles-avatar: host resolve failed", {
          operation: "roles_avatar_resolve",
          hostId: hostIdNum,
          roleName,
          error: err instanceof Error ? err.message : "Unknown",
        });
        return res.status(502).json({ error: "host unreachable" });
      }
      if (!host) {
        return res.status(502).json({ error: "host not resolvable" });
      }
    }

    // 4. Bytes go through the shared identity-avatar cache (same one the
    //    identity avatars and app icons use) so a cold sidebar paint doesn't
    //    open one SSH connection per role-avatar <img>. Concurrent misses
    //    for the same role coalesce into one load; the entry is fresh for
    //    the cache's unversioned window and dropped by the POST below.
    //    Key `role.<name>` cannot collide with identity keys (no dot) or
    //    app icons (`app.<slug>`).
    let avatar: CachedAvatar | null;
    let hit = false;
    const startedAt = Date.now();
    try {
      const result = await getCachedAvatar(
        hostIdNum,
        roleAvatarCacheKey(roleName),
        null,
        () => loadRoleAvatar(hostIdNum, host, roleName),
      );
      avatar = result.avatar;
      hit = result.hit;
    } catch (err) {
      if (err instanceof RoleAvatarConnectError) {
        sshLogger.warn("roles-avatar: SSH connect failed", {
          operation: "roles_avatar_connect",
          hostId: hostIdNum,
          roleName,
          error: err.message,
        });
        return res.status(502).json({ error: "host unreachable" });
      }
      if (err instanceof RoleAvatarReadError) {
        // Silent-fallback (matches identities.ts): a broken role file OR a
        // transient SSH exec failure renders a neutral placeholder rather
        // than a 5xx. Thrown (not returned null) so it is NOT cached.
        sshLogger.debug("roles-avatar: read failed, serving 404", {
          operation: "roles_avatar_read_miss",
          hostId: hostIdNum,
          roleName,
          error: err.message,
        });
        return res.status(404).json({ error: "no avatar" });
      }
      // Any unexpected path (frontmatter-parse throw etc.) → 502 with a
      // body distinct from the pre-read "host unreachable" path.
      sshLogger.warn("roles-avatar: role file read/parse error", {
        operation: "roles_avatar_read_error",
        hostId: hostIdNum,
        roleName,
        error: err instanceof Error ? err.message : "Unknown",
      });
      return res.status(502).json({ error: "role file read error" });
    }
    if (!hit) {
      sshLogger.info("Role avatar cache fill", {
        operation: "roles_avatar_cache_fill",
        hostId: hostIdNum,
        roleName,
        found: avatar !== null,
        bytes: avatar?.bytes.byteLength ?? 0,
        ms: Date.now() - startedAt,
      });
    }

    if (avatar === null) {
      return res.status(404).json({ error: "no avatar" });
    }

    // 5. Same unversioned Cache-Control + ETag semantics as the identity
    //    avatar GET: revalidate with the ETag (cheap 304 off the server
    //    cache), serving the stale copy meanwhile.
    //
    //    Phase 90 Plan 90-10 (LOW-severity cleanup 2): a stream-side write
    //    failure surfaces as a distinct 502 body from the resolve-side
    //    "host unreachable".
    const cacheControl = "max-age=0, stale-while-revalidate=86400";
    try {
      const ifNoneMatch = req.headers["if-none-match"];
      if (ifNoneMatch && ifNoneMatch === avatar.etag) {
        res.setHeader("ETag", avatar.etag);
        res.setHeader("Cache-Control", cacheControl);
        return res.status(304).end();
      }
      res.setHeader("Content-Type", avatar.mime);
      res.setHeader("Content-Length", String(avatar.bytes.byteLength));
      res.setHeader("ETag", avatar.etag);
      res.setHeader("Cache-Control", cacheControl);
      return res.send(avatar.bytes);
    } catch (streamErr) {
      sshLogger.warn("roles-avatar: response stream write failed", {
        operation: "roles_avatar_stream_error",
        hostId: hostIdNum,
        roleName,
        error:
          streamErr instanceof Error ? streamErr.message : "Unknown",
      });
      return res.status(502).json({ error: "avatar stream error" });
    }
  },
);


/** Role avatars share the identity-avatar byte cache under this key. */
const roleAvatarCacheKey = (roleName: string): string => `role.${roleName}`;

/** SSH connect failed while filling the role-avatar cache (→ 502). */
class RoleAvatarConnectError extends Error {}
/** Role file / sibling read failed (→ 404, never cached). */
class RoleAvatarReadError extends Error {}

/**
 * Cache loader for GET /:name/avatar. REMOTE: connect + role-file read +
 * sibling read + conn.end hold ONE per-host semaphore slot (verify:ssh-cap);
 * the reads are serial on one connection. LOCAL: bind-mount, no slot.
 * Returns null when the role names no avatar or the file is absent.
 */
async function loadRoleAvatar(
  hostId: number,
  host: Awaited<ReturnType<typeof resolveHostById>>,
  roleName: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!host) return readRoleAvatarOverConn(null, roleName);
  const remoteHost = host;
  return getHostSemaphore(hostId).run(async () => {
    let conn: Awaited<ReturnType<typeof connectOneShot>>;
    try {
      conn = await connectOneShot(
        remoteHost as unknown as Parameters<typeof connectOneShot>[0],
        SSH_CONNECT_TIMEOUT_MS,
      );
    } catch (err) {
      throw new RoleAvatarConnectError(
        err instanceof Error ? err.message : "Unknown",
      );
    }
    try {
      return await readRoleAvatarOverConn(conn, roleName);
    } finally {
      try {
        conn.end();
      } catch {
        /* ignore */
      }
    }
  });
}

async function readRoleAvatarOverConn(
  conn: Awaited<ReturnType<typeof connectOneShot>> | null,
  roleName: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  let markdown: string;
  try {
    markdown = (await readRoleFileByName(conn, roleName)).markdown;
  } catch (err) {
    throw new RoleAvatarReadError(err instanceof Error ? err.message : "Unknown");
  }
  // Absence of `avatar:` field → no avatar (never null-deref).
  const cosmetics = extractCosmeticsFromFrontmatter(markdown);
  if (!cosmetics.avatar || typeof cosmetics.avatar !== "string") return null;
  try {
    return await readAvatarSiblingFileByRole(conn, roleName, cosmetics.avatar);
  } catch (err) {
    throw new RoleAvatarReadError(err instanceof Error ? err.message : "Unknown");
  }
}

/**
 * Phase 90 Plan 90-08: POST /:name/avatar?hostId=<n>
 *
 * Accepts multipart/form-data with an `avatar` file field. Writes:
 *   1. avatar bytes to `~/fleet/roles/<name>/<name>.<ext>` on target host
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
 * appending a cache-buster (?v=<timestamp>); the GET side revalidates with
 * an ETag (max-age=0) and its server cache entry is dropped here.
 */
router.post(
  "/:name/avatar",
  // Phase 103 D-10: multipart-origin-guard — CORS-simple content types don't preflight
  multipartOriginGuard,
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
  // Instance-wide roles: non-admins refused; an admin's avatar change syncs out.
  async (req: Request, res: Response, next: express.NextFunction) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (
      !(await guardInstanceWideRoleWrite(
        res,
        userId,
        Number(req.query.hostId),
        String(req.params.name),
      ))
    ) {
      return;
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
    await normalizeUploadedAvatar(req.file);

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
    // REMOTE: connect + bytes write + role-file read/rewrite + conn.end are
    // serial on one connection and hold ONE per-host semaphore slot
    // (verify:ssh-cap). LOCAL: no SSH, no slot.
    const withSlot = local
      ? <T,>(fn: () => Promise<T>): Promise<T> => fn()
      : <T,>(fn: () => Promise<T>): Promise<T> =>
          getHostSemaphore(hostIdNum).run(fn);
    return withSlot(async () => {
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
        invalidateCachedAvatarsForHost(hostIdNum);

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
        const yamlBody = yaml.dump(stringifyColorHueForYaml(overlaid), {
          sortKeys: false,
          lineWidth: -1,
          noRefs: true,
          forceQuotes: false,
        });
        let newBody = `---\n${yamlBody}---\n${bodyAfterFm}`;
        // REMOTE reads come back trimmed (execCommand trims stdout), dropping
        // the role file's trailing newline; role markdown always ends with
        // "\n" on disk, so restore it. LOCAL reads are byte-exact — unchanged.
        if (!local && !newBody.endsWith("\n")) newBody += "\n";

        // Write the markdown back. writeRoleFileByName runs its own
        // ROLE_NAME_PATTERN + byte-cap gates (identity-artifact-reader.ts L2685).
        await writeRoleFileByName(conn, roleName, newBody);
        // Frontmatter now points at the new file — drop any role-avatar cache
        // entry filled between the bytes write and this one.
        invalidateCachedAvatar(hostIdNum, roleAvatarCacheKey(roleName));

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
    });
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
