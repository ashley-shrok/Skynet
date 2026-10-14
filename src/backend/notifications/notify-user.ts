/**
 * Notification dispatch for the push-trigger loop — currently Telegram only.
 *
 * Fired without awaiting: Telegram retries (and its retry_after) can take
 * tens of seconds, and the push-trigger loop must not stall other users'
 * notifications behind one slow send. sendTelegramToUser logs every outcome
 * itself.
 */

import type { PushPayload } from "./notification-payload.js";
import { sendTelegramToUser } from "./telegram-sender.js";
import { databaseLogger } from "../utils/logger.js";

export async function sendNotificationToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  void sendTelegramToUser(userId, payload).catch((err: unknown) => {
    databaseLogger.warn("[telegram] sendTelegramToUser threw (contract breach)", {
      operation: "telegram_send_threw",
      userId,
      error: err instanceof Error ? err.message : "unknown",
    });
  });
}
