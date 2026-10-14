/**
 * telegram-bots — per-user bot storage (real in-memory SQLite, FieldCrypto
 * round-trip with a fixed system key), the in-memory cache, and link codes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

let sqliteDb: Database.Database;

vi.mock("../database/db/index.js", () => ({
  db: {
    get $client() {
      return sqliteDb;
    },
  },
  DatabaseSaveTrigger: { forceSave: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../utils/system-crypto.js", () => ({
  SystemCrypto: { getInstance: () => ({ getEncryptionKey: async () => Buffer.alloc(32, 7) }) },
}));
vi.mock("../utils/logger.js", () => ({
  databaseLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  LINK_CODE_TTL_MS,
  _resetTelegramBotsForTests,
  consumeLinkCode,
  createLinkCode,
  deleteBot,
  findOtherUserWithBot,
  getBot,
  isBotStillSaved,
  linkChat,
  loadAllBots,
  saveBot,
  setTitleOnly,
  unlinkChat,
} from "./telegram-bots.js";

const TOKEN_A = "111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TOKEN_B = "222:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

beforeEach(() => {
  _resetTelegramBotsForTests();
  sqliteDb = new Database(":memory:");
  sqliteDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('u1'), ('u2');
    CREATE TABLE telegram_bots (
        user_id TEXT PRIMARY KEY,
        bot_token TEXT NOT NULL,
        bot_id TEXT NOT NULL UNIQUE,
        bot_username TEXT NOT NULL,
        chat_id TEXT,
        telegram_name TEXT NOT NULL DEFAULT '',
        title_only INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        linked_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
  `);
});

describe("bot storage", () => {
  it("stores the token encrypted and returns it decrypted", async () => {
    const bot = await saveBot("u1", TOKEN_A, "111", "ash_bot");
    expect(bot).toMatchObject({ userId: "u1", token: TOKEN_A, botUsername: "ash_bot", chatId: null });
    const raw = sqliteDb.prepare("SELECT bot_token FROM telegram_bots WHERE user_id='u1'").get() as { bot_token: string };
    expect(raw.bot_token).not.toContain("AAAA");
    expect(getBot("u1")?.token).toBe(TOKEN_A);
  });

  it("loadAllBots restores the cache from the database", async () => {
    await saveBot("u1", TOKEN_A, "111", "ash_bot");
    _resetTelegramBotsForTests();
    expect(getBot("u1")).toBeNull();
    const all = await loadAllBots();
    expect(all).toHaveLength(1);
    expect(getBot("u1")?.token).toBe(TOKEN_A);
  });

  it("linking, title-only and /stop update both cache and database", async () => {
    await saveBot("u1", TOKEN_A, "111", "ash_bot");
    await linkChat("u1", "555", "@ash");
    await setTitleOnly("u1", true);
    expect(getBot("u1")).toMatchObject({ chatId: "555", telegramName: "@ash", titleOnly: true });
    await unlinkChat("u1");
    expect(getBot("u1")).toMatchObject({ chatId: null, titleOnly: true });
    _resetTelegramBotsForTests();
    await loadAllBots();
    expect(getBot("u1")).toMatchObject({ chatId: null, titleOnly: true });
  });

  it("re-saving the same bot (new token) keeps the chat link", async () => {
    await saveBot("u1", TOKEN_A, "111", "ash_bot");
    await linkChat("u1", "555", "@ash");
    const newToken = "111:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
    const bot = await saveBot("u1", newToken, "111", "ash_bot");
    expect(bot).toMatchObject({ token: newToken, chatId: "555" });
  });

  it("switching to a different bot clears the chat link", async () => {
    await saveBot("u1", TOKEN_A, "111", "ash_bot");
    await linkChat("u1", "555", "@ash");
    const bot = await saveBot("u1", TOKEN_B, "222", "ash2_bot");
    expect(bot).toMatchObject({ botUsername: "ash2_bot", chatId: null, telegramName: "" });
  });

  it("a second account saving the same bot hits the UNIQUE constraint the route maps to 409", async () => {
    await saveBot("u1", TOKEN_A, "111", "ash_bot");
    await expect(saveBot("u2", TOKEN_A, "111", "ash_bot")).rejects.toThrow(
      /UNIQUE constraint failed: telegram_bots\.bot_id/,
    );
  });

  it("isBotStillSaved tracks the row and evicts the cache when it's gone", async () => {
    await saveBot("u1", TOKEN_A, "111", "ash_bot");
    expect(isBotStillSaved("u1", "111")).toBe(true);
    expect(isBotStillSaved("u1", "222")).toBe(false);
    expect(getBot("u1")).not.toBeNull();
    sqliteDb.exec("DELETE FROM telegram_bots WHERE user_id = 'u1'");
    expect(isBotStillSaved("u1", "111")).toBe(false);
    expect(getBot("u1")).toBeNull();
  });

  it("finds another account already using a bot", async () => {
    await saveBot("u1", TOKEN_A, "111", "ash_bot");
    expect(findOtherUserWithBot("111", "u2")).toBe("u1");
    expect(findOtherUserWithBot("111", "u1")).toBeNull();
  });

  it("setTitleOnly reports false without a bot; deleteBot removes everything", async () => {
    expect(await setTitleOnly("u2", true)).toBe(false);
    await saveBot("u1", TOKEN_A, "111", "ash_bot");
    await deleteBot("u1");
    expect(getBot("u1")).toBeNull();
    expect(sqliteDb.prepare("SELECT COUNT(*) AS n FROM telegram_bots").get()).toEqual({ n: 0 });
  });
});

describe("link codes", () => {
  it("redeems once, only for the user it was minted for", () => {
    const code = createLinkCode("u1");
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    expect(consumeLinkCode(code, "u2")).toBe(false);
    expect(consumeLinkCode(code, "u1")).toBe(true);
    expect(consumeLinkCode(code, "u1")).toBe(false);
  });

  it("rejects an expired code", () => {
    const now = 1_000_000;
    const code = createLinkCode("u1", now);
    expect(consumeLinkCode(code, "u1", now + LINK_CODE_TTL_MS + 1)).toBe(false);
  });

  it("a newer code does not invalidate one the user already opened", () => {
    const first = createLinkCode("u1");
    createLinkCode("u1");
    expect(consumeLinkCode(first, "u1")).toBe(true);
  });

  it("linking retires every outstanding code for that user only", () => {
    const a = createLinkCode("u1");
    const b = createLinkCode("u1");
    const other = createLinkCode("u2");
    expect(consumeLinkCode(a, "u1")).toBe(true);
    expect(consumeLinkCode(b, "u1")).toBe(false);
    expect(consumeLinkCode(other, "u2")).toBe(true);
  });

  it("keeps at most ten live codes per user, dropping the oldest", () => {
    const codes = Array.from({ length: 11 }, () => createLinkCode("u1"));
    expect(consumeLinkCode(codes[0], "u1")).toBe(false);
    expect(consumeLinkCode(codes[10], "u1")).toBe(true);
  });
});
