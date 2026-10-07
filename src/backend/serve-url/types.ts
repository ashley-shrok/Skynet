/**
 * Phase 103 Plan 03a — Serve-URL data-primitive contracts.
 *
 * This module is the FROZEN interface surface consumed by every downstream
 * serve-url module: tunnel-cache.ts, interstitial.ts (this plan), Plan 03b's
 * proxy-factory.ts + header-audit-sampler.ts, and Plan 05's
 * subdomain-dispatch.ts + serve-route.ts. It is intentionally lightweight
 * (three exports, no runtime logic) so downstream imports resolve
 * deterministically.
 *
 * Provenance:
 * - ServeTarget shape         → 103-CONTEXT.md domain (serve URL = per-host,
 *                               per-port reverse proxy target)
 * - ErrorClass union          → 103-CONTEXT.md D-14 (five interstitial
 *                               failure classes: port-not-listening,
 *                               host-unreachable, permission-denied,
 *                               SSH-level-failure, auth-missing/expired)
 * - HEADER_ALLOWLIST constant → 103-CONTEXT.md D-04 (default-deny
 *                               allowlist-strip at proxy forward — no
 *                               cookies, no Authorization, no X-Skynet-*).
 *                               Exact list per 103-PATTERNS.md
 *                               §proxy-factory.ts. Lowercase because Node's
 *                               http.getHeaderNames() lowercases everything.
 *
 * No package installs happen here — http-proxy-middleware install is
 * Plan 03b's job (after its package-legitimacy human-verify checkpoint).
 */

import type { Host } from "../../types/index.js";

/**
 * A serve-URL routing target. Derived by subdomain-dispatch parsing the
 * leftmost DNS label of a `<machineId>-<port>.serve.<domain>` request
 * (split on last dash; both sides all digits). The `host` field is the
 * caller's own DB row for that machine, resolved via
 * `resolveHostByUniversalId(machineId, userId)`.
 */
export interface ServeTarget {
  /** The caller's display name for the box (host.name). Used only in
   *  interstitials, logs and alongside unique keys (tunnelPort) — never
   *  alone as a routing or cache key, since names are per-user. */
  hostname: string;
  /** Positive integer TCP port on the AGENT's host where the reverse-proxy
   *  target listens. NOT the SSH port. */
  port: number;
  /** Resolved DB host row. Used to derive SSH credentials + pool key
   *  (`hostPoolKey(host)`, owner-scoped) for tunnel setup. */
  host: Host;
}

/**
 * The distinct interstitial failure classes per D-14. Each maps 1:1
 * to a rendered response in interstitial.ts:
 *
 * - port_not_listening → 502 HTML — SSH tunnel opened but agent's port
 *                       isn't accepting connections (ECONNREFUSED at
 *                       upstream).
 * - host_unreachable   → 502 HTML — could not open SSH tunnel or upstream
 *                       fetch failed for reasons other than a closed port
 *                       (network flap, target reboot, DNS).
 * - permission_denied  → 403 HTML — user is authenticated but does not
 *                       have `canAccessHost` on the resolved host row
 *                       (per Phase 78 pattern).
 * - ssh_failure        → 502 HTML — SSH-layer error (auth mismatch,
 *                       algorithm negotiation failure, sshd down).
 * - auth_missing       → 302 redirect to `https://<primaryDomain>/login`
 *                       — user has no valid session cookie (D-14 last
 *                       bullet: redirect to primary for re-auth).
 * - app_not_serving    → 404 HTML — the pane's registered app has no
 *                       live port in the fleet-status registry (nothing
 *                       is running yet, or the agent stopped it). Used
 *                       by app-pane-router when getAppSnapshot returns
 *                       no matching entry or the matching entry has an
 *                       invalid port. Distinct from port_not_listening,
 *                       which fires AFTER a port is known and the tunnel
 *                       fails to reach it — this class fires BEFORE any
 *                       tunnel work, so the message must not reference a
 *                       port number.
 * - invalid_link       → 400 HTML — the serve subdomain isn't
 *                       `<machineId>-<port>` (e.g. an old name-based link).
 *                       Fires before auth or any lookup; the message must
 *                       not echo the raw subdomain (T-103-27).
 */
export type ErrorClass =
  | "port_not_listening"
  | "host_unreachable"
  | "permission_denied"
  | "ssh_failure"
  | "auth_missing"
  | "app_not_serving"
  | "invalid_link";

/**
 * Exact, lowercase, ordered list of HTTP headers permitted to pass through
 * the reverse proxy to upstream (per D-04 default-deny allowlist-strip).
 *
 * Categories:
 * - Transport hop-by-hop essentials: host, connection, upgrade
 * - WebSocket upgrade quartet: sec-websocket-key, sec-websocket-version,
 *   sec-websocket-protocol (sec-websocket-extensions deliberately EXCLUDED
 *   per R&D GOTCHA 1 — permessage-deflate is stripped at proxy forward)
 * - HTTP body: content-type, content-length
 * - Byte-range request: range, if-range — required for media seeking. A
 *   `<video>`/`<audio>` scrubber sends `Range: bytes=X-Y` and needs the
 *   upstream to reply `206 Partial Content` with `Accept-Ranges: bytes`;
 *   stripping the request header made every upstream fall back to 200
 *   full-body and Chrome/Safari refused to seek. `if-range` (ETag or
 *   HTTP-date echoing a prior upstream response) is a re-seek companion
 *   and carries no browser-identity info.
 *
 * Explicitly EXCLUDED from allowlist (denied by default):
 * - cookie / cookie2 (Phase 78 D-04 cookie-egress invariant, D-05 test-enforced)
 * - authorization
 * - x-skynet-* (any Skynet-internal header)
 * - user-agent, referer, origin (upstream never sees browser identity)
 * - x-forwarded-* (Caddy stripped these already at the edge)
 * - accept-language, cache-control, pragma, dnt, etc. (denied by omission)
 *
 * Content-negotiation headers explicitly INCLUDED (2026-09-25):
 * - accept — HTTP content negotiation. Without it, framework servers that
 *   negotiate response type (SvelteKit form actions, Rails respond_to,
 *   ASP.NET action results) cannot see the browser's preference and default
 *   to whichever type is first in their internal priority list. Concrete
 *   symptom: SvelteKit form-action POSTs returned `application/json`
 *   action-result payloads instead of following a `redirect(303, ...)` as
 *   an HTTP 303, rendering the JSON body as text in the iframe. Accept is
 *   a content-negotiation signal, not a browser-identifier — every browser
 *   sends similar Accept strings per request context — so this addition
 *   does not weaken the "no browser identity" invariant meaningfully.
 * - accept-encoding — response compression negotiation (gzip/br). Without
 *   it, apps send uncompressed responses on every payload. Not a browser
 *   identifier — every modern browser sends the same set.
 *
 * Lowercase because `proxyReq.getHeaderNames()` returns lowercase names in
 * Node; the allowlist check in Plan 03b's proxy-factory does a case-sensitive
 * `includes()` against this array.
 *
 * `as const` gives Plan 03b a `readonly ["host", "connection", ...]` tuple
 * type so `HEADER_ALLOWLIST[number]` narrows to the union of literal
 * strings — the same source of truth also drives the CI cookie-egress test's
 * assertion table (Plan 04).
 */
export const HEADER_ALLOWLIST = [
  "host",
  "connection",
  "upgrade",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-protocol",
  "content-type",
  "content-length",
  "range",
  "if-range",
  "accept",
  "accept-encoding",
] as const;
