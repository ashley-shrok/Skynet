import UTIF from "utif";
import { initializeCanvas, readPsd, type Layer, type PixelData } from "ag-psd";

/**
 * Pixel decoding for TIFF and PSD, free of DOM APIs so it runs in the image
 * worker (and in tests). Each decoder lists its frames up front and decodes
 * one on request, as 8-bit RGBA.
 */

export interface FrameInfo {
  label: string;
  width: number;
  height: number;
  kind: "page" | "image" | "composite" | "layer";
}

export interface PsdLayerNode {
  name: string;
  depth: number;
  group: boolean;
  hidden: boolean;
  opacity: number;
  blendMode: string;
  /** Frame holding this layer's pixels, if it has any. */
  frame: number | null;
  left: number;
  top: number;
}

export interface DocMeta {
  format: "TIFF" | "PSD" | "HEIC";
  frames: FrameInfo[];
  info: [string, string][];
  /** TIFF Orientation tag of the first page, applied when displaying. */
  orientation: number;
  layers?: PsdLayerNode[];
  /** PSD saved without a flattened image: the viewer composes the layers. */
  needsComposite?: boolean;
  docWidth?: number;
  docHeight?: number;
}

export interface RgbaFrame {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface DecodedDoc {
  meta: DocMeta;
  frame(index: number): RgbaFrame | Promise<RgbaFrame>;
}

// ---- TIFF ------------------------------------------------------------------

type Ifd = Record<string, unknown> & { width?: number; height?: number };

const TIFF_COMPRESSION: Record<number, string> = {
  1: "none",
  2: "CCITT RLE",
  3: "CCITT fax 3",
  4: "CCITT fax 4",
  5: "LZW",
  6: "JPEG (old)",
  7: "JPEG",
  8: "Deflate",
  32773: "PackBits",
  32946: "Deflate",
  34712: "JPEG 2000",
  50000: "Zstandard",
};

function tag(ifd: Ifd, id: number): number | undefined {
  const v = ifd[`t${id}`] as number[] | undefined;
  return Array.isArray(v) ? v[0] : undefined;
}

export function decodeTiff(buffer: ArrayBuffer): DecodedDoc {
  let ifds: Ifd[];
  try {
    ifds = UTIF.decode(buffer) as Ifd[];
  } catch {
    throw new Error("This isn't a TIFF file the viewer can read.");
  }
  // Reduced-resolution copies (NewSubfileType bit 0) are thumbnails, not pages.
  const pages = ifds.filter((ifd) => ((tag(ifd, 254) ?? 0) & 1) === 0 && tag(ifd, 256) && tag(ifd, 257));
  if (pages.length === 0) throw new Error("This TIFF has no images.");
  const first = pages[0];
  const bits = (first.t258 as number[] | undefined) ?? [1];
  const compression = tag(first, 259) ?? 1;
  const meta: DocMeta = {
    format: "TIFF",
    frames: pages.map((ifd, i) => ({
      label: `Page ${i + 1}`,
      width: tag(ifd, 256) ?? 0,
      height: tag(ifd, 257) ?? 0,
      kind: "page",
    })),
    info: [
      ["Size", `${tag(first, 256)} × ${tag(first, 257)}`],
      ["Pages", String(pages.length)],
      ["Bits per sample", bits.join(", ")],
      ["Compression", TIFF_COMPRESSION[compression] ?? String(compression)],
    ],
    orientation: tag(first, 274) ?? 1,
  };
  return {
    meta,
    frame(index) {
      const ifd = pages[index];
      try {
        UTIF.decodeImage(buffer, ifd);
        const rgba = new Uint8ClampedArray(UTIF.toRGBA8(ifd).buffer);
        return { width: ifd.width as number, height: ifd.height as number, rgba };
      } catch {
        throw new Error(`Page ${index + 1} uses a TIFF encoding the viewer can't decode.`);
      }
    },
  };
}

// ---- PSD -------------------------------------------------------------------

const COLOR_MODES: Record<number, string> = {
  0: "Bitmap",
  1: "Grayscale",
  2: "Indexed",
  3: "RGB",
  4: "CMYK",
  7: "Multichannel",
  8: "Duotone",
  9: "Lab",
};

/** 16- and 32-bit documents come back as wider arrays; the viewer wants 8-bit. */
export function to8bit(pixels: PixelData): Uint8ClampedArray {
  const { data } = pixels;
  if (data instanceof Uint8ClampedArray) return data;
  if (data instanceof Uint8Array) return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const out = new Uint8ClampedArray(data.length);
  if (data instanceof Uint16Array) {
    for (let i = 0; i < data.length; i++) out[i] = data[i] >> 8;
  } else {
    for (let i = 0; i < data.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, data[i])) * 255);
  }
  return out;
}

