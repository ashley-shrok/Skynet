/**
 * Display / CSV text for values coming out of SQLite, Parquet and Arrow:
 * BigInt, dates, binary blobs and nested values all need a readable form.
 */

const MAX_TEXT = 2000;

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`;
  return value;
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid date" : value.toISOString();
  if (value instanceof Uint8Array) return `‹binary, ${value.byteLength.toLocaleString()} bytes›`;
  if (value instanceof ArrayBuffer) return `‹binary, ${value.byteLength.toLocaleString()} bytes›`;
  try {
    const text = JSON.stringify(value, jsonReplacer);
    if (text === undefined) return String(value);
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
  } catch {
    return String(value);
  }
}

/** Right-align numbers; everything else reads left to right. */
export function isNumericValue(value: unknown): boolean {
  return typeof value === "number" || typeof value === "bigint";
}

/** Base filename without its extension, for export names. */
export function baseName(filename: string): string {
  const base = filename.slice(filename.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}
