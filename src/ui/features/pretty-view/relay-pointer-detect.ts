/**
 * Phase 17 Plan 03 (RELAYBUB-02) — file-pointer detector for recv.sh bodies.
 *
 * When recv.sh writes a long inbound relay body to a temp file instead of
 * inlining it, the WS `relay_inbound.body` field contains a line of the form:
 *
 *   body written to /tmp/relay-msg-<id>.txt
 *
 * or the path appears alone as the body.
 *
 * `detectFilePointer(body)` recognises this form and returns the absolute path
 * + the original line so the caller can fetch the real content and show the
 * pointer line as a preview header above the fetched body.
 *
 * Security (T-17-03-02): POINTER_REGEX is client-side defence-in-depth only.
 * The authoritative SSRF gate is the backend's WHITELIST_REGEX (plan 17-02).
 * Even if a malicious body tricked this regex into returning a non-whitelisted
 * path, the backend rejects it with HTTP 400. encodeURIComponent in the caller
 * prevents path traversal via the query string.
 *
 * Character class matches plan 17-02's WHITELIST_REGEX: /tmp/relay-msg-*.txt
 * where * may be [A-Za-z0-9._-]+.
 */

/**
 * Matches a /tmp/relay-msg-*.txt path preceded and followed by whitespace or
 * start/end of string. Group 1 = the absolute path.
 */
export const POINTER_REGEX =
  /(?:^|\s)(\/tmp\/relay-msg-[A-Za-z0-9._-]+\.txt)(?:\s|$)/;

export interface FilePointer {
  pointerPath: string;
  pointerLine: string;
}

/**
 * Detect whether `body` is a recv.sh file-pointer form.
 *
 * @returns `{ pointerPath, pointerLine }` if matched, `null` otherwise.
 */
export function detectFilePointer(body: string): FilePointer | null {
  const match = body.match(POINTER_REGEX);
  if (!match) return null;
  return {
    pointerPath: match[1],
    pointerLine: body.trim(),
  };
}
