/**
 * Jupyter notebook (.ipynb, nbformat 4) model: parse, edit cells, and
 * write back the way Jupyter does — same indent, keys in the order they
 * came, sources kept as line lists or strings as they were — so a save
 * only changes what was edited.
 */

export type CellType = "code" | "markdown" | "raw";
export type MultilineString = string | string[];

export interface NbOutput {
  output_type: "stream" | "display_data" | "execute_result" | "error" | string;
  name?: string;
  text?: MultilineString;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

export interface NbCell {
  cell_type: CellType;
  id?: string;
  source: MultilineString;
  metadata?: Record<string, unknown>;
  outputs?: NbOutput[];
  execution_count?: number | null;
  attachments?: Record<string, Record<string, MultilineString>>;
}

export interface Notebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: {
    kernelspec?: { name?: string; display_name?: string; language?: string };
    language_info?: { name?: string; version?: string };
    [key: string]: unknown;
  };
  cells: NbCell[];
}

export interface NbDoc {
  nb: Notebook;
  indent: number;
  trailingNewline: boolean;
}

export class NotebookError extends Error {}

export function parseNotebook(text: string): NbDoc {
  let nb: Notebook;
  try {
    nb = JSON.parse(text) as Notebook;
  } catch {
    throw new NotebookError("This file isn't valid notebook JSON.");
  }
  if (!nb || typeof nb !== "object" || typeof nb.nbformat !== "number") {
    throw new NotebookError("This file isn't a Jupyter notebook.");
  }
  if (nb.nbformat < 4 || !Array.isArray(nb.cells)) {
    throw new NotebookError(
      `This notebook uses an old format (nbformat ${nb.nbformat}); open and save it once in Jupyter to upgrade it.`,
    );
  }
  const indentMatch = /^\{\r?\n( +)"/.exec(text);
  return { nb, indent: indentMatch ? indentMatch[1].length : 1, trailingNewline: /\n$/.test(text) };
}

export function serializeNotebook(doc: NbDoc): string {
  return JSON.stringify(doc.nb, null, doc.indent) + (doc.trailingNewline ? "\n" : "");
}

export function joinText(value: MultilineString | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? value.join("") : value;
}

/** Jupyter stores sources as lines that keep their "\n" (all but the last). */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.split(/(?<=\n)/);
}

/** `cell` with new source text, in the same shape (line list or string) it had. */
export function withSource(cell: NbCell, text: string): NbCell {
  return { ...cell, source: Array.isArray(cell.source) ? splitLines(text) : text };
}

function newId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A blank cell, with keys in Jupyter's (sorted) order and an id when the format has them. */
export function newCell(type: CellType, nb: Notebook): NbCell {
  const withId = nb.nbformat > 4 || nb.nbformat_minor >= 5;
  if (type === "code") {
    return {
      cell_type: "code",
      execution_count: null,
      ...(withId ? { id: newId() } : {}),
      metadata: {},
      outputs: [],
      source: [],
    } as NbCell;
  }
  return { cell_type: type, ...(withId ? { id: newId() } : {}), metadata: {}, source: [] } as NbCell;
}

/** Switch code ↔ markdown ↔ raw, dropping what only code cells have. */
export function changeCellType(cell: NbCell, type: CellType): NbCell {
  if (cell.cell_type === type) return cell;
  const { outputs: _o, execution_count: _e, ...rest } = cell;
  if (type === "code") {
    const { attachments: _a, ...codeRest } = rest;
    return { cell_type: "code", execution_count: null, ...omitType(codeRest), outputs: [] } as NbCell;
  }
  return { ...rest, cell_type: type };
}

function omitType(cell: Omit<NbCell, "outputs" | "execution_count" | "attachments">) {
  const { cell_type: _t, ...rest } = cell;
  return rest;
}

export function notebookLanguage(nb: Notebook): string {
  return (nb.metadata.language_info?.name ?? nb.metadata.kernelspec?.language ?? "python").toLowerCase();
}

/** First markdown heading, for titles and chips. */
export function notebookTitle(nb: Notebook): string | null {
  for (const cell of nb.cells) {
    if (cell.cell_type !== "markdown") continue;
    const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(joinText(cell.source));
    if (m) return m[1];
  }
  return null;
}

/**
 * A representative plot for chip thumbnails: the largest of the first few
 * images (the very first is often an empty axes or a tiny inline icon).
 */
export function firstImageOutput(nb: Notebook, lookAt = 5): string | null {
  let best: { src: string; size: number } | null = null;
  let seen = 0;
  for (const cell of nb.cells) {
    for (const out of cell.outputs ?? []) {
      for (const mime of ["image/png", "image/jpeg"]) {
        const data = out.data?.[mime];
        if (!data) continue;
        const b64 = joinText(data as MultilineString).replace(/\s+/g, "");
        if (!best || b64.length > best.size) best = { src: `data:${mime};base64,${b64}`, size: b64.length };
        if (++seen >= lookAt) return best.src;
      }
    }
  }
  return best?.src ?? null;
}

/** Pseudo filename so the code editor picks the right syntax mode. */
export function languageFilename(language: string): string {
  const ext: Record<string, string> = {
    python: "py", python3: "py", ipython: "py", r: "r", julia: "jl", javascript: "js", typescript: "ts",
    scala: "scala", sql: "sql", bash: "sh", sh: "sh", shell: "sh", ruby: "rb", go: "go", rust: "rs",
    "c++": "cpp", cpp: "cpp", c: "c", java: "java", kotlin: "kt", csharp: "cs", "c#": "cs", matlab: "m",
    octave: "m", haskell: "hs", lua: "lua", perl: "pl", php: "php", swift: "swift",
  };
  return `cell.${ext[language] ?? "txt"}`;
}
