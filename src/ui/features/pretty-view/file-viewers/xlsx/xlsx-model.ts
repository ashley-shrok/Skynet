import type ExcelJSType from "exceljs";
import type { CSSProperties } from "react";
import SSF from "ssf";
import JSZip from "jszip";

/**
 * Turn an .xlsx workbook into a display model for the read-only viewer:
 * per-sheet cell text (formatted the way Excel shows it), cell styles as
 * CSS, column widths / row heights in px, merges, frozen panes, images,
 * plus counts of what can't be shown (charts, pivot tables).
 *
 * ExcelJS reads the workbook; `ssf` (SheetJS's number-format engine) turns
 * values + number formats into Excel's display text.
 */

export interface XCell {
  /** Display text, as Excel would show it. */
  text: string;
  /** Formula without the leading "=", when the cell has one. */
  formula?: string;
  /** Raw value is a number (Excel's "General" alignment puts these right). */
  numeric?: boolean;
  style?: CSSProperties;
}

export interface XMerge {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface XImage {
  src: string;
  row: number;
  col: number;
  /** Offset inside the anchor cell, px. */
  dx: number;
  dy: number;
  width: number;
  height: number;
}

export interface XSheet {
  name: string;
  rowCount: number;
  colCount: number;
  /** rows[r][c], 0-based; sparse (missing = empty). */
  rows: Array<Array<XCell | undefined> | undefined>;
  colWidths: number[];
  rowHeights: number[];
  merges: XMerge[];
  frozenRows: number;
  frozenCols: number;
  images: XImage[];
  showGridLines: boolean;
}

export interface XWorkbook {
  sheets: XSheet[];
  charts: number;
  pivotTables: number;
}

const DEFAULT_COL_WIDTH_CHARS = 8.43;
/** Empty columns shown past the last used one, as Excel does. */
const EXTRA_COLS = 2;
const DEFAULT_ROW_HEIGHT_PT = 15;
/** Excel column width (characters of the default font) → px, Calibri 11. */
const colWidthPx = (chars: number) => Math.round(chars * 7 + 5);
const ptToPx = (pt: number) => Math.round((pt * 4) / 3);

/** Excel theme slot order as referenced by `{ theme: n }` colours. */
const THEME_SLOTS = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
/** Office 2013+ default theme, used when the workbook's theme can't be read. */
const DEFAULT_THEME: Record<string, string> = {
  dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6",
  accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5",
  accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47",
  hlink: "0563C1", folHlink: "954F72",
};

function parseThemeColours(themeXml: string | undefined): string[] {
  const colours: Record<string, string> = { ...DEFAULT_THEME };
  if (themeXml) {
    for (const slot of Object.keys(DEFAULT_THEME)) {
      const m = new RegExp(
        `<a:${slot}>\\s*<a:(?:srgbClr val="([0-9A-Fa-f]{6})"|sysClr[^>]*lastClr="([0-9A-Fa-f]{6})")`,
      ).exec(themeXml);
      if (m) colours[slot] = (m[1] ?? m[2]).toUpperCase();
    }
  }
  return THEME_SLOTS.map((s) => colours[s]);
}

/** Excel tint: lighten (tint > 0) or darken (tint < 0) in HSL lightness. */
function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const n = parseInt(hex, 16);
  let r = ((n >> 16) & 255) / 255;
  let g = ((n >> 8) & 255) / 255;
  let b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

type XColor = { argb?: string; theme?: number; tint?: number } | undefined;

function cssColor(c: XColor, theme: string[]): string | undefined {
  if (!c) return undefined;
  if (c.argb && /^[0-9A-Fa-f]{8}$/.test(c.argb)) return `#${c.argb.slice(2)}`;
  if (c.argb && /^[0-9A-Fa-f]{6}$/.test(c.argb)) return `#${c.argb}`;
  if (typeof c.theme === "number" && theme[c.theme]) return `#${applyTint(theme[c.theme], c.tint ?? 0)}`;
  return undefined;
}

const BORDER_CSS: Record<string, string> = {
  thin: "1px solid",
  hair: "1px solid",
  medium: "2px solid",
  thick: "3px solid",
  dashed: "1px dashed",
  mediumDashed: "2px dashed",
  dotted: "1px dotted",
  double: "3px double",
  dashDot: "1px dashed",
  mediumDashDot: "2px dashed",
  dashDotDot: "1px dotted",
  mediumDashDotDot: "2px dotted",
  slantDashDot: "2px dashed",
};

const H_ALIGN: Record<string, CSSProperties["justifyContent"]> = {
  left: "flex-start",
  center: "center",
  centerContinuous: "center",
  right: "flex-end",
  fill: "flex-start",
  justify: "flex-start",
  distributed: "center",
};
const V_ALIGN: Record<string, CSSProperties["alignItems"]> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
  justify: "center",
  distributed: "center",
};

type ExStyle = Partial<ExcelJSType.Style>;

