import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { messageQueueItems } from "../db/schema.js";
import { eq, and, isNull, asc, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

function publicItem(row: typeof messageQueueItems.$inferSelect) {
  return {
    id: row.id,
    hostId: row.hostId,
    tmuxSession: row.tmuxSession,
    body: row.body,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseHostId(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function parseTmuxSession(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw);
  if (s === "" || s === "null") return null;
  return s;
}

router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const hostId = parseHostId(req.query.hostId);
  if (hostId === null) {
    return res.status(400).json({ error: "hostId is required" });
  }
  const tmuxSession = parseTmuxSession(req.query.tmuxSession);
  try {
    const rows = db
      .select()
      .from(messageQueueItems)
      .where(
        and(
          eq(messageQueueItems.userId, userId),
          eq(messageQueueItems.hostId, hostId),
          tmuxSession === null
            ? isNull(messageQueueItems.tmuxSession)
            : eq(messageQueueItems.tmuxSession, tmuxSession),
        ),
      )
      .orderBy(asc(messageQueueItems.sortOrder), asc(messageQueueItems.createdAt))
      .all();
    return res.json(rows.map(publicItem));
  } catch (e) {
    databaseLogger.error("Failed to list message queue items", e, {
      operation: "list_message_queue_items",
      userId,
    });
    return res.status(500).json({ error: "Failed to list message queue items" });
  }
});

router.post("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const hostId = parseHostId(req.body?.hostId);
  if (hostId === null) {
    return res.status(400).json({ error: "hostId is required" });
  }
  const tmuxSession = parseTmuxSession(req.body?.tmuxSession);
  const body = typeof req.body?.body === "string" ? req.body.body : "";
  const providedSortOrder =
    typeof req.body?.sortOrder === "number" && Number.isFinite(req.body.sortOrder)
      ? Math.floor(req.body.sortOrder)
      : null;
  try {
    let sortOrder = providedSortOrder;
    if (sortOrder === null) {
      const maxRow = db
        .select({ max: sql<number>`COALESCE(MAX(${messageQueueItems.sortOrder}), -1)` })
        .from(messageQueueItems)
        .where(
          and(
            eq(messageQueueItems.userId, userId),
            eq(messageQueueItems.hostId, hostId),
            tmuxSession === null
              ? isNull(messageQueueItems.tmuxSession)
              : eq(messageQueueItems.tmuxSession, tmuxSession),
          ),
        )
        .get();
      sortOrder = (maxRow?.max ?? -1) + 1;
    }
    const id = nanoid();
    db.insert(messageQueueItems)
      .values({
        id,
        userId,
        hostId,
        tmuxSession,
        body,
        sortOrder,
      })
      .run();
    const row = db
      .select()
      .from(messageQueueItems)
      .where(eq(messageQueueItems.id, id))
      .get();
    if (!row) {
      return res.status(500).json({ error: "Failed to read back created item" });
    }
    return res.status(201).json(publicItem(row));
  } catch (e) {
    databaseLogger.error("Failed to create message queue item", e, {
      operation: "create_message_queue_item",
      userId,
    });
    return res.status(500).json({ error: "Failed to create message queue item" });
  }
});

router.patch("/:id", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const id = String(req.params.id);
  try {
    const existing = db
      .select()
      .from(messageQueueItems)
      .where(
        and(eq(messageQueueItems.id, id), eq(messageQueueItems.userId, userId)),
      )
      .get();
    if (!existing) {
      return res.status(404).json({ error: "Not found" });
    }
    const updates: Partial<typeof messageQueueItems.$inferInsert> = {};
    if (typeof req.body?.body === "string") updates.body = req.body.body;
    if (
      typeof req.body?.sortOrder === "number" &&
      Number.isFinite(req.body.sortOrder)
    ) {
      updates.sortOrder = Math.floor(req.body.sortOrder);
    }
    if (Object.keys(updates).length === 0) {
      return res.json(publicItem(existing));
    }
    updates.updatedAt = new Date().toISOString();
    db.update(messageQueueItems)
      .set(updates)
      .where(eq(messageQueueItems.id, id))
      .run();
    const row = db
      .select()
      .from(messageQueueItems)
      .where(eq(messageQueueItems.id, id))
      .get();
    if (!row) {
      return res.status(500).json({ error: "Failed to read back updated item" });
    }
    return res.json(publicItem(row));
  } catch (e) {
    databaseLogger.error("Failed to update message queue item", e, {
      operation: "update_message_queue_item",
      userId,
    });
    return res.status(500).json({ error: "Failed to update message queue item" });
  }
});

router.delete("/:id", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const id = String(req.params.id);
  try {
    const existing = db
      .select()
      .from(messageQueueItems)
      .where(
        and(eq(messageQueueItems.id, id), eq(messageQueueItems.userId, userId)),
      )
      .get();
    if (!existing) {
      return res.status(404).json({ error: "Not found" });
    }
    db.delete(messageQueueItems).where(eq(messageQueueItems.id, id)).run();
    return res.status(204).end();
  } catch (e) {
    databaseLogger.error("Failed to delete message queue item", e, {
      operation: "delete_message_queue_item",
      userId,
    });
    return res.status(500).json({ error: "Failed to delete message queue item" });
  }
});

export default router;
