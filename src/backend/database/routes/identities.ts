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

function publicIdentity(row: typeof identities.$inferSelect, role: string | null = null) {
  return {
    id: row.id,
    identityKey: row.identityKey,
    displayName: row.displayName,
    title: row.title,
    colorHue: row.colorHue,
    voice: row.voice,
    avatarMime: row.avatarMime,
    avatarUrl: `/identities/${row.id}/avatar`,
    avatarEtag: row.avatarEtag,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    role,
  };
}

router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const rows = db
      .select()
      .from(identities)
      .where(eq(identities.userId, userId))
      .all();
    // Role is authoritative from /sessions/list (per-host SSH conn reads frontmatter
    // on the identity's home box). The LOCAL-only resolveRoleForIdentity(null, ...) call
    // that was here returned null for every non-tina identity (skynet-ec2 only has tina's
    // identity file). Retiring that broken call; wire shape preserved (role: null on wire).
    const enriched = rows.map((row) => publicIdentity(row, null));
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

      const buffer = req.file.buffer;
      const etag = createHash("md5").update(buffer).digest("hex");
      const id = nanoid();
      const now = new Date().toISOString();
      db.insert(identities)
        .values({
          id,
          userId,
          identityKey,
          displayName,
          title: meta.title ?? null,
          colorHue: meta.colorHue ?? null,
          voice: meta.voice ?? null,
          avatarMime: req.file.mimetype,
          avatarData: buffer,
          avatarEtag: etag,
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
        } catch {
          overlaid = {};
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
      // TODO(Phase 66 Plan 03): the fields displayName/title/colorHue/voice/
      // avatarMime/avatarEtag in this response are stale store values —
      // Plan 03 flips GET reads to disk. During the deploy window between
      // Plans 02+03 landing, transient staleness on the response is
      // accepted per CONTEXT.md § "transition window drift".
      return res.json(publicIdentity(freshRow));
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

router.get(
  "/:id/avatar",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = String(req.params.id);
    try {
      const row = db
        .select()
        .from(identities)
        .where(and(eq(identities.id, id), eq(identities.userId, userId)))
        .all()[0];
      if (!row) {
        return res.status(404).json({ error: "Identity not found" });
      }
      const ifNoneMatch = req.headers["if-none-match"];
      const etag = `"${row.avatarEtag}"`;
      if (ifNoneMatch && ifNoneMatch === etag) {
        return res.status(304).end();
      }
      res.setHeader("Content-Type", row.avatarMime);
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "private, max-age=300");
      return res.send(row.avatarData);
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
