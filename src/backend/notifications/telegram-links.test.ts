/**
 * telegram-links — link-code lifecycle and the telegram_links table, against
 * a real in-memory SQLite (the db module is mocked to point at it).
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

vi.mock("../utils/logger.js", () => ({
  databaseLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  LINK_CODE_TTL_MS,
  _resetLinkCodesForTests,
  consumeLinkCode,
  createLinkCode,
  deleteLink,
  getLink,
  getUserIdsForChat,
  saveLink,
  setTitleOnly,
} from "./telegram-links.js";

beforeEach(() => {
  _resetLinkCodesForTests();
  sqliteDb = new Database(":memory:");
  sqliteDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO users (id) VALUES ('u1'), ('u2');
    CREATE TABLE telegram_links (
        user_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        telegram_name TEXT NOT NULL DEFAULT '',
        title_only INTEGER NOT NULL DEFAULT 0,
        linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
  `);
});

describe("link codes", () => {
  it("redeems a fresh code exactly once", () => {
    const code = createLinkCode("u1");
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    expect(consumeLinkCode(code)).toBe("u1");
    expect(consumeLinkCode(code)).toBeNull();
  });

  it("rejects an expired code", () => {
    const now = 1_000_000;
    const code = createLinkCode("u1", now);
    expect(consumeLinkCode(code, now + LINK_CODE_TTL_MS + 1)).toBeNull();
  });

  it("a newer code for the same user invalidates the older one", () => {
    const first = createLinkCode("u1");
    const second = createLinkCode("u1");
    expect(consumeLinkCode(first)).toBeNull();
    expect(consumeLinkCode(second)).toBe("u1");
  });

  it("codes for different users are independent", () => {
    const a = createLinkCode("u1");
    const b = createLinkCode("u2");
    expect(consumeLinkCode(a)).toBe("u1");
    expect(consumeLinkCode(b)).toBe("u2");
  });

  it("rejects an unknown code", () => {
    expect(consumeLinkCode("nope")).toBeNull();
  });
});

describe("telegram_links store", () => {
  it("saves and reads a link", async () => {
    await saveLink("u1", "555", "@ash");
    expect(getLink("u1")).toMatchObject({ userId: "u1", chatId: "555", telegramName: "@ash", titleOnly: false });
    expect(getLink("u2")).toBeNull();
  });

  it("re-linking replaces the chat but keeps title-only", async () => {
    await saveLink("u1", "555", "@ash");
    await setTitleOnly("u1", true);
    await saveLink("u1", "777", "@ash2");
    expect(getLink("u1")).toMatchObject({ chatId: "777", telegramName: "@ash2", titleOnly: true });
  });

  it("setTitleOnly reports false when the user isn't linked", async () => {
    expect(await setTitleOnly("u2", true)).toBe(false);
  });

  it("finds every user linked to a chat, and deletes links", async () => {
    await saveLink("u1", "555", "");
    await saveLink("u2", "555", "");
    expect(getUserIdsForChat("555").sort()).toEqual(["u1", "u2"]);
    await deleteLink("u1");
    expect(getLink("u1")).toBeNull();
    expect(getUserIdsForChat("555")).toEqual(["u2"]);
  });
});
