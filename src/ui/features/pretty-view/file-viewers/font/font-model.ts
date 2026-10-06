import type { Font, FontCollection } from "fontkit";

/**
 * Reads a font file with fontkit (MIT) into the plain summary the font
 * viewer shows. The browser draws the text itself (FontFace); fontkit is only
 * used for what the browser doesn't expose: names, character set, OpenType
 * features, variation axes, embedding rights.
 */

export interface FontAxis {
  tag: string;
  name: string;
  min: number;
  default: number;
  max: number;
}

export interface FontFeature {
  tag: string;
  label: string;
  /** Browsers apply it unless switched off. */
  defaultOn: boolean;
}

export interface FontInfo {
  format: string;
  family: string;
  style: string;
  fullName: string;
  postscriptName: string;
  version: string;
  designer: string | null;
  designerUrl: string | null;
  manufacturer: string | null;
  vendorUrl: string | null;
  copyright: string | null;
  trademark: string | null;
  license: string | null;
  licenseUrl: string | null;
  description: string | null;
  weight: number | null;
  italic: boolean;
  monospace: boolean;
  glyphCount: number;
  unitsPerEm: number;
  embedding: string;
  /** Printable code points the font maps, ascending. */
  codePoints: number[];
  features: FontFeature[];
  axes: FontAxis[];
  /** Named instances of a variable font ("Bold", "Light Condensed"...). */
  instances: { name: string; values: Record<string, number> }[];
  /** For a collection (.ttc): the other fonts in the file, by name. */
  collection: string[] | null;
}

const FEATURE_LABELS: Record<string, string> = {
  liga: "Standard ligatures",
  clig: "Contextual ligatures",
  dlig: "Discretionary ligatures",
  hlig: "Historical ligatures",
  calt: "Contextual alternates",
  kern: "Kerning",
  smcp: "Small caps",
  c2sc: "Caps to small caps",
  pcap: "Petite caps",
  c2pc: "Caps to petite caps",
  unic: "Unicase",
  titl: "Titling",
  case: "Case-sensitive forms",
  cpsp: "Capital spacing",
  lnum: "Lining figures",
  onum: "Old-style figures",
  pnum: "Proportional figures",
  tnum: "Tabular figures",
  frac: "Fractions",
  afrc: "Alternative fractions",
  zero: "Slashed zero",
  sups: "Superscript",
  subs: "Subscript",
  sinf: "Scientific inferiors",
  ordn: "Ordinals",
  swsh: "Swashes",
  cswh: "Contextual swashes",
  salt: "Stylistic alternates",
  hist: "Historical forms",
  ital: "Italics",
  ornm: "Ornaments",
  nalt: "Alternate annotation forms",
  numr: "Numerators",
  dnom: "Denominators",
  hwid: "Half widths",
  fwid: "Full widths",
  pwid: "Proportional widths",
  jp78: "JIS78 forms",
  jp83: "JIS83 forms",
  jp90: "JIS90 forms",
  jp04: "JIS2004 forms",
  trad: "Traditional forms",
  smpl: "Simplified forms",
  vert: "Vertical alternates",
};

const DEFAULT_ON = new Set(["liga", "clig", "calt", "kern"]);

/**
 * Shaping features the browser applies by script/position; toggling them
 * means nothing to a reader, so they're not offered.
 */
const INTERNAL = new Set([
  "aalt", "ccmp", "locl", "mark", "mkmk", "rlig", "rclt", "rvrn", "init", "medi", "fina", "isol", "fin2", "fin3",
  "med2", "abvm", "blwm", "abvs", "blws", "abvf", "blwf", "akhn", "rphf", "pref", "half", "pstf", "cjct", "nukt",
  "pres", "psts", "haln", "vatu", "curs", "dist", "ljmo", "vjmo", "tjmo", "size", "opbd", "lfbd", "rtbd", "valt",
  "vkrn", "vpal", "vhal", "palt", "halt", "ltra", "ltrm", "rtla", "rtlm", "mset", "stch", "chws", "vchw",
]);

export function featureLabel(tag: string): string {
  const ss = /^ss(\d\d)$/.exec(tag);
  if (ss) return `Stylistic set ${Number(ss[1])}`;
  const cv = /^cv(\d\d)$/.exec(tag);
  if (cv) return `Character variant ${Number(cv[1])}`;
  return FEATURE_LABELS[tag] ?? tag;
}

