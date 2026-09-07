// Phase 79 Plan 07 — Telegram bridge frontend API client.
//
// Thin wrappers around authApi for the 4 routes defined in Plan 03:
//   POST /telegram/validate      — proxied getMe check
//   POST /telegram/activate      — write telegram_bot_tokens row + register bot
//   POST /telegram/disconnect    — delete row + unregister bot
//   GET  /telegram/:identityKey  — status view for the tab
//
// Every wrapper converts authApi's throw-on-non-2xx into a stable discriminated-
// union response — so the calling React component can render inline errors
// without try/catch at every call site.
//
// Security invariants (see plan § threat_model T-79-07-01, T-79-07-03):
//   • The bot token is only ever placed in a POST body.
//   • The bot token is NEVER placed in a URL query string.
//   • The bot token is NEVER logged (no console.log / console.error on the token).
//
// authApi is the JWT-attaching axios instance from src/ui/main-axios.ts.
// We import from "@/main-axios" — same path used by voice-api.ts and
// identities-api.ts (alias defined in vite.config.ts + tsconfig.app.json).

import { authApi } from "@/main-axios";

// Local formatter — we do NOT reuse main-axios's `handleApiError` because its
// signature is `(error, operation) => never` (it throws). We want a string.
// Only surfaces axios-shaped .response.data.error and .message; NEVER
// includes any bot-token substring (token is a POST body field the caller
// controls; we don't fish it back out of the request config).
function formatError(err: unknown): string {
  if (err && typeof err === "object") {
    const anyErr = err as {
      response?: { data?: { error?: string; message?: string } };
      message?: string;
    };
    return (
      anyErr.response?.data?.error ??
      anyErr.response?.data?.message ??
      anyErr.message ??
      "Network error"
    );
  }
  return "Network error";
}

interface ValidateWireResp {
  ok?: boolean;
  botUsername?: string;
  botId?: number;
  firstName?: string;
  error?: string;
}

export async function postTelegramValidate(input: {
  botToken: string;
}): Promise<
  | { ok: true; botUsername: string; botId: number; firstName: string }
  | { ok: false; error: string }
> {
  try {
    const resp = await authApi.post<ValidateWireResp>("/telegram/validate", {
      botToken: input.botToken,
    });
    const data = resp.data ?? {};
    if (data.ok === true && typeof data.botUsername === "string" && typeof data.botId === "number") {
      return {
        ok: true,
        botUsername: data.botUsername,
        botId: data.botId,
        firstName: data.firstName ?? "",
      };
    }
    return { ok: false, error: data.error ?? "Telegram rejected token" };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

interface ActivateWireResp {
  ok?: boolean;
  botUsername?: string;
  error?: string;
}

export async function postTelegramActivate(input: {
  identityKey: string;
  botToken: string;
  humanUserId: string;
  telegramChatId?: string | null;
}): Promise<
  | { ok: true; botUsername: string }
  | { ok: false; error: string; status?: number }
> {
  try {
    const resp = await authApi.post<ActivateWireResp>("/telegram/activate", input);
    const data = resp.data ?? {};
    if (data.ok === true && typeof data.botUsername === "string") {
      return { ok: true, botUsername: data.botUsername };
    }
    return { ok: false, error: data.error ?? "activation failed" };
  } catch (err) {
    const anyErr = err as { response?: { status?: number } };
    return { ok: false, error: formatError(err), status: anyErr.response?.status };
  }
}

interface DisconnectWireResp {
  ok?: boolean;
  error?: string;
}

export async function postTelegramDisconnect(input: {
  identityKey: string;
}): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  try {
    const resp = await authApi.post<DisconnectWireResp>("/telegram/disconnect", input);
    const data = resp.data ?? {};
    if (data.ok === true) return { ok: true };
    return { ok: false, error: data.error ?? "disconnect failed" };
  } catch (err) {
    const anyErr = err as { response?: { status?: number } };
    return { ok: false, error: formatError(err), status: anyErr.response?.status };
  }
}

interface StatusWireResp {
  status?: "unconfigured" | "connected";
  botUsername?: string;
  telegramChatId?: string | null;
}

export async function getTelegramStatus(
  identityKey: string,
): Promise<
  | { status: "unconfigured" }
  | { status: "connected"; botUsername: string; telegramChatId: string | null }
  | { status: "error"; error: string }
> {
  try {
    const resp = await authApi.get<StatusWireResp>(
      `/telegram/${encodeURIComponent(identityKey)}`,
    );
    const data = resp.data ?? {};
    if (data.status === "connected" && typeof data.botUsername === "string") {
      return {
        status: "connected",
        botUsername: data.botUsername,
        telegramChatId: data.telegramChatId ?? null,
      };
    }
    return { status: "unconfigured" };
  } catch (err) {
    return { status: "error", error: formatError(err) };
  }
}

interface PendingStatusWireResp {
  chatId?: string | null;
  error?: string;
}

/**
 * Phase 83 Plan 05 — poll endpoint the TelegramTab hits every ~3s while
 * awaiting the user's /start message. Returns `{ chatId }` (may be null
 * if the bridge hasn't seen a /start yet).
 *
 * Distinct from getTelegramStatus above (which returns the full
 * connect-page shape used for initial modal paint). This one is the
 * hot poll — minimal payload, no botUsername (caller already has it
 * from the pending-start state).
 *
 * Wire: identityKey is passed as an axios `params` query param (URL-encoded
 * by axios), NOT URL-embedded — matches CONTEXT § 5 endpoint shape and the
 * backend's `req.query.identityKey` parse.
 */
export async function getTelegramPendingStatus(
  identityKey: string,
): Promise<
  | { ok: true; chatId: string | null }
  | { ok: false; error: string; status?: number }
> {
  try {
    const resp = await authApi.get<PendingStatusWireResp>(
      `/telegram/status`,
      { params: { identityKey } },
    );
    const data = resp.data ?? {};
    if ("chatId" in data) {
      return { ok: true, chatId: data.chatId ?? null };
    }
    return { ok: false, error: data.error ?? "unexpected response" };
  } catch (err) {
    const anyErr = err as { response?: { status?: number } };
    return {
      ok: false,
      error: formatError(err),
      status: anyErr.response?.status,
    };
  }
}
