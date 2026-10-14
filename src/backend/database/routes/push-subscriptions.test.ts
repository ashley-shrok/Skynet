/**
 * push-subscriptions — the notifications access gate and the Telegram
 * handlers (status, link, test, title-only, disconnect). Telegram modules are
 * mocked; handlers are called directly.
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

let configured = true;
let botUsername: string | null = "skynet_test_bot";
vi.mock("../../notifications/telegram-api.js", () => ({
  isTelegramConfigured: () => configured,
  getBotUsername: async () => botUsername,
}));

let link: { telegramName: string; titleOnly: boolean } | null = null;
const setTitleOnly = vi.fn();
const deleteLink = vi.fn();
vi.mock("../../notifications/telegram-links.js", () => ({
  createLinkCode: () => "code123",
  getLink: () => link,
  setTitleOnly: (...a: unknown[]) => setTitleOnly(...a),
  deleteLink: (...a: unknown[]) => deleteLink(...a),
}));

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

beforeEach(() => {
  accessRows.clear();
  configured = true;
  botUsername = "skynet_test_bot";
  link = null;
  setTitleOnly.mockReset();
  deleteLink.mockReset();
  sendTelegramToUser.mockReset();
});

describe("GET /telegram", () => {
  it("reports available + not linked", async () => {
    const res = makeRes();
    await handleGetTelegram("u1", asRes(res));
    expect(res._body).toEqual({ available: true, botUsername: "skynet_test_bot", linked: false });
  });

  it("reports the link when present", async () => {
    link = { telegramName: "@ash", titleOnly: true };
    const res = makeRes();
    await handleGetTelegram("u1", asRes(res));
    expect(res._body).toMatchObject({ linked: true, telegramName: "@ash", titleOnly: true });
  });

  it("reports unavailable when no bot is configured", async () => {
    configured = false;
    const res = makeRes();
    await handleGetTelegram("u1", asRes(res));
    expect(res._body).toEqual({ available: false, linked: false });
  });
});

describe("POST /telegram/link", () => {
  it("returns a t.me deep link with the one-time code", async () => {
    const res = makeRes();
    await handlePostTelegramLink("u1", asRes(res));
    expect(res._body).toEqual({ url: "https://t.me/skynet_test_bot?start=code123" });
  });

  it("503s when the bot is unreachable", async () => {
    botUsername = null;
    const res = makeRes();
    await handlePostTelegramLink("u1", asRes(res));
    expect(res._status).toBe(503);
  });
});

describe("POST /telegram/test", () => {
  it("returns ok on delivery", async () => {
    sendTelegramToUser.mockResolvedValue({ ok: true, messageId: 1, attempts: 1 });
    const res = makeRes();
    await handlePostTelegramTest("u1", asRes(res));
    expect(res._body).toEqual({ ok: true });
  });

  it("explains a blocked bot", async () => {
    sendTelegramToUser.mockResolvedValue({ ok: false, reason: "send_failed", errorCode: 403, description: "Forbidden" });
    const res = makeRes();
    await handlePostTelegramTest("u1", asRes(res));
    expect(res._body).toMatchObject({ ok: false, error: expect.stringMatching(/blocked the bot/) });
  });
});

describe("PATCH /telegram", () => {
  it("rejects a non-boolean titleOnly", async () => {
    const res = makeRes();
    await handlePatchTelegram("u1", { titleOnly: "yes" }, asRes(res));
    expect(res._status).toBe(400);
  });

  it("404s when not linked", async () => {
    setTitleOnly.mockResolvedValue(false);
    const res = makeRes();
    await handlePatchTelegram("u1", { titleOnly: true }, asRes(res));
    expect(res._status).toBe(404);
  });

  it("updates title-only and returns status", async () => {
    setTitleOnly.mockResolvedValue(true);
    link = { telegramName: "@ash", titleOnly: true };
    const res = makeRes();
    await handlePatchTelegram("u1", { titleOnly: true }, asRes(res));
    expect(setTitleOnly).toHaveBeenCalledWith("u1", true);
    expect(res._body).toMatchObject({ linked: true, titleOnly: true });
  });
});

describe("DELETE /telegram", () => {
  it("unlinks and returns status", async () => {
    const res = makeRes();
    await handleDeleteTelegram("u1", asRes(res));
    expect(deleteLink).toHaveBeenCalledWith("u1");
    expect(res._body).toMatchObject({ linked: false });
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
    expect(routes.length).toBe(5);
    for (const layer of routes) {
      expect(layer.route!.stack.map((l) => l.handle)).toContain(requireNotificationsAccess);
    }
  });
});
