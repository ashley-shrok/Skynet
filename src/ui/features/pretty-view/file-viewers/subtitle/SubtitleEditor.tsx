import { useCallback, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  CellStyleModule,
  ClientSideRowModelModule,
  LargeTextEditorModule,
  RowAutoHeightModule,
  RowApiModule,
  RowSelectionModule,
  ScrollApiModule,
  TextEditorModule,
  TooltipModule,
  type ColDef,
  type GridApi,
  type ValueSetterParams,
} from "ag-grid-community";
import { AlertTriangle, Download, MoveHorizontal, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileModeViewProps } from "../registry";
import { DARK_GRID_THEME } from "../data/grid-theme";
import {
  canAddCue,
  convertSubtitles,
  cueProblems,
  cuesOf,
  deleteCues,
  formatTime,
  insertCue,
  parseSubtitles,
  parseTime,
  serializeSubtitles,
  shiftCues,
  updateCue,
  type Cue,
  type SubtitleDoc,
} from "./subtitle-model";

/**
 * Subtitle editor (.srt, .vtt, .ass/.ssa): one row per line with start, end,
 * duration and text, edited in place. Add / delete lines, shift timings,
 * spot problems (overlaps, reversed times, lines too fast to read), export
 * to another format. Edits re-render only the changed cues (see
 * subtitle-model.ts), and the text goes to FileView as the draft, shared
 * with the Source tab.
 */

const MODULES = [
  ClientSideRowModelModule,
  TextEditorModule,
  LargeTextEditorModule,
  RowApiModule,
  RowSelectionModule,
  ScrollApiModule,
  RowAutoHeightModule,
  CellStyleModule,
  TooltipModule,
];

const TOOL_BTN = cn(
  "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] cursor-pointer",
  "bg-black/20 border border-white/10 text-[#e8e4d8] hover:bg-white/[0.06]",
  "disabled:opacity-40 disabled:cursor-not-allowed",
);

interface Row extends Cue {
  n: number;
  problems: string[];
}

const showTime = (ms: number) => formatTime(ms, "vtt");

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function readDoc(filename: string, content: string): { doc: SubtitleDoc | null; error: string | null } {
  try {
    return { doc: parseSubtitles(filename, content), error: null };
  } catch (err) {
    return { doc: null, error: err instanceof Error ? err.message : "This subtitle file couldn't be read." };
  }
}

