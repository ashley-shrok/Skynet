import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import multer from "multer";
import { createHash } from "crypto";
import { nanoid } from "nanoid";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import yaml from "js-yaml";
import { db } from "../db/index.js";
import { identities } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import {
  readIdentityFile,
  writeIdentityFile,
  writeAvatarSiblingFile,
  readAvatarSiblingFile,
  extractCosmeticsFromFrontmatter,
  isLocalHostId,
  getLocalIdentitiesRoot,
  extractRoleFromMarkdown,
  MIME_TO_AVATAR_EXT,
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
const IDENTITY_KEY_RE = /^[a-z0-9._=/+-]+$/;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_AVATAR_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error("Avatar must be PNG, JPEG, or WebP"));
  },
});

const IDENTITY_VOICE_RE = /^[A-Z][A-Za-z]+\.wav$/;

type IdentityMetadata = {
  identityKey?: string;
  displayName?: string;
  title?: string | null;
  colorHue?: number | null;
  voice?: string | null;
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
 * Phase 66: safe-defaults for the frontend Identity type's non-nullable-string
 * fields (displayName/avatarMime/avatarEtag). Disk-overlay populates when
 * identityHosts is supplied AND cosmetics exist on disk; safe defaults
 * otherwise satisfy TSC without widening the Identity type (Plan 05 defers
 * the type widening as bigger blast radius). Moved from Plan 05 to Plan 03
 * per checker B2 — co-located with the READ flip that creates the
 * null-cosmetics scenario, so this plan's own tests exercise the
 * safe-defaults path.
 *
 * `cosmetics` overlay semantics:
 *   - present string → use it (overrides safe-default)
 *   - present number for colorHue → use it (overrides null)
 *   - present boolean for coordinator → use it; absent → safe-default false (actor)
 *   - absent → safe-default (displayName=capitalizeFirst(identityKey);
 *     title/colorHue/voice → null; avatarMime/avatarEtag → "")
 *
 * Phase 67 Plan 67-01 exports this function so the colocated PUB-* tests
 * can exercise it directly (routes still call it from within the module).
 *
 * The `role` argument is preserved (used only by pre-flip tests; kept for
 * signature compatibility with any surviving caller).
 */
export function publicIdentity(
  row: typeof identities.$inferSelect,
  cosmetics: {
    displayName?: string;
    title?: string;
    colorHue?: number;
    voice?: string;
    avatarMime?: string;
    avatarEtag?: string;
    coordinator?: boolean;
  } = {},
  role: string | null = null,
) {
  return {
    id: row.id,
    identityKey: row.identityKey,
    displayName:
      typeof cosmetics.displayName === "string" && cosmetics.displayName.length > 0
        ? cosmetics.displayName
        : capitalizeFirst(row.identityKey),
    title: typeof cosmetics.title === "string" ? cosmetics.title : null,
    colorHue: typeof cosmetics.colorHue === "number" ? cosmetics.colorHue : null,
    voice: typeof cosmetics.voice === "string" ? cosmetics.voice : null,
    avatarMime:
      typeof cosmetics.avatarMime === "string" ? cosmetics.avatarMime : "",
    avatarUrl: `/identities/${row.id}/avatar`,
    avatarEtag:
      typeof cosmetics.avatarEtag === "string" ? cosmetics.avatarEtag : "",
    // Phase 67 Plan 67-01: coordinator overlay. Absence = actor = false
    // safe-default (mirrors the avatarMime/avatarEtag non-nullable-safe-default
    // pattern; the frontend Identity type has coordinator: boolean, not
    // boolean | null, so this shape is load-bearing for TSC).
    coordinator: typeof cosmetics.coordinator === "boolean" ? cosmetics.coordinator : false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    role,
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

router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const rows = db
      .select()
      .from(identities)
      .where(eq(identities.userId, userId))
      .all();

    const identityHosts = parseIdentityHosts(req.query.identityHosts);

    // Per-row parallel fetch via Promise.allSettled — bounds wall-clock so a
    // single slow box doesn't stretch the endpoint past the sum of per-row
    // 5s connect timeouts (T-66-03-01). Rows not in identityHosts skip the
    // SSH work entirely and go straight to safe-defaults publicIdentity.
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const keyLc = row.identityKey.toLowerCase();
        const hostId = identityHosts[keyLc];
        if (hostId === undefined) {
          // No hostId in caller-scoped map → safe-defaults for this row.
          return publicIdentity(row, {});
        }
        // Fetch cosmetics from disk. Swallow ALL errors → safe-defaults.
        try {
          const local = isLocalHostId(hostId);
          let conn: import("ssh2").Client | null = null;
          if (!local) {
            const host = await resolveHostById(hostId, userId);
            if (!host) return publicIdentity(row, {});
            conn = await connectOneShot(host, 5_000);
          }
          try {
            const { markdown } = await readIdentityFile(conn, row.identityKey);
            if (!markdown || markdown.length === 0) return publicIdentity(row, {});
            const cos = extractCosmeticsFromFrontmatter(markdown);
            return publicIdentity(row, cos);
          } finally {
            if (conn) {
              try { conn.end(); } catch { /* ignore */ }
            }
          }
        } catch {
          // Per-shape "cosmetics unfetchable → error state" scoped to this
          // row (not the whole endpoint). Row still appears in the response
          // with safe-default cosmetics.
          return publicIdentity(row, {});
        }
      }),
    );

    return res.json(enriched);
  } catch (e) {
    databaseLogger.error("Failed to list identities", e, {
      operation: "list_identities",
      userId,
    });
    return res.status(500).json({ error: "Failed to list identities" });
  }
});

