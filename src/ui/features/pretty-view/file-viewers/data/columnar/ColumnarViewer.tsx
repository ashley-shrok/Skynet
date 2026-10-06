import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { FileModeViewProps } from "../../registry";
import { extensionOf } from "../../registry-ext";
import { DataGrid, type RowSource } from "../DataGrid";
import { openArrow, openParquet, type ColumnarFile } from "./columnar-source";

/**
 * Parquet / Arrow / Feather viewer (view-only): a grid that loads rows as
 * you scroll, and a schema tab with column types and file facts. Sorting
 * would need the whole file, so columns aren't sortable here.
 */

type Load = { status: "loading" } | { status: "ready"; file: ColumnarFile } | { status: "error"; message: string };

export default function ColumnarViewer({ filename, src }: FileModeViewProps): JSX.Element {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [tab, setTab] = useState<"data" | "schema">("data");

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    setLoad({ status: "loading" });
    const open = extensionOf(filename) === "parquet" ? openParquet : openArrow;
    open(src).then(
      (file) => !cancelled && setLoad({ status: "ready", file }),
      (err: unknown) =>
        !cancelled &&
        setLoad({
          status: "error",
          message: err instanceof Error && /^(Couldn't|This)/.test(err.message) ? err.message : "This file couldn't be read.",
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [src, filename]);

  const source = useMemo<RowSource | null>(() => {
    if (load.status !== "ready") return null;
    const { file } = load;
    return {
      key: src ?? filename,
      columns: file.columns,
      rowCount: file.rowCount,
      sortable: false,
      getRows: (start, end) => file.getRows(start, end),
    };
  }, [load, src, filename]);

  if (load.status === "loading") return <div className="p-6 text-center text-sm text-[#a89a80]">Reading file…</div>;
  if (load.status === "error") {
    return (
      <div className="p-8 text-center text-sm text-[#cfc8b8]" data-testid="columnar-error">
        {load.message}
      </div>
    );
  }
  const { file } = load;
  return (
    <div className="flex h-full min-h-[360px] flex-col text-[13px] text-[#e8e4d8]" data-testid="columnar-viewer">
      <div className="flex items-center gap-1 border-b border-[#2e2a22] px-2 py-1" role="tablist">
        {(
          [
            ["data", "Data"],
            ["schema", "Schema"],
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
        <span className="ml-2 text-[12px] text-[#a89a80]">{file.format}</span>
      </div>
      <div className="min-h-0 flex-1 p-2">
        {tab === "data" && source ? <DataGrid source={source} filename={filename} /> : null}
        {tab === "schema" ? (
          <div className="h-full overflow-auto" data-testid="columnar-schema">
            <dl className="mb-4 grid max-w-xl grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[12px]">
              {file.facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-[#a89a80]">{k}</dt>
                  <dd className="font-mono">{v}</dd>
                </div>
              ))}
            </dl>
            <table className="w-full max-w-3xl border-collapse text-[12px]">
              <thead>
                <tr className="text-left text-[#a89a80]">
                  {["Column", "Type", "Nullable"].map((h) => (
                    <th key={h} className="border-b border-[#2e2a22] px-2 py-1 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {file.columns.map((c) => (
                  <tr key={c.name}>
                    <td className="border-b border-[#211e18] px-2 py-1 font-mono">{c.name}</td>
                    <td className="border-b border-[#211e18] px-2 py-1 font-mono text-[#cfc8b8]">{c.type ?? ""}</td>
                    <td className="border-b border-[#211e18] px-2 py-1">{c.nullable ? "yes" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
