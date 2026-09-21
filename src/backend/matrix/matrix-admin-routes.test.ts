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
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

const { setMatrixAdminCredsMock, getMatrixAdminCredsMock, setMatrixAdminServerNameMock, setMatrixAdminHostSideBaseMock } = vi.hoisted(() => ({
  setMatrixAdminCredsMock: vi.fn(),
  getMatrixAdminCredsMock: vi.fn(),
  setMatrixAdminServerNameMock: vi.fn(),
  setMatrixAdminHostSideBaseMock: vi.fn(),
}));

vi.mock("./matrix-admin-creds-store.js", () => ({
  setMatrixAdminCreds: setMatrixAdminCredsMock,
  getMatrixAdminCreds: getMatrixAdminCredsMock,
  setMatrixAdminServerName: setMatrixAdminServerNameMock,
  setMatrixAdminHostSideBase: setMatrixAdminHostSideBaseMock,
}));

const { saveMemoryDatabaseToFileMock, dbPrepareRunMock } = vi.hoisted(() => ({
  saveMemoryDatabaseToFileMock: vi.fn(),
  // POST /reset-registry-rooms deletes the two settings rows via
  // db.$client.prepare(...).run(...). Mock captures the run() call so
  // tests can assert the DELETE was issued.
  // Phase 128-09 (D-18): the db.select() plumbing that supported the
  // deleted /migrate-cred-files handler was removed alongside it.
  dbPrepareRunMock: vi.fn(),
}));

vi.mock("../database/db/index.js", () => ({
  saveMemoryDatabaseToFile: saveMemoryDatabaseToFileMock,
  db: {
    $client: {
      prepare: () => ({ run: dbPrepareRunMock }),
    },
  },
}));

// POST /reset-registry-rooms dynamic-imports registry-rooms.js at handler
// time (avoids the same circular-module problem the other endpoints work
// around). Mock ensureRegistryRoomsExist + re-export the two settings-key
// constants so tests can control the ensure result.
const { ensureRegistryRoomsExistMock } = vi.hoisted(() => ({
  ensureRegistryRoomsExistMock: vi.fn(),
}));

vi.mock("../relay-sessions/registry-rooms.js", () => ({
  ensureRegistryRoomsExist: ensureRegistryRoomsExistMock,
  SETTINGS_KEY_AGENTS_REGISTRY: "agents_registry_room_id",
  SETTINGS_KEY_HUMANS_REGISTRY: "humans_registry_room_id",
}));

// Phase 128-09 (D-18): the users schema mock supported the deleted
// /migrate-cred-files handler; no surviving test path needs it.

// Phase 128-09 (D-18): the Phase 79 Plan 08 vi.mock for
// ../telegram/human-token-writer.js + ../telegram/shared-volume.js are
// deleted alongside the migrate-cred-files test block below and the
// migrate-cred-files handler in matrix-admin-routes.ts.

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
      serverName: "thenasty.taild9b663.ts.net",
      hostSideBase: null,
    });
    const res = await request(server.port, "GET", "/matrix-admin/creds");
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed).toEqual({
      present: true,
      mxid: "@skynet-admin:thenasty.taild9b663.ts.net",
      homeserverBase: "http://100.113.23.63:8008",
      serverName: "thenasty.taild9b663.ts.net",
      hostSideBase: null,
    });
    expect(res.body).not.toMatch(/SECRET/);
  });

  it("surfaces serverName:null when the override has not been patched", async () => {
    getMatrixAdminCredsMock.mockResolvedValue({
      homeserverBase: "http://100.113.23.63:8008",
      userId: "@skynet-admin:thenasty.taild9b663.ts.net",
      password: "p",
      accessToken: "t",
      serverName: null,
      hostSideBase: null,
    });
    const res = await request(server.port, "GET", "/matrix-admin/creds");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).serverName).toBeNull();
  });

  it("surfaces hostSideBase when set", async () => {
    getMatrixAdminCredsMock.mockResolvedValue({
      homeserverBase: "http://synapse:8008",
      userId: "@skynet-admin:thenasty.taild9b663.ts.net",
      password: "p",
      accessToken: "t",
      serverName: "thenasty.taild9b663.ts.net",
      hostSideBase: "http://100.99.149.8:8008",
    });
    const res = await request(server.port, "GET", "/matrix-admin/creds");
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.hostSideBase).toBe("http://100.99.149.8:8008");
    expect(parsed.homeserverBase).toBe("http://synapse:8008");
  });

  it("surfaces hostSideBase:null when the override has not been patched", async () => {
    getMatrixAdminCredsMock.mockResolvedValue({
      homeserverBase: "http://synapse:8008",
      userId: "@skynet-admin:thenasty.taild9b663.ts.net",
      password: "p",
      accessToken: "t",
      serverName: null,
      hostSideBase: null,
    });
    const res = await request(server.port, "GET", "/matrix-admin/creds");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).hostSideBase).toBeNull();
  });
});

