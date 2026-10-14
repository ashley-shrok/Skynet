/**
 * telegram-sender — message formatting, the Open-in-Skynet button, the
 * access/link gates, and retry behaviour. callTelegram is mocked; retries
 * use an injected no-wait sleep.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const callTelegram = vi.fn();
let configured = true;
let publicUrl = "https://skynet.example.com";
vi.mock("./telegram-api.js", () => ({
  callTelegram: (...args: unknown[]) => callTelegram(...args),
  isTelegramConfigured: () => configured,
  getSkynetPublicUrl: () => publicUrl,
}));

let link: { chatId: string; titleOnly: boolean } | null = null;
vi.mock("./telegram-links.js", () => ({
  getLink: () => link,
}));

let canUse = true;
vi.mock("./notifications-access.js", () => ({
  userCanUseNotifications: () => canUse,
}));

const warn = vi.fn();
const info = vi.fn();
vi.mock("../utils/logger.js", () => ({
  databaseLogger: { warn: (...a: unknown[]) => warn(...a), info: (...a: unknown[]) => info(...a) },
}));

// ntfy-sender pulls in config/db modules; only buildClickUrl is needed here.
vi.mock("./ntfy-sender.js", () => ({
  buildClickUrl: (mxid: string, hostId: number | null) =>
    `/?openHarness=${encodeURIComponent(mxid)}${hostId === null ? "" : `&host=${hostId}`}`,
}));

import {
  _setSleepForTests,
  buildOpenUrl,
  buildTelegramText,
  sendTelegramToUser,
} from "./telegram-sender.js";

const sleeps: number[] = [];
_setSleepForTests(async (ms) => {
  sleeps.push(ms);
});

const payload = { title: "Mitzi:", body: "a < b & c", agentMxid: "@mitzi:hs", agentHostId: 3 };

beforeEach(() => {
  callTelegram.mockReset();
  warn.mockClear();
  info.mockClear();
  sleeps.length = 0;
  configured = true;
  publicUrl = "https://skynet.example.com";
  link = { chatId: "555", titleOnly: false };
  canUse = true;
});

describe("formatting", () => {
  it("escapes HTML and bolds the title", () => {
    expect(buildTelegramText(payload, false)).toBe("<b>Mitzi:</b>\na &lt; b &amp; c");
  });

  it("title-only drops the body and the trailing colon", () => {
    expect(buildTelegramText(payload, true)).toBe("<b>Mitzi</b>\nNew message");
  });

  it("builds an absolute Open URL, or none without an https public URL", () => {
    expect(buildOpenUrl(payload)).toBe("https://skynet.example.com/?openHarness=%40mitzi%3Ahs&host=3");
    publicUrl = "";
    expect(buildOpenUrl(payload)).toBeNull();
  });
});

describe("sendTelegramToUser", () => {
  it("sends to the linked chat with an Open in Skynet button and logs success", async () => {
    callTelegram.mockResolvedValueOnce({ ok: true, result: { message_id: 42 } });
    const res = await sendTelegramToUser("u1", payload);
    expect(res).toEqual({ ok: true, messageId: 42, attempts: 1 });
    const [method, params] = callTelegram.mock.calls[0];
    expect(method).toBe("sendMessage");
    expect(params).toMatchObject({ chat_id: "555", parse_mode: "HTML" });
    expect(params.reply_markup.inline_keyboard[0][0]).toEqual({
      text: "Open in Skynet",
      url: "https://skynet.example.com/?openHarness=%40mitzi%3Ahs&host=3",
    });
    expect(info).toHaveBeenCalledWith(
      "[telegram] notification sent",
      expect.objectContaining({ operation: "telegram_send_ok", messageId: 42 }),
    );
  });

  it("omits the button when there is no public URL", async () => {
    publicUrl = "";
    callTelegram.mockResolvedValueOnce({ ok: true, result: { message_id: 1 } });
    await sendTelegramToUser("u1", payload);
    expect(callTelegram.mock.calls[0][1].reply_markup).toBeUndefined();
  });

  it("does nothing when unconfigured, without access, or not linked", async () => {
    configured = false;
    expect(await sendTelegramToUser("u1", payload)).toEqual({ ok: false, reason: "not_configured" });
    configured = true;
    canUse = false;
    expect(await sendTelegramToUser("u1", payload)).toEqual({ ok: false, reason: "no_access" });
    canUse = true;
    link = null;
    expect(await sendTelegramToUser("u1", payload)).toEqual({ ok: false, reason: "not_linked" });
    expect(callTelegram).not.toHaveBeenCalled();
  });

  it("retries network errors and 5xx, then succeeds", async () => {
    callTelegram
      .mockResolvedValueOnce({ ok: false, errorCode: 0, description: "timeout" })
      .mockResolvedValueOnce({ ok: false, errorCode: 502, description: "Bad Gateway" })
      .mockResolvedValueOnce({ ok: true, result: { message_id: 7 } });
    const res = await sendTelegramToUser("u1", payload);
    expect(res).toEqual({ ok: true, messageId: 7, attempts: 3 });
    expect(sleeps).toEqual([1000, 3000]);
  });

  it("honours retry_after on 429", async () => {
    callTelegram
      .mockResolvedValueOnce({ ok: false, errorCode: 429, description: "Too Many Requests", retryAfter: 4 })
      .mockResolvedValueOnce({ ok: true, result: { message_id: 8 } });
    await sendTelegramToUser("u1", payload);
    expect(sleeps).toEqual([4000]);
  });

  it("does not retry a 403 and logs the failure", async () => {
    callTelegram.mockResolvedValueOnce({ ok: false, errorCode: 403, description: "Forbidden: bot was blocked by the user" });
    const res = await sendTelegramToUser("u1", payload);
    expect(res).toMatchObject({ ok: false, reason: "send_failed", errorCode: 403 });
    expect(callTelegram).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[telegram] notification NOT delivered",
      expect.objectContaining({ operation: "telegram_send_failed", errorCode: 403 }),
    );
  });

  it("gives up after three failed attempts", async () => {
    callTelegram.mockResolvedValue({ ok: false, errorCode: 500, description: "Internal" });
    const res = await sendTelegramToUser("u1", payload);
    expect(res).toMatchObject({ ok: false, reason: "send_failed", errorCode: 500 });
    expect(callTelegram).toHaveBeenCalledTimes(3);
  });
});