router.post(
  "/",
  authenticateJWT,
  upload.single("avatar"),
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const meta = parseMultipartMetadata(req);
    if (meta === null) {
      return res.status(400).json({ error: "Invalid JSON in data field" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Avatar file is required" });
    }
    const identityKey = (meta.identityKey ?? "").toLowerCase().trim();
    const displayName = (meta.displayName ?? "").trim();
    if (!identityKey || !IDENTITY_KEY_RE.test(identityKey)) {
      return res
        .status(400)
        .json({ error: "identityKey must match [a-z0-9._=/+-]+" });
    }
    if (!displayName) {
      return res.status(400).json({ error: "displayName is required" });
    }
    if (
      meta.colorHue != null &&
      (typeof meta.colorHue !== "number" ||
        meta.colorHue < 0 ||
        meta.colorHue > 359)
    ) {
      return res.status(400).json({ error: "colorHue must be 0-359" });
    }

    try {
      const existing = db
        .select()
        .from(identities)
        .where(
          and(
            eq(identities.userId, userId),
            eq(identities.identityKey, identityKey),
          ),
        )
        .all();
      if (existing.length > 0) {
        return res
          .status(409)
          .json({ error: `Identity "${identityKey}" already exists` });
      }

      // Phase 66 Plan 04: cosmetic fields are written to disk in a separate
      // step (identity-birth is the fresh-identity path per Plan 01); the
      // POST / handler retains the multipart validation but does NOT persist
      // displayName/title/colorHue/voice/avatarMime/avatarData/avatarEtag to
      // the store. This handler is legacy for the deprecated raw-POST flow
      // and returns cosmetics-absent (publicIdentity emits Plan 03's
      // safe-defaults contract when the overlay is empty).
      const id = nanoid();
      const now = new Date().toISOString();
      db.insert(identities)
        .values({
          id,
          userId,
          identityKey,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const row = db
        .select()
        .from(identities)
        .where(eq(identities.id, id))
        .all()[0];
      try {
        await DatabaseSaveTrigger.forceSave("identity_created");
      } catch (saveErr) {
        databaseLogger.warn("Force-save after identity create failed", {
          operation: "identity_create_save_failed",
          userId,
          identityKey,
          error: saveErr instanceof Error ? saveErr.message : "Unknown error",
        });
      }
      return res.status(201).json(publicIdentity(row));
    } catch (e) {
      databaseLogger.error("Failed to create identity", e, {
        operation: "create_identity",
        userId,
        identityKey,
      });
      return res.status(500).json({ error: "Failed to create identity" });
    }
  },
);

// Phase 66 Plan 66-02: cosmetics (displayName / title / colorHue / voice /
// avatar) are written to disk via the artifact-reader; the store row bumps
// updatedAt only. See CONTEXT.md § Track 2 and 66-02-PLAN.md.
router.put(
  "/:id",
  authenticateJWT,
  upload.single("avatar"),
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = String(req.params.id);
    const meta = parseMultipartMetadata(req);
    if (meta === null) {
      return res.status(400).json({ error: "Invalid JSON in data field" });
    }

    // Phase 66 Plan 66-02: hostId is required in the PUT body — the
    // disk-write flip needs it to route the artifact-reader (LOCAL vs
    // REMOTE branch). Validate BEFORE the row lookup so a bad payload
    // fails fast without touching the DB.
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

    // Field-shape validation (mirrors pre-flip handler; still needed BEFORE
    // reaching the disk-write branch so a bad hue/voice fails fast).
    if (meta.displayName !== undefined) {
      const dn = String(meta.displayName).trim();
      if (!dn) {
        return res
          .status(400)
          .json({ error: "displayName cannot be empty" });
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

    let row: typeof identities.$inferSelect | undefined;
    try {
      const existing = db
        .select()
        .from(identities)
        .where(and(eq(identities.id, id), eq(identities.userId, userId)))
        .all();
      if (existing.length === 0) {
        return res.status(404).json({ error: "Identity not found" });
      }
      row = existing[0];
    } catch (e) {
      databaseLogger.error("Failed to load identity for update", e, {
        operation: "update_identity_lookup",
        userId,
        id,
      });
      return res.status(500).json({ error: "Failed to update identity" });
    }

    const identityKey = row.identityKey;

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
        databaseLogger.warn("PUT /identities/:id — SSH connect failed", {
          operation: "update_identity_ssh_connect_failed",
          userId,
          id,
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
        // Data-integrity violation post-Phase-A: the identity's home is
        // supposed to hold the .md file. No offline fallback (shape file:
        // "error and move on"). Canned message per threat T-66-02-04.
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

      // ---- Bump store row updatedAt ONLY (cosmetics moved to disk) ----
      const nowIso = new Date().toISOString();
      try {
        db.update(identities)
          .set({ updatedAt: nowIso })
          .where(and(eq(identities.id, id), eq(identities.userId, userId)))
          .run();
      } catch (updErr) {
        databaseLogger.warn("Force-updatedAt bump after disk-write failed", {
          operation: "update_identity_row_bump_failed",
          userId,
          id,
          error: updErr instanceof Error ? updErr.message : "Unknown error",
        });
      }
      try {
        await DatabaseSaveTrigger.forceSave("identity_updated");
      } catch (saveErr) {
        databaseLogger.warn("Force-save after identity update failed", {
          operation: "identity_update_save_failed",
          userId,
          id,
          error: saveErr instanceof Error ? saveErr.message : "Unknown error",
        });
      }

      const freshRow = db
        .select()
        .from(identities)
        .where(eq(identities.id, id))
        .all()[0];
      // Phase 67 /close 2026-09-01 follow-up (H1): re-read the identity's
      // on-disk cosmetics AFTER the write completes and overlay them onto
      // publicIdentity so the response echoes the true state — most notably
      // the coordinator flag, which is disk-authoritative (Phase 67 Plan
      // 67-01). Without this overlay, publicIdentity safe-defaults
      // coordinator to false and the frontend's applyIdentityChange replaces
      // the store entry, dropping the watermark across all surfaces until
      // the next refreshIdentities() cycle. As a side benefit this closes
      // the pre-existing "stale echo" TODO for title/colorHue/voice/
      // avatarMime/avatarEtag: the response now reflects what was actually
      // written to disk. Errors during the read fall back to
      // publicIdentity(freshRow) with safe-defaults (matches GET / per-row
      // fetch-failure behavior — accept-the-ugly-render).
      let echoCosmetics: ReturnType<typeof extractCosmeticsFromFrontmatter> = {};
      try {
        const { markdown: postWriteMd } = await readIdentityFile(conn, identityKey);
        if (postWriteMd && postWriteMd.length > 0) {
          echoCosmetics = extractCosmeticsFromFrontmatter(postWriteMd);
        }
      } catch {
        // Swallow — response falls back to safe-defaults (empty cosmetics).
        echoCosmetics = {};
      }
      return res.json(publicIdentity(freshRow, echoCosmetics));
    } catch (e) {
      databaseLogger.error("Failed to update identity on disk", e, {
        operation: "update_identity_disk_write",
        userId,
        id,
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

router.delete("/:id", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const id = String(req.params.id);
  try {
    const result = db
      .delete(identities)
      .where(and(eq(identities.id, id), eq(identities.userId, userId)))
      .run();
    if (result.changes === 0) {
      return res.status(404).json({ error: "Identity not found" });
    }
    try {
      await DatabaseSaveTrigger.forceSave("identity_deleted");
    } catch (saveErr) {
      databaseLogger.warn("Force-save after identity delete failed", {
        operation: "identity_delete_save_failed",
        userId,
        id,
        error: saveErr instanceof Error ? saveErr.message : "Unknown error",
      });
    }
    return res.status(204).send();
  } catch (e) {
    databaseLogger.error("Failed to delete identity", e, {
      operation: "delete_identity",
      userId,
      id,
    });
    return res.status(500).json({ error: "Failed to delete identity" });
  }
});

// Phase 66 Plan 03: GET /:id/avatar reads the sibling avatar file from disk
// via readAvatarSiblingFile. Query `hostId=<n>` is required to route the
// artifact-reader (LOCAL bind-mount vs REMOTE connectOneShot). Response
// Content-Type derives from the on-disk file's extension. 404 when no
// sibling exists; 502 when SSH fails.
router.get(
  "/:id/avatar",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = String(req.params.id);

    // hostId query validation — fail fast BEFORE the row lookup or SSH work.
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

    try {
      const row = db
        .select()
        .from(identities)
        .where(and(eq(identities.id, id), eq(identities.userId, userId)))
        .all()[0];
      if (!row) {
        return res.status(404).json({ error: "Identity not found" });
      }

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
        const readResult = await readAvatarSiblingFile(conn, row.identityKey);
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
        // SSH-layer / SFTP error → 502 with canned message (T-66-03-02);
        // never leak raw SSH exceptions into the response body.
        return res
          .status(502)
          .json({ error: "identity home box unreachable" });
      } finally {
        if (conn) {
          try { conn.end(); } catch { /* ignore */ }
        }
      }
    } catch (e) {
      databaseLogger.error("Failed to serve avatar", e, {
        operation: "get_identity_avatar",
        userId,
        id,
      });
      return res.status(500).json({ error: "Failed to serve avatar" });
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
