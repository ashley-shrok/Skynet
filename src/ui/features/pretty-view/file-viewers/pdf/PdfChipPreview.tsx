import { useEffect, useRef, useState } from "react";
import { useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";
import { pdfLibUrl, pdfWorkerUrl } from "./pdfjs-paths";

/**
 * Inline chat-chip preview for PDFs: page 1 as a thumbnail plus the page
 * count. Uses the vendored pdf.js library (same copy as the viewer, loaded
 * on demand) once the chip is on screen. pdf.js fetches with Range
 * requests, so a large PDF only downloads what the first page needs.
 */

const THUMB_WIDTH = 320;

/** The slice of pdf.js's library API used here. */
interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: {
    url: string;
    disableAutoFetch: boolean;
    withCredentials: boolean;
  }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getViewport(o: { scale: number }): { width: number; height: number };
        render(o: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }): {
          promise: Promise<void>;
        };
      }>;
    }>;
    destroy(): Promise<void>;
  };
}

let libPromise: Promise<PdfJsLib> | null = null;
function loadPdfJs(): Promise<PdfJsLib> {
  libPromise ??= (import(/* @vite-ignore */ pdfLibUrl()) as Promise<PdfJsLib>).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl();
    return lib;
  });
  return libPromise;
}

export function PdfChipPreview({ url, filename, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pages, setPages] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: ReturnType<PdfJsLib["getDocument"]> | null = null;
    (async () => {
      try {
        const lib = await loadPdfJs();
        if (cancelled) return;
        task = lib.getDocument({
          url,
          disableAutoFetch: true,
          withCredentials: true,
        });
        const doc = await task.promise;
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, viewport }).promise;
        if (!cancelled) setPages(doc.numPages);
      } catch {
        if (!cancelled) onError();
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
    // onError is a fresh closure each render; the fetch only depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url]);

  return (
    <div ref={setEl} className="relative" data-testid="pdf-chip-preview">
      <canvas
        ref={canvasRef}
        aria-label={`First page of ${filename}`}
        className={pages === null ? "hidden" : "block w-full max-h-[240px] object-contain object-top bg-white"}
      />
      {pages === null ? (
        <div className="min-h-[52px] px-2.5 py-2 text-[11.5px] text-[#a89a80]">Loading PDF…</div>
      ) : (
        <div className="absolute right-1.5 bottom-1.5 rounded px-1.5 py-0.5 text-[10.5px] bg-black/70 text-[#e8e4d8]">
          {pages} {pages === 1 ? "page" : "pages"}
        </div>
      )}
    </div>
  );
}
