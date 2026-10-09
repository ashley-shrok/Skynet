/**
 * Phase 120 Plan 01 Task 2 (extended 2026-09-19) — injectBaseTag.
 *
 * Pure Buffer transform: given a text/html response body from the upstream
 * app, insert `<base href="/apps/:hostId/:slug/pane/">` inside (or before)
 * the document's `<head>` — so RELATIVE references in the app's HTML/JS
 * (`<script src="app.js">`, `fetch("api/foo")`, …) resolve against the
 * pane's mount prefix instead of the response URL's directory.
 * Root-absolute URLs (leading `/`) bypass `<base>` per URL spec and still
 * resolve against the document origin — so `<a href="/foo">` navigates the
 * iframe to Skynet's own root, not into the app. Apps handle this by
 * importing a scaffolded `PANE_BASE` constant and prefixing every internal
 * URL they emit; the app-development skill's § How the pane mounts your app
 * covers the rule + the scaffold files that make it inert boilerplate for
 * app authors.
 *
 * No default stylesheet is injected (removed 2026-10-09). An injected
 * `html,body{background:#fff}` set a background on the root element, which
 * stops an app's `body` background from propagating to the canvas — a
 * dark-`body` app rendered dark only behind its content and white below it.
 * The browser-default-white look for unstyled apps now comes from the
 * iframe element itself (AppPane.tsx: color-scheme light + white bg).
 *
 * Used by Wave 2's app-pane-proxy-factory inside its
 * `responseInterceptor(async (buffer, proxyRes, req, res) => …)` hook.
 *
 * ---
 *
 * LOAD-BEARING CAVEATS — enforced at the CALLER, not here:
 *
 * (1) `selfHandleResponse: true` MUST be set on the createProxyMiddleware
 *     options at the caller — without it the responseInterceptor never
 *     fires. (RESEARCH.md Pitfall 3 / Pattern 3.)
 *
 * (2) Content-Type gating is the CALLER's responsibility. This helper is
 *     an UNCONDITIONAL transform — the caller must skip it for non-html
 *     responses (JSON, JS, images, WebSocket upgrades, binaries). Doing the
 *     gate in both places doubles the audit surface (T-120-03 disposition:
 *     accept). A JSON body that happens to contain the substring `<head>`
 *     would otherwise get mangled.
 *
 * (3) Response auto-decompression (gzip / br / zstd / deflate) is handled
 *     by the caller's `responseInterceptor` wrapper itself — this
 *     helper receives ALREADY-DECOMPRESSED bytes.
 *
 * (4) Content-Length header rewrite (or chunked-encoding switchover)
 *     after the buffer is modified is handled by the caller's
 *     `responseInterceptor` wrapper itself — do NOT edit Content-Length here.
 *
 * (5) WebSocket upgrades bypass `proxyRes` entirely (they emit
 *     `101 Switching Protocols` and then flow as frames). This helper is
 *     never invoked on WS traffic. (RESEARCH.md Pitfall 3.)
 */

/**
 * Injects Skynet's pane-scope `<base>` tag into an HTML buffer.
 *
 * Semantics:
 *   - If the input matches `<head[^>]*>` (case-insensitive), the tag is
 *     inserted immediately after the FIRST matching open tag (regex is
 *     non-global — only the first match is replaced, so a malformed
 *     document with two `<head>` tags gets exactly one `<base>`).
 *   - If no `<head>` open tag is found, the tag is PREPENDED to the
 *     entire input as a fallback (still resolves relative paths correctly
 *     per the HTML spec's tolerant parser, which places it in the
 *     implicit head).
 *
 * URL encoding:
 *   - `hostId` is a positive integer — cast to a string via template
 *     literal, NOT URL-encoded.
 *   - `slug` is URL-encoded via `encodeURIComponent` unconditionally —
 *     slugs containing `/`, `?`, `#`, whitespace, or any other reserved
 *     URL character cannot break out of the intended URL path segment
 *     (defence-in-depth on top of Wave 2's `APP_SLUG_RE` gate at route
 *     entry — T-120-04 mitigation).
 *
 * @param buffer  UTF-8 encoded HTML response body from the upstream app.
 * @param hostId  Positive integer identifying the app's home box.
 * @param slug    App slug (Wave 2 validates it against `APP_SLUG_RE`
 *                before reaching this helper — but we defensively encode
 *                anyway).
 * @returns       A new UTF-8 Buffer whose decoding is the injected HTML.
 */
export async function injectBaseTag(
  buffer: Buffer,
  hostId: number,
  slug: string,
): Promise<Buffer> {
  const html = buffer.toString("utf8");
  const baseTag = `<base href="/apps/${hostId}/${encodeURIComponent(slug)}/pane/">`;
  const injected = html.match(/<head[^>]*>/i)
    ? html.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`)
    : `${baseTag}${html}`;
  return Buffer.from(injected, "utf8");
}
