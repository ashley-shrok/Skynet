import Papa from "papaparse";
import { extensionOf } from "../registry-ext";

/**
 * Parse / serialize delimited text (CSV, TSV, PSV) with PapaParse, keeping
 * the file's own format so an edited file saves back the way it came in:
 * delimiter, line endings, byte-order mark, trailing newline, and
 * quote-every-field style. Cell values are never altered; the only possible
 * change is quotes dropped from fields that never needed them.
 */

export interface DelimitedFormat {
  delimiter: string;
  newline: string;
  bom: boolean;
  trailingNewline: boolean;
  /** Every field was quoted in the original (e.g. many Excel exports). */
  quoteAll: boolean;
}

export interface DelimitedDoc {
  /** Rows as written; rows may be ragged (different lengths). */
  rows: string[][];
  format: DelimitedFormat;
}

const DELIMITER_BY_EXT: Record<string, string> = { tsv: "\t", psv: "|" };
const GUESSABLE = [",", "\t", ";", "|"];

function detectNewline(text: string): string {
  const i = text.indexOf("\n");
  if (i > 0 && text[i - 1] === "\r") return "\r\n";
  if (i >= 0) return "\n";
  return text.includes("\r") ? "\r" : "\n";
}

/** Quote-all heuristic: the first lines all open and close with quotes around every delimiter. */
function detectQuoteAll(rows: string[][], body: string, delimiter: string, newline: string): boolean {
  const lines = body.split(newline).slice(0, 5).filter((l) => l.length > 0);
  if (lines.length === 0) return false;
  return lines.every((line, i) => {
    const fields = rows[i]?.length ?? 0;
    return (
      line.startsWith('"') &&
      line.endsWith('"') &&
      line.split(`"${delimiter}"`).length === fields
    );
  });
}

export function parseDelimited(text: string, filename: string): DelimitedDoc {
  const bom = text.startsWith("﻿");
  let body = bom ? text.slice(1) : text;
  const newline = detectNewline(body);
  const trailingNewline = body.endsWith(newline);
  if (trailingNewline) body = body.slice(0, -newline.length);

  const ext = extensionOf(filename);
  const forced = ext ? DELIMITER_BY_EXT[ext] : undefined;
  const result = Papa.parse<string[]>(body, {
    delimiter: forced ?? "",
    delimitersToGuess: GUESSABLE,
    newline: newline as Papa.ParseConfig["newline"],
    skipEmptyLines: false,
  });
  // An empty file parses to one empty row; treat it as no rows.
  const rows = body.length === 0 ? [] : result.data;
  const delimiter = forced ?? (result.meta.delimiter || ",");
  return {
    rows,
    format: {
      delimiter,
      newline,
      bom,
      trailingNewline,
      quoteAll: detectQuoteAll(rows, body, delimiter, newline),
    },
  };
}

export function serializeDelimited(doc: DelimitedDoc): string {
  const { format } = doc;
  const body =
    doc.rows.length === 0
      ? ""
      : Papa.unparse(doc.rows, {
          delimiter: format.delimiter,
          newline: format.newline,
          quotes: format.quoteAll,
          // Formula-escaping would alter cell values; we never change data.
          escapeFormulae: false,
        });
  return (format.bom ? "﻿" : "") + body + (format.trailingNewline && body ? format.newline : "");
}

/** Spreadsheet-style column label: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
