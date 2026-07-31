import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import multer from "multer";
import { createHash } from "crypto";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { identities } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

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
};

function parseMultipartMetadata(req: Request): IdentityMetadata | null {
  if (!req.body?.data) return {};
  try {
    return JSON.parse(req.body.data);
  } catch {
    return null;
  }
}

function publicIdentity(row: typeof identities.$inferSelect) {
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
    return res.json(rows.map(publicIdentity));
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

    try {
      const existing = db
        .select()
        .from(identities)
        .where(and(eq(identities.id, id), eq(identities.userId, userId)))
        .all();
      if (existing.length === 0) {
        return res.status(404).json({ error: "Identity not found" });
      }

      const updates: Partial<typeof identities.$inferInsert> = {
        updatedAt: new Date().toISOString(),
      };
      if (meta.displayName !== undefined) {
        const dn = String(meta.displayName).trim();
        if (!dn)
          return res.status(400).json({ error: "displayName cannot be empty" });
        updates.displayName = dn;
      }
      if (meta.title !== undefined) {
        updates.title = meta.title == null ? null : String(meta.title);
      }
      if (meta.colorHue !== undefined) {
        if (meta.colorHue == null) {
          updates.colorHue = null;
        } else if (
          typeof meta.colorHue !== "number" ||
          meta.colorHue < 0 ||
          meta.colorHue > 359
        ) {
          return res.status(400).json({ error: "colorHue must be 0-359" });
        } else {
          updates.colorHue = meta.colorHue;
        }
      }
      if (meta.voice !== undefined) {
        if (meta.voice === null) {
          updates.voice = null;
        } else if (typeof meta.voice !== "string" || !IDENTITY_VOICE_RE.test(meta.voice)) {
          return res.status(400).json({ error: "voice must match [A-Z][A-Za-z]+\\.wav" });
        } else {
          updates.voice = meta.voice;
        }
      }
      if (req.file) {
        updates.avatarMime = req.file.mimetype;
        updates.avatarData = req.file.buffer;
        updates.avatarEtag = createHash("md5")
          .update(req.file.buffer)
          .digest("hex");
      }

      db.update(identities)
        .set(updates)
        .where(and(eq(identities.id, id), eq(identities.userId, userId)))
        .run();

      const row = db
        .select()
        .from(identities)
        .where(eq(identities.id, id))
        .all()[0];
      return res.json(publicIdentity(row));
    } catch (e) {
      databaseLogger.error("Failed to update identity", e, {
        operation: "update_identity",
        userId,
        id,
      });
      return res.status(500).json({ error: "Failed to update identity" });
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
