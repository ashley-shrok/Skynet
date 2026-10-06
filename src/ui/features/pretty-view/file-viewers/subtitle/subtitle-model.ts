import { parse as parseAss } from "ass-compiler";

/**
 * Subtitle files (.srt, .vtt, .ass/.ssa) as an ordered list of pieces: cues
 * and the raw text around them (headers, styles, notes, comments, blank
 * lines). Saving writes untouched pieces back byte-for-byte and re-renders
 * only the cues that were edited, so formatting, styling and anything the
 * editor doesn't understand survives. ASS dialogue is read with ass-compiler
 * (MIT); SRT and WebVTT are simple enough to read here.
 */

export type SubtitleFormat = "srt" | "vtt" | "ass";

export interface Cue {
  /** Stable id for the editor (not written to the file). */
  key: number;
  /** Milliseconds. */
  start: number;
  end: number;
  /** Editable text, lines separated by "\n" (ASS \N becomes a line break). */
  text: string;
}

interface CueOrigin {
  start: number;
  end: number;
  text: string;
  /** The cue's exact source text (block or line, without its final line break). */
  raw: string;
}

interface SrtExtra {
  kind: "srt";
  /** Index line and its line break as written, or "" when the cue had none. */
  head: string;
}

interface VttExtra {
  kind: "vtt";
  id: string | null;
  /** Cue settings after the end time, with their leading space ("" if none). */
  settings: string;
}

interface AssExtra {
  kind: "ass";
  /** Line keyword, e.g. "Dialogue: ". */
  prefix: string;
  fields: string[];
  startIdx: number;
  endIdx: number;
  textIdx: number;
}

type Piece =
  | { kind: "raw"; text: string }
  | { kind: "cue"; cue: Cue; origin: CueOrigin | null; extra: SrtExtra | VttExtra | AssExtra };

export interface SubtitleDoc {
  format: SubtitleFormat;
  eol: string;
  pieces: Piece[];
  /** Cues were added or removed: SRT indexes are renumbered on save. */
  renumber: boolean;
  /** An ASS file without an [Events] Format line (cues can't be added). */
  assNoEvents?: boolean;
  /** Where a first cue goes in an ASS file with no dialogue yet (piece index). */
  assInsertAt?: number;
  assFormat?: string[];
}

let nextKey = 1;

export function subtitleFormatFor(filename: string): SubtitleFormat | null {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "srt") return "srt";
  if (ext === "vtt") return "vtt";
  if (ext === "ass" || ext === "ssa") return "ass";
  return null;
}

export class SubtitleReadError extends Error {}

// ---------------------------------------------------------------- times

const TIME = String.raw`(?:\d+:)?\d{1,2}:\d{2}[,.]\d{1,3}`;
const TIMING = new RegExp(String.raw`^\s*(${TIME})\s*-->\s*(${TIME})(.*)$`);

