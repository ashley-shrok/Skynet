/**
 * /push-subscriptions — notification setup routes (Telegram).
 *
 * Security discipline:
 *   - All endpoints require JWT auth (authenticateJWT middleware).
 *   - All endpoints require notifications access (users.notifications_enabled
 *     or is_admin) — 403 otherwise. See notifications-access.ts.
 *   - userId is sourced from the JWT-verified AuthenticatedRequest, NEVER from
 *     req.body.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { userCanUseNotifications } from "../../notifications/notifications-access.js";
import { getBotUsername, isTelegramConfigured } from "../../notifications/telegram-api.js";
import {
  createLinkCode,
  deleteLink,
  getLink,
  setTitleOnly,
} from "../../notifications/telegram-links.js";
import { sendTelegramToUser } from "../../notifications/telegram-sender.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * Notifications access gate — runs after authenticateJWT on every route.
 * 403 unless the user has users.notifications_enabled set or is an admin.
 */
export function requireNotificationsAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const userId = (req as AuthenticatedRequest).userId;
  if (!userCanUseNotifications(userId)) {
    res.status(403).json({ error: "Notifications are not enabled for this account" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Telegram notifications
// ---------------------------------------------------------------------------
//
//   GET    /telegram       — status: {available, botUsername?, linked, telegramName?, titleOnly?}
//   POST   /telegram/link  — mint a one-time link code → {url: "https://t.me/<bot>?start=<code>"}
//   POST   /telegram/test  — send a test notification → {ok} or {ok:false, error}
//   PATCH  /telegram       — {titleOnly: boolean} → status
//   DELETE /telegram       — unlink → status
//
// The link itself is completed by the bot (telegram-poller.ts) when the user
// taps Start; the pane polls GET /telegram until linked flips true.

export interface TelegramStatusResponse {
  available: boolean;
  botUsername?: string;
  linked: boolean;
  telegramName?: string;
  titleOnly?: boolean;
}

export async function buildTelegramStatus(userId: string): Promise<TelegramStatusResponse> {
  const botUsername = isTelegramConfigured() ? await getBotUsername() : null;
  const link = getLink(userId);
  return {
    available: botUsername !== null,
    ...(botUsername ? { botUsername } : {}),
    linked: link !== null,
    ...(link ? { telegramName: link.telegramName, titleOnly: link.titleOnly } : {}),
  };
}

export async function handleGetTelegram(userId: string, res: Response): Promise<Response> {
  return res.status(200).json(await buildTelegramStatus(userId));
}

export async function handlePostTelegramLink(userId: string, res: Response): Promise<Response> {
  const botUsername = isTelegramConfigured() ? await getBotUsername() : null;
  if (!botUsername) {
    return res.status(503).json({ error: "Telegram is not available on this server" });
  }
  const code = createLinkCode(userId);
  databaseLogger.info("[telegram] link code issued", {
    operation: "telegram_link_code_issued",
    userId,
  });
  return res.status(200).json({ url: `https://t.me/${botUsername}?start=${code}` });
}

export async function handlePostTelegramTest(userId: string, res: Response): Promise<Response> {
  const result = await sendTelegramToUser(userId, {
    title: "Skynet test notification",
    body: "Telegram notifications are working.",
    agentMxid: "@system:skynet",
    agentHostId: null,
  });
  if (result.ok) return res.status(200).json({ ok: true });
  const error =
    result.reason === "send_failed"
      ? result.errorCode === 403
        ? "Telegram refused — you may have blocked the bot. Disconnect and connect again."
        : `Telegram error: ${result.description}`
      : result.reason === "not_linked"
        ? "Telegram is not connected"
        : "Telegram is not available on this server";
  return res.status(200).json({ ok: false, error });
}

export async function handlePatchTelegram(
  userId: string,
  body: unknown,
  res: Response,
): Promise<Response> {
  const titleOnly = (body as { titleOnly?: unknown } | undefined)?.titleOnly;
  if (typeof titleOnly !== "boolean") {
    return res.status(400).json({ error: "titleOnly must be a boolean" });
  }
  if (!(await setTitleOnly(userId, titleOnly))) {
    return res.status(404).json({ error: "Telegram is not connected" });
  }
  return res.status(200).json(await buildTelegramStatus(userId));
}

export async function handleDeleteTelegram(userId: string, res: Response): Promise<Response> {
  await deleteLink(userId);
  databaseLogger.info("[telegram] unlinked from preferences", {
    operation: "telegram_link_deleted",
    userId,
  });
  return res.status(200).json(await buildTelegramStatus(userId));
}

router.get("/telegram", authenticateJWT, requireNotificationsAccess, async (req: Request, res: Response) =>
  handleGetTelegram((req as AuthenticatedRequest).userId, res),
);

router.post("/telegram/link", authenticateJWT, requireNotificationsAccess, async (req: Request, res: Response) =>
  handlePostTelegramLink((req as AuthenticatedRequest).userId, res),
);

router.post("/telegram/test", authenticateJWT, requireNotificationsAccess, async (req: Request, res: Response) =>
  handlePostTelegramTest((req as AuthenticatedRequest).userId, res),
);

router.patch(
  "/telegram",
  authenticateJWT,
  requireNotificationsAccess,
  express.json({ limit: "8kb" }),
  async (req: Request, res: Response) =>
    handlePatchTelegram((req as AuthenticatedRequest).userId, req.body, res),
);

router.delete("/telegram", authenticateJWT, requireNotificationsAccess, async (req: Request, res: Response) =>
  handleDeleteTelegram((req as AuthenticatedRequest).userId, res),
);

export default router;
