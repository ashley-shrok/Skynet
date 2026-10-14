/**
 * notify-user — dispatches to Telegram without waiting on it, and a
 * Telegram send that throws is logged rather than propagated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendTelegramToUser = vi.fn();
const warn = vi.fn();
vi.mock("./telegram-sender.js", () => ({ sendTelegramToUser: (...a: unknown[]) => sendTelegramToUser(...a) }));
vi.mock("../utils/logger.js", () => ({ databaseLogger: { warn: (...a: unknown[]) => warn(...a) } }));

import { sendNotificationToUser } from "./notify-user.js";

const payload = { title: "Mitzi:", body: "hi", agentMxid: "@mitzi:hs", agentHostId: 1 };

beforeEach(() => {
  sendTelegramToUser.mockReset();
  warn.mockReset();
});

describe("sendNotificationToUser", () => {
  it("sends to Telegram", async () => {
    sendTelegramToUser.mockResolvedValue({ ok: true });
    await sendNotificationToUser("u1", payload);
    expect(sendTelegramToUser).toHaveBeenCalledWith("u1", payload);
  });

  it("does not wait for a slow Telegram send", async () => {
    sendTelegramToUser.mockReturnValue(new Promise(() => {}));
    await expect(sendNotificationToUser("u1", payload)).resolves.toBeUndefined();
  });

  it("logs (and swallows) a Telegram send that throws", async () => {
    sendTelegramToUser.mockRejectedValue(new Error("boom"));
    await sendNotificationToUser("u1", payload);
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("contract breach"),
      expect.objectContaining({ operation: "telegram_send_threw", error: "boom" }),
    );
  });
});
