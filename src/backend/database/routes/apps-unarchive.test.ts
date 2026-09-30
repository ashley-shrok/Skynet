/**
 * Tests for POST /apps/:hostId/:slug/unarchive (Phase 143 Plan 143-04).
 *
 * Tests exercise the route via a bare Express app + Node's built-in http module
 * (mirrors apps-archive.test.ts / role-unarchive.test.ts pattern).
 *
 * Auth middleware is mocked. All I/O primitives are mocked so tests exercise
 * every branch without real disk or SSH.
 *
 * Note: hostId is in PATH (not body) per apps-domain convention, matching
 * apps-archive.ts shape.
 *
 * Test coverage:
 *   1: Happy LOCAL — two preconditions pass, writer called → 200 { ok: true }
 *   2: archive_not_found LOCAL — archived folder absent → 409
 *   3: name_collision LOCAL — live folder exists → 409
 *   4: Idempotent success — two calls both return 200
 *   5: 401 unauthenticated
 *   6: 400 malformed hostId in path
 *   7: 400 malformed slug (fails APP_SLUG_RE — underscore)
 *   8: 504 SSH connect failure REMOTE
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
// Hoisted mock variables
// ---------------------------------------------------------------------------

const { mockFsAccess } = vi.hoisted(() => ({
  mockFsAccess: vi.fn().mockResolvedValue(undefined),
}));

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

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
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

// APP_SLUG_RE is a real constant — pass through verbatim.
vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  APP_SLUG_RE: /^[a-z0-9-]{1,64}$/,
  isLocalHostId: vi.fn(),
  getLocalAppsRoot: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock archive-tree primitives
// ---------------------------------------------------------------------------

vi.mock("../../claude-session/per-app-archive-file.js", () => ({
  writeAppArchiveFile: vi.fn(),
  getLocalArchivedAppsRoot: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock node:fs/promises
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  access: mockFsAccess,
  default: {
    access: mockFsAccess,
  },
}));

// ---------------------------------------------------------------------------
// Mock execCommand for REMOTE path SSH calls
// ---------------------------------------------------------------------------

vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { isLocalHostId, getLocalAppsRoot } from "../../claude-session/identity-artifact-reader.js";
import { writeAppArchiveFile, getLocalArchivedAppsRoot } from "../../claude-session/per-app-archive-file.js";
import { execCommand } from "../../ssh/tmux-helper.js";
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

    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (bodyStr !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
    }

    const req = http.request(
      { hostname: "127.0.0.1", port, method: opts.method, path: opts.path, headers },
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
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const stubConn = { end: vi.fn(), exec: vi.fn() };

const stubHost = {
  id: 5, ip: "10.0.0.5", port: 22, username: "ubuntu",
  authType: "password" as const, password: "secret",
};

// Non-overlapping fake roots
const FAKE_APPS_ARCHIVE_ROOT = "/tmp/test-apps-archive";
const FAKE_APPS_LIVE_ROOT = "/tmp/test-apps-live";

// ---------------------------------------------------------------------------
// Import the router under test — AFTER all vi.mock() calls
// ---------------------------------------------------------------------------

import router from "./apps-unarchive.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  mockFsAccess.mockReset();

  // Default: user owns 5 (local), 7 (remote); 99 not owned
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 5 || hostId === 7) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  (isLocalHostId as Mock).mockImplementation((hostId: number) => hostId === 5);
  (connectOneShot as Mock).mockResolvedValue(stubConn);
  (writeAppArchiveFile as Mock).mockResolvedValue(undefined);
  (getLocalArchivedAppsRoot as Mock).mockReturnValue(FAKE_APPS_ARCHIVE_ROOT);
  (getLocalAppsRoot as Mock).mockReturnValue(FAKE_APPS_LIVE_ROOT);

  // Default fs.access:
  //   - archive folder exists (resolves for APPS_ARCHIVE_ROOT)
  //   - live folder absent (rejects for APPS_LIVE_ROOT)
  mockFsAccess.mockImplementation((p: string) => {
    if (p.startsWith(FAKE_APPS_LIVE_ROOT)) {
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return Promise.reject(err);
    }
    return Promise.resolve();
  });

  // Default: execCommand returns "yes" for REMOTE tests
  (execCommand as Mock).mockResolvedValue("yes\n");

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

describe("POST /apps/:hostId/:slug/unarchive", () => {
  // -------------------------------------------------------------------------
  // Test 1: Happy LOCAL
  // -------------------------------------------------------------------------

  it("Test 1: happy LOCAL → 200 { ok: true }; writeAppArchiveFile called with correct args; audit log", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/5/my-app/unarchive",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(writeAppArchiveFile).toHaveBeenCalledTimes(1);
    expect(writeAppArchiveFile).toHaveBeenCalledWith(
      "my-app",
      ".unarchive-requested",
      "",
      { hostId: 5, conn: null },
    );
    expect(connectOneShot).not.toHaveBeenCalled();

    const infoMock = databaseLogger.info as unknown as Mock;
    expect(infoMock).toHaveBeenCalled();
    const infoMsg = infoMock.mock.calls[0][0] as string;
    expect(infoMsg).toMatch(/app unarchive requested/);
    expect(infoMsg).toMatch(/userId=/);
    expect(infoMsg).toMatch(/hostId=5/);
    expect(infoMsg).toMatch(/slug=my-app/);
  });

  // -------------------------------------------------------------------------
  // Test 2: archive_not_found
  // -------------------------------------------------------------------------

  it("Test 2: archive folder absent → 409 { reason: 'archive_not_found' }; writer NOT called", async () => {
    mockFsAccess.mockImplementation((p: string) => {
      if (p.startsWith(FAKE_APPS_ARCHIVE_ROOT)) {
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return Promise.reject(err);
      }
      return Promise.resolve();
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/5/my-app/unarchive",
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "archive_not_found" });
    expect(writeAppArchiveFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3: name_collision
  // -------------------------------------------------------------------------

  it("Test 3: live folder exists → 409 { reason: 'name_collision' }; writer NOT called", async () => {
    // Both archive and live folders present → collision
    mockFsAccess.mockResolvedValue(undefined);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/5/my-app/unarchive",
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "name_collision" });
    expect(writeAppArchiveFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 4: Idempotent success
  // -------------------------------------------------------------------------

  it("Test 4: idempotent — two calls both return 200", async () => {
    const res1 = await httpRequest(server, {
      method: "POST",
      path: "/apps/5/my-app/unarchive",
    });
    const res2 = await httpRequest(server, {
      method: "POST",
      path: "/apps/5/my-app/unarchive",
    });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(writeAppArchiveFile).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Test 5: 401 unauthenticated
  // -------------------------------------------------------------------------

  it("Test 5: 401 without JWT; no downstream calls", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/5/my-app/unarchive",
    });

    expect(res.status).toBe(401);
    expect(writeAppArchiveFile).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 6: 400 malformed hostId
  // -------------------------------------------------------------------------

  it("Test 6: 400 hostId not-a-number → 'hostId must be a positive integer'", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/not-a-number/my-app/unarchive",
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/positive integer/);
    expect(writeAppArchiveFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 7: 400 malformed slug (fails APP_SLUG_RE)
  // -------------------------------------------------------------------------

  it("Test 7: 400 slug with underscore fails APP_SLUG_RE", async () => {
    // APP_SLUG_RE = /^[a-z0-9-]{1,64}$/ — underscore fails
    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/5/bad_slug/unarchive",
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/slug must match/);
    expect(writeAppArchiveFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 8: 504 SSH connect failure REMOTE
  // -------------------------------------------------------------------------

  it("Test 8: REMOTE connectOneShot throws → 504; writer NOT called", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 3000ms"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/apps/7/my-app/unarchive",
    });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: "Host unreachable" });
    expect(writeAppArchiveFile).not.toHaveBeenCalled();
    expect(res.status).not.toBe(409);
  });
});
