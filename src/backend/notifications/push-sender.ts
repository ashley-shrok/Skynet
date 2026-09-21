/**
 * Phase 128 Plan 02 Task 3 — web-push wrapper with 410/404 inline pruning.
 *
 * What this module does:
 *   - Exports `sendPushToUser(userId, payload)` — a never-throws function
 *     safe to call from a hot loop (Plan 06's trigger loop depends on this
 *     contract, T-128-09 mitigation).
 *   - Fetches every subscription of `userId` from the push_subscriptions
 *     table and dispatches web-push in parallel via Promise.all (D-14 —
 *     fire on every subscribed device).
 *   - Inline-prunes rows whose provider returns 410 Gone or 404 Not Found
 *     (D-13 subscription lifecycle). Prune path calls DatabaseSaveTrigger
 *     .forceSave("push-subscription-prune-dead") exactly ONCE per wave
 *     (guarded by `prunedAny` — successful sends do NOT churn the disk,
 *     T-128-10 mitigation).
 *   - Logs at info-level on prune with `endpoint.slice(0, 40)` truncation
 *     ONLY (T-128-07 mitigation — full endpoint URLs are capability tokens
 *     and never appear in log payloads). Non-410 errors log at warn-level
 *     with same truncation.
 *   - Calls `webpush.setVapidDetails(...)` ONCE at module load — the
 *     web-push library caches these internally for every subsequent
 *     sendNotification call, so we don't need to pass them per-call.
 *
 * Why the byte-mirror of relay-room-sessions-store.ts:86-105:
 *   PATTERNS.md § S2 is explicit — the forceSave + try/catch + .warn
 *   fallback + disk-sat-guard shape is a load-bearing pattern. Same
 *   shape in every store module means one place to audit the discipline.
 *   Do NOT invent a new logging shape or a new save-trigger shape.
 *
 * Why never-throws contract:
 *   Plan 06's push-trigger loop will call this from a per-user hot loop.
 *   A single unhandled throw here would stall the trigger loop for that
 *   user (worst case: for all users if we're unlucky with the async
 *   scheduler). Every catch is inside the sender; forceSave failures are
 *   absorbed to .warn; nothing propagates.
 *
 * Why TTL:60 + urgency:"high":
 *   Per RESEARCH.md § Pattern 2. TTL 60 = if the push provider can't
 *   deliver within a minute, drop it (a 10-minute-old "you have a new
 *   message" ping is worse than none). urgency:"high" tells the provider
 *   this is user-facing / wake-the-device.
 */

import webpush from "web-push";
import { db, DatabaseSaveTrigger } from "../database/db/index.js";
import { databaseLogger } from "../utils/logger.js";
import { getVapidDetails } from "./vapid-config.js";

// ---------------------------------------------------------------------------
// Module-load: configure web-push with our VAPID tuple ONCE.
//
// Reading env vars at import time is the same discipline as vapid-config.ts
// — an operator hot-swap of skynet.env requires a process restart to pick up
// new keys. That's intentional (avoids stale-key-in-memory drift).
//
// If vapid-config throws here (missing/malformed env), the process fails
// to import this module — which is what we want. starter.ts's
// assertVapidConfigAtBoot (Plan 08) fires BEFORE this import happens, so
// the operator sees the structured VAPID error first, not a cryptic import
// crash. Belt-and-suspenders: even if the boot gate is bypassed, this
// import would still fail fast.
// ---------------------------------------------------------------------------

const { subject, publicKey, privateKey } = getVapidDetails();
webpush.setVapidDetails(subject, publicKey, privateKey);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Wire-format for the notification payload the service worker receives.
 * Kept small — Web Push has a ~4KB payload cap after aes128gcm encryption
 * overhead, and Apple's push service is stricter than that.
 *
 *   title:     lock-screen title line — usually the agent's display name.
 *   body:      lock-screen body line — the preview text (D-07).
 *   roomId:    Matrix room ID for the SW's notificationclick deep-link
 *              (D-08).
 *   agentMxid: sender mxid (for future per-agent routing / iconography).
 */
export interface PushPayload {
  title: string;
  body: string;
  roomId: string;
  agentMxid: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a push notification to EVERY subscription registered for `userId`
 * (D-14). Prunes dead endpoints inline (D-13); never throws (T-128-09).
 *
 * The empty-subscription case is a no-op: zero rows → return immediately,
 * no sendNotification calls, no forceSave, no logs. The trigger loop can
 * safely call this every message-arrival tick even before the user has
 * opted in.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  const rows = db.$client
    .prepare(
      "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
    )
    .all(userId) as SubscriptionRow[];

  if (rows.length === 0) {
    // Silent no-op. This is the common case for users who haven't opted
    // in yet — do NOT log at info level, that would flood.
    return;
  }

  const payloadJson = JSON.stringify(payload);
  let prunedAny = false;

  // Dispatch in parallel — D-14 (fire on every subscribed device) + latency
  // guard (serial dispatch across N devices adds N * push-provider-RTT).
  // Every task swallows its own exception; Promise.all never rejects.
  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          payloadJson,
          { TTL: 60, urgency: "high" },
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        const truncatedEndpoint = row.endpoint.slice(0, 40); // T-128-07

        if (statusCode === 410 || statusCode === 404) {
          // Dead endpoint — prune inline (D-13). DELETE is safe even if
          // the row was already removed concurrently — result.changes 0
          // is not an error, just a no-op.
          db.$client
            .prepare("DELETE FROM push_subscriptions WHERE id = ?")
            .run(row.id);
          prunedAny = true;
          databaseLogger.info("[push] pruned dead subscription", {
            operation: "push_subscription_pruned",
            userId,
            endpoint: truncatedEndpoint,
            statusCode,
          });
        } else {
          // Transient (5xx, network) or misconfig (401/403). Do NOT prune —
          // the subscription may work on the next tick. Just warn so ops
          // sees the failure rate.
          databaseLogger.warn("[push] send failed (non-410)", {
            operation: "push_send_failed",
            userId,
            statusCode,
            endpoint: truncatedEndpoint,
            error: err instanceof Error ? err.message : "unknown",
          });
        }
      }
    }),
  );

  // Disk-sat guard: only fire the forceSave when we actually mutated the
  // table. Successful sends must NOT churn the on-disk encrypted DB
  // (T-128-10 mitigation; disk-sat hotfix pattern from
  // relay-room-sessions-store.ts:86-90).
  if (prunedAny) {
    try {
      await DatabaseSaveTrigger.forceSave("push-subscription-prune-dead");
    } catch (err) {
      // forceSave failure is absorbed — the prune is already applied in
      // RAM. Worst case: on a non-graceful shutdown, the row comes back
      // and gets re-pruned on the next 410 hit. Better than propagating
      // and stalling the trigger loop.
      databaseLogger.warn(
        "push subscription prune forceSave failed — write persisted to RAM only",
        {
          operation: "push_prune_force_save_failed",
          userId,
          error: err instanceof Error ? err.message : "unknown",
        },
      );
    }
  }
}
