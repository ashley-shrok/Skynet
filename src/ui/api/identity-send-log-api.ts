// Phase 85 (D-04, D-05): identity-send-log fire-and-forget client. Called
// from the universal compose-send funnel in ComposeBox.useComposeSend on
// every send-attempt (text submit, reset button, thumbs-up, recap,
// quick-send, and any future compose-surface button — universal per D-03).
// Never propagates errors — delivery-failure does not gate the stamp
// (attempts count per D-05).

import { authApi } from "@/main-axios";

/**
 * Fire-and-forget POST to /identity-send-log/stamp. Records that Ashley
 * hit send toward `identityName` at `ts` (defaults to Date.now()). The
 * return value is void: callers MUST NOT await this, and error
 * propagation is fully suppressed. Any error — network, 4xx/5xx,
 * malformed input — is swallowed into a structured warn log. Attempts
 * count regardless of delivery success (D-05).
 */
export function stampIdentitySendLog(identityName: string, ts?: number): void {
  if (identityName == null || identityName === "") {
    console.warn({
      operation: "identity_send_log_stamp_skipped",
      reason: "empty_or_null_identity_name",
    });
    return;
  }
  const body = { identityName, ts: ts ?? Date.now() };
  try {
    authApi.post("/identity-send-log/stamp", body).catch((err: unknown) => {
      console.warn({
        operation: "identity_send_log_stamp_failed",
        identityName,
        ts: body.ts,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  } catch (err: unknown) {
    console.warn({
      operation: "identity_send_log_stamp_failed_sync",
      identityName,
      ts: body.ts,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
