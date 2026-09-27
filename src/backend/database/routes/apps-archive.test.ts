/**
 * Tests for the app-archive route.
 *
 * Tests exercise POST /apps/:hostId/:slug/archive via a bare Express app
 * using Node's built-in http module (mirrors role-archive.test.ts pattern).
 *
 * Auth middleware is mocked. writeAppFile, resolveHostById, connectOneShot,
 * and isLocalHostId are mocked so tests can exercise every branch without
 * touching real disk or SSH. APP_SLUG_RE is passed through as the real
 * regex (it's a constant, not a function that needs stubbing).
 *
 * Test coverage:
 *   1: Happy LOCAL — writeAppFile called with correct args, 200 { ok: true }
 *   2: Happy REMOTE — connectOneShot + writeAppFile with conn, conn.end() called
 *   3: Invalid slug (uppercase / underscore / traversal) → 400, no write
 *   4: Malformed hostId in path → 400, no write
 *   5: hostId not owned (resolveHostById → null) → 404, no write
 *   6: REMOTE connectOneShot throws → 504, no write
 *   7: writeAppFile throws → 500 generic message; conn.end() still called
 *   8: Unauthenticated (no JWT) → 401, no downstream calls
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

// Mute logger during tests (avoid noisy stderr on the 500 path).
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock SSH primitives + identity-artifact-reader + writeAppFile
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

// APP_SLUG_RE is a real constant (not a stubbable function). Pass it through
// verbatim so the route's slug gate uses the real regex; isLocalHostId is a
// function we want to control per test.
vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn(),
  APP_SLUG_RE: /^[a-z0-9-]{1,64}$/,
}));

vi.mock("../../claude-session/per-app-file.js", () => ({
  writeAppFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { writeAppFile } from "../../claude-session/per-app-file.js";
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

import router from "./apps-archive.js";

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

  // Default: writeAppFile succeeds
  (writeAppFile as Mock).mockResolvedValue(undefined);

  const app = express();
  app.use(express.json());
  app.use("/apps", router);

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

describe("POST /apps/:hostId/:slug/archive", () => {
  // -------------------------------------------------------------------------
  // Test 1: happy LOCAL
  // -------------------------------------------------------------------------

  it("Test 1: happy LOCAL → 200 { ok: true }; writeAppFile called with local conn=null; audit log fired", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/5/my-app/archive",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(writeAppFile).toHaveBeenCalledTimes(1);
    expect(writeAppFile).toHaveBeenCalledWith(
      "my-app",
      ".archive-requested",
      "",
      { hostId: 5, conn: null },
    );
    // LOCAL branch must not open an SSH connection
    expect(connectOneShot).not.toHaveBeenCalled();

    // Audit log
    const infoMock = databaseLogger.info as unknown as Mock;
    expect(infoMock).toHaveBeenCalled();
    const infoMsg = infoMock.mock.calls[0][0] as string;
    expect(infoMsg).toMatch(/app archive requested/);
    expect(infoMsg).toMatch(/userId=/);
    expect(infoMsg).toMatch(/hostId=5/);
    expect(infoMsg).toMatch(/slug=my-app/);
  });

  // -------------------------------------------------------------------------
  // Test 2: happy REMOTE
  // -------------------------------------------------------------------------

  it("Test 2: happy REMOTE → 200; conn passed to writeAppFile + conn.end() called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/7/my-app/archive",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(connectOneShot).toHaveBeenCalledTimes(1);
    expect(writeAppFile).toHaveBeenCalledTimes(1);
    expect(writeAppFile).toHaveBeenCalledWith(
      "my-app",
      ".archive-requested",
      "",
      { hostId: 7, conn: stubConn },
    );
    // Finally block must close the SSH connection
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Test 3: invalid slug → 400
  // -------------------------------------------------------------------------

  it("Test 3a: invalid slug (underscore) → 400; writeAppFile NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/5/bad_slug/archive",
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/slug/);
    expect(writeAppFile).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 3b: invalid slug (uppercase) → 400; writeAppFile NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/5/BadSlug/archive",
    });

    expect(res.status).toBe(400);
    expect(writeAppFile).not.toHaveBeenCalled();
  });

  it("Test 3c: invalid slug (dot / traversal shape) → 400; writeAppFile NOT called", async () => {
    // A slug containing a dot fails APP_SLUG_RE. Express normalizes
    // /apps/5/../etc so exercising a dotted slug is the practical way to
    // hit the gate.
    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/5/bad.slug/archive",
    });

    expect(res.status).toBe(400);
    expect(writeAppFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 4: malformed hostId → 400
  // -------------------------------------------------------------------------

  it("Test 4a: hostId 'not-a-number' → 400 'hostId must be a positive integer'", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/not-a-number/my-app/archive",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/positive integer/);
    expect(writeAppFile).not.toHaveBeenCalled();
  });

  it("Test 4b: hostId -1 → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/-1/my-app/archive",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/positive integer/);
    expect(writeAppFile).not.toHaveBeenCalled();
  });

  it("Test 4c: hostId 3.14 → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/3.14/my-app/archive",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/positive integer/);
    expect(writeAppFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 5: hostId not owned → 404 (NOT 403; no probe leak)
  // -------------------------------------------------------------------------

  it("Test 5: cross-user / unknown hostId → 404 'Host not found'; writeAppFile NOT called", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/99/my-app/archive",
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/Host not found/);
    // No probe leak — MUST NOT be 403
    expect(res.status).not.toBe(403);
    expect(writeAppFile).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 6: REMOTE host unreachable → 504
  // -------------------------------------------------------------------------

  it("Test 6: REMOTE connectOneShot throws → 504 'Host unreachable'; writeAppFile NOT called", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 3000ms"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/7/my-app/archive",
    });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: "Host unreachable" });
    expect(writeAppFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 7: writeAppFile throws → 500 generic; conn.end() still called
  // -------------------------------------------------------------------------

  it("Test 7: writeAppFile throws → 500 generic message; conn.end() still called (REMOTE); server-side error logged", async () => {
    (writeAppFile as Mock).mockRejectedValue(
      new Error("ENOSPC: no space left on device — sensitive fs path leak"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/7/my-app/archive",
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "failed to drop archive sentinel" });
    // Underlying error text MUST NOT reach the client
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
  // Test 8: unauthenticated → 401; no downstream calls
  // -------------------------------------------------------------------------

  it("Test 8: 401 without JWT; writeAppFile NOT called; no downstream calls", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/5/my-app/archive",
    });

    expect(res.status).toBe(401);
    expect(writeAppFile).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });
});
