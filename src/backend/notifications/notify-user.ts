/**
 * Notification fan-out — every channel the user has set up gets the DM
 * notification. Today that's ntfy (legacy, kept until Telegram is proven)
 * and Telegram.
 *
 * Telegram is fired without awaiting: its retries (and Telegram's
 * retry_after) can take tens of seconds, and the push-trigger loop must not
 * stall other users' notifications behind one slow send. sendTelegramToUser
 * logs every outcome itself.
 */

import { sendPushToUser, type PushPayload } from "./ntfy-sender.js";
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
  await sendPushToUser(userId, payload);
}
