/**
 * Vitest coverage for the /role-skills-editor router (Phase 89).
 *
 * Byte-shape mirror of `skills-editor.test.ts` (Phase 44) with:
 *   - role dimension added (role + role skill query params / body fields)
 *   - role-404 validation case added (D-15 — role-existence check before
 *     touching role skills)
 *   - per-endpoint happy-path + error-path coverage for all 7 endpoints
 *   - a dedicated `describe("path-safety gate")` block with 12+ SEC-labeled
 *     attack-input tests proving every escape attempt returns 400 BEFORE
 *     any SSH connection opens (role AND role skill AND path attack vectors)
 *
 * Endpoints covered:
 *   GET  /role-skills-editor/skills
 *   GET  /role-skills-editor/files
 *   POST /role-skills-editor/read
 *   PUT  /role-skills-editor/write
 *   POST /role-skills-editor/create
 *   DELETE /role-skills-editor/file
 *   DELETE /role-skills-editor/skill
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
import { Readable } from "node:stream";
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
  stringifyColorHueForYaml: (obj: Record<string, unknown>) => (typeof obj.colorHue === "number" ? { ...obj, colorHue: String(obj.colorHue) } : obj),
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

const { default: router } = await import("./role-skills-editor.js");

let server: http.Server;

/**
 * Default exec behavior: canned outputs matching a healthy fixture with
 * role "box-maintainer" existing, 2 role skills, and files inside them.
 * Tests override with `mockImplementation` where they want to exercise
 * a specific branch.
 */
function isRunbookFolderCheck(cmd: string): boolean {
  return cmd.startsWith("test -e") && cmd.endsWith("echo missing");
}

function defaultExecImpl(cmd: string): Promise<string> {
  if (cmd === "echo $HOME") return Promise.resolve("/home/testuser\n");
  // Role existence check — default: role exists
  if (cmd.includes("test -d") && cmd.includes("roles") && !cmd.includes("/skills/"))
    return Promise.resolve("ok");
  // Role skill existence check — default: role skill exists
  if (cmd.includes("test -d") && cmd.includes("/skills/"))
    return Promise.resolve("exists");
  // List role skills (find with -maxdepth 1 -type d)
  if (cmd.startsWith("find") && cmd.includes("-maxdepth 1"))
    return Promise.resolve("avatar-flow\ncss-fast-path\n");
  // List files recursively (find with -type f)
  if (cmd.startsWith("find") && cmd.includes("-type f"))
    return Promise.resolve("role skill.md\navatar-prompts/amelia.md\n");
  if (cmd.startsWith("cat ")) return Promise.resolve("hello role skill");
  if (cmd.includes("stat -c '%Y'")) return Promise.resolve("1700000042");
  if (cmd.includes("stat -c '%s'")) return Promise.resolve("13");
  // POST /create's runbook-folder check (`test -e <runbookRoot> && echo
  // exists || echo missing`) — default: the runbook exists.
  if (isRunbookFolderCheck(cmd)) return Promise.resolve("exists");
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
  app.use("/role-skills-editor", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ===========================================================================
// GET /role-skills-editor/skills
// ===========================================================================

describe("GET /role-skills-editor/skills", () => {
  it("200 with { skills: [{name}...] } sorted alphabetically", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/role-skills-editor/skills?hostId=1&role=box-maintainer",
    });
    expect(res.status).toBe(200);
    const body = res.body as { skills: { name: string }[] };
    expect(body.skills).toEqual([
      { name: "avatar-flow" },
      { name: "css-fast-path" },
    ]);
  });

  it("200 with { skills: [] } when the role skills directory is missing (empty state)", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d") && !cmd.includes("/skills/")) return "ok";
        if (cmd.startsWith("find") && cmd.includes("-maxdepth 1")) return "";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/role-skills-editor/skills?hostId=1&role=box-maintainer",
    });
    expect(res.status).toBe(200);
    expect((res.body as { skills: unknown[] }).skills).toEqual([]);
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
      path: "/role-skills-editor/skills?hostId=1&role=box-maintainer",
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("role not found");
    // Role skills listing find must NOT have been called after the 404.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const findCall = calls.find(
      ([, cmd]) => cmd.startsWith("find") && cmd.includes("-maxdepth 1"),
    );
    expect(findCall).toBeUndefined();
  });

  it("400 on missing role — SSH must NOT be attempted", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/role-skills-editor/skills?hostId=1",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid role name");
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("400 on missing hostId", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/role-skills-editor/skills?role=box-maintainer",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("hostId is required");
  });

  it("400 on non-integer hostId", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/role-skills-editor/skills?hostId=abc&role=box-maintainer",
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
      path: "/role-skills-editor/skills?hostId=1&role=box-maintainer",
    });
    expect(res.status).toBe(401);
  });

  it("404 on cross-user / unknown host", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/role-skills-editor/skills?hostId=999&role=box-maintainer",
    });
    expect(res.status).toBe(404);
  });

  it("502 on SSH connect fail", async () => {
    (connectOneShot as Mock).mockRejectedValueOnce(new Error("connect refused"));
    const res = await httpRequest(server, {
      method: "GET",
      path: "/role-skills-editor/skills?hostId=1&role=box-maintainer",
    });
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("SSH connect failed");
  });
});

