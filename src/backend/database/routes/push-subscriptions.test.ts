/**
 * push-subscriptions — the notifications access gate and the per-user
 * Telegram handlers (status, save bot, link, test, title-only, remove).
 * Telegram modules are mocked; handlers are called directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  systemLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
const accessRows = new Map<string, boolean>();
vi.mock("../../notifications/notifications-access.js", () => ({
  userCanUseNotifications: (userId: string) => accessRows.get(userId) ?? false,
}));
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: { getInstance: () => ({ createAuthMiddleware: () => vi.fn() }) },
}));

const callTelegram = vi.fn();
vi.mock("../../notifications/telegram-api.js", () => ({
  callTelegram: (...a: unknown[]) => callTelegram(...a),
}));

type Bot = { botUsername: string; chatId: string | null; telegramName: string; titleOnly: boolean };
let bot: Bot | null = null;
const saveBot = vi.fn();
const setTitleOnly = vi.fn();
const deleteBot = vi.fn();
let otherUser: string | null = null;
vi.mock("../../notifications/telegram-bots.js", () => ({
  createLinkCode: () => "code123",
  getBot: () => bot,
  findOtherUserWithBot: () => otherUser,
  saveBot: (...a: unknown[]) => saveBot(...a),
  setTitleOnly: (...a: unknown[]) => setTitleOnly(...a),
  deleteBot: (...a: unknown[]) => deleteBot(...a),
}));

const restartBotPoller = vi.fn();
const stopBotPoller = vi.fn();
vi.mock("../../notifications/telegram-poller.js", () => ({
  restartBotPoller: (...a: unknown[]) => restartBotPoller(...a),
  stopBotPoller: (...a: unknown[]) => stopBotPoller(...a),
}));

vi.mock("../../notifications/app-name.js", () => ({ getAppName: async () => "Acme" }));

const sendTelegramToUser = vi.fn();
vi.mock("../../notifications/telegram-sender.js", () => ({
  sendTelegramToUser: (...a: unknown[]) => sendTelegramToUser(...a),
}));

import router, {
  handleDeleteTelegram,
  handleGetTelegram,
  handlePatchTelegram,
  handlePostTelegramLink,
  handlePostTelegramTest,
  handlePutTelegramBot,
  requireNotificationsAccess,
} from "./push-subscriptions.js";

type MockRes = { _status: number; _body: unknown; status(c: number): MockRes; json(b: unknown): MockRes };
function makeRes(): MockRes {
  return {
    _status: 200,
    _body: undefined,
    status(c) {
      this._status = c;
      return this;
    },
    json(b) {
      this._body = b;
      return this;
    },
  };
}
const asRes = (r: MockRes) => r as unknown as Response;

const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
const LINKED: Bot = { botUsername: "ash_bot", chatId: "555", telegramName: "@ash", titleOnly: false };

beforeEach(() => {
  accessRows.clear();
  bot = null;
  otherUser = null;
  callTelegram.mockReset();
  saveBot.mockReset().mockImplementation(async () => {
    bot = { botUsername: "ash_bot", chatId: null, telegramName: "", titleOnly: false };
  });
  setTitleOnly.mockReset();
  deleteBot.mockReset().mockImplementation(async () => {
    bot = null;
  });
  restartBotPoller.mockReset();
  stopBotPoller.mockReset();
  sendTelegramToUser.mockReset();
});

describe("GET /telegram", () => {
  it("reports not set up", async () => {
    const res = makeRes();
    await handleGetTelegram("u1", asRes(res));
    expect(res._body).toEqual({ setUp: false, linked: false });
  });

  it("reports a bot waiting for Start", async () => {
    bot = { ...LINKED, chatId: null };
    const res = makeRes();
    await handleGetTelegram("u1", asRes(res));
    expect(res._body).toEqual({ setUp: true, botUsername: "ash_bot", linked: false, titleOnly: false });
  });

  it("reports a linked chat", async () => {
    bot = LINKED;
    const res = makeRes();
    await handleGetTelegram("u1", asRes(res));
    expect(res._body).toMatchObject({ setUp: true, linked: true, telegramName: "@ash" });
  });
});

describe("PUT /telegram/bot", () => {
  it("rejects something that isn't a token without calling Telegram", async () => {
    const res = makeRes();
    await handlePutTelegramBot("u1", { token: "hello" }, asRes(res));
    expect(res._status).toBe(400);
    expect(callTelegram).not.toHaveBeenCalled();
  });

  it("rejects a token Telegram doesn't accept", async () => {
    callTelegram.mockResolvedValue({ ok: false, errorCode: 401, description: "Unauthorized" });
    const res = makeRes();
    await handlePutTelegramBot("u1", { token: TOKEN }, asRes(res));
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toMatch(/didn't accept/);
    expect(saveBot).not.toHaveBeenCalled();
  });

  it("refuses a bot another account already uses", async () => {
    callTelegram.mockResolvedValue({ ok: true, result: { id: 123456789, is_bot: true, username: "ash_bot" } });
    otherUser = "u2";
    const res = makeRes();
    await handlePutTelegramBot("u1", { token: TOKEN }, asRes(res));
    expect(res._status).toBe(409);
    expect(res._body).toMatchObject({ error: expect.stringMatching(/another Acme account/) });
    expect(saveBot).not.toHaveBeenCalled();
  });

  it("turns a same-moment duplicate save into the friendly 409", async () => {
    callTelegram.mockResolvedValue({ ok: true, result: { id: 123456789, is_bot: true, username: "ash_bot" } });
    saveBot.mockRejectedValue(new Error("UNIQUE constraint failed: telegram_bots.bot_id"));
    const res = makeRes();
    await handlePutTelegramBot("u1", { token: TOKEN }, asRes(res));
    expect(res._status).toBe(409);
    expect(restartBotPoller).not.toHaveBeenCalled();
  });

  it("validates, clears any webhook, saves, and starts the poller", async () => {
    callTelegram.mockImplementation(async (_t: string, method: string) =>
      method === "getMe"
        ? { ok: true, result: { id: 123456789, is_bot: true, username: "ash_bot" } }
        : { ok: true, result: true },
    );
    const res = makeRes();
    await handlePutTelegramBot("u1", { token: `  ${TOKEN}  ` }, asRes(res));
    expect(callTelegram).toHaveBeenCalledWith(TOKEN, "getMe", {});
    expect(callTelegram).toHaveBeenCalledWith(TOKEN, "deleteWebhook", { drop_pending_updates: false });
    expect(saveBot).toHaveBeenCalledWith("u1", TOKEN, "123456789", "ash_bot");
    expect(restartBotPoller).toHaveBeenCalledWith("u1");
    expect(res._body).toMatchObject({ setUp: true, botUsername: "ash_bot", linked: false });
  });
});

describe("POST /telegram/link", () => {
  it("returns a Start link for the user's own bot", async () => {
    bot = { ...LINKED, chatId: null };
    const res = makeRes();
    await handlePostTelegramLink("u1", asRes(res));
    expect(res._body).toEqual({ url: "https://t.me/ash_bot?start=code123" });
  });

  it("409s before a bot is set up", async () => {
    const res = makeRes();
    await handlePostTelegramLink("u1", asRes(res));
    expect(res._status).toBe(409);
  });
});

describe("POST /telegram/test", () => {
  it("returns ok on delivery", async () => {
    sendTelegramToUser.mockResolvedValue({ ok: true, messageId: 1, attempts: 1 });
    const res = makeRes();
    await handlePostTelegramTest("u1", asRes(res));
    expect(res._body).toEqual({ ok: true });
    expect(sendTelegramToUser).toHaveBeenCalledWith("u1", expect.objectContaining({ title: "Acme test notification" }));
  });

  it("explains a revoked token", async () => {
    sendTelegramToUser.mockResolvedValue({ ok: false, reason: "send_failed", errorCode: 401, description: "Unauthorized" });
    const res = makeRes();
    await handlePostTelegramTest("u1", asRes(res));
    expect(res._body).toMatchObject({ ok: false, error: expect.stringMatching(/token no longer works/) });
  });
});

describe("PATCH /telegram", () => {
  it("rejects a non-boolean titleOnly", async () => {
    const res = makeRes();
    await handlePatchTelegram("u1", { titleOnly: "yes" }, asRes(res));
    expect(res._status).toBe(400);
  });

  it("404s without a bot", async () => {
    setTitleOnly.mockResolvedValue(false);
    const res = makeRes();
    await handlePatchTelegram("u1", { titleOnly: true }, asRes(res));
    expect(res._status).toBe(404);
  });
});

describe("DELETE /telegram", () => {
  it("stops the poller, removes the setup, returns not set up", async () => {
    bot = LINKED;
    const res = makeRes();
    await handleDeleteTelegram("u1", asRes(res));
    expect(stopBotPoller).toHaveBeenCalledWith("u1");
    expect(deleteBot).toHaveBeenCalledWith("u1");
    expect(res._body).toEqual({ setUp: false, linked: false });
  });
});

describe("requireNotificationsAccess", () => {
  function runGate(userId: string) {
    const res = makeRes();
    const next = vi.fn();
    requireNotificationsAccess({ userId } as unknown as Request, asRes(res), next);
    return { res, next };
  }

  it("403s a user without access", () => {
    const { res, next } = runGate("u-plain");
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  it("passes a user with access", () => {
    accessRows.set("u-flag", true);
    expect(runGate("u-flag").next).toHaveBeenCalledTimes(1);
  });

  it("is wired onto every route", () => {
    const stack = (router as unknown as {
      stack: Array<{ route?: { stack: Array<{ handle: unknown }> } }>;
    }).stack;
    const routes = stack.filter((layer) => layer.route);
    expect(routes.length).toBe(6);
    for (const layer of routes) {
      expect(layer.route!.stack.map((l) => l.handle)).toContain(requireNotificationsAccess);
    }
  });
});