function styleToCss(style: ExStyle | undefined, numeric: boolean, theme: string[]): CSSProperties {
  const css: CSSProperties = {};
  const font = style?.font;
  if (font) {
    if (font.bold) css.fontWeight = 700;
    if (font.italic) css.fontStyle = "italic";
    const deco = [font.underline ? "underline" : "", font.strike ? "line-through" : ""].filter(Boolean).join(" ");
    if (deco) css.textDecoration = deco;
    if (font.size) css.fontSize = `${font.size}pt`;
    if (font.name) css.fontFamily = `"${font.name}", Calibri, Carlito, Arial, sans-serif`;
    const color = cssColor(font.color as XColor, theme);
    if (color) css.color = color;
  }
  const fill = style?.fill;
  if (fill && fill.type === "pattern" && fill.pattern !== "none") {
    const bg = cssColor((fill.fgColor ?? fill.bgColor) as XColor, theme);
    if (bg) css.backgroundColor = bg;
  } else if (fill && fill.type === "gradient" && fill.stops?.length) {
    const bg = cssColor(fill.stops[0].color as XColor, theme);
    if (bg) css.backgroundColor = bg;
  }
  const al = style?.alignment;
  css.justifyContent = (al?.horizontal && H_ALIGN[al.horizontal]) || (numeric ? "flex-end" : "flex-start");
  css.alignItems = (al?.vertical && V_ALIGN[al.vertical]) || "flex-end";
  if (al?.horizontal === "center" || al?.horizontal === "centerContinuous") css.textAlign = "center";
  if (al?.horizontal === "right") css.textAlign = "right";
  if (al?.wrapText) {
    css.whiteSpace = "pre-wrap";
    css.wordBreak = "break-word";
    css.lineHeight = 1.25;
  }
  if (al?.indent) css.paddingLeft = `${4 + al.indent * 9}px`;
  const border = style?.border;
  if (border) {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const b = border[side];
      if (b?.style && BORDER_CSS[b.style]) {
        const prop = `border${side[0].toUpperCase()}${side.slice(1)}` as "borderTop";
        css[prop] = `${BORDER_CSS[b.style]} ${cssColor(b.color as XColor, theme) ?? "#000"}`;
      }
    }
  }
  return css;
}

/** Excel serial date number for a JS Date (ExcelJS dates are UTC-based). */
function toSerial(d: Date, date1904: boolean): number {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return (d.getTime() - epoch) / 86_400_000;
}

function formatValue(value: unknown, numFmt: string | undefined, date1904: boolean): { text: string; numeric: boolean } {
  if (value === null || value === undefined) return { text: "", numeric: false };
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE", numeric: false };
  if (typeof value === "string") return { text: value, numeric: false };
  if (value instanceof Date) {
    const fmt = numFmt && numFmt !== "General" ? numFmt : "yyyy-mm-dd";
    try {
      return { text: SSF.format(fmt, toSerial(value, date1904), { date1904 }), numeric: true };
    } catch {
      return { text: value.toISOString().slice(0, 10), numeric: true };
    }
  }
  if (typeof value === "number") {
    try {
      return { text: SSF.format(numFmt || "General", value, { date1904 }), numeric: true };
    } catch {
      return { text: String(value), numeric: true };
    }
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("error" in v) return { text: String(v.error), numeric: false };
    if ("richText" in v && Array.isArray(v.richText)) {
      return { text: (v.richText as Array<{ text: string }>).map((t) => t.text).join(""), numeric: false };
    }
    if ("hyperlink" in v) return { text: String(v.text ?? v.hyperlink), numeric: false };
    if ("formula" in v || "sharedFormula" in v) return formatValue(v.result, numFmt, date1904);
  }
  return { text: String(value), numeric: false };
}

/** Count charts and pivot tables by their parts in the .xlsx package. */
async function countUnsupported(bytes: ArrayBuffer): Promise<{ charts: number; pivotTables: number }> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    return {
      charts: names.filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n)).length,
      pivotTables: names.filter((n) => /^xl\/pivotTables\/pivotTable\d+\.xml$/.test(n)).length,
    };
  } catch {
    return { charts: 0, pivotTables: 0 };
  }
}

const IMAGE_MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif" };

export interface ParseOptions {
  /** Stop reading rows after this many per sheet (chip previews). */
  maxRows?: number;
  /** Skip images (chip previews). */
  skipImages?: boolean;
}

