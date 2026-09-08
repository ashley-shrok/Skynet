/**
 * Pure username → mxid transform + password generator, consumed by
 * POST /users/create (Phase 88 slice A).
 *
 * Locked decisions:
 *   D-06: mxid format `@<sanitized-username>_human:<server_name>`
 *   D-07: bijective escape sanitizer — `_` → `__` FIRST (escape-the-escape),
 *         then `@` → `_at_`, `.` → `_dot_`. Deterministic, collision-free.
 *   D-08: password = 48-char hex from randomBytes(24), discarded on the spot.
 *
 * This module is SELF-CONTAINED: the only import is node:crypto. No I/O,
 * no async beyond the generateHumanRelayPassword return type, no logger,
 * no cross-module imports from anywhere else in the codebase.
 */

import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Escape table for bijective username → Matrix localpart sanitization (D-07)
//
// ORDERING IS LOAD-BEARING (Pitfall 3, 88-RESEARCH.md):
//   The escape character `_` MUST be doubled FIRST. If any other entry ran
//   first it would inject a literal `_` into the string that could then be
//   doubled by the `_` → `__` rule, creating non-bijective collisions.
//   Example: if `@` → `_at_` ran first, then `_` → `__` would double the
//   underscores in that replacement — making `foo@bar` and `foo_at_bar` map
//   to the same output. The correct output is:
//     "foo@bar"    → "foo_at_bar"    (@ escaped; the underscores in _at_ are NEW)
//     "foo_at_bar" → "foo__at__bar"  (_ doubled FIRST; then underscores are safe)
// ---------------------------------------------------------------------------
const ESCAPE_TABLE: readonly (readonly [RegExp, string])[] = [
  [/_/g, "__"], // MUST be first — escape the escape character itself
  [/@/g, "_at_"],
  [/\./g, "_dot_"],
];

// The sanitizer output on the localpart segment must satisfy MXID_RE from
// matrix-admin-routes.ts line 27: `/^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/`.
// This module does not import that regex — Plan 03's integration tests re-verify
// at the route boundary.

/**
 * Transform a Skynet username into a Matrix localpart suitable for use in an
 * mxid. The transformation is:
 *   1. Lowercase the input.
 *   2. Apply the ESCAPE_TABLE in order (escape-the-escape ordering, D-07).
 *
 * The `_human` suffix is NOT appended here — that is the caller's concern
 * (see buildHumanMxid). Separating the two makes the sanitizer reusable
 * and testable independently.
 *
 * Bijectivity guarantee: no two distinct valid Skynet usernames can produce
 * the same sanitized localpart, because the `_` → `__` escape runs before any
 * other escape that introduces `_` chars. Proof is in the test suite (tests
 * 4-6 in username-to-mxid.test.ts).
 */
export function sanitizeUsernameToLocalpart(username: string): string {
  let s = username.toLowerCase();
  for (const [pattern, replacement] of ESCAPE_TABLE) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

/**
 * Build the full Matrix mxid for a human relay identity (D-06).
 *
 * Format: `@<sanitized-username>_human:<serverName>`
 *
 * The `_human` suffix distinguishes human relay accounts from agent accounts
 * in the same homeserver namespace (agents carry no suffix). Legacy identifiers
 * without the suffix (Ashley, Zoey, Laura from the one-shot import) continue
 * to work — the suffix is convention going forward, not a schema invariant.
 *
 * @param username   - The Skynet username (may be email-form, e.g. `ashley@aitherhealth.com`)
 * @param serverName - The Matrix server-name portion only (no scheme, no port);
 *                     obtain via extractServerName(adminCreds.homeserverBase).
 */
export function buildHumanMxid(username: string, serverName: string): string {
  return `@${sanitizeUsernameToLocalpart(username)}_human:${serverName}`;
}

/**
 * Generate a random one-time password for a human relay Matrix account (D-08).
 *
 * Returns 48 hex chars (96 bits of entropy) — mirroring the
 * `generateAgentPassword` function in
 * identity-birth-orchestrator.ts line 460 (renamed for human relay use).
 *
 * IMPORTANT: This value is passed to `createOrUpdateUser` and discarded on
 * the spot per D-08 — never logged, never stored. Skynet accesses the relay
 * account going forward exclusively via `loginAsUser` (admin auth), so the
 * password is intentionally unrecoverable after mint.
 */
export function generateHumanRelayPassword(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Extract the server-name portion from a homeserver base URL.
 *
 * Strips scheme (http:// / https://), trailing path segments, and port suffix.
 *
 * Examples:
 *   "https://matrix.example.com:8448" → "matrix.example.com"
 *   "http://100.113.23.63:8008"       → "100.113.23.63"
 *   "matrix.example.com"              → "matrix.example.com"
 *   "https://matrix.example.com/path" → "matrix.example.com"
 *
 * Rationale for duplication: the canonical source (`extractServerName` in
 * identity-birth-orchestrator.ts lines 470-478) is private/unexported in a
 * large, unrelated orchestrator module. Duplicating avoids cross-module
 * coupling between matrix-specific helpers and the identity birth path.
 * When identity-birth-orchestrator ever exports it, the duplicate can be
 * removed and swapped for the import — that is a future refactor, not this
 * slice's concern.
 */
export function extractServerName(homeserverBase: string): string {
  // Strip scheme prefix if present (http:// or https://)
  let s = homeserverBase.replace(/^https?:\/\//, "");
  // Strip trailing slash and any path
  s = s.split("/")[0];
  // Strip port suffix
  s = s.split(":")[0];
  return s;
}
