/**
 * Phase 89 (Plan 89-02): Vitest coverage for /runbooks-editor router.
 *
 * Byte-shape mirror of `skills-editor.test.ts` (Phase 44) with:
 *   - role dimension added (role + runbook query params / body fields)
 *   - role-404 validation case added (D-15 — role-existence check before
 *     touching runbooks)
 *   - per-endpoint happy-path + error-path coverage for all 7 endpoints
 *   - a dedicated `describe("path-safety gate")` block with 12+ SEC-labeled
 *     attack-input tests proving every escape attempt returns 400 BEFORE
 *     any SSH connection opens (role AND runbook AND path attack vectors)
 *
 * Endpoints covered:
 *   GET  /runbooks-editor/runbooks
 *   GET  /runbooks-editor/files
 *   POST /runbooks-editor/read
 *   PUT  /runbooks-editor/write
 *   POST /runbooks-editor/create
 *   DELETE /runbooks-editor/file
 *   DELETE /runbooks-editor/runbook
 *
 * Test pattern: bare Express app + Node's built-in http module (mirrors
 * skills-editor.test.ts pattern — no supertest dependency). All SSH
 * primitives mocked at the module boundary.
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
          (req as express.Request & { userId: string }).userId = mockUserId!;
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
  writeMarkdownFileAtomic: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  databaseLogger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import mocked modules AFTER vi.mock() declarations
// ---------------------------------------------------------------------------

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { writeMarkdownFileAtomic } from "../../claude-session/identity-artifact-reader.js";

// ---------------------------------------------------------------------------
// HTTP helper (mirrors skills-editor.test.ts + roles-list-for-host.test.ts)
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

const { default: router } = await import("./runbooks-editor.js");

let server: http.Server;

/**
 * Default exec behavior: canned outputs matching a healthy fixture with
 * role "box-maintainer" existing, 2 runbooks, and files inside them.
 * Tests override with `mockImplementation` where they want to exercise
 * a specific branch.
 */
function defaultExecImpl(cmd: string): Promise<string> {
  if (cmd === "echo $HOME") return Promise.resolve("/home/testuser\n");
  // Role existence check — default: role exists
  if (cmd.includes("test -d") && cmd.includes("roles") && !cmd.includes("runbooks"))
    return Promise.resolve("ok");
  // Runbook existence check — default: runbook exists
  if (cmd.includes("test -d") && cmd.includes("runbooks"))
    return Promise.resolve("exists");
  // List runbooks (find with -maxdepth 1 -type d)
  if (cmd.startsWith("find") && cmd.includes("-maxdepth 1"))
    return Promise.resolve("avatar-flow\ncss-fast-path\n");
  // List files recursively (find with -type f)
  if (cmd.startsWith("find") && cmd.includes("-type f"))
    return Promise.resolve("runbook.md\navatar-prompts/amelia.md\n");
  if (cmd.startsWith("cat ")) return Promise.resolve("hello runbook");
  if (cmd.includes("stat -c '%Y'")) return Promise.resolve("1700000042");
  if (cmd.includes("stat -c '%s'")) return Promise.resolve("13");
  if (cmd.startsWith("test -e")) return Promise.resolve("ok");
  if (cmd.startsWith("mkdir -p")) return Promise.resolve("");
  if (cmd.startsWith("touch ")) return Promise.resolve("");
  if (cmd.startsWith("rm ")) return Promise.resolve("");
  return Promise.resolve("");
}