// ===========================================================================
// GET /role-skills-editor/files
// ===========================================================================

describe("GET /role-skills-editor/files", () => {
  it("200 with { files: [{path}...] } sorted alphabetically, path-relative", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/role-skills-editor/files?hostId=1&role=box-maintainer&skill=avatar-flow",
    });
    expect(res.status).toBe(200);
    const body = res.body as { files: { path: string }[] };
    // Mock returns "role skill.md\navatar-prompts/amelia.md\n" — the shell `| sort`
    // is mocked via execCommand so order mirrors the mock string output order.
    expect(body.files).toEqual([
      { path: "role skill.md" },
      { path: "avatar-prompts/amelia.md" },
    ]);
  });

  it("200 with { files: [] } when the role skill has no files", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d") && !cmd.includes("/skills/")) return "ok";
        if (cmd.startsWith("find") && cmd.includes("-type f")) return "";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "GET",
      path: "/role-skills-editor/files?hostId=1&role=box-maintainer&skill=avatar-flow",
    });
    expect(res.status).toBe(200);
    expect((res.body as { files: unknown[] }).files).toEqual([]);
  });

  it("400 on invalid role skill name (traversal attempt) — SSH NOT attempted", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/role-skills-editor/files?hostId=1&role=box-maintainer&skill=../evil",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("invalid skill name");
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
      path: "/role-skills-editor/files?hostId=1&role=box-maintainer&skill=avatar-flow",
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("role not found");
  });

  it("502 on SSH connect fail", async () => {
    (connectOneShot as Mock).mockRejectedValueOnce(new Error("boom"));
    const res = await httpRequest(server, {
      method: "GET",
      path: "/role-skills-editor/files?hostId=1&role=box-maintainer&skill=avatar-flow",
    });
    expect(res.status).toBe(502);
  });

  it("404 on cross-user / unknown host", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/role-skills-editor/files?hostId=999&role=box-maintainer&skill=avatar-flow",
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// POST /role-skills-editor/read
// ===========================================================================

describe("POST /role-skills-editor/read", () => {
  it("200 with { content, mtime, size, isText:true } for a text file", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      content: string;
      mtime: number;
      size: number;
      isText: boolean;
    };
    expect(body.content).toBe("hello role skill");
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
        if (cmd.includes("test -d") && !cmd.includes("/skills/")) return "ok";
        // Return content with a 0x01 byte to trigger detectIsText→false
        if (cmd.startsWith("cat ")) return "\x01binarydata";
        if (cmd.includes("stat -c '%Y'")) return "1700000000";
        if (cmd.includes("stat -c '%s'")) return "11";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
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
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
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
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
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
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("role not found");
  });

  it("404 on unknown host", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 999,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("502 on SSH connect fail", async () => {
    (connectOneShot as Mock).mockRejectedValueOnce(new Error("boom"));
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(502);
  });
});

