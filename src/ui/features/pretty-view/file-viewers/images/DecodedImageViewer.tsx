import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Eye, EyeOff, Folder, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileModeViewProps } from "../registry";
import { baseName } from "../data/cell-format";
import { openImageDoc, type ImageDoc } from "./image-doc";
import { ZoomCanvas } from "./ZoomCanvas";

/**
 * Viewer for images browsers can't show natively — TIFF (multi-page), HEIC,
 * Photoshop (flattened image + layers) and camera RAW (the embedded
 * preview). View-only; "Download PNG" saves what's on screen.
 */

const MAX_BYTES = 300 * 1024 * 1024;

type Load = { status: "loading" } | { status: "ready"; doc: ImageDoc } | { status: "error"; message: string };

export default function DecodedImageViewer({ filename, src }: FileModeViewProps): JSX.Element {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [frame, setFrame] = useState(0);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [frameError, setFrameError] = useState<string | null>(null);

  useEffect(() => {
    if (!src) return;
    const ctrl = new AbortController();
    let doc: ImageDoc | null = null;
    setLoad({ status: "loading" });
    setFrame(0);
    (async () => {
      try {
        const res = await fetch(src, { credentials: "same-origin", signal: ctrl.signal });
        if (!res.ok) throw new Error(`Couldn't download the image (HTTP ${res.status}).`);
        if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
          throw new Error("This image is too large to open here (over 300 MB).");
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > MAX_BYTES) throw new Error("This image is too large to open here (over 300 MB).");
        doc = await openImageDoc(filename, bytes);
        if (ctrl.signal.aborted) return doc.close();
        setLoad({ status: "ready", doc });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setLoad({ status: "error", message: err instanceof Error ? err.message : "This image couldn't be opened." });
      }
    })();
    return () => {
      ctrl.abort();
      doc?.close();
    };
  }, [src, filename]);

  const doc = load.status === "ready" ? load.doc : null;

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setFrameError(null);
    doc.getFrame(frame).then(
      (c) => !cancelled && setCanvas(c),
      (err: unknown) => !cancelled && setFrameError(err instanceof Error ? err.message : "This part couldn't be decoded."),
    );
    return () => {
      cancelled = true;
    };
  }, [doc, frame]);

  if (load.status === "loading") return <div className="p-6 text-center text-sm text-[#a89a80]">Decoding image…</div>;
  if (load.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center text-sm text-[#cfc8b8]" data-testid="decoded-image-error">
        <div>{load.message}</div>
        {src ? (
          <a href={src} download={filename.slice(filename.lastIndexOf("/") + 1)} className="rounded border border-[#3a3428] px-3 py-1.5 hover:bg-[#2a251c]">
            Download
          </a>
        ) : null}
      </div>
    );
  }

  const { doc: d } = load;
  const current = d.frames[frame];
  const paged = !d.layers && d.frames.length > 1;

  const downloadPng = () => {
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const suffix = current.kind === "layer" ? `-${current.label.replace(/[^\w.-]+/g, "_")}` : paged ? `-page${frame + 1}` : "";
      a.download = `${baseName(filename)}${suffix}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, "image/png");
  };

  return (
    <div className="flex h-full min-h-[360px] flex-col text-[13px] text-[#e8e4d8]" data-testid="decoded-image-viewer">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#2e2a22] px-2 py-1 text-[12px]">
        <span className="rounded bg-[#2a251c] px-1.5 py-0.5 text-[11px] text-[#cfc8b8]">{d.format}</span>
        {paged ? (
          <span className="inline-flex items-center gap-1" data-testid="image-pager">
            <button type="button" aria-label="Previous" disabled={frame === 0} onClick={() => setFrame(frame - 1)} className="rounded p-0.5 hover:bg-[#2a251c] disabled:opacity-40">
              <ChevronLeft size={14} aria-hidden />
            </button>
            {current.label} of {d.frames.length}
            <button type="button" aria-label="Next" disabled={frame === d.frames.length - 1} onClick={() => setFrame(frame + 1)} className="rounded p-0.5 hover:bg-[#2a251c] disabled:opacity-40">
              <ChevronRight size={14} aria-hidden />
            </button>
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[#a89a80]" data-testid="image-info">
          {d.info.map(([k, v]) => `${k}: ${v}`).join(" · ")}
        </span>
        <button type="button" onClick={downloadPng} disabled={!canvas} className="inline-flex items-center gap-1 rounded border border-[#3a3428] px-2 py-0.5 hover:bg-[#2a251c] disabled:opacity-40">
          <Download size={12} aria-hidden /> Download PNG
        </button>
      </div>
      {d.approximateComposite && frame === 0 ? (
        <div className="border-b border-[#2e2a22] px-3 py-1 text-[12px] text-[#d9b98a]" data-testid="psd-approximate">
          This file was saved without a flattened image, so this view is assembled from its layers; masks, effects and some blend modes aren't reproduced.
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {d.layers ? (
          <nav className="w-56 shrink-0 overflow-y-auto border-r border-[#2e2a22] py-1 text-[12px]" aria-label="Layers" data-testid="psd-layers">
            {d.frames[0]?.kind === "composite" ? (
              <button type="button" onClick={() => setFrame(0)} className={cn("flex w-full items-center gap-1.5 px-3 py-1 text-left hover:bg-[#2a251c]", frame === 0 && "bg-[#3a3428] text-[#fbf5e8]")}>
                <ImageIcon size={13} aria-hidden /> Whole image
              </button>
            ) : null}
            <div className="px-3 pb-0.5 pt-2 text-[11px] uppercase tracking-wide text-[#7d725f]">Layers</div>
            {d.layers.map((l, i) => (
              <button
                key={i}
                type="button"
                disabled={l.frame === null}
                onClick={() => l.frame !== null && setFrame(l.frame)}
                title={`${l.name} · ${l.blendMode} · ${Math.round(l.opacity * 100)}%${l.hidden ? " · hidden" : ""}`}
                className={cn(
                  "flex w-full items-center gap-1.5 py-0.5 pr-2 text-left hover:bg-[#2a251c] disabled:cursor-default disabled:hover:bg-transparent",
                  frame === l.frame && l.frame !== null && "bg-[#3a3428] text-[#fbf5e8]",
                  l.hidden && "text-[#7d725f]",
                )}
                style={{ paddingLeft: 12 + l.depth * 12 }}
              >
                {l.group ? <Folder size={12} aria-hidden /> : l.hidden ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                {l.opacity < 1 ? <span className="text-[10.5px] text-[#7d725f]">{Math.round(l.opacity * 100)}%</span> : null}
              </button>
            ))}
          </nav>
        ) : null}
        <div className="relative min-w-0 flex-1">
          <ZoomCanvas canvas={canvas} />
          {frameError ? (
            <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-black/70 px-3 py-1 text-[12px] text-[#e8a27a]">{frameError}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
