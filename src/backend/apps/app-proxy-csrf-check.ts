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
 *   - POST/PUT/PATCH/DELETE with Origin exactly matching primaryOrigin → pass.
 *   - POST/PUT/PATCH/DELETE with a missing Origin header             → refuse.
 *   - POST/PUT/PATCH/DELETE with an empty-string Origin              → refuse.
 *   - POST/PUT/PATCH/DELETE with a mismatched Origin                 → refuse.
 *
 * Missing Origin on a state-changing request is anomalous — browsers
 * always send Origin on cross-origin POST/PUT/PATCH/DELETE. Safer to
 * refuse than to pass.
 */

import type { Request } from "express";

/* ------------------------------------------------------------------------ */
/*  Module-load fail-loud env check (W4)                                    */
/* ------------------------------------------------------------------------ */

export const PRIMARY_DOMAIN: string = (() => {
  const value = process.env.SKYNET_COOKIE_DOMAIN;
  if (!value) {
    throw new Error(
      "app-proxy-csrf-check: SKYNET_COOKIE_DOMAIN env var is required " +
        "(fail-loud per W4)",
    );
  }
  return value;
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
 * See D-13 semantics in the module header.
 */
export function appProxyCsrfCheck(req: Request, primaryOrigin: string): boolean {
  const method = String(req.method ?? "").toUpperCase();
  if (!STATE_CHANGING_METHODS.has(method)) return true;
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin.length === 0) return false;
  return origin === primaryOrigin;
}
