/**
 * Telegram link store — which Telegram chat receives each user's
 * notifications, plus the short-lived one-time codes that create a link.
 *
 * Linking flow:
 *   1. The preferences pane asks for a link → `createLinkCode(userId)` mints a
 *      random code and the route returns `https://t.me/<bot>?start=<code>`.
 *   2. The user taps Start in Telegram; the bot receives `/start <code>`.
 *   3. The update poller calls `consumeLinkCode(code)` → userId, then
 *      `saveLink(...)` with the chat the /start came from.
 *
 * Codes live in memory only (15-minute TTL). A restart drops pending codes,
 * which just means the user taps Connect again.
 */

import { randomBytes } from "node:crypto";
import { db, DatabaseSaveTrigger } from "../database/db/index.js";
import { databaseLogger } from "../utils/logger.js";

export const LINK_CODE_TTL_MS = 15 * 60 * 1000;

export interface TelegramLink {
  userId: string;
  chatId: string;
  telegramName: string;
  titleOnly: boolean;
  linkedAt: string;
}

interface TelegramLinkRow {
  user_id: string;
  chat_id: string;
  telegram_name: string;
  title_only: number;
  linked_at: string;
}

const pendingCodes = new Map<string, { userId: string; expiresAt: number }>();

function pruneExpiredCodes(now: number): void {
  for (const [code, entry] of pendingCodes) {
    if (entry.expiresAt <= now) pendingCodes.delete(code);
  }
}

/**
 * Mint a one-time link code for this user. Any earlier pending code for the
 * same user is invalidated so only the newest Connect tap works.
 * Telegram's start parameter allows [A-Za-z0-9_-], up to 64 chars.
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

/** Redeem a link code. Returns the userId, or null if unknown/expired. Single-use. */
export function consumeLinkCode(code: string, now = Date.now()): string | null {
  pruneExpiredCodes(now);
  const entry = pendingCodes.get(code);
  if (!entry) return null;
  pendingCodes.delete(code);
  return entry.userId;
}

function toLink(row: TelegramLinkRow): TelegramLink {
  return {
    userId: row.user_id,
    chatId: row.chat_id,
    telegramName: row.telegram_name,
    titleOnly: !!row.title_only,
    linkedAt: row.linked_at,
  };
}

export function getLink(userId: string): TelegramLink | null {
  const row = db.$client
    .prepare(
      "SELECT user_id, chat_id, telegram_name, title_only, linked_at FROM telegram_links WHERE user_id = ?",
    )
    .get(userId) as TelegramLinkRow | undefined;
  return row ? toLink(row) : null;
}

/** Every user linked to this chat (normally one; a chat can serve several accounts). */
export function getUserIdsForChat(chatId: string): string[] {
  const rows = db.$client
    .prepare("SELECT user_id FROM telegram_links WHERE chat_id = ?")
    .all(chatId) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

async function persist(reason: string, userId: string): Promise<void> {
  try {
    await DatabaseSaveTrigger.forceSave(reason);
  } catch (err) {
    databaseLogger.warn("[telegram] forceSave failed (non-fatal — write in RAM)", {
      operation: "telegram_link_force_save_failed",
      reason,
      userId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

/** Create or replace the user's link. Re-linking keeps their title-only choice. */
export async function saveLink(
  userId: string,
  chatId: string,
  telegramName: string,
): Promise<void> {
  db.$client
    .prepare(
      `INSERT INTO telegram_links (user_id, chat_id, telegram_name) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         chat_id = excluded.chat_id,
         telegram_name = excluded.telegram_name,
         linked_at = CURRENT_TIMESTAMP`,
    )
    .run(userId, chatId, telegramName);
  await persist("telegram-link-save", userId);
}

export async function setTitleOnly(userId: string, titleOnly: boolean): Promise<boolean> {
  const result = db.$client
    .prepare("UPDATE telegram_links SET title_only = ? WHERE user_id = ?")
    .run(titleOnly ? 1 : 0, userId);
  if (result.changes === 0) return false;
  await persist("telegram-link-title-only", userId);
  return true;
}

export async function deleteLink(userId: string): Promise<void> {
  const result = db.$client
    .prepare("DELETE FROM telegram_links WHERE user_id = ?")
    .run(userId);
  if (result.changes > 0) await persist("telegram-link-delete", userId);
}

/** Test-only: clear pending link codes. */
export function _resetLinkCodesForTests(): void {
  pendingCodes.clear();
}
