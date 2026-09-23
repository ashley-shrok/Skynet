import type { IncomingMessage } from "node:http";

/**
 * Phase 111 SKEW-07: extract `?build=<tag>` from the WS upgrade request URL.
 * Every WS server calls this at the top of its `wss.on("connection")`
 * handler BEFORE any JWT auth work. Returns null on absence.
 *
 * See guac-specific counterpart at src/backend/guacamole/*: the encrypted
 * token payload carries buildId, NOT the URL query — that server's
 * third-party framing prevents URL-query use.
 */
export function extractSkewTag(
  req: Pick<IncomingMessage, "url">,
): string | null {
  if (!req.url) return null;
  try {
    const parsed = new URL(req.url, "http://localhost");
    return parsed.searchParams.get("build");
  } catch {
    return null;
  }
}
