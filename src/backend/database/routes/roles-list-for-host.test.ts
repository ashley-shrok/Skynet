/**
 * Phase 22 (SRIC-02): Tests for the roles-list-for-host route.
 *
 * Tests exercise GET /roles?hostId=<n> via a bare Express app using Node's
 * built-in http module (supertest not in project deps — following the
 * identity-exists-on-host.test.ts pattern established in Phase 20).
 *
 * Auth middleware is mocked. SSH primitives (connectOneShot, execCommand) and
 * resolveHostById are mocked.
 *
 * Test coverage (10 tests — mirror plan Task 1 <behavior>):
 *   1: missing hostId → 400
 *   2: non-integer hostId → 400
 *   3: unknown host (resolveHostById → null) → 404
 *   4: happy path — ls returns 3 roles, batched cat resolves per-role markdown with
 *      ## Role sections → 200 with [{name, description}]
 *   5: description extraction pulls content between ## Role and next heading
 *   6: missing ## Role section → description falls back to "" (not null)
 *   7: SSH connect failure → 502, conn.end NOT called on null
 *   8: empty roles directory → 200 with []
 *   9: 401 without JWT
 *  10: role names that fail ROLE_NAME_PATTERN are silently dropped
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

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";

// ---------------------------------------------------------------------------
// Helper: HTTP request wrapper (mirrors identity-exists-on-host.test.ts:96)
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

const stubConn = {
  end: vi.fn(),
  exec: vi.fn(),
};

const stubHost = {
  id: 7,
  ip: "10.0.0.7",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// ---------------------------------------------------------------------------
// Import the router under test (module does not exist yet → RED)
// ---------------------------------------------------------------------------

import router from "./roles-list-for-host.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  stubConn.end.mockClear();

  // Default: user owns host 7; anything else → null
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 7) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  (connectOneShot as Mock).mockResolvedValue(stubConn);

  // Default execCommand returns empty ls (no roles). Individual tests override.
  (execCommand as Mock).mockResolvedValue("");

  const app = express();
  // Mount router at /roles (mirrors database.ts mount)
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

describe("GET /roles?hostId=<n>", () => {
  it("Test 1: missing hostId → 400 with {error: 'hostId is required'}", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/hostId/);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 2: non-integer hostId → 400", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=abc",
    });
    expect(res.status).toBe(400);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 3: unknown host → 404", async () => {
    // hostId=99999 → resolveHostById returns null (default for unknown)
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=99999",
    });
    expect(res.status).toBe(404);
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 4: happy path — 3 roles with descriptions", async () => {
    // First execCommand call = ls; subsequent = batched cat with delimiters
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) {
        return "box-maintainer\ntina\nnelly";
      }
      // Batched cat: emit ===ROLE:<n>=== delimited blocks
      return [
        "===ROLE:box-maintainer===",
        "# box-maintainer",
        "",
        "## Role",
        "Maintains the box.",
        "",
        "## Notes",
        "irrelevant",
        "===ROLE:tina===",
        "# tina",
        "",
        "## Role",
        "Fleet-wide coordinator.",
        "===ROLE:nelly===",
        "# nelly",
        "",
        "## Role",
        "Skill maintenance.",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });

    expect(res.status).toBe(200);
    const body = res.body as { name: string; description: string }[];
    expect(body).toHaveLength(3);
    // Alphabetical order per action step
    expect(body.map((r) => r.name)).toEqual(["box-maintainer", "nelly", "tina"]);
    expect(body.find((r) => r.name === "box-maintainer")?.description).toBe("Maintains the box.");
    expect(body.find((r) => r.name === "tina")?.description).toBe("Fleet-wide coordinator.");
    expect(body.find((r) => r.name === "nelly")?.description).toBe("Skill maintenance.");
  });

  it("Test 5: description extraction trims whitespace and stops at next ##", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "box-maintainer";
      return [
        "===ROLE:box-maintainer===",
        "# box-maintainer",
        "",
        "## Role",
        "",
        "   Line with leading spaces.   ",
        "Second line of description.",
        "",
        "## Handoff",
        "should not appear",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as { name: string; description: string }[];
    expect(body).toHaveLength(1);
    // Description trimmed, includes both content lines, excludes ## Handoff
    expect(body[0].description).toContain("Line with leading spaces.");
    expect(body[0].description).toContain("Second line of description.");
    expect(body[0].description).not.toContain("Handoff");
    expect(body[0].description).not.toContain("should not appear");
    // No trailing/leading whitespace
    expect(body[0].description).toBe(body[0].description.trim());
  });

  it("Test 6: missing ## Role section → description empty string (not null)", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) return "orphan";
      return [
        "===ROLE:orphan===",
        "# orphan",
        "",
        "## SomethingElse",
        "no role section",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as { name: string; description: string }[];
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("orphan");
    expect(body[0].description).toBe("");
  });

  it("Test 7: SSH connect failure → 502; conn.end NOT called on null conn", async () => {
    (connectOneShot as Mock).mockRejectedValue(
      new Error("Connect timeout after 5000ms"),
    );

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toMatch(/SSH connect failed/i);
    // Nothing should have called end() (conn was never obtained)
    expect(stubConn.end).not.toHaveBeenCalled();
  });

  it("Test 8: no roles directory / empty ls → 200 with []", async () => {
    // Default mock returns "" for all execCommand calls
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    // conn.end() should have been called (we did open a conn)
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("Test 9: 401 without JWT", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(401);
    expect(resolveHostById).not.toHaveBeenCalled();
    expect(connectOneShot).not.toHaveBeenCalled();
  });

  it("Test 10: role names failing ROLE_NAME_PATTERN are silently dropped", async () => {
    // ls includes both valid + invalid entries. Only valid should reach the batched cat + response.
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("ls ")) {
        // Mix of valid kebab-case + invalid entries. Invalid ones must be dropped.
        return [
          "good-role",           // valid
          "BadCase",             // invalid: uppercase
          "with_underscore",     // invalid: underscore (kebab-case only)
          "with.dot",            // invalid: dot
          "with space",          // invalid: space
          "another-good",        // valid
        ].join("\n");
      }
      // Batched cat receives only good-role + another-good
      // Assert the batched cat command does NOT contain any of the dropped names
      expect(cmd).not.toContain("BadCase");
      expect(cmd).not.toContain("with_underscore");
      expect(cmd).not.toContain("with.dot");
      expect(cmd).not.toContain("with space");
      return [
        "===ROLE:good-role===",
        "## Role",
        "good.",
        "===ROLE:another-good===",
        "## Role",
        "also good.",
      ].join("\n");
    });

    const res = await httpRequest(server, {
      method: "GET",
      path: "/roles?hostId=7",
    });
    expect(res.status).toBe(200);
    const body = res.body as { name: string; description: string }[];
    // Sorted alphabetically
    expect(body.map((r) => r.name)).toEqual(["another-good", "good-role"]);
  });
});
