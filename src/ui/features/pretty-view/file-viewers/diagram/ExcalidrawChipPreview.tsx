import { useEffect, useState } from "react";
import { useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";
import { pointExcalidrawAtOwnAssets } from "./excalidraw-assets";

/** Chat-chip preview for Excalidraw drawings: the drawing as an image. */

const PREVIEW_MAX_BYTES = 10 * 1024 * 1024;

export function ExcalidrawChipPreview({ url, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(url, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (blob.size > PREVIEW_MAX_BYTES) throw new Error("too large");
        pointExcalidrawAtOwnAssets();
        const { exportToSvg, loadFromBlob } = await import("@excalidraw/excalidraw");
        const scene = await loadFromBlob(new Blob([blob], { type: "application/json" }), null, null);
        const visibleElements = scene.elements.filter((e) => !e.isDeleted);
        if (!visibleElements.length) throw new Error("empty");
        const svg = await exportToSvg({
          elements: visibleElements,
          appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: false },
          files: scene.files,
        });
        if (!ctrl.signal.aborted) {
          setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`);
        }
      } catch {
        if (!ctrl.signal.aborted) onError();
      }
    })();
    return () => ctrl.abort();
    // onError is a fresh closure each render; the work only depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url]);

  return (
    <div ref={setEl} className="min-h-[52px] bg-white" data-testid="excalidraw-chip-preview">
      {src ? (
        <img src={src} alt="" className="mx-auto block max-h-[220px] w-full object-contain p-2" draggable={false} />
      ) : (
        <div className="bg-[#1a1712] px-2.5 py-2 text-[11.5px] text-[#a89a80]">Drawing…</div>
      )}
    </div>
  );
}