export default function SubtitleEditor({ filename, content, onChange, disabled }: FileModeViewProps): JSX.Element {
  // The text the current doc was parsed from or written to; different
  // `content` means it changed elsewhere (Source tab, reload) → re-parse.
  const [source, setSource] = useState(content);
  const [state, setState] = useState(() => readDoc(filename, content));
  const [history, setHistory] = useState<{ past: SubtitleDoc[]; future: SubtitleDoc[] }>({ past: [], future: [] });
  if (content !== source) {
    setSource(content);
    setState(readDoc(filename, content));
    setHistory({ past: [], future: [] });
  }
  const doc = state.doc;

  const [search, setSearch] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftBy, setShiftBy] = useState("+1.0");
  const [shiftScope, setShiftScope] = useState<"all" | "selected">("all");
  const [selectedCount, setSelectedCount] = useState(0);
  const apiRef = useRef<GridApi<Row> | null>(null);

  const commit = useCallback(
    (next: SubtitleDoc, opts: { undoable?: boolean } = {}) => {
      if (doc && opts.undoable !== false) setHistory((h) => ({ past: [...h.past.slice(-99), doc], future: [] }));
      const text = serializeSubtitles(next);
      setState({ doc: next, error: null });
      setSource(text);
      onChange(text);
    },
    [doc, onChange],
  );

  const restore = (from: "past" | "future") => {
    if (!doc) return;
    const stack = history[from];
    const target = stack[stack.length - 1];
    if (!target) return;
    setHistory(
      from === "past"
        ? { past: stack.slice(0, -1), future: [...history.future, doc] }
        : { past: [...history.past, doc], future: stack.slice(0, -1) },
    );
    commit(target, { undoable: false });
  };

  const cues = useMemo(() => (doc ? cuesOf(doc) : []), [doc]);
  const problems = useMemo(() => (doc ? cueProblems(cues, doc.format) : new Map<number, string[]>()), [cues, doc]);
  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase();
    return cues
      .map((c, i) => ({ ...c, n: i + 1, problems: problems.get(c.key) ?? [] }))
      .filter((r) => (!onlyProblems || r.problems.length) && (!q || r.text.toLowerCase().includes(q)));
  }, [cues, problems, search, onlyProblems]);

  const setTime = useCallback(
    (field: "start" | "end") => (p: ValueSetterParams<Row>) => {
      if (!doc || !p.data) return false;
      const ms = parseTime(String(p.newValue ?? ""));
      if (ms === null || ms === p.data[field]) return false;
      commit(updateCue(doc, p.data.key, { [field]: ms }));
      return true;
    },
    [doc, commit],
  );

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { field: "n", headerName: "#", width: 70, editable: false, cellClass: "sub-num" },
      {
        colId: "start",
        headerName: "Start",
        width: 130,
        editable: !disabled,
        valueGetter: (p) => (p.data ? showTime(p.data.start) : ""),
        valueSetter: setTime("start"),
        cellClass: "sub-time",
      },
      {
        colId: "end",
        headerName: "End",
        width: 130,
        editable: !disabled,
        valueGetter: (p) => (p.data ? showTime(p.data.end) : ""),
        valueSetter: setTime("end"),
        cellClass: "sub-time",
      },
      {
        colId: "duration",
        headerName: "Length",
        width: 84,
        editable: false,
        valueGetter: (p) => (p.data ? `${((p.data.end - p.data.start) / 1000).toFixed(1)} s` : ""),
        cellClass: "sub-time",
      },
      {
        colId: "text",
        headerName: "Text",
        flex: 1,
        minWidth: 240,
        editable: !disabled,
        wrapText: true,
        autoHeight: true,
        cellEditor: "agLargeTextCellEditor",
        cellEditorPopup: true,
        cellEditorParams: { maxLength: 5000, rows: 5, cols: 60 },
        valueGetter: (p) => p.data?.text ?? "",
        valueSetter: (p) => {
          if (!doc || !p.data || p.newValue === p.data.text) return false;
          commit(updateCue(doc, p.data.key, { text: String(p.newValue ?? "") }));
          return true;
        },
        cellClass: "sub-text",
      },
      {
        colId: "problems",
        headerName: "",
        width: 44,
        editable: false,
        valueGetter: (p) => (p.data?.problems.length ? "!" : ""),
        tooltipValueGetter: (p) => (p.data?.problems.length ? p.data.problems.join("\n") : undefined),
        cellRenderer: (p: { data?: Row }) =>
          p.data?.problems.length ? (
            <span className="text-[#e8a27a]" aria-label={p.data.problems.join(". ")} data-testid="sub-problem">
              <AlertTriangle size={14} className="mt-[7px]" />
            </span>
          ) : null,
      },
    ],
    [disabled, doc, commit, setTime],
  );

  if (!doc) {
    return (
      <div className="p-8 text-center text-sm text-[#cfc8b8]" data-testid="subtitle-error">
        {state.error} Open the Source tab to see or fix the file's text.
      </div>
    );
  }

  const selectedKeys = () => new Set((apiRef.current?.getSelectedRows() ?? []).map((r) => r.key));
  const focusedKey = () => {
    const cell = apiRef.current?.getFocusedCell();
    const row = cell ? apiRef.current?.getDisplayedRowAtIndex(cell.rowIndex) : null;
    return row?.data?.key ?? null;
  };

  const addLine = () => {
    const selected = [...selectedKeys()];
    const after = focusedKey() ?? selected[selected.length - 1] ?? null;
    const { doc: next, key } = insertCue(doc, after);
    commit(next);
    setSearch("");
    setOnlyProblems(false);
    // Put the cursor in the new line's text once the grid has it.
    setTimeout(() => {
      const api = apiRef.current;
      const node = api?.getRowNode(String(key));
      if (api && node?.rowIndex != null) {
        api.ensureIndexVisible(node.rowIndex);
        api.setFocusedCell(node.rowIndex, "text");
        api.startEditingCell({ rowIndex: node.rowIndex, colKey: "text" });
      }
    }, 50);
  };

  const deleteLines = () => {
    const keys = selectedKeys();
    const focused = focusedKey();
    if (!keys.size && focused !== null) keys.add(focused);
    if (!keys.size) return;
    commit(deleteCues(doc, keys));
  };

  const shiftSeconds = Number(shiftBy.replace(",", "."));
  const applyShift = () => {
    if (!Number.isFinite(shiftSeconds) || shiftSeconds === 0) return;
    commit(shiftCues(doc, shiftScope === "selected" ? selectedKeys() : null, Math.round(shiftSeconds * 1000)));
    setShiftOpen(false);
  };

  const base = filename.replace(/\.[^.]+$/, "");
  const exportTargets = (["srt", "vtt"] as const).filter((f) => f !== doc.format);
  const runtime = cues.length ? Math.max(...cues.map((c) => c.end)) : 0;

  return (
    <div className="flex h-full min-h-[420px] flex-col gap-2" data-testid="subtitle-editor">
      <style>{`.sub-num{color:#7d725f;font-variant-numeric:tabular-nums}.sub-time{font-variant-numeric:tabular-nums}.sub-text{white-space:pre-wrap;line-height:1.45;padding-top:6px;padding-bottom:6px}`}</style>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search lines…"
          aria-label="Search lines"
          className="min-w-[140px] max-w-[240px] flex-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[12px] text-[#fbf5e8] outline-none placeholder:text-[#a89a80]"
        />
        <button
          type="button"
          className={cn(TOOL_BTN, onlyProblems && "border-[#8a6a45] bg-[#3a2c1c]")}
          onClick={() => setOnlyProblems((v) => !v)}
          aria-pressed={onlyProblems}
          disabled={!problems.size && !onlyProblems}
          title="Show only lines with problems"
        >
          <AlertTriangle size={13} aria-hidden /> {problems.size} {problems.size === 1 ? "problem" : "problems"}
        </button>
        <span className="flex-1" />
        <button type="button" className={TOOL_BTN} onClick={() => restore("past")} disabled={disabled || !history.past.length} title="Undo">
          <Undo2 size={13} aria-hidden /> <span className="sr-only">Undo</span>
        </button>
        <button type="button" className={TOOL_BTN} onClick={() => restore("future")} disabled={disabled || !history.future.length} title="Redo">
          <Redo2 size={13} aria-hidden /> <span className="sr-only">Redo</span>
        </button>
        <button type="button" className={TOOL_BTN} onClick={addLine} disabled={disabled || !canAddCue(doc)} title="Add a line after the selected one">
          <Plus size={13} aria-hidden /> Line
        </button>
        <button type="button" className={TOOL_BTN} onClick={deleteLines} disabled={disabled || !cues.length} title="Delete the ticked lines (or the selected one)">
          <Trash2 size={13} aria-hidden /> {selectedCount > 1 ? `${selectedCount} lines` : "Line"}
        </button>
        <button type="button" className={cn(TOOL_BTN, shiftOpen && "bg-white/[0.08]")} onClick={() => setShiftOpen((v) => !v)} disabled={disabled || !cues.length} title="Move timings earlier or later">
          <MoveHorizontal size={13} aria-hidden /> Shift
        </button>
        {exportTargets.map((f) => (
          <button key={f} type="button" className={TOOL_BTN} onClick={() => download(`${base}.${f}`, convertSubtitles(doc, f))} disabled={!cues.length} title={`Download a copy as .${f}`}>
            <Download size={13} aria-hidden /> .{f}
          </button>
        ))}
      </div>
      {shiftOpen ? (
        <form
          className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-[12px] text-[#e8e4d8]"
          onSubmit={(e) => {
            e.preventDefault();
            applyShift();
          }}
          data-testid="subtitle-shift"
        >
          Move
          <select value={shiftScope} onChange={(e) => setShiftScope(e.target.value as "all" | "selected")} className="rounded border border-white/10 bg-[#1f1b15] px-1 py-0.5">
            <option value="all">all lines</option>
            <option value="selected" disabled={!selectedCount}>
              ticked lines ({selectedCount})
            </option>
          </select>
          by
          <input
            value={shiftBy}
            onChange={(e) => setShiftBy(e.target.value)}
            aria-label="Seconds"
            className="w-20 rounded border border-white/10 bg-[#1f1b15] px-1.5 py-0.5 text-right tabular-nums outline-none"
          />
          seconds <span className="text-[#7d725f]">(negative = earlier)</span>
          <button type="submit" className={TOOL_BTN} disabled={!Number.isFinite(shiftSeconds) || shiftSeconds === 0}>
            Apply
          </button>
        </form>
      ) : null}
      <div className="min-h-[300px] flex-1">
        <AgGridReact<Row>
          modules={MODULES}
          theme={DARK_GRID_THEME}
          rowData={rows}
          columnDefs={columnDefs}
          getRowId={(p) => String(p.data.key)}
          rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false }}
          onSelectionChanged={(e) => setSelectedCount(e.api.getSelectedRows().length)}
          onGridReady={(e) => {
            apiRef.current = e.api;
          }}
          stopEditingWhenCellsLoseFocus
          tooltipShowDelay={200}
          overlayNoRowsTemplate={cues.length ? "No lines match." : "No lines yet. Use “+ Line” to add one."}
        />
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[11.5px] text-[#a89a80]">
        <span data-testid="subtitle-count">
          {cues.length.toLocaleString()} {cues.length === 1 ? "line" : "lines"} · runs {showTime(runtime).replace(/\.\d+$/, "")}
        </span>
        <span>· {doc.format === "ass" ? "Advanced SubStation" : doc.format.toUpperCase()}</span>
      </div>
    </div>
  );
}
