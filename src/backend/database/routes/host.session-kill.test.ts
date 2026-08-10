/**
 * quick-260810-n3a — Task 1 tests
 *
 * Tests for POST /host/:hostId/session/kill — the SSH-backed tmux kill-session
 * backend route added to src/backend/database/routes/host.ts.
 *
 * Behavior spec (9 cases):
 *   1: happy path → 204; execCommand called with "tmux kill-session -t claude-abc"
 *   2: execCommand throws "can't find session" → 204 (idempotent — already gone)
 *   3: malicious tmuxSession ("foo; rm -rf /") → 400, connectOneShot NOT called
 *   4: empty tmuxSession → 400
 *   5: missing tmuxSession → 400
 *   6: non-numeric hostId → 400
 *   7: resolveHostById → null → 404
 *   8: connectOneShot rejects (SSH unreachable) → 500 { error: <message> }
 *   9: unauthenticated request → 401
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock — controls authentication per-test via mockUserId
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
      createDataAccessMiddleware: () =>
        (_req: express.Request, _res: express.Response, next: express.NextFunction) => {
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Mock SSH primitives BEFORE importing the module under test
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the db layer (host.ts imports from db/index + schema + drizzle-orm)
// ---------------------------------------------------------------------------

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
    returning: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../db/schema.js", () => ({
  hosts: {},
  sshCredentials: {},
  sshCredentialUsage: {},
  fileManagerRecent: {},
  fileManagerPinned: {},
  fileManagerShortcuts: {},
  transferRecent: {},
  commandHistory: {},
  recentActivity: {},
  hostAccess: {},
  userRoles: {},
  sessionRecordings: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  isNull: vi.fn(),
  gte: vi.fn(),
  sql: vi.fn(),
  inArray: vi.fn(),
  desc: vi.fn(),
}));

// Mock SimpleDBOps and other utils that host.ts imports
vi.mock("../../utils/simple-db-ops.js", () => ({
  SimpleDBOps: {
    select: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    getInstance: () => ({
      decrypt: vi.fn((v: string) => v),
      encrypt: vi.fn((v: string) => v),
    }),
  },
}));

vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      createDataAccessMiddleware: () =>
        (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
          next(),
    }),
  },
}));

vi.mock("../../utils/ssh-key-utils.js", () => ({
  parseSSHKey: vi.fn(),
}));

vi.mock("./host-normalizers.js", () => ({
  isNonEmptyString: (v: unknown) => typeof v === "string" && v.length > 0,
  isValidPort: (v: unknown) => typeof v === "number" && v > 0 && v <= 65535,
  stripSensitiveFields: (v: unknown) => v,
  transformHostResponse: (v: unknown) => v,
}));

vi.mock("./host-opkssh-routes.js", () => ({
  registerHostOpksshRoutes: vi.fn(),
}));

vi.mock("./host-folder-routes.js", () => ({
  registerHostFolderRoutes: vi.fn(),
}));

vi.mock("./host-file-manager-bookmark-routes.js", () => ({
  registerHostFileManagerBookmarkRoutes: vi.fn(),
}));

vi.mock("./host-command-history-routes.js", () => ({
  registerHostCommandHistoryRoutes: vi.fn(),
}));

vi.mock("./host-autostart-routes.js", () => ({
  registerHostAutostartRoutes: vi.fn(),
}));

vi.mock("./host-internal-routes.js", () => ({
  registerHostInternalRoutes: vi.fn(),
}));

vi.mock("./host-network-routes.js", () => ({
  registerHostNetworkRoutes: vi.fn(),
}));

vi.mock("./host-bulk-routes.js", () => ({
  registerHostBulkRoutes: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    post: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("multer", () => {
  const multerFn = () => ({
    single: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  });
  multerFn.memoryStorage = () => ({});
  return { default: multerFn };
});

// ---------------------------------------------------------------------------
// Import mocked primitives AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";

// ---------------------------------------------------------------------------
// HTTP helper — supports POST with JSON body
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
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers: {
          ...(bodyStr !== undefined
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) }
            : {}),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          let body: unknown;
          try { body = JSON.parse(data); } catch { body = data; }
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
// Stub host record
// ---------------------------------------------------------------------------

const stubResolvedHost = {
  id: 999,
  ip: "10.0.0.99",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// ---------------------------------------------------------------------------
// Import router under test (module under test is host.ts)
// ---------------------------------------------------------------------------

import router from "./host.js";

let server: http.Server;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/host", router);
  server = http.createServer(app);
  server.listen(0);
  return server;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserId = "1";

  // Default: host 999 resolves; anything else → null
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 999) return Promise.resolve(stubResolvedHost);
    return Promise.resolve(null);
  });
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /host/:hostId/session/kill (quick-260810-n3a)", () => {
  it("Test 1 (happy path): valid hostId + valid tmuxSession → 204; execCommand called with kill-session", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);
    (execCommand as Mock).mockResolvedValue("");

    makeApp();
    const res = await httpRequest(server, {
      method: "POST",
      path: "/host/999/session/kill",
      body: { tmuxSession: "claude-abc" },
    });

    expect(res.status).toBe(204);
    expect(execCommand).toHaveBeenCalledWith(fakeConn, "tmux kill-session -t claude-abc");
    expect(fakeConn.end).toHaveBeenCalled();
  });

  it("Test 2 (idempotent): execCommand throws 'can't find session' → 204 (already gone)", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);
    (execCommand as Mock).mockRejectedValue(new Error("can't find session: claude-abc"));

    makeApp();
    const res = await httpRequest(server, {
      method: "POST",
      path: "/host/999/session/kill",
      body: { tmuxSession: "claude-abc" },
    });

    expect(res.status).toBe(204);
    // conn.end must still be called via finally
    expect(fakeConn.end).toHaveBeenCalled();
  });

  it("Test 2b (idempotent): execCommand throws 'session not found' → 204", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);
    (execCommand as Mock).mockRejectedValue(new Error("session not found: claude-abc"));

    makeApp();
    const res = await httpRequest(server, {
      method: "POST",
      path: "/host/999/session/kill",
      body: { tmuxSession: "claude-abc" },
    });

    expect(res.status).toBe(204);
  });

  it("Test 3 (security gate): malicious tmuxSession → 400; connectOneShot NOT called (call count 0)", async () => {
    makeApp();
    const res = await httpRequest(server, {
      method: "POST",
      path: "/host/999/session/kill",
      body: { tmuxSession: "foo; rm -rf /" },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/invalid tmux session/i);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 4 (empty tmuxSession): empty string → 400", async () => {
    makeApp();
    const res = await httpRequest(server, {
      method: "POST",
      path: "/host/999/session/kill",
      body: { tmuxSession: "" },
    });

    expect(res.status).toBe(400);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 5 (missing tmuxSession): body {} → 400", async () => {
    makeApp();
    const res = await httpRequest(server, {
      method: "POST",
      path: "/host/999/session/kill",
      body: {},
    });

    expect(res.status).toBe(400);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 6 (non-numeric hostId): /host/abc/session/kill → 400", async () => {
    makeApp();
    const res = await httpRequest(server, {
      method: "POST",
      path: "/host/abc/session/kill",
      body: { tmuxSession: "claude-abc" },
    });

    expect(res.status).toBe(400);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 7 (host not found): resolveHostById → null → 404", async () => {
    // hostId=888 → resolveHostById returns null (not in stub default)
    makeApp();
    const res = await httpRequest(server, {
      method: "POST",
      path: "/host/888/session/kill",
      body: { tmuxSession: "claude-abc" },
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/host not found/i);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 8 (SSH unreachable): connectOneShot rejects → 500 { error: <message> }; error NOT swallowed", async () => {
    (connectOneShot as Mock).mockRejectedValue(new Error("Connection refused"));

    makeApp();
    const res = await httpRequest(server, {
      method: "POST",
      path: "/host/999/session/kill",
      body: { tmuxSession: "claude-abc" },
    });

    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBeTruthy();
    // The error message is surfaced (not swallowed)
    expect((res.body as { error: string }).error).toContain("Connection refused");
    // execCommand was never reached
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("Test 9 (unauthenticated): mockUserId=null → 401", async () => {
    mockUserId = null;

    makeApp();
    const res = await httpRequest(server, {
      method: "POST",
      path: "/host/999/session/kill",
      body: { tmuxSession: "claude-abc" },
    });

    expect(res.status).toBe(401);
    expect(connectOneShot).not.toHaveBeenCalled();
  });
});