export async function parseWorkbook(
  ExcelJS: typeof ExcelJSType,
  bytes: ArrayBuffer,
  opts: ParseOptions = {},
): Promise<XWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const themes = (wb as unknown as { _themes?: Record<string, string> })._themes;
  const theme = parseThemeColours(themes ? Object.values(themes)[0] : undefined);
  const date1904 = !!(wb.properties as { date1904?: boolean } | undefined)?.date1904;

  const sheets: XSheet[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state === "hidden" || ws.state === "veryHidden") continue;
    const colCount = Math.max(ws.columnCount, 1);
    const rowCount = Math.min(ws.rowCount, opts.maxRows ?? Number.MAX_SAFE_INTEGER);
    const defaultColWidth = ws.properties.defaultColWidth ?? DEFAULT_COL_WIDTH_CHARS;
    const defaultRowHeight = ws.properties.defaultRowHeight ?? DEFAULT_ROW_HEIGHT_PT;

    const colWidths: number[] = [];
    for (let c = 1; c <= colCount; c++) {
      const col = ws.getColumn(c);
      colWidths.push(col.hidden ? 0 : colWidthPx(col.width ?? defaultColWidth));
    }

    const rows: XSheet["rows"] = [];
    const rowHeights: number[] = [];
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      rowHeights.push(row.hidden ? 0 : ptToPx(row.height ?? defaultRowHeight));
      if (!row.hasValues && !row.cellCount) continue;
      const cells: Array<XCell | undefined> = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        if (c > colCount) return;
        if (cell.isMerged && cell.master !== cell) return; // covered by a merge
        const value = cell.value as unknown;
        const { text, numeric } = formatValue(value, cell.numFmt, date1904);
        const v = value as { formula?: string; sharedFormula?: string } | null;
        const formula = v && typeof v === "object" ? (v.formula ?? v.sharedFormula) : undefined;
        const style = styleToCss(cell.style as ExStyle, numeric, theme);
        cells[c - 1] = { text, numeric, formula, style };
      });
      rows[r - 1] = cells;
    }

    const merges: XMerge[] = [];
    const mergeModel = (ws.model as unknown as { merges?: string[] }).merges ?? [];
    for (const ref of mergeModel) {
      const [a, b] = ref.split(":");
      const tl = ws.getCell(a);
      const br = ws.getCell(b ?? a);
      merges.push({
        top: Number(tl.row) - 1,
        left: Number(tl.col) - 1,
        bottom: Number(br.row) - 1,
        right: Number(br.col) - 1,
      });
    }

    const view = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number; showGridLines?: boolean } | undefined;
    const frozen = view?.state === "frozen";

    const images: XImage[] = [];
    if (!opts.skipImages) {
      for (const img of ws.getImages()) {
        const media = wb.getImage(Number(img.imageId));
        const mime = IMAGE_MIME[media?.extension ?? ""];
        if (!media?.buffer || !mime) continue;
        const { tl, br } = img.range;
        // One-cell anchors carry a pixel size instead of a bottom-right cell.
        const ext = (img.range as unknown as { ext?: { width: number; height: number } }).ext;
        const col = Math.floor(tl.col);
        const row = Math.floor(tl.row);
        const span = (from: number, to: number, sizes: number[], fallback: number) => {
          let px = 0;
          for (let i = Math.floor(from); i < Math.ceil(to); i++) {
            const size = sizes[i] ?? fallback;
            px += size * (Math.min(to, i + 1) - Math.max(from, i));
          }
          return Math.round(px);
        };
        const defaultW = colWidthPx(defaultColWidth);
        const defaultH = ptToPx(defaultRowHeight);
        images.push({
          src: URL.createObjectURL(new Blob([media.buffer as unknown as BlobPart], { type: mime })),
          row,
          col,
          dx: Math.round((tl.col - col) * (colWidths[col] ?? defaultW)),
          dy: Math.round((tl.row - row) * (rowHeights[row] ?? defaultH)),
          width: ext ? Math.round(ext.width) : br ? span(tl.col, br.col, colWidths, defaultW) : 200,
          height: ext ? Math.round(ext.height) : br ? span(tl.row, br.row, rowHeights, defaultH) : 150,
        });
      }
    }

    // Like Excel, show a little empty space past the data, and make room
    // for images placed beyond the last used column / row.
    const imageCols = images.map((i) => i.col + 1);
    const imageRows = images.map((i) => i.row + 1);
    const shownCols = Math.max(colCount, ...imageCols) + EXTRA_COLS;
    while (colWidths.length < shownCols) colWidths.push(colWidthPx(defaultColWidth));
    const shownRows = Math.max(rowCount, ...imageRows);
    while (rowHeights.length < shownRows) rowHeights.push(ptToPx(defaultRowHeight));

    // A merge can't span the frozen / scrolling boundary in the grid, so a
    // freeze that would cut through a merge is dropped (the merge wins).
    let frozenRows = frozen ? (view?.ySplit ?? 0) : 0;
    let frozenCols = frozen ? (view?.xSplit ?? 0) : 0;
    if (merges.some((m) => m.left < frozenCols && m.right >= frozenCols)) frozenCols = 0;
    if (merges.some((m) => m.top < frozenRows && m.bottom >= frozenRows)) frozenRows = 0;

    sheets.push({
      name: ws.name,
      rowCount: shownRows,
      colCount: shownCols,
      rows,
      colWidths,
      rowHeights,
      merges,
      frozenRows,
      frozenCols,
      images,
      showGridLines: view?.showGridLines !== false,
    });
  }

  return { sheets, ...(await countUnsupported(bytes)) };
}

/** Release blob URLs created for images. */
export function disposeWorkbook(wb: XWorkbook): void {
  for (const s of wb.sheets) for (const img of s.images) URL.revokeObjectURL(img.src);
}

/** Spreadsheet column label: 0 → A, 26 → AA. */
export function colName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
