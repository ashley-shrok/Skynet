import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Check, Code2, Pencil, Plus, Trash2, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BinaryDraft, FileModeViewProps } from "../registry";
import {
  changeCellType,
  joinText,
  languageFilename,
  newCell,
  notebookLanguage,
  notebookTitle,
  parseNotebook,
  serializeNotebook,
  withSource,
  type CellType,
  type NbCell,
  type NbDoc,
} from "./nb-model";
import { NbMarkdown } from "./NbMarkdown";
import { NbOutputs } from "./NbOutputs";
import { CellEditor } from "./CellEditor";
import { useInView } from "../chip-fetch";

/**
 * Jupyter notebook viewer and editor. Markdown cells render (math, tables,
 * inline HTML) and switch to source on Edit; code cells are editable in
 * place; cells can be added, moved, deleted or retyped. Outputs are kept as
 * saved — there's no kernel to run code — and code edited since its output
 * is flagged. Saves go through the host as bytes (BinaryDraft), so large
 * notebooks aren't held to the text-save size limit.
 */

const MAX_BYTES = 50 * 1024 * 1024;

type Load = { status: "loading" } | { status: "ready" } | { status: "error"; message: string };

let nextKey = 1;
const keys = new WeakMap<NbCell, string>();
function keyOf(cell: NbCell): string {
  let k = keys.get(cell);
  if (!k) {
    k = `c${nextKey++}`;
    keys.set(cell, k);
  }
  return k;
}
/** The replacement cell keeps the original's key (stable React identity). */
function carryKey(from: NbCell, to: NbCell): NbCell {
  keys.set(to, keyOf(from));
  return to;
}

