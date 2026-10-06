// @vitest-environment node
import { describe, it, expect } from "vitest";
import UTIF from "utif";
import { writePsd } from "ag-psd";
import { decodePsd, decodeTiff, to8bit } from "./decode-core";

function solid(w: number, h: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set(rgba, i * 4);
  return out;
}

describe("decodeTiff", () => {
  it("lists pages and decodes RGBA", () => {
    const tiff = UTIF.encodeImage(solid(4, 3, [255, 0, 0, 255]).buffer, 4, 3) as ArrayBuffer;
    const doc = decodeTiff(tiff);
    expect(doc.meta.frames).toEqual([{ label: "Page 1", width: 4, height: 3, kind: "page" }]);
    const f = doc.frame(0) as { width: number; height: number; rgba: Uint8ClampedArray };
    expect([f.width, f.height]).toEqual([4, 3]);
    expect(Array.from(f.rgba.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it("rejects non-TIFF bytes with a readable error", () => {
    expect(() => decodeTiff(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toThrow(/TIFF/);
  });
});

describe("decodePsd", () => {
  const layer = (name: string, color: [number, number, number, number], extra: object = {}) => ({
    name,
    left: 1,
    top: 1,
    imageData: { width: 2, height: 2, data: solid(2, 2, color) },
    ...extra,
  });

  it("returns the flattened image first, then layers top-first with group structure", () => {
    const buffer = writePsd(
      {
        width: 4,
        height: 4,
        imageData: { width: 4, height: 4, data: solid(4, 4, [0, 0, 255, 255]) },
        children: [
          layer("Bottom", [255, 0, 0, 255]),
          { name: "Group", children: [layer("Inside", [0, 255, 0, 255], { hidden: true, opacity: 0.5 })] },
        ],
      },
      { noBackground: false },
    );
    const doc = decodePsd(buffer);
    expect(doc.meta.needsComposite).toBe(false);
    expect(doc.meta.frames.map((f) => [f.label, f.kind])).toEqual([
      ["Image", "composite"],
      ["Inside", "layer"],
      ["Bottom", "layer"],
    ]);
    expect(doc.meta.layers?.map((l) => [l.name, l.depth, l.group, l.hidden, l.frame])).toEqual([
      ["Group", 0, true, false, null],
      ["Inside", 1, false, true, 1],
      ["Bottom", 0, false, false, 2],
    ]);
    expect(doc.meta.layers?.[1].opacity).toBeCloseTo(0.5, 1);
    const composite = doc.frame(0) as { rgba: Uint8ClampedArray };
    expect(Array.from(composite.rgba.slice(0, 4))).toEqual([0, 0, 255, 255]);
  });

  it("flags files without a flattened image for composing", () => {
    const buffer = writePsd({
      width: 4,
      height: 4,
      children: [layer("Only", [9, 9, 9, 255])],
      imageResources: { versionInfo: { hasRealMergedData: false, writerName: "t", readerName: "t", fileVersion: 1 } },
    });
    const doc = decodePsd(buffer);
    expect(doc.meta.needsComposite).toBe(true);
    expect([doc.meta.docWidth, doc.meta.docHeight]).toEqual([4, 4]);
    expect(doc.meta.frames.map((f) => f.kind)).toEqual(["layer"]);
  });

  it("scales 16-bit pixels to 8-bit", () => {
    expect(Array.from(to8bit({ width: 1, height: 1, data: new Uint16Array([65535, 0, 32768, 65535]) }))).toEqual([255, 0, 128, 255]);
  });
});
