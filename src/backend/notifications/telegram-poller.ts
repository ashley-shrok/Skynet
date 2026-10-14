/**
 * Telegram update poller — receives what users send the bot, over outbound
 * long-polling (getUpdates) so nothing on this box is exposed to the
 * internet for Telegram.
 *
 * Handles three things, in private chats only:
 *   /start <code>  → redeem a link code from the preferences pane and link
 *                    this chat to that Skynet user
 *   /start         → (no code) explain how to connect
 *   /stop          → unlink every Skynet user linked to this chat
 * Anything else gets a one-line "replies go in Skynet" note.
 *
 * Only one process may long-poll a bot token at a time; a second one gets
 * 409 Conflict. Each Skynet instance needs its own bot.
 */

import { systemLogger } from "../utils/logger.js";
import { callTelegram, isTelegramConfigured } from "./telegram-api.js";
import { consumeLinkCode, deleteLink, getUserIdsForChat, saveLink } from "./telegram-links.js";

const LONG_POLL_TIMEOUT_S = 50;
const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

interface TelegramUser {
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: TelegramUser;
  };
}

export function displayNameOf(user: TelegramUser | undefined): string {
  if (!user) return "";
  if (user.username) return `@${user.username}`;
  return [user.first_name, user.last_name].filter(Boolean).join(" ");
}

async function reply(chatId: number, text: string): Promise<void> {
  const res = await callTelegram("sendMessage", { chat_id: chatId, text });
  if (!res.ok) {
    systemLogger.warn("[telegram] bot reply failed", {
      operation: "telegram_bot_reply_failed",
      chatId,
      errorCode: res.errorCode,
      description: res.description,
    });
  }
}

/** Handle one update. Exported for tests. Never throws. */
export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text || message.chat.type !== "private") return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const [command, arg] = text.split(/\s+/, 2);

  try {
    if (command === "/start") {
      if (!arg) {
        await reply(
          chatId,
          "To get Skynet notifications here, open Skynet → Preferences (gear) → Notifications and tap Connect Telegram.",
        );
        return;
      }
      const userId = consumeLinkCode(arg);
      if (!userId) {
        systemLogger.warn("[telegram] link code unknown or expired", {
          operation: "telegram_link_code_rejected",
          chatId,
        });
        await reply(
          chatId,
          "That link has expired. In Skynet, open Preferences (gear) → Notifications and tap Connect Telegram again.",
        );
        return;
      }
      await saveLink(userId, String(chatId), displayNameOf(message.from));
      systemLogger.info("[telegram] chat linked", {
        operation: "telegram_link_created",
        userId,
        chatId,
      });
      await reply(chatId, "Connected. Your Skynet notifications will arrive here. Send /stop to disconnect.");
      return;
    }

    if (command === "/stop") {
      const userIds = getUserIdsForChat(String(chatId));
      for (const userId of userIds) await deleteLink(userId);
      systemLogger.info("[telegram] chat unlinked via /stop", {
        operation: "telegram_link_stopped",
        chatId,
        userIds,
      });
      await reply(
        chatId,
        userIds.length > 0
          ? "Disconnected. You won't get Skynet notifications here anymore."
          : "This chat isn't connected to Skynet.",
      );
      return;
    }

    await reply(chatId, "This bot only sends notifications — reply to agents in Skynet.");
  } catch (err) {
    systemLogger.warn("[telegram] update handling failed", {
      operation: "telegram_update_failed",
      updateId: update.update_id,
      chatId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

let running = false;
let nextOffset = 0;

/**
 * One getUpdates round-trip. Returns true on success, false on failure
 * (caller backs off). Exported for tests.
 */
export async function pollOnce(): Promise<boolean> {
  const res = await callTelegram<TelegramUpdate[]>(
    "getUpdates",
    { offset: nextOffset, timeout: LONG_POLL_TIMEOUT_S, allowed_updates: ["message"] },
    (LONG_POLL_TIMEOUT_S + 10) * 1000,
  );
  if (!res.ok) {
    systemLogger.warn("[telegram] getUpdates failed", {
      operation: "telegram_get_updates_failed",
      errorCode: res.errorCode,
      description: res.description,
      hint:
        res.errorCode === 409
          ? "another process is polling this bot token — each Skynet instance needs its own bot"
          : res.errorCode === 401
            ? "TELEGRAM_BOT_TOKEN is invalid"
            : undefined,
    });
    return false;
  }
  for (const update of res.result) {
    nextOffset = Math.max(nextOffset, update.update_id + 1);
    await handleUpdate(update);
  }
  return true;
}

/** Start the long-poll loop. No-op when no bot token is configured. */
export function startTelegramPoller(): void {
  if (running) return;
  if (!isTelegramConfigured()) {
    systemLogger.info("[telegram] TELEGRAM_BOT_TOKEN not set — Telegram notifications disabled", {
      operation: "telegram_disabled",
    });
    return;
  }
  running = true;
  systemLogger.info("[telegram] update poller started", { operation: "telegram_poller_started" });

  void (async () => {
    let backoffMs = MIN_BACKOFF_MS;
    while (running) {
      const ok = await pollOnce();
      if (ok) {
        backoffMs = MIN_BACKOFF_MS;
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  })();
}

/** Test-only: stop the loop and reset the offset. */
export function _resetPollerForTests(): void {
  running = false;
  nextOffset = 0;
}
