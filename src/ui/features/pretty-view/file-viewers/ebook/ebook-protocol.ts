/**
 * Messages between the ebook viewer (Skynet UI) and the isolated reader
 * page (ebook-reader.html, which hosts foliate-js under a strict CSP).
 */

export type ReaderTheme = "light" | "sepia" | "dark";
export type ReaderFlow = "paginated" | "scrolled";

export interface ReaderStyle {
  /** Percent of the book's base size. */
  fontSize: number;
  theme: ReaderTheme;
  flow: ReaderFlow;
}

export interface TocEntry {
  label: string;
  href: string;
  depth: number;
}

export type ToReader =
  | { type: "open"; file: File; location: string | null; style: ReaderStyle }
  | { type: "nav"; dir: "prev" | "next" }
  | { type: "goto"; href?: string; fraction?: number }
  | { type: "style"; style: ReaderStyle }
  | { type: "search"; id: number; query: string }
  | { type: "search-clear" };

export type FromReader =
  | { type: "ready" }
  | { type: "opened"; title: string | null; author: string | null; toc: TocEntry[]; fixedLayout: boolean }
  | { type: "relocate"; fraction: number; cfi: string | null; chapter: string | null }
  | { type: "search-result"; id: number; cfi: string; chapter: string | null; pre: string; match: string; post: string }
  | { type: "search-done"; id: number }
  | { type: "nav-key"; dir: "prev" | "next" }
  | { type: "error"; message: string };

export const THEMES: Record<ReaderTheme, { bg: string; fg: string; link: string; scheme: "light" | "dark" }> = {
  light: { bg: "#ffffff", fg: "#1f1f1f", link: "#1a5fb4", scheme: "light" },
  sepia: { bg: "#f4ecd8", fg: "#3b2f20", link: "#7a4b12", scheme: "light" },
  dark: { bg: "#1d1b17", fg: "#e6e1d6", link: "#9fb4e8", scheme: "dark" },
};

/** Book typesetting for the chosen style (applied inside each section). */
export function readerCss(style: ReaderStyle): string {
  const t = THEMES[style.theme];
  return `
    html { color-scheme: ${t.scheme}; font-size: ${style.fontSize}% !important; }
    html, body { background: ${t.bg} !important; color: ${t.fg}; }
    a:link, a:visited { color: ${t.link}; }
    p, li, blockquote, dd { line-height: 1.55; hyphens: auto; -webkit-hyphens: auto; widows: 2; }
    img, svg, video { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap; }
  `;
}

/** title / author come in several shapes across formats. */
export function metaString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map(metaString).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.name === "string" || typeof v.name === "object") return metaString(v.name);
    const first = Object.values(v).find((x) => typeof x === "string");
    return typeof first === "string" ? first : null;
  }
  return String(value);
}
