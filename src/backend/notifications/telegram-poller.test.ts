/**
 * telegram-poller — per-user /start <code> linking, /stop, ignored chats,
 * and update offset handling. callTelegram and the bot store are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const callTelegram = vi.fn();
vi.mock("./telegram-api.js", () => ({
  callTelegram: (...args: unknown[]) => callTelegram(...args),
}));

const consumeLinkCode = vi.fn();
const linkChat = vi.fn();
const unlinkChat = vi.fn();
let bot: { chatId: string | null } | null = null;
vi.mock("./telegram-bots.js", () => ({
  consumeLinkCode: (...a: unknown[]) => consumeLinkCode(...a),
  linkChat: (...a: unknown[]) => linkChat(...a),
  unlinkChat: (...a: unknown[]) => unlinkChat(...a),
  getBot: () => bot,
  loadAllBots: async () => [],
}));

vi.mock("../utils/logger.js", () => ({
  systemLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { _resetPollersForTests, displayNameOf, handleUpdate, pollOnce } from "./telegram-poller.js";

const TOKEN = "111:AAAA";

function update(text: string, opts: { id?: number; chatType?: string } = {}) {
  return {
    update_id: opts.id ?? 1,
    message: {
      text,
      chat: { id: 555, type: opts.chatType ?? "private" },
      from: { first_name: "Ash", username: "ash" },
    },
  };
}

function repliesSent(): string[] {
  return callTelegram.mock.calls
    .filter(([, method]) => method === "sendMessage")
    .map(([, , params]) => (params as { text: string }).text);
}

beforeEach(() => {
  _resetPollersForTests();
  callTelegram.mockReset();
  callTelegram.mockResolvedValue({ ok: true, result: {} });
  consumeLinkCode.mockReset();
  linkChat.mockReset();
  unlinkChat.mockReset();
  bot = { chatId: null };
});

describe("handleUpdate", () => {
  it("links the chat on /start with this user's code, replying through their bot", async () => {
    consumeLinkCode.mockReturnValue(true);
    await handleUpdate("u1", TOKEN, update("/start abc123"));
    expect(consumeLinkCode).toHaveBeenCalledWith("abc123", "u1");
    expect(linkChat).toHaveBeenCalledWith("u1", "555", "@ash");
    expect(callTelegram.mock.calls[0][0]).toBe(TOKEN);
    expect(repliesSent()[0]).toMatch(/^Connected/);
  });

  it("refuses an expired or foreign code without linking", async () => {
    consumeLinkCode.mockReturnValue(false);
    await handleUpdate("u1", TOKEN, update("/start stale"));
    expect(linkChat).not.toHaveBeenCalled();
    expect(repliesSent()[0]).toMatch(/expired/);
  });

  it("explains how to connect on a bare /start", async () => {
    await handleUpdate("u1", TOKEN, update("/start"));
    expect(consumeLinkCode).not.toHaveBeenCalled();
    expect(repliesSent()[0]).toMatch(/Open my bot/);
  });

  it("/stop unlinks when this is the linked chat", async () => {
    bot = { chatId: "555" };
    await handleUpdate("u1", TOKEN, update("/stop"));
    expect(unlinkChat).toHaveBeenCalledWith("u1");
    expect(repliesSent()[0]).toMatch(/^Disconnected/);
  });

  it("/stop from some other chat changes nothing", async () => {
    bot = { chatId: "999" };
    await handleUpdate("u1", TOKEN, update("/stop"));
    expect(unlinkChat).not.toHaveBeenCalled();
    expect(repliesSent()[0]).toMatch(/isn't connected/);
  });

  it("blocking the bot unlinks the linked chat", async () => {
    bot = { chatId: "555" };
    await handleUpdate("u1", TOKEN, {
      update_id: 2,
      my_chat_member: { chat: { id: 555, type: "private" }, new_chat_member: { status: "kicked" } },
    });
    expect(unlinkChat).toHaveBeenCalledWith("u1");
    expect(callTelegram).not.toHaveBeenCalled();
  });

  it("ignores group chats", async () => {
    await handleUpdate("u1", TOKEN, update("/start abc", { chatType: "group" }));
    expect(consumeLinkCode).not.toHaveBeenCalled();
    expect(callTelegram).not.toHaveBeenCalled();
  });

  it("answers other text with a pointer back to Skynet", async () => {
    await handleUpdate("u1", TOKEN, update("hello"));
    expect(repliesSent()[0]).toMatch(/reply to agents in Skynet/);
  });
});

describe("pollOnce", () => {
  it("advances the offset past processed updates", async () => {
    callTelegram.mockImplementation(async (_t: string, method: string) =>
      method === "getUpdates"
        ? { ok: true, result: [update("hi", { id: 10 }), update("hi", { id: 11 })] }
        : { ok: true, result: {} },
    );
    const state = { generation: 1, offset: 0 };
    expect(await pollOnce("u1", TOKEN, state)).toBe(true);
    expect(state.offset).toBe(12);
    expect(callTelegram.mock.calls[0]).toEqual(
      expect.arrayContaining([TOKEN, "getUpdates", expect.objectContaining({ offset: 0 })]),
    );
  });

  it("stops handling updates once the loop is no longer live", async () => {
    consumeLinkCode.mockReturnValue(true);
    callTelegram.mockImplementation(async (_t: string, method: string) =>
      method === "getUpdates" ? { ok: true, result: [update("/start abc", { id: 10 })] } : { ok: true, result: {} },
    );
    await pollOnce("u1", TOKEN, { generation: 1, offset: 0 }, () => false);
    expect(linkChat).not.toHaveBeenCalled();
  });

  it("reports failure so the loop backs off", async () => {
    callTelegram.mockResolvedValue({ ok: false, errorCode: 409, description: "Conflict" });
    expect(await pollOnce("u1", TOKEN, { generation: 1, offset: 0 })).toBe(false);
  });
});

describe("displayNameOf", () => {
  it("prefers @username, falls back to first + last name", () => {
    expect(displayNameOf({ username: "ash", first_name: "Ash" })).toBe("@ash");
    expect(displayNameOf({ first_name: "Ash", last_name: "B" })).toBe("Ash B");
    expect(displayNameOf(undefined)).toBe("");
  });
});
