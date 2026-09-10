/**
 * Phase 103 Plan 03a — Skynet-styled interstitial renderer for serve-URL
 * failure classes.
 *
 * Per D-14, one page per failure class (four HTML + one 302 redirect):
 *
 *   port_not_listening → 502 HTML  ("port <port> of <host> isn't responding")
 *   host_unreachable   → 502 HTML  ("<host> may be offline")
 *   permission_denied  → 403 HTML  ("you don't have access to <host>")
 *   ssh_failure        → 502 HTML  ("SSH tunnel to <host> failed to establish")
 *   auth_missing       → 302        Location: https://<primary>/login?return=...
 *
 * NO auto-refresh (D-14 + 103-CONTEXT.md specifics L145: "user decides to
 * retry — auto-refresh masks legitimate ongoing outages"). No HTML meta-tag
 * reload, no JS-timer navigation. Plain "Try again" anchor only.
 *
 * Info-leak invariant (T-40-05 / T-103-17): renderInterstitial() accepts
 * NO err argument — only the ErrorClass discriminator + typed ServeTarget
 * fields + user-supplied originalUrl (which is HTML-escaped on the way
 * out). Zero possibility of stack traces, absolute paths, SSH error text,
 * or user bytes reaching the body.
 *
 * Same defense header set as PLAIN_TEXT_HEADERS in
 * pretty-view-fetch-host-file.ts:101-105:
 *   Cache-Control: no-store        (prevent cross-user cache poisoning)
 *   X-Content-Type-Options: nosniff (belt-and-braces vs MIME sniffing)
 *   Content-Type: text/html; charset=utf-8 (for the 4 HTML classes)
 *
 * Companion helper writeInterstitial(res, result) — Plan 05's
 * subdomain-dispatch and serve-route both need to shovel one of these
 * result objects into an Express Response, so DRY the write here.
 */

import type { Response } from "express";
import type { ErrorClass, ServeTarget } from "./types.js";

/* ------------------------------------------------------------------------ */
/*  Public types                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Rendered interstitial. `body` is empty for the 302 auth_missing case
 * (browser follows Location before rendering anything). Headers dict uses
 * lowercase names by convention (Express normalizes internally either way,
 * but lowercase matches how we set headers elsewhere in the backend).
 */
export interface InterstitialResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/* ------------------------------------------------------------------------ */
/*  HTML escape (kept local — this file's only user of it)                  */
/* ------------------------------------------------------------------------ */

/**
 * Escape the five HTML-significant characters. `originalUrl` and the
 * hostname/port fields all pass through here before landing in the
 * response body. Numeric port is coerced via String() then escaped, even
 * though a number can't contain HTML chars — belt-and-braces if the
 * ServeTarget type ever loosens.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ------------------------------------------------------------------------ */
/*  Header sets                                                             */
/* ------------------------------------------------------------------------ */

/** Defense headers applied to all 4 HTML branches. Mirrors
 *  PLAIN_TEXT_HEADERS in pretty-view-fetch-host-file.ts L101-105 with
 *  content-type flipped from text/plain to text/html. */
const HTML_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

/* ------------------------------------------------------------------------ */
/*  HTML template                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Minimal Skynet-styled interstitial page. Dark background, monospace
 * title, clean body text, plain "Try again" anchor. Colors align with the
 * pretty-view `--color-pv-*` token palette (see role file § Palette
 * authority) but are inlined here because interstitials render before any
 * Skynet frontend assets are guaranteed loadable (the browser is asking
 * for a serve subdomain that failed — we can't count on
 * `term.<domain>/assets/...` being reachable at this moment either).
 */