let psdCanvasReady = false;

/**
 * ag-psd allocates pixel buffers through a canvas by default, and workers
 * have no document: hand it plain buffers (and OffscreenCanvas, where it
 * really needs a canvas).
 */
function preparePsdReader(): void {
  if (psdCanvasReady) return;
  initializeCanvas(
    (width, height) => {
      if (typeof OffscreenCanvas === "undefined") throw new Error("No canvas available.");
      return new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement;
    },
    (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as unknown as ImageData,
  );
  psdCanvasReady = true;
}

export function decodePsd(buffer: ArrayBuffer): DecodedDoc {
  preparePsdReader();
  let psd: ReturnType<typeof readPsd>;
  try {
    psd = readPsd(buffer, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
  } catch (err) {
    throw new Error(`This Photoshop file couldn't be read${err instanceof Error ? ` (${err.message})` : ""}.`);
  }
  const frames: FrameInfo[] = [];
  const pixels: PixelData[] = [];
  // Every PSD has a flattened-image section, but files saved without
  // "Maximize compatibility" leave it blank and say so in version info.
  const hasFlattened = !!psd.imageData && psd.imageResources?.versionInfo?.hasRealMergedData !== false;
  if (hasFlattened && psd.imageData) {
    frames.push({ label: "Image", width: psd.width, height: psd.height, kind: "composite" });
    pixels.push(psd.imageData);
  }
  const layers: PsdLayerNode[] = [];
  // ag-psd lists children bottom-to-top; the panel shows top first.
  const walk = (children: Layer[] | undefined, depth: number) => {
    for (const layer of [...(children ?? [])].reverse()) {
      const group = Array.isArray(layer.children);
      let frame: number | null = null;
      if (!group && layer.imageData && layer.imageData.width > 0 && layer.imageData.height > 0) {
        frame = frames.length;
        frames.push({
          label: layer.name ?? "Layer",
          width: layer.imageData.width,
          height: layer.imageData.height,
          kind: "layer",
        });
        pixels.push(layer.imageData);
      }
      layers.push({
        name: layer.name ?? (group ? "Group" : "Layer"),
        depth,
        group,
        hidden: !!layer.hidden,
        opacity: layer.opacity ?? 1,
        blendMode: layer.blendMode ?? "normal",
        frame,
        left: layer.left ?? 0,
        top: layer.top ?? 0,
      });
      if (group) walk(layer.children, depth + 1);
    }
  };
  walk(psd.children, 0);
  if (frames.length === 0) throw new Error("This Photoshop file has no image data the viewer can show.");
  const layerCount = layers.filter((l) => !l.group).length;
  return {
    meta: {
      format: "PSD",
      frames,
      info: [
        ["Size", `${psd.width} × ${psd.height}`],
        ["Color mode", COLOR_MODES[psd.colorMode ?? 3] ?? "Unknown"],
        ["Bit depth", `${psd.bitsPerChannel ?? 8}-bit`],
        ["Layers", String(layerCount)],
      ],
      orientation: 1,
      layers,
      needsComposite: !hasFlattened,
      docWidth: psd.width,
      docHeight: psd.height,
    },
    frame(index) {
      const p = pixels[index];
      return { width: p.width, height: p.height, rgba: to8bit(p) };
    },
  };
}
