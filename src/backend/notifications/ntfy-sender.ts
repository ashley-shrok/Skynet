/**
 * Phase 144 Plan 02 Task 2 — ntfy-based push publisher.
 *
 * Replaces Phase 128's browser-push system with a plain HTTP POST
 * to the ntfy container over the internal Docker network. Preserves the
 * never-throws fire-and-forget contract from push-sender.ts (T-128-09
 * mitigation) — sendPushToUser MUST NOT propagate errors to the trigger loop.
 *
 * ## Key design points
 *
 *   - One HTTP POST per DM (one topic per user — no multi-device fan-out).
 *   - Reads the user's topic from push_subscriptions WHERE user_id = ? —
 *     if no row found, returns silently (user hasn't set up ntfy; not an error).
 *   - Bearer auth with NTFY_PUBLISH_TOKEN — admin credential for the publisher
 *     identity (pre-provisioned in server.yml; env-var-only per HC-3).
 *   - Fires and forgets — no retry, no queue, no circuit breaker.
 *   - Failure paths log via databaseLogger.warn with structured operation
 *     strings (T-144-11 mitigation — silent loss with no trace is unacceptable).
 *   - 5-second AbortSignal.timeout on the fetch (T-144-10 mitigation).
 *
 * ## HC-4 fix: buildClickUrl handles null agentHostId
 *
 *   When agentHostId is null or empty, the `host` query param is OMITTED
 *   entirely from the click URL. A literal `host=null` or `host=undefined`
 *   in the URL would cause unexpected navigation in the iOS ntfy app on tap.
 *   The routes.ts /ntfy-test endpoint passes agentHostId: null for the test
 *   notification (there's no agent host to navigate to for a system ping).
 */

import { db } from "../database/db/index.js";
import { databaseLogger } from "../utils/logger.js";
import {
  getNtfyInternalPublishUrl,
  getNtfyPublishToken,
} from "./ntfy-config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Wire-format for the notification payload.
 *
 * Kept compatible with Phase 128's PushPayload to preserve the
 * push-trigger-loop.ts call site (which passes agentHostId as number
 * after already guarding against null at the trigger level).
 * Extended to accept null to support the /ntfy-test route which fires
 * a system notification with no specific host target (HC-4).
 *
 *   title:        notification title line (agent display name + ":")
 *   body:         preview text (D-07 — from preview-text.ts)
 *   agentMxid:    sender mxid (for deep-link openHarness param)
 *   agentHostId:  fleet hostId (for deep-link host param) — null → host param omitted
 */
export interface PushPayload {
  title: string;
  body: string;
  agentMxid: string;
  agentHostId: number | null;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TopicRow {
  topic_name: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the deep-link URL for the notification's Click header.
 *
 * Format (agentHostId non-null): `/?openHarness=<encoded-mxid>&host=<encoded-hostId>`
 * Format (agentHostId null):     `/?openHarness=<encoded-mxid>`   (NO host param — HC-4 fix)
 *
 * URLSearchParams is used to build the query string cleanly — no manual
 * string concatenation that could accidentally emit `host=null` or `host=`.
 *
 * @param agentMxid - The sender's Matrix ID (e.g. "@agent:skynet")
 * @param agentHostId - The fleet hostId (number or string) or null (system notification)
 *
 * HC-4 fix (T-144-23 mitigation): when agentHostId is null, the `host` query
 * param is omitted entirely. This prevents the iOS ntfy app from navigating
 * to `/?openHarness=...&host=null` which would fail to resolve a valid harness
 * view. The test notification route calls this with null; the trigger loop
 * already drops the push when agentHostId is null (before calling sendPushToUser),
 * so this is purely a safety net for the test/system notification case.
 */
export function buildClickUrl(
  agentMxid: string,
  agentHostId: string | number | null,
): string {
  const params = new URLSearchParams();
  params.set("openHarness", agentMxid);

  // HC-4: only add host param when agentHostId is a non-null, non-empty value.
  // NEVER emit "host=null" or "host=undefined" — that causes broken navigation.
  if (agentHostId !== null && agentHostId !== undefined && String(agentHostId) !== "") {
    params.set("host", String(agentHostId));
  }

  return "/?" + params.toString();
}

/**
 * Send a push notification to the user's ntfy topic.
 *
 * Never-throws contract (T-128-09 preserved): all errors are caught and
 * logged via databaseLogger.warn; nothing propagates to the trigger loop.
 *
 * Empty-subscription case: if no push_subscriptions row exists for this
 * user, returns silently. This is the common case for users who haven't
 * set up ntfy — do NOT log at info level (would flood the logs).
 *
 * T-144-11 mitigation: every failure path logs with structured operation
 * strings so silent notification loss is always traceable in the logs.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  // Read user's topic — one row per user (new ntfy schema, Phase 144).
  const row = db.$client
    .prepare(
      "SELECT topic_name FROM push_subscriptions WHERE user_id = ?",
    )
    .get(userId) as TopicRow | undefined;

  if (!row) {
    // Silent no-op: user hasn't set up ntfy yet. Common case — do NOT log.
    return;
  }

  const publishToken = getNtfyPublishToken();
  const clickUrl = buildClickUrl(payload.agentMxid, payload.agentHostId);
  const topicUrl = `${getNtfyInternalPublishUrl()}/${encodeURIComponent(row.topic_name)}`;

  try {
    const response = await fetch(topicUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${publishToken}`,
        Title: payload.title,
        Click: clickUrl,
        "Content-Type": "text/plain",
      },
      body: payload.body,
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      // T-144-11: non-2xx publish — log and return (never throw).
      databaseLogger.warn("[ntfy] publish failed", {
        operation: "ntfy_publish_failed",
        userId,
        statusCode: response.status,
      });
    }
  } catch (err) {
    // T-144-11: fetch threw (network error, timeout, abort) — log and return.
    databaseLogger.warn("[ntfy] publish threw", {
      operation: "ntfy_publish_threw",
      userId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}
