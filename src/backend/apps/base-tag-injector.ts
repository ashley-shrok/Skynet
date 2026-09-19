/**
 * Phase 120 Plan 01 Task 2 (extended 2026-09-19) — injectBaseTag.
 *
 * Pure Buffer transform: given a text/html response body from the upstream
 * app, prepend TWO elements inside (or before) the document's `<head>`:
 *
 *   1. `<base href="/apps/:hostId/:slug/pane/">` — so absolute-path
 *      references in the app's HTML/JS (`<script src="/app.js">`,
 *      `fetch("/api/foo")`, …) resolve against the pane's mount prefix
 *      instead of Skynet's own root.
 *
 *   2. `<style>html,body{background:#fff;color:#000}:root{color-scheme:light}</style>`
 *      — a low-specificity default so an app that doesn't declare its own
 *      background (matching what agents assume: "browser default is white")
 *      renders consistently whether it's opened top-level (chrome address
 *      bar, browser-default white) or in the split-view iframe (which would
 *      otherwise show Skynet's dark theme through the transparent iframe
 *      background). Cascade preserves author overrides: any app-level
 *      `body { background: X }` declared later in the head OR in a linked
 *      stylesheet wins at equal specificity. Same rule for `color-scheme`
 *      — apps opting into dark mode via `:root { color-scheme: dark }` win.
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
 * Constant `<style>` block injected alongside the `<base>` tag. Defined at
 * module scope (not per-call) so callers/tests can reference the exact
 * bytes without repeating the string literal. Kept minimal and rule-only
 * so the low-specificity cascade contract (any app-supplied later rule
 * wins) stays legible.
 */
export const PANE_DEFAULT_STYLE_TAG =
  `<style>html,body{background:#fff;color:#000}:root{color-scheme:light}</style>`;

/**
 * Injects Skynet's pane-scope head prefix (`<base>` + default `<style>`)
 * into an HTML buffer.
 *
 * Semantics:
 *   - If the input matches `<head[^>]*>` (case-insensitive), the two tags
 *     are inserted immediately after the FIRST matching open tag (regex
 *     is non-global — only the first match is replaced, so a malformed
 *     document with two `<head>` tags gets exactly one prefix).
 *   - If no `<head>` open tag is found, the prefix is PREPENDED to the
 *     entire input as a fallback (still resolves absolute paths correctly
 *     per the HTML spec's tolerant parser; the style still lands in the
 *     implicit head).
 *   - Order inside the prefix is `<base>` first, then `<style>`. Base
 *     comes first because it's the more-conventional early-head position
 *     (any subsequent link/script in the app's own head resolves against
 *     it). The style block is standalone with no href references, so the
 *     order does not affect either tag's own behavior.
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
  const prefix = `${baseTag}${PANE_DEFAULT_STYLE_TAG}`;
  const injected = html.match(/<head[^>]*>/i)
    ? html.replace(/<head[^>]*>/i, (m) => `${m}${prefix}`)
    : `${prefix}${html}`;
  return Buffer.from(injected, "utf8");
}
