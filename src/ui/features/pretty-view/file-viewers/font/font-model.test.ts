import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { alphabet, featureLabel, featureSettings, readFont, sampleText, variationSettings } from "./font-model";

const ROOT = resolve(__dirname, "../../../../../..");
const bytes = (p: string) => new Uint8Array(readFileSync(resolve(ROOT, p)));
const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

describe("readFont", () => {
  it("reads a TrueType font's names, characters and features", async () => {
    const { info, glyph } = await readFont(bytes("public/fonts/CaskaydiaCoveNerdFontMono-Regular.ttf"));
    expect(info.format).toBe("TTF");
    expect(info.family).toContain("CaskaydiaCove");
    expect(info.style).toBe("Regular");
    expect(info.codePoints).toContain(65);
    expect(info.codePoints.some((cp) => cp < 0x20)).toBe(false);
    expect(info.features.map((f) => f.tag)).toContain("zero");
    expect(info.features.map((f) => f.tag)).not.toContain("ccmp");
    expect(info.embedding).toMatch(/Installable/);
    expect(glyph(65).name).toBe("A");
  });

  it("reads WOFF2", async () => {
    const { info } = await readFont(bytes("node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2"));
    expect(info.format).toBe("WOFF2");
    expect(info.family).toBe("KaTeX_Main");
  });

  it("rejects a file that isn't a font", async () => {
    await expect(readFont(new TextEncoder().encode("not a font at all"))).rejects.toThrow(/isn't a font/);
  });
});

describe("font helpers", () => {
  it("labels features", () => {
    expect(featureLabel("ss03")).toBe("Stylistic set 3");
    expect(featureLabel("cv11")).toBe("Character variant 11");
    expect(featureLabel("smcp")).toBe("Small caps");
  });

  it("only writes features switched away from their default", () => {
    const features = [
      { tag: "liga", label: "", defaultOn: true },
      { tag: "smcp", label: "", defaultOn: false },
    ];
    expect(featureSettings(features, {})).toBe("normal");
    expect(featureSettings(features, { smcp: true, liga: false })).toBe('"liga" 0, "smcp" 1');
  });

  it("writes variation settings", () => {
    expect(variationSettings([], {})).toBe("normal");
    expect(variationSettings([{ tag: "wght", name: "Weight", min: 100, default: 400, max: 900 }], {})).toBe('"wght" 400');
  });

  it("picks a sample the font can draw", () => {
    const latin = [32, ...range(0x41, 0x5a), ...range(0x61, 0x7a)];
    expect(sampleText(latin)).toBe("The quick brown fox jumps over the lazy dog");
    const arabic = [32, ...range(0x41, 0x5a), ...range(0x61, 0x7a), ...range(0x0600, 0x06ff)];
    expect(sampleText(arabic)).toMatch(/^نص/);
    expect(sampleText([0x2600, 0x2601, 0x2602])).toBe("☀☁☂");
    expect(alphabet(latin)[0]).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  });
});
