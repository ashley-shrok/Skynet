/**
 * Phase 80 Plan 04 — Tests for the pool-routes router (POST /pick).
 *
 * Tests exercise POST /identities/pool/pick via a bare Express app using
 * Node's built-in http module (project convention: no supertest — mirror
 * roles-list-for-host.test.ts pattern).
 *
 * Auth middleware is mocked. All backend collaborators (getMatrixAdminCreds,
 * resolveHostById, getVettedPool, countUsersMatching) are mocked so tests
 * exercise only the router logic.
 *
 * Test coverage (14 tests — mirror plan Task 1 <behavior>):
 *   1: missing JWT → 401
 *   2: missing hostId → 400
 *   3: non-integer hostId → 400
 *   4: missing role → 400
 *   5: role uppercase → 400
 *   6: role leading digit → 400 (ROLE_NAME_PATTERN leading-alpha gate)
 *   7: cross-user hostId → 404
 *   8: getMatrixAdminCreds() null → 503 matrix_admin_foundation_not_ingested
 *   9: empty pool → 503 "pool is empty"
 *  10: HAPPY PATH — regression guard for blocker 2:
 *      countUsersMatching MUST be called with the FULL base-handle MXID
 *      `@<PascalCandidate>-<PascalHyphenatedRole>:<server>` (NEVER the bare
 *      `@<candidate.toLowerCase()>:<server>` shape).
 *  11: all-busy fallback — returns first shuffled candidate (bare lowercase)
 *  12: countUsersMatching returns error → 502
 *  13: multi-segment role composes full PascalCase-hyphenated handle
 *  14: pool.json casing drift regression — lowercase pool entry still gets
 *      PascalCase-normalized in the check (defense-in-depth).
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock — controls whether a request is authenticated
// ---------------------------------------------------------------------------

let mockUserId: string | null = "1";

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
            return res.status(401).json({ error: "Unauthorized" });
          }
          (req as express.Request & { userId: string }).userId = mockUserId;
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Mock backend collaborators BEFORE importing the module under test
// ---------------------------------------------------------------------------

vi.mock("../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

vi.mock("./pool-loader.js", () => ({
  getVettedPool: vi.fn(),
}));

vi.mock("../matrix/matrix-admin-client.js", () => ({
  countUsersMatching: vi.fn(),
}));

vi.mock("../matrix/matrix-admin-creds-store.js", () => ({
  getMatrixAdminCreds: vi.fn(),
}));

// Silence logger noise in test output
vi.mock("../utils/logger.js", () => ({
  sshLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { resolveHostById } from "../ssh/host-resolver.js";
import { getVettedPool } from "./pool-loader.js";
import { countUsersMatching } from "../matrix/matrix-admin-client.js";
import { getMatrixAdminCreds } from "../matrix/matrix-admin-creds-store.js";

// ---------------------------------------------------------------------------
// HTTP request helper (mirrors roles-list-for-host.test.ts)
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr = opts.body === undefined ? "" : JSON.stringify(opts.body);
    const headers: Record<string, string> = {
      ...(opts.headers ?? {}),
    };
    if (bodyStr) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          let body: unknown;
          try {
            body = JSON.parse(data);
          } catch {
            body = data;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stub host + creds records
// ---------------------------------------------------------------------------

const stubHost = {
  id: 7,
  ip: "10.0.0.7",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

const stubCreds = {
  homeserverBase: "https://matrix.example.com",
  userId: "@admin:matrix.example.com",
  accessToken: "syt_test_token",
  password: "adminpw",
};

// ---------------------------------------------------------------------------
// Import the router under test (module does not exist yet → RED)
// ---------------------------------------------------------------------------

import router from "./pool-routes.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "1";

  // Default: user owns host 7, unknown otherwise.
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 7) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  (getMatrixAdminCreds as Mock).mockResolvedValue(stubCreds);
  (getVettedPool as Mock).mockReturnValue(["Willow", "Aster"]);
  (countUsersMatching as Mock).mockResolvedValue({ ok: true, total: 0 });

  const app = express();
  // Mount router at /identities/pool (mirrors database.ts mount).
  app.use("/identities/pool", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /identities/pool/pick", () => {
  it("Test 1: missing JWT → 401", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    expect(res.status).toBe(401);
    expect(countUsersMatching).not.toHaveBeenCalled();
    expect(getVettedPool).not.toHaveBeenCalled();
  });

  it("Test 2: missing hostId → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer" },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId/);
    expect(getVettedPool).not.toHaveBeenCalled();
  });

  it("Test 3: non-integer hostId → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: "abc" },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId/);
    expect(getVettedPool).not.toHaveBeenCalled();
  });

  it("Test 4: missing role → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { hostId: 7 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/role/);
    expect(getVettedPool).not.toHaveBeenCalled();
  });

  it("Test 5: role uppercase → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "Skynet-Maintainer", hostId: 7 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/role/);
    expect(getVettedPool).not.toHaveBeenCalled();
  });

  it("Test 6: role with leading digit → 400 (ROLE_NAME_PATTERN leading-alpha gate)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "2foo", hostId: 7 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/role/);
    expect(getVettedPool).not.toHaveBeenCalled();
  });

  it("Test 7: cross-user hostId → 404 (resolveHostById returns null)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 99999 },
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/Host/i);
    // Pool + admin API MUST NOT be touched on cross-user 404
    expect(getVettedPool).not.toHaveBeenCalled();
    expect(countUsersMatching).not.toHaveBeenCalled();
  });

  it("Test 8: getMatrixAdminCreds() null → 503 matrix_admin_foundation_not_ingested", async () => {
    (getMatrixAdminCreds as Mock).mockResolvedValueOnce(null);
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    expect(res.status).toBe(503);
    expect((res.body as { error: string }).error).toBe(
      "matrix_admin_foundation_not_ingested",
    );
    // No pool load / no admin API call on missing creds
    expect(getVettedPool).not.toHaveBeenCalled();
    expect(countUsersMatching).not.toHaveBeenCalled();
  });

  it("Test 9: empty pool → 503 'pool is empty'", async () => {
    (getVettedPool as Mock).mockReturnValueOnce([]);
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    expect(res.status).toBe(503);
    expect((res.body as { error: string }).error).toMatch(/pool is empty/);
    // Admin API MUST NOT be touched on empty pool
    expect(countUsersMatching).not.toHaveBeenCalled();
  });

  it("Test 10: HAPPY PATH — regression guard for blocker 2: countUsersMatching called with FULL base-handle MXID (never bare-lowercase)", async () => {
    // total===0 on first candidate → returns that name lowercased.
    (getVettedPool as Mock).mockReturnValueOnce(["Willow", "Aster"]);
    (countUsersMatching as Mock).mockResolvedValue({ ok: true, total: 0 });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });

    expect(res.status).toBe(200);
    const body = res.body as { name: string };
    // Response is bare lowercase pool name (matches IDENTITY_KEY_RE).
    expect(["willow", "aster"]).toContain(body.name);

    // REGRESSION GUARD: countUsersMatching call args MUST contain the full
    // PascalCase-hyphenated base handle, NEVER the bare-lowercase shape.
    const callArgs = (countUsersMatching as Mock).mock.calls;
    expect(callArgs.length).toBeGreaterThan(0);
    for (const [mxidArg] of callArgs) {
      // Positive: must contain the hyphenated PascalCase base-handle segment.
      expect(mxidArg as string).toMatch(
        /^@(Willow|Aster)-Skynet-Maintainer:matrix\.example\.com$/,
      );
      // Negative: must NOT be the bare-lowercase shape.
      expect(mxidArg as string).not.toMatch(
        /^@(willow|aster):matrix\.example\.com$/,
      );
    }
  });

  it("Test 11: all-busy fallback returns first pool name lowercased", async () => {
    (getVettedPool as Mock).mockReturnValueOnce(["Willow", "Aster"]);
    // Every candidate reports total>0 → picker exhausts shuffle and falls
    // back to the first shuffled candidate lowercased.
    (countUsersMatching as Mock).mockResolvedValue({ ok: true, total: 3 });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    expect(res.status).toBe(200);
    const body = res.body as { name: string };
    // Fallback name is one of the pool names (bare lowercase).
    expect(["willow", "aster"]).toContain(body.name);
    // Every candidate was probed (shuffle length === 2).
    expect((countUsersMatching as Mock).mock.calls.length).toBe(2);
  });

  it("Test 12: countUsersMatching returns error → 502", async () => {
    (countUsersMatching as Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: "admin_api_proxy_error",
    });
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toMatch(/admin API/i);
    // MUST NOT leak the pool state — response error string is generic.
    expect(JSON.stringify(res.body)).not.toContain("Willow");
    expect(JSON.stringify(res.body)).not.toContain("Aster");
  });

  it("Test 13: multi-segment role composes full PascalCase-hyphenated base handle", async () => {
    (getVettedPool as Mock).mockReturnValueOnce(["Willow"]);
    (countUsersMatching as Mock).mockResolvedValue({ ok: true, total: 0 });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "foo-bar-baz", hostId: 7 },
    });
    expect(res.status).toBe(200);
    expect((res.body as { name: string }).name).toBe("willow");

    // Exact call args: `@Willow-Foo-Bar-Baz:matrix.example.com`
    expect(countUsersMatching).toHaveBeenCalledWith(
      "@Willow-Foo-Bar-Baz:matrix.example.com",
    );
  });

  it("Test 14: pool.json casing drift — lowercase pool entry gets PascalCase-normalized (defense-in-depth)", async () => {
    // Pool entry is lowercase in JSON (drift from PascalCase seed convention).
    (getVettedPool as Mock).mockReturnValueOnce(["willow"]);
    (countUsersMatching as Mock).mockResolvedValue({ ok: true, total: 0 });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/pool/pick",
      body: { role: "skynet-maintainer", hostId: 7 },
    });
    expect(res.status).toBe(200);
    expect((res.body as { name: string }).name).toBe("willow");

    // Even though the pool entry is lowercase, the MXID check MUST use the
    // PascalCase-normalized base handle.
    expect(countUsersMatching).toHaveBeenCalledWith(
      "@Willow-Skynet-Maintainer:matrix.example.com",
    );
  });
});
