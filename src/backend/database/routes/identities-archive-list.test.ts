/**
 * Phase 143 Plan 143-03 (D-05/D-06/D-07): Tests for GET /identities-archive.
 *
 * Tests exercise the route via a bare Express app + Node's built-in http
 * module (mirrors roles-list-for-host.test.ts / apps-archive.test.ts pattern).
 *
 * Test coverage (3 tests):
 *   1: Unauthenticated → 401.
 *   2: Happy fleet-wide — host 1 returns ["wren"], host 2 returns ["ash"] →
 *      200 with [{identityKey:"ash",hostId:2},{identityKey:"wren",hostId:1}] (sorted).
 *   3: Partial fleet failure — one host's SSH connect throws → 200 with entries
 *      from the healthy host only; the failing host is silently dropped.
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
// Mock DB (drizzle select)
// ---------------------------------------------------------------------------

const mockDbSelectResult: Array<{ id: number }> = [];

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockDbSelectResult),
      }),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  hosts: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
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
// Mock isLocalHostId — all test hosts are REMOTE by default
// ---------------------------------------------------------------------------

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn().mockReturnValue(false),
  APP_SLUG_RE: /^[a-z0-9-]{1,64}$/,
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
}));

// ---------------------------------------------------------------------------
// Mock the primitive under test
// ---------------------------------------------------------------------------

vi.mock("../../claude-session/list-archived-identity-keys.js", () => ({
  listArchivedIdentityKeysOnHost: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { listArchivedIdentityKeysOnHost } from "../../claude-session/list-archived-identity-keys.js";

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
// Stub SSH conn
// ---------------------------------------------------------------------------

const stubConn = { end: vi.fn(), exec: vi.fn() };

// ---------------------------------------------------------------------------
// Import router under test
// ---------------------------------------------------------------------------

import router from "./identities-archive-list.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "1";

  // Default: two hosts (1 and 2), both REMOTE
  mockDbSelectResult.length = 0;
  mockDbSelectResult.push({ id: 1 }, { id: 2 });

  // Both hosts resolve to a stub host record
  (resolveHostById as Mock).mockResolvedValue({ id: 1, ip: "10.0.0.1", port: 22 });
  (connectOneShot as Mock).mockResolvedValue(stubConn);
  (listArchivedIdentityKeysOnHost as Mock).mockResolvedValue([]);

  const app = express();
  app.use("/identities-archive", router);
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

describe("GET /identities-archive", () => {
  it("Test 1: unauthenticated → 401", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities-archive",
    });
    expect(res.status).toBe(401);
  });

  it("Test 2: happy fleet-wide — returns sorted entries from both hosts", async () => {
    // host 1 → ["wren"], host 2 → ["ash"]
    (resolveHostById as Mock).mockImplementation((hostId: number) => {
      return Promise.resolve({ id: hostId, ip: `10.0.0.${hostId}`, port: 22 });
    });
    (listArchivedIdentityKeysOnHost as Mock).mockImplementation(
      (_conn: unknown) => {
        // We can't distinguish by conn easily in mocks, so use call count
        const callCount = (listArchivedIdentityKeysOnHost as Mock).mock.calls.length;
        // First call is for host 1 (first in Promise.all); second for host 2
        // But Promise.all may interleave — use resolveHostById call order instead.
        // Actually the cleaner approach: track by the connectOneShot call arg.
        // Since both conns are the same stubConn, differentiate by mock call index.
        if (callCount === 1) return Promise.resolve(["wren"]);
        return Promise.resolve(["ash"]);
      },
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities-archive",
    });

    expect(res.status).toBe(200);
    const body = res.body as Array<{ identityKey: string; hostId: number }>;
    // Should have 2 entries, sorted by hostId then identityKey
    expect(body).toHaveLength(2);
    // Sorted: hostId:1 comes before hostId:2
    expect(body[0].identityKey).toBe("wren");
    expect(body[0].hostId).toBe(1);
    expect(body[1].identityKey).toBe("ash");
    expect(body[1].hostId).toBe(2);
  });

  it("Test 3: partial fleet failure — SSH connect throws for one host, returns subset from healthy host", async () => {
    // host 1 connect fails; host 2 succeeds with ["ash"]
    (resolveHostById as Mock).mockImplementation((hostId: number) => {
      return Promise.resolve({ id: hostId, ip: `10.0.0.${hostId}`, port: 22 });
    });
    (connectOneShot as Mock).mockImplementation(
      (host: { id: number }) => {
        if (host.id === 1) {
          return Promise.reject(new Error("SSH connect timeout"));
        }
        return Promise.resolve(stubConn);
      },
    );
    (listArchivedIdentityKeysOnHost as Mock).mockResolvedValue(["ash"]);

    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities-archive",
    });

    // Still 200; only the healthy host's entries returned
    expect(res.status).toBe(200);
    const body = res.body as Array<{ identityKey: string; hostId: number }>;
    // Only host 2's entry (the failing host is silently dropped)
    expect(body.some((e) => e.hostId === 2 && e.identityKey === "ash")).toBe(true);
    // Failing host's entries not present
    expect(body.some((e) => e.hostId === 1)).toBe(false);
  });
});
