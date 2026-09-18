/**
 * image-gen-requests/parse-request-body.ts — slim, side-effect-free parser
 * for image-gen request bodies. Mirrors the shape of
 * spawn-requests/parse-request-body.ts (Phase 99) with these image-gen
 * deltas:
 *
 *   - Different field set (prompt/size/quality/n/ref + requested_at) per D-06.
 *   - CRITICAL D-06 delta: explicit-reject unknown top-level keys BEFORE
 *     per-field validation. Phase 99's parser silently accepts extras; this
 *     parser rejects them with `reason:"malformed", message:"unrecognized
 *     field: <k>"`. This prevents callers from believing a mistyped param
 *     took effect (T-116-01-03 tampering mitigation).
 *   - No dependency on ROLE_NAME_PATTERN or any other side-effecting module.
 *
 * WHY THIS EXISTS as a separate file (mirroring Phase 99 rationale): worker.ts
 * pulls in the adapter which reaches `fetch` + heavy runtime concerns. The
 * scan-orchestrator only needs the pure parser for its per-tick claim step —
 * keeping it dependency-free keeps the scan-orchestrator's test module graph
 * clean.
 *
 * The `_uuid` first arg is kept for symmetry with Phase 99's parser signature
 * (and to allow a future check that `ref`'s embedded uuid equals the request's
 * own uuid — currently deferred to the scan-orchestrator's companion-fetch
 * step per Plan 03).
 */

import type { ImageGenRequestBody } from "./types.js";

/**
 * Maximum length for the `prompt` field (chars). Matches OpenAI's own
 * documented 4000-char cap for gpt-image-1 prompts (RESEARCH.md V5).
 * Rejecting at this boundary prevents memory blowup + surfaces the caller-side
 * bug quickly rather than opaquely at the provider.
 */
export const PROMPT_MAX_LENGTH = 4000;

/**
 * Minimum / maximum for the optional `n` field (number of images to generate).
 * Upper cap prevents runaway multi-image bursts + matches typical OpenAI
 * batch limits.
 */
export const N_MIN = 1;
export const N_MAX = 10;

/**
 * Known-good top-level keys the parser accepts. Any other key present in the
 * body triggers a `reason: "malformed"` rejection per D-06 (fail-explicit,
 * do not silently drop). Note: `model` is intentionally NOT here (D-26 locks
 * the model to gpt-image-1 backend-side).
 */
const KNOWN_KEYS = new Set<string>(["prompt", "requested_at", "size", "quality", "n", "ref"]);

/**
 * Ref-filename shape: `<uuid>.ref.<ext>` where uuid is the standard 36-char
 * dashed UUID (8-4-4-4-12) and ext ∈ {png, jpg, jpeg, webp} (D-07).
 *
 * Note on the character class: the plan text specifies `[0-9a-f]{36}` but a
 * canonical UUID string is 32 hex chars + 4 hyphens = 36 chars total. Using
 * a pure hex 36-char class would reject the dashed form; using the strict
 * 8-4-4-4-12 dashed shape here — the scan-orchestrator (Plan 03) additionally
 * enforces the embedded uuid matches the request's own uuid.
 */
const REF_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.ref\.(png|jpg|jpeg|webp)$/i;

/**
 * Parse and validate a request file's raw JSON body.
 * Returns ok:true + ImageGenRequestBody on success, or ok:false + reason
 * + message on any validation failure (D-06, D-09).
 *
 * All failure paths use `reason: "malformed"` — other failure reasons (rate,
 * provider, expired, etc.) surface from the worker + adapter downstream.
 */