describe("PATCH /matrix-admin/creds/server-name", () => {
  let server: { port: number; close: () => Promise<void> };

  beforeEach(async () => {
    setMatrixAdminServerNameMock.mockReset();
    mockIsAdmin = true;
    server = await startServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("401 when no auth token present", async () => {
    mockIsAdmin = null;
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/server-name",
      { serverName: "thenasty.taild9b663.ts.net" },
    );
    expect(res.status).toBe(401);
  });

  it("403 when caller is authenticated but not admin", async () => {
    mockIsAdmin = false;
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/server-name",
      { serverName: "thenasty.taild9b663.ts.net" },
    );
    expect(res.status).toBe(403);
  });

  it("400 when serverName is neither string nor null", async () => {
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/server-name",
      { serverName: 42 },
    );
    expect(res.status).toBe(400);
  });

  it("400 when serverName is an empty string", async () => {
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/server-name",
      { serverName: "" },
    );
    expect(res.status).toBe(400);
  });

  it("400 when serverName contains illegal characters (uppercase, colon, etc.)", async () => {
    for (const bad of [
      "Thenasty.example.com", // uppercase
      "host:8008", // colon (port)
      "host with space",
      "host_underscore",
    ]) {
      const res = await request(
        server.port,
        "PATCH",
        "/matrix-admin/creds/server-name",
        { serverName: bad },
      );
      expect(res.status).toBe(400);
    }
  });

  it("409 when singleton row has not been ingested yet", async () => {
    setMatrixAdminServerNameMock.mockResolvedValue(false);
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/server-name",
      { serverName: "thenasty.taild9b663.ts.net" },
    );
    expect(res.status).toBe(409);
  });

  it("200 on successful patch — calls setMatrixAdminServerName with the value", async () => {
    setMatrixAdminServerNameMock.mockResolvedValue(true);
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/server-name",
      { serverName: "thenasty.taild9b663.ts.net" },
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      serverName: "thenasty.taild9b663.ts.net",
    });
    expect(setMatrixAdminServerNameMock).toHaveBeenCalledWith(
      "thenasty.taild9b663.ts.net",
    );
  });

  it("200 on null clear — calls setMatrixAdminServerName(null)", async () => {
    setMatrixAdminServerNameMock.mockResolvedValue(true);
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/server-name",
      { serverName: null },
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, serverName: null });
    expect(setMatrixAdminServerNameMock).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// 2026-09-11: PATCH /matrix-admin/creds/host-side-base — mirrors the
// server-name PATCH describe above; same admin-gate, 400/409/500 shape.
// ---------------------------------------------------------------------------

