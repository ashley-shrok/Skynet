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
import { getAppName } from "../../notifications/app-name.js";
import { callTelegram } from "../../notifications/telegram-api.js";
import {
  createLinkCode,
  deleteBot,
  findOtherUserWithBot,
  getBot,
  saveBot,
  setTitleOnly,
} from "../../notifications/telegram-bots.js";
import { restartBotPoller, stopBotPoller } from "../../notifications/telegram-poller.js";
import { sendTelegramToUser } from "../../notifications/telegram-sender.js";
import { requireRecentAuth } from "../../utils/recent-auth.js";

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
// Telegram notifications — each user sets up their own bot
// ---------------------------------------------------------------------------
//
//   GET    /telegram       — status: {setUp, botUsername?, linked, telegramName?, titleOnly?}
//   PUT    /telegram/bot   — {token} from @BotFather → validated, stored, poller started → status
//   POST   /telegram/link  — one-time Start link for the user's bot → {url}
//   POST   /telegram/test  — send a test notification → {ok} or {ok:false, error}
//   PATCH  /telegram       — {titleOnly: boolean} → status
//   DELETE /telegram       — remove the user's whole Telegram setup → status
//
// The chat link itself is completed by the user's bot poller
// (telegram-poller.ts) when they tap Start; the pane polls GET /telegram
// until linked flips true.

export interface TelegramStatusResponse {
  setUp: boolean;
  botUsername?: string;
  linked: boolean;
  telegramName?: string;
  titleOnly?: boolean;
}

export function buildTelegramStatus(userId: string): TelegramStatusResponse {
  const bot = getBot(userId);
  if (!bot) return { setUp: false, linked: false };
  return {
    setUp: true,
    botUsername: bot.botUsername,
    linked: bot.chatId !== null,
    ...(bot.chatId ? { telegramName: bot.telegramName } : {}),
    titleOnly: bot.titleOnly,
  };
}

/** BotFather tokens look like `123456789:AAH...` (digits, colon, 30+ url-safe chars). */
const BOT_TOKEN_SHAPE = /^\d+:[A-Za-z0-9_-]{30,}$/;

export async function handleGetTelegram(userId: string, res: Response): Promise<Response> {
  return res.status(200).json(buildTelegramStatus(userId));
}

export async function handlePutTelegramBot(
  userId: string,
  body: unknown,
  res: Response,
): Promise<Response> {
  const raw = (body as { token?: unknown } | undefined)?.token;
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!BOT_TOKEN_SHAPE.test(token)) {
    return res.status(400).json({
      error: "That doesn't look like a bot token. Copy the whole token BotFather sent (it looks like 123456789:AA…).",
    });
  }

  const me = await callTelegram<{ id: number; is_bot: boolean; username?: string }>(token, "getMe", {});
  if (!me.ok || !me.result?.is_bot || !me.result.username) {
    databaseLogger.warn("[telegram] bot token rejected", {
      operation: "telegram_bot_token_rejected",
      userId,
      errorCode: me.errorCode,
      description: me.description,
    });
    return res.status(400).json({
      error:
        me.errorCode === 401 || me.errorCode === 404
          ? "Telegram didn't accept that token. Check you copied all of it, or ask BotFather for it again with /token."
          : "Couldn't reach Telegram to check the token. Try again in a moment.",
    });
  }

  const botId = String(me.result.id);
  const appName = await getAppName();
  const alreadyUsed = () =>
    res.status(409).json({
      error: `That bot is already used by another ${appName} account. Create a separate bot with /newbot.`,
    });
  if (findOtherUserWithBot(botId, userId)) return alreadyUsed();

  // A bot with a webhook set can't be long-polled; clear any.
  await callTelegram(token, "deleteWebhook", { drop_pending_updates: false });
  try {
    await saveBot(userId, token, botId, me.result.username);
  } catch (err) {
    // Another account saved the same bot between the check above and now.
    if (err instanceof Error && /UNIQUE constraint failed: telegram_bots\.bot_id/.test(err.message)) {
      return alreadyUsed();
    }
    throw err;
  }
  restartBotPoller(userId);
  databaseLogger.info("[telegram] bot saved", {
    operation: "telegram_bot_saved",
    userId,
    botUsername: me.result.username,
  });
  return res.status(200).json(buildTelegramStatus(userId));
}

export async function handlePostTelegramLink(userId: string, res: Response): Promise<Response> {
  const bot = getBot(userId);
  if (!bot) {
    return res.status(409).json({ error: "Set up your bot first" });
  }
  const code = createLinkCode(userId);
  databaseLogger.info("[telegram] link code issued", {
    operation: "telegram_link_code_issued",
    userId,
  });
  return res.status(200).json({ url: `https://t.me/${bot.botUsername}?start=${code}` });
}

export async function handlePostTelegramTest(userId: string, res: Response): Promise<Response> {
  const result = await sendTelegramToUser(userId, {
    title: `${await getAppName()} test notification`,
    subtitle: null,
    body: "Telegram notifications are working.",
    agentMxid: "@system:skynet",
    agentHostId: null,
  });
  if (result.ok) return res.status(200).json({ ok: true });
  const error =
    result.reason === "send_failed"
      ? result.errorCode === 403
        ? "Telegram refused — you may have blocked your bot. Open it and tap Start again."
        : result.errorCode === 401
          ? "Your bot's token no longer works. Paste a new one from BotFather."
          : `Telegram error: ${result.description}`
      : result.reason === "not_linked"
        ? "Open your bot and tap Start first"
        : "Telegram isn't set up yet";
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
    return res.status(404).json({ error: "Telegram isn't set up" });
  }
  return res.status(200).json(buildTelegramStatus(userId));
}

export async function handleDeleteTelegram(userId: string, res: Response): Promise<Response> {
  stopBotPoller(userId);
  await deleteBot(userId);
  databaseLogger.info("[telegram] setup removed", {
    operation: "telegram_bot_deleted",
    userId,
  });
  return res.status(200).json(buildTelegramStatus(userId));
}

router.get("/telegram", authenticateJWT, requireNotificationsAccess, async (req: Request, res: Response) =>
  handleGetTelegram((req as AuthenticatedRequest).userId, res),
);

router.put(
  "/telegram/bot",
  authenticateJWT,
  requireNotificationsAccess,
  requireRecentAuth,
  express.json({ limit: "8kb" }),
  async (req: Request, res: Response) =>
    handlePutTelegramBot((req as AuthenticatedRequest).userId, req.body, res),
);

router.post("/telegram/link", authenticateJWT, requireNotificationsAccess, requireRecentAuth, async (req: Request, res: Response) =>
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
