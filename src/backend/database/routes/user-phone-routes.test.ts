/**
 * agent-phone — tests for the self-service /users/me/phone routes.
 *
 * Same scaffold as user-admin-routes.test.ts: bare Express + node:http, a
 * mocked Drizzle chain over an in-memory users array, and an authenticateJWT
 * stub that reads `x-test-user-id`.
 *
 * The invariant under test: a user with no number on file can never get one
 * through these routes (PUT and DELETE both 403).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

interface UserRow {
  id: string;
  phoneE164: string | null;
}

type Filter = { id?: string; phoneNotNull?: boolean };

const dbState: { users: UserRow[]; updateCount: number } = {
  users: [],
  updateCount: 0,
};

vi.mock("drizzle-orm", () => ({
  eq: (col: { _colName: string }, val: unknown) => ({ [col._colName]: val }),
  isNotNull: (col: { _colName: string }) => ({
    [`${col._colName}NotNull`]: true,
  }),
  and: (...parts: object[]) => Object.assign({}, ...parts),
}));

vi.mock("../db/schema.js", () => ({
  users: {
    id: { _colName: "id" },
    phoneE164: { _colName: "phoneE164" },
  },
}));

const { saveMemoryDatabaseToFileMock } = vi.hoisted(() => ({
  saveMemoryDatabaseToFileMock: vi.fn<() => Promise<void>>(),
}));

vi.mock("../db/index.js", () => {
  const matches = (row: UserRow, f: Filter) =>
    (f.id === undefined || row.id === f.id) &&
    (!f.phoneNotNull || row.phoneE164 !== null);

  const makeChain = (mode: "select" | "update") => {
    let filter: Filter = {};
    let updates: Partial<UserRow> | null = null;
    // biome-ignore lint/suspicious/noExplicitAny: chainable shim
    const chain: { [k: string]: any } = {};
    chain.from = () => chain;
    chain.limit = () => chain;
    chain.where = (f: { id?: string; phoneE164NotNull?: boolean }) => {
      filter = { id: f.id, phoneNotNull: f.phoneE164NotNull };
      return chain;
    };
    chain.set = (u: Partial<UserRow>) => {
      updates = u;
      return chain;
    };
    const resolve = () => {
      if (mode === "select") return dbState.users.filter((r) => matches(r, filter));
      dbState.updateCount++;
      for (const row of dbState.users) {
        if (updates && matches(row, filter)) Object.assign(row, updates);
      }
      return undefined;
    };
    chain.then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled);
    return chain;
  };

  return {
    db: {
      select: () => makeChain("select"),
      update: () => makeChain("update"),
    },
    saveMemoryDatabaseToFile: () => saveMemoryDatabaseToFileMock(),
  };
});

const { authLoggerMock } = vi.hoisted(() => ({
  authLoggerMock: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/logger.js", () => ({
  authLogger: authLoggerMock,
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { registerUserPhoneRoutes } from "./user-phone-routes.js";

function buildTestApp(): express.Express {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  const authenticateJWT: express.RequestHandler = (req, res, next) => {
    const hdr = req.header("x-test-user-id");
    if (!hdr) return res.status(401).json({ error: "Unauthorized" });
    (req as express.Request & { userId: string }).userId = hdr;
    next();
  };
  registerUserPhoneRoutes(router, authenticateJWT);
  app.use("/users", router);
  return app;
}

function request(
  server: http.Server,
  method: string,
  path: string,
  jsonBody?: unknown,
  userId?: string,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr = jsonBody === undefined ? "" : JSON.stringify(jsonBody);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(bodyStr),
          ...(userId ? { "x-test-user-id": userId } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

const phoneOf = (id: string) => dbState.users.find((u) => u.id === id)?.phoneE164;

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  dbState.users = [
    { id: "enabled-1", phoneE164: "+17165550100" },
    { id: "disabled-1", phoneE164: null },
  ];
  dbState.updateCount = 0;
  saveMemoryDatabaseToFileMock.mockResolvedValue(undefined);
  server = http.createServer(buildTestApp());
  server.listen(0);
});

afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("GET /users/me/phone", () => {
  it("returns the caller's number", async () => {
    const res = await request(server, "GET", "/users/me/phone", undefined, "enabled-1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phoneE164: "+17165550100" });
  });

  it("returns null when no number is on file", async () => {
    const res = await request(server, "GET", "/users/me/phone", undefined, "disabled-1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phoneE164: null });
  });

  it("401 without auth", async () => {
    const res = await request(server, "GET", "/users/me/phone");
    expect(res.status).toBe(401);
  });

  it("404 for an unknown user", async () => {
    const res = await request(server, "GET", "/users/me/phone", undefined, "ghost");
    expect(res.status).toBe(404);
  });
});

describe("PUT /users/me/phone", () => {
  it("changes the number when one is already on file", async () => {
    const res = await request(
      server,
      "PUT",
      "/users/me/phone",
      { phoneE164: "+447700900123" },
      "enabled-1",
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, phoneE164: "+447700900123" });
    expect(phoneOf("enabled-1")).toBe("+447700900123");
    expect(saveMemoryDatabaseToFileMock).toHaveBeenCalledTimes(1);
    // Audit log never carries the digits.
    expect(JSON.stringify(authLoggerMock.info.mock.calls)).not.toContain("447700900123");
  });

  it("403 when no number is on file — users cannot add one", async () => {
    const res = await request(
      server,
      "PUT",
      "/users/me/phone",
      { phoneE164: "+17165550199" },
      "disabled-1",
    );
    expect(res.status).toBe(403);
    expect(phoneOf("disabled-1")).toBeNull();
    expect(dbState.updateCount).toBe(0);
  });

  it.each([
    ["not-a-phone"],
    ["17165550199"],
    ["+1 716 555 0199"],
    ["+01234567"],
    ["+1234567"],
    [17165550199],
    [null],
  ])("400 for invalid number %j, DB unchanged", async (phoneE164) => {
    const res = await request(server, "PUT", "/users/me/phone", { phoneE164 }, "enabled-1");
    expect(res.status).toBe(400);
    expect(phoneOf("enabled-1")).toBe("+17165550100");
    expect(dbState.updateCount).toBe(0);
  });

  it("invalid input is a 400 even for a user without a number", async () => {
    const res = await request(
      server,
      "PUT",
      "/users/me/phone",
      { phoneE164: "bogus" },
      "disabled-1",
    );
    expect(res.status).toBe(400);
  });

  it("401 without auth", async () => {
    const res = await request(server, "PUT", "/users/me/phone", { phoneE164: "+17165550199" });
    expect(res.status).toBe(401);
  });

  it("only touches the caller's row", async () => {
    await request(server, "PUT", "/users/me/phone", { phoneE164: "+17165550199" }, "enabled-1");
    expect(phoneOf("disabled-1")).toBeNull();
  });
});

describe("DELETE /users/me/phone", () => {
  it("clears the number", async () => {
    const res = await request(server, "DELETE", "/users/me/phone", undefined, "enabled-1");
    expect(res.status).toBe(200);
    expect(phoneOf("enabled-1")).toBeNull();
    expect(saveMemoryDatabaseToFileMock).toHaveBeenCalledTimes(1);
  });

  it("after clearing, PUT is refused — only an admin can re-enable", async () => {
    await request(server, "DELETE", "/users/me/phone", undefined, "enabled-1");
    const res = await request(
      server,
      "PUT",
      "/users/me/phone",
      { phoneE164: "+17165550100" },
      "enabled-1",
    );
    expect(res.status).toBe(403);
    expect(phoneOf("enabled-1")).toBeNull();
  });

  it("403 when no number is on file", async () => {
    const res = await request(server, "DELETE", "/users/me/phone", undefined, "disabled-1");
    expect(res.status).toBe(403);
    expect(dbState.updateCount).toBe(0);
  });

  it("401 without auth", async () => {
    const res = await request(server, "DELETE", "/users/me/phone");
    expect(res.status).toBe(401);
  });
});
