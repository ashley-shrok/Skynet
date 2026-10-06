import { describe, it, expect } from "vitest";
import { findEmbeddedJpegs, jpegEnd } from "./raw-preview";

/** A structurally valid JPEG: SOI, an APP segment, SOS + entropy data, EOI. */
function fakeJpeg(payload: number, opts: { stuffing?: boolean; nested?: Uint8Array } = {}): Uint8Array {
  const app = opts.nested
    ? [0xff, 0xe1, ((opts.nested.length + 2) >> 8) & 0xff, (opts.nested.length + 2) & 0xff, ...opts.nested]
    : [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
  const sos = [0xff, 0xda, 0x00, 0x04, 0x01, 0x00];
  const data: number[] = [];
  for (let i = 0; i < payload; i++) data.push(i % 251);
  if (opts.stuffing) data.push(0xff, 0x00, 0xff, 0xd3, 0x10); // byte stuffing + a restart marker
  return Uint8Array.from([0xff, 0xd8, ...app, ...sos, ...data, 0xff, 0xd9]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("raw-preview", () => {
  it("finds the end of a JPEG through stuffing and restart markers", () => {
    const j = fakeJpeg(100, { stuffing: true });
    expect(jpegEnd(j, 0)).toBe(j.length);
    expect(jpegEnd(j.subarray(0, j.length - 2), 0)).toBe(-1); // truncated
  });

  it("picks the largest embedded preview and skips thumbnails nested inside it", () => {
    const thumb = fakeJpeg(5000);
    const big = fakeJpeg(20000, { nested: fakeJpeg(4500) });
    const raw = concat(new Uint8Array(300).fill(7), thumb, new Uint8Array(1000), big, new Uint8Array(50));
    const found = findEmbeddedJpegs(raw);
    expect(found.map((f) => f.length)).toEqual([big.length, thumb.length]);
    expect(found[0].offset).toBe(300 + thumb.length + 1000);
  });

  it("returns nothing when there's no complete JPEG", () => {
    expect(findEmbeddedJpegs(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2]))).toEqual([]);
  });
});
