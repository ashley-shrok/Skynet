/**
 * EXIF / TIFF orientation (1–8) applied while drawing, for sources the
 * browser won't rotate itself (decoded TIFF pixels, RAW previews whose
 * orientation lives in the RAW container).
 */

export type Drawable = CanvasImageSource & { width: number; height: number };

export function swapsAxes(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

export function orientedCanvas(source: Drawable, orientation: number): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const canvas = document.createElement("canvas");
  const o = orientation >= 1 && orientation <= 8 ? orientation : 1;
  canvas.width = swapsAxes(o) ? h : w;
  canvas.height = swapsAxes(o) ? w : h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas isn't available.");
  // Standard EXIF orientation transforms.
  const transforms: Record<number, [number, number, number, number, number, number]> = {
    1: [1, 0, 0, 1, 0, 0],
    2: [-1, 0, 0, 1, w, 0],
    3: [-1, 0, 0, -1, w, h],
    4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, h, 0],
    7: [0, -1, -1, 0, h, w],
    8: [0, -1, 1, 0, 0, w],
  };
  ctx.setTransform(...transforms[o]);
  ctx.drawImage(source, 0, 0);
  return canvas;
}
