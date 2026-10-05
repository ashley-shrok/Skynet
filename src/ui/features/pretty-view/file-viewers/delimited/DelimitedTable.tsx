import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  CellStyleModule,
  ClientSideRowModelModule,
  QuickFilterModule,
  RenderApiModule,
  RowApiModule,
  TextEditorModule,
  TextFilterModule,
  UndoRedoEditModule,
  colorSchemeDark,
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ValueGetterParams,
  type ValueSetterParams,
} from "ag-grid-community";
import { Columns3, Plus, Redo2, Rows3, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileModeViewProps } from "../registry";
import {
  columnLetter,
  parseDelimited,
  serializeDelimited,
  type DelimitedFormat,
} from "./delimited-format";

/**
 * Editable table for CSV / TSV / PSV, on AG Grid Community. Lazy-loaded by
 * table-mode.tsx so the grid only downloads when a delimited file is opened.
 *
 * The grid edits the parsed rows in place (so AG Grid's undo/redo and
 * sort/filter state survive edits) and every change is serialized back to
 * text with the file's own format and handed to FileView as the new draft.
 * Text arriving from elsewhere (Raw edits, a reload) is re-parsed.
 */

const MODULES = [
  ClientSideRowModelModule,
  TextEditorModule,
  TextFilterModule,
  QuickFilterModule,
  RenderApiModule,
  RowApiModule,
  UndoRedoEditModule,
  CellStyleModule,
];

const GRID_THEME = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "#13151c",
  foregroundColor: "#e8e4d8",
  headerBackgroundColor: "#1b1e27",
  headerTextColor: "#e8e4d8",
  oddRowBackgroundColor: "#161922",
  borderColor: "rgba(255,255,255,0.10)",
  accentColor: "hsl(220, 80%, 65%)",
  fontSize: 12,
  headerFontSize: 12,
  spacing: 5,
  wrapperBorderRadius: 8,
});

interface RowRecord {
  id: number;
  cells: string[];
}

let nextRowId = 1;
const toRecords = (rows: string[][]): RowRecord[] =>
  rows.map((cells) => ({ id: nextRowId++, cells }));

/** Numbers sort as numbers; everything else as text. */
function compareCells(a: unknown, b: unknown): number {
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  const na = Number(sa);
  const nb = Number(sb);
  if (sa.trim() !== "" && sb.trim() !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) {
    return na - nb;
  }
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
}

const TOOL_BTN = cn(
  "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] cursor-pointer",
  "bg-black/20 border border-white/10 text-[#e8e4d8] hover:bg-white/[0.06]",
  "disabled:opacity-40 disabled:cursor-not-allowed",
);

