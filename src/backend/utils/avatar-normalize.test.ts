import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { normalizeAvatar, normalizeUploadedAvatar, AVATAR_MAX_PX } from "./avatar-normalize.js";

async function noisyPng(size: number): Promise<Buffer> {
  // Random pixels so the PNG is large and doesn't compress away.
  const raw = Buffer.alloc(size * size * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

describe("normalizeAvatar", () => {
  it("shrinks a large PNG to <= AVATAR_MAX_PX WebP", async () => {
    const input = await noisyPng(1024);
    const out = await normalizeAvatar(input, "image/png");
    expect(out.mime).toBe("image/webp");
    expect(out.bytes.byteLength).toBeLessThan(input.byteLength);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.width).toBe(AVATAR_MAX_PX);
    expect(meta.height).toBe(AVATAR_MAX_PX);
  });

  it("never upscales a small image", async () => {
    const input = await noisyPng(64);
    const out = await normalizeAvatar(input, "image/png");
    const meta = await sharp(out.bytes).metadata();
    expect(meta.width).toBeLessThanOrEqual(64);
  });

  it("passes non-raster formats through untouched", async () => {
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(await normalizeAvatar(svg, "image/svg+xml")).toEqual({ bytes: svg, mime: "image/svg+xml" });
    const gif = Buffer.from("GIF89a....");
    expect(await normalizeAvatar(gif, "image/gif")).toEqual({ bytes: gif, mime: "image/gif" });
  });

  it("keeps the original when the bytes can't be decoded", async () => {
    const junk = Buffer.from("not an image at all");
    expect(await normalizeAvatar(junk, "image/png")).toEqual({ bytes: junk, mime: "image/png" });
  });
});

describe("normalizeUploadedAvatar", () => {
  it("rewrites a multer file in place", async () => {
    const input = await noisyPng(800);
    const file = { buffer: input, mimetype: "image/png", size: input.byteLength } as Express.Multer.File;
    await normalizeUploadedAvatar(file);
    expect(file.mimetype).toBe("image/webp");
    expect(file.size).toBe(file.buffer.byteLength);
    expect(file.buffer.byteLength).toBeLessThan(input.byteLength);
  });

  it("is a no-op without a file", async () => {
    await expect(normalizeUploadedAvatar(undefined)).resolves.toBeUndefined();
  });
});
