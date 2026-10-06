import { useEffect, useState } from "react";
import { useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";
import type { ModelThumbnail } from "./render-thumbnail";

/**
 * Inline chat-chip preview for 3D models: a rendered still plus triangle
 * count, made once the chip scrolls into view. Models over
 * PREVIEW_MAX_BYTES fall back to the plain chip.
 */

const PREVIEW_MAX_BYTES = 15 * 1024 * 1024;

export function ModelChipPreview({ url, filename, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [thumb, setThumb] = useState<ModelThumbnail | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const { renderModelThumbnail } = await import("./render-thumbnail");
        const name = filename.slice(filename.lastIndexOf("/") + 1);
        const result = await renderModelThumbnail(url, name, async () => {
          const res = await fetch(url, { credentials: "same-origin" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (Number(res.headers.get("content-length") ?? 0) > PREVIEW_MAX_BYTES) throw new Error("too large");
          const blob = await res.blob();
          if (blob.size > PREVIEW_MAX_BYTES) throw new Error("too large");
          return blob;
        });
        if (!cancelled) setThumb(result);
      } catch {
        if (!cancelled) onError();
      }
    })();
    return () => {
      cancelled = true;
    };
    // onError is a fresh closure each render; the work only depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url, filename]);

  return (
    <div ref={setEl} className="relative min-h-[52px]" data-testid="model-chip-preview">
      {thumb ? (
        <>
          <img src={thumb.image} alt="" className="block w-full" draggable={false} />
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10.5px] text-white">
            {thumb.info.triangles.toLocaleString()} triangles
          </span>
        </>
      ) : (
        <div className="px-2.5 py-2 text-[11.5px] text-[#a89a80]">Rendering model…</div>
      )}
    </div>
  );
}