export default function DelimitedTable({
  filename,
  content,
  onChange,
  disabled,
}: FileModeViewProps): JSX.Element {
  // The text the current records were parsed from or serialized to. A
  // different `content` means the text changed elsewhere → re-parse.
  const [initial] = useState(() => parseDelimited(content, filename));
  const [source, setSource] = useState<string>(content);
  const [records, setRecords] = useState<RowRecord[]>(() => toRecords(initial.rows));
  const formatRef = useRef<DelimitedFormat>(initial.format);
  if (content !== source) {
    const doc = parseDelimited(content, filename);
    formatRef.current = doc.format;
    setSource(content);
    setRecords(toRecords(doc.rows));
  }

  const [hasHeader, setHasHeader] = useState(true);
  const [search, setSearch] = useState("");
  const apiRef = useRef<GridApi<RowRecord> | null>(null);

  const emit = useCallback(
    (next: RowRecord[]) => {
      const text = serializeDelimited({
        rows: next.map((r) => r.cells),
        format: formatRef.current,
      });
      setSource(text);
      onChange(text);
    },
    [onChange],
  );

  const headerRecord = hasHeader ? records[0] : undefined;
  const dataRecords = useMemo(
    () => (hasHeader ? records.slice(1) : records),
    [records, hasHeader],
  );
  const colCount = useMemo(
    () => Math.max(1, ...records.map((r) => r.cells.length)),
    [records],
  );
  const lineNumber = useMemo(() => {
    const m = new Map<number, number>();
    dataRecords.forEach((r, i) => m.set(r.id, i + 1));
    return m;
  }, [dataRecords]);

  const columnDefs = useMemo<ColDef<RowRecord>[]>(() => {
    const rowNumberCol: ColDef<RowRecord> = {
      colId: "__row",
      headerName: "",
      valueGetter: (p: ValueGetterParams<RowRecord>) => (p.data ? lineNumber.get(p.data.id) : ""),
      width: 56,
      pinned: "left",
      editable: false,
      sortable: false,
      filter: false,
      resizable: false,
      suppressMovable: true,
      cellStyle: { color: "#a89a80", textAlign: "right" },
    };
    const cols: ColDef<RowRecord>[] = [];
    for (let i = 0; i < colCount; i++) {
      const name = headerRecord?.cells[i];
      cols.push({
        colId: `c${i}`,
        headerName: name && name.length > 0 ? name : hasHeader ? `Column ${columnLetter(i)}` : columnLetter(i),
        valueGetter: (p: ValueGetterParams<RowRecord>) => p.data?.cells[i] ?? "",
        valueSetter: (p: ValueSetterParams<RowRecord>) => {
          const cells = p.data.cells;
          while (cells.length <= i) cells.push("");
          cells[i] = p.newValue == null ? "" : String(p.newValue);
          return true;
        },
        comparator: compareCells,
      });
    }
    return [rowNumberCol, ...cols];
  }, [colCount, headerRecord, hasHeader, lineNumber]);

  const defaultColDef = useMemo<ColDef<RowRecord>>(
    () => ({
      editable: !disabled,
      sortable: true,
      filter: "agTextColumnFilter",
      resizable: true,
      // Columns share the width; past ~8 columns the grid scrolls sideways.
      flex: 1,
      minWidth: 110,
    }),
    [disabled],
  );

  // Row numbers come from a valueGetter the grid caches per row; refresh
  // them when rows are inserted / deleted or the header toggle moves them.
  useEffect(() => {
    apiRef.current?.refreshCells({ columns: ["__row"], force: true });
  }, [lineNumber]);

  const onGridReady = useCallback((e: GridReadyEvent<RowRecord>) => {
    apiRef.current = e.api;
  }, []);

  /** Position in `records` and column index of the focused cell, if any. */
  const focused = (): { recordIndex: number; col: number } | null => {
    const api = apiRef.current;
    const cell = api?.getFocusedCell();
    if (!api || !cell) return null;
    const node = api.getDisplayedRowAtIndex(cell.rowIndex);
    const colId = cell.column.getColId();
    const col = colId.startsWith("c") ? Number(colId.slice(1)) : -1;
    const recordIndex = node?.data ? records.findIndex((r) => r.id === node.data!.id) : -1;
    return { recordIndex, col };
  };

  const commit = (next: RowRecord[]) => {
    setRecords(next);
    emit(next);
  };

  const addRow = () => {
    const f = focused();
    const at = f && f.recordIndex >= 0 ? f.recordIndex + 1 : records.length;
    const row: RowRecord = { id: nextRowId++, cells: Array<string>(colCount).fill("") };
    commit([...records.slice(0, at), row, ...records.slice(at)]);
  };

  const deleteRow = () => {
    const f = focused();
    if (!f || f.recordIndex < 0) return;
    commit(records.filter((_, i) => i !== f.recordIndex));
  };

  const addColumn = () => {
    const f = focused();
    const at = f && f.col >= 0 ? f.col + 1 : colCount;
    commit(
      records.map((r) =>
        r.cells.length >= at
          ? { ...r, cells: [...r.cells.slice(0, at), "", ...r.cells.slice(at)] }
          : r,
      ),
    );
  };

  const deleteColumn = () => {
    const f = focused();
    if (!f || f.col < 0) return;
    commit(
      records.map((r) =>
        r.cells.length > f.col
          ? { ...r, cells: r.cells.filter((_, i) => i !== f.col) }
          : r,
      ),
    );
  };

  const renameColumn = () => {
    const f = focused();
    if (!f || f.col < 0 || !headerRecord) return;
    const current = headerRecord.cells[f.col] ?? "";
    const name = window.prompt("Column name", current);
    if (name === null || name === current) return;
    commit(
      records.map((r, i) => {
        if (i !== 0) return r;
        const cells = [...r.cells];
        while (cells.length <= f.col) cells.push("");
        cells[f.col] = name;
        return { ...r, cells };
      }),
    );
  };

  return (
    <div className="flex flex-col gap-2 h-full min-h-[420px]" data-testid="delimited-table">
      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search rows…"
          aria-label="Search rows"
          className="min-w-[140px] flex-1 max-w-[260px] text-[12px] px-2 py-1 rounded-md outline-none bg-black/20 border border-white/10 text-[#fbf5e8] placeholder:text-[#a89a80]"
        />
        <label className="inline-flex items-center gap-1.5 text-[12px] text-[#e8e4d8] px-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={(e) => setHasHeader(e.target.checked)}
          />
          First row is headers
        </label>
        <span className="flex-1" />
        <button type="button" className={TOOL_BTN} onClick={() => apiRef.current?.undoCellEditing()} disabled={disabled} title="Undo cell edit">
          <Undo2 size={13} aria-hidden /> <span className="sr-only">Undo</span>
        </button>
        <button type="button" className={TOOL_BTN} onClick={() => apiRef.current?.redoCellEditing()} disabled={disabled} title="Redo cell edit">
          <Redo2 size={13} aria-hidden /> <span className="sr-only">Redo</span>
        </button>
        <button type="button" className={TOOL_BTN} onClick={addRow} disabled={disabled} title="Add a row below the selected cell">
          <Plus size={13} aria-hidden /> Row
        </button>
        <button type="button" className={TOOL_BTN} onClick={deleteRow} disabled={disabled} title="Delete the selected cell's row">
          <Trash2 size={13} aria-hidden /> Row
        </button>
        <button type="button" className={TOOL_BTN} onClick={addColumn} disabled={disabled} title="Add a column right of the selected cell">
          <Plus size={13} aria-hidden /> Column
        </button>
        <button type="button" className={TOOL_BTN} onClick={deleteColumn} disabled={disabled} title="Delete the selected cell's column">
          <Trash2 size={13} aria-hidden /> Column
        </button>
        {hasHeader ? (
          <button type="button" className={TOOL_BTN} onClick={renameColumn} disabled={disabled} title="Rename the selected cell's column">
            <Columns3 size={13} aria-hidden /> Rename
          </button>
        ) : null}
      </div>
      <div className="flex-1 min-h-[360px]">
        <AgGridReact<RowRecord>
          modules={MODULES}
          theme={GRID_THEME}
          rowData={dataRecords}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(p) => String(p.data.id)}
          quickFilterText={search}
          undoRedoCellEditing
          undoRedoCellEditingLimit={50}
          stopEditingWhenCellsLoseFocus
          enterNavigatesVerticallyAfterEdit
          onGridReady={onGridReady}
          onCellValueChanged={() => emit(records)}
          overlayNoRowsTemplate="No rows. Use “+ Row” to add one."
        />
      </div>
      <div className="shrink-0 text-[11.5px] text-[#a89a80] flex items-center gap-1">
        <Rows3 size={12} aria-hidden />
        {dataRecords.length} {dataRecords.length === 1 ? "row" : "rows"} × {colCount}{" "}
        {colCount === 1 ? "column" : "columns"}
      </div>
    </div>
  );
}
