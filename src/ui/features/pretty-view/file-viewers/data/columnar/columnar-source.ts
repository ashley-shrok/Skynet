import type { DataColumn } from "../DataGrid";

/**
 * Parquet and Arrow files as a column list, file facts and a row reader.
 * Parquet reads only the footer up front, then the row groups a scroll
 * needs (HTTP Range requests; whole-file download when a server doesn't
 * support them). Arrow IPC files are read whole.
 */

export interface ColumnarFile {
  format: "Parquet" | "Arrow";
  columns: (DataColumn & { nullable?: boolean })[];
  rowCount: number;
  /** Label → value facts for the Schema tab. */
  facts: [string, string][];
  getRows(start: number, end: number): Promise<unknown[][]>;
}

export const ARROW_MAX_BYTES = 500 * 1024 * 1024;

export async function openParquet(url: string): Promise<ColumnarFile> {
  const [{ asyncBufferFromUrl, cachedAsyncBuffer, parquetMetadataAsync, parquetReadObjects, parquetSchema }, { compressors }] =
    await Promise.all([import("hyparquet"), import("hyparquet-compressors")]);
  const file = cachedAsyncBuffer(await asyncBufferFromUrl({ url, requestInit: { credentials: "same-origin" } }));
  const metadata = await parquetMetadataAsync(file);
  const tree = parquetSchema(metadata);
  const columns = tree.children.map((child) => {
    const el = child.element;
    const logical = el.logical_type?.type ?? el.converted_type;
    const physical = el.type ?? (child.children.length ? "GROUP" : "");
    return {
      name: el.name,
      type: [logical, physical].filter(Boolean).join(" / ") || undefined,
      nullable: el.repetition_type !== "REQUIRED",
    };
  });
  const codecs = new Set<string>();
  for (const rg of metadata.row_groups) for (const c of rg.columns) if (c.meta_data) codecs.add(c.meta_data.codec);
  const rowCount = Number(metadata.num_rows);
  return {
    format: "Parquet",
    columns,
    rowCount,
    facts: [
      ["Rows", rowCount.toLocaleString()],
      ["Columns", String(columns.length)],
      ["Row groups", String(metadata.row_groups.length)],
      ["Compression", [...codecs].join(", ") || "none"],
      ["File size", formatBytes(file.byteLength)],
      ["Written by", metadata.created_by ?? "unknown"],
    ],
    async getRows(start, end) {
      const rowEnd = Math.min(end, rowCount);
      if (start >= rowEnd) return [];
      const rows = await parquetReadObjects({ file, metadata, rowStart: start, rowEnd, compressors });
      return rows.map((r) => columns.map((c) => r[c.name]));
    },
  };
}

export async function openArrow(url: string, maxBytes = ARROW_MAX_BYTES): Promise<ColumnarFile> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Couldn't download the file (HTTP ${res.status}).`);
  const tooLarge = `This file is too large to open here (over ${formatBytes(maxBytes)}).`;
  if (Number(res.headers.get("content-length") ?? 0) > maxBytes) throw new Error(tooLarge);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(tooLarge);
  const arrow = await import("apache-arrow");
  await registerArrowCodecs(arrow);
  let table: import("apache-arrow").Table;
  try {
    table = arrow.tableFromIPC(bytes);
  } catch {
    throw new Error("This isn't an Arrow IPC / Feather v2 file the viewer can read (Feather v1 isn't supported).");
  }
  const fields = table.schema.fields;
  const columns = fields.map((f) => ({ name: f.name, type: String(f.type), nullable: f.nullable }));
  return {
    format: "Arrow",
    columns,
    rowCount: table.numRows,
    facts: [
      ["Rows", table.numRows.toLocaleString()],
      ["Columns", String(columns.length)],
      ["Record batches", String(table.batches.length)],
      ["File size", formatBytes(bytes.byteLength)],
    ],
    async getRows(start, end) {
      const out: unknown[][] = [];
      const stop = Math.min(end, table.numRows);
      for (let i = start; i < stop; i++) {
        const row = table.get(i);
        out.push(fields.map((f) => toPlain(row?.[f.name])));
      }
      return out;
    },
  };
}

let codecsRegistered = false;

/**
 * pyarrow writes Feather v2 LZ4-compressed by default; apache-arrow reads
 * compressed IPC only with codecs registered (lz4js: LZ4 frame, fzstd: Zstd).
 */
async function registerArrowCodecs(arrow: typeof import("apache-arrow")): Promise<void> {
  if (codecsRegistered) return;
  const [lz4, fzstd] = await Promise.all([import("lz4js"), import("fzstd")]);
  // Arrow views 64-bit columns in place, so buffers must start 8-byte aligned;
  // decoders can return views at arbitrary offsets into a larger buffer.
  const aligned = (out: Uint8Array) => (out.byteOffset % 8 === 0 ? out : out.slice());
  arrow.compressionRegistry.set(arrow.CompressionType.LZ4_FRAME, { decode: (data) => aligned(lz4.decompress(data)) });
  arrow.compressionRegistry.set(arrow.CompressionType.ZSTD, { decode: (data) => aligned(fzstd.decompress(data)) });
  codecsRegistered = true;
}

/** Arrow vectors / structs → plain values the grid can format. */
function toPlain(value: unknown): unknown {
  if (value && typeof value === "object" && "toJSON" in value && typeof (value as { toJSON: unknown }).toJSON === "function") {
    if (value instanceof Date) return value;
    return (value as { toJSON(): unknown }).toJSON();
  }
  return value;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}
