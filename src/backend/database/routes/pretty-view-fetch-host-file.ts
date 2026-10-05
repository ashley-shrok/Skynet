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
import {
  COMMON_RESPONSE_HEADERS,
  extractExtension,
  sendSftpFile,
} from "../../utils/sftp-file-response.js";
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

          // Content-type dispatch, Range (206 / 416) and streaming live in
          // the shared sftp-file-response helper. The setup timer is cleared
          // once bytes start flowing: a multi-GB transfer at slow bandwidth
          // can legitimately take minutes.
          await sendSftpFile({
            req,
            res,
            sftp,
            path: resolvedPath,
            size: stat.size,
            filename,
            disposition: "auto",
            onStreamStart: () => clearTimeout(setupTimer),
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
