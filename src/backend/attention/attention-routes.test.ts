/**
 * attention-routes.test.ts — GET /attention/read-state + POST /attention/seen.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

let mockUserId: string | null = "u1";

vi.mock("../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
          if (mockUserId === null) return res.status(401).json({ error: "Unauthorized" });
          (req as express.Request & { userId: string }).userId = mockUserId;
          next();
        },
    }),
  },
}));
vi.mock("../utils/logger.js", () => ({
  systemLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const store = {
  getForUser: vi.fn(),
  markSeen: vi.fn(),
};
vi.mock("./read-state-store.js", () => ({
  getReadStateStore: () => store,
  isValidIdentityName: (n: unknown) => typeof n === "string" && n.length > 0 && n.length <= 256,
}));

const publishToUser = vi.fn();
let registryPresent = true;
vi.mock("../fleet-status/registry-holder.js", () => ({
  getRegistry: () => (registryPresent ? { publishToUser } : null),
}));

import router from "./attention-routes.js";

function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: bodyStr
          ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bodyStr)) }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : undefined }),
        );
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

let server: http.Server;
beforeEach(async () => {
  mockUserId = "u1";
  registryPresent = true;
  store.getForUser.mockReset();
  store.markSeen.mockReset();
  publishToUser.mockReset();
  const app = express();
  app.use(express.json());
  app.use("/attention", router);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("GET /attention/read-state", () => {
  it("returns the caller's read state", async () => {
    store.getForUser.mockReturnValue({ baselineAt: 10, seen: [{ hostId: "h1", identityName: "a", seenFinishAt: 5 }] });
    const res = await request(server, "GET", "/attention/read-state");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ baselineAt: 10, seen: [{ hostId: "h1", identityName: "a", seenFinishAt: 5 }] });
    expect(store.getForUser).toHaveBeenCalledWith("u1");
  });

  it("401s without auth", async () => {
    mockUserId = null;
    expect((await request(server, "GET", "/attention/read-state")).status).toBe(401);
  });

  it("500s when the store throws", async () => {
    store.getForUser.mockImplementation(() => {
      throw new Error("db");
    });
    expect((await request(server, "GET", "/attention/read-state")).status).toBe(500);
  });
});

describe("POST /attention/seen", () => {
  it("advances the mark and pushes it to the caller's own tabs", async () => {
    store.markSeen.mockReturnValue(true);
    const res = await request(server, "POST", "/attention/seen", { hostId: "h1", identityName: "aspen", seenFinishAt: 1000 });
    expect(res.status).toBe(204);
    expect(store.markSeen).toHaveBeenCalledWith("u1", "h1", "aspen", 1000);
    expect(publishToUser).toHaveBeenCalledWith("u1", {
      schemaVersion: 1,
      type: "read-state-changed",
      hostId: "h1",
      identityName: "aspen",
      seenFinishAt: 1000,
    });
  });

  it("does not push when nothing advanced", async () => {
    store.markSeen.mockReturnValue(false);
    const res = await request(server, "POST", "/attention/seen", { hostId: "h1", identityName: "aspen", seenFinishAt: 1000 });
    expect(res.status).toBe(204);
    expect(publishToUser).not.toHaveBeenCalled();
  });

  it("still succeeds when the registry is not ready", async () => {
    registryPresent = false;
    store.markSeen.mockReturnValue(true);
    const res = await request(server, "POST", "/attention/seen", { hostId: "h1", identityName: "aspen", seenFinishAt: 1000 });
    expect(res.status).toBe(204);
  });

  it.each([
    [{ identityName: "aspen", seenFinishAt: 1 }],
    [{ hostId: "h1", seenFinishAt: 1 }],
    [{ hostId: "h1", identityName: "aspen" }],
    [{ hostId: "h1", identityName: "aspen", seenFinishAt: "1" }],
    [{ hostId: "h1", identityName: "aspen", seenFinishAt: 0 }],
  ])("400s on bad body %j", async (body) => {
    const res = await request(server, "POST", "/attention/seen", body);
    expect(res.status).toBe(400);
    expect(store.markSeen).not.toHaveBeenCalled();
  });
});
