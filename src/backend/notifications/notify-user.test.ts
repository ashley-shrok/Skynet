/**
 * notify-user — dispatches to Telegram without waiting on it, and a
 * Telegram send that throws is logged rather than propagated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendTelegramToUser = vi.fn();
const warn = vi.fn();
vi.mock("./telegram-sender.js", () => ({ sendTelegramToUser: (...a: unknown[]) => sendTelegramToUser(...a) }));
vi.mock("../utils/logger.js", () => ({ databaseLogger: { warn: (...a: unknown[]) => warn(...a) } }));

import { _resetNotifyQueuesForTests, sendNotificationToUser } from "./notify-user.js";

const payload = { title: "Mitzi:", body: "hi", agentMxid: "@mitzi:hs", agentHostId: 1 };

beforeEach(() => {
  _resetNotifyQueuesForTests();
  sendTelegramToUser.mockReset();
  warn.mockReset();
});

describe("sendNotificationToUser", () => {
  it("sends to Telegram", async () => {
    sendTelegramToUser.mockResolvedValue({ ok: true });
    await sendNotificationToUser("u1", payload);
    await vi.waitFor(() => expect(sendTelegramToUser).toHaveBeenCalledWith("u1", payload));
  });

  it("does not wait for a slow Telegram send", async () => {
    sendTelegramToUser.mockReturnValue(new Promise(() => {}));
    await expect(sendNotificationToUser("u1", payload)).resolves.toBeUndefined();
  });

  it("sends to one user in order, each waiting for the previous", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    sendTelegramToUser.mockImplementation(async (_u: string, p: { body: string }) => {
      if (p.body === "first") await new Promise<void>((r) => (releaseFirst = r));
      order.push(p.body);
      return { ok: true };
    });
    await sendNotificationToUser("u1", { ...payload, body: "first" });
    await sendNotificationToUser("u1", { ...payload, body: "second" });
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([]);
    releaseFirst();
    await vi.waitFor(() => expect(order).toEqual(["first", "second"]));
  });

  it("a slow send for one user doesn't hold up another user", async () => {
    sendTelegramToUser.mockImplementation(async (u: string) =>
      u === "slow" ? new Promise(() => {}) : { ok: true },
    );
    await sendNotificationToUser("slow", payload);
    await sendNotificationToUser("u2", payload);
    await vi.waitFor(() => expect(sendTelegramToUser).toHaveBeenCalledWith("u2", payload));
  });

  it("logs (and swallows) a Telegram send that throws", async () => {
    sendTelegramToUser.mockRejectedValue(new Error("boom"));
    await sendNotificationToUser("u1", payload);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("contract breach"),
      expect.objectContaining({ operation: "telegram_send_threw", error: "boom" }),
    );
  });
});
