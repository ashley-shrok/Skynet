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
 * No hardcoded fallback — each instance sets its own value. The value is
 * exported as `PRIMARY_DOMAIN` for the pane router's interstitials; the
 * CSRF check itself no longer uses it (see "Same-origin" below).
 * Same shape as `src/backend/serve-url/serve-route.ts` lines 50-61 —
 * duplicated (not shared) because both modules independently need to fail
 * loud, and indirection through a shared helper would add nothing.
 *
 * Config-shape tolerance: the env var is a bare hostname (it is the
 * `Domain=` cookie attribute, auth-manager.ts) but a URL-shaped value
 * (`https://term.example.com`) is accepted too; the hostname is extracted
 * either way.
 *
 * ---
 *
 * Info-leak invariant:
 *
 * This helper returns a result (with a refusal reason for the caller's log
 * line); it does NOT write a 403 body itself. Callers write the 403 so they
 * can shape the payload uniformly with their other refusal responses
 * (identical body across every refusal reason; never echo the received
 * Origin or Host).
 *
 * ---
 *
 * D-13 semantics:
 *
 *   - GET/HEAD/OPTIONS  → pass unconditionally (safe/idempotent per
 *                          RFC 9110 §9.2.1; matches SvelteKit's own
 *                          default CSRF check which ignores these methods).
 *   - POST/PUT/PATCH/DELETE from serve-URL traffic                   → refuse.
 *   - POST/PUT/PATCH/DELETE with Origin.hostname exactly matching the
 *     request's own Host hostname                                    → pass.
 *   - POST/PUT/PATCH/DELETE with the literal string `"null"` as Origin
 *                                                                → pass (see below).
 *   - POST/PUT/PATCH/DELETE with a missing Origin header             → refuse.
 *   - POST/PUT/PATCH/DELETE with an empty-string Origin              → refuse.
 *   - POST/PUT/PATCH/DELETE with a malformed Origin (non-URL)        → refuse.
 *   - POST/PUT/PATCH/DELETE with a missing or malformed Host         → refuse.
 *   - POST/PUT/PATCH/DELETE with a mismatched Origin.hostname        → refuse.
 *
 * WebSocket upgrades (GETs) skip the method gate and go straight to
 * `checkSameOrigin`, so every rule after the first line applies to them.
 *
 * Missing Origin on a state-changing request is anomalous — browsers
 * always send Origin on cross-origin POST/PUT/PATCH/DELETE. Safer to
 * refuse than to pass.
 *
 * ---
 *
 * Same-origin = Origin hostname equals the request's own Host hostname:
 *
 * The check used to compare Origin against SKYNET_COOKIE_DOMAIN. That only
 * works when the cookie domain IS the app's address. An instance reached at
 * several addresses sets the cookie domain to their shared parent (e.g.
 * `example.com` for `app.example.com` + `alt.example.com`), and then every
 * real browser Origin mismatched and every pane save was refused. Comparing
 * against the request's own Host needs no config and holds for any number
 * of addresses. Browsers set both headers themselves (scripts cannot), and
 * nginx (`location ^~ /apps/`, `Host $http_host`) and the edge proxy pass
 * Host through unchanged. Ports and scheme are ignored (hostname-only),
 * matching the prior check; the edge redirects plain HTTP to HTTPS.
 *
 * Serve-URL traffic is refused outright:
 *
 * The session cookie's Domain covers serve-URL hostnames
 * (`<id>-<port>.serve.<domain>`), so a request a serve page makes to the
 * pane path on ITS OWN hostname arrives with Origin == Host and a valid
 * session. Plain HTTP requests like that are taken by subdomain-dispatch
 * before the pane router ever sees them, but WebSocket upgrades are
 * dispatched on the http.Server by path alone and do land here. So a
 * request is refused when the edge marked it as serve traffic (Caddy sets
 * `X-Skynet-Serve-Subdomain` on every serve request, overwriting any
 * client value) or its Host is a serve-URL hostname. A serve page calling
 * the pane path on the main address fails the Origin == Host comparison.
 *
 * ---
 *
 * Origin: "null" — accepted (2026-09-25):
 *
 * The app-pane iframe (`src/ui/shell/AppPane.tsx`) declares
 * `referrerPolicy="no-referrer"` per D-20 discipline (don't leak the
 * parent Skynet URL to the embedded app). With that policy, browsers
 * per HTML spec serialize the request's origin as the literal string
 * `"null"` on `<form method="POST">` navigations — even same-origin ones.
 * (Confirmed live on iOS Safari 18; matches Fetch spec §3.5 origin
 * serialization under `no-referrer` policy.) Requests via `fetch()`
 * still carry a proper Origin, so this only affected raw form-action
 * POSTs; the failure mode was latent until an app used one.
 *
 * Accepting `Origin: "null"` here is safe because the pane path's CSRF
 * check is defense-in-depth over three layers that already close the
 * only realistic attacker vector:
 *
 *   1. The JWT session cookie is `SameSite=Lax`
 *      (`src/backend/utils/auth-manager.ts`), so a genuinely
 *      cross-site attacker's POST cannot carry the session at all.
 *   2. `authenticateJWT` runs BEFORE this check in the pane router
 *      middleware chain (`app-pane-router.ts`); by the time we're
 *      here the request is proven authenticated.
 *   3. A same-site attacker (another subdomain of the same registrable
 *      domain) whose page fires the POST sends
 *      `Origin: https://<their-subdomain>` — hostname differs from the
 *      Host the request was sent to, still refused; serve-URL pages
 *      calling their own hostname are refused as serve traffic. To
 *      produce `Origin: "null"` a same-site attacker would have to embed
 *      a sandboxed iframe on our OWN origin, which they cannot do without
 *      first compromising us.
 *
 * Net: no realistic attacker vector produces `Origin: "null"` + valid
 * session cookie on this path. Refusing it would only break legitimate
 * scaffolded apps that use raw form-action POSTs from inside the pane.
 */

