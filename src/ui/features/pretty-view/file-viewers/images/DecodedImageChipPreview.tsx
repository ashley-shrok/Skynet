import { useEffect, useState } from "react";
import { useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";

/**
 * Chat-chip thumbnail for TIFF / HEIC / PSD / RAW: decoded once the chip is
 * on screen, one at a time (decoding is heavy), cached per URL. Files over
 * PREVIEW_MAX_BYTES fall back to the plain chip.
 */

const PREVIEW_MAX_BYTES = 40 * 1024 * 1024;
const THUMB_WIDTH = 480;

interface Thumb {
  image: string;
  caption: string;
}

const cache = new Map<string, Promise<Thumb>>();
let queue: Promise<unknown> = Promise.resolve();

async function makeThumb(url: string, filename: string): Promise<Thumb> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > PREVIEW_MAX_BYTES) throw new Error("too large");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > PREVIEW_MAX_BYTES) throw new Error("too large");
  const { openImageDoc } = await import("./image-doc");
  const doc = await openImageDoc(filename, bytes);
  try {
    const full = await doc.getFrame(0);
    const scale = Math.min(1, THUMB_WIDTH / full.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(full.width * scale));
    canvas.height = Math.max(1, Math.round(full.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
    const layerCount = doc.layers?.filter((l) => !l.group).length ?? 0;
    const caption =
      doc.format === "PSD"
        ? `PSD · ${layerCount} layer${layerCount === 1 ? "" : "s"}`
        : doc.frames.length > 1
          ? `${doc.format} · ${doc.frames.length} ${doc.format === "TIFF" ? "pages" : "images"}`
          : `${doc.format} · ${doc.frames[0].width} × ${doc.frames[0].height}`;
    return { image: canvas.toDataURL("image/jpeg", 0.85), caption };
  } finally {
    doc.close();
  }
}

function thumbnail(url: string, filename: string): Promise<Thumb> {
  let job = cache.get(url);
  if (!job) {
    job = queue.then(() => makeThumb(url, filename));
    queue = job.catch(() => undefined);
    job.catch(() => cache.delete(url));
    cache.set(url, job);
  }
  return job;
}

export function DecodedImageChipPreview({ url, filename, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [thumb, setThumb] = useState<Thumb | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    thumbnail(url, filename.slice(filename.lastIndexOf("/") + 1)).then(
      (t) => !cancelled && setThumb(t),
      () => !cancelled && onError(),
    );
    return () => {
      cancelled = true;
    };
    // onError is a fresh closure each render; the work only depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url, filename]);

  return (
    <div ref={setEl} className="relative min-h-[52px]" data-testid="decoded-image-chip-preview">
      {thumb ? (
        <>
          <img src={thumb.image} alt="" className="block max-h-[240px] w-full object-contain" draggable={false} />
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10.5px] text-white">{thumb.caption}</span>
        </>
      ) : (
        <div className="px-2.5 py-2 text-[11.5px] text-[#a89a80]">Decoding image…</div>
      )}
    </div>
  );
}
