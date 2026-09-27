/**
 * phone-call-requests/types.ts
 *
 * Wire types for the agent-phone file-drop broker protocol. Internal-to-
 * backend — not exported to the frontend.
 *
 * Structurally patterned on image-gen-requests/types.ts (Phase 116) with
 * these agent-phone-specific deltas:
 *   - Request carries {caller_name, to_user, message, requested_at}.
 *     to_user is a Skynet username the worker resolves to a phoneE164 via
 *     the users table; caller_name is the TTS-friendly identifier the
 *     Bland prompt interpolates into the pickup + receipt phrases.
 *   - No companion-file case (no image-to-image analog).
 *   - No `n`/`size` passthroughs; every request is a single one-turn call.
 *   - Outcome enum has TWELVE values (9 Bland-side + 3 pre-call) — see
 *     the shape doc's "outcome enum" section for the taxonomy rationale.
 *   - Response is a SINGLE file (`<uuid>.response.json`) carrying
 *     `outcome` + optional `transcript`/`message`, rather than the split
 *     .success/.failure that image-gen uses. Single-file keeps the
 *     agent-side helper's poll loop simple (one filename to watch).
 *
 * No runtime imports — types-only file. Consumed by parse-request-body,
 * queue, worker, adapter, scan-orchestrator.
 */

/**
 * Request file body schema. The request-id (uuid) lives in the filename
 * `<uuid>.json`, NOT the body.
 *
 * All four fields are REQUIRED. Unknown top-level keys are REJECTED by
 * parseRequestBody with a `malformed` outcome — the same "fail-explicit,
 * don't silently drop caller-specified params" invariant image-gen uses.
 *
 * `caller_name` — TTS-friendly agent identifier composed by the caller
 *   (e.g. "Clipper the Box Maintainer"). Interpolated into the Bland task
 *   prompt at the pickup line ("Hi, this is X, with a message for you")
 *   and the end-of-turn receipt ("Your reply's going back to X"). Kept
 *   verbatim — the backend does no formatting or sanitization beyond
 *   basic type/length validation.
 *
 * `to_user` — the Skynet username of the human to call. Worker resolves
 *   this to a phoneE164 via a DB lookup at process time.
 *
 * `message` — the line to deliver over the phone.
 *
 * `requested_at` — ISO-Z timestamp set by the helper at file-drop time.
 *   Used for the dequeue-time TTL check (a request older than the
 *   agent-side poll deadline is stale and should not be dialed).
 */
export interface PhoneCallRequestBody {
  caller_name: string;
  to_user: string;
  message: string;
  requested_at: string;
}

/**
 * An in-flight pending phone-call item held in the in-memory queue.
 * Carries the parsed request contents plus sweep-provided metadata.
 */
export interface PendingPhoneCall {
  hostId: string; // HostRecord.id (string form)
  hostIdNum: number; // parseInt(hostId, 10) for downstream numeric APIs
  uuid: string; // from filename (strip .json)
  body: PhoneCallRequestBody;

  /**
   * Sweep-side validation failure (mirrors image-gen's
   * PendingImageGen.malformedReason).
   *
   * When the sweep's parse-request-body step finds the request body
   * malformed, it still enqueues a PendingPhoneCall so the request-id gets
   * a failure response back to the caller (rather than silently
   * disappearing). The malformed reason travels here.
   *
   * When present: worker short-circuits, skips DB lookup + adapter call,
   * and drops a `{outcome:"malformed", message}` response file so the
   * caller can iterate on the request body. When absent: normal path
   * (TTL check → resolve phone → build prompt → adapter call → write
   * response).
   */
  malformedReason?: string;
}

/**
 * Response-file outcome enum. Written verbatim into
 * `<uuid>.response.json` as the `outcome` field.
 *
 * Bland-side outcomes come after a call was placed:
 *   - placement_error : the third-party service refused POST /v1/calls
 *   - queue_error     : accepted but never connected
 *   - busy            : target line was busy
 *   - no_answer       : no pickup / voicemail
 *   - canceled        : mid-flight cancel
 *   - no_response     : human answered, hung up before speaking
 *   - completed       : human answered and spoke
 *   - timeout         : backend's own poll deadline passed
 *   - unknown         : defensive fallback for unmapped states
 *
 * Pre-call outcomes come from failures BEFORE any Bland call:
 *   - malformed        : request body failed parse
 *   - unknown_user     : to_user does not exist in the Skynet DB
 *   - no_phone_on_file : user exists but their phoneE164 is null
 */
export type PhoneCallOutcome =
  | "placement_error"
  | "queue_error"
  | "busy"
  | "no_answer"
  | "canceled"
  | "no_response"
  | "completed"
  | "timeout"
  | "unknown"
  | "malformed"
  | "unknown_user"
  | "no_phone_on_file";

/**
 * Response file body — written to `<uuid>.response.json`.
 *
 * `transcript` is populated when outcome is `completed` or `no_response`
 * (the Bland-side call happened and returned a transcript). For every
 * other outcome, `transcript` is absent.
 *
 * `message` is a short human-readable amplifier — e.g. the underlying
 * Bland error message on placement_error, the username on unknown_user,
 * the specific parse error on malformed. Absent when the outcome name is
 * self-explanatory (completed, no_response, busy).
 *
 * `call_length_seconds` is populated for outcomes where Bland actually
 * ran the call (completed, no_response, no_answer, busy, canceled).
 * Absent for pre-call outcomes and placement/queue errors that never
 * generated a call.
 */
export interface PhoneCallResponse {
  outcome: PhoneCallOutcome;
  transcript?: string;
  message?: string;
  call_length_seconds?: number;
}
