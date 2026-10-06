import type { DocMeta, FrameInfo, PsdLayerNode } from "./decode-core";
import { ImageClient } from "./image-client";
import { orientedCanvas } from "./orientation";
import { findEmbeddedJpegs } from "./raw-preview";
import { imageDocKind } from "./image-formats";

/**
 * One opened image document (TIFF pages, a HEIC's images, a PSD's flattened
 * image and layers, or a RAW file's embedded preview) as a list of frames
 * the viewer can show, each rendered to a canvas on demand.
 */

export interface ImageDoc {
  format: string;
  frames: FrameInfo[];
  info: [string, string][];
  layers?: PsdLayerNode[];
  /** Frame 0 was composed from the layers (blend modes approximated). */
  approximateComposite: boolean;
  getFrame(index: number): Promise<HTMLCanvasElement>;
  close(): void;
}

function imageDataCanvas(data: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext("2d")?.putImageData(data, 0, 0);
  return canvas;
}

const CANVAS_BLEND: Record<string, GlobalCompositeOperation> = {
  normal: "source-over",
  "pass through": "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color dodge": "color-dodge",
  "color burn": "color-burn",
  "hard light": "hard-light",
  "soft light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
  "linear dodge": "lighter",
};

/** Camera / capture details for the info line, when the file has EXIF. */
async function exifInfo(bytes: Uint8Array): Promise<[string, string][]> {
  try {
    const exifr = (await import("exifr")).default;
    const tags = await exifr.parse(bytes, [
      "Make", "Model", "LensModel", "ExposureTime", "FNumber", "ISO", "FocalLength", "DateTimeOriginal",
    ]);
    if (!tags) return [];
    const out: [string, string][] = [];
    // Many models already start with the maker ("Canon EOS R5").
    const make = String(tags.Make ?? "").trim();
    const model = String(tags.Model ?? "").trim();
    const camera = model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim();
    const round = (n: number) => String(Math.round(n * 10) / 10);
    if (camera) out.push(["Camera", camera]);
    if (tags.LensModel) out.push(["Lens", String(tags.LensModel)]);
    const exposure = [
      tags.ExposureTime ? (tags.ExposureTime < 1 ? `1/${Math.round(1 / tags.ExposureTime)}s` : `${tags.ExposureTime}s`) : null,
      tags.FNumber ? `f/${round(tags.FNumber)}` : null,
      tags.ISO ? `ISO ${tags.ISO}` : null,
      tags.FocalLength ? `${round(tags.FocalLength)}mm` : null,
    ].filter(Boolean);
    if (exposure.length) out.push(["Exposure", exposure.join(" · ")]);
    if (tags.DateTimeOriginal instanceof Date) out.push(["Taken", tags.DateTimeOriginal.toLocaleString()]);
    return out;
  } catch {
    return [];
  }
}

async function openRaw(bytes: Uint8Array): Promise<ImageDoc> {
  const [best] = findEmbeddedJpegs(bytes);
  if (!best) throw new Error("This RAW file has no preview image inside it, and full RAW processing isn't supported.");
  const jpeg = bytes.subarray(best.offset, best.offset + best.length);
  const bitmap = await createImageBitmap(new Blob([jpeg as BlobPart], { type: "image/jpeg" }), {
    imageOrientation: "from-image",
  }).catch(() => {
    throw new Error("This RAW file's preview image couldn't be decoded.");
  });
  // The preview's own EXIF orientation is applied above; most previews have
  // none and rely on the RAW's orientation instead.
  let orientation = 1;
  try {
    const exifr = (await import("exifr")).default;
    const own = await exifr.orientation(jpeg).catch(() => undefined);
    if (!own || own === 1) orientation = (await exifr.orientation(bytes).catch(() => undefined)) ?? 1;
  } catch {
    /* no EXIF */
  }
  const canvas = orientedCanvas(bitmap, orientation);
  bitmap.close();
  const info: [string, string][] = [
    ["Preview", `${canvas.width} × ${canvas.height} (embedded by the camera)`],
    ...(await exifInfo(bytes)),
  ];
  return {
    format: "RAW",
    frames: [{ label: "Preview", width: canvas.width, height: canvas.height, kind: "image" }],
    info,
    approximateComposite: false,
    getFrame: async () => canvas,
    close: () => {},
  };
}

async function openWithWorker(kind: "tiff" | "heic" | "psd", bytes: Uint8Array): Promise<ImageDoc> {
  // EXIF first: the bytes are handed (transferred) to the worker next.
  const exif = kind === "psd" ? [] : await exifInfo(bytes);
  const client = new ImageClient();
  let meta: DocMeta;
  try {
    meta = await client.open(kind, bytes.slice().buffer);
  } catch (err) {
    client.close();
    throw err;
  }
  const cache = new Map<number, Promise<HTMLCanvasElement>>();
  const workerFrame = (i: number) => {
    let c = cache.get(i);
    if (!c) {
      c = client.frame(i).then((data) => {
        const canvas = imageDataCanvas(data);
        return meta.orientation > 1 ? orientedCanvas(canvas, meta.orientation) : canvas;
      });
      c.catch(() => cache.delete(i));
      cache.set(i, c);
    }
    return c;
  };

  // PSD saved without a flattened image: compose one from the layers.
  if (meta.needsComposite && meta.layers && meta.docWidth && meta.docHeight) {
    const layers = meta.layers;
    const width = meta.docWidth;
    const height = meta.docHeight;
    const compose = async (): Promise<HTMLCanvasElement> => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas isn't available.");
      // Visibility and opacity inherit from enclosing groups (which come
      // before their children in the top-first list).
      const effective: { visible: boolean; opacity: number }[] = [];
      const stack: { visible: boolean; opacity: number }[] = [];
      for (const l of layers) {
        stack.length = l.depth;
        const parent = stack[l.depth - 1] ?? { visible: true, opacity: 1 };
        const own = { visible: parent.visible && !l.hidden, opacity: parent.opacity * l.opacity };
        effective.push(own);
        if (l.group) stack[l.depth] = own;
      }
      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        if (l.group || l.frame === null || !effective[i].visible) continue;
        const img = await workerFrame(l.frame);
        ctx.globalAlpha = effective[i].opacity;
        ctx.globalCompositeOperation = CANVAS_BLEND[l.blendMode] ?? "source-over";
        ctx.drawImage(img, l.left, l.top);
      }
      return canvas;
    };
    let composite: Promise<HTMLCanvasElement> | null = null;
    return {
      format: meta.format,
      frames: [{ label: "Image", width, height, kind: "composite" }, ...meta.frames],
      info: meta.info,
      layers: layers.map((l) => ({ ...l, frame: l.frame === null ? null : l.frame + 1 })),
      approximateComposite: true,
      getFrame: (i) => (i === 0 ? (composite ??= compose()) : workerFrame(i - 1)),
      close: () => client.close(),
    };
  }

  return {
    format: meta.format,
    frames: meta.frames,
    info: [...meta.info, ...exif],
    layers: meta.layers,
    approximateComposite: false,
    getFrame: workerFrame,
    close: () => client.close(),
  };
}

export async function openImageDoc(filename: string, bytes: Uint8Array): Promise<ImageDoc> {
  const kind = imageDocKind(filename);
  if (!kind) throw new Error("Unsupported image type.");
  return kind === "raw" ? openRaw(bytes) : openWithWorker(kind, bytes);
}