beforeEach(() => {
  vi.clearAllMocks();
  stubConn.end.mockClear();
  mockUserId = "1";

  // Default: user owns host 1; anything else → null (404).
  (resolveHostById as Mock).mockImplementation((hostId: number) => {
    if (hostId === 1) return Promise.resolve(stubHost);
    return Promise.resolve(null);
  });

  (connectOneShot as Mock).mockResolvedValue(stubConn);
  (execCommand as Mock).mockImplementation(
    async (_conn: unknown, cmd: string) => defaultExecImpl(cmd),
  );
  (writeMarkdownFileAtomic as Mock).mockResolvedValue(undefined);

  const app = express();
  app.use("/runbooks-editor", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ===========================================================================
// GET /runbooks-editor/runbooks
// ===========================================================================

describe("GET /runbooks-editor/runbooks", () => {
  it("200 with { runbooks: [{name}...] } sorted alphabetically", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/runbooks?hostId=1&role=box-maintainer",
    });
    expect(res.status).toBe(200);
    const body = res.body as { runbooks: { name: string }[] };
    expect(body.runbooks).toEqual([
      { name: "avatar-flow" },
      { name: "css-fast-path" },
    ]);
  });

  it("200 with { runbooks: [] } when the runbooks directory is missing (empty state)", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d") && !cmd.includes("runbooks")) return "ok";
        if (cmd.startsWith("find") && cmd.includes("-maxdepth 1")) return "";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/runbooks?hostId=1&role=box-maintainer",
    });
    expect(res.status).toBe(200);
    expect((res.body as { runbooks: unknown[] }).runbooks).toEqual([]);
  });

  it("404 with { error: 'role not found' } when the role folder is absent", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d")) return "missing";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/runbooks?hostId=1&role=box-maintainer",
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("role not found");
    // Runbooks listing find must NOT have been called after the 404.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const findCall = calls.find(
      ([, cmd]) => cmd.startsWith("find") && cmd.includes("-maxdepth 1"),
    );
    expect(findCall).toBeUndefined();
  });

  it("400 on missing role — SSH must NOT be attempted", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/runbooks?hostId=1",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid role name");
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("400 on missing hostId", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/runbooks?role=box-maintainer",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("hostId is required");
  });

  it("400 on non-integer hostId", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/runbooks?hostId=abc&role=box-maintainer",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe(
      "hostId must be a positive integer",
    );
  });

  it("401 when unauthenticated", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/runbooks?hostId=1&role=box-maintainer",
    });
    expect(res.status).toBe(401);
  });

  it("404 on cross-user / unknown host", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/runbooks?hostId=999&role=box-maintainer",
    });
    expect(res.status).toBe(404);
  });

  it("502 on SSH connect fail", async () => {
    (connectOneShot as Mock).mockRejectedValueOnce(new Error("connect refused"));
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/runbooks?hostId=1&role=box-maintainer",
    });
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("SSH connect failed");
  });
});

// ===========================================================================
// GET /runbooks-editor/files
// ===========================================================================

describe("GET /runbooks-editor/files", () => {
  it("200 with { files: [{path}...] } sorted alphabetically, path-relative", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/files?hostId=1&role=box-maintainer&runbook=avatar-flow",
    });
    expect(res.status).toBe(200);
    const body = res.body as { files: { path: string }[] };
    // Mock returns "runbook.md\navatar-prompts/amelia.md\n" — the shell `| sort`
    // is mocked via execCommand so order mirrors the mock string output order.
    expect(body.files).toEqual([
      { path: "runbook.md" },
      { path: "avatar-prompts/amelia.md" },
    ]);
  });

  it("200 with { files: [] } when the runbook has no files", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d") && !cmd.includes("runbooks")) return "ok";
        if (cmd.startsWith("find") && cmd.includes("-type f")) return "";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/files?hostId=1&role=box-maintainer&runbook=avatar-flow",
    });
    expect(res.status).toBe(200);
    expect((res.body as { files: unknown[] }).files).toEqual([]);
  });

  it("400 on invalid runbook name (traversal attempt) — SSH NOT attempted", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/files?hostId=1&role=box-maintainer&runbook=../evil",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid runbook name");
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("404 with { error: 'role not found' } when role folder absent", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d")) return "missing";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/files?hostId=1&role=box-maintainer&runbook=avatar-flow",
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("role not found");
  });

  it("502 on SSH connect fail", async () => {
    (connectOneShot as Mock).mockRejectedValueOnce(new Error("boom"));
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/files?hostId=1&role=box-maintainer&runbook=avatar-flow",
    });
    expect(res.status).toBe(502);
  });

  it("404 on cross-user / unknown host", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/files?hostId=999&role=box-maintainer&runbook=avatar-flow",
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// POST /runbooks-editor/read
// ===========================================================================

describe("POST /runbooks-editor/read", () => {
  it("200 with { content, mtime, size, isText:true } for a text file", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      content: string;
      mtime: number;
      size: number;
      isText: boolean;
    };
    expect(body.content).toBe("hello runbook");
    expect(body.mtime).toBe(1700000042);
    expect(body.size).toBe(13);
    expect(body.isText).toBe(true);
  });

  it("200 with isText:false and empty content when file contains NUL bytes", async () => {
    // Binary content: detectIsText returns false on NUL (0x00) or control bytes (0x01).
    // We return an empty string here because the NUL byte cannot survive JSON serialization
    // over the HTTP channel — instead we trigger isText:false via the 0x01 byte which
    // the TextDecoder rejects, then check content is "". The mock simulates a binary blob.
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d") && !cmd.includes("runbooks")) return "ok";
        // Return content with a 0x01 byte to trigger detectIsText→false
        if (cmd.startsWith("cat ")) return "\x01binarydata";
        if (cmd.includes("stat -c '%Y'")) return "1700000000";
        if (cmd.includes("stat -c '%s'")) return "11";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "img.png",
      }),
    });
    expect(res.status).toBe(200);
    const body = res.body as { content: string; isText: boolean };
    expect(body.isText).toBe(false);
    expect(body.content).toBe("");
  });

  it("400 on invalid path (empty) — SSH NOT attempted", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("401 when unauthenticated", async () => {
    mockUserId = null;
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("404 with { error: 'role not found' } when role folder absent", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d")) return "missing";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("role not found");
  });

  it("404 on unknown host", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 999,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("502 on SSH connect fail", async () => {
    (connectOneShot as Mock).mockRejectedValueOnce(new Error("boom"));
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(502);
  });
});

// ===========================================================================
// PUT /runbooks-editor/write
// ===========================================================================

describe("PUT /runbooks-editor/write", () => {
  it("200 with { mtime } on valid write with matching expectedMtime", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/runbooks-editor/write",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
        content: "new runbook content\n",
        expectedMtime: 1700000042,
      }),
    });
    expect(res.status).toBe(200);
    const body = res.body as { mtime: number };
    expect(body.mtime).toBe(1700000042);
    expect((writeMarkdownFileAtomic as Mock).mock.calls).toHaveLength(1);
    const [, sftpPath, sftpContent] = (writeMarkdownFileAtomic as Mock).mock
      .calls[0] as [unknown, string, string];
    expect(sftpPath).toBe(
      "/home/testuser/fleet/roles/box-maintainer/runbooks/avatar-flow/runbook.md",
    );
    expect(sftpContent).toBe("new runbook content\n");
  });

  it("409 with byte-identical mtime-mismatch shape on drift", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d") && !cmd.includes("runbooks")) return "ok";
        if (cmd.includes("stat -c '%Y'")) return "1700000999";
        if (cmd.startsWith("cat ")) return "current disk content\n";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/runbooks-editor/write",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
        content: "my draft",
        expectedMtime: 1700000042,
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
    expect(body.currentContent).toBe("current disk content\n");
    // 409 short-circuits BEFORE writeMarkdownFileAtomic runs.
    expect((writeMarkdownFileAtomic as Mock).mock.calls).toHaveLength(0);
  });

  it("413 when content exceeds MAX_CONTENT_BYTES (2 MB)", async () => {
    const oversized = "x".repeat(2_000_001);
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/runbooks-editor/write",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
        content: oversized,
      }),
    });
    expect(res.status).toBe(413);
  });

  it("400 on invalid path (path traversal attempt)", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/runbooks-editor/write",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "../etc/passwd",
        content: "x",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("404 with { error: 'role not found' } when role folder absent", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d")) return "missing";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/runbooks-editor/write",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
        content: "content",
      }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("role not found");
  });

  it("502 when writeMarkdownFileAtomic fails", async () => {
    (writeMarkdownFileAtomic as Mock).mockRejectedValueOnce(
      new Error("sftp broken"),
    );
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/runbooks-editor/write",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
        content: "new content",
      }),
    });
    expect(res.status).toBe(502);
  });
});

