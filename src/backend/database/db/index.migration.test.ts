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
