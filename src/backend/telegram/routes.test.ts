/**
 * Phase 79 Plan 03 Task 2 — /telegram/* route tests.
 *
 * Mirrors src/backend/matrix/matrix-admin-routes.test.ts scaffold: bare
 * Express + Node http.request, vi.mock() the AuthManager to inject a
 * mockable authenticated userId, vi.mock() the store + proxy + Plan 04
 * file writers to observe call sites.
 *
 * Blocker-specific tests (revisions B-1 + B-2):
 *   B-1a: activate → writeBotTokenFile called once with (identityKey, botToken)
 *   B-1b: disconnect → deleteBotTokenFile called once
 *   B-2a: activate → rewriteRegistryFromCurrentState called AFTER setTelegramBotToken
 *   B-2b: disconnect → rewriteRegistryFromCurrentState called AFTER deleteTelegramBotToken
 *   B-2c: activate returns 200 even when rewriteRegistryFromCurrentState fails; warn logged
 *   B-1/B-2 order: on activate, file writes + registry rewrite BOTH complete BEFORE res.json
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mock AuthManager BEFORE importing routes.ts.
// ---------------------------------------------------------------------------

let mockUserId: string | null = null;
const MOCK_USER_ID_DEFAULT = "user-uuid-1";

vi.mock("../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware: () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (mockUserId === null) {
            return res
              .status(401)
              .json({ error: "Missing authentication token" });
          }
          (req as express.Request & { userId: string }).userId = mockUserId;
          next();
        },
      createAdminMiddleware: () =>
        (
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction,
        ) => {
          return res.status(403).json({ error: "not used in these tests" });
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Mock the store, proxy, and Plan 04 writers.
// ---------------------------------------------------------------------------

const {
  setTelegramBotTokenMock,
  getTelegramBotTokenMock,
  deleteTelegramBotTokenMock,
  validateBotTokenMock,
  writeBotTokenFileMock,
  deleteBotTokenFileMock,
  rewriteRegistryFromCurrentStateMock,
} = vi.hoisted(() => ({
  setTelegramBotTokenMock: vi.fn(),
  getTelegramBotTokenMock: vi.fn(),
  deleteTelegramBotTokenMock: vi.fn(),
  validateBotTokenMock: vi.fn(),
  writeBotTokenFileMock: vi.fn(),
  deleteBotTokenFileMock: vi.fn(),
  rewriteRegistryFromCurrentStateMock: vi.fn(),
}));

vi.mock("./tokens-store.js", () => ({
  setTelegramBotToken: setTelegramBotTokenMock,
  getTelegramBotToken: getTelegramBotTokenMock,
  deleteTelegramBotToken: deleteTelegramBotTokenMock,
}));

vi.mock("./getme-proxy.js", () => ({
  validateBotToken: validateBotTokenMock,
}));

vi.mock("./bot-token-file-writer.js", () => ({
  writeBotTokenFile: writeBotTokenFileMock,
  deleteBotTokenFile: deleteBotTokenFileMock,
}));

vi.mock("./bridge-config-writer.js", () => ({
  rewriteRegistryFromCurrentState: rewriteRegistryFromCurrentStateMock,
}));

// Silence logger noise but keep spies for warn-assertion (B-2c).
const { warnSpy, errorSpy, infoSpy } = vi.hoisted(() => ({
  warnSpy: vi.fn(),
  errorSpy: vi.fn(),
  infoSpy: vi.fn(),
}));
vi.mock("../utils/logger.js", () => ({
  authLogger: {
    warn: warnSpy,
    error: errorSpy,
    info: infoSpy,
    debug: vi.fn(),
  },
  databaseLogger: {
    warn: warnSpy,
    error: errorSpy,
    info: infoSpy,
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are set up.
// ---------------------------------------------------------------------------

const { default: telegramRoutes } = await import("./routes.js");

// ---------------------------------------------------------------------------
// Test server harness.
// ---------------------------------------------------------------------------

function startServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.use("/telegram", telegramRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : {},
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: chunks }),
        );
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Shared valid payloads.
// ---------------------------------------------------------------------------

const VALID_TOKEN = "1234567890:AAABBBCCCDDDEEEFFFGGGHHHIIIJJJKKKLL";
const ACTIVATE_BODY = {
  identityKey: "alexander",
  botToken: VALID_TOKEN,
  humanUserId: MOCK_USER_ID_DEFAULT,
  telegramChatId: null,
};

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

let server: { port: number; close: () => Promise<void> };

beforeEach(async () => {
  setTelegramBotTokenMock.mockReset().mockResolvedValue(undefined);
  getTelegramBotTokenMock.mockReset().mockResolvedValue(null);
  deleteTelegramBotTokenMock.mockReset().mockResolvedValue(undefined);
  validateBotTokenMock.mockReset();
  writeBotTokenFileMock.mockReset().mockResolvedValue(undefined);
  deleteBotTokenFileMock.mockReset().mockResolvedValue(undefined);
  rewriteRegistryFromCurrentStateMock
    .mockReset()
    .mockResolvedValue({ ok: true, agentCount: 1, humanCount: 1 });
  warnSpy.mockReset();
  errorSpy.mockReset();
  infoSpy.mockReset();
  mockUserId = MOCK_USER_ID_DEFAULT;
  server = await startServer();
});

afterEach(async () => {
  await server.close();
});

// -------------------------- POST /telegram/validate ------------------------

describe("POST /telegram/validate", () => {
  it("401 when no auth", async () => {
    mockUserId = null;
    const res = await request(server.port, "POST", "/telegram/validate", {
      botToken: VALID_TOKEN,
    });
    expect(res.status).toBe(401);
  });

  it("400 when body missing botToken", async () => {
    const res = await request(server.port, "POST", "/telegram/validate", {});
    expect(res.status).toBe(400);
  });

  it("400 when botToken doesn't match regex", async () => {
    const res = await request(server.port, "POST", "/telegram/validate", {
      botToken: "not-a-real-token",
    });
    expect(res.status).toBe(400);
  });

  it("200 with {ok:true, botUsername} on valid token", async () => {
    validateBotTokenMock.mockResolvedValue({
      ok: true,
      botUsername: "foo_bot",
      botId: 1,
      firstName: "F",
    });
    const res = await request(server.port, "POST", "/telegram/validate", {
      botToken: VALID_TOKEN,
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.botUsername).toBe("foo_bot");
  });

  it("200 with {ok:false, error} on invalid token (Telegram rejection)", async () => {
    validateBotTokenMock.mockResolvedValue({
      ok: false,
      error: "Unauthorized",
    });
    const res = await request(server.port, "POST", "/telegram/validate", {
      botToken: VALID_TOKEN,
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("Unauthorized");
  });
});

// -------------------------- POST /telegram/activate ------------------------

describe("POST /telegram/activate", () => {
  it("401 when no auth", async () => {
    mockUserId = null;
    const res = await request(
      server.port,
      "POST",
      "/telegram/activate",
      ACTIVATE_BODY,
    );
    expect(res.status).toBe(401);
  });

  it("403 when authenticated user does NOT match humanUserId in body", async () => {
    mockUserId = "different-user";
    validateBotTokenMock.mockResolvedValue({
      ok: true,
      botUsername: "foo_bot",
      botId: 1,
      firstName: "F",
    });
    const res = await request(
      server.port,
      "POST",
      "/telegram/activate",
      ACTIVATE_BODY,
    );
    expect(res.status).toBe(403);
    expect(setTelegramBotTokenMock).not.toHaveBeenCalled();
  });

  it("400 when identityKey is malformed", async () => {
    const res = await request(server.port, "POST", "/telegram/activate", {
      ...ACTIVATE_BODY,
      identityKey: "../etc/passwd",
    });
    expect(res.status).toBe(400);
  });

  it("400 when botToken doesn't match regex", async () => {
    const res = await request(server.port, "POST", "/telegram/activate", {
      ...ACTIVATE_BODY,
      botToken: "bad",
    });
    expect(res.status).toBe(400);
  });

  it("400 when validateBotToken rejects (bad token)", async () => {
    validateBotTokenMock.mockResolvedValue({
      ok: false,
      error: "Unauthorized",
    });
    const res = await request(
      server.port,
      "POST",
      "/telegram/activate",
      ACTIVATE_BODY,
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Unauthorized");
    expect(setTelegramBotTokenMock).not.toHaveBeenCalled();
    expect(writeBotTokenFileMock).not.toHaveBeenCalled();
    expect(rewriteRegistryFromCurrentStateMock).not.toHaveBeenCalled();
  });

  it("200 happy path — calls setTelegramBotToken with all fields", async () => {
    validateBotTokenMock.mockResolvedValue({
      ok: true,
      botUsername: "foo_bot",
      botId: 1,
      firstName: "F",
    });
    const res = await request(
      server.port,
      "POST",
      "/telegram/activate",
      ACTIVATE_BODY,
    );
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.botUsername).toBe("foo_bot");

    expect(setTelegramBotTokenMock).toHaveBeenCalledOnce();
    const setArgs = setTelegramBotTokenMock.mock.calls[0];
    expect(setArgs[0]).toBe("alexander");
    expect(setArgs[1]).toMatchObject({
      botToken: VALID_TOKEN,
      botUsername: "foo_bot",
      humanUserId: MOCK_USER_ID_DEFAULT,
      telegramChatId: null,
    });
  });

  // ------ Blocker B-1a: writeBotTokenFile is called ------
  it("B-1a: activate happy-path calls writeBotTokenFile(identityKey, botToken) exactly once", async () => {
    validateBotTokenMock.mockResolvedValue({
      ok: true,
      botUsername: "foo_bot",
      botId: 1,
      firstName: "F",
    });
    await request(server.port, "POST", "/telegram/activate", ACTIVATE_BODY);
    expect(writeBotTokenFileMock).toHaveBeenCalledTimes(1);
    expect(writeBotTokenFileMock).toHaveBeenCalledWith(
      "alexander",
      VALID_TOKEN,
    );
  });

  // ------ Blocker B-2a: rewriteRegistryFromCurrentState ordering ------
  it("B-2a: rewriteRegistryFromCurrentState is called AFTER setTelegramBotToken", async () => {
    validateBotTokenMock.mockResolvedValue({
      ok: true,
      botUsername: "foo_bot",
      botId: 1,
      firstName: "F",
    });
    await request(server.port, "POST", "/telegram/activate", ACTIVATE_BODY);

    expect(rewriteRegistryFromCurrentStateMock).toHaveBeenCalledTimes(1);
    const setOrder = setTelegramBotTokenMock.mock.invocationCallOrder[0];
    const rewriteOrder =
      rewriteRegistryFromCurrentStateMock.mock.invocationCallOrder[0];
    expect(rewriteOrder).toBeGreaterThan(setOrder);
  });

  // ------ Blocker B-2c: 200 even when rewrite fails; warn logged ------
  it("B-2c: activate returns 200 when rewriteRegistryFromCurrentState returns {ok:false}; warn is logged", async () => {
    validateBotTokenMock.mockResolvedValue({
      ok: true,
      botUsername: "foo_bot",
      botId: 1,
      firstName: "F",
    });
    rewriteRegistryFromCurrentStateMock.mockResolvedValue({
      ok: false,
      error: "disk full",
    });

    const res = await request(
      server.port,
      "POST",
      "/telegram/activate",
      ACTIVATE_BODY,
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);

    // A warn call was fired for the failed rewrite.
    const warnCallsSerialized = warnSpy.mock.calls.map((c) => JSON.stringify(c));
    const rewriteWarn = warnCallsSerialized.find((s) =>
      /registry_rewrite_failed|registry rewrite failed/.test(s),
    );
    expect(rewriteWarn).toBeDefined();
  });

  // ------ B-1 + B-2 order-of-operations: both side-effects fire BEFORE res.json ------
  it("both writeBotTokenFile AND rewriteRegistryFromCurrentState complete BEFORE 200 response", async () => {
    validateBotTokenMock.mockResolvedValue({
      ok: true,
      botUsername: "foo_bot",
      botId: 1,
      firstName: "F",
    });

    let writeCompletedAt = 0;
    let rewriteCompletedAt = 0;
    writeBotTokenFileMock.mockImplementation(async () => {
      writeCompletedAt = Date.now();
      // Small delay to make ordering assertion meaningful.
      await new Promise((r) => setTimeout(r, 5));
    });
    rewriteRegistryFromCurrentStateMock.mockImplementation(async () => {
      rewriteCompletedAt = Date.now();
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, agentCount: 1, humanCount: 1 };
    });

    const responseReceivedAt = await new Promise<number>((resolve) => {
      const body = JSON.stringify(ACTIVATE_BODY);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: server.port,
          path: "/telegram/activate",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          res.on("data", () => {});
          res.on("end", () => resolve(Date.now()));
        },
      );
      req.write(body);
      req.end();
    });

    // Both side-effects completed before the response arrived.
    expect(writeCompletedAt).toBeGreaterThan(0);
    expect(rewriteCompletedAt).toBeGreaterThan(0);
    expect(responseReceivedAt).toBeGreaterThanOrEqual(writeCompletedAt);
    expect(responseReceivedAt).toBeGreaterThanOrEqual(rewriteCompletedAt);
    // And the ordering between them is write BEFORE rewrite (setToken → write → rewrite).
    expect(rewriteCompletedAt).toBeGreaterThanOrEqual(writeCompletedAt);
  });
});

// -------------------------- POST /telegram/disconnect ----------------------

describe("POST /telegram/disconnect", () => {
  it("401 when no auth", async () => {
    mockUserId = null;
    const res = await request(server.port, "POST", "/telegram/disconnect", {
      identityKey: "alexander",
    });
    expect(res.status).toBe(401);
  });

  it("404 when no row exists", async () => {
    getTelegramBotTokenMock.mockResolvedValue(null);
    const res = await request(server.port, "POST", "/telegram/disconnect", {
      identityKey: "alexander",
    });
    expect(res.status).toBe(404);
    expect(deleteTelegramBotTokenMock).not.toHaveBeenCalled();
    expect(deleteBotTokenFileMock).not.toHaveBeenCalled();
  });

  it("403 when row's humanUserId doesn't match auth user", async () => {
    getTelegramBotTokenMock.mockResolvedValue({
      identityKey: "alexander",
      botToken: VALID_TOKEN,
      botUsername: "foo_bot",
      humanUserId: "different-user",
      telegramChatId: null,
      createdAt: "",
      updatedAt: "",
    });
    const res = await request(server.port, "POST", "/telegram/disconnect", {
      identityKey: "alexander",
    });
    expect(res.status).toBe(403);
    expect(deleteTelegramBotTokenMock).not.toHaveBeenCalled();
  });

  it("400 when identityKey missing/malformed", async () => {
    const res = await request(server.port, "POST", "/telegram/disconnect", {
      identityKey: "../etc/passwd",
    });
    expect(res.status).toBe(400);
  });

  it("200 happy path — calls deleteTelegramBotToken", async () => {
    getTelegramBotTokenMock.mockResolvedValue({
      identityKey: "alexander",
      botToken: VALID_TOKEN,
      botUsername: "foo_bot",
      humanUserId: MOCK_USER_ID_DEFAULT,
      telegramChatId: null,
      createdAt: "",
      updatedAt: "",
    });
    const res = await request(server.port, "POST", "/telegram/disconnect", {
      identityKey: "alexander",
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(deleteTelegramBotTokenMock).toHaveBeenCalledWith("alexander");
  });

  // ------ Blocker B-1b: deleteBotTokenFile is called ------
  it("B-1b: disconnect happy-path calls deleteBotTokenFile(identityKey) exactly once", async () => {
    getTelegramBotTokenMock.mockResolvedValue({
      identityKey: "alexander",
      botToken: VALID_TOKEN,
      botUsername: "foo_bot",
      humanUserId: MOCK_USER_ID_DEFAULT,
      telegramChatId: null,
      createdAt: "",
      updatedAt: "",
    });
    await request(server.port, "POST", "/telegram/disconnect", {
      identityKey: "alexander",
    });
    expect(deleteBotTokenFileMock).toHaveBeenCalledTimes(1);
    expect(deleteBotTokenFileMock).toHaveBeenCalledWith("alexander");
  });

  // ------ Blocker B-2b: rewriteRegistryFromCurrentState ordering ------
  it("B-2b: rewriteRegistryFromCurrentState is called AFTER deleteTelegramBotToken", async () => {
    getTelegramBotTokenMock.mockResolvedValue({
      identityKey: "alexander",
      botToken: VALID_TOKEN,
      botUsername: "foo_bot",
      humanUserId: MOCK_USER_ID_DEFAULT,
      telegramChatId: null,
      createdAt: "",
      updatedAt: "",
    });
    await request(server.port, "POST", "/telegram/disconnect", {
      identityKey: "alexander",
    });

    expect(rewriteRegistryFromCurrentStateMock).toHaveBeenCalledTimes(1);
    const deleteOrder =
      deleteTelegramBotTokenMock.mock.invocationCallOrder[0];
    const rewriteOrder =
      rewriteRegistryFromCurrentStateMock.mock.invocationCallOrder[0];
    expect(rewriteOrder).toBeGreaterThan(deleteOrder);
  });
});

// -------------------------- GET /telegram/:identityKey ---------------------

describe("GET /telegram/:identityKey", () => {
  it("401 when no auth", async () => {
    mockUserId = null;
    const res = await request(server.port, "GET", "/telegram/alexander");
    expect(res.status).toBe(401);
  });

  it("400 when identityKey param is malformed", async () => {
    const res = await request(server.port, "GET", "/telegram/UPPERCASE");
    expect(res.status).toBe(400);
  });

  it("200 {status:'unconfigured'} when no row exists", async () => {
    getTelegramBotTokenMock.mockResolvedValue(null);
    const res = await request(server.port, "GET", "/telegram/alexander");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "unconfigured" });
  });

  it("200 {status:'connected', botUsername, telegramChatId} — bot token NEVER in response", async () => {
    getTelegramBotTokenMock.mockResolvedValue({
      identityKey: "alexander",
      botToken: VALID_TOKEN,
      botUsername: "foo_bot",
      humanUserId: MOCK_USER_ID_DEFAULT,
      telegramChatId: "-100987654321",
      createdAt: "",
      updatedAt: "",
    });
    const res = await request(server.port, "GET", "/telegram/alexander");
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed).toEqual({
      status: "connected",
      botUsername: "foo_bot",
      telegramChatId: "-100987654321",
    });
    // Belt-and-braces: no substring of the token in the raw response body.
    expect(res.body).not.toContain(VALID_TOKEN);
    expect(res.body).not.toContain("botToken");
    expect(res.body).not.toContain("bot_token");
  });
});
