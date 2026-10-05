/**
 * Serving files read over SFTP as HTTP responses — shared by every route
 * that hands a remote file to the browser (`GET /file/:host/*`, workspace
 * `/download`, skills / runbooks editor `/download`).
 *
 * - Per-extension content-type dispatch with an XSS-safe disposition lane
 *   (html / js / svg are always attachment) and a text/binary sniff
 *   fallback for unknown extensions.
 * - Single-range `Range: bytes=` support (206 / 416) so media players can
 *   scrub and downloads can resume.
 * - Streams with a fixed ~64 KiB buffer; files are never held in memory.
 *
 * Moved out of pretty-view-fetch-host-file.ts unchanged, plus
 * `sendSftpFile`, which is that route's former inline streaming block.
 */

import type { Request, Response } from "express";
import type { Readable } from "node:stream";
import { sniffTextBytes } from "./editable-file-byte-sniff.js";

/** Bytes read for unknown-extension sniff. Matches `sniffTextBytes`'s
 * internal 8 KiB sample size — reading more would be wasted work. */
export const SNIFF_BYTES = 8_192;

/** The one SFTP method streaming needs (ssh2's SFTPWrapper satisfies it). */
export type SftpStreamLike = {
  createReadStream(p: string, options?: { start?: number; end?: number }): Readable;
};

/**
 * Headers set on EVERY GET response (200 + 206 + all error paths).
 *
 * - `x-content-type-options: nosniff` — MIME-sniff off. Chrome/Safari won't
 *   second-guess the declared content-type; combined with our per-extension
 *   dispatch this closes the last "browser upgrades text/plain to text/html"
 *   loophole.
 * - `cache-control: no-store` — cross-user cache poisoning defense
 *   (T-78-01-GET2); every hit is a fresh auth-checked backend round-trip.
 *
 * `content-type` is NOT in this common set — it's per-request, dispatched
 * from file extension (or the sniff-fallback). Error responses set
 * content-type to text/plain explicitly.
 */
export const COMMON_RESPONSE_HEADERS = {
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
} as const;

/**
 * Extension → content-type dispatch table. Three lanes:
 *
 * INLINE — render in-browser with the real content-type. Video/audio/image
 * players + PDF viewer all handle these natively and none execute script.
 *
 * ATTACH — force `Content-Disposition: attachment; filename=<basename>`.
 * Preserves original content-type on the wire, but the disposition tells
 * the browser to download instead of render. Chrome/Safari WILL NOT
 * execute an attachment-disposed HTML/JS/SVG.
 *
 * ASIS — inline, no disposition, no execution risk (text/plain-ish types).
 *
 * Anything NOT in these tables goes through the sniff fallback: read
 * SNIFF_BYTES from the file, classify via sniffTextBytes, then either
 * text/plain inline (text) or application/octet-stream attachment (binary).
 */
export const EXT_INLINE: Record<string, string> = {
  // video
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  ogv: "video/ogg",
  // audio
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  opus: "audio/opus",
  // image
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/vnd.microsoft.icon",
  // document
  pdf: "application/pdf",
};

export const EXT_ATTACH: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  xhtml: "application/xhtml+xml",
  svg: "image/svg+xml",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  cjs: "application/javascript; charset=utf-8",
};

export const EXT_ASIS: Record<string, string> = {
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  yaml: "application/yaml; charset=utf-8",
  yml: "application/yaml; charset=utf-8",
  toml: "application/toml; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  log: "text/plain; charset=utf-8",
  conf: "text/plain; charset=utf-8",
  ini: "text/plain; charset=utf-8",
  env: "text/plain; charset=utf-8",
  sh: "text/plain; charset=utf-8",
  py: "text/plain; charset=utf-8",
  rb: "text/plain; charset=utf-8",
  rs: "text/plain; charset=utf-8",
  go: "text/plain; charset=utf-8",
  ts: "text/plain; charset=utf-8",
  tsx: "text/plain; charset=utf-8",
  jsx: "text/plain; charset=utf-8",
  css: "text/css; charset=utf-8",
  xml: "application/xml; charset=utf-8",
};

export type Disposition = "inline" | "attachment";
export interface DispatchResult {
  contentType: string;
  disposition: Disposition;
}

export function dispatchByExtensionOnly(ext: string | null): DispatchResult | null {
  if (!ext) return null;
  if (EXT_INLINE[ext]) return { contentType: EXT_INLINE[ext], disposition: "inline" };
  if (EXT_ATTACH[ext]) return { contentType: EXT_ATTACH[ext], disposition: "attachment" };
  if (EXT_ASIS[ext]) return { contentType: EXT_ASIS[ext], disposition: "inline" };
  return null;
}

export function dispatchFromSniff(sample: Uint8Array): DispatchResult {
  return sniffTextBytes(sample)
    ? { contentType: "text/plain; charset=utf-8", disposition: "inline" }
    : { contentType: "application/octet-stream", disposition: "attachment" };
}

/**
 * Parse an RFC 7233 `Range: bytes=X-Y` header into concrete byte offsets
 * bounded by the file size. Supports the two common shapes we care about:
 *
 *   `bytes=X-Y` → { start: X, end: Y }                      (explicit range)
 *   `bytes=X-`  → { start: X, end: size-1 }                 (open-ended tail)
 *   `bytes=-N`  → { start: size-N, end: size-1 }            (suffix range)
 *
 * Any other shape (multi-range `X-Y,A-B`, syntactically invalid) returns
 * `null` → caller falls back to a full-body 200. Multi-range would need
 * multipart/byteranges response support, which isn't worth building for
 * the "media scrubbing + resume download" use case; single ranges cover
 * everything a `<video>` scrubber or a save-as-resume ever asks for.
 *
 * A start beyond `size` returns `"unsatisfiable"` — caller responds 416.
 */
