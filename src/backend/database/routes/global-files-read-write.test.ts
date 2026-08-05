/**
 * quick-260805-70q (Fix B): Tests for POST /global-files/read tilde-expansion.
 *
 * Tests exercise POST /global-files/read via a bare Express app + Node's
 * built-in http module (mirrors roles-list-for-host.test.ts / identity-clone.test.ts
 * patterns — no supertest dependency).
 *
 * Coverage:
 *   B1: tilde path (~/.claude/CLAUDE.md) → echo $HOME probe fired, cat/stat
 *       use resolved absolute path, 200 response with content/mtime/size
 *   B2: absolute path (/etc/foo/bar) → no echo $HOME probe, cat/stat use
 *       original path unchanged, 200 response
 *   B3: unresolvable HOME (empty string) → 502 { error: "could not resolve remote HOME" }
 *       cat/stat NOT called, conn.end() called
 *   B4: unresolvable HOME (literal ~) → same 502 shape
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
// Mock global-files config loader (whitelist gate runs BEFORE SSH)
// ---------------------------------------------------------------------------

vi.mock("./global-files-config-loader.js", () => ({
  loadGlobalFilesConfig: vi.fn(),
  getFilesForHost: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock identity-artifact-reader (imported by the source; not used by READ,
// but must be mocked to prevent transitive SFTP setup from firing)
// ---------------------------------------------------------------------------

vi.mock("../../claude-session/identity-artifact-reader.js", () => ({
  writeMarkdownFileAtomic: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock logger (prevent sshLogger.warn/error from throwing or printing noise)
// ---------------------------------------------------------------------------

vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  databaseLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { loadGlobalFilesConfig, getFilesForHost } from "./global-files-config-loader.js";

// ---------------------------------------------------------------------------
// HTTP helper (mirrors roles-list-for-host.test.ts + identity-clone.test.ts)
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
  id: 1,
  name: "hostA",
  ip: "10.0.0.1",
  port: 22,
  username: "ubuntu",
  authType: "password" as const,
  password: "secret",
};

// ---------------------------------------------------------------------------
// Import the router under test (dynamic import AFTER vi.mock() declarations)
// ---------------------------------------------------------------------------

const { default: router } = await import("./global-files-read-write.js");

let server: http.Server;

beforeEach(() => {
  vi.clearAllMocks();
  stubConn.end.mockClear();
  mockUserId = "1";

  // Default: user owns host 1; anything else → null
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 1) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  (connectOneShot as Mock).mockResolvedValue(stubConn);

  // Default config + whitelist: all test paths are whitelisted
  (loadGlobalFilesConfig as Mock).mockResolvedValue({});
  (getFilesForHost as Mock).mockReturnValue([
    { path: "~/.claude/CLAUDE.md" },
    { path: "/etc/foo/bar" },
    { path: "~/foo" },
  ]);

  const app = express();
  app.use("/global-files", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /global-files/read — tilde-expansion", () => {
  it("Test B1: tilde path resolves via echo $HOME; cat/stat use absolute path", async () => {
    // execCommand branches: echo $HOME → resolved home; cat/stat → stubs
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd === "echo $HOME") return "/home/testuser\n";
      if (cmd.includes("cat ")) return "hello\n";
      if (cmd.includes("stat -c '%Y'")) return "1700000000\n";
      if (cmd.includes("stat -c '%s'")) return "5\n";
      return "";
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/global-files/read",
      body: JSON.stringify({ hostId: 1, path: "~/.claude/CLAUDE.md" }),
    });

    expect(res.status).toBe(200);
    const body = res.body as { content: string; mtime: number; size: number };
    expect(body.content).toBe("hello\n");
    expect(body.mtime).toBe(1700000000);
    expect(body.size).toBe(5);

    // echo $HOME must have been called
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const homeCall = calls.find(([, cmd]) => cmd === "echo $HOME");
    expect(homeCall).toBeDefined();

    // cat/stat must use the resolved absolute path (not a literal ~)
    const catCall = calls.find(([, cmd]) => cmd.includes("cat "));
    expect(catCall).toBeDefined();
    expect(catCall![1]).toContain("'/home/testuser/.claude/CLAUDE.md'");
    expect(catCall![1]).not.toContain("~");

    const mtimeCall = calls.find(([, cmd]) => cmd.includes("stat -c '%Y'"));
    expect(mtimeCall).toBeDefined();
    expect(mtimeCall![1]).toContain("'/home/testuser/.claude/CLAUDE.md'");
    expect(mtimeCall![1]).not.toContain("~");
  });

  it("Test B2: absolute path passes through unchanged; no echo $HOME fired", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("cat ")) return "bar-content\n";
      if (cmd.includes("stat -c '%Y'")) return "1700000001\n";
      if (cmd.includes("stat -c '%s'")) return "12\n";
      return "";
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/global-files/read",
      body: JSON.stringify({ hostId: 1, path: "/etc/foo/bar" }),
    });

    expect(res.status).toBe(200);
    const body = res.body as { content: string; mtime: number; size: number };
    expect(body.content).toBe("bar-content\n");

    const calls = (execCommand as Mock).mock.calls as [unknown, string][];

    // echo $HOME must NOT have been called
    const homeCall = calls.find(([, cmd]) => cmd === "echo $HOME");
    expect(homeCall).toBeUndefined();

    // cat must use the original absolute path
    const catCall = calls.find(([, cmd]) => cmd.includes("cat "));
    expect(catCall).toBeDefined();
    expect(catCall![1]).toContain("'/etc/foo/bar'");
    expect(catCall![1]).not.toContain("$HOME");
  });

  it("Test B3: unresolvable HOME (empty string) → 502; cat/stat not called; conn.end() called", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd === "echo $HOME") return "";
      // cat/stat should NOT be called — if they are, the test will catch via
      // the assertion below on execCommand call count
      return "should-not-be-reached";
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/global-files/read",
      body: JSON.stringify({ hostId: 1, path: "~/foo" }),
    });

    expect(res.status).toBe(502);
    const body = res.body as { error: string };
    expect(body.error).toBe("could not resolve remote HOME");

    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    // Only the echo $HOME call should have been made
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe("echo $HOME");

    // conn.end() must still be called (best-effort cleanup)
    expect(stubConn.end).toHaveBeenCalledTimes(1);
  });

  it("Test B4: unresolvable HOME (literal ~) → 502 same shape", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd === "echo $HOME") return "~\n";
      return "should-not-be-reached";
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/global-files/read",
      body: JSON.stringify({ hostId: 1, path: "~/foo" }),
    });

    expect(res.status).toBe(502);
    const body = res.body as { error: string };
    expect(body.error).toBe("could not resolve remote HOME");

    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    // Only the echo $HOME call should have been made
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe("echo $HOME");
  });
});
