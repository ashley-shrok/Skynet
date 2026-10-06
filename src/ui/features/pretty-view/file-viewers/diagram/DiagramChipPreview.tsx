import { useEffect, useState } from "react";
import { fetchTextPrefix, useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";
import { extensionOf } from "../registry-ext";

/** Chat-chip preview for Mermaid / Graphviz files: the rendered diagram. */

const PREVIEW_MAX_BYTES = 256 * 1024;

export function DiagramChipPreview({ url, filename, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const { text, partial } = await fetchTextPrefix(url, PREVIEW_MAX_BYTES, ctrl.signal);
        if (partial) throw new Error("too large to preview");
        const { renderDiagram } = await import("./diagram-render");
        const ext = extensionOf(filename);
        const { svg } = await renderDiagram(ext === "dot" || ext === "gv" ? "graphviz" : "mermaid", text);
        if (!ctrl.signal.aborted) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      } catch {
        if (!ctrl.signal.aborted) onError();
      }
    })();
    return () => ctrl.abort();
    // onError is a fresh closure each render; the work only depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url, filename]);

  return (
    <div ref={setEl} className="min-h-[52px] bg-[#f7f6f2]" data-testid="diagram-chip-preview">
      {src ? (
        <img src={src} alt="" className="mx-auto block max-h-[220px] w-full object-contain p-2" draggable={false} />
      ) : (
        <div className="bg-[#1a1712] px-2.5 py-2 text-[11.5px] text-[#a89a80]">Drawing diagram…</div>
      )}
    </div>
  );
}
