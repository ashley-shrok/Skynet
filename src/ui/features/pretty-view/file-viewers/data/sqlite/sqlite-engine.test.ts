// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import type { Database, SqlJsStatic } from "sql.js";
import { listTables, quoteIdent, runQuery, tableRows } from "./sqlite-engine";
import { isSqliteFile, usesWal, withoutWalFlag } from "./sqlite-header";

const require = createRequire(import.meta.url);
let SQL: SqlJsStatic;

beforeAll(async () => {
  const dist = path.dirname(require.resolve("sql.js/dist/sql-wasm.js"));
  const init = require("sql.js/dist/sql-wasm.js") as (c: object) => Promise<SqlJsStatic>;
  SQL = await init({ locateFile: (f: string) => path.join(dist, f) });
});

function sampleDb(): Database {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE "my items" (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL DEFAULT 0, img BLOB);
    CREATE INDEX idx_name ON "my items"(name);
    INSERT INTO "my items"(name, price, img) VALUES ('b', 2.5, x'0102'), ('a', 10, NULL), ('c', 1, NULL);
    CREATE VIEW cheap AS SELECT name FROM "my items" WHERE price < 5;
  `);
  return db;
}

describe("sqlite-engine", () => {
  it("lists tables and views with columns, counts and indexes", () => {
    const tables = listTables(sampleDb());
    expect(tables.map((t) => [t.name, t.kind, t.rowCount])).toEqual([
      ["my items", "table", 3],
      ["cheap", "view", null],
    ]);
    const items = tables[0];
    expect(items.columns.map((c) => [c.name, c.type, c.notNull, c.primaryKey, c.defaultValue])).toEqual([
      ["id", "INTEGER", false, true, null],
      ["name", "TEXT", true, false, null],
      ["price", "REAL", false, false, "0"],
      ["img", "BLOB", false, false, null],
    ]);
    expect(items.indexes.map((i) => i.name)).toEqual(["idx_name"]);
    expect(items.sql).toMatch(/^CREATE TABLE "my items"/);
  });

  it("pages and sorts rows across the whole table, ignoring unknown sort columns", () => {
    const db = sampleDb();
    expect(tableRows(db, "my items", 0, 2, null).map((r) => r[1])).toEqual(["b", "a"]);
    expect(tableRows(db, "my items", 1, 3, null).map((r) => r[1])).toEqual(["a", "c"]);
    expect(tableRows(db, "my items", 0, 3, { column: 2, desc: true }).map((r) => r[1])).toEqual(["a", "b", "c"]);
    expect(tableRows(db, "my items", 0, 3, { column: 99, desc: true })).toHaveLength(3);
    expect(tableRows(db, "cheap", 0, 10, { column: 0, desc: false }).map((r) => r[0])).toEqual(["b", "c"]);
    const blob = tableRows(db, "my items", 0, 1, null)[0][3];
    expect(Array.from(blob as Uint8Array)).toEqual([1, 2]);
  });

  it("runs multi-statement SQL: last result set, row cap, and in-memory change count", () => {
    const db = sampleDb();
    const r = runQuery(db, `UPDATE "my items" SET price = price * 2; SELECT name, price FROM "my items" ORDER BY name`, 2);
    expect(r.columns).toEqual(["name", "price"]);
    expect(r.rows).toEqual([
      ["a", 20],
      ["b", 5],
    ]);
    expect(r.truncated).toBe(true);
    expect(r.changes).toBe(3);
    expect(r.statements).toBe(2);
  });

  it("surfaces SQL errors", () => {
    expect(() => runQuery(sampleDb(), "SELECT * FROM nope", 10)).toThrow(/no such table/);
  });

  it("quotes identifiers safely", () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
  });
});

describe("sqlite-header", () => {
  it("recognises SQLite files and WAL mode, and clears the WAL flag on a copy", () => {
    const bytes = sampleDb().export();
    expect(isSqliteFile(bytes)).toBe(true);
    expect(isSqliteFile(new TextEncoder().encode("Thumbs.db is not sqlite".padEnd(120, " ")))).toBe(false);
    expect(usesWal(bytes)).toBe(false);
    const wal = bytes.slice();
    wal[18] = 2;
    wal[19] = 2;
    expect(usesWal(wal)).toBe(true);
    const fixed = withoutWalFlag(wal);
    expect([fixed[18], fixed[19], wal[18]]).toEqual([1, 1, 2]);
    // The fixed copy opens.
    expect(listTables(new SQL.Database(fixed))[0].rowCount).toBe(3);
  });
});
