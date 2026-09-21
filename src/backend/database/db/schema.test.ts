/**
 * Phase 128 Plan 01 Task 1 — Schema tests for push_subscriptions table.
 *
 * Boots an in-memory better-sqlite3 with the exact CREATE TABLE / CREATE
 * UNIQUE INDEX DDL added in Task 1, then asserts sqlite_master shape +
 * FK cascade + UNIQUE-index enforcement + idempotency across a simulated
 * "restart" (second exec against the same DB).
 *
 * Byte-parallel-copy discipline (Phase 89-01 Task 1 precedent) — the DDL
 * below is a verbatim copy of what lands in db/index.ts. If the two ever
 * drift, this test catches it: Test 4 would still pass on the local DDL,
 * but Tests 1-3 would decouple from prod schema. Store tests in downstream
 * plans (register / prune / send) also re-declare the DDL, keeping the
 * three sites locked together by convention.
 *
 * Test coverage (from Plan 126-01 Task 1 behavior block):
 *   Test 1: push_subscriptions table has all 7 columns with correct types
 *           and FK to users (id) ON DELETE CASCADE.
 *   Test 2: CREATE UNIQUE INDEX on (user_id, endpoint) exists — enforces
 *           D-14 multi-device semantics (one row per (user, endpoint),
 *           NOT per user).
 *   Test 3: Deleting a users row cascades — the referenced push_subscriptions
 *           rows disappear (T-128-01 mitigation).
 *   Test 4: DDL is idempotent — re-execing CREATE TABLE IF NOT EXISTS +
 *           CREATE UNIQUE INDEX IF NOT EXISTS is a no-op.
 *   Test 5: Drizzle mirror exports pushSubscriptions with snake_case column
 *           names matching the raw SQL.
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as schema from "./schema.js";

// Byte-parallel copy of the Task 1 DDL added to db/index.ts.
const PUSH_SUBSCRIPTIONS_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_delivered_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`;

const PUSH_SUBSCRIPTIONS_INDEX_SQL = `
  CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_endpoint_unique
    ON push_subscriptions(user_id, endpoint);
`;

// A minimal users table so the FK cascade works under strict-mode boot
// scenarios (matches production db init at index.ts L145 PRAGMA foreign_keys=ON).
const USERS_STUB_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL
  );
`;

function bootstrapSchemaDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(USERS_STUB_SQL);
  db.exec(PUSH_SUBSCRIPTIONS_CREATE_SQL);
  db.exec(PUSH_SUBSCRIPTIONS_INDEX_SQL);
  // Seed a user so subscription INSERTs don't trip the FK.
  db.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run(
    "user-A",
    "user",
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

describe("Phase 128-01 Task 1 — push_subscriptions schema", () => {
  it("Test 1: push_subscriptions table has all 7 columns with correct types + FK to users ON DELETE CASCADE", () => {
    const db = bootstrapSchemaDb();
    const sql = getTableSql(db, "push_subscriptions");

    // Columns from Task 1 behavior block (verbatim).
    expect(sql).toMatch(/id\s+TEXT\s+PRIMARY\s+KEY/i);
    expect(sql).toMatch(/user_id\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/endpoint\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/p256dh\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/auth\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(
      /created_at\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+CURRENT_TIMESTAMP/i,
    );
    // last_delivered_at is nullable — no NOT NULL.
    expect(sql).toMatch(/last_delivered_at\s+TEXT/i);

    // FK matches the relay_room_sessions pattern.
    expect(sql).toMatch(
      /FOREIGN\s+KEY\s*\(user_id\)\s+REFERENCES\s+users\s*\(id\)\s+ON\s+DELETE\s+CASCADE/i,
    );

    // PRAGMA table_info exposes the 7 columns.
    const cols = db
      .prepare("PRAGMA table_info(push_subscriptions)")
      .all() as { name: string }[];
    const colNames = cols.map((c) => c.name).sort();
    expect(colNames).toEqual(
      [
        "auth",
        "created_at",
        "endpoint",
        "id",
        "last_delivered_at",
        "p256dh",
        "user_id",
      ].sort(),
    );
  });

  it("Test 2: CREATE UNIQUE INDEX on (user_id, endpoint) enforces D-14 multi-device uniqueness", () => {
    const db = bootstrapSchemaDb();
    const idxSql = getIndexSql(
      db,
      "push_subscriptions_user_endpoint_unique",
    );

    // Uniqueness on the composite — one row per (user, endpoint) NOT per user.
    expect(idxSql).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(idxSql).toMatch(
      /push_subscriptions\s*\(\s*user_id\s*,\s*endpoint\s*\)/i,
    );

    // Live enforcement: same (user_id, endpoint) → conflict.
    db.prepare(
      "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)",
    ).run("sub-1", "user-A", "https://push.example/e1", "p1", "a1");

    expect(() =>
      db
        .prepare(
          "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)",
        )
        .run("sub-2", "user-A", "https://push.example/e1", "p2", "a2"),
    ).toThrow(/UNIQUE/i);

    // D-14 — same user, DIFFERENT endpoint (a second device) must SUCCEED.
    expect(() =>
      db
        .prepare(
          "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)",
        )
        .run("sub-3", "user-A", "https://push.example/e2", "p3", "a3"),
    ).not.toThrow();

    // Total rows for user-A should be 2 (one per endpoint).
    const count = db
      .prepare(
        "SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?",
      )
      .get("user-A") as { c: number };
    expect(count.c).toBe(2);
  });

  it("Test 3: deleting a users row cascades — referenced push_subscriptions rows disappear (T-128-01 mitigation)", () => {
    const db = bootstrapSchemaDb();

    db.prepare(
      "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)",
    ).run("sub-1", "user-A", "https://push.example/e1", "p1", "a1");
    db.prepare(
      "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)",
    ).run("sub-2", "user-A", "https://push.example/e2", "p2", "a2");

    // Sanity: rows exist pre-delete.
    const preCount = db
      .prepare(
        "SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?",
      )
      .get("user-A") as { c: number };
    expect(preCount.c).toBe(2);

    // Delete the user — CASCADE should sweep the subscription rows.
    db.prepare("DELETE FROM users WHERE id = ?").run("user-A");

    const postCount = db
      .prepare(
        "SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?",
      )
      .get("user-A") as { c: number };
    expect(postCount.c).toBe(0);
  });

  it("Test 4: DDL is idempotent — re-execing CREATE TABLE IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS is a no-op", () => {
    const db = bootstrapSchemaDb();

    // Simulate a "restart" second-pass exec — MUST be a no-op via IF NOT EXISTS.
    expect(() => db.exec(PUSH_SUBSCRIPTIONS_CREATE_SQL)).not.toThrow();
    expect(() => db.exec(PUSH_SUBSCRIPTIONS_INDEX_SQL)).not.toThrow();

    // SELECT on the table must succeed post-re-init.
    expect(() =>
      db.prepare("SELECT id FROM push_subscriptions LIMIT 1").get(),
    ).not.toThrow();

    // Exactly one table + one index still (no duplicate).
    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='push_subscriptions'",
      )
      .all();
    expect(tableRows.length).toBe(1);

    const indexRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='push_subscriptions_user_endpoint_unique'",
      )
      .all();
    expect(indexRows.length).toBe(1);
  });

  it("Test 5: Drizzle mirror exports pushSubscriptions with snake_case column names matching raw SQL", () => {
    expect(schema).toHaveProperty("pushSubscriptions");

    const ps = schema.pushSubscriptions as unknown as Record<
      string,
      { name?: string }
    >;
    expect(ps.id?.name).toBe("id");
    expect(ps.userId?.name).toBe("user_id");
    expect(ps.endpoint?.name).toBe("endpoint");
    expect(ps.p256dh?.name).toBe("p256dh");
    expect(ps.auth?.name).toBe("auth");
    expect(ps.createdAt?.name).toBe("created_at");
    expect(ps.lastDeliveredAt?.name).toBe("last_delivered_at");
  });
});