describe("PATCH /matrix-admin/creds/host-side-base", () => {
  let server: { port: number; close: () => Promise<void> };

  beforeEach(async () => {
    setMatrixAdminHostSideBaseMock.mockReset();
    mockIsAdmin = true;
    server = await startServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("401 when no auth token present", async () => {
    mockIsAdmin = null;
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/host-side-base",
      { hostSideBase: "http://100.99.149.8:8008" },
    );
    expect(res.status).toBe(401);
    expect(setMatrixAdminHostSideBaseMock).not.toHaveBeenCalled();
  });

  it("403 when caller is authenticated but not admin", async () => {
    mockIsAdmin = false;
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/host-side-base",
      { hostSideBase: "http://100.99.149.8:8008" },
    );
    expect(res.status).toBe(403);
    expect(setMatrixAdminHostSideBaseMock).not.toHaveBeenCalled();
  });

  it("400 when hostSideBase is neither string nor null", async () => {
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/host-side-base",
      { hostSideBase: 42 },
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/hostSideBase/);
    expect(setMatrixAdminHostSideBaseMock).not.toHaveBeenCalled();
  });

  it("400 when hostSideBase is an empty string", async () => {
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/host-side-base",
      { hostSideBase: "" },
    );
    expect(res.status).toBe(400);
    expect(setMatrixAdminHostSideBaseMock).not.toHaveBeenCalled();
  });

  it("400 when hostSideBase is not an http(s) URL", async () => {
    for (const bad of ["not-a-url", "ftp://x", "//no-scheme", "http:/onlyone"]) {
      const res = await request(
        server.port,
        "PATCH",
        "/matrix-admin/creds/host-side-base",
        { hostSideBase: bad },
      );
      expect(res.status).toBe(400);
    }
    expect(setMatrixAdminHostSideBaseMock).not.toHaveBeenCalled();
  });

  it("409 when singleton row has not been ingested yet", async () => {
    setMatrixAdminHostSideBaseMock.mockResolvedValue(false);
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/host-side-base",
      { hostSideBase: "http://100.99.149.8:8008" },
    );
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/POST \/matrix-admin\/creds/);
  });

  it("200 on successful patch (http URL) — calls setMatrixAdminHostSideBase with the value", async () => {
    setMatrixAdminHostSideBaseMock.mockResolvedValue(true);
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/host-side-base",
      { hostSideBase: "http://100.99.149.8:8008" },
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      hostSideBase: "http://100.99.149.8:8008",
    });
    expect(setMatrixAdminHostSideBaseMock).toHaveBeenCalledWith(
      "http://100.99.149.8:8008",
    );
  });

  it("200 on successful patch (https URL) — calls setMatrixAdminHostSideBase with the value", async () => {
    setMatrixAdminHostSideBaseMock.mockResolvedValue(true);
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/host-side-base",
      { hostSideBase: "https://matrix.example.com" },
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      hostSideBase: "https://matrix.example.com",
    });
    expect(setMatrixAdminHostSideBaseMock).toHaveBeenCalledWith(
      "https://matrix.example.com",
    );
  });

  it("200 on null clear — calls setMatrixAdminHostSideBase(null)", async () => {
    setMatrixAdminHostSideBaseMock.mockResolvedValue(true);
    const res = await request(
      server.port,
      "PATCH",
      "/matrix-admin/creds/host-side-base",
      { hostSideBase: null },
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, hostSideBase: null });
    expect(setMatrixAdminHostSideBaseMock).toHaveBeenCalledWith(null);
  });
});

// ---------------------------------------------------------------------------
// Phase 128-09 (D-18): the Phase 79 Plan 08 describe("POST /matrix-admin/
// migrate-cred-files") block is deleted alongside the corresponding handler
// in matrix-admin-routes.ts. The bridge is torn down; the one-shot migration
// endpoint has no reason to exist.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Relay-migration shape 6 — POST /matrix-admin/reset-registry-rooms tests
// ---------------------------------------------------------------------------

