/**
 * Phase 133 Plan 133-01: Tests for the role-archive route.
 *
 * Tests exercise POST /roles/:name/archive via a bare Express app using
 * Node's built-in http module (mirrors identity-archive.test.ts pattern).
 *
 * Auth middleware is mocked. writeRoleFile, resolveHostById, connectOneShot,
 * and isLocalHostId are mocked so tests can exercise every branch without
 * touching real disk or SSH.
 *
 * Test coverage (9 tests per plan behavior block):
 *   1: Happy LOCAL — writeRoleFile called with correct args, 200 { ok: true }
 *   2: Happy REMOTE — connectOneShot + writeRoleFile with conn, conn.end() called
 *   3: Invalid role name (uppercase / underscore / traversal) → 400, no write
 *   4: Missing hostId → 400, no write
 *   5: Malformed hostId (string / negative / float) → 400, no write
 *   6: hostId not owned (resolveHostById → null) → 404, no write
 *   7: REMOTE connectOneShot throws → 504, no write
 *   8: writeRoleFile throws → 500 generic message; conn.end() still called
 *   9: Unauthenticated (no JWT) → 401, no downstream calls
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
// Auth manager mock — matches identity-archive.test.ts pattern
// ---------------------------------------------------------------------------

let mockUserId: string | null = "1";

vi.mock("../../utils/auth-manager.js", () => {
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

// Mute logger during tests (avoid noisy stderr on the T-133-01-03 500 path).
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock SSH primitives + writeRoleFile BEFORE importing the module under test
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn(),
}));

vi.mock("../../claude-session/per-role-file.js", () => ({
  writeRoleFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { writeRoleFile } from "../../claude-session/per-role-file.js";
import { databaseLogger } from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// HTTP request helper
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr =
      opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    const headers: Record<string, string> = {
      ...(opts.headers ?? {}),
    };
    if (bodyStr !== undefined) {
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
    if (bodyStr !== undefined) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stubs — SSH connection object + host record
// ---------------------------------------------------------------------------

const stubConn = {
  end: vi.fn(),
  exec: vi.fn(),
};

const stubHost = {
  id: 5,
  ip: "10.0.0.5",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// ---------------------------------------------------------------------------
// Import the router under test — AFTER all vi.mock() calls
// ---------------------------------------------------------------------------

import router from "./role-archive.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();

  // Default: user owns host 5 (local) and host 7 (remote); host 99 not owned
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 5 || hostId === 7) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  // Default: hostId 5 is local, hostId 7 is remote
  (isLocalHostId as Mock).mockImplementation((hostId: number) => hostId === 5);

  // Default: SSH connect resolves to stubConn
  (connectOneShot as Mock).mockResolvedValue(stubConn);

  // Default: writeRoleFile succeeds
  (writeRoleFile as Mock).mockResolvedValue(undefined);

  // Rebuild app per test
  const app = express();
  app.use(express.json());
  app.use("/roles", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  mockUserId = "1";
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /roles/:name/archive", () => {
  // -------------------------------------------------------------------------
  // Test 1: happy LOCAL
  // -------------------------------------------------------------------------

  it("Test 1: happy LOCAL → 200 { ok: true }; writeRoleFile called with local conn=null; audit log fired", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/box-maintainer/archive",
      body: { hostId: 5 },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(writeRoleFile).toHaveBeenCalledTimes(1);
    expect(writeRoleFile).toHaveBeenCalledWith(
      "box-maintainer",
      ".archive-requested",
      "",
      { hostId: 5, conn: null },
    );
    // LOCAL branch must not open an SSH connection
    expect(connectOneShot).not.toHaveBeenCalled();

    // Audit log (T-133-01-05) — mirrors T-115-03-05 shape
    const infoMock = databaseLogger.info as unknown as Mock;
    expect(infoMock).toHaveBeenCalled();
    const infoMsg = infoMock.mock.calls[0][0] as string;
    expect(infoMsg).toMatch(/role archive requested/);
    expect(infoMsg).toMatch(/userId=/);
    expect(infoMsg).toMatch(/hostId=/);
    expect(infoMsg).toMatch(/name=box-maintainer/);
  });

  // -------------------------------------------------------------------------
  // Test 2: happy REMOTE
  // -------------------------------------------------------------------------

  it("Test 2: happy REMOTE → 200; conn passed to writeRoleFile + conn.end() called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/box-maintainer/archive",
      body: { hostId: 7 },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(connectOneShot).toHaveBeenCalledTimes(1);
    expect(writeRoleFile).toHaveBeenCalledTimes(1);
    expect(writeRoleFile).toHaveBeenCalledWith(
      "box-maintainer",
      ".archive-requested",
      "",
      { hostId: 7, conn: stubConn },
    );
    // Finally block must close the SSH connection
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Test 3: invalid role name → 400
  // -------------------------------------------------------------------------

  it("Test 3a: invalid role name (underscore) → 400; writeRoleFile NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/bad_name/archive",
      body: { hostId: 5 },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(
      /role name|\[a-z0-9-\]/,
    );
    expect(writeRoleFile).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 3b: invalid role name (uppercase) → 400; writeRoleFile NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/BadName/archive",
      body: { hostId: 5 },
    });

    expect(res.status).toBe(400);
    expect(writeRoleFile).not.toHaveBeenCalled();
  });

  it("Test 3c: invalid role name (traversal '..') → 400; writeRoleFile NOT called", async () => {
    // Express normalizes /roles/../etc/passwd/archive at the URL layer;
    // to actually get `..` into the :name param we exercise a name that
    // contains dots which will fail the ROLE_NAME_PATTERN gate.
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/..etcpasswd/archive",
      body: { hostId: 5 },
    });

    expect(res.status).toBe(400);
    expect(writeRoleFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 4: missing hostId → 400
  // -------------------------------------------------------------------------

  it("Test 4: missing hostId (body: {}) → 400; writeRoleFile NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/box-maintainer/archive",
      body: {},
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId is required/);
    expect(writeRoleFile).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 5: malformed hostId → 400
  // -------------------------------------------------------------------------

  it("Test 5a: hostId 'not-a-number' → 400 'hostId must be a positive integer'", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/box-maintainer/archive",
      body: { hostId: "not-a-number" },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(
      /positive integer/,
    );
    expect(writeRoleFile).not.toHaveBeenCalled();
  });

  it("Test 5b: hostId -1 → 400 'positive integer'", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/box-maintainer/archive",
      body: { hostId: -1 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/positive integer/);
    expect(writeRoleFile).not.toHaveBeenCalled();
  });

  it("Test 5c: hostId 3.14 → 400 'positive integer'", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/box-maintainer/archive",
      body: { hostId: 3.14 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/positive integer/);
    expect(writeRoleFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 6: hostId not owned → 404 (NOT 403; no probe leak)
  // -------------------------------------------------------------------------

  it("Test 6: cross-user / unknown hostId → 404 'Host not found'; writeRoleFile NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/box-maintainer/archive",
      body: { hostId: 99 },
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/Host not found/);
    // T-133-01-01: no probe info leak — MUST NOT be 403
    expect(res.status).not.toBe(403);
    expect(writeRoleFile).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 7: REMOTE host unreachable → 504
  // -------------------------------------------------------------------------

  it("Test 7: REMOTE connectOneShot throws → 504 'Host unreachable'; writeRoleFile NOT called", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 3000ms"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/box-maintainer/archive",
      body: { hostId: 7 },
    });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: "Host unreachable" });
    expect(writeRoleFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 8: writeRoleFile throws → 500 generic; conn.end() still called
  // -------------------------------------------------------------------------

  it("Test 8: writeRoleFile throws → 500 generic message; conn.end() still called (REMOTE); server-side error logged", async () => {
    (writeRoleFile as Mock).mockRejectedValue(
      new Error("ENOSPC: no space left on device — sensitive fs path leak"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/box-maintainer/archive",
      body: { hostId: 7 },
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "failed to drop archive sentinel" });
    // T-133-01-03: underlying error text MUST NOT reach the client
    expect(JSON.stringify(res.body)).not.toContain("ENOSPC");
    expect(JSON.stringify(res.body)).not.toContain("sensitive fs path leak");
    // finally { conn.end() } must still fire on write throw
    expect(stubConn.end).toHaveBeenCalledTimes(1);

    // Server-side error log MUST capture the underlying error text
    const errorMock = databaseLogger.error as unknown as Mock;
    expect(errorMock).toHaveBeenCalled();
    const errMsg = errorMock.mock.calls[0][0] as string;
    expect(errMsg).toMatch(/ENOSPC/);
  });

  // -------------------------------------------------------------------------
  // Test 9: unauthenticated → 401; no downstream calls
  // -------------------------------------------------------------------------

  it("Test 9: 401 without JWT; writeRoleFile NOT called; no downstream calls", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/box-maintainer/archive",
      body: { hostId: 5 },
    });

    expect(res.status).toBe(401);
    expect(writeRoleFile).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });
});
