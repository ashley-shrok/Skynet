/**
 * quick-260805-70q (Fix B): Tests for POST /global-files/read tilde-expansion.
 * Extended by inline-fix 2026-08-05 to cover PUT /global-files/write's own
 * tilde-expansion (which had the SAME class of bug on its mtime pre-check,
 * currentContent cat, and post-write re-stat — Ashley UAT of 70q ship caught
 * it via false 409 on every save).
 *
 * Tests exercise POST /global-files/read and PUT /global-files/write via a
 * bare Express app + Node's built-in http module (mirrors
 * roles-list-for-host.test.ts / identity-clone.test.ts patterns — no supertest
 * dependency).
 *
 * READ coverage:
 *   B1: tilde path (~/.claude/CLAUDE.md) → echo $HOME probe fired, cat/stat
 *       use resolved absolute path, 200 response with content/mtime/size
 *   B2: absolute path (/etc/foo/bar) → no echo $HOME probe, cat/stat use
 *       original path unchanged, 200 response
 *   B3: unresolvable HOME (empty string) → 502 { error: "could not resolve remote HOME" }
 *       cat/stat NOT called, conn.end() called
 *   B4: unresolvable HOME (literal ~) → same 502 shape
 *
 * WRITE coverage:
 *   W1: tilde path save with matching expectedMtime → echo $HOME fired ONCE,
 *       mtime pre-check + re-stat both use resolved absolute path (no literal ~),
 *       SFTP write called with absolute path, 200 { mtime } echoed with the
 *       server-authoritative new mtime (NOT 0)
 *   W2: absolute path save → no echo $HOME probe, mtime pre-check + SFTP write +
 *       re-stat all use original path unchanged, 200 { mtime }
 *   W3: tilde path with unresolvable HOME → 502 { error: "could not resolve remote HOME" }
 *       fired BEFORE the mtime pre-check (regression guard: pre-fix, the mtime
 *       check ran first with a raw ~/... and false-triggered a 409)
 *   W4: tilde path with real mtime mismatch → 409 with currentContent read from
 *       the resolved absolute path (NOT empty) — regression guard for the reload
 *       UX Ashley hit that replaced the textarea with "No content in this file yet"
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
import { writeMarkdownFileAtomic } from "../../claude-session/identity-artifact-reader.js";

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

describe("PUT /global-files/write — tilde-expansion (Ashley 2026-08-05 false-409 fix)", () => {
  it("Test W1: tilde path save with matching expectedMtime → 200 { mtime } with real new mtime; SFTP write + all stat/cat use resolved absolute path", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd === "echo $HOME") return "/home/testuser\n";
      // First `stat -c '%Y'` call = mtime pre-check. Second = post-write re-stat.
      // Both return the expectedMtime so the pre-check passes and the re-stat
      // echoes an authoritative value.
      if (cmd.includes("stat -c '%Y'")) return "1700000000\n";
      return "";
    });
    (writeMarkdownFileAtomic as Mock).mockResolvedValue(undefined);

    const res = await httpRequest(server, {
      method: "PUT",
      path: "/global-files/write",
      body: JSON.stringify({
        hostId: 1,
        path: "~/.claude/CLAUDE.md",
        content: "new content\n",
        expectedMtime: 1700000000,
      }),
    });

    expect(res.status).toBe(200);
    const body = res.body as { mtime: number };
    // Regression guard: pre-fix, the re-stat ran against a raw `~/...` and
    // returned 0 → client would then use expectedMtime=0 on the next save
    // and false-trigger a 409 again.
    expect(body.mtime).toBe(1700000000);

    const calls = (execCommand as Mock).mock.calls as [unknown, string][];

    // echo $HOME must have been called exactly ONCE
    const homeCalls = calls.filter(([, cmd]) => cmd === "echo $HOME");
    expect(homeCalls).toHaveLength(1);

    // Every stat/cat must use the resolved absolute path, none the literal ~
    const shellCalls = calls.filter(([, cmd]) =>
      cmd.includes("stat -c") || cmd.includes("cat "),
    );
    expect(shellCalls.length).toBeGreaterThanOrEqual(2); // pre-check stat + post-write stat
    for (const [, cmd] of shellCalls) {
      expect(cmd).toContain("'/home/testuser/.claude/CLAUDE.md'");
      expect(cmd).not.toContain("~");
    }

    // SFTP write must have been called with the resolved absolute path
    expect((writeMarkdownFileAtomic as Mock).mock.calls).toHaveLength(1);
    const [, sftpPath, sftpContent] = (writeMarkdownFileAtomic as Mock).mock
      .calls[0] as [unknown, string, string];
    expect(sftpPath).toBe("/home/testuser/.claude/CLAUDE.md");
    expect(sftpContent).toBe("new content\n");
  });

  it("Test W2: absolute path save → no echo $HOME; SFTP write + all stat/cat use original path unchanged", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd.includes("stat -c '%Y'")) return "1700000042\n";
      return "";
    });
    (writeMarkdownFileAtomic as Mock).mockResolvedValue(undefined);

    const res = await httpRequest(server, {
      method: "PUT",
      path: "/global-files/write",
      body: JSON.stringify({
        hostId: 1,
        path: "/etc/foo/bar",
        content: "abs content\n",
        expectedMtime: 1700000042,
      }),
    });

    expect(res.status).toBe(200);
    const body = res.body as { mtime: number };
    expect(body.mtime).toBe(1700000042);

    const calls = (execCommand as Mock).mock.calls as [unknown, string][];

    // echo $HOME must NOT have been called
    const homeCall = calls.find(([, cmd]) => cmd === "echo $HOME");
    expect(homeCall).toBeUndefined();

    // stat/cat must use the original absolute path
    const shellCalls = calls.filter(([, cmd]) =>
      cmd.includes("stat -c") || cmd.includes("cat "),
    );
    for (const [, cmd] of shellCalls) {
      expect(cmd).toContain("'/etc/foo/bar'");
    }

    // SFTP write receives the original absolute path
    const [, sftpPath] = (writeMarkdownFileAtomic as Mock).mock.calls[0] as [
      unknown,
      string,
    ];
    expect(sftpPath).toBe("/etc/foo/bar");
  });

  it("Test W3: tilde path with unresolvable HOME → 502 BEFORE mtime pre-check (regression guard for false-409 root cause)", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd === "echo $HOME") return "";
      return "should-not-be-reached";
    });
    (writeMarkdownFileAtomic as Mock).mockResolvedValue(undefined);

    const res = await httpRequest(server, {
      method: "PUT",
      path: "/global-files/write",
      body: JSON.stringify({
        hostId: 1,
        path: "~/foo",
        content: "whatever",
        expectedMtime: 1700000000,
      }),
    });

    expect(res.status).toBe(502);
    const body = res.body as { error: string };
    expect(body.error).toBe("could not resolve remote HOME");

    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    // Only echo $HOME — no stat pre-check, no cat, no SFTP write
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe("echo $HOME");
    expect((writeMarkdownFileAtomic as Mock).mock.calls).toHaveLength(0);
  });

  it("Test W4: tilde path with real mtime mismatch → 409 with currentContent from resolved absolute path (not empty)", async () => {
    // Simulate the file changing on disk since the client read it:
    // expectedMtime=1700000000, actual stat returns 1700000999
    // currentContent must be the REAL content read from the resolved path,
    // NOT an empty string (which is what pre-fix would return because
    // `cat '~/...'` finds no file).
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd === "echo $HOME") return "/home/testuser\n";
      if (cmd.includes("stat -c '%Y'")) return "1700000999\n";
      if (cmd.includes("cat ")) return "actual disk content\n";
      return "";
    });

    const res = await httpRequest(server, {
      method: "PUT",
      path: "/global-files/write",
      body: JSON.stringify({
        hostId: 1,
        path: "~/.claude/CLAUDE.md",
        content: "my draft edit",
        expectedMtime: 1700000000,
      }),
    });

    expect(res.status).toBe(409);
    const body = res.body as {
      error: string;
      currentMtime: number;
      currentContent: string;
    };
    expect(body.error).toBe("mtime mismatch");
    expect(body.currentMtime).toBe(1700000999);
    // Regression guard: pre-fix, this was "" because cat ran against a
    // literal `~/...` and returned nothing; that empty payload landed in
    // the modal's reload UX and replaced the textarea with the "No content
    // in this file yet" empty-state message. Post-fix, real content flows.
    expect(body.currentContent).toBe("actual disk content\n");

    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    // Both the stat and the cat must have used the resolved absolute path
    const catCall = calls.find(([, cmd]) => cmd.includes("cat "));
    expect(catCall).toBeDefined();
    expect(catCall![1]).toContain("'/home/testuser/.claude/CLAUDE.md'");
    expect(catCall![1]).not.toContain("~");

    // SFTP write must NOT have been called — 409 short-circuits before write
    expect((writeMarkdownFileAtomic as Mock).mock.calls).toHaveLength(0);
  });
});
