// A ```chart block in an agent reply (shape-wealthy-text): the chart library's
// own standard option object, written as JSON — or loosely, the way it's
// written in code (unquoted keys, single quotes, trailing commas), or as
// YAML. Nothing of our
// own to learn — the agent writes the standard format, the app draws it.
//
// The option is data, never code: it's parsed as JSON/YAML (functions can't be
// expressed), then every route the library has from option text into the page
// or out to the network is closed: tooltips always draw on the canvas (never
// as HTML), click-through links, the toolbox (its data view is HTML) and any
// picture by URL are dropped, and no string may be a script URL.
import JSON5 from "json5";
import { parse as parseYaml } from "yaml";

export type ChartOption = Record<string, unknown>;

export type ChartParseResult =
  | { ok: true; option: ChartOption; error?: undefined }
  | { ok: false; error: string; option?: undefined };

/** Fence languages drawn as a chart. */
export const CHART_LANGS = new Set(["chart", "echarts"]);

/** Option keys whose string values are HTML or CSS in the library's tooltip layer. */
const MARKUP_KEYS = new Set(["formatter", "valueFormatter", "extraCssText", "className", "content"]);
/**
 * Keys that reach outside the bubble or the page: links opened on click, the
 * toolbox, pictures (symbols, pattern fills, label backgrounds), the tooltip's
 * mount point and mode (forced to canvas below).
 */
const DROPPED_KEYS = new Set(["appendTo", "appendToBody", "renderMode", "link", "sublink", "target", "subtarget", "toolbox", "image", "lang"]);

/** A tooltip setting (or list of them) that always draws on the canvas. */
function canvasTooltip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canvasTooltip);
  if (value && typeof value === "object") return { ...(sanitize(value) as object), renderMode: "richText" };
  return value;
}

export function parseChartBlock(body: string): ChartParseResult {
  const text = body.trim();
  if (!text) return { ok: false, error: "The chart block is empty." };
  let value: unknown;
  try {
    value = JSON5.parse(text);
  } catch (err5) {
    try {
      value = parseYaml(text);
    } catch {
      return { ok: false, error: `The chart couldn't be read: ${err5 instanceof Error ? err5.message.split("\n")[0] : String(err5)}` };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "A chart block holds one option object." };
  }
  const option = sanitize(value) as ChartOption;
  const series = option.series;
  const hasSeries = Array.isArray(series) ? series.length > 0 : !!series && typeof series === "object";
  if (!hasSeries) return { ok: false, error: "The chart has no series to draw." };
  return { ok: true, option };
}

function sanitize(value: unknown, key = ""): unknown {
  if (key === "tooltip") return canvasTooltip(value);
  if (typeof value === "string") {
    // Pictures by URL (symbols, backgrounds, graphic images) never load, and
    // nothing is ever a script URL.
    if (/^\s*(image:\/\/|javascript:|vbscript:|data:[\w.+-]+\/[\w.+-]+[;,])/i.test(value)) return undefined;
    if (MARKUP_KEYS.has(key) && /[<>&]/.test(value)) return undefined;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v)).filter((v) => v !== undefined);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // A graphic image element is an outside picture by definition.
    if (obj.type === "image" && "style" in obj) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (DROPPED_KEYS.has(k) || (MARKUP_KEYS.has(k) && typeof v !== "string")) continue;
      const clean = sanitize(v, k);
      if (clean !== undefined) out[k] = clean;
    }
    return out;
  }
  return value;
}

const KIND_WORDS: Record<string, string> = {
  pie: "pie chart",
  bar: "bar chart",
  line: "line chart",
  scatter: "scatter chart",
  effectScatter: "scatter chart",
  radar: "radar chart",
  funnel: "funnel chart",
  gauge: "gauge",
  heatmap: "heat map",
  treemap: "tree map",
  sunburst: "sunburst chart",
  sankey: "flow chart",
  candlestick: "candlestick chart",
  boxplot: "box plot",
  graph: "network chart",
  tree: "tree chart",
  parallel: "parallel chart",
  themeRiver: "stream chart",
  pictorialBar: "bar chart",
};

/** The chart's title text, when it has one. */
export function chartTitle(option: ChartOption): string {
  const t = Array.isArray(option.title) ? option.title[0] : option.title;
  const text = t && typeof t === "object" ? (t as Record<string, unknown>).text : undefined;
  return typeof text === "string" ? text.trim() : "";
}

/** "pie chart", "line chart", … from the first series' type; "chart" otherwise. */
export function chartKindWord(option: ChartOption): string {
  const series = Array.isArray(option.series) ? option.series : [option.series];
  const types = new Set(
    series.map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>).type : undefined)).filter((t): t is string => typeof t === "string"),
  );
  if (types.size !== 1) return "chart";
  return KIND_WORDS[[...types][0]] ?? "chart";
}

/** The spoken line: "A pie chart: disk use by folder." */
export function chartSpeech(option: ChartOption): string {
  const kind = chartKindWord(option);
  const title = chartTitle(option);
  return `${article(kind)} ${kind}${title ? `: ${stripStop(title)}` : ""}.`;
}

export function article(word: string): string {
  return /^[aeiou]/i.test(word) ? `An` : `A`;
}

export function stripStop(s: string): string {
  return s.replace(/[.\s]+$/, "");
}
