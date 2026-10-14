/**
 * Per-user Telegram bots — each user who wants notifications creates their
 * own bot with @BotFather and pastes its token into Preferences →
 * Notifications. This module stores that setup and the one-time codes that
 * link the user's Telegram chat to it.
 *
 * Setup flow:
 *   1. User pastes a token → the route validates it (getMe) and calls
 *      `saveBot`. Saving a different bot clears any previous chat link.
 *   2. User taps "Open my bot" → `createLinkCode` mints a code and the route
 *      returns `https://t.me/<their bot>?start=<code>`.
 *   3. User taps Start; their bot's poller sees `/start <code>`,
 *      `consumeLinkCode` confirms it belongs to that user, and `linkChat`
 *      records the chat.
 *
 * Tokens are FieldCrypto-encrypted with the SYSTEM key (recordId = userId)
 * so the push-trigger loop can decrypt them while the user is logged out.
 * Decrypted setups are cached in memory: loaded once at boot
 * (`loadAllBots`) and kept current by every write below.
 *
 * Link codes live in memory only (15-minute TTL); a restart just means the
 * user taps "Open my bot" again.
 */

import { randomBytes } from "node:crypto";
import { db, DatabaseSaveTrigger } from "../database/db/index.js";
import { FieldCrypto } from "../utils/field-crypto.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { databaseLogger } from "../utils/logger.js";

export const LINK_CODE_TTL_MS = 15 * 60 * 1000;
const TOKEN_FIELD = "bot_token";

export interface TelegramBot {
  userId: string;
  token: string;
  botId: string;
  botUsername: string;
  /** null until the user taps Start in their bot. */
  chatId: string | null;
  telegramName: string;
  titleOnly: boolean;
}

interface TelegramBotRow {
  user_id: string;
  bot_token: string;
  bot_id: string;
  bot_username: string;
  chat_id: string | null;
  telegram_name: string;
  title_only: number;
}

const bots = new Map<string, TelegramBot>();
const pendingCodes = new Map<string, { userId: string; expiresAt: number }>();

async function systemKey(): Promise<Buffer> {
  return SystemCrypto.getInstance().getEncryptionKey();
}

function readRow(userId: string): TelegramBotRow | undefined {
  return db.$client
    .prepare(
      "SELECT user_id, bot_token, bot_id, bot_username, chat_id, telegram_name, title_only FROM telegram_bots WHERE user_id = ?",
    )
    .get(userId) as TelegramBotRow | undefined;
}

function fromRow(row: TelegramBotRow, key: Buffer): TelegramBot {
  return {
    userId: row.user_id,
    token: FieldCrypto.decryptField(row.bot_token, key, row.user_id, TOKEN_FIELD),
    botId: row.bot_id,
    botUsername: row.bot_username,
    chatId: row.chat_id,
    telegramName: row.telegram_name,
    titleOnly: !!row.title_only,
  };
}

