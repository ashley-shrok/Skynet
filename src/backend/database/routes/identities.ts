import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import multer from "multer";
import { createHash } from "crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import yaml from "js-yaml";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import {
  readIdentityFile,
  listIdentityKeysOnHost,
  writeIdentityFile,
  writeAvatarSiblingFile,
  readAvatarSiblingFile,
  extractCosmeticsFromFrontmatter,
  isLocalHostId,
  getLocalIdentitiesRoot,
  extractRoleFromMarkdown,
  MIME_TO_AVATAR_EXT,
  IDENTITY_KEY_RE,
  // Phase 85 Plan 85-01 Task 2: role-cosmetic merge (per-host memo in GET /
  // fanout) + role-folder avatar fallback in GET /:identityKey/avatar.
  readRoleFileByName,
  readAvatarSiblingFileByRole,
} from "../../claude-session/identity-artifact-reader.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

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

const IDENTITY_VOICE_RE = /^[A-Z][A-Za-z]+\.wav$/;

// Phase 86 code-review fix: match roles-create.ts MAX_TITLE_LENGTH so the two
// authoring surfaces (POST /roles at create, PUT /identities/:key at override)
// have consistent length semantics. Both sides trim + cap identically.
const IDENTITY_TITLE_MAX_LENGTH = 128;

type IdentityMetadata = {
  identityKey?: string;
  displayName?: string;
  title?: string | null;
  colorHue?: number | null;
  voice?: string | null;
  /** 260909-dls: avatar-revert wire. null = delete the identity's avatar
   *  frontmatter key + hard-delete sibling file (see null-delete overlay
   *  branch below). Absent = leave alone. Non-null string values via this
   *  field are ignored — avatar bytes arrive via req.file (multipart upload). */
  avatar?: string | null;
  /** Phase 66 Plan 66-02: required for the PUT disk-write flip. The
   *  frontend threads this from IdentityModal's existing `hostId` prop
   *  (which flows through per Phase 22 SRIC). The backend uses it to
   *  route the artifact-reader (isLocalHostId LOCAL branch vs
   *  connectOneShot REMOTE branch). Missing/invalid → 400. */
  hostId?: number;
};

function parseMultipartMetadata(req: Request): IdentityMetadata | null {
  if (!req.body?.data) return {};
  try {
    return JSON.parse(req.body.data);
  } catch {
    return null;
  }
}

/**
 * Phase 66 Plan 03 (moved from Plan 05 per checker B2): capitalizeFirst
 * safe-default helper. Mirrors the frontend withDisplayCap pattern at
 * src/ui/state/identities-store.ts L23-29 exactly. When disk cosmetics
 * are absent, displayName falls back to `capitalizeFirst(identityKey)`
 * so the frontend Identity type's non-nullable-string contract is
 * satisfied without widening the type.
 */
