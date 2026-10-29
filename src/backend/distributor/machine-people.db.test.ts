/**
 * machine-people.db.test.ts — listMachinePeople's queries against a real
 * in-memory SQLite (the sibling test mocks the query builder, so it can't
 * catch a wrong condition). Only the columns the queries touch are created.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

vi.mock("../database/db/index.js", () => ({ db: null }));
vi.mock("../utils/logger.js", () => ({
  systemLogger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import * as schema from "../database/db/schema.js";
import { listMachinePeople } from "./machine-people.js";

const NOW = Date.parse("2026-10-29T00:00:00Z");

let sqlite: InstanceType<typeof Database>;
let database: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, mxid TEXT);
    CREATE TABLE ssh_data (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, ip TEXT NOT NULL, port INTEGER NOT NULL, username TEXT NOT NULL, machine_id INTEGER);
    CREATE TABLE host_access (id INTEGER PRIMARY KEY, host_id INTEGER NOT NULL, user_id TEXT, role_id INTEGER, expires_at TEXT);
    CREATE TABLE user_roles (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, role_id INTEGER NOT NULL);
  `);
  const users = sqlite.prepare("INSERT INTO users VALUES (?, ?, ?)");
  for (const [id, name, mxid] of [
    ["u-amy", "amy", "@amy:x"],
    ["u-ben", "ben", "@ben_human:x"],
    ["u-cat", "cat", null],
    ["u-dan", "dan", "@dan_human:x"],
    ["u-eve", "eve", "@eve_human:x"],
    ["u-fay", "fay", "@fay_human:x"],
    ["u-gus", "gus", "@gus_human:x"],
  ] as const) {
    users.run(id, name, mxid);
  }
  const host = sqlite.prepare("INSERT INTO ssh_data VALUES (?, ?, ?, ?, ?, ?)");
  host.run(1, "u-amy", "box.example", 22, "agent", 1); // the box, login "agent"
  host.run(2, "u-ben", " BOX.example ", 22, "agent", 1); // same login, typed differently
  host.run(3, "u-gus", "box.example", 22, "other", 1); // same box, different login (other home)
  host.run(4, "u-fay", "elsewhere.example", 22, "agent", 4); // unrelated box
  const grant = sqlite.prepare("INSERT INTO host_access (host_id, user_id, role_id, expires_at) VALUES (?, ?, ?, ?)");
  grant.run(1, "u-cat", null, null); // direct share
  grant.run(2, null, 9, "2027-01-01T00:00:00Z"); // live group share on the second row
  grant.run(1, "u-fay", null, "2026-10-01T00:00:00Z"); // expired
  grant.run(3, "u-eve", null, null); // share on the other login's row
  sqlite.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").run("u-dan", 9);
  database = drizzle(sqlite, { schema });
});

afterEach(() => sqlite.close());

describe("listMachinePeople (real SQLite)", () => {
  it("lists owners, shares and group members for this login's home only", async () => {
    const people = await listMachinePeople(1, NOW, database);
    expect(people?.map((p) => p.username).sort()).toEqual(["amy", "ben", "cat", "dan"]);
    expect(people?.find((p) => p.username === "cat")?.mxid).toBeNull();
  });

  it("gives the same list from either row of the same login", async () => {
    const a = (await listMachinePeople(1, NOW, database))?.map((p) => p.username).sort();
    const b = (await listMachinePeople(2, NOW, database))?.map((p) => p.username).sort();
    expect(b).toEqual(a);
  });

  it("a different login on the same box gets its own list", async () => {
    const people = await listMachinePeople(3, NOW, database);
    expect(people?.map((p) => p.username).sort()).toEqual(["eve", "gus"]);
  });

  it("unknown host → null", async () => {
    expect(await listMachinePeople(99, NOW, database)).toBeNull();
  });
});