// ===========================================================================
// PUT /role-skills-editor/write
// ===========================================================================

describe("PUT /role-skills-editor/write", () => {
  it("200 with { mtime } on valid write with matching expectedMtime", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/role-skills-editor/write",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
        content: "new role skill content\n",
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
      "/home/testuser/fleet/roles/box-maintainer/skills/avatar-flow/role skill.md",
    );
    expect(sftpContent).toBe("new role skill content\n");
  });

  it("409 with byte-identical mtime-mismatch shape on drift", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d") && !cmd.includes("/skills/")) return "ok";
        if (cmd.includes("stat -c '%Y'")) return "1700000999";
        if (cmd.startsWith("cat ")) return "current disk content\n";
        return "";
      },
    );
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/role-skills-editor/write",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
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
      path: "/role-skills-editor/write",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
        content: oversized,
      }),
    });
    expect(res.status).toBe(413);
  });

  it("400 on invalid path (path traversal attempt)", async () => {
    const res = await httpRequest(server, {
      method: "PUT",
      path: "/role-skills-editor/write",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
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
      path: "/role-skills-editor/write",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
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
      path: "/role-skills-editor/write",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
        content: "new content",
      }),
    });
    expect(res.status).toBe(502);
  });
});

// ===========================================================================
// POST /role-skills-editor/create
// ===========================================================================

describe("POST /role-skills-editor/create", () => {
  it("200 with { path, mtime } on new file", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/create",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
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
      "'/home/testuser/fleet/roles/box-maintainer/skills/avatar-flow/new-note.md'",
    );
  });

  it("409 with { error: 'file exists' } when target already exists", async () => {
    (execCommand as Mock).mockImplementation(
      async (_conn: unknown, cmd: string) => {
        if (cmd === "echo $HOME") return "/home/testuser\n";
        if (cmd.includes("test -d") && !cmd.includes("/skills/")) return "ok";
        if (cmd.includes("test -d") && cmd.includes("/skills/")) return "exists";
        if (cmd.startsWith("test -e")) return "exists";
        return defaultExecImpl(cmd);
      },
    );
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/create",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe("file exists");
    // Should NOT have called touch after the 409.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const touchCall = calls.find(([, cmd]) => cmd.startsWith("touch "));
    expect(touchCall).toBeUndefined();
  });

  it("404 with { error: 'runbook not found' } when adding a file to a missing runbook (no newRunbook)", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (isRunbookFolderCheck(cmd)) return "missing";
      return defaultExecImpl(cmd);
    });
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/create",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "weekly-report",
        path: "runbook.md",
      }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("runbook not found");
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    expect(calls.find(([, c]) => c.startsWith("mkdir -p"))).toBeUndefined();
    expect(calls.find(([, c]) => c.startsWith("touch "))).toBeUndefined();
  });

  it("newRunbook: true creates the runbook folder and its first file when the runbook is missing", async () => {
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (isRunbookFolderCheck(cmd)) return "missing";
      return defaultExecImpl(cmd);
    });
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/create",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "weekly-report",
        path: "runbook.md",
        newRunbook: true,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ path: "runbook.md", mtime: 1700000042 });
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const check = calls.find(([, c]) => isRunbookFolderCheck(c));
    expect(check![1]).toContain("'/home/testuser/fleet/roles/box-maintainer/runbooks/weekly-report'");
    const mkdirCall = calls.find(([, c]) => c.startsWith("mkdir -p"));
    expect(mkdirCall![1]).toBe("mkdir -p '/home/testuser/fleet/roles/box-maintainer/runbooks/weekly-report'");
    const touchCall = calls.find(([, c]) => c.startsWith("touch "));
    expect(touchCall![1]).toBe("touch '/home/testuser/fleet/roles/box-maintainer/runbooks/weekly-report/runbook.md'");
  });

  it("newRunbook: true answers 409 { error: 'runbook exists' } when the runbook is already there — nothing is created", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/runbooks-editor/create",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        runbook: "avatar-flow",
        path: "runbook.md",
        newRunbook: true,
      }),
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe("runbook exists");
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    expect(calls.find(([, c]) => c.startsWith("mkdir -p"))).toBeUndefined();
    expect(calls.find(([, c]) => c.startsWith("touch "))).toBeUndefined();
  });

  it("400 on invalid path — SSH NOT attempted", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/create",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
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
      path: "/role-skills-editor/create",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "new.md",
      }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("role not found");
    // Critical: no mkdir or touch fired after the 404 — no role skill materialized.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    expect(calls.find(([, c]) => c.startsWith("mkdir -p"))).toBeUndefined();
    expect(calls.find(([, c]) => c.startsWith("touch "))).toBeUndefined();
  });
});

