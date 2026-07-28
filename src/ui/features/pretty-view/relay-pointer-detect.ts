/**
 * Phase 17 Plan 03 (RELAYBUB-02) — file-pointer detector for recv.sh bodies.
 *
 * When recv.sh writes a long inbound relay body to a file instead of
 * inlining it, the WS `relay_inbound.body` field contains a line of the form:
 *
 *   [long message, N chars — full text at ~/.claude/identities/<id>/relay-state/messages/<eventid>.txt — Read it] «...»
 *
 * or the path may appear alone as the body.
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
 * Character class matches plan 17-02's WHITELIST_REGEX:
 *   ~/.claude/identities/<id>/relay-state/messages/<eventid>.txt
 * where user and identity names are [a-z0-9_-] and eventid is [A-Za-z0-9_-].
 *
 * Updated 2026-07-28 (UAT Bug 2 fix): now uses the actual recv.sh identity-dir output
 * path shape (prev. form used a /tmp path). The recv.sh preview line format uses em-dash
 * boundaries (" — "); JS \s matches the ASCII space adjacent to the em-dash so
 * the (?:^|\s)..(?:\s|$) boundary shape still works without regex changes.
 */

/**
 * Matches an identity-dir relay message path preceded and followed by whitespace
 * or start/end of string. Group 1 = the absolute path.
 *
 * Path shape: /home/<user>/.claude/identities/<id>/relay-state/messages/<eventid>.txt
 * Character classes:
 *   - user and identity name: [a-z0-9_-] (POSIX-safe lowercase)
 *   - event-id: [A-Za-z0-9_-] (Matrix event ids are base64url-like; dot excluded)
 */
export const POINTER_REGEX =
  /(?:^|\s)(\/home\/[a-z0-9_-]+\/\.claude\/identities\/[a-z0-9_-]+\/relay-state\/messages\/[A-Za-z0-9_-]+\.txt)(?:\s|$)/;

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
