/**
 * Regression test for the 2026-08-06 hotfix — Phase 25's mocked resolveRoleForIdentity
 * tests silently passed with the LOCAL-null-return behavior and missed the whole class of
 * bug. This test uses a real un-mocked resolveRoleForIdentity + fake SSH conn to exercise
 * the full 'list sessions → read frontmatter on same conn → attach role to row' path.
 *
 * Test coverage (4 tests — mirror plan Task 1 <behavior>):
 *   1: happy path — two sessions (poppy/patricia) get real roles from frontmatter
 *   2: missing frontmatter — one row returns role:null, other rows unaffected
 *   3: per-identity timeout — hung cat → role:null, good row keeps its role
 *   4: host-level failure — connectOneShot throws → host silently dropped (no rows)
 *
 * Design: resolveRoleForIdentity is NOT mocked. The fake conn's execCommand responds to
 * two command shapes: "tmux list-sessions ..." and "cat $HOME/.claude/identities/..." .
 * resolveRoleForIdentity calls execWithTimeout(conn, cmd) internally — which calls
 * execCommand on the passed conn — so the real frontmatter parse path is exercised.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock — passes through with canned userId "1"
// ---------------------------------------------------------------------------

vi.mock("../../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware: () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          (req as express.Request & { userId: string }).userId = "1";
          next();
        },
    }),
  };
  return { AuthManager };
});

// ---------------------------------------------------------------------------
// Mock SSH primitives and host resolver BEFORE importing module under test.
// NOTE: execCommand is mocked so we can control what the fake conn returns.
// resolveRoleForIdentity is NOT mocked — the test exercises the real function.
// ---------------------------------------------------------------------------

vi.mock("../../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(),
}));

// execCommand is mocked at the module level; resolveRoleForIdentity uses it
// internally via execWithTimeout (also defined in identity-artifact-reader.ts).
// The mock here controls what comes back when the REAL resolveRoleForIdentity
// calls execCommand(conn, cmd) on the fake conn.
vi.mock("../../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(),
}));

vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the db + SimpleDBOps layer. sessions.ts calls:
//   SimpleDBOps.select(db.select().from(hosts).where(...), "ssh_data", userId)
// We return two candidate hosts with autoTmux: true.
// ---------------------------------------------------------------------------

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../db/schema.js", () => ({
  hosts: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

const mockSimpleDBOpsSelect = vi.fn();
vi.mock("../../utils/simple-db-ops.js", () => ({
  SimpleDBOps: {
    select: (...args: unknown[]) => mockSimpleDBOpsSelect(...args),
  },
}));

// Mock logger to suppress noise
vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import mocked primitives AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";

// ---------------------------------------------------------------------------
// HTTP helper (mirrors roles-list-for-host.test.ts pattern)
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: { method: string; path: string; headers?: Record<string, string> },
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
          try { body = JSON.parse(data); } catch { body = data; }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Stub host records
// ---------------------------------------------------------------------------

const stubHostRecord = {
  id: 42,
  name: "box-a",
  ip: "10.0.0.42",
  enableSsh: true,
  terminalConfig: JSON.stringify({ autoTmux: true }),
};

const stubResolvedHost = {
  id: 42,
  ip: "10.0.0.42",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// ---------------------------------------------------------------------------
// Import router under test
// ---------------------------------------------------------------------------

import router from "./sessions.js";

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();

  // Default: one candidate host
  mockSimpleDBOpsSelect.mockResolvedValue([stubHostRecord]);
  (resolveHostById as Mock).mockResolvedValue(stubResolvedHost);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeApp() {
  const app = express();
  app.use("/sessions", router);
  server = http.createServer(app);
  server.listen(0);
  return server;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /sessions/list — role resolution", () => {
  it("Test 1 (happy path): two sessions get real roles from frontmatter via same conn", async () => {
    // The fake conn: execCommand responds to list-sessions and per-identity cat
    const fakeConn = {
      end: vi.fn(),
      exec: vi.fn(),
    };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    let callCount = 0;
    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      callCount++;
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("poppy|1000\npatricia|2000");
      }
      if (cmd.includes("identities/poppy/poppy.md")) {
        return Promise.resolve("---\nrole: box-maintainer\n---\n# Poppy\n");
      }
      if (cmd.includes("identities/patricia/patricia.md")) {
        return Promise.resolve("---\nrole: chef\n---\n# Patricia\n");
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{ sessionName: string; role: string | null }>;
    expect(rows).toHaveLength(2);

    const poppy = rows.find((r) => r.sessionName === "poppy");
    expect(poppy?.role).toBe("box-maintainer");

    const patricia = rows.find((r) => r.sessionName === "patricia");
    expect(patricia?.role).toBe("chef");

    // Both list-sessions AND per-identity cat were called on the SAME conn instance
    expect(execCommand).toHaveBeenCalledWith(fakeConn, expect.stringContaining("tmux list-sessions"));
    expect(execCommand).toHaveBeenCalledWith(fakeConn, expect.stringContaining("identities/poppy/poppy.md"));
    expect(execCommand).toHaveBeenCalledWith(fakeConn, expect.stringContaining("identities/patricia/patricia.md"));
    // No second connectOneShot call for per-identity reads
    expect(connectOneShot).toHaveBeenCalledTimes(1);
  });

  it("Test 2 (missing frontmatter): bad frontmatter → role:null, other rows unaffected", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("poppy|1000\nephemeral-work|2000");
      }
      if (cmd.includes("identities/poppy/poppy.md")) {
        return Promise.resolve("---\nrole: box-maintainer\n---\n# Poppy\n");
      }
      if (cmd.includes("identities/ephemeral-work/ephemeral-work.md")) {
        // Return empty — no frontmatter (simulates missing identity file OR no role: key)
        return Promise.resolve("");
      }
      return Promise.resolve("");
    });

    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    const rows = res.body as Array<{ sessionName: string; role: string | null }>;
    expect(rows).toHaveLength(2);

    const poppy = rows.find((r) => r.sessionName === "poppy");
    expect(poppy?.role).toBe("box-maintainer");

    const ephemeral = rows.find((r) => r.sessionName === "ephemeral-work");
    // ephemeral-work has no identity key matching IDENTITY_KEY_RE (contains '-')
    // OR its identity file has no frontmatter → resolveRoleForIdentity throws → role: null
    expect(ephemeral?.role).toBeNull();
  });

  it("Test 3 (per-identity timeout): hung cat → role:null, good row keeps role, response bounded", async () => {
    const fakeConn = { end: vi.fn(), exec: vi.fn() };
    (connectOneShot as Mock).mockResolvedValue(fakeConn);

    (execCommand as Mock).mockImplementation((_conn: unknown, cmd: string): Promise<string> => {
      if (cmd.includes("tmux list-sessions")) {
        return Promise.resolve("poppy|1000\npatricia|2000");
      }
      if (cmd.includes("identities/poppy/poppy.md")) {
        // poppy hangs — returns a promise that never resolves
        return new Promise(() => undefined);
      }
      if (cmd.includes("identities/patricia/patricia.md")) {
        return Promise.resolve("---\nrole: chef\n---\n# Patricia\n");
      }
      return Promise.resolve("");
    });

    makeApp();

    // The response should return within a bounded time (not wait forever for poppy)
    const startMs = Date.now();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });
    const elapsedMs = Date.now() - startMs;

    expect(res.status).toBe(200);
    const rows = res.body as Array<{ sessionName: string; role: string | null }>;
    expect(rows).toHaveLength(2);

    const poppy = rows.find((r) => r.sessionName === "poppy");
    expect(poppy?.role).toBeNull(); // hung → timed out → role: null

    const patricia = rows.find((r) => r.sessionName === "patricia");
    expect(patricia?.role).toBe("chef"); // good row unaffected

    // Should complete well within 2x PER_HOST_TIMEOUT_MS (3000ms), not hang indefinitely
    expect(elapsedMs).toBeLessThan(8000);
  });

  it("Test 4 (host-level failure): connectOneShot throws → host silently dropped, no rows", async () => {
    // connectOneShot throws (whole-host failure — pre-existing behavior preserved)
    (connectOneShot as Mock).mockRejectedValue(new Error("SSH connection refused"));

    // execCommand should never be called (conn was never opened)
    makeApp();
    const res = await httpRequest(server, { method: "GET", path: "/sessions/list" });

    expect(res.status).toBe(200);
    // No rows from the failed host (silently dropped at outer try/catch)
    expect(res.body).toEqual([]);
    expect(execCommand).not.toHaveBeenCalled();
  });
});