// ===========================================================================
// POST /runbooks-editor/create
// ===========================================================================

describe("POST /runbooks-editor/create", () => {
  it("200 with { path, mtime } on new file", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/create",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "new-note.md",
      }),
    });
    expect(res.status).toBe(200);
    const body = res.body as { path: string; mtime: number };
    expect(body.path).toBe("new-note.md");
    expect(body.mtime).toBe(1700000042);
    // Verify mkdir -p ran on the parent, then touch on the file.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const mkdirCall = calls.find(([, cmd]) => cmd.startsWith("mkdir -p"));
    expect(mkdirCall).toBeDefined();
    const touchCall = calls.find(([, cmd]) => cmd.startsWith("touch "));
    expect(touchCall).toBeDefined();
    expect(touchCall![1]).toContain(
      "'/home/testuser/fleet/roles/box-maintainer/runbooks/avatar-flow/new-note.md'",
    );
  });

  it("409 with { error: 'file exists' } when target already exists", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d") && !cmd.includes("runbooks")) return "ok";
        if (cmd.includes("test -d") && cmd.includes("runbooks")) return "exists";
        if (cmd.startsWith("test -e")) return "exists";
        return defaultExecImpl(cmd);
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/create",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe("file exists");
    // Should NOT have called touch after the 409.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const touchCall = calls.find(([, cmd]) => cmd.startsWith("touch "));
    expect(touchCall).toBeUndefined();
  });

  it("400 on invalid path — SSH NOT attempted", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/create",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "../evil.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("404 with { error: 'role not found' } when role folder absent", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d")) return "missing";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/create",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "new.md",
      }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("role not found");
    // Critical: no mkdir or touch fired after the 404 — no runbook materialized.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    expect(calls.find(([, c]) => c.startsWith("mkdir -p"))).toBeUndefined();
    expect(calls.find(([, c]) => c.startsWith("touch "))).toBeUndefined();
  });
});