describe("POST /matrix-admin/reset-registry-rooms", () => {
  let server: { port: number; close: () => Promise<void> };

  beforeEach(async () => {
    dbPrepareRunMock.mockReset().mockReturnValue({ changes: 2 });
    saveMemoryDatabaseToFileMock.mockReset().mockResolvedValue(undefined);
    ensureRegistryRoomsExistMock.mockReset();
    mockIsAdmin = true;
    server = await startServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it("401 when no auth token present", async () => {
    mockIsAdmin = null;
    const res = await request(server.port, "POST", "/matrix-admin/reset-registry-rooms");
    expect(res.status).toBe(401);
    expect(dbPrepareRunMock).not.toHaveBeenCalled();
    expect(ensureRegistryRoomsExistMock).not.toHaveBeenCalled();
  });

  it("403 when caller is authenticated but not admin", async () => {
    mockIsAdmin = false;
    const res = await request(server.port, "POST", "/matrix-admin/reset-registry-rooms");
    expect(res.status).toBe(403);
    expect(dbPrepareRunMock).not.toHaveBeenCalled();
    expect(ensureRegistryRoomsExistMock).not.toHaveBeenCalled();
  });

  it("200 happy path — clears settings, forceSaves, calls ensureRegistryRoomsExist, returns new room IDs", async () => {
    ensureRegistryRoomsExistMock.mockResolvedValue({
      ok: true,
      agentsRoomId: "!newagents:t1000.taild9b663.ts.net",
      humansRoomId: "!newhumans:t1000.taild9b663.ts.net",
    });

    const res = await request(server.port, "POST", "/matrix-admin/reset-registry-rooms");
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.agentsRoomId).toBe("!newagents:t1000.taild9b663.ts.net");
    expect(parsed.humansRoomId).toBe("!newhumans:t1000.taild9b663.ts.net");

    // DELETE must be issued with both settings keys bound in order
    expect(dbPrepareRunMock).toHaveBeenCalledWith(
      "agents_registry_room_id",
      "humans_registry_room_id",
    );
    expect(saveMemoryDatabaseToFileMock).toHaveBeenCalledOnce();
    expect(ensureRegistryRoomsExistMock).toHaveBeenCalledOnce();
  });

  it("503 when ensureRegistryRoomsExist returns {ok: false} — includes reason", async () => {
    ensureRegistryRoomsExistMock.mockResolvedValue({
      ok: false,
      reason: "creds_missing",
    });

    const res = await request(server.port, "POST", "/matrix-admin/reset-registry-rooms");
    expect(res.status).toBe(503);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toBe("reset_registry_rooms_failed");
    expect(parsed.reason).toBe("creds_missing");

    // Settings clear + save still fired — the reset half of the operation
    // succeeded; only the ensure half failed.
    expect(dbPrepareRunMock).toHaveBeenCalledOnce();
    expect(saveMemoryDatabaseToFileMock).toHaveBeenCalledOnce();
  });

  it("500 when ensureRegistryRoomsExist throws — no room IDs leaked", async () => {
    ensureRegistryRoomsExistMock.mockRejectedValue(
      new Error("synapse_unreachable"),
    );

    const res = await request(server.port, "POST", "/matrix-admin/reset-registry-rooms");
    expect(res.status).toBe(500);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toMatch(/reset registry rooms/i);
    expect(parsed.agentsRoomId).toBeUndefined();
    expect(parsed.humansRoomId).toBeUndefined();
  });

  it("200 idempotent — two consecutive calls both clear + recreate", async () => {
    ensureRegistryRoomsExistMock.mockResolvedValue({
      ok: true,
      agentsRoomId: "!agents:t1000.taild9b663.ts.net",
      humansRoomId: "!humans:t1000.taild9b663.ts.net",
    });

    const res1 = await request(server.port, "POST", "/matrix-admin/reset-registry-rooms");
    const res2 = await request(server.port, "POST", "/matrix-admin/reset-registry-rooms");
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    expect(dbPrepareRunMock).toHaveBeenCalledTimes(2);
    expect(saveMemoryDatabaseToFileMock).toHaveBeenCalledTimes(2);
    expect(ensureRegistryRoomsExistMock).toHaveBeenCalledTimes(2);
  });
});
