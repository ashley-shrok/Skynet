import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db, DatabaseSaveTrigger } from "../db/index.js";
import { userOpenTabs } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { sessionManager } from "../../ssh/terminal-session-manager.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * @openapi
 * /open-tabs:
 *   get:
 *     summary: Get all open tabs for the current user
 *     tags:
 *       - Open Tabs
 *     responses:
 *       200:
 *         description: List of open tabs ordered by tab_order.
 */
const TAB_TTL_MS = 30 * 60 * 1000;

router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const cutoff = new Date(Date.now() - TAB_TTL_MS).toISOString();
    const tabs = db
      .select()
      .from(userOpenTabs)
      .where(
        and(
          eq(userOpenTabs.userId, userId),
          sql`${userOpenTabs.updatedAt} > ${cutoff}`,
        ),
      )
      .orderBy(userOpenTabs.tabOrder)
      .all();
    return res.json(tabs);
  } catch (e) {
    databaseLogger.error("Failed to get open tabs", e, {
      operation: "get_open_tabs",
      userId,
    });
    return res.status(500).json({ error: "Failed to get open tabs" });
  }
});

/**
 * @openapi
 * /open-tabs:
 *   post:
 *     summary: Upsert a single open tab for the current user
 *     tags:
 *       - Open Tabs
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, tabType, label, tabOrder]
 *             properties:
 *               id:
 *                 type: string
 *               tabType:
 *                 type: string
 *               hostId:
 *                 type: integer
 *                 nullable: true
 *               label:
 *                 type: string
 *               tabOrder:
 *                 type: integer
 *               backendSessionId:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Tab upserted successfully.
 */
router.post("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const {
    id,
    tabType,
    hostId,
    label,
    tabOrder,
    backendSessionId,
    targetTmuxSession,
    appSlug,
  } = req.body as {
    id: string;
    tabType: string;
    hostId?: number | null;
    label: string;
    tabOrder: number;
    backendSessionId?: string | null;
    targetTmuxSession?: string | null;
    appSlug?: string | null;
  };

  if (!id || !tabType || !label) {
    return res
      .status(400)
      .json({ error: "id, tabType, and label are required" });
  }

  try {
    const now = new Date().toISOString();
    const existing = db
      .select()
      .from(userOpenTabs)
      .where(and(eq(userOpenTabs.id, id), eq(userOpenTabs.userId, userId)))
      .all();
    if (existing.length > 0) {
      // Preserve existing backendSessionId when not explicitly provided
      const sessionId =
        backendSessionId !== undefined
          ? backendSessionId
          : existing[0].backendSessionId;
      const tmuxName =
        targetTmuxSession !== undefined
          ? targetTmuxSession
          : existing[0].targetTmuxSession;
      const appSlugValue =
        appSlug !== undefined ? appSlug : existing[0].appSlug;
      db.update(userOpenTabs)
        .set({
          tabType,
          hostId: hostId ?? null,
          label,
          tabOrder,
          backendSessionId: sessionId ?? null,
          targetTmuxSession: tmuxName ?? null,
          appSlug: appSlugValue ?? null,
          updatedAt: now,
        })
        .where(and(eq(userOpenTabs.id, id), eq(userOpenTabs.userId, userId)))
        .run();
    } else {
      db.insert(userOpenTabs)
        .values({
          id,
          userId,
          tabType,
          hostId: hostId ?? null,
          label,
          tabOrder,
          backendSessionId: backendSessionId ?? null,
          targetTmuxSession: targetTmuxSession ?? null,
          appSlug: appSlug ?? null,
          updatedAt: now,
        })
        .run();
    }
    // Skynet's DB is in-memory-decrypted SQLite; raw db.insert/update writes
    // reach RAM only. The 5-min isDirty poller is gated on _dirty=true which
    // only triggerSave/forceSave set — direct writes never mark dirty.
    // Without an explicit save call, an unclean shutdown (SIGKILL, OOM, host
    // reboot) silently loses the row. Force the save here so the write is
    // durable before we ACK. Silent-warn on failure — an in-memory-only tab
    // is worse UX than a slow response, but a 500 is worse still.
    // Pattern reference: host-autostart-routes.ts:173-181 / user-preferences.ts:406-418.
    try {
      await DatabaseSaveTrigger.forceSave("open_tabs_upsert");
    } catch (saveErr) {
      databaseLogger.warn(
        "Force-save after open tab upsert failed",
        {
          operation: "open_tabs_upsert_save_failed",
          userId,
          id,
          error:
            saveErr instanceof Error ? saveErr.message : "Unknown error",
        },
      );
    }
    return res.json({ success: true });
  } catch (e) {
    databaseLogger.error("Failed to upsert open tab", e, {
      operation: "upsert_open_tab",
      userId,
      id,
    });
    return res.status(500).json({ error: "Failed to upsert open tab" });
  }
});

/**
 * @openapi
 * /open-tabs:
 *   put:
 *     summary: Bulk replace all open tabs for the current user
 *     tags:
 *       - Open Tabs
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tabs:
 *                 type: array
 *     responses:
 *       200:
 *         description: Tabs updated successfully.
 */