// ===========================================================================
// DELETE /role-skills-editor/file
// ===========================================================================

describe("DELETE /role-skills-editor/file", () => {
  it("200 with { ok:true } on valid input; rm -f against composed path", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/role-skills-editor/file",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const rmCall = calls.find(([, cmd]) => cmd.startsWith("rm -f "));
    expect(rmCall).toBeDefined();
    expect(rmCall![1]).toContain(
      "'/home/testuser/fleet/roles/box-maintainer/skills/avatar-flow/role skill.md'",
    );
  });

  it("200 idempotent — missing file still returns { ok:true }", async () => {
    // rm -f swallows missing files; the exec returns empty string regardless.
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/role-skills-editor/file",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "nonexistent.md",
      }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });

  it("400 on invalid path — SSH NOT attempted", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/role-skills-editor/file",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
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
      path: "/role-skills-editor/file",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe("role not found");
  });

  it("404 on unknown host", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/role-skills-editor/file",
      body: JSON.stringify({
        hostId: 999,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// DELETE /role-skills-editor/skill
// ===========================================================================

describe("DELETE /role-skills-editor/skill", () => {
  it("200 with { ok:true } on valid role skill; rm -rf against composed skillRoot", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/role-skills-editor/skill",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
      }),
    });
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const rmrfCall = calls.find(([, cmd]) => cmd.startsWith("rm -rf "));
    expect(rmrfCall).toBeDefined();
    expect(rmrfCall![1]).toContain(
      "'/home/testuser/fleet/roles/box-maintainer/skills/avatar-flow'",
    );
  });

  it("400 on invalid role skill '../etc' BEFORE any rm -rf runs — SSH NOT attempted", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/role-skills-editor/skill",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "../etc",
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
      path: "/role-skills-editor/skill",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
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
      path: "/role-skills-editor/skill",
      body: JSON.stringify({
        hostId: 999,
        role: "box-maintainer",
        skill: "avatar-flow",
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
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "..",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-2: rejects role '../etc' with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "../etc",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-3: rejects role 'role/../evil' (embedded slash) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "role/../evil",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-4: rejects role '' (empty) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-5: rejects role 'role;rm -rf /' (shell metachar) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "role;rm -rf /",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-6: rejects role 'role name with spaces' (spaces rejected by ROLE_NAME_RE) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "role name with spaces",
        skill: "avatar-flow",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  // ---- SKILL-name attack vectors ----

  it("SEC-7: rejects role skill '..' with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "..",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-8: rejects role skill '../evil' with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "../evil",
        path: "role skill.md",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  // ---- PATH attack vectors ----

  it("SEC-9: rejects path '../../etc/passwd' (..' segment) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "../../etc/passwd",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-10: rejects path '/etc/passwd' (leading slash) with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: "/etc/passwd",
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-11: rejects path with NUL byte with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
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
      path: "/role-skills-editor/read",
      body: JSON.stringify({
        hostId: 1,
        role: "box-maintainer",
        skill: "avatar-flow",
        path: longPath,
      }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  // ---- DELETE /role skill rm-rf guard ----

  it("SEC-13: rejects DELETE /role skill on role '..' (life-critical rm -rf guard)", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/role-skills-editor/skill",
      body: JSON.stringify({ hostId: 1, role: "..", skill: "avatar-flow" }),
    });
    expect(res.status).toBe(400);
    // rm -rf must NEVER have been dispatched.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    const rmrfCall = calls.find(([, cmd]) => cmd.startsWith("rm -rf"));
    expect(rmrfCall).toBeUndefined();
    // SSH must NEVER have opened.
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("SEC-14: rejects GET /role-skills-editor/skills with role containing backslash with 400 before SSH", async () => {
    const res = await httpRequest(server, {
      method: "GET",
      path: "/role-skills-editor/skills?hostId=1&role=foo%5Cbar",
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });
});

// ===========================================================================
// GET /role-skills-editor/download
// ===========================================================================

describe("GET /role-skills-editor/download", () => {
  it("rejects bad input before any SSH", async () => {
    for (const q of [
      "hostId=1&role=box-maintainer&skill=avatar-flow&path=../x",
      "hostId=1&role=Bad Role&skill=avatar-flow&path=a.md",
      "hostId=abc&role=box-maintainer&skill=avatar-flow&path=a.md",
    ]) {
      const res = await httpRequest(server, {
        method: "GET",
        path: `/role-skills-editor/download?${q.replace(/ /g, "%20")}`,
      });
      expect(res.status).toBe(400);
    }
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("streams the file from inside the role skill directory", async () => {
    const realStub = stubConn as typeof stubConn & { sftp?: unknown };
    const seen: string[] = [];
    realStub.sftp = (cb: (e: Error | null, s: unknown) => void) =>
      cb(null, {
        realpath: (p: string, done: (e: Error | null, r: string) => void) => {
          seen.push(p);
          done(null, p === "." ? "/home/testuser" : p);
        },
        stat: (_p: string, done: (e: Error | null, s: unknown) => void) =>
          done(null, { size: 2, isFile: () => true }),
        createReadStream: () => Readable.from([Buffer.from("ok")]),
      });
    try {
      const res = await httpRequest(server, {
        method: "GET",
        path: "/role-skills-editor/download?hostId=1&role=box-maintainer&skill=avatar-flow&path=steps.md",
      });
      expect(res.status).toBe(200);
      expect(res.body).toBe("ok");
      expect(seen).toContain("/home/testuser/fleet/roles/box-maintainer/skills/avatar-flow/steps.md");
    } finally {
      delete realStub.sftp;
    }
  });
});

// ===========================================================================
// PUT /role-skills-editor/write-binary
// ===========================================================================

describe("PUT /role-skills-editor/write-binary", () => {
  it("rejects bad input and empty bodies before any SSH", async () => {
    for (const [q, body] of [
      ["hostId=1&role=box-maintainer&skill=avatar-flow&path=../x.pdf", "%PDF"],
      ["hostId=1&role=box-maintainer&skill=avatar-flow&path=a.pdf", ""],
    ]) {
      const res = await httpRequest(server, {
        method: "PUT",
        path: `/role-skills-editor/write-binary?${q}`,
        headers: { "Content-Type": "application/octet-stream" },
        body,
      });
      expect(res.status).toBe(400);
    }
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });
});

// ===========================================================================
// Folder ↔ name: POST /role-skills-editor/rename + PUT /write name gate
// ===========================================================================

describe("POST /role-skills-editor/skill", () => {
  function create(body: Record<string, unknown>) {
    return httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/skill",
      body: JSON.stringify(body),
    });
  }

  it("creates skills/<name>/SKILL.md with the standard seed", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.startsWith("if [ -e ")) return "ok";
      if (cmd.startsWith("stat -c")) return "1700000099";
      return defaultExecImpl(cmd);
    });
    const res = await create({ hostId: 1, role: "box-maintainer", skill: "ship", description: 'Ship it "now".' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ slug: "ship", mtime: 1700000099 });
    const root = "/home/testuser/fleet/roles/box-maintainer/skills";
    const cmds = (execCommand as Mock).mock.calls.map((c) => c[1] as string);
    expect(cmds.find((c) => c.startsWith("if [ -e "))).toContain(`mkdir '${root}/ship'`);
    expect(writeMarkdownFileAtomic).toHaveBeenCalledWith(
      stubConn,
      `${root}/ship/SKILL.md`,
      '---\nname: ship\ndescription: "Ship it \\"now\\"."\n---\n\n# Ship\n',
    );
  });

  it("409 when the name is taken", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.startsWith("if [ -e ")) return "exists";
      return defaultExecImpl(cmd);
    });
    const res = await create({ hostId: 1, role: "box-maintainer", skill: "ship", description: "d" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "skill exists" });
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });

  it("removes the folder again when the SKILL.md write fails", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.startsWith("if [ -e ")) return "ok";
      return defaultExecImpl(cmd);
    });
    (writeMarkdownFileAtomic as Mock).mockRejectedValueOnce(new Error("sftp"));
    const res = await create({ hostId: 1, role: "box-maintainer", skill: "ship", description: "d" });
    expect(res.status).toBe(502);
    const cmds = (execCommand as Mock).mock.calls.map((c) => c[1] as string);
    expect(cmds).toContain("rm -rf '/home/testuser/fleet/roles/box-maintainer/skills/ship'");
  });

  it("400s a missing, blank or multi-line description and unsafe names before any SSH", async () => {
    for (const body of [
      { hostId: 1, role: "box-maintainer", skill: "ship" },
      { hostId: 1, role: "box-maintainer", skill: "ship", description: "   " },
      { hostId: 1, role: "box-maintainer", skill: "ship", description: "a\nb" },
      { hostId: 1, role: "box-maintainer", skill: "../x", description: "d" },
      { hostId: 1, role: "../x", skill: "ship", description: "d" },
    ]) {
      expect((await create(body)).status).toBe(400);
    }
    expect(connectOneShot).not.toHaveBeenCalled();
  });
});

