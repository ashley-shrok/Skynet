/// <reference lib="webworker" />
import { decodePsd, decodeTiff, type DecodedDoc, type DocMeta, type RgbaFrame } from "./decode-core";
import type { ImageMessage, ImageReply, ImageRequest, ImageResult } from "./image-protocol";

/**
 * Decodes TIFF, PSD and HEIC off the main thread, one document per worker.
 * libheif (LGPL-3.0) is imported from /vendor/heif/ as its own, unmodified
 * file (see scripts/vendor-libs.mjs).
 */

let doc: DecodedDoc | null = null;

type HeifImage = {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (out: unknown) => void): void;
};

async function decodeHeic(bytes: ArrayBuffer, heifUrl: string): Promise<DecodedDoc> {
  const mod = (await import(/* @vite-ignore */ heifUrl)) as { default: () => Promise<{ HeifDecoder: new () => { decode(b: Uint8Array): HeifImage[] } }> };
  const lib = await mod.default();
  const images = new lib.HeifDecoder().decode(new Uint8Array(bytes));
  if (!images.length) throw new Error("This HEIC file has no images the viewer can decode.");
  // Primary image first; others (bursts, alternates) after it.
  const ordered = [...images].sort((a, b) => Number(b.is_primary()) - Number(a.is_primary()));
  const meta: DocMeta = {
    format: "HEIC",
    frames: ordered.map((img, i) => ({
      label: i === 0 ? "Image" : `Image ${i + 1}`,
      width: img.get_width(),
      height: img.get_height(),
      kind: "image",
    })),
    info: [
      ["Size", `${ordered[0].get_width()} × ${ordered[0].get_height()}`],
      ["Images", String(ordered.length)],
    ],
    // libheif applies the file's rotation / mirroring itself.
    orientation: 1,
  };
  return {
    meta,
    frame(index): Promise<RgbaFrame> {
      const img = ordered[index];
      const width = img.get_width();
      const height = img.get_height();
      const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
      // display() decodes asynchronously and calls back with null on failure.
      return new Promise((resolve, reject) => {
        img.display(target, (result) => {
          if (result) resolve({ width, height, rgba: target.data });
          else reject(new Error("This HEIC image couldn't be decoded."));
        });
      });
    },
  };
}

async function handle(req: ImageRequest): Promise<{ result: ImageResult; transfer: Transferable[] }> {
  if (req.type === "open") {
    doc =
      req.kind === "tiff" ? decodeTiff(req.bytes) : req.kind === "psd" ? decodePsd(req.bytes) : await decodeHeic(req.bytes, req.heifUrl);
    return { result: { meta: doc.meta }, transfer: [] };
  }
  if (!doc) throw new Error("No image is open.");
  const f = await doc.frame(req.index);
  // Copy out so the decoder's own buffers stay intact for re-requests.
  const rgba = f.rgba.slice().buffer;
  return { result: { width: f.width, height: f.height, rgba }, transfer: [rgba] };
}

self.onmessage = (event: MessageEvent<ImageMessage>) => {
  const { id, request } = event.data;
  handle(request).then(
    ({ result, transfer }) => self.postMessage({ id, ok: true, result } satisfies ImageReply, transfer),
    (err: unknown) =>
      self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies ImageReply),
  );
};
