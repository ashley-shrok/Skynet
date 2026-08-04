/**
 * Phase 22 (SRIC-04): Tests for the roles-create route.
 *
 * Tests exercise POST /roles via a bare Express app using Node's built-in http
 * module (supertest not in project deps — follows the identity-exists-on-host.
 * test.ts / roles-list-for-host.test.ts pattern).
 *
 * Auth middleware is mocked. SSH primitives (connectOneShot, execCommand) +
 * resolveHostById + writeMarkdownFileAtomic are mocked.
 *
 * Test coverage (10 tests — mirror plan Task 1 <behavior> 1..10):
 *   1: POST /roles without a body → 400
 *   2: uppercase/underscore name → 400 (fails ROLE_NAME_PATTERN)
 *   3: empty description → 400
 *   4: cross-user hostId (resolveHostById → null) → 404
 *   5: role folder already exists on host (existence probe returns "exists") → 409
 *   6: happy path — 201, mkdir/touch invoked, writeMarkdownFileAtomic
 *      called with the correct target path AND stub body matching the REVISION
 *      seed-comment format (contains seed phrases; NO "Skynet"; NO id-skill refs)
 *   7: SSH connect failure → 502; conn NOT accessed after failure
 *   8: description with newlines preserved (multi-line textarea)
 *   9: missing JWT cookie → 401
 *  10: description with shell metacharacters (backticks, $, quotes) round-trips
 *      via SFTP write unchanged (no shell injection surface)
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
// Mock SSH primitives + writeMarkdownFileAtomic BEFORE importing module under test
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
  writeMarkdownFileAtomic: vi.fn(),
}));

// The route imports ROLE_NAME_PATTERN from identity-birth-orchestrator — we don't
// mock it, but we DO need to ensure the real regex is loaded. Import the real
// module (vi.mock isn't declared for it) so ROLE_NAME_PATTERN is authentic.

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { writeMarkdownFileAtomic } from "../../claude-session/identity-artifact-reader.js";

// ---------------------------------------------------------------------------
// Helper: HTTP request wrapper (mirrors roles-list-for-host.test.ts:84)
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;

    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(opts.body));
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
    if (opts.body !== undefined) {
      req.write(opts.body);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stub SSH conn + host record
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
// Import the router under test (module does not exist yet → RED)
// ---------------------------------------------------------------------------

import router from "./roles-create.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  stubConn.end.mockClear();

  // Default: user owns host 5; anything else → null
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 5) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  (connectOneShot as Mock).mockResolvedValue(stubConn);

  // Default execCommand: return "missing" for the existence probe, "/home/ubuntu"
  // for `echo $HOME`, and empty string for the mkdir + touch call.
  (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
    if (cmd.includes("if [ -d")) return "missing";
    if (cmd.includes("echo $HOME")) return "/home/ubuntu";
    if (cmd.includes("mkdir -p") || cmd.includes("touch ")) return "";
    return "";
  });

  (writeMarkdownFileAtomic as Mock).mockResolvedValue(undefined);

  const app = express();
  // Router does its own express.json() mounting per plan — no outer json()
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

describe("POST /roles", () => {
  it("Test 1: POST /roles without body → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles",
      // No body sent
    });
    expect(res.status).toBe(400);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 2: uppercase/underscore name → 400 (ROLE_NAME_PATTERN violation)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles",
      body: JSON.stringify({
        name: "Box_Maintainer",
        description: "irrelevant",
        hostId: 5,
      }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/name/i);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 2b: path-traversal role name (`../etc`) → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles",
      body: JSON.stringify({
        name: "../etc",
        description: "irrelevant",
        hostId: 5,
      }),
    });
    expect(res.status).toBe(400);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 3: empty description → 400", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles",
      body: JSON.stringify({
        name: "box-maintainer",
        description: "",
        hostId: 5,
      }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/description/i);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 4: cross-user hostId → 404 (resolveHostById returns null)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles",
      body: JSON.stringify({
        name: "box-maintainer",
        description: "x",
        hostId: 99999,
      }),
    });
    expect(res.status).toBe(404);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 5: role folder already exists on host → 409", async () => {
    // Override existence probe to return "exists"
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("if [ -d")) return "exists";
      if (cmd.includes("echo $HOME")) return "/home/ubuntu";
      return "";
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles",
      body: JSON.stringify({
        name: "box-maintainer",
        description: "x",
        hostId: 5,
      }),
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toMatch(/role exists on host/i);
    // Should not have proceeded to mkdir/write
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
    // conn.end() still fires (try/finally)
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("Test 6: happy path — 201, mkdir/touch invoked, writeMarkdownFileAtomic called with seed-comment stub", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles",
      body: JSON.stringify({
        name: "box-maintainer",
        description: "x",
        hostId: 5,
      }),
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: "box-maintainer", description: "x" });

    // Assert mkdir -p (creates parent AND bounties atomically)
    const execCalls = (execCommand as Mock).mock.calls.map((c) => c[1] as string);
    expect(execCalls.some((c) =>
      c.includes(`mkdir -p "$HOME/.claude/roles/box-maintainer/bounties"`),
    )).toBe(true);

    // Assert touch history.md
    expect(execCalls.some((c) =>
      c.includes(`touch "$HOME/.claude/roles/box-maintainer/history.md"`),
    )).toBe(true);

    // Assert writeMarkdownFileAtomic called with expected target path
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    const writeArgs = (writeMarkdownFileAtomic as Mock).mock.calls[0];
    expect(writeArgs[1]).toBe("/home/ubuntu/.claude/roles/box-maintainer/box-maintainer.md");

    // Assert stub body — REVISION seed-comment format
    const stubBody = writeArgs[2] as string;

    // (a) Positive assertions: seed comment phrases present
    expect(stubBody).toContain("This role file was auto-generated");
    expect(stubBody).toContain("On first wake of an agent holding this role");
    expect(stubBody).toContain("flesh out the role");
    expect(stubBody).toContain("remove this comment");

    // (b) NO "Skynet" (case-insensitive)
    expect(stubBody).not.toMatch(/skynet/i);

    // (c) NO id-skill references (case-insensitive)
    expect(stubBody).not.toMatch(/§2|§3|id skill|SKILL\.md/i);

    // (d) Description appears verbatim under ## Role
    expect(stubBody).toMatch(/^# box-maintainer\n\n## Role\n\nx\n/);

    // Cleanup — conn.end() fired in finally
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("Test 7: SSH connect failure → 502; conn NOT accessed", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 5000ms"),
    );

    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles",
      body: JSON.stringify({
        name: "box-maintainer",
        description: "x",
        hostId: 5,
      }),
    });
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toMatch(/SSH connect failed/i);
    // Nothing should have called end() (conn was never obtained)
    expect(stubConn.end).not.toHaveBeenCalled();
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("Test 8: description with newlines preserved verbatim via SFTP write", async () => {
    const desc = "line1\nline2\nline3";
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles",
      body: JSON.stringify({
        name: "box-maintainer",
        description: desc,
        hostId: 5,
      }),
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: "box-maintainer", description: desc });

    // Description round-trips verbatim into SFTP contents (multi-line preserved)
    const stubBody = (writeMarkdownFileAtomic as Mock).mock.calls[0][2] as string;
    expect(stubBody).toContain("## Role\n\nline1\nline2\nline3\n");
  });

  it("Test 9: missing JWT → 401", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles",
      body: JSON.stringify({
        name: "box-maintainer",
        description: "x",
        hostId: 5,
      }),
    });
    expect(res.status).toBe(401);
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 10: description with shell metacharacters round-trips via SFTP (no shell injection surface)", async () => {
    // Backticks, $, semicolons, ampersands, single quotes, double quotes — all
    // would be dangerous if description were passed through `echo` into shell.
    // Since we use SFTP write (writeMarkdownFileAtomic), the bytes are streamed
    // through ssh2's SFTPWrapper.writeFile — no shell interpolation at all.
    const desc = "`whoami` $USER ; rm -rf / && echo 'pwned' \"quotes\"";

    const res = await httpRequest(server, {
      method: "POST",
      path: "/roles",
      body: JSON.stringify({
        name: "box-maintainer",
        description: desc,
        hostId: 5,
      }),
    });
    expect(res.status).toBe(201);

    // Description bytes round-trip UNMODIFIED into the SFTP write contents
    const stubBody = (writeMarkdownFileAtomic as Mock).mock.calls[0][2] as string;
    expect(stubBody).toContain(desc);

    // Belt: the description NEVER appears inside any execCommand argument
    // (it must never be shell-interpolated). Only name (which is regex-gated)
    // may appear in exec calls.
    const execCalls = (execCommand as Mock).mock.calls.map((c) => c[1] as string);
    for (const cmd of execCalls) {
      expect(cmd).not.toContain("whoami");
      expect(cmd).not.toContain("rm -rf");
      expect(cmd).not.toContain("pwned");
    }
  });
});