describe("POST /role-skills-editor/rename", () => {
  function rename(body: Record<string, unknown>) {
    return httpRequest(server, {
      method: "POST",
      path: "/role-skills-editor/rename",
      body: JSON.stringify(body),
    });
  }

  it("moves the folder, retargets forwarding links, rewrites SKILL.md's name", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.startsWith("if [ ! -d ")) return "ok";
      if (cmd.startsWith("n=0;")) return "1";
      if (cmd.startsWith("base64 -w0") && cmd.includes("/deploy/SKILL.md"))
        return Buffer.from("---\nname: ship\n---\n# Ship\n").toString("base64");
      return defaultExecImpl(cmd);
    });
    const res = await rename({ hostId: 1, role: "box-maintainer", skill: "ship", newName: "deploy" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "deploy" });
    const cmds = (execCommand as Mock).mock.calls.map((c) => c[1] as string);
    const role = "/home/testuser/fleet/roles/box-maintainer";
    expect(cmds.find((c) => c.startsWith("if [ ! -d "))).toContain(`mv -T '${role}/skills/ship' '${role}/skills/deploy'`);
    const fwd = cmds.find((c) => c.startsWith("n=0;")) ?? "";
    expect(fwd).toContain(`for l in '${role}/runbooks'/*`);
    expect(fwd).toContain(`if [ "$t" = '../skills/ship' ]; then ln -sfn '../skills/deploy' "$l"`);
    expect(fwd).toContain(`elif [ "$t" = '../skills/ship/SKILL.md' ]; then ln -sfn '../skills/deploy/SKILL.md' "$l"`);
    expect(writeMarkdownFileAtomic).toHaveBeenCalledWith(
      stubConn,
      `${role}/skills/deploy/SKILL.md`,
      "---\nname: deploy\n---\n# Ship\n",
    );
  });

  it("saves a SKILL.md draft into the renamed folder", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.startsWith("if [ ! -d ")) return "ok";
      if (cmd.startsWith("n=0;")) return "0";
      if (cmd.startsWith("stat -c")) return "1700000042";
      return defaultExecImpl(cmd);
    });
    const res = await rename({
      hostId: 1,
      role: "box-maintainer",
      skill: "deploy",
      newName: "staging",
      path: "SKILL.md",
      content: "---\nname: staging\n---\nedited\n",
      expectedMtime: 1700000042,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "staging", path: "SKILL.md" });
    expect(writeMarkdownFileAtomic).toHaveBeenCalledTimes(1);
    expect(writeMarkdownFileAtomic).toHaveBeenCalledWith(
      stubConn,
      "/home/testuser/fleet/roles/box-maintainer/skills/staging/SKILL.md",
      "---\nname: staging\n---\nedited\n",
    );
  });

  it("409 mtime mismatch before anything moves", async () => {
    const res = await rename({
      hostId: 1,
      role: "box-maintainer",
      skill: "ship",
      newName: "deploy",
      path: "SKILL.md",
      content: "x",
      expectedMtime: 1,
    });
    expect(res.status).toBe(409);
    const cmds = (execCommand as Mock).mock.calls.map((c) => c[1] as string);
    expect(cmds.some((c) => c.includes("mv -T"))).toBe(false);
  });

  it("400 when a draft path isn't SKILL.md", async () => {
    for (const path of ["notes.md", "runbook.md", "ship.md"]) {
      const res = await rename({ hostId: 1, role: "box-maintainer", skill: "ship", newName: "deploy", path, content: "x" });
      expect(res.status).toBe(400);
    }
  });

  it("409 when the new name is taken", async () => {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.startsWith("if [ ! -d ")) return "exists";
      return defaultExecImpl(cmd);
    });
    const res = await rename({ hostId: 1, role: "box-maintainer", skill: "ship", newName: "admin" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "skill exists" });
  });

  it("400s unsafe or no-op names before any SSH connect", async () => {
    for (const body of [
      { hostId: 1, role: "box-maintainer", skill: "ship", newName: "../x" },
      { hostId: 1, role: "../x", skill: "ship", newName: "deploy" },
      { hostId: 1, role: "box-maintainer", skill: "ship", newName: "ship" },
    ]) {
      expect((await rename(body)).status).toBe(400);
    }
    expect(connectOneShot).not.toHaveBeenCalled();
  });
});

