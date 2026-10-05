import { useEffect, useState } from "react";
import { Sheet } from "lucide-react";
import { useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";

/**
 * Inline chat-chip preview for Excel workbooks: the first sheet's name and
 * first rows as a small table, plus the sheet count. An .xlsx has to be
 * read whole, so workbooks over PREVIEW_MAX_BYTES fall back to the plain
 * chip. ExcelJS loads on demand (shared with the viewer's chunk).
 */

const PREVIEW_MAX_BYTES = 4 * 1024 * 1024;
const PREVIEW_ROWS = 5; // header + 4
const PREVIEW_COLS = 5;

interface Summary {
  sheetName: string;
  sheets: number;
  rows: string[][];
}

async function fetchCapped(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { credentials: "same-origin", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > PREVIEW_MAX_BYTES) throw new Error("too large");
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > PREVIEW_MAX_BYTES) throw new Error("too large");
  return bytes;
}

export function XlsxChipPreview({ url, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const [bytes, { default: ExcelJS }, { parseWorkbook, disposeWorkbook }] = await Promise.all([
          fetchCapped(url, ctrl.signal),
          import("exceljs"),
          import("./xlsx-model"),
        ]);
        const wb = await parseWorkbook(ExcelJS, bytes, { maxRows: PREVIEW_ROWS, skipImages: true });
        disposeWorkbook(wb);
        const first = wb.sheets[0];
        if (!first) throw new Error("no sheets");
        // Used columns only (the model pads a couple of empty ones, as Excel does).
        const used = Math.max(
          1,
          ...first.rows.slice(0, PREVIEW_ROWS).map((row) => {
            let last = 0;
            row?.forEach((cell, c) => {
              if (cell?.text) last = c + 1;
            });
            return last;
          }),
        );
        const rows = Array.from({ length: Math.min(first.rowCount, PREVIEW_ROWS) }, (_, r) =>
          Array.from({ length: Math.min(used, PREVIEW_COLS) }, (_, c) => first.rows[r]?.[c]?.text ?? ""),
        );
        if (!ctrl.signal.aborted) setSummary({ sheetName: first.name, sheets: wb.sheets.length, rows });
      } catch {
        if (!ctrl.signal.aborted) onError();
      }
    })();
    return () => ctrl.abort();
    // onError is a fresh closure each render; the fetch only depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url]);

  const cell = "px-1.5 py-0.5 max-w-[120px] truncate border-b border-r border-black/10";
  return (
    <div ref={setEl} className="min-h-[52px] text-[11.5px]" data-testid="xlsx-chip-preview">
      {summary ? (
        <>
          <table className="w-full table-fixed border-collapse text-left bg-white text-[#1f1f1f]">
            <tbody>
              {summary.rows.map((r, ri) => (
                <tr key={ri} className={ri === 0 ? "font-semibold bg-[#f3f3f3]" : undefined}>
                  {r.map((v, ci) => (
                    <td key={ci} className={cell}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-2.5 py-1 flex items-center gap-1 text-[#a89a80]">
            <Sheet size={12} aria-hidden />
            <span className="truncate">{summary.sheetName}</span>
            {summary.sheets > 1 ? <span className="shrink-0">· {summary.sheets} sheets</span> : null}
          </div>
        </>
      ) : (
        <div className="px-2.5 py-2 text-[#a89a80]">Loading workbook…</div>
      )}
    </div>
  );
}
