/**
 * Phase 66 Plan 66-04 — Migration test for the cosmetic-column drop.
 *
 * Boots an in-memory SQLite with the OLD identities schema (all 12 columns),
 * seeds a row, then invokes migrateSchema() (via the exported hook this file
 * imports below) and asserts:
 *
 *   Test 1: OLD schema → migrate → 7 cosmetic columns physically dropped;
 *           row survives with the 5 surviving columns intact.
 *   Test 2: NEW schema (columns already dropped) → migrate → no error,
 *           idempotent no-op, table shape unchanged.
 *   Test 3: dropColumnIfExists("identities", "bogus_col") on a non-existent
 *           column logs a warn but does NOT throw.
 *   Test 4 (B6 preflight): assertSqliteSupportsDropColumn no-throw on the
 *           bundled better-sqlite3 (≥ 3.35); throws with clear error when
 *           the version-reader is stubbed to return "3.34.0".
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import {
  assertSqliteSupportsDropColumn,
  dropColumnIfExists,
  runIdentitiesCosmeticDrops,
  runIdentitiesTableDrop,
} from "./index.js";
import { hosts } from "./schema.js";
import { FieldCrypto } from "../../utils/field-crypto.js";

// The OLD identities CREATE TABLE — verbatim from db/index.ts pre-Phase-66.
const OLD_IDENTITIES_CREATE_SQL = `
  CREATE TABLE identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    identity_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    title TEXT,
    color_hue INTEGER,
    voice TEXT,
    avatar_mime TEXT NOT NULL,
    avatar_data BLOB NOT NULL,
    avatar_etag TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, identity_key)
  );
`;

// The NEW identities CREATE TABLE — matches Plan 66-04 shrunken schema.
const NEW_IDENTITIES_CREATE_SQL = `
  CREATE TABLE identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    identity_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, identity_key)
  );
`;

type ColInfo = { name: string };
function columnNames(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as ColInfo[];
  return rows.map((r) => r.name);
}

describe("Phase 66-04 migration — drop cosmetic columns from identities", () => {
  it("Test 1: OLD schema → migrate → 7 cosmetic columns dropped, surviving 5 intact, row data preserved", () => {
    const db = new Database(":memory:");
    db.exec(OLD_IDENTITIES_CREATE_SQL);

    // Seed one row with every legacy column populated.
    db.prepare(
      `INSERT INTO identities
       (id, user_id, identity_key, display_name, title, color_hue, voice,
        avatar_mime, avatar_data, avatar_etag, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "id-1",
      "user-1",
      "tina",
      "Tina",
      "Fleet Op",
      128,
      "Elena.wav",
      "image/webp",
      Buffer.from("avatar-bytes"),
      "md5-etag",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );

    // Sanity: all 12 columns present pre-migration
    const preCols = columnNames(db, "identities");
    expect(preCols).toContain("display_name");
    expect(preCols).toContain("title");
    expect(preCols).toContain("color_hue");
    expect(preCols).toContain("voice");
    expect(preCols).toContain("avatar_mime");
    expect(preCols).toContain("avatar_data");
    expect(preCols).toContain("avatar_etag");

    // Run the drops against this test db handle (not the module singleton).
    runIdentitiesCosmeticDrops(db);

    // Post-migration: only 5 surviving columns present
    const postCols = columnNames(db, "identities");
    expect(postCols.sort()).toEqual(
      ["created_at", "id", "identity_key", "updated_at", "user_id"].sort(),
    );
    // 7 dropped columns are physically absent
    for (const dropped of [
      "display_name",
      "title",
      "color_hue",
      "voice",
      "avatar_mime",
      "avatar_data",
      "avatar_etag",
    ]) {
      expect(postCols).not.toContain(dropped);
    }

    // Surviving row data intact
    const row = db
      .prepare("SELECT id, user_id, identity_key, created_at, updated_at FROM identities WHERE id = ?")
      .get("id-1") as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.id).toBe("id-1");
    expect(row.user_id).toBe("user-1");
    expect(row.identity_key).toBe("tina");
    expect(row.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(row.updated_at).toBe("2026-01-01T00:00:00.000Z");

    // Assert display_name column no longer exists via SELECT throwing.
    expect(() => db.prepare("SELECT display_name FROM identities").get()).toThrow();
  });

  it("Test 2: NEW schema (columns already dropped) → migrate is idempotent no-op", () => {
    const db = new Database(":memory:");
    db.exec(NEW_IDENTITIES_CREATE_SQL);

    const preCols = columnNames(db, "identities").sort();

    // Should not throw even though drop targets are all absent
    expect(() => runIdentitiesCosmeticDrops(db)).not.toThrow();

    const postCols = columnNames(db, "identities").sort();
    expect(postCols).toEqual(preCols);
  });

  it("Test 3: dropColumnIfExists on a non-existent column does not throw", () => {
    const db = new Database(":memory:");
    db.exec(NEW_IDENTITIES_CREATE_SQL);

    expect(() =>
      dropColumnIfExists(db, "identities", "bogus_col_does_not_exist"),
    ).not.toThrow();

    // Table unchanged
    const cols = columnNames(db, "identities");
    expect(cols).toContain("id");
    expect(cols).not.toContain("bogus_col_does_not_exist");
  });

  it("Test 4 (B6 preflight): asserts SQLite version ≥ 3.35, throws clear error when version reader stubs 3.34.0", () => {
    const db = new Database(":memory:");

    // Bundled better-sqlite3 SQLite version must be ≥ 3.35 (native DROP COLUMN)
    expect(() => assertSqliteSupportsDropColumn(db)).not.toThrow();

    // Stub the version reader so it looks like an older SQLite. We monkey-
    // patch `db.prepare` for the exact `SELECT sqlite_version() AS v` query.
    const origPrepare = db.prepare.bind(db);
    const fakePrepare = ((sql: string) => {
      if (
        typeof sql === "string" &&
        sql.trim().toLowerCase().includes("sqlite_version")
      ) {
        return {
          get: () => ({ v: "3.34.0" }),
        };
      }
      return origPrepare(sql);
    }) as unknown as typeof db.prepare;
    (db as unknown as { prepare: typeof db.prepare }).prepare = fakePrepare;

    let err: unknown;
    try {
      assertSqliteSupportsDropColumn(db);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain("3.35");
    expect(msg).toContain("3.34.0");
  });
});

// The 5-column identities schema remaining after Phase 66 cosmetic drops.
const PHASE_66_IDENTITIES_CREATE_SQL = `
  CREATE TABLE identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    identity_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, identity_key)
  );
`;

describe("Phase 68-05 migration — drop identities table entirely", () => {
  it("Test 5: runIdentitiesTableDrop drops the table when present", () => {
    const db = new Database(":memory:");
    db.exec(PHASE_66_IDENTITIES_CREATE_SQL);

    // Seed a row to confirm data is gone post-drop.
    db.exec(
      "INSERT INTO identities (id, user_id, identity_key, created_at, updated_at) VALUES ('abc', 'user1', 'tina', '2026-01-01', '2026-01-01');",
    );

    // Confirm table exists pre-drop.
    const preRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='identities'",
      )
      .all();
    expect(preRows.length).toBe(1);

    runIdentitiesTableDrop(db);

    // Table must no longer exist.
    const postRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='identities'",
      )
      .all();
    expect(postRows).toEqual([]);

    // PRAGMA table_info returns empty for absent table.
    const pragmaRows = db.prepare("PRAGMA table_info(identities)").all();
    expect(pragmaRows).toEqual([]);
  });

  it("Test 6: runIdentitiesTableDrop is idempotent on absent table", () => {
    const db = new Database(":memory:");
    // No identities table created.

    // First call — no-op, no throw.
    expect(() => runIdentitiesTableDrop(db)).not.toThrow();

    // Second call — still no-op, no throw.
    expect(() => runIdentitiesTableDrop(db)).not.toThrow();

    // Table still absent.
    const pragmaRows = db.prepare("PRAGMA table_info(identities)").all();
    expect(pragmaRows).toEqual([]);
  });

  it("Test 7: runIdentitiesCosmeticDrops then runIdentitiesTableDrop on legacy 5-column schema leaves no identities table", () => {
    const db = new Database(":memory:");
    db.exec(PHASE_66_IDENTITIES_CREATE_SQL);

    // Seed a row.
    db.exec(
      "INSERT INTO identities (id, user_id, identity_key, created_at, updated_at) VALUES ('xyz', 'user2', 'ash', '2026-02-01', '2026-02-01');",
    );

    // Phase 66 cosmetic drops (all columns already absent — idempotent no-op).
    expect(() => runIdentitiesCosmeticDrops(db)).not.toThrow();

    // Phase 68 table drop.
    runIdentitiesTableDrop(db);

    // Table gone.
    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='identities'",
      )
      .all();
    expect(tableRows).toEqual([]);

    const pragmaRows = db.prepare("PRAGMA table_info(identities)").all();
    expect(pragmaRows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 72 Plan 02 — add runs_fleet_substrate column to ssh_data.
//
// Contract under test: the migration adds a BOOLEAN column (stored as
// INTEGER NOT NULL DEFAULT 0) via the same addColumnIfNotExists shape the
// rest of db/index.ts uses. Since addColumnIfNotExists is bound to the
// module-level sqlite singleton (and per Plan 02 must NOT be re-exported as
// runFleetSubstrateColumnAdd), the tests reproduce the same idempotent
// ALTER TABLE ADD COLUMN pattern directly against a test-owned in-memory
// database — the behavior contract is what matters:
//   - present on OLD schema after add
//   - unchanged on NEW schema (already-present, no throw, no dup)
//   - existing rows backfilled to 0
//   - Drizzle hosts.runsFleetSubstrate column exported
// ---------------------------------------------------------------------------

// The OLD ssh_data schema — subset of columns pre-Phase-72, WITHOUT
// runs_fleet_substrate. Mirrors the CREATE TABLE literal shape at
// db/index.ts L199-236, trimmed to what the migration test needs.
const OLD_SSH_DATA_CREATE_SQL = `
  CREATE TABLE ssh_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT,
    ip TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

// The NEW ssh_data schema — includes runs_fleet_substrate already.
const NEW_SSH_DATA_CREATE_SQL = `
  CREATE TABLE ssh_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT,
    ip TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL,
    runs_fleet_substrate INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

// Local reproduction of the addColumnIfNotExists shape from db/index.ts
// L634-659 — same probe-then-alter logic, but bound to a passed-in db
// so the tests don't touch the module singleton. Behavior contract is
// identical: probe via SELECT, on throw run ALTER TABLE ADD COLUMN.
function addColumnIfNotExistsOn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  try {
    db.prepare(`SELECT "${column}" FROM ${table} LIMIT 1`).get();
  } catch {
    db.exec(`ALTER TABLE ${table} ADD COLUMN "${column}" ${definition};`);
  }
}

describe("Phase 72-02 migration — add runs_fleet_substrate to ssh_data", () => {
  it("Test A: OLD schema (no runs_fleet_substrate) → migrate → column present", () => {
    const db = new Database(":memory:");
    db.exec(OLD_SSH_DATA_CREATE_SQL);

    // Sanity: column absent pre-migration.
    const preCols = columnNames(db, "ssh_data");
    expect(preCols).not.toContain("runs_fleet_substrate");

    addColumnIfNotExistsOn(
      db,
      "ssh_data",
      "runs_fleet_substrate",
      "INTEGER NOT NULL DEFAULT 0",
    );

    const postCols = columnNames(db, "ssh_data");
    expect(postCols).toContain("runs_fleet_substrate");
  });

  it("Test B: NEW schema (column already present) → migrate is idempotent no-op", () => {
    const db = new Database(":memory:");
    db.exec(NEW_SSH_DATA_CREATE_SQL);

    // Seed a row with runs_fleet_substrate = 1 to prove the value survives
    // the no-op migration path (no duplicate column, no default overwrite).
    db.prepare(
      `INSERT INTO ssh_data
       (user_id, name, ip, port, username, auth_type, runs_fleet_substrate)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("user-1", "exec-vm-1", "10.0.0.1", 22, "ubuntu", "password", 1);

    const preCols = columnNames(db, "ssh_data").sort();

    expect(() =>
      addColumnIfNotExistsOn(
        db,
        "ssh_data",
        "runs_fleet_substrate",
        "INTEGER NOT NULL DEFAULT 0",
      ),
    ).not.toThrow();

    const postCols = columnNames(db, "ssh_data").sort();
    expect(postCols).toEqual(preCols);

    // Existing row's value survives — the no-op path did NOT overwrite it
    // with the default.
    const row = db
      .prepare("SELECT runs_fleet_substrate FROM ssh_data WHERE user_id = ?")
      .get("user-1") as { runs_fleet_substrate: number };
    expect(row.runs_fleet_substrate).toBe(1);

    // No duplicate column — column count for runs_fleet_substrate is exactly 1.
    const matches = postCols.filter((c) => c === "runs_fleet_substrate");
    expect(matches.length).toBe(1);
  });

  it("Test C: existing rows backfilled to 0 after ALTER TABLE ADD COLUMN NOT NULL DEFAULT 0", () => {
    const db = new Database(":memory:");
    db.exec(OLD_SSH_DATA_CREATE_SQL);

    // Seed a row BEFORE the migration — the pre-slice-2 state where the
    // column doesn't exist yet.
    db.prepare(
      `INSERT INTO ssh_data
       (user_id, name, ip, port, username, auth_type)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("user-1", "legacy-host", "10.0.0.2", 22, "ubuntu", "password");

    addColumnIfNotExistsOn(
      db,
      "ssh_data",
      "runs_fleet_substrate",
      "INTEGER NOT NULL DEFAULT 0",
    );

    // Existing row exists with runs_fleet_substrate backfilled to 0
    // (SQLite's ALTER TABLE ADD COLUMN NOT NULL DEFAULT 0 backfills).
    const row = db
      .prepare(
        "SELECT runs_fleet_substrate FROM ssh_data WHERE user_id = ?",
      )
      .get("user-1") as { runs_fleet_substrate: number };
    expect(row).toBeDefined();
    expect(row.runs_fleet_substrate).toBe(0);
  });

  it("Test D: Drizzle hosts.runsFleetSubstrate column is exported and typed", () => {
    // Static-shape proof — the Drizzle schema declares the column so
    // Plan 04's typed query (db.select({ runsFleetSubstrate:
    // hosts.runsFleetSubstrate }).from(hosts)) compiles.
    expect(hosts.runsFleetSubstrate).toBeDefined();
    expect(hosts.runsFleetSubstrate).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 85 Plan 01 — create identity_send_log table.
//
// Contract under test: initializeCompleteDatabase()'s CREATE TABLE IF NOT
// EXISTS block lands the identity_send_log table with the D-01/D-02 shape:
//   identity_name TEXT PRIMARY KEY
//   last_send_at INTEGER NOT NULL
//   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
// - present on fresh install (create against empty db)
// - idempotent on second run (no throw, columns unchanged)
// - PRAGMA table_info reports the correct shape
// - upsert via INSERT OR REPLACE respects the primary key (no duplicates)
//
// The tests reproduce the exact CREATE TABLE SQL from db/index.ts as an
// inline const (mirroring the OLD_IDENTITIES_CREATE_SQL / OLD_SSH_DATA_
// CREATE_SQL pattern above), then exercise the shape contract against a
// test-owned in-memory database. forceSave is a runtime concern of the
// singleton boot path and is not exercised here (per plan Task 3 constraint).
// ---------------------------------------------------------------------------

const IDENTITY_SEND_LOG_CREATE_SQL =
  "CREATE TABLE IF NOT EXISTS identity_send_log ( identity_name TEXT PRIMARY KEY, last_send_at INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );";

type ColInfoFull = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};
function columnInfo(db: Database.Database, table: string): ColInfoFull[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColInfoFull[];
}

describe("Phase 85 migration — identity_send_log table", () => {
  it("Test 79-01: fresh in-memory DB → CREATE TABLE lands with all three columns", () => {
    const db = new Database(":memory:");

    // Sanity: table absent pre-create.
    const preRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='identity_send_log'",
      )
      .all();
    expect(preRows.length).toBe(0);

    db.exec(IDENTITY_SEND_LOG_CREATE_SQL);

    const postRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='identity_send_log'",
      )
      .all();
    expect(postRows.length).toBe(1);

    const cols = columnNames(db, "identity_send_log").sort();
    expect(cols).toEqual(
      ["identity_name", "last_send_at", "updated_at"].sort(),
    );
  });

  it("Test 79-02: running the CREATE a second time is a no-op (idempotent, no throw, shape unchanged)", () => {
    const db = new Database(":memory:");
    db.exec(IDENTITY_SEND_LOG_CREATE_SQL);

    const preCols = columnNames(db, "identity_send_log").sort();

    expect(() => db.exec(IDENTITY_SEND_LOG_CREATE_SQL)).not.toThrow();

    const postCols = columnNames(db, "identity_send_log").sort();
    expect(postCols).toEqual(preCols);
  });

  it("Test 79-03: PRAGMA table_info reports the correct column shape", () => {
    const db = new Database(":memory:");
    db.exec(IDENTITY_SEND_LOG_CREATE_SQL);

    const info = columnInfo(db, "identity_send_log");
    const byName = new Map(info.map((c) => [c.name, c]));

    const identity = byName.get("identity_name");
    expect(identity).toBeDefined();
    expect(identity!.type.toUpperCase()).toBe("TEXT");
    // In SQLite, PRIMARY KEY on a non-INTEGER column implies NOT NULL for
    // strict interpretation, but the notnull flag in table_info still
    // reports 0 unless NOT NULL is written explicitly. What we care about
    // is pk=1 (primary key enforcement, which is our uniqueness contract).
    expect(identity!.pk).toBe(1);

    const lastSend = byName.get("last_send_at");
    expect(lastSend).toBeDefined();
    expect(lastSend!.type.toUpperCase()).toBe("INTEGER");
    expect(lastSend!.notnull).toBe(1);
    expect(lastSend!.pk).toBe(0);

    const updated = byName.get("updated_at");
    expect(updated).toBeDefined();
    expect(updated!.type.toUpperCase()).toBe("TEXT");
    expect(updated!.notnull).toBe(1);
    expect(updated!.dflt_value).toBe("CURRENT_TIMESTAMP");
    expect(updated!.pk).toBe(0);
  });

  it("Test 79-04: INSERT round-trip + INSERT OR REPLACE respects primary key (upsert, no duplicate row)", () => {
    const db = new Database(":memory:");
    db.exec(IDENTITY_SEND_LOG_CREATE_SQL);

    // Initial insert.
    db.prepare(
      "INSERT INTO identity_send_log (identity_name, last_send_at) VALUES (?, ?)",
    ).run("ivy", 1725625200000);

    const firstRow = db
      .prepare(
        "SELECT identity_name, last_send_at FROM identity_send_log WHERE identity_name = ?",
      )
      .get("ivy") as { identity_name: string; last_send_at: number };
    expect(firstRow).toBeDefined();
    expect(firstRow.identity_name).toBe("ivy");
    expect(firstRow.last_send_at).toBe(1725625200000);

    // Upsert with newer ts — INSERT OR REPLACE respects the primary key.
    db.prepare(
      "INSERT OR REPLACE INTO identity_send_log (identity_name, last_send_at) VALUES (?, ?)",
    ).run("ivy", 1725711600000);

    // Row count for 'ivy' is still exactly 1 (no duplicate).
    const count = db
      .prepare(
        "SELECT COUNT(*) AS c FROM identity_send_log WHERE identity_name = ?",
      )
      .get("ivy") as { c: number };
    expect(count.c).toBe(1);

    // last_send_at is the new value.
    const updated = db
      .prepare(
        "SELECT last_send_at FROM identity_send_log WHERE identity_name = ?",
      )
      .get("ivy") as { last_send_at: number };
    expect(updated.last_send_at).toBe(1725711600000);
  });
});

// ---------------------------------------------------------------------------
// Phase 75 Plan 01 — matrix_admin_creds table + users.mxid column.
//
// Contract under test: the boot-time DDL adds the singleton matrix_admin_creds
// table (id, homeserver_base, user_id, access_token, password, created_at,
// updated_at) and one users.mxid TEXT column, both idempotent across sequential
// boots. FieldCrypto declares both secret columns as encrypted at rest.
//
// The DatabaseSaveTrigger.forceSave('phase-75-matrix-admin-schema') call in
// db/index.ts is exercised by boot, not by these unit tests — mirrors the
// existing L810-821 phase-68 block which is not directly unit-tested either.
// Acceptance-criteria grep of `phase-75-matrix-admin-schema` in db/index.ts
// covers the presence-check for the persist call.
// ---------------------------------------------------------------------------

// Local reproduction of the addColumnIfNotExists shape from db/index.ts
// L634-659 (also defined further above as addColumnIfNotExistsOn) — this
// alias makes the phase-75 cases self-describing without touching the
// module singleton.
function addColumnIfNotExistsMxid(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  try {
    db.prepare(`SELECT "${column}" FROM ${table} LIMIT 1`).get();
  } catch {
    db.exec(`ALTER TABLE ${table} ADD COLUMN "${column}" ${definition};`);
  }
}

// The users CREATE TABLE — verbatim shape from db/index.ts L150-168
// (post-Phase-72), used to seed a realistic starting point for the
// mxid idempotency test.
const USERS_CREATE_SQL_PRE_MXID = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_oidc INTEGER NOT NULL DEFAULT 0,
    oidc_identifier TEXT,
    client_id TEXT,
    client_secret TEXT,
    issuer_url TEXT,
    authorization_url TEXT,
    token_url TEXT,
    identifier_path TEXT,
    name_path TEXT,
    scopes TEXT DEFAULT 'openid email profile',
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    totp_backup_codes TEXT
  );
`;

// The matrix_admin_creds CREATE TABLE — mirrors the exact shape added to
// db/index.ts by Task 1. Encoded here so the idempotency test can run the
// DDL twice and assert the schema doesn't drift.
const MATRIX_ADMIN_CREDS_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS matrix_admin_creds (
    id INTEGER PRIMARY KEY,
    homeserver_base TEXT NOT NULL,
    user_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

describe("Phase 75-01 migration — matrix_admin_creds table + users.mxid column", () => {
  it("Test P75-1: matrix_admin_creds CREATE TABLE IF NOT EXISTS is idempotent across two boots and schema matches expected columns", () => {
    const db = new Database(":memory:");

    // Boot 1 — table absent, DDL creates it.
    db.exec(MATRIX_ADMIN_CREDS_CREATE_SQL);

    const postBoot1Tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='matrix_admin_creds'",
      )
      .all();
    expect(postBoot1Tables.length).toBe(1);

    const postBoot1Cols = columnNames(db, "matrix_admin_creds").sort();
    expect(postBoot1Cols).toEqual(
      [
        "access_token",
        "created_at",
        "homeserver_base",
        "id",
        "password",
        "updated_at",
        "user_id",
      ].sort(),
    );

    // Boot 2 — DDL is re-run; IF NOT EXISTS makes it a no-op.
    expect(() => db.exec(MATRIX_ADMIN_CREDS_CREATE_SQL)).not.toThrow();

    // Exactly one table still (no duplicate).
    const postBoot2Tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='matrix_admin_creds'",
      )
      .all();
    expect(postBoot2Tables.length).toBe(1);

    // Columns unchanged after the second boot.
    const postBoot2Cols = columnNames(db, "matrix_admin_creds").sort();
    expect(postBoot2Cols).toEqual(postBoot1Cols);
  });

  it("Test P75-2: users.mxid TEXT column added exactly once across two boots and is queryable without throwing", () => {
    const db = new Database(":memory:");
    db.exec(USERS_CREATE_SQL_PRE_MXID);

    // Sanity: mxid absent pre-migration.
    const preCols = columnNames(db, "users");
    expect(preCols).not.toContain("mxid");

    // Boot 1 — add the column.
    addColumnIfNotExistsMxid(db, "users", "mxid", "TEXT");
    const postBoot1Cols = columnNames(db, "users");
    expect(postBoot1Cols).toContain("mxid");

    // Boot 2 — re-run; addColumnIfNotExists is idempotent, no throw.
    expect(() =>
      addColumnIfNotExistsMxid(db, "users", "mxid", "TEXT"),
    ).not.toThrow();

    // Exactly one mxid column post-boot-2 (no duplicate).
    const postBoot2Cols = columnNames(db, "users");
    const mxidMatches = postBoot2Cols.filter((c) => c === "mxid");
    expect(mxidMatches.length).toBe(1);

    // Column is queryable — `SELECT mxid FROM users LIMIT 1` does not throw.
    expect(() => db.prepare("SELECT mxid FROM users LIMIT 1").get()).not.toThrow();
  });

  it("Test P75-3: FieldCrypto.shouldEncryptField declares matrix_admin_creds.access_token AND matrix_admin_creds.password as encrypted", () => {
    // Task 1 ENCRYPTED_FIELDS entry: matrix_admin_creds: new Set(["access_token", "password"]).
    expect(
      FieldCrypto.shouldEncryptField("matrix_admin_creds", "access_token"),
    ).toBe(true);
    expect(
      FieldCrypto.shouldEncryptField("matrix_admin_creds", "password"),
    ).toBe(true);

    // Negative controls — other column names on the same table are NOT encrypted.
    expect(
      FieldCrypto.shouldEncryptField("matrix_admin_creds", "user_id"),
    ).toBe(false);
    expect(
      FieldCrypto.shouldEncryptField("matrix_admin_creds", "homeserver_base"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 85-01 migration — users.avatar_path column
//
// Verifies that addColumnIfNotExists("users", "avatar_path", "TEXT") is
// idempotent (no-throw on second boot), that the column is present and
// queryable after migration, and that it is genuinely nullable (INSERT
// without providing a value succeeds and the column reads back as null).
//
// The live migration call (db/index.ts addColumnIfNotExists line 931 +
// forceSave) is exercised by boot, not by these unit tests — the forceSave
// call in db/index.ts is covered by a presence-check grep of
// 'phase-85-user-avatar-schema'. Mirrors the Phase 75-2 mxid test shape.
// ---------------------------------------------------------------------------

// Local reproduction of the addColumnIfNotExists shape from db/index.ts
// L634-659 — renamed for self-description without touching the module singleton.
function addColumnIfNotExistsAvatarPath(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  try {
    db.prepare(`SELECT "${column}" FROM ${table} LIMIT 1`).get();
  } catch {
    db.exec(`ALTER TABLE ${table} ADD COLUMN "${column}" ${definition};`);
  }
}

// The users CREATE TABLE — post-Phase-75 shape (includes mxid TEXT, which
// Phase 75 has already shipped by the time Phase 85 runs). This is the
// "pre-Phase-85" starting state: users table exists with mxid but without
// avatar_path.
const USERS_CREATE_SQL_PRE_AVATAR_PATH = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_oidc INTEGER NOT NULL DEFAULT 0,
    oidc_identifier TEXT,
    client_id TEXT,
    client_secret TEXT,
    issuer_url TEXT,
    authorization_url TEXT,
    token_url TEXT,
    identifier_path TEXT,
    name_path TEXT,
    scopes TEXT DEFAULT 'openid email profile',
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    totp_backup_codes TEXT,
    mxid TEXT
  );
`;

describe("Phase 85-01 migration — users.avatar_path column", () => {
  it("Test P85-1: users.avatar_path TEXT column added exactly once across two boots and is queryable without throwing", () => {
    const db = new Database(":memory:");
    db.exec(USERS_CREATE_SQL_PRE_AVATAR_PATH);

    // Sanity: avatar_path absent pre-migration.
    const preCols = columnNames(db, "users");
    expect(preCols).not.toContain("avatar_path");

    // Boot 1 — add the column.
    addColumnIfNotExistsAvatarPath(db, "users", "avatar_path", "TEXT");
    const postBoot1Cols = columnNames(db, "users");
    expect(postBoot1Cols).toContain("avatar_path");

    // Boot 2 — re-run; addColumnIfNotExists is idempotent, no throw.
    expect(() =>
      addColumnIfNotExistsAvatarPath(db, "users", "avatar_path", "TEXT"),
    ).not.toThrow();

    // Exactly one avatar_path column post-boot-2 (no duplicate).
    const postBoot2Cols = columnNames(db, "users");
    const avatarPathMatches = postBoot2Cols.filter((c) => c === "avatar_path");
    expect(avatarPathMatches.length).toBe(1);

    // Column is queryable — `SELECT avatar_path FROM users LIMIT 1` does not throw.
    expect(() =>
      db.prepare("SELECT avatar_path FROM users LIMIT 1").get(),
    ).not.toThrow();
  });

  it("Test P85-2: users.avatar_path is nullable (INSERT without providing value succeeds and reads back as null)", () => {
    const db = new Database(":memory:");
    db.exec(USERS_CREATE_SQL_PRE_AVATAR_PATH);

    // Run migration to add the column.
    addColumnIfNotExistsAvatarPath(db, "users", "avatar_path", "TEXT");

    // INSERT a row omitting avatar_path — mirrors what pre-Phase-85 code does
    // for legacy users (D-13: no backfill, existing rows keep null pointer).
    expect(() =>
      db
        .prepare(
          "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
        )
        .run("test-user-id", "testuser", "hashed-password"),
    ).not.toThrow();

    // SELECT the row back — avatar_path must be null (not '', not any sentinel).
    // This proves D-06's nullability guarantee: the column is genuinely NULL
    // when not provided, not an empty-string sentinel.
    const row = db
      .prepare("SELECT avatar_path FROM users WHERE id = ?")
      .get("test-user-id") as { avatar_path: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.avatar_path).toBeNull();
  });
});
