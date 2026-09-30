/**
 * Phase 143 Plan 143-03 (D-05/D-07): Tests for GET /roles-archive?hostId=<n>.
 *
 * Tests exercise the route via a bare Express app + Node's built-in http
 * module (mirrors roles-list-for-host.test.ts pattern).
 *
 * Test coverage (4 tests):
 *   1: Unauthenticated → 401.
 *   2: Happy host-scoped — listArchivedRolesOnHost returns ["box-maintainer","researcher"] →
 *      200 with [{name:"box-maintainer"},{name:"researcher"}].
 *   3: Missing hostId → 400 with error matching /hostId is required|hostId must be a positive integer/.
 *   4: Cross-user hostId (resolveHostById → null) → 404.
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
// Auth manager mock
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

// Mute logger during tests.
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  sshLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock SSH primitives
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock isLocalHostId — test host is REMOTE by default
// ---------------------------------------------------------------------------

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn().mockReturnValue(false),
  APP_SLUG_RE: /^[a-z0-9-]{1,64}$/,
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
}));

// ---------------------------------------------------------------------------
// Mock the primitive under test
// ---------------------------------------------------------------------------

vi.mock("../../claude-session/list-archived-roles.js", () => ({
  listArchivedRolesOnHost: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { listArchivedRolesOnHost } from "../../claude-session/list-archived-roles.js";

// ---------------------------------------------------------------------------
// HTTP request helper
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers: opts.headers ?? {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
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
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stub SSH conn + host record
// ---------------------------------------------------------------------------

const stubConn = { end: vi.fn(), exec: vi.fn() };

const stubHost = {
  id: 7,
  ip: "10.0.0.7",
  port: 22,
  username: "ubuntu",
};

// ---------------------------------------------------------------------------
// Import router under test
// ---------------------------------------------------------------------------

import router from "./roles-archive-list.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "1";

  // Default: user owns host 7; anything else → null
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 7) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  (connectOneShot as Mock).mockResolvedValue(stubConn);
  (listArchivedRolesOnHost as Mock).mockResolvedValue([]);

  const app = express();
  app.use("/roles-archive", router);
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

describe("GET /roles-archive?hostId=<n>", () => {
  it("Test 1: unauthenticated → 401", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles-archive?hostId=7",
    });
    expect(res.status).toBe(401);
  });

  it("Test 2: happy host-scoped — returns [{name}] entries", async () => {
    (listArchivedRolesOnHost as Mock).mockResolvedValue([
      "box-maintainer",
      "researcher",
    ]);

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles-archive?hostId=7",
    });

    expect(res.status).toBe(200);
    const body = res.body as Array<{ name: string }>;
    expect(body).toEqual([{ name: "box-maintainer" }, { name: "researcher" }]);
  });

  it("Test 3: missing hostId → 400 with message matching /hostId/", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles-archive",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(
      /hostId is required|hostId must be a positive integer/,
    );
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 4: cross-user hostId (resolveHostById → null) → 404", async () => {
    // hostId=99999 is unknown to the mock (returns null by default)
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles-archive?hostId=99999",
    });
    expect(res.status).toBe(404);
    expect(connectOneShot).not.toHaveBeenCalled();
  });
});