describe("PUT /role-skills-editor/write — SKILL.md's name must match the folder", () => {
  function write(path: string, content: string) {
    return httpRequest(server, {
      method: "PUT",
      path: "/role-skills-editor/write",
      body: JSON.stringify({ hostId: 1, role: "box-maintainer", skill: "ship", path, content }),
    });
  }
  function onDisk(text: string) {
    (execCommand as Mock).mockImplementation(async (_c: unknown, cmd: string) => {
      if (cmd.startsWith("base64 -w0")) return Buffer.from(text).toString("base64");
      return defaultExecImpl(cmd);
    });
  }

  it("400 name_mismatch on SKILL.md", async () => {
    onDisk("# no frontmatter\n");
    const res = await write("SKILL.md", "---\nname: other\n---\n");
    expect(res.status).toBe(400);
    expect((res.body as { code: string }).code).toBe("name_mismatch");
  });

  it("an untouched pre-existing mismatch still saves", async () => {
    onDisk("---\nname: Old Ship\n---\n");
    expect((await write("SKILL.md", "---\nname: Old Ship\n---\nedited\n")).status).toBe(200);
  });

  it("ignores name: in companion files, including old runbook main-file names", async () => {
    for (const path of ["notes.md", "runbook.md", "ship.md"]) {
      expect((await write(path, "---\nname: other\n---\n")).status).toBe(200);
    }
  });
});
