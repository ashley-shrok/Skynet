// Spoken lines for wealthy text (shape-wealthy-text): every chart, table,
// diagram, formula and collapsed section is read as one short line built from
// what's in it — never a model, never anything the agent has to write.
//
// Two readers use these: the bubble's speak button (which reads the drawn
// bubble; each block carries its line as screen-reader text) and voice mode
// (which reads the reply's markdown; `richSpeakable` rewrites the markdown).
import { CHART_LANGS, article, chartSpeech, parseChartBlock, stripStop } from "./chart-spec";

// ── Diagrams ──

export const MERMAID_LANGS = new Set(["mermaid", "mmd"]);
export const GRAPHVIZ_LANGS = new Set(["dot", "graphviz", "gv"]);

const MERMAID_KINDS: [RegExp, string][] = [
  [/^(flowchart|graph)\b/, "flowchart"],
  [/^sequenceDiagram\b/, "sequence diagram"],
  [/^classDiagram\b/, "class diagram"],
  [/^stateDiagram\b/, "state diagram"],
  [/^erDiagram\b/, "relationship diagram"],
  [/^journey\b/, "journey diagram"],
  [/^gantt\b/, "schedule chart"],
  [/^pie\b/, "pie chart"],
  [/^quadrantChart\b/, "quadrant chart"],
  [/^requirementDiagram\b/, "requirement diagram"],
  [/^gitGraph\b/, "branch diagram"],
  [/^mindmap\b/, "mind map"],
  [/^timeline\b/, "timeline"],
  [/^xychart\b/, "chart"],
  [/^sankey\b/, "flow chart"],
  [/^block\b/, "block diagram"],
  [/^architecture\b/, "architecture diagram"],
  [/^kanban\b/, "board"],
  [/^packet\b/, "packet diagram"],
];

/** "flowchart", "timeline", … from the diagram's opening keyword. */
export function diagramKindWord(lang: string, source: string): string {
  if (GRAPHVIZ_LANGS.has(lang)) return "graph diagram";
  const lines = source.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = lines.findIndex((l, j) => j > 0 && l.trim() === "---") + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("%%")) continue;
    for (const [re, word] of MERMAID_KINDS) if (re.test(line)) return word;
    return "diagram";
  }
  return "diagram";
}

