/**
 * Notification dispatch for the push-trigger loop — currently Telegram only.
 *
 * The loop is never made to wait: Telegram retries (and its retry_after) can
 * take a while, and other users' notifications must not stall behind one
 * slow send. But sends to the SAME user go out one at a time, in order, so
 * a retried message can't be overtaken by the next one. sendTelegramToUser
 * logs every outcome itself.
 */

import type { PushPayload } from "./notification-payload.js";
import { sendTelegramToUser } from "./telegram-sender.js";
import { databaseLogger } from "../utils/logger.js";

/** Tail of each user's send chain; removed once the chain drains. */
const queues = new Map<string, Promise<void>>();

export async function sendNotificationToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  const previous = queues.get(userId) ?? Promise.resolve();
  const next = previous
    .then(() => sendTelegramToUser(userId, payload))
    .then(
      () => undefined,
      (err: unknown) => {
        databaseLogger.warn("[telegram] sendTelegramToUser threw (contract breach)", {
          operation: "telegram_send_threw",
          userId,
          error: err instanceof Error ? err.message : "unknown",
        });
      },
    );
  queues.set(userId, next);
  void next.then(() => {
    if (queues.get(userId) === next) queues.delete(userId);
  });
}

/** Test-only: forget every queue. */
export function _resetNotifyQueuesForTests(): void {
  queues.clear();
}
