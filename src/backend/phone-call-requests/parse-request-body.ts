/**
 * phone-call-requests/parse-request-body.ts — slim, side-effect-free parser
 * for agent-phone request bodies.
 *
 * Structurally cloned from image-gen-requests/parse-request-body.ts:
 *   - Explicit-reject unknown top-level keys BEFORE per-field validation
 *     (fail-explicit, do not silently drop caller params).
 *   - Every failure uses `outcome: "malformed"` — other outcomes surface
 *     from the worker + adapter downstream.
 *   - No dependency on any side-effecting module — keeps the scan
 *     orchestrator's per-tick claim path dependency-free.
 *
 * Field caps are chosen to bound worst-case behavior without punishing
 * normal callers. `message` is generously capped at 2000 chars (per shape:
 * no cap explicitly requested by the operator; 2000 keeps a runaway 200KB
 * agent output from becoming a 30-minute phone monologue but leaves plenty
 * of room for reasonable notifications).
 */

import type { PhoneCallRequestBody } from "./types.js";

/** Max length for `caller_name` — enough for "Display Name the Long Role Name" plus room. */
export const CALLER_NAME_MAX_LENGTH = 200;

/** Max length for `to_user` — matches Skynet's practical username limit. */
export const TO_USER_MAX_LENGTH = 200;

/**
 * Max length for `message`. Ashley waved off a strict cap ("let's not solve
 * a problem we don't have"), so this is a defensive upper bound only —
 * chosen to prevent a runaway agent from generating a 30-minute monologue,
 * not to constrain normal calls. 2000 chars ≈ 2-3 minutes of TTS speech.
 */
export const MESSAGE_MAX_LENGTH = 2000;

/**
 * Known-good top-level keys. Any other key triggers `outcome: "malformed"`
 * so callers see the typo instead of thinking their extra param took effect.
 */
const KNOWN_KEYS = new Set<string>([
  "caller_name",
  "to_user",
  "message",
  "requested_at",
]);

/**
 * ISO-Z timestamp shape check — permissive but not accepting garbage.
 * The worker only uses this for a coarse TTL comparison, so exact fidelity
 * matters less than "did the caller drop something Date.parse can handle".
 */
function isIsoZTimestamp(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    return false;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms);
}

/**
 * Parse and validate a request file's raw JSON body.
 * Returns ok:true + PhoneCallRequestBody on success, or ok:false +
 * outcome:"malformed" + message on any validation failure.
 *
 * The `_uuid` first arg is kept for symmetry with image-gen's parser
 * (unused today; reserved for future cross-request companion validation).
 */
export function parseRequestBody(
  _uuid: string,
  rawBody: string,
): { ok: true; body: PhoneCallRequestBody } | { ok: false; outcome: "malformed"; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (err) {
    return {
      ok: false,
      outcome: "malformed",
      message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      outcome: "malformed",
      message: "request body must be a JSON object",
    };
  }

  const obj = parsed as Record<string, unknown>;

  // Unknown-key rejection FIRST (fail-explicit).
  for (const k of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(k)) {
      return {
        ok: false,
        outcome: "malformed",
        message: `unrecognized field: ${k}`,
      };
    }
  }

  // caller_name — required non-empty string, bounded length.
  const callerName = obj.caller_name;
  if (typeof callerName !== "string") {
    return {
      ok: false,
      outcome: "malformed",
      message: "caller_name must be a string",
    };
  }
  if (callerName.trim().length === 0) {
    return {
      ok: false,
      outcome: "malformed",
      message: "caller_name must not be empty",
    };
  }
  if (callerName.length > CALLER_NAME_MAX_LENGTH) {
    return {
      ok: false,
      outcome: "malformed",
      message: `caller_name exceeds ${CALLER_NAME_MAX_LENGTH} chars`,
    };
  }

  // to_user — required non-empty string, bounded length.
  const toUser = obj.to_user;
  if (typeof toUser !== "string") {
    return {
      ok: false,
      outcome: "malformed",
      message: "to_user must be a string",
    };
  }
  if (toUser.trim().length === 0) {
    return {
      ok: false,
      outcome: "malformed",
      message: "to_user must not be empty",
    };
  }
  if (toUser.length > TO_USER_MAX_LENGTH) {
    return {
      ok: false,
      outcome: "malformed",
      message: `to_user exceeds ${TO_USER_MAX_LENGTH} chars`,
    };
  }

  // message — required non-empty string, bounded length.
  const message = obj.message;
  if (typeof message !== "string") {
    return {
      ok: false,
      outcome: "malformed",
      message: "message must be a string",
    };
  }
  if (message.trim().length === 0) {
    return {
      ok: false,
      outcome: "malformed",
      message: "message must not be empty",
    };
  }
  if (message.length > MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      outcome: "malformed",
      message: `message exceeds ${MESSAGE_MAX_LENGTH} chars`,
    };
  }

  // requested_at — required ISO-Z timestamp.
  const requestedAt = obj.requested_at;
  if (typeof requestedAt !== "string" || !isIsoZTimestamp(requestedAt)) {
    return {
      ok: false,
      outcome: "malformed",
      message: "requested_at must be an ISO-Z timestamp",
    };
  }

  return {
    ok: true,
    body: {
      caller_name: callerName,
      to_user: toUser,
      message,
      requested_at: requestedAt,
    },
  };
}