export function diagramTitle(lang: string, source: string): string {
  if (GRAPHVIZ_LANGS.has(lang)) {
    // The graph's own label: a top-level label=, not one inside a node's [ ].
    const topLevel = source.replace(/\[[^\]]*\]/g, "");
    const graphAttr = source.match(/\bgraph\s*\[[^\]]*\blabel\s*=\s*"([^"]+)"/)?.[1];
    return (graphAttr ?? topLevel.match(/(?:^|[{;\s])label\s*=\s*"([^"]+)"/)?.[1] ?? "").trim();
  }
  const front = source.match(/^---\r?\n[\s\S]*?^title:\s*(.+)$[\s\S]*?^---/m)?.[1];
  if (front) return front.trim().replace(/^["']|["']$/g, "");
  return source.match(/^\s*(?:pie\s+)?title\s+(.+)$/m)?.[1]?.trim() ?? "";
}

/** "A flowchart: deploy steps." */
export function diagramSpeech(lang: string, source: string): string {
  const kind = diagramKindWord(lang, source);
  const title = diagramTitle(lang, source);
  return `${article(kind)} ${kind}${title ? `: ${stripStop(title)}` : ""}.`;
}

// ── Tables ──

/** "A table of 12 rows: host, disk, memory." */
export function tableSpeech(headings: string[], rowCount: number): string {
  const heads = headings.map((h) => h.trim()).filter(Boolean);
  const rows = `${rowCount} ${rowCount === 1 ? "row" : "rows"}`;
  return `A table of ${rows}${heads.length ? `: ${heads.join(", ")}` : ""}.`;
}

// ── Math ──

const GREEK = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi chi psi omega".split(" ");
const MAX_SPOKEN_FORMULA = 40;

/** A short formula read out in words; anything longer or stranger is "a formula". */
export function mathSpeech(tex: string): string {
  let s = tex.trim();
  const words: [RegExp, string][] = [
    [/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, " $1 over $2 "],
    [/\\sqrt\{([^{}]*)\}/g, " the square root of $1 "],
    [/\^\{?2\}?/g, " squared "],
    [/\^\{?3\}?/g, " cubed "],
    [/\^\{([^{}]*)\}/g, " to the power of $1 "],
    [/\^(\w)/g, " to the power of $1 "],
    [/_\{([^{}]*)\}/g, " sub $1 "],
    [/_(\w)/g, " sub $1 "],
    [/\\(times|cdot)\b/g, " times "],
    [/\\div\b/g, " divided by "],
    [/\\pm\b/g, " plus or minus "],
    [/\\(leq|le)\b|≤/g, " is at most "],
    [/\\(geq|ge)\b|≥/g, " is at least "],
    [/\\(neq|ne)\b|≠/g, " is not "],
    [/\\approx\b/g, " is about "],
    [/\\infty\b/g, " infinity "],
    [new RegExp(`\\\\(${GREEK.join("|")})\\b`, "gi"), " $1 "],
    [/\\[,;!: ]/g, " "],
    [/<=/g, " is at most "],
    [/>=/g, " is at least "],
    [/=/g, " equals "],
    [/</g, " is less than "],
    [/>/g, " is more than "],
    [/\+/g, " plus "],
    [/(?<=\s|^)-(?=\s*\w)/g, " minus "],
    [/\//g, " over "],
  ];
  for (const [re, rep] of words) s = s.replace(re, rep);
  s = s.replace(/[{}]/g, " ").replace(/\s+/g, " ").trim();
  if (!s || /\\/.test(s) || s.length > MAX_SPOKEN_FORMULA) return "a formula";
  return s;
}

// ── Markdown → speech (voice mode) ──

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*$/;

interface Segment {
  fence: boolean;
  lang: string;
  body: string;
  raw: string;
}

/** Splits markdown into fenced code blocks and the prose between them. */
export function splitFences(markdown: string): Segment[] {
  const lines = markdown.split("\n");
  const out: Segment[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.length) out.push({ fence: false, lang: "", body: prose.join("\n"), raw: prose.join("\n") });
    prose = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(FENCE_OPEN);
    if (!open) {
      prose.push(lines[i]);
      continue;
    }
    const marker = open[1];
    let j = i + 1;
    const closeRe = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
    while (j < lines.length && !closeRe.test(lines[j])) j++;
    flush();
    out.push({
      fence: true,
      lang: open[2].toLowerCase(),
      body: lines.slice(i + 1, j).join("\n"),
      raw: lines.slice(i, Math.min(j + 1, lines.length)).join("\n"),
    });
    i = j;
  }
  flush();
  return out;
}

const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function speakTables(prose: string): string {
  const lines = prose.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("|") && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const heads = splitRow(lines[i]).map(plainCell);
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim()) j++;
      out.push(tableSpeech(heads, j - i - 2));
      i = j - 1;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

function plainCell(s: string): string {
  return s.replace(/[*_`~]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/** A closed section is its summary; one written to start open is read in full. */
function speakDetails(prose: string): string {
  return prose.replace(/<details(\s[^>]*)?>([\s\S]*?)<\/details>/gi, (_m, attrs: string | undefined, inner: string) => {
    const summaryRe = /<summary(?:\s[^>]*)?>([\s\S]*?)<\/summary>/i;
    const summary = stripStop((inner.match(summaryRe)?.[1] ?? "Details").replace(/<[^>]+>/g, "").trim());
    if (!/\bopen\b/i.test(attrs ?? "")) return ` ${summary}. `;
    return ` ${summary}. ${inner.replace(summaryRe, "").trim()} `;
  });
}

function speakMath(prose: string): string {
  return prose
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => ` ${mathSpeech(tex)} `)
    .replace(/\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (_m, tex: string) => mathSpeech(tex));
}

/**
 * Voice mode's view of wealthy text: charts and diagrams become their spoken
 * line, tables their size and headings, collapsed sections their summary,
 * formulas their words. Other code blocks are left for the caller.
 */
export function richSpeakable(markdown: string): string {
  return splitFences(markdown)
    .map((seg) => {
      if (!seg.fence) return speakMath(speakDetails(speakTables(seg.raw)));
      if (CHART_LANGS.has(seg.lang)) {
        const res = parseChartBlock(seg.body);
        return res.ok ? ` ${chartSpeech(res.option)} ` : seg.raw;
      }
      if (MERMAID_LANGS.has(seg.lang) || GRAPHVIZ_LANGS.has(seg.lang)) return ` ${diagramSpeech(seg.lang, seg.body)} `;
      return seg.raw;
    })
    .join("\n");
}
