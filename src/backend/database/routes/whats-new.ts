import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db, DatabaseSaveTrigger } from "../db/index.js";
import { userPreferences } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import {
  WHATS_NEW_NOTES,
  type WhatsNewNote,
} from "../../whats-new/notes.js";
import { resolveUnseen, markSeen } from "../../whats-new/whats-new-state.js";

// What's new — the notes a person hasn't seen yet, shown once in a pop-up
// after an update. The per-person record lives on the user_preferences row
// (whats_new_seen) so it follows the account across devices.
//
//   GET  /            → 200 { notes: [{ id, text }] }  unseen, newest first.
//                       A person with no record is counted here (every current
//                       note marked seen) and gets an empty list.
//   POST /seen        body { ids: string[] } → 204. Marks those notes seen.

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const SEEN_IDS_MAX_PER_REQUEST = 500;
const NOTE_ID_MAX_LENGTH = 100;

function readSeen(userId: string): { exists: boolean; seen: string | null } {
  const row = db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .all()[0];
  return { exists: row !== undefined, seen: row?.whatsNewSeen ?? null };
}

async function writeSeen(
  userId: string,
  exists: boolean,
  value: string,
  reason: string,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  if (exists) {
    db.update(userPreferences)
      .set({ whatsNewSeen: value, updatedAt })
      .where(eq(userPreferences.userId, userId))
      .run();
  } else {
    db.insert(userPreferences)
      .values({ userId, whatsNewSeen: value, updatedAt })
      .run();
  }
  try {
    await DatabaseSaveTrigger.forceSave(reason);
  } catch (saveErr) {
    databaseLogger.warn("Force-save after what's-new update failed", {
      operation: "whats_new_save_failed",
      userId,
      error: saveErr instanceof Error ? saveErr.message : "Unknown error",
    });
  }
}

export async function handleGetWhatsNew(
  userId: string,
  res: Response,
  notes: readonly WhatsNewNote[] = WHATS_NEW_NOTES,
): Promise<Response> {
  try {
    const { exists, seen } = readSeen(userId);
    const { unseen, initialSeen } = resolveUnseen(seen, notes);
    if (initialSeen !== null) {
      await writeSeen(userId, exists, initialSeen, "whats_new_counted");
      databaseLogger.info("What's new: person counted, nothing shown", {
        operation: "whats_new_counted",
        userId,
        noteCount: notes.length,
      });
    } else if (unseen.length > 0) {
      databaseLogger.info("What's new: unseen notes served", {
        operation: "whats_new_served",
        userId,
        unseenIds: unseen.map((n) => n.id),
      });
    }
    return res.json({ notes: unseen.map(({ id, text }) => ({ id, text })) });
  } catch (e) {
    databaseLogger.error("Failed to get what's new", e, {
      operation: "whats_new_get",
      userId,
    });
    return res.status(500).json({ error: "Failed to get what's new" });
  }
}

export async function handleMarkWhatsNewSeen(
  userId: string,
  body: unknown,
  res: Response,
  notes: readonly WhatsNewNote[] = WHATS_NEW_NOTES,
): Promise<Response> {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length > SEEN_IDS_MAX_PER_REQUEST ||
    !ids.every((id) => typeof id === "string" && id.length <= NOTE_ID_MAX_LENGTH)
  ) {
    return res.status(400).json({ error: "ids must be an array of strings" });
  }
  try {
    const { exists, seen } = readSeen(userId);
    const next = markSeen(seen, ids as string[], notes);
    if (next !== null) {
      await writeSeen(userId, exists, next, "whats_new_seen");
    }
    databaseLogger.info("What's new: notes marked seen", {
      operation: "whats_new_marked_seen",
      userId,
      requested: ids.length,
      changed: next !== null,
    });
    return res.status(204).end();
  } catch (e) {
    databaseLogger.error("Failed to mark what's new seen", e, {
      operation: "whats_new_mark_seen",
      userId,
    });
    return res.status(500).json({ error: "Failed to mark what's new seen" });
  }
}

router.get("/", authenticateJWT, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  return handleGetWhatsNew(userId, res);
});

router.post("/seen", authenticateJWT, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  return handleMarkWhatsNewSeen(userId, req.body, res);
});

export default router;
