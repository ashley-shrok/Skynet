/**
 * notify-user — fans out to ntfy and Telegram, and a slow/failing Telegram
 * send never blocks or breaks the ntfy path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendPushToUser = vi.fn();
const sendTelegramToUser = vi.fn();
const warn = vi.fn();
vi.mock("./ntfy-sender.js", () => ({ sendPushToUser: (...a: unknown[]) => sendPushToUser(...a) }));
vi.mock("./telegram-sender.js", () => ({ sendTelegramToUser: (...a: unknown[]) => sendTelegramToUser(...a) }));
vi.mock("../utils/logger.js", () => ({ databaseLogger: { warn: (...a: unknown[]) => warn(...a) } }));

import { sendNotificationToUser } from "./notify-user.js";

const payload = { title: "Mitzi:", body: "hi", agentMxid: "@mitzi:hs", agentHostId: 1 };

beforeEach(() => {
  sendPushToUser.mockReset().mockResolvedValue(undefined);
  sendTelegramToUser.mockReset();
  warn.mockReset();
});

describe("sendNotificationToUser", () => {
  it("sends to both channels", async () => {
    sendTelegramToUser.mockResolvedValue({ ok: true });
    await sendNotificationToUser("u1", payload);
    expect(sendPushToUser).toHaveBeenCalledWith("u1", payload);
    expect(sendTelegramToUser).toHaveBeenCalledWith("u1", payload);
  });

  it("does not wait for a slow Telegram send", async () => {
    sendTelegramToUser.mockReturnValue(new Promise(() => {}));
    await sendNotificationToUser("u1", payload);
    expect(sendPushToUser).toHaveBeenCalled();
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
