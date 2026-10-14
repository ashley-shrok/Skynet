/**
 * Telegram update pollers — one outbound long-poll (getUpdates) loop per
 * user's bot, so nothing on this box is exposed to the internet for Telegram.
 *
 * Each loop handles what is sent to that user's bot, in private chats only:
 *   /start <code>  → if the code was minted for this user, link this chat
 *   /start         → (no code) explain how to connect
 *   /stop          → unlink the chat (the bot setup stays)
 * Anything else gets a one-line "replies go in Skynet" note.
 *
 * Loops are keyed by userId and carry a generation number: (re)starting or
 * stopping a user's loop bumps it, and the old loop exits after its current
 * request. A bot token can only be long-polled by one process at a time —
 * Telegram returns 409 Conflict to a second one.
 */

import { systemLogger } from "../utils/logger.js";
import { callTelegram } from "./telegram-api.js";
import { consumeLinkCode, getBot, linkChat, loadAllBots, unlinkChat } from "./telegram-bots.js";

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

async function reply(token: string, userId: string, chatId: number, text: string): Promise<void> {
  const res = await callTelegram(token, "sendMessage", { chat_id: chatId, text });
  if (!res.ok) {
    systemLogger.warn("[telegram] bot reply failed", {
      operation: "telegram_bot_reply_failed",
      userId,
      chatId,
      errorCode: res.errorCode,
      description: res.description,
    });
  }
}

/** Handle one update that arrived on `userId`'s bot. Exported for tests. Never throws. */
export async function handleUpdate(userId: string, token: string, update: TelegramUpdate): Promise<void> {
  const message = update.message;
  if (!message?.text || message.chat.type !== "private") return;

  const chatId = message.chat.id;
  const [command, arg] = message.text.trim().split(/\s+/, 2);

  try {
    if (command === "/start") {
      if (!arg) {
        await reply(
          token,
          userId,
          chatId,
          "To get Skynet notifications here, open Skynet → Preferences (gear) → Notifications and tap Open my bot.",
        );
        return;
      }
      if (!consumeLinkCode(arg, userId)) {
        systemLogger.warn("[telegram] link code unknown or expired", {
          operation: "telegram_link_code_rejected",
          userId,
          chatId,
        });
        await reply(
          token,
          userId,
          chatId,
          "That link has expired. In Skynet, open Preferences (gear) → Notifications and tap Open my bot again.",
        );
        return;
      }
      await linkChat(userId, String(chatId), displayNameOf(message.from));
      systemLogger.info("[telegram] chat linked", { operation: "telegram_link_created", userId, chatId });
      await reply(token, userId, chatId, "Connected. Your Skynet notifications will arrive here. Send /stop to disconnect.");
      return;
    }

    if (command === "/stop") {
      const linkedHere = getBot(userId)?.chatId === String(chatId);
      if (linkedHere) await unlinkChat(userId);
      systemLogger.info("[telegram] /stop received", { operation: "telegram_link_stopped", userId, chatId, linkedHere });
      await reply(
        token,
        userId,
        chatId,
        linkedHere
          ? "Disconnected. You won't get Skynet notifications here anymore."
          : "This chat isn't connected to Skynet.",
      );
      return;
    }

    await reply(token, userId, chatId, "This bot only sends notifications — reply to agents in Skynet.");
  } catch (err) {
    systemLogger.warn("[telegram] update handling failed", {
      operation: "telegram_update_failed",
      userId,
      updateId: update.update_id,
      chatId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

interface LoopState {
  generation: number;
  offset: number;
}

const loops = new Map<string, LoopState>();
let generationCounter = 0;

/**
 * One getUpdates round-trip for `userId`'s bot. Returns true on success,
 * false on failure (caller backs off). Exported for tests.
 */
export async function pollOnce(userId: string, token: string, state: LoopState): Promise<boolean> {
  const res = await callTelegram<TelegramUpdate[]>(
    token,
    "getUpdates",
    { offset: state.offset, timeout: LONG_POLL_TIMEOUT_S, allowed_updates: ["message"] },
    (LONG_POLL_TIMEOUT_S + 10) * 1000,
  );
  if (!res.ok) {
    systemLogger.warn("[telegram] getUpdates failed", {
      operation: "telegram_get_updates_failed",
      userId,
      errorCode: res.errorCode,
      description: res.description,
      hint:
        res.errorCode === 409
          ? "something else is polling this bot — a bot can only serve one Skynet account"
          : res.errorCode === 401
            ? "the bot token was revoked — the user needs to paste a new one in Preferences → Notifications"
            : undefined,
    });
    return false;
  }
  for (const update of res.result ?? []) {
    state.offset = Math.max(state.offset, update.update_id + 1);
    await handleUpdate(userId, token, update);
  }
  return true;
}

/** (Re)start the poll loop for `userId`'s current bot; stops it if they have none. */
export function restartBotPoller(userId: string): void {
  const bot = getBot(userId);
  if (!bot) {
    stopBotPoller(userId);
    return;
  }
  const state: LoopState = { generation: ++generationCounter, offset: 0 };
  loops.set(userId, state);
  const isCurrent = () => loops.get(userId) === state;
  systemLogger.info("[telegram] bot poller started", {
    operation: "telegram_poller_started",
    userId,
    botUsername: bot.botUsername,
  });

  void (async () => {
    let backoffMs = MIN_BACKOFF_MS;
    while (isCurrent()) {
      const ok = await pollOnce(userId, bot.token, state);
      if (!isCurrent()) return;
      if (ok) {
        backoffMs = MIN_BACKOFF_MS;
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  })();
}

export function stopBotPoller(userId: string): void {
  if (loops.delete(userId)) {
    systemLogger.info("[telegram] bot poller stopped", { operation: "telegram_poller_stopped", userId });
  }
}

/** Boot: load every user's bot and start a poller for each. */
export async function startAllBotPollers(): Promise<void> {
  const all = await loadAllBots();
  systemLogger.info("[telegram] starting bot pollers", {
    operation: "telegram_pollers_boot",
    bots: all.length,
  });
  for (const bot of all) restartBotPoller(bot.userId);
}

/** Test-only: stop every loop. */
export function _resetPollersForTests(): void {
  loops.clear();
}
