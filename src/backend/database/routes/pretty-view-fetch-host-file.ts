/**
 * SSH/SFTP-backed file-fetch surfaces for agent-cited file URLs.
 *
 *   POST /pretty-view/fetch-host-file   — modal JSON path (buffered; 2 MB
 *                                          cap; feeds the editable-file
 *                                          viewer, which needs the whole
 *                                          file in a base64 envelope)
 *   GET  /file/:host/*                  — verbatim URL path (streamed; 10
 *                                          GiB cap; agent-cited URL opened
 *                                          in a fresh browser tab)
 *
 * Split-router mount pattern (checker W-3): TWO NARROW Express routers,
 * each with exactly ONE handler. `prettyViewFetchHostFileRoutes` (POST-only,
 * mounted at `/pretty-view`) and `fileUrlRoutes` (GET-only, mounted at `/`).
 * `POST /fetch-host-file` at root and `GET /pretty-view/file/:host/*` both
 * 404 by construction — the wrong-prefix router has no matching handler.
 *
 * Symlink-escape defense (T-78-07): every code path calls
 * `sftp.realpath(absolutePath)` BEFORE any `stat`/`readFile`/`createReadStream`
 * and re-applies `FORBIDDEN_PATH_RE` to the resolved target. A symlink like
 * `/home/ubuntu/nasty-link` → `/proc/kmsg` is rejected before any I/O
 * touches the resolved target.
 *
 * XSS defense (T-78-01-GET1, reshaped): the POST path is unchanged
 * (base64-in-JSON — the browser never renders those bytes as HTML). The GET
 * path used to force `text/plain` on every response; that made the endpoint
 * unusable for media (videos, images, PDFs render as garbage) and mixed the
 * XSS defense with the content-type contract. The new dispatch is
 * per-extension with three lanes:
 *
 *   - Inline lane (video/*, audio/*, image/*, application/pdf) — real
 *     content-type, no `Content-Disposition`. Browsers render these
 *     natively; none execute script.
 *   - Attachment lane (text/html, application/javascript, image/svg+xml,
 *     application/xhtml+xml) — `Content-Disposition: attachment; filename=...`
 *     forces a download rather than in-tab render. Chrome/Safari WILL NOT
 *     execute an attachment-disposed HTML/JS/SVG regardless of content-type,
 *     so the XSS threat is closed at the disposition layer.
 *   - As-is lane (text/plain, application/json, source code, configs, and
 *     the sniff-fallback) — inline, no disposition, no execution risk.
 *
 * Unknown-extension fallback: read the first `SNIFF_BYTES` bytes via a
 * bounded SFTP range read, call `sniffTextBytes` (file(1)-style heuristic
 * shared with the POST path). Text → text/plain inline; binary →
 * application/octet-stream attachment.
 *
 * All GET responses still carry `X-Content-Type-Options: nosniff` (no
 * MIME-sniffing away the declared type) and `Cache-Control: no-store` (no
 * cross-user cache poisoning; T-78-01-GET2 preserved).
 *
 * Cap defense: MAX_BYTES_POST (2 MB) applies to the POST modal path only —
 * the modal editor reads the whole file into a text buffer, so tight is
 * safe. MAX_BYTES_GET (10 GiB) applies to the streamed GET path — a soft
 * "you pointed at the wrong path" catch. The GET path never buffers the
 * whole body: `sftp.createReadStream` piped to `res` uses a fixed ~64 KiB
 * buffer regardless of file size.
 *
 * Range support: the GET handler parses `Range: bytes=X-Y` requests,
 * returns `206 Partial Content` with `Content-Range: bytes X-Y/Z` and a
 * bounded `createReadStream({ start, end })`. Media players get scrubbing;
 * download managers get pause-and-resume. `Accept-Ranges: bytes` is
 * advertised on every 200 GET response.
 *
 * Info-leak invariant (T-40-05, inherited from pretty-view-fetch-tailnet-url.ts):
 * `err.message`, `absolutePath`, and `filename` NEVER appear in response
 * bodies (JSON on POST, raw text on GET; the attachment `filename=` DOES
 * expose the last path segment by design — that's the file's basename, not
 * the full absolute path, and is what a save-as dialog needs). Server logs
 * may include `errorClass = err.name`, host+port, and duration only.
 */

