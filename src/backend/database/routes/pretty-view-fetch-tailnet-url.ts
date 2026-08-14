/**
 * Phase 40 Plan 40-01 (D-01, D-04): SSRF-hardened proxy for agent-served
 * tailnet URLs - POST /pretty-view/fetch-tailnet-url.
 *
 * Purpose
 * -------
 * Skynet's browser client cannot reliably reach `http://100.x.y.z:PORT/...`
 * URLs (the id-skill's `python3 -m http.server` pattern for handing Ashley
 * files) because:
 *   * Skynet is served HTTPS in production -> browser blocks mixed HTTP content.
 *   * `python -m http.server` sets no CORS headers.
 *   * The tailnet IP may not be routable from Ashley's device (only Skynet is
 *     guaranteed on the Tailnet).
 * The backend, being on the tailnet, proxies the fetch on Ashley's behalf.
 *
 * Response shape (single call covers both the eligibility path and the
 * editor-open re-fetch path per D-02, D-04):
 *   {
 *     contentBase64: string,       // base64 of the raw response bytes
 *     sizeBytes: number,           // response body length in bytes
 *     contentType: string | null,  // Content-Type header as-served
 *     extension: string | null,    // lowercased, no leading dot; null if none
 *     filename: string,            // decoded filename from URL path
 *     isTextByExt: boolean,        // whitelist hit? (extension or basename)
 *     isTextByBytes?: boolean      // sniff verdict (only when isTextByExt=false)
 *   }
 *
 * Threat model
 * ------------
 * T-40-01 (SSRF / info-disclosure / EoP):
 *   * TAILNET_URL_RE allowlists only 100.64.0.0/10 CGNAT range (Tailscale).
 *   * Rejects http://localhost, 127.0.0.1, RFC1918 (10.x, 192.168.x), link-
 *     local (169.254.x), any non-http:// scheme (https://, file://, etc.).
 *   * Regex requires a non-empty filename after the port (no directory URLs).
 *   * Extra defense-in-depth path guards reject "..", "//" in the path, and
 *     trailing "/" - all suggest directory-listing / traversal intent.
 *   * All checks fire BEFORE any outbound fetch.
 * T-40-02 (directory-listing HTML spoof):
 *   * python -m http.server returns HTML for directory URLs. If the
 *     upstream returns a content-type containing "html" for a URL whose
 *     filename extension is NOT .html / .htm, reject at 502.
 * T-40-03 (DoS via oversized / slow upstream):
 *   * express.json({ limit: "2kb" }) on the request body (URLs are short).
 *   * FETCH_TIMEOUT_MS = 8_000 (matches UI-SPEC L175) via AbortController.
 *   * MAX_BYTES = 2_000_000 -> 413 on oversized response (matches the fleet's
 *     established "reasonable text file" ceiling in global-files-read-write.ts).
 * T-40-04 (unauthenticated access):
 *   * authenticateJWT middleware wired at the route. Tailnet ITSELF is the
 *     ACL boundary (ASVS V4) - no per-user URL allowlist is needed because
 *     the CGNAT range is inherently network-scoped.
 * T-40-05 (URL leakage in server logs):
 *   * sshLogger.info logs host+port only. Filename is OMITTED (Ashley-served
 *     files are sensitive by definition). Error paths log error class name
 *     only - no error.message, no URL.
 *
 * Node runtime: Node 18+ has globalThis.fetch globally; this file uses that
 * directly. If the ship image ever regresses to Node <18, swap to undici
 * (already a resident dep - package.json lists undici ^7.0.0).
 */

import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { sshLogger } from "../../utils/logger.js";
import { classifyByExtension } from "../../utils/editable-file-whitelist.js";
import { sniffTextBytes } from "../../utils/editable-file-byte-sniff.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/**
 * Tailnet CGNAT URL allowlist (Tailscale uses 100.64.0.0/10):
 *   - Only http:// scheme (the id-skill's python3 -m http.server is unencrypted).
 *   - Second octet 64..127 (regex enforces 64-69 | 70-99 | 100-119 | 120-127).
 *   - Third + fourth octets 0..999 (character-class permissive; the second-
 *     octet range is the tight guard).
 *   - Port required (1..65535 by length).
 *   - Path must start with a NON-slash and contain no `#`. `?query` is allowed
 *     (rev-3 2026-08-14 code-review H1: client regex accepts `?query`, backend
 *     must too — otherwise valid URLs pass the client eligibility check but
 *     fail the modal open with a misleading "server auto-killed" error).
 *   - This also rejects the trailing-"/" (empty filename) case at the regex
 *     level, because the [^/] class requires at least one non-slash first char.
 */
