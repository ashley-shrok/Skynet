/**
 * Telegram Bot API client — one thin `callTelegram` wrapper used by the
 * sender, the per-user update pollers, and the setup routes.
 *
 * Every user sets up their OWN bot (Preferences → Notifications), so every
 * call takes the bot token explicitly; there is no instance-wide bot.
 *
 * NEVER log a bot token — it is embedded in every request URL, so request
 * URLs are never logged either.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

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
 * Call a Bot API method as the bot identified by `token`, with a JSON body.
 * Never throws: network failures and timeouts come back as
 * `{ ok: false, errorCode: 0 }`.
 */
export async function callTelegram<T>(
  token: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<TelegramResult<T>> {
  if (!token) {
    return { ok: false, errorCode: 0, description: "no bot token" };
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
