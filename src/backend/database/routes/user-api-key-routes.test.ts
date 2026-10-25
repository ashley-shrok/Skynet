/**
 * Creating an access key: whoever creates it must choose how long it lasts —
 * a date, or "never" chosen on purpose. And creating or deleting one needs a
 * confirmed sign-in (the confirm check itself is covered in
 * user-confirm-identity-routes.test.ts; here it's let through).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const inserted: Array<Record<string, unknown>> = [];
const recentAuthCalls: string[] = [];

vi.mock("drizzle-orm", () => ({ eq: (col: unknown, val: unknown) => ({ col, val }) }));
vi.mock("../db/schema.js", () => ({ apiKeys: { __name: "api_keys" }, users: { __name: "users" } }));
vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ id: "u1", username: "owner" }] }),
      }),
    }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        inserted.push(row);
      },
    }),
  },
  saveMemoryDatabaseToFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../utils/logger.js", () => {
  const l = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { authLogger: l };
});
vi.mock("../../utils/recent-auth.js", () => ({
  requireRecentAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    recentAuthCalls.push(`${req.method} ${req.path}`);
    next();
  },
}));

import { registerUserApiKeyRoutes } from "./user-api-key-routes.js";

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerUserApiKeyRoutes(router, (_req, _res, next) => next());
  app.use("/users", router);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  inserted.length = 0;
  recentAuthCalls.length = 0;
});

async function create(body: unknown) {
  const res = await fetch(`${base}/users/api-keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("creating an access key", () => {
  it("refuses a key with no chosen lifetime", async () => {
    const res = await create({ name: "agent", userId: "u1" });
    expect(res.status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it("accepts a chosen end date of any length", async () => {
    const far = new Date(Date.now() + 50 * 365 * 24 * 3600 * 1000).toISOString();
    const res = await create({ name: "agent", userId: "u1", expiresAt: far });
    expect(res.status).toBe(201);
    expect(inserted[0].expiresAt).toBe(far);
  });

  it("accepts never-expires only when chosen on purpose", async () => {
    const res = await create({ name: "agent", userId: "u1", neverExpires: true });
    expect(res.status).toBe(201);
    expect(inserted[0].expiresAt).toBeNull();
    expect(res.body.token).toMatch(/^tmx_/);
  });

  it("refuses both an end date and never-expires at once", async () => {
    const res = await create({
      name: "agent",
      userId: "u1",
      neverExpires: true,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(res.status).toBe(400);
  });

  it("refuses an end date in the past", async () => {
    const res = await create({ name: "agent", userId: "u1", expiresAt: "2001-01-01T00:00:00Z" });
    expect(res.status).toBe(400);
  });

  it("goes through the confirm check", async () => {
    await create({ name: "agent", userId: "u1", neverExpires: true });
    expect(recentAuthCalls).toEqual(["POST /api-keys"]);
  });
});
