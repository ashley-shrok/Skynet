import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import ExcelJS from "exceljs";
import { AgGridReact } from "ag-grid-react";
import {
  CellStyleModule,
  ClientSideRowModelModule,
  PinnedRowModule,
  QuickFilterModule,
  RenderApiModule,
  RowApiModule,
  themeQuartz,
  type CellFocusedEvent,
  type CellStyle,
  type ColDef,
  type ColSpanParams,
  type GridApi,
  type ICellRendererParams,
  type RowSpanParams,
} from "ag-grid-community";
import { AlertTriangle, Sheet } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileModeViewProps } from "../registry";
import { colName, disposeWorkbook, parseWorkbook, type XCell, type XSheet, type XWorkbook } from "./xlsx-model";

/**
 * Read-only Excel viewer: ExcelJS parses the workbook (xlsx-model.ts), AG
 * Grid shows each sheet on a white "paper" theme so the workbook's own
 * colours read as they do in Excel. Lazy-loaded by xlsx-mode.tsx.
 */

/** Largest workbook the browser will download and parse. */
const MAX_BYTES = 50 * 1024 * 1024;

const MODULES = [
  ClientSideRowModelModule,
  CellStyleModule,
  QuickFilterModule,
  PinnedRowModule,
  RowApiModule,
  RenderApiModule,
];

const SHEET_THEME = themeQuartz.withParams({
  backgroundColor: "#ffffff",
  foregroundColor: "#000000",
  headerBackgroundColor: "#f3f3f3",
  headerTextColor: "#444444",
  headerFontWeight: 400,
  borderColor: "#d4d4d4",
  rowBorder: false,
  columnBorder: false,
  headerColumnBorder: true,
  fontFamily: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif',
  fontSize: 14,
  headerFontSize: 12,
  cellHorizontalPadding: 4,
  wrapperBorderRadius: 6,
  accentColor: "#217346", // Excel green for the focused-cell outline
  oddRowBackgroundColor: "#ffffff",
  rowHoverColor: "transparent",
});

interface SheetRow {
  /** 0-based sheet row index. */
  r: number;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; wb: XWorkbook };

const GRID_LINE = "1px solid #e1e1e1";

function cellAt(sheet: XSheet, r: number, c: number): XCell | undefined {
  return sheet.rows[r]?.[c];
}

/** Anchor cells of merges → their span; covered cells → true. */
function mergeIndex(sheet: XSheet) {
  const anchors = new Map<string, { rows: number; cols: number }>();
  const covered = new Set<string>();
  for (const m of sheet.merges) {
    anchors.set(`${m.top},${m.left}`, { rows: m.bottom - m.top + 1, cols: m.right - m.left + 1 });
    for (let r = m.top; r <= m.bottom; r++) {
      for (let c = m.left; c <= m.right; c++) if (r !== m.top || c !== m.left) covered.add(`${r},${c}`);
    }
  }
  return { anchors, covered };
}