function renderHtmlPage(params: {
  title: string;
  message: string;
  originalUrl: string;
}): string {
  const title = escapeHtml(params.title);
  const message = escapeHtml(params.message);
  const returnHref = escapeHtml(params.originalUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Skynet</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #0d1117; color: #e6edf3; }
  body { display: flex; align-items: center; justify-content: center; padding: 2rem; box-sizing: border-box;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  .card { max-width: 32rem; width: 100%; }
  h1 { font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
       font-size: 1.25rem; font-weight: 600; margin: 0 0 1rem 0; color: #7ee2b8; }
  p { font-size: 1rem; line-height: 1.5; margin: 0 0 1.5rem 0; color: #c9d1d9; }
  a.retry { display: inline-block; padding: 0.5rem 1rem; border: 1px solid #30363d; border-radius: 6px;
            color: #e6edf3; text-decoration: none; font-family: inherit; }
  a.retry:hover { background: #161b22; border-color: #7ee2b8; }
  footer { margin-top: 2rem; font-size: 0.8rem; color: #6e7681; }
</style>
</head>
<body>
<main class="card">
<h1>${title}</h1>
<p>${message}</p>
<a class="retry" href="${returnHref}">Try again</a>
<footer>skynet serve URL</footer>
</main>
</body>
</html>
`;
}

/* ------------------------------------------------------------------------ */
/*  Public renderer                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Render an interstitial for the given failure class. NEVER accepts an
 * `err` argument (T-103-17 — the whole point of the ErrorClass
 * discriminator is that upstream code has already CLASSIFIED the failure
 * before the info-leaky Error object is discarded).
 *
 * @param errorClass     One of the five D-14 failure classes.
 * @param target         Resolved serve target (hostname + port + host row).
 * @param originalUrl    The full URL the user's browser requested, used
 *                       for the "Try again" anchor href and for the
 *                       auth_missing redirect's `?return=...` param.
 * @param primaryDomain  The primary Skynet domain (e.g.
 *                       "term.gigaashley.click") — used ONLY for the
 *                       auth_missing 302 Location header. HTML branches
 *                       do not include it (interstitials render on the
 *                       serve subdomain itself per D-14).
 */
export function renderInterstitial(
  errorClass: ErrorClass,
  target: ServeTarget,
  originalUrl: string,
  primaryDomain: string,
): InterstitialResult {
  const safeHost = escapeHtml(target.hostname);
  const safePort = escapeHtml(String(target.port));

  switch (errorClass) {
    case "port_not_listening":
      return {
        status: 502,
        body: renderHtmlPage({
          title: "port not responding",
          message: `Port ${safePort} of ${safeHost} isn't responding. The agent may have stopped whatever was serving there.`,
          originalUrl,
        }),
        headers: { ...HTML_HEADERS },
      };

    case "host_unreachable":
      return {
        status: 502,
        body: renderHtmlPage({
          title: "host unreachable",
          message: `${safeHost} may be offline. Skynet couldn't open a connection to it.`,
          originalUrl,
        }),
        headers: { ...HTML_HEADERS },
      };

    case "permission_denied":
      return {
        status: 403,
        body: renderHtmlPage({
          title: "access denied",
          message: `You don't have access to ${safeHost}.`,
          originalUrl,
        }),
        headers: { ...HTML_HEADERS },
      };

    case "ssh_failure":
      return {
        status: 502,
        body: renderHtmlPage({
          title: "ssh tunnel failure",
          message: `SSH tunnel to ${safeHost} failed to establish. The box may be up but its sshd could not authenticate the Skynet backend.`,
          originalUrl,
        }),
        headers: { ...HTML_HEADERS },
      };

    case "auth_missing": {
      // No body. Browser follows Location before rendering anything. Do
      // NOT include HTML_HEADERS (no content-type on an empty body), only
      // Location + Cache-Control no-store (prevent an intermediary from
      // caching this redirect and preventing re-auth for a stale user).
      const returnParam = encodeURIComponent(originalUrl);
      return {
        status: 302,
        body: "",
        headers: {
          location: `https://${primaryDomain}/login?return=${returnParam}`,
          "cache-control": "no-store",
        },
      };
    }
  }
}

/* ------------------------------------------------------------------------ */
/*  Companion writer                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Shovel a rendered InterstitialResult into an Express Response. Set
 * headers, then status, then body, then end. Plan 05's subdomain-dispatch
 * and serve-route both use this — DRY the write here.
 */
export function writeInterstitial(
  res: Response,
  result: InterstitialResult,
): void {
  for (const [name, value] of Object.entries(result.headers)) {
    res.setHeader(name, value);
  }
  res.status(result.status);
  if (result.body.length > 0) {
    res.send(result.body);
  } else {
    res.end();
  }
}
