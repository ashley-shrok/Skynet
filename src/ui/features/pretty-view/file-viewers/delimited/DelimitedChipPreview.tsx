import { useEffect, useState } from "react";
import { fetchTextPrefix, useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";
import { parseDelimited } from "./delimited-format";

/**
 * Inline chat-chip preview for CSV / TSV / PSV: the header row plus the
 * first few rows as a small table, and the size ("120 rows × 4 columns").
 * Fetches once in view and reads at most PREVIEW_MAX_BYTES; a cut-off read
 * reports "at least" the rows it saw.
 */

const PREVIEW_MAX_BYTES = 64 * 1024;
const PREVIEW_ROWS = 4;
const PREVIEW_COLS = 5;

interface Summary {
  header: string[];
  rows: string[][];
  rowCount: number;
  colCount: number;
  partial: boolean;
}

export function DelimitedChipPreview({ url, filename, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const { text, partial } = await fetchTextPrefix(url, PREVIEW_MAX_BYTES, ctrl.signal);
        const { rows } = parseDelimited(text, filename);
        if (rows.length === 0) throw new Error("empty");
        if (!ctrl.signal.aborted) {
          setSummary({
            header: rows[0],
            rows: rows.slice(1, 1 + PREVIEW_ROWS),
            rowCount: rows.length - 1,
            colCount: Math.max(...rows.map((r) => r.length)),
            partial,
          });
        }
      } catch {
        if (!ctrl.signal.aborted) onError();
      }
    })();
    return () => ctrl.abort();
    // onError is a fresh closure each render; the fetch only depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url, filename]);

  const cols = summary ? Math.min(summary.colCount, PREVIEW_COLS) : 0;
  const cell = "px-1.5 py-0.5 max-w-[120px] truncate border-b border-white/[0.06]";

  return (
    <div ref={setEl} className="min-h-[52px] px-2.5 py-2 text-[11.5px]" data-testid="delimited-chip-preview">
      {summary ? (
        <>
          <table className="w-full table-fixed border-collapse text-left">
            <thead>
              <tr className="text-[#e8e4d8] font-semibold">
                {Array.from({ length: cols }, (_, i) => (
                  <th key={i} className={cell}>
                    {summary.header[i] ?? ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-[#cfc8b8]">
              {summary.rows.map((r, ri) => (
                <tr key={ri}>
                  {Array.from({ length: cols }, (_, i) => (
                    <td key={i} className={cell}>
                      {r[i] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-1 text-[#a89a80]">
            {summary.rowCount.toLocaleString()}
            {summary.partial ? "+" : ""} {summary.rowCount === 1 && !summary.partial ? "row" : "rows"} ×{" "}
            {summary.colCount} {summary.colCount === 1 ? "column" : "columns"}
          </div>
        </>
      ) : (
        <div className="text-[#a89a80]">Loading table…</div>
      )}
    </div>
  );
}
