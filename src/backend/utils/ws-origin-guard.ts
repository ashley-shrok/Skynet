// Phase 103 D-08: reject WebSocket upgrades from *.serve.term.<domain>
// origins. WS doesn't do CORS preflight, so this is the WS-layer complement
// to Plan 02's cors-config.ts reject (which handles state-changing HTTP
// endpoints via browser preflight). Imported by every WebSocketServer
// definition in the backend (terminal.ts, docker-console.ts, tunnel.ts,
// fleet-status-server.ts, relay-room-stream-server.ts).
//
// Threat model: the widened JWT cookie (Plan 02 D-02, Domain=term.<domain>)
// flows on any *.term.<domain> WS handshake. Without this guard, a malicious
// agent-supplied page served at foo-3000.serve.term.<domain> could open a
// WS to term.<domain>'s command surfaces (terminal, docker-console, etc.)
// and drive them authenticated as the user. This helper closes that hole.

// Regex tolerates both http:// and https:// schemes because dev/preview
// origins may be http. Requires a subdomain segment BEFORE `.serve.term.`
// (`[^/]+\.serve\.term\.`) so the bare `serve.term.<domain>` — which has
// no legitimate WS use case — does NOT match. Character class is identical
// in shape to Plan 02's cors-config.ts SERVE_SUBDOMAIN_RE, modulo the
// http|https prefix.
export const SERVE_SUBDOMAIN_ORIGIN_RE =
  /^https?:\/\/[^/]+\.serve\.term\.[a-zA-Z0-9.-]+$/;

export function isServeSubdomainOrigin(
  origin: string | undefined | null,
): boolean {
  if (!origin) return false;
  return SERVE_SUBDOMAIN_ORIGIN_RE.test(origin);
}

// Inspect the Origin header of an inbound request. Returns true when the
// upgrade should be rejected as a serve-subdomain-originated cross-site
// attempt.  Non-browser clients (curl, backend-to-backend) don't send an
// Origin header — they return false (not rejected purely for absence).
// Defensive: some proxies fold repeated headers into an array; only bare
// strings are matched, so anomalous shapes fall through to `false` (safer
// than rejecting on a shape we don't understand — the existing JWT auth
// gate on each WSS still applies).
export function rejectServeSubdomain(req: {
  headers: { origin?: string | string[] };
}): boolean {
  const origin = req.headers?.origin;
  if (typeof origin !== "string") return false;
  return isServeSubdomainOrigin(origin);
}
