/**
 * Frontend API client for Telegram notification setup.
 *
 *   GET    /push-subscriptions/telegram       → TelegramStatus
 *   POST   /push-subscriptions/telegram/link  → { url }  (open in Telegram, tap Start)
 *   POST   /push-subscriptions/telegram/test  → { ok, error? }
 *   PATCH  /push-subscriptions/telegram       → TelegramStatus  ({ titleOnly })
 *   DELETE /push-subscriptions/telegram       → TelegramStatus
 */

import { authApi, handleApiError } from "@/main-axios";

export interface TelegramStatus {
  /** False when this server has no Telegram bot configured. */
  available: boolean;
  botUsername?: string;
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