function ImagesCell({ images }: { images: XSheet["images"] }): JSX.Element {
  // Images anchored in this cell, drawn over the grid from the anchor.
  return (
    <>
      {images.map((img, i) => (
        <img
          key={i}
          src={img.src}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            left: img.dx,
            top: img.dy,
            width: img.width,
            height: img.height,
            maxWidth: "none",
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}

function CellText(p: ICellRendererParams<SheetRow> & { sheet: XSheet; col: number }): JSX.Element {
  const r = p.data?.r ?? -1;
  const cell = cellAt(p.sheet, r, p.col);
  const images = p.sheet.images.filter((img) => img.row === r && img.col === p.col);
  return (
    <>
      {cell?.text ? <span className="xlsx-cell-text">{cell.text}</span> : null}
      {images.length ? <ImagesCell images={images} /> : null}
    </>
  );
}

export default function XlsxViewer({ filename, src }: FileModeViewProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [sheetIndex, setSheetIndex] = useState(0);
  const [filter, setFilter] = useState("");
  const [focus, setFocus] = useState<{ ref: string; text: string; formula?: string } | null>(null);
  const apiRef = useRef<GridApi<SheetRow> | null>(null);

  useEffect(() => {
    if (!src) return;
    const ctrl = new AbortController();
    let loaded: XWorkbook | null = null;
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(src, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`Couldn't download the workbook (HTTP ${res.status}).`);
        const size = Number(res.headers.get("content-length") ?? 0);
        if (size > MAX_BYTES) throw new Error("This workbook is too large to show here (over 50 MB).");
        const bytes = await res.arrayBuffer();
        loaded = await parseWorkbook(ExcelJS, bytes);
        if (!ctrl.signal.aborted) setState({ status: "ready", wb: loaded });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const message =
          err instanceof Error && err.message.startsWith("Couldn't") ? err.message
          : err instanceof Error && err.message.startsWith("This workbook") ? err.message
          : "This file couldn't be read as an Excel workbook.";
        setState({ status: "error", message });
      }
    })();
    return () => {
      ctrl.abort();
      if (loaded) disposeWorkbook(loaded);
    };
  }, [src]);

  const sheet = state.status === "ready" ? state.wb.sheets[sheetIndex] : undefined;

  const grid = useMemo(() => {
    if (!sheet) return null;
    const { anchors, covered } = mergeIndex(sheet);
    const key = (r: number, c: number) => `${r},${c}`;

    const rowNumberCol: ColDef<SheetRow> = {
      colId: "__row",
      headerName: "",
      valueGetter: (p) => (p.data ? p.data.r + 1 : ""),
      width: 46,
      pinned: "left",
      sortable: false,
      resizable: false,
      suppressMovable: true,
      cellStyle: { background: "#f3f3f3", color: "#666", textAlign: "center", fontSize: "12px", borderRight: "1px solid #d4d4d4", borderBottom: "1px solid #e1e1e1" },
    };

    const cols: ColDef<SheetRow>[] = [];
    for (let c = 0; c < sheet.colCount; c++) {
      cols.push({
        colId: `c${c}`,
        headerName: colName(c),
        width: sheet.colWidths[c],
        hide: sheet.colWidths[c] === 0,
        pinned: c < sheet.frozenCols ? "left" : undefined,
        sortable: false,
        resizable: true,
        suppressMovable: true,
        valueGetter: (p) => (p.data ? cellAt(sheet, p.data.r, c)?.text ?? "" : ""),
        cellRenderer: CellText,
        cellRendererParams: { sheet, col: c },
        colSpan: (p: ColSpanParams<SheetRow>) => (p.data ? anchors.get(key(p.data.r, c))?.cols ?? 1 : 1),
        rowSpan: (p: RowSpanParams<SheetRow>) => (p.data ? anchors.get(key(p.data.r, c))?.rows ?? 1 : 1),
        cellClassRules: {
          "xlsx-has-image": (p) => !!p.data && sheet.images.some((i) => i.row === p.data!.r && i.col === c),
        },
        cellStyle: (p): CellStyle => {
          if (!p.data) return {};
          const r = p.data.r;
          if (covered.has(key(r, c))) return { background: "transparent", borderRight: "none", borderBottom: "none" };
          const cell = cellAt(sheet, r, c);
          const span = anchors.get(key(r, c));
          const css: CSSProperties = {
            display: "flex",
            overflow: "hidden",
            borderRight: sheet.showGridLines ? GRID_LINE : "none",
            borderBottom: sheet.showGridLines ? GRID_LINE : "none",
            ...(span ? { background: "#ffffff", zIndex: 1 } : {}),
            alignItems: "flex-end",
            ...cell?.style,
          };
          return css as CellStyle;
        },
      });
    }

    const all: SheetRow[] = Array.from({ length: Math.max(sheet.rowCount, 1) }, (_, r) => ({ r }));
    return {
      columnDefs: [rowNumberCol, ...cols],
      pinnedTop: all.slice(0, sheet.frozenRows),
      body: all.slice(sheet.frozenRows),
    };
  }, [sheet]);

  if (state.status === "loading") {
    return <div className="p-6 text-sm text-[#a89a80] text-center">Loading workbook…</div>;
  }
  if (state.status === "error") {
    return (
      <div className="p-6 text-sm text-[#a89a80] text-center" data-testid="xlsx-error">
        {state.message}
      </div>
    );
  }

  const { wb } = state;
  const missing = [
    wb.charts ? `${wb.charts} ${wb.charts === 1 ? "chart" : "charts"}` : "",
    wb.pivotTables ? `${wb.pivotTables} ${wb.pivotTables === 1 ? "pivot table" : "pivot tables"}` : "",
  ].filter(Boolean);

  if (!sheet || !grid) {
    return <div className="p-6 text-sm text-[#a89a80] text-center">This workbook has no visible sheets.</div>;
  }

  return (
    <div className="flex flex-col gap-2 h-full min-h-[480px]" data-testid="xlsx-viewer">
      {missing.length ? (
        <div className="flex items-center gap-2 text-[12px] text-[#e8d9b0] bg-[rgba(200,160,60,0.12)] border border-[rgba(200,160,60,0.3)] rounded-md px-2.5 py-1.5">
          <AlertTriangle size={13} aria-hidden className="shrink-0" />
          This workbook has {missing.join(" and ")} that can&apos;t be shown here. Download the file to
          see {wb.charts + wb.pivotTables === 1 ? "it" : "them"}.
        </div>
      ) : null}
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="flex-1 min-w-0 flex items-center gap-2 text-[12px] font-mono bg-black/20 border border-white/10 rounded-md px-2 py-1 text-[#e8e4d8]"
          data-testid="xlsx-formula-bar"
        >
          <span className="shrink-0 w-14 text-[#a89a80]">{focus?.ref ?? ""}</span>
          <span className="truncate" title={focus?.formula ? `=${focus.formula}` : focus?.text}>
            {focus?.formula ? `=${focus.formula}` : focus?.text ?? ""}
          </span>
        </div>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter rows…"
          aria-label="Filter rows"
          className="w-[180px] text-[12px] px-2 py-1 rounded-md outline-none bg-black/20 border border-white/10 text-[#fbf5e8] placeholder:text-[#a89a80]"
        />
      </div>
      <div className="flex-1 min-h-[360px] xlsx-grid">
        <AgGridReact<SheetRow>
          key={sheetIndex}
          modules={MODULES}
          theme={SHEET_THEME}
          rowData={grid.body}
          pinnedTopRowData={grid.pinnedTop}
          columnDefs={grid.columnDefs}
          getRowId={(p) => String(p.data.r)}
          getRowHeight={(p) => Math.max(sheet.rowHeights[p.data?.r ?? 0] ?? 20, 1) || 20}
          headerHeight={22}
          quickFilterText={filter}
          suppressRowTransform
          enableCellTextSelection
          ensureDomOrder
          suppressMovableColumns
          onGridReady={(e) => {
            apiRef.current = e.api;
          }}
          onCellFocused={(e: CellFocusedEvent<SheetRow>) => {
            const column = e.column && typeof e.column === "object" ? e.column.getColId() : null;
            if (!column || column === "__row" || e.rowIndex == null) return setFocus(null);
            const node =
              e.rowPinned === "top"
                ? apiRef.current?.getPinnedTopRow(e.rowIndex)
                : apiRef.current?.getDisplayedRowAtIndex(e.rowIndex);
            const r = node?.data?.r;
            if (r == null) return setFocus(null);
            const c = Number(column.slice(1));
            const cell = cellAt(sheet, r, c);
            setFocus({ ref: `${colName(c)}${r + 1}`, text: cell?.text ?? "", formula: cell?.formula });
          }}
        />
      </div>
      {wb.sheets.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto shrink-0" role="tablist" aria-label="Sheets" data-testid="xlsx-sheet-tabs">
          {wb.sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              aria-selected={i === sheetIndex}
              onClick={() => {
                setSheetIndex(i);
                setFocus(null);
              }}
              className={cn(
                "shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] cursor-pointer border",
                i === sheetIndex
                  ? "bg-[#217346]/40 border-[#2f8a57] text-[#f4f1e8]"
                  : "bg-black/20 border-white/10 text-[#cfc8b8] hover:bg-white/[0.06]",
              )}
            >
              <Sheet size={12} aria-hidden />
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <style>{`
        .xlsx-grid .ag-cell { line-height: 1.2; padding-top: 1px; padding-bottom: 1px; }
        .xlsx-grid .ag-cell.xlsx-has-image { overflow: visible !important; z-index: 3; }
        .xlsx-grid .ag-row:has(.xlsx-has-image) { z-index: 3; overflow: visible; }
        .xlsx-grid .xlsx-cell-text { overflow: hidden; text-overflow: clip; }
      `}</style>
      <span className="sr-only">{filename}</span>
    </div>
  );
}
