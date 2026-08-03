/**
 * Phase 20 (IDUI-05): Tests for the identity-exists-on-host route.
 *
 * Tests exercise GET /identities/exists-on-host?hostId=<n>&name=<slug> via a
 * bare Express app using Node's built-in http module (supertest not in project
 * deps — following the identity-avatar-batch.test.ts pattern from 20-01).
 *
 * Auth middleware is mocked. SSH primitives (connectOneShot, execCommand) and
 * isLocalHostId / resolveHostById are mocked.
 *
 * Test coverage (10 tests):
 *   1: local branch — existing folder returns {exists: true}
 *   2: local branch — missing folder returns {exists: false}
 *   3: SSH branch — existing folder returns {exists: true}
 *   4: SSH branch — missing folder returns {exists: false}
 *   5: SSH branch — connect timeout returns 504 {error: "Host unreachable"}
 *   6: host-not-owned returns 404 {error: "Host not found"}
 *   7: invalid name returns 400 {error: "name must match [a-z0-9._=/+-]+"}
 *   8: missing hostId returns 400
 *   9: 401 without JWT
 *  10: shell safety — name is validated pre-SSH and interpolated raw inside double-quoted path (CR-03 regression)
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock — controls whether a request is authenticated
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

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  stat: vi.fn(),
  default: {
    stat: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import { stat as fspStat } from "fs/promises";

// ---------------------------------------------------------------------------
// Helpers: HTTP request wrapper
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
// Stub SSH connection object
// ---------------------------------------------------------------------------

const stubConn = {
  end: vi.fn(),
  exec: vi.fn(),
};

// Stub host record (non-null = owned by user)
const stubHost = {
  id: 5,
  ip: "10.0.0.5",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// ---------------------------------------------------------------------------
// Test setup: build the Express app mounting the router
// ---------------------------------------------------------------------------

// Import the router under test — AFTER all vi.mock() calls so mocks take effect.
// (Module does not exist yet — all tests will fail RED.)
import router from "./identity-exists-on-host.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();

  // Default: user owns host 5 (local) and host 7 (remote)
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 5 || hostId === 7) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  // Default: hostId 5 is local, hostId 7 is remote
  (isLocalHostId as Mock).mockImplementation((hostId: number) => hostId === 5);

  // Default: SSH connect resolves to stubConn
  (connectOneShot as Mock).mockResolvedValue(stubConn);

  // Default: execCommand resolves "missing"
  (execCommand as Mock).mockResolvedValue("missing");

  // Default: fs.stat rejects ENOENT
  (fspStat as Mock).mockRejectedValue(
    Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" }),
  );

  // Rebuild app per test (mocks may change userId)
  const app = express();
  app.use("/identities", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  mockUserId = "1"; // reset for subsequent tests
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /identities/exists-on-host", () => {
  it("Test 1: local branch — existing folder returns {exists: true}", async () => {
    // hostId=5 → isLocalHostId=true; fs.stat succeeds (folder exists)
    (fspStat as Mock).mockResolvedValue({});

    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/exists-on-host?hostId=5&name=existing",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: true });
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 2: local branch — missing folder returns {exists: false}", async () => {
    // hostId=5 → isLocalHostId=true; fs.stat rejects ENOENT (default mock)
    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/exists-on-host?hostId=5&name=missing",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: false });
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 3: SSH branch — existing folder returns {exists: true}", async () => {
    // hostId=7 → isLocalHostId=false; execCommand returns "exists"
    (execCommand as Mock).mockResolvedValue("exists");

    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/exists-on-host?hostId=7&name=remote-id",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: true });
    expect(connectOneShot).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it("Test 4: SSH branch — missing folder returns {exists: false}", async () => {
    // hostId=7 → isLocalHostId=false; execCommand returns "missing" (default)
    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/exists-on-host?hostId=7&name=absent",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exists: false });
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it("Test 5: SSH branch — connect timeout returns 504 {error: 'Host unreachable'}", async () => {
    // connectOneShot rejects with a timeout error
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 3000ms"),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/exists-on-host?hostId=7&name=whatever",
    });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: "Host unreachable" });
  });

  it("Test 6: host-not-owned returns 404 {error: 'Host not found'}", async () => {
    // hostId=99 → resolveHostById returns null (default for unknown hostId)
    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/exists-on-host?hostId=99&name=anything",
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Host not found" });
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 7: invalid name returns 400 {error: 'name must match [a-z0-9._=/+-]+'}", async () => {
    // Name contains a space — fails IDENTITY_KEY_RE
    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/exists-on-host?hostId=5&name=Bad+Name",
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/name must match/);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 8: missing hostId returns 400", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/exists-on-host?name=valid",
    });

    expect(res.status).toBe(400);
  });

  it("Test 9: 401 without JWT", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/exists-on-host?hostId=5&name=valid",
    });

    expect(res.status).toBe(401);
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
  });

  it("shell safety — name is validated pre-SSH and interpolated raw inside double-quoted path (CR-03 regression)", async () => {
    // Part A: A name that would be injection-evil if unescaped is rejected by
    // IDENTITY_KEY_RE before SSH is reached.
    const evilName = encodeURIComponent("x'; touch /tmp/pwn; #");
    const rejectedRes = await httpRequest(server, {
      method: "GET",
      path: `/identities/exists-on-host?hostId=7&name=${evilName}`,
    });
    expect(rejectedRes.status).toBe(400);
    expect(connectOneShot).not.toHaveBeenCalled();

    // Part B: For a valid name, assert execCommand receives a command where
    // the name is interpolated raw inside the double-quoted path.
    // CR-03 regression guard: single quotes must NOT wrap the name — they do
    // not nest inside double quotes in POSIX shell and would match a directory
    // literally named 'testname' instead of testname.
    const safeName = "testname";
    (execCommand as Mock).mockResolvedValue("missing");

    await httpRequest(server, {
      method: "GET",
      path: `/identities/exists-on-host?hostId=7&name=${safeName}`,
    });

    expect(execCommand).toHaveBeenCalledTimes(1);
    const [, command] = (execCommand as Mock).mock.calls[0] as [unknown, string];
    // The name must appear raw inside the double-quoted path (correct form)
    expect(command).toContain(`/identities/${safeName}`);
    expect(command).toContain(`"$HOME/.claude/identities/${safeName}"`);
    // CR-03 regression: single-quoted form must NOT appear in the command
    expect(command).not.toContain(`'${safeName}'`);
  });
});
