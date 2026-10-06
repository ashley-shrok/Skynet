import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Database, Eye, Loader2, Play, Square, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileModeViewProps } from "../../registry";
import { DataGrid, memoryRowSource, type RowSource } from "../DataGrid";
import type { QueryResult, TableInfo } from "./sqlite-engine";
import { SqliteClient } from "./sqlite-client";
import { isSqliteFile, usesWal, withoutWalFlag } from "./sqlite-header";
import { SqlEditor } from "./SqlEditor";

/**
 * SQLite viewer (read-only): tables and views with row counts, a paged
 * grid that sorts across the whole table, the schema, and a SQL box.
 * The database runs in a worker on an in-memory copy; statements that
 * change data only change that copy — nothing is written back.
 */

const MAX_BYTES = 200 * 1024 * 1024;
const QUERY_MAX_ROWS = 10_000;

type Load =
  | { status: "loading" }
  | { status: "ready"; client: SqliteClient; tables: TableInfo[]; wal: boolean }
  | { status: "error"; message: string; notSqlite?: boolean };

type Tab = "data" | "schema" | "sql";

type QueryState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: QueryResult; ms: number; seq: number }
  | { status: "error"; message: string };

export default function SqliteViewer({ filename, src }: FileModeViewProps): JSX.Element {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("data");
  const [sqlText, setSqlText] = useState("");
  const [query, setQuery] = useState<QueryState>({ status: "idle" });
  const [modified, setModified] = useState(false);
  const querySeq = useRef(0);
  const cancelling = useRef(false);

  useEffect(() => {
    if (!src) return;
    const ctrl = new AbortController();
    let client: SqliteClient | null = null;
    setLoad({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(src, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`Couldn't download the database (HTTP ${res.status}).`);
        if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
          throw new Error("This database is too large to open here (over 200 MB).");
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > MAX_BYTES) throw new Error("This database is too large to open here (over 200 MB).");
        if (!isSqliteFile(bytes)) {
          setLoad({ status: "error", notSqlite: true, message: "This file isn't an SQLite database." });
          return;
        }
        const opened = await SqliteClient.open(withoutWalFlag(bytes));
        client = opened.client;
        if (ctrl.signal.aborted) return;
        setLoad({ status: "ready", client: opened.client, tables: opened.tables, wal: usesWal(bytes) });
        const first = opened.tables.find((t) => t.kind === "table") ?? opened.tables[0];
        setSelected(first?.name ?? null);
        setSqlText(first ? `SELECT * FROM ${quote(first.name)} LIMIT 100;` : "SELECT sqlite_version();");
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setLoad({ status: "error", message: err instanceof Error ? err.message : "This database couldn't be opened." });
      }
    })();
    return () => {
      ctrl.abort();
      client?.close();
    };
  }, [src]);

  const ready = load.status === "ready" ? load : null;
  const table = ready?.tables.find((t) => t.name === selected) ?? null;

  const tableSource = useMemo<RowSource | null>(() => {
    if (!ready || !table) return null;
    return {
      key: `${table.name}:${querySeq.current}`,
      columns: table.columns.map((c) => ({ name: c.name, type: c.type || undefined })),
      rowCount: table.rowCount,
      sortable: true,
      getRows: (start, end, sort) => ready.client.rows(table.name, start, end, sort),
    };
    // querySeq bumps after statements that may have changed data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, table, modified]);

  const schema = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const t of ready?.tables ?? []) out[t.name] = t.columns.map((c) => c.name);
    return out;
  }, [ready]);

  const run = useCallback(async () => {
    if (!ready || query.status === "running" || !sqlText.trim()) return;
    setQuery({ status: "running" });
    const started = performance.now();
    try {
      const result = await ready.client.query(sqlText, QUERY_MAX_ROWS);
      const seq = ++querySeq.current;
      setQuery({ status: "done", result, ms: performance.now() - started, seq });
      if (result.changes > 0 || /\b(create|drop|alter)\b/i.test(sqlText)) {
        const tables = await ready.client.tables();
        setLoad({ ...ready, tables });
        setModified(true);
      }
    } catch (err) {
      // A cancelled run rejects too; cancel() reports the outcome itself.
      if (cancelling.current) return;
      setQuery({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [ready, query.status, sqlText]);

  const cancel = useCallback(async () => {
    if (!ready) return;
    cancelling.current = true;
    try {
      const tables = await ready.client.cancel();
      setLoad({ ...ready, tables });
      setModified(false);
      querySeq.current++;
      setQuery({ status: "error", message: "Query cancelled. Any earlier changes in this view were discarded." });
    } catch (err) {
      setQuery({ status: "error", message: err instanceof Error ? err.message : "Couldn't restart the database." });
    } finally {
      cancelling.current = false;
    }
  }, [ready]);

  const resultSource = useMemo<RowSource | null>(() => {
    if (query.status !== "done" || query.result.columns.length === 0) return null;
    return memoryRowSource(
      `q${query.seq}`,
      query.result.columns.map((name) => ({ name })),
      query.result.rows,
    );
  }, [query]);

  if (load.status === "loading") {
    return <div className="p-6 text-center text-sm text-[#a89a80]">Opening database…</div>;
  }
  if (load.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-[#cfc8b8]" data-testid="sqlite-error">
        <div>{load.message}</div>
        {load.notSqlite && src ? (
          <a href={src} download={filename.slice(filename.lastIndexOf("/") + 1)} className="rounded border border-[#3a3428] px-3 py-1.5 hover:bg-[#2a251c]">
            Download
          </a>
        ) : null}
      </div>
    );
  }

  const tables = load.tables.filter((t) => t.kind === "table");
  const views = load.tables.filter((t) => t.kind === "view");

  return (
    <div className="flex h-full min-h-[360px] flex-col text-[13px] text-[#e8e4d8]" data-testid="sqlite-viewer">
      {load.wal ? (
        <div className="flex items-center gap-2 border-b border-[#2e2a22] px-3 py-1.5 text-[12px] text-[#d9b98a]" data-testid="sqlite-wal">
          <AlertTriangle size={13} aria-hidden />
          This database uses write-ahead logging. Recent changes still in its <code>-wal</code> file aren't shown.
        </div>
      ) : null}
      {modified ? (
        <div className="border-b border-[#2e2a22] px-3 py-1.5 text-[12px] text-[#d9b98a]" data-testid="sqlite-modified">
          Your statements changed this view's in-memory copy. The file itself is unchanged; reopen it to start over.
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 overflow-y-auto border-r border-[#2e2a22] py-2" aria-label="Tables">
          {[
            ["Tables", tables],
            ["Views", views],
          ].map(([label, list]) =>
            (list as TableInfo[]).length ? (
              <div key={label as string} className="mb-2">
                <div className="px-3 pb-1 text-[11px] uppercase tracking-wide text-[#7d725f]">{label as string}</div>
                {(list as TableInfo[]).map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => {
                      setSelected(t.name);
                      if (tab === "sql") setTab("data");
                    }}
                    className={cn(
                      "flex w-full items-center gap-1.5 px-3 py-1 text-left hover:bg-[#2a251c]",
                      selected === t.name && "bg-[#3a3428] text-[#fbf5e8]",
                    )}
                  >
                    {t.kind === "view" ? <Eye size={13} aria-hidden /> : <Table2 size={13} aria-hidden />}
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {t.rowCount !== null ? (
                      <span className="text-[11px] text-[#7d725f]">{t.rowCount.toLocaleString()}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null,
          )}
          {load.tables.length === 0 ? <div className="px-3 text-[#7d725f]">No tables.</div> : null}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b border-[#2e2a22] px-2 py-1" role="tablist">
            {(
              [
                ["data", "Data"],
                ["schema", "Schema"],
                ["sql", "SQL"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn("rounded px-2.5 py-1 text-[12px]", tab === id ? "bg-[#3a3428] text-[#fbf5e8]" : "text-[#cfc8b8] hover:bg-[#2a251c]")}
              >
                {label}
              </button>
            ))}
            {tab !== "sql" && table ? <span className="ml-2 truncate text-[12px] text-[#a89a80]">{table.name}</span> : null}
          </div>
          <div className="min-h-0 flex-1 p-2">
            {tab === "data" ? (
              tableSource ? (
                <DataGrid source={tableSource} filename={`${table!.name}.csv`} />
              ) : (
                <div className="p-4 text-[#a89a80]">Pick a table.</div>
              )
            ) : null}
            {tab === "schema" ? table ? <SchemaPanel table={table} /> : <div className="p-4 text-[#a89a80]">Pick a table.</div> : null}
            {tab === "sql" ? (
              <div className="flex h-full min-h-0 flex-col gap-2">
                <div className="h-36 shrink-0">
                  <SqlEditor value={sqlText} onChange={setSqlText} onRun={() => void run()} schema={schema} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  {query.status === "running" ? (
                    <button type="button" onClick={() => void cancel()} className="inline-flex items-center gap-1 rounded bg-[#5a2e22] px-3 py-1 text-[#fbe3d8] hover:bg-[#6d382a]">
                      <Square size={12} aria-hidden /> Cancel
                    </button>
                  ) : (
                    <button type="button" onClick={() => void run()} className="inline-flex items-center gap-1 rounded bg-[#2f4a32] px-3 py-1 text-[#e3f5e4] hover:bg-[#3a5b3d]" data-testid="sql-run">
                      <Play size={12} aria-hidden /> Run
                    </button>
                  )}
                  <span className="text-[#7d725f]">Ctrl/⌘+Enter · read-only: changes stay in this view</span>
                  {query.status === "running" ? <Loader2 size={13} className="animate-spin text-[#a89a80]" aria-hidden /> : null}
                  {query.status === "done" ? (
                    <span className="text-[#a89a80]" data-testid="sql-status">
                      {query.result.columns.length
                        ? `${query.result.rows.length.toLocaleString()} row${query.result.rows.length === 1 ? "" : "s"}${query.result.truncated ? ` (first ${QUERY_MAX_ROWS.toLocaleString()})` : ""}`
                        : `${query.result.statements} statement${query.result.statements === 1 ? "" : "s"} ran`}
                      {query.result.changes ? ` · ${query.result.changes.toLocaleString()} rows changed in memory` : ""}
                      {` · ${Math.round(query.ms)} ms`}
                    </span>
                  ) : null}
                  {query.status === "error" ? <span className="text-[#e8a27a]" data-testid="sql-error">{query.message}</span> : null}
                </div>
                <div className="min-h-0 flex-1">
                  {resultSource ? <DataGrid source={resultSource} filename={`${filename}-query.csv`} /> : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function quote(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

function SchemaPanel({ table }: { table: TableInfo }): JSX.Element {
  return (
    <div className="h-full overflow-auto" data-testid="sqlite-schema">
      <div className="mb-2 flex items-center gap-2 text-[12px] text-[#a89a80]">
        <Database size={13} aria-hidden />
        {table.kind === "view" ? "View" : "Table"} · {table.columns.length} columns
        {table.rowCount !== null ? ` · ${table.rowCount.toLocaleString()} rows` : ""}
      </div>
      <table className="mb-4 w-full max-w-3xl border-collapse text-[12px]">
        <thead>
          <tr className="text-left text-[#a89a80]">
            {["Column", "Type", "Not null", "Primary key", "Default"].map((h) => (
              <th key={h} className="border-b border-[#2e2a22] px-2 py-1 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.columns.map((c) => (
            <tr key={c.name}>
              <td className="border-b border-[#211e18] px-2 py-1 font-mono">{c.name}</td>
              <td className="border-b border-[#211e18] px-2 py-1 font-mono text-[#cfc8b8]">{c.type || "—"}</td>
              <td className="border-b border-[#211e18] px-2 py-1">{c.notNull ? "yes" : ""}</td>
              <td className="border-b border-[#211e18] px-2 py-1">{c.primaryKey ? "yes" : ""}</td>
              <td className="border-b border-[#211e18] px-2 py-1 font-mono text-[#cfc8b8]">{c.defaultValue ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {table.indexes.length ? (
        <>
          <div className="mb-1 text-[12px] text-[#a89a80]">Indexes</div>
          <ul className="mb-4 text-[12px]">
            {table.indexes.map((i) => (
              <li key={i.name} className="font-mono">
                {i.sql ?? `${i.name} (automatic)`}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="mb-1 text-[12px] text-[#a89a80]">Definition</div>
      <pre className="whitespace-pre-wrap rounded bg-[#13151c] p-2 font-mono text-[12px] text-[#cfc8b8]">{table.sql}</pre>
    </div>
  );
}
