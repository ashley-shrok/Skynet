/**
 * Phase 79 Plan 03 Task 1 — Telegram getMe proxy tests.
 *
 * Mirrors the shape from matrix-admin-client.test.ts (if any) but simpler —
 * we stub global.fetch via vi.stubGlobal and assert the return shape for:
 *   1. valid token → {ok:true, botUsername, botId, firstName}
 *   2. invalid token (Telegram returns ok:false + description) → {ok:false, error:description}
 *   3. timeout / AbortError → {ok:false, error:"Telegram unreachable"}
 *   4. network error (fetch rejects with non-Abort) → {ok:false, error:"Telegram proxy error"}
 *   5. bot has no username set → {ok:false, error:"Bot has no username set (create one via @BotFather)"}
 *   6. token value is NEVER logged (grep-style assertion on the logger mock's calls)
 *
 * We mock the logger to observe log-call payloads and prove no token leaks.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const loggerErrorMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    info: loggerInfoMock,
    error: loggerErrorMock,
    warn: loggerWarnMock,
    debug: vi.fn(),
  },
  authLogger: {
    info: loggerInfoMock,
    error: loggerErrorMock,
    warn: loggerWarnMock,
    debug: vi.fn(),
  },
}));

const VALID_TOKEN = "1234567890:AAABBBCCCDDDEEEFFFGGGHHHIIIJJJKKKLLLMMM";
const INVALID_TOKEN = "1234567890:BAD_TOKEN_XXXXXXXXXXXXXXXXXXXXXXXXX";

describe("validateBotToken (Telegram getMe backend proxy)", () => {
  beforeEach(() => {
    loggerErrorMock.mockReset();
    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("returns {ok:true, botUsername, botId, firstName} on valid token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          id: 123456789,
          is_bot: true,
          first_name: "Foo Bot",
          username: "foo_bot",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { validateBotToken } = await import("./getme-proxy.js");
    const result = await validateBotToken(VALID_TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.botUsername).toBe("foo_bot");
      expect(result.botId).toBe(123456789);
      expect(result.firstName).toBe("Foo Bot");
    }

    // Verify URL contains encoded token and getMe path
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("api.telegram.org/bot");
    expect(calledUrl).toContain("/getMe");
    expect(calledUrl).toContain(encodeURIComponent(VALID_TOKEN));
  });

  it("returns {ok:false, error} when Telegram rejects the token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        ok: false,
        error_code: 401,
        description: "Unauthorized",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { validateBotToken } = await import("./getme-proxy.js");
    const result = await validateBotToken(INVALID_TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Unauthorized");
    }
  });

  it("returns {ok:false, error:'Telegram unreachable'} on AbortError timeout", async () => {
    const abortErr = new DOMException("The operation was aborted.", "AbortError");
    const fetchMock = vi.fn().mockRejectedValue(abortErr);
    vi.stubGlobal("fetch", fetchMock);

    const { validateBotToken } = await import("./getme-proxy.js");
    const result = await validateBotToken(VALID_TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Telegram unreachable");
    }
  });

  it("returns {ok:false, error:'Telegram proxy error'} on generic network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const { validateBotToken } = await import("./getme-proxy.js");
    const result = await validateBotToken(VALID_TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Telegram proxy error");
    }
    // logger.error was called with SOMETHING (but must NOT include the token — checked below)
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  it("returns {ok:false, error:'Bot has no username set (create one via @BotFather)'} when bot is nameless", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          id: 1,
          is_bot: true,
          first_name: "Anon",
          // username missing on purpose
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { validateBotToken } = await import("./getme-proxy.js");
    const result = await validateBotToken(VALID_TOKEN);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(
        "Bot has no username set (create one via @BotFather)",
      );
    }
  });

  it("NEVER logs the bot token value on any code path", async () => {
    // Success path
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          result: { id: 1, is_bot: true, first_name: "F", username: "b" },
        }),
      }),
    );

    const { validateBotToken } = await import("./getme-proxy.js");
    await validateBotToken(VALID_TOKEN);

    for (const call of loggerInfoMock.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(VALID_TOKEN);
    }
    for (const call of loggerErrorMock.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(VALID_TOKEN);
    }
    for (const call of loggerWarnMock.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(VALID_TOKEN);
    }

    // Error path
    loggerErrorMock.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await validateBotToken(VALID_TOKEN);
    for (const call of loggerErrorMock.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(VALID_TOKEN);
    }
  });
});
