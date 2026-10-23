/**
 * Skynet file URLs: `<origin>/file/<host>/<abs-path>`.
 *
 * The chat renders same-origin file URLs as FileChips; a file pane is keyed
 * by the (host, path) pair the URL carries and rebuilds the URL from it.
 */

/** Longest host segment / path a file pane accepts (URL-fragment safety). */
export const FILE_PANE_MAX_HOST = 253;
export const FILE_PANE_MAX_PATH = 4096;
const FILE_HOST_RE = /^[a-zA-Z0-9._-]+$/;

// Returns true iff `href` is a Skynet-served file URL on THIS same origin.
// Anchoring to `window.location.origin` closes an assistant-plants-tracking-
// -pixel attack: an untrusted markdown link like
// `https://attacker.tld/file/x/tracker.png` would otherwise render as a
// FileChip whose <img src> fires a cookie-bearing request to attacker.tld,
// leaking the user's presence. Same-origin URLs go through Skynet's own
// backend, which already enforces host permissions.
export function isSkynetFileUrl(href: string | undefined): boolean {
  if (!href) return false;
  if (typeof window === "undefined") return false;
  const prefix = `${window.location.origin}/file/`;
  return href.startsWith(prefix);
}

/**
 * Build a Skynet file URL from a host name and an absolute landing path.
 * Encodes each path segment defensively so filenames with spaces, unicode,
 * or reserved URL characters (`?` `#` `%` `&`) survive without injecting
 * query / fragment syntax into the URL. The `/` separator is preserved.
 */
export function buildSkynetFileUrl(hostName: string, landingPath: string): string {
  const encodedHost = encodeURIComponent(hostName);
  const encodedPath = landingPath
    .split("/")
    .filter((seg) => seg.length > 0)
    .map(encodeURIComponent)
    .join("/");
  return `${window.location.origin}/file/${encodedHost}/${encodedPath}`;
}

/** True when (host, path) is a well-formed file-pane address. */
export function isValidFileAddress(host: unknown, path: unknown): host is string {
  return (
    typeof host === "string" &&
    host.length > 0 &&
    host.length <= FILE_PANE_MAX_HOST &&
    FILE_HOST_RE.test(host) &&
    typeof path === "string" &&
    path.startsWith("/") &&
    path.length <= FILE_PANE_MAX_PATH
  );
}

/**
 * Split a same-origin Skynet file URL into its host segment and decoded
 * absolute path. Null for anything else (other origins, malformed escapes,
 * a missing path).
 */
export function parseSkynetFileUrl(href: string): { host: string; path: string } | null {
  if (!isSkynetFileUrl(href)) return null;
  let pathname: string;
  try {
    pathname = new URL(href).pathname;
  } catch {
    return null;
  }
  const m = /^\/file\/([^/]+)(\/.+)$/.exec(pathname);
  if (!m) return null;
  let host: string;
  let path: string;
  try {
    host = decodeURIComponent(m[1]);
    path = m[2]
      .split("/")
      .map((seg) => decodeURIComponent(seg))
      .join("/");
  } catch {
    return null;
  }
  return isValidFileAddress(host, path) ? { host, path } : null;
}

/** Last path segment — the file's name. */
export function fileNameOfPath(path: string): string {
  const segs = path.split("/").filter(Boolean);
  return segs.length > 0 ? segs[segs.length - 1] : "file";
}

/**
 * Drag payload a FileChip writes: JSON `{ host, path, filename, origin? }`.
 * `origin` is the encoded tab spec of the conversation the chip sits in.
 * Never paired with text/plain (stray-drag hardening, same as app tiles).
 */
export const FILE_CHIP_MIME = "application/x-skynet-file-chip";

export interface FileChipDragPayload {
  host: string;
  path: string;
  filename: string;
  origin?: string | null;
}

const MAX_ORIGIN = 1024;

/** Parse + validate a FILE_CHIP_MIME payload. Null when malformed. */
export function parseFileChipPayload(json: string): FileChipDragPayload | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isValidFileAddress(r.host, r.path)) return null;
  const path = r.path as string;
  const filename =
    typeof r.filename === "string" && r.filename.trim().length > 0
      ? r.filename.trim().slice(0, 255)
      : fileNameOfPath(path);
  const origin =
    typeof r.origin === "string" && r.origin.length > 0 && r.origin.length <= MAX_ORIGIN
      ? r.origin
      : null;
  return { host: r.host, path, filename, origin };
}

/**
 * Window event a file pane fires to have its source conversation open the
 * file modal (so Save attaches to that conversation). Cancelable: the
 * conversation that takes it calls preventDefault(), so the pane knows it
 * was handled.
 */
export const OPEN_FILE_IN_CONVERSATION_EVENT = "skynet:open-file-in-conversation";

export interface OpenFileInConversationDetail {
  /** Encoded tab spec of the conversation (see lib/tab-url.ts). */
  origin: string;
  url: string;
  filename: string;
}
