/**
 * Telegram notification sender.
 *
 * Sends a DM notification to the user's linked Telegram chat through the
 * user's own bot, with an "Open in Skynet" button deep-linking to the conversation.
 * The full text travels in the message itself, so delivery doesn't depend on
 * the phone fetching anything from this server afterwards.
 *
 * Reliability discipline:
 *   - Retries transient failures (network/timeout, 429 flood control, 5xx)
 *     up to MAX_ATTEMPTS, honouring Telegram's retry_after.
 *   - Logs EVERY outcome — success included — so a missing notification can
 *     always be traced: `telegram_send_ok` / `telegram_send_failed`.
 *   - Never throws: the push-trigger loop must not be disturbed by a
 *     delivery failure.
 */

import { databaseLogger } from "../utils/logger.js";
import { userCanUseNotifications } from "./notifications-access.js";
import { buildClickUrl, type PushPayload } from "./notification-payload.js";
import { callTelegram, getSkynetPublicUrl } from "./telegram-api.js";
import { getBot, unlinkChat } from "./telegram-bots.js";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 3_000];
/**
 * Honour Telegram's flood-control wait up to this long. Sends to one user
 * run in a queue off the push-trigger loop (notify-user.ts), so waiting is
 * cheap; giving up early would just guarantee another 429.
 */
const MAX_RETRY_AFTER_S = 300;

/** Flat (not a union) — the backend tsconfig isn't strict enough to narrow on ok. */
export interface TelegramSendResult {
  ok: boolean;
  /** When ok. */
  messageId?: number;
  attempts?: number;
  /** When !ok. errorCode/description accompany "send_failed". */
  reason?: "no_bot" | "no_access" | "not_linked" | "send_failed";
  errorCode?: number;
  description?: string;
}

/** Injected for tests so retries don't actually wait. */
let sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function _setSleepForTests(fn: (ms: number) => Promise<void>): void {
  sleep = fn;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Message text in Telegram HTML parse mode. Title-only hides the preview body. */
export function buildTelegramText(payload: PushPayload, titleOnly: boolean): string {
  if (titleOnly) {
    const name = payload.title.replace(/:\s*$/, "");
    return `<b>${escapeHtml(name)}</b>\nNew message`;
  }
  return `<b>${escapeHtml(payload.title)}</b>\n${escapeHtml(payload.body)}`;
}

/**
 * Absolute "Open in Skynet" URL, or null when there's nothing to open:
 * system notifications (agentHostId null, e.g. the test send) have no
 * conversation, and a SKYNET_PUBLIC_URL that isn't https can't be used
 * (Telegram rejects relative and non-http button URLs, and a bad button
 * would fail the whole send).
 */
export function buildOpenUrl(payload: PushPayload): string | null {
  if (payload.agentHostId === null) return null;
  const base = getSkynetPublicUrl();
  if (!base.startsWith("https://")) return null;
  return base + buildClickUrl(payload.agentMxid, payload.agentHostId);
}

function isRetryable(errorCode: number): boolean {
  return errorCode === 0 || errorCode === 429 || errorCode >= 500;
}

export async function sendTelegramToUser(
  userId: string,
  payload: PushPayload,
): Promise<TelegramSendResult> {
  if (!userCanUseNotifications(userId)) return { ok: false, reason: "no_access" };
  const bot = getBot(userId);
  if (!bot) return { ok: false, reason: "no_bot" };
  if (!bot.chatId) return { ok: false, reason: "not_linked" };

  const openUrl = buildOpenUrl(payload);
  const params: Record<string, unknown> = {
    chat_id: bot.chatId,
    text: buildTelegramText(payload, bot.titleOnly),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
  if (openUrl) {
    params.reply_markup = {
      inline_keyboard: [[{ text: "Open in Skynet", url: openUrl }]],
    };
  }

  let lastCode = 0;
  let lastDescription = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await callTelegram<{ message_id: number }>(bot.token, "sendMessage", params);
    if (res.ok) {
      databaseLogger.info("[telegram] notification sent", {
        operation: "telegram_send_ok",
        userId,
        agentMxid: payload.agentMxid,
        messageId: res.result.message_id,
        attempts: attempt,
      });
      return { ok: true, messageId: res.result.message_id, attempts: attempt };
    }

    lastCode = res.errorCode ?? 0;
    lastDescription = res.description ?? "";
    const retry = attempt < MAX_ATTEMPTS && isRetryable(lastCode);
    databaseLogger.warn("[telegram] send attempt failed", {
      operation: "telegram_send_attempt_failed",
      userId,
      agentMxid: payload.agentMxid,
      attempt,
      errorCode: lastCode,
      description: lastDescription,
      willRetry: retry,
    });
    if (!retry) break;

    const waitMs =
      lastCode === 429 && res.retryAfter
        ? Math.min(res.retryAfter, MAX_RETRY_AFTER_S) * 1000
        : BACKOFF_MS[attempt - 1];
    await sleep(waitMs);
  }

  // 403 = the user blocked their bot or deleted the chat. Unlink so the
  // settings page shows "Open my bot" again instead of "Connected".
  if (lastCode === 403) {
    try {
      await unlinkChat(userId);
    } catch (err) {
      databaseLogger.warn("[telegram] unlink after 403 failed", {
        operation: "telegram_unlink_after_403_failed",
        userId,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  databaseLogger.warn("[telegram] notification NOT delivered", {
    operation: "telegram_send_failed",
    userId,
    agentMxid: payload.agentMxid,
    errorCode: lastCode,
    description: lastDescription,
    hint:
      lastCode === 403
        ? "user blocked their bot — chat unlinked; they reconnect from Preferences"
        : lastCode === 401
          ? "bot token revoked — user must paste a new one in Preferences"
          : undefined,
  });
  return { ok: false, reason: "send_failed", errorCode: lastCode, description: lastDescription };
}
