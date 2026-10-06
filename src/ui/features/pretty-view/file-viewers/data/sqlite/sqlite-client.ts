import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";
import type { QueryResult, TableInfo } from "./sqlite-engine";
import type { SqliteReply, SqliteRequest, SqliteResult } from "./sqlite-protocol";

/**
 * Main-thread handle on the SQLite worker. cancel() terminates the worker
 * (stopping any query) and reopens the original bytes in a fresh one, so
 * in-memory changes made by earlier statements are dropped.
 */
export class SqliteClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: SqliteResult) => void; reject: (e: Error) => void }>();

  private constructor(private readonly bytes: ArrayBuffer) {
    this.worker = this.spawn();
  }

  static async open(bytes: Uint8Array): Promise<{ client: SqliteClient; tables: TableInfo[] }> {
    // Keep a private copy: the worker gets its own on every (re)open.
    const own = bytes.slice().buffer;
    const client = new SqliteClient(own);
    const { tables } = (await client.call({ type: "open", bytes: own.slice(0), wasmUrl: absolute(wasmUrl) })) as {
      tables: TableInfo[];
    };
    return { client, tables };
  }

  tables(): Promise<TableInfo[]> {
    return this.call({ type: "tables" }).then((r) => (r as { tables: TableInfo[] }).tables);
  }

  rows(table: string, start: number, end: number, sort: { column: number; desc: boolean } | null): Promise<unknown[][]> {
    return this.call({ type: "rows", table, start, end, sort }).then((r) => (r as { rows: unknown[][] }).rows);
  }

  query(sql: string, maxRows: number): Promise<QueryResult> {
    return this.call({ type: "query", sql, maxRows }) as Promise<QueryResult>;
  }

  /** Stop whatever is running and start over from the file's bytes. */
  async cancel(): Promise<TableInfo[]> {
    this.worker.terminate();
    const err = new Error("Cancelled.");
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.worker = this.spawn();
    const { tables } = (await this.call({ type: "open", bytes: this.bytes.slice(0), wasmUrl: absolute(wasmUrl) })) as {
      tables: TableInfo[];
    };
    return tables;
  }

  close(): void {
    this.worker.terminate();
    this.pending.clear();
  }

  private spawn(): Worker {
    const worker = new Worker(new URL("./sqlite.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<SqliteReply>) => {
      const reply = event.data;
      const p = this.pending.get(reply.id);
      if (!p) return;
      this.pending.delete(reply.id);
      if ("error" in reply) p.reject(new Error(reply.error));
      else p.resolve(reply.result);
    };
    worker.onerror = (event) => {
      const err = new Error(event.message || "The database worker failed.");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
    return worker;
  }

  private call(request: SqliteRequest): Promise<SqliteResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const transfer = request.type === "open" ? [request.bytes] : [];
      this.worker.postMessage({ id, request }, transfer);
    });
  }
}

function absolute(url: string): string {
  return new URL(url, window.location.href).href;
}