function embeddingRights(fsType: Record<string, boolean> | undefined): string {
  if (!fsType) return "Not stated";
  if (fsType.noEmbedding) return "Restricted: may not be embedded";
  if (fsType.viewOnly) return "Preview and print only";
  if (fsType.editable) return "Editable embedding";
  return "Installable (no restrictions)";
}

function isPrintable(cp: number): boolean {
  return !(cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0xd800 && cp < 0xe000) || cp === 0xfeff);
}

function text(font: Font, key: string): string | null {
  const value = (font as unknown as { getName(k: string): string | null }).getName(key);
  return value?.trim() ? value.trim() : null;
}

function summarise(font: Font, collection: string[] | null): FontInfo {
  const os2 = (font as unknown as { "OS/2"?: { usWeightClass?: number; fsType?: Record<string, boolean> } })["OS/2"];
  const post = (font as unknown as { post?: { isFixedPitch?: number } }).post;
  const axes = Object.entries(font.variationAxes ?? {}).map(([tag, a]) => ({
    tag,
    name: a.name || tag,
    min: a.min,
    default: a.default,
    max: a.max,
  }));
  const instances = Object.entries((font as unknown as { namedVariations?: Record<string, Record<string, number>> }).namedVariations ?? {}).map(
    ([name, values]) => ({ name, values }),
  );
  const features = [...new Set(font.availableFeatures ?? [])]
    .filter((tag) => !INTERNAL.has(tag))
    .map((tag) => ({ tag, label: featureLabel(tag), defaultOn: DEFAULT_ON.has(tag) }));
  return {
    format: font.type,
    family: font.familyName || "Unnamed font",
    style: font.subfamilyName || "",
    fullName: font.fullName || font.familyName || "",
    postscriptName: font.postscriptName || "",
    version: (text(font, "version") ?? "").replace(/^Version\s+/i, ""),
    designer: text(font, "designer"),
    designerUrl: text(font, "designerURL"),
    manufacturer: text(font, "manufacturer"),
    vendorUrl: text(font, "vendorURL"),
    copyright: font.copyright?.trim() || null,
    trademark: text(font, "trademark"),
    license: text(font, "license"),
    licenseUrl: text(font, "licenseURL"),
    description: text(font, "description"),
    weight: os2?.usWeightClass ?? null,
    italic: font.italicAngle !== 0 || /italic|oblique/i.test(font.subfamilyName ?? ""),
    monospace: Boolean(post?.isFixedPitch),
    glyphCount: font.numGlyphs,
    unitsPerEm: font.unitsPerEm,
    embedding: embeddingRights(os2?.fsType),
    codePoints: [...font.characterSet].filter(isPrintable).sort((a, b) => a - b),
    features,
    axes,
    instances,
    collection,
  };
}

export class FontReadError extends Error {}

export interface ReadFont {
  info: FontInfo;
  /** Glyph name and advance (in font units) for one code point. */
  glyph(cp: number): { name: string | null; advance: number };
}

/** Parse `bytes`; for a collection, `index` picks the font. */
export async function readFont(bytes: Uint8Array, index = 0): Promise<ReadFont> {
  const fontkit = await import("fontkit");
  let parsed: Font | FontCollection;
  try {
    parsed = fontkit.create(bytes as unknown as Buffer);
  } catch {
    throw new FontReadError("This file isn't a font the viewer can read.");
  }
  let font: Font;
  let collection: string[] | null = null;
  if ("fonts" in parsed) {
    collection = parsed.fonts.map((f) => f.fullName || f.postscriptName || "Font");
    font = parsed.fonts[Math.min(index, parsed.fonts.length - 1)];
  } else {
    font = parsed;
  }
  try {
    const info = summarise(font, collection);
    return {
      info,
      glyph(cp) {
        try {
          const g = font.glyphForCodePoint(cp);
          return { name: g.name ?? null, advance: g.advanceWidth };
        } catch {
          return { name: null, advance: 0 };
        }
      },
    };
  } catch {
    throw new FontReadError("This font is damaged or uses a layout the viewer can't read.");
  }
}

/** "font-feature-settings" for the features switched away from their default. */
export function featureSettings(features: FontFeature[], on: Record<string, boolean>): string {
  const parts = features
    .filter((f) => (on[f.tag] ?? f.defaultOn) !== f.defaultOn)
    .map((f) => `"${f.tag}" ${on[f.tag] ? 1 : 0}`);
  return parts.length ? parts.join(", ") : "normal";
}

/** "font-variation-settings" for the axis values. */
export function variationSettings(axes: FontAxis[], values: Record<string, number>): string {
  const parts = axes.map((a) => `"${a.tag}" ${values[a.tag] ?? a.default}`);
  return parts.length ? parts.join(", ") : "normal";
}

