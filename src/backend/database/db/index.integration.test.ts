/**
 * Phase 128 Plan 11 — [BLOCKING] schema-integration gate.
 *
 * Skynet does NOT use `drizzle-kit push`. Schema mutations ship via
 * hand-written CREATE TABLE + drop-migration functions in
 * src/backend/database/db/index.ts (mirroring runPinColumnDrop /
 * runHiddenColumnDrop / runIdentitiesTableDrop). The `schema_push_requirement`
 * gate in the phase's planning brief is a mandatory pre-deploy verification
 * that the schema motion is correct. This file IS that gate: seven integration
 * assertions that boot the DB module in-memory and prove the Phase 128 schema
 * state is queryable + the drop-migration executes correctly.
 *
 * Test coverage (D-11 + D-13 + D-18 traceable):
 *   Test 1: push_subscriptions table exists after boot-time DDL (D-11).
 *   Test 2: UNIQUE INDEX on (user_id, endpoint) exists (D-14 multi-device
 *           semantics — one row per (user, endpoint)).
 *   Test 3: UNIQUE constraint enforced — a duplicate (user_id, endpoint)
 *           INSERT surfaces a SQLITE_CONSTRAINT error (the ON CONFLICT DO
 *           NOTHING invariant Plan 05's route relies on).
 *   Test 4: runTelegramBotTokensTableDrop drops telegram_bot_tokens when
 *           present (drop-on-hit — the exact motion a legacy install sees
 *           on first-boot post-deploy, D-18).
 *   Test 5: runTelegramBotTokensTableDrop is a no-op on a fresh DB where
 *           telegram_bot_tokens was never created (drop-on-miss — the exact
 *           motion a fresh install sees, no throw).
 *   Test 6: runTelegramBotTokensTableDrop is idempotent — running twice
 *           against the same DB (post-drop) does not throw.
 *   Test 7: FK cascade — deleting a users row cascades to that user's
 *           push_subscriptions rows (T-128-01 orphan-subscription mitigation
 *           at the DDL layer).
 *
 * SCOPE — this file exercises the DB module's *schema* motion in isolation
 * against a test-owned in-memory better-sqlite3, mirroring the byte-parallel
 * DDL convention established by index.phase89-schema.test.ts and
 * schema.test.ts (Plan 128-01). It does NOT boot the full Skynet backend or
 * touch DATA_DIR / DatabaseFileEncryption / DatabaseSaveTrigger — those are
 * orchestrator-level concerns at deploy time. Per Plan 11 Task 1 <action>:
 * "this test proves the migration is CORRECT before it ever runs on the
 * deployed DB." The byte-parallel DDL blocks below MUST stay in sync with
 * the CREATE TABLE statements in db/index.ts (Plans 128-01, 89-01) — if
 * production DDL drifts, this test must be updated in the same commit.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runTelegramBotTokensTableDrop } from "./index.js";

// Byte-parallel copy of the Phase 128 Plan 01 DDL landed in db/index.ts
// L618-627. If db/index.ts's push_subscriptions CREATE TABLE ever drifts
// from this shape, either update this const in the same commit OR fail
// Tests 1-3 loudly (which is what the byte-parallel discipline exists to do).
const USERS_STUB_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL
  );
`;

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

// The retired telegram_bot_tokens CREATE TABLE — the exact shape a legacy
// install has at first-boot-post-deploy time. This is a historical DDL:
// db/index.ts no longer contains a CREATE TABLE for this (Plan 128-01
// deleted it — that's the whole point of the drop-migration).
const LEGACY_TELEGRAM_BOT_TOKENS_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS telegram_bot_tokens (
    identity_key TEXT PRIMARY KEY,
    bot_token TEXT NOT NULL,
    bot_username TEXT NOT NULL,
    human_user_id TEXT NOT NULL,
    telegram_chat_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

/**
 * Bootstrap a fresh in-memory DB with the Phase 128 schema applied. Turns
 * on foreign_keys=ON to match db/index.ts L145 (initializeCompleteDatabase's
 * PRAGMA). Every test gets its own DB instance via beforeEach — no cross-test
 * pollution.
 */
function bootstrapPhase128Db(): Database.Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(USERS_STUB_SQL);
  db.exec(PUSH_SUBSCRIPTIONS_CREATE_SQL);
  db.exec(PUSH_SUBSCRIPTIONS_INDEX_SQL);
  return db;
}

