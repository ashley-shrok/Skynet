import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";
import { firstImageOutput, joinText, notebookLanguage, notebookTitle, parseNotebook } from "./nb-model";

/**
 * Chat-chip preview for notebooks: title, cell count and language, plus the
 * first plot (or the opening text when there's none). Notebooks over
 * PREVIEW_MAX_BYTES fall back to the plain chip.
 */

const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

interface Summary {
  title: string | null;
  meta: string;
  image: string | null;
  snippet: string;
}

export function NotebookChipPreview({ url, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(url, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (Number(res.headers.get("content-length") ?? 0) > PREVIEW_MAX_BYTES) throw new Error("too large");
        const { nb } = parseNotebook(await res.text());
        const code = nb.cells.filter((c) => c.cell_type === "code").length;
        const firstText = nb.cells.find((c) => joinText(c.source).trim());
        if (!ctrl.signal.aborted) {
          setSummary({
            title: notebookTitle(nb),
            meta: `${nb.cells.length} cells (${code} code) · ${notebookLanguage(nb)}`,
            image: firstImageOutput(nb),
            snippet: firstText ? joinText(firstText.source).split("\n").slice(0, 4).join("\n") : "",
          });
        }
      } catch {
        if (!ctrl.signal.aborted) onError();
      }
    })();
    return () => ctrl.abort();
    // onError is a fresh closure each render; the fetch only depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url]);

  return (
    <div ref={setEl} className="min-h-[52px]" data-testid="notebook-chip-preview">
      {summary ? (
        <div className="text-[11.5px] leading-[1.45]">
          <div className="flex items-center gap-1.5 px-2.5 pt-2 text-[#e8e4d8]">
            <BookOpen size={12} aria-hidden />
            <span className="truncate font-medium">{summary.title ?? "Notebook"}</span>
          </div>
          <div className="px-2.5 pb-1.5 text-[#7d725f]">{summary.meta}</div>
          {summary.image ? (
            <img src={summary.image} alt="" className="block max-h-[180px] w-full bg-white object-contain" draggable={false} />
          ) : summary.snippet ? (
            <pre className="mx-2.5 mb-2 max-h-[90px] overflow-hidden whitespace-pre-wrap rounded bg-[#1d1f27] p-1.5 font-mono text-[11px] text-[#cfc8b8]">
              {summary.snippet}
            </pre>
          ) : null}
        </div>
      ) : (
        <div className="px-2.5 py-2 text-[11.5px] text-[#a89a80]">Reading notebook…</div>
      )}
    </div>
  );
}