import express from "express";
import type { Request, Response } from "express";
import type { Readable } from "node:stream";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { sshLogger } from "../../utils/logger.js";
import { classifyByExtension } from "../../utils/editable-file-whitelist.js";
import { sniffTextBytes } from "../../utils/editable-file-byte-sniff.js";
import { withConnection } from "../../ssh/ssh-connection-pool.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostByName } from "../../ssh/host-resolver.js";
import type { SSHHost } from "../../../types/index.js";
import type { Client as SSHClientType } from "ssh2";

/* ------------------------------------------------------------------------ */
/*  Constants                                                               */
/* ------------------------------------------------------------------------ */

/** POST /pretty-view/fetch-host-file cap. The modal viewer buffers the
 * whole file into a base64 envelope; 2 MB is the historical "reasonable
 * text file" ceiling shared with pretty-view-fetch-tailnet-url.ts. */
const MAX_BYTES_POST = 2_000_000;

/** GET /file/:host/* cap. Sanity ceiling on streamed downloads — anything
 * bigger is almost certainly a wrong-path click (e.g. `/var/log/journal/*`
 * multi-GB binary). The GET path does NOT buffer the file; memory pressure
 * per request is a fixed ~64 KiB regardless of file size. Caddy's upstream
 * `read_timeout 5m` provides an orthogonal wall-clock ceiling. */
const MAX_BYTES_GET = 10 * 1024 ** 3; // 10 GiB

/** Bytes read for unknown-extension sniff. Matches `sniffTextBytes`'s
 * internal 8 KiB sample size — reading more would be wasted work. */
const SNIFF_BYTES = 8_192;

/** SSH connect timeout for `connectOneShot` (ms). */
const SSH_CONNECT_TIMEOUT_MS = 5_000;

/** Whole-operation SFTP setup timeout (ms) — bounds realpath + stat +
 * (for POST) readFile OR (for GET) initial stream open. Once the GET path
 * starts piping bytes to `res`, this timeout is cleared: a slow-but-
 * progressing multi-GB transfer must not trip an 8-second abort. */
const SFTP_SETUP_TIMEOUT_MS = 8_000;

/**
 * Single source of truth for the forbidden-path regex. Applied at BOTH the
 * pre-SSH boundary (against the user-supplied `absolutePath`) AND inside the
 * SFTP callback (against the `sftp.realpath` resolved target) — the second
 * application is what actually closes the T-78-07 symlink-escape gap.
 */
const FORBIDDEN_PATH_RE = /^\/(proc|sys|dev)(\/|$)/;

/**
 * Hostname regex — matches DNS-legal friendly names as stored in `hosts.name`.
 * Applied in the shared helper before any DB lookup so a malformed hostname
 * short-circuits without touching the resolver.
 */
