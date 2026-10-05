/**
 * agent-phone — frontend client for the self-service phone endpoints.
 *
 *   GET    /users/me/phone → { phoneE164: string | null }
 *   PUT    /users/me/phone → { ok: true, phoneE164 }
 *   DELETE /users/me/phone → { ok: true }
 *
 * A null number means the feature is not enabled for this user; PUT and
 * DELETE both 403 in that case (only an admin can grant a number).
 */

import { authApi, handleApiError } from "@/main-axios";

export const PHONE_E164_RE = /^\+[1-9]\d{7,14}$/;

/**
 * Strip the separators people naturally type ("+1 (716) 555-0100") so the
 * value can be checked against E.164. Does not guess a country code.
 */
export function normalizePhoneInput(raw: string): string {
  return raw.replace(/[\s().-]/g, "");
}

export async function getMyPhone(): Promise<string | null> {
  try {
    const response = await authApi.get("/users/me/phone");
    return (response.data as { phoneE164: string | null }).phoneE164 ?? null;
  } catch (error) {
    handleApiError(error, "get phone number");
  }
}

export async function updateMyPhone(phoneE164: string): Promise<string> {
  try {
    const response = await authApi.put("/users/me/phone", { phoneE164 });
    return (response.data as { phoneE164: string }).phoneE164;
  } catch (error) {
    handleApiError(error, "update phone number");
  }
}

export async function clearMyPhone(): Promise<void> {
  try {
    await authApi.delete("/users/me/phone");
  } catch (error) {
    handleApiError(error, "clear phone number");
  }
}