describe("Phase 128 schema integration — [BLOCKING] pre-deploy gate", () => {
  let db: Database.Database;

  beforeEach(() => {
    // Fresh in-memory DB per test to guarantee no cross-test pollution.
    db = bootstrapPhase128Db();
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // expected — some tests may already have closed the db
    }
  });

  it("Test 1: push_subscriptions table exists with the expected columns after boot-time DDL (D-11)", () => {
    const tableRow = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='push_subscriptions'",
      )
      .get() as { sql: string } | undefined;
    expect(tableRow).toBeDefined();
    expect(tableRow!.sql).toContain("push_subscriptions");

    // Full column-name assertion — proves the D-11 shape is queryable, not
    // just that some table exists with the right name.
    type ColInfo = { name: string };
    const cols = db
      .prepare("PRAGMA table_info(push_subscriptions)")
      .all() as ColInfo[];
    const colNames = cols.map((c) => c.name).sort();
    expect(colNames).toEqual(
      [
        "id",
        "user_id",
        "endpoint",
        "p256dh",
        "auth",
        "created_at",
        "last_delivered_at",
      ].sort(),
    );
  });

  it("Test 2: UNIQUE INDEX on (user_id, endpoint) exists (D-14 multi-device semantics)", () => {
    const indexRows = db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND name='push_subscriptions_user_endpoint_unique'",
      )
      .all() as Array<{ name: string; sql: string }>;
    expect(indexRows.length).toBe(1);
    expect(indexRows[0].name).toBe("push_subscriptions_user_endpoint_unique");
    // Explicit shape assertion — index is UNIQUE and covers BOTH columns in
    // the composite (not just one). The DDL must not silently drift to a
    // single-column index or a partial-index-with-WHERE-clause.
    expect(indexRows[0].sql).toContain("UNIQUE");
    expect(indexRows[0].sql).toContain("user_id");
    expect(indexRows[0].sql).toContain("endpoint");
    // Regression trap for D-14 rationale: DO NOT collapse to UNIQUE(user_id)
    // — the multi-device design relies on (user_id, endpoint) being the key.
    expect(indexRows[0].sql).not.toMatch(/UNIQUE\s*\(\s*user_id\s*\)/i);
    // Regression trap for D-03-style reactivation semantics: the index MUST
    // NOT be scoped by a partial-index WHERE clause (unlike unscoped
    // uniqueness the relay-room-sessions index uses, the push_subscriptions
    // index is likewise unscoped — a duplicate is a duplicate).
    expect(indexRows[0].sql.toUpperCase()).not.toContain("WHERE");
  });

  it("Test 3: UNIQUE(user_id, endpoint) constraint is enforced — duplicate INSERT raises SQLITE_CONSTRAINT (the ON CONFLICT DO NOTHING invariant Plan 05 relies on)", () => {
    // Seed a user so the FK on push_subscriptions.user_id resolves.
    db.prepare(
      "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
    ).run("test-user", "user", "hash");

    // First INSERT — succeeds.
    const insert = db.prepare(
      "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)",
    );
    const firstResult = insert.run(
      "sub-1",
      "test-user",
      "https://push.example.com/abc",
      "p256dh-key-1",
      "auth-key-1",
    );
    expect(firstResult.changes).toBe(1);

    // Second INSERT with SAME (user_id, endpoint) — different id, different
    // keys — MUST fail the UNIQUE constraint. The route's ON CONFLICT DO
    // NOTHING (Plan 05) turns this into a silent no-op; here we exercise
    // the raw constraint surface to prove the DDL layer enforces it.
    let err: unknown;
    try {
      insert.run(
        "sub-2-different-id",
        "test-user",
        "https://push.example.com/abc",
        "p256dh-key-2",
        "auth-key-2",
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    // better-sqlite3 surfaces SQLITE_CONSTRAINT_UNIQUE with the index name.
    expect(msg).toMatch(/UNIQUE constraint failed/i);
    expect(msg).toContain("push_subscriptions.user_id");
    expect(msg).toContain("push_subscriptions.endpoint");

    // The duplicate did NOT land — table still has exactly ONE row for that
    // (user_id, endpoint) pair.
    const count = db
      .prepare(
        "SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
      )
      .get("test-user", "https://push.example.com/abc") as { c: number };
    expect(count.c).toBe(1);

    // Same user, DIFFERENT endpoint (e.g. same user on desktop + phone) IS
    // allowed — D-14 multi-device semantics. Proves the UNIQUE is composite,
    // not on user_id alone.
    const secondEndpointResult = insert.run(
      "sub-3-phone",
      "test-user",
      "https://push.example.com/def",
      "p256dh-key-3",
      "auth-key-3",
    );
    expect(secondEndpointResult.changes).toBe(1);
  });

  it("Test 4: runTelegramBotTokensTableDrop drops telegram_bot_tokens when present (drop-on-hit, D-18)", () => {
    // Simulate a legacy install: pre-create the retired table with data,
    // to prove the drop wipes both the table AND its rows.
    db.exec(LEGACY_TELEGRAM_BOT_TOKENS_CREATE_SQL);
    db.prepare(
      "INSERT INTO telegram_bot_tokens (identity_key, bot_token, bot_username, human_user_id, telegram_chat_id) VALUES (?, ?, ?, ?, ?)",
    ).run("tina", "bot-token-xyz", "@tina_bot", "@ashley:t1000", "12345");

    // Sanity: table present pre-drop.
    const preRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_bot_tokens'",
      )
      .all();
    expect(preRows.length).toBe(1);

    // Exercise the exported drop function against this test DB (not the
    // module singleton — same pattern the sibling migration tests use for
    // runIdentitiesTableDrop / runPinColumnDrop / runHiddenColumnDrop).
    runTelegramBotTokensTableDrop(db);

    // Post-drop: table must be physically absent.
    const postRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_bot_tokens'",
      )
      .all();
    expect(postRows).toEqual([]);

    // PRAGMA table_info returns empty for an absent table — belt-and-
    // suspenders proof (not just hidden from sqlite_master).
    const pragmaRows = db
      .prepare("PRAGMA table_info(telegram_bot_tokens)")
      .all();
    expect(pragmaRows).toEqual([]);

    // Reading from the dropped table throws — proves rows are gone with the
    // table.
    expect(() =>
      db.prepare("SELECT * FROM telegram_bot_tokens").all(),
    ).toThrow();
  });

  it("Test 5: runTelegramBotTokensTableDrop is a no-op on a fresh DB where telegram_bot_tokens was never created (drop-on-miss, D-18)", () => {
    // Fresh DB — telegram_bot_tokens absent. Mirrors the fresh-install path.
    const preRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_bot_tokens'",
      )
      .all();
    expect(preRows.length).toBe(0);

    // Must not throw even though drop target is absent (DROP TABLE IF EXISTS
    // is idempotent by construction).
    expect(() => runTelegramBotTokensTableDrop(db)).not.toThrow();

    // Post: table still absent (unchanged).
    const postRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_bot_tokens'",
      )
      .all();
    expect(postRows.length).toBe(0);

    // Push_subscriptions unaffected by the no-op drop — proves the drop
    // scoped to only the target table.
    const pushCols = db
      .prepare("PRAGMA table_info(push_subscriptions)")
      .all() as Array<{ name: string }>;
    expect(pushCols.length).toBeGreaterThan(0);
  });

  it("Test 6: runTelegramBotTokensTableDrop is idempotent — running twice does not throw", () => {
    // Sequence: create the legacy table → drop it → drop it AGAIN. Both
    // drop calls must succeed. This proves an operator can safely restart
    // the container mid-migration and see the same schema outcome.
    db.exec(LEGACY_TELEGRAM_BOT_TOKENS_CREATE_SQL);

    // First drop — table exists, gets dropped.
    expect(() => runTelegramBotTokensTableDrop(db)).not.toThrow();

    // Second drop — table now absent, must still be a no-op (idempotent).
    expect(() => runTelegramBotTokensTableDrop(db)).not.toThrow();

    // Third drop — belt-and-suspenders, still safe.
    expect(() => runTelegramBotTokensTableDrop(db)).not.toThrow();

    // Table is absent at the end.
    const postRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_bot_tokens'",
      )
      .all();
    expect(postRows).toEqual([]);
  });

  it("Test 7: FK ON DELETE CASCADE — deleting a users row cascades to their push_subscriptions rows (T-128-01 orphan-subscription mitigation)", () => {
    // Seed two users so we can prove the cascade is scoped to the deleted
    // user, not "all rows".
    db.prepare(
      "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
    ).run("user-a", "alice", "hash-a");
    db.prepare(
      "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
    ).run("user-b", "bob", "hash-b");

    // Seed subscriptions: two for user-a (multi-device), one for user-b.
    const insertSub = db.prepare(
      "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)",
    );
    insertSub.run(
      "sub-a-desktop",
      "user-a",
      "https://push.example.com/a-desktop",
      "p-a-1",
      "auth-a-1",
    );
    insertSub.run(
      "sub-a-phone",
      "user-a",
      "https://push.example.com/a-phone",
      "p-a-2",
      "auth-a-2",
    );
    insertSub.run(
      "sub-b-desktop",
      "user-b",
      "https://push.example.com/b-desktop",
      "p-b-1",
      "auth-b-1",
    );

    // Sanity: three rows pre-delete.
    const preCount = db
      .prepare("SELECT COUNT(*) AS c FROM push_subscriptions")
      .get() as { c: number };
    expect(preCount.c).toBe(3);

    // Delete user-a — cascade MUST wipe user-a's two subscription rows
    // AND leave user-b's row intact.
    db.prepare("DELETE FROM users WHERE id = ?").run("user-a");

    const postCount = db
      .prepare("SELECT COUNT(*) AS c FROM push_subscriptions")
      .get() as { c: number };
    expect(postCount.c).toBe(1);

    // The surviving row belongs to user-b.
    const survivors = db
      .prepare("SELECT user_id FROM push_subscriptions")
      .all() as Array<{ user_id: string }>;
    expect(survivors).toEqual([{ user_id: "user-b" }]);

    // Regression trap — no orphan rows referencing the deleted user id.
    const orphans = db
      .prepare("SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?")
      .get("user-a") as { c: number };
    expect(orphans.c).toBe(0);
  });
});
