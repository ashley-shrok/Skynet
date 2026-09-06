/**
 * Phase 75 amendment tests — POST /matrix-admin/creds + GET /matrix-admin/creds.
 *
 * Follows the identity-no-dormancy.test.ts scaffold: bare Express + Node
 * http.request, vi.mock() the AuthManager to inject a mock admin/non-admin
 * user via a module-scoped mockUserId, vi.mock() the creds store to observe
 * ingestion calls.
 *
 * Test surface:
 *   Auth:
 *     1. 401 — no admin cookie/token
 *     2. 403 — token belongs to a non-admin user (isAdmin mock returns false)
 *   Body validation:
 *     3. 400 — invalid homeserverBase (not a URL)
 *     4. 400 — invalid userId (not @localpart:server_name shape)
 *     5. 400 — missing password
 *     6. 400 — missing accessToken
 *   Happy paths:
 *     7. 200 — first-time ingestion (rotation: false)
 *     8. 200 — rotation (rotation: true when getMatrixAdminCreds returns existing)
 *   Metadata:
 *     9. GET returns {present: false} when no creds ingested
 *     10. GET returns {present: true, mxid, homeserverBase} (no password/token leaked)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Mock the AuthManager BEFORE importing the module under test
// ---------------------------------------------------------------------------

let mockIsAdmin: boolean | null = false;
const MOCK_ADMIN_USER_ID = "admin-abc";

vi.mock("../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAdminMiddleware: () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (mockIsAdmin === null) {
            return res.status(401).json({ error: "Missing authentication token" });
          }
          if (mockIsAdmin === false) {
            return res.status(403).json({ error: "Admin privileges required" });
          }
          (req as express.Request & { userId: string }).userId = MOCK_ADMIN_USER_ID;
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Mock the creds store + saveMemoryDatabaseToFile
// ---------------------------------------------------------------------------

const { setMatrixAdminCredsMock, getMatrixAdminCredsMock } = vi.hoisted(() => ({
  setMatrixAdminCredsMock: vi.fn(),
  getMatrixAdminCredsMock: vi.fn(),
}));

vi.mock("./matrix-admin-creds-store.js", () => ({
  setMatrixAdminCreds: setMatrixAdminCredsMock,
  getMatrixAdminCreds: getMatrixAdminCredsMock,
}));

const { saveMemoryDatabaseToFileMock } = vi.hoisted(() => ({
  saveMemoryDatabaseToFileMock: vi.fn(),
}));

vi.mock("../database/db/index.js", () => ({
  saveMemoryDatabaseToFile: saveMemoryDatabaseToFileMock,
}));

// Silence logger noise
vi.mock("../utils/logger.js", () => ({
  authLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are set up
// ---------------------------------------------------------------------------

const { default: matrixAdminRoutes } = await import("./matrix-admin-routes.js");

// ---------------------------------------------------------------------------
// Test server harness
// ---------------------------------------------------------------------------

function startServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use("/matrix-admin", matrixAdminRoutes);
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
// Tests
// ---------------------------------------------------------------------------

const VALID_BODY = {
  homeserverBase: "http://100.113.23.63:8008",
  userId: "@skynet-admin:thenasty.taild9b663.ts.net",
  password: "test-password-abc-123",
  accessToken: "syt_test-token-abc-456",
};

describe("POST /matrix-admin/creds", () => {
  let server: { port: number; close: () => Promise<void> };

  beforeEach(async () => {
    setMatrixAdminCredsMock.mockReset().mockResolvedValue(undefined);
    getMatrixAdminCredsMock.mockReset().mockResolvedValue(null);
    saveMemoryDatabaseToFileMock.mockReset().mockResolvedValue(undefined);
    mockIsAdmin = true;
    server = await startServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("401 when no auth token present", async () => {
    mockIsAdmin = null;
    const res = await request(server.port, "POST", "/matrix-admin/creds", VALID_BODY);
    expect(res.status).toBe(401);
  });

  it("403 when caller is authenticated but not admin", async () => {
    mockIsAdmin = false;
    const res = await request(server.port, "POST", "/matrix-admin/creds", VALID_BODY);
    expect(res.status).toBe(403);
  });

  it("400 when homeserverBase is not a URL", async () => {
    const res = await request(server.port, "POST", "/matrix-admin/creds", {
      ...VALID_BODY,
      homeserverBase: "not-a-url",
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/homeserverBase/);
  });

  it("400 when userId is not a valid mxid", async () => {
    const res = await request(server.port, "POST", "/matrix-admin/creds", {
      ...VALID_BODY,
      userId: "not-a-valid-mxid",
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/userId/);
  });

  it("400 when password missing", async () => {
    const { password: _, ...noPass } = VALID_BODY;
    const res = await request(server.port, "POST", "/matrix-admin/creds", noPass);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/password/);
  });

  it("400 when accessToken missing", async () => {
    const { accessToken: _, ...noToken } = VALID_BODY;
    const res = await request(server.port, "POST", "/matrix-admin/creds", noToken);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/accessToken/);
  });

  it("200 on first-time ingestion — calls setMatrixAdminCreds, returns rotation:false", async () => {
    getMatrixAdminCredsMock.mockResolvedValue(null);
    const res = await request(server.port, "POST", "/matrix-admin/creds", VALID_BODY);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.rotation).toBe(false);
    expect(parsed.mxid).toBe(VALID_BODY.userId);
    expect(setMatrixAdminCredsMock).toHaveBeenCalledWith(VALID_BODY);
    expect(saveMemoryDatabaseToFileMock).toHaveBeenCalledOnce();
  });

  it("200 on rotation — returns rotation:true when existing creds present", async () => {
    getMatrixAdminCredsMock.mockResolvedValue({
      homeserverBase: "http://old",
      userId: "@old:old",
      password: "old",
      accessToken: "old-token",
    });
    const res = await request(server.port, "POST", "/matrix-admin/creds", VALID_BODY);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).rotation).toBe(true);
  });
});

describe("GET /matrix-admin/creds", () => {
  let server: { port: number; close: () => Promise<void> };

  beforeEach(async () => {
    getMatrixAdminCredsMock.mockReset();
    mockIsAdmin = true;
    server = await startServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns {present: false} when no creds ingested", async () => {
    getMatrixAdminCredsMock.mockResolvedValue(null);
    const res = await request(server.port, "GET", "/matrix-admin/creds");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ present: false });
  });

  it("returns metadata WITHOUT leaking password or access_token", async () => {
    getMatrixAdminCredsMock.mockResolvedValue({
      homeserverBase: "http://100.113.23.63:8008",
      userId: "@skynet-admin:thenasty.taild9b663.ts.net",
      password: "SECRET-DO-NOT-LEAK",
      accessToken: "SECRET-TOKEN-DO-NOT-LEAK",
    });
    const res = await request(server.port, "GET", "/matrix-admin/creds");
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed).toEqual({
      present: true,
      mxid: "@skynet-admin:thenasty.taild9b663.ts.net",
      homeserverBase: "http://100.113.23.63:8008",
    });
    expect(res.body).not.toMatch(/SECRET/);
  });
});

// Vitest wants at least one afterEach import — keep the linter happy
import { afterEach } from "vitest";
