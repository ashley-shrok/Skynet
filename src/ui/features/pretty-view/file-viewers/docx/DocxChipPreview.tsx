import { useEffect, useState } from "react";
import { useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";
import { summarizeDocx, type DocxSummary } from "./docx-summary";

/**
 * Inline chat-chip preview for Word documents: the title (document
 * properties, else the first heading) and the opening paragraphs, read
 * straight from the .docx's XML (no editor needed). Documents over
 * PREVIEW_MAX_BYTES fall back to the plain chip.
 */

const PREVIEW_MAX_BYTES = 4 * 1024 * 1024;

export function DocxChipPreview({ url, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [summary, setSummary] = useState<DocxSummary | null>(null);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(url, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (Number(res.headers.get("content-length") ?? 0) > PREVIEW_MAX_BYTES) throw new Error("too large");
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength > PREVIEW_MAX_BYTES) throw new Error("too large");
        const s = await summarizeDocx(bytes);
        if (!s.title && s.paragraphs.length === 0) throw new Error("empty");
        if (!ctrl.signal.aborted) setSummary(s);
      } catch {
        if (!ctrl.signal.aborted) onError();
      }
    })();
    return () => ctrl.abort();
    // onError is a fresh closure each render; the fetch only depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url]);

  return (
    <div ref={setEl} className="min-h-[52px]" data-testid="docx-chip-preview">
      {summary ? (
        <div className="bg-white text-[#1f1f1f] px-3 py-2.5 text-[11.5px] leading-[1.45] max-h-[200px] overflow-hidden">
          {summary.title ? <div className="font-semibold text-[13px] mb-1 truncate">{summary.title}</div> : null}
          {summary.paragraphs.map((p, i) => (
            <p key={i} className="line-clamp-2 mb-1">
              {p}
            </p>
          ))}
        </div>
      ) : (
        <div className="px-2.5 py-2 text-[11.5px] text-[#a89a80]">Loading document…</div>
      )}
    </div>
  );
}
