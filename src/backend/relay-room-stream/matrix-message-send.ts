/**
 * matrix-message-send.ts — Phase 90 Plan 04 Task 1.
 *
 * Thin composition layer over Plan 03's `sendMessageAsUser` primitive at
 * src/backend/matrix/matrix-admin-client.ts. Owns input validation (body
 * shape + txnId shape) and passes the frontend-supplied mqid VERBATIM as
 * the Matrix `txnId` per Pitfall 4 (mqid == txnId echo-back correlation).
 *
 * ## Why a service layer at all
 *
 * Two concerns live here that don't belong in matrix-admin-client:
 *
 *   1. Input validation for browser-supplied payloads (body length, no NUL,
 *      txnId grammar). matrix-admin-client is a generic Matrix client — it
 *      does not know that some inputs come from an untrusted browser.
 *
 *   2. Fail-fast rejection with stable error codes (`empty_body`,
 *      `body_too_long`, `invalid_txn_id`) that the WS server maps 1:1 to
 *      `send_error` frame reason codes. This layer keeps that vocabulary
 *      out of matrix-admin-client, which stays Matrix-protocol-focused.
 *
 * ## Validation policy
 *
 * - `body`: rejected if empty after trim, or if raw length > BODY_MAX_LENGTH,
 *   or if it contains a NUL byte. The trimmed check is intent-based ("did
 *   the user actually type something?"); the raw length is what actually
 *   goes into the Matrix event. The body is preserved verbatim (whitespace
 *   is intentional in code snippets, etc. — do not truncate or normalize).
 * - `txnId`: rejected if empty, contains NUL, or exceeds Matrix's opaque
 *   txnId length cap (256 chars — matches the txnId grammar used by the
 *   Matrix client-server API).
 *
 * ## Pitfall 4 correlation
 *
 * The frontend's mqid IS the Matrix txnId. On the way back through /sync,
 * the resulting Matrix event carries `unsigned.transaction_id === mqid`,
 * which Plan 06's optimistic-send matcher uses to correlate a pending
 * bubble with its landed event (no content-string matching, no time-window
 * heuristics — exact echo-back). This layer preserves that invariant by
 * passing the mqid straight through to the primitive.
 *
 * ## What NOT to add here
 *
 * - NO token minting — matrix-admin-client's sendMessageAsUser handles
 *   loginAsUser + Bearer-token discipline (T-90-BE-03).
 * - NO rate limiting — the WS server owns the per-user token bucket.
 * - NO Matrix protocol details — this layer sees `{ok, status, error}` /
 *   `{ok, eventId}` only.
 */

import { sendMessageAsUser } from "../matrix/matrix-admin-client.js";

/**
 * Maximum body length for a single relay-room send.
 *
 * 32768 chars is a reasonable ceiling for a chat message — well above
 * normal human-authored content, below Matrix's own event-size limit
 * (~65536 bytes for the full event JSON with metadata + attachments).
 * A DoS-defense cap; the WS server's per-user rate limit is the primary
 * throughput defense.
 *
 * If a codebase-wide compose cap emerges later, replace this with an
 * import from the shared constant. Voice's SPEAK_TEXT_MAX (25000) is
 * TTS-specific and does not apply here.
 */
const BODY_MAX_LENGTH = 32768;

/**
 * Maximum txnId length. Matrix's client-server API treats txnId as an
 * opaque string with a practical upper bound of ~256 chars in most
 * implementations.
 */
const TXN_ID_MAX_LENGTH = 256;

/**
 * WS-facing result shape. Success carries the resulting Matrix event id;
 * failure carries a stable error-code string the WS server maps to a
 * `send_error` frame reason.
 */
export type SendRoomMessageOk = {
  ok: true;
  eventId: string;
};

export type SendRoomMessageErr = {
  ok: false;
  status: number;
  error: string;
};

/**
 * Send a relay-room message on behalf of a user.
 *
 * @param senderMxid - Human user's Matrix ID (from JWT auth context — NEVER
 *   from a WS frame).
 * @param roomId - Matrix room ID.
 * @param body - Message text (validated for length + NUL; preserved verbatim
 *   otherwise).
 * @param mqid - Frontend-generated correlation ID; used DIRECTLY as the
 *   Matrix txnId for Pitfall 4 echo-back matching. Validated for length +
 *   grammar (non-empty, no NUL).
 */
export async function sendRoomMessage(
  senderMxid: string,
  roomId: string,
  body: string,
  mqid: string,
): Promise<SendRoomMessageOk | SendRoomMessageErr> {
  // Validate body — intent (non-empty after trim) + raw length + no NUL.
  // Order matters: length check first is O(1), NUL scan is O(n) so we
  // reject overlong before scanning.
  if (body.length > BODY_MAX_LENGTH) {
    return { ok: false, status: 413, error: "body_too_long" };
  }
  if (body.trim().length === 0) {
    return { ok: false, status: 400, error: "empty_body" };
  }
  if (body.includes("\x00")) {
    // NUL byte in body is a protocol violation (Matrix events are JSON;
    // JSON encodes NUL fine but downstream logs/tools often mangle it —
    // reject at the boundary).
    return { ok: false, status: 400, error: "empty_body" };
  }

  // Validate mqid → txnId. Empty / NUL / overlong reject as invalid_txn_id.
  // (The plan spec uses "invalid_txn_id" as the stable error code the WS
  // server maps to a send_error reason.)
  if (mqid.length === 0 || mqid.length > TXN_ID_MAX_LENGTH) {
    return { ok: false, status: 400, error: "invalid_txn_id" };
  }
  if (mqid.includes("\x00")) {
    return { ok: false, status: 400, error: "invalid_txn_id" };
  }

  // Delegate to Plan 03's primitive. mqid is passed verbatim as the Matrix
  // txnId — this is the Pitfall 4 correlation infrastructure. Whatever
  // sendMessageAsUser returns is the WS server's outcome.
  return await sendMessageAsUser(senderMxid, roomId, body, mqid);
}