export type RangeSpec = { start: number; end: number };
export function parseRangeHeader(
  header: string | undefined,
  size: number,
): RangeSpec | "unsatisfiable" | null {
  if (!header || !header.startsWith("bytes=")) return null;
  const spec = header.slice("bytes=".length);
  if (spec.includes(",")) return null; // multi-range not supported
  const match = spec.match(/^(\d*)-(\d*)$/);
  if (!match) return null;
  const startStr = match[1];
  const endStr = match[2];
  if (startStr === "" && endStr === "") return null;
  let start: number;
  let end: number;
  if (startStr === "") {
    // Suffix range: `-N` = the last N bytes.
    const suffix = parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(startStr, 10);
    if (!Number.isFinite(start) || start < 0) return null;
    if (endStr === "") {
      end = size - 1;
    } else {
      end = parseInt(endStr, 10);
      if (!Number.isFinite(end) || end < start) return null;
      if (end > size - 1) end = size - 1;
    }
  }
  if (start >= size) return "unsatisfiable";
  return { start, end };
}

/** Read the first N bytes of a file via a bounded SFTP stream. Used only
 * for the sniff-fallback (unknown extension) — a full readFile would
 * defeat the "streaming" property of the GET path on the sniff step. */
export function sftpReadHead(
  sftp: SftpStreamLike,
  p: string,
  bytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createReadStream(p, { start: 0, end: bytes - 1 });
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", (err: Error) => reject(err));
  });
}

/** Lower-cased extension of a filename, or null. */
export function extractExtension(filename: string): string | null {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1 || dotIdx === filename.length - 1) return null;
  return filename.slice(dotIdx + 1).toLowerCase();
}

export interface SendSftpFileOptions {
  req: Request;
  res: Response;
  sftp: SftpStreamLike;
  /** Already realpath-resolved and access-checked by the caller. */
  path: string;
  size: number;
  /** Basename for the content-type dispatch and the save-as name. */
  filename: string;
  /**
   * "auto": the dispatch decides (media / pdf / text inline; html, js, svg
   * and unknown binary as attachment). "attachment": always a download.
   */
  disposition: "auto" | "attachment";
  /** Called once headers are decided, right before bytes start flowing —
   * callers clear their setup timeouts here. */
  onStreamStart?: () => void;
}

/**
 * Send `path` as the response: content-type dispatch, Range → 206 / 416,
 * then stream. Resolves when the body is fully sent or the client hung
 * up; rejects on a stream error (after tearing the response down when
 * headers were already sent).
 */
export async function sendSftpFile(opts: SendSftpFileOptions): Promise<void> {
  const { req, res, sftp, path, size, filename } = opts;

  let dispatch = dispatchByExtensionOnly(extractExtension(filename));
  if (!dispatch) {
    const sampleSize = Math.min(SNIFF_BYTES, size);
    const sample = sampleSize > 0 ? await sftpReadHead(sftp, path, sampleSize) : Buffer.alloc(0);
    dispatch = dispatchFromSniff(new Uint8Array(sample));
  }
  const attachment = opts.disposition === "attachment" || dispatch.disposition === "attachment";

  const rangeHeader = typeof req.headers.range === "string" ? req.headers.range : undefined;
  const rangeParsed = parseRangeHeader(rangeHeader, size);
  if (rangeParsed === "unsatisfiable") {
    res.set({
      ...COMMON_RESPONSE_HEADERS,
      "content-type": "text/plain; charset=utf-8",
      "content-range": `bytes */${size}`,
    });
    res.status(416).send("range_not_satisfiable");
    return;
  }

  const streamStart = rangeParsed?.start ?? 0;
  const streamEnd = rangeParsed?.end ?? size - 1;
  const contentLength = size === 0 ? 0 : streamEnd - streamStart + 1;
  const headers: Record<string, string> = {
    ...COMMON_RESPONSE_HEADERS,
    "content-type": dispatch.contentType,
    "accept-ranges": "bytes",
    "content-length": String(contentLength),
  };
  if (attachment) {
    // filename= exposes the basename by design — a save-as dialog needs it.
    const safeFilename = filename.replace(/["\\\r\n]/g, "_");
    headers["content-disposition"] = `attachment; filename="${safeFilename}"`;
  }
  if (rangeParsed) {
    headers["content-range"] = `bytes ${streamStart}-${streamEnd}/${size}`;
  }
  res.set(headers);
  res.status(rangeParsed ? 206 : 200);
  opts.onStreamStart?.();

  if (contentLength === 0) {
    res.end();
    return;
  }

  // `end` in ssh2's createReadStream is inclusive.
  const stream = sftp.createReadStream(path, { start: streamStart, end: streamEnd });
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    stream.on("error", (err: Error) => {
      // Mid-stream failure: headers are flushed, so the best we can do is
      // destroy the response; media clients retry via Range.
      try {
        res.destroy();
      } catch {
        /* ignore secondary error */
      }
      finish(err);
    });
    // Client hung up (tab closed, download cancelled): release the channel.
    res.on("close", () => {
      stream.destroy();
      finish();
    });
    stream.on("end", () => finish());
    stream.pipe(res);
  });
}
