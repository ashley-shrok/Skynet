/**
 * Tests for POST /roles/:name/unarchive (Phase 143 Plan 143-04).
 *
 * Tests exercise the route via a bare Express app + Node's built-in http module
 * (mirrors role-archive.test.ts / identity-unarchive.test.ts pattern).
 *
 * Auth middleware is mocked. All I/O primitives are mocked so tests exercise
 * every branch without real disk or SSH.
 *
 * NOTE: "missing_roles" precondition does NOT apply to role un-archive (D-02
 * explicit: identity-only). Role un-archive has exactly two preconditions.
 *
 * Test coverage:
 *   1: Happy LOCAL — two preconditions pass, writer called → 200 { ok: true }
 *   2: archive_not_found LOCAL — archived folder absent → 409
 *   3: name_collision LOCAL — live folder exists → 409
 *   4: Idempotent success — two calls both return 200
 *   5: 401 unauthenticated
 *   6: 400 missing hostId
 *   7: 400 malformed name (fails ROLE_NAME_PATTERN — e.g. underscore)
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

// ROLE_NAME_PATTERN is a real constant — pass through verbatim.
vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn(),
  getLocalRolesRoot: vi.fn(),
}));

vi.mock("../../utils/role-name-pattern.js", () => ({
  ROLE_NAME_PATTERN: /^[a-z0-9-]+$/,
}));

// ---------------------------------------------------------------------------
// Mock archive-tree primitives
// ---------------------------------------------------------------------------

vi.mock("../../claude-session/per-role-archive-file.js", () => ({
  writeRoleArchiveFile: vi.fn(),
  getLocalArchivedRolesRoot: vi.fn(),
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
import { isLocalHostId, getLocalRolesRoot } from "../../claude-session/identity-artifact-reader.js";
import { writeRoleArchiveFile, getLocalArchivedRolesRoot } from "../../claude-session/per-role-archive-file.js";
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
  id: 42, ip: "10.0.0.42", port: 22, username: "ubuntu",
  authType: "password" as const, password: "secret",
};

// Non-overlapping fake roots
const FAKE_ROLES_ARCHIVE_ROOT = "/tmp/test-roles-archive";
const FAKE_ROLES_LIVE_ROOT = "/tmp/test-roles-live";

// ---------------------------------------------------------------------------
// Import the router under test — AFTER all vi.mock() calls
// ---------------------------------------------------------------------------

import router from "./role-unarchive.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  mockFsAccess.mockReset();

  // Default: user owns 42 (local), 43 (remote); 99 not owned
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 42 || hostId === 43) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  (isLocalHostId as Mock).mockImplementation((hostId: number) => hostId === 42);
  (connectOneShot as Mock).mockResolvedValue(stubConn);
  (writeRoleArchiveFile as Mock).mockResolvedValue(undefined);
  (getLocalArchivedRolesRoot as Mock).mockReturnValue(FAKE_ROLES_ARCHIVE_ROOT);
  (getLocalRolesRoot as Mock).mockReturnValue(FAKE_ROLES_LIVE_ROOT);

  // Default fs.access:
  //   - archive folder exists (resolves for ROLES_ARCHIVE_ROOT)
  //   - live folder absent (rejects for ROLES_LIVE_ROOT)
  mockFsAccess.mockImplementation((p: string) => {
    if (p.startsWith(FAKE_ROLES_LIVE_ROOT)) {
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return Promise.reject(err);
    }
    return Promise.resolve();
  });

  // Default: execCommand returns "yes" for REMOTE tests
  (execCommand as Mock).mockResolvedValue("yes\n");

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

describe("POST /roles/:name/unarchive", () => {
  // -------------------------------------------------------------------------
  // Test 1: Happy LOCAL
  // -------------------------------------------------------------------------

  it("Test 1: happy LOCAL → 200 { ok: true }; writeRoleArchiveFile called with correct args; audit log", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/ops-oncall/unarchive",
      body: { hostId: 42 },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(writeRoleArchiveFile).toHaveBeenCalledTimes(1);
    expect(writeRoleArchiveFile).toHaveBeenCalledWith(
      "ops-oncall",
      ".unarchive-requested",
      "",
      { hostId: 42, conn: null },
    );
    expect(connectOneShot).not.toHaveBeenCalled();

    const infoMock = databaseLogger.info as unknown as Mock;
    expect(infoMock).toHaveBeenCalled();
    const infoMsg = infoMock.mock.calls[0][0] as string;
    expect(infoMsg).toMatch(/role unarchive requested/);
    expect(infoMsg).toMatch(/userId=/);
    expect(infoMsg).toMatch(/hostId=42/);
    expect(infoMsg).toMatch(/name=ops-oncall/);
  });

  // -------------------------------------------------------------------------
  // Test 2: archive_not_found
  // -------------------------------------------------------------------------

  it("Test 2: archive folder absent → 409 { reason: 'archive_not_found' }; writer NOT called", async () => {
    mockFsAccess.mockImplementation((p: string) => {
      if (p.startsWith(FAKE_ROLES_ARCHIVE_ROOT)) {
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return Promise.reject(err);
      }
      return Promise.resolve();
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/ops-oncall/unarchive",
      body: { hostId: 42 },
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "archive_not_found" });
    expect(writeRoleArchiveFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3: name_collision
  // -------------------------------------------------------------------------

  it("Test 3: live folder exists → 409 { reason: 'name_collision' }; writer NOT called", async () => {
    // Archive folder present, live folder also present → collision
    mockFsAccess.mockResolvedValue(undefined);

    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/ops-oncall/unarchive",
      body: { hostId: 42 },
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: "name_collision" });
    expect(writeRoleArchiveFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 4: Idempotent success
  // -------------------------------------------------------------------------

  it("Test 4: idempotent — two calls both return 200", async () => {
    const res1 = await httpRequest(server, {
      method: "POST",
      path: "/roles/ops-oncall/unarchive",
      body: { hostId: 42 },
    });
    const res2 = await httpRequest(server, {
      method: "POST",
      path: "/roles/ops-oncall/unarchive",
      body: { hostId: 42 },
    });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(writeRoleArchiveFile).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Test 5: 401 unauthenticated
  // -------------------------------------------------------------------------

  it("Test 5: 401 without JWT; no downstream calls", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/ops-oncall/unarchive",
      body: { hostId: 42 },
    });

    expect(res.status).toBe(401);
    expect(writeRoleArchiveFile).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 6: 400 missing hostId
  // -------------------------------------------------------------------------

  it("Test 6: 400 missing hostId", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/ops-oncall/unarchive",
      body: {},
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId/);
    expect(writeRoleArchiveFile).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 7: 400 malformed name (fails ROLE_NAME_PATTERN)
  // -------------------------------------------------------------------------

  it("Test 7: 400 name with underscore fails ROLE_NAME_PATTERN", async () => {
    // ROLE_NAME_PATTERN = /^[a-z0-9-]+$/ — underscore fails
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles/bad_role/unarchive",
      body: { hostId: 42 },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/role name must match/);
    expect(writeRoleArchiveFile).not.toHaveBeenCalled();
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
      path: "/roles/ops-oncall/unarchive",
      body: { hostId: 43 },
    });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: "Host unreachable" });
    expect(writeRoleArchiveFile).not.toHaveBeenCalled();
    expect(res.status).not.toBe(409);
  });
});