const PANGRAM = "The quick brown fox jumps over the lazy dog";

/** Pangrams (or classic sample lines) for fonts made mainly for another script. */
const SCRIPT_SAMPLES: { name: string; ranges: [number, number][]; text: string }[] = [
  { name: "Arabic", ranges: [[0x0600, 0x06ff], [0x0750, 0x077f], [0xfb50, 0xfdff], [0xfe70, 0xfeff]], text: "نص حكيم له سر قاطع وذو شأن عظيم مكتوب على ثوب أخضر ومغلف بجلد أزرق" },
  { name: "Hebrew", ranges: [[0x0590, 0x05ff]], text: "דג סקרן שט בים מאוכזב ולפתע מצא חברה" },
  { name: "Cyrillic", ranges: [[0x0400, 0x04ff]], text: "Съешь же ещё этих мягких французских булок, да выпей чаю" },
  { name: "Greek", ranges: [[0x0370, 0x03ff], [0x1f00, 0x1fff]], text: "Ξεσκεπάζω την ψυχοφθόρα βδελυγμία" },
  { name: "Devanagari", ranges: [[0x0900, 0x097f]], text: "ऋषियों को सताने वाले दुष्ट राक्षसों के राजा रावण का सर्वनाश" },
  { name: "Thai", ranges: [[0x0e00, 0x0e7f]], text: "เป็นมนุษย์สุดประเสริฐเลิศคุณค่า" },
  { name: "Hangul", ranges: [[0xac00, 0xd7af], [0x1100, 0x11ff], [0x3130, 0x318f]], text: "다람쥐 헌 쳇바퀴에 타고파" },
  { name: "Kana", ranges: [[0x3040, 0x30ff]], text: "いろはにほへと ちりぬるを わかよたれそ つねならむ" },
  { name: "Han", ranges: [[0x4e00, 0x9fff], [0x3400, 0x4dbf]], text: "永和九年，岁在癸丑，暮春之初，会于会稽山阴之兰亭" },
];

const LATIN: [number, number][] = [[0x41, 0x5a], [0x61, 0x7a], [0xc0, 0x24f]];

function countIn(codePoints: number[], ranges: [number, number][]): number {
  let n = 0;
  for (const cp of codePoints) if (ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) n += 1;
  return n;
}

/**
 * Sample text the font can actually draw: the English pangram for Latin
 * fonts; a line in the font's main script when it was made mainly for
 * another one (Arabic, CJK...); otherwise a run of its own characters.
 */
export function sampleText(codePoints: number[]): string {
  const set = new Set(codePoints);
  const covers = (t: string) => [...t].every((c) => /\s/.test(c) || set.has(c.codePointAt(0)!));
  const latin = countIn(codePoints, LATIN);
  const main = SCRIPT_SAMPLES.map((s) => ({ s, n: countIn(codePoints, s.ranges) })).sort((a, b) => b.n - a.n)[0];
  if (main && main.n > latin && covers(main.s.text)) return main.s.text;
  if (covers(PANGRAM)) return PANGRAM;
  if (main && main.n > 0 && covers(main.s.text)) return main.s.text;
  const own = codePoints.filter((cp) => cp > 0x7f && !/\s/.test(String.fromCodePoint(cp)));
  const pick = (own.length ? own : codePoints).slice(0, 40);
  return String.fromCodePoint(...pick);
}

/** Letters and digits the font covers, for the specimen's character block. */
export function alphabet(codePoints: number[]): string[] {
  const set = new Set(codePoints);
  const rows = ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz", "0123456789", "!?&@#%*()[]{}.,:;'\"-–—/\\"];
  return rows.map((r) => [...r].filter((c) => set.has(c.codePointAt(0)!)).join("")).filter(Boolean);
}

/** Distinct family name for registering bytes with the browser. */
let counter = 0;
export function uniqueFamily(): string {
  counter += 1;
  return `skynet-font-preview-${counter}`;
}

/**
 * Register `bytes` as a browser font. Returns the family to use and a
 * cleanup; rejects when the browser's font sanitiser refuses the file.
 */
export async function registerFont(bytes: Uint8Array): Promise<{ family: string; release: () => void }> {
  const family = uniqueFamily();
  const face = new FontFace(family, bytes.slice().buffer);
  await face.load();
  document.fonts.add(face);
  return { family, release: () => document.fonts.delete(face) };
}
