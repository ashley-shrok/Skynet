import { useEffect, useState } from "react";
import { Shapes } from "lucide-react";
import { fetchTextPrefix, useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";

/**
 * Chat-chip preview for draw.io files: page count and page names, read with
 * DOMParser (inert; the diagram itself only renders in the sandboxed viewer).
 */

const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

export function drawioPages(xml: string): string[] | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (root.nodeName === "mxGraphModel") return ["Page-1"];
  if (root.nodeName !== "mxfile") return null;
  return Array.from(root.getElementsByTagName("diagram"), (d, i) => d.getAttribute("name") || `Page-${i + 1}`);
}

export function DrawioChipPreview({ url, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [pages, setPages] = useState<string[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const { text, partial } = await fetchTextPrefix(url, PREVIEW_MAX_BYTES, ctrl.signal);
        if (partial) throw new Error("too large");
        const found = drawioPages(text);
        if (!found) throw new Error("not draw.io");
        if (!ctrl.signal.aborted) setPages(found);
      } catch {
        if (!ctrl.signal.aborted) onError();
      }
    })();
    return () => ctrl.abort();
    // onError is a fresh closure each render; the work only depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url]);

  return (
    <div ref={setEl} className="min-h-[52px]" data-testid="drawio-chip-preview">
      {pages ? (
        <div className="px-2.5 py-2 text-[11.5px] leading-[1.45] text-[#cfc8b8]">
          <div className="mb-1 flex items-center gap-1.5 text-[#e8e4d8]">
            <Shapes size={12} aria-hidden /> draw.io · {pages.length} page{pages.length === 1 ? "" : "s"}
          </div>
          <ul>
            {pages.slice(0, 5).map((p, i) => (
              <li key={i} className="truncate">{p}</li>
            ))}
          </ul>
          {pages.length > 5 ? <div className="text-[#7d725f]">+{pages.length - 5} more</div> : null}
        </div>
      ) : (
        <div className="px-2.5 py-2 text-[11.5px] text-[#a89a80]">Reading diagram…</div>
      )}
    </div>
  );
}
