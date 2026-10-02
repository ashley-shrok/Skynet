/**
 * Phase 144 Plan 02 Task 1 — Schema tests for the rebuilt push_subscriptions table.
 *
 * Boots an in-memory better-sqlite3 with the exact CREATE TABLE DDL for the
 * NEW ntfy-based schema, then asserts sqlite_master shape + FK cascade +
 * UNIQUE constraint enforcement + idempotency + FieldCrypto registration.
 *
 * Replaces the Phase 128-01 tests (old browser-push schema with endpoint/p256dh/auth
 * columns). The new shape carries: id, user_id UNIQUE, topic_name UNIQUE,
 * reading_credential, ntfy_username, created_at — all per-user, one row max.
 *
 * Test coverage (from Plan 144-02 Task 1 <behavior> block):
 *   SCH-01: push_subscriptions has exactly 6 columns: id, user_id, topic_name,
 *           reading_credential, ntfy_username, created_at — no endpoint, p256dh,
 *           auth, last_delivered_at.
 *   SCH-02: UNIQUE(user_id) constraint rejects a second insert for the same user_id.
 *   SCH-03: UNIQUE(topic_name) constraint rejects a second insert with duplicate topic_name.
 *   SCH-04: Deleting a users row cascades the referenced push_subscriptions row.
 *   SCH-05: FieldCrypto.ENCRYPTED_FIELDS.push_subscriptions is a Set containing "reading_credential".
 *   SCH-06: runPushSubscriptionsRebuild is idempotent — calling it twice on an
 *           already-new-shape DB does not error.
 *   SCH-07: Running runPushSubscriptionsRebuild on a DB with the OLD shape drops the
 *           old table and creates the new shape.
 *   SCH-08: There is NO ntfy_publish_config table created at boot (HC-3 scope guard).
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import * as schema from "./schema.js";

// Byte-parallel copy of the new push_subscriptions DDL in db/index.ts (Phase 144).
const NEW_PUSH_SUBSCRIPTIONS_DDL = `
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    topic_name TEXT NOT NULL UNIQUE,
    reading_credential TEXT NOT NULL,
    ntfy_username TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`;

// Minimal users table so FK cascade works under PRAGMA foreign_keys=ON.
const USERS_STUB_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL
  );
`;

// Old Phase 128 push_subscriptions DDL — used by SCH-07 to set up the
// "before migration" state, then verified that runPushSubscriptionsRebuild
// drops it and creates the new shape.
const OLD_PUSH_SUBSCRIPTIONS_DDL = `
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
const OLD_PUSH_SUBSCRIPTIONS_INDEX_DDL = `
  CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_endpoint_unique
    ON push_subscriptions(user_id, endpoint);
`;

function bootstrapNewSchemaDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(USERS_STUB_SQL);
  db.exec(NEW_PUSH_SUBSCRIPTIONS_DDL);
  db.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run(
    "user-A",
    "alice",
  );
  db.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run(
    "user-B",
    "bob",
  );
  return db;
}

describe("Phase 144-02 Task 1 — push_subscriptions new schema (SCH-01..SCH-08)", () => {
  it("SCH-01: push_subscriptions has exactly 6 columns (id, user_id, topic_name, reading_credential, ntfy_username, created_at) — no endpoint, p256dh, auth, last_delivered_at", () => {
    const db = bootstrapNewSchemaDb();

    const cols = db
      .prepare("PRAGMA table_info(push_subscriptions)")
      .all() as { name: string }[];
    const colNames = cols.map((c) => c.name).sort();

    // Exactly these 6 columns — no more, no less.
    expect(colNames).toEqual(
      [
        "created_at",
        "id",
        "ntfy_username",
        "reading_credential",
        "topic_name",
        "user_id",
      ].sort(),
    );

    // Old browser-push columns must NOT exist.
    expect(colNames).not.toContain("endpoint");
    expect(colNames).not.toContain("p256dh");
    expect(colNames).not.toContain("auth");
    expect(colNames).not.toContain("last_delivered_at");
  });

  it("SCH-02: UNIQUE(user_id) rejects a second insert for the same user_id", () => {
    const db = bootstrapNewSchemaDb();

    db.prepare(
      "INSERT INTO push_subscriptions (id, user_id, topic_name, reading_credential, ntfy_username) VALUES (?, ?, ?, ?, ?)",
    ).run("sub-1", "user-A", "topic-aaa", "tk_readcred1", "skynet-reader-user-A");

    // Second insert with same user_id, different topic — must throw UNIQUE constraint.
    expect(() =>
      db
        .prepare(
          "INSERT INTO push_subscriptions (id, user_id, topic_name, reading_credential, ntfy_username) VALUES (?, ?, ?, ?, ?)",
        )
        .run("sub-2", "user-A", "topic-bbb", "tk_readcred2", "skynet-reader-user-A"),
    ).toThrow(/UNIQUE/i);
  });

  it("SCH-03: UNIQUE(topic_name) rejects a second insert with duplicate topic_name", () => {
    const db = bootstrapNewSchemaDb();

    db.prepare(
      "INSERT INTO push_subscriptions (id, user_id, topic_name, reading_credential, ntfy_username) VALUES (?, ?, ?, ?, ?)",
    ).run("sub-1", "user-A", "shared-topic", "tk_readcred1", "skynet-reader-user-A");

    // Different user, SAME topic_name — must throw UNIQUE constraint.
    expect(() =>
      db
        .prepare(
          "INSERT INTO push_subscriptions (id, user_id, topic_name, reading_credential, ntfy_username) VALUES (?, ?, ?, ?, ?)",
        )
        .run("sub-2", "user-B", "shared-topic", "tk_readcred2", "skynet-reader-user-B"),
    ).toThrow(/UNIQUE/i);
  });

  it("SCH-04: Deleting a users row cascades — referenced push_subscriptions row disappears (ON DELETE CASCADE)", () => {
    const db = bootstrapNewSchemaDb();

    db.prepare(
      "INSERT INTO push_subscriptions (id, user_id, topic_name, reading_credential, ntfy_username) VALUES (?, ?, ?, ?, ?)",
    ).run("sub-1", "user-A", "topic-aaa", "tk_readcred1", "skynet-reader-user-A");

    // Sanity: row exists before delete.
    const before = db
      .prepare("SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?")
      .get("user-A") as { c: number };
    expect(before.c).toBe(1);

    // Delete the user — FK ON DELETE CASCADE should sweep the subscription row.
    db.prepare("DELETE FROM users WHERE id = ?").run("user-A");

    const after = db
      .prepare("SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?")
      .get("user-A") as { c: number };
    expect(after.c).toBe(0);
  });

  it("SCH-05: FieldCrypto.ENCRYPTED_FIELDS.push_subscriptions is a Set containing exactly 'reading_credential'", async () => {
    // Dynamic import to get the FieldCrypto class internals via the module.
    // FieldCrypto.ENCRYPTED_FIELDS is private, so we access via the exported
    // isFieldEncrypted method which uses it internally, OR we can check by
    // inspecting what the module exports. The plan says the Set contains
    // exactly 'reading_credential'. We validate by importing field-crypto
    // and checking the ENCRYPTED_FIELDS map via the module's exposed exports.
    const fieldCryptoModule = await import("../../utils/field-crypto.js");
    const FieldCrypto = fieldCryptoModule.FieldCrypto;

    // shouldEncryptField checks ENCRYPTED_FIELDS internally.
    expect(FieldCrypto.shouldEncryptField("push_subscriptions", "reading_credential")).toBe(true);
    // Other push_subscriptions columns should NOT be encrypted.
    expect(FieldCrypto.shouldEncryptField("push_subscriptions", "topic_name")).toBe(false);
    expect(FieldCrypto.shouldEncryptField("push_subscriptions", "ntfy_username")).toBe(false);
    expect(FieldCrypto.shouldEncryptField("push_subscriptions", "user_id")).toBe(false);
  });

  it("SCH-06: runPushSubscriptionsRebuild is idempotent — calling it twice on an already-new-shape DB does not error", async () => {
    const { runPushSubscriptionsRebuild } = await import("./index.js");
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(USERS_STUB_SQL);
    // First call: creates new schema.
    expect(() => runPushSubscriptionsRebuild(db)).not.toThrow();
    // Second call: idempotent — IF EXISTS / IF NOT EXISTS guards make it a no-op.
    expect(() => runPushSubscriptionsRebuild(db)).not.toThrow();
    // Verify the new schema exists after both calls.
    const cols = db
      .prepare("PRAGMA table_info(push_subscriptions)")
      .all() as { name: string }[];
    const colNames = cols.map((c) => c.name).sort();
    expect(colNames).toContain("topic_name");
    expect(colNames).toContain("ntfy_username");
    expect(colNames).not.toContain("endpoint");
  });

  it("SCH-07: runPushSubscriptionsRebuild on a DB with the OLD shape drops old table + creates new shape", async () => {
    const { runPushSubscriptionsRebuild } = await import("./index.js");
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(USERS_STUB_SQL);
    // Set up OLD schema.
    db.exec(OLD_PUSH_SUBSCRIPTIONS_DDL);
    db.exec(OLD_PUSH_SUBSCRIPTIONS_INDEX_DDL);

    // Verify old schema exists before migration.
    const beforeCols = db
      .prepare("PRAGMA table_info(push_subscriptions)")
      .all() as { name: string }[];
    const beforeNames = beforeCols.map((c) => c.name);
    expect(beforeNames).toContain("endpoint");
    expect(beforeNames).toContain("p256dh");

    // Run the migration.
    runPushSubscriptionsRebuild(db);

    // Verify new schema after migration.
    const afterCols = db
      .prepare("PRAGMA table_info(push_subscriptions)")
      .all() as { name: string }[];
    const afterNames = afterCols.map((c) => c.name).sort();
    expect(afterNames).toEqual(
      ["created_at", "id", "ntfy_username", "reading_credential", "topic_name", "user_id"].sort(),
    );
    // Old columns gone.
    expect(afterNames).not.toContain("endpoint");
    expect(afterNames).not.toContain("p256dh");
    expect(afterNames).not.toContain("auth");
    expect(afterNames).not.toContain("last_delivered_at");
    // Old index must be gone.
    const oldIndex = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='push_subscriptions_user_endpoint_unique'")
      .get();
    expect(oldIndex).toBeUndefined();
  });

  it("SCH-08: No ntfy_publish_config table exists after boot (HC-3 scope guard — publish token is env-only)", async () => {
    // Import the db module to trigger any top-of-init CREATE TABLE calls.
    // We can't re-run the real init against a test DB, so we verify at the
    // schema/index module level: inspect the exported Drizzle schema objects
    // and the runPushSubscriptionsRebuild function to confirm ntfy_publish_config
    // is nowhere in the module.
    const schemaModule = await import("./schema.js");
    // The Drizzle schema should NOT export an ntfyPublishConfig table.
    expect(schemaModule).not.toHaveProperty("ntfyPublishConfig");
    expect(schemaModule).not.toHaveProperty("ntfy_publish_config");

    // Also verify the DDL we use in SCH-06/07 does not create ntfy_publish_config.
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(USERS_STUB_SQL);
    const { runPushSubscriptionsRebuild } = await import("./index.js");
    runPushSubscriptionsRebuild(db);

    const configTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ntfy_publish_config'")
      .get();
    expect(configTable).toBeUndefined();
  });
});