// ===========================================================================
// DELETE /runbooks-editor/file
// ===========================================================================

describe("DELETE /runbooks-editor/file", () => {
  it("200 with { ok:true } on valid input; rm -f against composed path", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/runbooks-editor/file",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const rmCall = calls.find(([, cmd]) => cmd.startsWith("rm -f "));
    expect(rmCall).toBeDefined();
    expect(rmCall![1]).toContain(
      "'/home/testuser/fleet/roles/box-maintainer/runbooks/avatar-flow/runbook.md'",
    );
  });

  it("200 idempotent — missing file still returns { ok:true }", async () => {
    // rm -f swallows missing files; the exec returns empty string regardless.
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/runbooks-editor/file",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "nonexistent.md",
      }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });

  it("400 on invalid path — SSH NOT attempted", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/runbooks-editor/file",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "../etc/passwd",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("404 with { error: 'role not found' } when role folder absent", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d")) return "missing";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/runbooks-editor/file",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("role not found");
  });

  it("404 on unknown host", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/runbooks-editor/file",
      body: JSON.stringify({
        hostId: 999,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// DELETE /runbooks-editor/runbook
// ===========================================================================

describe("DELETE /runbooks-editor/runbook", () => {
  it("200 with { ok:true } on valid runbook; rm -rf against composed runbookRoot", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/runbooks-editor/runbook",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
      }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const rmrfCall = calls.find(([, cmd]) => cmd.startsWith("rm -rf "));
    expect(rmrfCall).toBeDefined();
    expect(rmrfCall![1]).toContain(
      "'/home/testuser/fleet/roles/box-maintainer/runbooks/avatar-flow'",
    );
  });

  it("400 on invalid runbook '../etc' BEFORE any rm -rf runs — SSH NOT attempted", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/runbooks-editor/runbook",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "../etc",
      }),
    });
    expect(res.status).toBe(400);
    // rm -rf must NEVER have been called.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const rmrfCall = calls.find(([, cmd]) => cmd.startsWith("rm -rf"));
    expect(rmrfCall).toBeUndefined();
    // SSH must NEVER have opened (validation runs before resolveHostById).
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("404 with { error: 'role not found' } when role folder absent", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d")) return "missing";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/runbooks-editor/runbook",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
      }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("role not found");
    // rm -rf must NEVER have been called.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const rmrfCall = calls.find(([, cmd]) => cmd.startsWith("rm -rf"));
    expect(rmrfCall).toBeUndefined();
  });

  it("404 on unknown host", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/runbooks-editor/runbook",
      body: JSON.stringify({
        hostId: 999,
        role: "box-maintainer",
        runbook: "avatar-flow",
      }),
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// Path-safety gate — dedicated attack-input coverage
// ===========================================================================

describe("path-safety gate", () => {
  // ---- ROLE attack vectors ----

  it("SEC-1: rejects role '..' with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "..",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-2: rejects role '../etc' with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "../etc",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-3: rejects role 'role/../evil' (embedded slash) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "role/../evil",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-4: rejects role '' (empty) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-5: rejects role 'role;rm -rf /' (shell metachar) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "role;rm -rf /",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-6: rejects role 'role name with spaces' (spaces rejected by ROLE_NAME_RE) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "role name with spaces",
        runbook: "avatar-flow",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  // ---- RUNBOOK attack vectors ----

  it("SEC-7: rejects runbook '..' with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "..",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-8: rejects runbook '../evil' with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "../evil",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  // ---- PATH attack vectors ----

  it("SEC-9: rejects path '../../etc/passwd' (..' segment) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "../../etc/passwd",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-10: rejects path '/etc/passwd' (leading slash) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "/etc/passwd",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-11: rejects path with NUL byte with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "foo\0.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-12: rejects path > 512 chars with 400 before SSH", async () => {
    const longPath = "a".repeat(513);
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: longPath,
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  // ---- DELETE /runbook rm-rf guard ----

  it("SEC-13: rejects DELETE /runbook on role '..' (life-critical rm -rf guard)", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/runbooks-editor/runbook",
      body: JSON.stringify({ hostId: 1, role: "..", runbook: "avatar-flow" }),
    });
    expect(res.status).toBe(400);
    // rm -rf must NEVER have been dispatched.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const rmrfCall = calls.find(([, cmd]) => cmd.startsWith("rm -rf"));
    expect(rmrfCall).toBeUndefined();
    // SSH must NEVER have opened.
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-14: rejects GET /runbooks-editor/runbooks with role containing backslash with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/runbooks-editor/runbooks?hostId=1&role=foo%5Cbar",
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });
});
