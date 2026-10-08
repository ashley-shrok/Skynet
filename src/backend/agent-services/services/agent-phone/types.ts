/**
 * agent-phone outcome codes. `completed` and `no_response` are successes
 * (the message was delivered); the rest come back to the agent as the
 * error code. Engine-level codes (malformed, expired, not_configured, ...)
 * are added on top by the engine; see ../../engine/types.ts.
 *
 * After a call was placed:
 *   placement_error, queue_error, busy, no_answer, canceled,
 *   no_response, completed, timeout (backend poll deadline), unknown
 * Before any call:
 *   unknown_user, not_permitted, no_phone_on_file
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
  | "unknown_user"
  | "not_permitted"
  | "no_phone_on_file";