const HOSTNAME_RE = /^[a-zA-Z0-9._-]+$/;

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
const COMMON_RESPONSE_HEADERS = {
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
const EXT_INLINE: Record<string, string> = {
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

const EXT_ATTACH: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  xhtml: "application/xhtml+xml",
  svg: "image/svg+xml",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  cjs: "application/javascript; charset=utf-8",
};

const EXT_ASIS: Record<string, string> = {
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

type Disposition = "inline" | "attachment";
interface DispatchResult {
  contentType: string;
  disposition: Disposition;
}

function dispatchByExtensionOnly(ext: string | null): DispatchResult | null {
  if (!ext) return null;
  if (EXT_INLINE[ext]) return { contentType: EXT_INLINE[ext], disposition: "inline" };
  if (EXT_ATTACH[ext]) return { contentType: EXT_ATTACH[ext], disposition: "attachment" };
  if (EXT_ASIS[ext]) return { contentType: EXT_ASIS[ext], disposition: "inline" };
  return null;
}

function dispatchFromSniff(sample: Uint8Array): DispatchResult {
  return sniffTextBytes(sample)
    ? { contentType: "text/plain; charset=utf-8", disposition: "inline" }
    : { contentType: "application/octet-stream", disposition: "attachment" };
}

/* ------------------------------------------------------------------------ */
/*  Wire-up: auth middleware + permission manager                           */
/* ------------------------------------------------------------------------ */

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();

/* ------------------------------------------------------------------------ */
/*  SFTP promise wrappers (self-contained here — this file is now the       */
/*  canonical SFTP-wrapper precedent in the codebase; the SFTP              */
/*  side-channel that previously served plan-file fetches was retired in    */
/*  Phase 95 Part B alongside plan-mode deprecation).                       */
/* ------------------------------------------------------------------------ */

/** Minimal SFTP shape (duck-typed) — matches ssh2's SFTPWrapper for the
 * four methods we call. Kept local so mocks in the test file only need to
 * implement these four functions. */
type SftpLike = {
  realpath(
    p: string,
    cb: (err: Error | null, resolved: string) => void,
  ): void;
  stat(
    p: string,
    cb: (
      err: (Error & { code?: number }) | null,
      stats?: { size: number; isFile: () => boolean },
    ) => void,
  ): void;
  readFile(
    p: string,
    cb: (err: Error | null, data: Buffer) => void,
  ): void;
  /** Returns a Readable stream over the file. `options.start`/`options.end`
   * (inclusive) request a byte range; omitted = whole file. Used for both
   * the sniff-first-N-bytes fallback and full-body streaming. */
  createReadStream(
    p: string,
    options?: { start?: number; end?: number },
  ): Readable;
};

function openSftp(sshConn: SSHClientType): Promise<SftpLike> {
  return new Promise((resolve, reject) => {
    (
      sshConn as unknown as {
        sftp: (cb: (err: Error | null, sftp: SftpLike) => void) => void;
      }
    ).sftp((err, sftp) => {
      if (err) return reject(err);
      resolve(sftp);
    });
  });
}

function sftpRealpath(sftp: SftpLike, p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.realpath(p, (err, resolved) => {
      if (err) return reject(err);
      resolve(resolved);
    });
  });
}

function sftpStat(
  sftp: SftpLike,
  p: string,
): Promise<{ size: number; isFile: () => boolean }> {
  return new Promise((resolve, reject) => {
    sftp.stat(p, (err, stats) => {
      if (err || !stats) return reject(err ?? new Error("stat failed"));
      resolve(stats);
    });
  });
}

