import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { composeSplitAvatar, hueForRole, SPLIT_AVATAR_PX } from "./avatar-split.js";

const solid = (r: number, g: number, b: number) =>
  sharp({ create: { width: 80, height: 80, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();

async function pixels(bytes: Buffer) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  return (fx: number, fy: number) => {
    const x = Math.round(info.width * fx);
    const y = Math.round(info.height * fy);
    const i = (y * info.width + x) * info.channels;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  };
}

describe("composeSplitAvatar", () => {
  it("two roles: diagonal split, first role upper-left, second lower-right", async () => {
    const out = await composeSplitAvatar([
      { role: "a", image: { bytes: await solid(255, 0, 0), mime: "image/png" } },
      { role: "b", image: { bytes: await solid(0, 0, 255), mime: "image/png" } },
    ]);
    expect(out.mime).toBe("image/webp");
    const meta = await sharp(out.bytes).metadata();
    expect(meta.width).toBe(SPLIT_AVATAR_PX);
    expect(meta.height).toBe(SPLIT_AVATAR_PX);
    const px = await pixels(out.bytes);
    expect(px(0.3, 0.3).r).toBeGreaterThan(200);
    expect(px(0.3, 0.3).b).toBeLessThan(60);
    expect(px(0.7, 0.7).b).toBeGreaterThan(200);
    expect(px(0.7, 0.7).r).toBeLessThan(60);
    // On the diagonal (top-right → bottom-left) sits the gold divider.
    const d = px(0.5, 0.5);
    expect(d.r).toBeGreaterThan(200);
    expect(d.g).toBeGreaterThan(150);
    expect(d.b).toBeLessThan(120);
  });

  it("three roles: pie slices clockwise from 12 o'clock", async () => {
    const out = await composeSplitAvatar([
      { role: "a", image: { bytes: await solid(255, 0, 0), mime: "image/png" } },
      { role: "b", image: { bytes: await solid(0, 255, 0), mime: "image/png" } },
      { role: "c", image: { bytes: await solid(0, 0, 255), mime: "image/png" } },
    ]);
    const px = await pixels(out.bytes);
    // Slice 1 spans 12→4 o'clock (upper right), 2 spans 4→8 (bottom), 3 spans 8→12 (upper left).
    expect(px(0.75, 0.35).r).toBeGreaterThan(200);
    expect(px(0.5, 0.8).g).toBeGreaterThan(200);
    expect(px(0.25, 0.35).b).toBeGreaterThan(200);
  });

  it("role without an avatar gets a hue-from-name placeholder slice", async () => {
    const out = await composeSplitAvatar([
      { role: "alpha", image: null },
      { role: "b", image: { bytes: await solid(0, 0, 255), mime: "image/png" } },
    ]);
    const px = await pixels(out.bytes);
    // Corner of the placeholder slice is a flat colour that is not the blue role.
    const p = px(0.08, 0.08);
    expect(p.b).toBeLessThan(200);
    expect(p.r + p.g + p.b).toBeGreaterThan(60);
  });

  it("undecodable role avatar bytes fall back to the placeholder instead of throwing", async () => {
    const out = await composeSplitAvatar([
      { role: "a", image: { bytes: Buffer.from("not an image"), mime: "image/png" } },
      { role: "b", image: { bytes: await solid(0, 0, 255), mime: "image/png" } },
    ]);
    expect(out.bytes.byteLength).toBeGreaterThan(0);
  });

  it("rejects fewer than two parts", async () => {
    await expect(composeSplitAvatar([{ role: "a", image: null }])).rejects.toThrow();
  });

  it("hueForRole is deterministic and in range", () => {
    expect(hueForRole("box-maintainer")).toBe(hueForRole("box-maintainer"));
    expect(hueForRole("x")).toBeGreaterThanOrEqual(0);
    expect(hueForRole("x")).toBeLessThan(360);
  });
});
