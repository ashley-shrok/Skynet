import type { QueryResult, TableInfo } from "./sqlite-engine";

/** Messages between the SQLite viewer and its worker. */
export type SqliteRequest =
  | { type: "open"; bytes: ArrayBuffer; wasmUrl: string }
  | { type: "tables" }
  | { type: "rows"; table: string; start: number; end: number; sort: { column: number; desc: boolean } | null }
  | { type: "query"; sql: string; maxRows: number };

export type SqliteResult = { tables: TableInfo[] } | { rows: unknown[][] } | QueryResult;

export type SqliteMessage = { id: number; request: SqliteRequest };
export type SqliteReply = { id: number; ok: true; result: SqliteResult } | { id: number; ok: false; error: string };
