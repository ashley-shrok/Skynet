/**
 * Frontend API client for Telegram notification setup.
 *
 * Each user sets up their own bot: create it with @BotFather, paste the
 * token (PUT /telegram/bot), then open it via the Start link and tap Start.
 *
 *   GET    /push-subscriptions/telegram       → TelegramStatus
 *   PUT    /push-subscriptions/telegram/bot   → TelegramStatus  ({ token })
 *   POST   /push-subscriptions/telegram/link  → { url }  (open the bot, tap Start)
 *   POST   /push-subscriptions/telegram/test  → { ok, error? }
 *   PATCH  /push-subscriptions/telegram       → TelegramStatus  ({ titleOnly })
 *   DELETE /push-subscriptions/telegram       → TelegramStatus  (removes the whole setup)
 */

import axios from "axios";
import { authApi, handleApiError } from "@/main-axios";

export interface TelegramStatus {
  /** True once the user has saved their bot's token. */
  setUp: boolean;
  botUsername?: string;
  /** True once the user tapped Start in their bot. */
  linked: boolean;
  telegramName?: string;
  titleOnly?: boolean;
}

export interface TelegramTestResult {
  ok: boolean;
  error?: string;
}

export async function getTelegramStatus(): Promise<TelegramStatus> {
  try {
    const response = await authApi.get("/push-subscriptions/telegram");
    return response.data as TelegramStatus;
  } catch (error) {
    handleApiError(error, "get telegram status");
  }
}

/**
 * Save the user's bot token. When the server explains a rejection
 * (malformed token, refused by Telegram, bot used by another account) the
 * thrown Error carries that explanation verbatim — handleApiError would
 * replace some of them (e.g. 409) with generic text.
 */
export async function putTelegramBot(token: string): Promise<TelegramStatus> {
  try {
    const response = await authApi.put("/push-subscriptions/telegram/bot", { token });
    return response.data as TelegramStatus;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status !== 401) {
      const serverMessage = (error.response?.data as { error?: unknown } | undefined)?.error;
      if (typeof serverMessage === "string") throw new Error(serverMessage);
    }
    handleApiError(error, "save telegram bot");
  }
}

export async function postTelegramLink(): Promise<{ url: string }> {
  try {
    const response = await authApi.post("/push-subscriptions/telegram/link");
    return response.data as { url: string };
  } catch (error) {
    handleApiError(error, "post telegram link");
  }
}

export async function postTelegramTest(): Promise<TelegramTestResult> {
  try {
    const response = await authApi.post("/push-subscriptions/telegram/test");
    return response.data as TelegramTestResult;
  } catch (error) {
    handleApiError(error, "post telegram test");
  }
}

export async function patchTelegram(titleOnly: boolean): Promise<TelegramStatus> {
  try {
    const response = await authApi.patch("/push-subscriptions/telegram", { titleOnly });
    return response.data as TelegramStatus;
  } catch (error) {
    handleApiError(error, "patch telegram");
  }
}

export async function deleteTelegram(): Promise<TelegramStatus> {
  try {
    const response = await authApi.delete("/push-subscriptions/telegram");
    return response.data as TelegramStatus;
  } catch (error) {
    handleApiError(error, "delete telegram");
  }
}
