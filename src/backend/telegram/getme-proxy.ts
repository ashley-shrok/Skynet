/**
 * Phase 79 Plan 03 Task 1 — Telegram Bot API getMe proxy.
 *
 * Backend-side proxy for validating a Telegram bot token via
 * `https://api.telegram.org/bot<TOKEN>/getMe`. The token never leaves the
 * backend — the frontend POSTs the token to /telegram/validate; this
 * module reaches out to Telegram, parses the response, and returns a
 * stable discriminated-union shape.
 *
 * Shape mirrors src/backend/matrix/matrix-admin-client.ts:127-171
 * (loginAsUser) verbatim except:
 *   - GET (no body, no Authorization header)
 *   - URL: Telegram Bot API getMe endpoint (token in URL path segment)
 *   - Timeout: 10s (Telegram is fast; matrix admin uses 30s)
 *   - Response parsed as { ok, result:{ id, username?, first_name? }, description? }
 *
 * Security invariants (per plan.md <threat_model> T-79-03-04):
 *   - NEVER log the bot token value. Log only `{operation, botUsername?}`.
 *   - Return stable error strings — never leak Telegram's raw response body.
 */
import { databaseLogger } from "../utils/logger.js";

/** 10s AbortController timeout for the getMe call. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Stable error emitted on AbortError timeout. */
const ERR_TIMEOUT = "Telegram unreachable";
/** Stable error emitted on any other thrown error (network/parse). */
const ERR_PROXY = "Telegram proxy error";
/** Stable error emitted when Telegram returns 2xx but result.username is missing. */
const ERR_NO_USERNAME = "Bot has no username set (create one via @BotFather)";
/** Fallback error when Telegram rejects the token without a description string. */
const ERR_DEFAULT_REJECT = "Telegram rejected token";

/** Discriminated-union return shape. */
export type ValidateBotTokenResult =
  | { ok: true; botUsername: string; botId: number; firstName: string }
  | { ok: false; error: string };

interface TelegramGetMeResponse {
  ok: boolean;
  result?: {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    username?: string;
  };
  description?: string;
  error_code?: number;
}

/**
 * Validate a Telegram bot token by calling the Telegram getMe API.
 *
 * On success returns `{ok:true, botUsername, botId, firstName}`; on any
 * failure (Telegram-side rejection, timeout, network error, malformed
 * response) returns `{ok:false, error}` with a stable error string.
 *
 * The token is included in the URL path segment (Telegram's own auth
 * convention — no header alternative exists) but is NEVER logged.
 */
export async function validateBotToken(
  botToken: string,
): Promise<ValidateBotTokenResult> {
  const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getMe`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // Telegram returns 200 with {ok:false, description} for auth errors as
    // well as for other API errors — parse the body regardless of HTTP status.
    let data: TelegramGetMeResponse | null = null;
    try {
      data = (await response.json()) as TelegramGetMeResponse;
    } catch {
      // Non-JSON body (rare — Telegram always returns JSON, but be safe).
      return { ok: false, error: ERR_PROXY };
    }

    if (!data || data.ok !== true) {
      return {
        ok: false,
        error:
          typeof data?.description === "string" && data.description.length > 0
            ? data.description
            : ERR_DEFAULT_REJECT,
      };
    }

    const result = data.result;
    if (!result || typeof result.id !== "number") {
      return { ok: false, error: ERR_DEFAULT_REJECT };
    }

    if (typeof result.username !== "string" || result.username.length === 0) {
      return { ok: false, error: ERR_NO_USERNAME };
    }

    const botUsername = result.username;
    const botId = result.id;
    const firstName =
      typeof result.first_name === "string" ? result.first_name : "";

    databaseLogger.info("telegram getMe proxy ok", {
      operation: "telegram_getme_proxy",
      botUsername,
    });

    return { ok: true, botUsername, botId, firstName };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: ERR_TIMEOUT };
    }
    // Log a redacted error — the token value is NEVER passed here.
    databaseLogger.error("telegram getMe proxy error", err, {
      operation: "telegram_getme_proxy",
    });
    return { ok: false, error: ERR_PROXY };
  }
}
