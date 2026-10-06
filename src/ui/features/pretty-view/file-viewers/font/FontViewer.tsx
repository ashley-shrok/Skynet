import { useEffect, useMemo, useState } from "react";
import { Copy, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileModeViewProps } from "../registry";
import {
  alphabet,
  featureSettings,
  readFont,
  registerFont,
  sampleText,
  variationSettings,
  type FontInfo,
  type ReadFont,
} from "./font-model";

/**
 * Font viewer, view-only (.ttf/.otf/.woff/.woff2): a specimen with the
 * user's own text, OpenType feature toggles and variable-font sliders; every
 * character in a grid; and the font's details (names, licence, embedding
 * rights). The browser draws the text; fontkit reads everything else.
 */

const MAX_BYTES = 50 * 1024 * 1024;
const SIZES = [72, 48, 36, 24, 18, 14, 12];
const CHAR_PAGE = 1024;

type Tab = "specimen" | "characters" | "details";

interface Loaded {
  font: ReadFont;
  family: string | null;
}

const PARAGRAPH =
  "Typography is the craft of arranging type to make written language legible, readable and appealing when displayed. " +
  "The arrangement of type involves selecting typefaces, point sizes, line lengths, line spacing and letter spacing, " +
  "and adjusting the space between pairs of letters.";

function hex(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

export default function FontViewer({ src }: FileModeViewProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("specimen");

  useEffect(() => {
    if (!src) return;
    const ctrl = new AbortController();
    let release: (() => void) | null = null;
    setLoaded(null);
    setError(null);
    (async () => {
      const res = await fetch(src, { credentials: "same-origin", signal: ctrl.signal });
      if (!res.ok) throw new Error(`Couldn't download the font (HTTP ${res.status}).`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) throw new Error("This font is too large to preview.");
      const font = await readFont(bytes);
      let family: string | null = null;
      try {
        const reg = await registerFont(bytes);
        family = reg.family;
        release = reg.release;
      } catch {
        // The browser refused to load it; details still show.
      }
      if (ctrl.signal.aborted) {
        release?.();
        return;
      }
      setLoaded({ font, family });
    })().catch((err: unknown) => {
      if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : "This font couldn't be read.");
    });
    return () => {
      ctrl.abort();
      release?.();
    };
  }, [src]);

  if (error) return <div className="p-8 text-center text-sm text-[#cfc8b8]" data-testid="font-error">{error}</div>;
  if (!loaded) return <div className="p-6 text-center text-sm text-[#a89a80]">Reading font…</div>;
  const { info } = loaded.font;
  return (
    <div className="flex h-full min-h-[360px] flex-col text-[#e8e4d8]" data-testid="font-viewer">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#2e2a22] px-4 py-2">
        <div className="min-w-0">
          <span className="text-[15px] font-semibold text-[#fbf5e8]">{info.family}</span>
          {info.style ? <span className="ml-2 text-[13px] text-[#a89a80]">{info.style}</span> : null}
          <span className="ml-2 rounded border border-[#3a3428] px-1.5 py-px text-[10.5px] text-[#a89a80]">{info.format}</span>
          {info.axes.length ? <span className="ml-1.5 rounded border border-[#3a3428] px-1.5 py-px text-[10.5px] text-[#a89a80]">Variable</span> : null}
        </div>
        <nav className="ml-auto flex gap-1 text-[12.5px]" role="tablist">
          {(["specimen", "characters", "details"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn("rounded px-2.5 py-1 capitalize hover:bg-[#2a251c]", tab === t && "bg-[#3a3428] text-[#fbf5e8]")}
            >
              {t === "characters" ? `Characters (${info.codePoints.length.toLocaleString()})` : t}
            </button>
          ))}
        </nav>
      </header>
      {!loaded.family ? (
        <div className="border-b border-[#2e2a22] bg-[#2a2216] px-4 py-1.5 text-[12px] text-[#e8c27a]" data-testid="font-render-warning">
          Your browser refused to draw this font (it may be damaged), so text below uses a fallback font. The details are read from the file.
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "specimen" ? <Specimen info={info} family={loaded.family} /> : null}
        {tab === "characters" ? <Characters font={loaded.font} family={loaded.family} /> : null}
        {tab === "details" ? <Details info={info} /> : null}
      </div>
    </div>
  );
}

