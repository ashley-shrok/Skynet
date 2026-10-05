import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  CellStyleModule,
  ColumnAutoSizeModule,
  InfiniteRowModelModule,
  TooltipModule,
  type ColDef,
  type IDatasource,
  type IGetRowsParams,
} from "ag-grid-community";
import Papa from "papaparse";
import { Download } from "lucide-react";
import { DARK_GRID_THEME } from "./grid-theme";
import { baseName, formatCell, isNumericValue } from "./cell-format";

/**
 * Read-only grid over a row source that loads on demand (AG Grid's infinite
 * row model): huge tables scroll without loading every row. Shared by the
 * SQLite, Parquet and Arrow viewers.
 */

export interface DataColumn {
  name: string;
  /** Shown in the header tooltip. */
  type?: string;
}

export interface DataSort {
  column: number;
  desc: boolean;
}

export interface RowSource {
  /** Changing the key resets the grid (new table, new query). */
  key: string;
  columns: DataColumn[];
  /** Total rows when known. */
  rowCount: number | null;
  /** Sorting re-queries the source, so only sources that can sort the whole set allow it. */
  sortable: boolean;
  getRows(start: number, end: number, sort: DataSort | null): Promise<unknown[][]>;
}

const MODULES = [InfiniteRowModelModule, CellStyleModule, TooltipModule, ColumnAutoSizeModule];
const BLOCK_SIZE = 200;
export const EXPORT_MAX_ROWS = 100_000;

type Row = { values: unknown[] };

export function DataGrid({
  source,
  filename,
  footer,
}: {
  source: RowSource;
  filename: string;
  footer?: React.ReactNode;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<DataSort | null>(null);
  const [exporting, setExporting] = useState(false);

  const columnDefs = useMemo<ColDef<Row>[]>(
    () =>
      source.columns.map((col, i) => ({
        colId: String(i),
        headerName: col.name,
        headerTooltip: col.type ? `${col.name}: ${col.type}` : col.name,
        sortable: source.sortable,
        valueGetter: (p) => p.data?.values[i],
        // No data yet = the row is still loading; show nothing rather than NULL.
        valueFormatter: (p) => (p.data === undefined ? "" : p.value === null || p.value === undefined ? "NULL" : formatCell(p.value)),
        cellClassRules: {
          "dv-null": (p) => p.data !== undefined && (p.value === null || p.value === undefined),
          "dv-num": (p) => isNumericValue(p.value),
        },
        tooltipValueGetter: (p) => {
          const text = formatCell(p.value);
          return text.length > 40 ? text : undefined;
        },
        minWidth: 80,
        maxWidth: 480,
      })),
    [source],
  );

  const datasource = useMemo<IDatasource>(
    () => ({
      getRows: (params: IGetRowsParams) => {
        const first = params.sortModel[0];
        const nextSort = first ? { column: Number(first.colId), desc: first.sort === "desc" } : null;
        setSort(nextSort);
        source
          .getRows(params.startRow, params.endRow, nextSort)
          .then((rows) => {
            setError(null);
            const reachedEnd = rows.length < params.endRow - params.startRow;
            const last = source.rowCount ?? (reachedEnd ? params.startRow + rows.length : -1);
            params.successCallback(
              rows.map((values) => ({ values })),
              last,
            );
          })
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "Couldn't load these rows.");
            params.failCallback();
          });
      },
    }),
    [source],
  );

  const exportCsv = async () => {
    setExporting(true);
    try {
      const end = Math.min(source.rowCount ?? EXPORT_MAX_ROWS, EXPORT_MAX_ROWS);
      const rows = await source.getRows(0, end, sort);
      const csv = Papa.unparse({
        fields: source.columns.map((c) => c.name),
        data: rows.map((r) => r.map(formatCell)),
      });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName(filename)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const capped = (source.rowCount ?? EXPORT_MAX_ROWS + 1) > EXPORT_MAX_ROWS;
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5" data-testid="data-grid">
      <style>{`.dv-null{color:#6f6758;font-style:italic}.dv-num{text-align:right;font-variant-numeric:tabular-nums}`}</style>
      <div className="min-h-0 flex-1">
        <AgGridReact<Row>
          key={source.key}
          modules={MODULES}
          theme={DARK_GRID_THEME}
          rowModelType="infinite"
          datasource={datasource}
          columnDefs={columnDefs}
          cacheBlockSize={BLOCK_SIZE}
          maxBlocksInCache={50}
          infiniteInitialRowCount={Math.min(source.rowCount ?? BLOCK_SIZE, BLOCK_SIZE)}
          enableCellTextSelection
          ensureDomOrder
          tooltipShowDelay={400}
          autoSizeStrategy={{ type: "fitCellContents" }}
          suppressMovableColumns={false}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[#a89a80]">
        <span data-testid="data-grid-count">
          {source.rowCount !== null ? `${source.rowCount.toLocaleString()} rows` : "Rows load as you scroll"} ·{" "}
          {source.columns.length} columns
        </span>
        {footer}
        {error ? <span className="text-[#e8a27a]">{error}</span> : null}
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={exporting}
          className="ml-auto inline-flex items-center gap-1 rounded border border-[#3a3428] px-2 py-0.5 text-[#e8e4d8] hover:bg-[#2a251c] disabled:opacity-50"
          title={capped ? `Exports the first ${EXPORT_MAX_ROWS.toLocaleString()} rows` : "Export as CSV"}
        >
          <Download size={12} aria-hidden />
          {exporting ? "Exporting…" : capped ? `Export first ${EXPORT_MAX_ROWS.toLocaleString()} as CSV` : "Export CSV"}
        </button>
      </div>
    </div>
  );
}

/** A row source over rows already in memory (query results), sortable locally. */
export function memoryRowSource(key: string, columns: DataColumn[], rows: unknown[][]): RowSource {
  let sortedFor: string | null = null;
  let sorted = rows;
  const compare = (a: unknown, b: unknown): number => {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    if (isNumericValue(a) && isNumericValue(b)) return a < b ? -1 : 1;
    return formatCell(a).localeCompare(formatCell(b), undefined, { numeric: true });
  };
  return {
    key,
    columns,
    rowCount: rows.length,
    sortable: true,
    async getRows(start, end, sort) {
      const sortKey = sort ? `${sort.column}:${sort.desc}` : null;
      if (sortKey !== sortedFor) {
        sortedFor = sortKey;
        sorted = sort
          ? [...rows].sort((x, y) => compare(x[sort.column], y[sort.column]) * (sort.desc ? -1 : 1))
          : rows;
      }
      return sorted.slice(start, end);
    },
  };
}
