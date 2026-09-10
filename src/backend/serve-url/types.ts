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
 * leftmost DNS label of a `<hostname>-<port>.serve.term.<domain>` request
 * per D-11 (split on last dash; right side must be all-digits port). The
 * `host` field is the DB row resolved via `resolveHostByName(hostname,
 * userId)` per D-17 (owned-only lookup, matches Phase 78 file-URL
 * precedent).
 */
export interface ServeTarget {
  /** DNS-legal hostname portion of the label — the AGENT's host name, NOT
   *  the SSH tunnel bind address. Lowercased for lookup per D-13. */
  hostname: string;
  /** Positive integer TCP port on the AGENT's host where the reverse-proxy
   *  target listens. NOT the SSH port. */
  port: number;
  /** Resolved DB host row. Used to derive SSH credentials + pool key
   *  (`${host.ip}:${host.port ?? 22}:${host.username}`) for tunnel setup. */
  host: Host;
}

/**
 * The five distinct interstitial failure classes per D-14. Each maps 1:1
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
 */
export type ErrorClass =
  | "port_not_listening"
  | "host_unreachable"
  | "permission_denied"
  | "ssh_failure"
  | "auth_missing";

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
 *
 * Explicitly EXCLUDED from allowlist (denied by default):
 * - cookie / cookie2 (Phase 78 D-04 cookie-egress invariant, D-05 test-enforced)
 * - authorization
 * - x-skynet-* (any Skynet-internal header)
 * - user-agent, referer, origin (upstream never sees browser identity)
 * - x-forwarded-* (Caddy stripped these already at the edge)
 * - accept, accept-*, if-*, cache-control, pragma, dnt, etc. (denied by omission)
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
] as const;
