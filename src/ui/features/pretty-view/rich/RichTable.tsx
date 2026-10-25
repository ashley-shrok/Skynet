import React, { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy, Download } from "lucide-react";
import { SPEAK_SKIP_ATTR } from "../speakable-text";
import { tableSpeech } from "./rich-speech";

// Every ordinary table in an agent reply, made workable (shape-wealthy-text):
// click a heading to sort (low→high, high→low, back to the agent's order),
// long tables fold after FOLD_ROWS, and copy / download take it out as a
// spreadsheet. Copy and download follow the sort on screen and always carry
// every row. Nothing is remembered: a reload shows the agent's order.

export const FOLD_ROWS = 10;

type HastLike = { type?: string; tagName?: string; value?: string; children?: HastLike[] };
type Dir = "asc" | "desc";

function hastText(n: HastLike | undefined): string {
  if (!n) return "";
  if (n.type === "text") return n.value ?? "";
  if (n.tagName === "br") return " ";
  return (n.children ?? []).map(hastText).join("");
}
const elements = (n: HastLike | undefined, tag?: string) =>
  (n?.children ?? []).filter((c) => c.type === "element" && (!tag || c.tagName === tag));

/** Cell text as a number when it reads as one ("1,204", "$5.50", "12%", "3.2 GB"). */
export function cellNumber(text: string): number | null {
  const m = text.trim().match(/^\(?\s*([-+−]?)\s*[$€£¥]?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(?:%|[a-zA-Zµ]{1,4})?\s*\)?$/);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return m[1] === "-" || m[1] === "−" || /^\(.*\)$/.test(text.trim()) ? -n : n;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Row order for a sort: indices into `rows`. Empty cells always go last. */
export function sortOrder(rows: string[][], col: number, dir: Dir): number[] {
  const cells = rows.map((r) => (r[col] ?? "").trim());
  const filled = cells.filter(Boolean);
  const numeric = filled.length > 0 && filled.every((c) => cellNumber(c) !== null);
  const idx = rows.map((_, i) => i);
  const sign = dir === "asc" ? 1 : -1;
  return idx.sort((a, b) => {
    const x = cells[a];
    const y = cells[b];
    if (!x || !y) return !x && !y ? a - b : !x ? 1 : -1;
    const c = numeric ? cellNumber(x)! - cellNumber(y)! : collator.compare(x, y);
    return c !== 0 ? sign * c : a - b;
  });
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function toTsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((r) => r.map((c) => oneLine(c).replace(/\t/g, " ")).join("\t")).join("\n");
}
export function toCsv(headers: string[], rows: string[][]): string {
  const cell = (c: string) => {
    const v = oneLine(c);
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}
function toHtml(headers: string[], rows: string[][]): string {
  const tr = (cells: string[], tag: string) => `<tr>${cells.map((c) => `<${tag}>${escapeHtml(oneLine(c))}</${tag}>`).join("")}</tr>`;
  return `<table><thead>${tr(headers, "th")}</thead><tbody>${rows.map((r) => tr(r, "td")).join("")}</tbody></table>`;
}
export function tableFilename(headers: string[]): string {
  const slug = (headers[0] ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${slug || "table"}.csv`;
}

export function RichTable({ node, children, ...props }: { node?: unknown; children?: React.ReactNode } & React.TableHTMLAttributes<HTMLTableElement>) {
  const hast = node as HastLike | undefined;
  const { headers, rows } = useMemo(() => {
    const head = elements(hast, "thead")[0];
    const body = elements(hast, "tbody")[0];
    return {
      headers: elements(elements(head, "tr")[0], "th").map(hastText),
      rows: elements(body, "tr").map((tr) => elements(tr).map(hastText)),
    };
  }, [hast]);

  const [sort, setSort] = useState<{ col: number; dir: Dir } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const kids = React.Children.toArray(children).filter(React.isValidElement) as React.ReactElement<{ children?: React.ReactNode }>[];
  const thead = kids.find((k) => k.type === "thead");
  const tbody = kids.find((k) => k.type === "tbody");
  const rowEls = tbody ? (React.Children.toArray(tbody.props.children).filter(React.isValidElement) as React.ReactElement[]) : [];
  // Sorting reorders the drawn rows by the text read from the same rows; if
  // the two ever disagree, the table stays as written rather than mis-sort.
  const sortable = !!thead && rowEls.length === rows.length && headers.length > 0;

  const order = useMemo(() => (sort && sortable ? sortOrder(rows, sort.col, sort.dir) : rows.map((_, i) => i)), [sort, sortable, rows]);
  const folded = !expanded && rows.length > FOLD_ROWS;
  const shown = folded ? order.slice(0, FOLD_ROWS) : order;
  const orderedRows = order.map((i) => rows[i]);

  const onSort = (col: number) =>
    setSort((s) => (!s || s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null));

  const headEl = thead && sortable ? cloneHead(thead, sort, onSort) : thead;
  const bodyEl = tbody ? React.cloneElement(tbody, {}, shown.map((i) => rowEls[i] ?? null)) : null;

  const onCopy = async () => {
    const tsv = toTsv(headers, orderedRows);
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([tsv], { type: "text/plain" }),
            "text/html": new Blob([toHtml(headers, orderedRows)], { type: "text/html" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(tsv);
      }
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn(`[rich-table] copy failed rows=${rows.length} error=${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const onDownload = () => {
    const blob = new Blob(["﻿", toCsv(headers, orderedRows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = tableFilename(headers);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="pv-rich-table" data-testid="rich-table" data-sortable={sortable || undefined}>
      <div {...{ [SPEAK_SKIP_ATTR]: "" }}>
        <table {...props}>
          {headEl}
          {bodyEl}
        </table>
      </div>
      <div className="pv-rich-table-bar" {...{ [SPEAK_SKIP_ATTR]: "" }}>
        {rows.length > FOLD_ROWS && (
          <button type="button" className="pv-rich-tool" data-testid="rich-table-fold" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show fewer" : `Show all ${rows.length} rows`}
          </button>
        )}
        <span className="pv-rich-table-tools">
          <button type="button" className="pv-rich-tool" data-testid="rich-table-copy" onClick={() => void onCopy()} title="Copy for a spreadsheet" aria-label="Copy table">
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </button>
          <button type="button" className="pv-rich-tool" data-testid="rich-table-download" onClick={onDownload} title="Download as a spreadsheet file" aria-label="Download table">
            <Download aria-hidden="true" />
          </button>
        </span>
      </div>
      <span className="sr-only">{tableSpeech(headers, rows.length)}</span>
    </div>
  );
}

function cloneHead(
  thead: React.ReactElement<{ children?: React.ReactNode }>,
  sort: { col: number; dir: Dir } | null,
  onSort: (col: number) => void,
): React.ReactElement {
  const trs = React.Children.toArray(thead.props.children).filter(React.isValidElement) as React.ReactElement<{ children?: React.ReactNode }>[];
  const [tr, ...restRows] = trs;
  if (!tr) return thead;
  const ths = React.Children.toArray(tr.props.children).filter(React.isValidElement) as React.ReactElement<{ children?: React.ReactNode; className?: string }>[];
  const cells = ths.map((th, col) => {
    const active = sort?.col === col ? sort.dir : null;
    const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowUpDown;
    return React.cloneElement(
      th as React.ReactElement<Record<string, unknown>>,
      {
        key: th.key ?? col,
        className: [th.props.className, "pv-rich-th"].filter(Boolean).join(" "),
        "data-sorted": active ?? undefined,
        "aria-sort": active === "asc" ? "ascending" : active === "desc" ? "descending" : "none",
        tabIndex: 0,
        onClick: () => onSort(col),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSort(col);
          }
        },
      },
      th.props.children,
      <span key="sort" className="pv-rich-sort" aria-hidden="true">
        <Icon />
      </span>,
    );
  });
  return React.cloneElement(thead, {}, [React.cloneElement(tr, { key: tr.key ?? "h" }, cells), ...restRows]);
}
