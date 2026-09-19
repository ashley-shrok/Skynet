/**
 * Phase 120 Plan 01 Task 1 — appProxyCsrfCheck.
 *
 * Pure Origin-check helper for the in-pane app proxy boundary (shape 4's
 * Option B — the proxy itself enforces the same-origin CSRF check).
 *
 * ---
 *
 * FAIL-LOUD env enforcement (W4):
 *
 * Module-load reads `process.env.SKYNET_COOKIE_DOMAIN` and THROWS if unset.
 * No hardcoded fallback — t1000 sets its own value, T800 sets its own value.
 * Same shape as `src/backend/serve-url/serve-route.ts` lines 50-61 —
 * duplicated (not shared) because both modules independently need to fail
 * loud, and indirection through a shared helper would add nothing.
 *
 * HIGH-1 fix (unbiased code review 2026-09-19): the env var is documented
 * elsewhere (auth-manager.ts:713) as a bare hostname (e.g. `term.example.com`)
 * used as the `Domain=` cookie attribute. Browsers send the `Origin` header
 * as `scheme://host[:port]` (a full URL), so the old string-equality check
 * against the bare-hostname env value failed on every real state-changing
 * request in production. Fix: parse the incoming Origin as a URL and compare
 * its `hostname` against the normalized primary hostname. Config-shape
 * tolerance: accept both bare-hostname (`term.example.com`) and URL-shaped
 * (`https://term.example.com`) values; extract the hostname either way.
 *
 * ---
 *
 * Info-leak invariant:
 *
 * This helper returns a boolean; it does NOT write a 403 body itself.
 * Callers write the 403 so they can shape the payload uniformly with
 * their other refusal responses (identical body across "cross-origin"
 * and "missing origin" failure modes; never echo the received Origin).
 *
 * ---
 *
 * D-13 semantics:
 *
 *   - GET/HEAD/OPTIONS  → pass unconditionally (safe/idempotent per
 *                          RFC 9110 §9.2.1; matches SvelteKit's own
 *                          default CSRF check which ignores these methods).
 *   - POST/PUT/PATCH/DELETE with Origin.hostname exactly matching
 *     PRIMARY_DOMAIN → pass.
 *   - POST/PUT/PATCH/DELETE with a missing Origin header             → refuse.
 *   - POST/PUT/PATCH/DELETE with an empty-string Origin              → refuse.
 *   - POST/PUT/PATCH/DELETE with a malformed Origin (non-URL)        → refuse.
 *   - POST/PUT/PATCH/DELETE with a mismatched Origin.hostname        → refuse.
 *
 * Missing Origin on a state-changing request is anomalous — browsers
 * always send Origin on cross-origin POST/PUT/PATCH/DELETE. Safer to
 * refuse than to pass.
 */

import type { Request } from "express";

/* ------------------------------------------------------------------------ */
/*  Module-load fail-loud env check (W4) + hostname normalization (HIGH-1)   */
/* ------------------------------------------------------------------------ */

/**
 * Extract the hostname portion from a config value that may be either a
 * bare hostname (e.g. `term.example.com`) or a URL (e.g. `https://term.example.com`).
 * Returns the input unchanged if it does not parse as a URL — the bare-hostname
 * path is the documented production shape (auth-manager.ts:713 uses this env
 * var as the `Domain=` cookie attribute, which is bare-hostname-only).
 */
function normalizeToHostname(value: string): string {
  // Fast-path: no scheme separator → bare hostname; return as-is.
  if (!value.includes("://")) return value;
  try {
    return new URL(value).hostname;
  } catch {
    // Malformed URL-ish value — return the raw string; comparisons will
    // simply never match, which is the fail-closed shape we want.
    return value;
  }
}

export const PRIMARY_DOMAIN: string = (() => {
  const value = process.env.SKYNET_COOKIE_DOMAIN;
  if (!value) {
    throw new Error(
      "app-proxy-csrf-check: SKYNET_COOKIE_DOMAIN env var is required " +
        "(fail-loud per W4)",
    );
  }
  return normalizeToHostname(value);
})();

/* ------------------------------------------------------------------------ */
/*  Method taxonomy                                                          */
/* ------------------------------------------------------------------------ */

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/* ------------------------------------------------------------------------ */
/*  Pure helper                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Returns true if the request should be forwarded, false if it should be
 * refused (caller writes the 403). Pure — no I/O, no logging, no header
 * mutation on the request.
 *
 * `primaryHostname` is the bare hostname to match against (already
 * normalized via `normalizeToHostname` — module-level `PRIMARY_DOMAIN` is
 * the canonical caller argument).
 *
 * See D-13 semantics in the module header.
 */
export function appProxyCsrfCheck(
  req: Request,
  primaryHostname: string,
): boolean {
  const method = String(req.method ?? "").toUpperCase();
  if (!STATE_CHANGING_METHODS.has(method)) return true;
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.length === 0) return false;
  // HIGH-1 fix: parse the browser-sent Origin as a URL and compare its
  // hostname. A malformed Origin (rare — browsers always send well-formed
  // scheme+host+port) refuses fail-closed.
  let originHostname: string;
  try {
    originHostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (originHostname.length === 0) return false;
  return originHostname === primaryHostname;
}