const TAILNET_URL_RE = /^http:\/\/100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}:\d{1,5}\/[^/][^#]*$/;

/** Outbound fetch timeout - matches UI-SPEC L175 ("timeout > 8s"). */
const FETCH_TIMEOUT_MS = 8_000;

/** Max response-body size (bytes). Matches MAX_CONTENT_BYTES in
 * global-files-read-write.ts L76 - the fleet's established "reasonable text file"
 * ceiling. Anything larger -> 413. */
const MAX_BYTES = 2_000_000;

/** Extract the (lowercased, dot-stripped) extension from a filename, or null. */
function extractExtension(filename: string): string | null {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1 || dotIdx === filename.length - 1) return null;
  return filename.slice(dotIdx + 1).toLowerCase();
}

// ---------------------------------------------------------------------------
// POST /fetch-tailnet-url
// ---------------------------------------------------------------------------

router.post(
  "/fetch-tailnet-url",
  // Request body is a tiny { url } JSON object - 2 KB is very generous. Placing
  // the limit BEFORE authenticateJWT rejects malformed / oversized bodies
  // without touching auth (matches the belt-and-suspenders pattern in
  // global-files-read-write.ts).
  express.json({ limit: "2kb" }),
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const startEpoch = Date.now();

    // -----------------------------------------------------------------------
    // 1. Body schema: plain object with a string 'url' field
    // -----------------------------------------------------------------------
    const body = req.body;
    if (
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof (body as Record<string, unknown>).url !== "string"
    ) {
      res.status(400).json({ error: "invalid body" });
      return;
    }
    const url = (body as { url: string }).url;

    // -----------------------------------------------------------------------
    // 2. URL validation matrix (T-40-01 SSRF gate)
    //    Regex enforces the CGNAT + scheme + non-empty-filename shape.
    //    Extra guards below reject path traversal AND double-slash AND
    //    trailing slash - defense-in-depth on top of the regex.
    // -----------------------------------------------------------------------
    if (!TAILNET_URL_RE.test(url)) {
      res.status(400).json({ error: "invalid tailnet URL" });
      return;
    }
    if (url.endsWith("/")) {
      res.status(400).json({ error: "invalid tailnet URL" });
      return;
    }
    // "//" only in the "http://" prefix - reject any additional occurrence.
    if (url.indexOf("//", 7) !== -1) {
      res.status(400).json({ error: "invalid tailnet URL" });
      return;
    }
    // Raw-URL path-traversal check: reject any traversal-shaped segment in the
    // raw URL before it's parsed. This runs BEFORE `new URL(...)` because
    // WHATWG URL normalizes `/../` to nothing (a`/a/../b` becomes `/b`),
    // which would hide a traversal attempt from the decoded-segment check
    // below. We check both literal `..` / `.` AND their percent-encoded
    // forms (`%2e%2e`, `%2E`, mixed case, `%2e.` half-encoded, etc.) by
    // decoding the raw path first.
    const pathStart = url.indexOf("/", 8); // past "http://host:port"
    const rawPath = pathStart === -1 ? "" : url.slice(pathStart);
    let decodedRawPath: string;
    try {
      decodedRawPath = decodeURIComponent(rawPath);
    } catch {
      res.status(400).json({ error: "invalid tailnet URL" });
      return;
    }
    if (
      decodedRawPath.includes("/../") ||
      decodedRawPath.endsWith("/..") ||
      decodedRawPath.includes("/./") ||
      decodedRawPath.endsWith("/.")
    ) {
      res.status(400).json({ error: "invalid tailnet URL" });
      return;
    }

    // -----------------------------------------------------------------------
    // 3. Parse filename + extension for classification + host-only log context.
    // -----------------------------------------------------------------------
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      // Regex already rejected malformed URLs, but be defensive.
      res.status(400).json({ error: "invalid tailnet URL" });
      return;
    }
    // Path-traversal check on DECODED path segments (rev-3 2026-08-14
    // code-review M1+M2): (M1) catches percent-encoded traversal like
    // `%2e%2e` that the raw-string check above would miss; (M2) tolerates
    // legit filenames containing `..` in their basename such as `data..sql`
    // or `..dotfile` because traversal only matters when `..` is a whole
    // path segment.
    const pathSegments = parsedUrl.pathname
      .split("/")
      .map((seg) => decodeURIComponent(seg));
    if (pathSegments.some((seg) => seg === "." || seg === "..")) {
      res.status(400).json({ error: "invalid tailnet URL" });
      return;
    }
    const filename = decodeURIComponent(
      parsedUrl.pathname.split("/").pop() ?? "",
    );
    const extension = extractExtension(filename);
    // Host+port ONLY in log context - filename is intentionally omitted (T-40-05).
    const logHost = `${parsedUrl.hostname}:${parsedUrl.port}`;

    // -----------------------------------------------------------------------
    // 4. Outbound fetch (bounded by AbortController timeout, T-40-03).
    // -----------------------------------------------------------------------
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      // `redirect: "error"` closes the SSRF-via-redirect hole (rev-3 2026-08-14
      // code-review B1): the CGNAT allowlist only validates the initial URL, so
      // if the upstream tailnet server returned e.g. `302 Location:
      // http://169.254.169.254/...` (AWS IMDS) or `http://127.0.0.1:6379/`
      // (local Redis), the default `redirect: "follow"` behavior would happily
      // fetch it and proxy the bytes back. Refusing to follow any redirect
      // means the only bytes we ever proxy came from the same URL we validated.
      const response = await fetch(url, {
        signal: ctrl.signal,
        redirect: "error",
      });

      // 4a. Upstream non-2xx -> 502.
      if (!response.ok) {
        res.status(502).json({ error: `upstream ${response.status}` });
        sshLogger.warn("pretty-view proxy: upstream non-2xx", {
          operation: "pretty_view_fetch_tailnet_url",
          host: logHost,
          status: response.status,
          duration: Date.now() - startEpoch,
        });
        return;
      }

      // 4b. Directory-listing HTML spoof (T-40-02). Reject if the response
      //     content-type says html and the URL's filename is not .html/.htm.
      const contentType = response.headers.get("content-type");
      const contentTypeLower = contentType?.toLowerCase() ?? "";
      if (
        contentTypeLower.includes("html") &&
        extension !== "html" &&
        extension !== "htm"
      ) {
        res
          .status(502)
          .json({ error: "upstream html content-type mismatch" });
        sshLogger.warn("pretty-view proxy: html content-type mismatch", {
          operation: "pretty_view_fetch_tailnet_url",
          host: logHost,
          duration: Date.now() - startEpoch,
        });
        return;
      }

      // 4c. Streaming size guard (rev-3 2026-08-14 code-review H4). Previous
      //     `await response.arrayBuffer()` buffered the ENTIRE response into
      //     memory before checking size, so a malicious tailnet server could
      //     serve 500 MB (or an infinite chunked stream) and OOM the backend
      //     regardless of the MAX_BYTES cap. Now: check Content-Length header
      //     first (short-circuit fast when server declares oversize), then
      //     iterate the response body stream, bailing as soon as accumulated
      //     bytes cross the cap.
      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null) {
        const declaredBytes = Number(declaredLength);
        if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BYTES) {
          res.status(413).json({ error: "file exceeds max size" });
          sshLogger.warn("pretty-view proxy: oversized response (declared)", {
            operation: "pretty_view_fetch_tailnet_url",
            host: logHost,
            duration: Date.now() - startEpoch,
          });
          return;
        }
      }
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const bodyStream = response.body;
      if (bodyStream === null) {
        res.status(502).json({ error: "upstream empty body" });
        return;
      }
      const reader = bodyStream.getReader();
      let overCap = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > MAX_BYTES) {
            overCap = true;
            try { await reader.cancel(); } catch { /* best-effort */ }
            break;
          }
          chunks.push(value);
        }
      }
      if (overCap) {
        res.status(413).json({ error: "file exceeds max size" });
        sshLogger.warn("pretty-view proxy: oversized response (streamed)", {
          operation: "pretty_view_fetch_tailnet_url",
          host: logHost,
          duration: Date.now() - startEpoch,
        });
        return;
      }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));

      // 4d. Classification: extension first (D-02); sniff only when extension
      //     is not in the whitelist. sniffTextBytes is intentionally byte-only
      //     and does NOT execute or interpret the fetched bytes (ASVS V10).
      const isTextByExt = classifyByExtension(extension, filename);
      const isTextByBytes = isTextByExt
        ? undefined
        : sniffTextBytes(new Uint8Array(buf));

      res.status(200).json({
        contentBase64: buf.toString("base64"),
        sizeBytes: buf.byteLength,
        contentType: contentType ?? null,
        extension,
        filename,
        isTextByExt,
        isTextByBytes,
      });
      sshLogger.info("pretty-view proxy: ok", {
        operation: "pretty_view_fetch_tailnet_url",
        host: logHost,
        status: response.status,
        duration: Date.now() - startEpoch,
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown";
      if (name === "AbortError") {
        res.status(504).json({ error: "fetch timeout" });
      } else {
        // Do NOT leak err.message in the response body - masks upstream
        // internal paths / stack info. Log the error class name only.
        res.status(502).json({ error: "fetch failed" });
      }
      sshLogger.warn("pretty-view proxy: fetch error", {
        operation: "pretty_view_fetch_tailnet_url",
        host: logHost,
        errorClass: name,
        duration: Date.now() - startEpoch,
      });
    } finally {
      clearTimeout(timer);
    }
  },
);

export default router;