export function parseRequestBody(
  _uuid: string,
  rawBody: string,
): { ok: true; body: ImageGenRequestBody } | { ok: false; reason: "malformed"; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (err) {
    return {
      ok: false,
      reason: "malformed",
      message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "malformed", message: "body is not a JSON object" };
  }

  const obj = parsed as Record<string, unknown>;

  // ---------------------------------------------------------------------
  // D-06 CRITICAL: reject unrecognized top-level keys BEFORE per-field
  // validation. Fail-explicit prevents callers from thinking a mistyped
  // param took effect (T-116-01-03 tampering mitigation).
  // ---------------------------------------------------------------------
  for (const k of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(k)) {
      return { ok: false, reason: "malformed", message: `unrecognized field: ${k}` };
    }
  }

  // ---------------------------------------------------------------------
  // prompt — required, non-empty string, ≤ PROMPT_MAX_LENGTH chars
  // ---------------------------------------------------------------------
  const prompt = obj["prompt"];
  if (typeof prompt !== "string") {
    return { ok: false, reason: "malformed", message: "missing required field: prompt (must be string)" };
  }
  if (prompt.trim().length === 0) {
    return { ok: false, reason: "malformed", message: "prompt must be a non-empty string" };
  }
  if (prompt.length > PROMPT_MAX_LENGTH) {
    return {
      ok: false,
      reason: "malformed",
      message: `prompt exceeds ${PROMPT_MAX_LENGTH} character limit (got ${prompt.length})`,
    };
  }

  // ---------------------------------------------------------------------
  // requested_at — required, ISO-Z-parseable string (worker uses for TTL)
  // ---------------------------------------------------------------------
  const requested_at = obj["requested_at"];
  if (typeof requested_at !== "string") {
    return { ok: false, reason: "malformed", message: "missing required field: requested_at (must be ISO-8601 string)" };
  }
  if (isNaN(Date.parse(requested_at))) {
    return {
      ok: false,
      reason: "malformed",
      message: `requested_at is not a valid ISO-8601 timestamp: ${JSON.stringify(requested_at)}`,
    };
  }

  // ---------------------------------------------------------------------
  // size — optional string
  // ---------------------------------------------------------------------
  const size = obj["size"];
  if (size !== undefined && typeof size !== "string") {
    return { ok: false, reason: "malformed", message: "size must be a string when provided" };
  }

  // ---------------------------------------------------------------------
  // quality — optional string
  // ---------------------------------------------------------------------
  const quality = obj["quality"];
  if (quality !== undefined && typeof quality !== "string") {
    return { ok: false, reason: "malformed", message: "quality must be a string when provided" };
  }

  // ---------------------------------------------------------------------
  // n — optional integer in [N_MIN, N_MAX]
  // ---------------------------------------------------------------------
  const n = obj["n"];
  if (n !== undefined) {
    if (typeof n !== "number" || !Number.isInteger(n) || n < N_MIN || n > N_MAX) {
      return {
        ok: false,
        reason: "malformed",
        message: `n must be an integer between ${N_MIN} and ${N_MAX} (got ${JSON.stringify(n)})`,
      };
    }
  }

  // ---------------------------------------------------------------------
  // ref — optional string matching <uuid>.ref.<ext>
  // (The embedded-uuid-matches-request-uuid check is deferred to the
  // scan-orchestrator's companion-fetch step per Plan 03 — the parser
  // does not know its own uuid at call time here.)
  // ---------------------------------------------------------------------
  const ref = obj["ref"];
  if (ref !== undefined) {
    if (typeof ref !== "string") {
      return { ok: false, reason: "malformed", message: "ref must be a string when provided" };
    }
    if (!REF_PATTERN.test(ref)) {
      return {
        ok: false,
        reason: "malformed",
        message: `ref does not match <uuid>.ref.<png|jpg|jpeg|webp> shape: ${JSON.stringify(ref)}`,
      };
    }
  }

  // All optional fields have been type-narrowed by the checks above; assert
  // to their declared types when re-assembling to satisfy the interface.
  return {
    ok: true,
    body: {
      prompt,
      requested_at,
      ...(size !== undefined ? { size: size as string } : {}),
      ...(quality !== undefined ? { quality: quality as string } : {}),
      ...(n !== undefined ? { n: n as number } : {}),
      ...(ref !== undefined ? { ref: ref as string } : {}),
    },
  };
}
