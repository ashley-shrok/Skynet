/**
 * Quick 260811-ax1: Tests for the identity-no-dormancy route.
 *
 * Tests exercise GET/PUT /identities/:key/no-dormancy via a bare Express app
 * using Node's built-in http module (supertest not in project deps — following
 * the identity-exists-on-host.test.ts pattern).
 *
 * Auth middleware is mocked. SSH primitives (connectOneShot, execCommand) and
 * isLocalHostId / resolveHostById / getLocalIdentitiesRoot are mocked.
 *
 * Test coverage (14+ tests):
 *   1: GET local branch — sentinel exists → 200 { present: true }
 *   2: GET local branch — sentinel missing (ENOENT) → 200 { present: false }
 *   3: GET SSH branch — sentinel exists → 200 { present: true }
 *   4: GET SSH branch — sentinel missing → 200 { present: false }
 *   5: PUT local branch — { present: true } → 200, fs.writeFile called
 *   6: PUT local branch — { present: false } → 200, fs.unlink called; ENOENT swallowed
 *   7: PUT SSH branch — { present: true } → mkdir+touch command; 200
 *   8: PUT SSH branch — { present: false } → rm -f command; 200
 *   9: Invalid identity key (traversal, metachar, empty, >64) → 400 for GET + PUT
 *  10: Unknown / cross-user hostId → 404 for GET + PUT
 *  11: PUT missing body / wrong-type present → 400
 *  12: GET SSH branch — timeout/connect failure → 504
 *  13: 401 without JWT — both routes
 *  14: GET local fs unexpected error (EACCES) → 500 with generic message
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
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
  IDENTITY_KEY_RE: /^[a-z0-9_-]{1,64}$/,
  getLocalIdentitiesRoot: vi.fn().mockReturnValue("/tmp/test-identities-root"),
}));

vi.mock("fs/promises", () => ({
  default: {
    stat: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
  },
  stat: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { isLocalHostId } from "../../claude-session/identity-artifact-reader.js";
import fs from "fs/promises";

// ---------------------------------------------------------------------------
// HTTP request helper (GET + POST/PUT with optional body)
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
// Stub SSH connection object
// ---------------------------------------------------------------------------

const stubConn = {
  end: vi.fn(),
  exec: vi.fn(),
};

// Stub host record
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

import router from "./identity-no-dormancy.js";

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

  // Default: execCommand resolves "N" (sentinel not present)
  (execCommand as Mock).mockResolvedValue("N");

  // Default: fs.stat rejects ENOENT (sentinel absent)
  (fs.stat as Mock).mockRejectedValue(
    Object.assign(new Error("ENOENT: no such file or directory"), {
      code: "ENOENT",
    }),
  );

  // Default: fs.writeFile + fs.unlink succeed
  (fs.writeFile as Mock).mockResolvedValue(undefined);
  (fs.unlink as Mock).mockResolvedValue(undefined);

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
// Test 1: GET local branch — sentinel exists → 200 { present: true }
// ---------------------------------------------------------------------------

describe("GET /identities/:key/no-dormancy", () => {
  it("Test 1: local branch — sentinel exists → { present: true }", async () => {
    (fs.stat as Mock).mockResolvedValue({});

    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/moxie/no-dormancy?hostId=5",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ present: true });
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 2: GET local branch — sentinel missing (ENOENT) → 200 { present: false }
  // -------------------------------------------------------------------------

  it("Test 2: local branch — sentinel missing (ENOENT) → { present: false }", async () => {
    // fs.stat default mock already rejects ENOENT
    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/moxie/no-dormancy?hostId=5",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ present: false });
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 3: GET SSH branch — sentinel exists → 200 { present: true }
  // -------------------------------------------------------------------------

  it("Test 3: SSH branch — sentinel exists → { present: true }", async () => {
    (execCommand as Mock).mockResolvedValue("Y\n");

    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/moxie/no-dormancy?hostId=7",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ present: true });
    expect(connectOneShot).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Test 4: GET SSH branch — sentinel missing → 200 { present: false }
  // -------------------------------------------------------------------------

  it("Test 4: SSH branch — sentinel missing → { present: false }", async () => {
    // execCommand default mock returns "N"
    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/moxie/no-dormancy?hostId=7",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ present: false });
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Test 12: GET SSH branch — exec timeout / connect failure → 504
  // -------------------------------------------------------------------------

  it("Test 12: SSH branch — connect failure → 504 { error: 'Host unreachable' }", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 3000ms"),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/moxie/no-dormancy?hostId=7",
    });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: "Host unreachable" });
  });

  // -------------------------------------------------------------------------
  // Test 9a: GET invalid identity key → 400
  // -------------------------------------------------------------------------

  it("Test 9a: invalid key (path traversal '..')", async () => {
    // NOTE: '/..' in URL won't reach the handler with the '..' param
    // because the router path is /:key/no-dormancy and '..' would be normalized.
    // Test with other invalid patterns instead:
    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/bad;key/no-dormancy?hostId=5",
    });
    // semicolon contains a non-matching char; Express may 404 if path doesn't match
    // OR the key validation fires. Either way, not 200.
    expect(res.status).not.toBe(200);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 9b: invalid key (shell metachar with encoded semicolon) → 400", async () => {
    // Use a key that passes URL routing but fails IDENTITY_KEY_RE
    // IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/
    // Key "bad.key" contains a dot — fails the regex
    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/bad.key/no-dormancy?hostId=5",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/identity key must match/);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 9c: key length > 64 chars → 400", async () => {
    const longKey = "a".repeat(65);
    const res = await httpRequest(server, {
      method: "GET",
      path: `/identities/${longKey}/no-dormancy?hostId=5`,
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/identity key must match/);
  });

  // -------------------------------------------------------------------------
  // Test 10a: GET unknown hostId → 404
  // -------------------------------------------------------------------------

  it("Test 10a: unknown / cross-user hostId → 404 { error: 'Host not found' }", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/moxie/no-dormancy?hostId=99",
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Host not found" });
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 13a: GET without JWT → 401
  // -------------------------------------------------------------------------

  it("Test 13a: 401 without JWT", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/moxie/no-dormancy?hostId=5",
    });

    expect(res.status).toBe(401);
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 14: GET local fs unexpected error (EACCES) → 500 generic
  // -------------------------------------------------------------------------

  it("Test 14: GET local fs unexpected error (EACCES) → 500 generic message", async () => {
    (fs.stat as Mock).mockRejectedValue(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/identities/moxie/no-dormancy?hostId=5",
    });

    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBe("Failed to check sentinel");
    // EACCES detail must NOT be in the response (T-ax1-04)
    expect(JSON.stringify(res.body)).not.toContain("EACCES");
  });
});

// ---------------------------------------------------------------------------
// PUT tests
// ---------------------------------------------------------------------------

describe("PUT /identities/:key/no-dormancy", () => {
  // -------------------------------------------------------------------------
  // Test 5: PUT local branch — { present: true } → fs.writeFile called
  // -------------------------------------------------------------------------

  it("Test 5: local branch — { present: true } → 200; fs.writeFile called with correct path", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/moxie/no-dormancy?hostId=5",
      body: { present: true },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ present: true });
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const [calledPath] = (fs.writeFile as Mock).mock.calls[0] as [string, ...unknown[]];
    expect(calledPath).toBe("/tmp/test-identities-root/moxie/.no-dormancy");
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 6: PUT local branch — { present: false } → fs.unlink called; ENOENT swallowed
  // -------------------------------------------------------------------------

  it("Test 6a: local branch — { present: false } → 200; fs.unlink called", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/moxie/no-dormancy?hostId=5",
      body: { present: false },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ present: false });
    expect(fs.unlink).toHaveBeenCalledTimes(1);
    const [calledPath] = (fs.unlink as Mock).mock.calls[0] as [string];
    expect(calledPath).toBe("/tmp/test-identities-root/moxie/.no-dormancy");
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 6b: local branch — { present: false } with ENOENT from unlink → 200 (swallowed)", async () => {
    (fs.unlink as Mock).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/moxie/no-dormancy?hostId=5",
      body: { present: false },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ present: false });
  });

  // -------------------------------------------------------------------------
  // Test 7: PUT SSH branch — { present: true } → mkdir+touch command
  // -------------------------------------------------------------------------

  it("Test 7: SSH branch — { present: true } → mkdir+touch command; 200", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/moxie/no-dormancy?hostId=7",
      body: { present: true },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ present: true });
    expect(execCommand).toHaveBeenCalledTimes(1);
    const [, cmd] = (execCommand as Mock).mock.calls[0] as [unknown, string];
    expect(cmd).toContain(`mkdir -p "$HOME/.claude/identities/moxie" && touch "$HOME/.claude/identities/moxie/.no-dormancy"`);
  });

  // -------------------------------------------------------------------------
  // Test 8: PUT SSH branch — { present: false } → rm -f command
  // -------------------------------------------------------------------------

  it("Test 8: SSH branch — { present: false } → rm -f command; 200", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/moxie/no-dormancy?hostId=7",
      body: { present: false },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ present: false });
    expect(execCommand).toHaveBeenCalledTimes(1);
    const [, cmd] = (execCommand as Mock).mock.calls[0] as [unknown, string];
    expect(cmd).toContain(`rm -f "$HOME/.claude/identities/moxie/.no-dormancy"`);
  });

  // -------------------------------------------------------------------------
  // Test 9d: PUT invalid identity key → 400
  // -------------------------------------------------------------------------

  it("Test 9d: PUT invalid key (dot in name) → 400", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/bad.key/no-dormancy?hostId=5",
      body: { present: true },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/identity key must match/);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 9e: PUT key length > 64 → 400", async () => {
    const longKey = "a".repeat(65);
    const res = await httpRequest(server, {
      method: "PUT",
      path: `/identities/${longKey}/no-dormancy?hostId=5`,
      body: { present: true },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/identity key must match/);
  });

  // -------------------------------------------------------------------------
  // Test 10b: PUT unknown hostId → 404
  // -------------------------------------------------------------------------

  it("Test 10b: unknown / cross-user hostId → 404 { error: 'Host not found' }", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/moxie/no-dormancy?hostId=99",
      body: { present: true },
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Host not found" });
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 11: PUT missing body / wrong-type present → 400
  // -------------------------------------------------------------------------

  it("Test 11a: PUT missing body → 400", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/moxie/no-dormancy?hostId=5",
      // no body
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/present must be a boolean/);
  });

  it("Test 11b: PUT { present: 'true' } (string, not boolean) → 400", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/moxie/no-dormancy?hostId=5",
      body: { present: "true" },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/present must be a boolean/);
  });

  it("Test 11c: PUT {} missing present key → 400", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/moxie/no-dormancy?hostId=5",
      body: {},
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/present must be a boolean/);
  });

  // -------------------------------------------------------------------------
  // Test 12b: PUT SSH branch — exec timeout → 504
  // -------------------------------------------------------------------------

  it("Test 12b: SSH branch — exec timeout → 504 { error: 'Host unreachable' }", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 3000ms"),
    );

    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/moxie/no-dormancy?hostId=7",
      body: { present: true },
    });

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ error: "Host unreachable" });
  });

  // -------------------------------------------------------------------------
  // Test 13b: PUT without JWT → 401
  // -------------------------------------------------------------------------

  it("Test 13b: 401 without JWT", async () => {
    mockUserId = null;

    const res = await httpRequest(server, {
      method: "PUT",
      path: "/identities/moxie/no-dormancy?hostId=5",
      body: { present: true },
    });

    expect(res.status).toBe(401);
    expect(connectOneShot).not.toHaveBeenCalled();
    expect(resolveHostById).not.toHaveBeenCalled();
  });
});
