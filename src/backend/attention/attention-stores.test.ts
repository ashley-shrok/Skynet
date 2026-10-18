/**
 * attention-stores.test.ts — turn-finish log + per-user read state, run
 * against a real in-memory SQLite with the production DDL.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";

vi.mock("../database/db/index.js", () => ({
  getSqlite: () => {
    throw new Error("not used in these tests");
  },
}));
vi.mock("../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { triggerSave: vi.fn(), forceSave: vi.fn() },
}));
vi.mock("../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { ATTENTION_TABLES_SQL } from "./attention-schema.js";
import { createTurnFinishStore } from "./turn-finish-store.js";
import { createReadStateStore } from "./read-state-store.js";

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users (id) VALUES ('u1'), ('u2');");
  sqlite.exec(ATTENTION_TABLES_SQL);
});

describe("turn-finish store", () => {
  it("records, advances monotonically, and saves only on advance", () => {
    const save = vi.fn();
    const store = createTurnFinishStore({ sqlite: () => sqlite, save });
    expect(store.get("h1", "aspen")).toBeNull();
    expect(store.record("h1", "aspen", 1000)).toBe(true);
    expect(store.record("h1", "aspen", 900)).toBe(false);
    expect(store.record("h1", "aspen", 1000)).toBe(false);
    expect(store.get("h1", "aspen")).toBe(1000);
    expect(store.record("h1", "aspen", 2000)).toBe(true);
    expect(store.get("h1", "aspen")).toBe(2000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("keeps hosts apart — same name on two hosts is two identities", () => {
    const store = createTurnFinishStore({ sqlite: () => sqlite, save: vi.fn() });
    store.record("h1", "aspen", 1000);
    store.record("h2", "aspen", 5000);
    expect(store.get("h1", "aspen")).toBe(1000);
    expect(store.get("h2", "aspen")).toBe(5000);
  });

  it("survives a restart (a fresh store reads what the last one wrote)", () => {
    createTurnFinishStore({ sqlite: () => sqlite, save: vi.fn() }).record("h1", "aspen", 1234);
    const fresh = createTurnFinishStore({ sqlite: () => sqlite, save: vi.fn() });
    expect(fresh.get("h1", "aspen")).toBe(1234);
    expect(fresh.record("h1", "aspen", 1000)).toBe(false);
  });

  it("rejects junk input without writing", () => {
    const save = vi.fn();
    const store = createTurnFinishStore({ sqlite: () => sqlite, save });
    expect(store.record("", "aspen", 1)).toBe(false);
    expect(store.record("h1", "", 1)).toBe(false);
    expect(store.record("h1", "aspen", Number.NaN)).toBe(false);
    expect(store.record("h1", "aspen", 0)).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("fails open when the database throws", () => {
    const store = createTurnFinishStore({
      sqlite: () => {
        throw new Error("boom");
      },
      save: vi.fn(),
    });
    expect(store.get("h1", "aspen")).toBeNull();
    expect(store.record("h1", "aspen", 1000)).toBe(false);
  });
});

describe("read-state store", () => {
  const make = (now = 5000) => {
    const save = vi.fn();
    const forceSave = vi.fn();
    const store = createReadStateStore({ sqlite: () => sqlite, now: () => now, save, forceSave });
    return { store, save, forceSave };
  };

  it("creates the baseline once, on first read, and force-saves it", () => {
    const { store, forceSave } = make(5000);
    expect(store.getForUser("u1")).toEqual({ baselineAt: 5000, seen: [] });
    const later = createReadStateStore({ sqlite: () => sqlite, now: () => 9999, save: vi.fn(), forceSave: vi.fn() });
    expect(later.getForUser("u1").baselineAt).toBe(5000);
    expect(forceSave).toHaveBeenCalledTimes(1);
  });

  it("marks seen monotonically and returns it per user", () => {
    const { store, save } = make();
    expect(store.markSeen("u1", "h1", "aspen", 100)).toBe(true);
    expect(store.markSeen("u1", "h1", "aspen", 50)).toBe(false);
    expect(store.markSeen("u1", "h1", "aspen", 100)).toBe(false);
    expect(store.markSeen("u1", "h1", "aspen", 200)).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(store.getForUser("u1").seen).toEqual([
      { hostId: "h1", identityName: "aspen", seenFinishAt: 200 },
    ]);
  });

  it("keeps each user's read state separate on a shared agent", () => {
    const { store } = make();
    store.markSeen("u1", "h1", "aspen", 300);
    expect(store.getForUser("u2").seen).toEqual([]);
    expect(store.getForUser("u1").seen).toHaveLength(1);
  });

  it("rejects junk input", () => {
    const { store } = make();
    expect(store.markSeen("", "h1", "aspen", 1)).toBe(false);
    expect(store.markSeen("u1", "", "aspen", 1)).toBe(false);
    expect(store.markSeen("u1", "h1", "x".repeat(300), 1)).toBe(false);
    expect(store.markSeen("u1", "h1", "aspen", -1)).toBe(false);
  });
});
