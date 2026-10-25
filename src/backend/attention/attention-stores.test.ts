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

  it("backs off after a failed load instead of retrying every call", () => {
    let calls = 0;
    let clock = 0;
    const store = createTurnFinishStore({
      sqlite: () => {
        calls++;
        throw new Error("boom");
      },
      save: vi.fn(),
      now: () => clock,
    });
    store.get("h1", "a");
    store.get("h1", "b");
    store.record("h1", "a", 1);
    expect(calls).toBe(1);
    clock = 31_000;
    store.get("h1", "a");
    expect(calls).toBe(2);
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
    expect(store.getForUser("u1")).toEqual({ baselineAt: 5000, seen: [], dms: [] });
    const later = createReadStateStore({ sqlite: () => sqlite, now: () => 9999, save: vi.fn(), forceSave: vi.fn() });
    expect(later.getForUser("u1").baselineAt).toBe(5000);
    expect(forceSave).toHaveBeenCalledTimes(1);
  });

  it("launch day: a new user's baseline records every turn already logged as seen", () => {
    const turns = createTurnFinishStore({ sqlite: () => sqlite, save: vi.fn() });
    turns.record("h1", "aspen", 4_000);
    turns.record("h1", "birch", 9_000); // even a machine clock ahead of the server
    const { store } = make(5_000);
    const state = store.getForUser("u1");
    expect(state.seen).toEqual(
      expect.arrayContaining([
        { hostId: "h1", identityName: "aspen", seenFinishAt: 4_000 },
        { hostId: "h1", identityName: "birch", seenFinishAt: 9_000 },
      ]),
    );
    // Only on creation: a later turn is not auto-seen.
    turns.record("h1", "aspen", 6_000);
    expect(store.getForUser("u1").seen).toContainEqual({ hostId: "h1", identityName: "aspen", seenFinishAt: 4_000 });
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

describe("read-state store — DM marks", () => {
  const make = () => {
    const save = vi.fn();
    const forceSave = vi.fn();
    const store = createReadStateStore({ sqlite: () => sqlite, now: () => 5000, save, forceSave });
    return { store, save, forceSave };
  };

  it("records a DM (max-wins), force-saves it, and returns it on read", () => {
    const { store, forceSave } = make();
    expect(store.recordDm("u1", "h1", "aspen", 1000)).toEqual({
      hostId: "h1", identityName: "aspen", lastDmAt: 1000, seenDmAt: 0,
    });
    expect(store.recordDm("u1", "h1", "aspen", 900)).toBeNull();
    expect(store.recordDm("u1", "h1", "aspen", 1000)).toBeNull();
    expect(store.recordDm("u1", "h1", "aspen", 2000)?.lastDmAt).toBe(2000);
    expect(forceSave).toHaveBeenCalledTimes(2);
    expect(store.getForUser("u1").dms).toEqual([
      { hostId: "h1", identityName: "aspen", lastDmAt: 2000, seenDmAt: 0 },
    ]);
  });

  it("marks a DM seen monotonically, never past the recorded DM", () => {
    const { store, save } = make();
    expect(store.markDmSeen("u1", "h1", "aspen", 1000)).toBeNull(); // nothing recorded
    store.recordDm("u1", "h1", "aspen", 1000);
    expect(store.markDmSeen("u1", "h1", "aspen", 1500)).toBeNull(); // past the DM
    expect(store.markDmSeen("u1", "h1", "aspen", 1000)?.seenDmAt).toBe(1000);
    expect(store.markDmSeen("u1", "h1", "aspen", 1000)).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    // A newer DM makes it DM'd again; the old seen value stays.
    expect(store.recordDm("u1", "h1", "aspen", 3000)).toEqual({
      hostId: "h1", identityName: "aspen", lastDmAt: 3000, seenDmAt: 1000,
    });
  });

  it("keeps DMs per user and per host", () => {
    const { store } = make();
    store.recordDm("u1", "h1", "aspen", 1000);
    store.recordDm("u1", "h2", "aspen", 4000);
    expect(store.getForUser("u2").dms).toEqual([]);
    expect(store.getForUser("u1").dms).toHaveLength(2);
    expect(store.markDmSeen("u2", "h1", "aspen", 1000)).toBeNull();
  });

  it("rejects junk input", () => {
    const { store } = make();
    expect(store.recordDm("", "h1", "aspen", 1)).toBeNull();
    expect(store.recordDm("u1", "h1", "", 1)).toBeNull();
    expect(store.recordDm("u1", "h1", "aspen", Number.NaN)).toBeNull();
    expect(store.markDmSeen("u1", "h1", "aspen", 0)).toBeNull();
  });
});

describe("read-state store — markSeenForAllUsers (the user replied)", () => {
  it("advances every tracked user's mark, returns only those that moved, and skips untracked users", () => {
    const save = vi.fn();
    const store = createReadStateStore({ sqlite: () => sqlite, now: () => 100, save, forceSave: vi.fn() });
    store.getForUser("u1");
    store.getForUser("u2");
    store.markSeen("u2", "h1", "aspen", 5000);

    expect(store.markSeenForAllUsers("h1", "aspen", 3000)).toEqual(["u1"]);
    expect(store.getForUser("u1").seen).toContainEqual({ hostId: "h1", identityName: "aspen", seenFinishAt: 3000 });
    expect(store.getForUser("u2").seen).toContainEqual({ hostId: "h1", identityName: "aspen", seenFinishAt: 5000 });

    expect(store.markSeenForAllUsers("h1", "aspen", 3000)).toEqual([]);
    expect(store.markSeenForAllUsers("h1", "aspen", 6000).sort()).toEqual(["u1", "u2"]);
    expect(save).toHaveBeenCalled();
  });

  it("does nothing with no tracked users or bad input", () => {
    const store = createReadStateStore({ sqlite: () => sqlite, now: () => 100, save: vi.fn(), forceSave: vi.fn() });
    expect(store.markSeenForAllUsers("h1", "aspen", 3000)).toEqual([]);
    expect(store.markSeenForAllUsers("", "aspen", 3000)).toEqual([]);
    expect(store.markSeenForAllUsers("h1", "aspen", 0)).toEqual([]);
  });
});