export default function NotebookView({ filename, src, onBinaryDraft }: FileModeViewProps): JSX.Element {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [doc, setDoc] = useState<NbDoc | null>(null);
  const [editingMarkdown, setEditingMarkdown] = useState<string | null>(null);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const editable = !!onBinaryDraft;
  const docRef = useRef<NbDoc | null>(null);
  docRef.current = doc;
  const reportRef = useRef(onBinaryDraft);
  reportRef.current = onBinaryDraft;
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!src) return;
    const ctrl = new AbortController();
    setLoad({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(src, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`Couldn't download the notebook (HTTP ${res.status}).`);
        if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
          throw new Error("This notebook is too large to open here (over 50 MB).");
        }
        const parsed = parseNotebook(await res.text());
        if (ctrl.signal.aborted) return;
        setDoc(parsed);
        setEdited(new Set());
        dirtyRef.current = false;
        setLoad({ status: "ready" });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setLoad({ status: "error", message: err instanceof Error ? err.message : "This notebook couldn't be opened." });
      }
    })();
    return () => {
      ctrl.abort();
      if (dirtyRef.current) reportRef.current?.(null);
    };
  }, [src]);

  const draft = useMemo<BinaryDraft>(
    () => ({
      getBytes: async () => {
        const current = docRef.current;
        if (!current) throw new Error("The notebook isn't loaded.");
        return new TextEncoder().encode(serializeNotebook(current));
      },
      markSaved: () => {
        dirtyRef.current = false;
        setEdited(new Set());
        reportRef.current?.(null);
      },
    }),
    [],
  );

  const update = useCallback(
    (fn: (cells: NbCell[]) => NbCell[]) => {
      setDoc((d) => (d ? { ...d, nb: { ...d.nb, cells: fn(d.nb.cells) } } : d));
      if (!dirtyRef.current) {
        dirtyRef.current = true;
        reportRef.current?.(draft);
      }
    },
    [draft],
  );

  const setSource = (cell: NbCell, text: string) => {
    update((cells) => cells.map((c) => (c === cell || keyOf(c) === keyOf(cell) ? carryKey(c, withSource(c, text)) : c)));
    if (cell.cell_type === "code" && (cell.outputs?.length ?? 0) > 0) {
      setEdited((s) => (s.has(keyOf(cell)) ? s : new Set(s).add(keyOf(cell))));
    }
  };

  const insertAt = (index: number, type: CellType) => {
    if (!doc) return;
    const cell = newCell(type, doc.nb);
    update((cells) => [...cells.slice(0, index), cell, ...cells.slice(index)]);
    if (type !== "code") setEditingMarkdown(keyOf(cell));
  };
  const move = (index: number, by: number) =>
    update((cells) => {
      const to = index + by;
      if (to < 0 || to >= cells.length) return cells;
      const next = [...cells];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  const remove = (index: number) => update((cells) => cells.filter((_, i) => i !== index));
  const retype = (cell: NbCell, type: CellType) =>
    update((cells) => cells.map((c) => (keyOf(c) === keyOf(cell) ? carryKey(c, changeCellType(c, type)) : c)));

  if (load.status === "loading") return <div className="p-6 text-center text-sm text-[#a89a80]">Opening notebook…</div>;
  if (load.status === "error" || !doc) {
    return (
      <div className="p-8 text-center text-sm text-[#cfc8b8]" data-testid="nb-error">
        {load.status === "error" ? load.message : "This notebook couldn't be opened."}
      </div>
    );
  }

  const { nb } = doc;
  const language = notebookLanguage(nb);
  const langFile = languageFilename(language);
  const kernel = nb.metadata.kernelspec?.display_name ?? language;

  const Inserter = ({ index }: { index: number }) =>
    editable ? (
      <div className="group/ins flex h-4 items-center justify-center gap-2 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={() => insertAt(index, "code")} className="inline-flex items-center gap-1 rounded border border-[#3a3428] bg-[#1a1712] px-2 text-[11px] text-[#cfc8b8] hover:bg-[#2a251c]">
          <Plus size={11} aria-hidden /> Code
        </button>
        <button type="button" onClick={() => insertAt(index, "markdown")} className="inline-flex items-center gap-1 rounded border border-[#3a3428] bg-[#1a1712] px-2 text-[11px] text-[#cfc8b8] hover:bg-[#2a251c]">
          <Plus size={11} aria-hidden /> Text
        </button>
      </div>
    ) : (
      <div className="h-2" />
    );

  return (
    <div className="flex h-full min-h-[360px] flex-col bg-[#15171e] text-[13px] text-[#e8e4d8]" data-testid="notebook-view">
      <style>{NB_CSS}</style>
      <div className="flex items-center gap-2 border-b border-[#2e2a22] bg-[#1a1712] px-3 py-1.5 text-[12px]">
        <BookOpen size={14} aria-hidden className="text-[#a89a80]" />
        <span className="truncate font-medium">{notebookTitle(nb) ?? filename.slice(filename.lastIndexOf("/") + 1)}</span>
        <span className="text-[#a89a80]">
          · {kernel} · {nb.cells.length} cells
        </span>
        <span className="ml-auto text-[11.5px] text-[#7d725f]">
          {editable ? "Editing — code can't be run here; outputs are as last saved" : "Read-only"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2" data-testid="nb-cells">
        <div className="mx-auto max-w-5xl">
          {nb.cells.map((cell, i) => {
            const key = keyOf(cell);
            const source = joinText(cell.source);
            const isEditingMd = editingMarkdown === key;
            return (
              <div key={key}>
                <Inserter index={i} />
                <div className="group relative flex gap-2" data-testid="nb-cell" data-cell-type={cell.cell_type}>
                  <div className="w-14 shrink-0 pt-1.5 text-right font-mono text-[11px] text-[#7d8bb3]">
                    {cell.cell_type === "code" ? `[${cell.execution_count ?? " "}]:` : ""}
                  </div>
                  <div className="min-w-0 flex-1">
                    {cell.cell_type === "code" ? (
                      <LazyEditor value={source} languageFile={langFile} editable={editable} onChange={(t) => setSource(cell, t)} />
                    ) : cell.cell_type === "raw" ? (
                      <LazyEditor value={source} languageFile="cell.txt" editable={editable} onChange={(t) => setSource(cell, t)} />
                    ) : isEditingMd ? (
                      <CellEditor value={source} languageFile="cell.md" editable autoFocus onChange={(t) => setSource(cell, t)} />
                    ) : (
                      <div
                        className={cn("rounded px-2 py-1", editable && "cursor-text hover:bg-white/[0.03]")}
                        onDoubleClick={() => editable && setEditingMarkdown(key)}
                      >
                        {source.trim() ? <NbMarkdown text={source} attachments={cell.attachments} /> : <span className="text-[#7d725f]">Empty text cell — double-click to write</span>}
                      </div>
                    )}
                    {cell.cell_type === "code" && cell.outputs?.length ? (
                      <div className="mt-1.5 pl-1">
                        {edited.has(key) ? (
                          <div className="mb-1 text-[11px] text-[#d9b98a]" data-testid="nb-stale">
                            Code edited since this output ran
                          </div>
                        ) : null}
                        <NbOutputs outputs={cell.outputs} />
                      </div>
                    ) : null}
                  </div>
                  {editable ? (
                    <div className="absolute -top-1 right-0 hidden items-center gap-0.5 rounded border border-[#3a3428] bg-[#1a1712] p-0.5 group-hover:flex group-focus-within:flex">
                      {cell.cell_type === "markdown" ? (
                        <IconButton label={isEditingMd ? "Done editing" : "Edit text"} onClick={() => setEditingMarkdown(isEditingMd ? null : key)}>
                          {isEditingMd ? <Check size={13} /> : <Pencil size={13} />}
                        </IconButton>
                      ) : null}
                      <IconButton label={cell.cell_type === "code" ? "Make text cell" : "Make code cell"} onClick={() => retype(cell, cell.cell_type === "code" ? "markdown" : "code")}>
                        {cell.cell_type === "code" ? <Type size={13} /> : <Code2 size={13} />}
                      </IconButton>
                      <IconButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp size={13} />
                      </IconButton>
                      <IconButton label="Move down" disabled={i === nb.cells.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown size={13} />
                      </IconButton>
                      <IconButton label="Delete cell" onClick={() => remove(i)}>
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
          <Inserter index={nb.cells.length} />
          {editable ? (
            <div className="flex justify-center gap-2 py-3">
              <button type="button" onClick={() => insertAt(nb.cells.length, "code")} className="inline-flex items-center gap-1 rounded border border-[#3a3428] px-3 py-1 text-[12px] hover:bg-[#2a251c]" data-testid="nb-add-code">
                <Plus size={12} aria-hidden /> Code cell
              </button>
              <button type="button" onClick={() => insertAt(nb.cells.length, "markdown")} className="inline-flex items-center gap-1 rounded border border-[#3a3428] px-3 py-1 text-[12px] hover:bg-[#2a251c]">
                <Plus size={12} aria-hidden /> Text cell
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className="rounded p-1 text-[#cfc8b8] hover:bg-[#2a251c] disabled:opacity-30">
      {children}
    </button>
  );
}

/** Mount CodeMirror only once a cell scrolls near view; long notebooks stay light. */
function LazyEditor(props: { value: string; languageFile: string; editable: boolean; onChange: (t: string) => void }): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);
  return (
    <div ref={setEl}>
      {mounted ? (
        <CellEditor {...props} />
      ) : (
        <pre className="nb-pre rounded bg-[#1d1f27] py-1 pl-8">{props.value}</pre>
      )}
    </div>
  );
}

const NB_CSS = `
.nb-pre{margin:0;padding:6px 8px;white-space:pre-wrap;word-break:break-word;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8e4d8;border-radius:4px;max-height:none}
.nb-markdown{line-height:1.55;color:#e8e4d8}
.nb-markdown h1{font-size:1.6em;font-weight:700;margin:.4em 0 .3em}
.nb-markdown h2{font-size:1.35em;font-weight:700;margin:.4em 0 .3em}
.nb-markdown h3{font-size:1.15em;font-weight:600;margin:.4em 0 .25em}
.nb-markdown p{margin:.35em 0}
.nb-markdown ul{list-style:disc;padding-left:1.5em;margin:.3em 0}
.nb-markdown ol{list-style:decimal;padding-left:1.5em;margin:.3em 0}
.nb-markdown a{color:#9fb4e8;text-decoration:underline}
.nb-markdown code{font-family:ui-monospace,monospace;background:#262a35;padding:0 .3em;border-radius:3px;font-size:.92em}
.nb-markdown pre{background:#1d1f27;padding:8px;border-radius:4px;overflow:auto}
.nb-markdown pre code{background:none;padding:0}
.nb-markdown table{border-collapse:collapse;margin:.4em 0}
.nb-markdown th,.nb-markdown td{border:1px solid #3a3d48;padding:3px 8px}
.nb-markdown blockquote{border-left:3px solid #3a3d48;padding-left:.8em;color:#bdb6a6}
.nb-markdown img{max-width:100%}
.nb-markdown hr{border-color:#3a3d48;margin:.8em 0}
.nb-markdown .katex-display{overflow-x:auto;overflow-y:hidden}
`;