function Specimen({ info, family }: { info: FontInfo; family: string | null }): JSX.Element {
  const [sample, setSample] = useState(() => sampleText(info.codePoints));
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [axes, setAxes] = useState<Record<string, number>>({});
  const [light, setLight] = useState(false);
  const letters = useMemo(() => alphabet(info.codePoints), [info.codePoints]);

  const style: React.CSSProperties = {
    fontFamily: family ? `"${family}", system-ui` : undefined,
    fontFeatureSettings: featureSettings(info.features, features),
    fontVariationSettings: variationSettings(info.axes, axes),
  };
  const instance = info.instances.find((i) => info.axes.every((a) => (axes[a.tag] ?? a.default) === (i.values[a.tag] ?? a.default)));

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="font-specimen">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          dir="auto"
          placeholder="Type to preview"
          aria-label="Sample text"
          className="min-w-[240px] flex-1 rounded border border-[#3a3428] bg-[#1f1b15] px-2.5 py-1.5 text-[13px] outline-none focus:border-[#6f6758]"
        />
        <button type="button" onClick={() => setLight((v) => !v)} className="rounded border border-[#3a3428] px-2.5 py-1.5 text-[12px] hover:bg-[#2a251c]">
          {light ? "Dark background" : "Light background"}
        </button>
      </div>
      {info.axes.length ? (
        <section className="flex flex-col gap-2 rounded border border-[#2e2a22] p-3" aria-label="Variation axes">
          {info.instances.length ? (
            <label className="flex items-center gap-2 text-[12px] text-[#a89a80]">
              Style
              <select
                value={instance?.name ?? ""}
                onChange={(e) => {
                  const pick = info.instances.find((i) => i.name === e.target.value);
                  if (pick) setAxes({ ...pick.values });
                }}
                className="rounded border border-[#3a3428] bg-[#1f1b15] px-1.5 py-0.5 text-[12px] text-[#e8e4d8]"
              >
                {instance ? null : <option value="">Custom</option>}
                {info.instances.map((i) => (
                  <option key={i.name} value={i.name}>{i.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          {info.axes.map((a) => (
            <label key={a.tag} className="grid grid-cols-[120px_1fr_56px] items-center gap-2 text-[12px] text-[#a89a80]">
              <span className="truncate" title={a.tag}>{a.name}</span>
              <input
                type="range"
                min={a.min}
                max={a.max}
                step={a.max - a.min > 20 ? 1 : 0.1}
                value={axes[a.tag] ?? a.default}
                onChange={(e) => setAxes((v) => ({ ...v, [a.tag]: Number(e.target.value) }))}
                aria-label={a.name}
              />
              <span className="text-right tabular-nums text-[#e8e4d8]">{axes[a.tag] ?? a.default}</span>
            </label>
          ))}
        </section>
      ) : null}
      {info.features.length ? (
        <section className="flex flex-wrap gap-1.5" aria-label="OpenType features">
          {info.features.map((f) => {
            const on = features[f.tag] ?? f.defaultOn;
            return (
              <button
                key={f.tag}
                type="button"
                aria-pressed={on}
                title={f.tag}
                onClick={() => setFeatures((v) => ({ ...v, [f.tag]: !on }))}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11.5px]",
                  on ? "border-[#8a7a55] bg-[#3a3428] text-[#fbf5e8]" : "border-[#3a3428] text-[#a89a80] hover:bg-[#2a251c]",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </section>
      ) : null}
      <div className={cn("flex flex-col gap-3 rounded p-4", light ? "bg-[#fbf8f0] text-[#1a1712]" : "bg-[#1f1b15] text-[#fbf5e8]")} style={style}>
        {SIZES.map((size) => (
          <div key={size} className="flex items-baseline gap-3">
            <span className="w-8 shrink-0 text-right font-mono text-[10.5px] opacity-50" style={{ fontFamily: "ui-monospace, monospace" }}>{size}</span>
            <div dir="auto" className="min-w-0 flex-1 truncate" style={{ fontSize: size, lineHeight: 1.25 }} data-testid={`specimen-${size}`}>
              {sample || " "}
            </div>
          </div>
        ))}
        {letters.length ? (
          <div className="mt-2 flex flex-col gap-1 break-all text-[28px] leading-snug">
            {letters.map((row) => (
              <div key={row}>{row}</div>
            ))}
          </div>
        ) : null}
        {letters.length >= 2 ? <p className="mt-2 max-w-3xl text-[16px] leading-relaxed">{PARAGRAPH}</p> : null}
      </div>
    </div>
  );
}

function Characters({ font, family }: { font: ReadFont; family: string | null }): JSX.Element {
  const { codePoints } = font.info;
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(CHAR_PAGE);
  const [selected, setSelected] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return codePoints;
    const code = /^(?:u\+|0x)([0-9a-f]{2,6})$/i.exec(q) ?? /^([0-9a-f]{4,6})$/i.exec(q);
    const wanted = new Set([...q].map((c) => c.codePointAt(0)!));
    if (code) {
      // "U+00E9" means that one character, not the letters typed.
      if (/^(u\+|0x)/i.test(q)) wanted.clear();
      wanted.add(parseInt(code[1], 16));
    }
    return codePoints.filter((cp) => wanted.has(cp));
  }, [codePoints, query]);

  const fontFamily = family ? `"${family}", system-ui` : undefined;
  const detail = selected !== null ? font.glyph(selected) : null;
  return (
    <div className="flex min-h-full" data-testid="font-characters">
      <div className="min-w-0 flex-1 p-3">
        <div className="mb-2 flex items-center gap-1.5 rounded border border-[#3a3428] px-2 py-1">
          <Search size={13} className="text-[#7d725f]" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a character or code (e.g. é or U+00E9)"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
          />
        </div>
        {filtered.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1">
            {filtered.slice(0, shown).map((cp) => (
              <button
                key={cp}
                type="button"
                onClick={() => setSelected(cp)}
                title={hex(cp)}
                className={cn("flex aspect-square items-center justify-center rounded border border-[#2e2a22] text-[24px] hover:bg-[#2a251c]", selected === cp && "border-[#8a7a55] bg-[#3a3428]")}
                style={{ fontFamily }}
              >
                {String.fromCodePoint(cp)}
              </button>
            ))}
          </div>
        ) : (
          <div className="p-6 text-center text-[12.5px] text-[#a89a80]">This font has no matching characters.</div>
        )}
        {filtered.length > shown ? (
          <button type="button" onClick={() => setShown((n) => n + CHAR_PAGE)} className="mt-3 w-full rounded border border-[#3a3428] py-1.5 text-[12px] hover:bg-[#2a251c]">
            Show more ({(filtered.length - shown).toLocaleString()} left)
          </button>
        ) : null}
      </div>
      {selected !== null && detail ? (
        <aside className="sticky top-0 flex h-fit w-56 shrink-0 flex-col items-center gap-2 border-l border-[#2e2a22] p-4" data-testid="font-glyph-detail">
          <div className="flex h-36 w-full items-center justify-center rounded bg-[#1f1b15] text-[96px] leading-none" style={{ fontFamily }}>
            {String.fromCodePoint(selected)}
          </div>
          <div className="font-mono text-[13px]">{hex(selected)}</div>
          {detail.name ? <div className="break-all text-center text-[12px] text-[#a89a80]">{detail.name}</div> : null}
          <div className="text-[11.5px] text-[#7d725f]">Width {detail.advance} / {font.info.unitsPerEm}</div>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(String.fromCodePoint(selected))}
            className="inline-flex items-center gap-1 rounded border border-[#3a3428] px-2 py-0.5 text-[12px] hover:bg-[#2a251c]"
          >
            <Copy size={12} aria-hidden /> Copy
          </button>
        </aside>
      ) : null}
    </div>
  );
}

function Details({ info }: { info: FontInfo }): JSX.Element {
  const link = (url: string | null) =>
    url && /^https?:\/\//i.test(url) ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-[#9fb4e8] hover:underline">{url}</a>
    ) : (
      url
    );
  const rows: [string, React.ReactNode][] = [
    ["Family", info.family],
    ["Style", info.style],
    ["Full name", info.fullName],
    ["PostScript name", info.postscriptName],
    ["Version", info.version],
    ["Format", info.format],
    ["Weight", info.weight],
    ["Italic", info.italic ? "Yes" : "No"],
    ["Monospaced", info.monospace ? "Yes" : "No"],
    ["Glyphs", info.glyphCount.toLocaleString()],
    ["Characters", info.codePoints.length.toLocaleString()],
    ["Units per em", info.unitsPerEm],
    ["Variation axes", info.axes.map((a) => `${a.name} (${a.tag}) ${a.min}–${a.max}`).join(", ")],
    ["Features", info.features.map((f) => f.tag).join(", ")],
    ["Designer", info.designer],
    ["Designer site", link(info.designerUrl)],
    ["Manufacturer", info.manufacturer],
    ["Vendor site", link(info.vendorUrl)],
    ["Embedding", info.embedding],
    ["Copyright", info.copyright],
    ["Trademark", info.trademark],
    ["Licence", info.license],
    ["Licence URL", link(info.licenseUrl)],
    ["Description", info.description],
  ];
  return (
    <dl className="mx-auto grid max-w-3xl grid-cols-[150px_1fr] gap-x-4 gap-y-1.5 p-5 text-[12.5px]" data-testid="font-details">
      {rows
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[#a89a80]">{k}</dt>
            <dd className="whitespace-pre-wrap break-words">{v}</dd>
          </div>
        ))}
    </dl>
  );
}
