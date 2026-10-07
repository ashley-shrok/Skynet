import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { applyMachineIdSchema } from "./machine-id-migration.js";

let sqlite: Database.Database;

function insert(userId: string, ip: string, port = 22): number {
  return Number(
    sqlite
      .prepare("INSERT INTO ssh_data (user_id, ip, port) VALUES (?, ?, ?)")
      .run(userId, ip, port).lastInsertRowid,
  );
}

function machineOf(id: number): number | null {
  return (
    sqlite.prepare("SELECT machine_id FROM ssh_data WHERE id = ?").get(id) as {
      machine_id: number | null;
    }
  ).machine_id;
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE ssh_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      ip TEXT NOT NULL,
      port INTEGER NOT NULL
    )
  `);
});

describe("machine_id backfill", () => {
  it("groups existing rows by ip+port, anchored on the oldest row", () => {
    const a = insert("alice", "10.0.0.5");
    const b = insert("alice", "10.0.0.6");
    const c = insert("bob", " 10.0.0.5 ".toUpperCase());
    const d = insert("bob", "10.0.0.5", 2222);

    applyMachineIdSchema(sqlite);

    expect(machineOf(a)).toBe(a);
    expect(machineOf(b)).toBe(b);
    expect(machineOf(c)).toBe(a);
    expect(machineOf(d)).toBe(d);
  });

  it("is idempotent across boots", () => {
    insert("alice", "10.0.0.5");
    applyMachineIdSchema(sqlite);
    expect(() => applyMachineIdSchema(sqlite)).not.toThrow();
  });
});

describe("machine_id triggers", () => {
  beforeEach(() => applyMachineIdSchema(sqlite));

  it("a new row joins an existing machine or anchors its own", () => {
    const a = insert("alice", "box.tailnet");
    const b = insert("bob", "BOX.tailnet");
    const c = insert("bob", "other.tailnet");
    expect(machineOf(a)).toBe(a);
    expect(machineOf(b)).toBe(a);
    expect(machineOf(c)).toBe(c);
  });

  it("re-addressing a non-anchor row moves only that row", () => {
    const a = insert("alice", "box");
    const b = insert("bob", "box");
    const c = insert("carol", "other");
    sqlite.prepare("UPDATE ssh_data SET ip = 'other' WHERE id = ?").run(b);
    expect(machineOf(a)).toBe(a);
    expect(machineOf(b)).toBe(c);
  });

  it("re-addressing the anchor re-anchors the rest of its old group", () => {
    const a = insert("alice", "box");
    const b = insert("bob", "box");
    const c = insert("carol", "box");
    sqlite.prepare("UPDATE ssh_data SET ip = 'new-box' WHERE id = ?").run(a);
    expect(machineOf(a)).toBe(a);
    expect(machineOf(b)).toBe(b);
    expect(machineOf(c)).toBe(b);
  });

  it("updates that do not change the address leave machine_id alone", () => {
    const a = insert("alice", "box");
    const b = insert("bob", "box");
    sqlite.prepare("UPDATE ssh_data SET ip = 'BOX' WHERE id = ?").run(a);
    expect(machineOf(a)).toBe(a);
    expect(machineOf(b)).toBe(a);
  });
});
