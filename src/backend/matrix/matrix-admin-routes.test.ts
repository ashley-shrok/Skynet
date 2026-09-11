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

const { setMatrixAdminCredsMock, getMatrixAdminCredsMock, setMatrixAdminServerNameMock } = vi.hoisted(() => ({
  setMatrixAdminCredsMock: vi.fn(),
  getMatrixAdminCredsMock: vi.fn(),
  setMatrixAdminServerNameMock: vi.fn(),
}));

vi.mock("./matrix-admin-creds-store.js", () => ({
  setMatrixAdminCreds: setMatrixAdminCredsMock,
  getMatrixAdminCreds: getMatrixAdminCredsMock,
  setMatrixAdminServerName: setMatrixAdminServerNameMock,
}));

const { saveMemoryDatabaseToFileMock, dbSelectMock } = vi.hoisted(() => ({
  saveMemoryDatabaseToFileMock: vi.fn(),
  // Phase 79 Plan 08 — POST /migrate-cred-files iterates the users table
  // via db.select({name, mxid}).from(users). The route dynamic-imports
  // both db/index.js and db/schema.js at handler time (avoids a
  // circular-module problem at boot), so we mock both here and let the
  // per-test setup swap mockUserRows.
  dbSelectMock: vi.fn(),
}));

vi.mock("../database/db/index.js", () => ({
  saveMemoryDatabaseToFile: saveMemoryDatabaseToFileMock,
  db: {
    select: () => ({
      from: () => Promise.resolve(dbSelectMock()),
    }),
  },
}));

// The users symbol is only used as a column reference — return a bare
// object; the db.select mock ignores it entirely.
vi.mock("../database/db/schema.js", () => ({
  users: { username: "username", mxid: "mxid" },
}));

// Phase 79 Plan 08 — migrate-cred-files calls mintAndWriteHumanToken for
// each user with an mxid. Mock it here so tests can control per-call
// success/failure.
const { mintAndWriteHumanTokenMock } = vi.hoisted(() => ({
  mintAndWriteHumanTokenMock: vi.fn(),
}));

vi.mock("../telegram/human-token-writer.js", () => ({
  mintAndWriteHumanToken: mintAndWriteHumanTokenMock,
}));

// Phase 79 Plan 08 — shared-volume.ts computes TG_BRIDGE_STATE_DIR as a
// const at module-load time from TG_BRIDGE_STATE_DIR_OVERRIDE. Because
// matrix-admin-routes.js is imported at file scope (below), the const
// is frozen before the per-test tempDir is set. Mock the export directly
// with a getter that always reads the current env var.
vi.mock("../telegram/shared-volume.js", () => ({
  get TG_BRIDGE_STATE_DIR() {
    return process.env.TG_BRIDGE_STATE_DIR_OVERRIDE || "/state";
  },
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
      serverName: "thenasty.taild9b663.ts.net",
    });
    const res = await request(server.port, "GET", "/matrix-admin/creds");
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed).toEqual({
      present: true,
      mxid: "@skynet-admin:thenasty.taild9b663.ts.net",
      homeserverBase: "http://100.113.23.63:8008",
      serverName: "thenasty.taild9b663.ts.net",
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
    });
    const res = await request(server.port, "GET", "/matrix-admin/creds");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).serverName).toBeNull();
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