import type { IncomingHttpHeaders } from "node:http";
import type { Request } from "express";

/* ------------------------------------------------------------------------ */
/*  Module-load fail-loud env check (W4) + hostname normalization (HIGH-1)   */
/* ------------------------------------------------------------------------ */

/**
 * Extract the hostname portion from a config value that may be either a
 * bare hostname (e.g. `term.example.com`) or a URL (e.g. `https://term.example.com`).
 * Returns the input unchanged if it does not parse as a URL — the bare-hostname
 * path is the documented production shape (auth-manager.ts uses this env
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
/*  Pure helpers                                                             */
/* ------------------------------------------------------------------------ */

/** Why a request was refused — for the caller's log line, never the body. */
export type SameOriginRefusal =
  | "serve_host"
  | "missing_origin"
  | "malformed_origin"
  | "missing_host"
  | "malformed_host"
  | "origin_host_mismatch";

export type SameOriginResult =
  | { ok: true }
  | {
      ok: false;
      reason: SameOriginRefusal;
      /** Origin hostname when it parsed, else null. Log-only. */
      originHost: string | null;
      /** Request Host hostname when it parsed, else null. Log-only. */
      requestHost: string | null;
    };

/** Longest hostname we log (DNS maximum); longer values are cut. */
const MAX_LOGGED_HOST_LEN = 253;

function forLog(hostname: string | null): string | null {
  return hostname === null ? null : hostname.slice(0, MAX_LOGGED_HOST_LEN);
}

/**
 * Hostname from a Host header (`hostname[:port]`), or null if it isn't one.
 * URL-structural characters are refused first — the URL parser would
 * otherwise read a different hostname out of e.g. `x@evil.com` or `a.com/x`.
 */
function hostHeaderToHostname(host: string): string | null {
  if (/[/@?#\\\s]/.test(host)) return null;
  try {
    const hostname = new URL(`http://${host}`).hostname;
    return hostname.length > 0 ? hostname : null;
  } catch {
    return null;
  }
}

/** Serve-URL hostname: leftmost label `<id>-<port>`, then `.serve.`. */
const SERVE_HOSTNAME_RE = /^\d+-\d+\.serve\./;

/**
 * Same-origin check on a request's headers, independent of HTTP method.
 * Used directly by the WebSocket upgrade path (upgrades are GETs, so the
 * method gate in `appProxyCsrfCheck` would wave them through).
 *
 * See the module header for semantics and the security argument.
 */
export function checkSameOrigin(headers: IncomingHttpHeaders): SameOriginResult {
  const origin = headers.origin;
  const host = headers.host;
  const requestHost =
    typeof host === "string" && host.length > 0 ? hostHeaderToHostname(host) : null;

  if (
    headers["x-skynet-serve-subdomain"] !== undefined ||
    (requestHost !== null && SERVE_HOSTNAME_RE.test(requestHost))
  ) {
    return { ok: false, reason: "serve_host", originHost: null, requestHost: forLog(requestHost) };
  }

  if (typeof origin !== "string" || origin.length === 0) {
    return { ok: false, reason: "missing_origin", originHost: null, requestHost: forLog(requestHost) };
  }
  // Accept the literal string "null" produced by browsers for form-action
  // POST navigations from the pane iframe (referrerPolicy="no-referrer",
  // per D-20). See module header for the security argument — the pane's
  // JWT/SameSite=Lax + auth-first middleware already close every realistic
  // attacker vector that could produce Origin:"null" with a valid session.
  if (origin === "null") return { ok: true };

  let originHost: string | null;
  try {
    originHost = new URL(origin).hostname || null;
  } catch {
    originHost = null;
  }
  if (originHost === null) {
    return { ok: false, reason: "malformed_origin", originHost: null, requestHost: forLog(requestHost) };
  }
  if (typeof host !== "string" || host.length === 0) {
    return { ok: false, reason: "missing_host", originHost: forLog(originHost), requestHost: null };
  }
  if (requestHost === null) {
    return { ok: false, reason: "malformed_host", originHost: forLog(originHost), requestHost: null };
  }
  if (originHost !== requestHost) {
    return {
      ok: false,
      reason: "origin_host_mismatch",
      originHost: forLog(originHost),
      requestHost: forLog(requestHost),
    };
  }
  return { ok: true };
}

/**
 * Decides whether an HTTP request into the pane proxy may be forwarded.
 * Safe methods (GET/HEAD/OPTIONS) always pass; state-changing ones must be
 * same-origin per `checkSameOrigin`. Pure — no I/O, no logging, no header
 * mutation; the caller logs the refusal and writes the 403.
 *
 * See D-13 semantics in the module header.
 */
export function appProxyCsrfCheck(req: Request): SameOriginResult {
  const method = String(req.method ?? "").toUpperCase();
  if (!STATE_CHANGING_METHODS.has(method)) return { ok: true };
  return checkSameOrigin(req.headers);
}