function capitalizeFirst(s: string): string {
  if (!s || s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Phase 68 Plan 68-02: publicIdentity rewired to (identityKey, hostId, cosmetics, role).
 * Drops the DB row argument entirely. avatarUrl bakes hostId as a query param.
 *
 * Phase 85 Plan 85-01 Task 2: extended to (identityKey, hostId, cosmetics, role, roleCosmetics).
 * The fifth arg carries the role's raw cosmetic frontmatter and is merged per
 * `identity ?? role ?? null` (D-CTX-85-inherit). The response gains
 * `roleDefaults` — the role's raw values so the frontend Identity modal can
 * render inherit-vs-override affordances (Plan 85-05) without a second RPC.
 *
 * Signature: publicIdentity(identityKey, hostId, cosmetics, role, roleCosmetics)
 *
 * Returned object shape (12 fields — DROPPED: id, createdAt, updatedAt):
 *   identityKey, displayName, title, colorHue, voice, task, avatarMime, avatarUrl,
 *   avatarEtag, coordinator, role, roleDefaults.
 *
 * avatarUrl = `/identities/${identityKey}/avatar?hostId=${hostId}` — hostId baked
 * into the URL string. The frontend helper avatarUrlWithHost is no longer needed
 * (Wave 3 removes it; interim: the baked URL is self-sufficient). URL shape does
 * NOT change under Phase 85's role-avatar fallback — the backend does the
 * fallback internally in GET /:identityKey/avatar; the URL is what the frontend
 * renders and stays identical.
 *
 * `cosmetics` overlay semantics (unchanged from Phase 66/67):
 *   - present string → use it (overrides safe-default)
 *   - present number for colorHue → use it (overrides null)
 *   - present boolean for coordinator → use it; absent → safe-default false (actor)
 *   - absent → falls through to roleCosmetics under Phase 85 merge
 *
 * `roleCosmetics` merge semantics (Phase 85 Plan 85-01):
 *   - null (no role or role-read failed) → resolved cosmetics fall to null
 *     safe-defaults; `roleDefaults` field emitted as null
 *   - {} (role has no cosmetic frontmatter) → resolved falls to null; but
 *     `roleDefaults` emitted as {} (frontend distinguishes "role has no
 *     defaults" from "no role" via the `role` field being non-null)
 *   - {title/colorHue/voice/avatar: ...} → each present field is merged per
 *     `identity ?? role ?? null`; `roleDefaults` echoes the role's raw values
 *     verbatim
 *
 * Exported so colocated tests (PUB-*, PUB-M-* in get-disk.test.ts) can unit-test
 * the shape directly without going through the route.
 */
export function publicIdentity(
  identityKey: string,
  hostId: number,
  cosmetics: {
    displayName?: string;
    title?: string;
    colorHue?: number;
    voice?: string;
    avatarMime?: string;
    avatarEtag?: string;
    coordinator?: boolean;
    /** Phase 80 Plan 80-03: task string from identity file frontmatter.
     *  When present-and-string, surfaced verbatim; otherwise emitted as null
     *  (matches voice/title null-fallback shape). */
    task?: string;
  } = {},
  role: string | null = null,
  /** Phase 85 Plan 85-01 Task 2: role's raw cosmetic frontmatter, merged
   *  under identity per D-CTX-85-inherit. null when no role resolvable
   *  OR when the role-read failed; {} when role exists but carries no
   *  cosmetic frontmatter fields. */
  roleCosmetics: {
    title?: string;
    colorHue?: number;
    voice?: string;
    avatar?: string;
  } | null = null,
) {
  // Phase 85: per-field merge — identity ?? role ?? null. The narrowing
  // guards (typeof/range) live in extractCosmeticsFromFrontmatter; here we
  // only need presence-check fall-through.
  const mergedTitle =
    typeof cosmetics.title === "string"
      ? cosmetics.title
      : typeof roleCosmetics?.title === "string"
        ? roleCosmetics.title
        : null;
  const mergedColorHue =
    typeof cosmetics.colorHue === "number"
      ? cosmetics.colorHue
      : typeof roleCosmetics?.colorHue === "number"
        ? roleCosmetics.colorHue
        : null;
  const mergedVoice =
    typeof cosmetics.voice === "string"
      ? cosmetics.voice
      : typeof roleCosmetics?.voice === "string"
        ? roleCosmetics.voice
        : null;

  return {
    identityKey,
    displayName:
      typeof cosmetics.displayName === "string" && cosmetics.displayName.length > 0
        ? cosmetics.displayName
        : capitalizeFirst(identityKey),
    title: mergedTitle,
    colorHue: mergedColorHue,
    voice: mergedVoice,
    // Phase 80 Plan 80-03: task surfaces on every identity object (D-05
    // write-once semantics — read straight from disk frontmatter via
    // extractCosmeticsFromFrontmatter's task narrowing). Not merged with
    // role: task is per-identity (D-05 write-once at birth).
    task: typeof cosmetics.task === "string" ? cosmetics.task : null,
    avatarMime:
      typeof cosmetics.avatarMime === "string" ? cosmetics.avatarMime : "",
    // Phase 68: hostId baked into avatarUrl so the frontend no longer needs
    // to append it via avatarUrlWithHost (Wave 3 removes that helper).
    // Phase 85: URL shape unchanged — backend does role-folder fallback
    // internally in GET /:identityKey/avatar handler.
    avatarUrl: `/identities/${identityKey}/avatar?hostId=${hostId}`,
    avatarEtag:
      typeof cosmetics.avatarEtag === "string" ? cosmetics.avatarEtag : "",
    // Phase 67 Plan 67-01: coordinator overlay. Absence = actor = false (safe-default).
    coordinator: typeof cosmetics.coordinator === "boolean" ? cosmetics.coordinator : false,
    role,
    // Phase 85 Plan 85-01: roleDefaults echoes the role's raw cosmetic
    // values so IdentityModal (Plan 85-05) can render inherit-vs-override
    // affordances. null when no role; {} when role has no cosmetics.
    roleDefaults: roleCosmetics,
  };
}

// Phase 66 Plan 03: GET / accepts an optional `identityHosts` query param
// (URL-encoded JSON map `{ identityKey: hostId }`). For each row whose key
// is IN the map, we per-request lazy-fetch the identity's on-disk .md file
// via the artifact-reader on the caller-specified box and overlay the
// parsed cosmetics onto publicIdentity(). Rows with no hostId in the map,
// or whose disk fetch fails (unreachable / missing / malformed), come back
// with SAFE-DEFAULT cosmetics for that row (publicIdentity emits
// capitalizeFirst(identityKey) + null-nullables + ""-for-non-null-strings).
// The endpoint NEVER errors 5xx due to a per-row fetch failure — Ashley
// greenlit "accept the ugly render" per the shape file.
//
// Plan 05 (wave 3) rewires the frontend caller to pass a populated
// identityHosts map from conversation-store fleetSessions; in the transition
// window (Plan 03 shipped, Plan 05 pending) the map arrives as `{}` and
// every row comes back with safe-defaults on first render.
function parseIdentityHosts(raw: unknown): Record<string, number> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isInteger(v) && v > 0) {
        out[k.toLowerCase()] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

// Phase 68 disk-fanout enumeration. No DB SELECT. Fans out to unique hostIds
// from identityHosts map; per-host silent-swallow on error; first-host-wins
// on cross-host identityKey collision (explicitly deferred per CONTEXT.md § Scope edges).
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    // 1. Parse identityHosts from query param.
    const identityHosts = parseIdentityHosts(req.query.identityHosts);

    // 2. Empty map → no hosts to fan out to.
    if (Object.keys(identityHosts).length === 0) {
      return res.json([]);
    }

    // 3. Collect unique hostIds (Set preserves insertion order on iteration).
    const uniqueHostIds = [...new Set(Object.values(identityHosts))];

    // 4. Per-host fanout via Promise.all. Each host returns an array of publicIdentity objects.
    //    Per-host try/catch provides silent-swallow: one dead box does not break the
    //    endpoint — it just contributes zero identities (T-68-02-02, T-68-02-03).
    const perHostResults = await Promise.all(
      uniqueHostIds.map(async (hostId): Promise<ReturnType<typeof publicIdentity>[]> => {
        try {
          const local = isLocalHostId(hostId);
          let conn: import("ssh2").Client | null = null;

          if (!local) {
            const host = await resolveHostById(hostId, userId);
            if (!host) return [];
            conn = await connectOneShot(host, 5_000);
          }

          try {
            // Enumerate keys on this host.
            const identityKeys = await listIdentityKeysOnHost(conn);

            // Phase 85 Plan 85-01 Task 2: per-host role-cosmetics memo.
            // Multiple identities of the same role on the same host must
            // read the role file AT MOST ONCE (T-85-01-03 DoS mitigation).
            // Map<roleName, Promise<cosmetics-or-{}-on-error>>. Storing the
            // in-flight Promise (not the resolved value) collapses parallel
            // reads within the same Promise.all fanout — the second caller
            // awaits the first caller's in-flight readRoleFileByName rather
            // than kicking off a second SSH exec. Lives inside the per-host
            // try block so it's fresh per request, not module-global.
            const roleReadCache = new Map<
              string,
              Promise<ReturnType<typeof extractCosmeticsFromFrontmatter>>
            >();
            const readRoleCosmeticsMemoized = (
              roleName: string,
            ): Promise<ReturnType<typeof extractCosmeticsFromFrontmatter>> => {
              const existing = roleReadCache.get(roleName);
              if (existing !== undefined) return existing;
              const p = (async () => {
                try {
                  const { markdown: roleMd } = await readRoleFileByName(
                    conn,
                    roleName,
                  );
                  return roleMd ? extractCosmeticsFromFrontmatter(roleMd) : {};
                } catch {
                  // Silent-swallow: role read failed. Identity still surfaces
                  // with its own cosmetics + roleDefaults={} so frontend
                  // distinguishes "role has no defaults" from "no role" via
                  // the `role` field being non-null.
                  return {} as ReturnType<typeof extractCosmeticsFromFrontmatter>;
                }
              })();
              roleReadCache.set(roleName, p);
              return p;
            };

            // Per-key parallel read of cosmetics + role.
            const identityList = await Promise.all(
              identityKeys.map(async (identityKey) => {
                try {
                  const { markdown } = await readIdentityFile(conn, identityKey);
                  const cosmetics = extractCosmeticsFromFrontmatter(markdown);
                  const role = extractRoleFromMarkdown(markdown) ?? null;

                  // Phase 85: resolve role cosmetics via per-host memo.
                  // No role → pass null so publicIdentity emits roleDefaults=null.
                  const roleCosmetics =
                    role !== null
                      ? await readRoleCosmeticsMemoized(role)
                      : null;

                  return publicIdentity(
                    identityKey,
                    hostId,
                    cosmetics,
                    role,
                    roleCosmetics,
                  );
                } catch {
                  // Per-key failure swallowed — skip this key.
                  return null;
                }
              }),
            );

            return identityList.filter((x): x is ReturnType<typeof publicIdentity> => x !== null);
          } finally {
            if (conn) {
              try { conn.end(); } catch { /* ignore */ }
            }
          }
        } catch {
          // Per-host silent-swallow: unreachable host contributes zero identities.
          // Server logs receive the failure via databaseLogger (T-68-02-03).
          return [];
        }
      }),
    );

    // 5. Flatten per-host arrays into a single merged list.
    const flatList = perHostResults.flat();

    // 6. Dedupe on identityKey (first-host-wins by iteration order per T-68-02-05).
    const seen = new Set<string>();
    const merged: ReturnType<typeof publicIdentity>[] = [];
    for (const identity of flatList) {
      if (!seen.has(identity.identityKey)) {
        seen.add(identity.identityKey);
        merged.push(identity);
      }
    }

    return res.json(merged);
  } catch (e) {
    databaseLogger.error("Failed to list identities", e, {
      operation: "list_identities",
      userId,
    });
    return res.status(500).json({ error: "Failed to list identities" });
  }
});

