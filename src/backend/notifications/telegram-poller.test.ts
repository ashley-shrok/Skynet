/**
 * telegram-poller — /start <code> linking, /stop, ignored chats, and update
 * offset handling. callTelegram and the link store are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const callTelegram = vi.fn();
vi.mock("./telegram-api.js", () => ({
  callTelegram: (...args: unknown[]) => callTelegram(...args),
  isTelegramConfigured: () => true,
}));

const consumeLinkCode = vi.fn();
const saveLink = vi.fn();
const deleteLink = vi.fn();
const getUserIdsForChat = vi.fn();
vi.mock("./telegram-links.js", () => ({
  consumeLinkCode: (...a: unknown[]) => consumeLinkCode(...a),
  saveLink: (...a: unknown[]) => saveLink(...a),
  deleteLink: (...a: unknown[]) => deleteLink(...a),
  getUserIdsForChat: (...a: unknown[]) => getUserIdsForChat(...a),
}));

vi.mock("../utils/logger.js", () => ({
  systemLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { _resetPollerForTests, displayNameOf, handleUpdate, pollOnce } from "./telegram-poller.js";

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
    .filter(([method]) => method === "sendMessage")
    .map(([, params]) => (params as { text: string }).text);
}

beforeEach(() => {
  _resetPollerForTests();
  callTelegram.mockReset();
  callTelegram.mockResolvedValue({ ok: true, result: {} });
  consumeLinkCode.mockReset();
  saveLink.mockReset();
  deleteLink.mockReset();
  getUserIdsForChat.mockReset();
});

describe("handleUpdate", () => {
  it("links the chat on /start with a valid code", async () => {
    consumeLinkCode.mockReturnValue("u1");
    await handleUpdate(update("/start abc123"));
    expect(consumeLinkCode).toHaveBeenCalledWith("abc123");
    expect(saveLink).toHaveBeenCalledWith("u1", "555", "@ash");
    expect(repliesSent()[0]).toMatch(/^Connected/);
  });

  it("refuses an expired code without linking", async () => {
    consumeLinkCode.mockReturnValue(null);
    await handleUpdate(update("/start stale"));
    expect(saveLink).not.toHaveBeenCalled();
    expect(repliesSent()[0]).toMatch(/expired/);
  });

  it("explains how to connect on a bare /start", async () => {
    await handleUpdate(update("/start"));
    expect(consumeLinkCode).not.toHaveBeenCalled();
    expect(repliesSent()[0]).toMatch(/Connect Telegram/);
  });

  it("/stop unlinks every user on the chat", async () => {
    getUserIdsForChat.mockReturnValue(["u1", "u2"]);
    await handleUpdate(update("/stop"));
    expect(deleteLink).toHaveBeenCalledWith("u1");
    expect(deleteLink).toHaveBeenCalledWith("u2");
    expect(repliesSent()[0]).toMatch(/^Disconnected/);
  });

  it("ignores group chats", async () => {
    consumeLinkCode.mockReturnValue("u1");
    await handleUpdate(update("/start abc", { chatType: "group" }));
    expect(consumeLinkCode).not.toHaveBeenCalled();
    expect(callTelegram).not.toHaveBeenCalled();
  });

  it("answers other text with a pointer back to Skynet", async () => {
    await handleUpdate(update("hello"));
    expect(repliesSent()[0]).toMatch(/reply to agents in Skynet/);
  });
});

describe("pollOnce", () => {
  it("advances the offset past processed updates", async () => {
    callTelegram.mockImplementation(async (method: string) =>
      method === "getUpdates"
        ? { ok: true, result: [update("hi", { id: 10 }), update("hi", { id: 11 })] }
        : { ok: true, result: {} },
    );
    expect(await pollOnce()).toBe(true);
    callTelegram.mockResolvedValue({ ok: true, result: [] });
    await pollOnce();
    const getUpdatesCalls = callTelegram.mock.calls.filter(([m]) => m === "getUpdates");
    expect(getUpdatesCalls[0][1]).toMatchObject({ offset: 0 });
    expect(getUpdatesCalls[1][1]).toMatchObject({ offset: 12 });
  });

  it("reports failure so the loop backs off", async () => {
    callTelegram.mockResolvedValue({ ok: false, errorCode: 409, description: "Conflict" });
    expect(await pollOnce()).toBe(false);
  });
});

describe("displayNameOf", () => {
  it("prefers @username, falls back to first + last name", () => {
    expect(displayNameOf({ username: "ash", first_name: "Ash" })).toBe("@ash");
    expect(displayNameOf({ first_name: "Ash", last_name: "B" })).toBe("Ash B");
    expect(displayNameOf(undefined)).toBe("");
  });
});
