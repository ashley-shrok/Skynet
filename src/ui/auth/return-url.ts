/**
 * Bounty: 260910-pf4-serve-url-login-return-honor-make-skynet
 * Origin: 103-10-SUMMARY.md GAP 4 — subdomain-dispatch appends
 *   ?return=<encoded> on the 302 → /login redirect, but Auth.tsx was
 *   ignoring the param, dropping users at app root after login.
 *
 * Security note — leading-dot rule:
 *   We use `hostname === parent || hostname.endsWith("." + parent)` to
 *   avoid the plain-suffix bypass. Without the leading dot,
 *   "eviltermgigaashley.click".endsWith("termgigaashley.click") is TRUE
 *   even though the attacker controls "eviltermgigaashley.click" entirely.
 *   The leading dot forces the hostname boundary: "eviltermgigaashley.click"
 *   does NOT end with ".term.gigaashley.click".
 *
 * Pure functions — no React, no window/document reads; parentDomain is
 * passed in as a parameter for trivial testability.
 */

/**
 * Parse the `?return=` query parameter from a URL search string.
 *
 * @param search - URL search string, with or without a leading "?".
 * @returns The decoded `return` param value (trimmed), or null if absent/empty/whitespace-only.
 */
export function parseReturnFromSearch(search: string): string | null {
  if (!search) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = params.get("return");
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Validate that a return URL is safe to redirect to after login.
 *
 * Accepts only absolute HTTPS URLs whose hostname is exactly the parentDomain
 * or a subdomain of it (enforced with the leading-dot rule). Rejects:
 *   - null / empty input
 *   - non-https protocols (http, javascript, data, ftp, file, etc.)
 *   - protocol-relative URLs (//evil.com) which fail URL parse without a base
 *   - cross-domain hostnames (including plain-suffix bypass attempts)
 *   - embedded credentials (username / password in userinfo)
 *   - parentDomain that is empty, contains "/" or ":" (defensive)
 *
 * @param returnParam - The raw return URL string (or null).
 * @param parentDomain - The canonical parent domain (e.g. "term.gigaashley.click").
 *   At runtime, pass window.location.hostname — guaranteed === SKYNET_COOKIE_DOMAIN
 *   because /login is served on the primary domain (Phase 103 D-14).
 * @returns The normalized URL string (via URL constructor) if valid, otherwise null.
 */
export function validateReturnUrl(returnParam: string | null, parentDomain: string): string | null {
  // Defensive: reject bad parentDomain before doing anything else.
  if (!parentDomain || parentDomain.includes("/") || parentDomain.includes(":")) return null;

  if (!returnParam) return null;

  let parsed: URL;
  try {
    // No base: intentional. Relative paths and protocol-relative //evil.com both fail.
    parsed = new URL(returnParam);
  } catch {
    return null;
  }

  // Only HTTPS — rejects http, javascript, data, ftp, file, etc.
  if (parsed.protocol !== "https:") return null;

  // No embedded credentials — defeats https://term.gigaashley.click:9999@evil.com/.
  if (parsed.username !== "" || parsed.password !== "") return null;

  // Hostname check with leading-dot suffix rule.
  const host = parsed.hostname.toLowerCase();
  const parent = parentDomain.toLowerCase();
  if (host !== parent && !host.endsWith("." + parent)) return null;

  // All checks passed — return the normalized URL string.
  return parsed.href;
}