function sftpReadFile(sftp: SftpLike, p: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(p, (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

/** Read the first N bytes of a file via a bounded SFTP stream. Used only
 * for the sniff-fallback (unknown extension) — a full readFile would
 * defeat the "streaming" property of the GET path on the sniff step. */
function sftpReadHead(
  sftp: SftpLike,
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

/* ------------------------------------------------------------------------ */
/*  Shared fetch helper (private to this file)                              */
/*                                                                          */
/*  fetchHostFileBytes(userId, hostname, absolutePath)                      */
/*    → { bytes, host } on success                                          */
/*    → throws Error("<class>") on failure                                  */
/*                                                                          */
/*  Error taxonomy (message string classifies): invalid_hostname,           */
/*  path_must_be_absolute, path_traversal, path_forbidden, unknown_host,    */
/*  permission_denied, not_a_file, too_large. Underlying SSH errors bubble  */
/*  up unclassified — the handlers' catch blocks map them to the transport- */
/*  level classes (ssh_timeout, not_found, host_unreachable, etc.).         */
/* ------------------------------------------------------------------------ */

async function fetchHostFileBytes(
  userId: string,
  hostname: string,
  absolutePath: string,
): Promise<{ bytes: Buffer; host: SSHHost }> {
  // 1. Hostname validation
  if (!HOSTNAME_RE.test(hostname)) {
    throw new Error("invalid_hostname");
  }
  // 2. Absolute-path check
  if (!absolutePath.startsWith("/")) {
    throw new Error("path_must_be_absolute");
  }
  // 3. Traversal check
  if (
    absolutePath.includes("/../") ||
    absolutePath.endsWith("/..") ||
    absolutePath.includes("/./") ||
    absolutePath.endsWith("/.")
  ) {
    throw new Error("path_traversal");
  }
  // 4. Pre-SSH boundary check for /proc, /sys, /dev
  if (FORBIDDEN_PATH_RE.test(absolutePath)) {
    throw new Error("path_forbidden");
  }
  // 5. Host resolution (scoped to userId — cross-user isolation, RESEARCH Pitfall 7)
  const host = await resolveHostByName(hostname, userId);
  if (!host) {
    throw new Error("unknown_host");
  }
  // 6. Per-user-per-host RBAC
  const accessInfo = await permissionManager.canAccessHost(
    userId,
    host.id,
    "read",
  );
  if (!accessInfo.hasAccess) {
    throw new Error("permission_denied");
  }

  // 7. SSH/SFTP with AbortController-bounded overall timeout
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    // Trigger an AbortError-shaped rejection in the SFTP callback path via
    // the same abort signal Promise.race pattern used in this file's own SFTP wrappers above.
    ctrl.abort();
  }, SFTP_SETUP_TIMEOUT_MS);

  const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
  try {
    const bytes = await withConnection(
      poolKey,
      () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
      async (client) => {
        return await runWithAbort(ctrl.signal, async () => {
          const sftp = await openSftp(client);
          // W-2 symlink defense: resolve FIRST, re-check the resolved
          // target against FORBIDDEN_PATH_RE, THEN stat + read. Using the
          // resolved path for stat + read ensures size/isFile checks are
          // against what will actually be read (a symlink-to-oversized
          // file case is still capped).
          const resolvedPath = await sftpRealpath(sftp, absolutePath);
          if (FORBIDDEN_PATH_RE.test(resolvedPath)) {
            throw new Error("path_forbidden");
          }
          const stat = await sftpStat(sftp, resolvedPath);
          if (!stat.isFile()) {
            throw new Error("not_a_file");
          }
          if (stat.size > MAX_BYTES_POST) {
            throw new Error("too_large");
          }
          return await sftpReadFile(sftp, resolvedPath);
        });
      },
    );
    return { bytes, host };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Race a promise-returning task against an AbortSignal. If the signal fires
 * before the task settles, reject with an AbortError-shaped Error so the
 * handler catch blocks can map it to `ssh_timeout`.
 */
function runWithAbort<T>(
  signal: AbortSignal,
  task: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      const err = new Error("aborted");
      err.name = "AbortError";
      reject(err);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    task().then(
      (v) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/* ------------------------------------------------------------------------ */
/*  Extension helper (copied from pretty-view-fetch-tailnet-url.ts L96-101) */
/* ------------------------------------------------------------------------ */

function extractExtension(filename: string): string | null {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1 || dotIdx === filename.length - 1) return null;
  return filename.slice(dotIdx + 1).toLowerCase();
}

/* ------------------------------------------------------------------------ */
/*  POST handler — modal JSON path                                          */
/*                                                                          */
/*  Contract: 200 with TailnetFetchResult envelope on success; JSON         */
/*  { error: "<class>" } with a distinct HTTP status per class on failure.  */
/* ------------------------------------------------------------------------ */

async function postHandler(req: Request, res: Response): Promise<void> {
  const startEpoch = Date.now();
  // Body validation — only class the shared helper can't check (the body
  // itself doesn't exist yet).
  const body = req.body;
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof (body as Record<string, unknown>).hostname !== "string" ||
    typeof (body as Record<string, unknown>).absolutePath !== "string"
  ) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const { hostname, absolutePath } = body as {
    hostname: string;
    absolutePath: string;
  };
  const userId = (req as Request & { userId: string }).userId;

  try {
    const { bytes } = await fetchHostFileBytes(userId, hostname, absolutePath);
    const filename = absolutePath.split("/").pop() ?? "";
    const extension = extractExtension(filename);
    const isTextByExt = classifyByExtension(extension, filename);
    const isTextByBytes = isTextByExt
      ? undefined
      : sniffTextBytes(new Uint8Array(bytes));

    res.status(200).json({
      contentBase64: bytes.toString("base64"),
      sizeBytes: bytes.byteLength,
      contentType: null,
      extension,
      filename,
      isTextByExt,
      isTextByBytes,
    });
    sshLogger.info("pretty-view proxy: ok", {
      operation: "pretty_view_fetch_host_file",
      host: `${hostname}:sftp`,
      duration: Date.now() - startEpoch,
    });
  } catch (err) {
    const status = classifyErrorToStatus(err);
    const errorClass = classifyErrorToClass(err);
    // T-40-05 invariant: NEVER include err.message in the body — leaks
    // paths / SSH usernames / stack info. Only the classified string.
    res.status(status).json({ error: errorClass });
    sshLogger.warn("pretty-view proxy: sftp error", {
      operation: "pretty_view_fetch_host_file",
      host: `${hostname}:sftp`,
      errorClass: err instanceof Error ? err.name : "unknown",
      duration: Date.now() - startEpoch,
    });
  }
}

/* ------------------------------------------------------------------------ */
/*  GET handler — verbatim URL path (streamed)                              */
/*                                                                          */
/*  Contract:                                                               */
/*    - 200 OK: real per-extension content-type, `Accept-Ranges: bytes`,    */
/*      body streamed from SFTP; optional `Content-Disposition: attachment` */
/*      for executable types (html/js/svg/xhtml).                           */
/*    - 206 Partial Content: same as 200 plus `Content-Range: bytes X-Y/Z`, */
/*      body is the requested byte range only.                              */
/*    - 4xx/5xx errors: text/plain body with classified error string,       */
/*      no partial body written.                                            */
/*                                                                          */
/*  All responses carry `X-Content-Type-Options: nosniff` and               */
/*  `Cache-Control: no-store`.                                              */
/* ------------------------------------------------------------------------ */

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
type RangeSpec = { start: number; end: number };
function parseRangeHeader(
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

function sendErrorText(
  res: Response,
  status: number,
  errorClass: string,
): void {
  res.set({
    ...COMMON_RESPONSE_HEADERS,
    "content-type": "text/plain; charset=utf-8",
  });
  res.status(status).send(errorTextBody(errorClass));
}

async function getHandler(req: Request, res: Response): Promise<void> {
  const startEpoch = Date.now();
  const hostname =
    typeof req.params.host === "string" ? req.params.host : "";
  // Express 5 / path-to-regexp v8+: `*path` captures the tail as an
  // ARRAY of already-URL-decoded path segments in `req.params.path`.
  const rawSegments = (req.params as unknown as { path?: string[] | string })
    .path;
  const segments = Array.isArray(rawSegments)
    ? rawSegments
    : rawSegments
      ? [rawSegments]
      : [];
  if (segments.length === 0 || segments.every((s) => s.length === 0)) {
    sendErrorText(res, 400, "path_must_be_absolute");
    return;
  }
  const absolutePath = "/" + segments.join("/");
  const userId = (req as Request & { userId: string }).userId;

  // Pre-SSH synchronous validation — same shape as fetchHostFileBytes, but
  // we short-circuit BEFORE grabbing an SSH pool slot on obvious rejects.
  if (!HOSTNAME_RE.test(hostname)) {
    sendErrorText(res, 400, "invalid_hostname");
    return;
  }
  if (!absolutePath.startsWith("/")) {
    sendErrorText(res, 400, "path_must_be_absolute");
    return;
  }
  if (
    absolutePath.includes("/../") ||
    absolutePath.endsWith("/..") ||
    absolutePath.includes("/./") ||
    absolutePath.endsWith("/.")
  ) {
    sendErrorText(res, 400, "path_traversal");
    return;
  }
  if (FORBIDDEN_PATH_RE.test(absolutePath)) {
    sendErrorText(res, 400, "path_forbidden");
    return;
  }

  let host: SSHHost;
  try {
    const resolved = await resolveHostByName(hostname, userId);
    if (!resolved) {
      sendErrorText(res, 404, "unknown_host");
      return;
    }
    const accessInfo = await permissionManager.canAccessHost(
      userId,
      resolved.id,
      "read",
    );
    if (!accessInfo.hasAccess) {
      sendErrorText(res, 403, "permission_denied");
      return;
    }
    host = resolved;
  } catch (err) {
    sshLogger.warn("pretty-view proxy: pre-SSH failure (GET)", {
      operation: "pretty_view_fetch_host_file_get",
      host: `${hostname}:sftp`,
      errorClass: err instanceof Error ? err.name : "unknown",
      duration: Date.now() - startEpoch,
    });
    sendErrorText(res, 502, "host_unreachable");
    return;
  }

  const rangeHeader =
    typeof req.headers.range === "string" ? req.headers.range : undefined;
  const filename = absolutePath.split("/").pop() ?? "";
  const extension = extractExtension(filename);

  // SSH setup timer — bounds realpath + stat + (optional) sniff read +
  // stream open. Cleared before the stream starts piping bytes: the
  // subsequent multi-GB transfer must not trip an 8-second abort.
  const ctrl = new AbortController();
  const setupTimer = setTimeout(
    () => ctrl.abort(),
    SFTP_SETUP_TIMEOUT_MS,
  );
  const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;

  try {
    await withConnection(
      poolKey,
      () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
      async (client) => {
        await runWithAbort(ctrl.signal, async () => {
          const sftp = await openSftp(client);

          // Symlink defense (T-78-07): resolve FIRST, re-check the resolved
          // target against FORBIDDEN_PATH_RE, THEN stat and stream. Using
          // the resolved path for stat + stream ensures the size/isFile
          // checks are against what will actually be read.
          const resolvedPath = await sftpRealpath(sftp, absolutePath);
          if (FORBIDDEN_PATH_RE.test(resolvedPath)) {
            throw new Error("path_forbidden");
          }
          const stat = await sftpStat(sftp, resolvedPath);
          if (!stat.isFile()) {
            throw new Error("not_a_file");
          }
          if (stat.size > MAX_BYTES_GET) {
            throw new Error("too_large");
          }

          // Dispatch content-type. Extension-table hit is the fast path;
          // unknown extension falls back to reading the first SNIFF_BYTES
          // and running the shared file(1)-style heuristic.
          let dispatch = dispatchByExtensionOnly(extension);
          if (!dispatch) {
            // Empty file → sniff on zero bytes returns text (empty), fine.
            const sampleSize = Math.min(SNIFF_BYTES, stat.size);
            const sample =
              sampleSize > 0
                ? await sftpReadHead(sftp, resolvedPath, sampleSize)
                : Buffer.alloc(0);
            dispatch = dispatchFromSniff(new Uint8Array(sample));
          }

          // Range handling. `null` = no Range header (full body 200).
          // Object = single-range parse (206 partial). `"unsatisfiable"` =
          // 416 with `Content-Range: bytes */<size>` per RFC 7233 §4.4.
          const rangeParsed = parseRangeHeader(rangeHeader, stat.size);
          if (rangeParsed === "unsatisfiable") {
            res.set({
              ...COMMON_RESPONSE_HEADERS,
              "content-type": "text/plain; charset=utf-8",
              "content-range": `bytes */${stat.size}`,
            });
            res.status(416).send("range_not_satisfiable");
            return;
          }

          // Set final response headers. Content-Length uses the streamed-
          // byte count (either the full size or the range window).
          const streamStart = rangeParsed?.start ?? 0;
          const streamEnd = rangeParsed?.end ?? stat.size - 1;
          const contentLength =
            stat.size === 0 ? 0 : streamEnd - streamStart + 1;
          const responseHeaders: Record<string, string> = {
            ...COMMON_RESPONSE_HEADERS,
            "content-type": dispatch.contentType,
            "accept-ranges": "bytes",
            "content-length": String(contentLength),
          };
          if (dispatch.disposition === "attachment") {
            // filename= exposes the basename by design — a save-as dialog
            // needs it. The absolute path stays server-side per T-40-05.
            const safeFilename = filename.replace(/["\\\r\n]/g, "_");
            responseHeaders["content-disposition"] =
              `attachment; filename="${safeFilename}"`;
          }
          if (rangeParsed) {
            responseHeaders["content-range"] =
              `bytes ${streamStart}-${streamEnd}/${stat.size}`;
          }
          res.set(responseHeaders);
          res.status(rangeParsed ? 206 : 200);

          // Setup done — clear the setup timer BEFORE we start piping.
          // A multi-GB transfer at slow bandwidth can legitimately take
          // minutes; the SFTP_SETUP_TIMEOUT_MS budget was for setup only.
          clearTimeout(setupTimer);

          // Empty-body fast path — nothing to stream. Some clients close
          // on the response headers alone; explicit end() is safest.
          if (contentLength === 0) {
            res.end();
            return;
          }

          // Open the payload stream. `end` in ssh2's createReadStream is
          // inclusive (matches fs.createReadStream semantics).
          const stream = sftp.createReadStream(resolvedPath, {
            start: streamStart,
            end: streamEnd,
          });

          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (err?: Error) => {
              if (settled) return;
              settled = true;
              if (err) reject(err);
              else resolve();
            };

            stream.on("error", (err: Error) => {
              // Mid-stream failure. If headers are already flushed we
              // can't send a proper error body — the best we can do is
              // destroy the response so the client sees a truncated
              // transfer and (for media) retries via Range.
              try {
                if (!res.headersSent) {
                  // Should be unreachable — we already set headers above,
                  // but guard anyway.
                  sendErrorText(res, 502, "host_unreachable");
                } else {
                  res.destroy();
                }
              } catch {
                /* ignore secondary error */
              }
              finish(err);
            });

            // Client-side hangup (tab closed, download cancelled). Kill
            // the SFTP stream so we release the SSH channel promptly.
            res.on("close", () => {
              stream.destroy();
              finish();
            });

            stream.on("end", () => finish());

            stream.pipe(res);
          });
        });
      },
    );

    sshLogger.info("pretty-view proxy: ok (GET)", {
      operation: "pretty_view_fetch_host_file_get",
      host: `${hostname}:sftp`,
      duration: Date.now() - startEpoch,
      range: rangeHeader ? "yes" : "no",
    });
  } catch (err) {
    const status = classifyErrorToStatus(err);
    const errorClass = classifyErrorToClass(err);
    if (!res.headersSent) {
      sendErrorText(res, status, errorClass);
    } else {
      // Already committed to a streaming response — can't rewrite headers.
      // Just tear down and log.
      try {
        res.destroy();
      } catch {
        /* ignore */
      }
    }
    sshLogger.warn("pretty-view proxy: sftp error (GET)", {
      operation: "pretty_view_fetch_host_file_get",
      host: `${hostname}:sftp`,
      errorClass: err instanceof Error ? err.name : "unknown",
      duration: Date.now() - startEpoch,
    });
  } finally {
    clearTimeout(setupTimer);
  }
}

/* ------------------------------------------------------------------------ */
/*  Error classification helpers                                            */
/*                                                                          */
/*  Both POST and GET use the exact same taxonomy — only the response       */
/*  shape (JSON vs text) differs.                                           */
/* ------------------------------------------------------------------------ */

/** Maps a caught error to its HTTP status code. */
function classifyErrorToStatus(err: unknown): number {
  const name = err instanceof Error ? err.name : "unknown";
  const msg = err instanceof Error ? err.message : "";
  if (name === "AbortError") return 504;
  if (msg === "invalid_hostname") return 400;
  if (msg === "path_must_be_absolute") return 400;
  if (msg === "path_traversal") return 400;
  if (msg === "path_forbidden") return 400;
  if (msg === "unknown_host") return 404;
  if (msg === "permission_denied") return 403;
  if (msg === "not_a_file") return 400;
  if (msg === "too_large") return 413;
  if (msg.includes("ENOENT") || msg.includes("No such file")) return 404;
  if (msg.includes("Permission") || msg.includes("EACCES")) return 403;
  return 502;
}

/** Maps a caught error to its classified error-class string. */
function classifyErrorToClass(err: unknown): string {
  const name = err instanceof Error ? err.name : "unknown";
  const msg = err instanceof Error ? err.message : "";
  if (name === "AbortError") return "ssh_timeout";
  if (
    msg === "invalid_hostname" ||
    msg === "path_must_be_absolute" ||
    msg === "path_traversal" ||
    msg === "path_forbidden" ||
    msg === "unknown_host" ||
    msg === "permission_denied" ||
    msg === "not_a_file" ||
    msg === "too_large"
  ) {
    return msg;
  }
  if (msg.includes("ENOENT") || msg.includes("No such file")) return "not_found";
  if (msg.includes("Permission") || msg.includes("EACCES")) {
    return "permission_denied";
  }
  return "host_unreachable";
}

/**
 * Human-readable text body for a classified error. Format is
 * `<class>: <short sentence>` — the class string is always the leading
 * token so downstream automated tooling can parse it out.
 *
 * NEVER includes `err.message`, `absolutePath`, or `filename` (T-40-05
 * invariant); the sentences below are static per error class.
 */
function errorTextBody(errorClass: string): string {
  switch (errorClass) {
    case "invalid_hostname":
      return "invalid_hostname: hostname contains characters outside [a-zA-Z0-9._-]";
    case "path_must_be_absolute":
      return "path_must_be_absolute: path must start with /";
    case "path_traversal":
      return "path_traversal: . and .. segments are not allowed";
    case "path_forbidden":
      return "path_forbidden: /proc, /sys, and /dev are not accessible via file URLs";
    case "unknown_host":
      return "unknown_host: host is not registered on this server or you do not have access to it";
    case "permission_denied":
      return "permission_denied: you do not have read access to this file on this host";
    case "not_a_file":
      return "not_a_file: directories, sockets, and device files are not viewable via file URLs";
    case "too_large":
      return "too_large: file exceeds the endpoint size cap";
    case "not_found":
      return "not_found: no such file at that path";
    case "ssh_timeout":
      return "ssh_timeout: the host is slow or unreachable — try again in a moment";
    case "host_unreachable":
    default:
      return "host_unreachable: the box may be offline or the SSH channel is down";
  }
}

/* ------------------------------------------------------------------------ */
/*  Router exports (split-router pattern — W-3)                             */
/*                                                                          */
/*  Two NARROW routers, each with exactly ONE handler:                      */
/*    - prettyViewFetchHostFileRoutes: POST /fetch-host-file only           */
/*    - fileUrlRoutes:                 GET  /file/:host/*   only            */
/*                                                                          */
/*  Ghost aliases return 404 by construction because the wrong-prefix       */
/*  router has no matching (method, path) pair.                             */
/* ------------------------------------------------------------------------ */

export const prettyViewFetchHostFileRoutes = express.Router();
// Body-limit BEFORE auth (belt-and-suspenders — rejects oversized bodies
// without touching auth). Matches pretty-view-fetch-tailnet-url.ts L109-114.
// 8 KB because absolute paths can be longer than tailnet URLs (which use 2 KB).
prettyViewFetchHostFileRoutes.post("/fetch-host-file", express.json({ limit: "8kb" }), authenticateJWT, postHandler);

export const fileUrlRoutes = express.Router();
// Express 5 uses path-to-regexp v8+, which requires named wildcard params
// (bare `*` fails at load time with "Missing parameter name at index N").
// `{/*path}` captures the tail into `req.params.path` (array in v8+) AS
// AN OPTIONAL WILDCARD — matches both `/file/host/foo/bar` (path=["foo",
// "bar"]) AND `/file/host/` (path=undefined). We surface the trailing-
// slash case as a `path_must_be_absolute` error inside the handler so the
// GET route's error taxonomy covers it uniformly (per Test 20).
fileUrlRoutes.get("/file/:host{/*path}", authenticateJWT, getHandler);