// Phase 68 Plan 68-02: POST / — Option A (410 GONE). The raw-POST create flow is
// retired; identity creation goes through POST /identities/birth (identity-birth.ts)
// which handles disk-side work (create folder, write frontmatter, save avatar).
// Wave 4 removes identity-birth.ts's DB INSERT as part of the table drop.
router.post("/", authenticateJWT, (_req: Request, res: Response) => {
  return res.status(410).json({
    error: "POST /identities is retired — use POST /identities/birth to create new identities",
  });
});

// Phase 68 Plan 68-02: PUT /:identityKey rekeyed from /:id.
// Row lookup, row bump, and forceSave all removed — disk write is the sole side-effect.
// Phase 68: no row bump means no forceSave (disk write already fsynced by
// writeMarkdownFileAtomic + writeAvatarSiblingFile from Phase 66 Plan 66-01 Track 1).
router.put(
  "/:identityKey",
  authenticateJWT,
  upload.single("avatar"),
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const identityKey = String(req.params.identityKey);
    // Route param becomes disk path + SSH command interpolation via readIdentityFile /
    // writeIdentityFile. Gate BEFORE any of those touch it so `../etc/passwd` and
    // shell-metachar names can't reach the filesystem or shell.
    if (!IDENTITY_KEY_RE.test(identityKey)) {
      return res.status(400).json({
        error: "identityKey must match [a-z0-9_-]{1,64}",
      });
    }
    const meta = parseMultipartMetadata(req);
    if (meta === null) {
      return res.status(400).json({ error: "Invalid JSON in data field" });
    }

    // hostId is required in the PUT body — routes the artifact-reader (LOCAL vs REMOTE).
    // Validate BEFORE SSH work so a bad payload fails fast.
    const hostId = meta.hostId;
    if (
      typeof hostId !== "number" ||
      !Number.isFinite(hostId) ||
      !Number.isInteger(hostId) ||
      hostId <= 0
    ) {
      return res
        .status(400)
        .json({ error: "hostId required in request body (positive integer)" });
    }

    // Field-shape validation — still needed BEFORE the disk-write branch so a bad
    // hue/voice fails fast.
    if (meta.displayName !== undefined) {
      const dn = String(meta.displayName).trim();
      if (!dn) {
        return res
          .status(400)
          .json({ error: "displayName cannot be empty" });
      }
    }
    // Phase 86 code-review fix (H1 + H2): title empty-string → coerce to null
    // (matches frontend IdentityModal semantics that empty-after-trim = revert
    // to role default), and cap length to IDENTITY_TITLE_MAX_LENGTH matching
    // roles-create.ts. Coercion happens BEFORE the overlay branch so the
    // downstream `meta.title === null ? delete : set` logic sees a normalized
    // value.
    if (meta.title !== undefined && meta.title !== null) {
      const t = String(meta.title);
      if (t.trim() === "") {
        meta.title = null;
      } else if (t.length > IDENTITY_TITLE_MAX_LENGTH) {
        return res
          .status(400)
          .json({ error: `title must be ≤${IDENTITY_TITLE_MAX_LENGTH} chars` });
      }
    }
    if (
      meta.colorHue !== undefined &&
      meta.colorHue !== null &&
      (typeof meta.colorHue !== "number" ||
        meta.colorHue < 0 ||
        meta.colorHue > 359)
    ) {
      return res.status(400).json({ error: "colorHue must be 0-359" });
    }
    if (
      meta.voice !== undefined &&
      meta.voice !== null &&
      (typeof meta.voice !== "string" || !IDENTITY_VOICE_RE.test(meta.voice))
    ) {
      return res
        .status(400)
        .json({ error: "voice must match [A-Z][A-Za-z]+\\.wav" });
    }

    // Route via isLocalHostId (module-load parsed IDENTITIES_LOCAL_HOST_IDS
    // allowlist). LOCAL → conn=null, no SSH. REMOTE → resolveHostById +
    // connectOneShot; failure = 502.
    const local = isLocalHostId(hostId);
    let conn: import("ssh2").Client | null = null;

    if (!local) {
      try {
        const host = await resolveHostById(hostId, userId);
        if (!host) {
          return res
            .status(502)
            .json({ error: "identity home box unreachable" });
        }
        conn = await connectOneShot(host, 30_000);
      } catch (connErr) {
        databaseLogger.warn("PUT /identities/:identityKey — SSH connect failed", {
          operation: "update_identity_ssh_connect_failed",
          userId,
          identityKey,
          hostId,
          error:
            connErr instanceof Error ? connErr.message : "Unknown error",
        });
        return res
          .status(502)
          .json({ error: "identity home box unreachable" });
      }
    }

    try {
      // ---- Read the existing on-disk identity file ----
      const { markdown: existing } = await readIdentityFile(conn, identityKey);
      if (!existing || existing.length === 0) {
        // Data-integrity violation: the identity's home is supposed to hold the .md
        // file. No implicit-create (shape file: "error and move on"). Canned message
        // per threat T-66-02-04 / T-68-02-04.
        return res
          .status(500)
          .json({ error: "identity file missing on target host" });
      }

      // ---- Parse frontmatter ----
      const fmMatch = existing.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      let overlaid: Record<string, unknown> = {};
      let bodyAfterFm = existing;
      if (fmMatch) {
        try {
          const parsed = yaml.load(fmMatch[1]) as
            | Record<string, unknown>
            | null;
          if (parsed && typeof parsed === "object") {
            overlaid = { ...parsed };
          }
        } catch (yamlErr) {
          // Malformed frontmatter YAML — do NOT silently reset to {} because
          // that would drop the mandatory `role:` pointer (and anything else
          // the identity carried) on the next write, permanently bricking the
          // identity for every downstream artifact reader. Fail loud instead;
          // the operator must repair the frontmatter on disk before Skynet
          // will touch it again. (Code review HIGH #1, 2026-09-01.)
          databaseLogger.warn(
            "identity update: existing frontmatter YAML malformed — refusing overlay",
            {
              operation: "identity_update_frontmatter_parse",
              userId,
              identityKey,
              error: yamlErr instanceof Error ? yamlErr.message : "Unknown",
            },
          );
          return res.status(500).json({
            error:
              "existing identity frontmatter is malformed — repair on disk before editing",
          });
        }
        bodyAfterFm = existing.slice(fmMatch[0].length);
        // Strip a leading newline after the closing `---` (we re-add \n in
        // the emit below). If the original body starts with \n we keep the
        // rest verbatim.
        if (bodyAfterFm.startsWith("\n")) {
          bodyAfterFm = bodyAfterFm.slice(1);
        } else if (bodyAfterFm.startsWith("\r\n")) {
          bodyAfterFm = bodyAfterFm.slice(2);
        }
      }

      // Capture old avatar ext (if any) for post-write cleanup
      const oldAvatar =
        typeof overlaid.avatar === "string" ? overlaid.avatar : null;
      const oldExt =
        oldAvatar && oldAvatar.startsWith(`${identityKey}.`)
          ? oldAvatar.slice(identityKey.length + 1)
          : null;

      // ---- Overlay changed fields ----
      // absent → leave alone; explicit null → REMOVE; present → set.
      if (meta.displayName !== undefined) {
        // Empty string already rejected above.
        overlaid.displayName = String(meta.displayName).trim();
      }
      if (meta.title !== undefined) {
        if (meta.title === null) delete overlaid.title;
        else overlaid.title = String(meta.title);
      }
      if (meta.colorHue !== undefined) {
        if (meta.colorHue === null) delete overlaid.colorHue;
        else overlaid.colorHue = meta.colorHue;
      }
      if (meta.voice !== undefined) {
        if (meta.voice === null) delete overlaid.voice;
        else overlaid.voice = meta.voice;
      }
      if (meta.avatar !== undefined) {
        if (meta.avatar === null) delete overlaid.avatar;
        // Non-null values in meta.avatar are silently ignored — avatar bytes
        // arrive via req.file (multipart upload) at the "---- Avatar handling
        // ----" block below, NOT via the JSON meta payload. Only the null-
        // revert case is meaningful here.
      }

      // ---- Avatar handling ----
      let newExt: string | null = null;
      if (req.file) {
        const mapped = MIME_TO_AVATAR_EXT[req.file.mimetype];
        if (!mapped) {
          return res
            .status(415)
            .json({ error: "Avatar must be PNG, JPEG, or WebP" });
        }
        newExt = mapped;
        overlaid.avatar = `${identityKey}.${newExt}`;
      }

      // ---- Emit new file body ----
      const yamlBody = yaml.dump(overlaid, {
        sortKeys: false,
        lineWidth: -1,
        noRefs: true,
        forceQuotes: false,
      });
      const newBody = `---\n${yamlBody}---\n${bodyAfterFm}`;

      // ---- Write markdown ----
      await writeIdentityFile(conn, identityKey, newBody);

      // ---- Write avatar sibling (if new bytes) ----
      if (req.file && newExt) {
        await writeAvatarSiblingFile(
          conn,
          identityKey,
          newExt as import("../../claude-session/identity-artifact-reader.js").AvatarExt,
          req.file.buffer,
        );

        // Ext-swap cleanup: hard-delete the old sibling file. Best-effort
        // (missing-file is fine — this is opportunistic hygiene, not a
        // correctness guarantee).
        if (oldExt && oldExt !== newExt) {
          if (local) {
            const oldPath = path.join(
              getLocalIdentitiesRoot(),
              identityKey,
              `${identityKey}.${oldExt}`,
            );
            await fs.unlink(oldPath).catch(() => {
              /* best-effort */
            });
          } else if (conn) {
            await execCommand(
              conn,
              `rm -f "$HOME/.claude/identities/${identityKey}/${identityKey}.${oldExt}"`,
            ).catch(() => {
              /* best-effort */
            });
          }
        }
      }

      // 260909-dls: avatar-revert sibling-file cleanup. When the null-delete
      // branch above ran AND the identity previously had an avatar override,
      // hard-delete the sibling file on disk. Best-effort (missing file is
      // fine — matches the ext-swap cleanup pattern above). Ordering:
      // this runs AFTER writeIdentityFile so the frontmatter delete is
      // persisted before the sibling removal. A mid-motion crash between
      // the two steps leaves an orphaned sibling file, but readers correctly
      // fall back to the role's avatar via Phase 86 Plan 86-01, so the
      // invariant holds.
      if (meta.avatar === null && oldAvatar) {
        if (local) {
          const oldPath = path.join(
            getLocalIdentitiesRoot(),
            identityKey,
            oldAvatar,
          );
          await fs.unlink(oldPath).catch(() => {
            /* best-effort */
          });
        } else if (conn) {
          await execCommand(
            conn,
            `rm -f "$HOME/.claude/identities/${identityKey}/${oldAvatar}"`,
          ).catch(() => {
            /* best-effort */
          });
        }
      }

      // ---- Post-write re-read for response echo ----
      // Re-read the identity's on-disk cosmetics AFTER the write completes and overlay
      // them onto publicIdentity so the response echoes the true state — most notably
      // the coordinator flag, which is disk-authoritative (Phase 67 Plan 67-01).
      // Errors during the read → fall back to safe-defaults (empty cosmetics).
      let echoCosmetics: ReturnType<typeof extractCosmeticsFromFrontmatter> = {};
      let postWriteMd = "";
      try {
        const readResult = await readIdentityFile(conn, identityKey);
        postWriteMd = readResult.markdown ?? "";
        if (postWriteMd && postWriteMd.length > 0) {
          echoCosmetics = extractCosmeticsFromFrontmatter(postWriteMd);
        }
      } catch {
        // Swallow — response falls back to safe-defaults (empty cosmetics).
        echoCosmetics = {};
      }

      // Phase 85 Plan 85-01 Task 2: PUT response echo must also carry
      // roleDefaults so the frontend gets the same merged shape it receives
      // on GET /identities. Reads the role file once after the write; role
      // read failure → pass {} (identity's own values still surface).
      const roleName = extractRoleFromMarkdown(postWriteMd);
      let echoRoleCosmetics:
        | ReturnType<typeof extractCosmeticsFromFrontmatter>
        | null = null;
      if (roleName !== null) {
        try {
          const { markdown: roleMd } = await readRoleFileByName(conn, roleName);
          echoRoleCosmetics = roleMd
            ? extractCosmeticsFromFrontmatter(roleMd)
            : {};
        } catch {
          echoRoleCosmetics = {};
        }
      }

      return res.json(
        publicIdentity(
          identityKey,
          hostId,
          echoCosmetics,
          roleName ?? null,
          echoRoleCosmetics,
        ),
      );
    } catch (e) {
      databaseLogger.error("Failed to update identity on disk", e, {
        operation: "update_identity_disk_write",
        userId,
        identityKey,
      });
      return res.status(500).json({ error: "Failed to update identity" });
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


// Phase 68 Plan 68-02: GET /:identityKey/avatar rekeyed from /:id/avatar.
// Row lookup removed — the URL param IS the identityKey used by readAvatarSiblingFile.
// Identity's on-disk existence check falls to readAvatarSiblingFile's null return.
router.get(
  "/:identityKey/avatar",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const identityKey = String(req.params.identityKey);
    // readAvatarSiblingFile self-validates identityKey, but return a clean 400 here
    // rather than a downstream null-as-404 so bad callers get an actionable error.
    if (!IDENTITY_KEY_RE.test(identityKey)) {
      return res.status(400).json({
        error: "identityKey must match [a-z0-9_-]{1,64}",
      });
    }

    // hostId query validation — fail fast BEFORE SSH work.
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

    // No row lookup — identityKey from URL param feeds directly into
    // readAvatarSiblingFile's shell interpolation, guarded by IDENTITY_KEY_RE
    // pre-validation in the artifact-reader (T-68-02-01).
    const local = isLocalHostId(hostIdNum);
    let conn: import("ssh2").Client | null = null;
    if (!local) {
      try {
        const host = await resolveHostById(hostIdNum, userId);
        if (!host) {
          return res
            .status(502)
            .json({ error: "identity home box unreachable" });
        }
        conn = await connectOneShot(host, 5_000);
      } catch {
        return res
          .status(502)
          .json({ error: "identity home box unreachable" });
      }
    }

    try {
      let readResult = await readAvatarSiblingFile(conn, identityKey);

      // Phase 85 Plan 85-01 Task 2: role-folder avatar fallback. When the
      // identity has no sibling avatar of its own, resolve the identity's
      // role via its markdown frontmatter; if the role's frontmatter names
      // an avatar filename AND the role folder holds that sibling, serve
      // the role's shared avatar. Only 404 if BOTH branches return null.
      // Any error in the role-side chain is treated as "no fallback found"
      // (falls through to 404) — never surfaces as 5xx here.
      if (readResult === null) {
        try {
          const { markdown } = await readIdentityFile(conn, identityKey);
          const role = extractRoleFromMarkdown(markdown);
          if (role !== null) {
            const { markdown: roleMd } = await readRoleFileByName(conn, role);
            if (roleMd) {
              const roleCos = extractCosmeticsFromFrontmatter(roleMd);
              if (typeof roleCos.avatar === "string" && roleCos.avatar.length > 0) {
                readResult = await readAvatarSiblingFileByRole(
                  conn,
                  role,
                  roleCos.avatar,
                );
              }
            }
          }
        } catch {
          // Silent — role-side chain error → no fallback (existing 404 path).
        }
      }

      if (readResult === null) {
        return res
          .status(404)
          .json({ error: "no avatar on disk for this identity" });
      }

      // ETag is per-response, not stored server-side — kept for correctness
      // (identifies the resource version) even though `no-store` below tells
      // the browser not to cache the bytes at all. Every render on every
      // viewer reaches the identity's home for the current bytes, matching
      // Ashley's intent stated at /close 2026-09-01.
      const etag = `"disk-${createHash("md5").update(readResult.bytes).digest("hex")}"`;
      const ifNoneMatch = req.headers["if-none-match"];
      if (ifNoneMatch && ifNoneMatch === etag) {
        return res.status(304).end();
      }
      res.setHeader("Content-Type", readResult.mime);
      res.setHeader("Content-Length", String(readResult.bytes.byteLength));
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "no-store");
      return res.send(readResult.bytes);
    } catch {
      // SSH-layer / SFTP error → 502 with canned message (T-68-02-01);
      // never leak raw SSH exceptions into the response body.
      return res
        .status(502)
        .json({ error: "identity home box unreachable" });
    } finally {
      if (conn) {
        try { conn.end(); } catch { /* ignore */ }
      }
    }
  },
);

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
    return res
      .status(500)
      .json({ error: err?.message ?? "Identity route error" });
  },
);

export default router;
