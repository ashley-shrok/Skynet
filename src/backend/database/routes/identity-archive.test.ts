/**
 * Phase 115 Plan 115-03: Tests for the identity-archive route.
 *
 * Tests exercise POST /identities/:key/archive via a bare Express app using
 * Node's built-in http module (mirrors identity-no-dormancy.test.ts pattern,
 * which mirrors identity-exists-on-host.test.ts).
 *
 * Auth middleware is mocked. writeIdentityFile, resolveHostById, connectOneShot,
 * and isLocalHostId are mocked so tests can exercise every branch without
 * touching real disk or SSH.
 *
 * Test coverage (8 tests per plan behavior block):
 *   1: Happy LOCAL — writeIdentityFile called with correct args, 200 { ok: true }
 *   2: Happy REMOTE — connectOneShot + writeIdentityFile with conn, conn.end() called, 200
 *   3: Invalid identityKey → 400, writeIdentityFile NOT called
 *   4: Missing hostId → 400, writeIdentityFile NOT called
 *   5: hostId not owned (resolveHostById → null) → 404, writeIdentityFile NOT called
 *   6: REMOTE host unreachable (connectOneShot throws) → 504, writeIdentityFile NOT called
 *   7: writeIdentityFile throws → 500 generic message, conn.end() still called (REMOTE)
 *   8: Unauthenticated (no JWT) → 401, writeIdentityFile NOT called
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
// Auth manager mock — matches identity-no-dormancy.test.ts pattern
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

// Mute logger during tests (avoid noisy stderr on the T-115-03-03 500 path).
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock SSH primitives + writeIdentityFile BEFORE importing the module under test
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  stringifyColorHueForYaml: (obj: Record<string, unknown>) => (typeof obj.colorHue === "number" ? { ...obj, colorHue: String(obj.colorHue) } : obj),
  isLocalHostId: vi.fn(),
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
}));

vi.mock("../../claude-session/per-identity-file.js", () => ({
  writeIdentityFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { writeIdentityFile } from "../../claude-session/per-identity-file.js";

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

import router from "./identity-archive.js";

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

  // Default: writeIdentityFile succeeds
  (writeIdentityFile as Mock).mockResolvedValue(undefined);

  // Rebuild app per test
  const app = express();
  app.use(express.json());
  app.use("/identities", router);

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

describe("POST /identities/:key/archive", () => {
  // -------------------------------------------------------------------------
  // Test 1: happy LOCAL — 200 { ok: true }; writeIdentityFile called with
  //         (key, ".archive-requested", "", { hostId, conn: null })
  // -------------------------------------------------------------------------

  it("Test 1: happy LOCAL → 200 { ok: true }; writeIdentityFile called with local conn=null", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/archive",
      body: { hostId: 5 },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(writeIdentityFile).toHaveBeenCalledTimes(1);
    expect(writeIdentityFile).toHaveBeenCalledWith(
      "wren",
      ".archive-requested",
      "",
      { hostId: 5, conn: null },
    );
    // LOCAL branch must not open an SSH connection
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 2: happy REMOTE — 200 { ok: true }; connectOneShot opened, conn
  //         passed to writeIdentityFile, conn.end() called afterwards
  // -------------------------------------------------------------------------

  it("Test 2: happy REMOTE → 200; conn passed to writeIdentityFile + conn.end() called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/archive",
      body: { hostId: 7 },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(connectOneShot).toHaveBeenCalledTimes(1);
    expect(writeIdentityFile).toHaveBeenCalledTimes(1);
    expect(writeIdentityFile).toHaveBeenCalledWith(
      "wren",
      ".archive-requested",
      "",
      { hostId: 7, conn: stubConn },
    );
    // Finally block must close the SSH connection
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Test 3: invalid identityKey → 400; writeIdentityFile NOT called
  // -------------------------------------------------------------------------

  it("Test 3: invalid identityKey (contains dot) → 400; writeIdentityFile NOT called", async () => {
    // "bad.key" fails IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/ (dot not allowed)
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/bad.key/archive",
      body: { hostId: 5 },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(
      /identity key must match/,
    );
    expect(writeIdentityFile).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 4: missing hostId → 400; writeIdentityFile NOT called
  // -------------------------------------------------------------------------

  it("Test 4: missing hostId (body: {}) → 400; writeIdentityFile NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/archive",
      body: {},
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId is required/);
    expect(writeIdentityFile).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 5: hostId not owned by caller → 404; writeIdentityFile NOT called
  // -------------------------------------------------------------------------

  it("Test 5: cross-user / unknown hostId → 404; writeIdentityFile NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/archive",
      body: { hostId: 99 },
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/Host not found/);
    expect(writeIdentityFile).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 6: REMOTE host unreachable (connectOneShot throws) → 504; no
  //         writeIdentityFile call
  // -------------------------------------------------------------------------

  it("Test 6: REMOTE connectOneShot throws → 504 { error: 'Host unreachable' }; writeIdentityFile NOT called", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 3000ms"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/archive",
      body: { hostId: 7 },
    });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: "Host unreachable" });
    expect(writeIdentityFile).not.toHaveBeenCalled();
    // No conn was ever created, so no end() to check
  });

  // -------------------------------------------------------------------------
  // Test 7: writeIdentityFile throws → 500 generic message; conn.end() still
  //         called via finally (REMOTE branch)
  // -------------------------------------------------------------------------

  it("Test 7: writeIdentityFile throws → 500 generic; conn.end() still called (REMOTE)", async () => {
    (writeIdentityFile as Mock).mockRejectedValue(
      new Error("ENOSPC: no space left on device — sensitive fs path leak"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/archive",
      body: { hostId: 7 },
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "failed to drop archive sentinel" });
    // T-115-03-03: the underlying error text must NOT reach the client
    expect(JSON.stringify(res.body)).not.toContain("ENOSPC");
    expect(JSON.stringify(res.body)).not.toContain("sensitive fs path leak");
    // finally { conn.end() } must still fire even on writeIdentityFile throw
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Test 8: unauthenticated (JWT missing) → 401; writeIdentityFile NOT called;
  //         no downstream calls (resolveHostById, connectOneShot untouched).
  // -------------------------------------------------------------------------

  it("Test 8: 401 without JWT; writeIdentityFile NOT called; no downstream calls", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/identities/wren/archive",
      body: { hostId: 5 },
    });

    expect(res.status).toBe(401);
    expect(writeIdentityFile).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });
});
