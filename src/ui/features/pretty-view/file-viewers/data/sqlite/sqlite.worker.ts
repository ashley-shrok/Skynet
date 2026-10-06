/// <reference lib="webworker" />
import initSqlJs, { type Database } from "sql.js";
import { listTables, runQuery, tableRows } from "./sqlite-engine";
import type { SqliteMessage, SqliteReply, SqliteResult } from "./sqlite-protocol";

/**
 * SQLite for the viewer, off the main thread: a runaway query can be
 * cancelled by terminating this worker. The database lives in memory only;
 * nothing is ever written back to the file.
 */

let db: Database | null = null;

async function handle(msg: SqliteMessage["request"]): Promise<SqliteResult> {
  if (msg.type === "open") {
    const SQL = await initSqlJs({ locateFile: () => msg.wasmUrl });
    db?.close();
    db = new SQL.Database(new Uint8Array(msg.bytes));
    return { tables: listTables(db) };
  }
  if (!db) throw new Error("No database is open.");
  if (msg.type === "tables") return { tables: listTables(db) };
  if (msg.type === "rows") return { rows: tableRows(db, msg.table, msg.start, msg.end, msg.sort) };
  return runQuery(db, msg.sql, msg.maxRows);
}

self.onmessage = (event: MessageEvent<SqliteMessage>) => {
  const { id, request } = event.data;
  handle(request).then(
    (result) => self.postMessage({ id, ok: true, result } satisfies SqliteReply),
    (err: unknown) =>
      self.postMessage({
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies SqliteReply),
  );
};