// Vitest wants at least one afterEach import — keep the linter happy
import { afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Phase 79 Plan 08 — POST /matrix-admin/migrate-cred-files tests
// ---------------------------------------------------------------------------

describe("POST /matrix-admin/migrate-cred-files", () => {
  let server: { port: number; close: () => Promise<void> };
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-bridge-migrate-"));
    process.env.TG_BRIDGE_STATE_DIR_OVERRIDE = tempDir;
    mintAndWriteHumanTokenMock.mockReset();
    dbSelectMock.mockReset().mockReturnValue([]);
    mockIsAdmin = true;
    server = await startServer();
  });

  afterEach(async () => {
    delete process.env.TG_BRIDGE_STATE_DIR_OVERRIDE;
    await server.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("401 when no auth token present", async () => {
    mockIsAdmin = null;
    const res = await request(server.port, "POST", "/matrix-admin/migrate-cred-files", {});
    expect(res.status).toBe(401);
    expect(mintAndWriteHumanTokenMock).not.toHaveBeenCalled();
  });

  it("403 when caller is authenticated but not admin", async () => {
    mockIsAdmin = false;
    const res = await request(server.port, "POST", "/matrix-admin/migrate-cred-files", {});
    expect(res.status).toBe(403);
    expect(mintAndWriteHumanTokenMock).not.toHaveBeenCalled();
  });

  it("200 — mints for humans-with-mxid, reports skipped-no-mxid for Laura-like row", async () => {
    dbSelectMock.mockReturnValue([
      { name: "alice", mxid: "@ashley:thenasty.taild9b663.ts.net" },
      { name: "laura", mxid: null },
    ]);
    mintAndWriteHumanTokenMock.mockResolvedValue({ ok: true });

    const res = await request(server.port, "POST", "/matrix-admin/migrate-cred-files", {});
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toHaveLength(2);

    const alice = parsed.results.find(
      (r: { humanName: string }) => r.humanName === "alice",
    );
    const laura = parsed.results.find(
      (r: { humanName: string }) => r.humanName === "laura",
    );

    expect(alice.status).toBe("minted");
    expect(alice.mxid).toBe("@ashley:thenasty.taild9b663.ts.net");
    expect(laura.status).toBe("skipped-no-mxid");
    expect(laura.mxid).toBeNull();

    expect(mintAndWriteHumanTokenMock).toHaveBeenCalledWith(
      "@ashley:thenasty.taild9b663.ts.net",
      "alice",
    );
    expect(mintAndWriteHumanTokenMock).toHaveBeenCalledTimes(1);
  });

  it("200 — reports status:failed when mintAndWriteHumanToken rejects for one user; other users continue", async () => {
    dbSelectMock.mockReturnValue([
      { name: "alice", mxid: "@ashley:thenasty.taild9b663.ts.net" },
      { name: "zoey", mxid: "@zoey:thenasty.taild9b663.ts.net" },
    ]);
    mintAndWriteHumanTokenMock.mockImplementation(
      async (_mxid: string, humanName: string) => {
        if (humanName === "alice") {
          return { ok: false, error: "synapse_500" };
        }
        return { ok: true };
      },
    );

    const res = await request(server.port, "POST", "/matrix-admin/migrate-cred-files", {});
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.results).toHaveLength(2);

    const alice = parsed.results.find(
      (r: { humanName: string }) => r.humanName === "alice",
    );
    const zoey = parsed.results.find(
      (r: { humanName: string }) => r.humanName === "zoey",
    );

    expect(alice.status).toBe("failed");
    expect(alice.error).toBe("synapse_500");
    expect(zoey.status).toBe("minted");
  });

  it("200 — deletes stale .cred files under TG_BRIDGE_STATE_DIR and reports them", async () => {
    dbSelectMock.mockReturnValue([
      { name: "alice", mxid: "@ashley:thenasty.taild9b663.ts.net" },
    ]);
    mintAndWriteHumanTokenMock.mockResolvedValue({ ok: true });

    // Materialize legacy .cred files.
    fs.writeFileSync(path.join(tempDir, "alice.cred"), "plaintext-legacy-1");
    fs.writeFileSync(path.join(tempDir, "zoey.cred"), "plaintext-legacy-2");
    // Non-.cred file to prove the filter is scoped.
    fs.writeFileSync(path.join(tempDir, "registry.json"), "{}");

    const res = await request(server.port, "POST", "/matrix-admin/migrate-cred-files", {});
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);

    expect(parsed.deletedCredFiles).toEqual(
      expect.arrayContaining(["alice.cred", "zoey.cred"]),
    );
    expect(parsed.deletedCredFiles).toHaveLength(2);

    // Post-condition: .cred files are gone; registry.json survives.
    expect(fs.existsSync(path.join(tempDir, "alice.cred"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "zoey.cred"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "registry.json"))).toBe(true);
  });

  it("200 — idempotent: two consecutive calls both succeed with same response shape", async () => {
    dbSelectMock.mockReturnValue([
      { name: "alice", mxid: "@ashley:thenasty.taild9b663.ts.net" },
    ]);
    mintAndWriteHumanTokenMock.mockResolvedValue({ ok: true });

    const res1 = await request(server.port, "POST", "/matrix-admin/migrate-cred-files", {});
    const res2 = await request(server.port, "POST", "/matrix-admin/migrate-cred-files", {});

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const p1 = JSON.parse(res1.body);
    const p2 = JSON.parse(res2.body);

    // Same shape both times — second call is NOT a no-op, it re-mints.
    expect(p1.ok).toBe(true);
    expect(p2.ok).toBe(true);
    expect(p1.results).toHaveLength(1);
    expect(p2.results).toHaveLength(1);
    expect(p1.results[0].status).toBe("minted");
    expect(p2.results[0].status).toBe("minted");
    expect(mintAndWriteHumanTokenMock).toHaveBeenCalledTimes(2);
  });

  it("200 — empty users table returns ok:true with results: []", async () => {
    dbSelectMock.mockReturnValue([]);

    const res = await request(server.port, "POST", "/matrix-admin/migrate-cred-files", {});
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.results).toEqual([]);
    expect(parsed.deletedCredFiles).toEqual([]);
    expect(mintAndWriteHumanTokenMock).not.toHaveBeenCalled();
  });
});
