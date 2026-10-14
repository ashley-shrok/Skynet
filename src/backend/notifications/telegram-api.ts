/**
 * Telegram Bot API client — config getters plus one thin `callTelegram`
 * wrapper used by the sender, the update poller, and the link routes.
 *
 * Config is OPTIONAL (unlike ntfy's fail-fast gate): with no
 * TELEGRAM_BOT_TOKEN set, `isTelegramConfigured()` is false, the poller never
 * starts, the preferences pane reports Telegram as unavailable, and sends are
 * silent no-ops. That keeps instances that haven't created a bot (e.g. a peer
 * deploy) booting exactly as before.
 *
 * NEVER log the bot token — it is embedded in every request URL, so request
 * URLs are never logged either.
 */

import { systemLogger } from "../utils/logger.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export function getTelegramBotToken(): string {
  return (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
}

export function isTelegramConfigured(): boolean {
  return getTelegramBotToken() !== "";
}

/**
 * Public base URL of this Skynet instance (no trailing slash). Used to turn
 * the relative deep-link from buildClickUrl into an absolute URL for the
 * "Open in Skynet" button — Telegram rejects relative button URLs.
 */
export function getSkynetPublicUrl(): string {
  return (process.env.SKYNET_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
}

/**
 * Normalized result of a Bot API call. Never thrown — callers branch on ok.
 * Flat rather than a discriminated union: the backend tsconfig isn't strict,
 * so `ok: true | false` unions don't narrow.
 */
export interface TelegramResult<T> {
  ok: boolean;
  /** Present when ok. */
  result?: T;
  /** When !ok: Telegram's error code, or 0 for network/timeout errors. */
  errorCode?: number;
  description?: string;
  /** Seconds to wait before retrying (Telegram's 429 flood control). */
  retryAfter?: number;
}

interface TelegramWireResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

/**
 * Call a Bot API method with a JSON body. Never throws: network failures and
 * timeouts come back as `{ ok: false, errorCode: 0 }`.
 */
export async function callTelegram<T>(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<TelegramResult<T>> {
  const token = getTelegramBotToken();
  if (!token) {
    return { ok: false, errorCode: 0, description: "TELEGRAM_BOT_TOKEN not set" };
  }
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await response.json()) as TelegramWireResponse<T>;
    if (body.ok) {
      return { ok: true, result: body.result as T };
    }
    return {
      ok: false,
      errorCode: body.error_code ?? response.status,
      description: body.description ?? `HTTP ${response.status}`,
      retryAfter: body.parameters?.retry_after,
    };
  } catch (err) {
    return {
      ok: false,
      errorCode: 0,
      description: err instanceof Error ? err.message : "unknown",
    };
  }
}

let cachedBotUsername: string | null = null;

/**
 * The bot's @username (without the @), via getMe. Cached after the first
 * success; null when unconfigured or Telegram is unreachable.
 */
export async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  if (!isTelegramConfigured()) return null;
  const res = await callTelegram<{ username?: string }>("getMe", {});
  if (res.ok && res.result.username) {
    cachedBotUsername = res.result.username;
    return cachedBotUsername;
  }
  systemLogger.warn("[telegram] getMe failed", {
    operation: "telegram_get_me_failed",
    errorCode: res.ok ? 0 : res.errorCode,
    description: res.ok ? "no username in getMe result" : res.description,
  });
  return null;
}

/** Test-only: forget the cached bot username. */
export function _resetTelegramApiCacheForTests(): void {
  cachedBotUsername = null;
}
