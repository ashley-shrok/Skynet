// Phase 79 Plan 07 Task 1 — tests for the Telegram bridge frontend API client.
//
// Mocks @/main-axios (authApi + handleApiError) and asserts each wrapper
// returns a stable discriminated-union response (never throws). The wrappers
// convert authApi's throw-on-non-2xx into `{ok:false, error}` so the calling
// React component can render inline errors without try/catch at every use site.
//
// Anti-regression: NO test constructs a URL containing the bot token as a
// query string; NO test asserts a console.log call. The wrappers must never
// place the token anywhere except a POST body.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/main-axios", () => ({
  authApi: {
    post: vi.fn(),
    get: vi.fn(),
  },
  // handleApiError in the real module signature is (error, operation) => never
  // — it throws. Our wrappers wrap authApi in try/catch and format the error
  // themselves; they never call handleApiError. Provide a stub anyway so the
  // module import resolves cleanly.
  handleApiError: vi.fn((err: unknown) => {
    throw err;
  }),
}));

import { authApi } from "@/main-axios";
import {
  postTelegramValidate,
  postTelegramActivate,
  postTelegramDisconnect,
  getTelegramStatus,
} from "./telegram-api";

const mockedPost = authApi.post as unknown as ReturnType<typeof vi.fn>;
const mockedGet = authApi.get as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedPost.mockReset();
  mockedGet.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// postTelegramValidate
// ─────────────────────────────────────────────────────────────────────────────

describe("postTelegramValidate", () => {
  it("returns {ok:true, botUsername, botId, firstName} on success", async () => {
    mockedPost.mockResolvedValueOnce({
      data: { ok: true, botUsername: "foo_bot", botId: 12345, firstName: "Foo" },
    });
    const result = await postTelegramValidate({ botToken: "1234567890:AAAsomething" });
    expect(result).toEqual({
      ok: true,
      botUsername: "foo_bot",
      botId: 12345,
      firstName: "Foo",
    });
    expect(mockedPost).toHaveBeenCalledWith("/telegram/validate", {
      botToken: "1234567890:AAAsomething",
    });
  });

  it("returns {ok:false, error} when Telegram rejects the token (server 200 with ok:false)", async () => {
    mockedPost.mockResolvedValueOnce({
      data: { ok: false, error: "Unauthorized" },
    });
    const result = await postTelegramValidate({ botToken: "bad" });
    expect(result).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("returns {ok:false, error} on network error (authApi throws)", async () => {
    mockedPost.mockRejectedValueOnce(new Error("Network down"));
    const result = await postTelegramValidate({ botToken: "1234567890:AAA" });
    expect(result.ok).toBe(false);
    // `"error" in result` narrowing pattern — matches Plan 03 deviation #2
    // workaround for TS strict:false narrowing quirk on discriminated unions
    // whose function-return type is imported from another module.
    if ("error" in result) {
      expect(result.error).toContain("Network down");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// postTelegramActivate
// ─────────────────────────────────────────────────────────────────────────────

describe("postTelegramActivate", () => {
  it("returns {ok:true, botUsername} on success and passes body verbatim", async () => {
    mockedPost.mockResolvedValueOnce({
      data: { ok: true, botUsername: "foo_bot" },
    });
    const result = await postTelegramActivate({
      identityKey: "alexander",
      botToken: "1234567890:AAAsomething",
      humanUserId: "user-42",
    });
    expect(result).toEqual({ ok: true, botUsername: "foo_bot" });
    expect(mockedPost).toHaveBeenCalledWith("/telegram/activate", {
      identityKey: "alexander",
      botToken: "1234567890:AAAsomething",
      humanUserId: "user-42",
    });
  });

  it("returns {ok:false, error, status} on 403 (identityKey not owned by caller)", async () => {
    const err: any = new Error("forbidden");
    err.response = { status: 403, data: { error: "not your identity" } };
    mockedPost.mockRejectedValueOnce(err);
    const result = await postTelegramActivate({
      identityKey: "someone_else",
      botToken: "1234567890:AAA",
      humanUserId: "user-42",
    });
    expect(result.ok).toBe(false);
    if ("status" in result) {
      expect(result.status).toBe(403);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// postTelegramDisconnect
// ─────────────────────────────────────────────────────────────────────────────

describe("postTelegramDisconnect", () => {
  it("returns {ok:true} on 200", async () => {
    mockedPost.mockResolvedValueOnce({ data: { ok: true } });
    const result = await postTelegramDisconnect({ identityKey: "alexander" });
    expect(result).toEqual({ ok: true });
    expect(mockedPost).toHaveBeenCalledWith("/telegram/disconnect", {
      identityKey: "alexander",
    });
  });

  it("returns {ok:false, error, status} on 404 (no row)", async () => {
    const err: any = new Error("not found");
    err.response = { status: 404, data: { error: "no such row" } };
    mockedPost.mockRejectedValueOnce(err);
    const result = await postTelegramDisconnect({ identityKey: "ghost" });
    expect(result.ok).toBe(false);
    if ("status" in result) {
      expect(result.status).toBe(404);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getTelegramStatus
// ─────────────────────────────────────────────────────────────────────────────

describe("getTelegramStatus", () => {
  it("returns {status:'unconfigured'} when the row doesn't exist", async () => {
    mockedGet.mockResolvedValueOnce({ data: { status: "unconfigured" } });
    const result = await getTelegramStatus("alexander");
    expect(result).toEqual({ status: "unconfigured" });
    expect(mockedGet).toHaveBeenCalledWith("/telegram/alexander");
  });

  it("returns {status:'connected', botUsername, telegramChatId} when the row exists", async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        status: "connected",
        botUsername: "foo_bot",
        telegramChatId: "123456",
      },
    });
    const result = await getTelegramStatus("alexander");
    expect(result).toEqual({
      status: "connected",
      botUsername: "foo_bot",
      telegramChatId: "123456",
    });
  });

  it("returns {status:'error', error} when the network fails", async () => {
    mockedGet.mockRejectedValueOnce(new Error("Server crashed"));
    const result = await getTelegramStatus("alexander");
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toContain("Server crashed");
    }
  });

  it("URL-encodes the identityKey path segment", async () => {
    mockedGet.mockResolvedValueOnce({ data: { status: "unconfigured" } });
    await getTelegramStatus("weird/key with space");
    expect(mockedGet).toHaveBeenCalledWith(
      "/telegram/weird%2Fkey%20with%20space",
    );
  });
});
