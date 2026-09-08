/**
 * Phase 75 Plan 75-01 (D-01, D-04): SSH/SFTP-backed file-fetch surfaces for
 * agent-cited file URLs. The URL an agent writes into a chat message is the
 * URL the user clicks — and now also the URL a browser tab resolves — so
 * the shape philosophy (agents-aren't-lied-to) needs BOTH surfaces:
 *
 *   POST /pretty-view/fetch-host-file   — modal JSON path (existing UX)
 *   GET  /file/:host/*                  — verbatim URL path (agent-cited
 *                                          URL opened in a fresh browser tab)
 *
 * Both surfaces share a private `fetchHostFileBytes(userId, hostname,
 * absolutePath)` helper that owns ALL auth + resolve + guardrails + realpath
 * + stat + read logic. No handler-code duplication between POST and GET;
 * only response-shaping differs.
 *
 * Split-router mount pattern (checker W-3): this file exports TWO NARROW
 * Express routers, each with exactly ONE handler. `prettyViewFetchHostFileRoutes`
 * has ONLY a POST handler and is mounted at `/pretty-view`;
 * `fileUrlRoutes` has ONLY a GET handler and is mounted at `/`. This
 * eliminates the ghost-alias attack surface a single-router-mounted-twice
 * design would create: `POST /fetch-host-file` at root and `GET
 * /pretty-view/file/:host/*` both return 404 by construction because the
 * wrong-prefix router has no matching handler.
 *
 * Symlink-escape defense (T-78-07): the shared helper calls
 * `sftp.realpath(absolutePath)` BEFORE `sftp.stat` and re-applies the same
 * `FORBIDDEN_PATH_RE` regex to the resolved target. A symlink from
 * `/home/ubuntu/nasty-link` → `/proc/kmsg` is rejected here — BEFORE any
 * stat or read — because the pre-SSH check on the user-supplied path alone
 * cannot see the resolved target. `sftp.stat` returns Stats only, NOT a
 * path, so `sftp.realpath` is the only ssh2 API that closes this gap.
 *
 * XSS defense (T-78-01-GET1): the GET handler forces
 * `Content-Type: text/plain; charset=utf-8` on ALL responses regardless of
 * file extension, sets `X-Content-Type-Options: nosniff`, and sets
 * `Cache-Control: no-store`. A user-writeable `evil.html` served as
 * text/plain will render as text (not execute); no cache poisoning across
 * users on shared browser profiles.
 *
 * Info-leak invariant (T-40-05, inherited from pretty-view-fetch-tailnet-url.ts):
 * `err.message`, `absolutePath`, and `filename` NEVER appear in response
 * bodies (JSON on POST, raw text on GET). Server logs may include
 * `errorClass = err.name`, host+port, and duration only.
 */

import express from "express";
import type { Request, Response } from "express";
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

/** Max response-body size (bytes). Matches Phase 40's cap in
 * pretty-view-fetch-tailnet-url.ts — the fleet's established "reasonable
 * text file" ceiling. Anything larger → 413. */
const MAX_BYTES = 2_000_000;

/** SSH connect timeout for `connectOneShot` (ms). */
const SSH_CONNECT_TIMEOUT_MS = 5_000;

/** Whole-operation SFTP timeout (ms) — bounds realpath + stat + readFile. */
const SFTP_READ_TIMEOUT_MS = 8_000;

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
 * Headers forced on EVERY GET response (200 + all error paths). Set at the
 * top of the GET handler via `res.set(PLAIN_TEXT_HEADERS)` so error branches
 * inherit them without repetition.
 *
 * - `content-type: text/plain; charset=utf-8` — XSS defense T-78-01-GET1;
 *   never render user-served bytes as HTML/JS/SVG in the browser.
 * - `x-content-type-options: nosniff` — belt-and-braces against Chrome/Safari
 *   MIME-sniffing heuristics that might override the declared type.
 * - `cache-control: no-store` — cross-user cache poisoning defense
 *   (T-78-01-GET2); every hit is a fresh auth-checked backend round-trip.
 */
const PLAIN_TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
} as const;

/* ------------------------------------------------------------------------ */
/*  Wire-up: auth middleware + permission manager                           */
/* ------------------------------------------------------------------------ */

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();

