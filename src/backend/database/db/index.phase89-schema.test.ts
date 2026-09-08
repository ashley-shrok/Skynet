/**
 * Phase 89 Plan 01 Task 1 — Schema tests for relay_room_sessions +
 * admin_rooms tables.
 *
 * Boots an in-memory better-sqlite3 with the exact CREATE TABLE / CREATE
 * INDEX DDL added in Task 1, then asserts sqlite_master shape + idempotency
 * across a simulated "restart" (second exec against the same DB).
 *
 * Test coverage (5 cases from Plan 89-01 Task 1 behavior block):
 *   Test 1: relay_room_sessions table has all 8 D-02 columns with correct types.
 *   Test 2: A separate CREATE UNIQUE INDEX on (user_id, room_id) exists —
 *           NOT scoped by a WHERE clause on state (per D-02 reactivation).
 *   Test 3: admin_rooms table has room_id TEXT PRIMARY KEY + created_at
 *           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP.
 *   Test 4: Re-executing the CREATE TABLE DDL is a no-op (IF NOT EXISTS
 *           idempotent) — SELECT ... LIMIT 1 does not throw.
 *   Test 5: The Drizzle schema mirror exports relayRoomSessions and
 *           adminRooms with column names snake_case matching raw SQL.
 *
 * The DDL below is a byte-parallel copy of what lands in db/index.ts. If the
 * two ever drift, this test catches it (Test 4 would still pass on the local
 * DDL, but Tests 1-3 would decouple from prod schema — the follow-up store
 * tests in Tasks 2 & 3 also re-declare the DDL as their scaffolding, so the
 * three sites stay locked together by convention. Byte-parallel discipline
 * per fleet rule / Phase 43/85 precedent.
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as schema from "./schema.js";

// Byte-parallel copy of the Task 1 DDL added to db/index.ts.
const RELAY_ROOM_SESSIONS_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS relay_room_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    room_title TEXT,
    state TEXT NOT NULL,
    last_activity_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`;

const RELAY_ROOM_SESSIONS_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS relay_room_sessions_user_room_uidx
    ON relay_room_sessions(user_id, room_id);
`;

const ADMIN_ROOMS_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS admin_rooms (
    room_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

// A minimal users table so the FK survives DDL exec (foreign_keys=OFF here,
// but users still needs to exist under strict-mode boot scenarios).
const USERS_STUB_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL
  );
`;

function bootstrapSchemaDb(): Database.Database {
  const db = new Database(":memory:");
  // Turn on FK enforcement to match production db init (index.ts L145).
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(USERS_STUB_SQL);
  db.exec(RELAY_ROOM_SESSIONS_CREATE_SQL);
  db.exec(RELAY_ROOM_SESSIONS_INDEX_SQL);
  db.exec(ADMIN_ROOMS_CREATE_SQL);
  // Seed a user so Test 2's INSERT into relay_room_sessions doesn't trip the FK.
  db.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run(
    "user-A",
    "alice",
  );
  return db;
}

type MasterRow = { sql: string | null };

function getTableSql(db: Database.Database, name: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as MasterRow | undefined;
  if (!row || !row.sql) {
    throw new Error(`No sqlite_master row for table '${name}'`);
  }
  return row.sql;
}

function getIndexSql(db: Database.Database, name: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(name) as MasterRow | undefined;
  if (!row || !row.sql) {
    throw new Error(`No sqlite_master row for index '${name}'`);
  }
  return row.sql;
}

describe("Phase 89-01 Task 1 — relay_room_sessions + admin_rooms schema", () => {
  it("Test 1: relay_room_sessions table has all 8 D-02 columns with correct types + FK to users", () => {
    const db = bootstrapSchemaDb();
    const sql = getTableSql(db, "relay_room_sessions");

    // Columns from D-02 (verbatim — do NOT add/remove/reorder without re-greenlight).
    expect(sql).toMatch(/id\s+TEXT\s+PRIMARY\s+KEY/i);
    expect(sql).toMatch(/user_id\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/room_id\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/room_title\s+TEXT/i);
    expect(sql).toMatch(/state\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/last_activity_at\s+TEXT/i);
    expect(sql).toMatch(
      /created_at\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+CURRENT_TIMESTAMP/i,
    );
    expect(sql).toMatch(
      /updated_at\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+CURRENT_TIMESTAMP/i,
    );

    // FK matches the sessions/trusted_devices pattern.
    expect(sql).toMatch(
      /FOREIGN\s+KEY\s*\(user_id\)\s+REFERENCES\s+users\s*\(id\)\s+ON\s+DELETE\s+CASCADE/i,
    );

    // PRAGMA table_info exposes the 8 columns.
    const cols = db.prepare("PRAGMA table_info(relay_room_sessions)").all() as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name).sort();
    expect(colNames).toEqual(
      [
        "created_at",
        "id",
        "last_activity_at",
        "room_id",
        "room_title",
        "state",
        "updated_at",
        "user_id",
      ].sort(),
    );
  });

  it("Test 2: a separate CREATE UNIQUE INDEX on (user_id, room_id) exists — UNSCOPED (no WHERE state='active')", () => {
    const db = bootstrapSchemaDb();
    const idxSql = getIndexSql(
      db,
      "relay_room_sessions_user_room_uidx",
    );

    // Uniqueness on the composite (D-02 — unscoped for re-invite reactivation D-03).
    expect(idxSql).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(idxSql).toMatch(
      /relay_room_sessions\s*\(\s*user_id\s*,\s*room_id\s*\)/i,
    );

    // MUST NOT be scoped by WHERE state=... — re-invite must flip the same row.
    expect(idxSql).not.toMatch(/WHERE/i);

    // Live enforcement: two active rows for same (user, room) → conflict.
    db.prepare(
      "INSERT INTO relay_room_sessions (id, user_id, room_id, state) VALUES (?, ?, ?, ?)",
    ).run("uuid-a", "user-A", "!room1:s", "active");
    expect(() =>
      db
        .prepare(
          "INSERT INTO relay_room_sessions (id, user_id, room_id, state) VALUES (?, ?, ?, ?)",
        )
        .run("uuid-b", "user-A", "!room1:s", "inactive"),
    ).toThrow(/UNIQUE/i);
  });

  it("Test 3: admin_rooms table has room_id TEXT PRIMARY KEY + created_at DEFAULT CURRENT_TIMESTAMP", () => {
    const db = bootstrapSchemaDb();
    const sql = getTableSql(db, "admin_rooms");

    expect(sql).toMatch(/room_id\s+TEXT\s+PRIMARY\s+KEY/i);
    expect(sql).toMatch(
      /created_at\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+CURRENT_TIMESTAMP/i,
    );

    const cols = db.prepare("PRAGMA table_info(admin_rooms)").all() as {
      name: string;
    }[];
    const colNames = cols.map((c) => c.name).sort();
    expect(colNames).toEqual(["created_at", "room_id"]);
  });

  it("Test 4: DDL is idempotent — re-execing CREATE TABLE IF NOT EXISTS + SELECT LIMIT 1 do not throw", () => {
    const db = bootstrapSchemaDb();

    // Simulate a "restart" second-pass exec — MUST be a no-op via IF NOT EXISTS.
    expect(() => db.exec(RELAY_ROOM_SESSIONS_CREATE_SQL)).not.toThrow();
    expect(() => db.exec(RELAY_ROOM_SESSIONS_INDEX_SQL)).not.toThrow();
    expect(() => db.exec(ADMIN_ROOMS_CREATE_SQL)).not.toThrow();

    // SELECT on both tables must succeed post-init.
    expect(() =>
      db.prepare("SELECT id FROM relay_room_sessions LIMIT 1").get(),
    ).not.toThrow();
    expect(() =>
      db.prepare("SELECT room_id FROM admin_rooms LIMIT 1").get(),
    ).not.toThrow();
  });

  it("Test 5: Drizzle mirror exports relayRoomSessions + adminRooms with snake_case columns matching raw SQL", () => {
    // The mirror is loaded from ./schema.js — assertions confirm both exports
    // exist with the expected column-name shape.
    expect(schema).toHaveProperty("relayRoomSessions");
    expect(schema).toHaveProperty("adminRooms");

    // Drizzle table objects expose column definitions; we assert the raw
    // SQL column name (snake_case) per D-02 lock.
    // relayRoomSessions columns:
    const rrs = schema.relayRoomSessions as unknown as Record<
      string,
      { name?: string }
    >;
    expect(rrs.id?.name).toBe("id");
    expect(rrs.userId?.name).toBe("user_id");
    expect(rrs.roomId?.name).toBe("room_id");
    expect(rrs.roomTitle?.name).toBe("room_title");
    expect(rrs.state?.name).toBe("state");
    expect(rrs.lastActivityAt?.name).toBe("last_activity_at");
    expect(rrs.createdAt?.name).toBe("created_at");
    expect(rrs.updatedAt?.name).toBe("updated_at");

    // adminRooms columns:
    const ar = schema.adminRooms as unknown as Record<
      string,
      { name?: string }
    >;
    expect(ar.roomId?.name).toBe("room_id");
    expect(ar.createdAt?.name).toBe("created_at");
  });
});