/** "01:02:03,450", "02:03.450" or "1:02:03.45" → milliseconds; null if not a time. */
export function parseTime(text: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?\s*$/.exec(text);
  if (!m) return null;
  const [, h, min, s, frac = "0"] = m;
  if (Number(min) > 59 || Number(s) > 59) return null;
  return ((Number(h ?? 0) * 60 + Number(min)) * 60 + Number(s)) * 1000 + Number(frac.padEnd(3, "0"));
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Milliseconds → "HH:MM:SS,mmm" (SRT), "HH:MM:SS.mmm" (VTT) or "H:MM:SS.cc" (ASS). */
export function formatTime(ms: number, format: SubtitleFormat): string {
  const t = Math.max(0, Math.round(ms));
  if (format === "ass") {
    const cs = Math.round(t / 10);
    const h = Math.floor(cs / 360000);
    return `${h}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
  }
  const h = Math.floor(t / 3600000);
  const body = `${pad(h)}:${pad(Math.floor(t / 60000) % 60)}:${pad(Math.floor(t / 1000) % 60)}`;
  return `${body}${format === "srt" ? "," : "."}${pad(t % 1000, 3)}`;
}

// ---------------------------------------------------------------- parsing

interface Line {
  start: number;
  end: number;
  next: number;
  text: string;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    lines.push({ start: m.index, end: m.index + m[1].length, next: m.index + m[0].length, text: m[1] });
    if (m[2] === "") break;
  }
  return lines;
}

function pushRaw(pieces: Piece[], text: string) {
  if (!text) return;
  const last = pieces[pieces.length - 1];
  if (last?.kind === "raw") last.text += text;
  else pieces.push({ kind: "raw", text });
}

function parseBlocks(source: string, format: "srt" | "vtt"): Piece[] {
  const lines = splitLines(source);
  const pieces: Piece[] = [];
  let cursor = 0;
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].text.trim()) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].text.trim()) j += 1;
    const block = lines.slice(i, j);
    const at = TIMING.test(block[0].text) ? 0 : block.length > 1 && TIMING.test(block[1].text) ? 1 : -1;
    if (at >= 0) {
      const m = TIMING.exec(block[at].text)!;
      const start = parseTime(m[1]);
      const end = parseTime(m[2]);
      if (start !== null && end !== null) {
        const from = block[0].start;
        const to = block[block.length - 1].end;
        pushRaw(pieces, source.slice(cursor, from));
        const text = block.slice(at + 1).map((l) => l.text).join("\n");
        const cue: Cue = { key: nextKey++, start, end, text };
        const extra: SrtExtra | VttExtra =
          format === "srt"
            ? { kind: "srt", head: at === 1 ? source.slice(block[0].start, block[1].start) : "" }
            : { kind: "vtt", id: at === 1 ? block[0].text : null, settings: m[3].trim() ? ` ${m[3].trim()}` : "" };
        pieces.push({ kind: "cue", cue, origin: { start, end, text, raw: source.slice(from, to) }, extra });
        cursor = to;
      }
    }
    i = j;
  }
  pushRaw(pieces, source.slice(cursor));
  return pieces;
}

function splitFields(value: string, count: number): string[] {
  const out: string[] = [];
  let rest = value;
  for (let k = 0; k < count - 1; k += 1) {
    const comma = rest.indexOf(",");
    if (comma < 0) break;
    out.push(rest.slice(0, comma));
    rest = rest.slice(comma + 1);
  }
  out.push(rest);
  return out;
}

const assTextToEditor = (raw: string) => raw.replace(/\\N/g, "\n");
const editorToAssText = (text: string) => text.replace(/\r?\n/g, "\\N");

function parseAssDoc(source: string): Omit<SubtitleDoc, "eol" | "renumber"> {
  let parsed: ReturnType<typeof parseAss>;
  try {
    parsed = parseAss(source);
  } catch {
    throw new SubtitleReadError("This subtitle file couldn't be read.");
  }
  const lines = splitLines(source);
  const pieces: Piece[] = [];
  let cursor = 0;
  let section = "";
  let format: string[] | null = null;
  let afterFormat = -1;
  let n = 0;
  for (const line of lines) {
    const t = line.text.trim();
    const sec = /^\[(.+)\]$/.exec(t);
    if (sec) {
      section = sec[1].toLowerCase();
      continue;
    }
    if (section !== "events") continue;
    const fm = /^Format\s*:\s*(.*)$/i.exec(t);
    if (fm) {
      format = fm[1].split(",").map((f) => f.trim().toLowerCase());
      afterFormat = line.next;
      continue;
    }
    const dm = /^(Dialogue\s*:\s*)(.*)$/i.exec(line.text);
    if (!dm || !format) continue;
    const event = parsed.events.dialogue[n];
    n += 1;
    const fields = splitFields(dm[2], format.length);
    const startIdx = format.indexOf("start");
    const endIdx = format.indexOf("end");
    const textIdx = format.indexOf("text");
    if (!event || startIdx < 0 || endIdx < 0 || textIdx !== format.length - 1 || fields.length !== format.length) {
      throw new SubtitleReadError("This subtitle file's events couldn't be read.");
    }
    const start = Math.round(event.Start * 1000);
    const end = Math.round(event.End * 1000);
    const text = assTextToEditor(fields[textIdx]);
    pushRaw(pieces, source.slice(cursor, line.start));
    pieces.push({
      kind: "cue",
      cue: { key: nextKey++, start, end, text },
      origin: { start, end, text, raw: line.text },
      extra: { kind: "ass", prefix: dm[1], fields, startIdx, endIdx, textIdx },
    });
    cursor = line.end;
  }
  if (n !== parsed.events.dialogue.length) throw new SubtitleReadError("This subtitle file's events couldn't be read.");
  pushRaw(pieces, source.slice(cursor));
  const doc: Omit<SubtitleDoc, "eol" | "renumber"> = { format: "ass", pieces, assFormat: format ?? undefined };
  if (!format) doc.assNoEvents = true;
  else if (n === 0) {
    // Split the raw text after the Format line so a first cue can go there.
    const offset = afterFormat;
    let pos = 0;
    for (let p = 0; p < pieces.length; p += 1) {
      const piece = pieces[p] as { kind: "raw"; text: string };
      if (offset <= pos + piece.text.length) {
        const cut = offset - pos;
        pieces.splice(p, 1, { kind: "raw", text: piece.text.slice(0, cut) }, { kind: "raw", text: piece.text.slice(cut) });
        doc.assInsertAt = p + 1;
        break;
      }
      pos += piece.text.length;
    }
  }
  return doc;
}

export function parseSubtitles(filename: string, source: string): SubtitleDoc {
  const format = subtitleFormatFor(filename) ?? "srt";
  const eol = /\r\n/.test(source) ? "\r\n" : "\n";
  if (format === "ass") return { ...parseAssDoc(source), eol, renumber: false };
  return { format, eol, pieces: parseBlocks(source, format), renumber: false };
}

// ---------------------------------------------------------------- writing

function renderCue(doc: SubtitleDoc, piece: Extract<Piece, { kind: "cue" }>, index: number): string {
  const { cue, origin, extra } = piece;
  const unchanged = origin && origin.start === cue.start && origin.end === cue.end && origin.text === cue.text;
  const textLines = cue.text
    .split(/\r?\n/)
    // A blank line would end an SRT/VTT cue early.
    .filter((l, i, all) => l.trim() !== "" || (i === 0 && all.length === 1));
  switch (extra.kind) {
    case "srt": {
      const head = doc.renumber || !origin ? `${index}${doc.eol}` : extra.head;
      if (unchanged) return head + origin.raw.slice(extra.head.length);
      return `${head}${formatTime(cue.start, "srt")} --> ${formatTime(cue.end, "srt")}${doc.eol}${textLines.join(doc.eol)}`;
    }
    case "vtt": {
      if (unchanged) return origin.raw;
      const id = extra.id !== null ? `${extra.id}${doc.eol}` : "";
      return `${id}${formatTime(cue.start, "vtt")} --> ${formatTime(cue.end, "vtt")}${extra.settings}${doc.eol}${textLines.join(doc.eol)}`;
    }
    case "ass": {
      if (unchanged) return origin.raw;
      const fields = [...extra.fields];
      fields[extra.startIdx] = formatTime(cue.start, "ass");
      fields[extra.endIdx] = formatTime(cue.end, "ass");
      fields[extra.textIdx] = editorToAssText(cue.text);
      return extra.prefix + fields.join(",");
    }
  }
}

export function serializeSubtitles(doc: SubtitleDoc): string {
  let index = 0;
  return doc.pieces
    .map((p) => {
      if (p.kind === "raw") return p.text;
      index += 1;
      return renderCue(doc, p, index);
    })
    .join("");
}

// ---------------------------------------------------------------- editing

export function cuesOf(doc: SubtitleDoc): Cue[] {
  return doc.pieces.flatMap((p) => (p.kind === "cue" ? [p.cue] : []));
}

export function updateCue(doc: SubtitleDoc, key: number, patch: Partial<Omit<Cue, "key">>): SubtitleDoc {
  return {
    ...doc,
    pieces: doc.pieces.map((p) => (p.kind === "cue" && p.cue.key === key ? { ...p, cue: { ...p.cue, ...patch } } : p)),
  };
}

/** Move the given cues (or all of them) by `deltaMs`, never before 0. */
export function shiftCues(doc: SubtitleDoc, keys: Set<number> | null, deltaMs: number): SubtitleDoc {
  return {
    ...doc,
    pieces: doc.pieces.map((p) =>
      p.kind === "cue" && (!keys || keys.has(p.cue.key))
        ? { ...p, cue: { ...p.cue, start: Math.max(0, p.cue.start + deltaMs), end: Math.max(0, p.cue.end + deltaMs) } }
        : p,
    ),
  };
}

export function canAddCue(doc: SubtitleDoc): boolean {
  return !doc.assNoEvents;
}

/** Add an empty cue after `afterKey` (or at the end), starting where that one ends. Returns its key. */
export function insertCue(doc: SubtitleDoc, afterKey: number | null): { doc: SubtitleDoc; key: number } {
  const pieces = [...doc.pieces];
  const cueIdx = pieces.map((p, i) => (p.kind === "cue" ? i : -1)).filter((i) => i >= 0);
  let at = afterKey === null ? -1 : pieces.findIndex((p) => p.kind === "cue" && p.cue.key === afterKey);
  if (at < 0) at = cueIdx.length ? cueIdx[cueIdx.length - 1] : -1;
  const anchor = at >= 0 ? (pieces[at] as Extract<Piece, { kind: "cue" }>) : null;
  const start = anchor ? anchor.cue.end + 100 : 0;
  const cue: Cue = { key: nextKey++, start, end: start + 2000, text: "" };
  let extra: SrtExtra | VttExtra | AssExtra;
  if (doc.format === "srt") extra = { kind: "srt", head: "" };
  else if (doc.format === "vtt") extra = { kind: "vtt", id: null, settings: "" };
  else if (anchor && anchor.extra.kind === "ass") extra = { ...anchor.extra, fields: [...anchor.extra.fields] };
  else {
    const format = doc.assFormat ?? [];
    const defaults: Record<string, string> = { layer: "0", style: "Default", marginl: "0", marginr: "0", marginv: "0", marked: "Marked=0" };
    extra = {
      kind: "ass",
      prefix: "Dialogue: ",
      fields: format.map((f) => defaults[f] ?? ""),
      startIdx: format.indexOf("start"),
      endIdx: format.indexOf("end"),
      textIdx: format.indexOf("text"),
    };
  }
  const piece: Piece = { kind: "cue", cue, origin: null, extra };
  const sep = doc.format === "ass" ? doc.eol : doc.eol + doc.eol;
  if (at >= 0) {
    pieces.splice(at + 1, 0, { kind: "raw", text: sep }, piece);
  } else if (doc.format === "ass" && doc.assInsertAt !== undefined) {
    pieces.splice(doc.assInsertAt, 0, piece, { kind: "raw", text: doc.eol });
  } else {
    // First cue of an SRT/VTT file: after everything (the VTT header).
    const body = pieces.map((p) => (p.kind === "raw" ? p.text : "")).join("");
    const lead = body.trim() ? (/(\r?\n){2}$/.test(body) ? "" : /\r?\n$/.test(body) ? doc.eol : sep) : "";
    pieces.push({ kind: "raw", text: lead }, piece, { kind: "raw", text: doc.eol });
  }
  return { doc: { ...doc, pieces: mergeRaw(pieces), renumber: true }, key: cue.key };
}

export function deleteCues(doc: SubtitleDoc, keys: Set<number>): SubtitleDoc {
  const pieces: Piece[] = [];
  const dropBreaks = doc.format === "ass" ? 1 : 2;
  let pendingDrop = false;
  for (const p of doc.pieces) {
    if (p.kind === "cue" && keys.has(p.cue.key)) {
      pendingDrop = true;
      continue;
    }
    if (pendingDrop && p.kind === "raw") {
      let text = p.text;
      for (let k = 0; k < dropBreaks; k += 1) text = text.replace(/^(\r\n|\n|\r)/, "");
      pendingDrop = false;
      pieces.push({ ...p, text });
      continue;
    }
    pendingDrop = false;
    pieces.push(p);
  }
  // The last cue went: don't leave the blank separator that preceded it.
  const merged = mergeRaw(pieces);
  const last = merged[merged.length - 1];
  if (last?.kind === "raw" && !last.text.trim() && merged.length > 1 && merged.some((p) => p.kind === "cue")) {
    const trail = last.text;
    merged[merged.length - 1] = { kind: "raw", text: /\r?\n/.exec(trail)?.[0] ?? trail };
  }
  return { ...doc, pieces: merged, renumber: true };
}

function mergeRaw(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (p.kind === "raw" && last?.kind === "raw") out[out.length - 1] = { kind: "raw", text: last.text + p.text };
    else if (p.kind !== "raw" || p.text) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- checks

/** Text without markup, for reading speed and previews. */
export function plainText(text: string, format: SubtitleFormat): string {
  let t = text.replace(/\{[^}]*\}/g, "");
  if (format === "ass") t = t.replace(/\\[nh]/g, " ");
  else t = t.replace(/<[^>]*>/g, "");
  return t;
}

/** Characters per second above which most viewers can't keep up. */
export const MAX_READING_SPEED = 21;

export function cueProblems(cues: Cue[], format: SubtitleFormat): Map<number, string[]> {
  const problems = new Map<number, string[]>();
  const add = (key: number, msg: string) => problems.set(key, [...(problems.get(key) ?? []), msg]);
  cues.forEach((cue, i) => {
    const duration = cue.end - cue.start;
    if (duration <= 0) add(cue.key, "Ends before it starts");
    else {
      const chars = plainText(cue.text, format).replace(/\s+/g, "").length;
      const cps = chars / (duration / 1000);
      if (cps > MAX_READING_SPEED) add(cue.key, `Too fast to read (${Math.round(cps)} characters a second)`);
    }
    // ASS lines overlap on purpose (signs, karaoke, two speakers).
    const prev = cues[i - 1];
    if (format !== "ass" && prev && prev.end > cue.start) add(cue.key, "Overlaps the line before");
  });
  return problems;
}

// ---------------------------------------------------------------- export

/** The cues as a new file in another format (markup each format can't show is dropped). */
export function convertSubtitles(doc: SubtitleDoc, to: "srt" | "vtt"): string {
  const eol = "\n";
  const cues = cuesOf(doc);
  const textFor = (text: string) => {
    let t = doc.format === "ass" ? plainText(text, "ass") : text;
    // Keep the italic/bold/underline tags both formats share; drop the rest.
    t = t.replace(/<(?!\/?[ibu]>)[^>]*>/g, "");
    return t
      .split("\n")
      .filter((l) => l.trim())
      .join(eol);
  };
  const blocks = cues.map((c, i) => {
    const timing = `${formatTime(c.start, to)} --> ${formatTime(c.end, to)}`;
    return to === "srt" ? `${i + 1}${eol}${timing}${eol}${textFor(c.text)}` : `${timing}${eol}${textFor(c.text)}`;
  });
  return (to === "vtt" ? `WEBVTT${eol}${eol}` : "") + blocks.join(eol + eol) + eol;
}
