/**
 * image-gen-requests/types.ts
 *
 * Wire types for the image-gen file-drop broker protocol (Phase 116 D-06,
 * D-08, D-09, D-27). Internal-to-backend — not exported to frontend.
 *
 * Mirrors the shape of src/backend/spawn-requests/types.ts (Phase 99), with
 * these image-gen-specific deltas:
 *   - Request carries a `prompt` + optional passthrough params to gpt-image-1
 *     (D-06 provider-native passthrough philosophy).
 *   - PendingImageGen carries an optional `refImage: Buffer` for the
 *     image-to-image companion-file case (D-07).
 *   - FailureReason is a closed set of 7 values locked by D-27.
 *   - Success response shape includes generated image filenames + generation
 *     time (D-08).
 *
 * No runtime imports — types-only file. Consumed by parse-request-body,
 * queue, worker, adapter, scan-orchestrator.
 */

/**
 * Request file body schema (D-06).
 * The request-id (uuid) lives in the filename `<uuid>.json`, NOT the body.
 *
 * `prompt` and `requested_at` are required; the rest are optional passthroughs
 * forwarded to OpenAI's gpt-image-1 API. Unrecognized top-level keys are
 * REJECTED by parseRequestBody with `reason: "malformed"` per D-06 — this is
 * the "fail-explicit, don't silently drop caller-specified params" invariant
 * that distinguishes this parser from Phase 99's spawn-request parser.
 */
export interface ImageGenRequestBody {
  prompt: string;
  requested_at: string; // ISO-Z timestamp — used by worker for D-22 TTL check
  size?: string;
  quality?: string;
  n?: number;
  ref?: string; // companion filename `<uuid>.ref.<ext>` per D-07
}

/**
 * An in-flight pending image-gen item held in the in-memory queue.
 * Carries the parsed request contents plus sweep-provided metadata + optional
 * companion reference-image bytes.
 */
export interface PendingImageGen {
  hostId: string; // HostRecord.id (string form)
  hostIdNum: number; // parseInt(hostId, 10) for downstream numeric APIs
  uuid: string; // from filename (strip .json)
  body: ImageGenRequestBody;
  refImage?: Buffer; // companion `.ref.*` bytes loaded at scan time (D-07)
  userId: string; // owner-userId from host record

  /**
   * Sweep-side validation failure (mirrors PendingBirth.malformedReason).
   *
   * When the sweep's parse-request-body step finds the request body
   * malformed, it still enqueues a PendingImageGen so the request-id gets a
   * failure file back to the caller (rather than silently disappearing). The
   * malformed reason travels here.
   *
   * When present: worker short-circuits, skips the adapter call entirely,
   * and drops a `{reason:"malformed", message}` failure file so the caller
   * can iterate on the request body.
   * When absent: normal path (TTL check → token acquire → adapter call).
   */
  malformedReason?: string;
}

/**
 * Success response file body (D-08).
 * Written to ~/fleet/image-gen-requests/<uuid>.success.json alongside the
 * companion PNG(s) at ~/fleet/image-gen-requests/<uuid>.success.<i>.png.
 *
 * `images` lists the companion PNG filenames (one per generated image when
 * caller set `n > 1`). `size`, `model`, `n`, `generation_time_ms` are always
 * present. `seed` is present only when OpenAI returns one.
 */
export interface SuccessResponse {
  images: string[]; // filenames like "<uuid>.success.0.png"
  size: string;
  model: string; // locked to "gpt-image-1" per D-26
  seed?: string;
  n: number;
  generation_time_ms: number;
}

/**
 * Failure reason enum (D-27).
 * EXACTLY these 7 values in this order — the closed set is locked by
 * CONTEXT.md D-27 and MUST NOT drift.
 */
export type FailureReason =
  | "content_blocked"
  | "rate_limited"
  | "provider_unavailable"
  | "not_configured"
  | "malformed"
  | "expired"
  | "unknown";

/**
 * Failure response file body (D-09).
 * Written to ~/fleet/image-gen-requests/<uuid>.failure.json.
 *
 * `message` is PRESENT and descriptive when `reason === "malformed"` (caller
 * can iterate on the request body); ABSENT or short-terse for every other
 * reason (caller escalates opaquely).
 */
export interface FailureResponse {
  reason: FailureReason;
  message?: string;
}
