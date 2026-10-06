import type { Database, SqlValue } from "sql.js";

/**
 * Read-side queries for the SQLite viewer, on an sql.js Database. Runs in
 * the worker (sqlite.worker.ts); kept free of worker plumbing so it can be
 * tested directly.
 */

export interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
}

export interface TableInfo {
  name: string;
  kind: "table" | "view";
  /** null for views (counting can be expensive) or when counting failed. */
  rowCount: number | null;
  sql: string;
  columns: ColumnInfo[];
  indexes: { name: string; sql: string | null }[];
}

export interface QueryResult {
  columns: string[];
  rows: SqlValue[][];
  /** More rows existed than were returned. */
  truncated: boolean;
  /** Rows inserted / updated / deleted by the statements (in memory only). */
  changes: number;
  statements: number;
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function all(db: Database, sql: string, params: SqlValue[] = []): SqlValue[][] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows: SqlValue[][] = [];
    while (stmt.step()) rows.push(stmt.get());
    return rows;
  } finally {
    stmt.free();
  }
}

export function listTables(db: Database): TableInfo[] {
  const objects = all(
    db,
    "SELECT name, type, sql FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
  );
  return objects.map(([name, type, sql]) => {
    const table = String(name);
    const kind = type === "view" ? "view" : "table";
    let columns: ColumnInfo[] = [];
    try {
      columns = all(db, `PRAGMA table_info(${quoteIdent(table)})`).map((r) => ({
        name: String(r[1]),
        type: String(r[2] ?? ""),
        notNull: r[3] === 1,
        primaryKey: Number(r[5]) > 0,
        defaultValue: r[4] === null ? null : String(r[4]),
      }));
    } catch {
      /* a view over a missing table, say */
    }
    let rowCount: number | null = null;
    if (kind === "table") {
      try {
        rowCount = Number(all(db, `SELECT count(*) FROM ${quoteIdent(table)}`)[0][0]);
      } catch {
        rowCount = null;
      }
    }
    const indexes = all(
      db,
      "SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? ORDER BY name",
      [table],
    ).map((r) => ({ name: String(r[0]), sql: r[1] === null ? null : String(r[1]) }));
    return { name: table, kind, rowCount, sql: String(sql ?? ""), columns, indexes };
  });
}

/** Rows [start, end) of a table or view, optionally sorted by one column. */
export function tableRows(
  db: Database,
  table: string,
  start: number,
  end: number,
  sort: { column: number; desc: boolean } | null,
): SqlValue[][] {
  const known = listColumnNames(db, table);
  let order = "";
  if (sort && known[sort.column] !== undefined) {
    order = ` ORDER BY ${quoteIdent(known[sort.column])} ${sort.desc ? "DESC" : "ASC"}`;
  }
  return all(db, `SELECT * FROM ${quoteIdent(table)}${order} LIMIT ? OFFSET ?`, [
    Math.max(0, end - start),
    Math.max(0, start),
  ]);
}

function listColumnNames(db: Database, table: string): string[] {
  const stmt = db.prepare(`SELECT * FROM ${quoteIdent(table)} LIMIT 0`);
  try {
    return stmt.getColumnNames();
  } finally {
    stmt.free();
  }
}

/**
 * Run what the user typed (one or more statements). The last statement
 * that returns rows supplies the result, capped at maxRows. Writes change
 * only this in-memory copy.
 */
export function runQuery(db: Database, sql: string, maxRows: number): QueryResult {
  let result: QueryResult = { columns: [], rows: [], truncated: false, changes: 0, statements: 0 };
  let changes = 0;
  let statements = 0;
  for (const stmt of db.iterateStatements(sql)) {
    try {
      statements++;
      const columns = stmt.getColumnNames();
      if (columns.length === 0) {
        stmt.step();
        changes += db.getRowsModified();
        continue;
      }
      const rows: SqlValue[][] = [];
      let truncated = false;
      while (stmt.step()) {
        if (rows.length >= maxRows) {
          truncated = true;
          break;
        }
        rows.push(stmt.get());
      }
      result = { columns, rows, truncated, changes: 0, statements: 0 };
    } finally {
      stmt.free();
    }
  }
  return { ...result, changes, statements };
}
