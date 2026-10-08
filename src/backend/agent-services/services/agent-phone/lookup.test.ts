/**
 * userHasRegisteredHost — runs the real drizzle query against an in-memory
 * SQLite `ssh_data` table (only the columns the query touches).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

let drizzleInstance: ReturnType<typeof drizzle>;

vi.mock("../../../database/db/index.js", () => ({
  getDb: () => drizzleInstance,
}));

import { userHasRegisteredHost } from "./lookup.js";

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE ssh_data (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      ip TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL
    );
  `);
  const insert = sqlite.prepare(
    "INSERT INTO ssh_data (id, user_id, ip, port, username) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run(1, "alice", "10.0.0.5", 22, "agent"); // alice's box
  insert.run(2, "bob", "10.0.0.5", 22, "agent"); // bob registered the same box
  insert.run(3, "bob", "10.0.0.9", 22, "agent"); // bob-only box
  insert.run(4, "carol", "10.0.0.9", 2222, "agent"); // same ip, different port
  insert.run(5, "dave", "10.0.0.9", 22, "other"); // same ip+port, different login
  drizzleInstance = drizzle(sqlite);
});

describe("userHasRegisteredHost", () => {
  it("allows the owner of the origin host row", async () => {
    expect(await userHasRegisteredHost("alice", 1)).toBe(true);
  });

  it("allows a user who registered the same machine under their own row", async () => {
    expect(await userHasRegisteredHost("bob", 1)).toBe(true);
    expect(await userHasRegisteredHost("alice", 2)).toBe(true);
  });

  it("rejects a user who has not registered the machine", async () => {
    expect(await userHasRegisteredHost("alice", 3)).toBe(false);
  });

  it("treats a different port or login as a different machine", async () => {
    expect(await userHasRegisteredHost("carol", 3)).toBe(false);
    expect(await userHasRegisteredHost("dave", 3)).toBe(false);
  });

  it("rejects when the origin host row does not exist", async () => {
    expect(await userHasRegisteredHost("alice", 999)).toBe(false);
  });
});