router.put("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { tabs } = req.body as {
    tabs: Array<{
      id: string;
      tabType: string;
      hostId?: number | null;
      label: string;
      tabOrder: number;
      backendSessionId?: string | null;
      targetTmuxSession?: string | null;
      appSlug?: string | null;
    }>;
  };

  if (!Array.isArray(tabs)) {
    return res.status(400).json({ error: "tabs must be an array" });
  }

  try {
    db.delete(userOpenTabs).where(eq(userOpenTabs.userId, userId)).run();
    if (tabs.length > 0) {
      const now = new Date().toISOString();
      db.insert(userOpenTabs)
        .values(
          tabs.map((t) => ({
            id: t.id,
            userId,
            tabType: t.tabType,
            hostId: t.hostId ?? null,
            label: t.label,
            tabOrder: t.tabOrder,
            backendSessionId: t.backendSessionId ?? null,
            targetTmuxSession: t.targetTmuxSession ?? null,
            appSlug: t.appSlug ?? null,
            updatedAt: now,
          })),
        )
        .run();
    }
    // In-memory SQLite: force save so the bulk-replace is durable. See
    // POST handler above for rationale + pattern reference. Silent-warn
    // on failure.
    try {
      await DatabaseSaveTrigger.forceSave("open_tabs_sync");
    } catch (saveErr) {
      databaseLogger.warn(
        "Force-save after open tabs sync failed",
        {
          operation: "open_tabs_sync_save_failed",
          userId,
          error:
            saveErr instanceof Error ? saveErr.message : "Unknown error",
        },
      );
    }
    return res.json({ success: true });
  } catch (e) {
    databaseLogger.error("Failed to sync open tabs", e, {
      operation: "sync_open_tabs",
      userId,
    });
    return res.status(500).json({ error: "Failed to sync open tabs" });
  }
});

/**
 * @openapi
 * /open-tabs/{id}:
 *   patch:
 *     summary: Update a single open tab
 *     tags:
 *       - Open Tabs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tab updated successfully.
 *       404:
 *         description: Tab not found.
 */
router.patch("/:id", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const id = String(req.params.id);
  const updates = req.body as Partial<{
    label: string;
    tabOrder: number;
    backendSessionId: string | null;
    targetTmuxSession: string | null;
  }>;

  try {
    const result = db
      .update(userOpenTabs)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(and(eq(userOpenTabs.id, id), eq(userOpenTabs.userId, userId)))
      .run();

    if (result.changes === 0) {
      return res.status(404).json({ error: "Tab not found" });
    }
    // In-memory SQLite: force save so the update is durable. See
    // POST handler above for rationale + pattern reference. Silent-warn
    // on failure.
    try {
      await DatabaseSaveTrigger.forceSave("open_tabs_patch");
    } catch (saveErr) {
      databaseLogger.warn(
        "Force-save after open tab patch failed",
        {
          operation: "open_tabs_patch_save_failed",
          userId,
          id,
          error:
            saveErr instanceof Error ? saveErr.message : "Unknown error",
        },
      );
    }
    return res.json({ success: true });
  } catch (e) {
    databaseLogger.error("Failed to update open tab", e, {
      operation: "update_open_tab",
      userId,
      id,
    });
    return res.status(500).json({ error: "Failed to update open tab" });
  }
});

/**
 * @openapi
 * /open-tabs/{id}:
 *   delete:
 *     summary: Delete a single open tab
 *     tags:
 *       - Open Tabs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tab deleted successfully.
 */
router.delete("/:id", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const id = String(req.params.id);

  try {
    db.delete(userOpenTabs)
      .where(and(eq(userOpenTabs.id, id), eq(userOpenTabs.userId, userId)))
      .run();
    // In-memory SQLite: force save so the delete is durable. See
    // POST handler above for rationale + pattern reference. Silent-warn
    // on failure.
    try {
      await DatabaseSaveTrigger.forceSave("open_tabs_delete");
    } catch (saveErr) {
      databaseLogger.warn(
        "Force-save after open tab delete failed",
        {
          operation: "open_tabs_delete_save_failed",
          userId,
          id,
          error:
            saveErr instanceof Error ? saveErr.message : "Unknown error",
        },
      );
    }
    return res.json({ success: true });
  } catch (e) {
    databaseLogger.error("Failed to delete open tab", e, {
      operation: "delete_open_tab",
      userId,
      id,
    });
    return res.status(500).json({ error: "Failed to delete open tab" });
  }
});

/**
 * @openapi
 * /open-tabs/active-sessions:
 *   get:
 *     summary: Get all active backend sessions for the current user
 *     description: Returns live terminal sessions from the session manager. Used by the Active Connections panel and tab restore logic.
 *     tags:
 *       - Open Tabs
 *     responses:
 *       200:
 *         description: List of active sessions.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   sessionId:
 *                     type: string
 *                   hostId:
 *                     type: integer
 *                   hostName:
 *                     type: string
 *                   tabInstanceId:
 *                     type: string
 *                   isConnected:
 *                     type: boolean
 *                   createdAt:
 *                     type: number
 */
router.get(
  "/active-sessions",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const sessions = sessionManager.getUserSessions(userId);
      return res.json(
        sessions.map((s) => ({
          sessionId: s.id,
          hostId: s.hostId,
          hostName: s.hostName,
          tabInstanceId: s.attachedTabInstanceId ?? s.tabInstanceId ?? null,
          isConnected: s.isConnected,
          createdAt: s.createdAt,
        })),
      );
    } catch (e) {
      databaseLogger.error("Failed to get active sessions", e, {
        operation: "get_active_sessions",
        userId,
      });
      return res.status(500).json({ error: "Failed to get active sessions" });
    }
  },
);

export default router;