/* ------------------------------------------------------------------------ */
/*  SFTP promise wrappers (mirrors plan-file-fetch.ts L122-163 verbatim)    */
/*                                                                          */
/*  Copied locally rather than exported from plan-file-fetch.ts because     */
/*  the plan-file-fetch SftpLike type is module-private. Behaviour is       */
/*  identical.                                                              */
/* ------------------------------------------------------------------------ */

/** Minimal SFTP shape (duck-typed) — matches ssh2's SFTPWrapper for the
 * three methods we call. Kept local so mocks in the test file only need to
 * implement these three functions. */
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
    // the same abort signal Promise.race pattern used in plan-file-fetch.ts.
    ctrl.abort();
  }, SFTP_READ_TIMEOUT_MS);

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
          if (stat.size > MAX_BYTES) {
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
/*  GET handler — verbatim URL path                                         */
/*                                                                          */
/*  Contract: 200 with RAW file bytes on success (Content-Type forced       */
/*  text/plain; charset=utf-8 regardless of file extension). Errors return  */
/*  a short human-readable text body (NOT JSON) with the classified error   */
/*  string. All responses (success + error) carry the three defense         */
/*  headers.                                                                */
/* ------------------------------------------------------------------------ */

async function getHandler(req: Request, res: Response): Promise<void> {
  // Set the three defense headers FIRST so error branches inherit them
  // without repetition.
  res.set(PLAIN_TEXT_HEADERS);

  const startEpoch = Date.now();
  const hostname = req.params.host;
  // Express 5 / path-to-regexp v8+: `*path` captures the tail as an
  // ARRAY of already-URL-decoded path segments in `req.params.path`.
  // Join with `/` and re-add the leading slash per D-01
  // (`GET /file/thenasty/etc/hostname` → absolutePath `/etc/hostname`).
  // Empty tail (`GET /file/thenasty/`) surfaces as an empty array OR
  // undefined depending on the router version — treat both as
  // `path_must_be_absolute`.
  const rawSegments = (req.params as unknown as { path?: string[] | string })
    .path;
  const segments = Array.isArray(rawSegments)
    ? rawSegments
    : rawSegments
      ? [rawSegments]
      : [];
  if (segments.length === 0 || segments.every((s) => s.length === 0)) {
    res.set(PLAIN_TEXT_HEADERS);
    res.status(400).send(errorTextBody("path_must_be_absolute"));
    return;
  }
  const absolutePath = "/" + segments.join("/");
  const userId = (req as Request & { userId: string }).userId;

  try {
    const { bytes } = await fetchHostFileBytes(userId, hostname, absolutePath);
    // Bytes go out AS-IS; headers already set at top force text/plain.
    // Re-assert the headers on send in case Express touched them.
    res.set(PLAIN_TEXT_HEADERS);
    res.status(200).send(bytes);
    sshLogger.info("pretty-view proxy: ok (GET)", {
      operation: "pretty_view_fetch_host_file_get",
      host: `${hostname}:sftp`,
      duration: Date.now() - startEpoch,
    });
  } catch (err) {
    const status = classifyErrorToStatus(err);
    const errorClass = classifyErrorToClass(err);
    // Re-assert headers before send to ensure error responses ALSO carry the
    // defense headers (T-78-01-GET1/GET2 defense holds on 401/403/404/413/
    // 502/504 too).
    res.set(PLAIN_TEXT_HEADERS);
    res.status(status).send(errorTextBody(errorClass));
    sshLogger.warn("pretty-view proxy: sftp error (GET)", {
      operation: "pretty_view_fetch_host_file_get",
      host: `${hostname}:sftp`,
      errorClass: err instanceof Error ? err.name : "unknown",
      duration: Date.now() - startEpoch,
    });
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
      return "unknown_host: host is not registered in this Skynet or you do not have access to it";
    case "permission_denied":
      return "permission_denied: you do not have read access to this file on this host";
    case "not_a_file":
      return "not_a_file: directories, sockets, and device files are not viewable via file URLs";
    case "too_large":
      return "too_large: file exceeds the 2 MB cap";
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