async function persist(reason: string, userId: string): Promise<void> {
  try {
    await DatabaseSaveTrigger.forceSave(reason);
  } catch (err) {
    databaseLogger.warn("[telegram] forceSave failed (non-fatal — write in RAM)", {
      operation: "telegram_bot_force_save_failed",
      reason,
      userId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

/** Load every user's bot into memory (boot). Returns the loaded setups. */
export async function loadAllBots(): Promise<TelegramBot[]> {
  const rows = db.$client
    .prepare(
      "SELECT user_id, bot_token, bot_id, bot_username, chat_id, telegram_name, title_only FROM telegram_bots",
    )
    .all() as TelegramBotRow[];
  const key = await systemKey();
  bots.clear();
  for (const row of rows) {
    try {
      bots.set(row.user_id, fromRow(row, key));
    } catch (err) {
      databaseLogger.warn("[telegram] could not decrypt a stored bot token — user must set it up again", {
        operation: "telegram_bot_decrypt_failed",
        userId: row.user_id,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  return [...bots.values()];
}

export function getBot(userId: string): TelegramBot | null {
  return bots.get(userId) ?? null;
}

/** The user (other than `exceptUserId`) already using this bot, if any. */
export function findOtherUserWithBot(botId: string, exceptUserId: string): string | null {
  const row = db.$client
    .prepare("SELECT user_id FROM telegram_bots WHERE bot_id = ? AND user_id != ?")
    .get(botId, exceptUserId) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

/**
 * Save (or replace) the user's bot. A different bot than before starts
 * unlinked — the chat link belonged to the old bot. Re-saving the same bot
 * (e.g. after BotFather /revoke issued a new token) keeps the link and the
 * title-only choice.
 */
export async function saveBot(
  userId: string,
  token: string,
  botId: string,
  botUsername: string,
): Promise<TelegramBot> {
  const existing = readRow(userId);
  const sameBot = existing?.bot_id === botId;
  const key = await systemKey();
  const encrypted = FieldCrypto.encryptField(token, key, userId, TOKEN_FIELD);
  db.$client
    .prepare(
      `INSERT INTO telegram_bots (user_id, bot_token, bot_id, bot_username) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         bot_token = excluded.bot_token,
         bot_id = excluded.bot_id,
         bot_username = excluded.bot_username,
         chat_id = CASE WHEN ? THEN chat_id ELSE NULL END,
         telegram_name = CASE WHEN ? THEN telegram_name ELSE '' END,
         linked_at = CASE WHEN ? THEN linked_at ELSE NULL END`,
    )
    .run(userId, encrypted, botId, botUsername, sameBot ? 1 : 0, sameBot ? 1 : 0, sameBot ? 1 : 0);
  await persist("telegram-bot-save", userId);
  const bot = fromRow(readRow(userId)!, key);
  bots.set(userId, bot);
  return bot;
}

export async function linkChat(userId: string, chatId: string, telegramName: string): Promise<void> {
  db.$client
    .prepare(
      "UPDATE telegram_bots SET chat_id = ?, telegram_name = ?, linked_at = CURRENT_TIMESTAMP WHERE user_id = ?",
    )
    .run(chatId, telegramName, userId);
  await persist("telegram-bot-link", userId);
  const bot = bots.get(userId);
  if (bot) bots.set(userId, { ...bot, chatId, telegramName });
}

/** Forget the chat link but keep the bot (the user sent /stop). */
export async function unlinkChat(userId: string): Promise<void> {
  db.$client
    .prepare(
      "UPDATE telegram_bots SET chat_id = NULL, telegram_name = '', linked_at = NULL WHERE user_id = ?",
    )
    .run(userId);
  await persist("telegram-bot-unlink", userId);
  const bot = bots.get(userId);
  if (bot) bots.set(userId, { ...bot, chatId: null, telegramName: "" });
}

export async function setTitleOnly(userId: string, titleOnly: boolean): Promise<boolean> {
  const result = db.$client
    .prepare("UPDATE telegram_bots SET title_only = ? WHERE user_id = ?")
    .run(titleOnly ? 1 : 0, userId);
  if (result.changes === 0) return false;
  await persist("telegram-bot-title-only", userId);
  const bot = bots.get(userId);
  if (bot) bots.set(userId, { ...bot, titleOnly });
  return true;
}

/** Remove the user's whole Telegram setup. */
export async function deleteBot(userId: string): Promise<void> {
  const result = db.$client.prepare("DELETE FROM telegram_bots WHERE user_id = ?").run(userId);
  bots.delete(userId);
  if (result.changes > 0) await persist("telegram-bot-delete", userId);
}

function pruneExpiredCodes(now: number): void {
  for (const [code, entry] of pendingCodes) {
    if (entry.expiresAt <= now) pendingCodes.delete(code);
  }
}

/**
 * Mint a one-time link code for this user; any earlier pending code for the
 * same user stops working. Telegram's start parameter allows [A-Za-z0-9_-].
 */
export function createLinkCode(userId: string, now = Date.now()): string {
  pruneExpiredCodes(now);
  for (const [code, entry] of pendingCodes) {
    if (entry.userId === userId) pendingCodes.delete(code);
  }
  const code = randomBytes(16).toString("hex");
  pendingCodes.set(code, { userId, expiresAt: now + LINK_CODE_TTL_MS });
  return code;
}

/**
 * Redeem a code that arrived on `userId`'s bot. Single-use; returns false
 * when it's unknown, expired, or minted for a different user.
 */
export function consumeLinkCode(code: string, userId: string, now = Date.now()): boolean {
  pruneExpiredCodes(now);
  const entry = pendingCodes.get(code);
  if (!entry || entry.userId !== userId) return false;
  pendingCodes.delete(code);
  return true;
}

/** Test-only: clear the in-memory cache and pending codes. */
export function _resetTelegramBotsForTests(): void {
  bots.clear();
  pendingCodes.clear();
}
